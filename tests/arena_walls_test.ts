// Wave J lane J-T: wall plans from combined rules (src/game/arena/walls.ts).
import { makeArena, randomArena, type ArenaConfig } from "../src/game/ArenaConfig.ts";
import { seededRng } from "../src/game/Items.ts";
import { WALL_BLOCK_HEIGHT, WALL_RULE_KINDS, WALL_SEGMENTS, type SymmetrySpec, type WallPlan } from "../src/game/arena/contracts.ts";
import { applyOpBearing, symmetryFor, symmetryOps } from "../src/game/arena/symmetry.ts";
import { GATE_MIN_WIDTH, planEnclosure, segmentIndexAt, WALL_COMBINES, WALL_MAX_HEIGHT, wallHeightAt, wallPlanFor, wallRulesFor } from "../src/game/arena/walls.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}
const TAU = Math.PI * 2;
const SEG = TAU / WALL_SEGMENTS;

/** Structural validity of a plan: 48 contiguous segments covering [0, 2π], finite non-negative values. */
function validPlan(p: WallPlan, label: string): void {
  assert(p.segments.length === WALL_SEGMENTS, `${label}: ${p.segments.length} segments`);
  assert(Math.abs(p.segments[0].a0) < 1e-12, `${label}: first segment starts at ${p.segments[0].a0}`);
  assert(Math.abs(p.segments[WALL_SEGMENTS - 1].a1 - TAU) < 1e-12, `${label}: last segment ends at ${p.segments[WALL_SEGMENTS - 1].a1}`);
  let width = 0, cover = 0, mean = 0, max = 0;
  for (let k = 0; k < p.segments.length; k++) {
    const s = p.segments[k];
    if (k > 0) assert(Math.abs(s.a0 - p.segments[k - 1].a1) < 1e-12, `${label}: gap before segment ${k}`);
    assert(s.a1 > s.a0, `${label}: empty segment ${k}`);
    for (const v of [s.height, s.resistance, s.bounce]) assert(Number.isFinite(v) && v >= 0, `${label}: segment ${k} value ${v}`);
    assert(s.height <= WALL_MAX_HEIGHT + 1e-12, `${label}: segment ${k} height ${s.height} > ${WALL_MAX_HEIGHT}`);
    assert(s.bounce <= 1, `${label}: bounce ${s.bounce}`);
    assert((s.height === 0) === (s.resistance === 0), `${label}: an opening has no resistance and a wall has some`);
    width += s.a1 - s.a0;
    if (s.height >= WALL_BLOCK_HEIGHT) cover += s.a1 - s.a0;
    mean += (s.a1 - s.a0) * s.height;
    max = Math.max(max, s.height);
  }
  assert(Math.abs(width - TAU) < 1e-9, `${label}: segments cover ${width} rad`);
  assert(Math.abs(p.coverage - cover / TAU) < 1e-9 && Math.abs(p.meanHeight - mean / TAU) < 1e-9 && p.maxHeight === max, `${label}: summary disagrees`);
  const wsum = p.rules.reduce((a, r) => a + r.weight, 0);
  assert(p.rules.length >= 1 && p.rules.length <= 3 && Math.abs(wsum - 1) < 1e-9, `${label}: ${p.rules.length} rules, weights sum ${wsum}`);
}

const BASE = (over: Partial<ArenaConfig> = {}) => makeArena({ size: 34, walls: 1, wallHeight: 0.9, wallTall: 2.8, wallLow: 0.45, ...over });

Deno.test("wall plan: deterministic per seed and config; the ruin noise follows the seed", () => {
  for (let s = 0; s < 50; s++) {
    const cfg = randomArena(seededRng(s));
    const sym = symmetryFor(cfg);
    assert(JSON.stringify(wallPlanFor(cfg, s, sym)) === JSON.stringify(wallPlanFor(cfg, s, sym)), `seed ${s} not reproducible`);
  }
  const ruin = BASE({ wallRule: 3, wallGap: 0.4 });
  const a = wallPlanFor(ruin, 1), b = wallPlanFor(ruin, 2);
  assert(a.segments.some((s, k) => s.height !== b.segments[k].height), "two ruin seeds should differ");
});

Deno.test("wall plan: every rule kind and every combine mode builds valid contiguous segments", () => {
  let checked = 0;
  for (let r1 = 0; r1 < WALL_RULE_KINDS.length; r1++) {
    for (let r2 = -1; r2 < WALL_RULE_KINDS.length; r2++) {
      for (let c = 0; c < WALL_COMBINES.length; c++) {
        for (const r3 of [-1, (r1 + 3) % 8]) {
          const cfg = BASE({ wallRule: r1, wallRule2: r2, wallRule3: r3, wallCombine: c, wallMix: 0.45 });
          for (const sym of [symmetryFor(cfg), { kind: "rotational", order: 4, axisDeg: 7.5 } as SymmetrySpec]) {
            validPlan(wallPlanFor(cfg, 11 + r1, sym), `rules ${r1}/${r2}/${r3} combine ${WALL_COMBINES[c]} ${sym.kind}`);
            checked++;
          }
        }
      }
    }
  }
  console.log(`  validated ${checked} plans (8 primary x 9 secondary x 4 combine x 2 third x 2 symmetries)`);
});

