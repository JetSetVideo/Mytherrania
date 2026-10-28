# Lane H: vocabulary and derived-constants review (R08 + R10)

Written 2026-10-28. Analysis only: **no source file was edited, and no command, test or game was run.**
Every finding cites a `file:line` that was read. Numbers marked "(hand)" were computed by hand from
cited literals.

## Files

| File | What it is |
|---|---|
| `docs/GLOSSARY.md` | Every domain term, each with a definition, unit/range, source line, synonyms, ⚠ flags for inconsistent words, and a ✅ canonical word. Sections: A maths and statistics (MathCore + BRIEF terms: lambda, halfLife, spread, share, Pareto), B fighter/body/rig, C combat, D skills, E statuses/pickups, F arena/world, G perception/fog, H character creation, I AI/ranking, J records/screens, K sign conventions, L canonical-word table. |
| `docs/review/magic-numbers.md` | About 100 numeric literals (106 rows): file:line, value, meaning, whether derivable, and the proposed equation. §0 is the proposed **19-base `Tuning` set**. §6 lists every sign flip and inversion found, plus the coefficient attribution of the damage product. |
| `docs/review/vocabulary.md` | Naming findings P1/P2/P3 (V-01…V-62), function splits with their parameters (F-1…F-9), and duplicated logic to factorise (D-1…D-17). |
| `docs/review/statistics.md` | Where distributions are or should be computed, the plan targets (48–52% pairwise, 49.4–50.6% field-wide, 10k fights/pair), sampling-noise analysis, and the normalisation equation for each metric. |
| `docs/review/_notes.md` | The raw evidence log behind all of the above (scratch; one line per fact read). |

**Line-number caveat.** Engine.ts was 2,574 lines when read, matching the snapshot `c5b55af` and BRIEF's
cited lines 1819/1835. The parent was editing it concurrently: it was 2,620 lines at the end of the
review. Every Engine finding names its method, so it can be found again.

## Top 10 actionable items (priority order)

1. **Skill damage-over-time is about 100× too weak, and it ignores the truce.**
   - Engine.ts:1802-1808 subtracts `dps·dt` without `DAMAGE_SCALE`: 14 HP of a 34–58k HP bar.
   - It adds 11.2 knockback-meter points.
   - Status DoT does scale (Engine.ts:1145) and is truce-gated.
   - Fix: one `#applyDot(f, briefUnits)`, and declare the unit in `SkillPayload.dot`. *(vocabulary.md V-09)*
2. **`createFighter(…, radius)` puts the radius into `y`.**
   - The forwarding happens at Fighter.ts:39 via `body(x, y, z)`.
   - The collision radius is always 0.6 (SmashPhysics.ts:16).
   - `PLAYER_RADIUS = 0.5` is effectively a spawn height.
   - Fix: an options object, and r = H/3 from `Tuning`. *(V-01, M-B1)*
3. **Statuses double-dip.**
   - `StatusDef.attackMul` is documented as a *rate* (Status.ts:18-19), but Engine uses it both as the
     swing-rate divisor (Engine.ts:973) **and** as a damage factor (Engine.ts:1373, 1386).
   - Result: hasted = 1.69× DPS, chilled = 0.56×.
   - Fix: split it into `attackRateMul` and `damageMul`. *(V-13, statistics S-6)*
4. **Factor the two AI act functions into `#botAct(self, rival, dt)`.**
   - `#playerAct` (Engine.ts:1298-1336) duplicates about 45 lines of `#opponentAct` (Engine.ts:1015-1085).
   - It also lacks the truce roam, coin distraction and perception, so spectate (AI-vs-AI) fights, and
     the MMR ladder fed by them, are asymmetric.
   - The same asymmetry hits the surface drag: the player's is applied only when *not* spectating
     (Engine.ts:1846-1847 vs 1876-1877).
   - Fix: `#applySurfaceDrag(f, material, dt)`. *(V-07, V-08, D-1…D-3)*
5. **The impact "side" is pure noise.**
   - The defender's facing is defined as minus the blow direction, so their cross product is
     identically 0 (Engine.ts:1404-1407).
   - Fix: use the defender's real heading. *(magic-numbers S-3, V-02)*
