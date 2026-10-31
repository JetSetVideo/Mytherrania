# Wave I — spectator camera, inspect UI, ground fill, clash particles, 60 FPS guard (contract)

Written 2026-10-31 by the parent, from the user's spoken brief. FROZEN: lanes code against the
interfaces here and may not renegotiate them. Blocked on something outside your lane? Write
`artifacts/messages-I<lane>.md` and keep going on the rest.

## 0. The decoded brief (transcript kept, decode beside it)

| Spoken | Decoded | Where it lands |
|---|---|---|
| "in spectator mode I can change the angle of the camera and it remains the same" | the spectator camera keeps the angle you set: no ease-back, no reset on match start | I-A (+ parent wiring) |
| "my cursor with a nice little end with a blog kind of" | a custom cursor: a crisp reticle with a soft trailing blob | I-B (+ parent wiring) |
| "I can click on the characters fighting and see the statistic sheet floating next to them … when I click away it closes … or change the statistics for the other players or some of the bonuses and objects in the map" | click a fighter → a stat sheet anchored beside them; click the other fighter → it swaps; click away → it closes; click a map object/boon → its own card | I-B (+ parent wiring) |
| "some objects are kind of floating above the map" | props hover: their base is placed from the terrain height at the CENTRE, and at the model's own origin rather than its base | I-C |
| "the surface is already connected to the ground but not fully … another layer in the generation system for the ground … forms that would be met with the terrain to close the gaps depending on which ground they've been put on … add some sand if it's partially on the sand" | a **fill/skirt layer**: every platform and prop gets an apron that runs from its base edge down to the terrain, coloured like the ground material it stands on, closing the seam | I-C |
| "keep the 60 FPS running at all time on that type of hardware" | a measured frame budget plus an adaptive effects governor so the new work can never cost the 60 FPS | I-E |
| "particles … where for example two weapons collide" | blade-vs-blade clash detection and a bounded spark burst at the contact | I-D |

## 1. Frozen interfaces

### 1.1 `src/game/SpectatorCamera.ts` (new, I-A)

```ts
export type SpectateCamMode = "free" | "follow-a" | "follow-b";
export interface SpectateCamState { mode: SpectateCamMode; yaw: number; pitch: number; dist: number; height: number; }

export const SPECTATE_CAM_DEFAULTS: SpectateCamState;              // mode "free"
export const SPECTATE_CAM_BOUNDS: { pitch: readonly [number, number]; dist: readonly [number, number] };
export const CAMERA_PRESETS: readonly { id: string; label: string; state: SpectateCamState }[];   // 4, incl. a wide/broadcast and a top-down

/** Pure orbit. Clamps; NEVER decays and never depends on dt, so an angle the user set stays set. */
export function orbitCamera(s: SpectateCamState, dx: number, dy: number, sens: { yaw: number; pitch: number }): SpectateCamState;
/** Multiplicative zoom, clamped. */
export function zoomCamera(s: SpectateCamState, steps: number): SpectateCamState;
/** free -> follow-a -> follow-b -> free. */
export function cycleMode(s: SpectateCamState): SpectateCamState;
/** Lock the camera to a seat (a click on a fighter), keeping the user's yaw/pitch. */
export function focusSeat(s: SpectateCamState, seat: 0 | 1): SpectateCamState;
/** The camera pose for a state and a look-at target: position = target + spherical(yaw, pitch, dist) + height. */
export function cameraPose(s: SpectateCamState, target: readonly [number, number, number]): { position: [number, number, number]; look: [number, number, number] };
/** localStorage round trip; a corrupt or absent string yields SPECTATE_CAM_DEFAULTS. */
export function encodeSpectateCam(s: SpectateCamState): string;
export function decodeSpectateCam(raw: string | null): SpectateCamState;
```

