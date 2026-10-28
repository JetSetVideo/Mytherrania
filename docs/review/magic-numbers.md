# Magic numbers → derived constants (R08)

Lane H review, 2026-10-28. This is analysis only; no code was changed.

**What is listed.** Numeric literals in `src/engine/Engine.ts`, `src/game/*.ts` and
`src/physics/*.ts` that encode tuning or geometry. Not listed: 0, 1 and 2 used structurally, array
indices, and colours, unless they carry meaning. **Engine.ts line numbers** come from the snapshot
`c5b55af` (2,574 lines; see GLOSSARY.md "How to read the citations"). Each Engine row also gives the
enclosing method, so the row can be found again after the parent's edits land.

**Columns.**
- *Derivable?* — **D**: can be computed from named bases. **N**: a genuine free parameter that
  should get a name. **A**: art direction; give it a name, but no derivation is needed.
- *Proposed derivation* — always written in terms of the bases in §0.

All arithmetic in the "≡ current" checks was done by hand from the literals shown. None of it was
measured by running the game.

---

## 0. The proposed `Tuning` base set (19 bases)

Everything in §1–§6 can be written in terms of these. Each base is either a value the code already
uses or the median of a table the code already contains.

| # | Base | Symbol | Value (≡ today) | Unit | Where today's value comes from |
|---|---|---|---|---|---|
| T1 | `BODY_HEIGHT` | H | 1.8 | m | ragdoll `height: 1.8`, Engine.ts:1681 (`#throwRagdoll`) |
| T2 | `BODY_RADIUS_PER_HEIGHT` | ρ_r | 1/3 → r = 0.6 m | — | `radius: 0.6`, SmashPhysics.ts:16 |
| T3 | `RUN_SPEED` | v_run | 6.5 | m/s | `MOVE_SPEED`, Engine.ts:81 |
| T4 | `AI_SPEED_RATIO` | k_ai | 0.646 (= 4.2 / 6.5) | — | `AI_MOVE_SPEED`, Engine.ts:82 |
| T5 | `GRAVITY` | g | 24 | m/s² | `ARENA_GRAVITY`, ArenaPhysics.ts:14 |
| T6 | `DT_MAX` | dt_max | 0.1 | s | Engine.ts:1770 (`#loop`) |
| T7 | `REACTION_TIME` | t_r | 0.25 | s | HUD tick (Engine.ts:1774) and attack-pose window (Engine.ts:992, 1080, 1331) |
| T8 | `THIRD_PERSON_FOV` | φ | 50 | deg | Engine.ts:261 |
| T9 | `FRAMING_FILL` | f_fill | 0.35 | — | back-solved from the effective fight distance 5.5 m (Engine.ts:2043): H / (2·5.5·tan 25°) = 0.351 |
| T10 | `REFERENCE_REACH` | ℓ_ref | 1.9 (median) / 2.8 (max) | m | median and max of `reach` in Weapon.ts:40-46 (1.1, 1.5, 1.7, 1.9, 1.9, 2.1, 2.8) |
| T11 | `STRIDE_PER_HEIGHT` | k_s | 0.75 → stride ℓ_s = 1.35 m | — | new; see M-T3 |
| T12 | `ARMOR_SATURATION` | A_sat | 8 | armor points | repeated in Engine.ts:1123, 1263 and Physics.ts:244, 255 |
| T13 | `ARMOR_DR_PER_POINT` | κ_a | 0.04 | 1/point | repeated in Stats.ts:90, 107, 152 |
| T14 | `HEALTH_SCALE`, `FIGHT_LENGTH` | — | 1000, 10 | — | already named, Stats.ts:54, 58 |
| T15 | `KNOCKBACK_DOUBLING` | P_2 | 60 | % | Fighter.ts:53 |
| T16 | `METER_GAIN` | γ | 0.8 | % per brief unit | Engine.ts:1388 |
| T17 | `BLOCK_FACTOR` | β | 0.4 | — | Engine.ts:1386 |
| T18 | `EDGE_MARGIN_RADII` | m_e | 2.5 → 1.5 m | × r | `nearEdge < 1.5`, Engine.ts:1054, 1306 |
| T19 | `FALL_GRACE` | T_f | 0.816 | s | back-solved from `RING_OUT_FLOOR = −8` at g = 24: √(2·8/24) |

The derived names used below are:
r = ρ_r·H; v_ai = k_ai·v_run; DAMAGE_SCALE = HEALTH_SCALE / FIGHT_LENGTH (already derived,
Stats.ts:60); and λ(h) = ln2 / h, which is `lambdaFromHalfLife` (MathCore.ts:70).

---

## 1. Movement, body and timing

