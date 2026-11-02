// Tests that pin the cross-module BOUNDS: the equations that tie one module's output
// to another module's input. Each test is the executable form of a row in
// docs/SPEC.md, so the spec cannot drift from the code without a test failing.
import { luminosity } from "../src/graphics/Environment.ts";
import { adaptedRanges, NEUTRAL_ENV } from "../src/game/Senses.ts";
import { bodyFromStats, closingSpeed, density, physicsMultiplier, PHYSICS_MUL_MAX, PHYSICS_MUL_MIN, totalMass } from "../src/game/Physics.ts";
import { attackDamage, CLASSES, createStats, criticalChance, DAMAGE_SCALE, FIGHT_LENGTH, HEALTH_SCALE } from "../src/game/Stats.ts";
import { HARNESS_CLOSING_SPEED } from "../src/balance/ArenaHarness.ts";
import { applyRaceBonus } from "../src/game/Races.ts";
// Wave H (ancestry hierarchy, hair physics, match telemetry, data science).
import { ANCESTRY, ancestryOf, hairMassKg, METRICS, RACE_IDS, rankOf, type HairPhysicsSpec } from "../src/game/Ancestry.ts";
import { SecondaryMotion } from "../src/game/anim/SecondaryMotion.ts";
import { generationId, highlights, parseHistory, statGapOf, type FighterRecord, type MatchRecord } from "../src/game/MatchHistory.ts";
import { MATCH_TIME_LIMIT_MAX_S, MATCH_TIME_LIMIT_MIN_S, MATCH_TIME_LIMIT_S, resolveTimeLimit } from "../src/game/MatchControl.ts";
import { timeLimitVerdict } from "../src/game/WinConditions.ts";
import { budgetForLevel, generateSpectateCard, levelForBudget, spendBudget, techniquesFor } from "../src/game/SpectateGen.ts";
import { highlightsOf } from "../src/ui/HistoryView.ts";
import { keyVars, pca, spreadOf, standardise } from "../src/balance/CorpusMath.ts";
import { statDelta } from "../src/game/Races.ts";
import { skillsForClass } from "../src/game/Skills.ts";
import { SKILL_RESOURCE_COST } from "../src/engine/Engine.ts";
// Wave I (spectator camera, inspect overlay, terrain fill, clash sparks, frame budget).
import { CAMERA_PRESETS, cameraPose, cycleMode, decodeSpectateCam, encodeSpectateCam, orbitCamera, SPECTATE_CAM_BOUNDS, SPECTATE_CAM_DEFAULTS, zoomCamera } from "../src/game/SpectatorCamera.ts";
import { anchorCard, BAR_SEGMENTS, barLabel, barModel, barSegments, blobRadius, fighterCard, inspectBarSegments, objectCard, pickNearest, stepCursor, type CursorState } from "../src/ui/InspectOverlay.ts";
import { footHeight, materialUnder, seatingY, skirtFor } from "../src/graphics/GroundFill.ts";
import { canClash, clashStrength, detectClash, segSegClosest } from "../src/combat/Clash.ts";
import { ClashSparks, DEFAULT_MAX_SPARKS, SPARKS_PER_BURST } from "../src/graphics/fx/ClashSparks.ts";
import { EffectsGovernor, percentile, summarise } from "../src/game/FrameBudget.ts";
// Wave L (creation and menu components: étendards, the dice roll and its sheet, closed trees).
import { raceBanner } from "../src/ui/RaceBanners.ts";
import { creatorSheet, rollProfile } from "../src/ui/CreatorRoll.ts";
import { DISCLOSURE_STORAGE_KEY, decodeDisclosure, encodeDisclosure, groupKey, initialDisclosure, isOpen, toggleGroup } from "../src/ui/Disclosure.ts";
import { defaultOpenGroups, UI_TREE } from "../src/ui/UiTree.ts";
import { RACES } from "../src/game/Races.ts";
import { stunDuration } from "../src/physics/SmashPhysics.ts";
import { DEFAULT_TIMING, truceSeconds } from "../src/game/Disposition.ts";
import { HAIR_LENGTH_M, raceBuild, RACE_BUILDS } from "../src/game/RaceAppearance.ts";
import { applySecondary, combineSecondary } from "../src/game/SecondaryStats.ts";
import { SPINE_COUNT, spineColumn } from "../src/game/SpineCurve.ts";
import { clampFace, FACE_BY_STATE, NEUTRAL_FACE } from "../src/game/FaceMorph.ts";
import { classTensors } from "../src/game/AnimTensor.ts";
import { expectedScore, mmrAfter, START_MMR } from "../src/game/Ranking.ts";
import { keyAngle, stanceTransitions } from "../src/game/StanceAnim.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

// ---------------------------------------------------------------- luminosity

Deno.test("SPEC L1: luminosity is monotonic in sun elevation and bounded, for every cloud cover", () => {
  for (let c = 0; c <= 1.0001; c += 0.25) {
    let prev = -1;
    for (let deg = -30; deg <= 90; deg += 1) {
      const l = luminosity((deg * Math.PI) / 180, c);
      assert(l >= prev - 1e-12, `luminosity fell at ${deg} deg, cloud ${c}`);
      assert(l >= 0.04 * (1 - 0.45 * c) - 1e-12 && l <= 1 + 1e-12, `luminosity ${l} out of bounds at ${deg} deg, cloud ${c}`);
      prev = l;
    }
  }
  assert(Math.abs(luminosity(-0.5, 0) - 0.04) < 1e-9, "deep night is the 0.04 starlight floor");
  assert(Math.abs(luminosity(1.2, 0) - 1) < 1e-9, "high sun saturates to 1");
});

Deno.test("SPEC L2: cloud cover dims light by at most 45%", () => {
  const clear = luminosity(0.8, 0), overcast = luminosity(0.8, 1);
  assert(Math.abs(overcast / clear - 0.55) < 1e-9, `full overcast should keep 55%, kept ${(overcast / clear).toFixed(3)}`);
});

// ---------------------------------------------------- luminosity -> senses

Deno.test("SPEC S1: night shortens sight and lengthens hearing (the coupling, end to end)", () => {
  const gear = { helmet: 0, armour: 0.5, race: {} };
  const day = adaptedRanges(gear, { ...NEUTRAL_ENV, luminosity: luminosity(0.9, 0.2) });
  const night = adaptedRanges(gear, { ...NEUTRAL_ENV, luminosity: luminosity(-0.4, 0.2) });
  assert(night.sight < day.sight * 0.5, `night sight ${night.sight.toFixed(1)} should be < half of day ${day.sight.toFixed(1)}`);
  assert(night.hearing > day.hearing, "hearing must be longer at night");
  assert(night.sight > 0, "sight never reaches zero");
});

// ---------------------------------------------------- stats -> body -> physics

Deno.test("SPEC P1: strength makes a body DENSER, not only heavier", () => {
  const weak = bodyFromStats({ strength: 2, vitality: 5, resilience: 5, reflex: 5, armor: 3 });
  const strong = bodyFromStats({ strength: 10, vitality: 5, resilience: 5, reflex: 5, armor: 3 });
  assert(totalMass(strong) > totalMass(weak), "strength adds mass");
  assert(density(strong) > density(weak), "and density, because it adds mass faster than volume");
});

Deno.test("SPEC P2: the physics multiplier is bounded and equals 0.935 for equal bodies at rest", () => {
  const b = bodyFromStats({ strength: 6, vitality: 6, resilience: 6, reflex: 6, armor: 4 });
  assert(Math.abs(physicsMultiplier(b, b, 0) - 0.935) < 1e-9, `equal bodies at rest: ${physicsMultiplier(b, b, 0)}`);
  for (const c1 of CLASSES) for (const c2 of CLASSES) for (const v of [0, 1, 3, 10]) {
    const m = physicsMultiplier(bodyFromStats(createStats(c1)), bodyFromStats(createStats(c2)), v);
    assert(m >= PHYSICS_MUL_MIN && m <= PHYSICS_MUL_MAX, `${c1}->${c2} v=${v}: ${m} escaped [0.6,1.8]`);
  }
});

