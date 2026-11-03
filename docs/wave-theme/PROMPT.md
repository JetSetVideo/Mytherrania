# Identity Styling & Character Viewer — refined prompt (v2)

This rewrites the original voice prompt ("the name plaque… clay for orcs… axis widget top-right…") into a buildable
specification. It is grounded in what already ships (commit 9e5ec25: `src/ui/Theme.ts`, `src/ui/ThemeTextures.ts`,
`src/graphics/ViewerControls.ts`, `src/graphics/AxisGizmo.ts`, docs `THEME.md`, `VIEWER.md`, `VERIFY.md`) and names
every component, parameter, boundary and rule so the next wave can extend it without re-deciding anything.
Values marked **(shipped)** are in the code today; **(next)** are the improvements this prompt asks for.

---

## 0. The prompt (paste this to the next build swarm)

> Style every surface that shows a character from the character's **identity variables** — race, sub-race, class,
> birth sign, weapon (and, next, level tier, age stage and generator stats). Each variable owns a **material**, a
> **swatch** (five named colours) and a **pattern**; the variables are combined by a **relation logic** (synchronous /
> complementary / opposite) that decides accents. The **3D viewer** lets the user grab, turn, zoom toward the cursor
> and orient the figure with an **axis gizmo** (X red, Y yellow, Z green) in its top-right corner. Every value is a
> pure function of the profile, total over unknown ids, bounded by the limits below, CSP-safe, legible
> (contrast ≥ 4.5 on pixels), and verified in Chrome at 320 / 390 / 820 / 1280 / 1920 / 2560 px and 844×390.

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Identity variable** | A profile field that selects a style: `race`, `subrace`, `className`, `birthsign`, `weaponType` (next: `level`, `age`, `stats`). |
| **Material** | The physical substance a surface imitates. One per race: `clay` (ork), `scroll` (elf), `wood` (human), `stone` (dwarf); `neutral` for unknown. |
| **Swatch** | Five colours `{ base, light, dark, ink, accent }`: base = field, light/dark = relief and bevel, ink = text, accent = rings, pips and highlights. |
| **Pattern** | A repeating mark that identifies a class, sign or weapon family (e.g. `fletching`, `scales`, `fuller`). |
| **Layer** | One CSS background image of a material (gradient or generated SVG tile) with its tints. A **stack** is the ordered list of layers. |
| **Tint role** | Where a layer's colour may land: `field` (behind text), `mark` (sparse lines: cracks, knots, veins ≤ 8 % area), `edge` (borders, bevel). |
| **Plaque** | The name plate: race material + sub-race swatch. |
| **Chip** | A small tag for one variable (race, sub-race, class, sign, weapon) with its swatch, pattern and relation ring. |
| **Plate** | The card that holds the portrait or live viewer, the plaque, the chips, the LV badge and the equipment sockets. |
| **Relation** | How well two variables fit: `synchronous` (typical), `complementary` (works well), `opposite` (atypical). |
| **Anchor** | The variable the accent is taken from in a relation (the class, for class-weapon and class-sign; the race, for race-class and race-weapon). |
| **Fit score** | Cosine similarity between a class's primary-stat profile and a sign's / race's modifier vector (`signFit`, `raceFit`). |
| **Theme tokens** | The CSS custom properties `--th-*` written on the plate root by `applyTheme(el, profile)`. |
| **View state** | `{ yaw, pitch, distance, target }` of the viewer camera. **Home** = the framing from the pedestal law. |
| **Zoom-to-cursor** | Zoom that keeps the model point under the pointer fixed on screen. |
| **Gizmo** | The axis widget: 6 ends (`+X −X +Y −Y +Z −Z`), solid discs for +, hollow rings for −. **Snap** = look along an axis. |

---

## 2. Components and their parameters

### 2.1 `IdentityTheme` (pure, `src/ui/Theme.ts`)
| Function | Input → output | Rule |
|---|---|---|
| `raceTheme(race)` | → `{ material, label }` | total; unknown → `neutral` |
| `subraceSwatch(race, subrace)` | → `Swatch` | unknown sub-race → the race's first swatch; unknown race → `NEUTRAL_SWATCH` |
| `classTheme(c)`, `signTheme(s)`, `weaponTheme(w)` | → `{ swatch, pattern }` | weapon pattern is per **family** (blade `fuller`, polearm `shaft`, hafted `hammered`, flail `chain`, staff `grain`, bow `string`) |
| `relation(kind, a, b)` | → `Relation` | unknown on either side → `complementary` (neutral) |
| `relationAccent(rel, anchorAccent)` | → colour | sync = anchor accent; comp = anchor hue + 180°; opposite = `#ff4a5e` |
| `themeFor(profile)` | → `ThemeTokens` | the only thing the DOM reads |

