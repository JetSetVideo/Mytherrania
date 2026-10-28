# Silhouette Constraints — 2D-Drawing Proportion, Symmetry & Read Rule

Scope: the four playable races (human, elf, dwarf, ork) + 12 sub-races. This is the
2D-concept constraint set the body generator and rig must obey so that every race reads
as its own silhouette at gameplay distance (third-person, character small on screen),
and so random variation can never produce a body that reads as the wrong race.

Source of truth for the numbers: `src/game/BodyProfile.ts` (`RaceSilhouette`,
`BODY_PART_SHAPES`, `SILHOUETTE_TOP`, `randomSilhouette`), `src/game/RaceAppearance.ts`,
`src/game/SpineCurve.ts`. Every constraint below is expressed in metres at 1.0 scale,
`x` = right/left (mirror axis at `x = 0`), `+z` = front, `+y` = up.

---

## 0. Invariants (hard, never violated by any roll)

Let `W` = width knob, `H` = height knob, `D` = depth knob, `M` = muscle knob, `N` = section exponent.

```
RACE ORDERING — must hold under every jitter:
  stature:   dwarf  < human  < elf   < ork      (0.80 < 1.00 < 1.05 < 1.12)
  breadth:   elf    < human  < dwarf ≤ ork      (0.84 < 1.00 < 1.30 < 1.34)
  slenderness (limbTaper, higher = spindlier): dwarf < ork < human < elf
```

Full orders:
- stature: `dwarf 0.80 < human 1.00 < elf 1.05 < ork 1.12`
- breadth: `elf 0.84 < human 1.00 < dwarf 1.30 < ork 1.34`
- slenderness: `dwarf 0.78 < ork 0.85 < human 1.00 < elf 1.25`

The generator's per-knob bands (Section 4) are disjoint where two races must not be
confusable (elf vs human girth, dwarf vs human stature); where two races may overlap
(dwarf vs ork girth), they are separated by stature, `limbTaper`, `N`, and muscle.

---

## 1. Proportion system (head-units + ratios)

### 1.1 Head-units

Head-units = stature ÷ head-height. Design target, anchored to a 7.5-head human
baseline and the code's relative `head` knob:

```
head_units = 7.5 × (height ÷ head)

race    height  head   head-units   convention drawn on
human   1.00    1.00   7.5          heroic-leaning realistic (7.5–8 h)
elf     1.05    0.98   8.0          elongated heroic (8–8.5 h)
dwarf   0.80    1.12   5.4          stocky/dwarfen fantasy (4.5–5.5 h)
ork     1.12    1.08   7.8          heroic bruiser, big head, short neck (7.5–8 h)
```

Convention reference used throughout: **realistic 7–7.5 h**, **heroic 8 h** (fashion/
sport figure-drawing canon: 8 heads, shoulders ~2 head-widths, hip at the 4-head
line), **stocky 4.5–5.5 h** (dwarf/dwarfen canon: head large, torso long, limbs short,
shoulder ≈ hip). Elves pull the heroic figure one notch taller and one notch thinner;
orks keep the heroic height but add breadth and drop the neck.

### 1.2 Ratios (shoulder span : hip span : torso length : limb length)

Effective spans computed from the silhouette params (shoulder/hip offsets + limb root):
`span = 2 × (offset + limb_root × W)`. Torso = pelvis+abdomen+chest+neck, ×H.
Limb = upperArm+foreArm+hand, ×H. Normalised to human shoulder span = 1.00.

```
race    shoulder  hip    torso   limb    (S : Hp : T : L)
human   1.00      0.768  1.268   0.911
elf     0.864     0.659  1.331   0.956     ← slimmest shoulders, longest relative limb
dwarf   1.125     0.909  1.014   0.729     ← broadest-relative, shortest stature
ork     1.204     0.883  1.420   1.020     ← broadest, tallest-relative torso
```

Absolute spans (m, at 1.0 scale) the generator should land near:

```
race    shoulder span   hip span   torso len   limb len   shoulder:hip
human   1.12            0.86       1.42        1.02       1.30
elf     0.97            0.74       1.49        1.07       1.31
dwarf   1.26            1.02       1.14        0.82       1.24
ork     1.35            0.99       1.59        1.14       1.37
```

### 1.3 Limb-length index (limb ÷ torso) — recognisability constraint

```
race    design target   code produces (uniform stature scale)
human   0.72            0.718
elf     0.78            0.718
dwarf   0.60            0.718
ork     0.70            0.718
```

**Recognisability constraint:** `limb:torso` must sit in
`[0.70, 0.76]` (human/ork), `[0.74, 0.82]` (elf), `[0.55, 0.66]` (dwarf).
A race is recognisable iff its `limb:torso` and its head-unit count both fall inside the
band; if either leaves the band the figure reads as a scaled human, which is the single
most common failure mode.

> **Tension flag (action for the parent):** `partShape()` in `BodyProfile.ts` keeps part
> lengths fixed and applies stature as one *uniform* scale, so `limb:torso` is a constant
> 0.718 for all four races — dwarves get *shrunken humans*, not *short-limbed dwarves*.
> Hitting the dwarf/elf targets needs a `limbLength` knob (multiplier on the sum of
> upperArm+foreArm+hand+thigh+shin, compensating the torso to keep stature). Without it
> the dwarf constraint "smallest **and** shortest-limbed" is only half met.

---

## 2. Symmetry constraints

Mirror axis: the vertical centre plane `x = 0` (the sagittal plane). The body is
generated from one half and reflected; the rig must never break that.

### 2.1 Parts that MUST be perfectly mirrored (all 13)

Every lofted part is a surface of revolution about the spine and is generated
symmetric. Paired left/right lobes and paired limb parts must be identical:

| Part | mirror requirement |
|---|---|
| chest | symmetric; lobes at `±0.45` (pec) and `±1.6` (lat) must share amp & sharp **exactly** |
| abdomen | symmetric; `0`/`π` lobes sit on the plane |
| pelvis | symmetric; hip-flare lobes at `±1.5` identical |
| neck | symmetric |
| head | symmetric (features may add markings, not geometry) |
| pectorals | symmetric; `±1.57` and `±0.6` lobe pairs identical; `0` sternal groove on-plane |
| scapulae | symmetric; `±2.2` pairs identical; `π` spine & `0` valley on-plane |
| upperArm | L/R identical (biceps/triceps lobes `0`/`π` on-plane) |
| foreArm | L/R identical |
| hand | L/R identical (`±1.4` pads identical) |
| thigh | L/R identical |
| shin | L/R identical |
| foot | L/R identical (`±1.5` arch/heel identical) |

**Scalar-parameter tolerance: 0.** A mirrored pair (`shoulderL/R`, `elbowL/R`,
`hipL/R`, `kneeL/R`, `ankleL/R`, `toeL/R`, and all `±θ` lobe pairs) must carry
identical amp and sharp — the generator may not roll them independently.

**Mesh tolerance: 1 mm.** After posing the body in the canonical **T-pose**, reflect the
mesh about `x = 0` and take the per-vertex deviation. Pass iff
`max|v.x − (−v′.x)| ≤ 0.001 × height` m:

```
race    tolerance (m)
human   0.0010
elf     0.0011
dwarf   0.0008
ork     0.0011
```

### 2.2 What MAY be asymmetric (whitelist)

Only these, and none of them touch the 13 body parts' geometry:

- **Hair** — parting, braid/topknot/mohawk offset, `HAIR_LENGTH_M` grown from one seed.
- **Face markings / scars / warpaint** — texture or decal only, never mesh displacement.
- **The weapon** — see 2.3.
- **Sub-race overlays** (e.g. `ironhide` plate decals) — must be applied symmetrically or
  as surface texture.

Everything else (a dominant arm, an uneven shoulder, a lopsided pelvis, mismatched
limb girth) is **forbidden** — it defeats the mirror test and is not part of any race's
identity.

### 2.3 Weapon vs asymmetry

The weapon is **NOT body asymmetry**. It is a separate transform parented to a hand
joint and is excluded from the symmetry test entirely:

- The mirror test runs on the body mesh with the weapon **detached / hidden**.
- `silhouetteScore()` and the reflect-and-subtract acceptance test must never include
  weapon vertices.
- The weapon's own placement (one hand, one side) must not be used to justify any
  asymmetry in `shoulderL/R`, arm girth, or stance.

### 2.4 T-pose interaction

The **T-pose is the canonical symmetry-check pose**: arms extend along `±x`, feet on the
ground, spine neutral. In T-pose:

- Both hands are posed to the **identical neutral** (no weapon grip asymmetry baked into
  the rest pose).
- `constraintList()` must return equal `min`/`max` for every L/R joint pair in every
  state — asymmetry is only ever introduced by *animation curves at runtime*, never by
  the rest rig.
- The reflect-and-subtract test is performed in T-pose only. Other states (`attack`,
  `block`, `walk`) are legitimately asymmetric by pose; they are **not** tested for
  mirror equality, only the T-pose rest geometry is.

---

## 3. Silhouette rule (one feature per race, readable at 20 m)

Test: render the character at third-person distance (character ≈ 30–50 px tall on a
1080p frame), silhouetted solid black. If the feature is not visible in that black
shape, it is **not** a silhouette feature and must be cut from the identity set.

| Race | The one feature that must survive | Numeric gate |
|---|---|---|
| **Human** | The upright, balanced V-torso with a defined waist — the neutral reference figure. | `0.96 ≤ height ≤ 1.04`, `waist ≥ 0.09`, `limb:torso ∈ [0.70,0.76]` |
| **Elf** | The **spindle** — too tall and too thin: narrow shoulders on a long-limbed column. | `shoulder span ≤ 0.90 × human`, `limb:torso ≥ 0.74`, `W ≤ 0.90` |
| **Dwarf** | The **low wide block** — a mass that is shorter than it is broad across the shoulders. | `stature ≤ 0.85` AND `shoulder span ≥ 1.10 × human` |
| **Ork** | The **forward-heavy top** — widest shoulders over a narrower hip, hunched trapezius, big head. | `shoulder span ≥ 1.18 × human` AND `shoulder:hip ≥ 1.32` AND kyphosis exaggerated |

**Cut from the identity set (do not survive 20 m — remove from any "must read" list):**
finger count, facial features, ear length (`earMul` 1.9 elf ears vanish as black shape
unless backlit), hair parting, muscle striation, scapula spine detail on any race,
individual vertebrae, pectoral fold on elf/human.

