# Lane X — collision, hitboxes, impact physics, self-clearance (W05, W08, W09)

Owner files only (`src/combat/**` except `contracts.ts`, `tests/combat_*`). No shared file was
edited. **One contract addition** (optional fields, needed for the lever arm of the impulse):
`Contact.local?: V3` (contact point in WEAPON LOCAL coordinates) and `Contact.featureIndex?: number`
in `src/combat/contracts.ts`. `sweepStrike` fills both; `resolveImpact` falls back to the feature
centroid when they are absent.

## Files

| File | What |
|---|---|
| `src/combat/Geom.ts` | allocation-free kernel: segment–segment / point–triangle / segment–triangle closest points, pose decompose + slerp interpolation of 4×4 matrices, 3×3 symmetric eigen (PCA), Welzl minimum enclosing circle |
| `src/combat/Hitboxes.ts` | `hitboxesFromPlan` (capsules fitted to the SDF anatomy), `updateHitboxes`, helpers |
| `src/combat/Sweep.ts` | `sweepStrike`: continuous swept collision of edges/shafts (swept quads) and points/heads (swept spheres) |
| `src/combat/Impact.ts` | `resolveImpact`: physical impulse, hit angle, lever arm, 1H/2H, defender mass/zone/armour/guard/footing, damage by kind and location |
| `src/combat/SelfGuard.ts` | `selfPenetration`, `selfClearance` (signed), `solveSelfClearance` (minimal weighted joint correction) |
| `src/combat/RigAdapter.ts` | THREE side: `boneWorldOf`, `weaponMatrix`, `ArmGuard` (drives shoulder/elbow/grip of the real rig for the solver) |
| `src/combat/StrikeTracker.ts` | per-fighter prev/curr weapon matrix, swing ids, one hit per swing per target, strike windows |
| `tests/combat_fixtures.ts` | contract-frame WeaponSpec fixtures (longsword, greatsword, dagger w/ reverse grip, war hammer, spear) + profiles (not a test file) |
| `tests/combat_hitboxes_test.ts`, `combat_sweep_test.ts`, `combat_impact_test.ts`, `combat_selfguard_test.ts`, `combat_tracker_test.ts` | 22 tests |
| scratch `/Users/macmax/.hermes/cache/scratch/laneX/hitrate.ts` (+ `hitrate.md/json/log`), `selfguard_qa.ts` (+ `selfguard-*.json`), `probe_*.ts` | QA harnesses (not in the repo) |

## Exports (exact signatures)

