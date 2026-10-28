# Low-Poly Constraints — budget, edge flow, connectors, operators

Specification for the lofted superellipse body model (`graphics/Loft.ts`,
`graphics/BodySurface.ts`, `game/ShapeEquations.ts`, `game/BodyProfile.ts`).
Every number below is a build-time constant; none is a suggestion.

Current model: `PART_SAMPLES = 11`, `PART_SIDES = 22`, `capRings = 3` — flat for
all 13 parts. That is 4862 vertices / 9152 triangles of geometry that spends the
same on a shin as on a hand. This spec replaces the flat budget.

---

## 1. Polygon / station budget

### 1.1 The rule

Side count is fixed by **class**, because any two parts joined by a connector must
share it (§3). Stations are per-part.

```
stations_min = clamp( 2 + nBulges + (pinch ? 1 : 0) + ceil(length / 0.20), 4, 12 )
```

`stations_min` is a floor. The table may exceed it where the part is a hero surface
(head, hand) or carries a joint at both ends.

### 1.2 Side classes

| Class | Sides | Angular step | Parts | Why |
|---|---|---|---|---|
| `T` torso | 20 | 18.0° | chest, abdomen, pelvis, neck, head, pectorals, scapulae | Section *is* the silhouette. Pectoral/lat/hip lobes need points to read as facets. Head and neck share the class so the neck→skull bridge is same-class. |
| `A` arm | 16 | 22.5° | upperArm, foreArm, hand | Limb reads as a tapered tube; the section is rarely the silhouette. Hand gets its definition from stations + lobes, not from sides. |
| `L` leg | 12 | 30.0° | thigh, shin, foot | Legs are seen at distance and under cloth. 30° facets are inside the cel-shaded flat-facet budget. |

Classes must match within a **bridged chain** (§3). The shoulder and hip are
**not** bridged (dome-in-socket, §5), so the arm and leg classes are free.

### 1.3 Budget table

`rings = stations + 2 * capRings`; `verts = rings * sides`;
`tris = (rings - 1) * sides * 2`.

| Part | Class | Stations | Sides | capRings | Rings | Verts | Tris | Reason |
|---|---|---|---|---|---|---|---|---|
| chest | T | 9 | 20 | 2 | 13 | 260 | 480 | 2 bulges + 1 pinch + 5 lobes; the widest silhouette, most-read part. |
| abdomen | T | 6 | 20 | 2 | 10 | 200 | 360 | 0 bulges, 1 pinch; the waist is the only feature. |
| pelvis | T | 5 | 20 | 2 | 9 | 180 | 320 | 1 bulge, 2 hip lobes; short and mostly hidden. |
| neck | T | 4 | 20 | 3 | 10 | 200 | 360 | Short, featureless cylinder; floor value. High cap (0.5) needs 3 cap rings. |
| head | T | 8 | 20 | 3 | 14 | 280 | 520 | Hero surface: face plane, jaw, occiput. Extra stations for the crown dome (cap 0.7). |
| pectorals | T | 6 | 20 | 2 | 10 | 200 | 360 | 1 bulge + 1 pinch + 5 lobes on a thin plate. |
| scapulae | T | 6 | 20 | 2 | 10 | 200 | 360 | 1 bulge + 1 pinch + 4 lobes; sits proud of the chest. |
| upperArm | A | 7 | 16 | 3 | 13 | 208 | 384 | 1 biceps bulge; both ends jointed (shoulder dome + elbow bridge). |
| foreArm | A | 7 | 16 | 3 | 13 | 208 | 384 | 1 bulge, strongest taper (bias 1.4); jointed both ends. |
| hand | A | 9 | 16 | 3 | 15 | 240 | 448 | Most-read extremity. Definition comes from **stations** (9 for 0.16 m) + thumb/pinky pads, not sides. |
| thigh | L | 7 | 12 | 3 | 13 | 156 | 288 | 1 quad bulge + 2 lobes; hip dome + knee bridge. |
| shin | L | 6 | 12 | 3 | 12 | 144 | 264 | 1 calf bulge. **Almost no definition** — floor value, fewest verts of any part. |
| foot | L | 6 | 12 | 3 | 12 | 144 | 264 | Arch/heel lobes only; short, low, rarely the silhouette. |
| | | | | | **TOTAL** | **2620** | **4792** | |

### 1.4 Defence against 11 × 22 flat

