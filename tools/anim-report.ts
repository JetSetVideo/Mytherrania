// Lane M: numeric motion report — "check with numbers, not eyes".
//
//   deno run -A tools/anim-report.ts            measure the current motion (style on)  -> artifacts/anim-report.json
//   deno run -A tools/anim-report.ts --before   the same measurements with NO style    -> artifacts/anim-report-before.json
//
// For every race × subrace (Races.ts, 4 × 3) × swing kind (slash = longsword, chop = warhammer,
// thrust = spear) × live state (fresh / exhausted / low hp), on lane A's REAL skinned rig driven in
// the engine's frame order (SwingDriver -> Animator -> Skeleton.drive -> rig.update -> grip ->
// placement), plus walk and run loops:
//   slide      planted-foot slide per stance (Measure.DriftTracker), mm, max and p95
//   floor      lowest sole point (heel, ball, toe tip) above the ground, mm (< 0 = under the floor)
//   seam       gait cycle wrap: pose difference between consecutive cycles at phase 0 (deg) and the
//              velocity jump on the wrap frame (deg/s, Measure.SeamTracker); swing end -> idle:
//              the largest velocity jump in the 4 frames after the swing ends (deg/s)
//   clipping   weapon (features as capsules) and hands vs the holder's own torso capsules, knee vs
//              knee (shin/thigh capsules), foot vs foot: smallest clearance, mm (< 0 = inside)
//   timings    wind-up / strike / hold / recovery / settle, s
//   speed      peak joint speed, deg/s
// Seams and peak speeds come from a 240 Hz run (a 60 Hz second difference is mostly the curve's
// own acceleration); everything else from 60 Hz, the game's rate.
// @deno-types="@types/three"
import * as THREE from "three";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { Animator } from "../src/game/anim/Animator.ts";
import { JOINT_COUNT, JOINT_ORDER, legGeometryFromBones, type LegGeometry, limitTableFrom } from "../src/game/anim/Rig.ts";
import { armGeometry } from "../src/game/anim/Swing.ts";
import { runScenario, type ScenarioResult, type ScenarioSegment } from "../src/game/anim/Scenario.ts";
import { type CapsuleLike, ClearanceStat, polylineClearance, setClearance } from "../src/game/anim/Clipping.ts";
import { SwingDriver, swingSetupFor } from "../src/combat/SwingDriver.ts";
import { measureAimLine } from "../src/combat/SwingRig.ts";
import { hitboxesFromPlan, updateHitboxes } from "../src/combat/Hitboxes.ts";
import { boneWorldOf } from "../src/combat/RigAdapter.ts";
import type { ArchetypeId, Hitbox, HitboxSet, WeaponSpec } from "../src/combat/contracts.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { combatProfile } from "../src/game/weapons/Profile.ts";
import { toGeneratedWeapon } from "../src/game/weapons/Adapter.ts";
import { RACES } from "../src/game/Races.ts";
import { createFighter } from "../src/game/Fighter.ts";
import type { CombatStats } from "../src/game/Stats.ts";
import type { Appearance } from "../src/game/Characters.ts";
import { type LiveState, type MotionStyle, motionStyleFor, styleDistance, styleVector, weaponMotionFromSpec } from "../src/game/anim/MotionStyle.ts";

const DEG = 180 / Math.PI, MM = 1000;
export const ACCEL = 6.5 / 0.12; // engine PLAYER_WALK
/** Body size per race (lane A / anim_realrig_test): height m, weight kg. */
export const RACE_BODY: Record<string, { height: number; weight: number }> = {
  human: { height: 1.7, weight: 72 }, elf: { height: 1.77, weight: 60 }, dwarf: { height: 1.39, weight: 70 }, ork: { height: 1.95, weight: 120 },
};
/** One weapon per swing kind (seed 7: the swing tests' fixtures). */
export const KIND_WEAPON: Record<"slash" | "chop" | "thrust", ArchetypeId> = { slash: "longsword", chop: "warhammer", thrust: "spear" };
/** The live states the report sweeps. */
export const LIVE_STATES: Record<string, LiveState> = {
  fresh: { hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false },
  exhausted: { hpFrac: 0.8, staminaFrac: 0.03, manaFrac: 0.5, exhausted: true },
  lowHp: { hpFrac: 0.12, staminaFrac: 0.6, manaFrac: 0.6, exhausted: false },
};

