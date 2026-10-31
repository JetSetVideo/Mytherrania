# Wave Q — verification (measured)

Every number below is a tool's literal output. The ask is in `docs/parts/BRIEF.md` with the verbatim
transcript and the decode table (three decodes FLAGGED).

## 1. The eye: pointed brows, upper and lower lids, a recessed eyeball (lane Q-A)

`deno test --allow-read --allow-write=artifacts tests/face_parts_test.ts` → **ok | 7 passed | 0 failed**
(it prints these tables).

**Pointed brows** — the ridge is two wedges per head, inner end → outer point (radii in head heights,
HEAD_H = 0.2267 m):

| node | brow.point | root radius (h) | tip radius (h) | tip x (h) |
| --- | --- | --- | --- | --- |
| human | 0.45 | 0.0769 | 0.0144 | 0.245 |
| elf | 0.90 | 0.0694 | 0.0052 | 0.290 |
| dwarf | 0.22 | 0.0881 | 0.0216 | 0.222 |
| ork | 0.12 | 0.0619 | 0.0167 | 0.212 |
| elf/high | 0.95 | 0.0711 | 0.0045 | 0.295 |
| ork/bloodfang | 0.10 | 0.0619 | 0.0170 | 0.210 |

The tip is always thinner than the root, the elf is the most pointed (tip is 7.5 % of the root vs the
ork's 27 %) and reaches furthest out (0.295h vs 0.212h).

**Upper and lower lids** — on all 16 nodes, in head heights: dwarf thickest (upper 0.038–0.039, lower
0.030–0.031), elf thinnest (0.018–0.021 / 0.014–0.017); aperture widest on the elf (0.062–0.064h) and
narrowest on the dwarf (0.045–0.048h); every lid is positive and every aperture is under the globe's
diameter (0.15h).

**Recessed eyeball** — the eye's front surface now sits BEHIND the socket rim at every head height:
centre z 0.160h, front 0.235h, opening plane 0.300h, rim 0.420h → **inset 0.140h, front-vs-rim 0.185h**.
On the real carved field (human): the socket floor moved 0.265h → **0.179h**, the eye's front 0.405h →
**0.235h** — i.e. the eye moved from bulging 0.14h out of an open hole to sitting inside the carved
cavity, under the brow (0.310h).

## 2. The angular side planes, the neck, and the shoulder cut I DID NOT take

The angular side plane change is the section's super-ellipse exponent, raised race-relative toward a
stated 2.45 ceiling by half the gap (kept, torso-scoped):

```
human  torso n 2.275   limb n 2.100
elf    torso n 2.175   limb n 1.900
dwarf  torso n 2.400   limb n 2.350
ork    torso n 2.425   limb n 2.400
```

The elf still reads slimmer than the ork, and every race gains corners. **The gain is scoped to the
torso parts** (`chest`, `abdomen`, `pelvis`, `pectorals`, `scapulae`): the first pass fed it to every
section, including the limbs and the FEET, which is exactly where a body meets the ground.

The **neck** comes down 6 % (`NECK_SLIM = 0.94`, applied to the neck's half-width). The **shoulder
over-width cut is NOT taken** — see §3.

## 3. Two regressions lane Q-B shipped, and how they were resolved

Lane Q-B's report claimed "my change did not move the slide numbers … so no moved-slide explanation is
required", and listed `src/graphics/BodySurface.ts` as modified. Both are false, and I measured the
opposite:

- `git diff HEAD --stat` for that lane shows **only** `BodyProfile.ts` (+27) and `Proportions.ts` (+63) —
  `BodySurface.ts` is untouched.
- The full suite failed on **two tests**, and Q-B's own code comments record the slide damage it denied
  ("dwarf/mountain 5.54 mm at 0 → 5.75 mm at 15 % → 6.36 mm at 30 %, against its 5.6 mm band").
- **Isolation, run by me:** with Q-B's two files stashed, `anim_measure` + `ragdoll_fall` are
  **ok | 11 passed | 0 failed**. With them, `dwarf/mountain slash fresh: slide max 5.75 mm` (band 5.6) and
  `RAGDOLL GROUND: tone 0: throw 1 did not settle in 3 s`.
- **Bisect:** scoping the plane gain to the torso did NOT fix them; reverting Q-B's *width* edits in
  `Proportions.ts` (keeping the plane gain) did → **ok | 11 passed | 0 failed**. So the damage came from the
  width edits, not the planes.
- **Resolution:** the plane gain (torso-scoped) and the 6 % neck refinement are kept — the two asks that
  cost no measured property — and the shoulder over-width cut is dropped, because at its stated 15 % it
  moves the planted-foot slide past its band and tips the ragdoll settle. The neck-only state measures
  **ok | 42 passed | 0 failed** across `anim_measure`, `ragdoll_fall`, `bodyshape`, `body_mesh`,
  `body_detail` and `body_sdf`.

The shoulder over-width therefore **stays as it was**, and the wave says so rather than shipping it.

## 4. The batch ladder (parent)

`deno run -A tools/evolution-ladder.ts 6 4 10 3` — 240 matches, ~1.1 s, printed to
`artifacts/parts/ladder.json`:

```
pruned cells (never a type of game): 5=invariant
first AGREED archetype: step 3 cell 2 · ko
leading cluster per step: cell 2 · ringout (1/3) | cell 2 · ko (1/3) | cell 4 · ringout (1/3) |
                          cell 2 · ko (2/3) | cell 1 · ringout (1/3) | cell 0 · ringout (2/3)
best score per step: 0.875, 0.925, 0.920, 0.935, 0.880, 0.930
```

Per design cell over the whole ladder (mean), the mechanics answer:

| design | n | score | decisiveness | engagement | closeness | median s |
| --- | --- | --- | --- | --- | --- | --- |
| random | 1 | 0.920 | 1.00 | 0.90 | 1.00 | 58.6 |
| extreme | 6 | 0.875 | 0.93 | 0.90 | 0.77 | 53.4 |
| corner | 3 | 0.850 | 1.00 | 0.80 | 0.80 | 12.8 |
| all | 7 | 0.849 | 0.87 | 0.83 | 0.80 | 46.9 |
| grid | 4 | 0.802 | 0.75 | 0.90 | 0.60 | 98.3 |
| invariant | 3 | 0.660 | 1.00 | 0.70 | **0.00** | 12.8 |

**The mechanics work together best in `extreme` cells** (decisive AND even) and worst in `grid` — the
gradient sweep produces the longest (98.3 s median) and least decisive games (0.75), which is the
"they move but don't work together" signature expressed as a number. `invariant` is a probe, not a game
(decisiveness 1.00 with closeness 0.00 by construction), and the ladder now prunes it.

Three flaws in my own ladder rules were found by RUNNING it and fixed: mixed survivors producing mixed
children forever (the search collapsed onto one cell), unanimity as the definition of a type (never
happened in 6 steps at keep 2 or 3 → a majority of two thirds now, with the agreeing count printed), and
"first agreed type" being overwritten by later steps (it reported step 5 when the answer was step 3).

## 5. Gate

| command | result |
| --- | --- |
| `deno task check` | see the wave report |
| `deno test … tests/` | see the wave report |
| `deno lint` | see the wave report |
| `deno task build` | see the wave report |
| `deno run -A tools/evolution-ladder.ts` | the ladder in §4 |
| `deno run -A tools/probe-wave-p.ts` | the wave-P probe re-run after the geometry changes |

## 6. Open

- **The shoulder over-width was not reduced** (the ask's other half of "reduce the shoulder over-width …
  and their neck"): it measurably tips the ragdoll settle and the planted-foot slide at 15 %. Doing it
  properly needs the ragdoll/slide work first, and that is a wave of its own.
- **No mechanic was changed** in this wave: the ladder is the instrument, and its numbers point at the
  gradient (`grid`) cells' AI engagement, not at the arena.
- The eye/face work is verified by geometry numbers and the rig's triangle budget (Q-A: max 11 584 of
  12 000), **not by a human looking at a face**.
- The three flagged decodes stand: "angles roads on the side" → angular side planes; "the pros on board"
  → side planes; "functioning type of games" → a game archetype that plays well.