6. **Footsteps play every 0.35 s even when nobody moves.**
   - The timer grows every frame (Engine.ts:1777, 2107), and `playStep` is ungated (AudioManager.ts:31).
   - Fix: gate it on `moving`, and derive the interval Δt = stride / speed with stride = 0.75·H.
     That gives 0.21 s at the run speed and 0.32 s at the AI speed. *(V-10, M-T3)*
7. **Camera: replace the dead "adaptive" logic with one framing equation.**
   - `#camHeight` is never read.
   - `#camDist` is clamped to 5.5 below a target that is ≥ 7 (Engine.ts:2008-2011, 2043).
   - The "right-shoulder" offset is on the left (Engine.ts:2046-2051).
   - The first-person eye sits at 1.1 m (Engine.ts:2024).
   - Fix: d = H / (2·fill·tan(fov/2)) = 5.51 m at fill 0.35, plus a separation term, and a signed
     `SHOULDER_SIDE`. *(V-03, V-11, M-C1…M-C8, S-2)*
8. **Statistics.**
   - The character creator shows **invented** min/max/avg/median (Races.ts:52-67 → Menu.ts:355-373).
     Compute them with `summarize` over the eight classes.
   - Unify the 3 sample-summary functions, 2 Wilson intervals and 4 PRNGs into MathCore.
   - Make the harness report `summarize` of the 28 pair rates, the field shares, and z-scores.
   - Note that 48–52% is only attainable from noise at n ≈ 10k: at the 1,500-fight calibration, a
     perfectly balanced pair misses the band 12% of the time (hand). The recorded pair spread is
     0.12 against a 0.04 target. *(statistics S-1, S-3, S-4; D-12…D-14)*
9. **R08: introduce `Tuning` (the 19 bases in magic-numbers §0) and migrate in this order.**
   - The cheap, certain ones first:
     - `ARENA_GRAVITY` instead of the literal 24 (Engine.ts:1694);
     - `CRIT_MULT` instead of 1.40 (Stats.ts:150);
     - `ARMOR_SATURATION` (= 8, ×4 sites) and `ARMOR_DR_PER_POINT` (= 0.04, ×3 sites);
     - frame-rate-independent easing via `damp` for the coin spin, occlusion fade, velocity EMA and
       camera (M-T1, T9, T10, T13);
     - one `RING_OUT_FLOOR`-derived void height (M-K20).
   - Then normalise `physicsMul` so equal bodies at the median closing speed give exactly 1. Today it
     gives 1.10; re-run the calibration afterwards. *(M-K26, statistics S-5)*
10. **R10: apply the canonical words and split the two giant methods.**
    - Canonical words:
      - `skill` (not technique/power);
      - `KinematicBody` / `MassBody`;
      - `knockbackMeter` (and stop reading it as "stamina", Engine.ts:1418);
      - `hostile` (not `enemy`);
      - `inscribedRadius` (not `#ringHalf`);
      - face states named for the expression, not the event (Engine.ts:1560-1567).
    - Splits: `#loop` (about 345 lines) and `#resolveHit` (about 100 lines), with the parameters listed
      in F-1 and F-2. *(GLOSSARY §L; V-05, V-06, V-14, V-30, V-46; F-1, F-2)*

## Not done / not verified

- **Nothing was executed.** No game, test or harness was run. All "hand" numbers are arithmetic on
  cited literals, not measurements.
- **Code not read** (findings avoid claims about it):
  - Skills.ts:161-370, except grepped cooldowns and dot;
  - AiBrain internals, so how `engageRange` is used is unknown;
  - PowerUps values (rage/ward multipliers);
  - Ranking `recordMatch`;
  - CombatLog, TrainingRuns, BattleCorpus, the Neural* modules and EvolutionHarness beyond greps;
  - Humanoid.ts and the other graphics modules;
  - most of Menu.ts and UiTree.ts beyond greps;
  - AudioManager beyond line 31.
- **Lane folders in progress** (src/graphics/body, paint, fx, src/game/anim, src/world, src/ui
  new files) were deliberately not reviewed. One grep hit in src/world is cited only to note that lane E
  already uses `summarize`.
- **No `docs/overhaul/lane-H.md`.** This lane's write scope is limited to `docs/GLOSSARY.md` and
  `docs/review/**`, so this README is the handoff. The parent may copy it there.
- **Already owned by the parent:** the R14 movement/keybinding comments (V-22, S-1). They are listed for
  completeness only.
