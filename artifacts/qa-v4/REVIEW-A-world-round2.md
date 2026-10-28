# Mytherrania QA v4: Review A, round 2 (world, sky, lighting, camera, faces)

Reviewer: independent visual QA A (read-only). Inputs: `manifest.json` and the 19 re-captured PNGs `01-*` … `06-*` (1280×800).
Method: I inspected every PNG with vision analysis, using a full-frame pass plus crops (`region`) on faces, the sun, the HUD and the horizon band.
Colours and coordinates are vision-model estimates, not sampled pixels. Where passes disagreed I mark the finding **UNCERTAIN** and do not count it as evidence.
I did not take any claimed fix on trust; each one below is checked against the pixels.

## Verdict: **DISAGREE**. The screenshots are not yet acceptable.

Real progress since round 1:
- The black void is gone.
- Clouds now differ by place.
- The HUD rounding is fixed.
- Faces are much richer in first person.
- Shadows soften with occlusion.

Four claimed fixes are **not visible** in the captures:
1. The "lighter title overlay": noon and dusk titles are still dark, and dusk is near-black.
2. The "right-shoulder camera offset": the player is centred or slightly right, and their head still overlaps the opponent.
3. The "larger sun disc": the sun aimed at 16h/13h is a soft bloom with no disc edge, and the dawn disc floats ~160 px above the horizon at elev 4.2°.
4. "Two moons": only one moon is ever framed.

There is also still no coloured iris anywhere. Score rises from 4.5 to **6.0/10**, which is not enough to sign off.

## Round 1 → Round 2 delta

