// Lane X2: the integrated swing on REAL skinned rigs, driven like Engine (SwingDriver -> Animator
// attack layer + yaw -> rig.update -> grip from the blade angle -> placement -> ArmGuard -> sweep ->
// contact rewind + freeze). Proves: the plain attack lands at its engage distance and misses out of
// reach, the blade stops AT the body on contact (vs. passing through without the freeze), and the
// holder's own weapon never sits inside its own body.
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { Animator } from "../src/game/anim/Animator.ts";
import { legGeometryFromBones, limitTableFrom } from "../src/game/anim/Rig.ts";
import { armGeometry } from "../src/game/anim/Swing.ts";
import { hitboxDistance, hitboxesFromPlan, updateHitboxes } from "../src/combat/Hitboxes.ts";
import { ArmGuard, boneWorldOf, weaponMatrix } from "../src/combat/RigAdapter.ts";
import { StrikeTracker } from "../src/combat/StrikeTracker.ts";
import { selfClearance } from "../src/combat/SelfGuard.ts";
import { SwingDriver, swingSetupFor } from "../src/combat/SwingDriver.ts";
import { measureAimLine } from "../src/combat/SwingRig.ts";
import type { ArchetypeId, Contact, HitboxSet, WeaponSpec } from "../src/combat/contracts.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { combatProfile } from "../src/game/weapons/Profile.ts";
import { toGeneratedWeapon } from "../src/game/weapons/Adapter.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const DT = 1 / 60, BODY_RADIUS = 0.5;
interface Look { body: string; accent: string; height: number; weight: number; hair: string; eyes: string; race: string; subrace: string | null }
const HUMAN: Look = { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#3a2a1a", eyes: "#2f6fb5", race: "human", subrace: null };
const ORK: Look = { body: "#4f8490", accent: "#172128", height: 1.95, weight: 120, hair: "#172128", eyes: "#172128", race: "ork", subrace: "ironhide" };
type Rig = ReturnType<typeof buildSkinnedHumanoid>;
const rigs = new Map<string, { rig: Rig; boxes: HitboxSet }>();
function rigOf(app: Look, spec: WeaponSpec, tag: string) {
  const key = `${tag}|${app.race}|${spec.id}`;
  let r = rigs.get(key);
  if (!r) {
    const rig = buildSkinnedHumanoid(toGeneratedWeapon(spec), app, "fire", undefined, { paint: false, weaponSpec: spec });
    r = { rig, boxes: hitboxesFromPlan(rig.plan, { mass: app.weight }) };
    rigs.set(key, r);
  }
  return r;
}
const animatorFor = (rig: Rig, sk: ReturnType<typeof defaultHumanoid>) =>
  new Animator(legGeometryFromBones(rig.plan.bones, rig.plan.bones.find((b) => b.id === "ankleL")!.head[1], 1), limitTableFrom(sk.limits()));
const head = (rig: Rig, id: string) => rig.plan.bones.find((b) => b.id === id)!.head;

/** Deepest penetration (m, > 0 inside) of the weapon's features into a hitbox set. */
function depthInto(matrix: ArrayLike<number>, spec: WeaponSpec, boxes: HitboxSet): number {
  let worst = -Infinity;
  for (const f of spec.features) {
    const pts = f.points, n = Math.max(1, pts.length - 1);
    for (let k = 0; k < n; k++) for (let s = 0; s <= 8; s++) {
      const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)], u = s / 8;
      const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, z = a[2] + (b[2] - a[2]) * u;
      const wx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
      const wy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
      const wz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
      for (const box of boxes.boxes) worst = Math.max(worst, f.radius - hitboxDistance(box, wx, wy, wz));
    }
  }
  return worst;
}

interface Result { contact: Contact | null; selfWorst: number; holdDepth: number; engage: number }