### 2.2 Materials (shipped)
| Race | Material | Layers (field → marks → edge) | Shape cue |
|---|---|---|---|
| Ork | clay | matte terracotta field, crackle network, firing pits | uneven tablet edge |
| Elf | scroll | parchment field, fibres, foxing spots | rolled top and bottom ends |
| Human | wood | lighter grain bands bending around 2 knots | pegs at the ends |
| Dwarf | stone | slate field, speckle, iron veins | chamfered bevel |

### 2.3 Sub-race swatches (shipped; base / accent)
| Race | Sub-race | Name | base | accent | Why |
|---|---|---|---|---|---|
| Ork | Greenhide | Marsh green clay | `#2c4424` | `#9fd06a` | Blood-Marsh mud |
| Ork | Ironhide | **Slag purple clay** | `#3d2650` | `#d07a3e` | slag glass + temper-purple iron, rust accent |
| Ork | Bloodfang | Dried-blood clay | `#5a1d18` | `#ec6a4c` | Red Steppe |
| Elf | High | Ivory-gold scroll | `#f5e0b0` | `#a87a18` | ivory vellum, gilt ink |
| Elf | Wood | Leaf-ink scroll | `#d4e8c0` | `#3f7a2a` | green-tinted paper |
| Elf | Dark | Ink-violet scroll | `#e0d4ea` | `#6b3a91` | lavender vellum, violet ink |
| Human | Imperial | Walnut-gold wood | `#c0925a` | `#7a4f0c` | polished walnut with gilt |
| Human | Nomad | Sun-bleached ash | `#dccfb2` | `#3f6f8f` | weathered ash, sky accent |
| Human | Islander | Driftwood teal | `#b2c1b6` | `#1f6b66` | salt-grey driftwood |
| Dwarf | Mountain | Granite | `#524c47` | `#9c7a55` | grey granite, iron-brown veins |
| Dwarf | Forge | Ember-black | `#2a1e1a` | `#ff7a2e` | black iron, ember veins |
| Dwarf | Deep | Slate-blue | `#263a55` | `#86acd9` | blue slate, cold iron |

### 2.4 Class, sign and weapon themes (shipped)
- **Class → pattern:** Barbarian `fur`, Warrior `plates`, Rogue `stitch`, Assassin `crossstitch`, Mage `sigils`,
  Necromancer `bones`, Archer `fletching`, Priest `halo` (the only light class swatch).
- **Sign → pattern:** Serpent `scales`, Mountain `peaks`, Flame `flames`, Moon `crescents`, Storm `bolts`, Void `rings`.
- **Weapon:** 17 archetypes, one swatch each, pattern by family (2.1).

### 2.5 Relation logic (shipped)
| Kind | Synchronous | Complementary | Opposite |
|---|---|---|---|
| class-weapon | the class's own archetype (Archer → bow) | in `CLASS_WEAPON_COMPLEMENT[class]`, or same family **and** weapon class as the typical one | everything else |
| class-sign | the sign with the highest `signFit` for the class | `signFit ≥ FIT_COMPLEMENTARY` (0.2) | `< 0.2` |
| race-class | the race's `defaultClass` | humans (flat modifiers) always; else `raceFit ≥ 0.2` | `< 0.2` |
| race-weapon | the race's default class's weapon | as class-weapon with that class | — |

Rendering: sync = solid ring + round pip `=`, comp = double ring + half pip `+`, opposite = dashed red ring + diamond `x`,
plus a tooltip sentence (`relationTitle`).

### 2.6 `ViewerControls` (pure, `src/graphics/ViewerControls.ts`) — shipped parameters
| Parameter | Value | Boundary / meaning |
|---|---|---|
| `ORBIT_RAD_PER_100PX` | 0.6 rad | turn speed (mouse), same for 1-finger touch |
| pitch band | −0.45 … 1.15 rad | camera never orbits below the floor (`floorY`) |
| distance band | `distMin … distMax` from the pedestal law (≈ 1.7 – 6 m) | zoom clamps, no inversion |
| `WHEEL_GAIN` | 0.0015 per px | mouse wheel / two-finger scroll |
| `PINCH_GAIN` | 0.01 per unit | trackpad pinch (`wheel` + `ctrlKey`) |
| `WHEEL_LINE_PX` / `WHEEL_PAGE_PX` | 16 / 400 | normalise `deltaMode` lines / pages |
| `ZOOM_STEP_MAX` | ×1.5 per event | no jump from one big delta |
| zoom-to-cursor tolerance | ≤ 2 px drift (measured 0.03–0.19 px) | the pointed model point stays put |
| hover test rate | ≤ every 50 ms (≈ 6 ms each) | grab cursor only over the model |
| wheel ownership | `preventDefault` only over the model | the page scrolls everywhere else |
| double-click | `reset(home)` | exact return to home |

