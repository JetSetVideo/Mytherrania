# Lane W2 — Weapon readability at gameplay distance — handoff

Goal: make all 17 generated archetypes read as what they are in the third-person view (rival
~7 m away), within 600 triangles / 2 draw calls, with blades tapered, a real rapier, readable
hammer/mace heads and value contrast at noon and at night. Nothing outside
`src/graphics/weapons/**`, `src/game/weapons/Archetypes.ts` and `tests/weapons_*_test.ts` was
edited (`Generate.ts` needed no change; `Profile.ts`, `Form.ts`, `Features.ts`, the engine,
combat and animation were not touched). Nothing committed.

## Outcome (short)

* Blind identification by a vision model, 17 archetypes, 4 conditions, fixed prompt, synonym
  rubric written before the runs (`score.py`): **strict 10/11/9/11 before -> 13/12/9/13 after**
  (2x-DPR mean 10.7 -> 12.7); **family-level 14/15/10/13 -> 15/15/12/15**.
  **The 15/17 strict target is NOT met** (best 13/17). Persistent misses: flail (0/4, read as a
  staff), short sword (0/4, read as a dagger), greatsword (0/4 strict, always "longsword"), maul
  (1/4 strict, usually "warhammer").
* Clear per-weapon gains (strict, out of 4): rapier 1 -> 3, axe 1 -> 3, warhammer 2 -> 4,
  greataxe 2 -> 4, halberd 2 -> 3, mace 3 -> 4, bow 3 -> 4. Regressions: longsword 4 -> 2 (named
  "sword": family still 4/4), sabre 4 -> 3 (1x only: "sickle"), maul 2 -> 1 (naming), flail 1 -> 0.
* Every archetype's distinguishing feature now spans >= 6 px at 7 m (tested over 60 seeds each);
  head/haft value contrast >= 1.97x luminance for every metal x wood (tested); edge band >= 1.60x
  the flat (tested); tapered blades; the rapier has a 0.95-1.1 m needle blade with a cup and a
  knuckle bow; the ink no longer swells in close-ups. Tris 100-308 (budget 600), 2 draw calls.

## 1. The gameplay view and the minimum feature size

