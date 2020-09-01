const Constant = require('../memory/constant.js');
const Register = require('../memory/register.js');
const LLVM     = require("../../middle/llvm.js");
const TypeRef  = require('../typeRef.js');
const ExecutionBase = require('./base.js');

const Primative = {
	types: require('../../primative/types.js')
};

class Execution extends ExecutionBase {
	/**
	 * Generates the LLVM for a constant
	 * Used in other compile functions
	 * @param {BNF_Node} ast
	 */
	compile_constant(ast) {
		let preamble = new LLVM.Fragment();
		let type = null;
		let val = null;
		switch (ast.tokens[0].type) {
			case "float":
				type = new TypeRef(0, Primative.types.float);
				val = new LLVM.Constant(
					ast.tokens[0].tokens,
					ast.ref.start
				);
				break;
			case "boolean":
				type = new TypeRef(0, Primative.types.bool);
				val = new LLVM.Constant(
					val == "true" ? 1 : 0,
					ast.ref.start
				);
				break;
			case "integer":
				type = new TypeRef(0, Primative.types.i32);
				val = new LLVM.Constant(
					ast.tokens[0].tokens,
					ast.ref.start
				);
				break;
			case "string":
				let bytes = ast.tokens[0].tokens[1].length + 1;
				let str = ast.tokens[0].tokens[1].replace(/\"/g, "\\22").replace(/\n/g, '\\0A') + "\\00";

				let ir_t1 = new LLVM.Type(`[ ${bytes} x i8 ]`, 0, ast.ref);
				let ir_t2 = new LLVM.Type(`i8`, 1);

				let str_id = new LLVM.ID();
				let ptr_id = new LLVM.ID();

				preamble.append(new LLVM.Set(
					new LLVM.Name(str_id, false, ast.ref),
					new LLVM.Alloc(
						ir_t1,
						ast.ref
					),
					ast.ref
				));
				preamble.append(new LLVM.Store(
					new LLVM.Argument(
						new LLVM.Type(`[ ${bytes} x i8 ]*`, 0, ast.ref),
						new LLVM.Name(str_id.reference(), false, ast.ref),
						ast.ref, "#str_const"
					),
					new LLVM.Argument(
						ir_t1,
						new LLVM.Constant(`c"${str}"`, ast.ref),
						ast.ref
					)
				));
				preamble.append(new LLVM.Set(
					new LLVM.Name(ptr_id, false, ast.ref),
					new LLVM.Bitcast(
						ir_t2,
						new LLVM.Argument(
							new LLVM.Type(`[ ${bytes} x i8 ]*`, 0, ast.ref),
							new LLVM.Name(str_id.reference(), false, ast.ref),
							ast.ref, "#str_const"
						),
						ast.ref
					),
					ast.ref
				));

				type = new TypeRef(1, Primative.types.i8);
				val = new LLVM.Name(ptr_id, false, ast.ref);
				break;
			default:
				throw new Error(`Unknown constant type ${ast.tokens[0].type}`);
		}

		return {
			instruction: new LLVM.Argument(
				new LLVM.Type(type.type.represent, type.pointer, ast.ref.start),
				val,
				ast.ref
			),
			preamble,
			epilog: new LLVM.Fragment(),
			type: type,
		};
	}



	/**
	 *
	 * @param {BNF_Node} ast
	 * @param {Array[Number, TypeDef]} expects
	 * @param {Boolean} simple Simplifies the result to a single register when possible
	 */
	compile_expr (ast, expects = null, simple = false, block = false) {
		if (ast.type == "expr_brackets") {
			ast = ast.tokens[0];
		}

		let recursiveFail = false;
		let res = null;
		switch (ast.type) {
			case "constant":
				res = this.compile_constant(ast);
				break;
			case "call":
				if (block) {
					recursiveFail = true;
					break;
				}

				res = this.compile_call(ast);
				break;
			case "variable":
				res = this.compile_loadVariable(ast);
				break;
			case "expr_arithmetic":
				res = this.compile_expr_arithmetic(ast.tokens[0]);
				break;
			case "expr_compare":
				res = this.compile_expr_compare(ast.tokens[0]);
				break;
			case "expr_bool":
				res = this.compile_expr_bool(ast.tokens[0]);
				break;
			default:
				throw new Error(`Unexpected expression type ${ast.type}`);
		}

		if (recursiveFail) {
			this.getFile().throw(
				`Error: Recursive expression are not allowed at this stage`,
				ast.ref.start, ast.ref.end
			);
			return null;
		}

		if (res === null) {
			return null;
		}

		if (expects instanceof TypeRef && !expects.match(res.type)) {
			this.getFile().throw(
				`Error: Type miss-match, ` +
					`expected ${expects.toString()}, ` +
					`instead got ${res.type.toString()}`,
				ast.ref.start, ast.ref.end
			);
			return null;
		}

		/**
		 * Simplify result to a single register when;
		 *   - Simplifying is specified
		 *   - The value is not a constant
		 *   - The expected type is known
		 */
		if (
			simple &&
			!( res.instruction instanceof LLVM.Argument )
		) {
			let inner = res.instruction;
			let irType = null;
			if (expects) {
				irType = new LLVM.Type(expects.type.represent, expects.pointer, ast.ref.start)
			} else {
				if (!res.type) {
					throw new Error("Error: Cannot simplify due to undeduceable type");
				}
				irType = res.type;
			}

			res.register = new Register(res.type, "temp", ast.ref.start);
			let regIR = res.register.toLLVM();

			res.preamble.append(new LLVM.Set(
				regIR.name,
				inner,
				ast.ref.start
			));
			res.instruction = regIR;
		}

		res.ref = ast.ref;
		return res;
	}

	compile_expr_opperand (ast) {
		switch (ast.type) {
			case "variable":
				return this.compile_loadVariable(ast);
			case "constant":
				return this.compile_constant(ast);
			case "expr_brackets":
			case "call":
				return this.compile_expr(ast, null, true);
			default:
				throw new Error(`Unexpected expression opperand type ${ast.type} ${ast.ref.start.toString()}:${ast.ref.end.toString()}`);
		}
	}

	compile_expr_arithmetic(ast) {
		let action = null;
		switch (ast.type) {
			case "expr_add":
				action = "Add";
				break;
			case "expr_sub":
				action = "Sub";
				break;
			case "expr_mul":
				action = "Mul";
				break;
			case "expr_div":
				action = "Div";
				break;
			case "expr_mod":
				action = "Rem";
				break;
			default:
				throw new Error(`Unexpected arithmetic expression type ${ast.type}`);
		}



		let preamble = new LLVM.Fragment();
		let epilog = new LLVM.Fragment();

		// Load the two operands ready for operation
		let opperands = [
			this.compile_expr_opperand(ast.tokens[0]),
			this.compile_expr_opperand(ast.tokens[2])
		];

		if (opperands[0] === null || opperands[1] === null) {
			return null;
		}

		// Append the load instructions
		preamble.merge(opperands[0].preamble);
		preamble.merge(opperands[1].preamble);

		// Append the cleanup instructions
		epilog.merge(opperands[0].epilog);
		epilog.merge(opperands[1].epilog);



		// Check opperands are primatives
		if (!opperands[0].type.type.primative) {
			this.getFile().throw(
				`Error: Cannot run arithmetic opperation on non-primative type`,
				ast.tokens[0].ref.start, ast.tokens[0].ref.end
			);
			return null;
		}
		if (!opperands[1].type.type.primative) {
			this.getFile().throw(
				`Error: Cannot run arithmetic opperation on non-primative type`,
				ast.tokens[2].ref.start, ast.tokens[2].ref.end
			);
			return null;
		}


		// Check opperands are the same type
		if (!opperands[0].type.match(opperands[1].type)) {
			this.getFile().throw(
				`Error: Cannot perform arithmetic opperation on unequal types`,
				ast.tokens[0].ref.start, ast.tokens[2].ref.end
			);
			return null;
		}


		// Get the arrithmetic mode
		let mode = null;
		if (opperands[0].type.type.cat == "int") {
			mode = opperands[0].type.type.signed ? 0 : 1;
		} else if (opperands[0].type.type.cat == "float") {
			mode = 2;
		}
		if (mode === null) {
			this.getFile().throw(
				`Error: Unable to perform arithmetic opperation for unknown reason`,
				ast.tokens[1].ref.start, ast.tokens[1].ref.end
			);
			return null;
		}



		return {
			preamble, epilog,
			instruction: new LLVM[action](
				mode,
				opperands[0].instruction.type,
				opperands[0].instruction.name,
				opperands[1].instruction.name
			),
			type: opperands[0].type
		};
	}

	compile_expr_compare(ast) {
		let preamble = new LLVM.Fragment();
		let epilog = new LLVM.Fragment();


		// Load the two operands ready for operation
		let opperands = [
			this.compile_expr_opperand(ast.tokens[0]),
			this.compile_expr_opperand(ast.tokens[2])
		];


		// Check opperands are primatives
		if (!opperands[0].type.type.primative) {
			this.getFile().throw(
				`Error: Cannot perform comparison opperation on non-primative type`,
				ast.tokens[0].ref.start, ast.tokens[0].ref.end
			);
			return null;
		}
		if (!opperands[1].type.type.primative) {
			this.getFile().throw(
				`Error: Cannot perform comparison opperation on non-primative type`,
				ast.tokens[2].ref.start, ast.tokens[2].ref.end
			);
			return null;
		}


		// Check opperands are the same type
		if (!opperands[0].type.match(opperands[1].type)) {
			this.getFile().throw(
				`Error: Cannot perform comparison opperation on unequal types`,
				ast.tokens[0].ref.start, ast.tokens[2].ref.end
			);
			return null;
		}


		// Get the arrithmetic mode
		let mode = null;
		if (opperands[0].type.type.cat == "int") {
			mode = opperands[0].type.type.signed ? 0 : 1;
		} else if (opperands[0].type.type.cat == "float") {
			mode = 2;
		}
		if (mode === null) {
			this.getFile().throw(
				`Error: Unable to perform comparison opperation for unknown reason`,
				ast.tokens[1].ref.start, ast.tokens[1].ref.end
			);
			return null;
		}


		let cond = null;
		switch (ast.type) {
			case "expr_eq":
				cond = mode == 2 ? "oeq" : "eq";
				break;
			case "expr_neq":
				cond = mode == 2 ? "une" : "ne";
				break;
			case "expr_gt":
				cond = mode == 0 ? "ugt" :
					mode == 1 ? "sgt" :
					"ogt";
				break;
			case "expr_gt_eq":
				cond = mode == 0 ? "uge" :
					mode == 1 ? "sge" :
					"oge";
				break;
			case "expr_lt":
				cond = mode == 0 ? "ult" :
					mode == 1 ? "slt" :
					"olt";
				break;
			case "expr_lt_eq":
				cond = mode == 0 ? "ule" :
					mode == 1 ? "sle" :
					"ole";
				break;
			default:
				throw new Error(`Unexpected comparison expression type ${ast.type}`);
		}


		// Append the load instructions
		preamble.merge(opperands[0].preamble);
		preamble.merge(opperands[1].preamble);

		// Append the cleanup instructions
		epilog.merge(opperands[0].epilog);
		epilog.merge(opperands[1].epilog);



		return {
			preamble, epilog,
			instruction: new LLVM.Compare(
				mode,
				cond,
				opperands[0].instruction.type,
				opperands[0].instruction.name,
				opperands[1].instruction.name
			),
			type: new TypeRef(0, Primative.types.bool)
		};
	}

	compile_expr_bool(ast) {
		let preamble = new LLVM.Fragment();
		let epilog = new LLVM.Fragment();


		let opperands = [];
		let action = null;
		let type = new TypeRef(0, Primative.types.bool);
		switch (ast.type) {
			case "expr_and":
			case "expr_or":
				action = ast.type == "expr_and" ? "And" : "Or";
				opperands = [
					this.compile_expr_opperand(ast.tokens[0]),
					this.compile_expr_opperand(ast.tokens[2])
				];
				break;
			case "expr_not":
				action = "XOr";
				opperands = [
					this.compile_expr_opperand(ast.tokens[0]),
					{
						preamble: new LLVM.Fragment(),
						epilog: new LLVM.Fragment(),
						instruction: new LLVM.Constant("true"),
						type
					}
				];
				break;
			default:
				throw new Error(`Unexpected boolean expression type ${ast.type}`);
		}


		// Check opperands are of boolean type
		if (!opperands[0].type.match(type)) {
			this.getFile().throw(
				`Error: Cannot perform boolean opperation on non boolean types`,
				ast.tokens[0].ref.start, ast.tokens[0].ref.end
			);
			return null;
		}
		if (!opperands[1].type.match(type)) {
			this.getFile().throw(
				`Error: Cannot perform boolean opperation on non boolean types`,
				ast.tokens[2].ref.start, ast.tokens[2].ref.end
			);
			return null;
		}


		// Append the load instructions
		preamble.merge(opperands[0].preamble);
		preamble.merge(opperands[1].preamble);

		// Append the cleanup instructions
		epilog.merge(opperands[0].epilog);
		epilog.merge(opperands[1].epilog);


		let instruction = new LLVM[action](
			opperands[0].instruction.type,
			opperands[0].instruction.name,
			action == "XOr" ? opperands[1].instruction : opperands[1].instruction.name
		);

		return {
			preamble, epilog,
			instruction,
			type
		};
	}
}

module.exports = Execution;