type Rig = ReturnType<typeof buildSkinnedHumanoid>;
export interface Body { race: string; subrace: string; rig: Rig; boxes: HitboxSet; geom: LegGeometry; stats: CombatStats; spec: WeaponSpec; app: Appearance }
const TORSO = new Set(["chest", "abdomen", "pelvis"]);

/** Lane A's rig with this weapon, for a race / subrace (built like Engine.#spawnMeshes). */
export function buildBody(race: string, subrace: string, weapon: ArchetypeId): Body {
  const b = RACE_BODY[race] ?? RACE_BODY.human;
  const app: Appearance = { body: "#ef7455", accent: "#dfaa55", height: b.height, weight: b.weight, hair: "#3a2a1a", eyes: "#2f6fb5", race, subrace };
  const spec = weaponFromSeed(weapon, 7);
  const rig = buildSkinnedHumanoid(toGeneratedWeapon(spec), app, "fire", undefined, { paint: false, weaponSpec: spec });
  const ankleY = rig.plan.bones.find((x) => x.id === "ankleL")!.head[1];
  const stats = createFighter("Warrior", `${race}-${subrace}`, 0, 0, 0.5, race, subrace).stats;
  return { race, subrace, rig, boxes: hitboxesFromPlan(rig.plan, { mass: b.weight }), geom: legGeometryFromBones(rig.plan.bones, ankleY, 1), stats, spec, app };
}

