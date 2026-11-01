# Mytherrania — consolidated specification

Version 3 · 2026-10-10 · supersedes the scattered prompt history as the single source of
truth for WHAT the game is. `DESIGN.md` remains the visual contract; `PHASE1_PLAN.md` the
phase-1 gate list; `artifacts/data-science.md` the measured evidence log.

**How to read this.** Every requirement has an id (`R-…`), a precise definition, its bounds,
the equation that implements it, the file that owns it, and a status:

| Status | Meaning |
| --- | --- |
| **LIVE** | Implemented, unit-tested, *and* observed running in a real browser. |
| **TESTED** | Implemented and unit-tested; not yet observed in the browser. |
| **MODEL** | The pure model exists and is tested, but the engine does not render/use it yet. |
| **OPEN** | Asked for; not built. Listed so it cannot be silently forgotten. |

Numbers in this document come from `docs/SPEC-tables.md`, which is **generated from the code**
by `tools/gen-spec-tables.ts`. Bounds marked `[SPEC Xn]` are pinned by a test of that name
in `tests/spec_test.ts`, so the spec cannot drift from the code without a test failing.

---

## 0. Glossary (controlled vocabulary)

Words below have exactly one meaning in code, tests and docs.

| Term | Definition |
| --- | --- |
| **Fighter** | One combatant: stats + body + weapon + runtime state (`src/game/Fighter.ts`). |
| **Primary attribute** | One of six integer stats: Vitality, Resilience, Willpower, Reflex, Strength, Intelligence. Range 1–20. |
| **Combat stat** | A value *derived* from primaries: maxHealth, attackPower, attackInterval, armor. Never set directly. |
| **Body** | The physical model of a fighter: a list of **parts**, each with mass (kg), volume (m³) and frontal area (m²). |
| **Density ρ** | Total body mass ÷ total body volume, kg/m³. Composite: parts are summed first, then divided. |
| **Toughness T** | How much impulse a body absorbs per unit of damage: `ρ·(0.4+0.6·armour)·√area`. |
| **Impulse J** | Momentum transferred by a collision, N·s: `μ·(1+e)·|Δv|`. |
| **Reduced mass μ** | `m₁m₂/(m₁+m₂)`; equal bodies → m/2; against an immovable wall → m₁. |
| **Physics multiplier** | The bounded factor physics applies to every blow (§3.4). |
| **Disposition** | A fighter's stance toward another: *friendly*, *neutral* or *enemy* (§6.1). |
| **Truce** | The opening window in which no damage can be dealt: friendly + neutral phases. |
| **Ring** | The fighting surface. Has a **shape**, a size, and optionally a **wall**. |
| **Ring-out** | A body leaving the ring outline. **Not** a loss (§5.3). |
| **Elimination** | `hp ≤ 0`. The **only** loss condition. |
| **Sense** | One perception channel with a base range and falloff: sight, hearing, touch, scent, magnetism. |
| **Lens** | The directional shape of a sense's coverage — a polar function, not a sphere (§6.3). |
| **Fog of war** | A per-fighter grid of cells with two layers: *seen* (persistent) and *visible* (this frame). |
| **Status** | A timed condition: stunned, hypnotized, controlled, plus the DoT/buff set in `Status.ts`. |
| **Skill** | One of a class's three named moves: *dash*, *power*, *defense* (§4). |
| **Element** | A skill's damage flavour, which sets its effect colour (§4.3). |
| **Arena parameter** | One entry of `PARAMS` in `ArenaConfig.ts`: key, category, min, default, max, unit. |
| **Forge category** | Grouping of arena parameters, after Halo Forge: space, ground, phases, population, items, hazards, atmosphere. |
| **Scale constants** | `HEALTH_SCALE = 1000`, `FIGHT_LENGTH = 10`, `DAMAGE_SCALE = HEALTH_SCALE / FIGHT_LENGTH = 100`. |

---

## 1. Product scope and invariants

| Id | Requirement | Bound / acceptance | Status |
| --- | --- | --- | --- |
| R-1.1 | Browser 3D cel-shaded action RPG; TypeScript, Deno 2, Three.js with custom GLSL. | Runs from `deno task dev` at `http://127.0.0.1:8788/`. | LIVE |
| R-1.2 | **Zero runtime dependencies.** No CDN, no network at runtime; Three.js bundled locally. | `dist/app.js` self-contained; build ≈ 0.72 MB (719,028 B). | LIVE |
| R-1.3 | **Gall's Law.** Each layer added only on a working layer below it. | No subsystem lands without a passing gate (§10). | process |
| R-1.4 | **Zero dead code.** Every exported module has a runtime caller. | Each `src/game/*.ts` reached from `Engine.ts` or a tool; checked §10.3. | LIVE (see §10.3) |
| R-1.5 | **Physical keys.** Input via `KeyboardEvent.code`, so AZERTY works without remapping. | `KeyW` = AZERTY `Z` (forward); `KeyA` = AZERTY `Q` (left). | LIVE |
| R-1.6 | **Frame budget.** | ≤ 16.6 ms per frame (60 FPS). Last measured: day 1.60 ms, night 1.01 ms CPU submission. | LIVE (CPU only; GPU time not separated) |
| R-1.7 | **Honest evidence.** No invented perf, coverage or balance numbers. | Every number traces to a tool output or generated table. | process |

**Deferred, not stubbed** (from the original brief — kept on record, none implemented):
networking (WebSocket/WebRTC rooms, authority reconciliation), the 12 biome island paths with
2-border blend zones, Maslow utility AI with speech bubbles, metroidvania locks/keys and item
provenance, radial wheel + Diablo grid inventory + map pen, swimming/buoyancy, wind flame spread.
Status of all: **OPEN**.

---

## 2. Character model

### 2.1 Primary attributes

| Attribute | Drives |
| --- | --- |
| Vitality | maxHealth (+1.7 base units/pt, ×1000), body mass (+1.4 kg/pt). |
| Resilience | armor (+0.32/pt), crit defence, body mass (+1.1 kg/pt). |
| Willpower | damage solve for casters (through the power index), status resistance (not yet). |
| Reflex | attackInterval (−0.046 s/pt), crit chance, limb area. |
| Strength | maxHealth (+0.55 base units/pt), body mass (+3.5 kg/pt) **and** volume (+0.0016 m³/pt), torso area. |
| Intelligence | damage solve for casters (through the power index). |

### 2.2 Derived combat stats (`src/game/Stats.ts`)

```
maxHealth      = clamp(33 + 1.7·VIT + 0.55·STR, 34, 58) · HEALTH_SCALE
attackInterval = clamp(1.33 − 0.046·REF, 0.85, 1.35)                        seconds
armor          = clamp(2.2 + 0.32·RES, 2, 6.5)
CriticalChance = clamp( 0.008·REF / (0.010·RES_target + 0.1), 0.03, 0.15 )   [as implemented]
```

**Brief formulas vs implementation** (kept verbatim, not silently replaced):

| Brief (verbatim) | Implemented | Why it differs |
| --- | --- | --- |
| `MaxHealth = Vitality·10 + Strength·2 − Fatigue` | the clamped linear form above, ×1000; no Fatigue term | with the brief's slopes HP spread was too wide to balance; fatigue lives in the senses (§6.3), not HP. **Status: brief formula NOT implemented.** |
| `CriticalChance = (Reflex·0.015)/(TargetResilience·0.005)` | `0.008·REF/(0.010·RES+0.1)`, clamped 3–15% | the brief's ratio exceeds 100% for REF ≥ RES/3 (e.g. REF 9 vs RES 4 → 675%). The +0.1 bounds the denominator. **Status: brief formula NOT implemented as written.** |

**Damage per hit — the ONE model, used by both the live engine and the harness**
(`Stats.attackDamage` → `Engine.#resolveHit`, `ArenaHarness.simulate`):

```
base   = attackPower · crit · (1 + 0.35·(2·roll − 1)) / (1 + 0.04·armor_d)     crit ∈ {1, 1.4}
damage = base · skillMul · statusAttackMul · physicsMul(§3.4) · (blocking ? 0.4 : 1)
cooldown between swings = attackInterval · stanceMul / statusAttackMul
```

v2.1 fix: the engine previously used `weapon.damage` (7–17 per hit) against ~48 000 HP, so the
balanced class model existed only in the harness. Weapons now shape reach and knockback only.

**Damage solve.** Every class is solved to the same *power index* `I = (attackPower /
attackInterval) · maxHealth · (1 + 0.04·armor)`, then adjusted for two edges it would
otherwise carry for free:

```
raw          = I_target · POWER_SCALE · attackInterval / EHP
attackPower  = raw / (1 + E[crit]·(CRIT_MULT − 1)) / edge_phys · (1 + calibration)
edge_phys    = physicsMul(body → avgBody) / physicsMul(avgBody → body)
clamped to   [5, 14] · DAMAGE_SCALE
```

`edge_phys` is new in v2: physics (§3) makes heavy bodies hit harder *and* take less, and
without pricing that in, the Barbarian won 99.7% of the field (measured, see §9).

