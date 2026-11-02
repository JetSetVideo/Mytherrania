// Wave FALL lane A (C-ANIM): shove / stagger / stumble / fall / lying / get-up on lane A's REAL
// skinned rigs, every race and both sexes, driven like the engine (tests/wave_fall_anim_fixture.ts).
// SPEC FALL-F30..F41 pin the contract (docs/wave-fall/ANIMATION.md). Every bound below was MEASURED
// first (artifacts/wave-fall/anim-measure.json, written by this test) and the band sits outside the
// measured worst with the margin stated next to it.
// @deno-types="@types/three"
import * as THREE from "three";
import { Animator, type AnimatorInput, type AnimFallInput, type AnimShoveInput, FALL_ROOT_SPEED } from "../src/game/anim/Animator.ts";
import { WIDE_JOINT_LIMITS } from "../src/game/anim/FallMotion.ts";
import { JOINT_ORDER, legacyLegGeometry, limitTableFrom } from "../src/game/anim/Rig.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { applyRootTilt } from "../src/graphics/body/SkinnedHumanoid.ts";
import { BODIES, measure, type Summary } from "./wave_fall_anim_fixture.ts";
import { RISE_PHASE_MIN } from "../src/game/Fall.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const mm = (v: number) => `${(v * 1000).toFixed(1)} mm`;

const POSES = ["back", "front", "side"] as const;
const REACTS = ["shove", "stagger", "stumble"] as const;
let CACHE: Summary[] | null = null;
/** Every body x every fall pose (rise 1.3 s, M's probe value) + the reactions on the male bodies + rise-time extremes. */
function all(): Summary[] {
  if (CACHE) return CACHE;
  const out: Summary[] = [];
  for (const b of Object.keys(BODIES)) for (const p of POSES) out.push(measure(b, p, 1.3));
  for (const b of ["human", "elf", "dwarf", "ork"]) for (const r of REACTS) out.push(measure(b, r));
  // M's law (Fall.ts r3): rising = clamp(0.55·riseSeconds, RISE_PHASE_MIN = 1.0, T - DOWN_MIN), T in
  // [1.2, 3.5] s, so the rising clip runs 1.0..1.93 s: both ends on the human.
  for (const p of POSES) { out.push(measure("human", p, RISE_PHASE_MIN)); out.push(measure("human", p, 1.93)); }
  CACHE = out;
  try {
    Deno.mkdirSync("artifacts/wave-fall", { recursive: true });
    Deno.writeTextFileSync("artifacts/wave-fall/anim-measure.json", JSON.stringify(out, null, 1));
  } catch { /* read-only run: the assertions still hold */ }
  return out;
}
const falls = () => all().filter((s) => (POSES as readonly string[]).includes(s.script));
const nominal = () => falls().filter((s) => s.rise === 1.3);

// Engine-like idle drive for the byte-identity pin (no rig): legacy geometry, a short scripted walk.
function legacyRun(extra: (k: number) => Partial<AnimatorInput>): Float64Array[] {
  const sk = defaultHumanoid();
  const g = legacyLegGeometry({ heightScale: 1, spineY: 0.5, thigh: 0.45, shin: 0.45, footDrop: 0.08, hipX: 0.12 });
  const an = new Animator(g, limitTableFrom(sk.limits()));
  const frames: Float64Array[] = [];
  let x = 0;
  for (let k = 0; k < 150; k++) {
    const speed = k < 40 ? 0 : 2.2;
    x += speed / 60;
    const o = an.update(1 / 60, {
      x, z: 0, yaw: Math.PI / 2, speed, moveDirLocal: 0, turnRate: 0, grounded: true, hit: k > 100 && k < 110, attack: false,
      block: false, ko: false, engaged: true, skill: null, skillProgress: 0, groundHeight: () => 0, honoursYawOffset: true, ...extra(k),
    });
    frames.push(Float64Array.of(...o.angles, o.rootOffsetY, o.rootRoll, o.rootOffsetLateral, o.yawOffset, ...o.hipRoll, ...o.ankleRoll,
      o.feet[0].x, o.feet[0].z, o.feet[1].x, o.feet[1].z, o.breath, o.idleSway));
  }
  return frames;
}

