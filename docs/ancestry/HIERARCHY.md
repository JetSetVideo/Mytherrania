# Ancestry hierarchy

The hierarchy behind "ancestry is visible, not cosmetic" (`DESIGN.md` item 9) and "races are
numbers, not meshes" (item 22). It is the data in `artifacts/design/ancestry.json`, read through
`src/game/Ancestry.ts`; the per-part body-measure ratios it refers to are owned by
`artifacts/design/race-genes.json` (`RaceGenes.ts`) and are not duplicated here.

16 nodes: 4 races (human, elf, dwarf, ork) and 12 subraces (imperial, nomad, islander;
high, wood, dark; mountain, forge, deep; greenhide, ironhide, bloodfang).

## Rank semantics

Every node ranks all 13 metrics. **rank 1 = the most of that metric, rank 4 = the least.**
On the 4 race nodes the 13 ranks of a metric are a **strict permutation of {1,2,3,4}** — no
ties, no zeros — so a race's identity is an ordering, not an absolute that a later tweak could
flatten. `tests/ancestry_test.ts` asserts the permutation for every metric.

**Subrace rule.** A subrace node copies its race's `ranks` object and shifts **at most two
metrics by ±1, staying inside [1,4]** (never more, never past a bound). The shifted metrics are
the subrace's visible deviations; everything else is the parent's. Asserted in the test, and each
subrace's shifts are listed in *Subrace deltas* below.

## Per-metric ranking across the four races

Rank 1 = most of the metric.

| metric | 1st (most) | 2nd | 3rd | 4th (least) |
|---|---|---|---|---|
| height | elf | ork | human | dwarf |
| thinness | elf | human | ork | dwarf |
| legLength | elf | human | ork | dwarf |
| armLength | elf | human | ork | dwarf |
| shoulderWidth | dwarf | ork | human | elf |
| torsoMass | dwarf | ork | human | elf |
| skullProminence | dwarf | ork | human | elf |
| browProminence | dwarf | human | elf | ork |
| hairLength | elf | human | ork | dwarf |
| beardCoverage | dwarf | human | ork | elf |
| earLength | elf | human | dwarf | ork |
| tuskProtrusion | ork | dwarf | human | elf |
| skinDepth | human | ork | dwarf | elf |

Notes:
- `height`: elf 1 (tallest), ork 2, human 3, dwarf 4 — the brief's "taller than the humans but
  smaller than the elves" fixes ork above human.
- `skinDepth` = how far a race's skin range reaches (widest first). The elf stays pale/white, so
  it is last; the human runs brown to white, so it is first.
