# Sculpt constraints: joining independently animated pivots

Scope: how the torso (spine / abdomen pivots) and a limb (shoulder / hip pivots)
can present one continuous skin across the joint when geometry is **merged per
pivot** and each pivot draws exactly one ink outline.

Source of the constraint: `src/graphics/Humanoid.ts` (`part()` / `flushParts()`
accumulate geometry per pivot and emit one `createCelMesh` per pivot),
`src/graphics/Loft.ts` (`connectorGeometry`, `blendStations`, `loftGeometry`),
`src/game/BodyGraph.ts` (`BODY_LINKS` with `seat` / `blend`).

---

## 1. Diagnosis: why a connector placed at the limb pivot fails

### 1.1 The frames involved

Each part is a loft whose sections live in the **part's own local frame**:
`loftGeometry` puts the root section at local `y = 0`, the tip at `y = height`,
and every section is a superellipse in that part's local **x–z plane**, with
lobes at angles measured in that part's frame (`BodyProfile.ts`: angle `0` = +z
front, `π/2` = the body's left).

A pivot's local frame is the pivot `Group`'s frame. `makePivot` places the
pivot at an offset in its **parent's** frame, and `update()` applies only a
`rotation.x` to it. So:

- `spine` frame origin = `(0, spineY, 0)` in the rig.
- `shoulderL/R` origin = `(±(sil.shoulder − 0.13)·weightScale, 0.16, 0)` **in the spine frame**.
- `hipL/R` origin = `(±(sil.hip − 0.12)·weightScale, −0.22, 0)` **in the abdomen frame**.

The chest geometry is merged into the **spine** bucket; the upper-arm geometry
into the **shoulder** bucket; the pelvis into the **abdomen** bucket; the thigh
into the **hip** bucket.

### 1.2 The step at rest

The chest's lateral surface at the shoulder height (`spine y ≈ 0.16`, ≈ `t 0.70`
along the chest) sits at `x ≈ ±0.33·width` (root `0.36·width`, taper `[1.0,0.72,1.2]`
at `t≈0.70`, plus the latissimus lobe `amp 0.18` at `angle ±1.6`). The shoulder
pivot is placed at `±(0.46 − 0.13)·weightScale = ±0.33·weightScale` — i.e. **on**
that surface. The upper arm's root section radius is `0.10·width` (`upperArm.root`).
So a **0.10·width** ring butts against a **≈0.33·width** wall: the two surfaces
meet end-to-end and the eye reads a detached tube. Same at the hip: thigh root
`0.13·width` against a pelvis/pelvis-flare surface of `≈0.30–0.35·width`.

### 1.3 Why the connector-at-the-limb-pivot fix fails, in frame terms

The failed attempt was effectively:

```
part(elbowPivot_or_shoulderPivot,
     connectorGeometry(stationsFor("chest")[PART_SAMPLES-1],   // A end
                       stationsFor("upperArm")[0],             // B end
                       0.14),
     [0, 0.07, 0], [Math.PI, 0, 0]);
```

Four independent errors, all of them frame errors:

1. **Wrong frame for the A end.** `stationsFor("chest")[10]` is a section defined
   in the **chest (spine) frame**, centred on the spine axis (`x = 0`,
   `z = chestBow·0.5`). The connector is a child of the **shoulder** pivot, so the
   mesh is built around the shoulder origin at `x = ±0.33·width`. A chest-sized
   ring (tip radius `0.36·width·taper(1) ≈ 0.26·width`, plus lobes) centred at
   `x = 0.33·width` spans `x ∈ [0.07·width, 0.59·width]`: the inner half is buried
   in the chest, the outer half protrudes — **the "blade."**

2. **Wrong station along the chest.** `[PART_SAMPLES-1]` is the chest **tip**
   (`t = 1`, spine `y = 0.33`). The shoulder sits at spine `y = 0.16` (`t ≈ 0.70`),
   where the chest radius and lobe amplitudes are different. Even the section
   *shape* is the wrong one.

