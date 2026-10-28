// Dead-code audit for the zero-dead-code rule.
//
// A runtime symbol is LIVE when some runtime file (src/ or main.ts) references it —
// either another module, or its own module beyond the declaration line. Tests and
// tools are not runtime callers. Output, per exported FUNCTION:
//   DEAD       — referenced by no runtime code at all (may be tested, but unreachable)
//   TEST-ONLY  — the same, but at least a test or tool exercises it
// Constants and types are listed separately: a constant exported for a test bound
// (e.g. PHYSICS_MUL_MAX) is documentation of a live value, not unreachable code.
//   deno run -A tools/dead-exports.ts
const root = new URL("..", import.meta.url).pathname;
const runtime: string[] = [];
const support: string[] = [];
async function walk(dir: string, into: string[]) {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) await walk(p, into);
    else if (p.endsWith(".ts")) into.push(p);
  }
}
await walk(`${root}src`, runtime);
runtime.push(`${root}main.ts`);
// Tools are deliverables (the Monte Carlo harness, QA probes, generators): a function
// a tool calls is live. Tests alone are NOT callers.
await walk(`${root}tools`, runtime);
await walk(`${root}tests`, support);
const text = new Map<string, string>();
for (const f of [...runtime, ...support]) text.set(f, await Deno.readTextFile(f));

/**
 * Strip comments before counting references.
 *
 * A module that documents its own public surface in a header comment (the house style)
 * mentions every export by name, so a naive `count(name) > 1` self-reference check marks
 * the whole file live and the audit reports zero — silently, for every well-documented
 * module. Prose is not a caller: count only real code.
 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const code = new Map<string, string>();
for (const [f, s] of text) code.set(f, stripComments(s));

const exportRe = /^export\s+(?:async\s+)?(function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;
const count = (src: string, name: string) => (src.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
const out = { dead: [] as string[], testOnly: [] as string[], constants: [] as string[] };
for (const f of runtime.filter((g) => !g.includes("/tools/"))) {
  const src = text.get(f)!;
  for (const m of src.matchAll(exportRe)) {
    const [, kind, name] = m;
    if (kind === "interface" || kind === "type") continue;
    const inOwn = count(code.get(f)!, name) > 1;
    const inOther = runtime.some((g) => g !== f && count(code.get(g)!, name) > 0);
    if (inOwn || inOther) continue;
    const rel = `${f.replace(root, "")}: ${name}`;
    if (kind !== "function" && kind !== "class") { out.constants.push(rel); continue; }
    (support.some((g) => count(code.get(g)!, name) > 0) ? out.testOnly : out.dead).push(rel);
  }
}
console.log(`DEAD functions — no runtime reference and no test (${out.dead.length}):`);
for (const x of out.dead) console.log("  " + x);
console.log(`TEST-ONLY functions — no runtime reference, exercised only by tests/tools (${out.testOnly.length}):`);
for (const x of out.testOnly) console.log("  " + x);
console.log(`constants with no runtime reference (${out.constants.length}):`);
for (const x of out.constants) console.log("  " + x);
Deno.exitCode = out.dead.length + out.testOnly.length > 0 ? 1 : 0;
