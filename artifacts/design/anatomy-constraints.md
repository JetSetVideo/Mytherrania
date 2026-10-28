# Anatomy-Grounded Hierarchical Joint Limit Specification

Target: `src/game/Skeleton.ts` (`JOINT_LIMITS` / `defaultHumanoid`), `src/game/BodyGraph.ts`
(9 `JointId`s, `MUSCLES`, `tensionAt`), `src/game/BodyProfile.ts` (`constraintList`,
`STATE_JOINT_SCALE`).

This replaces the current static per-joint `min`/`max` numbers with ranges that are
**(a) anatomically grounded** and **(b) dependent** — a child joint's effective range is a
function of its parent's current angle, not a constant.

## 0. Conventions

- All angles in **radians**. Sign convention: for limb joints, **negative = flexion**
  (matching the existing rig: `elbowL/R` and `kneeL/R` are `[-2.6, 0]` and `[-2.4, 0]`);
  for the spine chain, **+ = forward flexion**, **− = extension** (matching `spine`/
  `abdomen` symmetric limits). Axes as in `Skeleton.Joint.axis`.
- `rest` is the neutral pose angle from the existing rig.
- Parent→child order (topological; constraints MUST be resolved in this order):
  ```
  pelvis → waist → ribcage → neckJoint → (head)
  ribcage → shoulder → elbow → wrist
  pelvis  → hip → knee → ankle
  ```
- Left/right share identical numbers; only the twist sign in `KICK_WEIGHTS` differs.
- `ribcage` is one `JointId` carried by four links (abdomen→chest, chest→pectorals,
  chest→scapulae). Pectorals and scapulae are **rigid children of the chest** — they take
  the ribcage transform wholesale and add **no** independent range. Only the
  `abdomen→chest` link articulates.

## 1. Per-joint range of motion

Each table gives the raw (uncoupled) range. `coupling to parent` names the section-2 rule
that further narrows the range at pose time.

### 1.1 ribcage — thoracolumbar (lower thoracic) segment
Parent: `waist`.

| axis | min | max | limiting muscle | coupling to parent |
|---|---|---|---|---|
| x (flex/ext) | −0.35 | +0.35 | intercostals (flex agonist) / serratus anterior (antagonist) | C1 |
| z (axial rotation) | −0.55 | +0.55 | serratus anterior / rhomboid | C2 |
| y (lateral bend) | −0.30 | +0.30 | intercostals | C2b |

The thoracic spine has the **largest** axial rotation of the trunk (ribs slide, facets
favour rotation) but only modest flexion — this is why `±0.55` rotation and `±0.35`
flexion, the opposite emphasis to the waist.

### 1.2 waist — lumbar / L5–S1 segment
Parent: `pelvis` (root, no parent joint).

| axis | min | max | limiting muscle | coupling to parent |
|---|---|---|---|---|
| x (flex/ext) | −0.42 | +0.85 | rectus abdominis (flex agonist) / erector spinae (ext agonist) | — (root) |
| z (axial rotation) | −0.20 | +0.20 | erector spinae | — |
| y (lateral bend) | −0.28 | +0.28 | erector spinae / rectus abdominis | — |

Lumbar flexion (~49°) is large; lumbar rotation is **small** (~11°) because the facets
are sagittally oriented — the classic clinical fact that most trunk rotation happens in
the thoracic spine, not the lumbar.

### 1.3 neckJoint — cervical spine + atlanto-occipital
Parent: `ribcage`. (Both `chest→neck` and `neck→head` links use this id; the second link
is the atlanto-occipital contribution and is folded into these numbers.)

| axis | min | max | limiting muscle | coupling to parent |
|---|---|---|---|---|
| x (flex/ext) | −0.95 | +0.85 | sternocleidomastoid (flex agonist) / trapezius (ext agonist) | C3 |
| z (rotation) | −1.35 | +1.35 | sternocleidomastoid / trapezius | C3 |
| y (lateral) | −0.65 | +0.65 | sternocleidomastoid / trapezius | C3b |