| ID | File:line (anchor) | Value | Meaning | D? | Proposed derivation |
|---|---|---|---|---|---|
| M-B1 | Engine.ts:80 `PLAYER_RADIUS` | 0.5 | Passed as `radius` to `createFighter`, but Fighter.ts:39 forwards it as the **y** of `body(x, y, z)`. The real radius stays 0.6 (SmashPhysics.ts:16). | D | Delete it. Pass `r = ρ_r·H` into the body's `radius` field, and spawn with `y = r`. |
| M-B2 | SmashPhysics.ts:16 `radius: 0.6` | 0.6 | Kinematic collision radius. | D | r = H/3. |
| M-B3 | Engine.ts:81 `MOVE_SPEED` | 6.5 | Player top speed. | N | Base T3. |
| M-B4 | Engine.ts:82 `AI_MOVE_SPEED` | 4.2 | Bot top speed: 0.646 of the player's. | D | v_ai = k_ai·v_run. The ratio should be stated explicitly; today it is implicit. |
| M-B5 | Engine.ts:1008 (`#roam`) | 0.5 | Roam speed factor → 2.1 m/s. | D | v_roam = 0.5·v_ai. Name it `ROAM_SPEED_RATIO`. |
| M-B6 | Engine.ts:1291-1292 (`#steerControlled`) | 0.7 | Speed of a fighter walked by a controller → 2.94 m/s. | D | v_ctrl = 0.7·v_ai. Name it `CONTROLLED_SPEED_RATIO`. |
| M-B7 | Engine.ts:1007, 1041 | 0.2, 0.5 | Arrival radii for roaming and for hunting a last-seen position. | D | arrive = r/3 (0.2) and r (0.6 ≈ 0.5). |
| M-B8 | Engine.ts:1253 (`#perceive`) | 0.2 | Speed (m/s) below which facing falls back to "toward the rival". | D | v_min = 0.03·v_run (0.195). |
| M-B9 | Engine.ts:1770 (`#loop`) | 0.1 | dt clamp. | N | Base T6. |
| M-B10 | Engine.ts:349-350 (`#schedule`) | 120, 100 ms | Heartbeat threshold and interval. | D | interval = dt_max (100 ms); threshold = 1.2·dt_max. |
| M-T1 | Engine.ts:1112 (`#tickWorld`) | 0.1 s | Time constant of the measured-velocity EMA (`1 − exp(−dt/0.1)`). | D | Use `damp(v, raw, λ, dt)` with λ = 1/0.1 = 10 /s (half-life 0.069 s). Name it `VELOCITY_SMOOTH_HALFLIFE`. |
| M-T2 | Engine.ts:1846-1847, 1876-1877 | `exp(−dt/stop)` | Surface friction, applied per fighter in two separate code blocks. | D | `stopLambda = 1/surface.stop`. Factor it into one `#applySurfaceDrag(f)`; see vocabulary.md V-07. |
| M-T3 | Engine.ts:2107 (`#loop`) | 0.35 s | Footstep interval. It is fixed and never gated: `#lastStep` grows every frame (Engine.ts:1777), and `AudioManager.playStep` (AudioManager.ts:31) plays unconditionally, so the fighter "walks" while standing still. | D | Δt_step = ℓ_s / max(v_measured, v_min), and play only while `anim.moving`. ℓ_s = k_s·H = 1.35 m gives 0.21 s at v_run and 0.32 s at v_ai. The current 0.35 s equals ℓ_s/v at 3.9 m/s, about the AI's speed. |
| M-T4 | Engine.ts:1774 (`#loop`) | 0.25 s | HUD and minimap refresh period. | D | period = t_r. ⚠ The skill bar prints cooldowns with `toFixed(1)` (Engine.ts:1533), a 0.1 s resolution, but refreshes only every 0.25 s, so the tenths jump 2–3 at a time. Either print `toFixed(0)` below 1 s, or refresh at 1/0.1 = 10 Hz for the chips alone. |
| M-T5 | Engine.ts:992, 1080, 1331 | 0.25 | Length of the attack-pose window. The same literal appears three times. | D | t_attackPose = t_r. One constant. |
| M-T6 | Engine.ts:1436 (`#resolveHit`) | 0.3 | Length of the hit-pose window. | D | 1.2·t_r. |
| M-T7 | Engine.ts:1437, 1700 | 0.1, 0.12 | Hit and fall flash durations. | D | t_flash = 0.4·t_r, and 0.48·t_r for a fall. One constant plus one ratio. |
| M-T8 | Engine.ts:1998 | 4 | Exposure gain per flash second (peak exposure 1.4 at t = 0.1). | A | Write it as `peakExposure` (1.4) and compute `1 + (peak − 1)·flash/t_flash`. |
| M-T9 | Engine.ts:1204 (`#drawCoins`) | 0.25 rad per **frame** | Coin spin. Frame-rate dependent: 15 rad/s at 60 Hz, 30 rad/s at 120 Hz. | D | ω = 15 rad/s, applied as `rotation.x += ω·dt`. |
| M-T10 | Engine.ts:2136 (`#updateOcclusion`) | 0.2 per **frame** | Wall-fade easing. Frame-rate dependent: λ = −ln(0.8)·60 = 13.4 /s at 60 Hz. | D | `damp(cur, target, 13.4, dt)`, halfLife = 0.052 s. |
| M-T11 | SkillRuntime.ts:75; Engine.ts:2305 | 0.35 | Stance buff outlives its animation by 0.35 s. The literal is duplicated. | D | Use one `STANCE_LINGER`. The equality with the footstep interval is a coincidence, so name it separately. |
| M-T12 | Engine.ts:2040 (third-person camera) | 1.8 /s | Rate at which the orbit yaw relaxes back to 0. | D | λ = ln2/0.385 s. Name it `ORBIT_RETURN_HALFLIFE = 0.385`. |
| M-T13 | Engine.ts:2010-2011 | 6 /s | Camera distance and height smoothing. | D | `damp(..., λ = 6)`, halfLife 0.116 s. Or use `springStep` (MathCore.ts:103), whose doc names camera follow as its intended use. |
| M-T14 | ArenaPhysics.ts:116 | 1.2 /s | Horizontal air drag on every body. This stacks with the surface drag (M-T2), so a fighter on the ring gets both. | N | Name it `AIR_DRAG_LAMBDA`. Document that the effective drag is λ_air + 1/stop. |