Testable rules: `orbitCamera` is clamped into `SPECTATE_CAM_BOUNDS` and **stable under no input**
(`orbitCamera(s, 0, 0, …)` deep-equals `s` — this is the user's complaint, so it is the first test);
`cameraPose` never puts the camera below the target's height for a positive pitch; `zoomCamera` is
monotone and clamped at both ends; `decodeSpectateCam(encodeSpectateCam(s))` round-trips and every
field survives a hostile string (`""`, `"null"`, `"{]"`, a huge dist, a negative pitch); every preset
is inside its bounds.

### 1.2 `src/ui/InspectOverlay.ts` (new, I-B)

```ts
export type InspectTarget = { kind: "fighter"; seat: 0 | 1 } | { kind: "object"; id: string };

export interface InspectRow { label: string; value: string; tone?: "good" | "bad" | "muted" }
export interface InspectBar { label: string; value: number; max: number; colour: string }
export interface InspectCard { title: string; subtitle: string; badges: string[]; rows: InspectRow[]; bars: InspectBar[] }

export interface FighterView {
  seat: 0 | 1; name: string; ancestry: string; subrace: string | null; className: string; level: number;
  controller: string; weapon: string;
  stats: { vitality: number; resilience: number; willpower: number; reflex: number; strength: number; intelligence: number };
  combat: { maxHealth: number; attackPower: number; attackInterval: number; armor: number };
  hp: number; mana: number; manaMax: number; stamina: number; staminaMax: number;
  dealt: number; hits: number; techniques: string[]; generationId: string | null;
  telemetry: { travelledM: number; avgDistanceM: number; peak5sDamage: number };
}
export interface ObjectView {
  id: string; kind: string; label: string; detail: string; x: number; z: number;
  radiusM: number; heightM: number; scale: number; boon: string | null;
}
export function fighterCard(v: FighterView): InspectCard;
export function objectCard(v: ObjectView): InspectCard;

/** Anchor a card beside a screen point without ever leaving the viewport: flip the side when the
 *  card would overflow, then clamp. `gap` defaults to 18 px. */
export function anchorCard(anchor: { x: number; y: number }, card: { w: number; h: number }, viewport: { w: number; h: number }, gap?: number): { left: number; top: number; side: "right" | "left" };
/** The nearest candidate within its own radius, else null. */
export function pickNearest(cands: readonly { id: string; x: number; y: number; r: number }[], p: { x: number; y: number }): string | null;

export interface CursorState { x: number; y: number; blobX: number; blobY: number; down: boolean; hoverId: string | null }
export const CURSOR_BLOB_LAG_MS: number;
/** Frame-rate independent ease of the blob toward the reticle (the "little blob" that trails it). */
export function stepCursor(s: CursorState, target: { x: number; y: number }, dt: number): CursorState;
/** The blob's own visual size: grows while the pointer is down and while hovering a target. */
export function blobRadius(s: CursorState): number;
```

Testable rules: `anchorCard` never returns a rect outside `[0, viewport]` for any anchor (fuzz it),
flips to the left when the right side overflows, and stays centred vertically on the anchor;
`pickNearest` returns null outside every radius and the NEAREST when two overlap; `fighterCard` has a
row for every one of the six primaries, a bar for hp/mana/stamina, the generation id in `badges` when
present, and `tone: "bad"` for a stat below the fighter's own average; `objectCard` names the boon
when there is one and says what it does; `stepCursor` converges (blob reaches the reticle within 1 s)
and is dt-independent (1 step of 0.1 s ≈ 10 steps of 0.01 s).

### 1.3 `src/combat/Clash.ts` (new, I-D)

```ts
export interface BladeSeg { a: readonly [number, number, number]; b: readonly [number, number, number]; speed: number; }
export interface ClashEvent { at: [number, number, number]; normal: [number, number, number]; strength: number; }

/** Exact closest approach between two segments (Ericson, Real-Time Collision Detection §5.1.9). */
export function segSegClosest(p1: readonly [number, number, number], q1: readonly [number, number, number], p2: readonly [number, number, number], q2: readonly [number, number, number]): { d: number; at: [number, number, number] };
/** A clash needs both blades moving and the blades within `threshold` metres. */
export function detectClash(a: BladeSeg, b: BladeSeg, threshold: number): ClashEvent | null;
export function clashStrength(relSpeed: number, minSpeed?: number, maxSpeed?: number): number;   // 0..1, saturating
export function canClash(now: number, lastAt: number, cooldown?: number): boolean;              // repeat gate
```

Testable rules: `segSegClosest` is exact on hand-computed cases (crossing segments → 0; parallel
offset lines → the offset; skewed; a degenerate zero-length segment; identical points) and never
NaN; `detectClash` reports no clash for blades at rest however close (the speed gate) or beyond the
threshold, reports one for two blades crossing at speed, and the contact `at` lies on both segments
(within 1e-9); `clashStrength(0) === 0`, monotone, `=== 1` at/above `maxSpeed`, never out of [0,1].

### 1.4 `src/graphics/fx/ClashSparks.ts` (new, I-D)

```ts
export interface ClashSparksOptions { maxSparks?: number; seed?: number }   // maxSparks default 96
export class ClashSparks {
  constructor(parent: THREE.Object3D, opts?: ClashSparksOptions);
  burst(at: readonly [number, number, number], strength: number, now: number, normal?: readonly [number, number, number]): void;
  update(now: number, dt: number): void;
  get liveCount(): number; get spawned(): number; get dropped(): number;
  /** 0..1: the caller's effects governor can thin the burst out without changing this class. */
  setScale(scale: number): void;
  clear(): void; dispose(): void;
  readonly triangleCount: number;
}
```

Testable rules (pure logic separated from THREE where possible): the pool is fixed — 10 000 bursts
never exceed `maxSparks` live and `spawned + dropped === bursts × perBurst`; every spark dies within
0.5 s of simulated time; `setScale(0)` spawns nothing; the same seed gives the same directions; the
class allocates nothing after construction (a test that runs 10 000 `burst`+`update` pairs and reports
the wall clock, well under a second); the whole pool is at most 2 meshes and its triangle count is
under 4 000.

### 1.5 `src/game/FrameBudget.ts` (new, I-E)

```ts
export interface GovernorOptions { targetMs?: number; hardMs?: number; minScale?: number; upRate?: number; downRate?: number }
export class EffectsGovernor {
  constructor(opts?: GovernorOptions);       // targetMs 12, hardMs 16.6, minScale 0.25
  /** One call per frame with the PREVIOUS frame's CPU ms; returns the effect scale 0..1 to apply. */
  step(cpuMs: number, dt: number): number;
  get scale(): number; get drops(): number; get recoveries(): number; get overBudgetFrames(): number;
}
export function percentile(samples: readonly number[], p: number): number;    // exact, sorted copy
export function summarise(samples: readonly number[]): { n: number; mean: number; p50: number; p95: number; p99: number; max: number };
```

Testable rules: a sustained 20 ms/frame CPU drives the scale to `minScale` and no lower; once the
CPU drops under target the scale recovers but never above 1; the governor never flaps (a scripted
alternating sequence moves the scale in one direction only while the regime holds); `percentile` is
exact on hand-computed samples and total on an empty one; every number is finite.

### 1.6 `src/graphics/GroundFill.ts` (new, I-C)

```ts
export type GroundMaterialId = "stone" | "grass" | "sand" | "wood" | "ice" | "rock";
export interface FillRun { x: number; z: number; y: number; radius: number; rotation: number; material: GroundMaterialId; }
export interface SkirtResult { geometry: THREE.BufferGeometry; triangles: number; maxDrop: number; }
export interface Footprint { min: number; max: number; mean: number; range: number }

/** The terrain under a circular footprint: `count` samples around the rim plus the centre. */
export function footHeight(sample: (x: number, z: number) => number, x: number, z: number, radius: number, count?: number): Footprint;
/** Where a prop's base must sit so that NO point of its footprint is above the ground (never floats). */
export function seatingY(sample: (x: number, z: number) => number, x: number, z: number, radius: number, count?: number): number;
/** The apron: a ring at the base edge running down to the terrain, closed, bounded, no NaN. */
export function skirtFor(run: FillRun, sample: (x: number, z: number) => number, opts?: { segments?: number; lip?: number; maxDrop?: number }): SkirtResult;
/** Which material a fill should be coloured as, from the ground under the footprint. */
export function materialUnder(sampleMaterial: (x: number, z: number) => GroundMaterialId, x: number, z: number, radius: number): GroundMaterialId;
```

Testable rules: on a flat ground `seatingY` equals that height and the skirt's `maxDrop` is ~0 (a
minimum apron only, no spikes); on a 20° slope `seatingY` is the footprint MAX (assert the base is at
or above the ground at every one of 64 rim samples) and the apron reaches the terrain everywhere
(`maxDrop` ≤ the slope's own fall across the footprint); a prop half on sand and half on grass takes
the material it covers most; triangles are bounded by `segments × 2 × 3`; no NaN, no zero-area
triangle, for radius 0.01 and radius 40.

### 1.7 Prop models (I-C also owns `src/graphics/props/PropModels.ts`)

Every prop geometry must be anchored so that `geometry.boundingBox.min.y` is the model's BASE (a tree
trunk, a pillar foot, a crate bottom) — the engine places a prop at `baseY + (h × scale)/2` today,
which floats any model whose origin is not its centre. Export:
`export function propBaseOffset(kind: ObjectKind, size: { r: number; h: number }, scale: number, detail: number, colour: string, seed: number): number;`
returning `-boundingBox.min.y` (0 when the model is already base-anchored), plus a test that asserts
the offset is finite for every kind × 3 details × 4 scales.

