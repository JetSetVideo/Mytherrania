# Vocabulary, naming and factorisation review (R10)

Lane H review, 2026-10-28. This is analysis only; no code was changed. Engine.ts line numbers come from
the snapshot `c5b55af`, as described in GLOSSARY.md; each Engine finding also names its method so it can
be found after the parent's edits.

**Priority.**
- **P1** misleads a reader or hides a bug.
- **P2** is unclear.
- **P3** is style.

Every finding cites lines I read. Where a claim depends on code I did *not* read, the finding says so.

---

## 1. P1: misleading names and comments that hide bugs

| ID | Where | Finding | Fix (name / split / parameters) |
|---|---|---|---|
| V-01 | Fighter.ts:25, 39; SmashPhysics.ts:15-16; Engine.ts:80, 333-334, 694-695 | `createFighter(className, name, x, z, radius, …)` forwards `radius` as the **y** argument of `body(x, y, z)`. The real radius is hard-coded to 0.6 in `body()`. `PLAYER_RADIUS = 0.5` therefore sets only the spawn height (the floor snap then lifts it to 0.6, ArenaPhysics.ts:87-88), and no caller can change a fighter's collision radius. | Use an options object: `createFighter({ className, name, spawn: { x, z }, radius, race, subrace, weaponType, birthsign })`, and `body(x, y, z, radius)`. Derive `radius = H/3` (magic-numbers.md, M-B1). |
| V-02 | Engine.ts:1404-1407 (`#resolveHit`) | The comment says "which side the blow lands on, relative to the defender's facing". But facing is defined as the exact opposite of the blow direction, so the cross product is always 0, and `side` is `Math.random() − 0.5`. | Name the real input: `#impactSide(attacker, defender, swingIndex)`, using the defender's heading (rig yaw or velocity). See magic-numbers.md, S-3. |
| V-03 | Engine.ts:2046-2051 (third-person camera) | `sh` is documented as the "right-shoulder offset", and the `* −1` puts the camera on the left. Derivation in magic-numbers.md, S-2. | Rename it `shoulderOffset` with a signed `SHOULDER_SIDE = +1 (right) / −1 (left)`. Delete the bare `* −1`. |
| V-04 | Engine.ts:884-887 vs 906-912 (`#skillTick`); Skills.ts:54 | The docs say the lunge is "along the facing direction". The code moves toward the opponent's *position* (`dx/d`), a homing lunge. | Either rename the behaviour ("lunge toward the target") in both docs, or pass the facing vector in: `#advanceLunge(f, dir, gain)`. |
| V-05 | Engine.ts:1560-1567 (`#updatePose`); FaceMorph.ts:11 | Face-state names are inverted: *receiving* a hit selects `"block"` ("squint + grimace"), and *attacking* selects `"hit"` ("shout"). | Rename the `FaceState` values after the expression, not the event: `"wince"`, `"shout"`, `"guard"`, `"slack"`, `"idle"`. Map event → expression in one table. |
| V-06 | Engine.ts:1418, 1121 | `staminaRatio: 1 − damagePercent/100` feeds the balance plate. The game has a real stamina pool (`#resources`, Engine.ts:141), so this stamina is fake. Separately, `fatigue = 1 − hp/maxHealth` is *injury*, not fatigue. | Pass the real stamina: `stamina.current/stamina.max` from `#resources`. Rename the senses input to `injury`, or feed it from stamina. |
| V-07 | Engine.ts:1846-1847 (inside `if (!this.#spectate)`) and 1876-1877 | The same surface drag `v *= exp(−dt/stop)` is written twice, once for the player inside the not-spectating branch and once for the opponent. In spectate mode the player's knockback velocity gets **no** surface drag, so the two AI fighters obey different physics. | `#applySurfaceDrag(f: Fighter, material: GroundMaterial, dt: number)`, called for both fighters after `stepArenaBody`. |
| V-08 | Engine.ts:1015-1085 `#opponentAct` vs 1298-1336 `#playerAct` | About 45 duplicated lines: the `CombatView` literal (1055-1062 = 1307-1314), the `chooseAiSkill` block (1064-1071 = 1315-1322), and the `executeAction` callbacks (1073-1084 = 1324-1335). `#playerAct` also **lacks** the truce roam (1019), coin distraction (1025) and perception/hunt (1036-1050). In spectate the "player" bot is omniscient and starts closing in immediately. That biases AI-vs-AI results and therefore the ladder (MMR, Engine.ts:1733-1743). | Split into `#botAct(self: Fighter, rival: Fighter, dt: number)`, built from: `#buildCombatView(self, rival, nearEdge): CombatView`; `#tryAiSkill(self, rival, view): boolean`; `#swing(attacker, defender): boolean` (also replaces Engine.ts:990-993); `#moveToward(self, x, z, speed, dt)`. Call `#botAct(o, p, dt)` and, when spectating, `#botAct(p, o, dt)`. |
| V-09 | Engine.ts:1802-1808; Skills.ts:72, 213 | Skill DoT: `hp −= dps·dt` with **no** `DAMAGE_SCALE`, so its only use (14 total over 4 s) removes 14 HP of a 34,000–58,000 HP bar. Meanwhile `damagePercent += tick·0.8` adds 11.2 meter points, in brief units. Status DoT does multiply by `DAMAGE_SCALE` (Engine.ts:1145), and it also respects the truce, which skill DoT does not. | Define the unit in the type: `dot: { totalBriefUnits: number; seconds: number }`. Route both DoTs through one `#applyDot(f, briefUnits)` that applies `DAMAGE_SCALE`, the meter gain, and the truce gate. |
| V-10 | Engine.ts:1777, 2107-2110; AudioManager.ts:31 | `#lastStep` grows every frame in every phase, and `playStep` has no gate. Footsteps sound every 0.35 s while idle, in the menu, and while dead. | Rename it `#stepPhase` (metres walked since the last step), advanced by `|v|·dt` only while `anim.moving`. Play the step when it exceeds the stride ℓ_s (magic-numbers.md, M-T3). |
| V-11 | Engine.ts:119-120, 2008-2011, 2043 | The fields are commented "adaptive camera distance/height". `#camHeight` is never read. `#camDist` is clamped by `min(·, 5.5)` while its target is ≥ 7, so in a fight it is constant. Both names promise behaviour that does not exist. | `#updateFollowCamera(p, o, dt)` with explicit inputs `(separation, measuredSpeed, fov, H)`. Use the framing equation from magic-numbers.md, M-C1, and delete the dead field. |
| V-12 | Engine.ts:1932-1944 | A palm vector and `weaponFromPalm` are computed every frame, but the output never depends on them: `pitch = skillHeld ? gp.pitch : 0` in every case. The comments ("the palm decides the weapon") describe behaviour that does not happen. | Delete them, or make the palm drive the pitch for real. If kept, extract `gripPitch(skillHeld: boolean, grip: GripPose): number` into GripStance.ts as a pure, tested function. |
| V-13 | Engine.ts:1373, 1386, 973; Status.ts:18-19 | `StatusDef.attackMul` is documented as an "attack-**rate** multiplier". Engine uses it twice: as the swing-rate divisor (Engine.ts:973) **and** as a damage factor (Engine.ts:1373, 1386). So `hasted` (1.3) gives 1.3 × 1.3 = 1.69× DPS, and `chilled` (0.75) gives 0.56×. | Split the field: `attackRateMul` and `damageMul`. Fill both explicitly in `STATUS_DEFS`, so the double effect is a choice, not an accident. |
| V-14 | SmashPhysics.ts:9 vs Physics.ts:41; ArenaPhysics.ts:11 | Two exported types are both called `Body`: kinematic and mass. ArenaPhysics needs an import alias to keep them apart, and Engine.ts:26 imports the mass one as `Body` while `Fighter.body` is the kinematic one. | `KinematicBody` and `MassBody`. Rename `#bodyOf` (Engine.ts:958) to `#massBodyOf`. |
| V-15 | SmashPhysics.ts:31; Engine.ts:1396, 1869 | `stunDuration(damage, strength, wallBounces)`. The brief's term is *Force_impact*, and `strength` is also a primary stat. | `stunDuration(damageBriefUnits, impactForce, wallBounces)`. |
| V-16 | Engine.ts:2409-2420 (`#sendCreationTelemetry`) | The analytics event sends `primary: { vitality: 8, … intelligence: 8 }`, a hard-coded placeholder rather than the fighter's real attributes. | `primary: pickPrimaries(createStats(p.className))`, or the allocation from `CharacterProfile.allocated`. |
| V-17 | Engine.ts:2332 (`#fighterRecord`); MatchHistory.ts:17 | `dealt` is computed as `other.maxHealth − other.hp`. That is the damage the opponent *received* from every source, including falls (Engine.ts:1656), walls (1868) and DoT. The summary still labels it "damage dealt". | Rename it `opponentHpLost`, or accumulate `dealtByHits` in `#resolveHit`, which already has `dmg`. |
| V-18 | Stats.ts:17 | The comment "Combat: HP=45, armor=4, attackInterval=1.0, attackPower=9.0." is stale and contradicts Stats.ts:21-24 ("Combat stats are DERIVED"). | Delete it. |
| V-19 | Engine.ts:178-179 | The doc reads "Which skill each fighter is animating (index into its runtime's list)", above a `Map<Fighter, boolean>` called `#skillFired`. | "True once the active skill's strike has resolved this cast." |
| V-20 | Engine.ts:1398-1401 | "with a weapon-swing floor of 3 m/s" sits over `max(3, vClose + 3)`. Since `vClose ≥ 0`, the 3 is an offset, not a floor. | `const swingSpeed = WEAPON_SWING_SPEED + vClose` (magic-numbers.md, M-K12). |
| V-21 | Engine.ts:1649-1650 vs 1659-1660 | The doc says "the body is returned to the ring after a 1.5 s ragdoll tumble". The code calls `#throwRagdoll(f, 1.6)` (1.6 is an *upward speed* in m/s) and then `#returnToRing(f)` in the same call, so there is no 1.5 s wait. | Fix the doc, or queue the return for when the ragdoll settles: `#scheduleReturn(f, afterSeconds)`. |
| V-22 | Engine.ts:85, 802 | The `SKILL_KEYS` comment says "Q/E/F suit a French Mac", and the hints read "WASD/ZQSD: Move … Q/E/F", but on AZERTY the Q key is both move-left and skill 0 (BRIEF.md:40-41). | Already being fixed by the parent (R14; the current Engine.ts:87-99 shows a new comment). Listed only for completeness. |

