// R's independent review of M: decals of generated + explicit marks on real bodies pack cleanly, centres on skin.
import { buildPreviewRig } from "../../../src/graphics/PreviewScene.ts";
import { packDecals, DECAL_MAX } from "../../../src/graphics/shaders/MaterialChannels.ts";
import { defaultMarks, resolveMarks, marksToDecals } from "../../../src/graphics/paint/marks/MarkLibrary.ts";
import { regionFrames } from "../../../src/graphics/paint/marks/Placement.ts";
import { generateBody } from "../../../src/graphics/body/BodyMesh.ts";
let total = 0, dropped = 0, nonfinite = 0, far = 0, maxDist = 0, overBudget = 0, n = 0;
for (const race of ["human", "elf", "dwarf", "ork"]) for (const sex of ["male", "female"]) {
  const body = generateBody({ race, subrace: null, className: "Warrior", height: 1.75, weight: 75, seed: 77, sex } as any);
  const mesh = body.mesh, P = mesh.positions;
  const frames = regionFrames(mesh, { face: body.plan.face as any, race });
  for (let seed = 1; seed <= 40; seed++) {
    const set = defaultMarks({ race, subrace: null, className: "Barbarian", birthsign: null, ageYears: 40, seed, heightM: 1.75 } as any);
    const res = resolveMarks(set, { race, subrace: null, frames });
    const out = marksToDecals(res, { mesh, skinSrgb: [0.6, 0.45, 0.4], skinRoughness: 0.5 });
    const pk = packDecals(out.decals);
    n++; total += pk.count; dropped += pk.dropped.length; if (out.decals.length > DECAL_MAX) overBudget++;
    if (!pk.data.every(Number.isFinite)) nonfinite++;
    for (const d of out.decals) {
      let best = Infinity;
      for (let i = 0; i < P.length; i += 3) best = Math.min(best, Math.hypot(P[i] - d.center[0], P[i + 1] - d.center[1], P[i + 2] - d.center[2]));
      maxDist = Math.max(maxDist, best); if (best > 0.03) far++;
    }
  }
}
console.log(JSON.stringify({ characters: n, decals: total, packDropped: dropped, overBudgetLists: overBudget, nonfinite, centresFartherThan30mmFromAVertex: far, maxNearestVertexMm: +(maxDist * 1000).toFixed(1) }));