- `shoulderWidth` (absolute shoulder span) puts dwarf 1 / elf 4. It is NOT the same quantity as
  the `shoulderToHip` **ratio** (span measured against the race's own hips), which tops out at
  ork — see *Body-part ratios*.

## Per-race look

| | human | elf | dwarf | ork |
|---|---|---|---|---|
| **skin** base | `#c98a63` | `#e8e2dc` | `#c58a5a` | `#7fae4e` |
| **skin** range | brown `#8a5a3c` → pale `#f0d6bf` | 4 pale/white tones | 4 brown tones | 3 greens + 2 purples |
| **skin** crease | `#6b4130` (red-brown), strength 0.35 | `#2f3d63` (blue-shifted, B−R = +52), strength 0.6 | `#4a2f22`, strength 0.45 | `#33421f`, strength 0.4 |
| **skin** zones | neck, joint, knuckle, brow | **under-eye, cheek-fold**, neck, joint | joint, knuckle, neck | joint, knuckle, neck, brow |
| **hair** length / curl / density | medium / 0.5 / 0.6 | **verylong** / 0.15 / 0.5 | short / 0.35 / 0.85 | short / 0.7 / 0.5 |
| **hair** colours | dark `#1a1a1a` → blond `#e8d8a8` | blue-green `#4f7a6a`/`#5a8a80` + ginger `#b06a2a`/`#c87a3a` | 5 browns | 3 dark-cool tones |
| **hair** baldChance | 0.25 | **0.0** | 0.2 | **0.55** (baldest) |
| **brows** len/thick/prom/tipPastFace | 0.6 / 0.45 / 0.55 / 0.2 | 0.9 / 0.15 / 0.35 / **0.55** | 0.65 / 0.75 / **0.85** / 0.25 | 0.35 / 0.25 / **0.15** / 0.1 |
| **beard** mode | `full` | `moustache-thin` | `full` | `chin` |
| **beard** coverage / lengthMul / required / allowed | 0.8 / 1.2 / false / true | 0.15 / 0.2 / **false** / **true** | **0.72** / 1.6 / **true** / true | 0.35 / 0.7 / false / true |
| **tusks** count / direction / protrusion | 0 / out / 0 | 0 / out / 0 | 0 / up / 0.06 | **2 / up / 0.35** |
| **ears** lengthMul / pointed / droop | 1.0 / 0.1 / 0.15 | 1.9 / **0.9** / 0.05 | 0.9 / 0.05 / 0.1 | 0.8 / 0.15 / 0.05 |
| **skull** massMul / browRidge / jawWidth | 1.0 / 0.25 / 0.5 | 0.95 / 0.15 / 0.4 | **1.15** / 0.7 / 0.62 | 1.12 / 0.65 / **0.85** |

Key derived facts (all asserted in `tests/ancestry_test.ts`):
- The elf crease has the largest **B − R** channel gap of the four (`+52`; dwarf `−40`,
  ork `−20`, human `−59`), so the elf is the only race whose folds read blue rather than
  brown/green, and its zones include `under-eye` and `cheek-fold`.
- The ork hide range holds one purple or more and two greens or more; the human range reads
  reddish-brown (`R > G > B`) at the darkest and pale at the lightest.
- The elf has no bald member (`baldChance === 0`) and the ork is the baldest (`0.55`).
- The dwarf beard is `required`, coverage `0.72 < 1` so the mouth stays readable; the elf beard
  is capped at a thin moustache and is never required.
- The dwarf and ork skulls are both heavier than the human's and the elf's; the ork jaw is the
  widest.
- Two lower tusks (`count = 2`), direction `up`, are unique to the ork.

### Subrace deltas

Each line is the parent's ranks shifted by the listed metrics (±1). Everything else equals the
parent.

| subrace | parent | shifts |
|---|---|---|
| Imperial | human | height 3→2 |
| Nomad | human | hairLength 2→1, legLength 2→1 |
| Islander | human | thinness 2→1, torsoMass 3→4 |
| High Elf | elf | browProminence 3→2 |
| Wood Elf | elf | torsoMass 4→3, skinDepth 4→3 |
| Dark Elf | elf | skinDepth 4→3 |
| Mountain | dwarf | height 4→3, legLength 4→3 |
| Forge | dwarf | armLength 4→3, skinDepth 3→2 |
| Deep | dwarf | skinDepth 3→4 |
| Greenhide | ork | skinDepth 2→1, beardCoverage 3→4 |
| Ironhide | ork | torsoMass 2→1, browProminence 4→3 |
| Bloodfang | ork | legLength 3→2, armLength 3→2 |

## Body-part ratios

Named in `artifacts/design/race-genes.json` (`ratios`), evaluated by `ratioValue` in
`RaceGenes.ts`. The numbers below are that file's `perRace` targets; this document only states
them and their ordering. Highest first.

| ratio id | label | human | elf | dwarf | ork | highest → lowest |
|---|---|---|---|---|---|---|
| waistToHips | waist width to hip width | 0.91 | 0.85 | 0.96 | 0.95 | dwarf > ork > human > elf |
| shoulderToHip | shoulder span to hip span | 1.4 | 1.33 | 1.52 | 1.66 | ork > dwarf > human > elf |
| legToTorso | leg-chain length to torso height | 0.75 | 0.795 | 0.615 | 0.705 | elf > human > ork > dwarf |
| armToTorso | arm-chain length to torso height | 0.821 | 0.871 | 0.674 | 0.772 | elf > human > ork > dwarf |
| headToBody | head length to torso height | 0.679 | 0.665 | 0.76 | 0.733 | dwarf > ork > human > elf |
| torsoToHeight | torso length as a share of body height | 1.333 | 1.258 | 1.626 | 1.418 | dwarf > ork > human > elf |
| chestToWaist | chest width to waist width | 1.33 | 1.45 | 1.22 | 1.26 | elf > human > ork > dwarf |
| neckToHead | neck length to head length | 0.684 | 0.698 | 0.611 | 0.634 | elf > human > ork > dwarf |
| handToForearm | hand length to forearm length | 0.4 | 0.38 | 0.43 | 0.42 | dwarf > ork > human > elf |
| footToShin | foot length to shin length | 0.684 | 0.66 | 0.72 | 0.71 | dwarf > ork > human > elf |
| thighToShin | thigh length to shin length | 1.105 | 1.1 | 1.15 | 1.12 | dwarf > ork > human > elf |

The metric table and the ratio table measure different things and are consistent where they
overlap: `legLength`/`armLength` (metric) and `legToTorso`/`armToTorso` (ratio) both order
elf > human > ork > dwarf. `shoulderWidth` (metric, absolute span) puts dwarf first, while
`shoulderToHip` (ratio, span against the race's own hips) puts ork first — a wider race can have
a narrower shoulder-over-hip proportion. Race-body width offsets set the absolute span
(`shoulderToHip`'s note in `race-genes.json`).

## Hair physics

`hairPhysics.massKg` rides the length ladder (at stature 1.0): bald 0, short 0.05, medium 0.15,
long 0.40, verylong 0.70 kg. `stiffness` falls as the mass grows (verylong 0.25 → short 0.85);
`damp` rises with it (verylong 0.72 → short 0.38); `windGain = 0.30 + 0.60·curl`, so a coiled
mass catches more wind.

`hairMassKg(race, subrace, seed)` returns the character's mass: the node's `massKg` scaled by
**stature³** (a shorter body carries a shorter, lighter fall — dwarf 0.8, human 1.0, elf 1.05,
ork 1.12), lifted by curl (`×(1 + 0.5·curl)`), and jittered by the seed at most ±8%. The seed
only multiplies, so the ordering between ancestries never flips. The default race ordering is
**elf > human > ork > dwarf**: dwarf and ork both wear short hair, but the dwarf's smaller
stature keeps its mass below the ork's. `tests/ancestry_test.ts` asserts this order, the
longer-subrace rise (High Elf > Dark Elf), the curl gain at equal length, seed stability and
finiteness over 16 nodes × 50 seeds.
