// QC (wave TEX): hashes every legacy paint output on 8 bodies (4 races x 2 sexes) + the full recipe matrix.
// Run with cwd = a repo root (base snapshot or the working tree): prints JSON {key: fnv1a hex}.
// Only legacy (base-commit) APIs are called, so the same script runs on 19f5c8c and on the wave tree.
const root = Deno.args[0] ?? Deno.cwd();
const imp = (p: string) => import(`file://${root}/${p}`);
const { generateBody } = await imp("src/graphics/body/BodyMesh.ts");
const { specFromAppearance, paintSkin } = await imp("src/graphics/body/SkinnedHumanoid.ts");
const { paintVertices } = await imp("src/graphics/paint/Layers.ts");
const { stackFor } = await imp("src/graphics/paint/Recipes.ts");
const { paintStage } = await imp("src/graphics/paint/PaintStage.ts");
const { RACES } = await imp("src/game/Races.ts");
const { BIRTHSIGNS } = await imp("src/game/Birthsight.ts");
const { CLASSES } = await imp("src/game/Stats.ts");
const { mannequinMesh } = await imp("src/graphics/paint/Mannequin.ts");

function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
const fh = (a: Float32Array) => fnv(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const sh = (s: string) => fnv(new TextEncoder().encode(s));
const out: Record<string, string> = {};
const races = ["human", "elf", "dwarf", "ork"];
const t0 = performance.now();
for (const race of races) {
  for (const sex of ["male", "female"]) {
    const a = { body: "#4f6f8a", accent: "#dfaa55", height: race === "dwarf" ? 1.35 : 1.75, weight: 75, hair: "#3a2a1e", eyes: "#dfaa55", race, subrace: null, sex };
    const spec = specFromAppearance(a, "Warrior", "serpent", 4242);
    const body = generateBody(spec);
    const cell = body.plan.cell;
    const st = stackFor({ race: spec.race, subrace: spec.subrace, className: spec.className, birthsign: spec.birthsign ?? null,
      hair: a.hair, accent: a.accent, garment: a.body, height: spec.height, vertexSpacing: cell, seed: spec.seed });
    const k = `${race}-${sex}`;
    out[`${k}.mesh`] = fh(body.mesh.positions);
    out[`${k}.stack`] = sh(JSON.stringify(st));
    out[`${k}.paintVertices`] = fh(paintVertices(body.mesh, st));
    out[`${k}.paintVertices.srgb`] = fh(paintVertices(body.mesh, st, { space: "srgb" }));
    out[`${k}.paintSkin`] = fh(paintSkin(body.mesh, spec, a, cell));
    out[`${k}.paintStage`] = fh(paintStage(body.mesh, spec, cell, {}, { metrics: false }).paint);
  }
}
// full recipe matrix on the mannequin
const mesh = mannequinMesh(1.8, 24);
let n = 0; const stacks: string[] = []; const paints: string[] = [];
for (const race of RACES) for (const subrace of [null, ...race.subspecies.map((s: { id: string }) => s.id)]) for (const birthsign of [...BIRTHSIGNS.map((b: { id: string }) => b.id), null]) {
  const st = stackFor({ race: race.id, subrace, birthsign, className: CLASSES[n % CLASSES.length], accent: "#9b72cf", seed: 9000 + n });
  stacks.push(JSON.stringify(st)); paints.push(fh(paintVertices(mesh, st))); n++;
}
out["matrix.count"] = String(n);
out["matrix.stacks"] = sh(stacks.join("\n"));
out["matrix.paints"] = sh(paints.join(","));
out["ms"] = (performance.now() - t0).toFixed(0);
console.log(JSON.stringify(out));
