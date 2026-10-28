// Lane W (W07): combat profiles derived from the physical axes, normalised to equal expected
// DPS, with the user's trade-offs holding statistically over 2,000 weapons per class:
//   finesse: higher crit chance, lower minimum damage, lower accuracy (misses more);
//   heavy:   lower crit chance, HIGHER minimum AND maximum damage, higher accuracy.

import type { CombatProfile, WeaponClass } from "../src/combat/contracts.ts";
import { rng32, type Summary, summarize } from "../src/core/MathCore.ts";
import { ARCHETYPE_IDS, ARCHETYPES } from "../src/game/weapons/Archetypes.ts";
import { rollWeapon, weaponFromSeed } from "../src/game/weapons/Generate.ts";
import {
  combatProfile, expectedDps, profileTerms, REACTION_TIME, rollStrike, TARGET_DPS,
} from "../src/game/weapons/Profile.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}
const PER_CLASS = 2000;
const CLASSES: WeaponClass[] = ["finesse", "balanced", "heavy", "ranged"];

/** Independent DPS: mean of [min,max] x (1 + cc (cm - 1)) x accuracy / cooldown. */
const dpsOf = (p: CombatProfile) =>
  ((p.minDamage + p.maxDamage) / 2) * (1 + p.critChance * (p.critMultiplier - 1)) * p.accuracy / p.cooldown;

function classSample(c: WeaponClass, seed: number): CombatProfile[] {
  const rng = rng32(seed);
  return Array.from({ length: PER_CLASS }, () => combatProfile(rollWeapon(rng, { classes: [c] })));
}

const FIELDS = ["minDamage", "maxDamage", "critChance", "critMultiplier", "accuracy", "cooldown", "reach", "impact", "armourPierce", "relativeDps"] as const;
type Field = typeof FIELDS[number];

Deno.test("profile: relativeDps within [0.95, 1.05] for 2,000 random weapons (recomputed independently)", () => {
  const rng = rng32(8788);
  const dps: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const w = rollWeapon(rng);
    const p = combatProfile(w);
    const d = dpsOf(p) / TARGET_DPS;
    dps.push(d);
    assert(d >= 0.95 && d <= 1.05, `${w.name}: dps ${d}`);
    assert(Math.abs(p.relativeDps - d) < 1e-3, "relativeDps field agrees with the recomputation");
    assert(Math.abs(expectedDps(p) - dpsOf(p)) < 1e-12, "expectedDps is the documented formula");
    for (const k of FIELDS) assert(Number.isFinite(p[k]) && p[k] >= 0, `${w.name}: ${k} finite`);
    assert(p.minDamage < p.maxDamage, "min < max");
    assert(p.critChance > 0 && p.critChance < 1 && p.accuracy > 0 && p.accuracy <= 1, "probabilities");
    assert(p.armourPierce <= 1 && p.critMultiplier > 1, "pierce and crit multiplier ranges");
  }
  const s = summarize(dps);
  console.log(`relativeDps over 2000 weapons: min ${s.min.toFixed(4)} max ${s.max.toFixed(4)} mean ${s.mean.toFixed(4)} median ${s.median.toFixed(4)}`);
});

Deno.test("profile: Monte Carlo strikes confirm the expectation (one weapon per class, 200k strikes)", () => {
  for (const [id, seed] of [["dagger", 1], ["longsword", 2], ["halberd", 3], ["maul", 4], ["bow", 5]] as const) {
    const p = combatProfile(weaponFromSeed(id, seed));
    const rng = rng32(seed * 31);
    let total = 0, crits = 0, misses = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++) {
      const r = rollStrike(p, rng);
      total += r.multiplier;
      if (r.outcome === "critical") crits++;
      if (r.outcome === "miss") misses++;
    }
    const simDps = total / N / p.cooldown;
    assert(Math.abs(simDps - 1) < 0.02, `${id}: simulated dps ${simDps.toFixed(4)}`);
    assert(Math.abs(misses / N - (1 - p.accuracy)) < 0.01, `${id}: miss rate`);
    assert(Math.abs(crits / N - p.accuracy * p.critChance) < 0.01, `${id}: crit rate`);
  }
});

