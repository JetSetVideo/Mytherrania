# Lane W — Weapons (W06, W07) — handoff

Procedural weapons: 17 archetypes sampled along physical axes, a part-based mass model
(balance + moment of inertia), strike features in the contract frame, derived combat
profiles normalised to equal expected DPS, legacy adapters, and a cel-shaded mesh builder.
Nothing in `src/engine`, `Weapon.ts`, `WeaponGen.ts`, `WeaponMesh.ts`, `Menu.ts`, `Fighter.ts`
or `contracts.ts` was edited; the integration patches are below.

## Files created

| File | Role |
|---|---|
| `src/game/weapons/Archetypes.ts` | `ARCHETYPES` (all 17 `ArchetypeId`s): class, hands, damage mix, grips, axis ranges with historical references, hilt/haft/bow build data, rarity, legacy type |
| `src/game/weapons/Form.ts` | Geometry + mass model: tail/forward lengths, blade centreline (curved), part masses solved for the sampled balance, inertia, grip positions |
| `src/game/weapons/Features.ts` | `StrikeFeature[]` in weapon-local space (edges, points, heads, shafts) |
| `src/game/weapons/Generate.ts` | Sampling (correlated axes), names, `weaponFromSeed`, `weaponFromArchetype`, `rollWeapon`, `weaponForm(spec)`, grip-mode rotation |
| `src/game/weapons/Profile.ts` | `combatProfile` (derived numbers + per-weapon DPS normalisation), `profileTerms`, `rollStrike` |
| `src/game/weapons/Adapter.ts` | `toGeneratedWeapon` (WeaponPart list) and `toLegacyWeapon` (Weapon struct) |
| `src/game/weapons/Loadout.ts` | Menu options (`"" / "random" / archetypes`) and `resolveWeapon(className, choice, seed)` |
| `src/graphics/weapons/MeshKit.ts` | Triangle builder: tubes/rings/caps into one non-indexed geometry (normal, outlineNormal, aColor, aSpecular) |
| `src/graphics/weapons/WeaponMaterial.ts` | Cel material with vertex colour + vertex specular (shares `celLighting`), inverted-hull outline on welded normals |
| `src/graphics/weapons/WeaponParts.ts` | Part builders: bevelled blade (lens/fuller/single edge, curved), hilt, leaf head, axe bit (beard/crescent), flanged mace, chain + spiked ball, hammer + back spike, maul block, bow limbs |
| `src/graphics/weapons/WeaponModel.ts` | `buildWeaponModel(spec)` (2 draw calls), `buildWeaponGeometry`, `strikeFeatureLines` (QA debug) |
| `tests/weapons_generate_test.ts` | 10 tests |
| `tests/weapons_profile_test.ts` | 5 tests (prints the class statistics) |
| `tests/weapons_model_test.ts` | 5 tests (prints triangle counts) |

## Exports (exact signatures)

Contract producers (`src/combat/contracts.ts`):

```ts
// Archetypes.ts
export const ARCHETYPES: Record<ArchetypeId, ArchetypeSpec>;
// Generate.ts  (GeneratedSpec extends WeaponSpec with headRadius: number — see open issues)
export function rollWeapon(rng: () => number, opts: RollOptions = {}): GeneratedSpec;
export function weaponFromArchetype(id: ArchetypeId, rng: () => number, opts: RollOptions = {}): GeneratedSpec;
// Profile.ts  (optional 2nd arg; default = the weapon's preferred grip, e.g. "reverse" for daggers)
export function combatProfile(spec: WeaponSpec, grip: GripMode = preferredGrip(spec)): CombatProfile;
// Adapter.ts
export function toGeneratedWeapon(spec: WeaponSpec): GeneratedWeapon;
export function toLegacyWeapon(spec: WeaponSpec): Weapon;
```

Other exports:

```ts
// Archetypes.ts
export interface AxisRange { min: number; max: number }
export type WeaponFamily = "blade" | "polearm" | "hafted" | "flail" | "staff" | "bow";
export type HeadStyle = "blade" | "leaf" | "halberd" | "scythe" | "axe" | "flanged" | "ball" | "hammer" | "block" | "ferrule" | "limbs";
export interface GripTemplate { id: GripPoint["id"]; modes: GripMode[] }
export interface ArchetypeAxes { length; mass; headLength; sharpness; curvature; headRadius; balanceFraction: AxisRange }
export interface HiltBuild / HaftBuild / RangedBuild / ArchetypeSpec
export const ARCHETYPE_IDS: readonly ArchetypeId[];
export function archetypesOfClass(weaponClass: WeaponClass): ArchetypeId[];
export const CLASS_ARCHETYPE: Record<ClassName, ArchetypeId>;
export function isArchetypeId(v: unknown): v is ArchetypeId;
export function rosterAxisSpan(axis: keyof ArchetypeAxes): AxisRange;

// Generate.ts
export interface RollOptions { classes?: WeaponClass[]; archetypes?: ArchetypeId[]; metal?: MetalName; seed?: number; size?: number }
export interface GeneratedSpec extends WeaponSpec { headRadius: number }
export interface SampledAxes { axes: PhysicalAxes; metal: MetalName; fitting: MetalName; ranged?: {...} }
export function weaponFromSeed(id: ArchetypeId, seed: number, opts: RollOptions = {}): GeneratedSpec;
export function sampleAxes(id: ArchetypeId, rng: () => number, opts: RollOptions = {}): SampledAxes;
export function candidateArchetypes(opts: RollOptions = {}): ArchetypeId[];
export function weaponName(id: ArchetypeId, axes: PhysicalAxes, metal: MetalName, details: FormDetails): string;
export function drawSeed(rng: () => number): number;
export function axesOfSpec(spec: WeaponSpec): PhysicalAxes;
export function weaponForm(spec: WeaponSpec): WeaponForm;
export function preferredGrip(spec: WeaponSpec): GripMode;
export function gripModeRotation(mode: GripMode): V3;          // Euler XYZ rad for the weapon node
export const FORM_SALT, SIZE_TO_MASS, SIZE_TO_HEAD, METAL_TO_SHARPNESS, SIZE_OPTION_PULL,
  METAL_EDGE_QUALITY, METAL_RARITY, BOW_EFFICIENCY, ARROW_MASS_PER_NEWTON, BOW_AIM_TIME, DRAW_SPEED, DRAW_FORCE_REF;

// Form.ts
export interface PhysicalAxes { length; mass; headLength; sharpness; curvature; headRadius; balanceFraction: number }
export interface MassPart { name: string; mass: number; y: number; z: number; k2: number }
export interface FormDetails { wood: WoodName; wrap: string; guardHalfSpan: number; shaftRadius: number; flangeCount: number }
export interface WeaponForm { ...positions, sizes, parts, balance, inertia }
export function tailLength(id: ArchetypeId, axes: PhysicalAxes): number;
export function forwardLength(id: ArchetypeId, axes: PhysicalAxes): number;
export function bladeAngleAt(form: WeaponForm, s: number): number;
export function bladePointAt(form: WeaponForm, s: number, out: V3): V3;
export function bladeEdgeNormalAt(form: WeaponForm, s: number, out: V3): V3;
export function bladeTangentAt(form: WeaponForm, s: number, out: V3): V3;
export function bladeHalfWidthAt(form: WeaponForm, s: number): number;
export function bowLimbPoint(half: number, brace: number, recurve: number, sign: 1 | -1, t: number): V3;
export function formDetails(id: ArchetypeId, axes: PhysicalAxes, rng: () => number): FormDetails;
export function buildForm(id: ArchetypeId, axes: PhysicalAxes, details: FormDetails): WeaponForm;
export function resolveGrips(id: ArchetypeId, form: WeaponForm): GripPoint[];
export const HAND_HALF_WIDTH, BUTT_MARGIN, MIN_TWO_HAND_TAIL, POLE_HAND_SPREAD, STEEL_DENSITY, WOOD_DENSITY,
  GRIP_LINEAR_DENSITY, BLADE_TAPER, BLADE_SECTION_FILL, POINT_FRACTION, TIP_WIDTH_RATIO, HEAD_TOP_MARGIN,
  CHAIN_LINEAR_DENSITY, BOW_RISER_SHARE, SCYTHE_START_ANGLE, SCYTHE_MAX_BEND, BOW_RISER_HALF, BOW_RECURVE_FLIP,
  WOODS, GRIP_WRAPS; export type WoodName;

// Features.ts
export function strikeFeatures(id: ArchetypeId, axes: PhysicalAxes, form: WeaponForm): StrikeFeature[];
export function hammerSpike(headRadius: number, curvature: number): { length: number; droop: number };
export function halberdBlade(forward: number, headLength: number): { height: number; centreY: number };
export function halberdFluke(forward: number, headLength: number, headRadius: number, shaftRadius: number): { base: V3; tip: V3 };
export function axePollRadius(bitHeight: number): number;
export const EDGE_CAPSULE, POINT_CAPSULE, CURVED_EDGE_POINTS, BACK_EDGE_KEENNESS, FALSE_EDGE_SHARE, FALSE_EDGE_KEENNESS, MAUL_BLOCK_RATIO;

// Profile.ts
export interface ProfileTerms { grip; mix; handsUsed; pivotInertia; omega; swingTime; thrustTime; strikeTime;
  momentum; strikeMass; contactRadius; precision; quickness; demand; finesse; spread; scale }
export function profileTerms(spec: WeaponSpec, grip: GripMode = preferredGrip(spec)): ProfileTerms;
export function expectedDps(p: Pick<CombatProfile, "minDamage" | "maxDamage" | "critChance" | "critMultiplier" | "accuracy" | "cooldown">): number;
export interface StrikeRoll { outcome: "miss" | "hit" | "critical"; multiplier: number }
export function strikeFromRolls(p: CombatProfile, accuracyRoll: number, critRoll: number, damageRoll: number): StrikeRoll;
export function rollStrike(p: CombatProfile, rng: () => number): StrikeRoll;
export const TARGET_DPS = 1, BASELINE_INTERVAL = 1.0, ARM_PIVOT, ARM_INERTIA, SWING_WORK_ONE_HAND, SWING_WORK_TWO_HANDS,
  OMEGA_MAX, SWING_ARC, THRUST_FORCE_ONE_HAND, THRUST_FORCE_TWO_HANDS, THRUST_DISTANCE, ARM_MASS, REACTION_TIME,
  RECOVERY_RATIO, MOMENTUM_REF, ARM_REACH_ONE_HAND, ARM_REACH_TWO_HANDS, FLIGHT_WINDOW, REVERSE_*, CRIT_*, ACCURACY_*,
  SPREAD_*, ARMOUR_PIERCE_MAX, PRESSURE_LOW, PRESSURE_HIGH, RANGED_SPEED_LOW, RANGED_SPEED_HIGH, CONTACT_REF;

// Adapter.ts
export function legacyTypeOf(spec: WeaponSpec): WeaponType;
export function legacyWeight(mass: number): number;             // log scale over the roster mass span
export function legacyBalance(spec: WeaponSpec): number;
export function legacyParts(spec: WeaponSpec): WeaponPart[];
export function legacyReach(spec: WeaponSpec, profileReach: number): number;
export const SHOULDER_OFFSET = 0.18, LEGACY_RANGED_REACH = 2.8, LEGACY_DAMAGE_PER_UNIT = 10, LEGACY_CURVE_SEGMENTS = 4;

// Loadout.ts
export const RANDOM_WEAPON = "random";
export const LEGACY_TO_ARCHETYPE: Record<WeaponType, ArchetypeId>;
export const CLASS_TRADEOFF: Record<WeaponClass, string>;
export interface WeaponMenuOption { value: string; label: string; hint: string }
export function weaponMenuOptions(): WeaponMenuOption[];
export function archetypeOfChoice(className: ClassName, choice: string | undefined): ArchetypeId | null;
export function resolveWeapon(className: ClassName, choice: string | undefined, seed: number): GeneratedSpec;

// graphics/weapons/WeaponModel.ts
export const WEAPON_TRIANGLE_BUDGET = 600;
export interface WeaponModel { group; surface; outline; geometry; triangleCount; drawCalls; setEffect(strength, time): void; dispose(): void }
export interface WeaponModelOptions { element?: Element; outlineWidth?: number }
export function buildWeaponModel(spec: WeaponSpec, opts: WeaponModelOptions = {}): WeaponModel;
export function buildWeaponGeometry(spec: WeaponSpec): { geometry: THREE.BufferGeometry; triangleCount: number };
export function weaponKit(spec: WeaponSpec): MeshKit;
export function weaponPalette(spec: WeaponSpec): WeaponPalette;
export function strikeFeatureLines(spec: WeaponSpec): THREE.Group;       // QA: THREE.Line per feature
export const FEATURE_LINE_COLORS: Record<StrikeFeature["kind"], string>;
// graphics/weapons/WeaponMaterial.ts
export function createWeaponCelMaterial(): THREE.ShaderMaterial;
export function createWeaponOutlineMaterial(width = WEAPON_OUTLINE_WIDTH): THREE.ShaderMaterial;
export const INK_COLOR = "#172128", WEAPON_OUTLINE_WIDTH = 0.02;
// graphics/weapons/MeshKit.ts: class MeshKit, interface Ring, interface TubeOptions
// graphics/weapons/WeaponParts.ts: rod, knob, wrap, haft, blade, hilt, leafHead, axeBit, blockZ, spike,
//   flangedHead, chain, spikedBall, hammerHead, maulBlock, bowLimb, interface WeaponPalette
```

