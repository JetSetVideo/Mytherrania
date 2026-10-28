# REVIEW B — Round 5: Metal Specular · Weapon-Arm Swing · Element-Accurate FX

Reviewer B, read-only. Evidence: `read_file` + `search_files` on `artifacts/qa-skills/manifest.json`
(per-shot `skill.element/active/effectFx`, `player.pose`, 24-entry `roster`) and `artifacts/qa-v4/manifest.json`,
plus vision review of the 40 PNGs in `artifacts/qa-skills/` (full frames; `region` crops not needed —
full-frame reads were decisive). No source read, no shell, no re-capture. Interaction not observed.
Where two vision passes disagreed I say UNCERTAIN and give both readings. Round-4 report: 7.5/10.

## Round-4 → Round-5 delta

| Reservation (round 4) | Round-4 state | Round-5 observed | Δ |
|---|---|---|---|
| 1. Barbarian greataxe non-metallic (no specular in shader) | Orange/tan crescent, no highlight | Axe head reads **dark steel / pale grey with a bright white specular highlight** in `-front`, `-right`, `-live` | **FIXED** |
| 2a. Manifest `player.pose` = `"idle"` in all strike frames | `idle` (clobbered by `setPose`) | `player.pose == "skill"` in **every** strike frame; `skill.active` names the skill (`Skullsplitter`, `Crushing Blow`, `Sanctuary`, …) | **FIXED** |
| 2b. Barbarian power frame = recoil, not chop apex | Low guard / recoil | Weapon arm **raised overhead** at the chop apex in `-front`, `-right`, `-live` | **FIXED** |
| 3. Effects saturate white; no cyan/green; hues ≠ element | White FX, orange Warrior trail, gold Priest *ground ring* only | **Cyan/blue** arcane, **gold** holy, **violet** shadow, white-blue wind, orange fire/fury — distinct | **FIXED (see caveat)** |

## Verdict per item

| # | Item | Verdict |
|---|------|---------|
| 1 | Metal specular — axe/blade read as metal (grey + highlight) | **PASS** |
| 2 | Corrected weapon-arm swing + corroborating pose metadata | **PASS** |
| 3 | Element-accurate, mutually distinct effect colours | **PASS (with caveat)** |

## 1. Metal specular — PASS
- **Barbarian Greataxe** (HUD confirms `Greataxe vs Longsword`): `-right` = dark steel head with a bright white
  highlight along the top edge; `-front` = pale grey/steel-white blade with a white specular streak;
  `-live` = grey/silver head with a white highlight. Three independent reads agree it is **metallic**, not
  orange/tan. The warm cast in `-front` is the translucent swing-trail overlay tinting the scene, not the
  material.
- **Warrior Longsword** `-power-front` (round-4 "flat orange slab"): now clearly a **silver/white blade with a
  bright highlight plus crossguard and pommel**; the orange shape is the swept swing-trail VFX, a separate
  object. `-power-live` = silver blade, white highlight. Reservation resolved.
- Grip/bowstring stay matte (Archer bow: white/silver tube, no spurious specular). Metal now differs by class
  (steel/silver vs gold staff head vs dark haft).

## 2. Corrected weapon-arm swing + pose metadata — PASS
- **Manifest corroborates the swing** (was the round-4 gap): `player.pose == "skill"` in **all 40 strike
  frames** (grep: lines 70,95,179,…,4346), and `skill.active` names the active skill per shot
  (`Shield Dash`, `Crushing Blow`, `Bulwark`, `Skullsplitter`, `Arcane Nova`, `Piercing Shot`, `Sanctuary`,
  `Death Mark`). The field that previously read `idle` now proves the pose.
- **Power = overhead chop:** Barbarian `-front/-right/-live` arm raised, axe held high (chop/wind-up apex);
  Warrior `-power-live` sword raised in an overhead chop; Mage `-power-live` both arms raised, staff overhead.
- **Defence = lowered guard:** Warrior `-defense-front` crouched, blade level across the body (lowered
  defensive guard, not an attack); Priest `-defense-back` arm forward casting a dome shield, blade down.