Deno.test("SPEC P3: every class has a distinct body, and the heaviest is the Barbarian", () => {
  const masses = CLASSES.map((c) => [c, totalMass(bodyFromStats(createStats(c)))] as const);
  assert(new Set(masses.map(([, m]) => m.toFixed(3))).size >= 6, "class bodies should be distinct");
  const heaviest = masses.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert(heaviest[0] === "Barbarian", `heaviest class should be Barbarian, got ${heaviest[0]}`);
});

Deno.test("SPEC P4: closing speed only ever raises the multiplier, saturating at |v| = 2", () => {
  const a = bodyFromStats(createStats("Warrior")), d = bodyFromStats(createStats("Mage"));
  const at0 = physicsMultiplier(a, d, 0), at2 = physicsMultiplier(a, d, 2), at9 = physicsMultiplier(a, d, 9);
  assert(at2 >= at0, "moving should not weaken a blow");
  assert(Math.abs(at9 - at2) < 1e-9, "the closing term saturates at |v| = 2");
});

Deno.test("SPEC P5: closing speed is relative — a fleeing defender softens the blow, a slow one does not", () => {
  // Attacker charges +x at 3 m/s; defender is ahead along +x.
  const still = closingSpeed(3, 0, 0, 0, 1, 0);
  const fleeing = closingSpeed(3, 0, 2, 0, 1, 0);
  const meeting = closingSpeed(3, 0, -1, 0, 1, 0);
  assert(Math.abs(still - 3) < 1e-12, "a standing defender takes the full 3 m/s");
  assert(Math.abs(fleeing - 1) < 1e-12, "a defender fleeing at 2 m/s cuts it to 1");
  assert(Math.abs(meeting - 4) < 1e-12, "a defender stepping in adds to it");
  assert(closingSpeed(0, 0, 5, 0, 1, 0) === 0, "moving apart is floored at 0, never negative");
  assert(closingSpeed(0, 3, 0, 0, 1, 0) === 0, "sideways motion does not count as closing");
});

// ---------------------------------------------------- health scale -> stun

Deno.test("SPEC H1: every class's average hit stuns 0.05-0.25 s (scale-corrected), never seconds", () => {
  // Regression: feeding scaled damage (~850) into the verbatim stun formula gave
  // ~10 s stuns per hit after the x1000 health change. The live engine now feeds the
  // CLASS damage (attackDamage x physics) divided by DAMAGE_SCALE.
  for (const c of CLASSES) {
    const a = createStats(c);
    for (const d of CLASSES) {
      const D = createStats(d);
      const dmg = attackDamage(a, D, 1, 0.5) * physicsMultiplier(bodyFromStats(a), bodyFromStats(D), HARNESS_CLOSING_SPEED);
      const stun = stunDuration(dmg / DAMAGE_SCALE, 1.2, 0);
      // Wave K's steeper impact term raises the WORST-case stun: at the strongest match-up the
      // average hit now stuns 0.218 s instead of 0.19 s (still ~13 frames, still sub-second), so the
      // band is 0.05-0.25 and the "unscaled damage would be absurd" ratio is 20x rather than 50x
      // (DAMAGE_SCALE is 50 after the pool halving, so a 50x assertion would be exactly its own value).
      assert(stun >= 0.05 && stun <= 0.25, `${c}->${d}: stun ${stun.toFixed(3)} s outside 0.05–0.25`);
      assert(stunDuration(dmg, 1.2, 0) > stun * 20, "unscaled damage would have produced absurd stuns");
    }
  }
});

Deno.test("SPEC H2: every class needs 18-90 average hits to kill every other class (armour, crit, physics)", () => {
  // Wave K halved the pools (HEALTH_SCALE 1000 -> 500) at the user's request ("reduce the HPs,
  // there is too much AP"): one strike is a bigger share of a life bar and a duel is shorter. The
  // band below is the MEASURED one after that change (21.5-59.0 hits over the 64 class pairs,
  // reported by lane J-A), not the pre-Wave-J 25-160.
  assert(HEALTH_SCALE === 500, "Wave K fixes the health pool at x500");
  assert(DAMAGE_SCALE === HEALTH_SCALE / FIGHT_LENGTH, "damage scale stays derived from the pool");
  for (const c of CLASSES) for (const d of CLASSES) {
    const a = applyRaceBonus(createStats(c), "human", null), D = applyRaceBonus(createStats(d), "human", null);
    // Expected damage per hit: mean roll (0.5), crit priced in at its chance.
    const crit = criticalChance(a.reflex, D.resilience);
    const perHit = attackDamage(a, D, 1, 0.5) * (1 + crit * 0.4)
      * physicsMultiplier(bodyFromStats(a), bodyFromStats(D), HARNESS_CLOSING_SPEED);
    const hits = D.maxHealth / perHit;
    assert(hits >= 18 && hits <= 90, `${c} needs ${hits.toFixed(0)} hits to kill ${d}; band is 18-90 (Wave K pools)`);
  }
});

// ---------------------------------------------------- disposition

Deno.test("SPEC D1: the truce is exactly 6 s (3 friendly + 3 neutral)", () => {
  assert(truceSeconds(DEFAULT_TIMING) === 6, "truce must be 6 s");
  assert(DEFAULT_TIMING.friendlySeconds === 3 && DEFAULT_TIMING.neutralSeconds === 3, "3 + 3");
});

// ---------------------------------------------------- race appearance

Deno.test("SPEC R1: orks underbite and elves have the longest ears; hair length is monotonic", () => {
  assert(RACE_BUILDS.ork.underbite > 0, "orks must have an underbite");
  assert(RACE_BUILDS.elf.earMul > RACE_BUILDS.human.earMul, "elf ears longer than human");
  assert(RACE_BUILDS.dwarf.beard, "dwarves always grow a beard");
  const tiers = ["bald", "short", "medium", "long", "verylong"] as const;
  for (let i = 1; i < tiers.length; i++) {
    assert(HAIR_LENGTH_M[tiers[i]] > HAIR_LENGTH_M[tiers[i - 1]], `${tiers[i]} must exceed ${tiers[i - 1]}`);
  }
  // A sub-species tweak layers on the race base without losing the race's identity.
  const forge = raceBuild("dwarf", "forge");
  assert(forge.beard && forge.heightMul === RACE_BUILDS.dwarf.heightMul, "subrace layers on the race base");
});

// ---------------------------------------------------- secondary stats

Deno.test("SPEC SS1: secondary layers stack additively", () => {
  const wood = combineSecondary("wood", null);
  const serpent = combineSecondary(null, "serpent");
  const both = combineSecondary("wood", "serpent");
  for (const k of Object.keys(both) as (keyof typeof both)[]) {
    assert(Math.abs(both[k] - (wood[k] + serpent[k])) < 1e-9, `${k} must stack additively`);
  }
});

// ---------------------------------------------------- spine

Deno.test("SPEC SP1: the spine is 33 vertebrae and adjacent curves meet at zero offset", () => {
  const col = spineColumn();
  assert(col.length === SPINE_COUNT && SPINE_COUNT === 33, "33 vertebrae");
  for (const v of col) assert(Number.isFinite(v.z) && Number.isFinite(v.y), "finite offsets");
  // Segment boundaries (7, 19, 24) are the joints between the four curves; the
  // half-sine arch is zero there, so the column has no kink.
  for (const i of [6, 18, 23]) {
    assert(Math.abs(col[i].z) < 0.02 && Math.abs(col[i + 1].z) < 0.02, `joint at ${i} must be ~0`);
  }
});

// ---------------------------------------------------- face morph

