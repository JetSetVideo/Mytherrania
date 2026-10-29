# Lane R — walls (V02), ring-out = elimination (V03), articulated ragdoll of the real body (V03)

Base: `a7fc002`. Nothing committed. `src/engine/Engine.ts` NOT edited — the integration patch is
`docs/overhaul/lane-R-engine.patch.py` (32 anchored hunks, verified on a scratch copy, see §4).

## 1. What changed (outcomes)

- **Walls stop bodies (V02).** The wall is now the ring outline as a convex polygon WITH its drawn
  thickness (0.35 m); a body is its footprint circle. Collision is continuous (swept circle, earliest
  time of impact over the frame's whole path, faces + rounded outer corners), the normal is the
  SEGMENT's normal, the response reflects with restitution e and Coulomb friction, the rest of the
  path slides; a body resting in a corner wedges (crease rule). hitWall / breach / integrity kept.
  Measured: 40 m/s × 64 bearings × 8 shapes (61,440 frames) → worst gap **+0.243 mm** (never inside).
- **Ring-out = elimination (V03)** — `src/game/RingOut.ts` + `WinConditions.ringOutVerdict` +
  `MatchHistory.WinReason "ringout"`; the engine ends the match (winner = the other, reason
  `"ringout"`) and shows the result after a 2 s follow of the fall.
- **Articulated ragdoll of the REAL skinned body (V03)** — `src/physics/ragdoll/**`: XPBD rigid
  segments on the rig's own bones (capsules = the combat hitboxes, masses from capsule volumes ×
  tissue density scaled to the fighter's mass), Skeleton joint limits (flex) + anatomical
  abduct/twist ranges, self-collision, ground/wall/platform/fluid contact through a world callback
  (Surroundings-ready), muscle tone from HP / stamina / damage meter / strength / statuses driving a
  protective pose (COVER ↔ BRACE by fall direction), seeded from the bone world matrices + body
  velocity + the last blow's moment; it writes the THREE.Bone local transforms, so the skinned mesh
  tumbles. Fixed 120 Hz substeps (≤ 4/frame), no per-frame allocation, settle/sleep, cost reported.

## 2. Files

Created
- `src/physics/WallCollision.ts` — wall polygon, swept circle vs wall, overlap, reflection.
- `src/game/RingOut.ts` — the ring-out rule, exit clock, double ring-out tie-break.
- `src/physics/ragdoll/QuatMath.ts` — allocation-free quaternion helpers, flex/abduct/twist decomposition.
- `src/physics/ragdoll/RagdollModel.ts` — segments, masses, inertia, joints, limits, contact spheres, self pairs.
- `src/physics/ragdoll/MuscleTone.ts` — tone from the fighter's condition, COVER/BRACE poses.
- `src/physics/ragdoll/RagdollWorld.ts` — world interface; flat ground, void, Surroundings, arena worlds.
- `src/physics/ragdoll/RagdollSolver.ts` — the XPBD solver (`Ragdoll` class).
- `src/physics/ragdoll/RigBinding.ts` — rig ↔ ragdoll (THREE): model from the rig, capture, apply, `RagdollDriver`.
- `tests/physics_wall_test.ts` (10), `tests/physics_ringout_test.ts` (8), `tests/ragdoll_model_test.ts` (6),
  `tests/ragdoll_fall_test.ts` (8), `tests/ragdoll_fixtures.ts` (stand-in Surroundings + the real rig, not a test).
- `docs/overhaul/lane-R-engine.patch.py` — the Engine.ts patch.

Modified
- `src/physics/ArenaPhysics.ts` — `stepArenaBody` rewritten on WallCollision (+ optional `contactRadius`
  param, `ArenaState.passing?`, `ArenaState.wallImpactSpeed?`, `ArenaStep.wallContact`, `wall.nx/nz`),
  `wallRestitution`, `footprintRadius`, constants.
- `src/game/WinConditions.ts` — `WinReasonKind = WinConditionKind | "ringout"`, `ringOutVerdict`; `WinVerdict.reason` widened.
- `src/game/MatchHistory.ts` — `WinReason` gains `"ringout"` (legacy `"ring-out"` kept for old records).
- `tests/live_arena_test.ts` — ONE edit, reason stated in the test: the "walked past the outline" body
  started at x 5.6, which is now INSIDE the wall (free region ends at R − 0.175 − r = 5.325 m); it starts at 5.2.

Not touched: `src/game/Ragdoll.ts` (the Verlet stick figure). After the engine patch nothing imports it
except `tests/arena_test.ts` (5 ragdoll cases) — delete both together when integrating.

## 3. Exports (exact signatures)

`src/physics/WallCollision.ts`
```ts
export const WALL_THICKNESS = 0.35, WALL_SKIN = 0.001, WALL_CONTACT_SLOP = 0.004, CURVE_TOLERANCE = 0.01;
export const CURVE_SAMPLES_MIN = 24, CURVE_SAMPLES_MAX = 512;
export interface WallPolygon { n; ax; az; ex; ez; len2; nx; nz: Float64Array…; halfThickness: number }
export function curveSamples(radius: number, tol = CURVE_TOLERANCE): number
export function wallPolygon(cfg: ArenaConfig, thickness = WALL_THICKNESS): WallPolygon
export function polygonFrom(xs: ArrayLike<number>, zs: ArrayLike<number>, halfThickness: number): WallPolygon
export function wallPolygonOf(cfg: ArenaConfig): WallPolygon            // cached per cfg
export function segmentDistance(poly: WallPolygon, i: number, x: number, z: number): number
export function insideDistance(poly: WallPolygon, x: number, z: number): number
export interface WallSweep { t; x; z; nx; nz; segment; corner: boolean; side: "inner" | "outer"; startGap }
export function createSweep(): WallSweep
export function sweepCircleWall(poly: WallPolygon, r: number, x0: number, z0: number, x1: number, z1: number, out: WallSweep): boolean
export interface WallOverlap { depth: number; nx: number; nz: number }
export function wallOverlap(poly: WallPolygon, r: number, x: number, z: number, out: WallOverlap): boolean
export function reflectVelocity(v: { vx: number; vz: number }, nx: number, nz: number, restitution: number, friction: number): number
```
`src/physics/ArenaPhysics.ts` (additions)
```ts
export const WALL_IMPACT_SPEED = 1, WALL_FRICTION_BASE = 0.4, WALL_MAX_SLIDES = 4;
export function wallRestitution(cfg: ArenaConfig, mass: number, approachSpeed: number, integrity: number): number
export function stepArenaBody(b, phys, dt, st, outwardSpeed, prev?: { x: number; z: number }, contactRadius: number = b.radius): ArenaStep
export interface ArenaStep { onRing; landedOutside; wall: { breached; selfDamage; speed; nx; nz } | null; wallContact: boolean }
export const FOOTPRINT_ZONES: readonly string[];
export function footprintRadius(boxes: readonly { zone: string; wa: ArrayLike<number>; wb: ArrayLike<number>; radius: number }[]): number
// ArenaState gains: passing?: Set<KinematicBody>; wallImpactSpeed?: number
```
`src/game/RingOut.ts`
```ts
export const RING_OUT_DROP_HEIGHTS = 1, REFERENCE_BODY_HEIGHT = 1.7, FALLBACK_KILL_PLANE_Y = -40, TOUCH_TOLERANCE = 0.02;
export function ringOutDrop(bodyHeight: number = REFERENCE_BODY_HEIGHT): number
export interface OutsideProbe { medium: Medium; surfaceY: number; killPlaneY: number }
export function outsideAt(cfg: ArenaConfig, s: Surroundings | null, x: number, z: number, t: number, out: OutsideProbe): OutsideProbe
export interface RingOutProbe { fighter; x; y; z; vx; vy; vz; radius; bottomY; bodyHeight; rimY; wallStopped: boolean; time }
export function beyondDistance(cfg: ArenaConfig, x: number, z: number): number
export function checkRingOut(cfg: ArenaConfig, p: RingOutProbe, s: Surroundings | null): RingOutEvent | null
export interface ExitClock { exitTime: number | null }
export function trackExit(clock: ExitClock, cfg: ArenaConfig, x: number, z: number, time: number): void
export interface RingOutCandidate { event: RingOutEvent; exitTime: number | null; hpFraction: number }
export function ringOutLoser(player: RingOutCandidate | null, opponent: RingOutCandidate | null): "player" | "opponent" | null
```
`src/game/WinConditions.ts`: `export type WinReasonKind = WinConditionKind | "ringout"; export function ringOutVerdict(loser: 0 | 1): WinVerdict`

`src/physics/ragdoll/QuatMath.ts`: `qMul, qConjMul, qMulConj(out, oi, a, ai, b, bi)`, `qNormalize(q, i)`,
`qRotate, qRotateInv(out, oi, q, qi, x, y, z)`, `qApplyRotation(q, i, wx, wy, wz)`, `qIntegrate(q, i, tx, ty, tz)`,
`qToRotationVector(out, oi, q, qi): number`, `qToFlexAbductTwist(out, oi, q, qi)`, `qFromFlexAbductTwist(out, oi, flex, abduct, twist)`,
`wrapPi(a)`, `clampAngle(a, lo, hi)`.

`src/physics/ragdoll/RagdollModel.ts`
```ts
export type V3 = [number, number, number]; export type Quat = [number, number, number, number];
export interface CapsuleInput { a: V3; b: V3; radius: number }
export interface RagdollBoneInput { id: string; parent: string | null; localPosition: V3; restRotation: Quat; capsules: CapsuleInput[] }
export const LATERAL_LIMITS: Record<string, { abduct: [number, number]; twist: [number, number] }>;
export const FLEX_SIGN: Record<string, 1 | -1>;  export const MIN_SEGMENT_MASS_FRACTION = 0.005, WELD_MASS_FRACTION = 0.02, SELF_REST_CLEARANCE = 0.01, SPHERE_MERGE = 0.03;
export function jointKindOf(id: string): { kind: string; side: 1 | -1 | 0 }
export interface RagdollModel { boneIds; boneParent; boneLocalPos; boneRestRot; segOfBone; boneWelded; segBone; rootBone; baseSegment; n; segParent; mass; invMass; inertia; invInertia; com; anchorParent; anchorChild; restRel; limits; flexSign; side; kind; sphereSeg; sphereLocal; sphereRadius; selfA; selfB; selfR; pairs; eqRadius; totalMass }
export function buildRagdollModel(bones: readonly RagdollBoneInput[], skeletonLimits: ReadonlyMap<string, { min: number; max: number }>, totalMass: number): RagdollModel
export function segmentSegment(p0x, p0y, p0z, p1x, p1y, p1z, q0x, q0y, q0z, q1x, q1y, q1z: number, st: { s: number; t: number }): number
export function targetRelative(m: RagdollModel, s: number, skeletonFlex: number, abductOut: number, twist: number, out: Float64Array, oi: number): void
```
`src/physics/ragdoll/MuscleTone.ts`
```ts
export const TONE_KNOCKBACK_PERCENT = 60, EXHAUSTED_TONE_FLOOR = 0.3, STRENGTH_REFERENCE = 37 / 8, STRENGTH_MIN = 0.4, STRENGTH_MAX = 2;
export const STATUS_TONE: Record<string, number>;
export interface FighterCondition { hpFraction; staminaFraction; damagePercent; strength: number; statuses: readonly string[] }
export interface Tone { tone: number; torqueScale: number }
export function muscleTone(c: FighterCondition, out?: Tone): Tone
export type JointTarget = [flex: number, abduct: number, twist: number];
export const COVER_POSE: Record<string, JointTarget>, BRACE_POSE: Record<string, JointTarget>;
export const BRACE_COS_LO = -0.1, BRACE_COS_HI = 0.5, FALL_SPEED_MIN = 1;
export function braceWeight(fx: number, fy: number, fz: number, vx: number, vy: number, vz: number): number
```
`src/physics/ragdoll/RagdollWorld.ts`
```ts
export interface SolidContact { depth; nx; ny; nz; friction; restitution: number }
export interface FluidSample { medium: Medium; surfaceY: number; drag: number; buoyancy: number }
export interface RagdollWorld { gravity: number; time: number; killPlaneY: number; sphereContact(x, y, z, r, out: SolidContact): boolean; fluidAt(x, z, out: FluidSample): boolean }
export const GROUND_FRICTION = 0.8, GROUND_RESTITUTION = 0.1, CANOPY_GROUND_DEPTH = 12;
export function flatGroundWorld(y = 0, friction = GROUND_FRICTION, gravity = ARENA_GRAVITY): RagdollWorld
export function voidWorld(killPlaneY = FALLBACK_KILL_PLANE_Y, gravity = ARENA_GRAVITY): RagdollWorld
export function surroundingsWorld(s: Surroundings, friction = GROUND_FRICTION, gravity = ARENA_GRAVITY): RagdollWorld
export function arenaWorld(st: ArenaState, s: Surroundings | null, gravity = ARENA_GRAVITY): RagdollWorld
```
`src/physics/ragdoll/RagdollSolver.ts`
```ts
export const SUBSTEP_HZ = 120, MAX_SUBSTEPS = 4, ITERATIONS = 4, MAX_EXTRA_ITERATIONS = 8, LIMIT_TOLERANCE = 0.004, ANCHOR_TOLERANCE = 0.005;
export const MUSCLE_FREQUENCY = 4, MUSCLE_DAMPING_RATIO = 0.8, MUSCLE_HOLD_RATIO = 2, RELAX_SPEED = 1.5, RELAX_HALF_LIFE = 0.35;
export const PASSIVE_JOINT_DAMPING = 2, AIR_DRAG = 0.02, FLUID_DRAG_COEFFICIENT = 1, SETTLE_SPEED = 0.08, SETTLE_RMS = 0.15, SETTLE_TIME = 0.5, MAX_SPIN = 50, STATIC_FRICTION_RATIO = 1.25;
export interface RagdollSeed { boneWorld: Float64Array; prevBoneWorld?: Float64Array; prevDt?: number; velocity: [number, number, number]; spin?: [number, number, number]; impact?: { point: [number, number, number]; impulse: [number, number, number] } }
export interface RagdollReport { substeps; ms; contacts: number; medium: Medium | null; immersion: number; settled: boolean; lost: boolean }
export class Ragdoll {
  constructor(model: RagdollModel, gravity = 24);
  readonly model; x; q; v; w; px; pq; target; lambda; holdTorque; report: RagdollReport;
  tone: number; torqueScale: number; reflex: number; settled: boolean; lost: boolean; time: number;
  setCondition(c: FighterCondition): void;  seed(seed: RagdollSeed): void;
  step(dt: number, world: RagdollWorld): RagdollReport;  writeBones(out: Float64Array): void;
  centreOfMass(): [number, number, number];  comVelocity(): [number, number, number];  energy(gravity: number): number;
  jointAngles(s: number, out: Float64Array, oi = 0): void;  limitViolation(): number;  maxAnchorGap(): number;
}
export function holdingTorques(m: RagdollModel, gravity: number): Float64Array
```
`src/physics/ragdoll/RigBinding.ts`
```ts
export type RagdollRig = Pick<SkinnedExtras, "plan" | "bones"> & { group: THREE.Group };
export function ragdollInputFromRig(rig: RagdollRig, boxes: HitboxSet): RagdollBoneInput[]
export function ragdollModelForRig(rig: RagdollRig, boxes: HitboxSet, skeletonLimits: ReadonlyMap<string, { min: number; max: number }>): RagdollModel
export function captureBoneWorld(rig: RagdollRig, out: Float64Array): Float64Array
export function applyRagdollToRig(rd: Ragdoll, rig: RagdollRig, scratch: Float64Array): void
export interface RagdollStart { condition: FighterCondition; velocity: [number, number, number]; impact?: RagdollSeed["impact"]; prevBoneWorld?: Float64Array; prevDt?: number }
export class RagdollDriver {
  constructor(rig: RagdollRig, boxes: HitboxSet, skeletonLimits: ReadonlyMap<string, { min: number; max: number }>, gravity?: number);
  readonly ragdoll: Ragdoll; active: boolean;
  capture(out?: Float64Array): Float64Array;  start(s: RagdollStart): void;
  update(dt: number, world: RagdollWorld): RagdollReport;  stop(): void;   // stop restores every bone's rest local pose
}
```

## 4. Engine.ts integration — `docs/overhaul/lane-R-engine.patch.py`

Run from the repo root: `python3 docs/overhaul/lane-R-engine.patch.py` (asserts every anchor occurs
exactly once, applies with `replace(…, 1)`, refuses to write otherwise). Hunks:

1. Imports: `footprintRadius`, `WALL_THICKNESS, wallPolygonOf`, the RingOut functions, `RagdollDriver`,
   `arenaWorld/RagdollWorld`, `RingOutEvent`; drop `../game/Ragdoll.ts` and the now-unused `fallDamage`.
2. `MatchEndReason` += `"ringout"`; `RING_OUT_FOLLOW_SECONDS = 2`; module `RING_CAM` vector.
3. Fields: `#ragdollDrivers`, `#ragdolled`, `#ragdollWorld`, `#footprint`, `#exitClocks`, `#lastImpact`,
   `#ringOutFollow` replace `#ragdollMeshes` / `#ragdolls`.
4. `#spawnMeshes`: drivers cleared with the rigs. 5. After `this.#armCombat(f, rig)`: build the
   `RagdollDriver` (hitboxes of the fighter, or `hitboxesFromPlan` for a classic weapon — cached per plan)
   and the wall footprint radius. 6. `#arenaState.wallImpactSpeed = MOVE_SPEED * 1.05` (walking into a
   wall slides; it is never a blow). 7. The wall + floor drawn on `wallPolygonOf(cfg)` (exact corners
   for n ≤ 8) and `BoxGeometry(…, WALL_THICKNESS)`. 8. `#startFight` resets (and the stale "no ring-out"
   comment). 9. The 7 m/s particle tumble in `#tickWorld` and `#drawRagdoll` removed.
10. `#strikeTick` guards use `#ragdolled`. 11. `#resolveHit` records the last blow (contact point +
   `imp.knockback` impulse). 12. `#landOutside`, `#returnToRing`, `#throwRagdoll` → `#ringOut(f, ev)` +
   `#startRagdoll(f)` (condition = HP, stamina, damage %, strength, statuses). 13. `#checkElimination`
   no longer returns bodies from the void. 14. `#endMatch`: ring-out wording, `brain.adapt` for any
   non-forfeit result, the result screen deferred via `#ringOutFollow`. 15. `#loop` follow clock.
16. Physics loop: footprint radius into `stepArenaBody`, ragdolled bodies skipped, `trackExit` +
   `checkRingOut` per body, `ringOutLoser` → `#ringOut`. 17. No body–body push against a ragdoll.
18. Rig loop: a ragdolled fighter skips `#updatePose`, the pose gate, grip, `rig.update` — the driver
   steps and writes the bones; the kinematic body/aura follow the centre of mass; old ragdoll
   visibility/aura lines removed. 19. Ring-out follow camera (eased, ring side, above). 20. `debugWorld`
   `ragdoll` → `#startRagdoll(o)`; snapshot gets `ragdollMs`.

**Lane S hook (two places):** the patch passes `null /* lane S: this.#surroundings */` to
`arenaWorld(…)` (#startRagdoll) and `checkRingOut(…)` (physics loop). Lane S's engine patch declares
`#surroundings: BiomeSurroundings | null`; once it is in, replace both `null` with `this.#surroundings`
(null keeps the ArenaConfig fallback: solid outside ground at `outsideHeight`, or a void).
**Lane O:** `lane-O-wallmat.patch` edits the same wall `BoxGeometry` line; my anchor is the substring
`new THREE.BoxGeometry(len + 0.05, wallSpan, 0.35)`, which survives their edit (either order works).

Verification (real): `src` + `deno.json` + `deno.lock` + `artifacts/design/*.json` copied to
`/Users/macmax/.hermes/cache/scratch/laneR/repo_copy`, then
```
$ python3 docs/overhaul/lane-R-engine.patch.py src/engine/Engine.ts
lane R: 32 hunks applied to src/engine/Engine.ts
$ deno check --frozen src/engine/Engine.ts
Check src/engine/Engine.ts            (no errors; strict + noUnusedLocals)
$ deno lint src/engine/Engine.ts
Checked 1 file
```
Not run in a browser (no build / no server per the brief): the follow camera, the HUD flow and the
deferred victory screen are type-checked only.

## 5. Decisions (derived, documented in code)

- **Body radius for walls:** `footprintRadius(hitboxes)` = farthest reach of the trunk/upper-arm/thigh
  capsules from the body axis in the bind pose = **0.313 m** for the default human (forearms/hands/weapon
  excluded: they fold). SmashPhysics' 0.6 and the engine's 0.5 are left as they are (floor/spacing rules
  depend on them); only the wall uses the footprint (new optional `contactRadius` param).
- **Restitution** `e = wallBounce · (1 − min(1, m·v / (wallResistance · integrity)))`: a tap bounces at
  the material's bounce, a near-breach blow is soaked up. Friction μ = 0.4 × `cfg.friction`.
- **Impacts vs leaning:** `hitWall` (wear, self-damage, stun) only on a NEW contact at ≥
  `wallImpactSpeed` (default 1 m/s; the patch sets 1.05 × walk speed). Sustained contact is inelastic
  and slides. Before, a walker pressed into the wall was re-hit every few frames.
- **Ring-out rule:** beyond the outline by more than the footprint (`beyondDistance > r`) AND (dropped >
  1 body height below the rim, OR touching the surface below — liquid, canopy AND solid ground (sumo
  rule: a body landing beyond a standing wall could never come back), OR below the kill plane); a wall
  that held this step never counts. Applies during the truce too (falling off is not an attack).
- **Double ring-out:** the earlier outline exit loses (the first ejected); tie → lower HP fraction loses;
  full tie → the player (deterministic).
- **Waist:** the rig's `spine` joint turns the whole body about the massless root, so the physical waist
  is the `abdomen` joint with Skeleton limits ±0.5 (the KO-pose overrides are not used).
- **Welding:** leaf bones lighter than 2 % of the body (toes, then feet) are welded to the shin at their
  rest angle. With free 0.06 kg toes / 0.8 kg feet the ground contact and the joint limits fought every
  substep: measured, a limp body crawled at 1.2–1.5 m/s for 5 s with ankles spinning 100+ rad/s.
  Model: 12 segments for 17 bones (masses kg: chest 12.57, abdomen+pelvis 27.00, neck 2.67, head 3.85,
  upper arms 2.22/1.90, forearm+hand 1.59/1.55, thighs 6.25/5.03, shin+foot 2.68/2.68).
- **Muscle tone:** `T = consciousness · √hp · (0.3 + 0.7·stamina) · 1/(1 + dp/60)` (dp law = the game's
  knockback law), torque × strength / 4.625; stiffness = T·I_eff·(2π·4 Hz)², ζ = 0.8, torque ≤ 2 × the
  joint's holding torque. The guard is a FALL reflex: it relaxes (half-life 0.35 s) once the body lies on
  something slower than 1.5 m/s — otherwise drives strained against the ground for ever.
- **Joint limits:** solved in the XPBD passes, then a kinematic post-projection (each subtree turned
  about its joint) whose velocity effect is the KE-minimising blend (an inelastic stop, never a bounce).

## 6. Commands run (real output)

```
$ deno check <12 lane files + 6 test files>     → clean ("Checked …", no errors)
$ deno lint src/physics src/game/RingOut.ts tests/physics_wall_test.ts tests/physics_ringout_test.ts tests/ragdoll_*.ts
Checked 15 files
$ deno test --allow-read tests/physics_wall_test.ts tests/physics_ringout_test.ts tests/ragdoll_model_test.ts \
    tests/ragdoll_fall_test.ts tests/physics_test.ts tests/live_arena_test.ts tests/arena_test.ts \
    tests/winconditions_test.ts tests/history_test.ts
  40 m/s x 64 bearings x 8 shapes: 61440 frames, worst gap 0.243 mm
  wall footprint radius 0.313 m; segments 12, contact spheres 90, self pairs 48, masses 12.57 27.00 2.67 3.85 2.22 1.90 1.59 1.55 6.25 5.03 2.68 2.68
  worst joint-limit excursion 2.89e-15 rad; worst anchor gap 45.5 mm (impact frames; invisible on the skin)
  0/1000 throws rose > 1 % (worst transient 0.00 %); worst end -2.5 % of E0; 0.242 ms/frame mean, 2.69 ms max over 40000 frames
  toned: worst transient rise 0.065 % of E0
  mean hand-to-head distance at rest: fresh 0.347 m, limp 0.906 m
  1-4 s max sinking speed: void 92.25 m/s, water(b=0.9) 0.98 m/s; floater COM -0.13 m from the surface
ok | 82 passed | 0 failed (15s)
```
(10 wall + 8 ring-out + 6 model + 8 fall + 2 physics + 14 live arena + 24 arena + 6 win conditions + 4 history.)
Tests covered: no tunnelling at 40 m/s on all 8 shapes; resting contact > −1 mm and no jitter after
200 frames (faces and corners); oblique slide at a constant rate; hexagon bounce = reflection about the
segment normal (normal −e·v_n, tangential kept with μ = 0) on an off-centre hit where radial ≠ normal by
> 10°; inner corner wedge; rounded outer corner; breach still possible; over-the-top pass. Ring-out:
footprint rule, ground/void/water/magma, wall-held never, low-wall integration, exit clock + tie-break.
Ragdoll: limits never exceeded > 0.01 rad over 12 × 3 s falls; 1,000 seeded limp throws end lower with no
throw rising > 1 %; 200 toned throws < 5 %; fresh arms end nearer the head (0.35 vs 0.91 m); water slows
the fall and a buoyant body floats at the surface; landings settle ≤ 3 s and sleep; bit-identical per seed;
thrown off the platform it lands outside and never enters the platform's solid; seed→write round trip
exact; driver stop restores the rest pose.

**Per-frame cost** (this Mac, Deno, one ragdoll): 0.24 ms mean / 2.69 ms max over 40,000 throw frames
(the violent first 0.67 s of each throw); 0.39 ms (limp) and 0.56 ms (fresh) mean over the 2.5 s render
falls; 0 ms once settled (sleeps). Model + driver build: 2.3 ms first, 0.4–0.6 ms after.

**Visual check:** `/Users/macmax/.hermes/cache/scratch/laneR/ragdoll_fall_strip.png` (1560×520, 2 rows ×
6 frames at t = 0, 0.25, 0.5, 0.75, 1.25, 2.5 s; real painted skinned mesh, 8,404 triangles, CPU-skinned
through the ragdoll-driven bones). Numbers: fresh COM (2.93, 1.01) → (8.41, −1.86), limit violation ≤ 1.1e-15 rad,
settled; limp → (8.18, −1.88), settled. Script: `/Users/macmax/.hermes/cache/scratch/laneR/render_fall.ts`.

## 7. Not done / not verified / risks

- **Engine patch not run in a browser** (type-check + lint only, on a scratch copy). The follow camera
  framing, the deferred victory screen and the AI near walls need a play pass.
- **Real Surroundings not exercised:** lane S's module was not imported; tests use contract-only fixtures
  (`tests/ragdoll_fixtures.ts`). Swap the two `null`s for `this.#surroundings` (§4).
- **Anchor gaps on impact frames** reach 45 mm for a substep (the skin cannot show them: bones keep their
  constant offsets); they close within a few substeps.
- **Ground normal is +y** for the outside surface (no slope normals from `surfaceAt`); hills give
  vertical push-out only.
- **Welded feet/toes** do not flex during the fall (rigid feet).
- **Mid-fight hard-knockback tumble retired** (the old > 7 m/s sphere ragdoll). Only ring-outs ragdoll;
  a KO could also `#startRagdoll` with tone 0 — not wired (one line in `#checkElimination` if wanted).
- **Unwalled flush arenas:** stepping fully off the edge onto the outside ground is now a loss (sumo
  rule). The AI keeps its 1.5 m edge margin; worth watching in play.
- `tests/arena_test.ts` still tests the old `Ragdoll.ts`; delete both after the patch.
- WallCollision/RingOut/ragdoll exports are test-only until the patch lands (the dead-export audit will
  flag them until then).
