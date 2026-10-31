# Wave L — verification (measured)

Every number below is a tool's literal output. Wave L answers the ask quoted in
`docs/creation/BRIEF.md`: improve the components from the main page to the panel you leave from to enter
the ring, give every race AND sub-species an étendard, make the generator's dice button show the model
and the statistics and refresh the Creator step, and put the options in visibly closed trees.

## 1. Étendards (lane L-A, `src/ui/RaceBanners.ts`)

16 standards: 4 races + 12 sub-species, **all 16 distinct as strings, 0 duplicates**, all four charges of
each race pair exercised. Per-race table (literal, from the lane's report and
`artifacts/design/race-banners.json`):

| race | charge | field | charge colour | trim | sub-species (charge / cadency / field) |
| --- | --- | --- | --- | --- | --- |
| human | crown | `#c98a63` | `#6b4130` | `#b5762e` | imperial crown/saltire/`#d99a70` · nomad crown/bordure/`#c08050` · islander sun/chief/`#c07a52` |
| elf | laurel | `#e8e2dc` | `#2f3d63` | `#5b7c99` | high star/saltire/`#f0eae4` · wood laurel/fess/`#dcd8cc` · dark star/chevron/`#cdc0d6` |
| dwarf | hammer | `#c58a5a` | `#4a2f22` | `#6f7378` | mountain hammer/pile/`#c8905e` · forge hammer/chief/`#b87a4c` · deep anvil/fess/`#c0a078` |
| ork | tusk | `#7fae4e` | `#33421f` | `#7c6a9e` | greenhide tusk/bend/`#8ac054` · ironhide skull/pile/`#6f9a48` · bloodfang skull/chief/`#86b258` |

Cadency is chosen by an FNV-1a hash of the sub-species id (documented in the module), so it is
reproducible and a sibling cannot collide. `deno test tests/racebanners_test.ts` → **9 passed / 0 failed**;
`tests/ui_icons_test.ts` (pre-existing, dice + chevron-down added) → **5 passed / 0 failed**.

**On screen** (probe): race boxes 4, races carrying a standard **4**, sub-species chips 12, chips carrying
a standard **12**, distinct race standard bodies **4**.

## 2. The dice, the model and the sheet (lanes L-B/L-D + the parent's preview)

`rollProfile(rng)` and `creatorSheet(profile)` (lane L-B, `tests/creatorroll_test.ts` → **7 passed**): over
200 rolls all **4 races** and all **8 classes** appeared; the same seed reproduces the profile and its seed
(20261031 → 1926776823 both runs); every sheet row is compared against
`createStats → applyRaceBonus → applySecondary → applyLevel`, and the pool is read, never hard-coded.

The dice button, measured live in Chrome:

```
present true · hasDiceIcon true · 122 x 48 px
colour rgb(243,230,255) · background rgb(42,35,56) · border rgb(160,108,213)  (= the violet #a06cd5 trim)
boxShadow steps 3   (the struck-stone face)
```

One click, one refresh:

```
model before  "Sir Aldric|human|imperial|Warrior||1.8000|90.0000|#172128|mountain"
model after   "Ash|human|imperial|Warrior|sword|1.7315|59.1222|#c0a070|serpent"
modelFollowedRoll true · previewLive true · triangles 10896
sheet rows 16 · "Ash Human · Imperial · Warrior / Longsword · sign The Serpent | Vitality 7 ... 
              Derived: Max Health 24 375, Attack Power 374 (≈ 314 a blow vs. an even foe), 
              Attack Interval 1.08 s, Armour 4"
creatorRefreshed true · rollChangedSomething true
```

The model is a live turntable drawn by `src/graphics/PreviewScene.ts`, built through the SAME path the
arena uses (`raceBuild` → seeded hair/skin/silhouette → `buildSkinnedHumanoid` with
`{garment, weaponSpec}`), so the Creator shows the fighter the match will build. It is drawn only while
its canvas is on screen (`offsetParent !== null`), which is what keeps the second WebGL context off the
fight's budget (below).

**Weak spot I will not hide:** the probe's `selectionBefore/After.race` field read `""` both times — my
selector for the open race box was wrong — so the refresh is proven by the name, the class and the model
key changing, and by the sheet rewiring, not by that field.