## How the numbers are made (summary — full equations in each file header)

* **Axes** (Archetypes.ts): length, mass, headLength, sharpness, curvature, headRadius,
  balanceFraction, each a range per archetype with cited references (arming/long sword
  1.05–1.28 m 1.1–1.7 kg, gladius, sabre 1796 LC, rapier, Zweihänder 2–3.2 kg, dory/spear,
  Swiss halberd, Viking/Dane axe, Gothic flanged mace, horseman's hammer 0.6–1.0 m 1–2 kg
  with an 18–30 mm face, maul 3–5 kg, quarterstaff, war scythe, war bow 1.8–2.0 m drawn
  0.71–0.76 m at 356–667 N).
* **Sampling** (Generate.ts): one size latent drives length (100%), mass (70%), head length
  (60%); head radius follows mass; metal density shifts mass, metal edge quality shifts
  sharpness; curvature only where the range allows (sabre, dagger, axe, greataxe, halberd,
  scythe, warhammer beak, bow recurve). Blades then fit the hilt (handle stays in range).
* **Mass model** (Form.ts): parts (grip/haft from density, guard share, blade as a tapered
  rod, head/ball/pommel/butt lumps); the fore/aft split is SOLVED so the centre of mass hits
  the sampled balance; inertia `I = Σ m k²`. Blade thickness is derived back from the solved
  blade mass. The mesh re-derives the same form from the spec (round-trip tested).
