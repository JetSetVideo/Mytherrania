// Expression evaluator for the climate contract's `Expr` (G16). Pure: no THREE, no DOM.
//
// An Expr is a number literal, a variable reference {v}, a coefficient reference {c} or an
// operator node {op, args}. Two ways to run one:
//   evalExpr(expr, vars, coefficients)   — tree walk, for tests and one-offs;
//   compileExpr(expr, coefficients, vars?) — resolves coefficients and validates every reference
//     ONCE, returning a closure `(vars) => number` that allocates nothing per call (the world
//     equations run every frame through these closures).
//
// Semantics are total: every operator returns a finite number for finite inputs (division by
// zero -> 0, log of <= 0 -> log(1e-9), sqrt of < 0 -> 0, overflow -> 0), so one bad input cannot
// poison the whole world table with NaN/Infinity. GLSL conventions where GLSL has the op.

import { EXPR_OPS, type Expr, type ExprOp } from "./contracts.ts";
import { clamp, lerp } from "../../core/MathCore.ts";

export type ExprVars = Readonly<Record<string, number>>;
export type ExprCoefficients = Readonly<Record<string, number>>;
export type CompiledExpr = (vars: ExprVars) => number;

/** Arity of each operator: [min, max] argument counts (Infinity = n-ary). */
export const EXPR_ARITY: Readonly<Record<ExprOp, readonly [number, number]>> = {
  add: [2, Infinity], sub: [2, 2], mul: [2, Infinity], div: [2, 2], mod: [2, 2], pow: [2, 2],
  neg: [1, 1], abs: [1, 1], sign: [1, 1], min: [1, Infinity], max: [1, Infinity], clamp: [3, 3],
  sqrt: [1, 1], exp: [1, 1], log: [1, 1], sin: [1, 1], cos: [1, 1], tan: [1, 1], atan2: [2, 2],
  floor: [1, 1], fract: [1, 1], hypot: [1, Infinity], mix: [3, 3], step: [2, 2],
  smoothstep: [3, 3], select: [3, 3],
};

const OP_SET: ReadonlySet<string> = new Set(EXPR_OPS);
/** Smallest argument `log` sees (log(x) of x <= 0 is undefined; we floor it). */
export const LOG_FLOOR = 1e-9;

