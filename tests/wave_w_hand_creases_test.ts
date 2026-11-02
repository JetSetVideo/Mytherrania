// Wave W lane H — the elbow crease no longer collapses toward the bone when the arm bends (half-angle
// helper bones + a smooth three-bone band, render-only), and the rest pose is unchanged.
// @deno-types="@types/three"
import * as THREE from "three";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import { hingeAngle } from "../src/graphics/body/JointHelpers.ts";
import { jointReport, plainWeights, posedSkin } from "../tools/probe-creases.ts";
import type { BodySpec } from "../src/graphics/body/contracts.ts";
import type { Appearance } from "../src/game/Characters.ts";

function assert(ok: unknown, msg = "assertion failed"): asserts ok { if (!ok) throw new Error(msg); }

const SPECS: BodySpec[] = [
  { race: "human", subrace: null, className: "Warrior", height: 1.76, weight: 76, seed: 7, sex: "male" },
  { race: "elf", subrace: null, className: "Warrior", height: 1.75, weight: 56, seed: 7, sex: "female" },
  { race: "dwarf", subrace: null, className: "Warrior", height: 1.38, weight: 78, seed: 7, sex: "male" },
  { race: "ork", subrace: null, className: "Warrior", height: 1.98, weight: 118, seed: 7, sex: "male" },
  { race: "ork", subrace: null, className: "Warrior", height: 1.88, weight: 96, seed: 42, sex: "female" },
];
const look = (s: BodySpec): Appearance => ({ body: "#c98a63", accent: "#dfaa55", height: s.height, weight: s.weight, hair: "#172128", eyes: "#2f6fb5", race: s.race, subrace: s.subrace } as Appearance);

Deno.test("creases: the guard's bent elbow keeps its inner flesh off the bone (helper bones), the rest pose is unchanged", () => {
  const rows: string[] = [];
  for (const spec of SPECS) {
    const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), look(spec), "fire", spec, { paint: false });
    assert(rig.jointHelpers && rig.jointHelpers.length === 4, "four crease helpers (elbows, knees)");
    // Rest: the helpers sit exactly on their joints (zero hinge → the band does not move).
    const rest = posedSkin(rig, {});
    for (const h of rig.jointHelpers) assert(Math.abs(hingeAngle(h)) < 1e-9 && h.helper.quaternion.angleTo(h.joint.quaternion) < 1e-9, "helper off its joint at rest");
    void rest;
    for (const angle of [-1.45, -1.7]) {
      for (const side of [0, 1] as const) {
        const r = jointReport(rig, "elbow", side, angle);
        // Linear blending alone (wave V): 0.33–0.38 of the joint radius at 1.45 rad (tools/probe-creases.ts).
        const floor = angle === -1.45 ? 0.45 : 0.42;
        assert(r.inner >= floor, `${spec.race}/${spec.sex}/${spec.seed} elbow ${side} at ${angle}: inner flesh ${r.inner} of the radius from the bone`);
        // At the guard's bend nothing folds or passes through itself (plain weights: up to 30 folds on the ork).
        if (angle === -1.45) assert(r.folds === 0 && r.selfX === 0, `${spec.race} elbow ${side} at the guard: ${r.folds} folds, ${r.selfX} self-intersections`);
        else assert(r.folds <= 2, `${spec.race} elbow ${side} at ${angle}: ${r.folds} folds`);
        if (side === 1) rows.push(`${spec.race}/${spec.sex}/${spec.seed} elbow ${angle}: inner ${r.inner}, folds ${r.folds}, selfX ${r.selfX}`);
      }
      // The helper follows the hinge (half of it), whatever twist rides on the forearm.
      const h = rig.jointHelpers.find((x) => x.joint.name === "elbowR")!;
      const a = hingeAngle(h), half = 2 * Math.atan2(new THREE.Quaternion().copy(h.rest).invert().multiply(h.helper.quaternion).x, new THREE.Quaternion().copy(h.rest).invert().multiply(h.helper.quaternion).w);
      assert(Math.abs(half - a / 2) < 1e-6, `helper ${half} vs half hinge ${a / 2}`);
    }
    const knee = jointReport(rig, "knee", 1, -1.2);
    assert(knee.inner >= 0.45, `${spec.race} knee at 1.2 rad: inner ${knee.inner}`);
    // Control (the check can fail): the plain two-bone weights collapse the same elbow under the floor.
    if (spec.race === "ork" && spec.seed === 7) {
      const geo = rig.skin.geometry, si = geo.getAttribute("skinIndex"), sw = geo.getAttribute("skinWeight");
      const plain = plainWeights(rig);
      geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(plain.skinIndex, 4));
      geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(plain.skinWeight, 4));
      const lbs = jointReport(rig, "elbow", 1, -1.45);
      assert(lbs.inner < 0.4 && lbs.folds > 10, `control: plain weights should collapse the ork elbow (inner ${lbs.inner}, folds ${lbs.folds})`);
      rows.push(`control ork plain weights elbow -1.45: inner ${lbs.inner}, folds ${lbs.folds}`);
      geo.setAttribute("skinIndex", si); geo.setAttribute("skinWeight", sw);
    }
  }
  console.log(rows.join("\n"));
});
