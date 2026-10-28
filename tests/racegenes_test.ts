// Race genes: the resolver and the random generator.
//
// These pin the four guarantees the generator exists to make: a range resolves for
// every part of every race, influences move a range toward (or away from) a neighbour
// without ever escaping the part's legal bounds, ratios evaluate and gate the
// silhouette, and a rolled body stays inside its legal ranges while rarely breaking a
// ratio. The last case measures the violation rate directly.
import genes from "../artifacts/design/race-genes.json" with { type: "json" };
import {
  applyInfluences,
  checkRatios,
  randomRaceBody,
  ratioValue,
  resolvePartAxis,
} from "../src/game/RaceGenes.ts";

type Axis = "x" | "y" | "z";
interface Rng { min: number; max: number }
interface JInfluence { part: string; axis: string; weight: number; sign: number }
interface JPart {
  axis: Record<string, Rng>;
  parent: string | null;
  children: string[];
  neighbours: string[];
  influences: JInfluence[];
}
interface JRatio {
  label: string;
  numerator: string;
  denominator: string;
  bounds: Rng;
  perRace: Record<string, number>;
  note: string;
}
interface JRace {
  stature: number;
  parts: Record<string, { axis: Record<string, Rng> }>;
  ratioTargets: Record<string, number>;
}
const DATA = genes as unknown as {
  parts: Record<string, JPart>;
  ratios: Record<string, JRatio>;
  races: Record<string, JRace>;
};

const PARTS = Object.keys(DATA.parts);
const RACES = Object.keys(DATA.races);
const AXES: Axis[] = ["x", "y", "z"];

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

/** A deterministic LCG, so the generator's measurement is reproducible. */
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The legal envelope for an axis: the union of every race's band, NOT the top-level entry.
 * The top-level numbers are the HUMAN reference, and an elf's chest is narrower than a
 * human's, so asserting an elf against the human band tests the wrong bound.
 */
function legal(part: string, axis: Axis): Rng {
  const t = DATA.parts[part].axis[axis];
  let min = t.min;
  let max = t.max;
  for (const race of RACES) {
    const a = DATA.races[race].parts[part]?.axis[axis];
    if (a) {
      min = Math.min(min, a.min);
      max = Math.max(max, a.max);
    }
  }
  return { min, max };
}

Deno.test("every part resolves for every race, and min<=max always", () => {
  for (const race of RACES) {
    for (const part of PARTS) {
      for (const axis of AXES) {
        const r = resolvePartAxis(part, axis, race);
        assert(Number.isFinite(r.min) && Number.isFinite(r.max), `${race}/${part}.${axis} is non-finite`);
        assert(r.min <= r.max, `${race}/${part}.${axis} is inverted (${r.min}..${r.max})`);
      }
    }
  }
});

Deno.test("entry points are total: junk input never yields NaN", () => {
  const r = resolvePartAxis("no-such-part", "x", "no-such-race");
  assert(Number.isFinite(r.min) && Number.isFinite(r.max), "unknown part/race produced a non-finite range");
  const inf = applyInfluences("chest", "x", { chest: { x: Number.NaN } }, "human");
  assert(Number.isFinite(inf.min) && Number.isFinite(inf.max), "NaN input produced a non-finite range");
  const v = ratioValue("no-such-ratio", {}, "human");
  assert(Number.isFinite(v), "unknown ratio produced a non-finite value");
  const report = checkRatios({ chest: { x: Number.NaN } }, "human");
  assert(report.every((e) => Number.isFinite(e.value)), "checkRatios reported a non-finite value");
});

Deno.test("applyInfluences moves the range toward a neighbour and never escapes the absolute bounds", () => {
  let exercised = 0;
  for (const race of RACES) {
    for (const part of PARTS) {
      // A range can only be asserted to travel in a direction when EVERY influencer on that
      // axis agrees, because the pulls are weighted and summed. Driving one of chest.z's two
      // influencers proves nothing: the other, left at its base, can outweigh it.
      const byAxis = new Map<string, { part: string; axis: string; weight: number }[]>();
      for (const inf of DATA.parts[part].influences) {
        if (inf.sign !== 1) continue;
        const list = byAxis.get(inf.axis) ?? [];
        list.push(inf);
        byAxis.set(inf.axis, list);
      }
      for (const [axis, infs] of byAxis) {
        const abs = legal(part, axis as Axis);
        const base = resolvePartAxis(part, axis as Axis, race);
        const baseCentre = (base.min + base.max) / 2;
        const vals: Record<string, Record<string, number>> = {};
        let wsum = 0;
        let wtarget = 0;
        for (const inf of infs) {
          const v = DATA.parts[inf.part].axis[inf.axis].max;
          vals[inf.part] = { [inf.axis]: v };
          wsum += inf.weight;
          wtarget += inf.weight * v;
        }
        const r = applyInfluences(part, axis as Axis, vals, race);
        assert(r.min <= r.max, `${race}/${part}.${axis} came back inverted`);
        assert(r.min >= abs.min - 1e-9 && r.max <= abs.max + 1e-9, `${race}/${part}.${axis} escaped [${abs.min}, ${abs.max}]`);
        assert(r.max - r.min <= base.max - base.min + 1e-9, `${race}/${part}.${axis} did not tighten`);
        // "Toward" is toward the WEIGHTED TARGET of the influencers, not upward: a part whose
        // neighbours all sit below it must move DOWN when they are driven to their max.
        const target = wsum > 0 ? wtarget / wsum : baseCentre;
        const dir = target - baseCentre;
        const moved = (r.min + r.max) / 2 - baseCentre;
        if (dir !== 0) {
          assert(
            moved * dir >= -1e-9,
            `${race}/${part}.${axis} did not move toward the weighted target ${target.toFixed(4)} (base ${baseCentre.toFixed(4)}, moved ${moved.toFixed(4)})`,
          );
        }
        exercised++;
      }
    }
  }
  assert(exercised > 0, "no sign:1 influence in the data could be exercised");
});