| | Flat 11×22 | This budget | Delta |
|---|---|---|---|
| Vertices | 4862 | 2620 | **−46.1 %** |
| Triangles | 9152 | 4792 | **−47.6 %** |
| Vertices on shin (waste) | 374 | 144 | −61 % |
| Vertices on hand (hero) | 374 | 240 | −36 % *sides*, but 9 stations vs 11 and 2 lobe columns vs 1 |
| Distinct lobe columns on hand | ~1 | 2 | more readable |

The flat budget is wrong in both directions: it over-spends on shin/foot/neck
(parts whose silhouette is set by taper, not section) and under-spends on the
hand's longitudinal definition. Cutting the shin from 22 to 12 sides and the
thigh to 12 buys the stations the hand and head need, at a net 47 % triangle
saving.

Hard ceiling: **total ≤ 2800 verts / 5200 tris.** Any part that exceeds its row
must borrow from a lower row, never raise the total.

---

## 2. Edge-flow constraints

The loft builder already emits the correct topology (`Loft.ts:129-137`): vertices
are station-major, and each triangle connects `r·S+i` to `(r+1)·S+i`. These rules
preserve it and forbid the things that break it.

### 2.1 Where loops MUST run

1. **A closed ring of edges at every joint plane** — at `t = 0` and `t = 1` of
   every part, and at both ends of every connector. These are the deformation
   rings; the rig's linear-blend weights sit on them.
2. **≥ 3 rings within `0.15 × length` of any joint.** A bend must be distributed
   over three or more segments. Two rings at a joint = one crease = the classic
   low-poly elbow fold.
3. **Longitudinal edges parallel to the part axis**, constant θ, station to
   station. Edge `r·S+i → (r+1)·S+i` for every `r`, `i`.
4. **One vertex column per lobe ridge.** A lobe's angle must be an exact multiple
   of `2π / sides` (§2.4), so its ridge sits on a column of vertices and reads as
   a facet edge rather than a smeared bump.

### 2.2 Where loops MUST NOT run

1. **No diagonal edge may cross a joint plane.** An edge whose θ changes between
   consecutive rings is a diagonal. At a bending joint a diagonal has different
   lengths under the two bones' weights and pinches to a spike. This is the
   single biggest cause of ugly low-poly deformation. The builder's axial edges
   are already safe; **never** retriangulate a joint ring as a fan or a
   Delaunay-style strip.
2. **No fan-from-single-apex on a bending end.** Cap domes may fan; parts joined
   by a connector must have `capRings = 0` at the joined end (§3.5).
3. **No edges crossing a lobe centre line.** Lobe columns are fixed; a triangle
   spanning two adjacent lobe columns flattens both ridges.

### 2.3 Valence

| Vertex | Valence |
|---|---|
| Interior grid vertex | 4 |
| Joint ring vertex | 4 (2 axial, 2 circumferential) |
| Cap ring vertex | 4 |
| Cap apex (if a single vertex) | `sides` — only on a non-bending end |
| Connector seam vertex | 4 (2 axial in A, 2 in connector — welded, not duplicated) |

### 2.4 Lobe-angle quantisation (mandatory)

Authored lobe angles in `BODY_PART_SHAPES` are off-grid. `2π/20 = 0.3142`; an
authored `0.45` sits between columns 1 and 2, so its ridge is smeared. Snap every
lobe angle to `round(angle / (2π/S)) * (2π/S)`:

| Sides | Step (rad) | Step (°) | Valid lobe angles (k = 0…S/2) |
|---|---|---|---|
| 12 | 0.5236 | 30.0 | 0, 0.5236, 1.0472, 1.5708, 2.0944, 2.6180, π |
| 16 | 0.3927 | 22.5 | 0, 0.3927, 0.7854, 1.1781, 1.5708, … |
| 20 | 0.3142 | 18.0 | 0, 0.3142, 0.6283, 0.9425, 1.2566, 1.5708, 1.8850, 2.1991, 2.5133, 2.8274, π |

Corrections to apply to the current table:

| Part | Authored | Class S | Snap to | Notes |
|---|---|---|---|---|
| chest | ±0.45 | 20 | ±0.3142 | pectoral |
| chest | ±1.6 | 20 | ±1.5708 | latissimus |
| pectorals | ±0.6 | 20 | ±0.6283 | lower fold |
| pectorals | ±1.57 | 20 | ±1.5708 | deltoid sweep |
| scapulae | ±2.2 | 20 | ±2.1991 | — |
| pelvis | ±1.5 | 20 | ±1.5708 | hip flare |
| hand | ±1.4 | 16 | ±1.5708 | thumb/pinky pads |
| foot | ±1.5 | 12 | ±1.5708 | arch/heel |
| shin | π | 12 | π | already on grid |

