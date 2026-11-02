// Wave X lane B: measure the rendered skin with and without the physique sculpt (pure, no browser).
//   deno run -A tools/measure-wave-x-body.ts [out.json]
// Every number in docs/wave-x/BODY.md's body tables comes from this script's JSON.
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { meshPlan, skinField } from "../src/graphics/body/BodyMesh.ts";
import { meshStats } from "../src/graphics/body/MeshStats.ts";
import { measurePhysique, shoulderProfile } from "../src/graphics/body/Physique.ts";
import type { DetailedAnatomy } from "../src/graphics/body/Anatomy.ts";
import type { BodySpec } from "../src/graphics/body/contracts.ts";

export const WAVE_X_SPECS: Record<string, BodySpec> = {
  human: { race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 72, seed: 7 },
  elf: { race: "elf", subrace: "wood", className: "Warrior", height: 1.77, weight: 60, seed: 7 },
  dwarf: { race: "dwarf", subrace: "mountain", className: "Warrior", height: 1.39, weight: 70, seed: 7 },
  ork: { race: "ork", subrace: "ironhide", className: "Warrior", height: 1.95, weight: 120, seed: 7 },
};

const mm = (m: number) => Math.round(m * 10000) / 10;
/** The deltoid/clavicle profile of a plan's rendered skin field (left side). */
export function profileOf(plan: DetailedAnatomy) {
  const f = skinField(plan), s = { d: 0, region: 0, bone: 0 };
  return shoulderProfile((x, y, z) => f.sample(x, y, z, s).d, plan.proportions);
}
export function measureAll(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const [name, base] of Object.entries(WAVE_X_SPECS)) {
    for (const sex of ["male", "female"] as const) {
      const spec = { ...base, sex };
      const before = anatomyFor(spec, { physique: false }), after = anatomyFor(spec);
      const mb = meshPlan(before).mesh, ma = meshPlan(after).mesh;
      const fat = anatomyFor(spec, { physique: { belly: 1 } });
      const mf = meshPlan(fat).mesh;
      const noBulge = sex === "male" ? measurePhysique(meshPlan(anatomyFor(spec, { physique: { bulge: false } })).mesh, after.proportions) : null;
      const b = measurePhysique(mb, before.proportions), a = measurePhysique(ma, after.proportions), f = measurePhysique(mf, fat.proportions);
      const sa = meshStats(ma), sf = meshStats(mf);
      const pb = profileOf(before), pa = profileOf(after);
      rows.push({
        race: name, sex, cellMm: mm(after.cell), headMm: mm(after.proportions.head),
        waistBeforeMm: mm(b.waistCircumference), waistAfterMm: mm(a.waistCircumference), waistChangePct: Math.round((a.waistCircumference / b.waistCircumference - 1) * 1000) / 10,
        shoulderBeforeMm: mm(b.shoulderWidth), shoulderAfterMm: mm(a.shoulderWidth),
        shoulderToWaistBefore: Math.round((b.shoulderWidth / b.waistCircumference) * 1000) / 1000, shoulderToWaistAfter: Math.round((a.shoulderWidth / a.waistCircumference) * 1000) / 1000,
        deltoidApexOverClavicleBeforeMm: mm(pb.apexY - pb.clavicleY), deltoidApexOverClavicleAfterMm: mm(pa.apexY - pa.clavicleY),
        valleyDepthBeforeMm: mm(pb.valleyDepth), valleyDepthAfterMm: mm(pa.valleyDepth),
        meshApexOverClavicleAfterMm: mm(a.deltoidApexY - a.clavicleY),
        profileAfter: { clavicle: [mm(pa.clavicleX), mm(pa.clavicleY)], valley: [mm(pa.valleyX), mm(pa.valleyY)], apex: [mm(pa.apexX), mm(pa.apexY)] },
        lineaDepthBeforeMm: mm(b.lineaDepth), lineaDepthAfterMm: mm(a.lineaDepth),
        crotchVsBellyBeforeMm: mm(b.crotchVsBelly), crotchVsBellyAfterMm: mm(a.crotchVsBelly),
        crotchVsThighBeforeMm: mm(b.crotchVsThigh), crotchVsThighAfterMm: mm(a.crotchVsThigh),
        bulgeAddedMm: noBulge ? mm(a.crotchZ - noBulge.crotchZ) : null,
        bellyFrontBeforeMm: mm(b.bellyZ), bellyFrontAfterMm: mm(a.bellyZ), bellyFrontFatMm: mm(f.bellyZ),
        belly: after.physique?.belly ?? 0,
        componentsAfter: sa.components, boundaryAfter: sa.boundaryEdges, trianglesAfter: sa.triangles,
        componentsFat: sf.components, boundaryFat: sf.boundaryEdges,
      });
    }
  }
  return rows;
}

if (import.meta.main) {
  const rows = measureAll();
  for (const r of rows) console.log(JSON.stringify(r));
  const out = Deno.args[0];
  if (out) await Deno.writeTextFile(out, JSON.stringify(rows, null, 2));
}
