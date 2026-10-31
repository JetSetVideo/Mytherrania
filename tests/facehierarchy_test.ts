// Lane P-B: the facial-ratio hierarchy and the hair/beard law, proved on the data. Every number
// printed here is GENERATED from artifacts/design/ancestry.json (ranks 1..16 and the ratio
// divisions) - nothing in the tables is typed by hand.
import {
  ANCESTRY,
  FACE_METRICS,
  FACE_UNITS,
  type FaceMetricName,
  validateAncestry,
} from "../src/game/Ancestry.ts";
import {
  beardLaw,
  beardOrder,
  compare,
  type FaceRatios,
  faceRatios,
  HAIR_LENGTH_TIER,
  hairLaw,
  hairOrder,
  NODE_COUNT,
  paletteSpread,
  rankMetric,
  rankRatio,
  RATIO_KEYS,
  RATIO_LABELS,
} from "../src/ui/FaceHierarchy.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const IDS = Object.keys(ANCESTRY);
/** The nodes of one race block: its race node plus its 3 subraces. */
const lineOf = (race: string) => IDS.filter((id) => ANCESTRY[id].race === race);
const pad = (s: string, n: number) => s.padEnd(n);
const num = (v: number, d = 1) => v.toFixed(d);

Deno.test("face block: every node carries all 17 measures, each a strict 1..16 permutation", () => {
  const problems = validateAncestry();
  assert(problems.length === 0, `validateAncestry problems:\n  ${problems.join("\n  ")}`);
  assert(IDS.length === NODE_COUNT, `${IDS.length} nodes, expected ${NODE_COUNT}`);
  for (const id of IDS) {
    const f = ANCESTRY[id].face;
    for (const m of FACE_METRICS) {
      assert(Number.isInteger(f[m]) && f[m] >= 1 && f[m] <= 16, `${id}.face.${m} = ${f[m]}`);
      assert(typeof FACE_UNITS[m] === "string" && FACE_UNITS[m].length > 0, `${m} needs a unit`);
    }
  }
  for (const m of FACE_METRICS) {
    const ranks = IDS.map((id) => ANCESTRY[id].face[m]);
    assert(new Set(ranks).size === NODE_COUNT, `${m} is not a strict 1..16 permutation`);
    assert(Math.min(...ranks) === 1 && Math.max(...ranks) === 16, `${m} must span 1..16`);
  }
});

Deno.test("rankMetric: 16 rows, unique ranks, most first; the race-block structure is readable", () => {
  for (const m of FACE_METRICS) {
    const rows = rankMetric(m);
    assert(rows.length === NODE_COUNT, `${m}: ${rows.length} rows`);
    assert(new Set(rows.map((r) => r.id)).size === NODE_COUNT, `${m}: ids unique`);
    assert(new Set(rows.map((r) => r.value)).size === NODE_COUNT, `${m}: ranks unique`);
    for (let i = 1; i < rows.length; i++) {
      assert(rows[i].value > rows[i - 1].value, `${m}: not ascending`);
    }
    assert(rows[0].value === 1 && rows[rows.length - 1].value === 16, `${m}: span`);
  }
  // Sanity the brief states out loud: the dwarf line pours the most into the chin.
  const chin = rankMetric("chinLength");
  assert(
    chin[0].id === "mountain" && ANCESTRY[chin[0].id].race === "dwarf",
    `longest chin should be a dwarf, got ${chin[0].id}`,
  );
  assert(
    new Set(chin.slice(0, 4).map((r) => ANCESTRY[r.id].race)).size === 1,
    "the top-4 longest chins are one race block",
  );
});

Deno.test("faceRatios: finite, positive; a dwarf jaw beats an elf jaw on chin-to-mouth", () => {
  for (const id of IDS) {
    const r = faceRatios(ANCESTRY[id]);
    for (const k of RATIO_KEYS) assert(Number.isFinite(r[k]) && r[k] > 0, `${id}.${k} = ${r[k]}`);
  }
  const d = faceRatios(ANCESTRY.dwarf), e = faceRatios(ANCESTRY.elf);
  assert(
    d.chinToMouth > e.chinToMouth,
    `dwarf chinToMouth ${d.chinToMouth} should beat elf ${e.chinToMouth}`,
  );
});

Deno.test("rankRatio: biggest first across all 16 nodes", () => {
  for (const k of RATIO_KEYS) {
    const rows = rankRatio(k);
    assert(rows.length === NODE_COUNT, `${k}: ${rows.length} rows`);
    for (let i = 1; i < rows.length; i++) {
      assert(rows[i].value <= rows[i - 1].value, `${k}: not descending`);
    }
  }
  assert(
    ANCESTRY[rankRatio("chinToMouth")[0].id].race === "dwarf",
    "biggest chin-to-mouth is a dwarf",
  );
});

Deno.test("compare: criteria stated in order, signs antisymmetric, self-comparison is a tie", () => {
  const c = compare("dwarf", "elf");
  assert(c.criteria.join() === RATIO_KEYS.join(), "compare walks RATIO_KEYS");
  assert(c.rows.length === RATIO_KEYS.length, "one row per criterion");
  c.rows.forEach((row, i) => {
    assert(row.criterion === RATIO_KEYS[i], `row ${i} out of order`);
    assert(row.label === RATIO_LABELS[RATIO_KEYS[i]], `row ${i} label`);
  });
  const rev = compare("elf", "dwarf");
  c.rows.forEach((row, i) => {
    assert(row.sign === -rev.rows[i].sign, `${RATIO_KEYS[i]}: sign must flip`);
    assert(
      Math.abs(row.a - rev.rows[i].b) < 1e-12 && Math.abs(row.b - rev.rows[i].a) < 1e-12,
      `${RATIO_KEYS[i]}: a/b swap`,
    );
  });
  assert(
    c.score.a + c.score.b + c.score.ties === RATIO_KEYS.length,
    "score covers every criterion",
  );
  assert(
    c.verdict === (c.score.a > c.score.b ? "dwarf" : c.score.b > c.score.a ? "elf" : null),
    "verdict follows the score",
  );
  const self = compare("high", "high");
  assert(
    self.rows.every((r) => r.sign === 0) && self.verdict === null,
    "a node against itself ties every criterion",
  );
  assert(
    compare("nope", "nope").a === "human",
    "an unknown id falls back to human, like compareAncestry",
  );
});