Deno.test("SPEC FALL-F30: fall/shove absent, null or phase 'stand' = today's motion, byte-identical (and no fall outputs)", () => {
  const base = legacyRun(() => ({}));
  const nul = legacyRun(() => ({ fall: null, shove: null }));
  const stand = legacyRun(() => ({ fall: { phase: "stand", t01: 0, dir: [1, 0], pose: "back" } }));
  for (const [name, run] of [["null", nul], ["stand", stand]] as const) {
    for (let k = 0; k < base.length; k++) {
      for (let j = 0; j < base[k].length; j++) {
        assert(Object.is(base[k][j], run[k][j]), `${name}: frame ${k} value ${j}: ${base[k][j]} vs ${run[k][j]}`);
      }
    }
  }
  // A shove that has fully released returns to the exact same numbers as a never-shoved fighter.
  const shoved = legacyRun((k) => k > 20 && k < 40 ? { shove: { phase: "impact", t01: 0.5, dir: [0, -1], magnitude01: 1 } } : {});
  const later = shoved.slice(120), ref = base.slice(120);
  let worst = 0;
  for (let k = 0; k < later.length; k++) for (let j = 0; j < 16; j++) worst = Math.max(worst, Math.abs(later[k][j] - ref[k][j]));
  assert(worst < 1e-3, `a released shove leaves the pose ${worst.toFixed(5)} rad off`);
});

Deno.test("SPEC FALL-F31: AnimatorInput.fall / .shove shapes match C-ANIM (M fills them from Fall.ts / the shove timeline)", () => {
  const f: AnimFallInput = { phase: "rising", t01: 0.5, dir: [1, 0], pose: "side" };
  const s: AnimShoveInput = { phase: "recoil", t01: 0.25, dir: [0, -1], magnitude01: 0.7 };
  const inp: Partial<AnimatorInput> = { fall: f, shove: s };
  assert(inp.fall?.pose === "side" && inp.shove?.magnitude01 === 0.7);
  for (const p of ["stand", "stagger", "stumble", "falling", "down", "rising"] as AnimFallInput["phase"][]) assert(typeof p === "string");
});

Deno.test("SPEC FALL-F32: down — the lowest skin point is on the floor (|gap| <= 2 cm), every race, sex and pose; nothing below by a cell", () => {
  for (const s of nominal()) {
    assert(s.downExact[0] >= -0.02 && s.downExact[1] <= 0.02, `${s.body}/${s.script}: lowest skin while down [${mm(s.downExact[0])}, ${mm(s.downExact[1])}] (band ±20 mm)`);
  }
  for (const s of all()) assert(s.worstSkin >= -0.025, `${s.body}/${s.script}/${s.rise}: a body part ${mm(-s.worstSkin)} below the floor (one cell 25-35 mm)`);
});

Deno.test("SPEC FALL-F33: down — the animator's OWN grounding (sphere model, before the skin settle) is within 6 cm of the skin", () => {
  // Measured worst ~4 cm (back fall: the heel / arm under the model's radius); the exact skin
  // contact is SkinnedHumanoid.settleOnFloor (the engine calls it with AnimatorOutput.groundBody).
  for (const s of nominal()) {
    assert(Math.abs(s.downModel[0]) <= 0.06 && Math.abs(s.downModel[1]) <= 0.06, `${s.body}/${s.script}: model grounding [${mm(s.downModel[0])}, ${mm(s.downModel[1])}]`);
  }
});

Deno.test("SPEC FALL-F34: down — the torso lies on the floor (back/front <= 5 cm; side <= 0.5 w: it lies on its shoulder)", () => {
  // Measured: back/front <= 3 cm; side 0.40-0.47 w (w = shoulder half-span: 7 cm human, 16 cm ork).
  for (const s of nominal()) {
    const band = s.script === "side" ? 0.5 * s.w : 0.05;
    assert(s.downTorso <= band, `${s.body}/${s.script}: torso ${mm(s.downTorso)} above the floor (band ${mm(band)})`);
  }
});

Deno.test("SPEC FALL-F35: rising — a loaded foot stays planted (slide <= 25 mm over M's whole rising range 1.0..1.93 s)", () => {
  // Measured: 4-18 mm (ork back at 1.0 s the worst). Pinned with RISE_PHASE_MIN: a 0.44 s clip (the
  // pre-r3 law) slid 46-83 mm because the joint speed limit makes the pose lag.
  for (const s of falls()) {
    const band = 0.025;
    assert(s.riseSlide <= band, `${s.body}/${s.script}/rise ${s.rise}: planted foot slid ${mm(s.riseSlide)} (band ${mm(band)})`);
  }
});

