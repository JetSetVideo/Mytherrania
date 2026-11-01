# Wave U — menus restructured, steppers, medieval skin (2026-11-01)

Audit tool: `deno task build && deno run -A tools/probe-ui-all.ts <outDir>` — every screen (title,
settings, history, creator top + bottom, fight HUD, pause, victory, sheet) at five viewports
(390×844, 844×390, 820×1180, 1280×800, 1920×1080): screenshots, contact sheets, and a measured audit
(component tree with parent/grandparent per control, value-control kinds, clipped text, tap targets
< 32 px, text < 11 px, viewport overflow). Before: `artifacts/qa-ui-before/`, after:
`artifacts/qa-ui-after/`.

## Measured, 45 screenshots each

| | before | after |
|---|---|---|
| clipped text | 514 | 0 |
| tap targets < 32 px | 510 | 30 (the 28 px settings checkboxes, inside 40 px clickable label rows) |
| text < 11 px | 500 | 0 |
| elements past the viewport | 416 | 0 |
| native dropdowns / sliders / number fields | 670 | 0 |
| ‹ value › steppers | 0 | 295 |
| page errors | 0 | 0 |

The "before" counts are inflated by the first bug below (the Creator was counted on every screen).

## Found and fixed

1. **The Creator was displayed on EVERY screen.** `.menu-screen[data-flat="1"]{display:grid}` beat
   `.menu-screen{display:none}` on specificity, so the Creator rendered beside the title, History and
   Victory screens (title: 57 controls instead of 5). Fixed with `:not(.active){display:none}`.
2. **The stat sheet wrapped letter by letter** in the title/preview column: its 3 columns switched on
   the VIEWPORT width while the sheet lives in a narrow column, with `overflow-wrap:anywhere` labels.
   Now `auto-fit minmax(168px,1fr)` (the space the sheet has) and word wrapping.
3. **The sex override never stuck** (pre-existing): CreatorSync writes `appearance.sex`, the field
   sync read a top-level `sex` that does not exist and wrote "male" back at once. Found by clicking the
   new stepper in the real game; the old dropdown path reverted the same way.
4. The gilded title clipped ("MYTHERI…"), option hints and group summaries cut by ellipses (14–21 per
   screen), squashed palette chips (14×44), 19 px fields, 10 px labels, the duel table off a phone,
   the fight's control hints sitting under the menu's backdrop.

## What changed

- **Steppers** (`src/ui/Stepper.ts`, lane U-S, 33 tests): left / right (keyboard ←/→, hold to repeat,
  PageUp/Down ×10 on numbers) replaces every dropdown, slider and number field of the menus and the
  settings dialog. The native element stays hidden as the source of truth, so every existing listener
  and `.value` read is unchanged; `autoUpgrade` re-applies after re-renders. Verified in the real game:
  a click on Camera › saved `"camera":"close"`, ArrowRight moved it on, Sex › switched to female.
- **Structure**: the Creator reads Back → title → the model with its statistics on the RIGHT (the dice,
  presets and palette moved under the model) → the editing boards → one sticky action bar (Discard /
  Save left, Enter the ring right). Title: the one entry plus History / Spectate / Settings compressed
  to icon buttons in one row. Victory: a parchment scroll, Rematch on top, Sheet / History / Menu in a
  row. Settings on phones: label above a full-width stepper.
- **Icons**: the emoji buttons (⚔ 📋 📜 👁) are line icons of the one family (`Icons.ts` gained swords,
  scroll, eye, sheet, save, chevron-right).
- **Medieval skin** (styles.css, "Wave U" block): leather/walnut boards in gilded frames, iron plaques
  for secondary acts, crimson lacquer for the primary act, parchment wells for values and documents,
  a calligraphic script for titles (Apple Chancery), engraved capitals for labels, an illuminated
  initial on each screen's explanation, gold sliders/checkboxes, a bronze HUD. All textures are
  generated SVG noise in data: URIs (no image files, CSP-safe).

## Not done / open

- Number fields can no longer be typed into (hold an arrow, or PageUp ×10). If typing an attribute
  matters, mark the field `data-stepper="off"`.
- A stepper on a control whose change re-renders the screen ends a press-and-hold after one step.
- The 3D model preview itself (lighting, framing) and the in-world spheres are engine/graphics work,
  not this wave.
- Image reviews are hypotheses: two of their claims were wrong when measured (a "missing" stepper in a
  crop that holds none; the hints "dark on dark" was the menu backdrop above them, not their style).