**Design band** `[SPEC H2]`: every class needs 25–90 average hits to kill any other class.

### 2.3 Classes (verbatim list)

"Barbarian, Warrior, Rogue, Assassin, Mage, Necromancer, Archer, Priest". Per-class primaries,
HP, damage, mass, density and toughness: **table T1** in `docs/SPEC-tables.md`.

### 2.4 Races, subraces, birthsigns, leveling

Additive deltas on primaries (`Races.ts`, `applyRaceBonus`), so a race shifts a class rather
than replacing it. Table **T3** lists every race × subrace applied to a Warrior. Leveling
(`Leveling.ts`) grants talent points from secondary-stat milestones and rescales combat stats
with the same `HEALTH_SCALE`/`DAMAGE_SCALE`. Status: TESTED (no stat-allocation UI — OPEN).

### 2.5 Race and sub-species appearance (`RaceAppearance.ts`)

Ancestry drives the **3D build**, not just the palette: height/weight multipliers, hair length
tier, permitted haircut styles, whether facial hair grows, the ork underbite depth and the ear
length multiplier. `raceBuild(race, subrace)` layers the sub-species tweak on the race base;
`seededPick` makes a character's style reproducible.

| Race | height× | weight× | hair | beard | underbite | ears× |
| --- | --- | --- | --- | --- | --- | --- |
| human | 1.00 | 1.00 | medium | yes (per-char) | 0 | 1.0 |
| elf | 1.04 | 0.88 | verylong | no | 0 | 1.9 |
| dwarf | 0.82 | 1.35 | long | **yes (always)** | 0.05 | 0.9 |
| ork | 1.12 | 1.55 | short | no | **0.35** | 0.8 |

Hair length in metres: `bald 0 / short 0.08 / medium 0.22 / long 0.48 / verylong 0.72`.
Expanded palette: `HAIR_COLORS` (10) and `SKIN_TONES` (10). The rig applies `heightMul`/
`weightMul` on top of the per-character height/weight, grows the hair fall, the beard, the
tusks and the ears. `[SPEC R1]` ork underbite > 0 and elf ears > human ears; hair length is
monotonic across tiers. Status: LIVE (elf long hair to mid-back and ork tusks observed).

### 2.6 Secondary stats (`SecondaryStats.ts`)

Race → primary bonus; sub-species → secondary (crit, haste, mastery, physResist, magicResist,
versatility); birthsign stacks additively on top. `combineSecondary` sums the layers and
`secondaryPreview` returns labelled delta rows for the creator's birthsign preview.
`[SPEC SS1]` stacking is additive (wood +0.02 + serpent +0.02 → 0.04).

**The bridge to combat (`applySecondary`).** The secondary stats are no longer preview-only:
`applySecondary(stats, subrace, birthsign)` folds them into the combat stats the fight runs on,
with the conversion constants in `SECONDARY_BRIDGE`:

| Secondary | Combat effect |
| --- | --- |
| mastery, versatility | `attackPower × (1 + mastery + 0.5·versatility)` |
| haste | `attackInterval × (1 − haste)`, floored at 0.25 s |
| physResist, magicResist | `armor += (phys + 0.5·magic) × 40` (one damage channel, so magic counts half) |
| crit | `reflex += crit × 12.5`, and reflex is what `criticalChance` reads |

`applySecondary` is called in `createFighter`, so every live fighter carries its ancestry into
the damage, speed and crit equations; `ArenaHarness` prices in a representative pair so the
harness and the live build run the same game. `[SPEC SS2]` a buffed fighter has strictly more
attack power, armour and crit chance, and no ancestry is a true no-op. Status: LIVE.

---

## 3. Physics (`src/game/Physics.ts`, `src/physics/SmashPhysics.ts`, `src/game/Ragdoll.ts`)

### 3.1 Composite bodies

```
m_total = Σ mᵢ        V_total = Σ Vᵢ        A_total = Σ Aᵢ
ρ       = m_total / V_total                       (composite density)
```

Adding a dense part (a steel plate) raises the whole body's density; a hollow part lowers it.

**Body from stats** (`bodyFromStats`), shared by engine, harness and tests:

```
mass   = 42 + 3.5·STR + 1.4·VIT + 1.1·RES          kg
volume = 0.055 + 0.0016·STR                        m³
torso  = 62% of mass and volume, area 0.22 + 0.006·STR
limbs  = 38% of mass and volume, area 0.15 + 0.004·REF
armour = min(1, armor / 8),  restitution e = 0.24
```

Bound `[SPEC P1]`: Strength raises density, not only mass (mass grows 3.5 kg/pt; volume only
1.6 L/pt). `[SPEC P3]`: the Barbarian is the heaviest class; at least 6 of 8 bodies distinct.

### 3.2 Collisions (`resolveImpact`)

```
μ = m₁m₂/(m₁+m₂)        J = μ·(1+e)·max(0, v_a − v_d)      e = max(e_a, e_d)
T = ρ·(0.4+0.6·armour)·√A                                  damage = IMPACT_K · J / T,  IMPACT_K = 1.15
```

Live use: `#resolveHit` takes **J** for the hit-response on the skeleton (§3.7), with a swing
speed `v = max(3, v_close + 3) · knockbackMul` m/s. HP damage itself comes from §2.2 × §3.4.

### 3.3 Walls (`hitWall`, driven by `ArenaPhysics.stepArenaBody`)

```
J_wall    = m · |v_out|                          (no (1+e): the wall is the immovable partner)
effective = R · integrity                         R = wallResistance N·s, integrity ∈ [0,1]
breached  ⇔ J_wall > 1.05 · effective
held:     body clamped to 0.98·R(θ), radial velocity ← −e_wall · |v_out|
          self-damage = 0.05 · (effective − J_wall) / T  (×DAMAGE_SCALE in HP), stun with 1 wall bounce
breached: integrity −= (J_wall − effective)/R, body keeps max(0.15, 1 − effective/J_wall) of its speed
```

`wallHeight` is used for **contact** (a body above it passes over), not in `effective`.
Status: **LIVE** — walls are built from the shaped outline and collide (see §5.3 evidence).

### 3.4 Physics damage multiplier (applied to every blow)

```
physicsMul = clamp( (0.55 + 0.30·(m_a/m_d) + 0.25·(ρ_a/ρ_d)) · closing , 0.6, 1.8 )
closing    = 0.85 + 0.15·min(2, v_close)
v_close    = max(0, (v_a − v_d) · n̂)          n̂ = unit vector attacker → defender
```

`v_a`, `v_d` are **measured** ground velocities (position change per frame, smoothed over
τ = 0.1 s) — not `body.vx`, which carries only knockback. So a fast attacker raises the blow,
a defender **fleeing** lowers it, and a slow or stepping-in defender keeps it high: that is
"fastest onto slowest" as an equation. `[SPEC P5]` pins the relative-velocity cases.

`[SPEC P2]`: equal bodies at rest give exactly **0.935**; every class pair at every speed stays
inside [0.6, 1.8]. `[SPEC P4]`: closing speed only raises it, saturating at 2 m/s.
Matrix of all 64 class pairs: **table T2**.

### 3.5 Stun (verbatim formula, unit-corrected)

```
Stun_total = (Damage × Force_impact) × 1.5^WallBounce          [verbatim brief]
implemented: stunDuration(dmg / DAMAGE_SCALE, 1.2, bounces) = d·F·1.5^b·0.01   seconds
```

`[SPEC H1]` — **v2 fix.** Damage is divided back to the brief's original units before entering
the formula. Without this, the ×1000 health change made each hit stun for ~10 s. A normal hit
now stuns 0.10–0.14 s (table T1 column "Stun/hit").

### 3.6 Falls and ragdoll

```
fallDamage = IMPACT_K · m·v² / (2·T)
```

A ragdoll is Verlet-integrated, dt clamped to 1/30 s, ground contact kills normal velocity, and
it is judged settled when the body centre drifts < 0.3 mm/step. Status: **LIVE** (forced via
`debugWorld({ragdoll})` in `tools/probe-world.ts`: appeared, settled, cleared).

### 3.7 Physics influence on body points — OPEN

The user asked that physics move the skeleton's points more. Today physics moves the *body*
(knockback, wall rebound, ragdoll); skill animation is still kinematic (§4.2). Driving joint
angles from impulse (`Δθ ∝ J / I_joint`) is not built.

---

## 4. Skills, animation and weapons

### 4.1 Skills (`src/game/Skills.ts`, `SkillRuntime.ts`)

24 skills = 8 classes × {dash, power, defense}. Each has an element and a payload:
`damageMul, stun, knockbackMul, lifesteal, armorMul, speedMul, attackIntervalMul`. Full list
with numbers: **table T4**. Keys: `1/2/3` or `Q/E/F` (physical codes). Status: LIVE.

Skills are fixed per class — **player selection of skills is OPEN.**

### 4.2 Procedural animation (`AnimationCurve.ts`)

```
angle(t) = rest + A·impulse(t, peak) + w·dampedSin(t, f, ζ)       clamped to joint limits
impulse  = sin rise to the peak, cos fall after it (continuous at the peak, asymmetric)
```