* **Grips**: main at y = 0; off a palm+ behind for 1.5/2-handed; choke up the haft for
  polearms/greataxe/maul/staff. Daggers offer `["reverse", "forward"]` (reverse first): the
  ice-pick grip turns the strongest arm motion — the downward hammer-fist drive — into a thrust
  along the blade, with the pommel locked against the thumb. `combatProfile(spec, "reverse")`
  gives more thrust share, crit, impact and armour pierce at a shorter reach (tested on 200
  daggers: reverse beats forward on all three every time).
* **Profile** (Profile.ts): swing speed from work vs pivot inertia
  (`ω = min(24, √(2W/(I + 2rMb + Mr² + I_arm)))`), thrust time from force and mass,
  cooldown = reaction + 2 × strike time, impact = momentum at the centre of percussion /
  9 kg·m/s, crit from precision (sharpness × point/edge share) and quickness, accuracy from
  alignment demand (point > edge > blunt), striking mass, contact radius and lever length,
  spread from a finesse index, armour pierce from point keenness and head pressure. Then ONE
  scale per weapon: `k = cooldown / ((1 + cc(cm − 1)) · accuracy)`, `min = k(1 − w)`,
  `max = k(1 + w)`, so `mean × critFactor × accuracy / cooldown = 1` for every weapon.

## Statistics (real output)

`deno test --allow-read tests/weapons_profile_test.ts` — relativeDps recomputed from the
profile fields (not trusting the field) over 2,000 random weapons:

```
relativeDps over 2000 weapons: min 0.9998 max 1.0002 mean 1.0000 median 1.0000
```

Per class, 2,000 weapons each (`rollWeapon(rng, { classes: [c] })`), min / max / mean / median:

| class | minDamage | maxDamage | critChance | critMultiplier | accuracy | cooldown (s) | reach (m) | impact | armourPierce |
|---|---|---|---|---|---|---|---|---|---|
| finesse | 0.210 / 0.591 / 0.366 / 0.380 | 0.784 / 1.460 / 1.018 / 1.034 | 0.208 / 0.337 / 0.281 / 0.278 | 1.896 / 2.334 / 2.110 / 2.098 | 0.700 / 0.758 / 0.730 / 0.739 | 0.510 / 0.932 / 0.661 / 0.664 | 0.670 / 2.000 / 1.316 / 1.410 | 0.661 / 1.851 / 1.093 / 0.964 | 0.116 / 0.508 / 0.330 / 0.299 |
| balanced | 0.591 / 1.552 / 1.015 / 1.020 | 1.209 / 2.891 / 1.755 / 1.500 | 0.041 / 0.227 / 0.135 / 0.138 | 1.250 / 2.102 / 1.679 / 1.802 | 0.755 / 0.818 / 0.791 / 0.797 | 0.812 / 1.993 / 1.212 / 1.041 | 1.428 / 2.763 / 1.932 / 1.735 | 1.099 / 2.544 / 1.913 / 2.040 | 0.000 / 0.178 / 0.091 / 0.123 |
| heavy | 0.623 / 2.026 / 1.107 / 1.051 | 1.298 / 2.578 / 1.799 / 1.748 | 0.030 / 0.164 / 0.077 / 0.071 | 1.250 / 1.777 / 1.443 / 1.345 | 0.795 / 0.948 / 0.855 / 0.842 | 0.839 / 2.188 / 1.298 / 1.234 | 1.053 / 1.899 / 1.358 / 1.303 | 0.978 / 3.312 / 1.665 / 1.414 | 0.000 / 0.404 / 0.068 / 0.018 |
| ranged | 0.516 / 0.917 / 0.687 / 0.684 | 1.850 / 2.439 / 2.115 / 2.113 | 0.257 / 0.329 / 0.296 / 0.296 | 1.976 / 2.318 / 2.162 / 2.161 | 0.713 / 0.775 / 0.753 / 0.753 | 1.182 / 1.651 / 1.418 / 1.420 | 11.919 / 17.080 / 14.939 / 14.899 | 0.212 / 0.600 / 0.375 / 0.372 | 0.379 / 0.557 / 0.476 / 0.475 |

relativeDps is 1.000 / 1.000 / 1.000 / 1.000 (3 decimals) in every class. The test asserts, on
mean AND median: finesse critChance > heavy, finesse critMultiplier > heavy, finesse minDamage <
heavy, finesse maxDamage < heavy, finesse accuracy < heavy; and the stronger percentile checks
finesse critChance p20 > heavy p80, finesse accuracy p80 < heavy p20, finesse minDamage p80 <
heavy p20, finesse relative spread > heavy. A Monte Carlo of 200k `rollStrike`s each (dagger,
longsword, halberd, maul, bow) lands within 2% of DPS 1 with the predicted miss and crit rates.

Per archetype, mean of 500 weapons (`weaponFromSeed(id, s·7919)`, scratch probe, same code):

| archetype | min | max | crit | critMul | acc | cooldown | reach | impact | pierce | I (kg·m²) | ω (rad/s) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dagger (reverse) | 0.237 | 0.816 | 0.315 | 2.219 | 0.717 | 0.522 | 0.690 | 0.823 | 0.455 | 0.005 | 21.4 |
| shortsword | 0.381 | 1.073 | 0.267 | 2.044 | 0.741 | 0.689 | 1.215 | 0.852 | 0.278 | 0.054 | 14.7 |
| sabre | 0.477 | 1.315 | 0.242 | 2.040 | 0.751 | 0.842 | 1.458 | 0.988 | 0.129 | 0.127 | 12.7 |
| rapier | 0.310 | 0.950 | 0.312 | 2.237 | 0.712 | 0.622 | 1.707 | 0.946 | 0.466 | 0.119 | 13.0 |
| longsword | 0.436 | 1.079 | 0.254 | 1.990 | 0.747 | 0.708 | 1.436 | 1.383 | 0.223 | 0.196 | 14.5 |
| greatsword | 0.722 | 1.346 | 0.194 | 1.881 | 0.778 | 0.942 | 1.674 | 2.040 | 0.156 | 0.686 | 9.6 |
| spear | 0.377 | 0.937 | 0.299 | 2.171 | 0.703 | 0.624 | 1.793 | 1.583 | 0.444 | 1.309 | 8.9 |
| halberd | 1.257 | 2.162 | 0.132 | 1.775 | 0.800 | 1.508 | 2.288 | 2.280 | 0.133 | 4.127 | 5.0 |
| scythe | 1.192 | 2.358 | 0.172 | 1.981 | 0.767 | 1.593 | 2.406 | 2.081 | 0.071 | 3.580 | 5.5 |
| staff | 0.954 | 1.411 | 0.066 | 1.250 | 0.807 | 0.970 | 1.575 | 1.379 | 0.007 | 0.724 | 11.3 |
| axe | 0.836 | 1.715 | 0.124 | 1.669 | 0.832 | 1.149 | 1.217 | 1.286 | 0.000 | 0.314 | 9.6 |
| greataxe | 1.290 | 2.199 | 0.117 | 1.696 | 0.839 | 1.582 | 1.711 | 2.230 | 0.000 | 2.173 | 6.3 |
| mace | 1.058 | 1.636 | 0.041 | 1.263 | 0.877 | 1.195 | 1.187 | 1.397 | 0.025 | 0.342 | 9.1 |
| flail | 1.201 | 1.803 | 0.038 | 1.278 | 0.864 | 1.312 | 1.477 | 1.445 | 0.039 | 0.844 | 7.2 |
| warhammer | 0.928 | 1.515 | 0.080 | 1.358 | 0.807 | 1.014 | 1.288 | 1.278 | 0.307 | 0.471 | 8.6 |
| maul | 1.679 | 2.137 | 0.030 | 1.250 | 0.941 | 1.809 | 1.453 | 2.952 | 0.103 | 2.702 | 5.4 |
| bow | 0.686 | 2.118 | 0.297 | 2.164 | 0.753 | 1.420 | 14.913 | 0.378 | 0.477 | 0.129 | 19.4 |