### 2.7 `AxisGizmo` — shipped parameters
| Parameter | Value | Boundary / meaning |
|---|---|---|
| colours | X `#e0443a` red, Y `#e8c62e` yellow, Z `#3fae4f` green | + ends solid, − ends hollow rings with hover label |
| size | `clamp(64, 0.2 × viewer width, 96)` px | 87 px at 1280, 96 at 1920 |
| inset | 8 px from the top-right | moves down/left to keep ≥ 6 px from sockets, plaque, tags, LV badge (`GIZMO_AVOID_SELECTOR`) and below sticky bars (`GIZMO_COVER_SELECTOR`) |
| pick | nearest end centre | all 6 ends clickable even when they overlap |
| snap | `snapTo(axis)` | `+Z` = front, `+X` = from the figure's left, `+Y` = from above |

---

## 3. Global boundaries (all shipped unless marked)
- **Legibility:** ink-on-base contrast ≥ 4.5 for every swatch (computed); pattern strokes under text keep ≥ 4.5,
  sparse marks ≥ 3; measured on pixels ≥ 4.5 (today ≥ 6.17).
- **Distinctness:** sub-race swatches within one race ≥ 10 ΔE on pixels (today human 15.6, elf 12.9, dwarf 19.1,
  ork 40.6). **(next)** raise the elf floor: the scroll texture washes the bases together.
- **CSP:** no inline `style=`, no `data:` URIs in `styles.css`; textures go through custom properties set by script.
- **Layout:** no overflow, clipping or text under 11 px at every viewport; touch targets ≥ 44 px on phones; titles
  centred within 1 px; the gizmo never covers a control.
- **Totality:** every function accepts unknown, null and junk ids and returns the neutral theme.

---

## 4. Next improvements this prompt asks for

1. **More identity variables (next):**
   - **Level tier → metal of the frame/trim:** bronze 1–4, copper 5–8, silver 9–12, gold 13–16, platinum 17–20
     (`LevelBadge.levelTier`), so the plate border matches the LV badge.
   - **Age stage → wear:** young = crisp edges; mature = light wear; elder = faded field, softened marks
     (`Age.lifeStage`; elves age slower).
   - **Generator stats (0–1000) → intensity:** strength → deeper relief, intelligence → finer pattern, agility →
     lighter frame weight. Each bounded to ±15 % of the base look, identity at 500.
2. **Material variants per sub-race (next):** the material, not only the colour, varies: Ironhide clay gets slag-glass
   flecks, Forge stone ember veins that glow, Wood-elf scroll leaf watermarks, Islander wood salt bloom.
3. **Relation strength (next):** a numeric score 0–1 alongside the three-way class (from the fit scores), shown as ring
   thickness, so "almost synchronous" and "barely opposite" look different.
4. **Whole-plate harmony rule (next):** when the class-weapon and class-sign relations are both synchronous, the plate
   frame takes the shared accent ("set bonus" look); two opposites give a split frame.
5. **Viewer (next):**
   - Safari's own `gesturestart/gesturechange` pinch; test on a real Mac trackpad.
   - Inertia after a drag (decay ≤ 0.4 s, off when `prefers-reduced-motion`).
   - Keyboard: arrows turn, `+`/`−` zoom, `0` resets, `1`–`6` snap.
   - `−Y` snap shows the model from below through a see-through pedestal (today the base hides it).
   - Optional live viewer on the selected hero card only (WebGL context budget ≈ 16).
   - Fix the 3–5 px gizmo clip at 844×390 and remove the redundant drag code in `Engine.ts` (~line 5826).
6. **Theme lab (next):** a QA page listing every swatch, material and relation with its contrast and ΔE values,
   generated from `allSwatches()`, for quick visual review.

---

## 5. Acceptance (how the next wave is judged)
- Pure tests: totality, contrast floors, ΔE floors, relation table, token output per profile, every new variable at
  its boundary values; view-state clamps, zoom drift ≤ 2 px, snap exactness, reset exactness.
- Chrome at all seven viewports: computed styles differ per id as specified, pixel contrast ≥ 4.5, no layout faults,
  0 page errors, 0 CSP violations; drag, wheel, ctrl-wheel pinch, touch pinch, double-click and every gizmo end.
- A vision check of the race plaques reads clay / scroll / wood / stone in race order, repeated with shuffled labels,
  backed by pixel measurements.
- Numbers in the report are generated by code.