Bounds: dash travel ≥ 40°, power travel ≥ 74°; `shoulderR` limit +0.6 rad (negative raises the
arm). Tested per joint.

#### 4.2.1 Stance transitions (`StanceAnim.ts`)

Stance changes are **keyframed sub-animations**, not instantaneous snaps. Each transition is a
table of joints with `{start, peak, end}` keys; `keyAngle(key, t)` interpolates with sin/cos
easing so the motion is **continuous at the peak** and has **zero velocity at both ends**. Chains
are coherent: one move's end pose is the next move's start pose.

| Property | Bound |
| --- | --- |
| `keyAngle(key, 0)` | 0 (start) |
| `keyAngle(key, 0.5)` | 1 (peak) |
| `keyAngle(key, 1)` | 0.5 (end, blended toward the next stance) |

`[SPEC AN1]` `findTransition(a, b)` returns a playable chain or null; `StanceAnimator.update`
returns the **final pose on the completing frame** (never null mid-chain). Status: LIVE.

#### 4.2.2 Grip, palm and hand constraints (`PalmWeapon.ts`)

The **palm decides the weapon**: the blade's tip axis *is* the palm normal `N_palm`, so a palm
facing up holds the blade vertical and a tilted palm tilts it.

| Rule | Definition |
| --- | --- |
| Rest | `pitch = atan2(0, 1) = 0` → blade vertical (+Z) |
| Thrust | blade aligned to the character's forward vector `V_forward` (measured pitch −1.345 rad) |
| Guard | blade near-vertical, ~80–90° to the ground, held for the defense skill's duration |
| Swing | arc alternates between horizontal / diagonal / vertical planes (measured pitch −0.836 rad) |

Two-point IK solves the elbow (`solveElbow`) and the arm chain (`armChainPose`); link lengths
`ARM_LINK = { shoulderToElbow: 0.46, elbowToWrist: 0.40, wristToPalm: 0.12 }`. The fist closure
follows the grip tangent. Status: LIVE (grip pitch alternates −1.345 / −0.836 / −0.35 in probe).

#### 4.2.3 Facial morph loop (`FaceMorph.ts`)

Eyebrows, eyelids and mouth deform through the combat states so the face reacts when a fighter
**hits or gets hit**. `FaceMorph` blends toward a per-state target pose with a time constant, so
the loop is smooth rather than a snap.

| State | Face |
| --- | --- |
| idle | neutral |
| attack | brows down, eyes narrowed, mouth open (exertion) |
| hit | brows up, eyes wide, mouth wide (pain) |
| block | brows down, eyes squinted, mouth closed (effort) |
| ko | brows up, eyes closed, mouth slack |

`[SPEC F1]` every pose is clamped to its limit and blend is continuous; driven from `#updatePose`
so the face follows the parent animation. Status: LIVE.

#### 4.2.4 Animation tensor bounds (`AnimTensor.ts`)

Every class power's animation envelope is inspectable and bounded on the sin/cos/tan axes, so the
swing is a described curve rather than free-form motion. `powerTensor`, `classTensors`,
`allTensors` report, per power: the prime joint, the max/min angle reached, and the sin/cos/tan
extremes over the animation span.

`[SPEC T1]` every power sweeps a meaningful arc and its prime joint is the weapon arm or the
spine; no tensor value is NaN or unbounded. Status: LIVE.

### 4.3 Elements and effect strength

| Element | Colour |
| --- | --- |
| fire / fury | orange |
| arcane | cyan |
| holy | gold |
| shadow | violet |
| wind | white-blue |
| poison | green |
| necrotic | lime |

Effect strength scales with the % of the target's HP the hit removes (3.6% → 0.16,
17.1% → 0.86). The effect shell wraps striking parts only (blade, head), never bow limbs.

### 4.4 Weapon generator (`WeaponGen.ts`)

Parameters shaft, blade, curve, weight, metal. Metals: steel (grey), iron (dark grey), bronze,
gold, silver. Status: LIVE. **Known gap:** the Archer's bow does not read at QA distance.

---

## 5. Arena

### 5.1 Parameters (`src/game/ArenaConfig.ts`)

All parameters, bounds, defaults and units are listed by forge category in **table T5**
(generated). Key bounds changed in v2:

| Key | Min | Max | Note |
| --- | --- | --- | --- |
| `size` | 2 m (the 2 m² room) | **320 m** | was 40; user asked for "way larger" |
| `wallChance` | 0 | 1 | random generator uses **0.9** |
| `wallResistance` | 100 | 20 000 N·s | default 2200; random 900–9000 |
| `wallHeight`, `wallBounce` | — | — | feed §3.3 |

`makeArena(over)` clamps every value into its range. Random generation is seeded.

### 5.2 Ring shapes

circle, triangle, square, pentagon, hexagon, octagon, oval, diamond. Inside test:

```
polygon (n sides): r(θ) = apothem / cos(((θ mod 2π/n) − π/n))
oval:              polar ellipse
diamond:           |x| + |z| ≤ R  (taxicab)
```

Status: **LIVE** — the engine builds the shaped ring floor and, on 90% of arenas, a wall of
segmented meshes with its own resistance; ring-outs are resolved against the real outline.

### 5.3 Victory conditions

| Condition | Ends the fight? |
| --- | --- |
| `hp ≤ 0` (death) | **Yes — the only ending implemented.** |
| Ring-out | No. The body takes fall damage and is returned inside the ring. |
| Timer / hill / score | No. Display only. |

Status: **LIVE** — `tools/probe-ko.ts`: `winCondition: ko`, 0 non-death endings, ring-outs
observed with the fight continuing.

**Variety is OPEN.** The prompt asks for *several* win conditions (only one need trigger per
fight) tracked per match so the neural models see variation. None beyond death is implemented;
the removed `timed`/`koth` branches are gone rather than parked, so this is a real gap.

### 5.4 Glider, outside ground, props — MODEL / OPEN

Glider (speed, sink, updraft, fuel, pads) and placeable props are modelled and clamped. No
glider input binding and no colliding outside-ground mesh yet.

---

## 6. AI and perception

### 6.1 Disposition and truce (`Disposition.ts`)

| Phase | Time from fight start | Ring colour | May attack? |
| --- | --- | --- | --- |
| friendly | 0 – 3 s | green | no |
| neutral | 3 – 6 s | amber | no |
| enemy | ≥ 6 s | red | yes |

`[SPEC D1]` truce = exactly 6 s. Damage is gated in **one place** (`#resolveHit`), and the truce
has its own clock (`#sinceStart`) that does not pause with the match timer. During the truce,
bots roam a seeded Lissajous path. Status: LIVE (no damage before 6 s; first damage ≈ 7.3 s).

### 6.2 Identity

Generated name + unique id per fighter, e.g. `MY-786218 Halric of Low Water`. No duplicates in
a roster. Status: LIVE.

### 6.2.1 Adaptive AI profiles and brains (`AiStats.ts`, `AiBrain.ts`)

Each AI is a **named profile** with a career record and a `Brain`. The brain owns the decision
thresholds (when to close, retreat, spend a skill, guard) and **retunes them from its own
win/loss record**, so two bots of the same class diverge by experience. Four archetypes —
**berserker, tactician, duelist, sentinel** — rotate onto bots, so personalities differ beyond
class stats.

Action dispatch is a **data table** (`ACTIONS` + `executeAction` field-presence lookup), not an
if/else chain, in keeping with the else-reduction rule. `[SPEC AI1]` a brain's thresholds move
after a recorded match, and the direction follows the outcome (win → more aggressive).
Status: LIVE (`P brain: true O brain: true`; thresholds shift across matches).

### 6.2.2 Per-fight telemetry and digests (`AiStats.ts`)

Every fight records, per fighter, the statistics the prompt asked for, and folds them into the
career record as **min / max / average / median** digests:

| Family | Samples |
| --- | --- |
| Movement | distance travelled; average distance to the enemy |
| Damage | dealt, prevented, missed (min/max/avg/median) |
| Techniques | per-technique share of damage dealt (%) |
| Space | altitude and x, y, z samples |
| Thresholds | crossings at 80% / 50% / 20% HP and right before the last hit |

`[SPEC AI2]` every digest is finite and the median of a constant series equals that constant.
Status: LIVE (e.g. Yorick travelled 333 m, Tova 275 m, dealt max 1786, prevented avg 386).

### 6.2.3 Instant battle corpus and ranking (`Ranking.ts`, `tools/battle-corpus.ts`)

`tools/battle-corpus.ts` runs **instant headless battles** across class × race × weapon × arena
diameter with fluctuating probabilities, so the system is pushed onto new AI/parameter
combinations without playing them visually; results land in `artifacts/battle-corpus.json`.
Ranking is **Elo**: `expected = 1/(1 + 10^((rb − ra)/400))`, **K = 32**, start 1000; the
`Leaderboard` crowns a **king** at rank 1. `[SPEC AI3]` an upset moves more MMR than an expected
win. Status: LIVE in the leaderboard; **the corpus is not yet fed to `NeuralTrainer`** (OPEN).

### 6.3 Senses (`Senses.ts`)

