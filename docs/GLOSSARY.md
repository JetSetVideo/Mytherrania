# Mytherrania glossary

The game's vocabulary: one row per term, with a one-sentence definition, its unit and range, where it
is defined, and the other words the code uses for the same thing. Lane H (R08 + R10), written
2026-10-28. Nothing here changes code. It is the reference the renames and comments in
`docs/review/vocabulary.md` point at.

**How to read the citations.** `file:line` points at the line that defines the term.
`src/engine/Engine.ts` line numbers are from the snapshot `c5b55af` (2,574 lines). They agree with
the lines BRIEF.md cites, for example `Engine.ts:1819 keyZ: -move.z`. The parent is editing
Engine.ts right now (it was 2,620 lines when this was written), so every Engine citation also gives
a code anchor (a method or constant name) that you can search for.

**Status flags** in the *Synonyms* column:
- ⚠ — the code uses two or more words for this one concept, or one word for two concepts.
- ✅ — the word is the recommended canonical one.

Units: m (metres), s (seconds), rad (radians), 1/s (a rate), kg, HP (hit points after `HEALTH_SCALE`),
"brief units" (the original damage scale, HP / `DAMAGE_SCALE`).

---

## A. Maths, smoothing and statistics (MathCore + BRIEF)

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **t (normalised parameter)** | The position along an interpolation or an animation: 0 is the start, 1 is the end. | [0, 1] | `src/core/MathCore.ts:8` | Engine also calls it `progress` (`skillProgress()`, Engine.ts:903) and `prevT` (`#skillPrevT`, Engine.ts:155). ✅ `t` |
| **lerp** | Linear interpolation `a + (b − a)·t`. It is not clamped, so it extrapolates. | — | `MathCore.ts:27` | Engine writes the same formula inline: `x += (target − x)·k` at Engine.ts:1113, 2010, 2011, 2136. |
| **invLerp / remap** | `invLerp` finds where `v` sits between a and b, as a value of t. `remap` maps one range onto another and clamps the result. | — | `MathCore.ts:32, 37` | — |
| **smoothstep / smootherstep** | Hermite S-curves from 0 to 1. Smoothstep has a continuous first derivative (C1); smootherstep also has a continuous second derivative (C2). | [0, 1] | `MathCore.ts:42, 48` | — |
| **lambda (convergence rate)** | The rate of exponential damping. After `1/lambda` s a damped value has closed about 63% of its gap. | 1/s, ≥ 0 | `MathCore.ts:9-10` | ⚠ Engine encodes it in three different ways: `1 − exp(−dt/0.1)` (time constant, Engine.ts:1112), `1 − exp(−6·dt)` (rate, Engine.ts:2010), and `exp(−(1/stop)·dt)` (time-to-stop, Engine.ts:1846). Recommendation: always use ✅ `lambda`, and derive it with `lambdaFromHalfLife`. |
| **halfLife** | The time a damped value takes to close half its gap. `lambda = ln2 / halfLife`. | s, > 0 | `MathCore.ts:11, 70` | `Surface.stop` (Engine.ts:1846) is a time constant (time to 1/e), not a half-life. |
| **damp / dampAngle** | Frame-rate-independent exponential smoothing toward a target: `lerp(cur, target, 1 − e^(−lambda·dt))`. `dampAngle` takes the shortest arc. | — | `MathCore.ts:65, 86` | Re-implemented inline in Engine (see the lambda row). |
| **spring (critically damped)** | A smoother whose state is a value and a velocity. It reaches the target in about `smoothTime` with no overshoot. | `smoothTime` in s | `MathCore.ts:91-112` | — |
| **spread** | `max − min` of a sample (its full width). | same unit as the sample | `MathCore.ts:12, 127` | ⚠ `DAMAGE_SPREAD = 0.35` (`src/game/Stats.ts:147`) is a *relative half-width*: the damage multiplier lies in [0.65, 1.35]. Recommendation: rename it `DAMAGE_HALF_RANGE`, or define `spread` as relative and say so. |
| **share** | The fraction of a total held by a subset. "The top 20% hold 80%" is a share of 0.8. | [0, 1] | `MathCore.ts:13, 184` (`topShare`) | — |
| **Summary** | min, max, mean, median, p20, p80, population standard deviation, and spread of a sample. | — | `MathCore.ts:115-128, 140` (`summarize`) | ⚠ the name `summarize` is also exported by `src/game/MatchHistory.ts`, and Engine imports that one (Engine.ts:64). Recommendation: rename the history one `summarizeHistory`. |
| **p20 / p80** | The 20th and 80th percentiles, which are the Pareto cut points. | — | `MathCore.ts:121-123` | — |
| **quantile** | A linearly interpolated quantile of an ascending-sorted array. | q ∈ [0, 1] | `MathCore.ts:131` | — |
| **normalise (min-max)** | Rescale a sample in place so its minimum maps to 0 and its maximum to 1. | [0, 1] | `MathCore.ts:161` | — |
| **Pareto (80/20)** | A heavy-tailed distribution. With `alpha = log 5 / log 4 ≈ 1.161`, the top 20% hold 80% of the total. Used for feature sizes (R07). | alpha dimensionless | `MathCore.ts:168-181`; `docs/overhaul/BRIEF.md:21` | BRIEF:31 records the transcription drift "parental law" = Pareto. |
| **xm (Pareto scale)** | The smallest value a Pareto draw can take. | sample unit | `MathCore.ts:175-178` | — |
| **cap (tail cap)** | The upper bound that truncates a Pareto draw. | sample unit | `MathCore.ts:176` | — |
| **rng32 / seed** | A seedable Mulberry32 generator returning values in [0, 1). The same seed gives the same sequence. | — | `MathCore.ts:193` | ⚠ `seededRng` (`src/game/Items.ts`, imported at Engine.ts:31) and `Math.random()` are both still used for gameplay rolls (Engine.ts:520, 692, 705, 1372, 1407, 1665). |
| **target spread** | The allowed width of a balance metric's distribution, for example pairwise win rates within 48–52%. | % | `Stats.ts:146`; see `docs/review/statistics.md` | — |