3. **Wrong orientation.** The chest section lies in the **x–z plane** (normal +y).
   The connector is rotated `π` about x so its axis hangs down; its A-end ring
   therefore ends up **horizontal**, centred on the shoulder, perpendicular to the
   chest's vertical lateral wall. That is a T-junction, not a continuation — **the
   notch.**

4. **Wrong ownership under animation.** The connector is a child of the shoulder
   pivot, so `update()` rotates it with the arm. Its A end is supposed to stay
   glued to the chest, but it swings away the moment the shoulder rotates — tearing
   even if the rest pose were perfect.

### 1.4 The general impossibility

A bridge between two pivots has **two ends that must live in two different
frames**: the parent end must be expressed in the parent pivot's frame (so it stays
on the torso), the child end in the child pivot's frame (so it stays on the limb).
A single mesh is parented to exactly one pivot, so it can satisfy **at most one**
end. **No single bridging mesh can join two independently animated pivots.**

The only way out: split the join into a **parent-owned** piece and a
**child-owned** piece, and have them meet on a locus that is **invariant under the
child's rotation**. A rotation about a pivot fixes exactly one family of surfaces:
**spheres centred on that pivot.** So the meeting locus must be a sphere centred on
the joint.

---

## 2. Scheme comparison

| | (a) torso collar reaching to the limb root | (b) limb root matches torso section | (c) torso-drawn socket, limb root overlaps in | (d) shared sphere / ball-and-socket |
|---|---|---|---|---|
| **Idea** | torso draws a cuff from the chest surface out to a ring at the limb's root plane | build `upperArm` so its root section equals the chest's local section at the socket | torso draws a socket shell at the pivot; limb's root cap buried inside it | socket and limb head are both spherical shells of radius R about the pivot |
| **Survives animation?** | **No.** The rim is a planar ring; rotating the limb tilts its root out of that plane → the rim opens into a visible hole. | **No.** The match is only true at rest; any rotation tilts the limb's root ring off the chest surface → the step returns. | **Yes**, if the socket is a **sphere centred on the pivot**: rotation maps the sphere to itself and keeps the limb's root (which is within radius `r_limb` of the pivot) inside it. | Yes in principle, but the two shells are **coincident** where they overlap → z-fight; and the limb's shell rotates while the torso's shell does not, so they cannot stay complementary. Rejected. |
| **One outline per pivot?** | Yes (collar merges into torso). | Yes. | Yes (socket merges into the parent pivot; limb stays its own). | Yes. |
| **Visible seam where the collar ends?** | Yes — a free rim that opens under rotation. Fatal. | Yes — the step it was meant to remove. | Only a **crease** where the limb exits the sphere (a dihedral line, not a free edge). The crease migrates with the pose and reads as the deltoid / gluteal boundary. Acceptable and desirable. | None, but unbuildable as above. |
| **Why rejected** | planar termination is not rotation-invariant | rest-pose-only match | — | coincident shells z-fight; cannot be tiled across a rotating joint |

**Verdict.** Option (c), tightened to the one construction that is actually
rotation-invariant: **the parent pivot owns a socket that is a sphere centred
exactly on the child pivot's origin.** (a) is (c) with the wrong termination
(planar instead of spherical). (b) is a rest-pose-only match. (d) is
geometrically sound but not realisable as two disjoint meshes. The sphere is the
unique invariant, so (c) is the winning scheme.

The socket must be owned by the **parent** pivot (spine for the shoulder, abdomen
for the hip). If the limb owned it, the socket would rotate with the limb and the
torso's blend point would tear instead.

---

## 3. Recipe for the winning scheme

All quantities are in the rig's **local (pre-`heightScale`) space**, the same space
as the pivot offsets, which are already multiplied by `weightScale`. The whole
group is scaled uniformly by `heightScale` afterwards, so nothing here changes.

### 3.1 Shoulder socket (owned by `spine`)