## 2. Camera and framing

| ID | File:line (anchor) | Value | Meaning | D? | Proposed derivation |
|---|---|---|---|---|---|
| M-C1 | Engine.ts:2008 (`#loop`) | `7 + 0.5·speed + min(0.15·dist, 2.5)` and 9 | Target camera distance. `speed` here is the **input magnitude** (0..1), not a velocity. | D | d_target = d_0·(1 + c_sep·min(sep/ℓ_ref, s_max)), with d_0 = H / (2·f_fill·tan(φ/2)) = 1.8 / (2·0.35·0.4663) = **5.51 m**. |
| M-C2 | Engine.ts:2043 (third-person branch) | `min(#camDist, 5.5)` | Fight cap. Because d_target ≥ 7 > 5.5, this is **always 5.5**: the adaptive term in M-C1 has no effect in the fight camera. | D | Remove the cap and let M-C1 produce d_0 ≈ 5.5 directly. Then the separation term actually widens the shot. |
| M-C3 | Engine.ts:2009, 2011 | `6 + 0.3·speed` and 7 | Target camera height (`#camHeight`). It is written every frame and **never read**. | — | Delete it, or use it in place of the `0.9 + camLift` sum (M-C5). |
| M-C4 | Engine.ts:260-261 | FOV 60 (close) and 50 (third) | Perspective FOVs. | N | Base T8. Close FOV = φ + 10°. |
| M-C5 | Engine.ts:2047, 2050 | `camLift = 1.55`, `+ 0.9` | Camera rig height above the body centre. The world height of the pivot is 0.6 + 0.9 + 1.55 = 3.05 m before the pitch term. | D | pivotY = H·0.83 (= 1.5 m; the 0.9 term) and lift = 0.86·H (= 1.55). Better: derive the lift from pitch and d so that the head (0.97·H) is centred. |
| M-C6 | Engine.ts:2046 `sh` | 1.15 | Shoulder offset. The comment says right shoulder, but the `* −1` puts the camera on the **left**; see §6, S-2. | D | sh = 2·r·0.96 ≈ 1.15. Write it as 2r, the offset that keeps the player's silhouette out of the screen centre. |
| M-C7 | Engine.ts:2061-2063 | 0.55, 1.15 | Look target: 55% of the way to the opponent, at a height of body + 1.15 (= 1.75 m = 0.97·H). | D | lookY = 0.97·H − body.y; the share 0.55 stays a named `LOOK_SHARE`. |
| M-C8 | Engine.ts:2024, 2026 (first person) | +0.5, +0.4 | Eye and look heights above the body centre. They put the eye at **1.1 m**, chest height for a 1.8 m fighter. | D | eyeY = 0.93·H − body.y = 1.07. The 0.5 is probably a bug (camera at chest height). |
| M-C9 | Engine.ts:2030-2031 (close) | 2.6, 0.7, 0.95, 0.55 | Portrait camera offsets. | D | ahead = 1.44·H, side = 0.39·H, camY = body + 0.53·H, lookY = body + 0.31·H. |
| M-C10 | Engine.ts:2018, 2021 (orbit view) | 0.85 | Look height in the QA orbit view. | D | 0.47·H above the centre. |
| M-C11 | Engine.ts:2038-2039 | 0.003 rad/px; pitch in [0.05, 1.2] | Mouse sensitivity and pitch limits. | N | `MOUSE_RAD_PER_PX`; pitch limits `PITCH_MIN` and `PITCH_MAX` (1.2 rad = 69°). |
| M-C12 | Engine.ts:245, 722 | 0.5, 0.42 | Initial orbit pitch: 0.5 at construction, 0.42 at fight start. Two defaults for one quantity. | D | One `DEFAULT_PITCH`. At d = 5.5 m, 0.42 rad gives a rise of tan(0.42)·5.5 = 2.46 m above the pivot. Pick the pitch from the rise you want: `atan(rise/d)`. |
| M-C13 | Engine.ts:262-263, 2066, 2069, 269 | ortho half-width 10 and 15; iso offset (8, 9, 8); birds-eye y 22 | Fixed orthographic framing. It does not follow the arena size, which can go up to `LIVE_ARENA_MAX`. | D | halfWidth = 1.1·R_circ(arena), where R_circ = max R(θ). The iso offset is R_circ·(0.8, 0.9, 0.8). |
| M-C14 | Engine.ts:267 | ±2.0 | Axis-view window. Its comment says "a 2.2 m character", but the physics height is 1.8. | D | halfHeight = 1.1·H_model, where H_model comes from `debugRigInfo().height`. |
| M-C15 | Engine.ts:2079, 2086-2087 | 60, −2, +40 | Axis camera distance and clip planes. | A | Fine as QA constants; give them names. |
| M-C16 | Engine.ts:2386 (`#pollGamepad`) | 0.18 | Stick dead zone. | N | `STICK_DEADZONE`. |