## B. Fighter, body and rig

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **fighter** | One combatant: name, class, combat stats, weapon, kinematic body, hp, damagePercent, timers, skeleton and decision tree. | — | `src/game/Fighter.ts:9-23` | Engine also says *player* / *opponent* (`#player`, `#opponent`, Engine.ts:100-101), *combatant* (Engine.ts:183), *bot* (Engine.ts:743), *rival* (HUD text, Engine.ts:1506), *self* / *other* (Engine.ts:1463-1464), *attacker* / *defender* (Engine.ts:1353). ✅ `fighter`. Use player/opponent only for the two seats. |
| **player / opponent (seat)** | Seat 0 and seat 1 of a match. In spectate mode both seats are run by the AI. | id 0 / 1 | `#idOf`, Engine.ts:948-951 | ⚠ `#winner: "player" | "opponent"` (Engine.ts:105) and `winner: 0 | 1` (`#recordMatch`, Engine.ts:2352) encode the same fact in two ways. |
| **kinematic body (`Body` in SmashPhysics)** | A point with a radius: position, velocity and a collision radius. | m, m/s; radius 0.6 m | `src/physics/SmashPhysics.ts:9-17` | ⚠ It has the same name as the mass model `Body` in `src/game/Physics.ts:41`. ArenaPhysics.ts:11 aliases it as `KinematicBody`. Recommendation: export ✅ `KinematicBody` and ✅ `MassBody`. |
| **mass body (`Body` in Physics)** | A composite of parts with mass, volume and frontal area, plus a material (armour fraction, restitution). | kg, m³, m² | `src/game/Physics.ts:21-48` | Built by `bodyFromStats` (Physics.ts:249). Engine names it with `#bodyOf` (Engine.ts:958). |
| **body radius** | The collision radius of the kinematic body. | m; always 0.6 | `SmashPhysics.ts:16` | ⚠ `PLAYER_RADIUS = 0.5` (Engine.ts:80) is passed as `createFighter(..., radius)`, but Fighter.ts:39 forwards it as the **y** argument of `body(x, y, z)`. It never sets the radius. See vocabulary.md, V-01. |
| **body centre (body.y)** | Height of the kinematic body's centre above the floor. The floor snap holds it at `radius` (0.6 m). | m | `src/physics/ArenaPhysics.ts:87-88`; BRIEF.md:49 | ⚠ The rig group is placed at body.y (Engine.ts:1952), not at the feet. That is the cause of R03's floating soles. |
| **rig (HumanoidRig)** | The Three.js group of meshes that draws a fighter. Each pivot is its own mesh plus an outline. | — | `src/graphics/Humanoid.ts` (`buildHumanoid`, used at Engine.ts:624) | Also called *mesh*, *model* (`modelBounds`, Engine.ts:2148) and *body* (in graphics comments). ✅ `rig` for the scene object, ✅ `model` only in QA captures. |
| **pivot** | A named transform node of the rig that one body part hangs from, for example the shoulder pivot. | — | BRIEF.md:44; `debugRigInfo` (Engine.ts:2203-2232) | Overlaps with *joint*. A joint is the angle; a pivot is the scene node that applies it. |
| **joint (Joint, JointName)** | One rotational degree of freedom of the skeleton (shoulderR, elbowL, hipL, kneeR, spine, neck…), with an angle and limits. | rad | `src/game/Skeleton.ts:32-47` | ⚠ `JointId` (`src/game/BodyGraph.ts:24`) is a side-less joint *type* (shoulder, elbow, hip, knee), while `JointName` is a sided *instance*. Engine maps one to the other by hand (Engine.ts:1598-1604). |
| **skeleton** | The joint angles of one fighter, plus its pose, skill-animation, grip, face and balance state. | — | `src/game/Skeleton.ts` (`defaultHumanoid`, used at Fighter.ts:46) | — |
| **pose (PoseName)** | The discrete body state the skeleton eases toward: idle, walk, attack, hit, ko or skill. | enum | `Skeleton.ts:1` | ⚠ The same idea appears as `BodyState` (`src/game/BodyProfile.ts:241`, with 9 values) and `FaceState` (`src/game/FaceMorph.ts:11`). |
| **face state (FaceState)** | The expression preset: idle, attack, hit, ko or block. | enum | `FaceMorph.ts:11` | ⚠ The names are inverted relative to the events. *Taking* a hit shows the `"block"` face and *attacking* shows the `"hit"` face (Engine.ts:1560-1567). |
| **stance** | ⚠ Four different concepts share this word: (1) **grip stance**, how the hand holds the weapon (`GripStance`: rest, thrust, guard, swing-h/v/d; `src/game/GripStance.ts:13`); (2) **balance stance**, whether the fighter is standing, staggered, kneeling or fallen (`src/game/BalancePlates.ts:16`); (3) **skill stance**, the buff a defensive skill holds up (`SkillRuntime.armorMul`/`speedMul`, `src/game/SkillRuntime.ts:14-17`); (4) the "fighting crouch" pose (Engine.ts:1545). | — | as listed | Recommendation: ✅ `grip` (1), ✅ `footing` (2), ✅ `guardBuff` (3), ✅ `pose` (4). |
| **silhouette** | The per-part shape parameters (length, root radius, taper, …) that give one fighter its body proportions. | m | `src/game/BodyProfile.ts:37` (`RaceSilhouette`); `randomSilhouette`, used at Engine.ts:622 | — |
| **body part (BodyPartName)** | A named lofted segment: chest, upperArm, foreArm, thigh, shin, and so on. | — | `BodyProfile.ts:17` | ⚠ `BodyPart` in Physics.ts:21 is a *mass* part (torso, limbs, weapon), not a mesh part. |
| **balance (plate)** | A damped-sinusoid sway of the centre of mass after an impact. | rad offset | `src/game/BalancePlates.ts`; used at Engine.ts:1413, 1948 | — |
| **ragdoll** | A Verlet node-and-link body that replaces the rig while a thrown fighter tumbles. | — | `src/game/Ragdoll.ts:10-45`; Engine.ts:1146-1159 | — |