```
const armRootR   = stationsFor("upperArm", sil)[0].radius;   // metres = 0.10 * sil.width
const R_shoulder = 1.35 * armRootR;                           // socket ball radius

const sx        = side === "L" ? sil.shoulder : -sil.shoulder;
const shoulderX = (sx - Math.sign(sx) * armSeat) * weightScale;   // armSeat = 0.13
// same shoulderX the makePivot call uses:

part(spine, sphereGeo(R_shoulder, PART_SIDES, 16), [shoulderX, 0.16, 0]);
```

- **Section:** a true circle — `n = 2.0`, `depth = 1.0`, `lobes = []`. Do **not**
  flatten or lobe the socket: any non-spherical deviation destroys the rotation
  invariance and reintroduces the step under animation.
- **Frame:** the spine (parent) frame, centred at the shoulder pivot's rest offset
  `(shoulderX, 0.16, 0)`.
- **Orientation:** none (a sphere is rotationally symmetric).
- **Geometry call:** `new THREE.SphereGeometry(R_shoulder, PART_SIDES, 16)`
  translated to `(shoulderX, 0.16, 0)`. `SphereGeometry` is already used in this
  file (ears, hair cap), so it does not violate the "no primitives for body parts"
  rule; alternatively loft `stations = R·sin(π·t)` over 13 stations. Triangle cost
  ≈ `22·16·2 = 704` per socket.
- **Point count / phase:** `sides = PART_SIDES (22)`, `rings = 16`. θ origin at
  **+z** to match the body convention. Phase alignment is **not geometrically
  required** here because the socket is a disjoint surface inside the merged
  spine mesh (merge does not weld), but keeping 22 sides / +z origin keeps it
  consistent if a blended skirt is ever added.
- **No skirt at rest:** the chest occludes the sphere's inward half (the sphere
  spans `x ∈ [shoulderX − R, shoulderX + R] = [0.19w, 0.47w]`; the chest surface is
  at `≈0.33w`, so the inner half is inside the chest). For thin races where the
  chest may not fully occlude (elf `width 0.84`), add a short loft blending the
  chest's lateral section into the sphere's inner hemisphere — but keep the
  **outer** hemisphere pure sphere.

### 3.2 Hip socket (owned by `abdomen`)

```
const thighRootR = stationsFor("thigh", sil)[0].radius;   // metres = 0.13 * sil.width
const R_hip      = 1.35 * thighRootR;

const sx   = side === "L" ? -sil.hip : sil.hip;
const hipX = (sx - Math.sign(sx) * hipSeat) * weightScale;    // hipSeat = 0.12

part(abdomen, sphereGeo(R_hip, PART_SIDES, 16), [hipX, -0.22, 0]);
```

Same rules; the hip pivot's parent is `abdomen`, so the socket is added to the
`abdomen` bucket (the same bucket that already draws the pelvis).

### 3.3 Limb side (no change required)

The upper arm / thigh geometry already hangs from its pivot with its root dome
inside radius `r_limb` of the pivot, so it is automatically inside the socket.
The limb's root cap must stay **opaque** so the buried cap is never seen. Do **not**
move the limb's root station down to meet the sphere — leave it at the pivot and
let the socket hide it.

### 3.4 Why this preserves one outline per pivot

The socket is merged into the parent pivot's single `createCelMesh`; the limb keeps
its own. The union shows the limb emerging from the socket ball. The only extra
contour is the **crease** where the limb's cylinder crosses the sphere — one ink
line per pivot at the deltoid / gluteal boundary, which is anatomically correct.
No free rim exists, so there is no seam that can open.

---

## 4. Behaviour under a bend

The join is pose-correct for **every** rotation of the child pivot iff all of:

1. **The socket is a sphere of radius `R` centred exactly on the child pivot's
   origin** expressed in the parent frame. A rotation about the pivot maps this
   sphere to itself.
2. **`R ≥ ρ`**, where `ρ = max |p − pivot|` over the child's root region. Because
   the pivot rotates about its own origin and the limb is rigid, `ρ` is
   pose-invariant and equals the root section's max radius `r_limb` when the limb's
   `cap ≤ 1` (current `upperArm.cap = 0.8`, `thigh.cap = 0.8`). If `cap > 1`,
   `ρ = cap·r_limb` and `R` must be raised accordingly.
