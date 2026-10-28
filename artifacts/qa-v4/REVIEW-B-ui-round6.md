# REVIEW B — Round 6: Full 8-Class × 3-Skill Capture (Coverage Gap Closed)

Reviewer B, read-only. Evidence: `read_file` + `search_files` on
`artifacts/qa-skills/manifest.json` (121 shot entries = 120 skill shots + `roster`;
each shot carries `skill.active/kind/element/progress/effectFx/cooldowns` and
`player.pose`), `tools/qa-skills.ts`, `src/game/Skills.ts`, and vision review of the
PNGs in `artifacts/qa-skills/` (full frames + `region` crops on the newly captured
Rogue/Necromancer weapon FX). No shell, no source edits, no re-capture; interaction
not observed. Where vision passes disagreed I say UNCERTAIN and give both readings.
Round-5 report: 8.5/10, AGREE.

---

## Round-5 → Round-6 delta

| Reservation (round 5) | Round-5 state | Round-6 observed | Δ |
|---|---|---|---|
| **Coverage gap: no Rogue, no Necromancer captured** | Only 6 classes / 40 PNGs; poison + necrotic unverifiable | **All 8 classes × 3 skills × 5 angles = 120 PNGs**; Rogue and Necromancer fully captured | **CLOSED** |
| `skill-rogue-*.png` (poison green) unverifiable | No Rogue shots | `skill-rogue-{dash,power,defense}-{front,right,back,left,live}.png` exist; **poison green confirmed** | **RESOLVED** |
| Necromancer/necrotic uncaptured | No Necro shots | 15 Necromancer PNGs exist; **necrotic tint is present but pale/ambiguous** (see item 2) | **CAPTURED, PARTIAL colour** |
| Mage `-power-front` renders arcane effect white | White on 1 frame | Still white on `-power-front` **and** `-power-live` | **UNCHANGED (persists)** |
| Metal specular / weapon-arm swing / pose metadata | Fixed, PASS | Re-confirmed; `player.pose == "skill"` in all 120 shots | **HOLDS** |

---

## Coverage matrix (item 1)

`tools/qa-skills.ts` now builds cases via `CLASSES.flatMap` over the three key
slots, so every class is exercised for dash/power/defense. Manifest shot names and
on-disk PNGs agree 1:1: **120 shot names, 120 PNGs, 24 distinct `skill.active`
names, `errors: []`** (0 console errors).

| Class | dash | power | defense | Weapon (manifest) | Element |
|---|---|---|---|---|---|
| Barbarian | ✓ | ✓ | ✓ | Greataxe | fury |
| Warrior | ✓ | ✓ | ✓ | Longsword | fire |
| **Rogue** | ✓ | ✓ | ✓ | Twin Daggers | poison |
| Assassin | ✓ | ✓ | ✓ | — | shadow |
| Mage | ✓ | ✓ | ✓ | Warped Staff | arcane |
| **Necromancer** | ✓ | ✓ | ✓ | Bone Scythe | necrotic |
| Archer | ✓ | ✓ | ✓ | — | wind |
| Priest | ✓ | ✓ | ✓ | War Mace | holy |

Each skill has 5 angles (front / right / back / left / live). **No class/skill lacks
an image.** All 24 `SKILLS_BY_CLASS` names appear in the manifest `roster` entry and
match `Skills.ts` exactly (Reaver's Charge, Skullsplitter, Iron Hide / Shield Dash,
Crushing Blow, Bulwark / Shadowstep, Venom Strike, Evasion / Death Mark, Execution,
Vanish / Blink, Arcane Nova, Mana Shield / Grave Step, Soul Rend, Bone Armor /
Rolling Shot, Piercing Shot, Steady Aim / Divine Step, Smite, Sanctuary).
**Verdict: PASS.**