## C. Combat

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **hp / maxHealth** | The fighter's remaining and maximum life points. A fighter at hp ≤ 0 is KO'd. | HP; maxHealth 34,000–58,000 | `Fighter.ts:15`; `src/game/Stats.ts:81` | Shown as "HP" in the HUD (Engine.ts:1518). ✅ `hp` |
| **HEALTH_SCALE** | The ×1000 multiplier that turns the brief's health numbers into "RPG" numbers. | 1000 | `Stats.ts:54` | — |
| **FIGHT_LENGTH** | How many times longer a duel lasts than the original brief's. Damage is scaled by `HEALTH_SCALE / FIGHT_LENGTH`. | 10 | `Stats.ts:58` | — |
| **DAMAGE_SCALE** | The factor between "brief units" and HP: `HEALTH_SCALE / FIGHT_LENGTH`. | 100 | `Stats.ts:60` | ⚠ Applied inconsistently. Status damage-over-time is multiplied by it (Engine.ts:1145); skill damage-over-time is not (Engine.ts:1806). See vocabulary.md, V-09. |
| **brief units** | Damage expressed on the original brief's scale: HP / DAMAGE_SCALE. Used by stun, fall damage and the knockback meter. | — | `src/physics/SmashPhysics.ts:28-29` | — |
| **attackPower** | The class's base damage per swing before crit, damage jitter, armour, physics and buffs. It is solved so that every class has the same power index. | HP; clamped 500–1,400 | `Stats.ts:88-103` | ⚠ `Skills.ts:63` still says a skill's damage multiplier applies to "the weapon's damage". |
| **attackInterval** | Seconds between swings for the class. | s; 0.85–1.35 | `Stats.ts:82` | ⚠ `Weapon.cooldown` (`src/game/Weapon.ts:40-46`) is a second swing period that combat does not use. The live game uses `#swingCooldown` (Engine.ts:968). |
| **armor (stat)** | Class armour points. Each point reduces damage by 4%: `dmg / (1 + 0.04·armor)`. | points; 2–6.5 | `Stats.ts:83, 152` | ⚠ **armour (material)** in `Physics.ts:33` is a different thing: a 0–1 plating fraction, `min(1, armor/8)`. Same word, two spellings, two meanings. Recommendation: ✅ `armor` (stat), ✅ `platingFraction` (material). |
| **power index** | DPS × effective HP: `(attackPower / attackInterval) · maxHealth · (1 + 0.04·armor)`. The balance solver makes it equal across classes. | target 450 (scaled) | `Stats.ts:49, 106-108` | — |
| **crit / criticalChance** | The chance that a hit does ×1.4 damage: `clamp(0.008·REF / (0.010·RES + 0.1), 0.03, 0.15)`. | [0.03, 0.15] | `Stats.ts:136-138, 150` | `SecondaryStat "crit"` (`src/game/SecondaryStats.ts:16`) adds to it. |
| **damage jitter (`DAMAGE_SPREAD`)** | The uniform per-hit multiplier `1 ± 0.35`. | [0.65, 1.35] | `Stats.ts:147, 151` | ⚠ called *spread*, but it is a relative half-width (see A, spread). |
| **damagePercent (knockback meter)** | A Smash-style meter that rises with damage taken and multiplies the knockback received: `knockback = weapon.knockback · (1 + damagePercent/60)`. | % ≥ 0, uncapped | `Fighter.ts:16, 52-54` | ⚠ The HUD labels it **"knockback N%"** (Engine.ts:1518). Engine also reads it as **stamina**: `staminaRatio = 1 − damagePercent/100` (Engine.ts:1418). Recommendation: ✅ `knockbackMeter` (code) and "knockback %" (UI); never stamina. |
| **knockback / knockbackPower** | The horizontal launch speed given to the defender's kinematic body. | m/s | `Fighter.ts:52`; `SmashPhysics.ts:19-24` | `Impact.knockback` (`Physics.ts:160`) is a distance in metres that nothing reads. ⚠ |
| **stun (fighter.stun)** | Seconds the fighter cannot act after a blow: `Stun = Damage·Force·1.5^WallBounce · 0.01 s`. | s | `Fighter.ts:18`; `SmashPhysics.ts:26-33` | ⚠ There is also the **status** `"stunned"` (`src/game/Status.ts:31`). A physical stun > 0.6 s is converted into it (Engine.ts:1140). ✅ `stun` = the physical timer, `stunned` = the status. |
| **block** | Holding guard. While blocking a fighter takes ×0.4 damage. | s timer in AnimState | Engine.ts:91, 1361, 1386 | — |
| **closing speed (v_close)** | The attacker's speed onto the defender along the line between them: `max(0, (v_a − v_d)·n̂)`. | m/s ≥ 0 | `Physics.ts:277-284`; Engine.ts:935-946 | — |
| **reduced mass (mu), impulse (J), toughness (T)** | `mu = m1·m2/(m1+m2)`; `J = mu(1+e)·v_rel`; `T = rho·(0.4+0.6·armour)·sqrt(A)`. | kg; N·s; — | `Physics.ts:12-17` | — |
| **physicsMul** | A blow's damage multiplier from the mass ratio, density ratio and closing speed, clamped to [0.6, 1.8]. | — | `Physics.ts:258-275` | Two equal bodies standing still give 0.935, not 1 (`Physics.ts:265`). See statistics.md, S-5. |
| **reach** | How far a weapon strikes, measured from the attacker's centre. A hit lands when `dist ≤ reach + defender.radius`. | m; 1.1–2.8 | `Weapon.ts:40-46`; Engine.ts:1360 | ⚠ The other "in reach" tests use different margins: +0.4 (`SkillRuntime.ts:114`) and +0.6 (aura, Engine.ts:1978). |
| **wall / wallResistance / integrity** | The perimeter wall resists a body's momentum `J = m·v`. It breaks when `J > 1.05·R·integrity`. Integrity (1 = intact, 0 = gone) is shared by the whole wall. | resistance in N·s; integrity [0, 1] | `Physics.ts:165-218`; `src/physics/ArenaPhysics.ts:16-24` | `walled` (ArenaPhysics.ts:20) is this match's roll; `walls` (`src/game/ArenaConfig.ts:106`) is the 0/1 number. ⚠ a number used as a boolean. |
| **fall damage** | `D = 0.9·(½mv²)/T`, in brief units. | brief units | `Physics.ts:220-230` | — |
| **ringed out** | The body's centre is not over the ring floor this frame. This is a state, not a defeat. | boolean | `Fighter.ts:19`; Engine.ts:1873 | ⚠ `WinReason "ring-out"` (`src/game/MatchHistory.ts:6`) is a leftover: Engine.ts:706 says "no ring-out" ending. |
| **RING_OUT_FLOOR** | The fall height below which a body counts as having left the world and is returned to the ring. | m; −8 | Engine.ts:83, 1693 | Engine also uses `RING_OUT_FLOOR − 1.5` (body clamp, Engine.ts:1875) and `− 2` (void plane, Engine.ts:589). ⚠ three floors. |
| **KO / eliminated** | A fighter with hp ≤ 0. Death is the only way a match ends. | boolean | `Fighter.ts:20`; Engine.ts:1704-1719 | *Victory* / *defeat* (UI), `endReason "ko"`. ✅ `ko` |

