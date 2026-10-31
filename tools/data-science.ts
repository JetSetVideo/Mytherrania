// Bounded data-science pass over the match corpus (Wave H, lane H-F).
//
//   deno run --allow-read --allow-write=artifacts tools/data-science.ts [count] [seed]
//
// Compresses every match to the six KeyVars, standardises them, reports the spread, flags
// the special games (far from the centre on any variable — both the plain mean/sd flag and
// the robust median/MAD flag), runs a PCA over the standardised variables, places one match
// against the corpus by k-nearest-neighbour, and writes artifacts/data-science-pass.json.
//
// It MEASURES and PRINTS its own wall-clock time and its record count: the whole point of
// lane H-F is that the pass fits "within the maximum" — 5 000 records in well under 10 s.
//
// Source: reads artifacts/battle-corpus.json when that file carries full match records;
// otherwise it synthesises a reproducible corpus from a seeded RNG (no Math.random). The
// output states which source it used and why.
//
// Pure tool: no rendering, no network, no unseeded randomness.

import { rng32 } from "../src/core/MathCore.ts";
import { CLASSES, createStats } from "../src/game/Stats.ts";
import {
  KEY_VARS,
  type KeyVars,
  keyVars,
  type MatchLike,
  type MatchStatsLike,
  nearestNeighbours,
  pca,
  robustGames,
  specialGames,
  spreadOf,
  standardise,
  type StandardRow,
} from "../src/balance/CorpusMath.ts";

const CORPUS_PATH = "artifacts/battle-corpus.json";
const OUT_PATH = "artifacts/data-science-pass.json";

const count = Math.max(1, parseInt(Deno.args[0] ?? "5000", 10) || 5000);
const seed = parseInt(Deno.args[1] ?? "20261031", 10) || 20261031;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Corpus loading: a full-record file wins; otherwise synthesise (the reason is printed).
// ---------------------------------------------------------------------------

/** A JSON row is a full match record only if it names its two fighters. */
function isFullRecord(r: unknown): boolean {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return typeof o.duration === "number" && Array.isArray(o.fighters) &&
    (o.fighters as unknown[]).length >= 2;
}

function toMatchLike(r: Record<string, unknown>): MatchLike {
  return {
    duration: Number(r.duration),
    reason: String(r.reason ?? ""),
    winner: r.winner === 0 || r.winner === 1 ? r.winner : null,
    fighters: r.fighters as MatchLike["fighters"],
    statGap: r.statGap as MatchLike["statGap"],
    generation: r.generation as MatchLike["generation"],
  };
}

interface Loaded {
  source: string;
  note: string;
  records: MatchLike[];
}

function loadCorpus(): Loaded {
  let raw: string | null = null;
  try {
    raw = Deno.readTextFileSync(CORPUS_PATH);
  } catch {
    raw = null;
  }

  if (raw !== null) {
    try {
      const j = JSON.parse(raw) as unknown;
      const candidates = Array.isArray(j)
        ? j
        : (j && typeof j === "object" && Array.isArray((j as Record<string, unknown>).records))
        ? (j as { records: unknown[] }).records
        : [];
      const full = candidates.filter(isFullRecord) as Record<string, unknown>[];
      if (full.length > 0) {
        return {
          source: CORPUS_PATH,
          note: `${full.length} full match records read from ${CORPUS_PATH}`,
          records: full.map(toMatchLike),
        };
      }
      // The file exists but only holds a summary (meta/digest/sample): say so and synthesise.
      const sample = (j as { sample?: unknown[] })?.sample;
      const sampleN = Array.isArray(sample) ? sample.length : 0;
      return synthesise(
        `${CORPUS_PATH} present but holds no full records (only a digest${
          sampleN ? ` + ${sampleN}-row summary sample` : ""
        }); synthesised a reproducible corpus instead`,
      );
    } catch {
      return synthesise(
        `${CORPUS_PATH} present but unreadable JSON; synthesised a reproducible corpus instead`,
      );
    }
  }
  return synthesise(`no ${CORPUS_PATH}; synthesised a reproducible corpus`);
}