The neck is the **second most mobile** region after the shoulder: ~78° rotation to each
side (≈1.35 rad) driven by the atlanto-axial joint, ~49° flexion.

### 1.4 shoulder — glenohumeral + scapulothoracic
Parent: `ribcage`.

| axis | min | max | limiting muscle | coupling to parent |
|---|---|---|---|---|
| x (flex/ext) | −1.05 | +3.00 | deltoid (flex/abd agonist) / latissimus dorsi (ext antagonist) | C4 |
| y (abd/adduct) | −0.75 | +2.97 | deltoid / latissimus dorsi | C4 |
| z (int/ext rotation) | −1.60 | +1.40 | pectoralis major (int) / latissimus + rhomboid (ext) | C4b |

**The shoulder is the most mobile joint in the body** (~180° flexion and abduction ≈
3.0 rad). Its range is not from the glenoid alone — the scapula rotates on the thorax
(≈2:1 humeral:scapular rhythm), which is why the `ribcage` parent and the `scapulae`
part both matter. Glenohumeral adduction is limited to ≈−0.75 rad by the trunk.

### 1.5 elbow — humeroulnar / humeroradial
Parent: `shoulder`.

| axis | min | max | limiting muscle | coupling to parent |
|---|---|---|---|---|
| x (flex/ext) | −2.60 | 0.00 | biceps brachii (flex agonist) / triceps brachii (ext antagonist) | C5 |
| z (pronation/supination) | −1.50 | +1.50 | biceps (supinator) / pronator (folded into biceps) | — |

**The elbow cannot hyperextend** — `max = 0.00`. Full flexion ≈ 149° (−2.60 rad), set by
the bony block of the coronoid process into the coronoid fossa plus biceps bulk, not the
biceps alone.

### 1.6 wrist — radiocarpal
Parent: `elbow`.

| axis | min | max | limiting muscle | coupling to parent |
|---|---|---|---|---|
| x (flex/ext) | −1.22 | +1.40 | flexor carpi (flex agonist) / extensor carpi (ext antagonist) | C6 |
| y (radial/ulnar deviation) | −0.60 | +0.35 | flexor carpi ulnaris (ulnar) / extensor carpi radialis (radial) | C6b |

Flexion ≈ 80° (+1.40), extension ≈ 70° (−1.22); ulnar deviation (0.60) exceeds radial
(0.35) because the radial styloid abuts the scaphoid sooner.

### 1.7 hip — coxofemoral
Parent: `pelvis`.

| axis | min | max | limiting muscle | coupling to parent |
|---|---|---|---|---|
| x (flex/ext) | −0.52 | +2.10 | iliopsoas (flex agonist) / gluteus maximus (ext agonist) | — (root) |
| y (abd/adduct) | −0.52 | +0.78 | gluteus (abd agonist) / adductors (folded into gluteus) | — |
| z (int/ext rotation) | −0.78 | +0.70 | gluteus maximus (ext rot) / iliopsoas (int rot) | — |

Hip flexion ~120° (+2.10) with knee flexed; extension only ~30° (−0.52), stopped by the
iliofemoral ligament (Y-ligament), which is why the pelvis must tilt to reach further.

### 1.8 knee — tibiofemoral
Parent: `hip`.

| axis | min | max | limiting muscle | coupling to parent |
|---|---|---|---|---|
| x (flex/ext) | −2.40 | 0.00 | quadriceps (ext agonist) / hamstrings (flex agonist) | C7 |

**The knee cannot bend forward** — `max = 0.00`. Flexion ≈ 137° (−2.40) is stopped by the
calf meeting the thigh, not by a muscle; the hamstrings are the agonist. Hyperextension is
blocked passively by the ACL and posterior capsule.

### 1.9 ankle — talocrural
Parent: `knee`.