## 2. Lane ownership

| Lane | Owns | Deliverable |
|---|---|---|
| I-A | `src/game/SpectatorCamera.ts`, `tests/spectatorcamera_test.ts` | the persistent spectator camera maths |
| I-B | `src/ui/InspectOverlay.ts`, `tests/inspectoverlay_test.ts`, `styles.css` | the cursor, the cards, the pick + anchor maths, the styles |
| I-C | `src/graphics/GroundFill.ts`, `src/graphics/props/PropModels.ts`, `tests/groundfill_test.ts`, `tests/propmodels_test.ts` | the fill layer and base-anchored props |
| I-D | `src/combat/Clash.ts`, `src/graphics/fx/ClashSparks.ts`, `tests/clash_test.ts`, `tests/clashsparks_test.ts` | clash detection + the spark pool |
| I-E | `src/game/FrameBudget.ts`, `tools/frame-budget.ts`, `tests/framebudget_test.ts` | the governor + the measured 60 FPS budget |
| Parent | `src/engine/Engine.ts`, `src/world/**`, `tools/probe-wave-i.ts`, `docs/SPEC.md`, `tests/spec_test.ts` | wiring, the live probe, the gate, the commit |

## 3. The gate (every lane before it reports done)

1. `deno check <your files>` → 0 errors. 2. `deno test --allow-read --allow-write=artifacts tests/<your test>` → all pass.
3. `deno lint <your files>` → clean. 4. No `Math.random` in a pure module. 5. Report WHO/WHAT/WHERE/WHEN/WHY/HOW
with the literal command output — a claim without the command's output is not evidence.
