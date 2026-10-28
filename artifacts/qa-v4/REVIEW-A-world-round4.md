# Mytherrania QA v4: Review A, round 4 (shadows, fight-start framing, skill/weapon FX)

Reviewer: independent visual QA A (read-only). Inputs: `qa-v4/manifest.json` + re-captured PNGs, and `qa-skills/manifest.json` + PNGs. Method: full-frame vision pass plus `region` crops on every claim; second independent passes on the shadow pair, fight-start and the archer shot. Colours/coords are vision estimates, not sampled pixels. Where two passes disagreed the item is marked **UNCERTAIN** and not counted. No claim is taken on trust.

## Verdict: **AGREE** (still acceptable for this stylised cel-shaded prototype) — but one claimed fix is FALSIFIED

Round 4 is **not a regression** and lands real improvements: the fight-start framing now genuinely shows the opponent over the player's shoulder, and a new per-class skill system with weapon meshes and a coloured effect is present. **However, claim 1 (long low-sun shadows) is not delivered** — three independent vision passes agree there is no long shadow at dawn, so the round-3 "not delivered" item remains open. Claim 4 is only partially met.

## Round 3 → Round 4 delta

| Item | R3 | R4 | Evidence (round-4) |
|---|---|---|---|
| Long low-sun shadows (claim 1) | FAIL | **FAIL** | 03-shadow-elev06 (7.1°): only a small dark blob directly under each foot. 03-shadow-elev66 (68.9°): short contact shadow, ~0.2× height. **3 passes agree** — no long/stretched shadow at low sun; the two elevations look the same. "Now rendered" is not visible. |
| Fight-start framing (claim 2) | PARTIAL | **PASS** | 02-fight-start-third: opponent shows **head + both shoulders + upper chest + both arms** above/around the player silhouette; player sits centre. **2 passes agree.** Head-over-lower-torso overlap is resolved to "head, shoulders, upper chest, arms" as claimed. |
| Dawn sun high in frame (claim 3) | PARTIAL / defect | **ACCEPTED (explanation)** | Camera pitches down; the ground↔sky boundary sits in the upper ~¼–⅓ of the frame, so a 4° sun renders near the top. Explanation accepted, no longer treated as a defect. Sun-disc *identity* is **UNCERTAIN** (see below). |
| Per-class skills + weapon mesh + elemental FX (claim 4) | n/a | **PARTIAL** | Weapons read for warrior/mage/barbarian; but aura is a **ground ring**, not on the weapon; several "power" poses read static; the **archer bow does not read in 2 agreeing passes**. See table below. |

Counts (over the 4 claims): **PASS 2 · PARTIAL 1 · FAIL 1**.

## Claim 1 — Long low-sun shadows: **FAIL**

- Full-frame pass on 03-shadow-elev06 (sun 7.1°, dawn): *"no cast shadow… floor uniformly lit."*
- Region crop [350,300→1000,720]: *"only a small dark patch right under the feet… no elongated shadow."*
- Tight crop [380,340→860,640]: *"no long, low-sun shadow… only small dark rounded blobs directly under each foot."*
- Comparison shot 03-shadow-elev66 (68.9°, noon): short contact shadow ~0.2–0.25× character height, pointing lower-right.
- The low-sun and high-sun frames show the **same** short contact shadow → the frustum/length change is not visible. The claim is falsified.

## Claim 2 — Fight-start framing: **PASS**

02-fight-start-third (Frostford, third-person). Pass 1: opponent's *"head, shoulders, upper chest and arms are visible; only lower torso/legs hidden."* Pass 2 (independent): *"Head – visible above the player's head; Shoulders – both sides; Upper chest – visible; Arms – both sides."* Player centre. The round-3 head-clips-lower-torso defect is resolved to the claimed "over the shoulder" read.

## Claim 3 — Dawn sun high in frame: **ACCEPTED**, disc identity UNCERTAIN

- Pass 1 (full frame, 03-time-dawn): camera looks downward; a horizon line sits ~¼–⅓ down; a **red vertical rectangle** near top-centre (~15–20% down) above the horizon.
- Pass 2 (crop [380,0→950,300]): *"no sun disc or bright shape… the only distinct object is a red pillar roughly halfway down."* → the "sun" in pass 1 may be the arena **red pillar**, not the sun.
- Both passes agree the camera pitches downward and the ground/sky boundary is near the top of the frame. **The explanation (camera pitch ⇒ true horizon near/above frame top ⇒ a 4° sun renders high) is geometrically consistent and is accepted.** The exact sun-disc shape/identity is **UNCERTAIN** (two passes disagree) and is not counted.

## Claim 4 — Skill weapon meshes + elemental effect + swing: **PARTIAL**

| Shot | Weapon reads? | Coloured aura? | Pose | Passes |
|---|---|---|---|---|
| skill-warrior-power-front | YES — blade + crossguard + grip | **Ground** orange/yellow ring, not on blade | static/guard | 1 |
| skill-warrior-power-right | NO — occluded (player seen from behind) | none | static | 1 |
| skill-warrior-dash-front | sword reads; **no shield** despite "Shield Dash" | white motion trail + ground ring | active dash lean | 1 |
| skill-barbarian-power-front | partial — axe head + haft low at waist | none | static/clinch | 1 |
| skill-barbarian-power-right | NO axe visible | none | static | 1 |
| skill-mage-power-live | YES — staff shaft + grip + head | **Ground** yellow/orange ring | active cast | 1 |
| skill-archer-power-front | **NO bow** | none | idle/neutral | **2 (agree)** |
| hud-skill-art | n/a — abstract icons (arrow, starburst, shield); no weapon art, no elemental colour | none | n/a | 1 |

Pattern: weapon meshes read for warrior/mage (and partly barbarian) when the camera is **in front**, but not from the "right" orbit angle (player's back to camera). What is rendered is a **ground ring** in the class element colour, **not an aura on the weapon**. Several "power" strikes read as static/guard/clinch rather than a real swing; only dash (warrior) and cast (mage) read as active. The **archer's bow is absent in two agreeing passes** → counted. Claim 4 is therefore PARTIAL, not PASS.

## Score: **7.0 / 10** (round 3: 7.5)

Earned: fight-start now shows the opponent over the shoulder (claim 2 verified); new per-class skill set with weapon meshes and a coloured effect exists; dawn-sun explanation accepted; no regressions, ground/sky/HUD still correct.
Held back: **claim 1 falsified — no long low-sun shadow at 7.1°** (3 agreeing passes); skill aura is a ground ring rather than on the weapon; "power" poses often static; archer bow does not render; sun-disc identity uncertain.

## Explicit verdict

**AGREE** — the prototype is still acceptable for its stylised scope and round 4 improves on round 3. **But the manifest's claim 1 must be corrected:** long low-sun shadows are *not* rendered, and claim 4 should be downgraded to "weapon meshes + ground effect present; swing poses and archer bow incomplete."

## Evidence limitations
- Vision-model estimates only; no pixel sampler.
- Items with a single pass (most skill shots) are reported as observed-with-caveat; only the shadow pair, fight-start and the archer shot got independent second passes.
- Two passes disagreed on the dawn "sun" shape (red rectangle vs none/red pillar) → marked UNCERTAIN, not counted.