| axis | min | max | limiting muscle | coupling to parent |
|---|---|---|---|---|
| x (dorsi/plantarflex) | −0.87 | +0.35 | tibialis anterior (dorsi agonist) / gastrocnemius (plantar agonist) | C8 |
| y (inversion/eversion) | −0.30 | +0.52 | tibialis anterior (inv agonist) / peroneals (folded into tibialis) | C8b |

Dorsiflexion only ≈ 20° (+0.35) — stopped by the talus wedging in the mortise, which is
why the knee must flex to let the shank pass over the planted foot. Plantarflexion ≈ 50°.

## 2. Coupling model (the core requirement)

### 2.1 Master formula

For any child joint `c` with parent `p`:

```
# Normalised parent excursion into each direction of the parent's own range:
e_flex(p) = clamp((θ_p − rest_p) / (max_p − rest_p), 0, 1)
e_ext(p)  = clamp((θ_p − rest_p) / (rest_p − min_p), 0, 1)
e_rot(p)  = clamp(θ_p / max(|min_p|,|max_p|), −1, 1)      # signed, for axial rotation
e_lat(p)  = same form as e_rot, for lateral bend

# Scale each side of the child's range:
S_pos = clamp(1 − Σ k_i · f_i(p), S_min, 1)      # scales child's max side
S_neg = clamp(1 − Σ k_j · g_j(p), S_min, 1)      # scales child's min side

# Effective, coupled range:
θ_c.max_eff = rest_c + (max_c − rest_c) · S_pos
θ_c.min_eff = rest_c + (min_c − rest_c) · S_neg
```

`S_min = 0.15` (a joint never locks completely — that is what `STATE_JOINT_SCALE`'s 0.05
`ko` row is for). `S` multiplies the **span from rest**, so coupling shrinks a joint
toward its neutral, never past it, and never inverts min/max.

Resolve parents before children, and clamp `θ_c` into `[min_eff, max_eff]` **after** the
parent angle for that frame is final. Compose with the existing state/race scaling:
`constraintList()` should apply `S` on top of `STATE_JOINT_SCALE` (state brace) and
`raceConstraintScale` (mass), i.e. `scale = stateScale · raceScale · S`.

### 2.2 Coupling pairs, coefficients, and anatomical reason