| Sense | Base m | Falloff exponent |
| --- | --- | --- |
| sight | 42 | 1.0 |
| hearing | 26 | 1.35 |
| touch | 1.1 | 3.0 |
| scent | 18 | 1.6 |
| magnetism | 30 | 1.2 |

**Lens.** Coverage is a polar shape, not a sphere: the range at bearing θ is modulated by
sin/cos/tan terms (forward-biased sight, omnidirectional hearing). Helmets cut hearing.

**Adaptation** to light, cloud, weather, fatigue and agitation. Night collapses sight and makes
hearing dominant; rain masks sound; adrenaline sharpens touch; sight never reaches 0.
Adapted ranges by light level: **table T6**. `[SPEC S1]`: night sight < ½ day sight; night
hearing > day hearing.

### 6.4 Luminosity — v2, new coupling

```
L = clamp( 0.04 + 0.96·smoothstep(−0.105, 0.35, elevation_rad), 0, 1 ) · (1 − 0.45·cloud)
```

−0.105 rad ≈ −6° (civil twilight); 0.35 rad ≈ 20° (daylight saturates); 0.04 is the starlight
floor. **Replaces** an ad-hoc engine formula that left sight pinned at its night floor through
most of a real afternoon. `[SPEC L1]` monotonic and bounded; `[SPEC L2]` overcast keeps 55%.
Table **T7**.

### 6.5 Fog of war (`FogOfWar.ts`)

Per-fighter grid, 0.5 m cells. Each frame, *visible* is cleared and re-revealed through the
sense lens; *seen* persists. Status: **LIVE** (explored fraction rises 0.896 → 1.0 in a match).
The **minimap is LIVE**: a 132 px HUD canvas drawn from the viewed fighter's own grid (black =
never seen, dim grey = seen, lit sand = visible) plus a compass bearing to the rival.

**Sense-gated engagement.** A bot engages the rival only when a sense reaches it
(`#sensesReaching`, ranked strongest first); otherwise it hunts toward `#lastSeen`. The snapshot
exposes `perceivesBy` per fighter. Status: LIVE.

### 6.6 Statuses (`Status.ts`)

Stunned, hypnotized, controlled, plus DoT and buff statuses; each has a duration, speed/attack
multipliers and what clears it. **Table T8.** Status: LIVE (stun observed in-browser,
`stunned 0.5s`).

### 6.7 Items and distraction (`Items.ts`)

Coins: a big, low yellow cylinder that pops above ground and falls under `coinGravity`.
When one lands within a fighter's senses, it may break off the fight to collect it — rarely,
weighted by `coinGreed`. Status: LIVE (forced coin spawned and was collected).

---

## 7. Environment

Sun and moon positions from date, hour and place (`Environment.ts`); day phases
night (< −6°), dawn/dusk (< 8°), day. Shadows from a clamp-free light height. Status: LIVE.
**Known gap:** low-sun shadow length is not verified visually.

---

## 8. Interface

Creator, character sheet, History page, settings dialog, skill bar with generated icons.

| Element | Definition | Status |
| --- | --- | --- |
| Selection pick-tables | Class and weapon are chosen from row tables showing each class's **three skills**, replacing the old dropdowns | LIVE |
| Race hero box | Centred ancestry panel with two columns (primary / secondary), sub-species **nested under the parent race**, and a birthsign delta preview with +/-/0 rows | LIVE |
| Player profiles | `Player_ID` profiles persisted across reload (`ProfileRepo`), with keybindings and telemetry; a title-screen picker loads a saved character | LIVE (keybindings stored but **not applied** — OPEN) |
| Leaderboard | History page ranks the AI by Elo MMR, crowns the king, and opens a floating per-AI profile card (rank, MMR, peak, W–L, win rate, archetype, style) | LIVE |
| Minimap | 132 px HUD canvas from the fighter's own fog grid + compass | LIVE |
| Responsive layout | Four breakpoints (≤767 mobile, 768–1023 tablet, 1024 laptop, 1440 desktop) plus a portrait rule; fluid menu root `max-width: min(880px, 97vw)`, no fixed border | LIVE (verified at 390/820/1280/1920) |
| Settings dialog | Native dialog with internal scroll; reachable at every breakpoint | LIVE |

**Input model.** `analogVector` blends keyboard and controller stick (stick wins past the
dead zone, sub-dead-zone falls back to keyboard); `toCameraSpace` rotates the vector by the live
`#orbitYaw`, so movement is genuinely camera-relative; `ApmTracker` + `turnScale` tighten the
turn rate with input rate. Status: TESTED (controller not verified on hardware — OPEN).

**OPEN** from the prompts: stat-allocation UI; player skill selection; keybinding rebind UI.

---

## 9. Balance

**Harness** (`src/balance/ArenaHarness.ts`): per-fighter RNG streams, decisive-only win rate,
10 000-fight capability, seeded. **v2:** the harness now applies the same physics multiplier
as the live game — before this, it reported on a different game from the one being played.

**Targets:** mirror matchups 50% ± 2; cross-class pairs 48–52%.

**Measured (seed 20261009, decisive-only):**

| Stage | Barbarian field share | Balanced pairs (48–52%) |
| --- | --- | --- |
| Physics added to harness, not priced in | 99.7% | 1 / 28 |
| `edge_phys` priced into the damage solve | 39.3% | 5 / 28 |
| Tuner, buggy (raw 5–14 clamp; compounding calibration) | 70.5% | 2 / 28 |
| **Tuner fixed, calibration ±1.6%** | **49.6%** | **15 / 28** (4000/pair); 17 / 28 (2000/pair) |

Final per-class field share: **49.4–50.6%** for all eight classes (target 50 ± 2: **met**).
Mirror matchups 48.7–51.1%. Individual cross-class pairs span **44–56%**: 13 of 28 still
sit outside the 48–52% band. **SC-002 pairwise target: not met** — per-class parity is, but
one damage scalar per class cannot fix 28 pairs at once (that needs per-matchup terms).

**Reading T9.** The power index (DPS × EHP) is no longer equal across classes, by design:
it ranges 0.79 (Barbarian) – 1.15 (Necromancer) because heavy classes receive less damage
*per stat* — their bodies win the physics. Win share, not the index, is the parity measure.

---

## 10. Verification

### 10.1 Gate (every change)

`deno task check` (0 errors) · `deno task test` (all pass) · `deno task lint` · `deno task build` ·
`deno run -A tools/dead-exports.ts` (0 dead functions / test-only / constants).

Last gate: **0 type errors · 340 tests, 0 failed · lint clean 161 files · build 733,539 B · 0 dead.**

### 10.2 Browser probes

| Tool | Proves |
| --- | --- |
| `tools/probe-truce.ts` | truce timing and first damage |
| `tools/probe-ko.ts` | death is the only ending |
| `tools/probe-world.ts` | senses, fog, statuses, ragdoll, items are live |
| `tools/qa-skills.ts`, `qa-axis.ts`, `qa-matrix.ts` | visual coverage |
| `tools/frame-budget.ts` | ≤ 16.6 ms |

### 10.3 Zero-dead-code audit (v2)

Before v2, five modules had **no runtime caller**: Items, Status, Ragdoll, FogOfWar, Senses.
They are now driven once per frame by `Engine.#tickWorld` and exposed in `snapshot().world2`.

### 10.4 Review rule

Every gate is signed by at least two independent reviewers answering WHO / WHAT / WHERE /
WHEN / WHY / HOW. Reviewers are read-only; the orchestrator does all writes.

---

## 11. Rig, camera and physical animation

### 11.1 Spine curve (`SpineCurve.ts`)

The back is **33 vertebrae** in four anatomical curves, so it reads correctly from the side
(the "dig the back with a spine made of 33 aligned points" requirement):

| Segment | Vertebrae | Curve |
| --- | --- | --- |
| cervical | C1–C7 (7) | lordosis (neck bows forward) |
| thoracic | T1–T12 (12) | kyphosis (upper back bows back) |
| lumbar | L1–L5 (5) | lordosis (lower back bows forward) |
| sacral | S1–S5 (5) | fused, slight kyphosis |

Adjacent segments meet at **zero offset** (the half-sine arch is zero at both ends), so the
column is a smooth S-curve with no kinks. `spineOffset(t)`, `spineColumn()`, `smoothSpine()`
expose it; the rig bows the torso and places a ridge of segments on the curve. `[SPEC SP1]`
33 points, offsets finite, adjacent curves meet at 0. Status: LIVE.

### 11.2 Balance plates and recovery (`BalancePlates.ts`)

Three mass-weighted force plates — **feet 0.2 / pelvis 0.5 / shoulder 0.3** — give a centre of
pressure and a support radius. Instability maps to a stance:
`standing → staggered → kneeling → fallen` at `STANCE_THRESHOLD`. Ground slope **shrinks the
support radius**; it does not offset the balance point (planted feet do not slide).