/** One plain swing at centre distance D, engine frame order. `freeze` false = the control (no stop). */
function swing(id: ArchetypeId, D: number | "engage", defender = ORK, freeze = true): Result {
  const spec = weaponFromSeed(id, 7);
  const att = rigOf(HUMAN, spec, "A"), dfd = rigOf(defender, weaponFromSeed("mace", 3), "B");
  const A = att.rig, B = dfd.rig;
  const skA = defaultHumanoid(), skB = defaultHumanoid();
  const setup = swingSetupFor(spec, armGeometry(head(A, "shoulderR"), head(A, "elbowR"), A.plan.arms[1].grip));
  setup.aimLine = measureAimLine(A, skA, setup);
  const profile = combatProfile(spec);
  const engage = Math.min(setup.engage, profile.reach + BODY_RADIUS);
  const dist = D === "engage" ? engage : D;
  const anA = animatorFor(A, skA), anB = animatorFor(B, skB), drv = new SwingDriver(setup, limitTableFrom(skA.limits()));
  const guard = new ArmGuard(A, att.boxes, spec), tr = new StrikeTracker();
  const a = { x: 0, z: 0 }, b = { x: 0, z: dist }, prevArm = new Float64Array(4), arm = new Float64Array(4);
  const grip = A.weaponNode.parent!;
  let contact: Contact | null = null, selfWorst = -Infinity, holdDepth = -Infinity, holdFrames = 0;
  for (let f = 0; f < 30 + Math.ceil((profile.cooldown + 0.3) / DT); f++) {
    if (f === 30) { tr.beginSwing(setup.twoHanded ? 2 : 1); drv.begin(dist, profile.cooldown); }
    if (f >= 30) drv.advance(DT);
    const s = drv.takeStep(), d0 = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    a.x += (b.x - a.x) / d0 * s; a.z += (b.z - a.z) / d0 * s;
    for (const [rig, sk, an, me, other, isA] of [[A, skA, anA, a, b, true], [B, skB, anB, b, a, false]] as const) {
      const yaw = Math.atan2(other.x - me.x, other.z - me.z) + (isA ? drv.yaw() : 0);
      const o = an.update(DT, {
        x: me.x, z: me.z, yaw, rootY: 0, speed: 0, moveDirLocal: 0, turnRate: 0, grounded: true, hit: false,
        attack: isA && drv.active, attackPose: isA ? drv.attackPose() : null, block: false, ko: false, engaged: true,
        skill: null, skillProgress: 0, groundHeight: () => 0, externalRoll: 0,
      });
      sk.drive(o.angles, o.hipRoll, o.ankleRoll);
      rig.update(sk, DT);
      rig.setGrip(isA ? drv.gripPitch(sk.joint("spine").angle, sk.joint("shoulderR").angle, sk.joint("elbowR").angle) : 0, isA ? drv.gripRoll() : 0);
      if (isA) rig.weaponNode.position.y = -drv.chokeOffset();
      rig.group.position.set(me.x + o.rootOffsetLateral * Math.cos(yaw), o.rootOffsetY, me.z - o.rootOffsetLateral * Math.sin(yaw));
      rig.group.rotation.set(0, yaw, o.rootRoll);
      rig.group.updateMatrixWorld(true);
    }
    guard.solve(skA);
    updateHitboxes(dfd.boxes, boneWorldOf(B));
    tr.sample(weaponMatrix(A), f * DT);
    selfWorst = Math.max(selfWorst, selfClearance({ matrix: tr.curr.matrix, time: 0 }, att.boxes, spec));
    tr.active = drv.striking();
    const hit: Contact | null = !contact ? tr.sweep(1, dfd.boxes, spec) : null;
    if (hit) {
      contact = hit;
      if (freeze) {
        // Engine.#onContact: rewind the weapon arm to the contact instant, then hold.
        arm[0] = skA.joint("shoulderR").angle; arm[1] = skA.joint("elbowR").angle; arm[2] = grip.rotation.x; arm[3] = grip.rotation.z;
        for (let i = 0; i < 4; i++) arm[i] = prevArm[i] + (arm[i] - prevArm[i]) * hit.t;
        guard.apply(arm);
        (tr.curr.matrix as Float32Array).set(weaponMatrix(A));
        drv.freeze(hit.t);
      }
    }
    if (contact && holdFrames < 6) { holdDepth = Math.max(holdDepth, depthInto(tr.curr.matrix, spec, dfd.boxes)); holdFrames++; }
    prevArm[0] = skA.joint("shoulderR").angle; prevArm[1] = skA.joint("elbowR").angle; prevArm[2] = grip.rotation.x; prevArm[3] = grip.rotation.z;
  }
  return { contact, selfWorst, holdDepth, engage };
}

for (const id of ["longsword", "spear", "warhammer"] as ArchetypeId[]) {
  Deno.test(`${id}: lands at its engage distance (human and ork), misses at 3 m, never cuts its holder`, () => {
    const atOrk = swing(id, "engage"), atHuman = swing(id, "engage", HUMAN), far = swing(id, 3.0);
    console.log(`${id}: engage ${atOrk.engage.toFixed(2)} m -> ork ${atOrk.contact?.hitbox.zone ?? "MISS"}, human ${atHuman.contact?.hitbox.zone ?? "MISS"}; 3.0 m -> ${far.contact?.hitbox.zone ?? "miss"}; self worst ${(100 * Math.max(atOrk.selfWorst, atHuman.selfWorst, far.selfWorst)).toFixed(2)} cm`);
    assert(atOrk.contact && atHuman.contact, "contact at the engage distance");
    assert(!far.contact, "no contact out of reach");
    for (const r of [atOrk, atHuman, far]) assert(r.selfWorst <= 0.005, `own blade ${(100 * r.selfWorst).toFixed(2)} cm inside its holder`);
  });
}

Deno.test("on contact the blade stops at the body (the control without the freeze passes through)", () => {
  for (const id of ["longsword", "warhammer", "spear"] as ArchetypeId[]) {
    const stop = swing(id, 1.4), through = swing(id, 1.4, ORK, false);
    console.log(`${id} at 1.4 m: blade depth during the hold ${(100 * stop.holdDepth).toFixed(1)} cm; without the freeze ${(100 * through.holdDepth).toFixed(1)} cm`);
    assert(stop.contact && through.contact, "both swings connect");
    assert(stop.holdDepth < 0.05, `${id}: blade ${(100 * stop.holdDepth).toFixed(1)} cm inside the body while it should be stopped`);
    assert(through.holdDepth > stop.holdDepth + 0.04, `${id}: the control must pass deeper (freeze is what stops it)`);
  }
});