## D. Skills

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **skill** | One of the three class moves (dash, power, defense), each with a cooldown, a payload and an animation. | — | `src/game/Skills.ts:81-92` | ⚠ The code says *skill* (types, Engine), *technique* (Engine.ts:54, 841, 860; AiStats `techniques`; UI "Techniques", `src/ui/UiTree.ts:153`; Menu.ts:467) and *power* (BRIEF R09 "powers HUD"; UiTree.ts:212 "Power costs"). But **power** is also one of the three kinds. Recommendation: ✅ `skill` in code; "technique" may stay as a UI label, but not as an identifier; never "power" for the general concept. |
| **kind (SkillKind)** | Which of the three slots a skill fills: `dash` (gap closer), `power` (heavy strike), `defense` (guard buff and cleanse). | enum | `Skills.ts:8` | ⚠ The spelling switches between "defense" (the identifier) and "defence" (Engine.ts:834, SkillRuntime.ts:108, 118, UiTree.ts:153). ✅ `defense` |
| **element** | The magic school of a skill (fire, fury, poison, shadow, arcane, necrotic, wind, holy). It decides the effect colour and which status the skill inflicts. | enum | `Skills.ts:11` | ⚠ Status.ts calls it a *school* (`clearedBy`, Status.ts:6, 24, 82). ✅ `element` |
| **payload** | What a skill does when it lands: damageMul, stun, knockbackMul, lifesteal, dot, and the stance multipliers. | — | `Skills.ts:62-79` | — |
| **cooldown** | Seconds before the skill can be used again. | s; dash 3.5–5, power 7–9, defense 9–11 | `Skills.ts:89` (values at 150-354) | Also `attackCooldown` (the swing timer, Fighter.ts:17) and `Weapon.cooldown`. ⚠ three different "cooldowns". |
| **lunge / hop** | Ground gained and vertical lift over a skill's animation. | m | `Skills.ts:54-57` | ⚠ The doc says "along the facing direction"; Engine applies it toward the opponent (Engine.ts:906-912). |
| **hitAt** | The fraction of the animation at which the strike resolves. | t ∈ [0, 1] | `Skills.ts:52` | — |
| **effect strength (skillFx)** | Peak flare intensity of the weapon effect, scaled by the share of the target's health removed. | [0, 1] | Engine.ts:139, 927 | — |
| **DoT (damage over time)** | Damage spread over a duration. A skill's `dot` is `{ total, seconds }`; a status has `dps`. | ⚠ units differ: see DAMAGE_SCALE | `Skills.ts:72`; `Status.ts:21` | — |
| **mana / stamina (resources)** | The pools a skill spends: dash costs stamina; power costs mana and stamina; defense costs mostly stamina. | points | `src/game/Resources.ts:11-20`; Engine.ts:58-62 | ⚠ `staminaRatio` in Engine.ts:1418 is not this stamina (see damagePercent). |

