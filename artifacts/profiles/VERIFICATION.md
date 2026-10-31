# Wave O — verification (measured)

Every number below is a tool's literal output. Wave O answers the ask in `docs/profiles/BRIEF.md`: from the
title's profile button into a panel where the user can generate a random or a specified fighter, see the list
of the ones they already have, and see their models and their statistics.

## 1. The journey, measured in a real Chrome

```
title        [data-action="profiles"] present — "≡ Profiles / Models, statistics, roll or manage"
opened       screen visible · 1 saved · 1 row · toolbar [Roll a fighter, Create a fighter, Load,
             Duplicate, Rename, Delete] · no empty state (a profile existed)
roll         rows 1 -> 2 · selected "Kestrel" · 2 rows carry a PNG data URL · biggest 54 662 bytes
stats        16 sheet rows · "Kestrel · Human · Imperial · Mage · Warped Staff · The Mountain |
             Vitality 4 Resilience 7 Willpower 9 Reflex 5 Strength 3 Intelligence 13 |
             Max Health 20 450 · Attack Power 636 · Attack Interval 1.13 s · Armour 5.6 | …"
studio       renders 2 · cacheHits 1 · cached 2   (one context; the list's second paint hit the cache)
load         active switched to "Hero" — the selected row became the active fighter
viewports    390/820/1280/1920 px: NO clipping (after the fix in §4)
errors       []
```

The portraits are real pixels, not placeholders: lane O-A rendered PRESETS[0] at 256 px in headless Chromium
through the default `THREE.WebGLRenderer` and measured a **59 810-byte PNG, 65 536/65 536 opaque pixels, 150
colour buckets**, inspected visually — a skinned humanoid with hair/beard/garment on the dark field, i.e. the
arena's build and not the old `buildHumanoid` one.

## 2. The blocker the ask contained, and how it was resolved

A saved `Profile` (src/game/Profiles.ts) carries id/name/class/race/sub-species/sign/keybindings/telemetry —
**no appearance at all**, so a stored fighter could not be drawn. Lane O-B resolves one deterministically
from the record's own name seed + race + sub-species + calling (reusing `nameSeed`, `raceBuild`, `SKIN_TONES`,
`HAIR_COLORS`, `randomSilhouette`), and a STORED appearance always wins. Asserted: the same record always
yields the same look, a rename freezes the current look (a name change must not repaint the model), and a
saved appearance survives untouched.

## 3. The library's invariants (lane O-B, `tests/profilelibrary_test.ts`, 11 tests)

- **100 rolled ids → 100 unique ids, 0 collisions** (the id comes from the seed hash and a collision bumps the
  seed rather than overwriting).
- The library **never empties**: deleting the last live profile returns `false`.
- A roll reuses Wave L's `rollProfile` — asserted by deep-equality, not by a paraphrase.
- The repo has **no remove()**, so deletion writes a `removed: true` tombstone and every reader here skips it.
  Flagged in the brief as the parent's call; physical deletion would need a repo-level `remove()`.

## 4. Two real layout bugs the probe found (both fixed, both re-measured)

1. **The panel's width used `96vw`**, which ignores the container's padding: a row overflowed by **5 px at
   820 px** (`825 > 820`). Now `min(980px, 100%)` → all four viewports clean.
2. **The row's manage column overflowed at phone width** (`402 > 390`): four manage buttons on one line. The
   row now wraps them onto their own full-width line under 1024 px and shrinks them below 767 px.

A third finding was a UX hole rather than a bug: the title's profile area is inside a *closed* tree (Wave L),
so the way into the panel was hidden behind a collapsed header. The `title/start/profiles` group is now
`defaultOpen: true` like the modes group, and the `[SPEC LL2]` pin was re-stated from 1 to 2 open entry groups
with the reason recorded.

## 5. Gate

| command | result |
| --- | --- |
| `deno task check` | 0 errors |
| `deno task test` | see the wave report |
| `deno lint` | clean |
| `deno task build` | 1 834 434 bytes |
| `deno run -A tools/probe-wave-o.ts` | the numbers in §1, 0 page errors |
| `tools/probe-wave-h.ts` / `tools/probe-wave-i.ts` | re-run after the menu change (their booleans are part of the gate) |

## 6. Open, stated plainly

- **Rename uses `prompt()`** — the honest stopgap. A headless probe has no prompt and gets `null` (no
  rename offered); the library's own rename is unit-tested either way. An inline editable row is the proper
  fix.
- **Delete is a tombstone**, not a physical removal (the repo has no `remove()`).
- The **"Create a fighter" action leaves for the Creator**, whose own Save-as-profile button is the return
  path: the panel does not edit an existing fighter in place.
- **The portraits are 256 px and cached forever** in one studio; nothing invalidates a portrait except
  `forget`/`clear`, and the engine never calls them (a profile's look is frozen at creation, so nothing
  currently changes under a cached key).
- A 100-row cap keeps ~1.3 KB banners and 100 portrait requests off the DOM; the count still reports the true
  total, but the parent renders no "showing 100 of N" line yet.
- **No human eye** has looked at the panel: the machine says nothing clips and the buttons are 40–44 px.