Deno.test("SPEC F1: every face pose is clamped and the neutral pose is inside its limits", () => {
  for (const state of Object.keys(FACE_BY_STATE) as (keyof typeof FACE_BY_STATE)[]) {
    const p = FACE_BY_STATE[state];
    const c = clampFace(p);
    for (const k of Object.keys(c) as (keyof typeof c)[]) {
      assert(Number.isFinite(c[k]), `${state}.${k} finite`);
      // mouthCurve is signed (a frown is negative); every other channel is 0..1.
      const lo = k === "mouthCurve" ? -1 : 0;
      assert(c[k] >= lo && c[k] <= 1, `${state}.${k} in [${lo},1]`);
    }
  }
  assert(clampFace(NEUTRAL_FACE).eyeOpen === NEUTRAL_FACE.eyeOpen, "neutral is already in range");
});

// ---------------------------------------------------- animation tensors

Deno.test("SPEC T1: every class's powers have finite, bounded sin/cos/tan tensors", () => {
  for (const c of CLASSES) {
    const tensors = classTensors(c);
    assert(tensors.length === 3, `${c} has 3 powers`);
    for (const t of tensors) {
      assert(t.joints.length > 0, `${c} ${t.kind} animates at least one joint`);
      assert(t.maxTravel > 0, `${c} ${t.kind} sweeps a real arc`);
      assert(t.primeJoint !== null, `${c} ${t.kind} names a prime joint`);
      for (const j of t.joints) {
        assert(Number.isFinite(j.minAngle) && Number.isFinite(j.maxAngle), `${c} ${t.kind} ${j.joint} finite`);
        assert(j.maxAngle >= j.minAngle, `${c} ${t.kind} ${j.joint} max >= min`);
        for (const v of [j.minCos, j.maxCos, j.minSin, j.maxSin, j.minTan, j.maxTan, j.maxVel]) {
          assert(Number.isFinite(v), `${c} ${t.kind} ${j.joint} tensor finite`);
        }
      }
    }
  }
});

// ---------------------------------------------------- ranking

Deno.test("SPEC AI3: an upset moves more MMR than an expected win", () => {
  const strong = 1400, weak = 1000;
  const upset = mmrAfter(weak, strong, 1) - weak;
  const expected = mmrAfter(strong, weak, 1) - strong;
  assert(upset > expected, "the underdog gains more from an upset than the favourite from an expected win");
  assert(Math.abs(expectedScore(START_MMR, START_MMR) - 0.5) < 1e-9, "equal ratings expect 0.5");
});

// ---------------------------------------------------- stance animation

Deno.test("SPEC AN1: a stance key hits its start, peak and end angles, and is continuous at the peak", () => {
  for (const tr of stanceTransitions()) {
    assert(tr.keys.length > 0, `${tr.from}->${tr.to} animates at least one joint`);
    for (const key of tr.keys) {
      assert(Math.abs(keyAngle(key, 0) - key.from) < 1e-9, "start angle");
      assert(Math.abs(keyAngle(key, 0.5) - key.peak) < 1e-9, "peak angle");
      assert(Math.abs(keyAngle(key, 1) - key.to) < 1e-9, "end angle");
      // Velocity is continuous at the peak: the approach and the departure meet there.
      const before = keyAngle(key, 0.5 - 1e-6), after = keyAngle(key, 0.5 + 1e-6);
      assert(Math.abs(before - after) < 1e-5, "continuous at the peak");
    }
  }
});

// ---------------------------------------------------- secondary -> combat bridge

Deno.test("SPEC SS2: secondary stats feed the combat equations", () => {
  const base = createStats("Warrior");
  const buffed = applySecondary(base, "imperial", "mountain");
  assert(buffed.attackPower > base.attackPower, "mastery/versatility raise attack power");
  assert(buffed.armor > base.armor, "resistances add armour");
  const hasted = applySecondary(base, "nomad", "flame");
  assert(hasted.attackInterval < base.attackInterval, "haste shortens the attack interval");
  const crit = applySecondary(base, null, "serpent");
  assert(crit.reflex > base.reflex, "crit raises effective reflex");
  // Compare against a resilient defender: against a soft one both values sit on the
  // crit formula's 0.15 ceiling, which would hide the difference.
  assert(criticalChance(crit.reflex, 100) > criticalChance(base.reflex, 100), "and therefore the crit chance");
  const none = applySecondary(base, null, null);
  assert(none.attackPower === base.attackPower && none.armor === base.armor && none.reflex === base.reflex, "no ancestry is a true no-op");
});


// ------------------------------------------------- Wave H: ancestry hierarchy

function raceRanks(metric: (typeof METRICS)[number]): number[] {
  return RACE_IDS.map((r) => ANCESTRY[r].ranks[metric]).sort((a, b) => a - b);
}

Deno.test("SPEC HA1: every ancestry is complete and the four races are strictly ordered on every metric", () => {
  const ids = Object.keys(ANCESTRY);
  assert(ids.length === 16, `16 ancestry nodes (4 races + 12 subraces), got ${ids.length}`);
  for (const id of ids) {
    const node = ANCESTRY[id];
    assert(typeof node.name === "string" && node.name.length > 0, `${id} has a name`);
    assert(node.race.length > 0, `${id} names its race`);
    for (const m of METRICS) {
      const r = node.ranks[m];
      assert(Number.isInteger(r) && r >= 1 && r <= 4, `${id}.${m} rank ${r} is an integer in [1,4]`);
    }
    assert(Number.isFinite(node.hairPhysics.massKg) && node.hairPhysics.massKg >= 0, `${id} carries a finite hair mass`);
    assert(node.skin.range.length >= 3, `${id} has a skin range, not one flat colour`);
    assert(node.hair.colors.length >= 2, `${id} draws hair from a palette, not one colour`);
    assert(node.lore.length > 0, `${id} carries a lore line`);
  }
  // THE hierarchy: a strict ordering per metric, so "tallest/thinnest/broadest" is decidable.
  for (const m of METRICS) {
    assert(JSON.stringify(raceRanks(m)) === JSON.stringify([1, 2, 3, 4]), `${m} ranks 1..4 exactly once`);
    const order = rankOf(m).map((e) => e.id);
    assert(order.length === 4 && new Set(order).size === 4, `${m} orders the four races with no ties`);
  }
  // The brief's own claims: elves tallest, dwarf shortest, ork between human and elf, dwarf the
  // broadest shoulders and the biggest torso, elf the thinnest.
  assert(ANCESTRY.elf.ranks.height === 1 && ANCESTRY.ork.ranks.height === 2, "elf tallest, then ork");
  assert(ANCESTRY.human.ranks.height === 3 && ANCESTRY.dwarf.ranks.height === 4, "human, then dwarf shortest");
  assert(ANCESTRY.dwarf.ranks.shoulderWidth === 1 && ANCESTRY.elf.ranks.shoulderWidth === 4, "dwarf broadest, elf narrowest");
  assert(ANCESTRY.dwarf.ranks.torsoMass === 1, "dwarf has the biggest torso");
  assert(ANCESTRY.elf.ranks.thinness === 1, "elf is the thinnest");
});

