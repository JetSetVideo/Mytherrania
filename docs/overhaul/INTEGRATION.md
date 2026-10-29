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
| R11 review agents | **done** `49d793d` | `docs/review/performance.md`, `security.md` (13 findings, 0 High), `architecture.md`, `new-code-vocabulary.md`. Applied: S1 (escape every saved/typed value in sheet + history HTML), S2 (CSP `<meta>` + `form-action 'none'`, header verified with curl), S6 (dist committed). Open: S3 save schema validation, S4 telemetry `sendBeacon` to `/api/telemetry` (server rejects POST), S7 debug hook in production, S8 serve.ts Host check/headers; architecture steps 1–11 (type cycle Skeleton↔anim/Rig↔body/contracts; PLAYER_RADIUS 0.5 vs body 0.6; gravity 9.81 vs 24; Engine.ts 2,923 lines). |
| R13 perf | **partly done** `49d793d` | Same harness as the review, before → after: phone 375×812 @3, 4× CPU, 12 m: JS median 7.3 → **5.9 ms**, frames > 12.5 ms per 5 s **62 → 4** (budget ≤ 5); 120 m: 6.6 → 4.6 ms, 13 → 1. 4K @2: JS 2.3 → 1.5 ms, GPU median 3.54 → **2.0 ms** (budget ≤ 2.5); 120 m GPU 3.27 → 2.44. `getProgram` still 0.49 ms/frame at 4× (was 1.5–2.3; remaining trigger unidentified). Not done: wall merge (96 draws), rigid-part merge (~31 draws/fighter/pass), body LOD, terrain chunking by visible area, shadow-frustum fit, cold-start (load task 0.7 s / 2.9 s at 4×). |

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

## Wave 2 — combat, weapons, menu (2026-10-28 evening)

| Req | State | Evidence (parent-run) |
|-----|-------|-----------------------|
| W01 ancestry accordion | **shipped** `d92dc74` | Mouse: Fight → Ancestry → Elf expands (others aria-expanded=false, panels 0 px), High Elf chip selected, header "Human · Imperial" style merge; fighter spawned elf/high. |
| W02 settings / give up / Esc pause | **shipped** `d92dc74` | Lane U verified Esc pause (clock frozen 2 s), Give up → forfeit saved to history. Gear icon-only (aria-label Settings). |
| W03 minimap top-right + gear | **shipped** `d92dc74` | 1280 px: minimap [1080,12,1264,196], gear [1028,12,1072,56]. |
| W04 min arena | **shipped** `d92dc74` | LIVE_ARENA_MIN 34 m (derived); live ring 34 m. |
| W06/W07 weapons | **shipped** `3cac8f8`, readability `0a2fc6a` | 19 menu rows; rematches rolled Rapier/Greataxe/Mace/Axe/Shortsword/Dagger/Warhammer. Lane W: finesse vs heavy crit 0.28/0.08, min 0.37/1.11, accuracy 0.73/0.86, relativeDps 0.9998–1.0002. W2 blind ID 13/17 (target 15): flail, short sword, greatsword, maul still misnamed. |
| W05/W08/W09 collision + impact | **shipped** `0a2fc6a` | Hitboxes: human 50 capsules 99% coverage. X2 harness: plain attack 24/24 up to the engage distance, 0/24 at 3 m. Live 20 s (real GPU): longsword 17/17 contacts (12 hit, 2 crit, 3 miss); dagger 30 contacts of 37 swings but 15 grazes + 11 misses. Parent balance fix: Impact damage = efficiency vs the weapon kind's AVERAGE contact × the class armour law; probe `tools/balance_probe.ts`: archetype DPS spread 1.83 → ~1.33 per armour level (staff +15–20 %, flail −10 % outliers). |

Open (wave 2): head hits dominate slashes live (11/17 head on a longsword); daggers/spears graze at body range (point speed); skills land 50–58 % at 1.2–2.0 m and are cut short on contact; off-hand does not grip two-handed hafts; up to 8 cm blade overlap when guards interlock; bow has no projectile; arena-harness balance re-run needed with geometric combat.

## Wave 3 — occlusion, walls, ring-out, ragdoll, surroundings (2026-10-29) — `7c75c63`

| Req | Evidence (parent-run, real GPU via Playwright) |
|-----|-----------------------------------------------|
| V02 walls | Walled hexagon 34 m, player held S (backwards) 9 s: stopped at r = 16.384 m and stayed there exactly for 5.6 s of pushing (no jitter, no pass), wallHits held 1 / breached 0. Lane R: 40 m/s from 64 directions on all 8 shapes, never inside the wall. |
| V03 ring-out + ragdoll | Open 34 m arena: walking off the edge → winner opponent, reason "ringout", result "…threw Sir Aldric out of the arena in 4.3s". Ragdoll flag true at ring-out; 0.1–1.7 ms/frame. Hills: body lands ~3.7 m below the rim; icy water: drops 12 m, sinks ~0.7 m/s; magma: floats (buoyancy 1.1). Zoomed vision: the real cel-shaded body, sprawled (a first unzoomed read said "stick figure" — a misread at distance). |
| V04 surroundings | Live: canopy, hills, void, clouds, magma, meadow (+ water in the ring-out run), 2–5 draw calls each, no errors. Blind vision: magma ✓, meadow ✓, canopy ✗ and clouds ✗ (both read as "water" at gameplay distance/fog). |
| V01 occlusion | 105 occluders registered; orbit sweep: 1–2 blocking objects detected and faded at blocking angles, 0 at clear ones; vision: the wall in front of the camera rendered semi-transparent, the player fully visible. Not shown live: the rival dithered over the player (the debug orbit clamps to the player's side). |

Open (wave 3): canopy and cloud seas read as water — need contrast/shape work; the ring's pale-cyan ice band reads as a water moat in every biome shot (lane E paint); splash/burn/branch FX not done; a KO does not ragdoll yet (one line); feet/toes welded rigid in the ragdoll; magma floats (contract said "slow sink"); on an open arena with flush outside ground, stepping off loses the match — watch the AI.
