// Tests that pin the cross-module BOUNDS: the equations that tie one module's output
// to another module's input. Each test is the executable form of a row in
// docs/SPEC.md, so the spec cannot drift from the code without a test failing.
import { luminosity } from "../src/graphics/Environment.ts";
import { adaptedRanges, NEUTRAL_ENV } from "../src/game/Senses.ts";
import { bodyFromStats, closingSpeed, density, physicsMultiplier, PHYSICS_MUL_MAX, PHYSICS_MUL_MIN, totalMass } from "../src/game/Physics.ts";
import { attackDamage, CLASSES, createStats, criticalChance, DAMAGE_SCALE, HEALTH_SCALE } from "../src/game/Stats.ts";
import { HARNESS_CLOSING_SPEED } from "../src/balance/ArenaHarness.ts";
import { applyRaceBonus } from "../src/game/Races.ts";
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

Deno.test("SPEC H1: every class's average hit stuns 0.05–0.20 s (scale-corrected), never seconds", () => {
  // Regression: feeding scaled damage (~850) into the verbatim stun formula gave
  // ~10 s stuns per hit after the x1000 health change. The live engine now feeds the
  // CLASS damage (attackDamage x physics) divided by DAMAGE_SCALE.
  for (const c of CLASSES) {
    const a = createStats(c);
    for (const d of CLASSES) {
      const D = createStats(d);
      const dmg = attackDamage(a, D, 1, 0.5) * physicsMultiplier(bodyFromStats(a), bodyFromStats(D), HARNESS_CLOSING_SPEED);
      const stun = stunDuration(dmg / DAMAGE_SCALE, 1.2, 0);
      assert(stun >= 0.05 && stun <= 0.2, `${c}->${d}: stun ${stun.toFixed(3)} s outside 0.05–0.20`);
      assert(stunDuration(dmg, 1.2, 0) > stun * 50, "unscaled damage would have produced absurd stuns");
    }
  }
});

Deno.test("SPEC H2: every class needs 25–160 average hits to kill every other class (armour, crit, physics)", () => {
  assert(HEALTH_SCALE === 1000, "the brief fixes health at x1000");
  for (const c of CLASSES) for (const d of CLASSES) {
    const a = applyRaceBonus(createStats(c), "human", null), D = applyRaceBonus(createStats(d), "human", null);
    // Expected damage per hit: mean roll (0.5), crit priced in at its chance.
    const crit = criticalChance(a.reflex, D.resilience);
    const perHit = attackDamage(a, D, 1, 0.5) * (1 + crit * 0.4)
      * physicsMultiplier(bodyFromStats(a), bodyFromStats(D), HARNESS_CLOSING_SPEED);
    const hits = D.maxHealth / perHit;
    assert(hits >= 25 && hits <= 160, `${c} needs ${hits.toFixed(0)} hits to kill ${d}; band is 25–160`);
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
