const root = Deno.args[0];
const { generateBody } = await import(`${root}/src/graphics/body/BodyMesh.ts`);
async function h(buf: ArrayBufferView | string): Promise<string> {
  const data = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const d = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(d)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const out: Record<string, unknown> = {};
for (const race of ["human", "elf", "dwarf", "ork"]) for (const sex of ["male", "female"]) {
  const spec = { race, subrace: null, className: "Warrior", height: 1.75, weight: 75, seed: 1234567, sex };
  const b = generateBody(spec);
  const m = b.mesh;
  out[`${race}/${sex}`] = {
    mesh: await h(m.positions) + ":" + await h(m.normals) + ":" + await h(m.indices) + ":" + await h(m.region) + ":" + await h(m.bone ?? new Uint8Array()),
    physics: await h(JSON.stringify({ root: b.plan.root, bones: b.plan.bones, bounds: b.plan.bounds, cell: b.plan.cell })),
    skin: await h(JSON.stringify({ skin: b.plan.skinRoot, strokes: b.plan.strokes, skinBounds: b.plan.skinBounds })),
  };
}
console.log(JSON.stringify(out, null, 1));