## Triangles per archetype (real output, 60 seeds each, budget 600, 2 draw calls)

`deno test --allow-read tests/weapons_model_test.ts`:

| archetype | min tris | max tris |
|---|---|---|
| dagger | 124 | 124 |
| shortsword | 100 | 100 |
| sabre | 112 | 112 |
| rapier | 88 | 88 |
| longsword | 100 | 100 |
| greatsword | 100 | 100 |
| spear | 104 | 104 |
| halberd | 140 | 140 |
| scythe | 134 | 134 |
| staff | 100 | 100 |
| axe | 122 | 122 |
| greataxe | 146 | 146 |
| mace | 154 | 190 |
| flail | 188 | 296 |
| warhammer | 96 | 108 |
| maul | 120 | 120 |
| bow | 94 | 94 |

Every weapon: one non-indexed geometry shared by a cel surface mesh and an outline mesh
(`drawCalls === 2`; the optional elemental shell adds its own). Merged manually (MeshKit), not
with `mergeGeometries` (which does resolve under the import map — Humanoid.ts uses it — but
one builder gives exact tri counts and consistent attributes). Visual check: a headless
software-rasterised contact sheet (side, 3/4 and 70° views) was inspected; all 17 read as
their family, no holes or detached parts; the guard was fixed to span z (the blade width) and
verified numerically (guard z ±0.044–0.198 m, blade x ±0.002 m).

## Integration (shared files — exact patches for the parent)

### 1. `src/game/Fighter.ts` — carry the spec + profile (conservative: only explicit choices)

`tests/fighter_test.ts:9` asserts the Barbarian default is named `"Greataxe"`, so this patch
keeps class defaults on the legacy path. (Option B below switches everyone.)

Anchor `import { weaponForClass, buildWeaponByName, type Weapon } from "./Weapon.ts";` — add after it:

```ts
import type { CombatProfile, WeaponSpec } from "../combat/contracts.ts";
import { nameSeed } from "./RaceAppearance.ts";
import { resolveWeapon } from "./weapons/Loadout.ts";
import { toLegacyWeapon } from "./weapons/Adapter.ts";
import { combatProfile } from "./weapons/Profile.ts";
```

In `export interface Fighter`, after `  weapon: Weapon;` add:

```ts
  /** Generated weapon (W06) and its derived combat numbers (W07); absent on the legacy path. */
  weaponSpec?: WeaponSpec;
  weaponProfile?: CombatProfile;
```

Replace the signature + weapon line of `createFighter`:

```ts
export function createFighter(className: ClassName, name: string, x: number, z: number, radius: number, race?: string, subrace?: string | null, weaponType?: string, birthsign?: string | null, weaponSeed?: number): Fighter {
  ...
  // W06: an explicit choice ("random", an archetype, a legacy type) gets a generated weapon.
  const weaponSpec = weaponType ? resolveWeapon(className, weaponType, weaponSeed ?? nameSeed(name)) : undefined;
  const weapon = weaponSpec ? toLegacyWeapon(weaponSpec) : weaponForClass(className);
  return {
    name, className, stats, weapon, weaponSpec,
    weaponProfile: weaponSpec ? combatProfile(weaponSpec) : undefined,
    ...rest unchanged
```

(`buildWeaponByName` is then unused in Fighter.ts — drop it from the import for `noUnusedLocals`.)
Option B (everyone on generated weapons): `const weaponSpec = resolveWeapon(className, weaponType, weaponSeed ?? nameSeed(name));`
and update `tests/fighter_test.ts:9` to `assert(f.weaponSpec?.archetype === "greataxe")`; re-run the balance/arena tests (reach and knockback change).
For "random" to re-roll each match, pass a match seed as `weaponSeed` at `Engine.ts:843` (`createFighter(..., player.weaponType, player.birthsign, matchSeed)`).

### 2. `src/engine/Engine.ts` `#spawnMeshes` (line ~749) and `src/graphics/Portrait.ts:35`

```ts
// before
const weaponGen = generateClassWeapon(f.className);
// after (legacy mesh + FX keep working: WeaponPart list from the spec)
const weaponGen = f.weaponSpec ? toGeneratedWeapon(f.weaponSpec) : generateClassWeapon(f.className);
```
with `import { toGeneratedWeapon } from "../game/weapons/Adapter.ts";` (Portrait: `fighter.weaponSpec`).

To show the new cel model instead of the part boxes, `SkinnedHumanoid.ts` (lane A) ~line 195:
```ts
// before
const weaponMesh = buildWeaponMesh(weapon, element);
// after (options gains `weaponSpec?: WeaponSpec`; WeaponModel has the same group/triangleCount/setEffect)
const weaponMesh = options.weaponSpec ? buildWeaponModel(options.weaponSpec, { element }) : buildWeaponMesh(weapon, element);
if (options.weaponSpec) weaponMesh.group.rotation.set(...gripModeRotation(preferredGrip(options.weaponSpec)));
```
The rotation sits on `weaponNode` itself, so lane X's features (weapon-local) rotate with it.

### 3. `Engine.ts` `#swingCooldown` — the weapon's tempo

Import for patches 3 and 4: `import { BASELINE_INTERVAL, rollStrike } from "../game/weapons/Profile.ts";`

```ts
// before
return interval / Math.max(0.2, (st ? attackMultiplier(st) : 1) * focus);
// after: Profile is normalised to BASELINE_INTERVAL = 1 s (Stats baseline attackInterval)
const tempo = f.weaponProfile ? f.weaponProfile.cooldown / BASELINE_INTERVAL : 1;
return (interval * tempo) / Math.max(0.2, (st ? attackMultiplier(st) : 1) * focus);
```

### 4. `Engine.ts` `#resolveHit` — weapon-shaped damage (keeps class balance)

```ts
// before
const base = attackDamage(attacker.stats, dStats, Math.random(), Math.random());
// after
let base: number;
const prof = attacker.weaponProfile;
if (prof) {
  const strike = rollStrike(prof, Math.random);           // accuracy -> crit -> damage in [min, max]
  if (strike.outcome === "miss") return;                   // or log "miss"/hand to lane X as a graze
  // Class crit and armour as today, class spread neutral (0.5): the weapon now owns the spread.
  const classHit = attackDamage(attacker.stats, dStats, Math.random(), 0.5);
  const armourDiv = 1 + dStats.armor * 0.04;
  base = classHit * strike.multiplier * armourDiv / (1 + dStats.armor * 0.04 * (1 - prof.armourPierce));
} else base = attackDamage(attacker.stats, dStats, Math.random(), Math.random());
```
With patch 3, expected DPS per class is unchanged (E[multiplier] = cooldown); only the shape
(floor, crit, misses) and armour pierce differ. Knockback already follows: `toLegacyWeapon`
maps `weapon.knockback = profile.impact` (Fighter.ts:53 uses it).

### 5. `src/ui/Menu.ts` weapon table (lane U/G owns Menu.ts) — list archetypes + Random

