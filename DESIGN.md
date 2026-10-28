# Mytherrania design contract
0. Research: user brief is reference: grotesque cartoon, cel shading, ink outlines. OMH lacks a game context; mobile/landing reference queries used. No third-party artwork/fonts.
1. Identity: bold/expressive, ink-cut, playful, readable. Signature: warm polygonal training island in cool ocean; chunky black-edged player/dummy. Avoid editorial serif/glass template.
2. Palette: ink #172128; panel #202d35; text #fff3cf; muted #b9c9c8; sand #dfaa55; grass #82b970; ocean #4f8490; coral #ef7455; positive #a9ce7c. World dominates. AA text contrast target.
3. Type: -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; display Impact/Arial Black/sans-serif; body 14/16, labels 12, title 28/40. Body leading 1.5, display 1.05. Local fonts, system CJK fallbacks.
4. Layout: 4px base, 4/8/12/16/24/32 scale. Full viewport world; anchored HUD; native settings dialog with internal scroll. 375/768/1440 QA. Clear central play area.
5. Components: native button/select/range/meters/dialog. Solid borders, 6px radius. Warm hover, 3px coral focus ring, active 1px offset; disabled dim. Real loading/error status, no fake disabled features.
6. Motion: physics only; HUD 120ms ease-out; reduced motion disables UI transitions. Keyboard and pointer controls. No scroll library.
7. Depth: solid ink panels, no blur, comic outline shadow.
8. Accessibility: visible focus, explicit labels, dialog Escape close, gesture-only audio unlock. No claim of full spatial gameplay screen-reader access.

## Character contract (v3)
9. **Ancestry is visible, not cosmetic.** Race changes the build (height/weight multipliers), the hair length and style, the beard, the ear length and the ork underbite. A viewer must be able to name the race from a silhouette: elf = tallest + long hair + long pointed ears; dwarf = shortest + broadest + full beard; ork = heaviest + broad jaw + upward tusks + short hair. Colour alone must never be the only difference.
10. **Palette expansion.** Hair uses `HAIR_COLORS` (10: near-black through platinum, plus muted auburn/slate/green tints); skin uses `SKIN_TONES` (10). Races may tint within this set; no race is a single flat colour.
11. **The back reads.** The spine is an anatomical S-curve (33 vertebrae: cervical lordosis, thoracic kyphosis, lumbar lordosis, sacral), visible from the side as a bowed back with a ridge of segments. No straight-cylinder torsos.
12. **The face acts.** Eyebrows, eyelids and mouth deform with the combat state (idle / attack / hit / block / ko) and blend smoothly; a fighter's face must visibly react to landing and taking a hit.
13. **Hair and beards are geometry, not decals.** A long-hair fall drapes down the back outside the torso silhouette (or the torso occludes it); a beard hangs from the jaw into the visible neck gap. Both must clear the torso volume or they are invisible.
14. **The weapon follows the palm.** Blade tip = palm normal; rest blade vertical (+Z); thrust along the forward vector; guard near-vertical (~80–90° to ground) for the defense skill's duration; swing arcs alternate horizontal/diagonal/vertical.
15. **The camera never loses the character.** Geometry between the third-person camera and the viewed character fades out (eased per-mesh alpha, `α = clamp((d − d_min)/(d_max − d_min), 0, 1)`), so the player is never hidden by a wall.
16. **Balance is physical.** Three force plates (feet 0.2 / pelvis 0.5 / shoulder 0.3) drive stance (standing → staggered → kneeling → fallen) and post-hit recovery along a damped sinusoid; the body sways back toward its balance point rather than snapping.
17. **Menu room.** Every new parameter has a place: the menu root is fluid (`min(880px, 97vw)`) with internal scroll and four breakpoints (≤767 / 768–1023 / 1024 / 1440). Nothing clips at 390–1920 px.
18. **One outline per pivot.** Body geometry is merged per pivot, so a pivot draws one surface and one ink outline rather than one per primitive. A doubled outline at a limb ROOT is inherent to per-joint meshes (the arm must move independently of the torso) and is accepted; a doubled outline *within* one pivot is a bug.
19. **Secondary stats are live.** Race/sub-species/birthsign secondaries feed the damage, speed, armour and crit equations through `applySecondary`, and the balance harness prices in the same bridge, so the harness and the live build run the same game.

## Body-shape contract (v4 — supersedes the primitive model)
20. **No primitives.** A body part is a swept surface (a loft), never a box, sphere or cylinder. Its cross-section is a superellipse with an exponent in [1.75, 2.45] — organic, never a circle and never a square — modulated by directional muscle lobes (pectorals, lats, a spine groove, biceps, calves), tapered along its length, and pinched at a waist.
21. **No right angles.** A section's sharpest turn must stay under 0.6 rad (a right angle is 1.571). Both ends of a part are DOME-capped, never flat discs. Where two parts meet, a connector loft carries one section into the other on a smoothstep, so the join has matched tangents instead of a crease.
22. **Races are numbers, not meshes.** `RaceSilhouette` holds the proportions; the equations turn them into the surface. The dwarf is the smallest (height 0.80), the elf the thinnest (width 0.84, muscle 0.68), the ork the heaviest (width 1.34). Change the numbers and the silhouette changes.
23. **Random variation stays in character.** `randomSilhouette` jitters a race's numbers inside a band, capped by `SILHOUETTE_TOP`, and re-rolls until `silhouetteScore` says the body still reads from every side. Variation never overrides "dwarves are the shortest".
24. **Constraints are complete and stated.** `STATE_JOINT_SCALE` lists every joint for every state (9 x 16), and `constraintList` resolves the full range per joint. A braced state articulates less; a heavy race articulates less.
25. **The rig stands on the ground.** The rig computes its own scale and spine offset from the parts' heights, so the sole lands exactly at the body's lower edge — the feet are never buried in the floor.