## 3. Combat and physics

| ID | File:line (anchor) | Value | Meaning | D? | Proposed derivation |
|---|---|---|---|---|---|
| M-K1 | Engine.ts:1386 (`#resolveHit`) | 0.4 | Damage factor while blocking. | N | Base T17 (β). |
| M-K2 | Engine.ts:1388, 1807 | 0.8 | Knockback-meter gain per brief unit of damage. | N | Base T16 (γ). |
| M-K3 | Engine.ts:1657, 1698 | 0.4 | Meter gain from falls. | D | γ_fall = γ/2. |
| M-K4 | Fighter.ts:53 | 60 | Meter % at which knockback doubles. | N | Base T15. Equation: `kb = kb_0·(1 + meter/P_2)`. |
| M-K5 | Engine.ts:1397 | ×3 | Launch-speed gain applied to `knockbackPower`. | D | Fold it into the weapon table, or name it `LAUNCH_GAIN`. With weapon knockback 0.7–1.3 this gives 2.1–3.9 m/s at meter 0%, i.e. 0.32–0.6·v_run. |
| M-K6 | SmashPhysics.ts:23 | 0.35 | Vertical launch ratio, `vy = 0.35·power`. | D | vy = power·tan(θ_launch) with θ_launch = 19.3°. Name the angle. |
| M-K7 | Engine.ts:1396, 1869 | `stunDuration(·, 1.2, b)` | The brief's "Force_impact" coefficient, passed as an argument the callee names `strength`. | N | `STUN_FORCE = 1.2`. Rename the parameter (vocabulary.md, V-14). |
| M-K8 | SmashPhysics.ts:32 | 1.5, 0.01 | Wall-bounce growth and seconds per brief unit. | N | Both named in the brief; give them identifiers. |
| M-K9 | Engine.ts:1140 | 0.6 s | A physical stun longer than this also applies the `stunned` status. | D | 0.4·`STATUS_DEFS.stunned.duration` (1.5 s) = 0.6. |
| M-K10 | Engine.ts:973 | 0.2 | Floor on the attack-rate multiplier: a fighter can be slowed at most 5×. | D | 1/`MAX_SLOWDOWN` with `MAX_SLOWDOWN = 5`. |
| M-K11 | Engine.ts:873 | 1.4 | `knockbackMul` above which a skill counts as a thrust (for grip). | D | The median `knockbackMul` of the power skills. Name it `THRUST_KNOCKBACK_MIN`. |
| M-K12 | Engine.ts:1401 | `max(3, vClose + 3)` | Swing speed for the impulse. The comment calls 3 a "floor", but `vClose ≥ 0` (Physics.ts:283), so `max` never binds and 3 acts as an **offset**. | D | v_swing = v_weapon + v_close, where v_weapon = 3 m/s = ω_arm·ℓ_ref (≈ 1.6 rad/s · 1.9 m). Drop the `max`. |
| M-K13 | Engine.ts:1400, 1408 | 0.5 m | Lever arm in ω = J/(m·0.5). | D | Lever = shoulder height above the centre ≈ 0.28·H. |
| M-K14 | Engine.ts:1419 | 0.15 | Armour mass per armor point, as a fraction of body mass. | D | Today `0.15·armor` gives 0.30–0.98 × body mass across the armor range 2–6.5 (Stats.ts:83), which is implausible. Recommend `armorMass = m·k_plate·min(1, armor/A_sat)` with `k_plate = 0.3` (full plate ≈ 30% of body mass). Flag for design. |
| M-K15 | Engine.ts:1415-1416 | `?? 10` | Defaults for non-optional stats. | — | Delete them; the type guarantees a value. |
| M-K16 | Engine.ts:1149 | 7 m/s | Horizontal speed above which a fighter ragdolls. | D | v_ragdoll = 1.08·v_run ≈ "thrown faster than you can run". Or name it `RAGDOLL_SPEED`. |
| M-K17 | Engine.ts:1149, 1659, 2181 | upward 3, 1.6, 5 | Initial upward speed of a ragdoll. | D | v_up = √(2·g·h_apex), with h_apex = 0.10·H, 0.03·H, 0.29·H. Name each apex. |
| M-K18 | Engine.ts:1154 | 2.5 s | Ragdoll timeout. | D | 2.5 ≈ 3·T_f. Name it `RAGDOLL_MAX_AGE`. |
| M-K19 | Engine.ts:1694 | `√(2·24·|RING_OUT_FLOOR|) + 0.2·|vy|` | Impact speed on returning from the void. The `24` is a retyped `ARENA_GRAVITY`. | D | v_imp = g·T_f (19.6 m/s) using the imported constant. Justify the 0.2·|vy| term or drop it. |
| M-K20 | Engine.ts:83, 589, 1875 | −8, −10, −9.5 | Ring-out trigger height, void plane, and body clamp floor. Three floors. | D | `RING_OUT_FLOOR = −½·g·T_f²` (−8.0); `VOID_Y = RING_OUT_FLOOR − H` (−9.8); clamp to `VOID_Y + r`. |
| M-K21 | Engine.ts:1666 | 2 m (min 0.5) | How far inside the edge a returned fighter is placed. | D | R(θ) − m_e·r·(4/3) = R − 2.0. Better: reuse `EDGE_MARGIN` (1.5) + r. |
| M-K22 | Stats.ts:150 | 1.40 | Crit multiplier, retyped although `CRIT_MULT = 1.4` exists (Stats.ts:50). | D | Use `CRIT_MULT`. |
| M-K23 | Stats.ts:75 | 5 | "Average defender" resilience used to price in crit. | D | mean(PRIMARY.resilience) = 38/8 = **4.75**. Compute it like `AVERAGE_BODY` (Stats.ts:126-130). |
| M-K24 | Stats.ts:90, 107, 152 | 0.04 | Damage reduction per armor point. | N | Base T13 (κ_a). |
| M-K25 | Physics.ts:244, 255; Engine.ts:1123, 1263 | /8 | armor → plating fraction. | N | Base T12 (A_sat). |
| M-K26 | Physics.ts:262-273 | 0.55, 0.30, 0.25; 0.85 + 0.15·min(2, v) | physicsMul coefficients. Equal bodies give 1.10 × closing, i.e. 0.935 at rest and **1.10** at the harness's 1 m/s. The multiplier is not normalised. | D | Normalised form: `(w0 + wm·m_a/m_d + wρ·ρ_a/ρ_d) / (w0 + wm + wρ) · (1 + c_v·(min(v, v_cap) − v_ref))`, with v_ref = `HARNESS_CLOSING_SPEED` (1, the measured median, ArenaHarness.ts:6-7, 41-42) and c_v = 0.15. This gives exactly 1 for equal bodies at the median closing speed. Changing it rescales every blow, so re-run the calibration (statistics.md, S-5). |
| M-K27 | Physics.ts:267-268 | 0.6, 1.8 | physicsMul clamp. Nearly log-symmetric: 1/1.8 = 0.556. | D | [1/k, k] with k = 1.8. That makes the clamp sign-symmetric in ln-space (an attacker's edge and a defender's edge are mirror images). |
| M-K28 | Physics.ts:250-255 | 42, 3.5, 1.4, 1.1, 0.055, 0.0016, 0.22, 0.006, 0.15, 0.004, 0.62/0.38, 0.24 | `bodyFromStats` coefficients. | N | Already documented in the header (Physics.ts:241-244). Group them as `BODY_COEF`, like `COEF` in Stats.ts:39. ⚠ Restitution 0.24 here vs `DEFAULT_MATERIAL` 0.28 (Physics.ts:38). |
| M-K29 | Physics.ts:79, 203, 207, 210, 229 | 0.4/0.6, 1.05, 0.15, 0.05, 0.9 | Toughness split, breach ratio, minimum retained speed, self-damage scale, fall scale. | N | Already named in the header formulas (Physics.ts:12-17); promote them to constants. |
| M-K30 | Physics.ts:160 | 0.12 | `Impact.knockback` metres per (J/m). It is never read. | — | Delete it, or use it as the launch model in place of M-K5. |

