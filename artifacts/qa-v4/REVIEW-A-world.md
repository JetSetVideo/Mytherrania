# Mytherrania QA v4: Review A (world, sky, lighting, camera)

Reviewer: independent visual QA A (read-only). Inputs: `manifest.json` plus the 15 PNGs listed below, at 1280×800.
Method: each PNG was inspected with vision analysis (full frame plus crops/grids where findings disagreed). Colours are approximate hex
estimates from the vision model, not a pixel sampler. Where two passes disagreed, I mark the finding **UNCERTAIN** and do not count it as evidence.
Out of scope: 07-spectate-live, 08-victory, 09/10-history (owned by other reviewers).

## Verdict summary

| Exp | Verdict | One-line reason |
|---|---|---|
| E1 sky vs sun elevation | PARTIAL | In-fight sky is correct for all 5 hours. All 3 title screens are dark slate regardless of hour (noon ≈ #2B3440). |
| E2 sun disc/glow | PARTIAL | Dawn has a soft radial glow, but no sun disc appears in any shot. The glow sits too high for elev 4.2°. |
| E3 two moons at night | FAIL (unverified) | No moon disc appears in 03-time-night or 01-title-night. They may be out of frame, and no shot frames them. |
| E4 clouds by place | FAIL | Frostford (cloudiness 0.65) is the clearest sky in the set (~0–5% cover). Greywall ~10–15%. Sunspire shows 3–4 wisps. |
| E5 light tint + shadows | PARTIAL | Dusk is warm and day is neutral. Night tint is ambiguous (blue vs neutral). Dawn has no long shadows. Close camera has no shadows. |
| E6 fight-start camera | PARTIAL | The camera is behind the player's back and looks toward the opponent. It has NO right-shoulder offset (player centred at x≈640), and the player's head overlaps the opponent's body. |
| E7 rings + wedges | PARTIAL | Wedges point at the opponent in every view (third, iso, bird's-eye). Rings are green in every shot; orange and red states never appear. |
| E8 faces | FAIL | Opponent face shows sclera + black pupil, a hair cap and a chin. There is no iris, nose/nostrils, upper/lower lips or ears. The mouth is a black bar. |
| E9 HUD lines | PASS (2 minor flags) | Every line is present and the place/time/phase match the manifest. Possible 17:53 vs 17:54 rounding. One OCR read of "HP 50/30" is UNCERTAIN. |
| E10 artifacts | FAIL | Isometric and bird's-eye frames are 50–60% black void. Title backdrop is crushed to near-black. Red pillar casts no shadow. |

Counts: **PASS 1 · PARTIAL 5 · FAIL 4** (E3 is counted as FAIL because no evidence was produced).

Overall "fantasy cel-shaded arena" score: **4.5 / 10**. The time-of-day sky pipeline works in gameplay, and the outlines and flat shading read
as cel-shaded. However, faces are emoji-level, there is no scenery beyond the ring, the iso/top cameras show void, the title never
shows the world, and in 3rd person the weapons the HUD lists ("Longsword vs Longsword") are not visible.

## Per-screenshot findings (image vs manifest)

### 01-title-noon: manifest 12:00, day, elev 70.3°, occl 0.10
- Sky: there is no blue sky anywhere. The top 100 rows average ≈ #2B3440 (dark slate). A dim overlay covers the whole scene, so it does not read as noon. **Contradicts manifest (E1 FAIL).**
- Scene: one dark silhouette at ≈(640,580) on a dark ring. The manifest has 2 fighters at x=±2.5, so the second is off-frame or hidden behind the UI.
- No sun, clouds, stars. The floor reads as a trapezoid ≈#2a2a2a with near-black sides.

### 01-title-dusk: manifest 18:18, dusk, elev −6.0°
- Top rows average ≈ #1b1512–#1a1d22, so there is no peach/orange horizon. The frame is visually indistinguishable from the noon title. **Contradicts manifest.**
- The two passes disagreed on whether a character is visible (UNCERTAIN). The ring at ≈(640,620) is teal ≈#2a4a4a.

### 01-title-night: manifest 23:00, night, elev −74.6°
- Top ≈ #0a0e14 and horizon ≈ #1a1f2a give the right darkness, but there are **0 stars and 0 moons**. E1 night criterion (round stars) FAIL on the title.
- Result: all three title screens look the same. The overlay/vignette hides the day-cycle entirely.

### 02-fight-start-third: manifest 11:05, day, elev 66°, occl 0, surface wood
- Sky is light blue, lighter at the horizon, with scattered white wisps (E1 PASS). No sun disc; at 66° it is plausibly out of frame.
- Camera: behind the player and slightly above, looking the same way the player faces. The player's x-range is ≈570–710 (centre ≈640), so **there is no right-shoulder offset**. The opponent's x-range is ≈550–690. The player's head overlaps the opponent's torso on screen, so the opponent is only partly visible (E6 PARTIAL).
- Shadows are cast screen-left from both fighters and contact blobs are present. The red pillar at (640, 200–300) has **no shadow**.
- Rings: player's is green at ≈(640,680) with its wedge pointing away from the camera; opponent's is green at ≈(610,500) with its wedge pointing toward the player. Correct facing, but green is shown while the HUD says "Fight!".
- HUD: `You — Sir Aldric (Warrior) · HP 30/30 · Knockback 0%` / `AI — Ser Vail (Warrior) · …` / `Fight!` /
  `Longsword vs Longsword` / `Sunspire Steppe · 11:05 · day`. This matches the manifest (11.0833 h = 11:05). No swords are visible in frame.

### 03-time-dawn: manifest 06:24, dawn, elev 4.2°
- Top sky ≈ #B8C6D9 and horizon ≈ #F5C9A8, so the warm peach horizon is present (E1 PASS).
- There is a soft radial glow, no disc, centred ≈(200,100) with r≈150. The horizon is at y≈200–300, so the glow sits ~100–200 px above it. At elev 4.2° the
  glow should hug the horizon (E2 PARTIAL).
- Character light is warm (E5 PASS). There are **no long cast shadows**; at 4.2° they should be about 13× character height, or faded deliberately. Only contact blobs are visible.
- Ground near the characters reads darker (blue-grey/brown), which is plausible for a low sun.
- Opponent face: white eyes with black pupils, faint brows, black hair cap. No nose, lips or ears.
- HUD `Sunspire Steppe · 06:24 · dawn`: correct.

### 03-time-morning: manifest 09:30, day, elev 47.8°
- Top ≈ #A8D4EE and horizon ≈ #DCEAF3 give a correct day gradient. There are 3–4 faint wisps near the top edge, so cloud cover is very sparse.
- No sun disc (out of frame). Shadows fall lower-right and contact shadows are present. The light is neutral.
- Camera is centred behind the player, with no shoulder offset. HUD `09:30 · day` is correct.

### 03-time-noon: manifest 12:30, day, elev 68.9°
- Top ≈ #a6cceb and horizon ≈ #d9e7f0 (PASS). There are 2–3 thin wisps in the upper right.
- Shadows fall screen-left with contact blobs, and the light is neutral. Shadow edges are blocky, with possible shadow acne.
- Face crop (480–800, 300–520): sclera **yes**; iris **no**; pupil **yes (black)**; brows **no**; nose **no**; nostrils **no**;
  upper/lower lip **no**, with the mouth as a black rectangle; ears **no**; hair cap **yes**; chin **yes**. **E8 FAIL.**
- HUD `Sunspire Steppe · 12:30 · day`: correct.

### 03-time-dusk: manifest 17:54 (17.9 h), dusk, elev −0.1°
- Top ≈ #b9c6d4 and horizon ≈ #e8b48f give a warm peach horizon (PASS). There is no localized glow even though the sun is exactly on the horizon (E2 miss).
- Character tint is warm and contact shadows are present (E5 PASS).
- The HUD read is `Sunspire Steppe · 17:53 · dusk`, but 17.9 h = **17:54**. This is a likely float-floor bug: `Math.floor(0.9*60)` = 53.999… → 53.
  Verify with the formatter. One OCR read showed "HP 50/30" for the player; the manifest says hp 30, so this is UNCERTAIN and should be re-checked in the pixels.
- A dark post at the centre of the horizon has no shadow.

### 03-time-night: manifest 22:30, night, elev −67.4°
- Top ≈ #1e2a44 and horizon ≈ #3a4a66 give a dark navy sky (PASS). Round white star dots were counted at 9–20, mostly in the upper right (PASS).
- **0 moon discs** in frame (E3 not demonstrated). Faint wisps of cloud are present.
- Character tint: one pass said "cool/blue, dim" and another said "neutral", so it is UNCERTAIN. E5 needs a clearly blue key/ambient (for example
  a moonlight key ≈#8fa6d8 at ≤0.35 intensity).
- One pass reported a large near-black wedge (#0a0a1a) on the right side of the ground. The 3×3 grid pass reports only a "dark edge".
  Possible void or shadow-map edge, UNCERTAIN, so recheck.
- HUD `22:30 · night`: correct.

### 04-place-greywall-december-noon: manifest 12:30, day 355, day, elev 18.2°, occl 0
- Top ≈ #A6D0F0 and horizon ≈ #DCEAF8 give a day gradient (PASS). Clouds cover ≈10–15% as thin white/grey wisps.
  Cloudiness 0.55 should give roughly 40–55% visible cover, so this is under-cloudy (E4).
- Shadows are long, 2–3× character height, cast left. That is consistent with 18.2° (cot 18.2° ≈ 3.0). PASS.
- Scenery: a low dark blue-grey rampart on the horizon gives a sense of place. HUD `Greywall Keep · 12:30 · day`: correct.

### 04-place-frostford-december-noon: manifest 12:30, day 355, **dusk**, elev 3.4°, occl 0.30
- Sky runs from top ≈ #E6C8BE (pinkish-peach) to horizon ≈ #F0C8A0, which is consistent with elev 3.4°. There is no sun disc or localized glow.
- **Clouds ≈0–5% even though cloudiness is 0.65 and occlusion is 0.30. Contradicts the manifest.** The image shows clear sky while the engine says
  30% of the sun is occluded.
- Shadows are only 1–2 body widths long. At 3.4° they should be about 17× height (or faded). **Too short.**
- There is no snow in "Frostford" in December. A dark band on the horizon (#4A5A6A) reads as a river.
- HUD `Frostford Crossing · 12:30 · dusk` matches the manifest. Naming "dusk" at 12:30 is semantically wrong: polar-winter noon
  should be labelled "low sun"/"winter day" rather than dusk.

### 05-camera-close: manifest 15:00, Verdant Hills, day, elev 30.4°, occl 0.69
- 3×3 grid pass: blue sky with white cumulus across the top row, a red pillar on the right, tan ground at the bottom, and a character
  occupying the centre and left-centre. Clouds are the most cumulus-like in the set, which fits occlusion 0.69.
- The first pass reported a large black void on the left with a rope railing. Crops of the left half found 0% black, so this is UNCERTAIN and probably a hallucination.
- Shadows: one pass saw opposite-direction blobs and two passes saw **none**. With occl 0.69, softened shadows are acceptable, but a contact
  shadow must remain (E5 PARTIAL).
- Opponent orientation is unresolved (profile vs facing). Only one eye was confirmed. HUD `Verdant Hills · 15:00 · day`: correct.

### 05-camera-isometric: same world as close, occl 0.73
- **Black void covers ≈50–60% of the frame (E10 FAIL).** There is no sky and no ground beyond the arena. The arena is a diamond with a tan floor, a dark teal border and
  red corner posts.
- Shadows fall down-right for both fighters. Rings are green and **both wedges point at the other fighter** (E7 direction PASS).
- HUD `Verdant Hills · 15:00 · day`: correct.

### 05-camera-birds-eye: occl 0.76
- **Black void dominates the frame (E10 FAIL).** The arena is a centred square: brown floor, grey/blue-grey frame, red corner dots.
- Long dark shadows point upper-right. With elev 30.4° they should be ~1.7× height, and the shadows read longer.
  No cloud shadows, even though occlusion is 0.76.
- Wedges point toward each other (PASS). The ring's inner colour takes the body colour (red / yellow).

### 06-first-person: manifest firstPerson=true, camera field "third", occl 0.80
- Light-blue sky with scattered white cumulus. A dark horizon band separates sky from the brown ground. No sun disc.
- The opponent is centred and faces the camera, with a grey longsword in hand (the only third-party shot where a sword is clearly visible). **No own hands
  or weapon**, which is weak for a first-person fighter.
- Face: sclera and pupil yes, iris no, brows yes. Nose: one pass said yes and another said no (UNCERTAIN). Lips are a black bar; no ears.
- The opponent's shadow falls left. At occlusion 0.80 the shadows still render at full strength, so occlusion is not attenuating the shadow/key.
- Manifest inconsistency: `camera:"third"` while `firstPerson:true`. Snapshot should report the effective camera.

## Cross-cutting contradictions (image vs manifest)
1. Title screens (3): hour/phase changes (12:00, 18:18, 23:00) produce no visible sky change.
2. Frostford: cloudiness 0.65 and occl 0.30, yet the sky is clear.
3. Verdant Hills: occl 0.69–0.80, yet shadows/key light in FP and bird's-eye look unoccluded. In close camera they vanish entirely, so behaviour is inconsistent.
4. 03-time-dusk: 17.9 h is shown as 17:53 (expected 17:54). Probable rounding bug.
5. 06-first-person: snapshot `camera` field says "third".
6. Rings are green in every frame, including while the HUD shows "Fight!".

## Top 5 prioritized fixes

**P0-1: Fill the void beyond the arena (iso / bird's-eye / title).** Add a ground plane of ≥200 m radius (grass/steppe material per place, with fog
matching the horizon sky colour) and a sky dome that is always rendered (`scene.background` = sky shader, never `#000`). For top-down cameras, set
`scene.fog` near/far so distant ground fades into the horizon colour. Acceptance: <5% of pixels below #101010 in 05-camera-isometric and
05-camera-birds-eye.

**P0-2: Make the title backdrop show the live world.** Cut the menu overlay opacity to ≤0.35 and drop the vignette, or confine the overlay to a
centred panel. Frame both fighters (camera at ~(0, 2.2, 7.5) looking at (0, 1, 0)). Acceptance: 01-title-noon top rows read blue
(B > R+40), dusk shows a peach horizon, and night shows stars.

**P1-3: Wire cloudiness and occlusion to visible clouds and light.** Cloud coverage threshold should be `smoothstep(1-cloudiness-0.1,
1-cloudiness+0.1, noise)` so that 0.65 gives about 60% cover. Multiply `sun.intensity` and the shadow opacity by `(1 - 0.7*sunOcclusion)`, and keep a
constant contact-shadow blob (opacity 0.45). Add a snow/frost ground tint for Frostford in December. Acceptance: Frostford visibly the cloudiest sky,
Sunspire the clearest, and shadows softened but present at occl 0.8.

**P1-4: Faces (E8).** Add a coloured iris disc (radius 0.6 × sclera, e.g. #4a7bb7/#6b4a2b) between sclera and pupil, and two brow
bars. Add a nose wedge with two dark nostril dots, separate upper/lower lip meshes (#a8584e / #c06a5e) instead of the black mouth bar,
ear half-discs on the sides of the head, and a chin bevel. Acceptance: all 11 features identifiable in a crop of the opponent's head in 03-time-noon.

**P1-5: Camera and indicators.**
- (a) Third-person fight cam: right-shoulder offset with lateral +0.6 m along the player's right vector and camera height ≈1.7 m. Look-at a point 0.4 m
  right of the midpoint between the two fighters, so the opponent is never behind the player's head. Acceptance: in 02-fight-start-third the player's
  centre x is ≤560 and the opponent bbox does not intersect the player bbox.
- (b) Ring colour must follow AI state. Shots 02/03/05 show "Fight!" with a green ring, so either the state is not mapped or the capture only ever sees "calm".
  Expose `ringState` in the snapshot.
- (c) Sun: render a disc (angular size ≈2°, #fff4d6 core, additive glow) at the true sun direction. Clamp the dawn/dusk glow to the
  horizon band. Also add a dawn/dusk capture whose camera yaw points at the sun azimuth.

Lower priority (P2): fix 17:53 rounding (`Math.round(h*60)` before splitting h/m). Report the effective camera in the snapshot for first person. Show first-person
hands and sword. Make pillar/posts cast shadows (`castShadow=true`). Make night lighting unmistakably cool (key #8fa6d8, ambient #1c2440).
Add a moon-framing capture (camera pitched up 25° at night) to verify E3.

## Evidence limitations
- Colours and pixel coordinates are vision-model estimates, not sampled values. The vision passes disagreed on 05-camera-close (void vs no void, profile vs facing),
  03-time-night (blue vs neutral tint, ground wedge), and the HP OCR on 03-time-dusk. These are marked UNCERTAIN and should be re-checked
  with a pixel sampler (e.g. `getImageData` in the QA harness).
- E3 (moons) and the sun disc cannot be confirmed absent from the world, only absent from these frames.