/** Build a reproducible corpus from a seeded RNG. Reason strings and winners are drawn too. */
function synthesise(note: string): Loaded {
  const rng = rng32(seed);
  const reasons = ["ko", "ring-out", "koth", "forfeit"];
  const records: MatchLike[] = [];

  for (let i = 0; i < count; i++) {
    const clsA = CLASSES[Math.floor(rng() * CLASSES.length)];
    let clsB = CLASSES[Math.floor(rng() * CLASSES.length)];
    if (clsB === clsA) clsB = CLASSES[(CLASSES.indexOf(clsA) + 1) % CLASSES.length];

    // Builds: the real class primaries with a per-fighter jitter, so the corpus spans a
    // continuous stat space rather than eight fixed points.
    const mk = (cls: typeof clsA): { stats: MatchStatsLike; level: number } => {
      const base = createStats(cls);
      const j = (v: number) => clamp(Math.round(v + (rng() * 2 - 1) * 2.5), 1, 14);
      return {
        stats: {
          vitality: j(base.vitality),
          resilience: j(base.resilience),
          willpower: j(base.willpower),
          reflex: j(base.reflex),
          strength: j(base.strength),
          intelligence: j(base.intelligence),
        },
        level: 1 + Math.floor(rng() * 20),
      };
    };
    const A = mk(clsA), B = mk(clsB);

    // Duration: a 25-120 s body with a rare "time-limit" tail (180-320 s) so genuine special
    // games exist for the flag to find, instead of a corpus where nothing is ever unusual.
    const wild = rng() < 0.03;
    const duration = wild ? 180 + rng() * 140 : 25 + rng() * 95;
    const hits = Math.max(1, Math.round(duration * (0.35 + rng() * 0.55)));

    const u = rng();
    const winner: 0 | 1 | null = u < 0.04 ? null : u < 0.52 ? 0 : 1;
    const total = 400 + rng() * 3600;
    const winShare = 0.5 + rng() * 0.45; // 0.50..0.95 one-sided; draws below are set even
    const dealt0 = winner === null
      ? total / 2
      : winner === 0
      ? total * winShare
      : total * (1 - winShare);
    const dealt1 = total - dealt0;

    records.push({
      duration,
      reason: wild ? "timed" : reasons[Math.floor(rng() * reasons.length)],
      winner,
      fighters: [
        {
          level: A.level,
          stats: A.stats,
          dealt: dealt0,
          hits: Math.round(hits * 0.5),
          hpLeft: rng() * 60,
        },
        {
          level: B.level,
          stats: B.stats,
          dealt: dealt1,
          hits: Math.round(hits * 0.5),
          hpLeft: rng() * 60,
        },
      ],
    });
  }
  return {
    source: `synthetic (seed ${seed}, rng32)`,
    note: `${note}; ${records.length} records generated deterministically from seed ${seed}`,
    records,
  };
}

// ---------------------------------------------------------------------------
// Run the pass on one corpus, timed end to end.
// ---------------------------------------------------------------------------

function fmt(v: number, dp = 3): number {
  return Number.isFinite(v) ? Number(v.toFixed(dp)) : 0;
}

