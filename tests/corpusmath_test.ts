// CorpusMath (lane H-F): the data-science pass. These pin the properties the brief requires:
// NaN-free standardisation, the two distance metrics, hand-checkable quartiles, the outlier
// flags (plain and robust), PCA, nearest-neighbour placement, and a 5 000-row timing bound.
import { rng32 } from "../src/core/MathCore.ts";
import {
  euclidean,
  type KeyVars,
  keyVars,
  mahalanobis,
  type MatchLike,
  nearestNeighbours,
  pca,
  robustGames,
  specialGames,
  spreadOf,
  standardise,
} from "../src/balance/CorpusMath.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

/** A KeyVars row with every field defaulted to a constant, so a test moves one variable. */
function vars(
  duration = 60,
  gapDistance = 1,
  dominance = 0.5,
  damageShare = 0.5,
  pace = 0.5,
  spread = 0.1,
): KeyVars {
  return { duration, gapDistance, dominance, damageShare, pace, spread };
}

const ALL_KEYS = ["duration", "gapDistance", "dominance", "damageShare", "pace", "spread"] as const;

// ------------------------------------------------------------------ standardise

Deno.test("standardise is NaN-free and turns a constant column into 0", () => {
  const rows: KeyVars[] = [];
  for (let i = 0; i < 50; i++) rows.push(vars(50 + i, 1, 0.7, 0.3, 0.5, 0.2)); // dominance constant
  const { rows: std, mean, sd } = standardise(rows);

  assert(sd.dominance === 0, `constant column has sd 0, got ${sd.dominance}`);
  for (const r of std) {
    for (const k of ALL_KEYS) assert(Number.isFinite(r[k]), `${k} must be finite, got ${r[k]}`);
    assert(r.dominance === 0, `constant column standardises to 0, got ${r.dominance}`);
  }
  for (const k of ALL_KEYS) {
    assert(Number.isFinite(mean[k]) && Number.isFinite(sd[k]), `${k} mean/sd finite`);
  }
  // A varying column standardises to mean 0, sd 1.
  const m = std.reduce((s, r) => s + r.duration, 0) / std.length;
  assert(Math.abs(m) < 1e-9, `standardised mean ~0, got ${m}`);
});

Deno.test("standardise drops a NaN input at the source (never propagates)", () => {
  const rows = [vars(60), vars(70), vars(NaN)];
  const { rows: std } = standardise(rows);
  for (const r of std) for (const k of ALL_KEYS) assert(Number.isFinite(r[k]), `${k} finite`);
});

Deno.test("keyVars coerces a non-finite record to finite output", () => {
  const bad: MatchLike = {
    duration: NaN,
    reason: "ko",
    winner: 0,
    fighters: [
      {
        stats: {
          vitality: 5,
          resilience: 5,
          willpower: 5,
          reflex: 5,
          strength: 5,
          intelligence: 5,
        },
        dealt: NaN,
        hits: NaN,
      },
      {
        stats: {
          vitality: 5,
          resilience: 5,
          willpower: 5,
          reflex: 5,
          strength: 5,
          intelligence: 5,
        },
      },
    ],
  };
  const kv = keyVars(bad);
  for (const k of ALL_KEYS) assert(Number.isFinite(kv[k]), `${k} finite, got ${kv[k]}`);
});

// ------------------------------------------------------------------ distances

Deno.test("euclidean and mahalanobis are 0 for identical rows and grow with the difference", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 1, y: 1 };
  const c = { x: 5, y: 5 };
  assert(euclidean(a, a) === 0, "euclidean identical = 0");
  assert(mahalanobis(a, a, { x: 1, y: 1 }) === 0, "mahalanobis identical = 0");
  assert(euclidean(a, c) > euclidean(a, b), "euclidean grows with distance");
  assert(
    mahalanobis(a, c, { x: 1, y: 1 }) > mahalanobis(a, b, { x: 1, y: 1 }),
    "mahalanobis grows",
  );
});

Deno.test("mahalanobis down-weights a high-variance column", () => {
  const a = { x: 0 };
  const b = { x: 1 }; // a one-unit move
  const wide = mahalanobis(a, b, { x: 10 }); // a wide column: 1 unit is cheap
  const narrow = mahalanobis(a, b, { x: 0.1 }); // a narrow column: 1 unit is dear
  assert(wide < narrow, `wide column must cost less (${wide} < ${narrow})`);
  assert(Math.abs(wide - 0.1) < 1e-9 && Math.abs(narrow - 10) < 1e-9, "scaled by 1/sd");
});

// ------------------------------------------------------------------ spread

Deno.test("spreadOf matches hand-computed quartiles on a 5-element sample", () => {
  const durs = [10, 20, 30, 40, 50];
  const rows = durs.map((d) => vars(d));
  const s = spreadOf(rows).duration;
  assert(s.n === 5, `n=5, got ${s.n}`);
  assert(s.min === 10 && s.max === 50, "min/max");
  assert(Math.abs(s.median - 30) < 1e-9, `median 30, got ${s.median}`);
  assert(Math.abs(s.p20 - 18) < 1e-9, `p20 18 (0.8 between 10 and 20), got ${s.p20}`);
  assert(Math.abs(s.p80 - 42) < 1e-9, `p80 42 (0.2 between 40 and 50), got ${s.p80}`);
  assert(Math.abs(s.mean - 30) < 1e-9, `mean 30, got ${s.mean}`);
  assert(Math.abs(s.sd - Math.sqrt(200)) < 1e-9, `population sd sqrt(200), got ${s.sd}`);
});