## 3. Closed trees (lane L-C, `src/ui/UiTree.ts` + `src/ui/Disclosure.ts`)

Live DOM: **18 option groups, 1 open on arrival**, `openKeys ["title/start/modes"]`, every header carrying a
count, 18 `summary.opt-head` elements. Per-group state on the Creator screen (all CLOSED):
`ancestry/race, ancestry/subrace, ancestry/hero, ancestry/lore(6), calling/class, calling/weapon,
calling/skills, sign/birthsign, sign/secondary, opponent/rival, opponent/terms(2), opponent/spectate(7),
opponent/inspect(7), arena/field(2), arena/walls(2), arena/pickups(2)`.

`tests/disclosure_test.ts` → **12 passed**; pre-existing `tests/uitree_test.ts` → **5 passed**, unmodified. A
bug the lane found in its own TDD and fixed: `initialDisclosure(tree)` read the global tree instead of its
argument, so an injected tree opened the wrong groups.

## 4. Regression on the two earlier UI waves (the menu was rewritten, so this is the evidence it still is)

`tools/probe-wave-h.ts` first came back with **three false claims** — the ancestry lore panel read "Imperial"
for both the ork and the elf selection (`panelsDiffer false`, `orkMentionsChin false`,
`elfMentionsThinMoustache false`). Cause: the race cards became heraldic boxes wrapping the toggle button,
so a delegated click landing on the BOX no longer resolved to a `.race-toggle`. Fixed in the delegated
handler (`toggleFromBox`: the box resolves through its own toggle, which also makes the whole card one
target). Re-run:

```
panelPresent true · elfHasSkinHairBeard true · orkMentionsTusks true · orkMentionsChin true
elfMentionsThinMoustache true · panelsDiffer true · errors []
ork  "Greenhide — Born in the Blood Marshes: the plainest green hide and the barest chin. …"
elf  "High Elf — Star-touched scholars of Elun-Dar, taller even than their kin, with a haughtier brow. …"
```

`tools/probe-wave-i.ts` after the rewrite: camera angle held **true**, props **0 floating**, seams **15/15**,
card bars **12 squares** with the numbers inside **true**, clash **capped true** (284 spawned), card swap and
close both true, **errors []**.

## 5. Gate

| command | result |
| --- | --- |
| `deno task check` | 0 errors |
| `deno task test` | `ok \| 1388 passed \| 0 failed` (Wave K: 1346; the wave added LL1–LL4 and the lanes' new files) |
| `deno lint` | `Checked 488 files` (0 problems) |
| `deno task build` | `1782828 bytes` (Wave K: 1 768 201) |
| `deno test tests/spec_test.ts` | LL1–LL4 pass (`[SPEC LL1..LL4]`) |
| `deno run -A tools/probe-wave-l.ts` | banners/trees/dice/sheet as above, 4 viewports with **no clipping**, **errors []** |
| `deno run -A tools/frame-budget.ts` | day p99 3.2 ms (headroom 13.4 of 16.6), night p99 8.8 (7.8), **spectate p99 3.8 ms (12.8)** with the preview context live |

The probe's own `frame` block reads `p50 16.7 / p99 17.4 ms` — that is the rAF INTERVAL (vsync-paced), not
CPU cost, so it is a weaker measurement than `tools/frame-budget.ts` and it is quoted only as "60 FPS held".
The GPU timer was **unavailable** on that run (`gpu unavailable`), so no GPU number is claimed for this wave.

## 6. Open, stated honestly

- The last sentence of the ask ("Options should be visually in their closed tress tha…") is truncated in the
  transcript; the decode is in the brief and it is the one thing in this wave I inferred rather than heard.
- The preview rebuilds the whole rig on every roll and does not dispose the shared body/skin caches (they
  are reused by design); a session with hundreds of rolls is untested.
- `renderPortrait` (the sheet's PNG) still draws the older `buildHumanoid` body — the Creator now shows the
  real one, the sheet's portrait was left alone because it is a different screen and a different wave's
  evidence.
- No eye has judged the new components: everything here is geometry, DOM and colour read by a machine. The
  four viewports were checked for CLIPPING, not for taste.