Minimum angular separation between two lobe centres: **0.35 rad (20°)** at S=20,
**0.39 rad (22.5°)** at S=16 — one full step. Closer lobes stack their gains and
are unresolvable.

### 2.5 Corner budget

`maxCorner` (`ShapeEquations.ts:139`) is measured on the sampled polygon.

| Part class | worstCorner ceiling | Meaning |
|---|---|---|
| Torso / head (section-driven) | **0.35 rad (20°)** | keeps the silhouette organic |
| Limbs / hand / foot | **0.55 rad (31.5°)** | the cel-shaded facet look |
| Hard limit (any part) | **0.60 rad (34°)** | above this the facet reads as a crease |

`π/2 = 1.571` is a right angle and fails the whole model. The class-side counts in
§1.2 are chosen so a section-driven part at `n = 2.45` still lands under 0.35.

---

## 3. Connector constraints

A connector is a short loft carrying part A's terminal section into part B's root
section (`Loft.ts:152`). It is a real surface, not a seam.

### 3.1 Sides

```
S_conn = S_A = S_B
```

**Equal, not max.** If A and B differ, the smaller ring's vertices lie on straight
chords while the larger ring's lie on the analytic curve; the gap is the chord
sagitta `r·(1 − cos(π/S))`, up to **5.8 mm** at the abdomen's radius. That is a
visible hairline crack, not a hidden one. Therefore **side count is a property of
the chain, not the part** — the classes in §1.2 exist precisely so every bridged
pair is same-class.

| Connector | S_A | S_B | S_conn |
|---|---|---|---|
| chest → abdomen | 20 | 20 | 20 |
| abdomen → pelvis | 20 | 20 | 20 |
| chest → neck | 20 | 20 | 20 |
| neck → head | 20 | 20 | 20 |
| upperArm → foreArm | 16 | 16 | 16 |
| foreArm → hand | 16 | 16 | 16 |
| thigh → shin | 12 | 12 | 12 |
| shin → foot | 12 | 12 | 12 |

### 3.2 Angular phase (the spiral)

Every ring is sampled at `θ_k = k·(2π/S) + φ` with the Loft builder's phase
origin `φ = 0` (θ = 0 at +z, front). Two rings with the **same S and same φ**
have coincident angles, so connecting vertex `k` of A's terminal ring to vertex
`k` of the connector's first ring is a pure translation — no twist.

A spiral appears only when `S_A ≠ S_B` and you connect index `k` to index `k`:
A's `k` sits at `k·2π/S_A`, B's at `k·2π/S_B`, and the offset grows to
`2π·(1/S_A − 1/S_B)` by the wrap — a full turn of accumulated twist. Rule:

> The connector must resample **both** end sections at `S_conn` using
> `θ_k = k·2π/S_conn + 0`, then connect `k ↔ k`. Never connect unequal-index
> rings directly.

Because §3.1 forces `S_conn = S_A = S_B`, resampling is the identity and the rule
is satisfied by construction.

### 3.3 What the two end sections must share

| Property | Requirement | Failure if not |
|---|---|---|
| `sides` | equal | spiral (§3.2) |
| phase origin `φ` | equal (0) | spiral |
| lobe angles | identical set, exact (tol `1e-6`) | a ridge pops at the seam |
| lobe angles on grid | multiples of `2π/S` | ridge smears at the seam |
| A's terminal `radius, depth, n` | copied verbatim into the connector's first station | step discontinuity in the silhouette |
| B's root `radius, depth, n` | copied verbatim into the connector's last station | step discontinuity |

`blendStations` (`Loft.ts:59`) matches lobes by angle with tolerance `1e-6`; a
lobe present at one end only must fade to `amp = 0` over the bridge — which the
function already does. That guarantee depends on the `1e-6` match, which in turn
depends on the on-grid quantisation in §2.4.

### 3.4 Station count

```
stations_conn = clamp( ceil(S_conn / 5), 3, 6 )
```

Fewer than 3 intermediates and the bridge reads as a cylinder segment with two
hard rings at its ends. More than 6 is wasted on a 0.05–0.10 m bridge.

| S_conn | 12 | 16 | 20 |
|---|---|---|---|
| stations | 3 | 4 | 4 |

`blendStations(a, b, count)` yields `count − 1` intermediates; the current call
uses `count = 4` → 3 stations. For S_conn = 20 use `count = 5` → 4 stations.

### 3.5 Connector cap

```
capRings = 0
```

**The current `connectorGeometry` default of `capRings = 2` is a defect.** It
domes both ends of the bridge *into* the parts it joins, creating a self-
intersecting collar that pokes through the neighbour's surface. A connector's
ends are welded to the neighbours' rings, so no cap exists there. Only the
non-joined ends of a part (the shoulder dome, the hip dome) get cap rings.