3. **The child pivot's offset in the parent frame is constant.** True: `update()`
   applies only `rotation.x` to the pivot; its position never changes, so the
   socket and the pivot stay coincident for the whole animation.
4. **The child's root cap is opaque** and is never translated off the pivot by any
   animation (the current rig does not translate pivots).
5. **The socket is scaled in the same space as the pivot offset** (i.e. it uses the
   same `weightScale` as `shoulderX` / `hipX`). A mismatch detaches the ball from
   the chest.

Under (1)–(5) there is **no pose that opens a gap**: rotating the shoulder 90° in
any direction slides the exit-crease around the sphere while the limb's root stays
buried; the deltoid ball stays put. The crease deepens or shallows smoothly but
never tears and never balloons.

**What is still a problem at extreme bends (not the socket's job):**

- At high abduction the **upper-arm tube** can enter the chest / neck (worst for
  wide races: ork `width 1.34`, dwarf `1.30`). This is self-intersection, not a
  socket failure. Bound it with the joint ranges from
  `constraintList` / `STATE_JOINT_SCALE` (`BodyProfile.ts`) — keep shoulder
  abduction under ~75° from rest and flexion under ~90°.
- A rolled arm can drive the elbow into the ribs; again a pose-limit fix.

The socket holds at any angle; only limb-vs-torso collision is left to joint limits.

---

## 5. Parameter bounds

| parameter | default | min | max | breaks at min | breaks at max |
|---|---|---|---|---|---|
| `k` (socket radius factor) `R = k·r_limb` | **1.35** | 1.15 | 1.80 | `k < 1.0`: limb root ring pokes outside the sphere → visible flange/hole that changes as the arm moves. `k ∈ [1.0,1.15]`: works but zero margin — any `weightScale`/silhouette mismatch leaves a sliver gap; shoulder has no mass. | `k > 1.8`: shoulder reads as a golf ball; for thin races the ball exceeds the chest silhouette and appears to float; the arm emerges so low it looks stubby. |
| `r_limb` (source) | `stationsFor(part,sil)[0].radius` | — | — | — | must be read from the built station (tracks `sil.width`), not hard-coded, or the socket drifts off the limb for ork/dwarf/elf. |
| socket `sides` (points around) | **22** (`PART_SIDES`) | 16 | 32 | `< 16`: faceted shoulder, polygonal outline. | `> 32`: wasted triangles, no visible gain. |
| socket `rings` (latitude) | **16** | 10 | 24 | `< 10`: visible banding/facets on the ball. | `> 24`: waste. |
| `seat` (existing, m) | shoulder 0.13 / hip 0.12 | 0.00 | 0.20 | `0.00`: pivot sits on the chest's lateral surface (`x ≈ 0.33w`), ball half-buried, no deltoid mass. | `> 0.20`: pivot pulled toward the spine, ball merges into the chest core, deltoid/gluteal mass vanishes, limb seems to come from inside the torso. |
| limb `cap` (existing) | 0.8 | — | 1.0 | — | `> 1.0`: `ρ` becomes `cap·r_limb`, so `R_min` rises — recompute `R` or the root dome pokes out of the sphere. |
| shoulder pose range | from `constraintList` | — | abduction ~75°, flexion ~90° from rest | — | beyond: upper arm enters chest/neck (collision, not socket). |

Sockets add ≈ `22·16·2 ≈ 704` tris each; 4 sockets (2 shoulders + 2 hips) ≈ 2816
tris — negligible.

---

## 6. One-line summary for the implementer

Add a **sphere of radius `1.35·r_limb` centred on each shoulder/hip pivot,
merged into the parent pivot's bucket** (`spine` / `abdomen`), pure circle section,
22 sides / 16 rings, no lobes; leave the limb geometry at its pivot. The limb's
root cap is then always buried inside a surface that is invariant under the joint's
rotation, so the join holds for any pose and each pivot still draws one outline.
