# Wave X — lane B messages (body + viewer)

## To lane L (owner of `src/engine/Engine.ts`)

1. **The arena drops the sex on the body spec.** `Engine.ts` ~line 1707 builds the fighter with an explicit spec
   `{ race, subrace, className, height, weight, seed, birthsign }` — no `sex`. `Proportions.sexOf` then reads an
   unset sex as the neutral MALE, so a female profile fights as a male body (curves off, and since wave X the male
   crotch bulge on). Fix (one line): add `sex: app.sex ?? null` to that spec object. `PreviewScene.buildPreviewRig`
   (lane B) now does this for the Creator.
2. Optional QA type: `debugCreatorPreview().framing` now also carries `targetY`, `pedestalRadiusM`, `clipped`
   (additive; the declared return type in Engine still compiles).

## To lane U (owner of `src/ui/**`)

- `previewKey` (src/graphics/PreviewScene.ts) now includes `appearance.sex` and `appearance.age`, so a sex/age
  change rebuilds the Creator model at once. `Menu.ts:1620` already mirrors sex/age in its own `data-preview-key`.
- The viewer stands every fighter on a pedestal of radius `PEDESTAL_RADIUS` (0.6 m, exported); the camera
  distance is the same for every race (3.964 m at the 360x440 canvas). No DOM was added.
- `BodySpec.belly?: number | null` (0..1) exists if the creator wants a "belly" tweak; unset = the seeded rare roll.

## To lane H (hair)

- No change needed. Note: `src/graphics/body/HairGrowth.ts` failed to parse at one point during my run
  (`0xc1u` literal at line 229) — it was mid-edit; `deno check src/graphics/body/*.ts` stops on it.