*§4–§6 follow.*

## 4. Arena, world and perception

| ID | File:line (anchor) | Value | Meaning | D? | Proposed derivation |
|---|---|---|---|---|---|
| M-A1 | Engine.ts:83 `RING_OUT_FLOOR` | −8 | Height that counts as having left the world. | D | `−½·g·T_f²` (M-K20). |
| M-A2 | Engine.ts:49 `PICKUP_REACH` | 0.6 | Pickup collection distance from the centre. Coins use `itemRadius + body.radius` instead (Engine.ts:1176), so the two collection rules differ. | D | reach = r + `def.radius`, the same rule as coins. |
| M-A3 | Engine.ts:51 `PICKUP_COUNT` | 6 | Drops per match. It does not scale with arena size, which ranges over 2–320 m (ArenaConfig.ts:35). | D | count = round(ρ_pickup·π·R_in²) with ρ_pickup = 6 / (π·(12/2·0.82)²) ≈ 0.079 /m² at the default size 12. Clamp it to [2, 24]. |
| M-A4 | Engine.ts:520 (`#spawnPickups`) | 0.82 | Fraction of the inscribed radius used for spawning pickups. | D | R_in − m_e·r (keep them clear of the edge band). |
| M-A5 | Engine.ts:545-550 (`#ringHalf`) | 16 samples | Inscribed radius = min R(θ) over 16 bearings. With n = 16 it can miss a polygon's narrow corners. It also runs several times per frame (Engine.ts:1001, 1129, 1166, 1810-1811). | D | Compute it once per match from `outline(cfg, 96)` and cache it. |
| M-A6 | Engine.ts:677 | 8, `LIVE_ARENA_MAX` (=120, Menu.ts:13) | Clamp on a rolled arena's size. | D | The 8 is derivable exactly: size_min = 2·(spawnHalf + m_e·r) = 2·(2.5 + 1.5) = **8**, i.e. both spawns stay out of the edge band. Write it that way, so the minimum follows if the spawn or margin changes. |
| M-A7 | Engine.ts:691 (`#startFight`) | `min(2.5, half·0.4)` | Half the spawn separation. | D | (ℓ_max + 2r)/2 + 0.5 = (2.8 + 1.2)/2 + 0.5 = **2.5**: start just outside the longest weapon's reach, with 0.5 m of air. |
| M-A8 | Engine.ts:692-693 | `(rand − 0.5)·(half − 2)` | Spectate spawn spread. | D | ±(R_in − EDGE_MARGIN − r)/2. |
| M-A9 | Engine.ts:1054, 1306 | 1.5 | "Near edge" distance for the AI. Duplicated. | D | Base T18: m_e·r. |
| M-A10 | Engine.ts:1001; Disposition.ts:114-116 | −0.8, −1.2, ×0.6 | Three margins stacked on the roam radius: r_eff = 0.6·(R_in − 0.8 − 1.2). | D | One margin: r_roam = R_in − EDGE_MARGIN − r, passed as `bound` with no internal shrink. |
| M-A11 | Disposition.ts:115-116 | 0.37, 0.29 rad/s; ±0.4 jitter | Lissajous frequencies and roll jitter. Engine passes `roll: 0.5` (Engine.ts:1002), which makes the jitter term zero. | N | Name the frequencies. Feed `roll` from the item RNG, or delete the term. |
| M-A12 | Disposition.ts:22 `DEFAULT_TIMING` | 3 + 3 s | Default truce phases. Engine overwrites them with `roamSeconds/2` (Engine.ts:709), whose default is 6 (ArenaConfig.ts:51). | D | `DEFAULT_TIMING = split(PARAM_BY_KEY.roamSeconds.def)`, with one source of truth. |
| M-A13 | Engine.ts:1163-1166 | 60, 0.1, 3, 1.5 | Coin period = 60/itemRate (`itemRate` is per minute, ArenaConfig.ts:62); at most 3 live coins; spawn ring R_in − 1.5. | D | 60 = seconds per minute (fine; name it). Max coins = ⌈itemRate·t_coinLife/60⌉. Spawn margin = EDGE_MARGIN. |
| M-A14 | Engine.ts:1129 | `min(60, half + 2)`, `max(0.5, half/48)` | Fog-grid half-extent and cell size. Cell = R_in/48 targets about 96 cells across. The 60 m cap matches the sight cap (M-P2), but an arena can reach R ≈ 60 at size 120. | D | half = R_circ + r (cover the corners, not the inscribed circle); cell = 2·half / N_cells, with N_cells = 96 named. |
| M-A15 | Engine.ts:1474, 1497 | 4 px probe, 3.5 px dot | Minimap sampling step and marker size. The canvas is 132 px wide (Engine.ts:795), so 33 probes per side, while the fog grid has about 96 cells: the minimap under-samples the fog by about 3×. | D | probe = W / N_cells; dot = max(3, r·scale). Lane F owns the minimap rework. |
| M-A16 | Engine.ts:422, 1487; ArenaPhysics.ts:135 | 96, 48 | Outline segment counts for the floor, the wall and the minimap. | D | n = clamp(⌈2π·R_circ / s_seg⌉, 24, 192) with s_seg = 0.5 m. |
| M-A17 | Engine.ts:441 (`#buildArena`) | 9000 | Normaliser for wall "toughness" colour. It is neither the parameter's max (20,000) nor its default (2,200) (ArenaConfig.ts:38). | D | tough = ln(R/R_min) / ln(R_max/R_min) with R_min, R_max from `PARAM_BY_KEY.wallResistance`. Log scale, because the range spans 200×. |
| M-A18 | Engine.ts:426, 430, 446, 458, 462 | 0.6 depth; +0.05 overlap; 0.35 thick; `size·4 + 80`; −0.01 | Floor slab, wall segment overlap and thickness, outside-ground plane size, z-fight offset. | D | slab = r; overlap = wallThickness/7; outside plane = 4·size + 80 → 2·(R_circ + view distance). Keep −0.01 as `Z_FIGHT_EPS`. |
| M-A19 | Engine.ts:563-576 (`#rebuildTerrain`) | hill positions and sizes; river 2.5 wide, banks at ±1.5 | Decorative layout. | A | Superseded by lane E's heightfield (R07). Delete it once that lands. |
| M-A20 | Terrain.ts:26-28 | 0.35, 0.6, 0.85 | Concentric material bands as fractions of the inscribed radius. | N | `MATERIAL_BANDS`. The ice band starts at 0.85, so its width is 0.15·R_in: 0.9 m (1.5·r) in a 12 m arena, and 9 m in a 120 m one. Consider a band width fixed in metres (k·r) rather than as a fraction. |
| M-A21 | Terrain.ts:12-15 | speed / turn / stop per material | Surface table. `turn` is read nowhere. | N | Keep the table. Rename `stop` to `stopTimeConstant` (s). Delete `turn`, or wire it into `movementStep`. |
| M-P1 | Engine.ts:1118, 1260 | 0.1 / 0.8 | Agitation in the truce and in the fight. Duplicated. | N | `AGITATION_CALM`, `AGITATION_FIGHT`, set in one `#agitation()`. |
| M-P2 | Engine.ts:1134 | 60 | Cap on the fog-reveal radius. | D | min(sight, half_fog). It is the same 60 as M-A14, so give it one name. |
| M-P3 | Engine.ts:1234 (`#coinTarget`) | 0.9, 0.5 | Eye height and the fourth `itemNoticed` argument. | D | eye = 0.93·H − ... (as M-C8). The second literal is unnamed at the call site: use a named argument. |
| M-P4 | Engine.ts:1259 | 0.05; ratio `adapted.sight / base.sight` | Scales **every** sense's stimulus distance by the *sight* ratio. Hearing is therefore weakened at night like sight. | D | One ratio per sense: `distance / (adapted[s]/base[s])`. That needs `sensesTouching` to take per-sense scales. |
| M-P5 | Senses.ts:21-34, 54-58, 97-107 | base ranges, falloffs, gear coefficients, lens shape (0.72, 0.55, 0.35, 1.35, ×0.5) | Perception tuning. | N | Already named as constants. ⚠ The `×0.5` in `fl` (Senses.ts:107) is not in the formula documented at Senses.ts:90. |
| M-P6 | Ranking.ts:26-29 | engageRange 2.4 / 1.8 / 1.7 / 1.3 m | AI engage distances, absolute in metres and independent of the weapon (reach 1.1–2.8, Weapon.ts:40-46). The sentinel's 1.3 m is shorter than 6 of the 7 weapon reaches. (How `engageRange` gates movement inside AiBrain was not read.) | D | engage = k_arch·reach, with k = 2.4/1.9 = 1.26, 0.95, 0.89, 0.68 (normalised to ℓ_ref = 1.9). |
| M-P7 | SkillRuntime.ts:114-116 | +0.4, +1.4, 0.42 | AI skill triage: "in reach" margin, "far" margin, "hurt" HP ratio. | D | in reach: `dist ≤ reach + r_defender` (the hit rule, Engine.ts:1360); far: `> reach + 2·r + 0.2`; hurt: name it `HURT_RATIO`. |
| M-P8 | Engine.ts:1978 | +0.6 | Aura "in reach" margin. | D | Same as the hit rule: + defender.radius. |