Per-race readability rule restated as the generator's pass test:
`elf` passes iff spindle-gate holds; `dwarf` iff block-gate holds; `ork` iff top-heavy
gate holds; `human` iff it stays inside the median band (fails as human if it drifts into
any other race's gate).

---

## 4. Per-part constraint set (the generator must obey)

Two numbers per part per race:
- **G** = girth multiplier band, `× baseline root` (baseline = `BODY_PART_SHAPES[part].root`).
- **L** = length multiplier band, `× baseline length`.

The generator's global jitter (`spread = 0.09`) must be **clamped per part** to these
bands; a roll outside a band is rejected and re-rolled (same rejection loop as
`randomSilhouette`). Bands are chosen so no race can roll into another race's range.

### 4.1 Girth bands (G) — × baseline root

| Part | elf | human | dwarf | ork |
|---|---|---|---|---|
| chest | 0.78–0.86 | 0.96–1.04 | 1.24–1.36 | 1.28–1.40 |
| pectorals | 0.72–0.82 | 0.95–1.05 | 1.26–1.42 | 1.30–1.48 |
| scapulae | 0.72–0.82 | 0.95–1.05 | 1.24–1.40 | 1.28–1.44 |
| abdomen | 0.80–0.90 | 0.94–1.06 | 1.22–1.36 | 1.26–1.40 |
| pelvis | 0.78–0.88 | 0.94–1.06 | 1.24–1.38 | 1.24–1.38 |
| neck | 0.76–0.90 | 0.94–1.08 | 1.16–1.34 | 1.20–1.40 |
| head | 0.82–0.94 | 0.96–1.04 | 1.06–1.18 | 1.04–1.16 |
| upperArm | 0.78–0.90 | 0.94–1.06 | 1.22–1.36 | 1.26–1.42 |
| foreArm | 0.76–0.90 | 0.94–1.06 | 1.20–1.36 | 1.24–1.42 |
| hand | 0.80–0.94 | 0.94–1.06 | 1.18–1.34 | 1.20–1.38 |
| thigh | 0.78–0.90 | 0.94–1.06 | 1.22–1.38 | 1.24–1.40 |
| shin | 0.78–0.90 | 0.94–1.06 | 1.20–1.36 | 1.22–1.40 |
| foot | 0.80–0.94 | 0.94–1.06 | 1.18–1.34 | 1.20–1.38 |

No-overlap guarantee: **elf G_max ≤ 0.94 < human G_min** for every part, and
**human G_max ≤ 1.08 < dwarf G_min** for the race-defining parts (chest, pelvis,
upperArm, thigh, shin). Dwarf and ork overlap (allowed — separated by stature, `N`,
`limbTaper`).

### 4.2 Length bands (L) — × baseline length, before stature scale

| Part | elf | human | dwarf | ork |
|---|---|---|---|---|
| chest | 0.98–1.06 | 0.97–1.03 | 0.88–0.96 | 1.02–1.10 |
| abdomen | 0.98–1.06 | 0.97–1.03 | 0.88–0.96 | 1.02–1.10 |
| pelvis | 0.98–1.06 | 0.97–1.03 | 0.90–0.98 | 1.00–1.08 |
| neck | 1.02–1.12 | 0.97–1.03 | 0.84–0.94 | 0.90–1.00 |
| head | 0.96–1.04 | 0.97–1.03 | 0.96–1.04 | 0.96–1.04 |
| pectorals | 0.96–1.06 | 0.97–1.03 | 0.90–1.00 | 1.00–1.10 |
| scapulae | 0.96–1.06 | 0.97–1.03 | 0.90–1.00 | 1.00–1.10 |
| upperArm | 1.00–1.10 | 0.97–1.03 | 0.78–0.88 | 1.04–1.14 |
| foreArm | 1.00–1.10 | 0.97–1.03 | 0.78–0.88 | 1.04–1.14 |
| hand | 1.00–1.08 | 0.97–1.03 | 0.84–0.92 | 1.02–1.10 |
| thigh | 1.00–1.10 | 0.97–1.03 | 0.78–0.88 | 1.04–1.14 |
| shin | 1.00–1.10 | 0.97–1.03 | 0.78–0.88 | 1.04–1.14 |
| foot | 1.00–1.08 | 0.97–1.03 | 0.84–0.92 | 1.02–1.10 |

No-overlap: dwarf L_max ≤ 1.00 < human L_min (0.97) for the stature-defining parts
(head aside); elf/orc stay above human. Neck is the one part where the elf lengthens and
the ork shortens (the elf's long neck vs the ork's absent neck are silhouette features).

### 4.3 Scalar knobs (bands, replacing the raw ±9 % spread)

| Knob | elf | human | dwarf | ork |
|---|---|---|---|---|
| height | 1.00–1.10 | 0.95–1.05 | 0.76–0.85 | 1.06–1.18 |
| width | 0.80–0.90 | 0.94–1.08 | 1.22–1.40 | 1.26–1.44 |
| depth | 0.84–0.94 | 0.94–1.06 | 1.10–1.24 | 1.04–1.18 |
| limbTaper | 1.16–1.34 | 0.94–1.06 | 0.72–0.86 | 0.80–0.94 |
| muscle | 0.60–0.76 | 0.92–1.10 | 1.32–1.58 | 1.46–1.74 |
| shoulder | 0.36–0.44 | 0.43–0.49 | 0.46–0.54 | 0.50–0.58 |
| hip | 0.23–0.29 | 0.27–0.33 | 0.31–0.37 | 0.29–0.35 |
| waist | 0.12–0.20 | 0.06–0.14 | 0.00–0.09 | 0.00–0.10 |
| head | 0.92–1.04 | 0.96–1.04 | 1.06–1.18 | 1.02–1.14 |
| sectionN | 1.85–1.95 | 2.05–2.15 | 2.30–2.42 | 2.36–2.45 |

Hard clamps: every band is inside `SILHOUETTE_TOP`. The stature order
`dwarf_max 0.85 < human_min 0.95 < elf ≤ ork` and the breadth order
`elf_max 0.90 < human_min 0.94 < dwarf ≤ ork` must be re-asserted after clamping.

---

## 5. Pectorals & scapulae scaling (broad ork → near-invisible elf)

Plate readability is the **physical protrusion** of the muscle lobe past the torso
section:

```
protrusion(part) = amp_effective × root_resolved
  amp_effective  = baseline_amp × muscle            (partShape() already does this)
  root_resolved  = baseline_root × width
```

Baseline amps: pectorals paired lobe `±0.45` amp = 0.24, root 0.22.
Scapulae spine lobe (`π`) amp = 0.13, root 0.20.

```
race    pec amp   pec root   pec protrusion   scap amp   scap root   scap protrusion
human   0.240     0.220      0.053 m          0.130      0.200       0.026 m
elf     0.163     0.185      0.030 m          0.088      0.168       0.015 m
dwarf   0.348     0.286      0.100 m          0.189      0.260       0.049 m
ork     0.384     0.295      0.113 m          0.208      0.268       0.056 m
```

**Visibility thresholds (at 20 m, third-person):**

- **Reads as armour-like plate:** protrusion ≥ 0.045 m → dwarf, ork. (ork 0.056 scap,
  0.113 pec; dwarf 0.049 scap, 0.100 pec.)
- **Reads as muscle mass only:** 0.045 > protrusion ≥ 0.030 m → human pec (0.053 reads),
  human scap does not.
- **Sub-threshold / nearly invisible:** protrusion < 0.030 m → **elf** (pec 0.030,
  scap 0.015) and human scapula (0.026). Intended: the slim elf shows a smooth chest and
  back; the plate is deliberately below the 20 m read line.

**Scaling rule (the generator must apply this, not free-roll):**

```
pec_amp  = 0.24 × muscle        (clamped to race muscle band, §4.3)
scap_amp = 0.13 × muscle
```
Pectoral and scapula amplitude is a **function of the muscle knob only** — never rolled
independently — so a broad ork (muscle 1.46–1.74) always shows plates and a slim elf
(muscle 0.60–0.76) never does. Any independent roll that lifts elf muscle above 0.80, or
drops ork muscle below 1.40, is rejected.

**Symmetry of the plates (does not break §2):** the paired lobes must be mirrored
exactly —

- Pectorals: lobes at `+0.45` and `−0.45` share `amp` and `sharp` **to tolerance 0**;
  the sternal groove lobe at `0` (amp −0.07) lies on the plane and is self-symmetric.
  Outer sweeps `±1.57` and folds `±0.6` are likewise exact pairs.
- Scapulae: lobes at `+2.2` and `−2.2` are exact pairs; the spine lobe at `π` and the
  medial valley at `0` are on-plane and self-symmetric.

So the plates scale together (one amplitude per race) and mirror together (one amp per
pair) — the broad-ork / invisible-elf gradient never introduces left/right asymmetry and
never violates the 1 mm mirror tolerance.

---

## 6. Acceptance checklist (what "done" means for a rolled body)

1. `stature order dwarf < human < elf < ork` holds after jitter clamp.
2. `breadth order elf < human < dwarf ≤ ork` holds after jitter clamp.
3. Every part's G and L sit inside its §4 band for its race.
4. `limb:torso` inside `[0.70,0.76]` human/ork, `[0.74,0.82]` elf, `[0.55,0.66]` dwarf.
5. T-pose reflect-and-subtract max deviation ≤ `0.001 × height` m, weapon hidden.
6. The race's §3 silhouette gate passes at the 20 m black-shape test.
7. Pectoral/scapula amplitude = `0.24 × muscle` / `0.13 × muscle`, paired lobes exact.