## 2. P2: unclear names and abbreviations

| ID | Where | Name today | Means | Proposed |
|---|---|---|---|---|
| V-30 | Engine.ts:545-550 | `#ringHalf()` | min R(θ) over 16 bearings: the inscribed radius, *not* `halfSize` (ArenaConfig.ts:125-128) | `#inscribedRadius` (cache it per match) |
| V-31 | Engine.ts:122-123, 1810-1812 | `#surfaceP`, `#surfaceO`, `surfP` | the first two hold a `GroundMaterial` id; the third holds a `Surface` | `#groundOf: Map<Fighter, GroundMaterial>`, `surface` |
| V-32 | Engine.ts:2043 | `d3` | the clamped follow distance | `followDistance` |
| V-33 | Engine.ts:2046 | `sh` | shoulder offset (m) | `shoulderOffset` |
| V-34 | Engine.ts:1112 | `k` | EMA blend factor | `blend = 1 − exp(−dt/τ)`, or call `damp` |
| V-35 | Engine.ts:1100-1103 | `hpP`, `hpO`, `dpo`, `dealtP`, `dealtO` | HP ratios, player–opponent distance, hit counts | per-fighter loop with `hpRatio`, `rivalDistance`, `hitsLanded` |
| V-36 | Engine.ts:1369-1391 | `aSt`, `dRt`, `aProf`, `dProf`, `pay`, `mul` | attacker statuses, defender runtime, profiles, payload, damage multiplier | `attackerStatuses`, `defenderRuntime`, … `skillDamageMul` |
| V-37 | Engine.ts:1442 vs 1530 | `art` | attacker runtime at 1442; skill *artwork* at 1530 | `attackerRuntime` / `skillArtUrl` |
| V-38 | Engine.ts:931, 1132, 1230, 1406, 2029 | `fx` (and `fx2`) | effect strength (931), facing x (1132, 1230, 1406), forward x (2029) | `effect`, `facingX`, `forwardX` |
| V-39 | Engine.ts:1403, 1412 | `mD`, `dMass` | the same value under two names | `defenderMass` |
| V-40 | Engine.ts:692-693 | `px`, `oz` | player spawn x, opponent spawn z | `spawnX`, `spawnZ`. The spawn is also not mirrored: player at (−s, 0), opponent at (+s, +s) |
| V-41 | Engine.ts:1966 | `rdc` | ragdoll of this fighter | `ragdoll` |
| V-42 | Engine.ts:391, 400 | `ext`, `kI` | shadow frustum half-extent, key-light intensity | `shadowHalfExtent`, `keyIntensity` |
| V-43 | Engine.ts:206-207, 1865, 2492 | `#wallHits = [held, breached]` indexed by `breached ? 1 : 0` | a two-field record | `{ held: 0, breached: 0 }` |
| V-44 | Engine.ts:2531 | snapshot key `world2` | perception / fog / status / items view | `perception` |
| V-45 | Engine.ts:64 vs MathCore.ts:140 | `summarize` | two different functions: history summary vs sample summary | `summarizeHistory` |
| V-46 | Disposition.ts:12, 81; Status.ts:125 | `"enemy"` | the hostile phase / an enemy target | `"hostile"` for the disposition; keep `"enemy"` for a target side |
| V-47 | Status.ts:6, 24, 82 | *school*, `clearedBy` | an element | `clearedByElements`, with parameter `element` |
| V-48 | Terrain.ts:7 | `stop` "stop-time multiplier" | a time constant in s (Engine.ts:1846) | `stopTimeConstant` |
| V-49 | ArenaConfig.ts:106, 116; Engine.ts:456, 684 | `walls`, `outsideGround`, `outsideCollision` (numbers compared `>= 1`) | booleans rolled as 0/1 | keep them numeric for the parameter UI, but read them through `hasWalls(cfg)` |
| V-50 | Engine.ts:705, 727 | `#arenaType` + `PLACES[indexOf(type)]` | a decoration theme that silently chooses the place by array order | `#decorTheme`, with an explicit `THEME_PLACE: Record<Theme, PlaceId>` |
| V-51 | Races.ts:16; Menu.ts:111 | `subspecies`, "sub-species" | subrace | `subraces` |
| V-52 | Races.ts:9 vs 15; Birthsight.ts:7 | `tweak` vs `mods` | the same kind of stat modifier | `mods` everywhere |
| V-53 | Birthsight.ts (file name) | Birthsight | Birthsign | rename the file |
| V-54 | Stats.ts:22, 45 | "archetypes" (meaning classes) | class | "classes" (the AI `Archetype` in Ranking.ts:11 owns the word) |
| V-55 | Stats.ts:147; BodyProfile.ts:329; PartHierarchy.ts:154 | `spread` | ± relative half-width | `jitter` / `halfRange` (MathCore's `spread` = max − min) |
| V-56 | Engine.ts:2163-2164 | an orphan doc block, "QA/diagnostics: pin the world clock and place, and choose a camera." | it describes `debugView` (Engine.ts:2234) but sits above `debugWorld` | move it |
| V-57 | Senses.ts:90 vs 107 | the doc formula `1 + flare·tan·agitation` | the code has an extra `·0.5` | add `0.5` to the doc, or fold it into `flare` |
| V-58 | Engine.ts:1002 | `roll: 0.5` | makes the roam jitter term `(roll − 0.5)·0.8` zero | pass a real roll, or delete the parameter |
| V-59 | Engine.ts:1897 | `nowS = performance.now()/1000` for buffs | wall clock: buffs keep expiring while the game is frozen or the tab is hidden | `#matchClock` (sim seconds) |
| V-60 | Races.ts:33-67 | `StatRange { avg, median }` | not statistics: `avg = c + 0.5` and `median = c` are made up | see statistics.md, S-4 |
| V-61 | MatchHistory.ts:6 | `WinReason "ring-out" | "timed" | "koth"` | endings the live game cannot produce (Engine.ts:706) | one `EndReason` type shared with HistoryFilter.ts:37 and WinConditions.ts:8 |
| V-62 | Duplicated type names | `MatchRecord` (MatchHistory.ts:22, HistoryFilter.ts:22), `HistorySummary` (MatchHistory.ts:93, HistoryFilter.ts:61), `WeaponType` (Weapon.ts:3, WeaponGen.ts:8), `JointConstraint` (PartHierarchy.ts:211, BodyProfile.ts:277), `Violation` (ParameterBounds.ts:35, PartHierarchy.ts:297), `Vec3` (PalmWeapon.ts:17, DepthGuard.ts:29, WeaponIntegrity.ts:23) | — | one exporting module per type; the others import it |

## 3. Functions doing more than their name says: proposed splits

Each split lists the parameters every part takes, so nothing is read from hidden state that a test
cannot supply.

| ID | Function (lines) | What it does today | Split into |
|---|---|---|---|
| F-1 | `#loop` (Engine.ts:1766-2111, about 345 lines) | timers, global keys, cooldowns, skills, DoT, surface lookup, player movement, AI, arena physics, body separation, elimination, world tick, and per-rig work (pickups, regen, joint limits, pose gate, grip, placement, aura); then camera ×6 modes, occlusion, render, footsteps | `#tickClocks(dt)`; `#handleGlobalKeys()`; `#stepCombat(dt)`; `#stepPlayerMovement(dt, input: InputVector, apm: number)`; `#stepArena(dt)`; `#separateBodies(a: KinematicBody, b: KinematicBody, massA, massB)`; `#updateFighterVisuals(f, rig, rival, dt)`, which splits further into `#collectPickups(f, nowS)`, `#updateGrip(f, rig)`, `#placeRig(f, rig, rival)`, `#updateAura(f, aura, rival)`; `#updateCamera(mode, p, o, dt)`, with one function per mode; `#tickFootsteps(f, dt)` |
| F-2 | `#resolveHit` (Engine.ts:1353-1450, about 100 lines) | gate + range; damage product; meter; telemetry; stun; knockback; impulse; side; balance; status; anim, flash and audio; lifesteal; DoT; log; HUD | `#inStrikeRange(att, def): {dx, dz, dist} \| null`; `damageFactors(base, skillMul, statusMul, physicsMul, rageMul, wardMul, blocking): number` (pure, in a game module, sharable with the harness, see statistics.md); `#applyDamage(def, dmg)`; `#applyStunAndLaunch(att, def, dmgBrief, payload, dir)`; `#applyBodyImpulse(def, J, side)`; `#applyBalanceImpact(def, J, side, mass)`; `#applySkillStatus(att, def, skill)`; `#recordHit(att, def, dmg, vClose, skill)` |
| F-3 | `#skillTick` (Engine.ts:888-933) | runtime tick, lunge, cleanse, strike, effect flare | `#advanceLunge(f, dir, gain)`; `#resolveSkillStrike(f, rival, skill, anim, t)`; `#updateSkillEffect(f, anim, t)` |
| F-4 | `#tickWorld` (Engine.ts:1095-1184) | telemetry sampling, velocity EMA, senses + fog, statuses, stun → status, ragdolls, coin spawn, coin physics, coin pickup | `#sampleTelemetry(t)`; `#measureVelocities(dt)` (using `damp`); `#updatePerception(f, light, agitation)`; `#tickStatusEffects(f, dt, hostile)`; `#tickRagdoll(f, dt)`; `#tickCoins(dt, hostile)` |
| F-5 | `#startFight` (Engine.ts:667-760) | arena roll, spawn, identities, truce, reset of 10 maps, camera reset, arena build, world time, brains, ladder, HUD | `#rollArena(seed, override): ArenaState`; `#spawnPair(player, opponent, inscribedRadius, spectate)`; `#resetMatchState()`; `#seedBrains(seedBase, spectate)` |
| F-6 | `#applyEnvironment` (Engine.ts:373-409), every frame | key light, shadow frustum, moon light, ambient, cel uniforms, fog, valley tint | `#placeKeyLight(env)`; `#fitShadowFrustum(sunElevation, arenaRadius)`; `#updateCelLighting(env, sunUp)`; `#updateAtmosphere(env, place)`. Also: `new THREE.Fog(...)` is allocated every frame (Engine.ts:405); update the existing one in place. |
| F-7 | `#poseGate` (Engine.ts:1588-1644) | rebuilds the bone table every frame from the silhouette | `limbBones(silhouette, shoulderY, hipY): Bone[]`, pure and cached per race/subrace, which also removes the 0.16 / −0.22 literals; `worstJointAngles(skeleton, bones)`; `sampleLimb(bone, angle, torsoRadius)` |
| F-8 | `#buildArena` (Engine.ts:416-486) | floor, walls, outside ground, props, pickups | `buildFloor(outline, slab)`, `buildWalls(outline, height, thickness, toughness)`, `buildOutside(cfg)`, `buildProps(props)`, as pure-ish builders returning `THREE.Object3D`; `#spawnPickups()` called by `#startFight`, not hidden inside the build |
| F-9 | `snapshot` (Engine.ts:2459-2573) | one 115-line object literal with inline IIFEs | `#truceInfo()`, `#ringInfo()`, `#aiInfo(f)`, `#perceptionInfo(f)`, `#cameraInfo()` |

## 4. Duplicated logic to factorise

| ID | Pattern | Occurrences | Factor into |
|---|---|---|---|
| D-1 | Surface drag | Engine.ts:1846-1847, 1876-1877 | `#applySurfaceDrag(f, material, dt)` (V-07) |
| D-2 | Bot act | `#opponentAct` / `#playerAct` | `#botAct(self, rival, dt)` (V-08) |
| D-3 | "swing" = set cooldown, set attack-pose timer, resolve hit | Engine.ts:990-993, 1077-1083, 1328-1334 | `#swing(attacker, defender): boolean` |
| D-4 | Normalise then step: `x += dx/d·speed·dt` | Engine.ts:910-911, 1009-1010, 1028-1029, 1042-1043, 1291-1292, 2316 | `#moveToward(f, tx, tz, distanceThisFrame)`; moving away is the same call with a negated distance |
| D-5 | Rival lookup `f === this.#player ? this.#opponent : this.#player` | Engine.ts:891, 1131, 1229, 1464, 1953 | `#rivalOf(f)` |
| D-6 | Get-or-create status state | Engine.ts:1138-1139, 1430-1431, 2174-2175 | `#statusesOf(f)` |
| D-7 | Tally increment `set(k, (get(k) ?? 0) + 1)` | Engine.ts:922, 1142, 1433 (also 1030, 1177, 1439) | `increment(map, key, by = 1)` |
| D-8 | Fall damage + meter | Engine.ts:1654-1658, 1695-1699 | `#applyFallDamage(f, impactSpeed)` |
| D-9 | Agitation and sense gear | Engine.ts:1118 = 1260; 1123 = 1263 (and 1234 with armour 0) | `#agitation()`, `#senseGear(f)` |
| D-10 | HP ratio `hp / stats.maxHealth` | Engine.ts:1057, 1068, 1100, 1121, 1309, 1319, 1417 | `hpRatio(f)` in Fighter.ts |
| D-11 | Runtime reset | Engine.ts:636-640 (rematch), 2300-2305 (debug skill hold); SkillRuntime.ts:24-31, 65-77 | `resetRuntime(rt, skills)` and `applyStance(rt, skill)` in SkillRuntime.ts |
| D-12 | Sample statistics | MathCore.ts:140 `summarize` (population sd, p20/p80); MatchHistory.ts:66 `describe` (sample sd); AiStats.ts:25 `fold` (sample sd, drops non-finite); Races.ts:52 (invented) | MathCore `summarize`, with a `sd: "population" \| "sample"` option and NaN filtering (statistics.md, S-1) |
| D-13 | Wilson interval | MatchHistory.ts:57 `wilson`; ArenaHarness.ts:19 `wilsonInterval` (both hard-code z = 1.96) | one `wilson(wins, n, z = Z95)` in MathCore |
| D-14 | Mulberry32 PRNG | MathCore.ts:193 `rng32`; ArenaHarness.ts:9; EvolutionHarness.ts:11; arena-worker.ts:5 `randomSource` (plus Items `seededRng`) | `rng32` everywhere |
| D-15 | Weapon stat table | Weapon.ts:40-46 = WeaponGen.ts:84-90 (damage, cooldown, reach, knockback); knockback formula Weapon.ts:60 = WeaponGen.ts:164 | one `WEAPON_BASE` table and one `scaledKnockback(base, w)` |
| D-16 | "In reach" margins | Engine.ts:1360 (+ defender.radius), 1978 (+0.6), SkillRuntime.ts:114 (+0.4) | `inStrikeRange(dist, reach, defenderRadius)` |
| D-17 | Armour → plating | Physics.ts:255; Engine.ts:1123, 1263 (`min(1, armor/8)`) | `platingFraction(armor)` in Physics.ts |

## 5. P3: style

- **Imports mid-file.** Engine.ts:63-74 places an import block after the constants, and Engine.ts:66-67 imports twice from `AiBrain.ts`.
- **Spelling.** It drifts between British and American: `defence`/`defense`, `armour`/`armor`, `colour`/`color` (`dispositionColour`, Disposition.ts:41, vs three's `color`). Pick one for identifiers (the code mostly uses `defense` and `armor`) and keep the other only in prose.
- **Per-frame allocation.**
  - `PRIORITY` array allocated per fighter per frame (Engine.ts:1552).
  - `new THREE.Fog` every frame (Engine.ts:405).
  - Tint object literal every frame (Engine.ts:407).
  - `[p, o]` arrays inside loops (Engine.ts:1109, 1119, 1175).
- **`console.warn` in a per-frame path** (Engine.ts:1642).
- **Duplicated comment lines.** Engine.ts:1958-1959; Stats.ts:18-21.
- **Variable shadowing.** The `filter((p) => …)` callback shadows the player `p` (Engine.ts:1905).
- **Unneeded defaults.** `?? 10` defaults on non-optional stats (Engine.ts:1415-1416).
- **Repeated computation.** `toughness(defender)` is computed twice (Physics.ts:149, 152).
- **Pass-through helper.** `movementMul(rt)` only returns `rt.speedMul` (SkillRuntime.ts:94).
- **Dead fields.** `Surface.turn` (Terrain.ts:6), `Weapon.cooldown` (Weapon.ts:40-46) and `Impact.knockback` (Physics.ts:160) are never read (verified by searching `src/`).
