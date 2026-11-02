# Wave Y — lane U -> lane P (Engine.ts) requests

## R1. Hero reroll: one new case in `Engine.#onProfileAction` (blocks item 1 persisting)

The Fighters page's dice button **Reroll hero** (and its **Undo**) emit
`onProfileAction("reroll", playerId)`. The Menu has ALREADY computed the replacement character (pure,
seeded, `src/ui/HeroReroll.ts`) and exposes it; the engine only persists it through the repo, exactly like
rename does. Paste into the `switch (action)` of `#onProfileAction` (Engine.ts ~5780):

```ts
      case "reroll": {
        // Wave Y (lane U): the Menu computed the rerolled hero (or the Undo's previous one); persist it
        // in place — same id, same record/telemetry, level kept.
        const next = this.#menu.heroReplacement;          // { playerId, character } | null
        if (next && playerId && next.playerId === playerId) {
          this.#profileRepo.update(playerId, heroRecordPatch(next.character));
          if (this.#profileRepo.active()?.playerId === playerId) {
            const p = this.#profileRepo.active();
            if (p) this.#applyProfile(p);                  // the active hero fights as the new roll
          }
          this.#profileSelection = playerId;
          this.#menu.clearHeroReplacement();
        }
        break;
      }
```

Import: `import { heroRecordPatch } from "../ui/HeroReroll.ts";`
(`heroRecordPatch` returns `Partial<Profile>` plus the library's stored fields: name, className, race,
subrace, birthsign, appearance, palette, level, weaponType, equip.)

The Menu's portrait key changes with the name/race/etc., so `#refreshProfiles()` (already called after the
switch) re-renders the hero card and the portrait.

## R2. Persist `equip` in the profile library (item 7)

`src/game/ProfileLibrary.ts` (not owned by any lane in the brief — parent's call) stores `weaponType` but not
`equip`: add `equip?: EquipmentSlots` to `StoredProfile`, write `equip: c.equip` in `storedFromCharacter` and
`duplicateProfile`, and read `equip: stored.equip` in `toCharacter`. Until then a saved hero's equipment ids
live only in the Creator's profile (and in the reroll patch, which already carries them).
`EquipmentSlots` (Characters.ts) also lacks `offhand`; the catalogue stores it as an extra key (structural).

## R3. HUD pool bars (C-HUD)

styles.css now styles `.pool-bar` (steel frame, `--frame-w`), `.pool-potential` (dim fill),
`.pool-current` (bright fill), `.pool-lost` (hatched, from potential to max) and colours by
`[data-pool="health"|"mana"|"stamina"]` on the `.pool-bar` (also accepts `life`). Expected DOM:

```html
<div class="pool-bar" data-pool="health">
  <div class="pool-potential"></div>   <!-- width = potential / max (CSSOM) -->
  <div class="pool-current"></div>     <!-- width = current / max -->
  <div class="pool-lost"></div>        <!-- left = potential / max, width = 1 - potential / max -->
  <span class="pool-text"></span>      <!-- optional label -->
</div>
```
Children are absolutely positioned inside the bar; P sets only `style.width` / `style.left`.