Deno.test("SPEC HA2: the ancestry look reads from the silhouette alone (hair, beard, tusks, ears, skull)", () => {
  // Baldness: impossible for an elf, most likely for an ork.
  assert(ANCESTRY.elf.hair.baldChance === 0, "no bald elves, exactly");
  const others = ["human", "dwarf"].map((r) => ANCESTRY[r].hair.baldChance);
  assert(ANCESTRY.ork.hair.baldChance > Math.max(...others), "orks are the baldest");
  // Beards: the dwarf always grows one, the ork only on the chin, the elf at most a thin moustache.
  assert(ANCESTRY.dwarf.beard.required && ANCESTRY.dwarf.beard.mode === "full", "dwarves are always bearded");
  assert(ANCESTRY.ork.beard.mode === "chin" && ANCESTRY.ork.beard.required === false, "ork facial hair is chin-only");
  assert(ANCESTRY.elf.beard.mode === "moustache-thin" && ANCESTRY.elf.beard.required === false, "an elf never grows a full beard");
  assert(ANCESTRY.human.beard.allowed && ANCESTRY.human.beard.mode === "full", "a human may wear a big beard");
  // Tusks: two, up, and only the ork.
  assert(ANCESTRY.ork.tusk.count === 2 && ANCESTRY.ork.tusk.direction === "up", "ork carries two up-curved tusks");
  assert(ANCESTRY.elf.tusk.count === 0 && ANCESTRY.dwarf.tusk.count === 0 && ANCESTRY.human.tusk.count === 0, "and no other race does");
  // Brows: dwarf biggest, elf thin with tips past the face, ork short.
  assert(ANCESTRY.dwarf.brow.prominence > ANCESTRY.human.brow.prominence, "dwarf brows beat human");
  assert(ANCESTRY.elf.brow.tipPastFace >= Math.max(...["human", "dwarf", "ork"].map((r) => ANCESTRY[r].brow.tipPastFace)), "elf brow tips run furthest");
  assert(ANCESTRY.elf.brow.thickness < ANCESTRY.dwarf.brow.thickness, "elf brows are thinner than a dwarf's");
  assert(ANCESTRY.ork.brow.prominence < ANCESTRY.human.brow.prominence, "ork brows are short");
  // Ears and skull.
  assert(ANCESTRY.elf.ears.pointed > Math.max(...["human", "dwarf", "ork"].map((r) => ANCESTRY[r].ears.pointed)), "elf ears are the most pointed");
  assert(ANCESTRY.dwarf.skull.massMul > ANCESTRY.elf.skull.massMul, "the dwarf skull is heavier than the elf's");
  assert(ANCESTRY.ork.skull.massMul > ANCESTRY.human.skull.massMul, "so is the ork's");
  // A subrace resolves through its race, never throwing.
  assert(ancestryOf("elf", "high").race === "elf" && ancestryOf("elf", "nope").id === "elf", "a missing subrace falls back to the race");
});

Deno.test("SPEC HA3: hair physics mass follows length and curl, is seed-stable and never NaN", () => {
  const mass = (race: string) => hairMassKg(race, null, 12345);
  assert(mass("elf") > mass("human") && mass("human") > mass("ork") && mass("ork") > mass("dwarf"),
    "verylong > medium > short > long-by-race ordering follows the hair, not the height");
  for (const id of Object.keys(ANCESTRY)) {
    const race = ANCESTRY[id].race;
    for (const seed of [0, 1, 7, 999, 4294967295]) {
      const m = hairMassKg(race, id === race ? null : id, seed);
      assert(Number.isFinite(m) && m >= 0, `${id}/${seed} mass is finite and non-negative`);
      assert(m === hairMassKg(race, id === race ? null : id, seed), `${id}/${seed} mass is seed-stable`);
    }
  }
  // The solver itself: at rest with no wind and no motion, nothing moves.
  const spec: HairPhysicsSpec = { massKg: 0.4, stiffness: 12, damp: 2.4, windGain: 0.6 };
  const sm = new SecondaryMotion(spec, 4, 3);
  for (let i = 0; i < 200; i++) sm.step(1 / 60, { wind: [0, 0, 0], headVel: [0, 0, 0], yaw: 0, wetness: 0 });
  assert(sm.magnitude() === 0 && sm.resting(), "no wind, no motion: the mass never leaves rest");
  for (let i = 0; i < 200; i++) sm.step(1 / 60, { wind: [6, 0, 0], headVel: [0, 0, 0], yaw: 0, wetness: 0 });
  assert(sm.magnitude() > 0.001 && sm.magnitude() < 1, "a steady wind displaces the mass, inside the 1 m box");
  const o = sm.offset(0);
  assert(o.every((c) => Number.isFinite(c)), "no NaN reaches the rig");
});

// ------------------------------------------------- Wave H: match telemetry

Deno.test("SPEC HD1: the match time limit is 180 s by default and the bell is a TIE, never a win", () => {
  assert(MATCH_TIME_LIMIT_S === 180, "the brief's 3 minutes");
  assert(MATCH_TIME_LIMIT_MAX_S === 240, "and its 4-minute ceiling");
  assert(resolveTimeLimit() === 180 && resolveTimeLimit(MATCH_TIME_LIMIT_S) === 180);
  for (const input of [-5, 0, 10, 30, 1000, 1e9, NaN, Infinity, -Infinity]) {
    const v = resolveTimeLimit(input);
    assert(Number.isFinite(v) && v >= MATCH_TIME_LIMIT_MIN_S && v <= MATCH_TIME_LIMIT_MAX_S, `resolveTimeLimit(${input}) = ${v}`);
  }
  const before = timeLimitVerdict(180, 179.9);
  assert(!before.over, "the clock is not a verdict before the limit");
  const at = timeLimitVerdict(180, 180);
  assert(at.over && at.winner === null && at.reason === "time-limit", "at the limit nobody wins");
  const after = timeLimitVerdict(180, 500);
  assert(after.over && after.winner === null, "and nobody wins however long it runs after");
});

function fightRec(o: Partial<FighterRecord> = {}): FighterRecord {
  return {
    name: "A", race: "human", subrace: null, className: "Warrior", weapon: "sword", level: 1,
    controller: "decision-tree",
    stats: { vitality: 8, resilience: 8, focus: 8, reflex: 8, strength: 8, intelligence: 8, maxHealth: 40000, attackPower: 900, armor: 4 },
    dealt: 0, hits: 0, hpLeft: 40000, ...o,
  };
}

Deno.test("SPEC HD2: the stat gap is a bounded measure, zero for a mirror match, and the generation id is stable", () => {
  const mirror = statGapOf(fightRec(), fightRec(), 100, 100);
  assert(mirror.distance === 0 && mirror.damageShare === 0 && mirror.dominance === 0, "a mirror match with even damage has no gap");
  const apart = statGapOf(fightRec(), fightRec({ stats: { ...fightRec().stats, reflex: 16, strength: 15 } }), 900, 100);
  assert(apart.distance > mirror.distance, "different builds are farther apart");
  assert(apart.damageShare > 0.5 && apart.dominance > 0.4, "and a one-sided fight reads as dominant");
  for (const [a, b, da, db] of [[0, 0, 0, 0], [1e9, 0, 0, 0], [0, 1e9, 0, 0], [5, 5, -3, 7]] as const) {
    const g = statGapOf(fightRec({ stats: { ...fightRec().stats, strength: a } }), fightRec({ stats: { ...fightRec().stats, strength: b } }), da, db);
    assert(Number.isFinite(g.distance) && Number.isFinite(g.dominance), "no NaN for any input");
    assert(g.dominance >= 0 && g.dominance <= 1, `dominance ${g.dominance} inside [0,1]`);
    assert(g.damageShare >= 0 && g.damageShare <= 1, `damageShare ${g.damageShare} inside [0,1]`);
  }
  assert(generationId(42) === generationId(42) && /^GEN-[0-9A-F]{6}$/.test(generationId(42)), "generationId is stable and well formed");
  const ids = new Set<number>();
  for (let s = 0; s < 400; s++) ids.add(maybeHash(generationId(s * 7919)));
  assert(ids.size >= 390, `generation ids barely collide over 400 seeds (${ids.size} distinct)`);
});

function maybeHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
}