// ------------------------------------------------------------------ outlier flags

Deno.test("specialGames finds an injected outlier in a 200-row corpus and reports its variable", () => {
  const rows: KeyVars[] = [];
  for (let i = 0; i < 200; i++) rows.push(vars(60 + (i % 5) * 0.1, 1 + (i % 7) * 0.01));
  rows[137] = vars(100_000, 1); // the injected special game
  const flags = specialGames(rows, 3);
  const hit = flags.find((f) => f.index === 137);
  assert(hit !== undefined, "the injected outlier is flagged");
  assert(hit!.key === "duration", `flagged on duration, got ${hit!.key}`);
  assert(Math.abs(hit!.z) > 3, `z beyond the threshold, got ${hit!.z}`);
});

Deno.test("the robust flag (median/MAD) reaches an outlier a single wild value hides from the plain flag", () => {
  const rows: KeyVars[] = [];
  for (let i = 0; i < 200; i++) rows.push(vars(60 + (i % 3)));
  rows[198] = vars(100); // a moderate outlier
  rows[199] = vars(1_000_000_000); // a wild value that inflates the plain sd ~1e8x

  const plain = specialGames(rows, 3);
  const robust = robustGames(rows, 3);

  assert(
    !plain.some((f) => f.index === 198),
    "the plain flag cannot see #198 (its sd is inflated by #199)",
  );
  assert(
    robust.some((f) => f.index === 198 && f.key === "duration"),
    "the robust flag catches #198",
  );
  assert(
    plain.some((f) => f.index === 199),
    "the wild value itself is still flagged by the plain flag",
  );
});

// ------------------------------------------------------------------ PCA

Deno.test("PCA ratios are ordered, non-negative and sum to 1; it recovers a one-axis corpus", () => {
  // A corpus whose variance lies entirely along `duration`: every other variable is constant.
  const axis: KeyVars[] = [];
  for (let i = 0; i < 300; i++) axis.push(vars(i, 0, 0.5, 0.5, 0, 0));
  const { rows: stdAxis } = standardise(axis);
  const oneAxis = pca(stdAxis);
  assert(
    Math.abs(oneAxis.ratios[0] - 1) < 1e-6,
    `first component explains ~1, got ${oneAxis.ratios[0]}`,
  );
  assert(oneAxis.ratios.slice(1).every((r) => r < 1e-6), "the rest explain ~nothing");

  // A mixed corpus: the general invariants.
  const rng = rng32(20261031);
  const mixed: KeyVars[] = [];
  for (let i = 0; i < 400; i++) {
    mixed.push(vars(60 + rng() * 60, rng() * 4, rng(), rng(), rng(), rng()));
  }
  const { rows: stdMixed } = standardise(mixed);
  const r = pca(stdMixed).ratios;
  assert(r.length === 6, `one ratio per key variable, got ${r.length}`);
  for (const ratio of r) assert(ratio >= 0, `non-negative, got ${ratio}`);
  const sum = r.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 1e-6, `ratios sum to 1, got ${sum}`);
  for (let i = 1; i < r.length; i++) {
    assert(r[i] <= r[i - 1] + 1e-9, `ordered, PC${i + 1} <= PC${i}`);
  }
});

// ------------------------------------------------------------------ nearest neighbour

Deno.test("nearest-neighbour placement of a corpus row returns itself at distance 0", () => {
  const rng = rng32(7);
  const rows: KeyVars[] = [];
  for (let i = 0; i < 100; i++) {
    rows.push(vars(40 + rng() * 80, rng() * 3, rng(), rng(), rng(), rng()));
  }
  const { rows: std } = standardise(rows);
  const nn = nearestNeighbours(std, std[10], 5);
  assert(nn.distances[0] === 0, `self is at distance 0, got ${nn.distances[0]}`);
  assert(nn.distances.length === 5, "five neighbours returned");
  assert(nn.meanDistance >= 0 && Number.isFinite(nn.meanDistance), "mean distance finite");
});

// ------------------------------------------------------------------ bounded runtime

Deno.test("5 000 rows run the whole pass within the runtime bound", () => {
  const rng = rng32(99);
  const rows: KeyVars[] = [];
  for (let i = 0; i < 5000; i++) {
    rows.push(vars(25 + rng() * 120, rng() * 5, rng(), rng(), rng(), rng()));
  }

  const t0 = performance.now();
  const { rows: std } = standardise(rows);
  spreadOf(rows);
  specialGames(rows, 3);
  robustGames(rows, 3);
  pca(std);
  const elapsed = performance.now() - t0;

  console.log(`5000-row pass (standardise + spread + flags + PCA): ${elapsed.toFixed(1)} ms`);
  assert(elapsed < 10_000, `5000 rows must finish under 10 s, took ${elapsed.toFixed(1)} ms`);
});
