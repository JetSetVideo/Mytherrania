# Wave V — the Fighters page, idle stance, weapon grip, body forms (2026-11-02)

Lane reports: `lane-P.md` (pose), `lane-G.md` (grip), `lane-B.md` (body). Parent: the Fighters page
and the integration (the four patches, the engine hand-off of saved heroes).

## The Fighters page (parent)

The title's hero chip used to only flip a highlight. Now:
- a hero chip (title) or **Fighters** opens the Fighters page on that hero's tab;
- one **tab per saved hero** (ancestry standard, name, calling, level; ★ = the hero you play) and a
  **+ New** tab that holds the generator;
- a hero tab shows the hero card: the rendered figure LEFT, record + three statistic columns RIGHT,
  verbs under it (Play this hero, Duplicate, Rename, Delete);
- **Enter the ring as <hero>** fights with that hero's saved character (the engine now passes the
  heroes' characters to the menu); on + New it fights with the generator's roll;
- **Save as profile** turns the roll into a hero and switches to its tab; the title chips follow.
Measured (tools/probe-fighters.ts, laptop + phone, real clicks): every step of
Fighters → + New → dice → Save → tab → title chip → Enter the ring lands where it should; the match's
player is the chosen hero (race, class and the HUD name checked); 0 page errors.

## Idle stance (lane P) — tools/anim-report.ts --idle, tools/probe-idle.ts

Cause: the legs have no yaw joint, so lane M's ball pivot rolled a planted foot onto its ball whenever
the idle rig turned toward a moving rival. Fix: an idle facing hold (0.1 rad slack, re-face by stepping).

| | before | after |
|---|---|---|
| heel lift, headless (144 runs × 10 s), max | 27.3 mm | ≤ 1.7 mm |
| frames with a heel up, headless | 80–83 % | 0 |
| live browser, frames with a heel > 5 mm (human / ork) | 76/104, 60/109 | 4/109, 2/98 |
| breathing, chest pitch peak-to-peak fresh / tired | 2.5–3.0° / 6.5–7.8° | 0.9–1.1° / 2.3–2.7° |
| idle weight shift (pelvis sideways) | 0 | 10–18 mm over 6–9 s |

Final symmetry pass: bilateral parts mirrored, then a seeded natural asymmetry on the rendered skin
(dominant arm 88 % right; arm 1.2–2.4 %, legs ≤ 1.2 %); total volume −0.025…+0.056 %. The physics body
stays mirrored (on it, the asymmetry moved hitboxes and broke the ragdoll weld floor).

## Weapon grip (lane G) — tools/probe-grip.ts

Cause: the rig has no wrist bone, and the swing solved any blade angle into the grip (up to 1.1 rad
past a real hand), ignored the hand's pronation, and the fallback pointed the blade through the back of
the hand. Fix: the wrist pitch is a turn of the handle inside the hand plane, clamped per archetype
(carry vs strike snap), the roll a twist about the finger axis, the forearm turns the thumb up.

| | before | after |
|---|---|---|
| orientation rules passed (17 archetypes × 4 beats, human) | 0/17 per beat | 17/17 per beat |
| handle out of the palm plane at guard | up to 50° | 0° |
| blade at guard | leaning 30° across the face | +81° up (dagger −80°, reverse) |
| weapon vs own torso, min clearance | 62.9 mm | 89.8 mm |
Combined build re-check (axe, dagger, spear, longsword, warhammer): 20/20 beats pass, through the fist.

## Body forms and textures (lane B) — tools/probe-body.ts

| | before | after |
|---|---|---|
| elbow waist (side view) | 0.00–0.05 (one tube) | 0.28–0.44 |
| knee waist dwarf / ork | 0.02 / 0.16 | 0.15 / 0.33 |
| arms with a muscle belly in the silhouette | 0–1 | every arm |
| distinct blend widths | 19 of 29 | 23–24 of 41 |
| painted texture gradient, arms / trunk (human male) | 0.54 / 0.41 /m | 1.11 / 0.85 /m |
The 80/20 improvisation pass (Improvise.ts): 80 % of shape parameters kept or nudged a few %, 20 %
explored within bounds, seeded and mass-neutral, along the anatomy hierarchy. Triangles +1.2 % max.

## Gates

`deno task check` 0 errors · `deno task lint` 567 files clean · `NO_COLOR=1 deno task test` →
ok | 1702 passed | 0 failed (1670 + 32 new) · UI audit (45 screenshots, 5 viewports): clipped 0,
tiny 0, overflow 0, page errors 0.

## Open

- Hands are mitten-like (no fingers): the grip reads as a fist, not a hand of fingers.
- On two-handed weapons the off hand is 23–49 cm from the haft (the arm joints turn on one axis).
- Thrust tips point 22–28° up at contact (the thrust keys keep the forearm level).
- The torso's geometry is unchanged (every chest change broke a combat/ragdoll pin): its detail is
  painted only. A vision pass flagged possible deep creases at an elbow in a close-up — to check.
- The hero card's figure sits on the portrait renderer's blue background.
