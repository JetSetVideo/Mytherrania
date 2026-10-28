# Lane C — Motion (R04 + foot-planting half of R03)

Procedural animation built on interpolation maths: a phase-driven gait with latched (planted) feet, analytic
two-bone foot IK with hip abduction, a layered spring-weighted pose blender, and one `Animator` per fighter that
replaces `Skeleton.setPose` for locomotion. Pure modules (no THREE, no DOM), no per-frame allocation in the animator.

## 0. Read first — the legacy rig renders the legs MIRRORED

`Humanoid.update` writes `pivot.rotation.set(joint.angle, 0, 0)`. The rig faces +z, bones hang along −y, and
`Rx(θ)·(0,−1,0) = (0, −cosθ, −sinθ)`: a positive angle tips a hanging bone **backward**. Every leg author in the
codebase assumed the opposite: walk pose (`hipL 0.55` forward), `Skills.legDrive` (front leg `+`), `StanceAnim`
kneel (`hip 0.8, knee −1.9, ankle 0.7`). So today a positive hip swings the thigh back, and the `[−2.4, 0]`
knee folds the shin **forward** (a reversed "bird" knee). Arms are fine: shoulder/elbow negative = forward.
Lane C keeps the Skeleton convention the authors used (hip + = flexion, knee − = flexion, ankle + = toes down,
spine + = lean forward) and exports `RIG_ROTATION_SIGN` (hip/knee = −1, all others +1). **Without patch A1 my
output renders mirrored legs.** The same flip makes the existing kneel, walk-pose and leg-drive skill curves
anatomically correct.

## 1. Files (all new)