### 3.6 Seam continuity

The connector's first ring must be the **same station object** as A's last, and
its last ring the same as B's first — copy the `radius/depth/n/lobes/offset`,
not an approximation. `blendGain` (smoothstep) gives matched tangents at both
ends, so no crease forms at the seam.

---

## 4. Shape-operator limits

`r(t,θ) = taper(t) · (1 + Σ bulge(t)) · pinch(t) · (1 + lobeGain(θ))`.

### 4.1 Taper — `taper(t, root, tip, bias)`

| Param | Min | Max | Breaks below min | Breaks above max |
|---|---|---|---|---|
| `root` (m) | 0.02 | 0.50 | degenerate section, cap dome collapses | wider than its parent socket, self-intersects at the joint |
| `tip / root` | 0.35 | 1.00 | needle tip; the cap dome (≤ 0.85) balloons past the next part | no taper — the part reads as a tube and the joint has no clearance |
| `bias` | 0.50 | 1.80 | concave root flare; a crease appears and `maxCorner` fails | convex tip flare; tip radius outruns `tip` and can exceed `root` |

### 4.2 Bulge — `bulge(t, c, w, amp)`

| Param | Min | Max | Breaks below min | Breaks above max |
|---|---|---|---|---|
| `c` (centre) | 0.15 | 0.85 | no room to fall to zero before the end → end radius uncontrolled, connector cannot match | same, at the far end |
| `w` (width) | 0.12 | 0.40 | narrower than station spacing `1/(stations−1)`; peak aliases between stations, muscle flickers | spans the whole part, flattening the taper into a tube |
| `amp` | 0.00 | 0.35 | (n/a) | peak exceeds base taper by >35 %; section becomes wider than the root → self-intersects with the neighbouring part at the joint |

### 4.3 Pinch — `pinch(t, c, w, depth)`

| Param | Min | Max | Breaks below min | Breaks above max |
|---|---|---|---|---|
| `c` | 0.20 | 0.80 | as bulge | as bulge |
| `w` | 0.15 | 0.40 | aliases between stations | flattens the whole part |
| `depth` | 0.00 | 0.45 | (n/a) | radius drops below 0.55×; the waist pinches to a neck, and with a simultaneous bulge the profile inverts → negative radius |

### 4.4 Lobe — `{ angle, amp, sharp }`

| Param | Min | Max | Breaks below min | Breaks above max |
|---|---|---|---|---|
| `angle` | on grid (§2.4) | on grid | off-grid ridge smears between columns | — |
| `amp` | −0.15 | +0.30 | groove cuts >15 % of radius; two overlapping grooves drive gain ≤ 0 → inverted normals | radius > 1.30× base; two overlapping lobes sum past the far wall → self-intersection |
| `sharp` | 1.50 | `sharp_max(S)` below | lobe spans >100° and merges with its neighbours — no readable ridge | ridge narrower than the angular point spacing → aliases and flickers between stations |

`sharp_max` = the sharpness at which the lobe's half-power width still contains
≥ 3 sampled points:

```
sharp_max(S) = ln(0.5) / ln( cos(3π / S) )
```

| Sides S | 12 | 14 | 16 | 18 | 20 | 22 | 24 |
|---|---|---|---|---|---|---|---|
| `sharp_max` | 2.00 | 2.82 | 3.76 | 4.82 | 6.01 | 7.32 | 8.76 |

Authored `sharp` values run 2.0–3.5. At the new S = 12 (legs) and S = 16 (arms),
any lobe with `sharp > 2.00` / `> 3.76` respectively must be reduced. Check:
shin calf `sharp 2.4` at S = 12 **violates** → set to 2.0. Hand pads `sharp 2.2`
at S = 16 pass.

Sum rule: for every θ, `|lobeGain(θ)| ≤ 0.45`, and `lobeGain(θ) ≥ −0.25`.
Per-lobe `amp` in `[−0.15, +0.30]` plus the 0.35 rad separation rule (§2.4)
guarantees this.

### 4.5 Section exponent — `n`

| Bound | Value | Below → | Above → |
|---|---|---|---|
| min | **1.75** | diamond corners at θ = 0, π/2; `worstCorner` climbs toward π/2 | — |
| max | **2.45** | — | squared-off box corners; section reads as a rounded rectangle, breaking the organic read |

Minimum sides for a section-driven part, to hold `worstCorner ≤ 0.35`:

```
sides_min = ceil( 6·(n − 1) + 8 )
```