## 5. Rendering look (art constants: give them names, no derivation)

| ID | File:line | Values | Note |
|---|---|---|---|
| M-L1 | Engine.ts:357-361 | shadow map 1024; camera ±14, near 1, far 170; bias −0.0008, normalBias 0.02 | ±14 is overwritten by M-L2. Make the map size depend on the device tier (R13). |
| M-L2 | Engine.ts:391-393 | `ext = min(30, 12 + 6/max(0.12, tan(max(elev, 0.05))))`, hysteresis 0.5 | Derivable: ext = R_circ + h_caster/tan(elev), with h_caster = tallest prop or wall (6 is implicit) and a cap from the shadow-map texel budget: ext_max = 1024·texel_target / 2. |
| M-L3 | Engine.ts:384-405 | sun distance 60 and moon 30; sun ×1.6, moon ×2.5, cel moon ×3, ambient 1.6 and ×1.5; moon tint (0.5, 0.66, 1.1); fog 45..700; light floors 0.03 and 0.1; shadow threshold 0.05 | Name them in one `LIGHTING` block. Normalisation suggestion: choose the gains so that `k_key·I_key + k_amb·I_amb = E_target` at noon and at full moon, which turns five free gains into two targets. |
| M-L4 | Engine.ts:407 | place tints | Move them into `PLACES` (Environment.ts) beside each place. |
| M-L5 | Engine.ts:647-660, 1991-1992 | aura ring 0.6–0.8, wedge 0.22 at −0.92, contact 0.55 α0.32, lift 0.02; truce scale +0.35; pulse 0.75 + 0.25·|sin(t·(2 + 0.05·meter))| | Ring radii are derivable from r: inner = r, outer = 1.33·r, wedge at outer + 0.2·r. |
| M-L6 | Engine.ts:533-534, 1197, 1203 | marker radius ×0.5, y 0.5; coin 0.12 thick, y + 0.06 | y + 0.06 = thickness/2: derive it. |
| M-L7 | Engine.ts:2133-2140 | +0.2, `occlusionAlpha(d, 1.5, 6, 0.12)`, 0.6, 0.03 | Occlusion fade: corridor radius, near and far distances, minimum alpha, depthWrite cut-off, hide cut-off. |

