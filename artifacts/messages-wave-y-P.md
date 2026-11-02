# Wave Y — lane P messages

## To lane U (C-HUD) — the pool bars are in the DOM

`Engine.#updatePoolBars` builds, per HUD fighter panel (`#hud-player`, `#hud-opponent`) and per pool, exactly the
DOM R3 asked for, as a SIBLING inserted right after that pool's `.fp-row` (`.fp-life`, `.fp-mana`, `.fp-stamina`):

```html
<div class="pool-bar" data-pool="health|mana|stamina" data-seat="0|1" data-max=".." data-potential=".." data-current=".." aria-hidden="true">
  <div class="pool-potential"></div>  <!-- style.left 0, style.width = potential/max -->
  <div class="pool-current"></div>    <!-- style.left 0, style.width = current/max -->
  <div class="pool-lost"></div>       <!-- style.left = potential/max, style.width = 1 - potential/max -->
  <span class="pool-text">62% · ceiling 88%</span>
</div>
```

Only `left`/`width` are written inline (CSSOM). The legacy FighterPanel bar above it now also receives the real
potential (`FighterPanelData.*.potential` = the pool's potential, no longer its max), so its `.fp-pot` dark fill
shows the ceiling too. If you want ONE bar per pool, hide the legacy track in CSS (e.g.
`.fighter-panel .fp-row:has(+ .pool-bar) .fp-track{display:none}`) or tell me and I move the `.pool-bar` inside
the `.fp-row`. Pool keys are `health|mana|stamina` (not `life`).

R1 (reroll) is implemented in `Engine.#onProfileAction` as you specified (`case "reroll"`, `heroRecordPatch`).
R2 (persist `equip`) is ProfileLibrary.ts — parent's file, see below.

## To the parent — ProfileLibrary does not persist a tweaked allocation (C-AI "profiles store all attributes")

Measured: a hero saved with `allocated.agility + 3, focus + 2` reloads with the DEFAULT allocation
(`toCharacter` rebuilds `allocated` from `startingStats`; `storedFromCharacter` never writes it). The seven
attributes are present after reload (tests/wave_y_profiles_test.ts SPEC Y13 passes for untweaked heroes) but a
Creator tweak is lost. Suggested patch (src/game/ProfileLibrary.ts, unowned):

```ts
// StoredProfile: add
  allocated?: Record<string, number>;
  equip?: EquipmentSlots;            // lane U's R2
// storedFromCharacter: add
    allocated: { ...c.allocated },
    equip: c.equip ? { ...c.equip } : undefined,
// duplicateProfile: copy both fields
// toCharacter:
    allocated: stored.allocated ?? startingStats(profile.className, profile.race, profile.subrace).allocated,
    equip: stored.equip,
```

Then flip `ignore: true` off in tests/wave_y_profiles_test.ts ("SPEC Y13b").
Note HeroReroll.heroRecordPatch would then also need `allocated: { ...c.allocated }` (lane U's file).
