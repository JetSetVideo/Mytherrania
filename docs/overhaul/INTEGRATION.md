# Overhaul integration tracker

Parent-owned. One row per requirement; "verified" means the parent re-ran it, not a lane's report.

| Req | State | Evidence (parent-run) |
|-----|-------|-----------------------|
| R14 movement + layout | **shipped** `5b7d9c9` | Browser, AZERTY CDP keys: Z +2.31 m toward the opponent (was −1.95), S −2.04, Q −2.34 right-axis, D +3.05; `key="z"` on `KeyZ` flips the hints to WASD / Q/E/F. |
| R01 Back | **shipped** `d9d6d15` | Mouse clicks: title→select→Back→title; title→digest→Back→title; Esc on select→title; Esc on title stays. |
| R02 sign icons | **shipped** `d9d6d15` | 6/6 rows: white `rgb(255,255,255)` SVG 18×18, centred; vision crop confirms snake / peaks / flame / crescent / bolt / vortex, no emoji. |
| R09 skill bar | **shipped** `d9d6d15` | 1440×900, 768×1024, 375×812: 3 chips on one row, centred, above `#hints`, no overlap with any HUD rect. At 375 px "Crushing Blow" ellipsises. |
| R15 paint | landed, **unwired** `43d04c2` | 29/29 paint tests. Waits for lane A's mesh. |
| R10/R08 review | landed `43d04c2` | `docs/GLOSSARY.md`, `docs/review/*`. |
| R07/R12 terrain (E) | **shipped** `0e2b1f4` + readability `57f8e83` | 3 matches: slope max ≤ limit (0.451/0.393/0.577 vs 0.577); flagged features 3.55–3.68 (exceptions exist); AI used a 3-point A* route. E2 live: 12 m ring 3,936 tris, 16 m 5,880 (≤ 6k); spawns level (0.589/0.588, 0.471/0.471); soleGap 0 at spawn; floor vertex colours span 0.03–0.88 (paint reaches the GPU). Vision, view from above the wall at noon: relief 0 → **5/10**, colour **5/10**; flat (faceted) shading tested A/B on the same frame: no gain (5/5, "slightly noisy") → kept smooth. |
| R06 minimap (F) | **shipped** `0a9a3ac` | 1 bake/match; 7 contours from terrain; click + AZERTY typed M cycle overview→follow→heading. Vision clarity 5/10 → 7/10 after parent fix (capped sight wedge, token markers instead of cursor-like arrows). |
| R05 trails (D) | **shipped** `ed125ba` | No shader/console errors. Real dash mid-lunge shows telegraph, trail, afterimage, ring. Noon visibility: dash 2→7/10, shield arc 2→6/10 after parent's daylight density uniform. Speed lines not seen by vision. |
| R03/R15 body (A) | **shipped** `8d53c0a` + polish `859bae1` | Clean single-model captures (noon, 2× DPR, character-relative): after A2 + parent paint fix — **ork front 9/10** (6 before; cause was upper-arm warpaint, measured by A2 and confirmed live; short sleeves tried and REVERTED, 3/10), dwarf shoulders 10/10, elf 10/10 with pointed ears, dwarf feet 7/10 (sole/heel/toe). **Dwarf hands still 2/10** ("rounded stump"). Vision ratings vary ±4 between runs on unchanged geometry (dwarf 10 → 6) — judge paired frames only. |
| R04 motion (C) | **shipped** `8d53c0a` + real-rig fixes `859bae1` | Live, 12 m ring, AZERTY walk fwd/strafe/back/left: **0 of 74 frames sunk > 1 cm** (was −12.8 cm); AI min −0.1 cm. Vision claims checked by C2 with FK: trailing-knee "reversed" refuted (foot was buried); back-lean only in backpedal/attack/skills (authored data). Pelvis drop at walk start still −0.20 to −0.23 m live (C2 harness −0.11). Ringed-out falls show large soleGap (falling, not floating). |
| R11 review agents | after integration | |
| R13 perf | after integration | |

## Lane H findings — status

| # | Finding | Checked by parent | Action |
|---|---------|-------------------|--------|
| 1 | Skill DoT not scaled by DAMAGE_SCALE, ignores truce | yes (Engine DoT block vs `#tickWorld` status DoT; `Skills.ts:213` total 14 pre-scale) | **fixed** `5114e99` — balance harness must be re-run |
| 2 | `createFighter` radius lands in `body.y`; collision radius fixed 0.6 | yes (`Fighter.ts:39` → `SmashPhysics.body(x, y, z)`) | deferred: gameplay change, fold into the derived `Tuning` |
| 3 | Status attack multiplier used as rate AND damage | not yet | review wave |
| 4 | Spectate `#playerAct` skips truce/perception/drag | not yet | review wave (biases the ladder) |
| 5 | Hit side cross product is always 0 | not yet | review wave |
| 6 | Footsteps play every 0.35 s even standing / in menu | yes (unconditional `#lastStep` block) | **fixed** `5114e99` (cadence 1.8 + 0.18·v, walking only) |
| 7 | Adaptive camera dead (`#camHeight` unread; `#camDist` capped below its target) | not yet | review wave |
| 8 | Creator's race min/max/avg/median are formulas, not data | not yet | review wave (R08) |
| 9 | Palm direction computed, never changes the grip | not yet | review wave |

## Known open items from lanes

- D: afterimages are a generic standing figure facing the camera (not the fighter's pose); the floor arrow is a straight-line prediction; shield arc hazes the view at close orbit distance; speed lines not confirmed visible.
- E: cliffs render as ~74° slopes (mesh vs grid differ up to 0.5 m at faces); A* ignores the other fighter.
- E2: large arenas (≈140 m domain, cell 1.1 m) build a 25k-triangle ring floor and the patterns blur at that cell size — the triangle budget should scale with the camera's visible area, not the arena area (R13). Gameplay camera (low, behind the fighter) still reads mostly one colour zone at a time (vision 2/10 richness on a large arena). Stripes break into noise on slopes > 0.35.
- QA lessons: `debugView({clean:true})` hides the ARENA (model-only capture) — never use it for terrain shots; `freeze` stops the sky clock, not the fight (a match can end mid-capture and its result overlay darkens every frame); orbit views from outside a walled ring see only the wall.
- F: fog grid sized from the ring's smallest radius, so triangle/oval/diamond corners never reveal (Engine fix); ramp glyph direction unchecked.
- QA hook: `debugView({skillHold})` leaves `rt.active` set after release — restart the match (R) before a real-use capture.
- A+C: cold body build ~0.3 s each (0.6 s at match start for two; rematches cached). Bundle 1.24 MB. Portrait.ts still renders the OLD Humanoid for the sheet portrait.
- C: spine counter-twist not implemented (pitch-only joints); feet have no yaw joint, so turning on the spot sweeps the heel around the ball.
- C2: skill data writes a NEGATIVE spine angle at the strike (chest leans back while charging forward, e.g. dash −0.35 rad) — sign decision for Skills.ts; Skeleton hip limit 1.2 rad shortens sprint landings; feet slide during leg-owning skills (the skill moves the body).
- A2: hands are still mittens (fingers below the 2.2–3.4 cm grid) — live vision 2/10 on the dwarf's free hand; needs local resolution or a separate hand mesh.

- G: pointer lock blocks mouse presses on skill chips mid-fight; first Esc in a fight may only release pointer lock (Chrome). Back from victory goes to the creator when the fight started there.
- B: birth sign does not reach `BodySpec` (add optional field or pass the stack from the engine); `Appearance.body` palette no longer colours skin — keep fighters distinguishable (`garment: true`).