Deno.test("SPEC HD3: the History page and the record layer agree on which match is the fastest and the widest", () => {
  const mk = (duration: number, distance: number, dominance: number, tie = false, reason = "ko", id = 1): MatchRecord => ({
    id, at: "2026-10-31T12:00:00.000Z", hour: 12, phase: "day", place: "Sunspire", arena: "ring",
    reason: reason as MatchRecord["reason"], duration, firstStrike: null, winner: tie ? null : 0,
    limitS: 180, tie, margin: dominance,
    statGap: { raw: { vitality: 0, resilience: 0, focus: 0, reflex: 0, strength: 0, intelligence: 0 }, z: {}, distance, damageShare: dominance, dominance },
    generation: { seed: id, id: generationId(id), arena: "ring", budget: 12, techniques: [], ancestry: ["human", "ork"] },
    fighters: [fightRec({ dealt: 100, hpLeft: tie ? 10000 : 1 }), fightRec({ dealt: tie ? 90 : 0 })],
  });
  const list: MatchRecord[] = [mk(40, 1.0, 0.2, false, "ko", 1), mk(12, 0.4, 0.1, false, "ko", 2), mk(180, 2.4, 0.9, true, "time-limit", 3), mk(180, 0.2, 0.0, true, "time-limit", 4)];
  const rec = highlights(list);
  const view = highlightsOf(list.map((r) => ({ durationS: r.duration, statGap: r.statGap, generation: r.generation, tie: r.tie, endReason: r.tie ? "time-limit" as const : "ko" as const })));
  assert(rec.fastest?.id === 2 && view.fastest?.durationS === 12, "the fastest DECIDED match is the 12 s one");
  assert(rec.widestGap?.id === 3 && view.widestGap?.durationS === 180, "the widest stat gap is the 2.4 sd one");
  assert(rec.tieCount === 2 && view.tieCount === 2 && rec.timeoutCount === 2 && view.timeoutCount === 2, "both count ties and timeouts the same way");
  assert(highlights([]).fastest === null && highlightsOf([]).fastest === null, "an empty history highlights nothing");
});

// ------------------------------------------------- Wave H: generation and data science

Deno.test("SPEC HE1: a spectator card round-trips level<->budget and its techniques always include the class's three", () => {
  for (let level = 1; level <= 20; level++) {
    const budget = budgetForLevel(level);
    assert(Number.isFinite(budget) && budget >= 0, `level ${level} budget ${budget}`);
    assert(levelForBudget(budget) === level, `level ${level} round-trips through its budget`);
  }
  let seed = 1;
  const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const role of ["Warrior", "Assassin", "Mage", "Priest"] as const) {
    const spent = spendBudget(60, role, rng);
    const sum = Object.values(spent).reduce((a, b) => a + b, 0);
    assert(sum <= 60 && sum >= 60 - 6, `${role} spent ${sum} of 60`);
    assert(Object.values(spent).every((v) => v >= 0), "no negative allocation");
    const tech = techniquesFor(spent, role);
    assert(tech.length >= 3 && tech.length <= 6, `${role} unlocks 3..6 techniques, got ${tech.length}`);
    for (const s of skillsForClass(role)) assert(tech.includes(s.id), `${role} always has its own skill ${s.id}`);
  }
  const card = generateSpectateCard(777);
  assert(card.seed === 777 && /^GEN-[0-9A-F]{6}$/.test(card.generationId), "the card carries its generation id");
  assert(card.levelA >= 1 && card.levelA <= 20 && card.levelB >= 1 && card.levelB <= 20, "both levels are drawn from the table");
  assert(Number.isFinite(card.arenaSize) && card.arenaSize > 0, "the arena size is finite and positive");
});

Deno.test("SPEC HF1: the corpus standardises NaN-free and its principal components explain exactly the variance", () => {
  let s = 99;
  const rng = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const rows = Array.from({ length: 200 }, (_, i) => keyVars({
    duration: 20 + rng() * 160, reason: rng() < 0.5 ? "ko" : "time-limit", winner: i % 7 === 0 ? null : (i % 2) as 0 | 1,
    fighters: [
      { stats: { vitality: 8, resilience: 8, focus: 8, reflex: 8 + Math.round(rng() * 8), strength: 8, intelligence: 8 }, dealt: Math.round(rng() * 500) },
      { stats: { vitality: 8, resilience: 8, focus: 8, reflex: 8, strength: 8 + Math.round(rng() * 8), intelligence: 8 }, dealt: Math.round(rng() * 500) },
    ],
  }));
  const { rows: z } = standardise(rows);
  for (const r of z) for (const [k, v] of Object.entries(r)) assert(Number.isFinite(v), `standardised ${k} is finite`);
  const spread = spreadOf(rows);
  for (const [k, v] of Object.entries(spread)) assert(Number.isFinite(v.mean) && Number.isFinite(v.sd) && v.max >= v.min, `spread ${k} is finite and ordered`);
  const p = pca(z);
  const sum = p.ratios.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 1e-6, `the explained-variance ratios sum to 1 (got ${sum})`);
  assert(p.ratios.every((r) => r >= 0) && p.ratios[0] === Math.max(...p.ratios), "ratios are non-negative and the first component explains the most");
});

Deno.test("SPEC HX1: a generated stat budget can never push a fighter outside the balance window", () => {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let s = 4242;
  const rng = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const className of CLASSES) {
    const base = createStats(className);
    for (let level = 1; level <= 20; level++) {
      const spent = spendBudget(budgetForLevel(level), className, rng);
      const out = { ...base };
      const d = statDelta(spent);
      for (const [k, v] of Object.entries(d)) {
        if (typeof v !== "number") continue;
        const key = k as keyof typeof out;
        out[key] = (out[key] ?? 0) + v;
      }
      out.maxHealth = clamp(out.maxHealth, 30 * HEALTH_SCALE, 60 * HEALTH_SCALE);
      out.attackPower = clamp(out.attackPower, 5 * DAMAGE_SCALE, 14 * DAMAGE_SCALE);
      out.armor = clamp(out.armor, 1, 8);
      out.attackInterval = clamp(out.attackInterval, 0.5, 1.5);
      for (const [k, v] of Object.entries(out)) assert(Number.isFinite(v), `${className} L${level} ${k} is finite`);
      assert(out.maxHealth <= 60 * HEALTH_SCALE && out.attackPower <= 14 * DAMAGE_SCALE, `${className} L${level} stays inside the bands`);
      assert(out.maxHealth >= 30 * HEALTH_SCALE && out.attackPower >= 5 * DAMAGE_SCALE, `${className} L${level} stays above the floors`);
    }
  }
  // A legacy record (no gap, no generation) still parses, so an old history keeps working.
  const legacy = parseHistory(JSON.stringify([{ id: 1, at: "2026-01-01T00:00:00.000Z", hour: 12, phase: "day", place: "P", arena: "ring", reason: "ko", duration: 30, firstStrike: null, winner: 0, fighters: [fightRec(), fightRec()] }]));
  assert(legacy.length === 1 && legacy[0].tie === false && legacy[0].limitS === 180, "a pre-Wave-H record loads with the defaults");
});


// ------------------------------------------------- Wave I: the spectator camera