```ts
// before
<tbody>${(["", "axe", "sword", "dagger", "staff", "scythe", "bow", "mace"] as const).map(w => `
  <tr class="pick-row" data-weapon="${w}" data-selected="${(w || undefined) === this.#player.weaponType || (w === "" && !this.#player.weaponType)}">
    <td class="pick-name">${w === "" ? "Class default" : w[0].toUpperCase() + w.slice(1)}</td>
  </tr>`).join("")}
// after (import { weaponMenuOptions } from "../game/weapons/Loadout.ts")
<tbody>${weaponMenuOptions().map(o => `
  <tr class="pick-row" data-weapon="${o.value}" data-selected="${(o.value || undefined) === this.#player.weaponType || (o.value === "" && !this.#player.weaponType)}">
    <td class="pick-name">${o.label}</td>
    <td class="pick-hint">${o.hint}</td>
  </tr>`).join("")}
```
`pickRow("weapon-table", ...)` and the highlight loop need no change (values are strings).
Saved profiles holding `"sword"` etc. still resolve (`LEGACY_TO_ARCHETYPE`).

### Optional
* `contracts.ts`: add `headRadius?: number` to `WeaponSpec` (generated specs already carry it;
  hand-built specs fall back to the archetype mid-range).
* `CelShader.ts`: a `vertexColors` option on `createCelMesh` would let WeaponMaterial reuse
  the factory instead of mirroring its GLSL (the bands/rim/spec constants are copied verbatim
  and share the `celLighting` uniform objects).

## Commands run (real output)

```
$ deno check src/game/weapons/*.ts src/graphics/weapons/*.ts tests/weapons_*_test.ts
(only "Check <file>" lines for the 14 files; no diagnostics)
$ deno lint src/game/weapons/ src/graphics/weapons/ tests/weapons_generate_test.ts tests/weapons_profile_test.ts tests/weapons_model_test.ts
Checked 13 files
$ deno test --allow-read tests/weapons_generate_test.ts tests/weapons_profile_test.ts tests/weapons_model_test.ts
ok | 20 passed | 0 failed (609ms)
```
Mutation checks (each applied, test run, reverted): dagger grips forward-first, DPS scale
removed, crit equation inverted, leaf apex moved 5 cm, axe edge pulled 4 cm in, face winding
flipped — all six make the suite fail. (Bending blades 3× or moving the halberd fluke is NOT
caught by the on-mesh test, by design: features and mesh share the same helper.)

## Not done / not verified

* Not run in the browser; the whole-tree `deno task check` / `deno task test` not run (other lanes
  are writing). No integration patch applied.
* Frame: the new model and the adapter's parts put the EDGE on +z (contract); the legacy boxes had
  blade width on x. The rig mount (`grip.rotation.x = -0.35`) was tuned for the legacy mesh, so the
  edge-forward look in the rig is unverified — check one swing visually after patch 2.
* The bow in `toGeneratedWeapon` keeps the legacy x-sway layout (WeaponPart cannot rotate about x);
  the new model and the features use the contract frame (limbs in yz, string at −z).
* No arrow projectile exists; the bow's profile reach (12–17 m) is capped to 2.8 m in the legacy struct.
* Animations do not yet use `grips` (off-hand IK) or the reverse-grip pose (lane C).

## Risks / open issues

* Normalisation assumes a miss deals 0. If lane X turns failed accuracy rolls into grazes worth
  g × the per-hit mean, the per-swing expectation becomes mean × (acc × CF + (1 − acc) × g), so the
  scale must become k = cooldown / (acc × CF + (1 − acc) × g) (CF = 1 + cc(cm − 1)). Simplest: keep
  grazes at 0 damage.
* Armour pierce is a bonus outside the normalisation (vs armour 4, pierce 0.6 ≈ +9% DPS).
* The class crit (Stats) stacks with the weapon crit in patch 4; the class expected crit is already
  divided out of attackPower in Stats.ts, so class balance holds, but a high-reflex dagger crits a lot.
* Flail inertia treats the chain as taut (ball at full extension) — fine mid-swing, wrong at rest.
* Heavy cooldowns reach 2.2 s (maul) vs 0.5 s (dagger); with patch 3 that is the real tempo gap.
  If it feels sluggish, lower `RECOVERY_RATIO` — DPS stays 1 because k re-solves.
* Outline width 0.02 m (bodies 0.035) so a 25–60 mm blade is not drowned in ink; tune live.
