# Lane N — noise algebra, spreading, tileable texture recipes (G06, G07)

Status: done. `deno check` clean on all lane files, `deno lint` clean, lane tests **27 passed / 0 failed**
(`NO_COLOR=1 deno test --allow-read tests/noise_algebra_test.ts tests/noise_spread_test.ts tests/textures_*_test.ts`, ~7 s).
Pure TypeScript, no THREE/DOM. `Noise.ts` / `Blend.ts` untouched (imported only).

## Files

| File | What |
|---|---|
| `src/graphics/paint/NoiseAlgebra.ts` | `NoiseExpr` (JSON tree), `compileNoise`, simplex + periodic lattice noises, op math |
| `src/graphics/paint/Spread.ts` | value spread (`measureSpread`, `spreadTo` incl. equalise) + spatial spread (`poissonDisc`, `scatter`, Pareto helpers) |
| `src/graphics/textures/TextureRecipes.ts` | 15 material recipes (RGBA channel exprs, palette, cel levels, spread targets) |
| `src/graphics/textures/BakeTexture.ts` | `bakeRecipe` -> tileable RGBA8 + stats, `bakePreview` -> cel albedo, `paletteRamp` |
| `tests/noise_algebra_test.ts`, `tests/noise_spread_test.ts`, `tests/textures_bake_test.ts` | 11 + 9 + 7 tests |

## What the parent must call (integration)

```ts
import { bakeRecipe, bakePreview } from "./src/graphics/textures/BakeTexture.ts";
import { TEXTURE_RECIPES, textureRecipe } from "./src/graphics/textures/TextureRecipes.ts";
import { poissonDisc, scatter, alphaForTopShare } from "./src/graphics/paint/Spread.ts";
import { compileNoise } from "./src/graphics/paint/NoiseAlgebra.ts";

const baked = bakeRecipe(textureRecipe("stone"), 128, worldSeed);   // { data: Uint8Array RGBA, size, stats, rawStats, ms }
// new THREE.DataTexture(baked.data, baked.size, baked.size, THREE.RGBAFormat) + RepeatWrapping (it tiles), needsUpdate = true
// channels: R albedo variation, G mask/pattern, B height/cel detail, A roughness or mask (see recipe.channels[ch])
const preview = bakePreview(textureRecipe("stone"), 128, worldSeed, baked); // cel-shaded sRGB albedo, alpha 255
```

- `bakeRecipe` / `bakePreview` / `textureRecipe` / `TEXTURE_RECIPES`: terrain + prop materials. The data are
  **linear numbers, not colours** (R/G/B/A are masks/heights/roughness) — upload with `NoColorSpace`;
  only `bakePreview` output is sRGB colour (`SRGBColorSpace`).
- `poissonDisc(rng32(seed), w, h, minDist, { wrap })`: blue-noise placement (grass tufts, rocks, trees).
- `scatter(rng32(seed), {width, height}, count, { sizeMin, sizeMax, cluster, wrap, alpha })`: Pareto-sized
  non-overlapping discs (pebbles, boulders, clumps). For 80/20 by disc **area** pass
  `alpha: 2 * alphaForTopShare((sizeMax / sizeMin) ** 2)`.
- `compileNoise(expr, seed, { period })`: any new material/shader-side CPU noise. `spreadTo` for any
  generated field that reads muddy.
- Test-only today (no game caller yet): `NOISE_SOURCES`, `NOISE_OPERATORS`, `noiseOpsUsed`,
  `cappedParetoTopShare`, `paretoSizes` (also used inside `scatter`). Keep them for coverage/debug UI or drop.

## API

### NoiseAlgebra
- `type NoiseExpr` — `{ op, ... }` discriminated union, JSON round-trippable (tested).
- `compileNoise(expr, seed, { period?: number | [px, py, pz] }) => (x, y, z) => number`. Closures built once;
  no allocation per sample (Worley `CellSample` / `WarpOut` scratch reused per node).
- **Sources (13)**: `constant`, `coordinate` (x|y|z|radial|angle, optional `cell`), `value`, `gradient` (Perlin from
  Noise.ts), `simplex` (own 3D simplex on the BCC lattice, perm-hashed; periodic variant hashCell-hashed),
  `worley` (`feature` f1|f2|f2MinusF1|cellId, `jitter`), `fbm` / `ridged` / `billow` / `turbulence` (base value|gradient|simplex,
  octaves/lacunarity/gain), `checker`, `stripes` (axis, sharpness), `spots` (worley-thresholded discs, density, softness).
  Params: `scale` (feature size), `seedSalt`. Lattice sources return ~[0,1].