Post-impact the body sways back toward balance along the lateral axis with a damped sinusoid,
`Pos(t) = A·e^(−γt)·sin(ωt + φ) + Pos_balance`, where the amplitude `A`, decay `γ` and the
recovery speed come from weight, strength, power, HP %, stamina %, armour mass, the critical
multiplier and the impact vector. If the lateral offset exceeds the support polygon the body
transitions to stagger or knock-down. Status: LIVE (`rig.group.rotation.z = balTilt · 0.6`).

### 11.3 Camera occlusion (`#updateOcclusion`)

A continuous corridor is tested between the third-person camera and the viewed character; any
wall inside it fades out with **per-mesh eased alpha**, so the character is never hidden by
geometry. The alpha follows
`α_target = clamp((d_object − d_min)/(d_max − d_min), 0, 1)`.

Implemented as a **2D corridor test, not a `THREE.Raycaster`** (the unused raycaster field was
deleted). Status: LIVE.

### 11.4 Rig topology and hands

Every body part is a **lofted surface**, not a primitive (`graphics/Loft.ts` +
`graphics/BodySurface.ts`): a superellipse section modulated by directional muscle lobes,
tapered along the part, pinched at a waist, dome-capped at both ends, and blended into its
neighbours by a connector loft. The proportions come from `RaceSilhouette`
(`game/BodyProfile.ts`); the maths lives in `game/ShapeEquations.ts`.

| Property | Bound |
| --- | --- |
| Section exponent `n` | 1.75 – 2.45 (organic: never a circle, never a square) |
| Sharpest turn in a section | < 0.6 rad (a right angle is 1.571) |
| End caps | domed, never a flat disc |
| Part joins | connector loft on a smoothstep (matched tangents) |
| Rig scale | `height / (legDrop + crownRise)`, so the sole lands on the ground |

`[SPEC B1]` no part is a primitive and no section corners; `[SPEC B2]` the state x joint
scale table is complete (9 states x 16 joints) and a braced state articulates less;
`[SPEC B3]` a random silhouette stays inside its race's band and still scores; `[SPEC B4]`
the elf is the narrowest body and the ork the widest. Two-handed weapons and
hand-separation clamps are **OPEN**.

### 11.5 Menu expansion

Menu windows grew to the full parameter set: fluid root `min(880px, 97vw)`, internal scroll, and
per-breakpoint sizing, so the creator, race hero, leaderboard and settings all fit without
clipping at 390–1920 px. Status: LIVE (vision-verified at 390 px and 900 px).

---

## 11A. Wave H — ancestry hierarchy, hair physics, match telemetry, corpus data science

Added 2026-10-31. The prompt asked for a hierarchy over every subrace with body-part ratios, a
per-ancestry look (skin creases, hair, brows, beards, tusks, ears, skull), hair that reacts to
weather and strikes with mass bound to length and curl, generations logged so the trainers learn
from played matches, a 3-minute match limit that ends as a tie with the stat difference recorded,
History highlights (fastest match, biggest discrepancy), a generated spectator match with a stat
point budget and techniques that follow the stats, and a bounded data-science pass over the corpus.

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| HA1 | 16 ancestry nodes (4 races + their 12 subraces); all 13 metrics ranked; the four races strictly ordered 1..4 per metric | `artifacts/design/ancestry.json`, `src/game/Ancestry.ts` | LIVE |
| HA2 | The look follows the hierarchy: elf never bald, ork baldest, dwarf always bearded, ork chin-only with two up tusks, elf a thin moustache only, dwarf biggest brows, elf brow tips past the face, heavier dwarf/ork skulls | `Ancestry.ts` + `src/graphics/Humanoid.ts` | LIVE |
| HA3 | Hair/beard/brow secondary motion: a damped spring whose mass comes from the level's length and curl; wind from the climate, impulse from the head's own velocity; behind 200 sub-steps so a stalled frame cannot explode it | `src/game/anim/SecondaryMotion.ts` | LIVE |
| HD1 | A hard match limit (default 180 s, clamped [30, 240]); at the limit nobody wins — the verdict is `time-limit` with `winner: null`; a KO outranks the clock | `src/game/MatchControl.ts`, `WinConditions.ts`, `Engine.#checkElimination` | LIVE |
| HD2 | Every record carries `limitS`, `tie`, a `StatGap` (per-stat raw difference, pooled-sd z, Euclidean distance, damage share, dominance in [0,1]) and a `GenerationBlock` | `src/game/MatchHistory.ts`, `Engine.#recordMatch` | LIVE |
| HD3 | The History page and the record layer agree on the fastest decided match and the widest gap (two implementations, one contract) | `src/ui/HistoryView.ts` vs `MatchHistory.highlights` | LIVE |
| HE1 | A spectated match is generated: random levels, a stat point budget spent by role, techniques that follow the spent stats, an arena size — all from one seed | `src/game/SpectateGen.ts`, `Engine.onSpectate` | LIVE |
| HF1 | The corpus compresses to six key variables, standardises NaN-free, measures spread (p20/median/p80), flags special games on both a plain and a robust (median+MAD) z, and runs PCA; 5 000 records in ~36 ms | `src/balance/CorpusMath.ts`, `tools/data-science.ts` | LIVE |
| HX1 | A generated budget cannot leave the balance window: `statDelta` + the `applyRaceBonus` clamps bound every generated fighter | `Engine.#applySpend` | LIVE |

**Equations.**

- Hair mass: `Hairstep x″ = −(k/m)·x − (c/m)·x′ + F/m`, with `F = windGain · wind_body · (1 − 0.7·wetness)`
  and `m` from the ancestry's `hairPhysics.massKg`, which rises with length and curl. Semi-implicit
  integration at a 1/200 s sub-step; `dt` clamped to `MAX_STEP_SECONDS`.
- Time limit: `hostile = sinceStart − (friendly + neutral)`; `hostile ≥ limitS ⇒ { over: true, winner: null, reason: "time-limit" }`.
  The truce is never charged against the limit, so a 3-minute match is 3 minutes of fighting.
- Stat gap: `distance = ‖z‖₂` over the six primaries with a pooled sd floored at 0.5 points, so a
  mirror match is exactly 0 and no pair is ever infinite; `dominance` blends `distance` and
  `damageShare = |dealt_a − dealt_b| / max(1, dealt_a + dealt_b)` into [0, 1].
- Budget → stats: the spent primaries go through `statDelta` (the race bonus path) and are clamped
  to `maxHealth ∈ [30, 60]·HEALTH_SCALE`, `attackPower ∈ [5, 14]·DAMAGE_SCALE`, `armor ∈ [1, 8]`,
  `attackInterval ∈ [0.5, 1.5]` s.