function runPass(): { json: Record<string, unknown>; lines: string[] } {
  const t0 = performance.now();
  const loaded = loadCorpus();
  const records = loaded.records;

  // O(N): one record -> its KeyVars.
  const vars: KeyVars[] = records.map(keyVars);

  // O(N): standardise to z-scores (zero-variance column -> 0).
  const std = standardise(vars);

  // O(N): spread of every key variable.
  const spread = spreadOf(vars);

  // O(N): the two outlier flags.
  const plainFlags = specialGames(vars, 3);
  const robustFlags = robustGames(vars, 3);

  // O(N * D^2), D = 6: PCA over the standardised variables.
  const pcaRes = pca(std.rows);

  // O(N): place the most exceptional match against the corpus by 5-NN.
  const focus = plainFlags[0]?.index ?? robustFlags[0]?.index ?? 0;
  const query: StandardRow = std.rows[focus] ?? ({} as StandardRow);
  const nn = nearestNeighbours(std.rows, query, 5);

  const t1 = performance.now();
  const elapsedMs = t1 - t0;

  const lines: string[] = [];
  lines.push(
    `records: ${records.length}   source: ${loaded.source}   elapsed: ${fmt(elapsedMs, 1)} ms`,
  );
  lines.push(`(${loaded.note})`);

  lines.push("");
  lines.push("SPREAD OF EVERY KEY VARIABLE (n / min / p20 / median / p80 / max / mean / sd)");
  for (const k of KEY_VARS) {
    const s = spread[k];
    lines.push(
      `  ${k.padEnd(12)} n=${s.n}  min=${fmt(s.min)}  p20=${fmt(s.p20)}  median=${
        fmt(s.median)
      }  p80=${fmt(s.p80)}  max=${fmt(s.max)}  mean=${fmt(s.mean)}  sd=${fmt(s.sd)}`,
    );
  }

  lines.push("");
  lines.push("PCA OVER THE STANDARDISED KEY VARS (explained variance ratio, then loadings)");
  pcaRes.ratios.forEach((r, i) => {
    const load = pcaRes.loadings[i]?.map((x) => fmt(x, 3)) ?? [];
    lines.push(`  PC${i + 1}  ratio=${fmt(r, 5)}  loadings=[${load.join(", ")}]`);
  });

  lines.push("");
  lines.push("SPECIAL GAMES");
  const topPlain =
    plainFlags.slice(0, 5).map((f) => `#${f.index}(${f.key} z=${fmt(f.z, 2)})`).join("  ") ||
    "none";
  const topRobust =
    robustFlags.slice(0, 5).map((f) => `#${f.index}(${f.key} z=${fmt(f.z, 2)})`).join("  ") ||
    "none";
  lines.push(`  plain  (mean/sd,   |z|>3): ${plainFlags.length} flagged  ${topPlain}`);
  lines.push(`  robust (median/MAD, |z|>3): ${robustFlags.length} flagged  ${topRobust}`);
  const hidden = robustFlags.filter((f) => !plainFlags.some((p) => p.index === f.index));
  if (hidden.length > 0) {
    lines.push(
      `  robust flag reaches ${hidden.length} match(es) the plain flag misses (a wild value inflated the plain sd): ${
        hidden.slice(0, 5).map((f) => `#${f.index} ${f.key}`).join(", ")
      }`,
    );
  }

  lines.push("");
  lines.push(
    `5-NN PLACEMENT of #${focus} (standardised): mean distance to its 5 nearest = ${
      fmt(nn.meanDistance)
    }; nearest = #${nn.nearestIndex}`,
  );

  // The one-line conclusion: name the most exceptional match and why.
  const focusRec = records[focus];
  const focusFlag = plainFlags[0] ?? robustFlags[0];
  const conclusion = focusFlag
    ? `most exceptional match: #${focus} (${fmt(focusRec?.duration ?? 0, 1)}s, ends "${
      focusRec?.reason ?? "?"
    }"): its ${focusFlag.key} sits ${
      fmt(Math.abs(focusFlag.z), 2)
    } z from the corpus centre; mean distance to its 5 nearest neighbours is ${
      fmt(nn.meanDistance)
    }`
    : `no match exceeds the |z| > 3 special-game threshold; the most central is #${focus}`;
  lines.push("");
  lines.push(`CONCLUSION  ${conclusion}`);

  const json = {
    source: loaded.source,
    note: loaded.note,
    recordCount: records.length,
    elapsedMs: fmt(elapsedMs, 2),
    seed,
    keyVars: [...KEY_VARS],
    spread: Object.fromEntries(KEY_VARS.map((k) => [k, {
      n: spread[k].n,
      min: fmt(spread[k].min),
      p20: fmt(spread[k].p20),
      median: fmt(spread[k].median),
      p80: fmt(spread[k].p80),
      max: fmt(spread[k].max),
      mean: fmt(spread[k].mean),
      sd: fmt(spread[k].sd),
    }])),
    pca: {
      explainedVarianceRatio: pcaRes.ratios.map((r) => fmt(r, 6)),
      loadings: pcaRes.loadings.map((v) => v.map((x) => fmt(x, 4))),
    },
    plainFlags: plainFlags.map((f) => ({ index: f.index, variable: f.key, z: fmt(f.z, 3) })),
    robustFlags: robustFlags.map((f) => ({ index: f.index, variable: f.key, z: fmt(f.z, 3) })),
    nearestNeighbour: {
      focusIndex: focus,
      meanDistance: fmt(nn.meanDistance, 4),
      nearestIndex: nn.nearestIndex,
    },
    conclusion,
  };
  return { json, lines };
}

// ---------------------------------------------------------------------------
// Wire to the trainer (why this comment exists): lane H-F does not modify
// src/balance/NeuralTrainer.ts. The trainer should call keyVars() on each match record
// before standardising — the exact call it should make is
//
//     import { keyVars, standardise } from "./CorpusMath.ts";
//     const { rows } = standardise(history.map(keyVars));   // rows: z-scored features
//
// `rows` is then a finite, fixed-width (6) feature matrix any of the neural nets can digest
// directly: no NaN (keyVars drops non-finite inputs at the source), fixed axis order.
// ---------------------------------------------------------------------------

const { json, lines } = runPass();
for (const l of lines) console.log(l);

await Deno.mkdir("artifacts", { recursive: true });
await Deno.writeTextFile(OUT_PATH, JSON.stringify(json, null, 2));
console.log(
  `\nwrote ${OUT_PATH} (${json.recordCount as number} records, ${json.elapsedMs as number} ms)`,
);