*(Method note: the task described angles as left/right/front/back/**hit**/live and a
separate `hud-skill-art.png` + roster image. The actual angle set is
front/right/back/left/**live** — no `hit` angle — and the directory holds **only**
120 skill PNGs + `manifest.json`; see item 5.)*

---

## Element colours (item 2)

Manifest `roster` elements: Barbarian=fury, Warrior=fire, Rogue=poison,
Assassin=shadow, Mage=arcane, Necromancer=necrotic, Archer=wind, Priest=holy.
Observed rendered aura per class (vision, multiple angles):

| Class | Element | Expected | Observed | Verdict |
|---|---|---|---|---|
| Barbarian | fury | orange | **orange** aura (power-front) | PASS |
| Warrior | fire | orange | **orange** (power-front); **white/cream** (power-live) | PARTIAL |
| **Rogue** | poison | green | **green** on power-front, power-right, dash-front, defense-front, defense-live | **PASS** |
| Assassin | shadow | violet | **violet/purple** (power-front) | PASS |
| Mage | arcane | cyan | **cyan/blue** (dash-front, defense-front); **white** (power-front, power-live) | PARTIAL |
| **Necromancer** | necrotic | green | **pale greenish-white / white** cone; warm gold ground ring; crops disagreed (front=green tint, right=white) | **PARTIAL / UNCERTAIN** |
| Archer | wind | white-blue | **white / pale blue** cone (power-front) | PASS |
| Priest | holy | gold | **gold/yellow** (power-front, defense-front) | PASS |

- **The previously-unverifiable colours are now captured.** Rogue/poison reads a
  clear **green** on every Rogue frame checked (power-front and power-right show a
  translucent mint/green aura; dash-front and defense-front/live also green). The
  round-5 gap on poison-green is **closed and the claim holds**.
- **Necromancer/necrotic is the weak spot.** It is captured now, but the glow does
  **not** read as a clear saturated green. Full-frame reads called it "pale
  greenish-white / off-white cone, not a saturated necrotic green" (power-front),
  "white" (dash-front), "gold/yellow" (power-live, defense-live, power-back). Region
  crops on the weapon FX split: **power-front crop = green tint, power-right crop =
  white**. The element style in `Skills.ts` supports this — necrotic `core: #c8e6c0`
  is a very pale green and `edge: #2f4a2a` a dark green, so the rendered flare is a
  washed-out greenish-white rather than a poison-strength green. **Verdict: the
  necrotic tint is present but faint; it is not demonstrably "green" the way poison
  is. UNCERTAIN.**
- **Mage/arcane** is cyan on dash/defense but **white on both power frames** — the
  round-5 `-power-front` exception is not a one-off; it also affects `-power-live`.
- **Warrior/fire** is orange on `-power-front` but white/cream on `-power-live`.
- Colours are mutually distinct where they render (green / orange / violet / cyan /
  white-blue / gold); necrotic overlaps white.

---

## Pose (item 3)

- **Metadata: `player.pose == "skill"` in every strike frame.** Arithmetic over the
  manifest: 197 `"pose":"skill"` + 30 `"pose":"idle"` + 13 `"pose":"hit"` = 240 poses
  = 120 shots × (player + opponent). The 30 idle + 13 hit are all **opponent**
  states (spot-checked: e.g. `skill-rogue-power-front` has player = Twin Daggers /
  pose `skill`, opponent = Longsword / pose `idle`). Therefore **all 120 players are
  `skill`** — the round-4 clobbered-pose defect stays fixed.
- **Power = overhead / raised:** Barbarian power-front arm raised overhead (orange);
  Priest power-front arm raised (gold); Necromancer power-front and power-live both
  arms raised overhead; Assassin power-front arm raised; Mage power-live staff raised
  overhead. **Exception:** Warrior `-power-front` reads as a diagonal cut with the
  arm **not** overhead — but Warrior `-power-live` **is** overhead, so the power
  pose holds on at least one frame (minor, angle-dependent).
- **Defence = lowered guard / crouch:** Rogue defense-front = crouched lowered
  guard; Necromancer defense-front = crouched lowered guard; Priest defense-front =
  crouched lowered guard. Confirmed.
- **Dash = forward lunge:** Rogue dash-front = forward lunge; Necromancer dash-live
  = forward lunge. Confirmed.
- **Verdict: PASS.**

---

## Weapons (item 4)

- **Rogue — dagger:** `skill-rogue-power-front` shows a **short dagger/blade** (silver
  blade, dark hilt) clearly shorter than the opponent's longsword; manifest weapon =
  **Twin Daggers**. Reads correctly.
- **Necromancer — scythe:** manifest weapon = **Bone Scythe**. `-power-right` and
  `-dash-live` show a **long dark shaft with a curved, hook-shaped blade** at the top
  — the scythe silhouette. **Caveat:** `-power-front` shows mainly the long straight
  shaft with the crescent blade not clearly visible (reads as a pole from that
  angle), but other angles confirm the curved blade. **Verdict: PASS** (dagger and
  scythe both read; scythe blade clearer on some angles than others).

---

## HUD (item 5)

- **`hud-skill-art.png` does not exist.** `tools/qa-skills.ts` writes only
  `skill-<class>-<kind>-<angle>.png` shots plus the `roster` manifest entry; there is
  **no** dedicated HUD/skill-art capture and **no** roster PNG. A project-wide search
  for `hud-skill-art` / `*skill-art*` finds only report text and `probe-art.ts`, not
  an image. So the round-6 task's stated HUD artifact is **MISSING — UNVERIFIABLE as
  a standalone file.**
- **However, the HUD is visible inside the `-live` frames and is correct.** In both
  `skill-rogue-defense-live` and `skill-necromancer-dash-live` the left-side skill bar
  shows three rows with **three differently shaped icons**:
  **chevron/arrow (dash) · starburst (power) · shield (defense)** — matching the
  `kind` field. Skill names and tags (`Shadowstep — dash`, `Venom Strike — power`,
  `Evasion — defense`; `Grave Step`, `Soul Rend`, `Bone Armor`) are legible.
- **Verdict: PARTIAL** — the three-icons-per-class, kind-differentiated HUD is
  **verified from the live shots**, but the specific `hud-skill-art.png` artifact the
  task names **was not produced**.

---

## UNCERTAIN (honest limits)

1. **Necrotic colour.** Region crops of the same effect disagreed (power-front =
   green tint, power-right = white); full frames ranged from "pale greenish-white" to
   "gold" to "white". Best-supported reading: a **faint, desaturated greenish-white
   flare plus a warm ground ring**, not a clear green. Cannot certify "necrotic →
   green" at poison-strength.
2. **Ground ring colour is inconsistent with element.** Rogue shows a green ring,
   Priest a gold ring, but Mage shows a yellow-orange ring and Necromancer a yellow
   ring despite cyan/green elements. The ring may be a generic indicator rather than
   an element aura; this muddies per-frame colour reads.
3. **Mage arcane is white on the power skill** (front and live), cyan only on
   dash/defense — arcane is not uniformly cyan.
4. **No `hit` angle exists** (task expected one); the fifth angle is `live`.

---

## Score

**Round 5 = 8.5 → Round 6 = 9.0 / 10.**

The round-5 blocker — the missing Rogue and Necromancer captures — is **fully closed**:
24/24 skills, 8/8 classes, 120 PNGs, 0 console errors, and poison-green is now
verified on real Rogue frames. Held back from higher by (a) the **missing
`hud-skill-art.png`** artifact, (b) the **weak/ambiguous necrotic colour** (the one
element still not demonstrably green), and (c) the **persisting white arcane on the
Mage power skill**.

| Count | Items |
|---|---|
| **PASS** | 3 — Coverage (1), Pose (3), Weapons (4) |
| **PARTIAL** | 2 — Element colours (2), HUD (5) |
| **FAIL** | 0 |

---

## Verdict: **AGREE** (coverage gap closed)

Accepted as claimed:
- **All 8 classes × 3 skills are captured** — 120 PNGs, 24 distinct active skills, 0
  console errors; the roster in `Skills.ts` and the manifest agree on all 24 names.
- **Rogue / poison renders green** — the specific gap from round 5 is now verifiable
  and the claim holds.
- **Necromancer / necrotic is now captured** and its dagger↔scythe and
  dagger↔scythe-style weapons read correctly (Rogue dagger, Necromancer scythe).
- `player.pose == "skill"` in every strike frame; arms raised for power, lowered for
  defence, lunging for dash; the three HUD icons differ by kind (chevron / starburst
  / shield).

Not accepted / open:
- **`hud-skill-art.png` does not exist** — the named HUD artifact was not produced
  (the HUD itself is verified only incidentally, inside the `-live` frames).
- **Necrotic does not read as a clear green** — it is a faint greenish-white/white
  with a warm ring; "necrotic → green" is UNCERTAIN.
- **Mage arcane is white on the power skill** (front and live) — the round-5
  single-frame exception is broader than reported.

Blockers: none that break correctness — all classes, skills, poses, weapons, and HUD
behaviour function; the residual items are a missing artifact and colour-fidelity
ambiguity, not defects.

**On the specific question — is the round-5 coverage gap closed?** **Yes. AGREE.**
The uncaptured Rogue and Necromancer sets now exist and cover every skill; poison
green is confirmed. The only caveat carried forward is that necrotic green remains
weak/unverifiable as a saturated colour, and the standalone HUD artifact is missing.