/** The style of a body + weapon (lane M MotionStyle), seeded by the race/subrace name. */
export function styleOf(body: Body, kind: "slash" | "chop" | "thrust"): MotionStyle {
  let seed = 0;
  for (const ch of `${body.race}/${body.subrace}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return motionStyleFor({
    race: body.race, subrace: body.subrace, seed,
    body: { geometry: body.geom, height: body.app.height, weight: body.app.weight },
    weapon: weaponMotionFromSpec(body.spec, kind), stats: body.stats,
  });
}

const head = (rig: Rig, id: string) => rig.plan.bones.find((b) => b.id === id)!.head;
const WPTS = new Float64Array(3 * 16);

/** Per-frame clipping channels for one body. */
export class ClipMeter {
  readonly weaponTorso = new ClearanceStat(0);
  readonly weaponGuard = new ClearanceStat(0);
  readonly weaponStrike = new ClearanceStat(0);
  readonly handTorso = new ClearanceStat(0);
  readonly kneeKnee = new ClearanceStat(0);
  readonly footFoot = new ClearanceStat(0);
  readonly #torso: Hitbox[];
  readonly #hands: Hitbox[];
  readonly #shinL: Hitbox[]; readonly #shinR: Hitbox[];
  readonly #footL: Hitbox[]; readonly #footR: Hitbox[];
  constructor(readonly body: Body) {
    const bx = body.boxes.boxes;
    this.#torso = bx.filter((h) => TORSO.has(h.zone));
    this.#hands = bx.filter((h) => h.zone === "hand");
    // Shins only: the thigh capsules meet at the crotch by construction (bind pose), which is not clipping.
    this.#shinL = bx.filter((h) => h.zone === "shin" && h.side === "L");
    this.#shinR = bx.filter((h) => h.zone === "shin" && h.side === "R");
    this.#footL = bx.filter((h) => h.zone === "foot" && h.side === "L");
    this.#footR = bx.filter((h) => h.zone === "foot" && h.side === "R");
  }
  /** Measure the rig's CURRENT matrices; `phase` tags the weapon sample as guard / strike / other. */
  sample(phase: "guard" | "strike" | "other"): void {
    const { rig, boxes, spec } = this.body;
    updateHitboxes(boxes, boneWorldOf(rig));
    const m = rig.weaponNode.matrixWorld.elements;
    let w = Infinity;
    for (const f of spec.features) {
      const n = Math.min(16, f.points.length);
      for (let k = 0; k < n; k++) {
        const p = f.points[k];
        WPTS[3 * k] = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
        WPTS[3 * k + 1] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
        WPTS[3 * k + 2] = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
      }
      w = Math.min(w, polylineClearance(WPTS, n, f.radius, this.#torso as CapsuleLike[]));
    }
    this.weaponTorso.add(w);
    if (phase === "guard") this.weaponGuard.add(w);
    if (phase === "strike") this.weaponStrike.add(w);
    this.handTorso.add(setClearance(this.#hands, this.#torso));
    this.kneeKnee.add(setClearance(this.#shinL, this.#shinR));
    this.footFoot.add(setClearance(this.#footL, this.#footR));
  }
}

/** Drive the real rig from an animator frame like Engine does (pose, grip, placement). */
function placeRig(rig: Rig, sk: ReturnType<typeof defaultHumanoid>, drv: SwingDriver | null, out: { angles: Float64Array; hipRoll: Float64Array; ankleRoll: Float64Array }, pl: { x: number; y: number; z: number; yaw: number; roll: number; lateral: number }, dt: number): void {
  sk.drive(out.angles, out.hipRoll, out.ankleRoll);
  rig.update(sk, dt);
  if (drv) {
    rig.setGrip(drv.gripPitch(sk.joint("spine").angle, sk.joint("shoulderR").angle, sk.joint("elbowR").angle), drv.gripRoll());
    rig.weaponNode.position.y = -drv.chokeOffset();
  }
  rig.group.position.set(pl.x + pl.lateral * Math.cos(pl.yaw), pl.y, pl.z - pl.lateral * Math.sin(pl.yaw));
  rig.group.rotation.set(0, pl.yaw, pl.roll);
  rig.group.updateMatrixWorld(true);
}

const quant = (xs: number[], q: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};
const peakDeg = (r: ScenarioResult) => {
  let m = 0, j0 = 0;
  for (let j = 0; j < JOINT_COUNT; j++) if (r.peakSpeed[j] > m) { m = r.peakSpeed[j]; j0 = j; }
  return { degPerS: m * DEG, joint: JOINT_ORDER[j0] };
};

export interface SwingCase {
  race: string; subrace: string; kind: string; live: string;
  slideMaxMm: number; slideP95Mm: number; ballSlideMaxMm: number; stances: number; floorMinMm: number;
  swingEndVelJumpDegS: number; swingEndPoseJumpDeg: number; peakJointDegS: number; peakJoint: string; speedLimited: number; limitViolations: number;
  weaponTorsoMm: number; weaponGuardMm: number; weaponStrikeMm: number; handTorsoMm: number; kneeKneeMm: number; footFootMm: number;
  timing: { windup: number; strike: number; hold: number; recover: number; settle: number; total: number; contactAt: number };
  /** Swing length / engine cooldown (> 1 is fine: the recovery is an interruptible tail). */
  totalOverCooldown: number;
  /** The BLOW (wind-up + strike + hold) / cooldown: > 1 means the next blow waits (the attack rate drops). */
  blowOverCooldown: number;
  /** Peak weapon speed in the recovery / in the strike (< 1: the recovery is the slower, heavier move). */
  recoverOverStrike: number;
}

/** One swing (engaged idle -> press -> swing -> settle) for a body, kind and live state. */
export function measureSwing(body: Body, kind: "slash" | "chop" | "thrust", live: string, styled: boolean): SwingCase {
  const lim = limitTableFrom(defaultHumanoid().limits());
  const arm = armGeometry(head(body.rig, "shoulderR"), head(body.rig, "elbowR"), body.rig.plan.arms[1].grip);
  const setup = swingSetupFor(body.spec, arm);
  const skMeasure = defaultHumanoid();
  setup.aimLine = measureAimLine(body.rig, skMeasure, setup);
  // Engine.#swingCooldown: class attack interval × the weapon's tempo (profile cooldown / BASELINE_INTERVAL 1.0).
  const cooldown = body.stats.attackInterval * combatProfile(body.spec).cooldown;
  const style = styled ? styleOf(body, kind) : null;
  const run = (hz: number, withRig: boolean) => {
    const an = new Animator(body.geom, lim, styled ? {} : { pivotPitch: 0 }), drv = new SwingDriver(setup, lim);
    if (style) { an.setStyle(style); drv.setStyle(style); an.setLive(LIVE_STATES[live]); drv.setLive(LIVE_STATES[live]); }
    const sk = defaultHumanoid(), clip = new ClipMeter(body);
    const dist = setup.sweet + 0.25;
    // Estimate the swing length (style may stretch it): run until the driver is idle + settle.
    const segs: ScenarioSegment[] = [
      { duration: 0.6, speed: 0, engaged: true },
      { duration: 3.0, speed: 0, engaged: true, swing: { driver: drv, distance: dist, cooldown } },
    ];
    let started = false, prevA = Number.NaN, prevB = Number.NaN, vStrike = 0, vRecover = 0;
    const res = runScenario(an, segs, {
      hz, accel: ACCEL,
      onFrame: !withRig ? () => {
        // Weapon speed by phase: the blade angle (arcs) or the hand's arm (thrust), rad/s.
        if (!drv.active) { prevA = Number.NaN; return; }
        const sm = drv.sample, a = kind === "thrust" ? sm.shoulder : sm.blade, b2 = kind === "thrust" ? sm.elbow : 0;
        if (Number.isFinite(prevA)) {
          const v = Math.hypot(a - prevA, b2 - prevB) * hz, tm = drv.phaseTimes(), c = drv.clock;
          if (c > tm.windup && c <= tm.windup + tm.strike) vStrike = Math.max(vStrike, v);
          else if (c > tm.windup + tm.strike + tm.hold) vRecover = Math.max(vRecover, v);
        }
        prevA = a; prevB = b2;
      } : (t, out, pl) => {
        placeRig(body.rig, sk, drv, out, pl, 1 / hz);
        if (t > 0.3) {
          if (drv.active) started = true;
          const c = drv.clock, tm = drv.player.timing;
          const phase = !drv.active && !started ? "guard" : drv.active && c >= tm.windup && c <= tm.windup + tm.strike ? "strike" : "other";
          clip.sample(phase);
        }
      },
    });
    return { res, clip, drv, vStrike, vRecover };
  };
  const a = run(60, true), b = run(240, false);
  const tm = a.drv.phaseTimes();
  const end = b.res.swingEnds[0]?.velJump ?? 0;
  const pk = peakDeg(b.res);
  return {
    race: body.race, subrace: body.subrace, kind, live,
    slideMaxMm: Math.max(0, ...a.res.drift) * MM, slideP95Mm: quant(a.res.drift, 0.95) * MM, ballSlideMaxMm: Math.max(0, ...a.res.driftBall) * MM,
    stances: a.res.drift.length, floorMinMm: a.res.soleMin * MM,
    swingEndVelJumpDegS: end * DEG, swingEndPoseJumpDeg: end * DEG / 240, peakJointDegS: pk.degPerS, peakJoint: pk.joint,
    speedLimited: b.res.speedLimited, limitViolations: a.res.limitViolations + b.res.limitViolations,
    weaponTorsoMm: a.clip.weaponTorso.min * MM, weaponGuardMm: a.clip.weaponGuard.min * MM, weaponStrikeMm: a.clip.weaponStrike.min * MM,
    handTorsoMm: a.clip.handTorso.min * MM, kneeKneeMm: a.clip.kneeKnee.min * MM, footFootMm: a.clip.footFoot.min * MM,
    timing: { ...tm, total: tm.windup + tm.strike + tm.hold + tm.recover + tm.settle, contactAt: tm.contactAt },
    totalOverCooldown: (tm.windup + tm.strike + tm.hold + tm.recover + tm.settle) / cooldown,
    blowOverCooldown: (tm.windup + tm.strike + tm.hold) / cooldown,
    recoverOverStrike: b.vRecover / Math.max(1e-9, b.vStrike),
  };
}

export interface LoopCase {
  race: string; subrace: string; gait: string; live: string;
  slideMaxMm: number; slideP95Mm: number; ballSlideMaxMm: number; stances: number; floorMinMm: number;
  cycleSeamDeg: number; wrapVelJumpDegS: number; backgroundVelJumpDegS: number; cycles: number;
  kneeKneeMm: number; footFootMm: number; peakJointDegS: number;
}

/** Walk (2.1 m/s) or run (6.5 m/s) loop for a body and live state. */
export function measureLoop(body: Body, gait: "walk" | "run", live: string, styled: boolean): LoopCase {
  const lim = limitTableFrom(defaultHumanoid().limits());
  const v = gait === "walk" ? 2.1 : 6.5;
  const style = styled ? styleOf(body, "slash") : null;
  const segs: ScenarioSegment[] = [{ duration: 0.4, speed: 0 }, { duration: 1.6, speed: v }, { duration: 3, speed: v }];
  const run = (hz: number, withRig: boolean) => {
    const an = new Animator(body.geom, lim, styled ? {} : { pivotPitch: 0 });
    if (style) { an.setStyle(style); an.setLive(LIVE_STATES[live]); }
    const sk = defaultHumanoid(), clip = new ClipMeter(body);
    const res = runScenario(an, segs, {
      hz, accel: ACCEL,
      onFrame: withRig ? (t, out, pl) => { if (t > 1.0) { placeRig(body.rig, sk, null, out, pl, 1 / hz); clip.sample("other"); } } : undefined,
    });
    return { res, clip };
  };
  const a = run(60, true), b = run(240, false);
  // Steady state only: skip the first 3 cycle seams (acceleration transient).
  const seams = b.res.seams.cycleSeams.slice(3), wraps = b.res.seams.wrapVelJumps.slice(3);
  return {
    race: body.race, subrace: body.subrace, gait, live,
    slideMaxMm: Math.max(0, ...a.res.drift) * MM, slideP95Mm: quant(a.res.drift, 0.95) * MM, ballSlideMaxMm: Math.max(0, ...a.res.driftBall) * MM,
    stances: a.res.drift.length, floorMinMm: a.res.soleMin * MM,
    cycleSeamDeg: Math.max(0, ...seams) * DEG, wrapVelJumpDegS: Math.max(0, ...wraps) * DEG,
    backgroundVelJumpDegS: b.res.seams.background(0.95) * DEG, cycles: seams.length,
    kneeKneeMm: a.clip.kneeKnee.min * MM, footFootMm: a.clip.footFoot.min * MM, peakJointDegS: peakDeg(b.res).degPerS,
  };
}

const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "-");
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "-");
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "-");

/** Pairwise distances of style vectors (race means, subraces, live) — "slightly different", measured. */
export function styleDifferences(bodies: Body[]): Record<string, unknown> {
  const vec = new Map<string, number[]>();
  for (const b of bodies) vec.set(`${b.race}/${b.subrace}`, styleVector(styleOf(b, "slash")));
  const races = [...new Set(bodies.map((b) => b.race))];
  const mean = (keys: string[]) => {
    const vs = keys.map((k) => vec.get(k)!), n = vs[0].length;
    return Array.from({ length: n }, (_, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length);
  };
  const raceMean = new Map(races.map((r) => [r, mean([...vec.keys()].filter((k) => k.startsWith(r + "/")))]));
  const racePairs: Record<string, number> = {};
  for (let i = 0; i < races.length; i++) for (let j = i + 1; j < races.length; j++) {
    racePairs[`${races[i]}-${races[j]}`] = styleDistance(raceMean.get(races[i])!, raceMean.get(races[j])!);
  }
  const subPairs: Record<string, number> = {};
  for (const r of races) {
    const ks = [...vec.keys()].filter((k) => k.startsWith(r + "/"));
    let mx = 0, mn = Infinity;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const d = styleDistance(vec.get(ks[i])!, vec.get(ks[j])!); mx = Math.max(mx, d); mn = Math.min(mn, d); }
    subPairs[r] = mx; subPairs[`${r}:min`] = mn;
  }
  // Same race + subrace, two seeds (two fighters never move identically).
  const b0 = bodies[0];
  const twin = (seed: number) => styleVector(motionStyleFor({ race: b0.race, subrace: b0.subrace, seed, body: { geometry: b0.geom, height: b0.app.height, weight: b0.app.weight }, weapon: weaponMotionFromSpec(b0.spec, "slash"), stats: b0.stats }));
  const seedPair = styleDistance(twin(1), twin(2));
  // Live: fresh vs exhausted vs low hp on the same fighter.
  const st = styleOf(b0, "slash");
  const liveVec = (l: LiveState) => { st.setLiveImmediate(l); return styleVector(st); };
  const fresh = liveVec(LIVE_STATES.fresh), ex = liveVec(LIVE_STATES.exhausted), lo = liveVec(LIVE_STATES.lowHp);
  st.setLiveImmediate(LIVE_STATES.fresh);
  return {
    vectorFields: styleVector.fields, racePairs, subracePairsMaxMin: subPairs, seedPair,
    live: { freshExhausted: styleDistance(fresh, ex), freshLowHp: styleDistance(fresh, lo) },
    perSubrace: Object.fromEntries([...vec.entries()].map(([k, v]) => [k, v.map((x) => Number(x.toFixed(4)))])),
  };
}

if (import.meta.main) {
  const before = Deno.args.includes("--before");
  const styled = !before;
  const outPath = before ? "artifacts/anim-report-before.json" : "artifacts/anim-report.json";
  const t0 = performance.now();
  const swings: SwingCase[] = [], loops: LoopCase[] = [];
  const bodies: Body[] = [];
  for (const race of RACES) {
    for (const sub of race.subspecies) {
      for (const kind of ["slash", "chop", "thrust"] as const) {
        const body = buildBody(race.id, sub.id, KIND_WEAPON[kind]);
        if (kind === "slash") bodies.push(body);
        for (const live of Object.keys(LIVE_STATES)) swings.push(measureSwing(body, kind, live, styled));
        if (kind === "slash") for (const g of ["walk", "run"] as const) for (const live of Object.keys(LIVE_STATES)) loops.push(measureLoop(body, g, live, styled));
      }
      console.error(`  measured ${race.id}/${sub.id} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    }
  }
  const worst = <T>(xs: T[], k: keyof T, min = false) => xs.reduce((m, x) => (min ? Math.min(m, x[k] as number) : Math.max(m, x[k] as number)), min ? Infinity : -Infinity);
  console.log(`\n# Lane M motion report — ${before ? "BEFORE (no style)" : "AFTER (MotionStyle on)"}  (${swings.length} swings, ${loops.length} loops)\n`);
  console.log("## Swings (worst over 3 subraces × 3 live states per race × kind)\n");
  console.log("| race | kind | slide max/p95 mm | floor min mm | end vel-jump °/s | peak °/s | weapon-torso guard/strike mm | hand-torso mm | knee-knee mm | foot-foot mm | windup/strike/hold/recover/settle s (fresh, 1st subrace) |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const race of RACES) for (const kind of ["slash", "chop", "thrust"]) {
    const cs = swings.filter((c) => c.race === race.id && c.kind === kind);
    const t = cs.find((c) => c.live === "fresh")!.timing;
    console.log(`| ${race.id} | ${kind} | ${f1(worst(cs, "slideMaxMm"))}/${f1(worst(cs, "slideP95Mm"))} | ${f1(worst(cs, "floorMinMm", true))} | ${f1(worst(cs, "swingEndVelJumpDegS"))} | ${f1(worst(cs, "peakJointDegS"))} | ${f1(worst(cs, "weaponGuardMm", true))}/${f1(worst(cs, "weaponStrikeMm", true))} | ${f1(worst(cs, "handTorsoMm", true))} | ${f1(worst(cs, "kneeKneeMm", true))} | ${f1(worst(cs, "footFootMm", true))} | ${f3(t.windup)}/${f3(t.strike)}/${f3(t.hold)}/${f3(t.recover)}/${f3(t.settle)} |`);
  }
  console.log("\n## Timings by live state (human/imperial slash; s)\n");
  for (const live of Object.keys(LIVE_STATES)) {
    const c = swings.find((x) => x.race === "human" && x.subrace === "imperial" && x.kind === "slash" && x.live === live)!;
    console.log(`  ${live.padEnd(10)} windup ${f3(c.timing.windup)} strike ${f3(c.timing.strike)} hold ${f3(c.timing.hold)} recover ${f3(c.timing.recover)} settle ${f3(c.timing.settle)} total ${f3(c.timing.total)}`);
  }
  console.log("\n## Loops (worst over subraces × live states)\n");
  console.log("| race | gait | slide max/p95 mm | floor min mm | cycle seam ° | wrap vel-jump °/s (background p95) | knee-knee mm | foot-foot mm |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const race of RACES) for (const g of ["walk", "run"]) {
    const cs = loops.filter((c) => c.race === race.id && c.gait === g);
    console.log(`| ${race.id} | ${g} | ${f1(worst(cs, "slideMaxMm"))}/${f1(worst(cs, "slideP95Mm"))} | ${f1(worst(cs, "floorMinMm", true))} | ${f3(worst(cs, "cycleSeamDeg"))} | ${f1(worst(cs, "wrapVelJumpDegS"))} (${f1(worst(cs, "backgroundVelJumpDegS"))}) | ${f1(worst(cs, "kneeKneeMm", true))} | ${f1(worst(cs, "footFootMm", true))} |`);
  }
  const summary = {
    swingSlideMaxMm: worst(swings, "slideMaxMm"), loopSlideMaxMm: worst(loops, "slideMaxMm"),
    floorMinMm: Math.min(worst(swings, "floorMinMm", true), worst(loops, "floorMinMm", true)),
    cycleSeamMaxDeg: worst(loops, "cycleSeamDeg"), swingEndVelJumpMaxDegS: worst(swings, "swingEndVelJumpDegS"),
    weaponGuardMinMm: worst(swings, "weaponGuardMm", true), weaponStrikeMinMm: worst(swings, "weaponStrikeMm", true),
    weaponTorsoMinMm: worst(swings, "weaponTorsoMm", true), handTorsoMinMm: worst(swings, "handTorsoMm", true),
    kneeKneeMinMm: Math.min(worst(swings, "kneeKneeMm", true), worst(loops, "kneeKneeMm", true)),
    footFootMinMm: Math.min(worst(swings, "footFootMm", true), worst(loops, "footFootMm", true)),
    peakJointMaxDegS: worst(swings, "peakJointDegS"), limitViolations: swings.reduce((s, c) => s + c.limitViolations, 0),
    speedLimitedJointFrames: swings.reduce((s, c) => s + c.speedLimited, 0),
    freshTotalOverCooldownMax: worst(swings.filter((c) => c.live === "fresh"), "totalOverCooldown"),
    freshBlowOverCooldownMax: worst(swings.filter((c) => c.live === "fresh"), "blowOverCooldown"),
    recoverOverStrikeMax: worst(swings, "recoverOverStrike"),
    recoverOverStrikeSlashMax: worst(swings.filter((c) => c.kind === "slash"), "recoverOverStrike"),
    recoverOverStrikeChopMax: worst(swings.filter((c) => c.kind === "chop"), "recoverOverStrike"),
    recoverOverStrikeThrustMax: worst(swings.filter((c) => c.kind === "thrust"), "recoverOverStrike"),
    tiredTotalOverCooldownMax: worst(swings.filter((c) => c.live !== "fresh"), "totalOverCooldown"),
  };
  console.log("\n## Summary\n");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(26)} ${f2(v)}`);
  let diff: Record<string, unknown> | null = null;
  if (styled) {
    diff = styleDifferences(bodies);
    console.log("\n## Style differences (normalised style-vector distance; 0 = identical)\n");
    console.log("  race pairs     ", Object.entries(diff.racePairs as Record<string, number>).map(([k, v]) => `${k} ${f3(v)}`).join(", "));
    console.log("  subrace max/min", Object.entries(diff.subracePairsMaxMin as Record<string, number>).map(([k, v]) => `${k} ${f3(v)}`).join(", "));
    console.log("  two seeds, same subrace", f3(diff.seedPair as number));
    const lv = diff.live as Record<string, number>;
    console.log("  live: fresh-exhausted", f3(lv.freshExhausted), " fresh-lowHp", f3(lv.freshLowHp));
  }
  await Deno.mkdir("artifacts", { recursive: true });
  await Deno.writeTextFile(outPath, JSON.stringify({ mode: before ? "before" : "after", generatedAt: new Date().toISOString(), summary, swings, loops, styleDifferences: diff }, null, 1));
  console.log(`\nwrote ${outPath} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  void THREE;
}