Deno.test("SPEC FALL-F36: continuity — joint step <= the blender's maxJointSpeed·dt, root turn <= FALL_ROOT_SPEED·dt (60 Hz, any rise time)", () => {
  const sk = defaultHumanoid();
  const an = new Animator(legacyLegGeometry({ heightScale: 1, spineY: 0.5, thigh: 0.45, shin: 0.45, footDrop: 0.08, hipX: 0.12 }), limitTableFrom(sk.limits()));
  const jMax = an.blender.maxJointSpeed / 60 + 1e-6, rMax = FALL_ROOT_SPEED / 60 + 0.01;
  for (const s of all()) {
    assert(s.dJoint <= jMax, `${s.body}/${s.script}/${s.rise}: a joint moved ${s.dJoint.toFixed(3)} rad in one frame (limit ${jMax.toFixed(3)})`);
    assert(s.dRoot <= rMax, `${s.body}/${s.script}/${s.rise}: the root turned ${s.dRoot.toFixed(3)} rad in one frame (limit ${rMax.toFixed(3)})`);
  }
});

Deno.test("SPEC FALL-F37: the get-up ends in guard and hands back — gait-planted feet, soles on the floor, fall weight 0", () => {
  for (const s of falls()) assert(s.standsAtEnd, `${s.body}/${s.script}/${s.rise}: not standing on both planted feet after the rise`);
});

Deno.test("SPEC FALL-F38: shove / stagger / stumble — real recovery steps (1..6 lift-offs), planted feet slide <= 10 mm", () => {
  for (const s of all().filter((x) => (REACTS as readonly string[]).includes(x.script))) {
    assert(s.steps >= 1 && s.steps <= 6, `${s.body}/${s.script}: ${s.steps} lift-offs`);
    assert(s.reactSlide <= 0.01, `${s.body}/${s.script}: planted foot slid ${mm(s.reactSlide)}`);
  }
});

Deno.test("SPEC FALL-F39: Skeleton.drive(..., wide) clamps to the widened fall windows; without it the base limits (unchanged)", () => {
  const sk = defaultHumanoid();
  const a = new Float64Array(JOINT_ORDER.length);
  a[JOINT_ORDER.indexOf("hipL")] = 1.8; a[JOINT_ORDER.indexOf("spine")] = -1.2;
  sk.drive(a, [0, 0], [0, 0], undefined, undefined, true); sk.update(0);
  assert(Math.abs(sk.joint("hipL").angle - 1.8) < 1e-9 && Math.abs(sk.joint("spine").angle + 1.2) < 1e-9, "wide drive keeps 1.8 / -1.2");
  assert(WIDE_JOINT_LIMITS.hipL.max === 1.9);
  sk.drive(a, [0, 0], [0, 0]); sk.update(0);
  assert(Math.abs(sk.joint("hipL").angle - 1.2) < 1e-9 && Math.abs(sk.joint("spine").angle + 0.6) < 1e-9, "base drive clamps to 1.2 / -0.6");
});

Deno.test("SPEC FALL-F40: applyRootTilt — identity tilt leaves the group untouched; a tilt goes between yaw and roll", () => {
  const g = new THREE.Group();
  g.rotation.set(0, 0.7, 0.1);
  const before = g.quaternion.clone();
  assert(!applyRootTilt(g, [0, 0, 0, 1]) && g.quaternion.equals(before), "identity tilt is a no-op");
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  applyRootTilt(g, [q.x, q.y, q.z, q.w]);
  const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7).multiply(q)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.1));
  assert(Math.abs(Math.abs(g.quaternion.dot(want)) - 1) < 1e-9, "Ry(yaw)·tilt·Rz(roll)");
});

Deno.test("SPEC FALL-F41: every body falls, lies and rises without leaving the floor's band while down (measured table)", () => {
  // The table V and M read: per body x pose the down band, torso height, rise slide and the steps.
  const rows = all();
  assert(rows.length === Object.keys(BODIES).length * 3 + 4 * 3 + 6, `rows ${rows.length}`);
  for (const s of nominal()) assert(s.downExact[1] - s.downExact[0] <= 0.03, `${s.body}/${s.script}: the lying body bobs ${mm(s.downExact[1] - s.downExact[0])}`);
});