`Engine.ts:377` builds the third-person camera at 50 deg; `SettingsPanel.ts:97,221` makes the
default fov 50 deg (vertical). Viewport 577 CSS px tall (the parent's 1280x577), rival at 7 m:

    px per metre = (577 / 2) / (7 * tan(25 deg)) = 88.4 px/m (176.8 device px/m at 2x DPR)
    6 px  ->  6 / 88.4 = 0.068 m          (WeaponModel.minFeatureSize(), GAMEPLAY_VIEW)

## 2. Silhouette rules per archetype (implemented + tested)

"Across" = the feature's larger extent off the weapon axis, "along" = its extent on it; the
minimum over 60 seeds per archetype (`deno test tests/weapons_readability_test.ts`, real output),
in 1x CSS px at 7 m (in-plane, i.e. seen square-on). Rule: both >= 6 px (staff: the bare pole).

| archetype | distinguishing feature (what was done) | min across / along |
|---|---|---|
| dagger | short triangular blade (long needle point, `BLADE_LOOK`) + cross >= 7 cm (guard span r(0.035, 0.055), look-only) | 6.2 / 24.2 px |
| shortsword | broad leaf blade (VISUAL width 1.2x, leaf bulge) + oval gladius guard + ball pommel | 7.1 / 53.7 px |
| sabre | curved single edge, long tapered point (point 20%), KNUCKLE BOW on the edge side | 12.2 / 74.1 px |
| rapier | 0.95-1.1 m needle blade (tip 42% then 22% point) + swept hilt: cup Ø 10 cm, quillons with ball finials, knuckle bow | 15.6 / 16.1 px |
| longsword | long straight cross (span 0.2-0.26 m) + wheel pommel + fullered blade, 20% point | 17.7 / 23.6 px |
| greatsword | V guard (quillons rise 26°, ball finials, drawn 1.2x span), leather ricasso + parrying hooks, blade 1.15x wide | 34.2 / 46.1 px |
| spear | leaf head drawn max(1.3 R, 3.4 cm) half-width, bright edges / dark midrib, dark socket | 6.0 / 25.4 px |
| halberd | axe blade riveted along the socket (no neck), flat diamond top spike, hooked fluke | 16.1 / 42.4 px |
| scythe | long reaping blade, 30% tapered point, iron collar | 29.1 / 31.2 px |
| staff | dark pole with bright iron ferrules (no head = its identity) | pole 1.60 m+ |
| axe | big bearded crescent bit only — no eye block, no poll lug, no stub above the head | 10.7 / 14.6 px |
| greataxe | as the axe, Dane-axe size | 15.0 / 21.7 px |
| mace | 6-8 Gothic pentagonal flanges peaking at 1.12 R over a dark core, finial, short collar | 6.8 / 9.4 px |
| flail | dark handle, BRIGHT big links, spiked ball (core 1.0 R, 9 spikes to 1.5 R) | 9.7 / 18.3 px |
| warhammer | T head: crowned face drawn 2.0 R + arched beak drawn 1.7x long; NO top spike | 14.9 / 6.8 px |
| maul | octagonal sledge block, bright bevelled faces, dark iron bands, dark langets | 14.8 / 9.5 px |
| bow | limbs (raw wood x0.7) + 8 mm cream string + horn nocks | 8.6 / 107.9 px |

What was tried and rejected (each measured with the blind namer): a neck flaring both ways on
the halberd blade reads as a **pennon**; any block behind or above an axe bit (eye block, poll
lug, wooden stub with a knob) reads as a **hammer / poleaxe / pick**; a long top spike on the war
hammer reads as a **mace / morning star / trident**; an S-laid flail chain reads as a **curled
staff finial**; blockier mace flanges read as a **hammer**.

### Physics vs visual-only

Physical axes changed (Archetypes.ts; features, mass model and profile follow automatically):

| archetype | axis | before | after | why |
|---|---|---|---|---|
| rapier | headLength / length | 0.9-1.12 / 1.07-1.32 m | 0.95-1.1 / 1.1-1.3 m | the brief's 0.95-1.1 m blade |
| axe | headLength / headRadius | 0.10-0.20 / 0.08-0.15 m | 0.16-0.27 / 0.13-0.20 m | at 0.1-0.2 m the bit is a 12x7 px blob read as a hammer |
| greataxe | headLength / headRadius | 0.18-0.32 / 0.13-0.22 m | 0.24-0.36 / 0.18-0.26 m | must dwarf the hand axe |
| dagger | guardHalfSpan (look-only) | 0.03-0.05 | 0.035-0.055 | 6 px guard |

Profile after the change (`tests/weapons_profile_test.ts`, 2,000 weapons per class): relativeDps
min 0.9998 max 1.0002 mean 1.0000; heavy accuracy mean 0.855 (unchanged), heavy minDamage mean
1.105 (was 1.107), heavy cooldown mean 1.295 (was 1.298). All class-ordering tests pass.

VISUAL-ONLY (mesh only, spec numbers untouched, named `VISUAL_*` in WeaponParts.ts; every strike
feature still lies on or inside the drawn part — existing on-mesh test):
`VISUAL_LEAF_SCALE 1.3 / VISUAL_LEAF_MIN 0.034` (spear leaf, edge features ~1 cm inside the
drawn edge), `VISUAL_HAMMER_FACE 2.0` (face drawn 2 R; the face sphere sits inside),
`VISUAL_BEAK 1.7` (**drawn beak tip up to 6.7 cm past the point feature**, bounded by a test at
7.5 cm), `VISUAL_FLANGE_REACH 1.12`, `VISUAL_BALL_CORE 1.0 / VISUAL_SPIKE_REACH 1.5` (flail),
`BLADE_LOOK` profiles (drawn edge within ~0.35 w0 < 1 cm of the edge features; shortsword 1.2x,
greatsword 1.15x wide), `GREATSWORD_GUARD_SCALE 1.2`, `GREATSWORD_HOOK 0.07`, rapier cup/knuckle
bow, sabre knuckle bow, `BOW_STRING_RADIUS 0.004`, `CHAIN_PITCH 0.06`. The axe's **poll head
feature (Features.ts) is no longer drawn** (a drawn poll read as a hammer).

## 3. Value contrast (implemented + tested)

At noon the cel shader lights a surface by ambient x 1.15 + light x band (ambient 0.83, light
1.1: `Environment.environmentAt(12)`, `Engine.ts:521-525`), so a `#e3eaee` steel blade clipped to
pure white everywhere (L* 99, measured) — head, flats and edge one white blob.

* `paletteOf()` (WeaponModel.ts): **flat** = lerp(metal.dark, metal.blade, `FLAT_MIX 0.6`) for
  blade flats / bit cheeks; **edge** = metal.highlight on the apex of every blade section and on
  a crisp 2.5 mm-stepped band on axe bits, beak/flange rims, maul faces; **dark** = metal.dark for
  spines, fullers, sockets, langets; **wood** = WOODS x `HAFT_SHADE 0.4`; bow limbs x 0.7.
* Tested over every metal x wood: worst head/haft luminance ratio **1.97** (bronze on ash), worst
  edge/flat **1.60**.
* Rendered medians (seed 6, 2x, ground L* 62.5 noon / 18 night): steel heads L* 99 -> 73-97 at
  noon (no longer clipped), hafts L* 60 -> 40 (they were ground-coloured); at night heads
  32-39, hafts 17.7 (the haft sinks into the ground, the head stays lit). Table:
  `/Users/macmax/.hermes/cache/scratch/laneW2/metrics_table.md`.
* Ink (WeaponMaterial.ts): width x clamp(depth / `INK_REF_DISTANCE 7`, 0, 1) — unchanged at 7 m
  (1.8 px), but a 1-3 m close-up no longer wraps a 2 cm rapier blade in 2 cm of ink a side (the
  "short, stubby, rectangular blade with a flat blunt end" in the parent's close-up).

## 4. Headless verification

Renderer: `/Users/macmax/.hermes/cache/scratch/laneW2/render.ts` — a software rasteriser that
mirrors WeaponMaterial (3 cel bands, rim, vertex specular, inverted-hull ink on welded normals,
sRGB out), perspective fov 50, 577 px view, 3x supersampling, weapon at 7 m with the in-hand
-0.2 rad cant, 12° elevation, light 60° high and 40° left of the camera. Contact sheets are in a
fixed shuffled order (no family hints), numbered, 115x240 CSS px cells (1.3 x 2.7 m). Before =
`git archive HEAD` copy (`render_head.ts`; byte-identical to the tagged-HEAD render).
`W2_ASCII=n` prints a cell as L* characters — how silhouettes were checked without vision.

Conditions: **A** seed 6 noon yaw 45° 2x DPR; **B** seed 11 night 45° 2x; **C** seed 6 noon 45°
1x; **D** seed 22 noon yaw 135° 2x — **held out** (never looked at during development; A was the
development condition, so A is not independent). Prompt (identical for every run): *"This
contact sheet shows N numbered objects ..., all drawn at the same scale (each cell is about 1.3 m
wide and 2.7 m tall in the world) as seen in a video game from about 7 metres away. Each object is
a hand-held weapon. For each numbered cell, name the specific weapon type you see (the most
specific common name) ..."* — no names given. Scoring in code (`score.py`): strict = archetype
synonyms (e.g. maul = maul/sledgehammer/great hammer, warhammer = war hammer/war pick/horseman's
pick, greataxe = great/battle/Dane axe, flail = flail/ball and chain, "morning star" only with a
chain); family = sword / axe / hammer families merged.

| condition | before strict | before family | after strict | after family |
|---|---|---|---|---|
| A seed 6 noon 45° 2x (dev) | 10/17 | 14/17 | 13/17 | 15/17 |
| B seed 11 night 45° 2x | 11/17 | 15/17 | 12/17 | 15/17 |
| C seed 6 noon 45° 1x | 9/17 | 10/17 | 9/17 | 12/17 |
| D seed 22 noon 135° 2x (held out) | 11/17 | 13/17 | 13/17 | 15/17 |

Per weapon (strict / family out of 4; raw names A, B, C, D):

| archetype | before | before names | after | after names |
|---|---|---|---|---|
| dagger | 4 / 4 | dagger x4 | 4 / 4 | dagger x4 |
| shortsword | 0 / 0 | dagger x4 | 0 / 0 | dagger x4 |
| sabre | 4 / 4 | katana, katana, scimitar, katana | 3 / 3 | scimitar, saber, sickle, scimitar |
| rapier | 1 / 4 | arming sword, shortsword, rapier, arming sword | 3 / 4 | shortsword, rapier, rapier, rapier |
| longsword | 4 / 4 | longsword, longsword, arming sword, longsword | 2 / 4 | longsword, sword, sword, longsword |
| greatsword | 0 / 4 | longsword x4 | 0 / 4 | longsword x4 |
| spear | 4 / 4 | spear, spear, pike, spear | 4 / 4 | spear x4 |
| halberd | 2 / 2 | halberd, halberd, spear, polehammer | 3 / 3 | halberd, halberd, lance, halberd |
| scythe | 4 / 4 | scythe x4 | 4 / 4 | scythe x4 |
| staff | 4 / 4 | quarterstaff x4 | 4 / 4 | quarterstaff x4 |
| axe | 1 / 1 | pickaxe, hatchet, war hammer, hammer | 3 / 3 | war axe, hatchet, shortsword, hatchet |
| greataxe | 2 / 3 | poleaxe, battle axe, halberd, battle axe | 4 / 4 | battle axe x4 |
| mace | 3 / 3 | javelin, mace, mace, mace | 4 / 4 | mace x4 |
| flail | 1 / 1 | flail, morning star, quarterstaff, quarterstaff | 0 / 0 | staff, staff, mace, staff |
| warhammer | 2 / 3 | war hammer, hammer, mace, war hammer | 4 / 4 | war hammer x4 |
| maul | 2 / 4 | war hammer, warhammer, maul, maul | 1 / 4 | maul, warhammer, warhammer, warhammer |
| bow | 3 / 3 | longbow, bow, scythe, longbow | 4 / 4 | longbow, bow, longbow, longbow |

Caveats (measured, not assumed): the namer is deterministic for an identical image but flips
labels of UNCHANGED cells when another cell changes (e.g. halberd/rapier/flail changed name when
only the axe cell changed), so one sheet is +-2; four conditions are reported, not the best one.
In 5-cell development probes it named axe, greataxe, sabre, mace, dagger correctly (hatchet,
battleaxe, scimitar, mace, dagger), war hammer / maul / mace / axe correctly with the flail as a
"war pick", and the greatsword "claymore (V-shaped crossguard)" — but in the 17-cell sheets the
greatsword is always "longsword". A 1.8 m box mannequin holding
each weapon (protocol P2, `W2_FIGURE=1`) was tried during development only (10/17, not run on
"before"), so it is not part of the comparison. Raw outputs: `.../laneW2/vision/*.txt`
(`FINAL_*` = scored after, `before_*` = scored before; sheet 2 of each condition was re-run
after the last code change, the sabre point; sheet 1 images are byte-identical to the scored ones).

Sheets: `.../laneW2/sheet_before_s{6,11,22}_*.png`, `.../laneW2/sheet_final_s{6,11,22}_*.png`.

## 5. Triangles (60 seeds each, budget 600, 2 draw calls; `weapons_model_test.ts`)

| archetype | before | after |
|---|---|---|
| dagger | 124 | 152 |
| shortsword | 100 | 148 |
| sabre | 112 | 178 |
| rapier | 88 | 276 |
| longsword | 100 | 156 |
| greatsword | 100 | 260 |
| spear | 104 | 115 |
| halberd | 140 | 201 |
| scythe | 134 | 144 |
| staff | 100 | 100 |
| axe | 122 | 148 |
| greataxe | 146 | 172 |
| mace | 154-190 | 223-275 |
| flail | 188-296 | 224-308 |
| warhammer | 96-108 | 135-147 |
| maul | 120 | 231 |
| bow | 94 | 158 |

## 6. Files changed

| File | Change |
|---|---|
| `src/graphics/weapons/WeaponParts.ts` | Rewritten part builders: palette ramp (`flat`, `woodLight`), `BLADE_LOOK` profiles + ricasso, per-archetype hilts (cup, knuckle bow, V guard + hooks, oval guard, wheel pommel), bearded/riveted axe bit with crisp edge band, diamond halberd spike + hooked fluke, Gothic flange plates, bright chain, big spiked ball, T war hammer with arched beak, banded maul, thicker bow limbs; helpers `pathTube`, `plate`, `langets`, `lookHalfWidth`; `VISUAL_*` constants |
| `src/graphics/weapons/WeaponModel.ts` | `paletteOf` (FLAT_MIX, HAFT_SHADE, BOW_LIMB_SHADE), `GAMEPLAY_VIEW`, `minFeatureSize()`, `READABLE_PARTS`, part tags, new head assembly (langets, axe without eye/poll, halberd, nocks, string radius) |
| `src/graphics/weapons/WeaponMaterial.ts` | Depth-capped ink (`inkDistance` uniform, `INK_REF_DISTANCE = 7`) |
| `src/graphics/weapons/MeshKit.ts` | `setPart(name)` + `parts[]` per triangle (QA tags; not in the geometry) |
| `src/game/weapons/Archetypes.ts` | Rapier blade 0.95-1.1 m; axe / greataxe bit sizes; dagger guard span |
| `tests/weapons_readability_test.ts` | NEW, 7 tests: min feature size from the camera, 6 px rule for all 17 (60 seeds), value contrast for every metal x wood, blade taper + drawn tip = point feature, rapier length + cup + knuckle bow, beak exaggeration bound, depth-capped ink |

Mutation checks (applied, run, reverted, `cmp` confirmed restore): spear leaf min 0.02, haft
shade 0.9, rapier without knuckle bow, ink not depth-capped, untapered rapier, beak 3.5x — each
fails the suite.

## 7. Commands (real output)

```
$ deno check src/graphics/weapons/*.ts src/game/weapons/*.ts tests/weapons_*_test.ts
(only "Check <file>" lines, 15 files)
$ deno lint src/graphics/weapons/ src/game/weapons/Generate.ts src/game/weapons/Archetypes.ts tests/weapons_*_test.ts
Checked 10 files
$ deno test --allow-read tests/weapons_generate_test.ts tests/weapons_profile_test.ts tests/weapons_model_test.ts tests/weapons_readability_test.ts
ok | 27 passed | 0 failed (890ms)
relativeDps over 2000 weapons: min 0.9998 max 1.0002 mean 1.0000 median 1.0000
value contrast: worst head/haft ratio 1.97, worst edge/flat 1.60
warhammer: drawn beak tip at most 6.7 cm past the point feature (VISUAL_BEAK)
```
`SkinnedHumanoid.ts` (the only outside importer, `buildWeaponModel`) still type-checks.

## 8. Open issues

* **Target missed: 13/17 strict at best.** Flail (staff/mace: a taut chain is a stick at 7 m; a
  hanging ball would contradict the taut-chain strike features in Features.ts — lane W/X decision),
  short sword vs dagger (only absolute size differs; the namer ignores scale even with a 1.8 m
  mannequin), greatsword vs longsword (V guard + hooks + ricasso win in isolation only), maul
  named "warhammer" (a naming convention as much as a shape problem).
* **1x DPR is still weak** (9/17 strict): at 88 px/m a hand axe is ~10x17 px and a sabre's curve
  is a few px.
* **Collision vs picture**: the war hammer's drawn beak runs up to 6.7 cm past its point feature,
  and the axe's poll sphere has no drawn counterpart. If lane X wants collision = picture, scale
  `Features.hammerSpike` by `VISUAL_BEAK` and drop or shrink the axe poll feature (Features.ts is
  not lane W2's file).
* **Not verified in the live WebGL game** (no build, per the brief): the parent's noon/2x close-up
  and gameplay shots should be re-taken; the 3/4 software view is an approximation of the
  behind-the-shoulder camera, and the vision namer sees isolated weapons, not swinging ones.
* Lowest head/haft pairs: bronze on ash 1.97x, iron on ash 2.16x, bronze on yew 2.28x; obsidian
  heads are darker than most hafts (2.39x the other way) and only their edge band lifts them at
  night.