Deno.test("wall rules mean what the contract says", () => {
  const h = (cfg: ArenaConfig) => wallPlanFor(cfg, 3).segments.map((s) => s.height);
  assert(h(BASE({ wallRule: 0 })).every((v) => v === 0), "none: no wall anywhere");
  assert(h(BASE({ wallRule: 1, wallLow: 0.4 })).every((v) => Math.abs(v - 0.4) < 1e-12), "low: a constant curb");
  assert(h(BASE({ wallRule: 2, wallHeight: 1.1 })).every((v) => Math.abs(v - 1.1) < 1e-12), "full: the base height all round");
  // gates: 2 openings (asymmetric map), each at least two segments wide, perpendicular to the spawn line.
  const gates = wallPlanFor(BASE({ wallRule: 5, wallGate: 15, spawnAngle: 180 }), 3);
  const openIdx = gates.segments.map((s, k) => (s.height === 0 ? k : -1)).filter((k) => k >= 0);
  assert(openIdx.length >= 4, `gates: ${openIdx.length} open segments (≥ 2 per gate)`);
  assert(GATE_MIN_WIDTH >= 2 * SEG - 1e-12, "a gate is at least two segments wide");
  assert(gates.segments[segmentIndexAt(gates, Math.PI / 2)].height === 0 && gates.segments[segmentIndexAt(gates, -Math.PI / 2)].height === 0, "gates at ±90° from a seat at 180°");
  assert(gates.segments[segmentIndexAt(gates, Math.PI)].height > 0, "no gate behind the seat");
  // half: walled arc of the requested span.
  const half = wallPlanFor(BASE({ wallRule: 6, wallArc: 180, wallHeight: 0.9 }), 3);
  assert(Math.abs(half.coverage - 0.5) <= 1 / WALL_SEGMENTS + 1e-9, `half: coverage ${half.coverage}`);
  // towers: `count` tall spots on a low wall.
  const towers = wallPlanFor(BASE({ wallRule: 7, wallTowers: 4, wallTall: 3, wallLow: 0.4 }), 3);
  const tall = towers.segments.filter((s) => s.height === 3).length;
  assert(tall >= 4 && tall <= 8, `towers: ${tall} tall segments for 4 towers`);
  assert(towers.segments.filter((s) => Math.abs(s.height - 0.4) < 1e-12).length === WALL_SEGMENTS - tall, "towers: the rest is the curb");
  assert(towers.maxHeight === 3, "towers reach wallTall");
  // battlement: alternating merlons and (open) crenels.
  const bat = wallPlanFor(BASE({ wallRule: 4, wallPeriod: 6, wallTall: 3, wallLow: 0.45 }), 3);
  const hs = bat.segments.map((s) => s.height);
  assert(new Set(hs).size === 2 && Math.min(...hs) < WALL_BLOCK_HEIGHT && Math.max(...hs) >= 2.4, `battlement heights ${[...new Set(hs)]}`);
  assert(Math.abs(bat.coverage - 0.5) < 1e-9, `battlement: half merlons, half crenels (${bat.coverage})`);
  // walls = 0: no wall at all, whatever the rules say.
  const none = wallPlanFor(BASE({ walls: 0, wallRule: 2 }), 3);
  assert(none.segments.every((s) => s.height === 0) && none.coverage === 0 && planEnclosure(none) === "open", "walls 0 = no wall");
  assert(wallRulesFor(BASE({ walls: 0 }), 3).rules[0].kind === "none", "walls 0 reports a single none rule");
});

Deno.test("combine modes: blend is the weighted mean, max/min the envelope, sectors split by weight", () => {
  const two = (combine: number) => wallPlanFor(BASE({ wallRule: 2, wallRule2: 1, wallMix: 0.25, wallHeight: 1.2, wallLow: 0.4, wallCombine: combine }), 3);
  assert(two(0).segments.every((s) => Math.abs(s.height - (0.75 * 1.2 + 0.25 * 0.4)) < 1e-12), "blend");
  assert(two(1).segments.every((s) => Math.abs(s.height - 1.2) < 1e-12), "max");
  assert(two(2).segments.every((s) => Math.abs(s.height - 0.4) < 1e-12), "min");
  const sec = two(3);
  const full = sec.segments.filter((s) => Math.abs(s.height - 1.2) < 1e-12).length;
  assert(Math.abs(full / WALL_SEGMENTS - 0.75) <= 1 / WALL_SEGMENTS + 1e-9, `sectors: ${full}/48 segments for weight 0.75`);
});