Deno.test("SPEC IA1: a spectator angle the user sets STAYS set, and every preset is legal", () => {
  const start = SPECTATE_CAM_DEFAULTS;
  const turned = orbitCamera(start, 240, 60, { yaw: 0.002, pitch: 0.002 });
  assert(turned.yaw !== start.yaw && turned.pitch !== start.pitch, "the drag turns the camera");
  // THE COMPLAINT: no input must leave the angle exactly where the user put it — no ease-back.
  let idle = turned;
  for (let i = 0; i < 500; i++) idle = orbitCamera(idle, 0, 0, { yaw: 0.002, pitch: 0.002 });
  assert(idle.yaw === turned.yaw && idle.pitch === turned.pitch, `an idle frame must not move the camera (${idle.yaw} vs ${turned.yaw})`);
  assert(orbitCamera(start, 0, 0, { yaw: 1, pitch: 1 }).yaw === start.yaw, "zero drag is a no-op");
  for (let i = 0; i < 1_000; i++) {
    const s2 = orbitCamera(idle, (i % 97) - 48, (i % 41) - 20, { yaw: 0.004, pitch: 0.004 });
    assert(s2.yaw >= -Math.PI && s2.yaw <= Math.PI, `yaw wraps into [-pi, pi] (got ${s2.yaw})`);
    assert(s2.pitch >= SPECTATE_CAM_BOUNDS.pitch[0] && s2.pitch <= SPECTATE_CAM_BOUNDS.pitch[1], `pitch clamped (got ${s2.pitch})`);
  }
  assert(zoomCamera(start, 4).dist > start.dist && zoomCamera(start, -4).dist < start.dist, "zoom is monotone");
  assert(zoomCamera(start, 100).dist === SPECTATE_CAM_BOUNDS.dist[1] && zoomCamera(start, -100).dist === SPECTATE_CAM_BOUNDS.dist[0], "and clamped");
  for (const preset of CAMERA_PRESETS) {
    assert(preset.state.pitch >= SPECTATE_CAM_BOUNDS.pitch[0] && preset.state.pitch <= SPECTATE_CAM_BOUNDS.pitch[1], `${preset.id} pitch in bounds`);
    assert(preset.state.dist >= SPECTATE_CAM_BOUNDS.dist[0] && preset.state.dist <= SPECTATE_CAM_BOUNDS.dist[1], `${preset.id} dist in bounds`);
  }
  const pose = cameraPose(start, [3, 1, -2]);
  const d = Math.hypot(pose.position[0] - 3, pose.position[1] - (1 + start.height), pose.position[2] + 2);
  assert(Math.abs(d - start.dist) < 1e-9, `cameraPose keeps the distance (got ${d})`);
  let mode = start;
  for (let i = 0; i < 3; i++) mode = cycleMode(mode);
  assert(mode.mode === start.mode, "cycling three times returns to the starting mode");
  assert(decodeSpectateCam(encodeSpectateCam(turned)).yaw === turned.yaw, "the camera round-trips through storage");
  for (const bad of [null, "", "null", "{]", "{}", '{"dist":1e9,"pitch":NaN}', '{"mode":"nope"}']) {
    const c = decodeSpectateCam(bad as string | null);
    assert(Number.isFinite(c.yaw) && Number.isFinite(c.pitch) && Number.isFinite(c.dist) && Number.isFinite(c.height), `hostile storage decodes finite (${bad})`);
  }
});

// ------------------------------------------------- Wave I: the inspect overlay

Deno.test("SPEC IB1: the inspect card anchors on screen, the cursor's blob follows the reticle, and the pick is nearest-wins", () => {
  // Fuzz only over cards that FIT the viewport: that is the documented contract (a card wider than
  // the screen cannot be placed inside it), and the oversize case is pinned separately below.
  for (let i = 0; i < 2_000; i++) {
    const viewport = { w: 400 + (i % 900), h: 300 + (i % 500) };
    const card = { w: 60 + (i % Math.max(60, viewport.w - 80)), h: 40 + (i % Math.max(40, viewport.h - 60)) };
    const anchor = { x: (i * 37) % viewport.w, y: (i * 53) % viewport.h };
    const at = anchorCard(anchor, card, viewport);
    assert(at.left >= -1e-9 && at.top >= -1e-9, "never above/left of the viewport");
    assert(at.left + card.w <= viewport.w + 1e-6 && at.top + card.h <= viewport.h + 1e-6, "never past the right/bottom edge");
    assert(at.side === "left" || at.side === "right", "a side is always chosen");
  }
  // A card larger than the viewport degrades to the clamped origin instead of returning a NaN.
  const oversize = anchorCard({ x: 500, y: 400 }, { w: 2_000, h: 1_500 }, { w: 800, h: 600 });
  assert(Number.isFinite(oversize.left) && Number.isFinite(oversize.top), "an oversize card still answers with finite numbers");
  const flipped = anchorCard({ x: 900, y: 100 }, { w: 200, h: 100 }, { w: 1000, h: 800 });
  assert(flipped.side === "left" && flipped.left <= 900, "a card that would overflow flips to the left");
  assert(pickNearest([{ id: "a", x: 10, y: 10, r: 6 }], { x: 40, y: 40 }) === null, "outside every radius is a miss");
  assert(pickNearest([{ id: "a", x: 10, y: 10, r: 40 }, { id: "b", x: 20, y: 10, r: 40 }], { x: 18, y: 10 }) === "b", "two overlapping: the nearer centre wins");
  const card = fighterCard({
    seat: 0, name: "A", ancestry: "elf/high", subrace: "high", className: "Mage", level: 3, controller: "AI",
    weapon: "staff", stats: { vitality: 6, resilience: 6, focus: 12, reflex: 10, strength: 4, intelligence: 14, agility: 9 },
    combat: { maxHealth: 40000, attackPower: 900, attackInterval: 1, armor: 4 },
    hp: 30000, mana: 40, manaMax: 60, stamina: 20, staminaMax: 30, dealt: 1200, hits: 9,
    techniques: ["mage-blink"], generationId: "GEN-ABCDEF",
    telemetry: { travelledM: 40, avgDistanceM: 5, peak5sDamage: 900 },
  });
  assert(card.rows.length >= 10 && card.bars.length === 3, "a fighter card carries its rows and three pools");
  assert(card.badges.includes("GEN-ABCDEF") && card.badges.includes("AI"), "the generation and the controller are badged");
  assert(card.rows.some((r) => r.tone === "bad"), "the below-average stat is flagged");
  const obj = objectCard({ id: "o", kind: "crate", label: "Crate", detail: "", x: 0, z: 0, radiusM: 0.5, heightM: 0.8, scale: 1, boon: null });
  assert(obj.rows.some((r) => r.label === "What it's for"), "a prop without a boon says what it is for");
  const boon = objectCard({ id: "p", kind: "buff pickup", label: "Rage", detail: "", x: 0, z: 0, radiusM: 0.4, heightM: 0.3, scale: 1, boon: "rage" });
  assert(boon.badges.includes("rage") && boon.rows.some((r) => r.label === "Effect"), "a boon carries its id and its real effect");
  let cur: CursorState = { x: 100, y: 100, blobX: 0, blobY: 0, down: false, hoverId: null };
  for (let i = 0; i < 60; i++) cur = stepCursor({ ...cur, x: 400, y: 300 }, { x: 400, y: 300 }, 1 / 60);
  assert(Math.hypot(cur.blobX - 400, cur.blobY - 300) < 1, "the blob converges on the reticle within a second");
  const one = stepCursor({ ...cur, blobX: 0, blobY: 0 }, { x: 500, y: 500 }, 0.1);
  let ten: CursorState = { ...cur, blobX: 0, blobY: 0 };
  for (let i = 0; i < 10; i++) ten = stepCursor(ten, { x: 500, y: 500 }, 0.01);
  assert(Math.abs(one.blobX - ten.blobX) < 0.5, "the blob's ease is frame-rate independent");
  assert(blobRadius({ ...cur, down: true }) > blobRadius(cur), "the blob grows while the button is down");
});

// ------------------------------------------------- Wave I: terrain fill and clash

const slope = (x: number, z: number): number => x * Math.tan(20 * Math.PI / 180) + z * 0.0;