Deno.test("a sign:-1 influence pushes the range the other way", () => {
  let exercised = 0;
  for (const race of RACES) {
    for (const part of PARTS) {
      for (const inf of DATA.parts[part].influences) {
        if (inf.sign !== -1) continue;
        const axis = inf.axis as Axis;
        const nRange = DATA.parts[inf.part].axis[inf.axis];
        // Same call, same everything, except the sign:-1 neighbour travels from its min to
        // its max. A sign:+1 pull would raise the range; a sign:-1 pull must lower it.
        const atMin = applyInfluences(part, axis, { [inf.part]: { [inf.axis]: nRange.min } }, race);
        const atMax = applyInfluences(part, axis, { [inf.part]: { [inf.axis]: nRange.max } }, race);
        const cMin = (atMin.min + atMin.max) / 2;
        const cMax = (atMax.min + atMax.max) / 2;
        assert(
          cMax <= cMin + 1e-9,
          `${race}/${part}.${axis}: raising a sign:-1 neighbour must not raise the range (${cMin.toFixed(4)} -> ${cMax.toFixed(4)})`,
        );
        exercised++;
      }
    }
  }
  assert(exercised > 0, "no sign:-1 influence in the data");
});

Deno.test("influences are mutual: if A lists B then B lists A", () => {
  for (const a of PARTS) {
    for (const inf of DATA.parts[a].influences) {
      const b = inf.part;
      assert(DATA.parts[b] !== undefined, `${a} influences unknown part '${b}'`);
      assert(
        DATA.parts[b].influences.some((x) => x.part === a),
        `${a} lists ${b}, but ${b} does not list ${a} — influences must be mutual`,
      );
    }
  }
});

Deno.test("ratioValue matches a hand-computed case", () => {
  const entry = Object.entries(DATA.ratios).find(
    ([, r]) => r.numerator.includes(".") && r.denominator.includes("."),
  );
  assert(entry !== undefined, "no direct part.axis ratio to hand-compute");
  const [id, ratio] = entry!;
  const [numPart, numAxis] = ratio.numerator.split(".");
  const [denPart, denAxis] = ratio.denominator.split(".");
  const body: Record<string, Record<Axis, number>> = {
    [numPart]: { x: 0, y: 0, z: 0 },
    [denPart]: { x: 0, y: 0, z: 0 },
  };
  body[numPart][numAxis as Axis] = 4;
  body[denPart][denAxis as Axis] = 2;
  assert(Math.abs(ratioValue(id, body, RACES[0]) - 2) < 1e-9, `expected 4/2 = 2, got ${ratioValue(id, body, RACES[0])}`);
});

Deno.test("checkRatios reports exactly the out-of-range ratios", () => {
  const race = RACES[0];
  const entry = Object.entries(DATA.ratios).find(([, r]) => r.numerator.includes("."));
  assert(entry !== undefined, "no direct part.axis ratio to force out of range");
  const [id, ratio] = entry!;
  const [numPart, numAxis] = ratio.numerator.split(".");
  // Start from a legal body, then drive one ratio far above its range.
  const body = randomRaceBody(race, rng(7));
  body[numPart][numAxis as Axis] = legal(numPart, numAxis as Axis).max;

  const expected = Object.keys(DATA.ratios)
    .filter((k) => {
      const v = ratioValue(k, body, race);
      const b = DATA.ratios[k].bounds;
      return v < b.min || v > b.max;
    })
    .sort();
  const got = checkRatios(body, race).map((e) => e.id).sort();
  assert(JSON.stringify(got) === JSON.stringify(expected), `checkRatios ${JSON.stringify(got)} != out-of-range ${JSON.stringify(expected)}`);
  assert(got.includes(id), `the ratio forced out of range (${id}) was not reported`);
  for (const e of checkRatios(body, race)) {
    assert(e.value < e.min || e.value > e.max, `${e.id} was reported but is in range`);
  }
});

Deno.test("randomRaceBody stays in legal bounds and keeps the ratio-violation rate below 5%", () => {
  const N = 200;
  let totalViolations = 0;
  for (const race of RACES) {
    const rand = rng(20261011);
    let bad = 0;
    for (let i = 0; i < N; i++) {
      const body = randomRaceBody(race, rand);
      for (const part of PARTS) {
        for (const axis of AXES) {
          const v = body[part]?.[axis];
          assert(Number.isFinite(v), `${race} sample ${i}: ${part}.${axis} is non-finite`);
          const abs = legal(part, axis);
          assert(
            v >= abs.min - 1e-9 && v <= abs.max + 1e-9,
            `${race} sample ${i}: ${part}.${axis}=${v} outside legal [${abs.min}, ${abs.max}]`,
          );
        }
      }
      if (checkRatios(body, race).length > 0) bad++;
    }
    const rate = bad / N;
    console.log(`${race}: ratio-violation rate ${(rate * 100).toFixed(1)}% (${bad}/${N})`);
    assert(rate < 0.05, `${race}: ratio-violation rate ${(rate * 100).toFixed(1)}% must be below 5%`);
    totalViolations += bad;
  }
  console.log(`all races: ${totalViolations} violating samples of ${N * RACES.length}`);
});