- Dash = forward lunge (Assassin `-dash-front` deep lunge; Warrior `-dash-live` forward-leaning charge).
- Minor: Archer power is a **bow draw** (arm extended, string pulled) rather than an overhead chop — correct
  for a bow, not a defect.

## 3. Element-accurate effect colours — PASS (with caveat)
Manifest elements (`roster`): Barbarian=fury, Warrior=fire, Rogue=poison, Assassin=shadow, Mage=arcane,
Necromancer=necrotic, Archer=wind, Priest=holy. Observed colours:
- **Mage / arcane → cyan-blue.** `-right` = cyan-blue crescent arc; `-back` = cyan/teal Mana-Shield dome;
  `-left` = cyan/teal crystalline aura; `-live` = cyan crystal staff tip. 4/5 shots read cyan. **`-front` is
  the exception** — two passes agree it shows a white/neutral staff glow + an orange *ground ring*, no cyan
  (see UNCERTAIN).
- **Priest / holy → gold.** `-front` = golden-yellow cone of light; `-live` = gold aura + golden arc;
  `-back` = pale golden-yellow dome shield. Consistent gold; the round-4 "gold = ground decal only" is gone.
- **Assassin / shadow → violet.** `-dash-front` = translucent lavender/violet trail, no green.
- **Archer / wind → white / pale blue-grey** cone.
- **Warrior / fire & Barbarian / fury → orange/amber** trails/rings (`-dash-live` = orange-red streak;
  `-power-live` = amber trail; Barbarian = orange aura/ring).
- The hues are now **mutually distinct** and match element semantics. The manifest `effectFx` still scales
  with health removed (Warrior live: 0.162 defence / 0.236 dash / 0.888 power vs 3.84 / 8.16 / 18.24 % dmg).
- **Caveat / not verifiable:** the task asks about **Rogue `poison` green** — the roster lists
  `Rogue/…/poison` but **no Rogue shots were captured** (only Warrior, Barbarian, Mage, Archer, Priest,
  Assassin). Necromancer/necrotic is likewise uncaptured. So "poison green" is **UNVERIFIED (no capture)**,
  not confirmed. No shot shows a rogue; the nearest (Assassin) is shadow-violet by design.

## UNCERTAIN (two vision passes disagreed)
1. **`skill-mage-power-front` FX colour.** Pass A: white glow along the staff + orange ground ring.
   Pass B: white/neutral glow, orange ground ring — **no cyan**. Both agree this frame is white, so this is a
   *within-item exception* rather than a contradiction; the other four Mage shots are cyan. Mage arcane reads
   cyan overall, but this one angle does not.
2. **Mage staff pose.** `-live` reads arms raised **overhead**; `-right` reads the staff held **diagonally
   across the body** (not vertical). Different angles/frames — not a contradiction, but "overhead" is only
   confirmed on some frames.

## Score
**Round 4 = 7.5 → Round 5 = 8.5 / 10.** The metal specular fix is real and verified across three Barbarian
angles and the Warrior sword; the pose metadata now corroborates the swing (`pose:"skill"`, `skill.active`
named) and the arm is genuinely raised for power / lowered for defence; effect colours are element-appropriate
and mutually distinct (cyan / gold / violet / white-blue / orange). Held back only by the single white
Mage-front frame and the **uncaptured Rogue/Necromancer** elements, so the full roster colour mapping is not
proven.

## Verdict: **AGREE**
Accepted as claimed:
- The greataxe/blade now read as **metal** (grey + bright specular highlight); non-metallic rendering resolved.
- The weapon arm is genuinely **raised in an overhead chop for power skills** and **lowered in a guard for
  defence skills**; `player.pose == "skill"` and `skill.active` corroborate in every strike frame.
- Effects are now **element-accurate and distinct** (arcane cyan, holy gold, shadow violet, wind white-blue,
  fire/fury orange).
Not accepted / open:
- "poison green for Rogue" is **unverified — no Rogue (or Necromancer) shots exist** in this capture set.
- `skill-mage-power-front` still renders the arcane effect white (one frame); mage overhead pose confirmed on
  some angles only.
Blockers: none that break correctness — HUD, skill logic, and swing/FX behaviour work; the residual items are
capture-coverage gaps, not defects.