Deno.test("hair/beard law: elves lightest+longest, dwarves fullest+always bearded, humans widest, orks baldest", () => {
  const elfSet = new Set(lineOf("elf"));
  for (const row of hairOrder().slice(0, 4)) {
    assert(elfSet.has(row.id), `${row.id} is top-4 lightness but not an elf`);
  }
  const topTier = Math.max(...hairLaw().map((r) => r.lengthTier));
  assert(
    hairLaw().filter((r) => r.lengthTier === topTier).some((r) => elfSet.has(r.id)),
    "the longest tier includes an elf",
  );
  assert(
    HAIR_LENGTH_TIER.verylong === 4 && ANCESTRY.elf.hair.length === "verylong",
    "elf hair is the verylong tier",
  );
  const widest = hairLaw().reduce((a, b) => (b.spread > a.spread ? b : a));
  assert(
    ANCESTRY[widest.id].race === "human",
    `widest hair range should be human, got ${widest.id}`,
  );
  assert(
    paletteSpread(ANCESTRY[widest.id].hair.colors) === widest.spread,
    "the spread is the palette luminance range",
  );
  const spreadRows = [...hairLaw()].sort((a, b) => b.spread - a.spread);
  assert(
    spreadRows.slice(0, 4).every((r) => ANCESTRY[r.id].race === "human"),
    "the human line holds the widest hair ranges",
  );
  const baldest = hairLaw().reduce((a, b) => (b.baldChance > a.baldChance ? b : a));
  assert(ANCESTRY[baldest.id].race === "ork", `baldest should be an ork, got ${baldest.id}`);
  assert(ANCESTRY.elf.hair.baldChance === 0, "no bald elves");
  for (const id of lineOf("dwarf")) {
    assert(beardLaw().find((b) => b.id === id)!.required === true, `${id} dwarf must be bearded`);
  }
  const dwarfSet = new Set(lineOf("dwarf"));
  for (const row of beardOrder().slice(0, 4)) {
    assert(dwarfSet.has(row.id), `${row.id} is top-4 fullness but not a dwarf`);
  }
});

// The printed tables: the six required metric/ratio rankings plus the hair/beard law. Every
// number is generated from the JSON, so the report can quote this output as evidence.
Deno.test("printed ranked tables (generated from the data)", () => {
  const metricTable = (label: string, metric: FaceMetricName) => {
    console.log(`\n== ${label} (rank 1 = most; ${FACE_UNITS[metric]}) ==`);
    for (const r of rankMetric(metric)) {
      console.log(`  ${String(r.value).padStart(2)}. ${pad(r.id, 10)} [${ANCESTRY[r.id].race}]`);
    }
  };
  for (
    const [label, metric] of [
      ["chin length", "chinLength"],
      ["mouth width", "mouthWidth"],
      ["nose length", "noseLength"],
      ["brow prominence", "browProminence"],
      ["forehead height", "foreheadHeight"],
    ] as const
  ) metricTable(label, metric);

  const ratioTable = (label: string, key: keyof FaceRatios) => {
    console.log(`\n== ${label} (ratio, biggest first; ${RATIO_LABELS[key]}) ==`);
    for (const r of rankRatio(key)) {
      console.log(`  ${pad(r.id, 10)} ${num(r.value, 3)}  [${ANCESTRY[r.id].race}]`);
    }
  };
  ratioTable("chin-to-mouth", "chinToMouth");

  console.log("\n== the hair/beard law (lightest first) ==");
  console.log(
    `  ${pad("id", 10)} ${pad("race", 7)} ${pad("light", 6)} ${pad("lenTier", 7)} ${
      pad("massKg", 7)
    } ${pad("spread", 7)} ${pad("bald", 5)} ${pad("full", 5)} reqd`,
  );
  for (const h of hairOrder()) {
    const b = beardLaw().find((x) => x.id === h.id)!;
    console.log(
      `  ${pad(h.id, 10)} ${pad(ANCESTRY[h.id].race, 7)} ${pad(num(h.lightness, 3), 6)} ${
        pad(String(h.lengthTier), 7)
      } ${pad(num(h.massKg, 2), 7)} ${pad(num(h.spread, 0), 7)} ${pad(num(h.baldChance, 2), 5)} ${
        pad(num(b.fullness, 2), 5)
      } ${b.required}`,
    );
  }

  console.log("\n== the debate criteria, in order ==");
  for (const k of RATIO_KEYS) console.log(`  ${pad(k, 18)} = ${RATIO_LABELS[k]}`);
  const c = compare("dwarf", "elf");
  console.log(
    `\n== dwarf vs elf (verdict ${c.verdict}; score ${c.score.a}-${c.score.b}, ties ${c.score.ties}) ==`,
  );
  for (const row of c.rows) {
    console.log(
      `  ${pad(row.criterion, 18)} dwarf ${num(row.a, 3)}  elf ${num(row.b, 3)}  -> ${
        row.winner ?? "tie"
      }`,
    );
  }
});
