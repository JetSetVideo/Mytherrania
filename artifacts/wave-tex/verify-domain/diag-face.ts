// QD: are M's face-feature zones (fixed mm offsets from the face frame) on the REAL eyes and mouth of each body?
// Measures the plan's FaceAnchors (eye centres, mouth) in the measured face frame (regionFrames(mesh)) vs FACE_ORIFICES_MM.
import { generateBody } from "../../../src/graphics/body/BodyMesh.ts";
import * as P from "../../../src/graphics/paint/marks/Placement.ts";
import * as lib from "../../../src/graphics/paint/marks/MarkLibrary.ts";
import { FACE_ORIFICES_MM } from "../../../src/graphics/paint/marks/Scar.ts";
const rows: any[] = [];
const subjects: [string, string | null, string, number, number][] = [["human", null, "male", 1.8, 80], ["human", null, "female", 1.68, 62], ["elf", null, "female", 1.75, 58], ["dwarf", null, "male", 1.35, 85], ["ork", null, "female", 1.9, 100], ["ork", null, "male", 2.0, 120]];
const MARKED_FACE = [{ name: "C incision", anchor: [0.15, -0.05] }, { name: "C dotwork", anchor: [-0.1, -0.1] }];
for (const [race, subrace, sex, height, weight] of subjects) {
  const body: any = generateBody({ race, subrace, className: "Warrior", height, weight, seed: 7, sex } as any);
  const mesh = body.mesh, plan = body.plan;
  const face = plan.face ?? plan.faceAnchors;
  const fr = P.regionFrames(mesh);
  const f = P.frameOf(fr, "face", 0)!;
  const k = fr.heightM / 1.8;
  const mm = (p: number[]) => { const q = P.pointToFrameMm(f, p as any); return [Math.round(q.x), Math.round(q.y)]; };
  const real: Record<string, number[]> = face ? { eyeL: mm(face.eye[0]), eyeR: mm(face.eye[1]), mouth: mm(face.mouth) } : {};
  const zones = P.faceFeatureZones(fr.heightM);
  const assumed = Object.fromEntries(FACE_ORIFICES_MM.map((o) => [o.name, [Math.round(o.x * k), Math.round(o.y * k)]]));
  const err = Object.fromEntries(Object.entries(real).map(([n, p]) => { const a = assumed[n]; return [n, a ? Math.round(Math.hypot(p[0] - a[0], p[1] - a[1])) : null]; }));
  // where C's face marks land relative to the REAL features (mm from the nearest real feature centre)
  const land = MARKED_FACE.map((m) => { const [x, y] = P.uvToMm(f, m.anchor[0], m.anchor[1]); let best = 1e9, nm = ""; for (const [n, p] of Object.entries(real)) { const d = Math.hypot(x - p[0], y - p[1]); if (d < best) { best = d; nm = n; } } return `${m.name} at (${Math.round(x)},${Math.round(y)}) mm: ${Math.round(best)} mm from real ${nm}`; });
  // generated face marks over 500 seeds: how many sit inside a zone centred on the REAL features (same radii)
  let gen = 0, hit = 0;
  for (let s = 0; s < 500; s++) {
    const set = lib.defaultMarks({ race, subrace, className: "Barbarian", birthsign: "storm", ageYears: null, seed: s * 7919 + 1, heightM: height });
    const res = lib.resolveMarks(set, { race, subrace, frames: fr });
    for (const m of res.marks) if (m.region === "face") {
      gen++;
      const fp = P.footprintPoints(P.footprintOf(m as any, f), 9);
      const zr = zones.map((z: any) => ({ ...z, x: (real as any)[z.name]?.[0] ?? z.x, y: (real as any)[z.name]?.[1] ?? z.y }));
      if (fp.some(([x, y]) => zr.some((z: any) => ((x - z.x) / z.rx) ** 2 + ((y - z.y) / z.ry) ** 2 <= 1))) hit++;
    }
  }
  rows.push({ subject: `${race}-${sex}`, frameR_mm: Math.round(f.radiusM * 1000), frameHL_mm: Math.round(f.halfLengthM * 1000), real, assumed, offByMm: err, land, generatedFaceMarks: gen, onRealFeature: hit });
}
console.log(JSON.stringify(rows, null, 1));
await Deno.writeTextFile(new URL("./diag-face.json", import.meta.url), JSON.stringify(rows, null, 1));
