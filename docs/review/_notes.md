# Lane H working notes (scratch; evidence parking)

Scope: R08 (derived constants) + R10 (vocabulary). Read-only on code.
Targets: src/engine/Engine.ts, src/game/*.ts, src/physics/*.ts, src/graphics/*.ts (not body/paint/fx), src/ui/Menu.ts, src/ui/UiTree.ts, src/balance/*.ts, docs/, DESIGN.md, PHASE1_PLAN.md.

Verified from BRIEF.md (docs/overhaul/BRIEF.md):
- BRIEF.md:37-41 movement double negation Engine.ts:1819 (`keyZ: -move.z`) + Engine.ts:1835 (`fwd = -analog.z`). KeyQ bound to move-left and skill 0.
- BRIEF.md:42-43 flat arena floor; hills = decorative spheres.
- BRIEF.md:47-49 discrete poses; rig group at body.y (0.6 m).
- BRIEF.md:52 skill HUD rebuilt innerHTML every 0.25 s.
- BRIEF.md:53 minimap 132 px.
- BRIEF.md:57-61 MathCore exports.

## Evidence log (file:line -> fact)

### Engine.ts 1-650
- 44-47 PICKUP_TINT colours (skip). 49 PICKUP_REACH=0.6 "close to centre". 51 PICKUP_COUNT=6.
- 58-62 SKILL_RESOURCE_COST dash{0,12} power{20,8} defense{5,12}; comment "technique kind".
- 63-74 imports placed AFTER constants (mid-file import block) - style P3.
- 64 imports `summarize` from MatchHistory; MathCore also exports `summarize` -> name collision P2.
- 66-67 two import lines from AiBrain (Brain, executeAction) P3.
- 76 CameraMode close|third|isometric|birds-eye|axis. 78 ArenaType ring|walls|hills|river.
- 80 PLAYER_RADIUS=0.5; 81 MOVE_SPEED=6.5; 82 AI_MOVE_SPEED=4.2 (ratio .646); 83 RING_OUT_FLOOR=-8.
- 85-89 SKILL_KEYS Digit1-3 + KeyQ/KeyE/KeyF; comment "Q/E/F suit a French Mac" but KeyQ is AZERTY 'A' = move-left (BRIEF:40-41) -> comment contradicts P1.
- 91 AnimState {hit, attack, block, moving}.
- 105 #winner "player"|"opponent".
- 109 #lastStep (step sound). 119 #camDist=9 120 #camHeight=7 "adaptive".
- 122-123 #surfaceP/#surfaceO (P/O abbreviations).
- 125 sun 1.2, 126 moon 0, 127 ambient .6 (overwritten at 397 to 1.6).
- 130 #dayOfYear=283.
- 137 #element; 139 #skillFx "peak weapon-effect strength".
- 178-179 comment "Which skill each fighter is animating (index into its runtime's list)" but type Map<Fighter, boolean> -> comment contradicts code P1.
- 206-207 #wallHits [held, breached] tuple -> P2 use named object.
- 236 #velocity {x,z,px,pz}.
- 241 #hudTimer. 244-245 #orbitYaw/#orbitPitch=0.5.
- 253 pixelRatio min(dpr,2). 260 close FOV 60; 261 third FOV 50; near .1 far 1500; 262 iso half-width 10, far 120; 263 birds-eye 15; 267 axis 2.0 "2.2 m character fills". 269 birds-eye y=22.
- 315 createProfile seed (Date.now() & 0xffffff) ^ 0x5A.
- 332 opponent default literal profile "Ser Vail".
- 333-334 spawn x = -2.5 / +2.5.
- 349-350 heartbeat 120 ms threshold, 100 ms interval.
- 357 shadow map 1024; 359 near1 far170 +-14; 360 bias -.0008 normalBias .02.
- 384 ky floor .03; 385 sun distance 60; 387 sun x1.6; 388 shadow threshold .05; 389 1-.75*occlusion / .5; 391 ext = min(30, 12 + 6/max(.12, tan(max(elev,.05)))); 393 hysteresis .5; 394 moon dist 30, floor .1; 395 moon x2.5; 397 ambient 1.6; 400 moon x3; 402 moonlight tint (.5,.66,1.1); 403 ambient x1.5; 405 fog 45..700; 407 place tints.
- 422 outline(cfg,96) segments; 426 floor depth .6; 430 y=-.6; 441 tough = min(1, wallResistance/9000); 442 HSL(.55,.25,.55-.3*tough); 446 wall seg len+.05, thickness .35; 458 outside plane size*4+80; 462 outsideHeight-.01.
- 472 cylinder 16 segs.
- 497-511 #grantPickup: value is PERCENT of pool; share = value/100.
- 520 spawn radius ringHalf*0.82.
- 533 marker radius def.radius*.5; 534 y .5.
- 545-550 #ringHalf: min over 16 samples of ringRadiusAt -> name says "half span" but returns min RADIUS (inscribed radius) P2. 16 samples could miss narrow corners.
- 563 hills fractional pos & sizes; 565 y s*.4; 566 scale.y .5; 570 river width 2.5 depth .3; 573-576 banks .8 at +-1.5.
- 582 void plane 2400; 584 comment "12 m platform" (stale: arena is now shaped by cfg.size); 589 void y = RING_OUT_FLOOR - 2.
- 619 skin mix 0.4; 622 seed ^ 0x2545f491; 626 renderSkillArt(sk, 40) px.
- 639-640 rematch reset duplicates createRuntime field defaults -> factorise resetRuntime(rt, skills).
- 648 aura ring .6..0.8, 48 segs; 647 opacity .75.

### Engine.ts 651-1000
- 651 wedge radius .22; 652 wedge y -.92 (= aura outer .8 + .12; derivable); 655 contact shadow r .55 opacity .32; 657 -.005; 660 holder y .02.
- 674 arenaRng seed Date.now() ^ (history.length*2654435761) (Knuth hash). 677 size clamp [8, LIVE_ARENA_MAX] when no chosen size.
- 691 spawn = min(2.5, half*.4); 692-693 spectate random (half-2) span; 694-695 player (px,0), opponent (-px, oz) with oz=spawn -> non-mirrored: opponent at (+spawn,+spawn) vs player (-spawn,0); constructor 333-334 uses (+-2.5, 0). P2 (name px/oz; asymmetric).
- 703 roster seed (len+1)*977 + rand*1e5; 719 item rng len*7919+13; 736 seedBase (len+1)*7919+rand; 740 side salts 0xA53A/0x5A3C.
- 705 arenaType random among 4, INDEPENDENT of cfg shape; 727 placeIdx = index of arenaType -> PLACES[placeIdx] couples type->place by array order (fragile P2).
- 709 truce friendly = neutral = roamSeconds/2.
- 711 m.clear() list of maps — good factorisation but list must be kept in sync with field list.
- 722 orbitPitch .42 at fight start vs .5 initial (245).
- 772 Space attack; 774 KeyV first-person.
- 790-791 HUD placeholder "HP 100 · 0%".
- 802 hints "WASD/ZQSD: Move | ... 1/2/3 (or Q/E/F)" -> Q is both ZQSD-left and skill key P1 (matches BRIEF:40-41).
- 820 volume default "0.75" duplicates #volume=.75 (107).
- 834 doc "0 dash, 1 power, 2 defence" vs kind literal "defense" (58-62, 920) spelling drift P3.
- 844 #payFor(f, kind) atomic; 847 unknown kind costs 0.
- 873 thrust = knockbackMul > 1.4 || dash.
- 884-887 doc "travel along the FACING direction" but 906-912 moves toward OPPONENT position (dx/d) -> comment contradicts code P1.
- 888 #skillTick does: runtime tick, lunge, cleanse, hit resolve, fx -> split candidate.
- 922 tally key string `cleansed:${name}`.
- 927 effectStrength(anim, t, dealt/maxHealth).
- 949 #idOf 0 player 1 opponent.
- 966-973 cooldown = interval / max(.2, attackMul*focus) — 0.2 floor = max 5x slowdown.
- 992 attack anim timer .25 s.
- 998 roam seed round((x+100)*137 + (z+100)*31).

### Engine.ts 1001-1350
- 1001 roam bound max(1, ringHalf - .8); 1002 roll .5; 1007 arrive .2 m; 1008 roam speed AI_MOVE_SPEED*.5.
- 1015-1085 #opponentAct vs 1298-1336 #playerAct: ~45 duplicated lines (CombatView build 1055-1062 == 1307-1314; chooseAiSkill 1064-1071 == 1315-1322; executeAction w/ attack closure 1073-1084 == 1324-1335). #playerAct LACKS truce roam (1019), coin (1025), perception/hunt (1036-1050) -> in spectate the "player" bot is omniscient & ignores truce roam -> asymmetric AI-vs-AI P1. Factor: #botAct(self, rival, dt, {perceive, roam, coins}).
- 1023/1302 speed = AI_MOVE_SPEED*speedMul.
- 1041 hunt arrival .5 m. 1054/1306 nearEdge edgeDistance < 1.5 (dup literal).
- 1059/1311 enemyAttacking as 1/0 number.
- 1080/1331/992 attack anim .25 (3 copies).
- 1100 hpP/hpO; 1101 dpo = distance player-opponent; 1103 dealtP/dealtO (abbrev P2).
- 1112 velocity EMA k = 1-exp(-dt/.1) == MathCore damp(lambda=10) -> use damp. Comment "~0.1 s".
- 1118 agit = truce? .1 : .8 ; 1260 agitation same literals duplicated -> #agitation().
- 1121 `fatigue = 1 - hp/maxHealth` -> it's injury fraction, not fatigue (stamina exists in Resources) P1 naming.
- 1123/1263 armour = min(1, stats.armor/8); 1234 armour 0 -> 3 copies; armour vs armor spelling.
- 1129 fog radius min(60, half+2), cell max(.5, half/48); 1134 sight cap 60 (dup 60).
- 1135 lensFactor(0, acos(...), agit).
- 1140 stun>0.6 -> "stunned" status.
- 1145 dot*DAMAGE_SCALE, min(maxHealth, hp - dot) (negative dot heals).
- 1146-1149 ragdoll when |v|>7 m/s; throwRagdoll(f,3); 1154 age>2.5 s.
- 1161-1163 coin period = 60/max(.1,itemRate) (itemRate = coins per minute); 1164 max 3 items; 1166 r=rand*max(.5, half-1.5).
- 1171 tickItem(it, dt, 0, coinGravity).
- 1176 collect: dist < itemRadius + body.radius (good, derived) vs PICKUP_REACH .6 constant (Engine:49) inconsistent rule P2.
- 1197 coin 0.12 thick, 32 segs; 1203 y+0.06 = thickness/2 (derivable); 1204 spin += .25 rad PER FRAME (frame-rate dependent) P1.
- 1217 ragdoll spheres 12x8.
- 1234 itemNoticed(it, x, 0.9 eye height?, z, facing, 0.5, ...).
- 1253 facing from velocity if speed > .2 m/s else toward rival.
- 1259 sense scale = max(.05, adapted.sight/SENSE_BASE.sight) — scales ALL senses by sight ratio (hearing scaled by sight) P1-ish semantics.
- 1291-1292 controlled walk AI_MOVE_SPEED*.7.
- 1343 #decideFor brain or tree.

### Engine.ts 1351-1680
- 1356 isHostile single gate. 1360 range: dist > reach + defender.radius.
- 1372 attackDamage(attacker.stats, dStats, Math.random(), Math.random()) (unseeded).
- 1386 dmg = base*mul*statusMul*physicsMul*buffMul*wardMul*(blocking? .4 : 1) — block .4 literal.
- 1388 damagePercent += dmg/DAMAGE_SCALE * .8; 1657 fall adds *.4 -> two coefficients for same meter.
- 1393 recordDefence(prevented-before, dmg).
- 1395-1396 stun = max(stun, stunDuration(dmg/DAMAGE_SCALE, 1.2, 0)) + pay.stun — "Force" 1.2 literal.
- 1397 impact(body, dx, dz, knockbackPower*3*knockbackMul) — x3 literal.
- 1398-1401 comment "weapon-swing floor of 3 m/s" but code `max(3, vClose + 3)`; vClose>=0 (closingSpeed floored at 0 per 937) so max() never binds -> it is an OFFSET +3, not a floor P1 comment/code.
- 1400 omega = J/(m_d*0.5 m) lever arm .5.
- 1404-1407 side = clamp(fx*(dz/d) - fz*(dx/d) + (rand-.5)) with fx=-dx/d, fz=-dz/d => cross term = (-dx*dz + dz*dx)/d^2 = 0 IDENTICALLY. Facing is defined as exactly anti-parallel to blow, so "which side" is pure noise U(-.5,.5). Hidden bug via sign inversion P1.
- 1408 applyImpulse(-J/(mD*.5), side) negative sign.
- 1412 dMass = mD alias. 1415-1416 `?? 10` defaults on non-optional stats.
- 1418 staminaRatio = 1 - min(1, damagePercent/100): "stamina" derived from knockback meter while Resources has real stamina P1 naming.
- 1419 armorMass = mass*.15*armor. 1422 critMultiplier: 1 constant (crit never passed).
- 1436 hit anim .3 s; 1437 flash .1 s.
- 1443 dot {dps: total/seconds}.
- 1461 minimap; 1469 scale = W/(2*fog.half); 1474 probe step 4 px; 1487 outline 48 segs (vs 96 in buildArena 422); 1497 dot r 3.5 px; 1502 bearing 0deg = north = -z.
- 1518 HUD prints damagePercent as "knockback N%" -> synonym knockback == damagePercent.
- 1526 innerHTML rebuild of skill bar.
- 1538 mins = round(hour*60) % 1440.
- 1552 PRIORITY array allocated per frame per fighter (hot path alloc) P3.
- 1560-1567 face mapping: TAKING a hit -> "block" face; ATTACKING -> "hit" face. Face-state names are inverted wrt meaning P1 vocabulary.
- 1588 #poseGate: 1600-1603 rootY .16 shoulder, -.22 hip literals (rig pivot heights; should come from silhouette/rig) ; 1619 left = +Rt sign convention; 1620-1621 ty = rootY - len*cos, tz = -len*sin.
- 1642 console.warn in per-frame path.
- 1649-1650 doc "returned to the ring after a 1.5 s ragdoll tumble" but 1659-1660 throwRagdoll(f, 1.6) (1.6 = upward speed m/s, not seconds) then #returnToRing IMMEDIATELY P1/P2.
- 1666 r = max(.5, ringRadiusAt(a) - 2) "2 m in from the edge"; 1669 y=.6 (body centre).

### Engine.ts 1681-2010
- 1681 ragdoll y floor .2, height 1.8 (fighter height literal).
- 1694 impactSpeed = sqrt(2*24*|RING_OUT_FLOOR|) + |vy|*.2 -> GRAVITY 24 m/s^2 literal (=19.6 m/s). 1698 *.4; 1700 flash .12.
- 1716-1718 double KO: higher hp wins.
- 1750 dealt = digest().dealt.mean * hits.
- 1770 dt cap .1 s. 1774 HUD tick .25 s (+minimap redraw).
- 1802-1808 skill DoT: hp -= dps*dt (no DAMAGE_SCALE) and damagePercent += tick*.8 (no /DAMAGE_SCALE) — vs 1388 dmg/DAMAGE_SCALE*.8 and status DoT 1145 dot*DAMAGE_SCALE: unit of pay.dot.total ambiguous; one of the two paths is off by DAMAGE_SCALE. Also skill DoT ignores truce while status DoT (1145) respects it P1. (check Skills.ts payload.dot)
- 1810-1811 #ringHalf() (16 ringRadiusAt samples) recomputed every frame several times (also 1001,1129,1166) — cache per match P3 perf.
- 1812 surfP; 1846-1847 player vx/vz *= exp(-dt/stop) INSIDE `if (!spectate)`; 1876-1877 opponent same separately -> duplicated drag; in spectate the player's knockback velocity gets no surface drag P1 asymmetry.
- 1819 keyZ: -move.z ; 1835 fwd = -analog.z (BRIEF double negation). 1833 `const analog = camRot` alias.
- 1825-1826 f = unit to opponent, r = (-fz, fx) "right".
- 1834 movementStep(..., MOVE_SPEED*surf.speed*speedMul*(canAct?1:0), dt, apm).
- 1861-1862 outward radial velocity.
- 1865 #wallHits[breached?1:0]++.
- 1869 stunDuration(hurt/DAMAGE_SCALE, 1.2, 1) wall bounce 1.
- 1875 body floor clamp RING_OUT_FLOOR-1.5 (= -9.5); void plane at RING_OUT_FLOOR-2 (589, = -10); ring-out trigger at RING_OUT_FLOOR (1693) -> three floors.
- 1878-1886 "equal mass" separation though bodies have masses (bodyOf).
- 1897 nowS = performance.now()/1000 -> buffs use WALL clock not sim clock (frozen QA / tab hidden keeps expiring) P2.
- 1905 filter((p) => p !== got) shadows player `p` P3.
- 1932-1944 palm: skillHeld ? {x: sin(pitch)* -1, ...} : {0,1,0}; pitch = skillHeld ? gp.pitch : (palmIsUp(palm) ? 0 : atan2(-tip.x, tip.y)). When !skillHeld palm is always up -> pitch 0; when skillHeld palm/tip unused. weaponFromPalm result never affects output => dead computation; the `* -1` then `-tip.x` double sign is never exercised P1 (dead code hiding intent).
- 1949 balTilt eps 1e-4; 1957 rotation.z = balTilt*.6.
- 1954 yaw = atan2(dx, dz) (yaw 0 = +z).
- 1958-1959 duplicated comment line.
- 1978 aura inReach = reach + .6 vs hit rule reach + defender.radius (1360, .5) inconsistent.
- 1991 truce ring scale 1 + .35*progress; 1992 opacity .75+.25|sin(t*(2+dp*.05))|.
- 1998 exposure 1 + flash*4.
- 2006-2007 camera "speed" from INPUT magnitude (unitless 0..1), not measured velocity.
- 2008 targetDist = fight? 7 + .5*speed + min(.15*dist, 2.5) : 9 ; 2009 height fight? 6 + .3*speed : 7 ; 2010 rate 6/s exp smoothing (== damp lambda 6).

### Engine.ts 2011-2574
- 2011 #camHeight written; search shows NO read anywhere (only 120, 2011) -> dead state P1.
- 2043 d3 = fight ? min(#camDist, 5.5) : #camDist; targetDist >= 7 in fight (2008) so after convergence d3 == 5.5 constant -> adaptive distance has no effect in third-person fight P1 dead logic. `d3` abbreviation.
- 2018/2021 orbit view look y+.85; 2024 first-person eye = body.y + .5 (=1.1 m when body.y=.6; fighter height 1.8 -> eye should be ~0.93*H); 2026 look opp y+.4.
- 2030 close cam 2.6 ahead + .7 side, y+.95; 2031 look y+.55.
- 2038 mouse sensitivity .003 rad/px (x and y); 2039 pitch clamp [.05,1.2]; 2040 orbit-yaw return rate 1.8/s.
- 2041 behind = atan2(p-o) ; 2046 sh = 1.15 "right-shoulder offset"; 2049/2051 offset = sh * -1 * (cos yaw, -sin yaw). Using the file's own right-vector convention (1826: right = (-fz, fx)) with camera forward f = -(sin yaw, cos yaw): right = (cos yaw, -sin yaw). `* -1` puts the camera on the LEFT -> comment vs sign mismatch P1 (either rename to left or drop -1).
- 2047 camLift 1.55; 2050 y = body.y + .9 + cy + camLift; 2061 look 55% toward opponent, y+1.15.
- 2066 iso cam offset (8,9,8); 2069 birds-eye y 22 (dup 269).
- 2079 axis d=60; 2086 near d-2; 2087 far d+40.
- 2102 sky aim floor .05.
- 2107 step sound every .35 s: #lastStep += dt EVERY frame (1777) with no moving/phase check in Engine -> footsteps tick while idle/in menu unless AudioManager gates P1 (verify AudioManager).
- 2133 blockDistance(.., halfLen + .2); 2134 occlusionAlpha(d, 1.5, 6, .12); 2136 ease 0.2 PER FRAME (frame-rate dependent) P2; 2139 depthWrite >.6; 2140 visible >.03.
- 2163-2164 orphan doc "QA/diagnostics: pin the world clock and place, and choose a camera." stacked above debugWorld's doc; belongs to debugView (2234) P2.
- 2176 debug status 2 s; 2180 stun 2; 2181 upward 5; 2185 coin +1.2 m.
- 2305 buffRemaining = duration + .35 (another .35); 2310-2311 effectStrength .45.
- 2332 FighterRecord.dealt = other.maxHealth - other.hp -> includes fall/wall/DoT damage, not only dealt P2 naming.
- 2386 gamepad deadzone .18.
- 2418 creation telemetry sends primary stats hard-coded all 8 (not the real allocation) P1 telemetry correctness.
- 2465 sunElevationDeg = round(elev*573)/10 (573 ~ 1800/PI) derivable.
- 2531 `world2` key name P2. 2537 fogAscii(..,16).

### physics/SmashPhysics.ts (33 lines)
- 9-13 `Body` = kinematic {x,y,z,vx,vy,vz,radius}; game/Physics.ts:41 ALSO exports `Body` (mass model) -> same name two concepts; ArenaPhysics.ts:11 aliases `Body as KinematicBody` P1 vocabulary.
- 15-16 body(x,y,z) -> radius hard-coded 0.6.
- 19-24 impact(): v += dir*power; vy = max(vy, power*.35) launch ratio .35.
- 26-33 stunDuration(damage, strength, wallBounces) = damage*strength*1.5^b*0.01 ("10 ms per unit"); param `strength` = brief's Force_impact; collides with stats.strength P2.

### physics/ArenaPhysics.ts (143 lines)
- 14 ARENA_GRAVITY = 24 exported — Engine.ts:1694 re-types literal 24 instead of importing it P1 (derive).
- 7-8 KinematicBody vs Body (Physics) explained in header.
- 43 doc 0.98*R; 71 wall speed floor .5; 75 R*.98; 87 floor snap y = radius when y > -2r; 96 landing threshold vy < -.5; 116 horizontal damping exp(-1.2 dt) for every body (+ Engine surface drag 1846/1876 on top -> two drag laws stacked).
- 105-107 prop collision r = r_prop*scale + r_body.
- 127 edgeDistance = R(theta) - |p| (+ inside).
- 135 outline n default 96.

### game/Fighter.ts (54 lines)
- 16 damagePercent "Smash-style: rising percent increases knockback taken".
- 25 createFighter(className, name, x, z, radius, ...) ; 39 `body: body(x, radius, z)` -> `radius` is passed as the Y coordinate (SmashPhysics.body(x,y,z)); the body's real radius stays 0.6 (SmashPhysics:16). Engine PLAYER_RADIUS=.5 (Engine:80) therefore never sets a radius; it is the spawn height, and the floor snap (ArenaPhysics:87-88) lifts the centre to .6. P1 HIDDEN BUG / misleading param.
- 53 knockbackPower = weapon.knockback * (1 + damagePercent/60) — 60 = percent at which knockback doubles.

### game/Physics.ts (309 lines)
- 12-17 header equations (mu, J, T, D=IMPACT_K*J/T, wall 1.05, fall .9).
- 38 DEFAULT_MATERIAL armour .35 restitution .28; 255 bodyFromStats restitution .24 (different default).
- 41 `Body` mass model (name clash, see SmashPhysics).
- 79 toughness = rho*(.4 + .6*armour)*sqrt(max(.01, A)).
- 127 IMPACT_K 1.15; 129 GLANCE_RATIO .08.
- 149 T and 152 t = toughness(defender) computed twice P3.
- 160 Impact.knockback = J/m2*.12 (metres).
- 203 breach ratio > 1.05; 207 min retained .15; 210 selfDamage *.05; 229 fall *.9.
- 241-255 mass = 42 + 3.5 STR + 1.4 VIT + 1.1 RES; volume .055 + .0016 STR; area torso .22+.006 STR, limbs .15+.004 REF; split .62/.38; armour = min(1, armor/8).
- armour (0..1 material fraction) vs armor (CombatStats integer stat) -> two spellings, two meanings; /8 saturation repeated Engine:1123,1263 and Physics:244,255 -> constant ARMOR_SATURATION = 8.
- 262-275 physicsMul = clamp((.55 + .30 m_a/m_d + .25 rho_a/rho_d) * (.85 + .15 min(2,|v|)), .6, 1.8); 265 equal still = .935 (not 1.0!) -> normalisation: coefficients should sum so equal bodies at reference speed give 1.
- 282 closingSpeed floored at 0.
- 287-309 REFERENCE_BODIES skirmisher/juggernaut/wall.

### game/Stats.ts (153 lines)
- 2-9 ClassName 8 classes: Barbarian Warrior Rogue Assassin Mage Necromancer Archer Priest.
- 11-15 CombatStats: 6 primaries (vitality resilience willpower reflex strength intelligence) + maxHealth attackPower attackInterval armor.
- 17 STALE comment "Combat: HP=45, armor=4, attackInterval=1.0, attackPower=9.0." contradicts 21-24 (derived now) P1. 18-21 duplicated "shape the 3D mesh" comment.
- 25-34 PRIMARY table. 39-43 COEF hpBase 33 hpPerVit 1.7 hpPerStr .55 intervalBase 1.33 perReflex .046 armorBase 2.2 perRes .32.
- 49 TARGET_POWER_INDEX 450; 50 CRIT_MULT 1.4 BUT 150 uses literal 1.40 P1 dup.
- 54 HEALTH_SCALE 1000; 58 FIGHT_LENGTH 10; 60 DAMAGE_SCALE = 100 (derived, good); 68 POWER_SCALE; 70-71 POWER_MIN 5*DS, POWER_MAX 14*DS.
- 75 expectedCrit uses defender resilience 5 literal "average defender"; mean resilience over PRIMARY = (7+8+4+3+3+4+4+5)/8 = 4.75 -> derive like AVERAGE_BODY (126-130).
- 81-83 clamps HP [34,58]k, interval [.85,1.35], armor [2,6.5].
- 90, 107, 152: armour damage reduction 0.04/point repeated 3x -> ARMOR_DR_PER_POINT.
- 99 edge = phys(c->avg)/phys(avg->c).
- 113-122 POWER_CALIBRATION -0.0095..+0.0163 (fitted "3 seeds x 1500 fights/pair").
- 137 criticalChance = clamp(.008 REF / (.010 RES + .1), .03, .15).
- 146-147 DAMAGE_SPREAD .35 = relative HALF-width (variance in [.65, 1.35]); MathCore spread = max - min (absolute full width) -> same word, different measure P2. Target "48-52%" stated 146.
- 151 variance = 1 + .35*(roll-.5)*2 (uniform).

### game/Skills.ts (370 lines, read 1-160 + grep)
- 8 SkillKind "dash"|"power"|"defense". 11 Element 8 values fire fury poison shadow arcane necrotic wind holy.
- 34-46 JointTrack; 48-60 SkillAnimation duration hitAt lunge hop effectIntensity; 54 lunge doc "applied along the facing direction" (Engine moves toward opponent 906-912).
- 63 damageMul doc "Multiplier applied to the weapon's damage" but Engine:1364-1368 applies it to class attackDamage, weapon.damage unused there -> stale P2.
- 72 dot {total, seconds} — unit unspecified; only use: 213 dot total 14 over 4 s. Engine 1443 dps=3.5, 1806 hp -= 3.5*dt => 14 HP vs maxHealth 34k-58k (Stats:81) = ~0.03% (no DAMAGE_SCALE) while damagePercent +11.2 pts (1807). Status DoT (1145) multiplies by DAMAGE_SCALE. => skill DoT is ~100x too weak in HP, P1 hidden bug.
- 106-112 SIGN CONVENTION: negative shoulder angle raises arm forward; amplitudes negated. 115-121 strikeTracks coefficients .5, .8, .4, .6, -.4; 129-132 legDrive .7, .3; 139-141 crouch 2.2, .9, .5, .3.
- cooldowns: dash 3.5-5, power 7-9, defense 9-11 (grep lines 150-354).
- 366 skillsForClass.

### game/SkillRuntime.ts (128 lines)
- 8-22 SkillRuntime {skills, cooldowns, active, armorMul, speedMul, attackIntervalMul, dot, buffRemaining}.
- 74-76 buffRemaining = duration + .35 — duplicated by Engine debugView 2302-2305 (re-implements beginSkill) -> factor.
- Engine 636-640 re-implements createRuntime reset -> resetRuntime(rt, skills).
- 94 movementMul = speedMul trivial wrapper.
- 114 inReach = dist <= reach + .4; 115 far > reach + 1.4; 116 hurt < .42. vs hit rule reach + defender.radius(.6) (Engine 1360) vs aura reach + .6 (Engine 1978): three "in reach" margins.
- 118 "Defence" spelling vs kind "defense".

### Weapon.ts 40-46 & WeaponGen.ts 84-90: identical stat table duplicated (damage, cooldown, reach, knockback) P2 factorise. reach 1.1-2.8.

### Type-name census (grep ^export type|interface in src/game)
- DUPLICATE names: MatchRecord HistoryFilter.ts:22 & MatchHistory.ts:22; HistorySummary HistoryFilter.ts:61 & MatchHistory.ts:93; WeaponType Weapon.ts:3 & WeaponGen.ts:8; JointConstraint PartHierarchy.ts:211 & BodyProfile.ts:277; Violation ParameterBounds.ts:35 & PartHierarchy.ts:297; Vec3 PalmWeapon.ts:17, DepthGuard.ts:29, WeaponIntegrity.ts:23 (+ InputVector Vec2 {x,z}); Body SmashPhysics:9 & Physics:41.
- End-of-match vocab x3: WinReason MatchHistory.ts:6 "ko|ring-out|timed|koth"; EndReason HistoryFilter.ts:37 "ko|endurance|domination|sudden-death"; WinConditionKind WinConditions.ts:8 "ko|sudden-death|first-blood|endurance|domination".
- Stance x4: GripStance GripStance.ts:13 (rest thrust guard swing-h/v/d); Stance BalancePlates.ts:16 (standing staggered kneeling fallen); "stance" = defensive skill buff (SkillRuntime:14); BodyState BodyProfile.ts:241.
- Pose/face/state: PoseName Skeleton.ts:1 idle walk attack hit ko skill; FaceState FaceMorph.ts:11 idle attack hit ko block; BodyState BodyProfile.ts:241.
- Disposition Disposition.ts:12 "friendly|neutral|enemy" but Engine 181 / isHostile say "hostile" -> value `enemy` vs word hostile.
- Archetype Ranking.ts:11 berserker tactician duelist sentinel (AI play style) vs Stats.ts:22,45 "eight archetypes" = classes -> P1 synonym clash.
- `Stats` AiStats.ts:15 vs module Stats.ts/CombatStats.
- StatusName Status.ts:8 stunned hypnotised controlled burning poisoned chilled blessed hasted slowed; Fighter.stun (seconds) vs status "stunned".
- SenseName Senses.ts:16 sight hearing touch magnetism scent.
- GroundMaterial Terrain.ts:1 stone sand ice wood; Surface Terrain.ts:3.
- RingShape ArenaConfig.ts:144; ObjectKind 219; ArenaCategory 13; ParamSpec 16; ArenaConfig 105; ArenaObject 221.
- PickupKind PowerUps.ts:15 resource|buff|coin vs ItemKind Items.ts:13 coin|chest|shrine|banner -> "coin" is both an Item and a Pickup (two coin systems: Engine #coins via items 1177 and #grantPickup coin 498).
- ResourceKind Resources.ts:11 mana|stamina.
- SecondaryStat SecondaryStats.ts:16 crit haste mastery physResist magicResist versatility.
- StatName Races.ts:3; Subrace Races.ts:5; RaceDef 12. Birthsign Birthsight.ts:3 (file name Birthsight vs type Birthsign P2).
- Decision DecisionTree.ts:1 attack advance retreat block wait flank; BrainMode AiBrain.ts:18 tree|neural|hybrid; Personality AiBrain.ts:21.
- Controller MatchHistory.ts:5 human|decision-tree (vs AiStatus controller() in Status "caster").
- MatchLengthId, SpeedId MatchControl.ts:9,19.

### game/Disposition.ts (120 lines)
- 3-6 FRIENDLY -> NEUTRAL -> ENEMY; 12 type "friendly|neutral|enemy"; 21 doc "then hostile"; 81 label "HOSTILE"; Engine isHostile -> value `enemy` vs word `hostile` P2 (canonical: hostile).
- 22 DEFAULT_TIMING 3+3 s; Engine:709 overrides with roamSeconds/2 each.
- 25 truceSeconds = friendly + neutral ("truce" = both non-hostile phases).
- 36 canAttack; 41-46 colours; 50 truceProgress; 66 isHostile(elapsed, attackerId, targetId, allies, t).
- 92 RoamInput.bound doc "Arena half-size"; Engine passes ringHalf-.8 (1001) and roamIntent shrinks again r = max(.2, bound-1.2) (114) then *.6 (115-116) -> three stacked margins P2.
- 112 phase = (seed%1000)/1000*2PI; 115-116 Lissajous freqs .37/.29 rad/s, amp .6r, jitter (roll-.5)*.8; Engine passes roll .5 const (1002) => jitter term always 0 (dead) P2.
- 118 idle when (seed + floor(t/2)) % 5 == 0 -> "one in five" 2 s windows.

### game/Senses.ts (232 lines, read 1-110)
- 16 SenseName; 21-27 SENSE_BASE sight 42 hearing 26 touch 1.1 magnetism 30 scent 18 m.
- 30-34 SENSE_FALLOFF 1.0/1.35/3.0/1.2/1.6.
- 40-47 SenseGear helmet 0..1, armour 0..1 (Engine passes min(1, armor/8)).
- 54-58 gear coefficients (sight -.30 helm -.08 armour; hearing -.45/-.12; touch -.25 armour; magnetism -.15 helm; scent -.35 helm); 60 floor .2 m.
- 93-109 lensFactor(elevation, azimuth, agitation, flatten .72, forward .55, flare .35); 106 tan cap 1.35 rad; 107 code `1 + flare*tan*a*0.5` but doc 90 says `1 + flare*tan*agitation` (extra .5) P2 comment/code.
- Engine 1135 calls lensFactor(0, az, agit): elevation 0 -> flatten & flare terms inert in the fog reveal.

### Misc read (Ranking, FogOfWar, ArenaConfig, Terrain, Races, Birthsight, Characters, MatchHistory)
- ArenaConfig.ts:105-119 ArenaConfig fields (size walls wallChance wallResistance wallHeight wallBounce ... roamSeconds ... itemRate coinSize coinPop coinGravity coinGreed ... outsideGround outsideCollision outsideHeight ...). `walls`, `outsideGround`, `outsideCollision` are numbers used as booleans (>=1) (Engine 456, 684; ArenaPhysics 93) P2.
- ArenaConfig.ts:125-128 halfSize = size/2 "half-width of the field" vs Engine #ringHalf = min radius over 16 bearings (Engine 545-550): two meanings of "half" P1/P2.
- ArenaConfig.ts:167 ringRadiusAt, 195 insideRing, 251 placeObjects, 291 randomArena.
- Ranking.ts:1 "MMR (Elo)"; 11 Archetype; 26-29 engageRange 2.4/1.8/1.7/1.3 m (absolute, independent of weapon reach 1.1-2.8 Weapon.ts:40-46) -> derive as k*reach; cowardice/aggression/neuralTrust 0..1; 45 START_MMR 1000; 47 K_FACTOR 32; 51 Elo scale 400.
- FogOfWar.ts:4-5 seen (ever) / visible (now); 12-23 FogGrid cols rows cell half; 25 createFog(half, cell=1).
- Terrain.ts:3-9 Surface {speed, turn, stop, step}; 7 doc "stop-time MULTIPLIER (higher = slides longer)" but Engine uses exp(-(1/stop)dt) => stop is a TIME CONSTANT in s P2; 8 step duplicates material; 12-15 stone 1/1/.7, sand .7/.8/.4, ice 1.25/.5/2.2, wood 1/.9/.9; 24-29 materialAt bands .35 .6 .85 of ringHalf.
- Engine #surfaceP/#surfaceO hold GroundMaterial ids, surfP holds Surface -> name mismatch P2.
- Races.ts:5-10 Subrace.tweak; 12-20 RaceDef.mods + `subspecies: Subrace[]` -> subrace / subspecies / "sub-species" (Menu.ts:111) synonyms; tweak vs mods same concept.
- Races.ts:33-67 StatRange {min,max,avg,median} "descriptive, not sampled": base 8 + bonus; min c-3, max c+4, avg c+.5, median c -> invented distribution labelled as statistics P1 (statistics.md).
- Birthsight.ts:3-9 Birthsign {id,name,symbol emoji,mods,lore}; file name Birthsight vs type Birthsign; UiTree.ts:131 "star sign" synonym.
- Characters.ts:6-23 Appearance {body, accent, height, weight (units unstated), hair, eyes, race, subrace, silhouette}; 25-37 CharacterProfile {name race subrace className appearance palette birthsign level allocated weaponType equip}.
- MatchHistory.ts:5 Controller; 6 WinReason; 17 dealt; 22-34 MatchRecord; 36 HISTORY_KEY; 37 HISTORY_CAP 500; 57 wilson z=1.96; 66-74 describe(): n mean median SAMPLE sd (n-1) min max — duplicates MathCore.summarize which uses POPULATION sd (MathCore:124-125, 155) P2; 77-91 rateBy; 93-104 HistorySummary; 106 summarize (name clash w/ MathCore).
- Menu.ts:15 Screen title|select|victory|digest|sheet; UiTree.ts:20 ScreenId same set; Menu.ts:121-122 "Calling" panel = class; UiTree.ts:151 "The eight callings"; 153 "Techniques" = skills ("Dash, power and defence"); 212 "Power costs" for technique costs.

### Status.ts (142)
- 8 StatusName; 10-28 StatusDef {disables, control self|caster, speedMul, attackMul, dps (brief units; Engine *DAMAGE_SCALE 1145), duration, clearedBy schools(=elements), good}.
- 31-39 table: stunned 1.5 s, hypnotised 3, controlled 4, burning 6 dps 4 s, poisoned 4 dps 6 s, chilled .6 speed 1 dps, blessed -5 dps (heal) 8 s, hasted 1.4/1.3, slowed .55/.8.
- 106-112 speed/attack multipliers multiply all active (product composition, unbounded below except Engine .2 floor 973).
- 125 ElementStatus target "enemy"|"self" ("enemy" again vs hostile). 127-134 durations; 123 power full / dash half / defense self-only.
- "school" (Status:6,24,82) == element (Skills:11) -> synonym; Status:121 says "same element names, so the vocabulary is one set".

### Targets in docs
- PHASE1_PLAN.md:6 "10000 independent fights per unordered class pair, held-out seeds, 48-52% pairwise target".
- PHASE1_PLAN.md:20 "Balance field-wide to 49.4–50.6%".
- docs/SPEC.md:583 "mirror matchups 50% ± 2; cross-class pairs 48–52%"; 594 per-class field share 49.4–50.6% met; 596 "SC-002 pairwise target: not met".
- artifacts/data-science.md:284-285 "field shares 49.4–50.6%; mirrors 48.7–51.1%; pairs 44–56%, 15/28 in 48–52%".
- Stats.ts:146 "48-52%"; Stats.ts:110-112 calibration 3 seeds x 1500 fights/pair.

### Verified by grep (src/)
- AudioManager.ts:31 playStep(material) = #surfaceTone(material), no gating -> with Engine 1777/2107 footsteps play every .35 s even standing still / in menu. CONFIRMED P1.
- `weapon.cooldown` referenced nowhere -> Weapon.cooldown (Weapon.ts:40-46) unused in combat.
- `.turn` read nowhere -> Surface.turn (Terrain.ts:6) dead tuning field.
- Impact.knockback (Physics.ts:160) never read.
- Weapon.ts:60 and WeaponGen.ts:164 duplicate `base.knockback * (0.5 + w*0.09)`.
- Summary-stat implementations x4: MathCore.summarize (pop sd, p20/p80) ; MatchHistory.describe 66-74 (sample sd) ; AiStats.fold 24-38 (sample sd, drops non-finite) ; Races.computeRaceStats 52-67 (fake). Wilson x2: MatchHistory.wilson 57 ; ArenaHarness.wilsonInterval 19-31 (z 1.96 literal both). PRNG x4: MathCore.rng32 193, ArenaHarness.randomSource 9-17, EvolutionHarness.randomSource 11, arena-worker randomSource 5 (+ Items.seededRng).
- ArenaHarness: 7 HARNESS_CLOSING_SPEED=1 "from the MEDIAN of closing speeds" (41-42) — good existing derived constant; 45 600 exchange cap; 46 tie eps .0005; 102 decisive = fights - draws; 105 band literal .48/.52; harness models crit+jitter+armour+physics only (no block .4, skills, knockback, status, DoT, buffs, pickups) vs Engine 1386.
- "spread" as relative half-width also: BodyProfile.ts:329,338 randomSilhouette spread .09; PartHierarchy.ts:154-158 PARAM_SPREAD; ParameterBounds.ts:117 damage_variance "Random damage spread".
