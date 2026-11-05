// QD: ork-female generated face marks that touch QD's anatomical eye/mouth zones although M's zones are passed.
import { generateBody } from "../../../src/graphics/body/BodyMesh.ts";
import * as P from "../../../src/graphics/paint/marks/Placement.ts";
import * as lib from "../../../src/graphics/paint/marks/MarkLibrary.ts";
const body: any = generateBody({ race: "ork", subrace: null, className: "Warrior", height: 1.9, weight: 100, seed: 7, sex: "female" } as any);
const face = body.plan.face, fr = P.regionFrames(body.mesh, { face, race: "ork" }), f = P.frameOf(fr, "face", 0)!;
const mm = (p: any) => { const q = P.pointToFrameMm(f, p); return [q.x, q.y]; };
const er = face.eyeRadius * 1000;
const zr = [{ n: "eyeL", c: mm(face.eye[0]), rx: 1.4 * er, ry: 1.4 * er }, { n: "eyeR", c: mm(face.eye[1]), rx: 1.4 * er, ry: 1.4 * er }, { n: "mouth", c: mm(face.mouth), rx: 2.2 * er, ry: er }];
console.log("M zones", JSON.stringify(P.faceZones(fr).map((z: any) => ({ ...z, x: Math.round(z.x), y: Math.round(z.y), rx: Math.round(z.rx), ry: Math.round(z.ry) }))));
console.log("QD zones", JSON.stringify(zr.map((z) => ({ n: z.n, x: Math.round(z.c[0]), y: Math.round(z.c[1]), rx: Math.round(z.rx), ry: Math.round(z.ry) }))));
for (let s = 0; s < 150; s++) {
  const set = lib.defaultMarks({ race: "ork", subrace: null, className: "Barbarian", birthsign: "storm", ageYears: null, seed: s * 7919 + 1, heightM: 1.9 });
  const res = lib.resolveMarks(set, { race: "ork", frames: fr });
  for (const m of res.marks) if (m.region === "face") {
    const fp = P.footprintPoints(P.footprintOf(m as any, f), 9);
    const hits = zr.filter((z) => fp.some(([x, y]) => ((x - z.c[0]) / z.rx) ** 2 + ((y - z.c[1]) / z.ry) ** 2 <= 1)).map((z) => z.n);
    if (hits.length) console.log(s, m.id, m.type, m.scar?.kind ?? m.tattoo?.style, "anchor", m.anchor, "ext", m.extentMm.map(Math.round), "angle", +m.angle.toFixed(2), "hits", hits, "report", JSON.stringify(res.placement.report.find((r: any) => r.id === m.id)));
  }
}