## E. Statuses, pickups and items

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **status (StatusName)** | A timed condition: stunned, hypnotised, controlled, burning, poisoned, chilled, blessed, hasted or slowed. Each carries speed and attack multipliers, a dps, and the elements that clear it. | s | `Status.ts:8-40` | — |
| **controlled** | A status under which the caster steers the victim away from itself. | s | `Status.ts:33`; Engine.ts:1279-1296 | `controller()` (Status.ts:101) has nothing to do with `Controller` ("human" or "decision-tree", MatchHistory.ts:5). ⚠ |
| **cleanse** | Remove every status that a given element clears. A defense skill does this on its hit frame. | — | `Status.ts:82`; Engine.ts:917-923 | — |
| **pickup (PickupDef)** | A drop on the floor (health orb, mana orb, stamina draught, rage, ward, swift, focus, coin). It gives either a percentage of a pool or a timed buff. | value % of pool | `src/game/PowerUps.ts:15-50`; Engine.ts:488-511 | ⚠ *drop*, *orb*, *power-up* (file name), *map buff* (Engine.ts:1381) are all used for it. ✅ `pickup` |
| **buff (ActiveBuff)** | A timed multiplier from a pickup: rage (damage dealt), ward (damage taken), swift (speed), focus (swing rate). | multiplier | `PowerUps.ts:43, 170` | ⚠ The defensive skill's stance multipliers are also called buffs (`SkillRuntime.buffRemaining`, SkillRuntime.ts:21). |
| **item / coin** | A world object that pops, falls and lands. Coins pull the AI off the fight (a distraction). | — | `src/game/Items.ts:13-52` | ⚠ "coin" is also a pickup id (PowerUps, Engine.ts:498). Two coin systems feed one counter (`#coins`). |
| **distraction / greed** | The AI breaking off to chase a landed coin. `coinGreed` sets how likely that is. | s chased | Engine.ts:1227-1242; `ArenaConfig.ts:111` | — |