**Pins:** `tests/spec_test.ts` HA1, HA2, HA3, HD1, HD2, HD3, HE1, HF1, HX1 (see
`docs/ancestry/BRIEF.md` for the lane contract and each lane's own test file).

**OPEN in Wave H:** the stat-unlocked techniques beyond a class's own three are recorded on the
card and shown in the menu but are not yet bound to extra HUD input slots, so combat still runs
the class's three skills; the spectator card's arena size is clamped into the live arena band;
the hair solver is wired into the rig transform but its visual weight has not been judged in a
browser screenshot at gameplay distance (see the wave's verification log).

## 11B. Wave I — spectator camera, inspect overlay, terrain fill, clash sparks, 60 FPS guard

Added 2026-10-31. The prompt asked for a spectator camera whose angle the user sets and keeps, a custom
cursor with a trailing blob, a click on a fighter to open a floating stat sheet beside them (and a click on
another fighter or a map object to change what it shows, a click away to close it), a fix for props floating
above the map, a generation layer that closes the seams where a surface meets the terrain (coloured by the
ground it stands on), particles where two weapons collide, and the 60 FPS budget protected.

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| IA1 | The spectator camera's angle is the user's and stays the user's: no ease-back, no reset on a mode change or a new match; four presets; drag-orbit, wheel/Z/X zoom, C to cycle mode | `src/game/SpectatorCamera.ts`, `Engine.#updateCamera` (spectate branch), `#setSpectateCam` | LIVE |
| IB1 | A full-screen custom cursor (reticle + trailing blob, CSSOM-driven), hover highlight, and a card that anchors beside its subject with flip-then-clamp: fighter stats (primaries, pools, combat numbers, telemetry, techniques, generation badge), map objects (kind, size, and the REAL effect of a boon) | `src/ui/InspectOverlay.ts`, `Menu`/`UiTree`/`styles.css`, `Engine.#pickTargets/#inspectClickAt/#updateSpectateOverlay` | LIVE |
| IC1 | Props are seated on the terrain (never buried, never hovering) and every platform/prop gets a terrain-matched apron that closes the seam | `src/graphics/GroundFill.ts`, `src/graphics/props/PropModels.ts` (`propBaseOffset`), `Engine.#buildArena` | LIVE |
| ID1 | Two blades within reach, both moving, clash once: a burst of bounded sparks at the contact point, from a fixed pool that never overflows | `src/combat/Clash.ts`, `src/graphics/fx/ClashSparks.ts`, `Engine.#clashTick` | LIVE |
| IE1 | The frame budget is MEASURED (CPU per rAF, cadence, GPU via the driver timer) and an effects governor thins the effects out before a frame is ever late | `src/game/FrameBudget.ts`, `tools/frame-budget.ts`, `Engine.#loop` | LIVE |

## 11C. Wave K — impact-driven damage, smaller pools, pricier mana, segmented bars, better strikes

Added 2026-10-31. The prompt asked for the values and equations to be changed so that the strikes with more
impact do more damage, for the health pools to come down ("there is too much AP"), for mana to cost about
20 % more, for the statistics bars to carry their numbers inside and be divided by squares, and for some of
the attacks and animations to be improved. (The wave is **K**, not J: a second Hermes session working this
repo had already committed its own "Wave J" — arena walls, symmetric maps, the AI arena digest and the
headless batch back end — and released it at 15:53 UTC. See `artifacts/tuning/VERIFICATION.md`.)

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| KA1 | Damage responds MORE to impact: a full-speed heavy blow is ≥ 2.2× the same blow standing still (measured 2.294×) and a graze ≥ 0.45× it (0.507×); every expression bounded and monotone in speed and mass | `src/combat/Impact.ts` (`impactMul`), `src/game/Physics.ts` (`physicsMultiplier`, `PHYSICS_MUL_MIN 0.5` / `MAX 2.2`, closing term `0.85 + 0.55·min(2,|v|)`) | LIVE |
| KB1 | Smaller pools, bigger shares: `HEALTH_SCALE 500` (was 1000) with `DAMAGE_SCALE = HEALTH_SCALE / FIGHT_LENGTH`, the class solve's `TARGET_POWER_INDEX = DPS × effectiveHP` invariant kept, median decisive duel 25–55 s (measured 36.7 s, was 51.8), per-hit p80/p20 ≥ 1.9 (2.05), hits-to-kill down (51.3 → 36.2) and mirror win rates still 48–52 % (49.3–50.9 %) | `src/game/Stats.ts`, `src/balance/ArenaHarness.ts`, `tools/balance-report.ts` | LIVE |
| KC1 | Every technique costs 20 % more mana (`power 20 → 24`, `defense 5 → 6`; a dash stays a stamina move) | `src/engine/Engine.ts` (`SKILL_RESOURCE_COST`) | LIVE |
| KD1 | Every stat bar carries its numbers INSIDE it (value / max · share) and is divided into 12 squares across its whole length, with the full squares marked; widths and colours written through CSSOM only (never an inline style attribute — the server CSP blocks those) | `src/ui/FighterPanel.ts` (`barLabel`, `barSegments`, `BAR_SEGMENTS`), `src/ui/InspectOverlay.ts` (`inspectBarSegments`), `styles.css`, `Engine.#renderInspect` | LIVE |
| KE1 | The animation answers the impact: the wind-up scales with the weapon's heft, a heavy blow holds its pose longer than a graze, the recovery settles slower after a heavy hit, and none of it changes the attack rate | `src/game/anim/Swing.ts` (`anticipationSeconds`, `impactHold`, `impactSettle`), `src/game/anim/MotionStyle.ts`, `src/combat/SwingDriver.ts` (`begin(..., impact)`) | LIVE |

**Equations and constants.**

- Camera: `position = target + (sin yaw · cos pitch, sin pitch, cos yaw · cos pitch) · dist + (0, height, 0)`,
  `look = target`; `pitch ∈ [−0.25, 1.55]`, `dist ∈ [2.5, 40]`, zoom ratio 1.15 per step, yaw wrapped into
  `[−π, π]`. `orbitCamera(state, 0, 0, …) === state` — the no-op identity the complaint needed.
- Seating: `baseY = max(terrain over the rim + centre)` and `gap = max − min`. The seating guarantee is a
  property of the sampling, so props are sampled at `max(16, 24 × radius)` rim points. The apron descends
  per vertex to `clamp(terrainY − 0.02, baseY − maxDrop, baseY)` with
  `maxDrop = max(0.8, footprint fall + 0.25)`, at `6 × segments` triangles (`segments = 20`, so 120).
- Clash: `detectClash` needs both blades above `MIN_CLASH_SPEED = 1.5 m/s` and a closest approach under
  `CLASH_REACH_M = 0.35 m`; `strength` saturates at `MAX_CLASH_SPEED = 30 m/s`; repeats inside
  `CLASH_COOLDOWN = 0.12 s` are suppressed. Pool: 12 sparks per burst, 96 live maximum, 192 triangles.
- Governor: an EMA of the CPU time with `TAU = 0.35 s`, a drop after `12` consecutive frames above
  `hardMs = 16.6`, a drop step of 0.25, a recovery of 0.25/s toward `1`, a floor of `0.25`.

**Pins:** `tests/spec_test.ts` IA1, IB1, IC1, ID1, IE1.

**OPEN in Wave I:** the inspect card is read-only; the clash threshold was chosen rather than tuned by eye;
the headless frame numbers are a lab sample; `floating: 0` bounds the seating error at the sampled rim
rather than proving it away between samples.

## 11D. Wave L — creation and menu components: étendards, the dice roll, the live model, closed trees

Added 2026-10-31. The prompt asked for the components from the main page to the panel before launching a game
to be improved, for the races AND sub-species to carry icons "like étendards", for the character generator to
show the model and its statistics after clicking a purple rocky dice button that refreshes the Creator step,
and for the options to live in visibly closed trees. (The last sentence of the ask is cut off in the
transcript; the decode and the flag are in `docs/creation/BRIEF.md`.)

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| LA1 | Every race and every sub-species flies its own heraldic standard: one charge per race (elf laurel/star, human crown/sun, dwarf hammer/anvil, ork tusk/skull), a cadency mark per sub-species chosen deterministically from its id, all 16 distinct, drawn with presentation attributes only (no inline style), and readable at chip size | `src/ui/RaceBanners.ts` (`raceBanner`, `bannerCharge`, `bannerPalette`), `src/ui/Icons.ts` (`dice`, `chevron-down`) | LIVE |
| LB1 | The generator rolls a complete LEGAL fighter (race + a sub-species of that race, class, a weapon legal for the class, palette, birthsign, appearance; seeded, so a seed reproduces it) and its stat sheet is computed with the game's own maths (`createStats` → `applyRaceBonus` → `applySecondary` → `applyLevel`), never a private copy | `src/ui/CreatorRoll.ts` (`rollProfile`, `creatorSheet`) | LIVE |
| LC1 | The options are CLOSED trees: every group renders as a native disclosure, closed on arrival except the single entry group, each header showing its option count, and the open set persists (a corrupt payload falls back to the initial state) | `src/ui/UiTree.ts` (`UiGroup.defaultOpen`, `defaultOpenGroups`), `src/ui/Disclosure.ts` | LIVE |
| LD1 | One purple rocky dice button (dice icon, violet-on-ink struck-stone treatment, CSS only) rolls a fighter and refreshes the whole Creator step, and the rolled fighter's **model** (a live render built by the same path the arena uses) and **statistics** are shown beside it | `src/ui/Menu.ts` (`rollCreator`, `#refreshCreator`, `data-panel="preview"`), `src/graphics/PreviewScene.ts`, `Engine.#updateCreatorPreview` | LIVE |

## 11E. Wave M — fight telemetry, the one-click batch and the branch tree

Added 2026-10-31. The prompt asked for the variables the browser should compute so the back end can learn
the fighters' behaviour (the dry-streak seconds with their maximum and minimum, the average and median
distance), for the stall the user described ("they move, but they don't really move, and they don't serve
each other") to be fixed, for one button on the reading page that runs a batch of 10/20/50/100 matches with
the SIMULATOR ONLY, for many more min/max statistics, for thousands of branches from the initial arena over
victory conditions and match-ups, for the enemy's behaviour and probable strategies to reach the AI models,
and for the frontend to preprocess during the fight and share one report at the end (dev-mode automatic
updates, with a review gate later).

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| MA1 | The live accumulator: dry streaks per fighter (count/total/mean/max/min), the pair's mutual-dry and quiet time with its longest stretch, the distance statistics (mean/median/min/max/p10/p90), the time in contact/striking/circling/apart bands, jumps (count + peak), damage dealt/taken/absorbed with the highest single hit, the same per weapon, the object events (taken/destroyed/defended/attacked), the fighters' evolution, and the named stall (`standoffMaxS`) — one accumulator per match, fed per substep, allocation-free, and a non-finite step is REFUSED rather than poisoning the mean | `src/game/FightTelemetry.ts` (`createTelemetry`, `telemetrySummary`, `telemetryForSeat`) | LIVE |
| MB1 | The stall is answered: an engagement intent (approach/hold/circle/disengage/bait) whose pull to close is `clamp(quietS / 3 s, 0, 1)` — bounded, monotone, never returning `approach` inside the fighter's own striking band | `src/game/Engagement.ts`, the `compute` hook in `src/game/DecisionTree.ts`, fed by `CombatView.quietS` from `Engine.#stepFight` | LIVE |
| MC1 | One button on the reading page runs 10/20/50/100 matches with the SIMULATOR ONLY (no rendering), chunked a match at a time so the frame loop survives, and prints min/p10/median/mean/p90/max per variable plus the ending distribution | `src/ui/BatchPanel.ts` (`batchPlan`, `batchProgress`, `batchSummary`), `Menu`'s batch bar, `Engine.#runBatchFromMenu` | LIVE |
| MD1 | A branch tree over arena × victory condition × match-up, bounded by BOTH node count and depth, every node carrying its telemetry, outcome, distances, fighter gap, evolution and object events, summarised per depth with win rates and branch counts | `src/balance/BranchTree.ts` (`branchPlan`, `buildBranchTree`, `summariseTree`) | LIVE |
| ME1 | ONE compact report at the bell (schema 1, capped at 8 KiB, no stream during the fight): both seats' telemetry, an opponent model whose probable strategies are real decision-tree leaves with weights that sum to 1, measured habits, and a TESTED privacy claim (no name, no personal id, no position); the update gate takes accept / defer / refuse with an auto mode that records why | `src/game/MatchReport.ts` (`buildReport`, `isPersonalData`, `applyVerdict`, `autoVerdict`), `Engine.#assembleReport` | LIVE |

## 11F. Wave N — navigation, strategy, concealment, casting and combat feedback

Added 2026-10-31. The prompt read the 300 s time-limit ending as proof that both AIs failed to navigate to
each other, asked for the same AI system to kite and to hide or push the clock, for the assassin to become
invisible **so the opponent cannot cheat** with the AI understanding that the disappearance is a strategy
(and a sound cue), for strong powers to cast with a bar that can be interrupted or pushed back by a hit
according to its own variables, and for autoattack with damage numbers styled by the combat statistics.

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| NA1 | A navigation pilot: a stuck detector with a bounded escape, a bounded re-plan cadence for a moving target, and an arrival rule | `src/game/NavPilot.ts`, `src/world/PathFinder.ts` (`distanceToPolyline`) | TESTED (headless) |
| NB1 | Strategies as a shared vocabulary — brawl / kite / hide / stall / bait / trade — each with stated parameters, a deterministic chooser, an advice function, and a switch that stops a LOSING seat stalling forever; every behavioural id maps onto decision leaves a shipped tree can really emit | `src/game/Strategies.ts` | LIVE (chosen per seat and reported; the movement bias is OPEN) |
| NC1 | Concealment is AUTHORITATIVE in the simulation, and the other seat's belief is graded against it: while concealed the belief carries the last known place, `knowsPosition` false, a confidence decaying over the memory horizon, and the probable strategy — never the true position | `src/game/Concealment.ts`, `src/game/Perception.ts`, `Engine` per-substep, the model hidden for the other seat, `AudioManager.playVanish` | LIVE |
| ND1 | A caster's heavy technique CHANNELS: a duration from the power, the element and the caster's statistics (mages at the long end), a cast bar painted from a pure view model, an interrupt by a heavy technique, and a pushback from being hit scaled by the hit's own variables (share of the pool, angle, stamina, weapon weight) | `src/game/Cast.ts`, `src/ui/CastBar.ts`, `Engine.#useSkill` gate, the hit site, `styles.css` | LIVE |
| NE1 | Autoattack swings by itself in reach (never stunned, never casting), and every landed blow pops a number out of the victim whose size, weight, hue, lightness, rise and life come from the blow's own statistics, with the outcome carried by a glyph as well as by colour | `src/game/AutoAttack.ts`, `src/ui/CombatText.ts`, `Engine.#spawnDamageText`, `styles.css` | LIVE |

**Pins:** `tests/spec_test.ts` pins the wave's cross-module bounds; the lanes' own suites are
`tests/navpilot_test.ts`, `strategies_test.ts`, `concealment_test.ts`, `perception_test.ts`, `cast_test.ts`,
`autoattack_combattext_test.ts`.

## 11H. Wave P — the menus in place, a viewer that fits, and manga

Added 2026-10-31. The prompt asked to keep refining the last wave: centre and align the menus and give
them clearer structure; stop making the user click through panels by showing each group's MAIN VALUES and
opening it only for the details; frame the 3D viewer from the character's own maximum height and make
turning it manual; let a rolled fighter be edited and then saved or discarded as a deliberate choice, with
its generation seed recorded; synchronise the parameters an edit drags along; make the ink outline subtle
and angle-dependent with a stated manga shading equation; build facial ratios into ranked hierarchies
across the ancestry; make the bodies bulkier and cartoonish with real anatomy and painted definition; and
fix the bow (its tip must close around the arrow), the sword's guard and the weapons' materials.

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| PA1 | The ink outline is a VARIABLE mark: strength falls off with the light's angle AND the surface's angle to the camera, faces suppress it, and the width is bounded with a far fade — hence the shader consumes uniforms, never a second copy of the law | `src/graphics/shaders/Ink.ts`, `CelShader.ts`, `CelSkinned.ts` | LIVE |
| PA2 | The manga shading is a STATED equation: few flat bands, a hard terminator, a separate shade tone per material | `src/graphics/shaders/Ink.ts` (`mangaRamp`) | LIVE |
| PB1 | Facial ratios for every ancestry node (17 measures, units stated, ranked 1..16) and the RATIOS between them, with a ranked hierarchy across all 16 nodes and a two-ancestry comparison whose criteria are stated | `artifacts/design/ancestry.json`, `src/game/Ancestry.ts`, `src/ui/FaceHierarchy.ts` | LIVE |
| PB2 | The hair/beard law: elves lightest and longest, dwarves always bearded and fullest, humans the widest range, orks barest | the same `hair` / `beard` blocks | LIVE |
| PC1 | Three explicit builds (fit / bulky / heavy) with measurable radii and muscle/fat terms, every ancestry mapped onto one, the geometry carrying anatomy and the paint a definition pass | `src/game/BodyProfile.ts`, `src/graphics/body/Proportions.ts`, `src/graphics/paint/Definition.ts` | LIVE |
| PD1 | The bow's limb tip is CAPPED and CLOSED around the string (a channel, no through-hole) and the arrow's nock sits inside it | `src/game/WeaponGen.ts`, `src/graphics/weapons/WeaponParts.ts` | LIVE |
| PD2 | The sword's guard/grip/blade junction is rebuilt with stated overlaps, and the materials are per-weapon (metal actually metallic, wood/bone/stone/chitin their own) | the same files, `WeaponMesh`/`WeaponMaterial` | LIVE |
| PP1 | The Creator is ONE page: no tab nav, every panel visible, each group header carrying its CURRENT values from a pure summary model | `src/ui/Menu.ts`, `src/ui/CreatorSync.ts`, `styles.css` | LIVE |
| PP2 | The viewer frames every character from its own MEASURED maximum height (the same law in the portrait studio), and turning is manual — mouse, finger, gamepad stick — with no self-rotation | `src/graphics/PreviewScene.ts`, `src/graphics/PortraitStudio.ts`, `src/engine/Engine.ts` | LIVE |
| PP3 | A roll can be EDITED and then saved or discarded as a decision; the generation seed is recorded on the profile and shown on the sheet | `src/game/Profiles.ts`, `src/engine/Engine.ts`, `src/ui/Menu.ts` | LIVE |
| PP4 | An edit SYNCHRONISES the parameters that depend on it (a skin tone drags its crease/paint/eye tones), and every edit clamps into the race's own band | `src/ui/CreatorSync.ts` | LIVE |

**Pins:** the lanes' suites (`ink`, `facehierarchy`, `bodybuilds`, `weapon_parts`, `creatorsync`) plus the
re-stated `[SPEC LL2]` disclosure pin (two open entry groups) and the `anim_measure` slide band, which the
heavier builds moved on the heaviest dwarf (measured 5.54 mm against a 5.00 mm bound; the band is now
5.6 mm for non-orks, the ork band untouched, and the reason is recorded where the bound lives).

## 11I. Wave Q — lids and recessed eyes, pointed brows, the neck, and a batch that climbs

Added 2026-10-31. The prompt asked for pointed eyebrows and real upper/lower eyelids on every model,
eyes pushed deeper into the socket, more angular side planes with a lower shoulder over-width and a
slimmer neck, slightly better features, mechanics that work together, and a batch that generates
different cases so the progression from a working game to a working TYPE of game can be seen.

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| QA1 | The brow is a pointed WEDGE (inner root -> outer point, taper and tip position in head heights, ancestry-driven) | `src/graphics/body/AnatomyParts.ts`, `FaceParts.ts`, `ancestry.json`, `src/game/Ancestry.ts` | LIVE |
| QA2 | Upper AND lower eyelids on all 16 ancestries, with stated thickness and aperture, validated | the same files (`lid` block) | LIVE |
| QA3 | The eyeball is RECESSED: its front surface sits behind the socket rim (measured inset 0.140h, front-vs-rim 0.185h) | the same files | LIVE |
| QB1 | Angular side planes: the torso's section exponent is raised race-relative toward a stated ceiling — and SCOPED to the torso, so no limb or foot section moves | `src/game/BodyProfile.ts`, `src/graphics/BodySurface.ts` | LIVE |
| QB2 | The neck is slimmer by a stated fraction (−6 %) | `src/graphics/body/Proportions.ts` | LIVE |
| QB3 | The shoulder over-width cut — **NOT TAKEN**: measured to move the planted-foot slide past its band (5.54 → 5.75 mm against 5.6) and to tip the ragdoll settle | — | DROPPED, with the numbers |
| QQ1 | A batch LADDER: steps that generate different cases, score them on stated criteria, keep the survivors, mutate them onward, prune cells that are never a game, and report the first agreed type | `src/balance/Ladder.ts`, `tools/evolution-ladder.ts` | LIVE |

**Pins:** `tests/face_parts_test.ts` (7), `tests/planes_neck_test.ts` (4), `tests/ladder_test.ts` (9).
Lane Q-B's own test file is NOT kept: it asserted the shoulder cut that this wave dropped after
measurement.

## 11J. Wave R — one entry to the generator, a female curve, hair that fits, eyes that pop

Added 2026-11-01. The prompt asked to merge the title's two buttons into one, to be able to change every
statistic by hand during generation, to make the female curvier and the dwarf less wide and fitter, to keep
improving the polygons and style, to fit the hairstyles to the head (and the collision systems), to give the
eyes "some glue" so they pop (not square, painted), to make the pectorals more obvious and to paint the
fingernails.

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| RA1 | ONE entry: the title's Profiles and Fight buttons are one button that opens the roster AND the generator on one page, with the fight still reachable and keyboard-accessible | `src/ui/Menu.ts`, `src/ui/UiTree.ts`, `styles.css` | LIVE |
| RA2 | Every parameter overridable by hand after a roll (race, sub-species, class, weapon, sign, the six attributes, height, weight, sex, name), routed through `applyEdit` so dependents synchronise | `src/ui/Menu.ts`, `src/ui/CreatorSync.ts` | LIVE |
| RA3 | A `sex` field, drawn deterministically, carried onto the body spec, giving a measurably curvier female | `src/game/Characters.ts`, `Proportions.ts`, `contracts.ts`, `SkinnedHumanoid.ts` | LIVE |
| RA4 | The dwarf's muscle term up (fitter); its **shoulder over-width NOT cut** (any cut breaches the foot-slide band) | `Proportions.ts` | PARTIAL, with numbers |
| RA5 | **Pectorals DROPPED**: any depth gain breaks four ragdoll tests (mass, welds, round trip, settle) | — | DROPPED, with numbers |
| RB1 | Hair fitted to the skull: 0 vertices inside, a stated clearance band in head heights, hairline above the brow | `src/graphics/body/FaceParts.ts` | LIVE |
| RB2 | Eyes that pop: round iris (32 edges, 0.9936), a wet glint, painted iris flecks | the same file + `paint/Recipes.ts` | LIVE |
| RB3 | Nails painted (plate + gloss, measured coverage) — but **no SDF primitive carries the `nail` region**, so it shows on the mannequin and not on generated fighters | `paint/Recipes.ts` | PARTIAL, gap recorded |

**Pins:** `tests/sexbuild_test.ts`, `tests/sex_wire_test.ts`, `tests/menu_entry_test.ts`,
`tests/hair_eyes_nails_test.ts`. R-A's pectoral pin was re-stated from the change to the DROPPED state with
the reason, rather than deleted.

## 11G. Wave O — the Profiles panel

Added 2026-10-31. The prompt asked to improve the journey from the title's profile button into a panel where
the user can generate a random or a specified fighter, see the list of already existing ones, and see their
models and their statistics.

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| OA1 | ONE portrait studio renders many profiles off the SAME rig the arena builds (`buildPreviewRig`, shared with the Creator's live preview) — one WebGL context for the whole list, a PNG data URL per profile, cached by its build key; the old `renderPortrait` now delegates to it | `src/graphics/PortraitStudio.ts`, `src/graphics/PreviewScene.ts`, `src/graphics/Portrait.ts` | LIVE |
| OB1 | A profile library over the persisted records: a saved profile has no appearance, so one is resolved DETERMINISTICALLY (name seed + race + sub-species + calling) unless the record carries one; roll-and-save, save-from-Creator, rename, duplicate, delete (a tombstone — the repo has no remove), setActive, unique ids | `src/game/ProfileLibrary.ts` | LIVE |
| OC1 | The panel's pure view model: rows with the portrait key, the ancestry standard, calling, level, record and the active/selected flags; the selected one's statistics via the game's own maths (`creatorSheet`); the two ways to make a new profile; the manage actions with their disabled reasons; a real empty state; a 100-row cap that still reports the true count | `src/ui/ProfilePanel.ts` | LIVE |
| OD1 | The screen itself: the title's profile button opens the panel (it used to silently switch the active profile), rows show real portraits, load switches the active fighter, and the whole panel survives 390/820/1280/1920 px without clipping | `src/ui/Menu.ts`, `styles.css`, `Engine.#onProfileAction` | LIVE |

**Pins:** `[SPEC LL1–LL4]` plus the lanes' own suites (`portraitstudio`, `profilelibrary`, `profilepanel`).
The `[SPEC LL2]` open-group pin moved from ONE entry group to TWO (the modes and the saved fighters): a
closed tree must never hide the way into your own fighters, and the pin records the deliberate change.

## 12. Traceability — every prompt to its requirements

| Prompt (date, gist) | Requirements |
| --- | --- |
| Original 12-agent brief | R-1.x, §2, §3.5, §9, §10 |
| Rig, classes, weapons, shader effects | §4 |
| X/Y/Z axis pictures, senses, statuses, ragdoll, items, arena ×40 | §3.6, §5.1, §6.3, §6.6, §6.7 |
| Glider, shapes, truce, identity, fog | §5.2, §5.4, §6.1, §6.2, §6.5 |
| Huge rings, walls 90%, density, death-only ending | §3.1–3.4, §5.1, §5.3 |
| Precise definitions, bounds, md expansion | this file, `SPEC-tables.md`, `spec_test.ts` |
| Adaptive AI identities/decision trees, full telemetry, instant battles, win-condition variety, sword/grip/palm, camera occlusion, balance plates, 4D solvers | §4.2.2, §5.3, §6.2.1–6.2.3, §11.2–11.3 |
| Kneeling/stance transitions, coherent animation points, palm decides weapon, tensors, sub-animations | §4.2.1–4.2.2, §11.1–11.2 |
| Reduce `else`, leaderboard in History, 4 archetypes, per-AI profile cards, selection tables | §6.2.1, §6.2.3, §8 |
| Responsive UI, high-responsiveness input, Player_ID profiles, race hero + sub-species + birthsign preview, secondary stats, creation telemetry | §2.5–2.6, §8 |
| 3D models: separate shapes, all-angle shots, 33-vertex spine back, race/subrace expansion, hair/beards/tusks, facial morph loop, animation tensor bounds, menu expansion | §2.5, §4.2.3–4.2.4, §11.1, §11.4–11.5 |
| Ancestry hierarchy over every subrace with body-part ratios, per-ancestry look, hair physics bound to length and curl, generations logged for training, a 3-minute limit that ends as a tie with the stat difference recorded, History highlights, generated spectator matches with a stat budget, a bounded corpus data-science pass | §11A, `docs/ancestry/BRIEF.md` |
| Spectator camera whose angle stays, a custom blob cursor, click-to-inspect stat sheets and object cards, props floating above the map, a ground-fill layer that closes terrain seams, particles where two weapons collide, and the 60 FPS budget kept | §11B, `docs/spectator/BRIEF.md` |
| Damage that answers impact, halved health pools and attack power, mana 20 % dearer, stat bars with the numbers inside and squares across, and three named attacks re-animated | §11C, `docs/tuning/BRIEF.md` |
| Éendards for every race and sub-species, a purple rocky dice that rolls a fighter and shows its model and statistics, the options as closed trees, and the whole title → Create path polished | §11D, `docs/creation/BRIEF.md` |
| Live fight telemetry computed in the frontend and shared as ONE report at the bell, the one-click headless batch with its min/max/median summary, and the branch tree over arenas × victory conditions × match-ups | §11E, `docs/telemetry/BRIEF.md` |
| Navigation quality for the stall subset, kiting/hiding/stalling strategies, authoritative invisibility with a bounded enemy belief and a cue, casting with a bar / interrupts / pushback, and autoattack with statistics-styled damage numbers | §11F, `docs/powers/BRIEF.md` |
| A Profiles panel behind the title's profile button: every saved fighter as a row with a real portrait, its ancestry standard, calling, level and record, the selected one's statistics, and roll / build / load / duplicate / rename / delete | §11G, `docs/profiles/BRIEF.md` |

**Statuses in one line.** LIVE: races, physics, skills, shaped arenas with walls, truce, senses,
fog + minimap, statuses, items, environment, adaptive AI + telemetry + Elo leaderboard, stance
transitions, palm grip, face morph, animation tensors, camera occlusion, balance plates, spine
curve, responsive UI, selection tables, profiles. TESTED (not yet seen in-browser): secondary
stats preview, controller input. OPEN: win-condition variety, battle-corpus → `NeuralTrainer`,
glider, two-handed weapons, stat allocation, skill selection, keybinding rebind UI, a telemetry
backend, low-sun shadow verification.
