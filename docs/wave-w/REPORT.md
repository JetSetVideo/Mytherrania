# Wave W — interface by depth and full window; hands, two-handed grips, level thrusts (2026-11-02)

Lane reports: `lane-H.md` (hands, portrait, creases), `lane-T.md` (off hand, thrusts, guard).

## Interface (parent) — tools/probe-ui-all.ts, 9 screens × 7 viewports (320×568 … 2560×1440)

| | before | after |
|---|---|---|
| width used, title (desktop / 2560) | 27 % / 20 % | 80 % / 80 % |
| width used, settings / victory (2560) | 30 % / 24 % | 80 % / 80 % |
| width used, Fighters / History (2560) | 55 % / 60 % | 97.5 % |
| type size falls with depth (title > panel > group > control > hint) | not on Fighters/Settings (14/13/12/12.5 px) | every screen, every width (desktop 108/21/18/15.7/13.2) |
| visible text, title / Fighters | 426 / 1538 chars | 242 / 1219 |
| icon height / label size; centre offset | up to 2.0×; up to 27 px | 1.2× (≤ 1.6); 0 px |
| clipped / overflow / text < 11 px / page errors | — | 0 / 0 / 0 / 0 on 63 screenshots |

- One token set: a fluid gutter (4–32 px), padding, gap, column width and five type levels (`--t0`…`--t4`,
  `clamp(px, rem + vw, px)`); `tests/ui_wave_w_test.ts` evaluates them at seven widths and asserts the order.
- Screens span the window minus the gutter; the title, victory and settings keep ≥ 80 % on large screens;
  large screens get more columns, not longer lines. Phones: 4–8 px gutters; under 360 px decorative hints drop.
- 50 hints compressed (≤ ~35 chars), body face Iowan Old Style, tabular numbers; icons beside their label.
- Title: a two-page spread on wide screens (modes | your heroes + a New hero card), no chevrons. Victory:
  result beside the acts. Hero card: no "· — ·" meta, the active hero's verb reads as a state, Delete as danger.

## Hands, portrait, creases (lane H)

- Fingers (render-only: no finger bones; the curl is solved on the CPU when the grip changes, 0.18 ms):
  index–little gap to the handle 0 mm (ork −0.5…0), middle-finger wrap 115–216°, 266 triangles a hand,
  every ancestry under the 12 000-triangle budget. Vision: human 3/10 → 6/10, dwarf 3–4 → 7–8.
- Portrait/preview background: corner RGB [23,33,40] (blue) → [23,15,9] (walnut).
- Creases: the skin never had holes (0 boundary / 0 non-manifold edges on 24 bodies); the pinch was folds when
  the arm bends. Elbow at guard: folded triangles 536 → 0, inner flesh 0.29–0.39 → 0.48–0.68 of the joint
  radius; knee 1.2 rad: 200 → 10. Waists unchanged.

## Two hands, thrusts, guard (lane T)

| | before | after |
|---|---|---|
| off hand to the haft, human, 8 two-handed weapons × 5 beats | 221–505 mm | 0 mm on 39/40 (staff hold 30 mm) |
| thrust tip vs the line to the target's torso (spear / rapier / dagger) | +26.7° / +26.8° / −59.8° | −4.7° / −5.1° / +3.2° |
| guard handle angle to the fingers | 47° | 83° (bow 80°) |
The spear at its engage distance used to hit the head; it now hits the chest (human) / abdomen (ork).

## Gates

`deno task check` 0 · `deno task lint` 584 files clean · `NO_COLOR=1 deno task test` → ok | 1721 passed | 0 failed.

## Open

- Broad bodies (ork, dwarf) let the off hand go at the hold beat and on spear/staff strikes (needs a torso
  yaw or shoulder protraction joint); the thrust cocks with the point 25–30° up.
- At the strike the handle runs 13–33 mm into the palm (the wrist snap pivots about the grip, not the wrist);
  the dwarf's guard reaches its wrist limit; the elf's thumb floats 4–12 mm; fingers are 6-sided tubes.
- The title's heroes page is sparse with a single saved hero.