Deno.test("SPEC IC1: a prop cannot float (seated on the footprint's high point) and its apron reaches the terrain", () => {
  const r = 0.9, x = 1.5, z = -0.4;
  const base = seatingY(slope, x, z, r);
  const foot = footHeight(slope, x, z, r);
  assert(base === foot.max, "the seat is the footprint maximum");
  // The seating contract, stated the way it is actually meant: the base sits on the HIGHEST ground
  // under the footprint, so the prop is never buried (base - ground >= 0 everywhere) and never hovers
  // by more than the footprint's own fall (base - ground <= range). The apron covers that fall: a
  // base placed at the MAX is above the DOWNHILL ground by exactly range, which is the seam.
  let buried = Infinity;
  let hover = -Infinity;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const ground = slope(x + Math.cos(a) * r, z + Math.sin(a) * r);
    buried = Math.min(buried, base - ground);
    hover = Math.max(hover, base - ground);
  }
  assert(buried >= -1e-9, `the base is never below the ground under its footprint (worst ${buried})`);
  assert(hover <= foot.range + 1e-9, `and never hovers by more than the footprint's own fall (${hover} vs ${foot.range})`);
  // What the OLD placement did: the base sat at the terrain height under the CENTRE plus half the
  // model's height, so on a slope it was buried uphill and hovering downhill at the same time.
  const oldCentre = footHeight(slope, x, z, r).mean;
  assert(oldCentre < foot.max, "the centre sample is lower than the high point, which is why the old placement buried the uphill side");
  const skirt = skirtFor({ x, z, y: base, radius: r, rotation: 0, material: "sand" }, slope, { segments: 20, maxDrop: foot.range + 0.25 });
  assert(skirt.maxDrop + 0.02 >= foot.range, `the apron covers the footprint's fall (${skirt.maxDrop} vs ${foot.range})`);
  assert(skirt.triangles <= 20 * 2 * 3, `bounded triangles (${skirt.triangles})`);
  const flat = skirtFor({ x: 0, z: 0, y: 2, radius: 1, rotation: 0, material: "stone" }, () => 2, { segments: 12 });
  assert(flat.maxDrop < 0.05 && flat.triangles > 0, "flat ground needs almost no apron");
  for (const radius of [0.01, 40]) {
    const s2 = skirtFor({ x: 0, z: 0, y: 1, radius, rotation: 0.3, material: "ice" }, slope, { segments: 8 });
    for (const v of s2.geometry.getAttribute("position").array) assert(Number.isFinite(v as number), "no NaN in the apron");
  }
  const sandHalf = (px: number) => (px < 0 ? "sand" : "grass") as "sand" | "grass";
  assert(materialUnder(sandHalf, -0.2, 0, 1) === "sand", "a footprint mostly on sand is filled as sand");
  const grassHalf = (px: number) => (px < 0.2 ? "sand" : "grass") as "sand" | "grass";
  assert(materialUnder(grassHalf, 0.5, 0, 1) === "grass", "a footprint mostly on grass is filled as grass");
});

Deno.test("SPEC ID1: two moving blades within reach clash once, at a bounded strength, and the spark pool never overflows", () => {
  const crossA = { a: [0, 0, 0] as [number, number, number], b: [1, 0, 0] as [number, number, number], speed: 6 };
  const crossB = { a: [0.5, -0.5, 0] as [number, number, number], b: [0.5, 0.5, 0] as [number, number, number], speed: 6 };
  const near = segSegClosest(crossA.a, crossA.b, crossB.a, crossB.b);
  assert(Math.abs(near.d) < 1e-9, `crossing segments meet (got ${near.d})`);
  const parallel = segSegClosest([0, 0, 0], [1, 0, 0], [0, 0.3, 0], [1, 0.3, 0]);
  assert(Math.abs(parallel.d - 0.3) < 1e-9, `parallel lines keep their offset (got ${parallel.d})`);
  const degenerate = segSegClosest([1, 1, 1], [1, 1, 1], [2, 2, 2], [2, 2, 2]);
  assert(Number.isFinite(degenerate.d), "a zero-length segment is finite, never NaN");
  const idle = detectClash({ ...crossA, speed: 0 }, { ...crossB, speed: 0 }, 0.35);
  assert(idle === null, "two blades at rest never spark, however close");
  const hit = detectClash(crossA, crossB, 0.35);
  assert(hit !== null && hit.strength >= 0 && hit.strength <= 1, "two blades crossing at speed clash");
  assert(detectClash({ ...crossA, a: [0, 5, 0], b: [1, 5, 0] }, crossB, 0.35) === null, "beyond reach there is no clash");
  assert(clashStrength(0) === 0 && clashStrength(1e6) === 1, "strength runs 0..1 and saturates");
  assert(canClash(10, 9.95) === false && canClash(10, 9) === true, "the repeat gate holds for its cooldown");
  // A stand-in for the scene node the pool is added to: the class only calls add() on it.
  const parent = { add: () => {} } as unknown as ConstructorParameters<typeof ClashSparks>[0];
  const sparks = new ClashSparks(parent, { maxSparks: 48, seed: 7 });
  for (let i = 0; i < 10_000; i++) {
    sparks.burst([0, 1, 0], 1, i / 60);
    sparks.update(i / 60, 1 / 60);
    assert(sparks.liveCount <= 48, `the pool never overflows (${sparks.liveCount})`);
  }
  assert(sparks.spawned + sparks.dropped === 10_000 * SPARKS_PER_BURST, `every spark is either born or refused (${sparks.spawned} + ${sparks.dropped})`);
  sparks.setScale(0);
  const before = sparks.spawned;
  sparks.burst([0, 1, 0], 1, 200);
  assert(sparks.spawned === before, "a zeroed scale spawns nothing");
  assert(sparks.triangleCount > 0 && sparks.triangleCount < 4_000, `the pool stays inside its triangle budget (${sparks.triangleCount})`);
  assert(DEFAULT_MAX_SPARKS === 96, "the default pool is the 96 the wave budgeted");
});

Deno.test("SPEC IE1: the effects governor answers sustained load slowly, recovers slower, and never flaps", () => {
  const g = new EffectsGovernor();
  const spike = g.step(20, 1 / 60);
  assert(spike === 1, "one 20 ms frame does not drop the effects");
  let scale = 1;
  for (let i = 0; i < 3_000; i++) scale = g.step(20, 1 / 60);
  assert(scale === 0.25, `sustained 20 ms frames drive the scale to the floor (got ${scale})`);
  const recoverFrames = (() => { let n = 0; while (scale < 1 && n < 10_000) { scale = g.step(4, 1 / 60); n++; } return n; })();
  assert(scale === 1 && recoverFrames > 60, `recovery is slower than the drop (${recoverFrames} frames)`);
  const climbs = (() => { let dirs = 0, prev = g.step(4, 1 / 60), last = 1; for (let i = 0; i < 600; i++) { const v = g.step(4, 1 / 60); if (Math.sign(v - prev) !== 0 && Math.sign(v - prev) !== last) dirs++; last = Math.sign(v - prev) || last; prev = v; } return dirs; })();
  assert(climbs <= 1, `a steady regime moves the scale one way (${climbs} reversals)`);
  for (const bad of [NaN, -5, 1e9, 0]) assert(Number.isFinite(g.step(bad, 1 / 60)), `finite for cpu=${bad}`);
  assert(percentile([1, 2, 3, 4, 5], 0.5) === 3 && percentile([1, 2, 3, 4, 5], 1) === 5, "percentile is exact on a hand-computed sample");
  assert(percentile([], 0.5) === 0, "and total on an empty one");
  const st = summarise([1, 2, 3, 4, 5]);
  assert(st.n === 5 && st.mean === 3 && st.max === 5 && st.p50 === 3, "summarise matches the hand-computed stats");
});


// ------------------------------------------------- Wave K: the resource price of a technique

Deno.test("SPEC KK1: mana costs are 20% above the balance pass's table, and a dash costs no mana", () => {
  // The recorded pre-Wave-J table: dash 0, power 20, defense 5 (mana). The user asked for +20%.
  const before = { dash: 0, power: 20, defense: 5 };
  for (const [kind, mana] of Object.entries(before)) {
    const cost = SKILL_RESOURCE_COST[kind];
    assert(cost !== undefined, `${kind} has a cost row`);
    assert(cost.mana === Math.round(mana * 1.2), `${kind} mana ${cost.mana} is 20% above ${mana}`);
    assert(Number.isFinite(cost.stamina) && cost.stamina >= 0, `${kind} stamina is finite and non-negative`);
  }
  assert(SKILL_RESOURCE_COST.dash.mana === 0, "a dash is a stamina move: no mana");
  assert(SKILL_RESOURCE_COST.power.mana > SKILL_RESOURCE_COST.defense.mana, "a power skill costs more mana than a guard");
});


// ------------------------------------------------- Wave K: the statistics bars