| File | Role |
|---|---|
| `src/game/anim/Rig.ts` | joint order, limit table, `RIG_ROTATION_SIGN`, `LegGeometry` (+ legacy / skinned builders), sagittal + 3D leg FK |
| `src/game/anim/FootIK.ts` | law-of-cosines two-bone IK, pelvis drop, ground probe, sole-parallel leg solve, 3D solve with hip abduction |
| `src/game/anim/Gait.ts` | derived gait shape (stride, duty, apex, bob, sway), phase cycle, foot latching, swing arc, re-plant steps |
| `src/game/anim/PoseBlend.ts` | layer blender: spring-weighted override/additive layers, masks, clamp, pop guard, angular speed limit |
| `src/game/anim/Poses.ts` | guard / attack / hit / KO / air / breath pose tables (attack/hit/KO copied from `defaultHumanoid`) |
| `src/game/anim/Animator.ts` | per-fighter pipeline: gait → weights → trunk → pelvis → 3D IK legs → arms/head → blend |
| `src/game/anim/LegacyGeometry.ts` | legacy rig leg lengths from the pure body modules (`buildHumanoid`'s equations, no THREE) |
| `src/game/anim/Measure.ts` | world sole points from angles (`footWorld`), contact-aware `DriftTracker` |
| `src/game/anim/Scenario.ts` | scripted runs + `derivedSpeedBound` (tests, report, parent QA) |
| `tests/anim_gait_test.ts`, `anim_footik_test.ts`, `anim_blend_test.ts`, `anim_animator_test.ts` | 24 tests |
| `/Users/macmax/.hermes/cache/scratch/laneC/report.ts` | tool-free numeric report (output in §6) |

## 2. Equations (R08: derived from named base parameters)

- `L = thigh + shin`; `ŝ = v/√(gL)`; `Fr = ŝ²`; `run = smoothstep(0.35, 0.65, Fr)` (walk→run near Fr 0.5).
- **Stride** `λ = L·(a + b·ŝ)·hill`, `a = 0.74`, `b = 1.56` (fit of Alexander's `λ/L = 2.3·Fr^0.3` at ŝ = 0.5 and 1);
  `hill = clamp(1 − 0.9·|slope|, 0.5, 1)`.
- **Duty** `β = min(lerp(0.62, 0.38, run), 2L·sin(θmax)·hill/λ)`, `θmax = 0.45` rad; cadence `f = v/λ`.
- **Phase** advances by **actual distance travelled / λ**; leg phases offset 0 / 0.5; stance `φ < β`.
  Swing progress lands exactly at the wrap: `u += (1−u)·dφ/(1−φ)`, capped `du ≤ dt/minSwingTime` (0.2 s).
- **Planted feet are latched** in world x/z at touchdown → they cannot skate (gait test: drift exactly 0).
- **Swing**: horizontal = cubic Hermite with zero world velocity at both ends (smoothstep); lift
  `H·sin²(π·u^k)`, `k = lerp(1, 0.7, run)`; apex `H = L·min(0.4, 0.05 + 0.07ŝ + 0.2·run)`.
- **Bob** (2/cycle) `A = lerp((1−k)L(1−cos θh), −gT_f²/8, run)`, `θh = asin(stance/2L)`, `k = 0.5` knee compliance,
  `T_f` flight time; **sway** roll (1/cycle) `atan(0.035)·(1−run)` pivoting at the ground (`rootOffsetLateral`).
- **IK**: `α = acos((t²+d²−s²)/2td)`, `γ = acos((t²+s²−d²)/2ts)`, thigh `ψd + α` (knee forward), shin `ψt − (π−γ)`;
  reach clamped to `[|t−s|+ε, t+s−ε]` with a C1 soft band; unreachable → `pelvisDrop = hipY − (ty + √(lim² − dz²))`.
  Hip abduction `roll = atan2(x_p, −y_p)` (abduct ≤ 0.6, adduct ≤ 0.3 rad), ankle counter-roll `−roll`.
  Sole parallel to the ground: `ankle = Θ − R_pelvis + ψ_shin`, `toe = −slope − Θ`; past an ankle limit the foot
  rolls about the ball (heel lift) or heel (toe lift) instead of breaking.
- **Pelvis**: `hip = ground + sole + L·ride + bob − drop`; `ride` 0.955 stand / 0.92 guard / ≤ 0.95 moving (knees
  ≥ ~33°, away from the IK singularity); drop = max over feet (planted weight 1; swing fades the lift-off spot out
  and the LANDING spot in), capped at 0.2 L, rate ≤ 1 m/s + 1.2·v·tan θmax (inverted-pendulum vault).
- **Blend**: `pose = lerpAngle(pose, L, w·mask)` per override layer, `+= w·mask·L` per additive layer,
  `w` = critically damped spring (`springStep`), clamp, pop-guard spring (0.05 s; bypassed for IK legs ∝ plant
  weight and for skill-curve joints), then **speed limit** `ω = (π/2)·maxRange/minSwingTime = 23.56 rad/s`.
- **Upper body**: shoulder `= rest − g_arm·(ψthigh_opposite − mean)`, elbow bend by run; neck/head cancel 90% of
  the trunk pitch; breathing 0.25 Hz × 0.025 rad when idle; acceleration lean `0.5·atan(a/g)`.

## 3. Exports (exact signatures)

```ts
// Rig.ts
export const JOINT_ORDER: readonly JointName[];             export const JOINT_COUNT: number;
export const JOINT_INDEX: Readonly<Record<JointName, number>>; export type Side = 0 | 1;
export const LEG_JOINTS: readonly { hip: number; knee: number; ankle: number; toe: number }[];
export const ARM_JOINTS: readonly { shoulder: number; elbow: number }[];
export const RIG_ROTATION_SIGN: Readonly<Record<JointName, 1 | -1>>;
export interface JointLimitTable { min: Float64Array; max: Float64Array; rest: Float64Array }
export function limitTableFrom(limits: ReadonlyMap<JointName, { min: number; max: number; rest: number }>): JointLimitTable;
export function clampToLimits(angles: Float64Array, lim: JointLimitTable): void;
export interface TrunkLink { joint: "spine" | "abdomen"; y: number; z: number }
export interface LegGeometry { trunk: readonly TrunkLink[]; hipOffset: { y: number; z: number }; hipLateral: readonly [number, number];
  thigh: number; shin: number; soleOffset: number; ballForward: number; heelBack: number }
export function legLength(g: LegGeometry): number;
export function standingSoleDepth(g: LegGeometry): number;
export function legacyLegGeometry(p: { heightScale: number; spineY: number; thigh: number; shin: number; footDrop: number; hipX: number }): LegGeometry;
export function legGeometryFromBones(bones: readonly BoneSegment[], soleOffset: number, modelScale = 1): LegGeometry;
export function hipPivot(g: LegGeometry, spine: number, abdomen: number, out: Float64Array): number;
export interface LegFK { hipY; hipZ; kneeY; kneeZ; ankleY; ankleZ; ballY; ballZ; heelY; heelZ; footPitch: number }
export function newLegFK(): LegFK;
export function legFK(g: LegGeometry, angles: Float64Array, side: Side, out: LegFK): LegFK;
export interface LegFK3 { ankle: Float64Array; ball: Float64Array; heel: Float64Array }
export function newLegFK3(): LegFK3;
export function legFK3(g: LegGeometry, angles: Float64Array, side: Side, hipRoll: number, ankleRoll: number, out: LegFK3): LegFK3;
export function localToWorld(rootX: number, rootZ: number, yaw: number, lx: number, lz: number, out: Float64Array, at = 0): void;
export function worldToLocal(rootX: number, rootZ: number, yaw: number, wx: number, wz: number, out: Float64Array, at = 0): void;
// FootIK.ts
export interface TwoBoneChain { upper: number; lower: number; reachMargin: number; softness: number }
export const IK_EPSILON = 1e-4;
export interface TwoBoneResult { upperPitch; lowerPitch; kneeFlex; endY; endZ; reach: number; reachable: boolean; pelvisDrop: number }
export function newTwoBoneResult(): TwoBoneResult;
export function smoothMin(a: number, b: number, k: number): number;   export function smoothMax(a: number, b: number, k: number): number;
export function pelvisDropFor(hipY: number, hipZ: number, targetY: number, targetZ: number, limit: number): number;
export function solveTwoBone(hipY: number, hipZ: number, targetY: number, targetZ: number, chain: TwoBoneChain, out: TwoBoneResult): TwoBoneResult;
export interface GroundSample { height: number; slopePitch: number }  export type GroundHeightFn = (x: number, z: number) => number;
export function sampleGround(ground: GroundHeightFn, x: number, z: number, dirX: number, dirZ: number, halfSpan: number, out: GroundSample): GroundSample;
export function ankleFromBall(ballY: number, ballZ: number, footPitch: number, soleOffset: number, ballForward: number, out: Float64Array): void;
export interface LegSolution { hip; knee; ankle; toe; pelvisDrop: number; reachable: boolean; roll: number; residual: number }
export function newLegSolution(): LegSolution;
export function solveLeg(hipY: number, hipZ: number, pelvisR: number, contactY: number, contactZ: number, footPitch: number, groundPitch: number,
  geom: { thigh: number; shin: number; soleOffset: number; ballForward: number }, chain: TwoBoneChain, out: LegSolution,
  contactForward: number = geom.ballForward, ik?: TwoBoneResult): LegSolution;
export function solveLegInPelvis(dx: number, dy: number, dz: number, pelvisR: number, footPitch: number, groundPitch: number,
  chain: TwoBoneChain, rollMin: number, rollMax: number, out: LegSolution, ik?: TwoBoneResult): LegSolution;
// Gait.ts
export interface GaitParams { gravity; strideAtRest; strideGain; walkRunFroude: readonly [number, number]; dutyWalk; dutyRun; maxStanceAngle;
  apexBase; apexGain; apexRun; apexMax; landLambda; minSwingTime; kneeCompliance; toeOffWalk; toeOffRun; toeOffWindow; swingDorsiflex;
  swayLateral; stepCycleTime; footErrorForward; footErrorLateral; strideSlopeLoss; stillSpeed; movingSpeed; speedLambda: number }
export const DEFAULT_GAIT: GaitParams;
export interface GaitShape { speedNorm; froude; runBlend; stride; duty; cadence; stanceLength; swingApex; bobAmplitude; toeOffPitch; swayRoll: number }
export function newGaitShape(): GaitShape;
export function gaitShape(speed: number, leg: number, p?: GaitParams, out?: GaitShape, slopePitch = 0): GaitShape;
export interface FootState { planted: boolean; x; z; lift; pitch; swing; liftX; liftZ; liftPitch; landX; landZ; restX; restZ: number }
export interface GaitInput { x; z; yaw; speed; moveDirLocal: number; grounded: boolean; stagger: number; turnRate: number; slopePitch?: number }
export class Gait { constructor(geom: LegGeometry, params?: Partial<GaitParams>); readonly params; readonly feet: readonly [FootState, FootState];
  readonly shape: GaitShape; phase; speed; moving; cycleRate; bob; roll; urgency: number; get legLength(): number;
  reset(x: number, z: number, yaw: number, stagger = 0): void; update(dt: number, inp: GaitInput): void }
export function frac(v: number): number;
// PoseBlend.ts
export function makeMask(joints: readonly JointName[], value = 1): Float64Array;
export const LOWER_JOINTS, UPPER_JOINTS: readonly JointName[];  export const MASK_FULL, MASK_UPPER, MASK_LOWER: Float64Array;
export type LayerMode = "override" | "additive";  export interface LayerSpec { name: string; mode: LayerMode; mask: Float64Array; smoothTime: number }
export class PoseBlender { constructor(limits: JointLimitTable, popSmoothTime = 0.05); readonly passThrough, trusted: Float64Array;
  maxJointSpeed: number; speedLimited: number; addLayer(spec: LayerSpec): number; get layerCount(): number; values(layer: number): Float64Array;
  mask(layer: number): Float64Array; setTarget(layer: number, w: number): void; setWeightImmediate(layer: number, w: number): void;
  weight(layer: number): number; stepWeights(dt: number): void; baseAuthority(j: number): number; blendJoint(j: number): number;
  evaluateJoint(j: number, dt: number, out: Float64Array): number; evaluate(dt: number, out: Float64Array, skip: Float64Array | null = null): void;
  resetFilter(): void }
// Poses.ts
export type SparsePose = Partial<Record<JointName, number>>;
export const GUARD_POSE, ATTACK_POSE, HIT_OFFSETS, KO_POSE, AIR_POSE, BREATH_UNIT: SparsePose;
export function poseArray(pose: SparsePose, lim: JointLimitTable, mode: "override" | "additive"): Float64Array;
// Animator.ts
export interface AnimatorParams { gait: Partial<GaitParams>; rideStand; rideGuard; rideRun; reachMargin; softness; swingReachMargin; swingSoftness;
  abductionMax; adductionMax; swingRadiusSoftness; maxPelvisDrop; pelvisTiltMax; maxDropRate; guardStagger; guardIdleWeight; leanWalk; leanRun;
  accelLeanGain; accelLambda; armGainWalk; armGainRun; elbowBendWalk; elbowBendRun; headStabilise; breathRate; breathAmplitude; popSmoothTime;
  smoothAir; smoothGuard; smoothAttack; smoothSkill; smoothKo; smoothHit; smoothBreath; skillMaskLambda; maxJointSpeed; maxStep; teleportDistance: number }
export const DEFAULT_ANIMATOR: AnimatorParams;
export interface AnimatorInput { x: number; z: number; yaw: number; rootY?: number; speed: number; moveDirLocal: number; turnRate: number;
  grounded: boolean; hit: boolean; attack: boolean; block: boolean; ko: boolean; engaged?: boolean; skill: SkillAnimation | null;
  skillProgress: number; groundHeight: GroundHeightFn; externalRoll?: number }
export interface FootOut { x: number; y: number; z: number; planted: boolean }
export interface AnimatorOutput { angles: Float64Array; rootOffsetY: number; rootRoll: number; rootOffsetLateral: number;
  hipRoll: Float64Array; ankleRoll: Float64Array; footPlant: { left: boolean; right: boolean }; feet: [FootOut, FootOut];
  pelvisDrop: number; phase: number }
export const LAYER: { loco: 0; air: 1; guard: 2; attack: 3; skill: 4; ko: 5; hit: 6; balance: 7; breath: 8 };
export class Animator { constructor(geometry: LegGeometry, limits: JointLimitTable, params?: Partial<AnimatorParams>);
  readonly geometry; limits; params; gait: Gait; blender: PoseBlender; output: AnimatorOutput; get legLength(): number;
  reset(x: number, z: number, yaw: number): void; update(dt: number, inp: AnimatorInput): AnimatorOutput }
// LegacyGeometry.ts
export const LEGACY_BODY_RADIUS = 0.6;
export function legacyLegGeometryFor(race: string, subrace: string | null, height: number, weight: number, silhouette?: RaceSilhouette): LegGeometry;
// Measure.ts
export interface RigPlacement { x; y; z; yaw; roll; lateral: number }
export interface FootWorld { ballX; ballY; ballZ; heelX; heelY; heelZ; pitch: number }  export function newFootWorld(): FootWorld;
export function footWorld(g: LegGeometry, angles: Float64Array, side: Side, r: RigPlacement, out: FootWorld, hipRoll = 0, ankleRoll = 0): FootWorld;
export class DriftTracker { constructor(minFrames = 3, contactTolerance = 0.005); readonly perStep: number[]; readonly perStepBall: number[];
  sample(planted: boolean, f: FootWorld, groundAtBall: number, groundAtHeel: number): void; flush(): void }
// Scenario.ts
export interface ScenarioSegment { duration: number; speed: number; moveDirLocal?; turnRate?: number; hit?; attack?; block?; ko?; engaged?; grounded?: boolean;
  skill?: SkillAnimation; label?: string }
export interface ScenarioOptions { hz: number; accel: number; ground?: GroundHeightFn; x0?; z0?; yaw0?: number;
  onFrame?: (t: number, out: AnimatorOutput, rig: RigPlacement) => void }
export interface ScenarioResult { frames; dt: number; jointSpeed: Float64Array; maxStep: Float64Array; limitViolations: number; drift: number[];
  driftBall: number[]; soleError: number[]; pelvisDrop: number[]; gaitPlantedFrames: number; honestPlantedFrames: number; finalAngles: Float64Array; speedLimited: number }
export function derivedSpeedBound(ranges: ArrayLike<number>, minSwingTime: number, skills: readonly SkillAnimation[]): number;
export function scenarioDuration(segs: readonly ScenarioSegment[]): number;
export function runScenario(an: Animator, segs: readonly ScenarioSegment[], opt: ScenarioOptions): ScenarioResult;
```

`AnimatorOutput.footPlant` is a **promise**: true only when the gait owns the leg (base authority > 0.98), the IK
residual is < 1 cm and no leg joint was clamped. The returned object is reused every frame (do not store it).

## 4. Integration patch (shared files — parent applies; anchors are TEXT, Engine.ts lines moved during my run)

### A. `src/graphics/Humanoid.ts`

A1 — apply the sign table (fixes the mirrored legs; also makes kneel / leg-drive curves render as authored) and
the two new leg rolls. Anchor: `pivot.rotation.set(joint.angle, 0, 0);` inside `update(sk, dt)`.

```ts
// imports
import { legacyLegGeometry, type LegGeometry, RIG_ROTATION_SIGN } from "../game/anim/Rig.ts";
const LEG_SIDES = [[0, "L"], [1, "R"]] as const; // module scope: no per-frame allocation

// update(sk, dt): replace the loop body line
        pivot.rotation.set(RIG_ROTATION_SIGN[name] * joint.angle, 0, 0);
// …then after the loop:
      for (const [i, side] of LEG_SIDES) {
        pivots.get(`hip${side}`)!.rotation.z = sk.legRoll.hip[i];     // abduction (order ZYX, set at build)
        pivots.get(`ankle${side}`)!.rotation.z = sk.legRoll.ankle[i]; // counter-roll (default order XYZ)
      }
```

A2 — at build time, right after the leg loop (`// Hips -> thighs -> knees -> …` block), give the hips Euler order
ZYX (abduction outermost, as `legFK3` / `solveLegInPelvis` assume) and expose the leg geometry:

```ts
  for (const s of ["L", "R"] as const) pivots.get(`hip${s}`)!.rotation.order = "ZYX";
  const legGeometry: LegGeometry = legacyLegGeometry({
    heightScale, spineY, thigh: P("thigh").height, shin: P("shin").height, footDrop,
    hipX: (sil.hip - (socketFor("thigh")?.seat ?? 0)) * weightScale,
  });
// HumanoidRig interface: add   legGeometry?: LegGeometry;
// return { group, triangleCount: triCount, legGeometry, …existing fields }
```

### B. `src/game/Skeleton.ts` — a "driven" mode (the Animator already smoothed everything)

The Skeleton's own `angle += (target − angle)·(1 − e^{−14dt})` easing must NOT run on Animator output: a 70 ms
lag moves a planted foot by ~18 cm at walking hip speeds. The skill clock, hit timing, kick spring, balance,
grip, face and stance transitions keep working.

```ts
import { JOINT_ORDER } from "./anim/Rig.ts"; // type-only cycle back to Skeleton: no runtime cycle

  // class fields
  #driven: Float64Array | null = null;
  /** Hip abduction / ankle counter-roll per leg [L, R], rad — written by drive(), read by the rig. */
  readonly legRoll = { hip: new Float64Array(2), ankle: new Float64Array(2) };
  /** Lane C: take these angles (JOINT_ORDER) as-is each update; null returns to pose easing. */
  drive(angles: Float64Array | null, hipRoll?: ArrayLike<number>, ankleRoll?: ArrayLike<number>): void {
    this.#driven = angles;
    if (hipRoll) { this.legRoll.hip[0] = hipRoll[0]; this.legRoll.hip[1] = hipRoll[1]; }
    if (ankleRoll) { this.legRoll.ankle[0] = ankleRoll[0]; this.legRoll.ankle[1] = ankleRoll[1]; }
  }
  isDriven(): boolean { return this.#driven !== null; }

  // update(dt): insert right after `this.face.update(dt);` (BEFORE the stance-transition block)
    if (this.#driven) {
      for (let i = 0; i < JOINT_ORDER.length; i++) {
        const name = JOINT_ORDER[i], j = this.#joints.get(name)!, b = this.#base.get(name)!;
        j.target = this.#driven[i];
        j.angle = clamp(j.target + (this.#kick.get(name)?.off ?? 0), b.min, b.max);
      }
    }
  // in `if (this.#skill) {` insert first:
      if (this.#driven) { // the Animator blends the curve; keep only the clock (consumeSkillHit, skillProgress)
        if (this.#skill.holdAt === null) this.#skill.t += dt / this.#skill.anim.duration;
        if (this.#skill.t >= 1) { this.#skill = null; this.pose = "idle"; }
        return;
      }
  // before `const k = 1 - Math.exp(-14 * dt);` insert:
    if (this.#driven) return;
```

### C. `src/engine/Engine.ts`

C1 — fields (next to `#rigs` / `#anim`):
```ts
  #animators = new Map<Fighter, Animator>();
  #animPrev = new Map<Fighter, { x: number; z: number; yaw: number }>();
  /** Ground under any (x, z): flat arena today; lane E's heightfield sampler plugs in here. */
  #groundHeight = (_x: number, _z: number): number => 0;
// imports: Animator (../game/anim/Animator.ts), limitTableFrom (../game/anim/Rig.ts),
//          legacyLegGeometryFor (../game/anim/LegacyGeometry.ts), wrapAngle (../core/MathCore.ts)
```

C2 — after `this.#rigs.set(f, rig);` (fighter build loop):
```ts
      const legs = rig.legGeometry ?? legacyLegGeometryFor(profiles[i].race, profiles[i].subrace, app.height, app.weight, app.silhouette);
      this.#animators.set(f, new Animator(legs, limitTableFrom(f.skeleton.limits())));
      this.#animPrev.delete(f);
```

C3 — `#updatePose(f, state, dt)`: replace the two lines
`const pose = PRIORITY.find(([cond]) => cond)?.[1] ?? "idle";` / `if (f.skeleton.pose !== pose) f.skeleton.setPose(pose);`
(keep the decay of state.hit/attack/block above and the face code below) with:
```ts
    const other = f === this.#player ? this.#opponent : this.#player;
    const yaw = Math.atan2(other.body.x - f.body.x, other.body.z - f.body.z); // same as the rig loop
    const prev = this.#animPrev.get(f) ?? { x: f.body.x, z: f.body.z, yaw };
    const h = Math.max(1e-4, dt), dx = f.body.x - prev.x, dz = f.body.z - prev.z;
    const speed = Math.hypot(dx, dz) / h; // from positions: the AI writes body.x/z directly, not vx/vz
    const bal = f.skeleton.balance.state().offset;
    const out = this.#animators.get(f)!.update(dt, {
      x: f.body.x, z: f.body.z, yaw, rootY: f.body.y, speed,
      moveDirLocal: speed > 1e-3 ? wrapAngle(Math.atan2(dx, dz) - yaw) : 0,
      turnRate: wrapAngle(yaw - prev.yaw) / h,
      grounded: f.body.y <= this.#groundHeight(f.body.x, f.body.z) + 0.62, // body centre 0.6 above the floor
      hit: state.hit > 0, attack: state.attack > 0, block: state.block > 0, ko: f.eliminated,
      engaged: this.#phase === "fight" && !this.#winner,
      skill: f.skeleton.skillAnimation(), skillProgress: f.skeleton.skillProgress() ?? 0,
      groundHeight: this.#groundHeight,
      externalRoll: Math.abs(bal) > 1e-4 ? bal * 0.6 : 0, // the balance tilt the rig loop adds
    });
    prev.x = f.body.x; prev.z = f.body.z; prev.yaw = yaw;
    this.#animPrev.set(f, prev);
    f.skeleton.pose = f.eliminated ? "ko" : state.hit > 0 ? "hit" : state.attack > 0 ? "attack" : speed > 0.2 ? "walk" : "idle"; // diagnostics only
    f.skeleton.drive(out.angles, out.hipRoll, out.ankleRoll);
```
(`f.skeleton.pose` is public; if a skill runs, `playSkill` already set it to "skill" — keep `if (!f.skeleton.skillHeld())` around that line.)

C4 — rig loop. Replace `f.skeleton.applyCoupledLimits(race);` with
`if (!f.skeleton.isDriven()) f.skeleton.applyCoupledLimits(race);` — measured in §6: for hip 0.3 / knee −0.5 the coupled
ankle window is **[−0.106, 0.106]** (PartHierarchy's knee/elbow use the opposite sign of the Skeleton, so a flexed
knee reads as "fully displaced"); it would tilt every planted sole. Then move `const other = f === p ? o : p;` above
the placement and replace `rig.group.position.set(f.body.x, f.body.y + hop, f.body.z);` and
`rig.group.rotation.z = balTilt * 0.6;` with:
```ts
      const ao = this.#animators.get(f)!.output;
      const yawNow = Math.atan2(other.body.x - f.body.x, other.body.z - f.body.z);
      rig.group.position.set(
        f.body.x + ao.rootOffsetLateral * Math.cos(yawNow), // roll pivots at the ground, not the body centre
        f.body.y + hop + ao.rootOffsetY,                    // ride height, bob, reach drop
        f.body.z - ao.rootOffsetLateral * Math.sin(yawNow));
      …
      rig.group.rotation.z = balTilt * 0.6 + ao.rootRoll;
```
C5 — round reset / teleport: `this.#animators.get(f)!.reset(f.body.x, f.body.z, yaw)` (the animator also auto-resets on
a > 1.5 m jump in one frame). `#poseGate` (DepthGuard) also sweeps `hip*` / `knee*` (thigh, shin) against the torso
capsule and can clamp them after `drive()`; with the A1 sign flip its leg sweep direction must be re-checked by the
parent (not verified by lane C). If it clamps a leg, that foot leaves the ground for that frame.

### D. Leg lengths the animator needs

- **Legacy `Humanoid`** exposes no lengths. Either patch A2 (`rig.legGeometry`, exact), or call
  `legacyLegGeometryFor(race, subrace, app.height, app.weight, app.silhouette)` — pure, reproduces buildHumanoid's
  equations (`footDrop = rootRadius(foot)·depth + 0.04`, `legDrop = 0.14 + 0.22 + thigh + shin + footDrop`,
  `heightScale = height/(legDrop + crownRise)`, `spineY = legDrop − 0.6/heightScale`). Human 1.75 m: thigh 0.362,
  shin 0.328, L = 0.690, sole 0.068, ball 0.152 m; `standingSoleDepth` = 0.6000 = BODY_RADIUS (checks out).
- **Lane A `SkinnedHumanoid`**: `legGeometryFromBones(plan.bones, soleOffset, groupScale)` — needs bind-pose heads of
  spine, abdomen, hipL, hipR, kneeL, ankleL, toeL and assumes joint angle 0 = bind pose. Lane A must apply the same
  `RIG_ROTATION_SIGN`, hip Euler order ZYX + `legRoll`; if its rig origin sits at the soles (contract: soles at
  y = 0), `standingSoleDepth` is 0 and the engine should place the group at ground height instead of body.y.
  Recommend a pelvis root bone so trunk lean does not tilt the hips (see issue 3).

## 5. Commands run (real output)

```
$ deno check src/game/anim/*.ts tests/anim_*_test.ts ; echo "check exit=$?"
check exit=0
$ deno test --allow-read tests/anim_gait_test.ts tests/anim_footik_test.ts tests/anim_blend_test.ts tests/anim_animator_test.ts
gaitShape derives stride = L(a + b·ŝ) with ŝ = v/sqrt(gL); cadence = v/stride; run blend rises with speed ... ok
phase advances by distance travelled / stride once the speed has settled ... ok
a planted foot never moves in the world while planted (latched), so it cannot skate ... ok
swing arc: lift reaches the derived apex and both ends are on the ground ... ok
pelvis bob has 2 periods per cycle and sway 1 (sign changes over one cycle) ... ok
standing still settles: the phase stops with both feet planted; turning on the spot re-plants ... ok
solveTwoBone hits reachable targets within 1 mm, knee bends forward only ... ok
solveTwoBone clamps reach to [|t-s|+ε, t+s-ε] and reports the pelvis drop for an unreachable target ... ok
smoothMin is exact outside its band and never above either input ... ok
solveLeg keeps the sole parallel to flat ground and on a 15° slope, ball within 1 mm ... ok
ankleFromBall: a level foot puts the ankle soleOffset above and ballForward behind the ball ... ok
solveLegInPelvis reaches a foot BESIDE the hip with abduction (3D FK within 1 mm) ... ok
sampleGround measures a 15° plane's pitch along the probe direction ... ok
layer weights crossfade through a critically damped spring (no snap, no overshoot) ... ok
masks and modes: override lerps only masked joints, additive adds offsets, result within limits ... ok
blending is frame-rate independent: 60 Hz and 144 Hz agree after 1 s ... ok
the angular speed limit bounds every per-frame step ... ok
walk -> run -> stop -> attack -> hit at game speeds: within limits, no pops, feet planted ... ok
player top speed 6.5 m/s + skills: bound holds, limiter engages on < 0.5% of joint-frames ... ok
skill curves never need the speed limiter (their peak rate is under the animator's bound) ... ok
feet reach the ground within 1 cm during stance on ±15° slopes and across a cross-fall ... ok
frame-rate independence: 60 Hz and 144 Hz give the same pose after 1 s ... ok
standing: knees flexed, root lowered, both soles planted; output object reused (no per-frame allocation) ... ok
a skill drives the upper body from its curve; a leg skill takes the legs (feet not claimed planted) ... ok
ok | 24 passed | 0 failed (153ms)
```
Not executed: `deno lint` (not in my allowed command list), `deno task check/test` (whole tree), any build or browser run.

## 6. Numeric report — `deno run --allow-read /Users/macmax/.hermes/cache/scratch/laneC/report.ts` (verbatim)

Drift = per-stance x/z slide of the loaded contact point(s) (ball and heel tracked separately while touching);
sole contact error = lowest sole point vs ground on frames reported planted; coverage = honest-planted / gait-planted.

```
legacy human 1.75 m / 75 kg: thigh=0.362 shin=0.328 L=0.690 sole=0.068 ball=0.152 m
derived joint-speed bound ω=23.56 rad/s -> 0.393 rad/frame @60Hz, 0.164 @144Hz
  shape v=0: ŝ=0.000 Fr=0.000 run=0.000 stride=0.511 duty=0.620 cadence=0.000Hz apex=0.034 bob=0.0092
  shape v=2.1: ŝ=0.807 Fr=0.652 run=1.000 stride=1.379 duty=0.380 cadence=1.523Hz apex=0.211 bob=-0.0076
  shape v=4.2: ŝ=1.614 Fr=2.606 run=1.000 stride=2.248 duty=0.267 cadence=1.868Hz apex=0.250 bob=-0.0191
  shape v=6.5: ŝ=2.499 Fr=6.243 run=1.000 stride=3.200 duty=0.188 cadence=2.032Hz apex=0.276 bob=-0.0290

MAIN sequence: idle 1.00s -> walk (AI step speed) 2.00s -> run (player top speed) 2.00s -> stop + guard 1.00s -> skill Reaver's Charge 0.95s -> skill Arcane Nova 1.20s -> basic attack 0.50s -> hit 0.35s -> block 1.00s -> idle 1.50s; accel 54.2 m/s²

== walk 2.1 -> run 4.2 (AI speed) -> stop -> attack -> hit (60 Hz, 471 frames)
  speed limiter engaged on 0 of 7536 joint-frames
  joint speed |Δθ|/dt [rad/s] n=7520 min=0.000 max=21.390 mean=1.453 median=0.213 p80=2.628
  max per-frame step: 0.3565 rad (kneeR) vs bound 0.3927 rad -> PASS
  limit violations: 0
  stance drift [cm] n=19 min=0.000 max=0.249 mean=0.035 median=0.000 p80=0.029
  planted sole contact error [cm] n=553 min=0.000 max=0.004 mean=0.000 median=0.000 p80=0.000
  pelvis drop [cm] n=471 min=0.000 max=13.798 mean=2.988 median=0.349 p80=6.270
  stance drift, ball only [cm] n=19 min=0.000 max=0.249 mean=0.034 median=0.000 p80=0.028
  plant coverage: 553/553 gait-planted foot-frames reported planted (100.0%)

== MAIN flat (60 Hz, 690 frames)
  speed limiter engaged on 7 of 11040 joint-frames
  joint speed |Δθ|/dt [rad/s] n=11024 min=0.000 max=23.562 mean=1.379 median=0.214 p80=2.196
  max per-frame step: 0.3927 rad (kneeL) vs bound 0.3927 rad -> PASS
  limit violations: 0
  stance drift [cm] n=26 min=0.000 max=0.423 mean=0.081 median=0.001 p80=0.240
  planted sole contact error [cm] n=809 min=0.000 max=0.082 mean=0.000 median=0.000 p80=0.000
  pelvis drop [cm] n=690 min=0.000 max=13.798 mean=2.589 median=0.285 p80=4.415
  stance drift, ball only [cm] n=26 min=0.000 max=0.423 mean=0.079 median=0.000 p80=0.231
  plant coverage: 741/744 gait-planted foot-frames reported planted (99.6%)

== MAIN flat (144 Hz, 1656 frames)
  speed limiter engaged on 12 of 26496 joint-frames
  joint speed |Δθ|/dt [rad/s] n=26480 min=0.000 max=23.562 mean=1.374 median=0.207 p80=2.155
  max per-frame step: 0.1636 rad (kneeL) vs bound 0.1636 rad -> PASS
  limit violations: 0
  stance drift [cm] n=27 min=0.000 max=0.502 mean=0.100 median=0.001 p80=0.237
  planted sole contact error [cm] n=1948 min=0.000 max=0.077 mean=0.000 median=0.000 p80=0.000
  pelvis drop [cm] n=1656 min=0.000 max=13.798 mean=2.574 median=0.217 p80=4.550
  stance drift, ball only [cm] n=27 min=0.000 max=0.502 mean=0.099 median=0.000 p80=0.231
  plant coverage: 1788/1795 gait-planted foot-frames reported planted (99.6%)

== frame-rate independence after 1 s (walk 1.4 m/s + attack layer at 0.4 s): max |θ60 - θ144| = 0.0102 rad (toeR)

== 15° UPHILL walk 2.1 m/s (60 Hz, 360 frames)
  speed limiter engaged on 0 of 5760 joint-frames
  joint speed |Δθ|/dt [rad/s] n=5744 min=0.000 max=16.879 mean=1.607 median=0.219 p80=3.248
  max per-frame step: 0.2813 rad (ankleR) vs bound 0.3927 rad -> PASS
  limit violations: 0
  stance drift [cm] n=20 min=0.000 max=0.316 mean=0.050 median=0.005 p80=0.064
  planted sole contact error [cm] n=388 min=0.000 max=0.082 mean=0.000 median=0.000 p80=0.000
  pelvis drop [cm] n=360 min=0.000 max=9.329 mean=0.367 median=0.000 p80=0.580
  stance drift, ball only [cm] n=20 min=0.000 max=0.109 mean=0.014 median=0.000 p80=0.007
  plant coverage: 388/388 gait-planted foot-frames reported planted (100.0%)

== 15° DOWNHILL walk 2.1 m/s (60 Hz, 360 frames)
  speed limiter engaged on 2 of 5760 joint-frames
  joint speed |Δθ|/dt [rad/s] n=5744 min=0.000 max=23.562 mean=1.540 median=0.202 p80=2.398
  max per-frame step: 0.3927 rad (kneeR) vs bound 0.3927 rad -> PASS
  limit violations: 0
  stance drift [cm] n=21 min=0.000 max=0.423 mean=0.072 median=0.002 p80=0.102
  planted sole contact error [cm] n=371 min=0.000 max=0.052 mean=0.000 median=0.000 p80=0.000
  pelvis drop [cm] n=360 min=0.000 max=13.798 mean=4.191 median=2.407 p80=9.453
  stance drift, ball only [cm] n=21 min=0.000 max=0.423 mean=0.060 median=0.000 p80=0.036
  plant coverage: 371/372 gait-planted foot-frames reported planted (99.7%)

== 15° SIDE slope (cross-fall) walk (60 Hz, 360 frames)
  speed limiter engaged on 0 of 5760 joint-frames
  joint speed |Δθ|/dt [rad/s] n=5744 min=0.000 max=19.038 mean=1.310 median=0.170 p80=2.584
  max per-frame step: 0.3173 rad (kneeR) vs bound 0.3927 rad -> PASS
  limit violations: 0
  stance drift [cm] n=17 min=0.000 max=0.242 mean=0.038 median=0.001 p80=0.025
  planted sole contact error [cm] n=379 min=0.000 max=0.064 mean=0.005 median=0.000 p80=0.001
  pelvis drop [cm] n=360 min=0.000 max=13.798 mean=4.299 median=4.112 p80=6.887
  stance drift, ball only [cm] n=17 min=0.000 max=0.240 mean=0.036 median=0.000 p80=0.024
  plant coverage: 379/379 gait-planted foot-frames reported planted (100.0%)

== STRAFE sideways 2.1 m/s (engaged) (60 Hz, 270 frames)
  speed limiter engaged on 0 of 4320 joint-frames
  joint speed |Δθ|/dt [rad/s] n=4304 min=0.000 max=14.930 mean=0.854 median=0.153 p80=1.424
  max per-frame step: 0.2488 rad (kneeR) vs bound 0.3927 rad -> PASS
  limit violations: 0
  stance drift [cm] n=14 min=0.000 max=1.955 mean=0.846 median=1.004 p80=1.100
  planted sole contact error [cm] n=259 min=0.000 max=0.247 mean=0.013 median=0.002 p80=0.022
  pelvis drop [cm] n=270 min=0.000 max=8.929 mean=2.235 median=0.537 p80=4.924
  stance drift, ball only [cm] n=14 min=0.000 max=1.955 mean=0.840 median=1.004 p80=1.100
  plant coverage: 259/278 gait-planted foot-frames reported planted (93.2%)

== turn in place 2 rad/s (60 Hz, 210 frames)
  speed limiter engaged on 0 of 3360 joint-frames
  joint speed |Δθ|/dt [rad/s] n=3344 min=0.000 max=6.615 mean=0.262 median=0.008 p80=0.121
  max per-frame step: 0.1102 rad (kneeR) vs bound 0.3927 rad -> PASS
  limit violations: 0
  stance drift [cm] n=11 min=0.000 max=14.531 mean=8.756 median=11.178 p80=11.856
  planted sole contact error [cm] n=306 min=0.000 max=0.002 mean=0.000 median=0.000 p80=0.000
  pelvis drop [cm] n=210 min=0.000 max=1.486 mean=0.319 median=0.041 p80=0.698
  stance drift, ball only [cm] n=11 min=0.000 max=0.045 mean=0.014 median=0.011 p80=0.018
  plant coverage: 306/306 gait-planted foot-frames reported planted (100.0%)

== walk BACKWARD 2.1 m/s (engaged) (60 Hz, 270 frames)
  speed limiter engaged on 0 of 4320 joint-frames
  joint speed |Δθ|/dt [rad/s] n=4304 min=0.000 max=21.014 mean=1.304 median=0.258 p80=2.401
  max per-frame step: 0.3502 rad (kneeL) vs bound 0.3927 rad -> PASS
  limit violations: 0
  stance drift [cm] n=14 min=0.000 max=0.273 mean=0.061 median=0.012 p80=0.099
  planted sole contact error [cm] n=272 min=0.000 max=0.128 mean=0.001 median=0.000 p80=0.000
  pelvis drop [cm] n=270 min=0.000 max=13.512 mean=2.441 median=0.618 p80=3.716
  stance drift, ball only [cm] n=14 min=0.000 max=0.273 mean=0.061 median=0.012 p80=0.099
  plant coverage: 272/273 gait-planted foot-frames reported planted (99.6%)

== ROBUSTNESS: speed STEPS (accel 1e4 m/s²) (60 Hz, 270 frames)
  speed limiter engaged on 2 of 4320 joint-frames
  joint speed |Δθ|/dt [rad/s] n=4304 min=0.000 max=23.562 mean=1.801 median=0.382 p80=3.055
  max per-frame step: 0.3927 rad (kneeR) vs bound 0.3927 rad -> PASS
  limit violations: 0
  stance drift [cm] n=13 min=0.000 max=0.302 mean=0.093 median=0.000 p80=0.211
  planted sole contact error [cm] n=293 min=0.000 max=0.004 mean=0.000 median=0.000 p80=0.000
  pelvis drop [cm] n=270 min=0.000 max=13.798 mean=3.092 median=0.000 p80=7.135
  stance drift, ball only [cm] n=13 min=0.000 max=0.286 mean=0.090 median=0.000 p80=0.204
  plant coverage: 293/294 gait-planted foot-frames reported planted (99.7%)

== coupled limits for hip 0.3, knee -0.5 (Skeleton sign): knee window [0.334, 1.966] (Skeleton knee range [-2.4, 0]), ankle window [-0.106, 0.106]
```

## 7. Open issues / not done / risks

1. **Leg sign mirror (§0)** — without patch A1 the animator's correct angles render mirrored. A1 changes how every
   existing leg animation looks (for the better, per their authors' intent); any existing test asserting raw pivot
   rotation for hips/knees would need updating. Not verified in the browser (no build/server allowed).
2. **Coupled limits** (`PartHierarchy`): knee `[0, 2.3]` / elbow `[0, 2.4]` vs Skeleton `[−2.4, 0]` / `[−2.6, 0]`.
   `applyCoupledLimits` mostly skips knees (lo > hi) but clamps ankles to ±0.106 rad when knees flex. Patch C4 skips
   it for driven skeletons; the sign mismatch itself is the parent's / lane H's to fix.
3. **Legacy hierarchy**: hips hang off spine → abdomen, so a trunk lean tilts the pelvis. The pelvis keeper
   counter-rotates the abdomen past 0.4 rad of pelvis pitch (chest keeps the skill's lean).
4. **Short legs**: L = 0.69 m for a 1.75 m human (39 % of height; anatomical ≈ 50 %). Player top speed 6.5 m/s is
   Fr 6.2 (elite-sprint regime): pelvis drop up to 13.8 cm, and the angular speed limiter engages on 7 / 11040
   joint-frames at 60 Hz (12 / 26496 at 144 Hz). At the AI's 4.2 m/s it never engages at 60 Hz.
5. **No foot yaw**: turning on the spot pivots each foot on its ball (ball slide ≤ 0.045 cm) while the heel sweeps
   (both-contact drift 14.5 cm). A third hip axis (yaw) would fix it. **Spine counter-twist is not implemented**:
   every Skeleton joint is pitch-only; it would need a yaw output like `hipRoll`.
6. **Strafing** relies on hip abduction (0.6 / 0.3 rad): drift ≤ 1.96 cm but honest-plant coverage is 93.2 %
   (forward gaits ≥ 99.6 %). Cross-fall: the ankle counter-roll only cancels the hip roll, the sole cannot bank to a
   lateral slope (lowest edge on the ground; error ≤ 0.064 cm measured).
7. One-frame lag: the animator reads `skillProgress()` before `Skeleton.update` advances it.
8. `Poses.ts` duplicates `defaultHumanoid`'s attack / hit / KO numbers; KO is clamped to the BASE limits.
9. New math helpers in my lane the parent may promote to MathCore: `smoothMin`, `smoothMax` (FootIK.ts), `frac` (Gait.ts).
10. `#poseGate` sweeps leg bones too (see C5): its effect on IK legs after the sign flip is unverified.
11. `src/engine/Engine.ts` shows as modified in git — not by lane C (I never wrote it); anchors above are text, not line numbers.