Deno.test("profile: class trade-offs hold over 2,000 weapons per class (finesse vs heavy)", () => {
  const stats = new Map<WeaponClass, Record<Field, Summary>>();
  CLASSES.forEach((c, i) => {
    const sample = classSample(c, 100 + i);
    const rec = {} as Record<Field, Summary>;
    for (const k of FIELDS) rec[k] = summarize(sample.map((p) => p[k]));
    stats.set(c, rec);
  });
  const f = stats.get("finesse")!, h = stats.get("heavy")!;
  for (const q of ["mean", "median"] as const) {
    assert(f.critChance[q] > h.critChance[q], `crit chance finesse > heavy (${q})`);
    assert(f.critMultiplier[q] > h.critMultiplier[q], `crit multiplier finesse > heavy (${q})`);
    assert(f.minDamage[q] < h.minDamage[q], `min damage finesse < heavy (${q})`);
    assert(f.maxDamage[q] < h.maxDamage[q], `max damage heavy > finesse (${q})`);
    assert(f.accuracy[q] < h.accuracy[q], `accuracy finesse < heavy (${q})`);
  }
  // Stronger than the means: the ranges barely overlap.
  assert(f.critChance.p20 > h.critChance.p80, "crit: finesse p20 above heavy p80");
  assert(f.accuracy.p80 < h.accuracy.p20, "accuracy: finesse p80 below heavy p20");
  assert(f.minDamage.p80 < h.minDamage.p20, "floor: finesse p80 below heavy p20");
  // Spread: the finesse distribution is wider relative to its mean (lower floor, higher variance).
  const relSpread = (s: Record<Field, Summary>) => (s.maxDamage.median - s.minDamage.median) / (s.maxDamage.median + s.minDamage.median);
  assert(relSpread(f) > relSpread(h), "finesse spread wider than heavy");
  const fmt = (s: Summary) => `${s.min.toFixed(3)} / ${s.max.toFixed(3)} / ${s.mean.toFixed(3)} / ${s.median.toFixed(3)}`;
  console.log("class | field | min / max / mean / median  (2000 weapons per class)");
  for (const c of CLASSES) for (const k of FIELDS) console.log(`${c} | ${k} | ${fmt(stats.get(c)![k])}`);
});

Deno.test("profile: dagger reverse grip turns the stab into a thrust (more crit, impact, pierce; shorter reach)", () => {
  let better = 0;
  for (let i = 1; i <= 200; i++) {
    const w = weaponFromSeed("dagger", i * 7);
    const rev = combatProfile(w, "reverse"), fwd = combatProfile(w, "forward");
    const tr = profileTerms(w, "reverse"), tf = profileTerms(w, "forward");
    assert(tr.mix.thrust > tf.mix.thrust, "reverse = more thrust");
    assert(rev.reach < fwd.reach, "reverse = shorter reach");
    assert(Math.abs(dpsOf(rev) - 1) < 0.05 && Math.abs(dpsOf(fwd) - 1) < 0.05, "both grips normalised");
    if (rev.critChance > fwd.critChance && rev.impact > fwd.impact && rev.armourPierce > fwd.armourPierce) better++;
  }
  assert(better === 200, `reverse beats forward on crit, impact and pierce for every dagger (${better}/200)`);
});

Deno.test("profile: derived, not tabled - physics drives the numbers inside one archetype", () => {
  for (const id of ["maul", "longsword", "spear"] as const) {
    const ws = Array.from({ length: 300 }, (_, i) => weaponFromSeed(id, i + 1));
    const I = ws.map((w) => w.inertia + w.mass), cd = ws.map((w) => combatProfile(w).cooldown);
    const si = summarize(I), sc = summarize(cd);
    let cov = 0;
    for (let i = 0; i < I.length; i++) cov += (I[i] - si.mean) * (cd[i] - sc.mean);
    const corr = cov / I.length / (si.stdev * sc.stdev);
    assert(corr > 0.5, `${id}: heavier/longer-lever weapons recover slower (corr ${corr.toFixed(2)})`);
    const sharp = ws.map((w) => w.sharpness), crit = ws.map((w) => combatProfile(w).critChance);
    const ss = summarize(sharp), sk = summarize(crit);
    let cov2 = 0;
    for (let i = 0; i < sharp.length; i++) cov2 += (sharp[i] - ss.mean) * (crit[i] - sk.mean);
    // Pure blunt weapons cannot crit through a keen edge, so only edged/pointed ones are checked.
    if (ARCHETYPES[id].mix.blunt < 1) assert(cov2 > 0, `${id}: sharper -> more crit`);
    else assert(sk.stdev < 1e-3 || cov2 >= -1e-9, `${id}: sharpness does not drive a maul's crit`);
  }
  const bow = weaponFromSeed("bow", 3);
  const p = combatProfile(bow);
  assert(Math.abs(p.cooldown - (bow.ranged!.drawTime + REACTION_TIME)) < 1e-3, "bow cooldown = draw + reaction");
  assert(p.reach > 5, "bow reach comes from arrow speed");
  for (const id of ARCHETYPE_IDS) assert(combatProfile(weaponFromSeed(id, 1)).impact > 0, `${id}: impact`);
});
