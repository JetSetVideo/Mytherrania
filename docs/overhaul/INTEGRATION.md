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
| R03/R15 body (A) | running | |
| R04 motion (C) | running | |
| R05 trails (D) | running | |
| R07/R12 terrain (E) | running | |
| R06 minimap (F) | running | |
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

- G: pointer lock blocks mouse presses on skill chips mid-fight; first Esc in a fight may only release pointer lock (Chrome). Back from victory goes to the creator when the fight started there.
- B: birth sign does not reach `BodySpec` (add optional field or pass the stack from the engine); `Appearance.body` palette no longer colours skin — keep fighters distinguishable (`garment: true`).