- **Operators (46)**: arithmetic `add sub mul div(safe) mod pow neg abs min max oneMinus sqrt exp log`;
  shaping `clamp saturate step smoothstep threshold quantize bias gain remap contrast`; `mix` (mask expr);
  `sin cos`; blends `screen overlay softLight multiply` (Blend.ts) + `difference exclusion colorDodge colorBurn`;
  CSG `union intersect subtract smoothUnion smoothIntersect smoothSubtract` (polynomial smin/smax, `k`);
  domain `translate scale rotate(about y) warp(by expr | [ex,ey,ez] | Noise.ts warp3) tile`.
- **Tileable**: `period` P -> every lattice source uses n = round(P/scale) cells and wraps lattice indices
  mod n (hashCell, not the 256 perm). Periods propagate through domain ops: `scale` gives the child P/f;
  `rotate` snaps to angle atan2(b, a) with |a|,|b| <= 4 and gives the child P/hypot(a, b) (exactly periodic);
  `tile` snaps its period to divide P; checker uses even cell counts; coordinates become cell-local
  triangle waves. Verified: every recipe channel satisfies f(x+P) = f(x) = f(z-P) to 1e-6 on 1500 probes.
- Also exported: `simplex3`, `simplexPeriodic3`, `valuePeriodic3`, `gradientPeriodic3`, `worleyPeriodic3`,
  `blendOp`, `safeDiv`, `floorMod`, `schlickBias`, `schlickGain`, `quantizeLevels`, `smoothMin`, `smoothMax`.

### Spread
- `measureSpread(samples)` -> `{count,min,max,mean,median,p20,p80,spread = p80-p20, range = max-min}`.
- `spreadTo(values, {p20,p80} | {lo,hi}, { equalize?, clampLo?, clampHi? })` — in place; linear quantile map or
  CDF equalisation (ties share mean rank); degenerate (p20 = p80) falls back to min/max stretch.
- `poissonDisc(rng, w, h, minDist, { wrap?, maxTries = 30 })` — Bridson, toroidal option, exact-division grid.
- `scatter(rng, area, count, { sizeMin, sizeMax, cluster, density?, gap, wrap, maxTries, alpha })` — largest-first dart
  throwing; keep probability `1 - cluster*(1 - density)`; invariant d >= r_i + r_j + gap.
- `paretoSizes`, `cappedParetoTopShare(alpha, capRatio)` (analytic share of capped Pareto), `alphaForTopShare(capRatio)`.

## Measured numbers (real runs, this machine)

Simplex3, 200k probes: min -0.975, max 0.975, mean 0.0007, std 0.384 (SIMPLEX_NORM = 75 from a 10^6-probe raw
peak of 0.01301). Single-octave means: value 0.496, gradient 0.498, simplex 0.504.
Periodic 5-octave simplex fbm: ~630–645 ns/sample.

Value spread: fbm(5 oct) p20..p80 0.438..0.597 (spread 0.160) -> 0.250..0.750 / 0.300..0.700 / 0.550..0.850 exactly on target;
equalised decile shares 0.100 x 10.

Poisson (100x60, r = 3): 420 pts, min pair 3.000, largest gap 3.29 (< 2r), density n r^2/A = 0.63; toroidal 403 pts, min 3.001, gap 3.11.
Pareto: uncapped top-20% share over 5 x 200k draws 0.763 / 0.771 / 0.774 / 0.781 / 0.835 (median 0.774; theory 0.8 —
alpha ~1.16 has infinite variance, so samples run low). Capped at 100x: sampled 0.662, analytic 0.661.
Scatter 240x240, 800 discs, r in [0.6, 12], alpha_r = 2*alphaForTopShare(400) = 1.846: 800/800 placed, 0 overlaps,
**top-20% area share 0.799**, radius share 0.450 (predicted 0.455). Default alpha, cap 10x, 1500 discs: radius share
0.504 vs predicted 0.507. Cluster: mean density at items 0.515 (cluster 0) -> 0.768 (cluster 1).

Bakes, 128x128, seed 1234 (raw p20..p80 -> baked p20..p80; masks kept raw):