| # | parent → child | direction scaled | k | formula | anatomical reason |
|---|---|---|---|---|---|
| C1 | waist → ribcage | flex | 0.35 | `S_flex = 1 − 0.35·e_flex(waist)` | Erector spinae (longissimus/iliocostalis) is a **continuous** lumbar→thoracic muscle. With the lumbar spine fully flexed it is at maximal shortening, so it can no longer hold thoracic extension; intercostals also shorten. Deep lumbar flexion therefore caps thoracic flexion. |
| C1b | waist → ribcage | ext | 0.30 | `S_neg = 1 − 0.30·e_ext(waist)` | Symmetric passive-tension limit: full lumbar extension pre-lengthens erector spinae, reducing available thoracic extension. |
| C2 | waist → ribcage | rotation | 0.40 | `S_rot = 1 − 0.40·|e_rot(waist)|` | Lumbar facets are sagittal, so lumbar rotation is small and loads the disc. When the lumbar spine is already rotated, the erector spinae is pre-stretched and the thoracic rotation it would drive is reduced. |
| C2b | waist → ribcage | lateral | 0.30 | `S_lat = 1 − 0.30·|e_lat(waist)|` | Same continuous erector spinae; lateral flexion of the lumbar column shortens the ipsilateral fibres. |
| C3 | ribcage → neckJoint | rotation | 0.45 | `S_rot = 1 − 0.45·|e_rot(ribcage)|` | **Brief's case:** when the thorax is twisted, the cervical rotators (sternocleidomastoid, trapezius) are carried into a shortened/pre-rotated position and cannot add full cervical rotation on top — head turn is always measured *relative to* the shoulders. |
| C3b | ribcage → neckJoint | lateral | 0.30 | `S_lat = 1 − 0.30·|e_lat(ribcage)|` | Trapezius spans the cervical spine and thorax; thoracic side-bend shortens one side. |
| C3c | ribcage → neckJoint | flex/ext | 0.25 | `S_flex = 1 − 0.25·e_flex(ribcage)` | Trapezius is a thoracic-attached extensor of the neck; thoracic flexion slackens it, reducing available neck extension (and vice-versa). |
| C4 | ribcage → shoulder | flex & abd | 0.35 / 0.20 | `S_flex = 1 − 0.35·e_flex(ribcage) − 0.20·|e_rot(ribcage)|` | **Overhead reach requires thoracic extension.** Latissimus dorsi and pectoralis major originate on the thorax; thoracic flexion (slouch) shortens them and physically stops the arm going overhead. Thoracic rotation also pre-rotates the scapular platform, cutting elevation. |
| C4b | ribcage → shoulder | rotation | 0.25 | `S_rot = 1 − 0.25·|e_rot(ribcage)|` | Scapulothoracic rhythm: the scapula rides the thorax, so a twisted thorax caps humeral rotation. |
| C5 | shoulder → elbow | flex | 0.22 / 0.15 | `S_neg = 1 − 0.22·e_flex(shoulder) − 0.15·e_abd(shoulder)` | **Biceps brachii and triceps are two-joint muscles.** With the shoulder flexed/abducted the biceps is already shortened, so *active insufficiency* limits further elbow flexion. |
| C5r | elbow → shoulder | flex & abd | 0.20 | `S_pos(shoulder) = 1 − 0.20·e_flex(elbow)` | **Brief's case, reverse direction:** the shoulder cannot fully flex/abduct while the elbow is fully flexed — the biceps is at its shortest length and *passive insufficiency* stops it. This is why you straighten your arm to reach overhead. Two-joint muscles make the coupling **bidirectional**. |
| C6 | elbow → wrist | flex | 0.15 | `S_neg = 1 − 0.15·e_flex(elbow)` | Weak: the forearm flexors arise just distal to the elbow, so elbow flexion slightly slackens the flexor carpi group. |
| C7 | hip → knee | flex | 0.30 / 0.15 | `S_neg = 1 − 0.30·e_flex(hip) − 0.15·e_ext(hip)` | **Hamstrings are two-joint** (ischium → tibia). Deep hip flexion (e.g. high knee raise) shortens them → *active insufficiency* caps knee flexion. Hip extension pre-lengthens them → passive tension also caps knee flexion. **The safe knee range narrows at BOTH ends as the hip leaves neutral.** |
| C7r | knee → hip | — | 0.10 | `S_pos(hip) = 1 − 0.10·e_flex(knee)` | Rectus femoris (two-joint, AIIS → tibia): a flexed knee slackens it, mildly reducing hip flexion drive. |
| C8 | knee → ankle | dorsiflex | 0.40 | `S_pos = 1 − 0.40·e_flex(knee)` | **Gastrocnemius is two-joint** (femur condyles → calcaneus). A flexed knee shortens it, and because it must LENGTHEN for ankle dorsiflexion, knee flexion sharply caps dorsiflexion — the reason you cannot dorsiflex the foot with the knee bent and the heel down. |
| C8b | knee → ankle | plantarflex | 0.10 | `S_neg = 1 − 0.10·e_ext(knee)` | Minor: knee extension slightly pre-lengthens gastrocnemius, mildly reducing plantarflexion reserve. |

`e_abd(shoulder)` reuses `e_flex(shoulder)` computed on the `y` axis (abduction is the
`y` channel; flexion the `x` channel).

### 2.3 Worked numeric check (the two visual defects)