| n | 1.75 | 2.00 | 2.10 | 2.35 | 2.45 |
|---|---|---|---|---|---|
| `sides_min` (torso class) | 13 | 14 | 15 | 17 | 18 |

All torso parts use S = 20 ≥ 18 → satisfied for every race and sub-race,
including `bloodfang` (`sectionN = 2.45`). Limb parts are exempt: their
silhouette is set by taper, not by the section corner.

### 4.6 Cap — `cap` / `capDepth`, `capRings`

| Param | Min | Max | Breaks below min | Breaks above max |
|---|---|---|---|---|
| `capDepth` | 0.15 | 0.85 | flat disc cap = a ring of right angles (`maxCorner` → π/2) | dome balloons `0.85 × end radius` past the end, into the neighbouring part |
| `capRings` | 2 | 3 | one ring is a hard shoulder, still a near-right-angle | wasted rings on a small dome |

Use `capRings = 3` where `cap ≥ 0.5` (neck, head, upperArm, foreArm, hand,
thigh, shin, foot) and `2` otherwise (chest, pectorals, scapulae, abdomen,
pelvis). Connectors: `capRings = 0` (§3.5).

---

## 5. Mesh merging and separation

### 5.1 Rule

> Merge parts **only** when they are rigid to the **same bone** and share the
> same `sides` and phase. Everything else stays a separate mesh.

A merged mesh is a buffer concatenation — no welding, no shared vertices — so
the only requirement is identical topology parameters.

### 5.2 Ownership

| Mesh | Bone | Parts | Sides |
|---|---|---|---|
| torsoPlate | spine | chest + pectorals + scapulae | 20 |
| abdomen | abdomen | abdomen | 20 |
| pelvis | root | pelvis | 20 |
| neck | neck | neck | 20 |
| head | head | head | 20 |
| upperArmL/R | shoulder | upperArm | 16 |
| foreArmL/R | elbow | foreArm | 16 |
| handL/R | wrist | hand | 16 |
| thighL/R | hip | thigh | 12 |
| shinL/R | knee | shin | 12 |
| footL/R | ankle | foot | 12 |

**Mergeable:** `chest + pectorals + scapulae` → `torsoPlate` (660 verts,
1200 tris). All three are rigid to the spine bone and all three are T-class
(S = 20). The overlays keep their own stations and lobes; concatenating their
buffers changes nothing visually and removes two draw calls.

**Must stay separate** — each pair spans a joint, i.e. two different bones:

| Pair | Joint |
|---|---|
| chest ↔ abdomen | spine / abdomen |
| abdomen ↔ pelvis | abdomen / root |
| chest ↔ neck | spine / neck |
| neck ↔ head | neck / head |
| upperArm ↔ foreArm | elbow |
| foreArm ↔ hand | wrist |
| thigh ↔ shin | knee |
| shin ↔ foot | ankle |

### 5.3 Shoulder and hip are not connectors

The shoulder (chest → upperArm) and hip (pelvis → thigh) are **cross-class**
joints (20 → 16 and 20 → 12). They are **not** bridged. The limb's root dome
(`cap = 0.8`, `capRings = 3`) sits inside the torso's surface, and the torso's
own lobes cover the gap: chest carries the latissimus lobes at ±1.5708 and the
pelvis carries the hip flare at ±1.5708. This is why `upperArm` and `thigh` have
the largest `cap` values (0.8) in the profile — that number is a socket depth,
and it must stay ≥ 0.7 to hide the joint.

---

## 6. Defects this spec fixes in the current code

| # | Location | Defect | Fix |
|---|---|---|---|
| 1 | `BodySurface.ts:17-19` | flat `11 × 22` for all parts | per-part table §1.3 |
| 2 | `Loft.ts:157` | `connectorGeometry` default `capRings = 2` domes the bridge into its neighbours | `capRings = 0` |
| 3 | `Loft.ts:157` | connector `sides = 18` mismatches every class | `sides = S_conn = class value` |
| 4 | `Loft.ts:159` | `blendStations(..., 4)` gives 3 stations regardless of `S_conn` | `ceil(S_conn/5)`, clamped [3, 6] |
| 5 | `BodyProfile.ts:126-130` etc. | lobe angles off the section grid (0.45, 0.6, 1.4, 1.5, 1.6, 2.2) | snap to `k·2π/S` (§2.4) |
| 6 | `BodyProfile.ts:199` | shin calf lobe `sharp 2.4` exceeds `sharp_max(12) = 2.00` | `sharp = 2.0` |
| 7 | `BodySurface.ts:60` | `capRings = 3` for all parts | 3 where `cap ≥ 0.5`, else 2 |