```ts
// Hitboxes.ts
export const TISSUE_DENSITY = 1010, VOXEL_PER_CELL = 0.5, VOXEL_MIN = 0.006, VOXEL_MAX = 0.015, COVER_QUANTILE = 0.985,
  SPLIT_RATIO = 1.1, SPLIT_GAIN = 0.88, MAX_CAPSULES_PER_GROUP = 8, VOLUME_PER_CAPSULE = 0.0025, SKIN_INSET = 0.006,
  THICKNESS_CAP = 1.2, UNCOVERED_WEIGHT = 2, FIT_SAMPLE = 500, SPLIT_QUANTILES = [1/3, 1/2, 2/3], AIR_STRIDE = 2,
  AIR_STRIDE_CELLS = 3000, EXTRA_CAPSULES = 2, REPAIR_SHARE = 0.08, REPAIR_MIN_VOXELS = 12, REPAIR_CAPSULES = 2,
  MIN_SPLIT_VOXELS = 60, CONTACT_SLACK = 0.01;
export const DEBUG: { on: boolean };
export const lastFitTiming: { voxelMs; bandMs; bandCells; fitMs; capsules; voxels; step };
export interface HitboxFitOptions { mass?: number; step?: number; fullField?: boolean }
export function zoneOf(bone: BoneId, region: Region): { zone: HitZone; side: "L" | "R" | "C" } | null;
export function positivePrimitives(node: SdfNode, out?: Primitive[]): Primitive[];
export function bindRoll(plan: AnatomyPlan, bone: BoneId): number;
export function bindBoneMatrix(plan: AnatomyPlan, bone: BoneId): Float64Array;
export function bulgeBand(plan: AnatomyPlan): number;
export function hitboxesFromPlan(plan: AnatomyPlan, opts?: HitboxFitOptions): HitboxSet;     // contract
export function cloneHitboxSet(set: HitboxSet, mass?: number): HitboxSet;
export function updateHitboxes(set: HitboxSet, boneWorld: (bone: string) => Float32Array | number[]): void; // contract
export function capsuleVolume(set: HitboxSet): number;
export function hitboxDistance(box: Hitbox, x: number, y: number, z: number): number;

// Sweep.ts
export const MAX_SUBSTEP_ANGLE = 0.05, MAX_SUBSTEP_TRAVEL = 0.03, MAX_SUBSTEPS = 64, REFINE_SAMPLES = 8, FALLBACK_DT = 1/60, TIE_WINDOW = 1e-3;
export interface SweepOptions { exclude?: (box: Hitbox) => boolean; slack?: number }
export function sweepStrike(prev: StrikeSample, curr: StrikeSample, target: HitboxSet, weapon: WeaponSpec, opts?: SweepOptions): Contact | null; // contract (+opts)

// Impact.ts
export const ARM_MASS_FRACTION = 0.05, ARM_COUPLING = 0.5, TWO_HAND_TRUNK_SHARE = 0.04, STRENGTH_REF = 5.5,
  STRENGTH_FACTOR_RANGE = [0.6, 1.5], WRIST_LOCK = { 1: 0.15, 2: 1 }, ARM_LEVER = 0.6, OFF_HAND_SPACING = 0.12,
  JOINT_COUPLING = 0.5, RESTITUTION_FLESH = 0.05, RESTITUTION_ARMOUR = 0.3, TRANSFER = { cut: 0.6, thrust: 0.8, blunt: 1 },
  FRICTION = 0.35, BLOCK_BRACE = 0.45, GROUND_SHARE = 0.5, STAGGER_DV0 = 0.25, STAGGER_PER_DV = 0.55, STAGGER_MAX = 1.2,
  V_NOMINAL = 10, BLUNT_EFF_RANGE = [0.45, 1.45], CUT_ALIGN_MIN = [0.5, 0.3], CUT_ALIGN_FULL = 0.85,
  THRUST_ALIGN_MIN = 0.55, THRUST_ALIGN_FULL = 0.93, BITE_SPEED = 4, CUT_PIERCE_SHARE = 0.5, THRUST_PIERCE_BONUS = 0.4,
  BLUNT_TRANSMIT = 0.55, GRAZE_EFF = 0.35, ACCURACY_FLOOR = 0.75, VITAL_GAIN = 1.5;
export const SEGMENT_MASS_SHARE, ZONE_EFFECTIVE_SHARE, ZONE_EXPOSURE, ZONE_VITALITY, ZONE_DAMAGE: Record<HitZone, number>;
export function handMass(attackerMass: number, strength: number): number;
export function effectiveWeaponMass(weapon: WeaponSpec, yContact: number, handsUsed: 1 | 2, attackerMass: number, strength: number, across?: number): number;
export function targetEffectiveMass(zone: HitZone, mass: number): number;
export function resolveImpact(input: ImpactInput): ImpactResult;                               // contract

// SelfGuard.ts
export const SELF_MARGIN = 0.005, SELF_MAX_ITERATIONS = 6, SELF_FD_STEP = 0.01, SELF_MAX_STEP = 0.6;
export const SELF_JOINT_WEIGHT: Record<string, number>; // gripPitch 1, gripRoll 1.5, elbow 2, shoulder 4
export interface SelfOptions { gripSide?: "L" | "R"; handsUsed?: 1 | 2; margin?: number }
export function gripExcluded(box: Hitbox, weapon: WeaponSpec, opts?: SelfOptions): boolean;
export function selfClearance(strike: StrikeSample, own: HitboxSet, weapon: WeaponSpec, opts?: SelfOptions): number; // signed, m
export function selfPenetration(strike: StrikeSample, own: HitboxSet, weapon: WeaponSpec, opts?: SelfOptions): SelfPenetration; // contract (+opts)
export interface ClearanceJoint { name: string; angle: number; min: number; max: number; weight: number }
export interface ClearanceProblem { joints: ClearanceJoint[]; penetration(angles: Float64Array): number; margin?: number; maxIterations?: number; step?: number }
export interface ClearanceResult { angles: Float64Array; deltas: Float64Array; before: number; after: number; iterations: number; evaluations: number }
export function solveSelfClearance(p: ClearanceProblem): ClearanceResult;

// RigAdapter.ts (THREE)
export type CombatRig = HumanoidRig & SkinnedExtras;
export const GRIP_PITCH_RANGE: [number, number] = [-2.4, 1.2], GRIP_ROLL_RANGE: [number, number] = [-1.8, 1.8];
export function boneWorldOf(rig: CombatRig): (bone: string) => Float32Array | number[];
export function weaponMatrix(rig: CombatRig, out?: Float32Array): Float32Array;
export interface ArmGuardOptions extends SelfOptions { joints?: string[]; writeBack?: boolean }
export class ArmGuard {
  constructor(rig: CombatRig, own: HitboxSet, weapon: WeaponSpec, opts?: ArmGuardOptions);
  last: ClearanceResult | null; worst: string;
  apply(angles: ArrayLike<number>): void; measure(): number; joints(sk: Skeleton): ClearanceJoint[];
  solve(sk: Skeleton): ClearanceResult;
}

// StrikeTracker.ts
export const WINDOW_LEAD = 0.35, ATTACK_HOLD = 0.25, ATTACK_LEAD = 0.1, ATTACK_TRAIL = 0.3;
export interface StrikeWindow { start: number; end: number }
export function skillStrikeWindow(anim: { hitAt: number }): StrikeWindow;   // normalised progress
export function attackStrikeWindow(): StrikeWindow;                          // seconds since the press
export class StrikeTracker {
  readonly prev: StrikeSample; readonly curr: StrikeSample; swingId: number; handsUsed: 1 | 2; active: boolean;
  beginSwing(handsUsed?: 1 | 2): number; endSwing(): void; updateWindow(progress: number | null, window: StrikeWindow): void;
  sample(matrix: ArrayLike<number>, time: number): void; reset(): void; canStrike(id: number): boolean;
  markStruck(id: number): void; struck(id: number): boolean;
  sweep(id: number, target: HitboxSet, weapon: WeaponSpec, opts?: SweepOptions): Contact | null;
}
```