| recipe | ms | R | G | B | A |
|---|---|---|---|---|---|
| stone | 50.3 | .35-.70 -> .30-.70 | mask .00-.00 | .11-.60 -> .30-.70 | .26-.70 -> .60-.85 |
| cobble | 53.0 | .26-.70 -> .30-.70 | mask .00-.94 | .40-1.0 -> .30-.70 | .24-.94 -> .55-.90 |
| sand | 53.4 | .21-.79 -> .30-.70 | mask .00-.00 | .02-.90 -> .30-.70 | .71-.79 -> .70-.85 |
| grass | 46.8 | .16-.42 -> .30-.70 | .02-.98 -> .30-.70 | .33-.67 -> .30-.70 | .62-.75 -> .60-.80 |
| dirt | 61.1 | .25-.45 -> .30-.70 | mask .00-.00 | .42-.57 -> .30-.70 | .81-.88 -> .60-.90 |
| snow | 43.3 | .60-.73 -> .55-.85 | mask .00-.00 | .23-.48 -> .30-.70 | .38-.42 -> .25-.40 |
| ice | 59.0 | .20-.43 -> .30-.70 (equalised) | mask .00-.05 | .43-.56 -> .30-.70 | .27-.29 -> .10-.30 |
| bark | 81.5 | .03-.74 -> .30-.70 | mask .00-.07 | .34-.80 -> .30-.70 | .58-.63 -> .65-.90 |
| woodPlanks | 60.0 | .52-.83 -> .30-.70 | mask .00-.00 | .00-1.0 -> .30-.70 | .61-.69 -> .50-.70 |
| metal | 39.0 | .41-.66 -> .30-.70 | mask .00-.00 | .38-.97 -> .30-.70 | .25-.38 -> .20-.40 |
| cloth | 27.6 | .06-.74 -> .30-.70 | .05-.87 -> .30-.70 | .08-.80 -> .30-.70 | .85-.90 -> .75-.90 |
| leather | 63.8 | .29-.48 -> .30-.70 | mask .00-.00 | .27-.50 -> .30-.70 | .05-.23 -> .45-.75 |
| lava | 68.8 | .13-.44 -> .30-.70 (equalised) | mask .00-.44 | .50-.97 -> .30-.70 | .49-.90 -> .50-.85 |
| moss | 65.3 | .38-.63 -> .30-.70 | mask .00-1.0 | .25-.35 -> .30-.70 | .71-.76 -> .70-.90 |
| cloudPuff | 77.3 | .39-.64 -> .30-.70 | mask .40-1.0 | .62-.79 -> .30-.70 | .58-.96 -> .35-.95 |

Timing test: stone 128x128 = 45.8 / 47.0 / 47.3 ms (median 47.0, budget 150). Slowest recipe bark ~82 ms.

Seam (wrap neighbour |diff| / mean interior |diff|, 4 seeds pooled): all channels 0.0–1.30 except **ice.G 1.57**
(sparse 1-px crack mask; the bound is 1.5 x interior + 3 standard errors of the seam mean, which it meets; with 8
seeds the same channel measured ≤ 1.41). Exact periodicity of every channel is tested separately.

## Gaps (honest)

- The 1.5x seam rule is statistical; for sparse binary masks it needed a 3-standard-error allowance. Exact
  periodicity (f(x+P) = f(x)) is the real proof and passes for all 60 channels.
- Bake origin is an irrational fraction of the tile (`BAKE_ORIGIN`) so seams don't sit on lattice lines of regular
  patterns; without it cloth's 4-px weave measured 2x at the seam (still mathematically seamless).
- 80/20 **by radius** is impossible with a radius cap of 20x (peak reachable share 0.61); the scatter proves 80/20 by
  disc area (0.799). Uncapped Pareto samples read ~0.77 median, not 0.80 (heavy-tail sampling bias).
- `rotate` in a periodic context snaps to angles atan2(b, a), |a|,|b| <= 4 (nearest of ~50 angles); `angle`
  coordinates are seamed at the branch cut / cell borders — recipes mask them (metal swirl) before cell borders.
- Periodic and non-periodic compiles of the same tree give different noise (hashCell vs 256-perm lattices).
- Some masks are very sparse at the tested seed (sand grit, wood knots, metal scratches: p80 = 0); they are authored
  masks, not spread. Recipe palettes/looks are unreviewed visually (no GPU/browser run in this lane).
- Worley uses the 3x3x3 neighbourhood (as Noise.ts): F2 can be slightly overestimated at jitter ~1.
- No mip-map / normal-map generation from B (height); the parent can derive normals from B on upload.
