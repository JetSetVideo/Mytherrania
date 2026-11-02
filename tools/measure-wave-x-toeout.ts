// Wave X (parent): the RENDERED foot turn-out — heel->toe direction of each skinned foot, rig space,
// before (skeleton toeOut forced to 0) and after (the skeleton's default turn-out).
import * as THREE from "three";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import { measuredToeOut } from "../src/game/anim/FootTurnout.ts";

const races = ["human", "elf", "dwarf", "ork"];
const out: Record<string, unknown> = {};
for (const race of races) {
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), { body: "#c08060", accent: "#888", height: 1.7, weight: 70, eyes: "#222", race }, "fire", undefined, { paint: false });
  rig.group.updateMatrixWorld(true);
  const P = rig.plan;
  const pts = P.legs.map((leg, i) => {
    const s = i === 0 ? "L" : "R";
    const heelBone = rig.bones.get(`ankle${s}` as never)!, toeBone = rig.bones.get(`toe${s}` as never)!;
    const heel = new THREE.Vector3(leg.ankle[0], 0, leg.heelBack[2]).applyMatrix4(heelBone.matrixWorld.clone().invert());
    const toe = new THREE.Vector3(leg.toeTip[0], 0, leg.toeTip[2]).applyMatrix4(toeBone.matrixWorld.clone().invert());
    return { heelBone, toeBone, heel, toe, lateral: leg.ankle[0] };
  });
  const measure = () => {
    rig.group.updateMatrixWorld(true);
    const inv = rig.group.matrixWorld.clone().invert();
    return pts.map((p) => {
      const h = p.heel.clone().applyMatrix4(p.heelBone.matrixWorld).applyMatrix4(inv);
      const t = p.toe.clone().applyMatrix4(p.toeBone.matrixWorld).applyMatrix4(inv);
      return +(measuredToeOut(p.lateral, [h.x, h.y, h.z], [t.x, t.y, t.z]) * 180 / Math.PI).toFixed(2);
    });
  };
  const sk = defaultHumanoid();
  const saved = Float64Array.from(sk.legRoll.toeOut);
  sk.legRoll.toeOut.fill(0);
  rig.update(sk, 0);
  const before = measure(), soleBefore = rig.soleOffset;
  sk.legRoll.toeOut.set(saved);
  rig.update(sk, 0);
  const after = measure(), soleAfter = rig.soleOffset;
  out[race] = { beforeDeg: before, afterDeg: after, soleOffsetMm: [+(soleBefore * 1000).toFixed(2), +(soleAfter * 1000).toFixed(2)] };
}
console.log(JSON.stringify(out, null, 1));
await Deno.writeTextFile("artifacts/qa-wave-x/toeout-render.json", JSON.stringify(out, null, 1));
