function Simplify (node) {
	switch (node.type) {
		case 'program':
			return SimplifyProgram(node);
	}

	return null;
};
function SimplifyProgram(node) {
	let out = [];

	for (let token of node.tokens[0]){
		if (token.tokens[0][0].type == "def") {
			out.push(SimplifyDef(token.tokens[0][0]));
		} else if (token.tokens[0][0].type == "comment") {
			continue;
		} else {
			throw new Error("BNF Compile Error: Unknown top level data type");
		}
	}

	node.tokens = out;
	return node;
}
function SimplifyDef (node) {
	let out = [
		SimplifyName(node.tokens[0][0]),
		SimplifyExpr(node.tokens[4][0])
	];

	node.tokens = out;
	return node;
}
function SimplifyName (node) {
	let arr = node.tokens[0].concat(node.tokens[1]);
	let out = arr[0].tokens;
	for (let i=1; i<arr.length; i++){
		out += arr[i].tokens[0].tokens
	}

	node.tokens = out;
	return node;
}
function SimplifyExpr (node) {
	let out = [SimplifyExprP2(node.tokens[0][0])]

	for (let token of node.tokens[1]) {
		out.push( SimplifyExprP2(token.tokens[2][0]) );
	}

	// Simplify recusion
	if (
		out.length == 1 &&
		(out[0].type == "expr" || out[0].type == "expr_p2_or")
	) {
		return out[0];
	}

	node.tokens = out;
	return node;
}
function SimplifyExprP2(node) {
	switch (node.tokens[0].type) {
		case 'expr_p1':
			return SimplifyExprP1(node.tokens[0]);
		case 'expr_p2_or':
			return SimplifyExprOr(node.tokens[0]);
	}

	throw new Error(`BNF Compile Error: Unknown expr_p2 expression ${node.type}`);
}
function SimplifyExprOr(node) {

	node.tokens = [
		SimplifyExprP1(node.tokens[0][0]),
		SimplifyExprP2(node.tokens[5][0]),
	];

	if (node.tokens[1].type == "expr_p2_or") {
		node.tokens = [node.tokens[0]].concat(node.tokens[1].tokens);
	}

	return node;
}
function SimplifyExprP1(node) {
	switch (node.tokens[0].type) {
		case "expr_p1_not":
			return SimplifyP1Not(node.tokens[0]);
		case "expr_p1_opt":
		case "expr_p1_orm":
		case "expr_p1_zrm":
			return SimplifyP1(node.tokens[0]);
		case "expr_opperand":
			return SimplifyExprOpperand(node.tokens[0]);
	}

	throw new Error(`BNF Compile Error: Unknown expr_p2 expression ${node.tokens[0].type}`);
}
function SimplifyP1Not (node) {
	node.tokens = SimplifyExprOpperand(node.tokens[1][0]);
	return node;
}
function SimplifyP1 (node) {
	node.tokens = SimplifyExprOpperand(node.tokens[0][0]);
	return node;
}
function SimplifyExprOpperand(node){
	switch (node.tokens[0].type) {
		case "name":
			return SimplifyName(node.tokens[0]);
		case "constant":
			return SimplifyConstant(node.tokens[0]);
		case "brackets":
			return SimplifyBrackets(node.tokens[0]);
	}

	throw new Error(`BNF Compile Error: Unknown expr_opperand expression ${node.tokens[0].type}`);
}
function SimplifyConstant(node) {
	let str = "";
	for (let term of node.tokens[1]){
		if (typeof(term.tokens) == "string") {
			str += term.tokens
		} else {
			str += term.tokens[0].tokens;
		}
	}

	node.tokens = str;
	return node;
}
function SimplifyBrackets(node) {
	return SimplifyExpr(node.tokens[2][0]);
}



function Compile(tree) {
	tree = Simplify(tree);

	let tempNo = 0;
	let out = {};

	function GenerateTerminal(name, expr) {
		if (out[name]) {
			throw new Error(`BNF Compilation: Multiple occurances of term name ${name}`);
		}

		if (expr.type == "expr_p2_or") { // Select
			out[name] = {
				type: "select",
				match: []
			};

			for (let opt of expr.tokens){
				if (opt.type == "constant") {
					out[name].match.push({
						type: "literal",
						val: opt.tokens
					});
				} else if (opt.type == "name") {
					out[name].match.push({
						type: "ref",
						val: opt.tokens
					});
				} else {
					let temp = `#t${tempNo++}`;
					GenerateTerminal(temp, opt);
					out[name].match.push({
						type: "ref",
						val: temp,
						count: "1"
					});
				}
			}
		} else if (expr.type == "expr_p1_not") {
			let temp = `#t${tempNo++}`;
			GenerateTerminal(temp, expr.tokens);
			out[name] = {
				type: "not",
				match: temp
			};
		} else {                         // Sequence
			out[name] = {
				type: "sequence",
				match: []
			};

			for (let opt of expr.tokens) {
				let term = opt;
				let count = "1";
				if        (opt.type == "expr_p1_opt") {
					term = term.tokens;
					count = "?"
				} else if (opt.type == "expr_p1_zrm") {
					term = term.tokens;
					count = "*"
				} else if (opt.type == "expr_p1_orm") {
					term = term.tokens;
					count = "+"
				}

				if (term.type == "name") {
					out[name].match.push({
						type: "ref",
						val: opt.tokens,
						count: count
					});
				} else if (term.type == "constant") {
					out[name].match.push({
						type: "literal",
						val: opt.tokens,
						count: count
					});
				} else {
					let temp = `#t${tempNo++}`;
					GenerateTerminal(temp, term);
					out[name].match.push({
						type: "ref",
						val: temp,
						count: count
					});
				}
			}
		}
	}

	for (let term of tree.tokens) {
		GenerateTerminal(term.tokens[0].tokens, term.tokens[1]);
	}

	// console.log(167, out);

	return out;
};


module.exports = Compile;