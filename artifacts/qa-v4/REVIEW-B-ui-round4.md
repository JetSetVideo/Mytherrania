# REVIEW B — Round 4: Skill HUD · Generated Weapons · Per-skill Anim · Elemental FX (qa-skills)

Reviewer B, read-only. Evidence: `read_file` on `artifacts/qa-skills/manifest.json` (24-skill `roster`, per-shot
`skill.active/element/effectFx/cooldowns`) and `artifacts/qa-v4/manifest.json`, plus vision review of the 41 PNGs
in `artifacts/qa-skills/` (full frames + `region` crops). No source read, no shell. Interaction not observed.
Where two vision passes disagreed I say UNCERTAIN and give both readings. Round-2 report: 7.0/10.

## Verdict per item

| # | Item | Verdict |
|---|------|---------|
| 1 | HUD skill bar (3 rows, kind icons, name/kind/cooldown) | **PASS** |
| 2 | Generated weapons read as real, metal differs by class | **PARTIAL** |
| 3 | Per-skill sine/cosine animation (swing/stance, not idle) | **PARTIAL** |
| 4 | Elemental FX scaled by share of health removed | **PARTIAL** |
| 5 | HUD readable, no overflow, hints name skill keys | **PASS** |

---

## 1. HUD skill bar — PASS
`hud-skill-art.png` (crop) and every fight shot show one dark rounded panel with **exactly three rows**:
`1 Shield Dash (dash)` · `2 Crushing Blow (power)` · `3 Bulwark (defense)` for the Warrior; the same layout
adapts per class (Mage `Blink/Arcane Nova/Mana Shield`, Priest `Divine Step/Smite/Sanctuary`, Barbarian
`Reaver's Charge/Skullsplitter/Iron Hide`, Assassin `Death Mark/Execution/Vanish`, Archer `Rolling
Shot/Piercing Shot/Steady Aim`) — matching the manifest `cooldowns[]` names/kinds exactly.
- Icons differ by **kind** as claimed: row 1 = **chevrons/arrows** (dash), row 2 = **starburst** (power),
  row 3 = **shield with cross** (defense). Two independent passes agree.
- Name (white) + kind (grey) + a yellow keybind square (1/2/3) are all present and legible. Cooldown is 0 in
  every captured frame (`cd:0`), so a non-zero timer was **not** observable — only the keybind number is shown.
- No text is clipped and nothing overflows the panel border.

## 2. Generated weapons — PARTIAL
Weapons are clearly **part-based** and the metal/parts differ by class:
- **Warrior** Longsword: straight silver/steel blade, dark crossguard, dark grip, pommel — reads as a real sword
  in `skill-warrior-power-live`, `-defense-front`, `-dash-live` (consistent across passes).
- **Mage** "Warped Staff": dark violet/black shaft + **gold ring head** (`skill-mage-power-front/live`).
- **Priest** "War Mace": dark shaft + pale/cream blocky head (`skill-priest-defense-front`).
- **Archer** Longbow: white/silver tube + grey arrow (`skill-archer-power-front`).
- **Assassin** Hidden Blade: small dark wrist blade (`skill-assassin-dash-front`).
- **Barbarian** Greataxe: crescent head, but rendered **warm orange/tan with no metallic highlight**
  (`skill-barbarian-power-front`) — it does not read as a metal weapon.
✘ **Not accepted as universal:** "the weapon reads as a real weapon." The Barbarian axe reads non-metallic, and
`skill-warrior-power-front` renders the held object as a **flat orange slab** (two passes) — see UNCERTAIN below.
The metal *does* vary by class (steel/silver vs gold ring vs dark shaft), so the core claim holds partially.