## 6. Signs, inversions and coefficients

Each row is a sign or axis flip in the code: whether it is correct, and what it implies.

| ID | Where | What the code does | Verdict |
|---|---|---|---|
| S-1 | Engine.ts:1819 and 1835 | `keyZ: −move.z`, then `fwd = −analog.z`, on top of Input's z = −1 for KeyW. Three negations: the forward key walks away from the opponent. | **Bug**, confirmed in BRIEF.md:37-41. The parent is fixing it (R14). After the fix, keep one convention: forward = +1 at the edge of the input layer. |
| S-2 | Engine.ts:2046-2051 | `sh` is documented as the "right-shoulder offset", and the offset is `sh·(−1)·(cos yaw, −sin yaw)`. Camera forward is f = −(sin yaw, cos yaw). By the file's own right-vector rule (Engine.ts:1826: right = (−f_z, f_x)), right = (cos yaw, −sin yaw), so `·(−1)` puts the camera on the **left**. | The comment or the sign is wrong. Decide which shoulder you want and remove the stray `·(−1)`, or rename it `leftShoulder`. |
| S-3 | Engine.ts:1404-1407 | Facing is defined as `f = −(dx, dz)/d`, exactly anti-parallel to the blow direction `(dx, dz)/d`. Their 2-D cross product `fx·dz/d − fz·dx/d` is therefore **identically 0**, so `side` is pure noise from `(Math.random() − 0.5)`. | **Hidden bug.** Use the defender's real facing (`rig.group.rotation.y` or the velocity heading), or the attacker's swing plane (`#swingIndex` parity), for the side. |
| S-4 | Engine.ts:1937, 1943 | The palm is `(sin(pitch)·−1, cos(pitch), 0)` and the pitch is `atan2(−tip.x, tip.y)`, a double negation. But when a skill is held, `pitch = gp.pitch` and the palm is never used; when not held, the palm is always up, so `pitch = 0`. | **Dead computation.** `pitch = skillHeld ? gp.pitch : 0`. Delete `weaponFromPalm` / `palmIsUp` from this path, or make the palm drive the pitch for real. |
| S-5 | Engine.ts:1408 | `applyImpulse(−J/(m_d·0.5), side)`. The minus sign is the convention that a blow tips the defender backward. | Correct as a convention, but undocumented. State the skeleton's sign rule at the call site. |
| S-6 | Engine.ts:424, 429-430 | Floor shape built from `(x, −z)` and rotated by `−π/2` about X. The two flips cancel: the shape maps to world (x, 0, z), and the extrusion runs +y from −0.6 to 0. | **Correct** double flip. Add a one-line comment. |
| S-7 | Engine.ts:448 | Wall segment `rotation.y = −atan2(dz, dx)`. | Correct for three.js (a positive Y rotation maps +x to (cos, 0, −sin)). Comment it. |
| S-8 | Engine.ts:652-653 | Wedge at local −y on a ring rotated −90° about X, which maps to world +z (facing). | Correct and commented. |
| S-9 | Skills.ts:106-112 | Shoulder amplitudes are negated because a negative angle raises the arm. | Correct and commented. Should move into `Skeleton`'s joint definition, so tracks can use "raise = +". |
| S-10 | Engine.ts:2038-2039 | `orbitYaw −= md.x·k` and `pitch += md.y·k`. | Non-inverted orbit: moving the mouse down raises the camera. State it, and expose an "invert Y" setting. |
| S-11 | Engine.ts:1145; Status.ts:37 | `hp −= dot·DAMAGE_SCALE`; blessed has `dps = −5`, so it heals (capped at maxHealth). | Correct. The sign carries the meaning; document "dps > 0 hurts". |
| S-12 | ArenaPhysics.ts:79-81 | Wall rebound `v += (−retained − v_r)·n̂`. | Correct reflection: it replaces the outward component with an inward one of size `retained`. |

**Coefficient attribution (the damage product).** Engine.ts:1386 multiplies seven factors:
`dmg = base · damageMul · statusMul · physicsMul · rage · ward · block`. In log form each factor
adds a signed contribution, `ln dmg = Σ ln f_i`. Today only `physicsMul` is clamped ([0.6, 1.8]),
while `statusMul` is floored only inside `#swingCooldown` (Engine.ts:973), not here. The proposed
normalisation is to give each factor a declared range, so the total spread is bounded:
`ln f_i ∈ [ln lo_i, ln hi_i]`, with `Σ ln hi_i − Σ ln lo_i` set to the target log-spread (statistics.md, S-6).