Deno.test("wallHeightAt reads the segment under any bearing (wrapping)", () => {
  const plan = wallPlanFor(BASE({ wallRule: 7, wallTowers: 5 }), 9);
  for (let k = 0; k < WALL_SEGMENTS; k++) {
    const c = (k + 0.5) * SEG;
    assert(wallHeightAt(plan, c) === plan.segments[k].height, `segment ${k}`);
    assert(wallHeightAt(plan, c - TAU) === plan.segments[k].height && wallHeightAt(plan, c + 3 * TAU) === plan.segments[k].height, `wrap ${k}`);
  }
});

Deno.test("symmetric maps get symmetric walls (exact on the 48-segment lattice; order 5 measured)", () => {
  let exact = 0, rot5 = 0, rot5Mismatch = 0, rot5Total = 0;
  for (let s = 0; s < 600; s++) {
    const cfg = randomArena(seededRng(s));
    const sym = symmetryFor(cfg);
    if (sym.kind === "none" || cfg.walls < 1) continue;
    const plan = wallPlanFor(cfg, s, sym);
    for (const op of symmetryOps(sym)) {
      for (let k = 0; k < WALL_SEGMENTS; k++) {
        const c = (k + 0.5) * SEG;
        const same = wallHeightAt(plan, applyOpBearing(op, c)) === plan.segments[k].height;
        if (sym.kind === "rotational" && sym.order === 5) { rot5Total++; if (!same) rot5Mismatch++; }
        else assert(same, `seed ${s} ${sym.kind}/${sym.order} axis ${sym.axisDeg}: segment ${k} differs from its image`);
      }
    }
    if (sym.kind === "rotational" && sym.order === 5) rot5++; else exact++;
  }
  console.log(`  exact on ${exact} symmetric walled plans; rotational-5: ${rot5} plans, ${rot5Mismatch}/${rot5Total} segment-image pairs differ (${(100 * rot5Mismatch / Math.max(1, rot5Total)).toFixed(1)}%)`);
  assert(exact > 100, `too few symmetric plans checked (${exact})`);
  assert(rot5Mismatch / Math.max(1, rot5Total) < 0.12, "order 5 off-lattice mismatch stays small");
});

Deno.test("random arenas: walls are DRASTICALLY lower, often open, mixed, with occasional tall parts (2000 arenas)", () => {
  const N = 2000;
  const seg: number[] = [], walled: number[] = [];
  let open = 0, enclosed = 0, mixed = 0, tall = 0, mostlyOpen = 0;
  for (let s = 0; s < N; s++) {
    const cfg = randomArena(seededRng(s));
    const plan = wallPlanFor(cfg, s, symmetryFor(cfg));
    for (const g of plan.segments) { seg.push(g.height); if (g.height > 0) walled.push(g.height); }
    const e = planEnclosure(plan);
    if (e === "open") open++; else if (e === "enclosed") enclosed++; else mixed++;
    if (plan.maxHeight >= 2) tall++;
    if (plan.coverage <= 0.5) mostlyOpen++;
  }
  const sorted = [...seg].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = seg.reduce((a, b) => a + b, 0) / seg.length;
  const band = walled.filter((h) => h >= 0.3 && h <= 1.2).length / walled.length;
  const report = {
    arenas: N, segmentMean: +mean.toFixed(3), median: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3), p99: +q(0.99).toFixed(3), max: +sorted[sorted.length - 1].toFixed(3),
    fullyOpen: open / N, fullyEnclosed: enclosed / N, mixed: mixed / N, mostlyOpen: mostlyOpen / N, withTallPart2m: tall / N, walledIn0p3to1p2: +band.toFixed(3),
  };
  console.log("  new wall distribution:", JSON.stringify(report));
  // The old roll: one 1.4..6 m wall all round in 90% of arenas (median 3.45 m, p90 5.5 m, 0% mixed).
  assert(report.median < 1.2, `median ${report.median} m should be < 1.2 m`);
  assert(report.segmentMean < 1.0, `mean ${report.segmentMean} m should be < 1 m (old 3.35 m)`);
  assert(report.p90 < 2.0, `p90 ${report.p90} m should be < 2 m (old 5.5 m)`);
  assert(report.walledIn0p3to1p2 > 0.6, `most of the walled perimeter is 0.3..1.2 m (${report.walledIn0p3to1p2})`);
  assert(report.max > 3 && report.max <= WALL_MAX_HEIGHT, `tall parts reach ~3.5 m (${report.max})`);
  assert(report.withTallPart2m > 0.05, `some arenas keep a tall part (${report.withTallPart2m})`);
  assert(report.fullyOpen > 0.2, `a real share of arenas has no blocking wall at all (${report.fullyOpen})`);
  assert(report.mixed > 0.15, `a real share is partly open (${report.mixed})`);
  assert(report.fullyEnclosed < 0.5, `enclosure is no longer the norm (${report.fullyEnclosed})`);
});