## F. Arena and world

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **arena (ArenaConfig)** | All the parameters of one match's battlefield: shape, size, wall, outside ground, props, truce length, item rates and environment (about 50 numeric fields). | mixed | `src/game/ArenaConfig.ts:105-119` | ⚠ *ring* (Engine.ts:412 "the ring's real SHAPE"), *arena*, *platform* (Engine.ts:584), *field* (ArenaConfig.ts:125). Recommendation: ✅ `arena` for the config, ✅ `ring` only for the walkable floor polygon. |
| **arena type (ArenaType)** | A decorative theme (ring, walls, hills, river), picked at random each match independently of the config, which also chooses the `Place` by array index. | enum | Engine.ts:78, 705, 727 | ⚠ "walls" here is decoration; the real wall is `cfg.walls`. Two different meanings of *walls*. |
| **ring (floor / outline)** | The walkable floor: a closed polygon of `n` points at radius `R(θ) = ringRadiusAt(cfg, θ)`. | m | `ArenaConfig.ts:167`; `ArenaPhysics.ts:135-143` | *outline* = the sampled polygon; Engine samples it at n = 96 (Engine.ts:422) and n = 48 (Engine.ts:1487). |
| **R(θ) (ring radius at bearing)** | The distance from the centre to the ring edge along bearing θ. | m | `ArenaConfig.ts:167` | — |
| **edge distance** | `R(θ) − |p|`: positive inside the ring, negative outside. | m | `ArenaPhysics.ts:122-129` | — |
| **size / halfSize** | `size` is the full span of the field and `halfSize = size/2`. | m | `ArenaConfig.ts:105, 125-128` | ⚠ Engine's `#ringHalf()` (Engine.ts:545-550) is not size/2. It is the minimum `R(θ)` over 16 bearings (the inscribed radius). Recommendation: rename it ✅ `#inscribedRadius()` and compute it once per match. |
| **outside ground** | A solid plane outside the ring at `outsideHeight`, which a thrown body lands on. | m | `ArenaConfig.ts:116`; `ArenaPhysics.ts:92-100` | — |
| **props (ArenaObject)** | Solid scenery (pillar, ramp, platform, crate, rock, arch, tree, gliderPad), each with a radius, a height and a scale. | m | `ArenaConfig.ts:219-230` | — |
| **ground material / surface** | The floor type at a point (stone, wood, sand, ice, in concentric bands) and its movement factors: `speed` ×, `turn` ×, `stop` (time constant, s). | ×; s | `src/game/Terrain.ts:1-30` | ⚠ Terrain.ts:7 calls `stop` a "multiplier", but Engine uses it as a time constant (Engine.ts:1846). `turn` is read nowhere. Engine's `#surfaceP` holds a *material* id, not a `Surface`. |
| **terrain** | ⚠ Today this means only the decorative hill spheres and river boxes (Engine.ts:552-579; BRIEF.md:42-43). From lane E onward (R07) it will mean a real heightfield. Recommendation: rename the old decoration ✅ `#rebuildDecor`. | — | — | — |
| **place / environment** | Where and when the fight happens: a named `Place`, the hour, the day of year, and the derived sun, moons, light and fog. | h, day | `src/graphics/Environment.ts`; Engine.ts:365-409 | *world time* (`#setWorldTime`). |
| **truce / disposition** | The opening of a match, split into two phases: friendly for `friendlySeconds`, then neutral for `neutralSeconds`, then hostile. Nobody can deal damage until the truce ends. | s; 3 + 3 by default | `src/game/Disposition.ts:1-38` | ⚠ The type value is `"enemy"` (Disposition.ts:12), but the label says "HOSTILE" (Disposition.ts:81) and the gate is `isHostile` (Disposition.ts:66). Recommendation: ✅ `hostile`. Engine replaces DEFAULT_TIMING with `roamSeconds/2` for each phase (Engine.ts:709). |
| **roam** | The wander during the truce: a Lissajous path inside `bound`, idle one window in five. | m | `Disposition.ts:85-120`; Engine.ts:996-1013 | — |
| **gravity** | The downward acceleration of every free body. | 24 m/s² | `ArenaPhysics.ts:14` (`ARENA_GRAVITY`) | ⚠ Engine.ts:1694 retypes `24` instead of importing the constant. |

## G. Perception and fog

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **senses** | The five channels through which a fighter perceives (sight, hearing, touch, magnetism, scent). Each has a base range, a falloff, and modifiers from gear and race. | m | `src/game/Senses.ts:16-75` | — |
| **sense range (base / adapted)** | Base: `SENSE_BASE` × gear × race. Adapted: the base further scaled by light, cloud, fatigue and agitation each frame. | m; sight 42, hearing 26, touch 1.1, magnetism 30, scent 18 | `Senses.ts:21-27`; Engine.ts:1122-1127 | ⚠ Engine passes `fatigue = 1 − hp/maxHealth` (Engine.ts:1121). That is *injury*, not fatigue. |
| **lens (lensFactor)** | The direction-dependent scale on a sense range: flat with elevation, stretched forward with agitation. | [0, ~2] | `Senses.ts:77-109` | ⚠ The doc formula leaves out the code's extra `×0.5` on the flare term (Senses.ts:90 vs 107). |
| **agitation** | How fight-focused a fighter is: 0.1 during the truce, 0.8 after. It stretches the lens forward. | [0, 1] | Engine.ts:1118, 1260 | Computed twice with the same literals. ⚠ |
| **perceive / sensed by** | Whether any sense reaches the rival this frame, and which ones. The AI hunts the last perceived position when none do. | — | Engine.ts:1244-1268 | — |
| **fog of war (FogGrid)** | A fighter's personal grid of cells, with two layers: `seen` (ever looked at) and `visible` (looked at this frame). | cell size m | `src/game/FogOfWar.ts:1-29` | — |
| **seen / visible** | `seen` stays set once a cell has been looked at and is drawn dimmed. `visible` is cleared and re-marked every frame. | boolean per cell | `FogOfWar.ts:4-5` | *explored* = the seen fraction (`exploredFraction`). |
| **bearing / compass point** | The direction to the rival, with 0° = north = −z. | deg | Engine.ts:1502-1506 (`bearing`, `compassPoint` from Senses) | — |
| **minimap** | The HUD canvas drawn from the fog grid, the outline and two dots. | 132 px | Engine.ts:1452-1508; BRIEF.md:53 | — |

