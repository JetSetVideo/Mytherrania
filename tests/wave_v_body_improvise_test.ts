// Wave V lane B: the 80/20 improvisation pass over the body's shape knobs (src/graphics/body/Improvise.ts).
// Pins the CONTRACT: exactly 20 % of each part's knobs explored per seed, kept knobs within ± KEEP_JITTER,
// every value inside its knob's bounds, deterministic per seed, volume-kept reshapes, and — measured on the
// races whose grid cell is fixed — no seed ever moves a joint (the solved abductions are seed-independent).
import { EXPLORE_SHARE, improvise, KEEP_JITTER, knobHash, reshapeDepth, reshapeGirth, reshapeLong, SHAPE_KNOBS } from "../src/graphics/body/Improvise.ts";
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { armNode, legNode } from "../src/graphics/body/AnatomyParts.ts";
import { proportionsFor } from "../src/graphics/body/Proportions.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const SEEDS = Array.from({ length: 200 }, (_, i) => (i * 2654435761 + 17) >>> 0);

Deno.test("improvise: exactly 20 % of each part's knobs are explored, the other 80 % kept (shares)", () => {
  const parts = [...new Set(SHAPE_KNOBS.map((k) => k.part))];
  assert(SHAPE_KNOBS.length === 25 && new Set(SHAPE_KNOBS.map((k) => k.id)).size === 25, "25 unique knobs");
  for (const seed of SEEDS) {
    const imp = improvise(seed);
    assert(imp.explored.length === Math.round(EXPLORE_SHARE * SHAPE_KNOBS.length), `seed ${seed}: ${imp.explored.length} explored`);
    for (const p of parts) {
      const own = SHAPE_KNOBS.filter((k) => k.part === p);
      const ex = imp.explored.filter((id) => id.startsWith(`${p}.`));
      assert(ex.length === Math.round(EXPLORE_SHARE * own.length), `seed ${seed} part ${p}: ${ex.length} of ${own.length} explored`);
    }
  }
});

Deno.test("improvise: every value inside its bounds; kept knobs move at most ± KEEP_JITTER; explored knobs roam the range", () => {
  const span = new Map<string, [number, number]>();
  for (const seed of SEEDS) {
    const imp = improvise(seed);
    for (const k of SHAPE_KNOBS) {
      const v = imp.values[k.id];
      assert(Number.isFinite(v) && v >= k.min - 1e-12 && v <= k.max + 1e-12, `${k.id} = ${v} outside [${k.min}, ${k.max}]`);
      if (!imp.explored.includes(k.id)) assert(Math.abs(v - 1) <= KEEP_JITTER + 1e-12, `kept ${k.id} = ${v}`);
      else {
        const s = span.get(k.id) ?? [Infinity, -Infinity];
        span.set(k.id, [Math.min(s[0], v), Math.max(s[1], v)]);
      }
    }
  }
  // Over 200 seeds every knob is explored 40+ times; its explored values cover most of its range,
  // far beyond the kept band (which is ±3 % wide).
  for (const k of SHAPE_KNOBS) {
    const s = span.get(k.id);
    assert(s, `${k.id} was never explored in 200 seeds`);
    assert((s[1] - s[0]) / (k.max - k.min) > 0.6, `${k.id} explored only ${((s[1] - s[0]) / (k.max - k.min) * 100).toFixed(0)} % of its range`);
  }
});

Deno.test("improvise: deterministic per seed, and different seeds explore different knobs", () => {
  const a = improvise(1234), b = improvise(1234);
  assert(JSON.stringify(a) === JSON.stringify(b), "same seed, same draw");
  const sets = new Set(SEEDS.slice(0, 40).map((s) => improvise(s).explored.slice().sort().join("|")));
  assert(sets.size > 20, `only ${sets.size} distinct explored sets in 40 seeds`);
  assert(knobHash(7, "arm.biceps.shape", 1) === knobHash(7, "arm.biceps.shape", 1) && knobHash(7, "x", 1) !== knobHash(8, "x", 1), "hash is stable and seeded");
});

Deno.test("improvise: the reshapes keep an ellipsoid's volume (shape, girth, depth)", () => {
  const size: [number, number, number] = [0.031, 0.12, 0.027];
  const vol = (s: number[]) => s[0] * s[1] * s[2];
  for (const v of [0.82, 0.9, 1, 1.07, 1.18]) {
    for (const f of [reshapeLong, reshapeGirth, reshapeDepth]) {
      assert(Math.abs(vol(f(size, v)) / vol(size) - 1) < 1e-12, `${f.name}(${v}) changed the volume`);
    }
    assert(reshapeDepth(size, v)[0] === size[0], "reshapeDepth never touches x (the medial-lateral extent)");
  }
});

Deno.test("improvise: bodies differ in DETAIL per seed, and no seed moves a joint (fixed-cell races)", () => {
  // Detail: two seeds build different arm and leg trees at the same proportions.
  const P = proportionsFor({ race: "human", subrace: null, className: "Warrior", height: 1.76, weight: 76, seed: 1 });
  const Q = { ...P, spec: { ...P.spec, seed: 2 } };
  assert(JSON.stringify(armNode(P, 1, 0.3).node) !== JSON.stringify(armNode(Q, 1, 0.3).node), "seed changes the arm's detail");
  assert(JSON.stringify(legNode(P, 1, 0.05).node) !== JSON.stringify(legNode(Q, 1, 0.05).node), "seed changes the leg's detail");
  // Joints: humans and orks keep the DuBois cell (within the refinement tolerance), so every solved
  // abduction is a pure function of the proportions — identical across seeds (pre-wave: also seed-free).
  for (const s of [{ race: "human", height: 1.76, weight: 76 }, { race: "ork", height: 1.98, weight: 118 }]) {
    const rows = new Set<string>();
    for (const seed of [1, 2, 3, 4]) {
      const p = anatomyFor({ ...s, subrace: null, className: "Warrior", seed, sex: "male" });
      rows.add(`${p.cell}|${p.armAbduction}|${p.legAbduction}|${p.armDisplayAbduction}`);
    }
    assert(rows.size === 1, `${s.race}: joints differ across seeds: ${[...rows].join(" ; ")}`);
  }
});
