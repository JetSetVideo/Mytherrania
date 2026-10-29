// Lane C: the Expr evaluator — every operator's semantics, compile-time reference checks, refs.
import { EXPR_OPS, type Expr } from "../src/world/climate/contracts.ts";
import { compileExpr, evalExpr, EXPR_ARITY, exprRefs, X } from "../src/world/climate/Expr.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const COEF = { k: 2, half: 0.5 };
const VARS = { x: 3, y: -2, z: 0 };
const { v, c } = X;

/** Evaluate both ways and require they agree. */
function both(e: Expr): number {
  const a = evalExpr(e, VARS, COEF);
  const b = compileExpr(e, COEF, new Set(Object.keys(VARS)))(VARS);
  assert(Object.is(a, b) || near(a, b), `eval ${a} != compiled ${b} for ${JSON.stringify(e)}`);
  return a;
}

Deno.test("expr: every operator has an arity and matches its documented semantics (tree walk == compiled)", () => {
  for (const op of EXPR_OPS) assert(EXPR_ARITY[op], `arity for ${op}`);
  const cases: [Expr, number][] = [
    [X.add(v("x"), 1, c("k")), 6], [X.sub(v("x"), v("y")), 5], [X.mul(v("x"), v("y"), c("half")), -3],
    [X.div(v("x"), 2), 1.5], [X.div(v("x"), v("z")), 0],
    [X.mod(7, 3), 1], [X.mod(-1, 3), 2], [X.mod(5, 0), 0],
    [X.pow(2, 3), 8], [X.pow(-8, 1 / 3), -2], [X.pow(0, -1), 0],
    [X.neg(v("x")), -3], [X.abs(v("y")), 2], [X.sign(v("y")), -1], [X.sign(v("z")), 0],
    [X.min(4, v("y"), 9), -2], [X.max(v("x")), 3], [X.max(1, 5, v("x")), 5],
    [X.clamp(v("x"), 0, 1), 1], [X.clamp(v("y"), 0, 1), 0],
    [X.sqrt(16), 4], [X.sqrt(-4), 0], [X.exp(0), 1], [X.exp(1e6), 0],
    [X.log(Math.E), 1], [X.log(0), Math.log(1e-9)], [X.log(-5), Math.log(1e-9)],
    [X.sin(0), 0], [X.cos(0), 1], [X.tan(0), 0], [X.atan2(1, 0), Math.PI / 2], [X.atan2(0, -1), Math.PI],
    [X.floor(-1.5), -2], [X.fract(-1.25), 0.75], [X.fract(2.5), 0.5],
    [X.hypot(3, 4), 5], [X.hypot(1, 2, 2), 3],
    [X.mix(2, 4, 0.25), 2.5], [X.step(1, 0.5), 0], [X.step(1, 1), 1],
    [X.smoothstep(0, 1, 0.5), 0.5], [X.smoothstep(0, 1, -1), 0], [X.smoothstep(0, 1, 2), 1], [X.smoothstep(1, 1, 1), 1],
    [X.smoothstep(1, 0, 0.25), 0.84375],
    [X.select(1, 10, 20), 10], [X.select(0.5, 10, 20), 20],
  ];
  for (const [e, want] of cases) {
    const got = both(e);
    assert(near(got, want), `${JSON.stringify(e)} = ${got}, want ${want}`);
    assert(Number.isFinite(got), "always finite");
  }
  const used = new Set<string>();
  for (const [e] of cases) for (const op of exprRefs(e).ops) used.add(op);
  for (const op of EXPR_OPS) assert(used.has(op), `semantics test covers ${op}`);
});

Deno.test("expr: unknown variables / coefficients throw at COMPILE time naming them; arity is checked", () => {
  const known = new Set(["x"]);
  let msg = "";
  try { compileExpr(X.add(v("x"), v("nope")), COEF, known); } catch (e) { msg = (e as Error).message; }
  assert(msg.includes("nope"), `unknown variable named: ${msg}`);
  msg = "";
  try { compileExpr(X.mul(c("missingCoef"), 2), COEF); } catch (e) { msg = (e as Error).message; }
  assert(msg.includes("missingCoef"), `unknown coefficient named: ${msg}`);
  msg = "";
  try { compileExpr({ op: "clamp", args: [1, 2] }, COEF); } catch (e) { msg = (e as Error).message; }
  assert(msg.includes("clamp"), `arity error: ${msg}`);
  msg = "";
  try { evalExpr(v("ghost"), VARS, COEF); } catch (e) { msg = (e as Error).message; }
  assert(msg.includes("ghost"), "evalExpr names unknown variables");
});

Deno.test("expr: exprRefs lists variables, coefficients and operators", () => {
  const r = exprRefs(X.mix(v("a"), X.mul(c("k"), v("b")), X.smoothstep(0, 1, v("a"))));
  assert(r.vars.size === 2 && r.vars.has("a") && r.vars.has("b"), "vars");
  assert(r.coefficients.size === 1 && r.coefficients.has("k"), "coefficients");
  assert(r.ops.has("mix") && r.ops.has("mul") && r.ops.has("smoothstep") && r.ops.size === 3, "ops");
});

Deno.test("expr: a compiled closure reads fresh values on each call", () => {
  const f = compileExpr(X.add(v("a"), c("k")), COEF);
  const vars: Record<string, number> = { a: 1 };
  assert(f(vars) === 3, "first");
  vars.a = 10;
  assert(f(vars) === 12, "re-reads");
});