## H. Character creation

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **race** | A fighter's species (for example human or dwarf). It sets stat modifiers (`mods`), traits, lore and the body build. | enum (id) | `src/game/Races.ts:12-20, 71` | ✅ `race` |
| **subrace** | A variant within a race. It adds a stat `tweak` and its own build. | id or null | `Races.ts:5-10` | ⚠ the code says *subrace* (types, profile), *subspecies* (`RaceDef.subspecies`, Races.ts:16) and *sub-species* (UI, `src/ui/Menu.ts:111`; Engine.ts:605). ⚠ `Subrace.tweak` and `RaceDef.mods` are the same concept under two names. Recommendation: ✅ `subrace`, ✅ `mods`. |
| **ancestry** | The UI section that groups race and subrace. | — | `Menu.ts:110-111`; `UiTree.ts:135` | A UI label only. ✅ Fine as is. |
| **class (ClassName)** | The fighter's discipline: one of eight (Barbarian, Warrior, Rogue, Assassin, Mage, Necromancer, Archer, Priest). It decides the primary stats, the weapon and the three skills. | enum | `Stats.ts:2-9` | ⚠ the UI calls it **calling** (`Menu.ts:121-122`; `UiTree.ts:146-151`), and Stats.ts:22, 45 calls the classes **archetypes**, which collides with the AI `Archetype` (`src/game/Ranking.ts:11`). Recommendation: ✅ `class` (code), "Calling" (UI label), never "archetype" for a class. |
| **primary stats** | vitality, resilience, focus, reflex, strength, intelligence. They shape both the combat stats and the mesh. | points, about 1–10 | `Stats.ts:11-15, 25-34` | Abbreviated VIT/RES/WIL/REF/STR/INT in comments (Physics.ts:241). |
| **secondary stats** | crit, haste, mastery, physResist, magicResist, versatility, derived from subrace and birthsign. | — | `src/game/SecondaryStats.ts:16, 110` | — |
| **birthsign** | The sign the fighter was born under (serpent, mountain, flame, moon, storm, void). It gives stat mods and lore. | id | `src/game/Birthsight.ts:3-44` | ⚠ the file is called *Birthsight*; the UI says *star sign* (`UiTree.ts:131`). Recommendation: ✅ `birthsign`, and rename the file `Birthsign.ts`. |
| **CharacterProfile** | Everything that defines a playable character: name, race, subrace, class, appearance, palette, birthsign, level, allocated points, weapon and equipment. | — | `src/game/Characters.ts:25-37` | — |
| **Profile (player profile)** | A saved player account (Player_ID, character state, keybindings, telemetry) stored in localStorage. | — | `src/game/Profiles.ts:38` | ⚠ not the same as `CharacterProfile` or `AiProfile` (`src/game/AiStats.ts:204`). Three "profiles". |
| **appearance / silhouette / palette** | Visual parameters: colours, height and weight (units unstated, Characters.ts:9-10), hair, and proportions. | — | `Characters.ts:6-23` | — |

## I. AI and ranking

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **decision tree / Decision** | The rule tree mapping a `CombatView` to one of attack, advance, retreat, block, wait or flank. | enum | `src/game/DecisionTree.ts:1-41` | — |
| **CombatView** | What the AI sees each frame: distance, both reaches, both HP ratios, nearEdge, ready, whether the enemy is attacking, both damagePercents, round time. | — | `DecisionTree.ts:3` | Built by hand twice in Engine (Engine.ts:1055-1062 and 1307-1314). ⚠ |
| **brain (Brain)** | The adaptive wrapper around the tree (`tree`, `neural` or `hybrid`), retuned from the win/loss record. | — | `src/game/AiBrain.ts:18, 47` | — |
| **personality** | The brain's seed parameters: engageRange (m), cowardice, aggression, neuralTrust (0–1). | — | `AiBrain.ts:21`; `Ranking.ts:13-23` | — |
| **archetype (AI)** | One of four AI play styles: berserker, tactician, duelist, sentinel. | enum | `Ranking.ts:10-32` | ⚠ clashes with "class archetype" (see H, class). |
| **MMR / Elo** | The ladder rating: start 1000, K = 32, logistic scale 400. | rating | `Ranking.ts:45-57` | *rating*, *ladder*, *leaderboard*, *king* (top entry). ✅ `mmr` |
| **telemetry** | The per-fight samples (distance to enemy, damage dealt, prevented and missed, altitude, x/z, closing speed, technique counts). | — | `AiStats.ts:54-80` | ⚠ also used for the character-creation analytics event (`src/game/CreationTelemetry.ts:17`). |
| **digest** | ⚠ Three meanings: (1) `Telemetry.digest()`, the folded min/max/mean/median of an AI's samples (`AiStats.ts:6, 182`); (2) `CombatLog.digest()`, which returns a `CombatDigest` (`src/game/CombatLog.ts:15`; Engine reads its `firstStrike`, Engine.ts:2341); (3) the **Digest screen**, the History page (`Menu.ts:15`). Recommendation: ✅ `digest` for (1); call (2) `logSummary`; call (3) the "History" screen. |
| **APM** | Actions per minute from input activity. It tightens movement turning. | 1/min | `src/game/InputVector.ts` (`ApmTracker`); Engine.ts:1820-1822 | — |