/** A non-finite result becomes 0: the evaluator never emits NaN or Infinity. */
function fin(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

// ---------------------------------------------------------------- scalar semantics (shared)

/** a / b, 0 when b == 0. */
export function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : fin(a / b);
}
/** GLSL mod: a - b * floor(a / b); 0 when b == 0. Result has the sign of b. */
export function glslMod(a: number, b: number): number {
  return b === 0 ? 0 : fin(a - b * Math.floor(a / b));
}
/** Sign-preserving power: sign(a) * |a|^b (a real result for a negative base). */
export function signedPow(a: number, b: number): number {
  if (a === 0) return b > 0 ? 0 : b === 0 ? 1 : 0;
  return fin(a < 0 ? -Math.pow(-a, b) : Math.pow(a, b));
}
/** GLSL smoothstep(e0, e1, x); e0 == e1 degenerates to step(e0, x). Works for e0 > e1 too. */
export function glslSmoothstep(e0: number, e1: number, x: number): number {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
/** GLSL step(edge, x): 0 when x < edge, else 1. */
export function glslStep(edge: number, x: number): number {
  return x < edge ? 0 : 1;
}

function applyOp(op: ExprOp, a: readonly number[]): number {
  switch (op) {
    case "add": { let s = 0; for (const x of a) s += x; return fin(s); }
    case "sub": return fin(a[0] - a[1]);
    case "mul": { let p = 1; for (const x of a) p *= x; return fin(p); }
    case "div": return safeDiv(a[0], a[1]);
    case "mod": return glslMod(a[0], a[1]);
    case "pow": return signedPow(a[0], a[1]);
    case "neg": return -a[0];
    case "abs": return Math.abs(a[0]);
    case "sign": return Math.sign(a[0]);
    case "min": { let m = a[0]; for (let i = 1; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }
    case "max": { let m = a[0]; for (let i = 1; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
    case "clamp": return clamp(a[0], a[1], a[2]);
    case "sqrt": return Math.sqrt(Math.max(0, a[0]));
    case "exp": return fin(Math.exp(a[0]));
    case "log": return Math.log(Math.max(LOG_FLOOR, a[0]));
    case "sin": return Math.sin(a[0]);
    case "cos": return Math.cos(a[0]);
    case "tan": return fin(Math.tan(a[0]));
    case "atan2": return Math.atan2(a[0], a[1]);
    case "floor": return Math.floor(a[0]);
    case "fract": return a[0] - Math.floor(a[0]);
    case "hypot": { let s = 0; for (const x of a) s += x * x; return fin(Math.sqrt(s)); }
    case "mix": return fin(lerp(a[0], a[1], a[2]));
    case "step": return glslStep(a[0], a[1]);
    case "smoothstep": return glslSmoothstep(a[0], a[1], a[2]);
    case "select": return a[0] > 0.5 ? a[1] : a[2];
  }
}

// ---------------------------------------------------------------- node predicates

export function isVarRef(e: Expr): e is { v: string } {
  return typeof e === "object" && "v" in e;
}
export function isCoefRef(e: Expr): e is { c: string } {
  return typeof e === "object" && "c" in e;
}
export function isOpNode(e: Expr): e is { op: ExprOp; args: readonly Expr[] } {
  return typeof e === "object" && "op" in e;
}

function checkArity(op: ExprOp, n: number): void {
  if (!OP_SET.has(op)) throw new Error(`expr: unknown operator "${op}"`);
  const [lo, hi] = EXPR_ARITY[op];
  if (n < lo || n > hi) throw new Error(`expr: "${op}" takes ${lo}${hi === Infinity ? "+" : hi === lo ? "" : ".." + hi} args, got ${n}`);
}

// ---------------------------------------------------------------- tree-walk evaluation

/** Evaluate `expr` directly. Throws on an unknown variable/coefficient (naming it) or bad arity. */
export function evalExpr(expr: Expr, vars: ExprVars, coefficients: ExprCoefficients): number {
  if (typeof expr === "number") return expr;
  if (isVarRef(expr)) {
    const x = vars[expr.v];
    if (x === undefined) throw new Error(`expr: unknown variable "${expr.v}"`);
    return x;
  }
  if (isCoefRef(expr)) {
    const x = coefficients[expr.c];
    if (x === undefined) throw new Error(`expr: unknown coefficient "${expr.c}"`);
    return x;
  }
  checkArity(expr.op, expr.args.length);
  const vals = expr.args.map((a) => evalExpr(a, vars, coefficients));
  return applyOp(expr.op, vals);
}

// ---------------------------------------------------------------- compilation

/**
 * Compile `expr` into a closure. Coefficients are resolved now (inlined as constants); when
 * `knownVars` is given every variable reference is checked against it. Throws at compile time,
 * naming the unknown variable/coefficient. A variable missing at CALL time reads as 0.
 */
export function compileExpr(expr: Expr, coefficients: ExprCoefficients, knownVars?: ReadonlySet<string>): CompiledExpr {
  if (typeof expr === "number") { const k = expr; return () => k; }
  if (isVarRef(expr)) {
    const name = expr.v;
    if (knownVars && !knownVars.has(name)) throw new Error(`expr: unknown variable "${name}"`);
    return (vars) => vars[name] ?? 0;
  }
  if (isCoefRef(expr)) {
    const k = coefficients[expr.c];
    if (k === undefined) throw new Error(`expr: unknown coefficient "${expr.c}"`);
    return () => k;
  }
  const op = expr.op;
  checkArity(op, expr.args.length);
  const f = expr.args.map((a) => compileExpr(a, coefficients, knownVars));
  const [a, b, c] = f;
  switch (op) {
    case "add":
      if (f.length === 2) return (v) => fin(a(v) + b(v));
      return (v) => { let s = 0; for (let i = 0; i < f.length; i++) s += f[i](v); return fin(s); };
    case "mul":
      if (f.length === 2) return (v) => fin(a(v) * b(v));
      return (v) => { let p = 1; for (let i = 0; i < f.length; i++) p *= f[i](v); return fin(p); };
    case "sub": return (v) => fin(a(v) - b(v));
    case "div": return (v) => safeDiv(a(v), b(v));
    case "mod": return (v) => glslMod(a(v), b(v));
    case "pow": return (v) => signedPow(a(v), b(v));
    case "neg": return (v) => -a(v);
    case "abs": return (v) => Math.abs(a(v));
    case "sign": return (v) => Math.sign(a(v));
    case "min":
      return (v) => { let m = a(v); for (let i = 1; i < f.length; i++) { const x = f[i](v); if (x < m) m = x; } return m; };
    case "max":
      return (v) => { let m = a(v); for (let i = 1; i < f.length; i++) { const x = f[i](v); if (x > m) m = x; } return m; };
    case "clamp": return (v) => clamp(a(v), b(v), c(v));
    case "sqrt": return (v) => Math.sqrt(Math.max(0, a(v)));
    case "exp": return (v) => fin(Math.exp(a(v)));
    case "log": return (v) => Math.log(Math.max(LOG_FLOOR, a(v)));
    case "sin": return (v) => Math.sin(a(v));
    case "cos": return (v) => Math.cos(a(v));
    case "tan": return (v) => fin(Math.tan(a(v)));
    case "atan2": return (v) => Math.atan2(a(v), b(v));
    case "floor": return (v) => Math.floor(a(v));
    case "fract": return (v) => { const x = a(v); return x - Math.floor(x); };
    case "hypot":
      return (v) => { let s = 0; for (let i = 0; i < f.length; i++) { const x = f[i](v); s += x * x; } return fin(Math.sqrt(s)); };
    case "mix": return (v) => fin(lerp(a(v), b(v), c(v)));
    case "step": return (v) => glslStep(a(v), b(v));
    case "smoothstep": return (v) => glslSmoothstep(a(v), b(v), c(v));
    case "select": return (v) => (a(v) > 0.5 ? b(v) : c(v));
  }
}

// ---------------------------------------------------------------- references

export interface ExprRefs {
  vars: Set<string>;
  coefficients: Set<string>;
  ops: Set<ExprOp>;
}

/** Every variable, coefficient and operator an expression uses (accumulates into `into`). */
export function exprRefs(expr: Expr, into: ExprRefs = { vars: new Set(), coefficients: new Set(), ops: new Set() }): ExprRefs {
  if (typeof expr === "number") return into;
  if (isVarRef(expr)) { into.vars.add(expr.v); return into; }
  if (isCoefRef(expr)) { into.coefficients.add(expr.c); return into; }
  into.ops.add(expr.op);
  for (const a of expr.args) exprRefs(a, into);
  return into;
}

// ---------------------------------------------------------------- builder (terse equation authoring)

type A = Expr;
const node = (op: ExprOp, args: readonly A[]): Expr => ({ op, args });

/** Terse constructors so WorldVars reads like the maths: X.mul(X.v("rain"), X.c("k")). */
export const X = {
  v: (id: string): Expr => ({ v: id }),
  c: (id: string): Expr => ({ c: id }),
  add: (...a: A[]) => node("add", a), sub: (a: A, b: A) => node("sub", [a, b]),
  mul: (...a: A[]) => node("mul", a), div: (a: A, b: A) => node("div", [a, b]),
  mod: (a: A, b: A) => node("mod", [a, b]), pow: (a: A, b: A) => node("pow", [a, b]),
  neg: (a: A) => node("neg", [a]), abs: (a: A) => node("abs", [a]), sign: (a: A) => node("sign", [a]),
  min: (...a: A[]) => node("min", a), max: (...a: A[]) => node("max", a),
  clamp: (x: A, lo: A, hi: A) => node("clamp", [x, lo, hi]),
  sqrt: (a: A) => node("sqrt", [a]), exp: (a: A) => node("exp", [a]), log: (a: A) => node("log", [a]),
  sin: (a: A) => node("sin", [a]), cos: (a: A) => node("cos", [a]), tan: (a: A) => node("tan", [a]),
  atan2: (y: A, x: A) => node("atan2", [y, x]),
  floor: (a: A) => node("floor", [a]), fract: (a: A) => node("fract", [a]),
  hypot: (...a: A[]) => node("hypot", a),
  mix: (a: A, b: A, t: A) => node("mix", [a, b, t]), step: (edge: A, x: A) => node("step", [edge, x]),
  smoothstep: (e0: A, e1: A, x: A) => node("smoothstep", [e0, e1, x]),
  select: (cond: A, a: A, b: A) => node("select", [cond, a, b]),
} as const;