Deno.test("SPEC KK2: every stat bar is cut into squares and carries its numbers inside, with no inline style attribute", () => {
  assert(BAR_SEGMENTS >= 8 && BAR_SEGMENTS % 4 === 0, `12-ish squares that divide by 2/3/4 (got ${BAR_SEGMENTS})`);
  // The model: a third of the bar is 4 full squares of 12, and the partial one carries the rest.
  const model = barModel({ nominal: 1_000 / 3, potential: 1_000 / 3, max: 1_000 });
  const segs = barSegments(model, BAR_SEGMENTS);
  assert(segs.fills.length === BAR_SEGMENTS && segs.full.length === BAR_SEGMENTS, "one entry per square");
  assert(segs.full.filter(Boolean).length === 4, `a third fills 4 squares (got ${segs.full.filter(Boolean).length})`);
  // Each square carries the fraction OF ITSELF that is filled, so the sum is the bar fraction in
  // square units: sum = fraction x segments (a third of 12 squares sums to 4.0, not to 0.333).
  assert(Math.abs(segs.fills.reduce((a, b) => a + b, 0) - (1 / 3) * BAR_SEGMENTS) < 1e-9, "the squares cover the bar's own fraction");
  assert(segs.fills.every((f) => f >= 0 && f <= 1), "fills stay in [0,1]");
  // The label the bar shows: value / max and the share.
  assert(barLabel(320, 500) === "320 / 500 · 64%", `label format (got ${barLabel(320, 500)})`);
  assert(barLabel(0, 0) === "0 / 0 · 0%" && barLabel(NaN, 5) === "0 / 5 · 0%" && barLabel(900, 500) === "500 / 500 · 100%", "and it is total");
  const card = inspectBarSegments({ label: "HP", value: 30, max: 40, colour: "#ef7455" });
  assert(card.fills.length === BAR_SEGMENTS && card.full.filter(Boolean).length === 9, "the card uses the same squares");
});

Deno.test("SPEC KK3: the card's bars are written through CSSOM, never an inline style attribute", async () => {
  // A text-level pin, because the failure it guards (the History bars rendering nothing under the
  // server's style-src 'self' CSP) is invisible in a unit test and was a real bug in this repo.
  const engine = await Deno.readTextFile(new URL("../src/engine/Engine.ts", import.meta.url));
  const inspect = engine.slice(engine.indexOf("  #renderInspect(): void {"), engine.indexOf("  #positionInspect(): void {"));
  assert(inspect.length > 400, `the renderer was found (${inspect.length} chars)`);
  assert(!/style="/.test(inspect), "no inline style attribute in the inspect card's markup");
  assert(inspect.includes("inspect-bar-seg") && inspect.includes("barLabel("), "the squares and the label are both rendered");
  assert(inspect.includes("--bar-colour") && inspect.includes("style.width"), "widths and colours go through CSSOM");
});


// ------------------------------------------------- Wave L: the creation and menu components

Deno.test("SPEC LL1: every race and every sub-species flies its own standard, drawn without a style attribute", () => {
  const sigs = new Map<string, string>();
  for (const r of RACES) {
    const mine = raceBanner(r.id);
    assert(mine.length > 200, `${r.id} has a standard`);
    assert(!/style=/.test(mine), `${r.id}: no inline style attribute (the page CSP blocks it)`);
    assert(mine.includes('viewBox="0 0 96 120"'), `${r.id}: a 4:5 hanging field`);
    sigs.set(r.id, mine);
    for (const sub of r.subspecies) {
      const banner = raceBanner(r.id, sub.id);
      assert(banner.length > 200, `${r.id}/${sub.id} has its own standard`);
      assert(banner !== mine, `${r.id}/${sub.id} is differenced from its own race (cadency)`);
      sigs.set(`${r.id}/${sub.id}`, banner);
    }
  }
  assert(new Set(sigs.values()).size === sigs.size, `all ${sigs.size} standards are distinct`);
  assert(raceBanner("nobody") === "", "an unknown race draws nothing rather than a broken glyph");
});

Deno.test("SPEC LL2: the options are CLOSED trees on arrival, with the one entry group open", () => {
  // Wave O: the title has TWO entry groups — the modes (Fight/History/Spectate/Settings) and the
  // saved fighters (which opens the Profiles panel). Both start open; every other group in the
  // interface starts closed. The count moved from 1 to 2 on purpose, and this pin records why.
  const open = defaultOpenGroups();
  assert(open.length === 2 && open.includes("title/start/modes") && open.includes("title/start/profiles"), `the two entry groups start open (got ${open.join(", ")})`);
  const state = initialDisclosure(UI_TREE);
  const selectGroups = UI_TREE.find((s) => s.id === "select")!.panels.flatMap((p) => p.groups.map((g) => groupKey("select", p.id, g.id)));
  assert(selectGroups.length >= 10, `the Creator has its groups (${selectGroups.length})`);
  assert(selectGroups.every((k) => !isOpen(state, k)), "every Creator group starts closed");
  const oneOpen = toggleGroup(state, "select/ancestry/race");
  assert(isOpen(oneOpen, "select/ancestry/race") && !isOpen(state, "select/ancestry/race"), "toggling opens it without mutating the previous state");
  const round = decodeDisclosure(encodeDisclosure(oneOpen), UI_TREE);
  assert(isOpen(round, "select/ancestry/race"), "an open group survives the storage round-trip");
  const fallback = decodeDisclosure("{not json", UI_TREE);
  assert(!isOpen(fallback, "select/ancestry/race") && isOpen(fallback, "title/start/modes"), "a corrupt payload falls back to the initial state");
  assert(DISCLOSURE_STORAGE_KEY === "mytherrania-ui-open", "the key the renderer persists under");
});

Deno.test("SPEC LL3: the dice rolls a legal fighter and the sheet shows the game's own numbers", async () => {
  const { createStats, HEALTH_SCALE } = await import("../src/game/Stats.ts");
  const { applySecondary } = await import("../src/game/SecondaryStats.ts");
  const rolls = Array.from({ length: 24 }, (_, i) => rollProfile(() => ((i + 1) * 0.0417) % 1));
  for (const rolled of rolls) {
    const p = rolled.profile;
    assert(RACES.some((r) => r.id === p.race), `the rolled race exists (${p.race})`);
    assert(CLASSES.includes(p.className), `the rolled class exists (${p.className})`);
    assert(p.subrace === null || p.subrace !== "", "a roll may leave the sub-species open for the player");
    const sheet = creatorSheet(p);
    assert(sheet.primary.length === 7 && sheet.derived.length >= 4, "the sheet carries the primaries and the derived numbers");
    const row = sheet.derived.find((r) => r.label === "Max Health");
    assert(row !== undefined, "the sheet shows the health pool");
    const live = applySecondary(applyRaceBonus(createStats(p.className), p.race, p.subrace, p.birthsign), p.subrace, p.birthsign).maxHealth;
    const shown = Number(row!.value.replace(/\s/g, ""));
    assert(Number.isFinite(shown) && Math.abs(shown - live) / live < 0.02, `Max Health ${row!.value} is the live pool (${Math.round(live)})`);
    assert(live >= 30 * HEALTH_SCALE * 0.5 && live <= 60 * HEALTH_SCALE * 2, "and it sits in the pool band, not a hard-coded number");
  }
});

Deno.test("SPEC LL4: the Creator's dice button, preview canvas and the engine's live model are wired (text pin)", async () => {
  const menu = await Deno.readTextFile(new URL("../src/ui/Menu.ts", import.meta.url));
  const engine = await Deno.readTextFile(new URL("../src/engine/Engine.ts", import.meta.url));
  assert(menu.includes('data-action="dice"') && menu.includes("dice-btn-rocky") && menu.includes('icon("dice"'), "the purple rocky dice button is in the markup with the dice icon");
  assert(menu.includes('id="creator-preview"'), "the Creator carries the preview canvas");
  assert(/<canvas[^>]*id="creator-preview"/.test(menu) || /creator-preview[^>]*canvas/.test(menu), "and it is a canvas, not a placeholder");
  assert(menu.includes("creatorSheet(") && menu.includes("opt-group"), "the sheet and the closed trees are rendered");
  assert(menu.includes("#persistDisclosure") || menu.includes("encodeDisclosure("), "the open state is persisted through the pure model");
  assert(engine.includes("new PreviewScene("), "the engine stands the live model on that canvas");
  assert(engine.includes("onRoll:"), "and follows the menu's roll hook");
});