## J. Records and screens

| Term | Definition | Unit / range | Source | Synonyms / notes |
|---|---|---|---|---|
| **MatchRecord** | One finished duel: id, time, hour, phase, place, arena, reason, duration, first strike, winner, and two `FighterRecord`s. | — | `MatchHistory.ts:22-34` | ⚠ `HistoryFilter.ts:22` declares a second `MatchRecord`, and `HistorySummary` also exists twice (MatchHistory.ts:93, HistoryFilter.ts:61). |
| **end reason** | How a match ended. | enum | — | ⚠ three vocabularies: `WinReason` (ko, ring-out, timed, koth; MatchHistory.ts:6), `EndReason` (ko, endurance, domination, sudden-death; HistoryFilter.ts:37), `WinConditionKind` (ko, sudden-death, first-blood, endurance, domination; WinConditions.ts:8). The live game only produces "ko". |
| **FighterRecord.dealt** | Recorded as the opponent's `maxHealth − hp`. That includes fall, wall and DoT damage. | HP | Engine.ts:2332 | ⚠ the name says "dealt", but the value is the damage the opponent *received*. |
| **screen (Screen / ScreenId)** | title, select (creator), sheet (character sheet), digest (history), victory. | enum | `Menu.ts:15`; `UiTree.ts:20` | *page* is used in comments (Engine.ts:2440 "History page"). |
| **sheet** | The character-sheet screen: stats, weapon, duel history, portrait. | — | Engine.ts:298-308; `Menu.ts:217` | — |
| **HUD** | The in-fight overlay: HP lines, status, weapons, world clock, minimap, compass, skill bar. | — | Engine.ts:786-813 | — |
| **QA / debug view** | Test hooks: freeze, pose pin, axis/orbit cameras, clean capture, skill hold. | — | Engine.ts:2163-2320 | — |

## K. Sign and axis conventions (as found)

| Convention | Value | Source |
|---|---|---|
| World up | +y | Engine.ts:2093 |
| Facing yaw | `rotation.y = atan2(dx, dz)`: yaw 0 faces +z | Engine.ts:1954 |
| Compass north | −z (0°) | Engine.ts:1502 |
| "Right" of a facing f = (fx, fz) | `r = (−fz, fx)` | Engine.ts:1826 |
| Forward key | `Input` returns z = −1 for KeyW; Engine negates it twice (Engine.ts:1819, 1835) | BRIEF.md:37-41 |
| Shoulder angle | negative raises the arm forward/up; a positive amplitude pins it to the +0.6 limit | `Skills.ts:106-112` |
| Left limb root | +x in torso space (`L ? +Rt : −Rt`) | Engine.ts:1619 |
| Damage sign | status `dps` > 0 hurts, < 0 heals (blessed −5) | `Status.ts:20, 37` |
| Edge distance | + inside the ring, − outside | `ArenaPhysics.ts:123-124` |

## L. Recommended canonical words (summary)

| Concept | Use | Avoid in identifiers |
|---|---|---|
| a class move | `skill` | technique, power (except `kind: "power"`) |
| the defensive kind | `defense` | defence |
| class | `class` / `className` | archetype, calling (UI label only) |
| AI play style | `archetype` | personality (that is the parameter set) |
| knockback meter | `knockbackMeter` (was damagePercent) | stamina, damage % |
| kinematic vs mass body | `KinematicBody` / `MassBody` | `Body` for either |
| material plating | `platingFraction` | armour |
| hostile phase | `hostile` | enemy (as a disposition value) |
| subrace | `subrace` | subspecies, sub-species |
| birthsign | `birthsign` | star sign, birthsight |
| max − min | `spread` (MathCore) | — |
| ± relative jitter | `jitter` / `halfRange` | spread |
| inscribed ring radius | `inscribedRadius` | ringHalf, half |
| pickup | `pickup` | drop, orb, power-up, map buff |
| how a match ended | one `EndReason` type | WinReason, WinConditionKind duplicates |
