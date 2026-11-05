// QC (wave TEX final): independent checks of F's MeshOcclusion — cost per build (cold/warm), determinism, range,
// cache key, hostile inputs. Run: deno run -A artifacts/wave-tex/verify-code/closing/qc-occlusion.ts [hostile]
import { generateBody } from "../../../../src/graphics/body/BodyMesh.ts";
import type { BodySpec, MeshData } from "../../../../src/graphics/body/contracts.ts";
import { meshOcclusion } from "../../../../src/graphics/paint/MeshOcclusion.ts";
import { vertexRings } from "../../../../src/graphics/paint/FormShade.ts";

const mode = Deno.args[0] ?? "main";
const clone = (m: MeshData): MeshData => ({ ...m, positions: m.positions.slice(), normals: m.normals.slice(), indices: m.indices.slice(), region: m.region.slice() } as MeshData);
const fnv = (a: Float32Array) => { let h = 0x811c9dc5; const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (const b of u) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };

if (mode === "main") {
  const rows: string[] = [];
  let bad = 0;
  for (const race of ["human", "elf", "dwarf", "ork"]) for (const sex of ["male", "female"]) {
    const spec = { race, subrace: null, className: "Warrior", height: 1.75, weight: 75, seed: 7, sex } as BodySpec;
    const body = generateBody(spec) as unknown as { mesh: MeshData };
    const mesh = body.mesh;
    const n = mesh.positions.length / 3;
    const adj = vertexRings(mesh as never) as Int32Array[];
    const t0 = performance.now(); const a = meshOcclusion(mesh, { adj }); const cold = performance.now() - t0;
    const t1 = performance.now(); const b = meshOcclusion(mesh, { adj }); const warm = performance.now() - t1;
    const c = meshOcclusion(clone(mesh), { adj }); // fresh object: recomputed
    const d = meshOcclusion(clone(mesh)); // own rings
    const e = meshOcclusion(mesh, { adj, rays: 8 }); // different key: recomputed, not the cached array
    const f = meshOcclusion(mesh, { adj }); // back to defaults: key changed -> recomputed (cache holds one entry)
    let lo = Infinity, hi = -Infinity, nonFinite = 0, open = 0;
    for (const v of a) { if (!Number.isFinite(v)) nonFinite++; lo = Math.min(lo, v); hi = Math.max(hi, v); if (v < 0.06) open++; }
    const det = fnv(a) === fnv(c);
    const ownRings = fnv(a) === fnv(d);
    const keyOk = e !== a && e.length === n && fnv(f) === fnv(a);
    const ok = b === a && det && nonFinite === 0 && lo >= 0 && hi <= 1 && keyOk;
    if (!ok) bad++;
    rows.push(`${race}-${sex}: n=${n} cold ${cold.toFixed(1)} ms warm ${warm.toFixed(3)} ms sameArray=${b === a} deterministic(fresh clone)=${det} ownRings==adj=${ownRings} keyOk=${keyOk} range [${lo.toFixed(3)}, ${hi.toFixed(3)}] nonFinite=${nonFinite} open(<0.06)=${(100 * open / n).toFixed(1)}% hash=${fnv(a)}`);
  }
  console.log(rows.join("\n"));
  console.log(`MESHOCC bodies 8, failures ${bad}`);
} else {
  // hostile: run each case in this process, one case per invocation (a hang is detected by the caller's deadline)
  const cube = (): MeshData => {
    const P = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((v) => v * 0.2));
    const I = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3]);
    const N = new Float32Array(24); for (let i = 0; i < 8; i++) { N[i * 3] = P[i * 3] - 0.1; N[i * 3 + 1] = P[i * 3 + 1] - 0.1; N[i * 3 + 2] = P[i * 3 + 2] - 0.1; }
    return { positions: P, normals: N, indices: I, region: new Uint8Array(8) } as unknown as MeshData;
  };
  const m = cube();
  const c = mode;
  if (c === "nanpos") m.positions[0] = NaN;
  if (c === "infpos") m.positions[0] = Infinity;
  if (c === "allnan") m.positions.fill(NaN);
  if (c === "nannormal") m.normals.fill(NaN);
  if (c === "zeronormal") m.normals.fill(0);
  if (c === "badindex") (m as unknown as { indices: Uint32Array }).indices = new Uint32Array([0, 1, 99]);
  if (c === "huge") { for (let i = 0; i < 3; i++) m.positions[i] = 1e6; }
  let r: Float32Array | string;
  try { const o = meshOcclusion(m, c === "badopts" ? { voxel: NaN, radius: -1, rays: 0, smooth: -3 } : {}); r = o; } catch (e) { r = `threw ${(e as Error).message.slice(0, 80)}`; }
  console.log(`${c}: ${typeof r === "string" ? r : `ok len ${r.length} finite ${r.every(Number.isFinite)} in[0,1] ${r.every((v) => v >= 0 && v <= 1)}`}`);
}