**Shoulder step (arm meets torso).** At `elbow = −2.6` (full flexion):
`S_pos(shoulder) = 1 − 0.20·1.0 = 0.80`, so `shoulder.max_eff = 0 + (3.00)·0.80 = 2.40`
instead of 3.00. The arm cannot swing to the torso-hugging extreme that produced the
interpenetration step; the coupled range keeps the deltoid mass inside the `seat = 0.13`
overlap.

**Hip step (leg meets hip).** At `hip = +2.10` (deep flexion):
`S_neg(knee) = 1 − 0.30·1.0 = 0.70`, so `knee.min_eff = 0 + (−2.40)·0.70 = −1.68`. The
knee is held to a 96° bend, which is what keeps the thigh's `seat = 0.12` gluteal overlap
from inverting through the pelvis when the hip is at its travel limit.

## 3. Joints whose limit must BE the muscle pair

`BodyGraph` already carries an agonist/antagonist per link and computes `tensionAt()` from
a **single** joint's normalised angle. For the limit and the muscle system to agree rather
than fight, these joints must feed the *same* shared quantity to both:

| joint | muscle pair (`BODY_LINKS.muscles`) | why the limit must be the muscle |
|---|---|---|
| shoulder | deltoid / latissimus | deltoid is agonist for the coupled abduction cap (C4); latissimus is the thorax-anchored passive limit |
| elbow | **biceps / triceps** | biceps/triceps are two-joint — the limit (C5/C5r) and `tensionAt` must both read a **shared muscle length** `L = g(θ_shoulder, θ_elbow)`, not θ_elbow alone |
| hip | iliopsoas / gluteus | gluteus is the passive hip-extension stop |
| knee | **quadriceps / hamstrings** | hamstrings are two-joint — the limit (C7) must use the same `L = g(θ_hip, θ_knee)` that `tensionAt` uses, or the knee will be told to flex while the hamstring is reported slack |
| ankle | **tibialis / gastrocnemius** | gastrocnemius is two-joint — limit C8 and `tensionAt` must share `L = g(θ_knee, θ_ankle)` |
| neckJoint | sternocleidomastoid / trapezius | trapezius is thorax-anchored; C3 couples it to the ribcage twist |
| ribcage | intercostals / serratus | both are thorax-spanning; the coupled rotation cap (C2) is their tension |
| waist | rectus abdominis / erector spinae | erector spinae spans lumbar→thoracic — it is the physical reason for C1 |
| wrist | flexor carpi / extensor carpi | direct agonist/antagonist, no two-joint complication |

**Rule:** for the three two-joint pairs (elbow, knee, ankle), `tensionAt()` must be
generalised from `angle` to a **muscle-length function of both joints of the pair**, e.g.

```
L_biceps  = restLen_biceps − a·θ_shoulder − b·θ_elbow        # a≈0.35, b≈1.0
flex = clamp((restLen_biceps − L_biceps) / span, −1, 1)      # feeds tensionAt
```

so the constraint (section 2) and the tension model read one number. Otherwise the
coupling shrinks the range while `tensionAt` still reports full strength on a muscle that
the coupling has declared slack.

## 4. Implementation notes (for the coder)

1. Add a `COUPLINGS: { parent: JointId; child: JointId; axis: "x"|"y"|"z"; k: number;
   uses: "flex"|"ext"|"rot"|"lat"|"abd"; side: 1|-1 }[]` table from section 2.2.
2. Resolve in topological order (section 0). Compute `θ_p` first, then `S`, then clamp `θ_c`.
3. Apply `S` multiplicatively with `STATE_JOINT_SCALE[state][joint]` and
   `raceConstraintScale(silhouette)` inside `constraintList()`.
4. Keep `S_min = 0.15`; assert `min_eff ≤ rest ≤ max_eff` after every resolve (a coupling
   that inverts the range is a bug, not a pose).
5. No new runtime dependencies; pure functions, no Three.js (match `BodyGraph`/`BodyProfile`).
