# Wave J-T → engine: what `src/engine/Engine.ts` and the physics must change

Written by lane J-T (2026-10-31) for the parent, who writes the patch after wave I commits. Engine.ts
was READ ONLY for this lane; the line numbers below are from the working tree at the time of writing
(wave I in flight) — re-anchor on the quoted text, not the number.

The pure modules are done and tested (`src/game/arena/{walls,symmetry,spawns,digest}.ts`); nothing in
the running game uses them yet. Until this patch lands the game keeps ONE wall all round at
`cfg.wallHeight`, which `randomArena` now rolls at 0.4..1.6 m (the plan's base) instead of 1.4..6 m —
so the live game already gets a lower wall, but not the gaps, towers or symmetry.

## 1. Match start — `#startMatch` (randomArena call ≈ line 1593, arenaState ≈ 1601–1611, spawns ≈ 1612–1631)

Today (anchors):

```ts
const cfg = randomArena(arenaRng, { ...this.#menu?.arenaChoice(), ...this.#arenaOverride, ... });   // ≈1593
if (this.#arenaOverride?.size === undefined) cfg.size = clampLiveArenaSize(cfg.size);              // ≈1599
this.#arenaState = { cfg, walled: cfg.walls >= 1, integrity: 1, props: placeObjects(cfg, arenaRng), wallImpactSpeed: ... };  // ≈1601
const spawn = Math.min(2.5, half * 0.4);                                                           // ≈1616
const px = this.#spectate ? (Math.random() - 0.5) * (half - 2) : -spawn;                           // ≈1617
this.#terrainField = generateArenaTerrain(Math.floor(arenaRng() * 0x7fffffff), cfg, {}, { fairSpots: [...] });  // ≈1619
for (const prop of this.#arenaState.props) prop.y = heightAt(this.#terrainField, prop.x, prop.z);  // ≈1625
this.#player = createFighter(..., px, 0, ...); this.#opponent = createFighter(..., -px, oz, ...);   // ≈1630
```

Replace with (keep the arenaRng draw ORDER: placeObjects first, then the terrain seed):

```ts
import { symmetryFor, symmetrizeHeightfield, symmetrizeObjects } from "../game/arena/symmetry.ts";
import { wallPlanFor } from "../game/arena/walls.ts";
import { spawnPlan } from "../game/arena/spawns.ts";
import { arenaDigest } from "../game/arena/digest.ts";

const sym = symmetryFor(cfg);                         // degrades a creator/override choice the outline cannot hold
const rawProps = placeObjects(cfg, arenaRng);         // same draw as today
const terrainSeed = Math.floor(arenaRng() * 0x7fffffff);
const wallPlan = wallPlanFor(cfg, terrainSeed ^ 0x3c6ef372, sym);   // no extra arenaRng draw
const nominal = spawnPlan(cfg, sym, null, 2);          // zones + nominal spots (flat ground)
const raw = generateArenaTerrain(terrainSeed, cfg, {}, { fairSpots: nominal.spawns.map((s) => ({ x: s.x, z: s.z })) });
this.#terrainField = symmetrizeHeightfield(raw, sym);  // 2 passes, ~2–4 ms each on a 34 m ring
const props = symmetrizeObjects(rawProps, sym, cfg, nominal.zones);
const spawns = spawnPlan(cfg, sym, this.#terrainField, 2, props);   // slope/rise/prop checked
this.#arenaState = { cfg, walled: cfg.walls >= 1, integrity: 1, props, wallImpactSpeed: MOVE_SPEED * 1.05, wallPlan,
                     segIntegrity: new Float64Array(wallPlan.segments.length).fill(1) };
for (const prop of props) prop.y = heightAt(this.#terrainField, prop.x, prop.z);
const [s0, s1] = spawns.spawns;
this.#player = createFighter(..., s0.x, s0.z, ...);   this.#opponent = createFighter(..., s1.x, s1.z, ...);
// initial rig yaw: rig.group.rotation.y = s0.yaw / s1.yaw (rig convention atan2(dx, dz))
this.#arenaDigest = arenaDigest(cfg, wallPlan, this.#terrainField, props, sym, spawns);
```

Notes:
- The spectate branch's `Math.random()` spawn (≈1617–1618) goes: `spawnAngle` (rolled by randomArena)
  already varies the spawn bearing, and a symmetric map must use the image seats or it is not fair.
- `clampLiveArenaSize` scales the ring after the roll: harmless (scaling keeps every symmetry).
- `#ringHalf()` (≈1350) stays as is; spawnPlan uses its own 64-bearing `minRingRadius`.
- The fair pads RingRelief levels under `fairSpots` are symmetric images, so the symmetrized field keeps
  them level; the second `spawnPlan` then normally returns the nominal spots unchanged.

## 2. Wall meshes — `#buildArena` (≈1121; the wall block ≈1170–1196, `#wallMeshes` field ≈479)

Today: `if (this.#arenaState.walled)` builds one `BoxGeometry(len + 0.05, wallSpan, WALL_THICKNESS)` per
OUTLINE edge (`pts` = wallPolygon vertices for n ≤ 8, else `outline(cfg, 96)`), all `cfg.wallHeight`
tall, spanning `rimLo .. rimHi + wallHeight`.

New: build per PLAN segment (48 angular spans), merged into runs of equal height to save draw calls:

```ts
for (const run of runsOfEqualHeight(plan.segments)) {          // skip runs with height 0 (openings)
  // polyline along the outline from bearing run.a0 to run.a1: the point at a0, every outline
  // vertex whose bearing lies inside, the point at a1 (r = ringRadiusAt(cfg, θ) or the polygon chord)
  for (const [a, b] of edgesOf(polyline)) {
    const lo = min(floorY at a, b) , hi = max(...);           // local rim, not the whole ring's
    const span = run.height + (hi - lo);
    box(len + 0.02, span, WALL_THICKNESS) at mid(a, b), y = lo + span / 2, rotation.y = -atan2(dz, dx)
    material: colour by run.resistance (as today: tough = min(1, resistance / 9000)); a tower/merlon (h ≥ 2) may take a
    darker cap or a slightly thicker box (1.4 × WALL_THICKNESS) so tall parts read as towers
    name "arena-wall"; this.#wallMeshes.push(seg); this.#occluders.register(seg, { kind: "wall" })
  }
}
```

- `#wallMeshes` visibility toggles (≈4061, ≈4115) keep working (same array).
- Minimap (`setWorld` ≈1714, `walled: this.#arenaState.walled`): pass the plan (or `digest.open`) so the
  baked wall line shows the gaps — that is `src/ui/Minimap.ts` (wave I-owned), a follow-up.

## 3. Collision — `src/physics/ArenaPhysics.ts` + `WallCollision.ts`

Geometry stays the convex WallPolygon (the collision SHAPE is the outline); the plan decides the
HEIGHT, RESISTANCE and BOUNCE at the contact's bearing `θc = atan2(SWEEP.z, SWEEP.x)`:

```ts
const seg = st.wallPlan ? st.wallPlan.segments[segmentIndexAt(st.wallPlan, θc)] : { height: cfg.wallHeight, resistance: cfg.wallResistance, bounce: cfg.wallBounce };
```

The rule (replaces `if (yAt - b.radius >= rimY + cfg.wallHeight) break;` at ArenaPhysics ≈137 and the
final-guard `+ cfg.wallHeight` at ≈228):

| segment height h | contact outcome |
|---|---|
| h = 0 (opening) | no wall: the path continues (a straight path leaves a convex outline once, so `break`) |
| body bottom ≥ rimY + h | over the top (unchanged formula, per-segment h) |
| 0 < h < WALL_BLOCK_HEIGHT (0.6 m, a curb) | a LEAN (approach < wallImpactSpeed) slides along it as today (walking does not wander off the ring); a BLOW (approach ≥ wallImpactSpeed) TRIPS over: no hitWall, add the body to `st.passing`, keep 0.7 × the horizontal speed |
| WALL_BLOCK_HEIGHT ≤ h < h_com (≈ 0.55 × body height, ≈ 0.95 m) | a hard knock (approach ≥ KNOCK_OVER_SPEED, suggest 6 m/s) TOPPLES the body over (as the curb, 0.6 × speed); anything softer holds like a wall |
| h ≥ h_com | holds unless breached: `hitWall(phys, approach, { resistance: seg.resistance, height: h, restitution: seg.bounce }, st.segIntegrity[k])` |

- Integrity becomes per segment (`ArenaState.segIntegrity: Float64Array`, index = plan segment); keep
  `st.integrity` as the MIN over segments for the HUD/snapshot. A breach opens ONE segment (and could
  set `plan.segments[k].height = 0` so the digest's `open[]` can be refreshed — see §5).
- `wallRestitution(cfg, …)` reads `cfg.wallBounce`/`cfg.wallResistance`: give it the segment's values.
- `wallFor(cfg)` (ArenaConfig) stays for legacy callers (= the base wall).
- `stepArenaBody` must not allocate: `segmentIndexAt` is a 6-step binary search, no allocation.
- `cfg.walls = 0` → `wallPlanFor` returns all-zero segments; the `walled` flag can keep gating the polygon.
- RingOut (`src/game/RingOut.ts`) needs nothing: an opening simply lets the body leave the outline.

## 4. The AI — `#aiStep` (opponent ≈2227, player-bot ≈2458: `const nearEdge = edgeDistance(...) < 1.5`)

Per frame per bot (allocation: `digestFeatures` returns one small object — pool it if the frame budget
complains):

```ts
const f = digestFeatures(this.#arenaDigest, o.body.x, o.body.z, p.body.x, p.body.z);
// f.edgeAway / f.openAway  — "I am being knocked toward an open edge": back off / circle
// f.openAngle / f.openDist — the nearest ring-out lane: steer so the line me→enemy points the enemy into it
// f.cover                  — a pillar between us (ranged/skill decisions)
const nearEdge = f.edgeAway < 1.5 && f.openAway === 1;   // a walled edge is no longer "dangerous"
```

Lane J-B's `src/game/DecisionTree.ts` already reads `Pick<ArenaDigest, "rim"|"wallHeight"|"open"|"openFraction">`
through its own `arenaFeatures` — pass `this.#arenaDigest` to it; the two feature sets overlap (pick one in
integration). The headless batch (lane J-B) should build the digest with the SAME pipeline as §1 so the
record's `digest` equals what the live AI saw.

## 5. Snapshot — `snapshot()` (≈4778; the `ring:` block ≈4815–4830, `wallHeight: +this.#arena.wallHeight.toFixed(2)` ≈4826)

Add, next to `wallHeight` (which stays: it is now the plan's BASE height):

```ts
walls: { rules: plan.rules.map((r) => r.kind), combine: plan.combine, base: plan.baseHeight,
         coverage: plan.coverage, mean: plan.meanHeight, max: plan.maxHeight, openSegments: plan.segments.filter((s) => s.height === 0).length },
symmetry: this.#arenaDigest.symmetry,
spawns: this.#arenaDigest.spawns,
digest: this.#arenaDigest,           // JSON-safe by contract (tests/arena_digest_test.ts round-trips it)
```

If a breach zeroes a segment (§3), recompute `this.#arenaDigest = arenaDigest(...)` on the breach event
(not per frame) so the AI sees the new opening.

## 6. Pins the parent may add to `tests/spec_test.ts`

- SPEC J1: random walls median < 1.2 m, p90 < 2 m, tall parts exist (tests/arena_walls_test.ts measures it).
- SPEC J2: every randomArena symmetry fits its outline (ringAsymmetry ≈ 0) — tests/arena_symmetry_test.ts.
- SPEC J3: digest arrays are DIGEST_DIRS long and JSON round-trip — tests/arena_digest_test.ts.