| Exp | Round 1 | Round 2 | Change driver (evidence) |
|---|---|---|---|
| E1 sky follows sun elevation | PARTIAL | PARTIAL | In-fight sky is still correct for all hours. The title sky is still dark slate at noon (#2b3440, same as round 1), and dusk is now ~#0f0f0f. |
| E2 sun disc / glow | PARTIAL | PARTIAL | Dawn now shows a disc (~150 px), but it sits ~160 px above the horizon. 03-sky-sun-16h and 03-sky-sunspire-clouds show bloom only, with no edge. |
| E3 two moons | FAIL | PARTIAL | 03-sky-moon-01h: 1 full moon disc of ~100 px plus 30–40 stars. The second moon is never shown. |
| E4 clouds by place | FAIL | **PASS** (flag) | Frostford ≈55–65% cover vs Sunspire ≈5–10%, same hour, both aimed at the sun. Flag: 04-frostford-december still shows no cloud shapes. |
| E5 light tint + shadows | PARTIAL | PARTIAL | Occlusion now softens shadows in iso, bird's-eye and FP. Night is still neutral, not cool. Dawn, dusk and Frostford at 3.4° show no long shadows. |
| E6 fight-start camera | PARTIAL | PARTIAL | The camera is behind the player and the opponent is visible. There is no right-shoulder offset: player centre x≈660, and the head overlaps the opponent's lower torso. |
| E7 rings + wedges | PARTIAL | PARTIAL | Wedges point at the opponent in 3rd person, iso and bird's-eye. Rings are still green in every 01–06 frame. |
| E8 faces | FAIL | PARTIAL | First person: brows, nose, 2 nostrils, upper and lower lip, ears, hair and chin are all present. There is **no iris** in any crop. The 3rd-person face at 03-time-noon still reads as dots plus an open mouth. |
| E9 HUD vs manifest | PASS (2 flags) | **PASS** | 03-time-dusk now reads `17:54` (17.9 h). The HP crop reads `30/30`, so the round-1 "50/30" was an OCR misread. All place, time and phase lines match the manifest. |
| E10 artifacts / black void | FAIL | PARTIAL | Iso and bird's-eye now show olive ground (~#6b7f5e), with near-black under 1%. The 01-title-dusk frame is still a near-black wash. |

Counts, round 1 → round 2: **PASS 1→2 · PARTIAL 5→8 · FAIL 4→0.**

## Per-claim fix verification

| Claimed fix | Verified? | Evidence |
|---|---|---|
| Valley floor tinted by place (no void in iso / bird's-eye) | **YES** | 05-camera-isometric and 05-camera-birds-eye show a uniform olive-green ground outside the arena, with near-black under 1%. In 3rd person, the horizon crops show a pale grey plane between wall and horizon for Greywall and a cool pale band for Frostford. The tint differs only subtly by place. |
| Lighter title overlay | **NO** | 01-title-noon still has a ~70% black overlay, with the top sky at ≈#2b3440 (identical to round 1). 01-title-dusk reads #0f0f0f–#222, with no peach horizon and no fighter visible. 01-title-night shows ~4 faint stars and 0 moons. Only one fighter is visible at noon. |
| Clouds fade in closer to the horizon | **NOT DEMONSTRATED** | In 03-time-dawn, 03-time-morning and 04-greywall, every pass reports clouds "high, not near the horizon", and the horizon band is clear. The 03-time-noon pass says "upper half and near horizon" (UNCERTAIN). |
| Larger sun disc | **PARTIAL** | 03-time-dawn has a disc of ~150 px with a defined edge at ≈(200,95), but the horizon is at y≈255. At 4.2° the disc should touch the horizon. In 03-sky-sun-16h the crop around the sun found "only a soft gradient bloom … no defined circular edge", with a core of ~200–300 px. 03-sky-sunspire-clouds shows the same. |
| New shots sun-16h / moon-01h / frostford vs sunspire | **YES (captured)** | All 4 exist and their HUD lines match the manifest (16:00 day; 01:00 night; Frostford 13:00 day; Sunspire 13:00 day). |
| Frostford 0.65 vs Sunspire 0.25 cloudiness | **YES** | Frostford has ~60% soft cloud masses and the sun hidden behind cloud as a diffuse glow. Sunspire has 5–10% faint wisps. This is a clear, correct ordering. |
| Shadows weaken with sun occlusion | **YES** | Shadows are "weak, soft, low-opacity" at occl 0.90 (iso) and 0.92 (bird's-eye), and soft at 0.95 (FP) and 0.87 (close). Contact shadows remain in close camera. |
| HUD minutes rounding | **YES** | 03-time-dusk HUD crop reads `Sunspire Steppe · 17:54 · dusk`. |
| Nose / lips darker and larger | **YES in FP, weak in 3rd person** | 06 face crop: a darker tan rectangular nose with 2 black nostril dots, a red upper lip and darker-red lower lip, tan ear half-discs, and a chin. 03-time-noon crop: a nose is visible, but no nostrils, no distinct lips and no ears. At 3rd-person distance the features collapse. |
| Right-shoulder camera offset at fight start | **NO** | 02-fight-start-third: player bbox ≈(580–740, 430–680), centre x≈660, which is right of centre. A right-shoulder rig would place the player left of centre. The player's head overlaps the opponent's lower torso; opponent bbox ≈(560–670, 310–500). 03-time-dawn and 03-time-morning are also "centred, no shoulder offset". Possible cause: the offset decays before `elapsed` 1.2 s. The capture does not show it either way. |

## Per-expectation detail (round 2)

**E1 PARTIAL.** All in-fight hours are correct:
- Dawn: top ≈#B0C4DE, horizon ≈#F5D0A9 (peach).
- Morning and noon: light blue, paler at the horizon.
- Dusk: peach horizon, lavender top.
- Night: dark blue with ~7 stars.
- Moon shot: deep blue with 30–40 stars.

The title screens still do not follow the hour. Noon looks like dusk, and dusk is the darkest of the three.

**E2 PARTIAL.** A disc exists (dawn), but its elevation on screen does not match 4.2°. When the camera aims straight at the sun (16h, 13h), the bloom swallows the disc. Dusk (−0.1°) has a horizon glow but no localized hotspot.

**E3 PARTIAL.** One moon is confirmed: full phase, ~100 px, with grey maria. The two-moon world is never shown in a single frame. Night character lighting is still neutral, so the night lighting part of E5 is not met.

**E4 PASS.** The A/B pair proves that cloudiness drives cover. Caveat: 04-frostford-december (cloudiness 0.65, occlusion 0.28) still shows a featureless gradient with "no distinct cloud shapes". The clouds may be invisible in dusk tint, or culled near the horizon.

**E5 PARTIAL.**
- Working: dawn and dusk tints are warm, day is neutral, and occlusion softening works.
- Missing: there is no cool night key in 03-time-night. Shadows at low sun (dawn 4.2°, Frostford 3.4°, dusk) are absent rather than long. Greywall at 18° still has correct ~3× shadows.

**E6 PARTIAL.** What works: the camera is behind the player, the opponent is ahead, and swords are now visible in 02 for both fighters. What fails: the offset, and the overlap with the opponent (see the claim table above).

**E7 PARTIAL.** Wedge direction is correct in every view. Ring colour states (orange / red) never appear in 01–06. Those states are owned by the 07 shots, so I note this but do not hold it against these frames' world quality.

**E8 PARTIAL.**

| Feature | 06 FP crop | 03-noon crop | 05-close |
|---|---|---|---|
| Sclera | yes | yes | yes |
| Iris | **no** | **no** | "yellow" (UNCERTAIN, single pass) |
| Pupil | yes | yes | yes |
| Brows | yes | yes | yes |
| Nose | yes | yes | no |
| Nostrils | yes | no | no |
| Lips (two shapes) | yes | no | no (black line) |
| Ears | yes | no | no |
| Hair | yes | yes | yes |
| Chin | yes | no | yes |

In first person, 10 of 11 features are present (only the iris is missing). Away from first person the face still fails.

**E9 PASS.** Every HUD line matches the manifest for place, time (rounded) and phase, for example `Verdant Hills · 11:32 · day` with hour 11.533. Frostford's "dusk" at 12:30 in December is technically consistent with the manifest, but the semantics are questionable (P2).

**E10 PARTIAL.** The void is fixed in gameplay cameras. The title dusk frame is a near-black wash. The ground plane beyond the wall in 3rd person is a flat pale plane with no features: acceptable, but bland.

## Score: **6.0 / 10** (round 1: 4.5)

What earned the +1.5:
- Void removed.
- Place-driven clouds.
- Occlusion-aware shadows.
- Moon and star rendering.
- First-person faces now read as faces.
- HUD correct.

What holds the score at 6:
- The title still hides the world.
- The camera offset is absent.
- No sun disc when looking at the sun.
- One moon only.
- No iris.
- Night lighting is not cool.
- Low-sun shadows are missing.

## Remaining top 5 fixes

1. **P0 Title backdrop (E1/E10).** The overlay is unchanged at noon (~70%) and worse at dusk.
   - Fix: limit the dim to a centred panel (≤0.35 alpha) and frame both fighters.
   - Acceptance: 01-title-noon top rows are blue (B > R+40), dusk shows a peach horizon, and night shows ≥10 stars.
2. **P0 Right-shoulder fight camera (E6).**
   - Fix: apply a +0.6 m lateral offset along the player's right vector and keep it through `elapsed` ≥ 2 s. Re-capture 02 *after* any blend.
   - Acceptance: player centre x ≤ 560, and the player bbox does not intersect the opponent bbox.
3. **P1 Sun disc (E2).**
   - Fix: draw the disc *after* bloom, or clamp bloom, so a hard-edged ~2° disc (#fff4d6) survives when aimed at it. Also fix the sun direction→screen mapping so the dawn disc at 4.2° sits on the horizon. It is currently ~160 px high, so either the sun mesh is not at the true elevation or a fixed offset is applied.
   - Acceptance: 03-sky-sun-16h shows a disc edge, and the dawn disc centre is within 30 px of the horizon.
4. **P1 Two moons + cool night (E3/E5).**
   - Fix: add a capture framing both moons, or widen the FOV in 03-sky-moon-01h. Make the night key cool (≈#8fa6d8, ≤0.35) with a cool ambient (≈#1c2440).
   - Acceptance: 2 discs in one night frame, and blue-shifted skin and tunic in 03-time-night.
5. **P1 Faces at gameplay distance + iris (E8).**
   - Fix: add a coloured iris disc (≈0.6 × sclera, e.g. #4a7bb7 / #6b4a2b). Scale up the nose, lips and ears, or add outline contrast, so they survive at 3rd-person distance (head ≈60×50 px).
   - Acceptance: all 11 features identifiable in the 03-time-noon head crop.

P2 (not top 5):
- Long low-sun shadows: dawn, dusk and Frostford at 3.4° currently show none. Use a capped length with a fade, not zero.
- Visible clouds in the 04-frostford-december dusk tint.
- Clouds near the horizon: the claimed fix is not observable.
- Snow tint for Frostford in December.
- Rename polar-noon "dusk".
- Snapshot `camera: "third"` while `firstPerson: true`.
- First-person hands and weapon still absent.

## Evidence limitations
- No pixel sampler was used; all hex values and bboxes are vision estimates.
- The 05-close iris colour ("yellow") came from one pass with no crop confirmation, so it is UNCERTAIN.
- One pass on 04-greywall called the beyond-wall area "void/skybox", but the horizon crop shows a pale ground plane. I accept the crop.
- Absence of the second moon is shown only for these frames, not for the world.