## 3. Per-skill animation — PARTIAL
Poses are demonstrably **skill-driven and non-idle** in most shots, and they differ across skills:
- Warrior **power** (`-power-live`): torso pitched forward, committed **downward diagonal chop** (not idle).
- Warrior **defense** (`-defense-front`): **crouched hanging guard**, knees bent, blade angled down.
- Warrior **dash** (`-dash-live`): **forward lunge/dash**, body low, leaning into the opponent.
- Assassin **dash** (`-assassin-dash-front/live`): torso reclined **backward** — retreat/recoil pose.
- Archer **power** (`-archer-power-front`): **recoil/shot-release**, torso thrown back.
✘ Gaps: the *strike frame is not always the peak*. `skill-barbarian-power-front` shows a **recoil/low-guard**,
not an overhead chop apex. And the manifest `player.pose` field reads **`"idle"` in every static strike frame**
(dash/power/defense front/right/back/left) — the one field that should corroborate a swing does not. So the
impulse animation exists in the mesh, but the capture/pose metadata does not prove it.

## 4. Elemental FX scaled by health removed — PARTIAL
Coloured effects are present, and the **scaling mechanism is supported by the manifest**:
in the three Warrior "live" frames `effectFx` rises monotonically with the opponent's `damagePercent` —
3.6% → 0.16 (defense), 7.67% → 0.23 (dash), 17.14% → 0.856 (power). That matches "scaled by the share of the
target's health removed."
Observed colours, however, do **not** match the claimed mapping:
- Warrior: an amber/orange **swing trail + ground ring** (`-dash-live`); power shows a swing arc (orange/red on
  the crop, white on the full pass → UNCERTAIN).
- Priest: a **gold/amber ground ring** under the feet + a translucent white light-cone — the gold is a *ground
  decal*, not a weapon aura.
- Mage: `-power-front/live` show a **red** ring/glow and a plain dark staff — **no cyan/blue** was seen.
- Archer: a **white** wind glow/trail; Assassin: a **violet** dash trail.
✘ **Not accepted as claimed:** "fire orange for Warrior, cyan/blue for Mage, green for Rogue, gold for Priest."
Cyan and green were **never** observed; the priest's gold is a ground ring; several effects are white. The FX are
largely **ground rings / motion trails**, not an aura on the weapon.

## 5. HUD readability & control hints — PASS
Panel is readable with no overflow (item 1). The bottom legend explicitly names the skill keys in every shot:
`… 1/2/3 (or Q/E/F): Dash / Power / Defend · V: First-person · R: Restart · Esc: Menu`. ✔

---

## UNCERTAIN (two vision passes disagreed)
1. **`skill-warrior-power-front` weapon & pose.** Pass A: flat salmon-pink slab held across the chest, idle/guard.
   Pass B (crop): flat orange slab, no metal, no glow. Both agree it is a **slab, not a sword**, and **not an
   overhead chop** — but the same class's `-power-live` clearly shows a proper blade mid-chop. Read as: this one
   angle renders the weapon ambiguously. Cannot confirm a clean chop here.
2. **`skill-warrior-power-live` swing-trail colour.** Full frame = white translucent trail; crop = orange/red arc.
   A coloured arc is likely present; exact hue unresolved.
3. **`skill-warrior-defense`** front = crouched guard vs live = upright ready guard. Different frames, so not a
   contradiction, but the "crouched" read is only on one frame.

## Score
**Round 2 = 7.0 → Round 4 = 7.5 / 10.** The skill HUD (item 1/5) is genuinely good and verified two ways; the
per-skill animation and the effectFx-scaling are real. Held back by the overstated elemental-colour mapping,
the non-metallic Barbarian weapon / slab artifact, and the un-corroborating `pose:"idle"` metadata.

## Verdict: **AGREE (acceptable), with reservations**
Not accepted as claimed:
- Element colour mapping (fire/cyan/green/gold): only an orange Warrior trail and a gold Priest *ground ring*
  seen; no cyan, no green; several effects white.
- "The weapon reads as a real weapon" (all classes): Barbarian greataxe is non-metallic; Warrior power-front
  renders a slab.
- "Genuine swing at the strike frame": Barbarian power-front is a recoil; manifest `player.pose` = `"idle"` in
  all strike frames.
Blockers: none that break correctness — the HUD and skill logic work; the issues are visual polish/proof.