## How it works (one paragraph each)

**Hitboxes (W09).** The body's positive SDF volumes are voxelised (step ½ cell); a thin band outside
them is tested against the real skin field (smooth-union bulges, sculpt strokes). Each voxel belongs
to the primitive it is deepest in → (zone, side, bone). Each part is fitted by capsules minimising
*air enclosed + 2 × body left out*, with the radius capped at the part's half-thickness (√(5·λ_min)),
recursive splits, and a repair pass. Capsules are stored in the bone's bind frame, so
`updateHitboxes` is 6 multiply-adds per endpoint. Zones: head, neck, chest, abdomen, pelvis,
upperArm/foreArm/hand/thigh/shin/foot ×L/R (+x is the character's left).

**Sweep (W05).** Prev/curr weapon matrices → rigid poses (lerp grip + slerp orientation; blade
points move on arcs). Sub-steps from the rotation (≤ 0.05 rad) and travel (≤ 3 cm). Edges/shafts:
the quad each segment sweeps is tested as two triangles against each capsule axis, so a blade that
crosses a forearm between two instants still hits; points/heads: swept sphere. Earliest contact wins
(ties: point > edge > head > shaft); velocity by central difference; `edgeAlignment = |cos(facing, v)|`
(heads: the striking face), `thrustAlignment = max(0, cos(axis, v))` (signed: a point only pierces
moving forward — stricter than the contract's |cos|).

**Impact (W08/W09).** `v_n` from the relative velocity; effective weapon mass at the contact's lever
arm from the weapon + arm masses as one rigid body (`1/m = 1/M + s⊥²d²/I_cm`), two hands lock the haft
to both forearms (`WRIST_LOCK`) and add trunk mass; effective target mass = segment masses discounted
0.5 per joint (Winter 2009); `J_n = (1+e)·μ·v_n·transfer`, Coulomb friction for the tangential part,
then guard/footing. Damage = attackPower × roll × crit × `ZONE_DAMAGE` × Σ mix·efficiency·armour.
`ZONE_DAMAGE` = (1 + 1.5·vitality) normalised so the rule-of-nines surface mean is exactly 1:
head 1.69, neck 1.54, chest 1.28, abdomen 1.13, pelvis 0.98, thigh 0.88, upperArm 0.83, shin/foreArm
0.78, hand/foot 0.73. `profile.impact` is NOT used (the impulse already comes from mass/inertia);
`defender.blocking` reduces knockback only — the engine keeps its own ×0.4 block on damage.

**Self-clearance (W05).** Signed penetration of every feature into every own capsule except the
gripping hand+forearm (both when two-handed). Solver: Gauss–Newton on one constraint,
`Δθ = −(g + margin)·W⁻¹∇g / ∇gᵀW⁻¹∇g`, central differences, limits, line search, ≤ 6 iterations;
DOFs shoulderR (weight 4), elbowR (2), grip pitch (1) and roll (1.5) — the wrist moves first.
Self-contact never reaches `#resolveHit` (only the OTHER fighter's hitboxes are swept).

## Measured results (real command output)

### Hitboxes (`tests/combat_hitboxes_test.ts`, real `buildSkinnedHumanoid` bodies)

| Body | capsules | fit time | skin vertices within r + 1 cm (bind) | attack pose (skinned) | air overshoot |
|---|---|---|---|---|---|
| human 1.70 m / 72 kg | 50 | 226 ms (voxel 33 + band 73 + fit 119) | **98.98 %** (worst 3.1 cm) | 99.03 % | **21.6 %** |
| ork 1.95 m / 120 kg | 57 | 322 ms (voxel 44 + band 112 + fit 166) | **95.94 %** (worst 3.6 cm) | 96.04 % | **15.5 %** |

Coverage meets ≥ 95 %. **Overshoot misses the brief's < 15 %** (15.5–21.6 %): the fitter sits on a
coverage/overshoot frontier — `SKIN_INSET` 8 mm gives human 18.8 % / 98.8 %, ork 13.4 % / 94.8 %,
dwarf 14.6 % / 93.5 %, i.e. coverage then fails. The test guards < 25 % and reports the number.
Most remaining air is at the trunk's flanks (chest 3–5 L, pelvis 2 L): capsules cannot follow an
elliptical cross-section without more pieces. Note the SDF ork's volume is 242 L (245 kg at
tissue density) for a 120 kg spec — the engine must pass the real mass (`opts.mass`).

### Sweep / impact (`combat_sweep_test.ts`, `combat_impact_test.ts`)

- 30 m/s tip swing (ω 31.8 rad/s) crossing a 4 cm forearm entirely between two 1/60 s instants: hit
  at t ≈ 0.5, speed ω·r ± 12 %, edge alignment > 0.95. Parallel pass 10 cm off: null.
- Edge-leading alignment 1.000, flat-leading 0.000. Reverse-grip dagger stab: `point`, thrust 1.0.
- War hammer square chest blow at 12 m/s: **1H 16.1 N·s, 2H 36.5 N·s** (m_w,eff 1.7 → 4.4 kg).
  80° glance: **3.0 N·s** vs 16.1 square, slides along the swing.
- 2H hammer on 60 kg: Δv 0.59 m/s, stagger 0.18 s; on 130 kg: Δv 0.29 m/s, stagger 0.02 s.
- Armour 0.6 keeps **85 % of an aligned stab, 52 % of a clean cut**.
- Miss rate (4000 rolls): finesse 18.3 %, heavy 7.0 %, finesse with a poorly aligned edge 31.4 %.
- `ZONE_EFFECTIVE_SHARE` (mass an impulse meets): pelvis/chest/abdomen ≈ 0.41, thigh 0.30, neck 0.24,
  upperArm 0.24, shin 0.19, head 0.17, foreArm 0.13, foot 0.11, hand 0.07.

### Self-penetration before → after the solver (`combat_selfguard_test.ts`, real rig + Skeleton)

Attack pose + all 24 skill curves via `Skeleton.playSkill`, 60 Hz, grip as the engine sets it:

| Weapon (contract frame) | frames | penetrating frames | max before | max after | worst solve |
|---|---|---|---|---|---|
| longsword | 1214 | 61 | 0.71 cm (upperArmR) | **0.00 cm** | 1.70 ms |
| greatsword | 1214 | 61 | 0.61 cm (upperArmR) | **0.00 cm** | 0.40 ms |
| war hammer | 1214 | 100 | 1.92 cm (upperArmR, thighR) | **0.00 cm** | 0.22 ms |

Average solve 0.02–0.3 ms/frame (1–10 evaluations; clear frames cost one measure). With the
proposed forward grip (pitch +1.6) the swords never penetrate (0/1214 frames). **Finding:** with
contract-frame blades the rig's own clipping is small; the clipping visible in today's build comes
from (a) the legacy `WeaponMesh` putting blade WIDTH along local x (sword 8.5 cm, axe head 42 cm, mace
26 cm — straight into the arm/torso; the contract puts edges on ±z) and (b) the grip: at rest the
blade stands up alongside the upper arm, and in the attack pose (shoulderR −1.7) it points DOWN and
BACK (axis (−0.18, −0.56, −0.81), tip behind the hips) — the blade never sweeps forward.

### Hit rate per distance — NEW geometric system vs OLD distance rule

Harness `scratch/laneX/hitrate.ts`: human (Warrior, longsword fixture on `weaponNode`) attacks an ork
(guarding) D m away, driven exactly like `Engine.#updatePose` (Animator → drive → rig.update →
setGrip → placement, lunge as `#skillTick`); 25 swings per distance (plain attack + 24 skills);
old rule = `dist ≤ reach 1.76 + radius 0.5` at the resolve instant. Run time 3.1 s.

| D (m) | old rule | new · engine grip · strike window | new · engine grip · whole anim | new · forward grip | new · forward grip + aim yaw | + 0.6 m step-in on the plain attack |
|---|---|---|---|---|---|---|
| 0.8 | 25/25 (100 %) | 22/25 (88 %) | 22/25 (88 %) | 19/25 (76 %) | 23/25 (92 %) | 23/25 (92 %) |
| 1.0 | 24/25 (96 %) | 21/25 (84 %) | 21/25 (84 %) | 19/25 (76 %) | 19/25 (76 %) | 20/25 (80 %) |
| 1.2 | 24/25 (96 %) | 17/25 (68 %) | 18/25 (72 %) | 18/25 (72 %) | 20/25 (80 %) | 21/25 (84 %) |
| 1.5 | 24/25 (96 %) | 15/25 (60 %) | 15/25 (60 %) | 13/25 (52 %) | 13/25 (52 %) | 13/25 (52 %) |
| 1.8 | 24/25 (96 %) | 12/25 (48 %) | 12/25 (48 %) | 11/25 (44 %) | 12/25 (48 %) | 12/25 (48 %) |
| 2.0 | 23/25 (92 %) | 12/25 (48 %) | 12/25 (48 %) | 11/25 (44 %) | 12/25 (48 %) | 12/25 (48 %) |
| 2.5 | 13/25 (52 %) | 9/25 (36 %) | 9/25 (36 %) | 8/25 (32 %) | 8/25 (32 %) | 8/25 (32 %) |
| 3.0 | 8/25 (32 %) | 7/25 (28 %) | 7/25 (28 %) | 7/25 (28 %) | 7/25 (28 %) | 7/25 (28 %) |

By swing kind (engine grip, strike window): **plain attack hits only at 0.8 m** (0 from 1.0 m; with a
0.6 m step-in up to 1.2 m); dash skills 7/8 at every D ≤ 2.5 (the lunge closes in); power skills 8/8
up to 1.5 m, 5/8 at 2.0, 2/8 at 2.5; defensive skills (braces) 6/8 at 0.8 → 0/8 from 1.5 m (the old
rule lets them deal damage at 2 m). The strike window loses nothing vs the whole animation. Zones
hit (engine grip): thigh 42, abdomen 17, hand 16, chest 10, foreArm 10, upperArm 9, head 6,
pelvis 5 — the blade sweeps low and behind; with the forward grip: chest 52, head 10–19. Contact
speed median ≈ 10 m/s. Edge alignment at contact: median 0.84 with the engine grip, 0.35 with the
forward grip (pitching the hand 1.6 rad turns the contract's +z edge away from the swing plane).

**The danger, quantified:** with geometry, the plain attack — the most frequent action — lands only
when bodies touch (≤ 0.8 m centre to centre), while the AI and the "in reach" ring use
`reach + radius ≈ 2.26 m`. Integrating the geometric gate as-is would make most plain attacks whiff.
Fixes, in order of effect (measured where possible):
1. **Engage at the geometric reach**: AI/attack range = shoulder-to-tip reach ≈ arm 0.6 + weapon
   length, i.e. 1.0–1.2 m for this sword (harness: ≥ 68 % at 1.2 m for skills, plain attack needs ≤ 0.8 m today).
2. **Plain-attack curve that reaches forward**: today's `ATTACK_POSE` raises the arm to −1.7 rad
   (near vertical) and the blade swings over/behind; a strike that ends with the shoulder at
   −1.2…−1.4 rad (horizontal), elbow straight, plus a step-in (0.6 m measured: plain attack reaches
   1.2 m) — lane C owns the curve.
3. **Aim yaw** (turn the trunk so the weapon arm's sagittal plane passes through the target,
   sin ψ = 0.27 / D): +4–12 points at 0.8–1.2 m, nothing beyond (reach-limited, not aim-limited).
4. **Grip**: the forward grip removes self-clipping and moves hits to the chest/head but lowers edge
   alignment; a grip that keeps the contract +z edge in the swing plane needs lane W's mesh + lane C.

## Engine.ts integration patch (parent applies; anchors are current lines)

**1. Imports** — after `import { Animator } from "../game/anim/Animator.ts";`
```ts
import { hitboxesFromPlan, updateHitboxes } from "../combat/Hitboxes.ts";
import { resolveImpact as resolveStrike } from "../combat/Impact.ts";   // Physics.resolveImpact keeps its name
import { ArmGuard, boneWorldOf, weaponMatrix } from "../combat/RigAdapter.ts";
import { attackStrikeWindow, skillStrikeWindow, StrikeTracker } from "../combat/StrikeTracker.ts";
import type { CombatProfile, Contact, HitboxSet, WeaponSpec } from "../combat/contracts.ts";
/** Stats.armor (2..6.5) → share of a cut the armour stops (0.2..0.65). */
const ARMOUR_SCALE = 10;
/** Physical Δv of a blow is 0.2–0.6 m/s; ×6 lands in the old knockbackPower·3 band (1.2–3.6 m/s). */
const KNOCKBACK_GAIN = 6;
```
**2. Fields** — after `  #animators = new Map<Fighter, Animator>();`
```ts
  /** Lane X: capsule hitboxes, strike tracker, self-clearance guard and weapon per fighter. */
  #hitboxes = new Map<Fighter, HitboxSet>();
  #strikes = new Map<Fighter, StrikeTracker>();
  #armGuards = new Map<Fighter, ArmGuard>();
  #weaponSpec = new Map<Fighter, { spec: WeaponSpec; profile: CombatProfile }>();
  /** Seconds since the plain attack was pressed (null: none), and the skill a swing carries. */
  #attackClock = new Map<Fighter, number | null>();
  #swingSkill = new Map<Fighter, Skill | null>();
  #weaponScratch = new Float32Array(16);
```
**3. Spawn** — after `      this.#animators.set(f, new Animator(legGeometryFromBones(rig.plan.bones, ankleY, 1), limitTableFrom(f.skeleton.limits())));`
```ts
      {
        const spec = weaponSpecFor(f);        // lane W: the fighter's WeaponSpec (drawn on rig.weaponNode)
        const profile = combatProfile(spec);  // lane W: src/game/weapons/Profile.ts
        const boxes = hitboxesFromPlan(rig.plan, { mass: this.#bodyOf(f).parts.reduce((s, q) => s + q.mass, 0) });
        this.#hitboxes.set(f, boxes);
        this.#strikes.set(f, new StrikeTracker());
        this.#armGuards.set(f, new ArmGuard(rig, boxes, spec));
        this.#weaponSpec.set(f, { spec, profile });
        this.#attackClock.set(f, null);
        this.#swingSkill.set(f, null);
      }
```
**4. Player attack** — in `#playerAttack`, replace `    this.#resolveHit(f, this.#opponent);` with
`    this.#beginSwing(f); // resolves in #strikeTick when the blade crosses the target`.

**5. AI attack** — in the `attack: () => {` callback, replace `        this.#resolveHit(o, p);` with `        this.#beginSwing(o);`.

**6. Skill start** — in `#useSkill`, after `    f.skeleton.playSkill(skill.animation);` add `    this.#beginSwing(f, skill);`.

**7. Skill hit frame** — in `#skillTick`, replace the six lines from `      const before = other.hp;` to
`      this.#fx.impact(f, this.#skyTime, skill.kind === "power" ? other.body : undefined);` with
```ts
      if (!this.#strikes.has(f)) { // no tracker (legacy path): the old hit-frame resolution
        const before = other.hp;
        this.#resolveHit(f, other, skill);
        const dealt = Math.max(0, before - Math.max(0, other.hp));
        this.#skillFx.set(f, effectStrength(anim, t, dealt / other.stats.maxHealth));
        this.#skillFired.set(f, true);
        this.#fx.impact(f, this.#skyTime, skill.kind === "power" ? other.body : undefined);
      }
```
(the defensive cleanse above it stays).

**8. New methods** — insert before the doc comment `   * Resolve one strike. A plain attack passes no skill; a skill adds its damage`
```ts
  /** Lane X: a swing starts (press, AI, skill): arm the tracker; the hit resolves in #strikeTick. */
  #beginSwing(f: Fighter, skill?: Skill): void {
    const tracker = this.#strikes.get(f);
    if (!tracker) { if (!skill) this.#resolveHit(f, f === this.#player ? this.#opponent : this.#player); return; }
    tracker.beginSwing(this.#weaponSpec.get(f)?.spec.hands === 2 ? 2 : 1);
    this.#swingSkill.set(f, skill ?? null);
    this.#attackClock.set(f, skill ? null : 0);
  }

  /**
   * Lane X, per fighter AFTER both rigs are posed and placed: keep the blade out of its holder
   * (ArmGuard: minimal shoulder/elbow/wrist correction), then sweep the blade's motion since last
   * frame against the OTHER fighter's capsules inside the swing's strike window.
   */
  #strikeTick(f: Fighter, rig: HumanoidRig & SkinnedExtras, dt: number): void {
    const tracker = this.#strikes.get(f), guard = this.#armGuards.get(f), weapon = this.#weaponSpec.get(f);
    if (!tracker || !guard || !weapon) return;
    guard.solve(f.skeleton); // refreshes matrices and f's own hitboxes
    const other = f === this.#player ? this.#opponent : this.#player;
    const otherRig = this.#rigs.get(other), otherBoxes = this.#hitboxes.get(other);
    if (otherRig && otherBoxes) { otherRig.group.updateMatrixWorld(true); updateHitboxes(otherBoxes, boneWorldOf(otherRig)); }
    tracker.sample(weaponMatrix(rig, this.#weaponScratch), this.#elapsed);
    const anim = f.skeleton.skillAnimation(), clock = this.#attackClock.get(f) ?? null;
    if (anim) tracker.updateWindow(f.skeleton.skillProgress(), skillStrikeWindow(anim));
    else if (clock !== null) {
      tracker.updateWindow(clock, attackStrikeWindow());
      this.#attackClock.set(f, clock + dt > attackStrikeWindow().end ? null : clock + dt);
    } else tracker.updateWindow(null, attackStrikeWindow());
    if (!otherBoxes || f.eliminated || other.eliminated) return;
    const contact = tracker.sweep(this.#idOf(other), otherBoxes, weapon.spec);
    if (!contact) return;
    const skill = this.#swingSkill.get(f) ?? undefined, before = other.hp;
    this.#resolveHit(f, other, skill, contact);
    if (skill && anim) {
      const dealt = Math.max(0, before - Math.max(0, other.hp));
      this.#skillFx.set(f, effectStrength(anim, Math.min(1, f.skeleton.skillProgress() ?? 1), dealt / other.stats.maxHealth));
      this.#skillFired.set(f, true);
      this.#fx.impact(f, this.#skyTime, skill.kind === "power" ? other.body : undefined);
    }
  }
```
**9. Call it** — after the rig loop `for (const [f, rig] of this.#rigs) {` closes, i.e. between
`        aura.visible = !f.eliminated;\n      }\n    }` and `    // Hit flash: briefly tint the background toward the defender's damage`:
```ts
    // Lane X: both rigs are posed and placed — guard each blade, then sweep it against the other body.
    if (this.#phase === "fight" && !this.#winner) for (const [f, rig] of this.#rigs) this.#strikeTick(f, rig, dt);
```
**10. `#resolveHit`** — signature `#resolveHit(attacker: Fighter, defender: Fighter, skill?: Skill, contact?: Contact)`;
replace `    if (dist > attacker.weapon.reach + defender.body.radius) return;\n    const blocking = this.#anim.get(defender)!.block > 0;` with
```ts
    if (!contact && dist > attacker.weapon.reach + defender.body.radius) return; // legacy gate without a contact
    const blocking = this.#anim.get(defender)!.block > 0;
    const wpn = this.#weaponSpec.get(attacker), dRt0 = this.#skills.get(defender);
    const dStats0 = dRt0 ? effectiveStats(defender.stats, dRt0) : defender.stats;
    const va = this.#velocity.get(attacker), vd = this.#velocity.get(defender);
    const imp = contact && wpn ? resolveStrike({
      contact, weapon: wpn.spec, profile: wpn.profile, handsUsed: this.#strikes.get(attacker)?.handsUsed ?? 1,
      attacker: { mass: this.#bodyOf(attacker).parts.reduce((s, q) => s + q.mass, 0), strength: attacker.stats.strength ?? 5.5,
        attackPower: attacker.stats.attackPower, velocity: [va?.x ?? 0, 0, va?.z ?? 0] },
      defender: { mass: this.#bodyOf(defender).parts.reduce((s, q) => s + q.mass, 0), armour: Math.min(0.65, (dStats0.armor ?? 0) / ARMOUR_SCALE),
        blocking, balance: 1 - Math.min(1, Math.abs(defender.skeleton.balance.state().offset) / 0.3), velocity: [vd?.x ?? 0, 0, vd?.z ?? 0] },
      rng: Math.random,
    }) : null;
    if (imp?.outcome === "miss") return; // deflected/dodged: the swing is spent, no damage, no push
```
then `const base = attackDamage(...)` → `const base = imp ? imp.damage : attackDamage(attacker.stats, dStats, Math.random(), Math.random());`,
`const physicsMul = physicsMultiplier(aBody, dBody, vClose);` → `const physicsMul = imp ? 1 : physicsMultiplier(aBody, dBody, vClose);`,
and `    impact(defender.body, dx, dz, knockbackPower(attacker, defender) * 3 * (pay?.knockbackMul ?? 1));` →
```ts
    if (imp) {
      const mD0 = dBody.parts.reduce((s, q) => s + q.mass, 0), jH = Math.hypot(imp.knockback[0], imp.knockback[2]);
      impact(defender.body, imp.knockback[0], imp.knockback[2], jH / mD0 * KNOCKBACK_GAIN * (1 + defender.damagePercent / 60) * (pay?.knockbackMul ?? 1));
      defender.stun = Math.max(defender.stun, imp.stagger);
    } else impact(defender.body, dx, dz, knockbackPower(attacker, defender) * 3 * (pay?.knockbackMul ?? 1));
```
and `const J = resolveImpact({ attacker: aBody, defender: dBody, attackerSpeed: swing }).impulse;` →
`const J = imp ? Math.hypot(...imp.knockback) * KNOCKBACK_GAIN : resolveImpact({ attacker: aBody, defender: dBody, attackerSpeed: swing }).impulse;`.
The ×0.4 block on damage, statuses, buffs, telemetry, log and minimap ping stay unchanged.

## Commands run (project root)

- `deno check src/combat/*.ts tests/combat_*.ts` → all `Check …` lines, no errors.
- `deno lint src/combat/ tests/combat_*.ts` → `Checked 14 files`.
- `deno test --allow-read --allow-write=/Users/macmax/.hermes/cache/scratch tests/combat_hitboxes_test.ts tests/combat_sweep_test.ts tests/combat_impact_test.ts tests/combat_selfguard_test.ts tests/combat_tracker_test.ts` → `ok | 22 passed | 0 failed (7s)`.
- `deno run --config deno.json --allow-read --allow-write=<scratch> scratch/laneX/hitrate.ts` → table above (3.1 s).
- `scratch/laneX/selfguard_qa.ts engine|forward|sideways` → engine/forward rows above.

## Not done / risks

- **Air overshoot 15.5–21.6 % vs the < 15 % target** (coverage target met). Fit costs 0.2–0.35 s per
  new body at load (cached per plan object); budget it with the body build (~0.3 s).
- **Plain attack reach** (above): geometric gating without a forward-reaching curve + geometric AI
  range makes plain attacks whiff beyond 0.8 m. Lane C (curve) and the AI range must change with it.
- WeaponSpec frame vs today's mesh: `WeaponMesh` draws blade width along x; the contract (and my
  fixtures) put edges on ±z. Until lane W's mesh lands, the drawn sword and the collision blade
  differ by a 90° roll about the blade axis.
- `Contact.thrustAlignment` is signed (max(0, cos)), stricter than the contract's |cos|.
- Hitbox radius ignores a scaled rig group (bodies are built at size; the engine does not scale them).
- `ArmGuard` uses shoulder/elbow pitch + grip pitch/roll only (the Skeleton has single-axis joints);
  a clearance needing shoulder abduction or trunk yaw is out of its reach (never needed in the runs).
- Not run in the browser; no engine patch applied; integration untested end-to-end.
