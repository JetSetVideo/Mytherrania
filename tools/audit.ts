// Conservative static reachability audit. This is not a proof of dynamic path coverage.
const root = Deno.cwd();
const sources: string[] = [];
async function collect(dir: string) {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) await collect(path);
    else if (entry.name.endsWith(".ts")) sources.push(path);
  }
}
await collect("src");
const texts = new Map<string, string>();
for (const file of [...sources, "main.ts", "tools/arena.ts"]) {
  texts.set(new URL(file, `file://${root}/`).pathname, await Deno.readTextFile(file));
}
const edges: Record<string, string[]> = {};
const visited = new Set<string>();
function visit(file: string) {
  if (visited.has(file)) return;
  visited.add(file);
  const text = texts.get(file);
  if (text === undefined) return;
  const dependencies = [
    ...text.matchAll(/(?:from\s*|import\s*\(|new URL\s*\()\s*["'](\.[^"']+\.ts)["']/g),
  ]
    .map((match) => new URL(match[1], `file://${file}`).pathname);
  edges[file.replace(`${root}/`, "")] = dependencies.map((p) => p.replace(`${root}/`, ""));
  for (const dependency of dependencies) visit(dependency);
}
for (const entry of ["main.ts", "tools/arena.ts"]) visit(`${root}/${entry}`);
const unreachable = sources.filter((file) => !visited.has(`${root}/${file}`));
const suspiciousExports: { file: string; name: string }[] = [];
const markers: { file: string; marker: string }[] = [];
for (const file of sources) {
  const text = texts.get(`${root}/${file}`)!;
  for (
    const match of text.matchAll(
      /export\s+(?:async\s+)?(?:class|function|const|interface|type|enum)\s+(\w+)/g,
    )
  ) {
    const name = match[1];
    const regex = new RegExp(`\\b${name}\\b`);
    const external = [...texts].some(([path, body]) =>
      path !== `${root}/${file}` && regex.test(body)
    );
    if (!external) suspiciousExports.push({ file, name });
  }
  for (const match of text.matchAll(/\b(?:TODO|FIXME|STUB|NOT_IMPLEMENTED)\b/g)) {
    markers.push({ file, marker: match[0] });
  }
}
const hashes: Record<string, string> = {};
for (
  const file of [
    ...sources,
    "main.ts",
    "index.html",
    "styles.css",
    "deno.json",
    "tools/build.ts",
    "tools/serve.ts",
    "tools/arena.ts",
  ].sort()
) {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(file));
  hashes[file] = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
const report = {
  timestamp: new Date().toISOString(),
  sourceModules: sources.length,
  reachableModules: sources.length - unreachable.length,
  entrypoints: ["main.ts", "tools/arena.ts"],
  edges,
  unreachable,
  suspiciousExports,
  markers,
  hashes,
  method:
    "Local static import/worker URL graph and conservative cross-module exported identifier references; strict TypeScript noUnusedLocals/noUnusedParameters complement this.",
  limits:
    "Identifier presence does not prove use; dynamic imports not matching literal pattern require review. This does not prove zero unreachable branches, 100% path coverage, or zero allocations. Browser and unit coverage reported separately.",
};
await Deno.mkdir("artifacts", { recursive: true });
await Deno.writeTextFile("artifacts/reachability.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (unreachable.length || suspiciousExports.length || markers.length) Deno.exit(1);
