// Lane N: texture recipes + baking — coverage of the whole algebra, value spread targets,
// tileable seams, determinism, preview, and bake timings.
import { NOISE_OPERATORS, NOISE_SOURCES, compileNoise, noiseOpsUsed } from "../src/graphics/paint/NoiseAlgebra.ts";
import { BAKE_ORIGIN, BAKE_PLANE_Y, bakePreview, bakeRecipe, paletteRamp, TILE_PERIOD } from "../src/graphics/textures/BakeTexture.ts";
import { TEXTURE_CHANNELS, TEXTURE_RECIPES, textureRecipe } from "../src/graphics/textures/TextureRecipes.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const f2 = (v: number) => v.toFixed(2);

const REQUIRED_IDS = [
  "stone", "cobble", "sand", "grass", "dirt", "snow", "ice", "bark", "woodPlanks", "metal", "cloth", "leather", "lava", "moss", "cloudPuff",
];

Deno.test("textures: the 15 named recipes exist with well-formed metadata", () => {
  const ids = TEXTURE_RECIPES.map((r) => r.id);
  assert(new Set(ids).size === ids.length, "unique ids");
  for (const id of REQUIRED_IDS) assert(ids.includes(id), `recipe ${id}`);
  for (const r of TEXTURE_RECIPES) {
    assert(r.purpose.length > 10 && !r.purpose.includes("\n"), `${r.id}: one-line purpose`);
    assert(r.palette.length >= 2 && r.palette.length <= 4, `${r.id}: 2..4 palette stops`);
    for (const h of r.palette) assert(/^#[0-9a-f]{6}$/i.test(h), `${r.id}: hex ${h}`);
    assert(r.celLevels >= 2 && r.celLevels <= 8, `${r.id}: celLevels`);
    for (const ch of TEXTURE_CHANNELS) {
      assert(r.channels[ch].length > 3, `${r.id}.${ch} documented`);
      assert(r.expr[ch] !== undefined, `${r.id}.${ch} expression`);
    }
  }
  assert(textureRecipe("lava").id === "lava", "lookup");
  let threw = false;
  try { textureRecipe("nope"); } catch { threw = true; }
  assert(threw, "unknown id throws");
});

Deno.test("textures: between them the recipes use EVERY source and EVERY operator", () => {
  const used = new Set<string>();
  const worleyFeatures = new Set<string>(), fbmBases = new Set<string>();
  const walk = (e: unknown): void => {
    if (!e || typeof e !== "object") return;
    const o = e as Record<string, unknown>;
    if (o.op === "worley") worleyFeatures.add(String(o.feature ?? "f1"));
    if (o.op === "fbm") fbmBases.add(String(o.base ?? "gradient"));
    for (const v of Object.values(o)) if (Array.isArray(v)) v.forEach(walk); else walk(v);
  };
  for (const r of TEXTURE_RECIPES) for (const ch of TEXTURE_CHANNELS) { noiseOpsUsed(r.expr[ch], used); walk(r.expr[ch]); }
  const missingS = NOISE_SOURCES.filter((s) => !used.has(s));
  const missingO = NOISE_OPERATORS.filter((o) => !used.has(o));
  assert(missingS.length === 0, `sources unused by recipes: ${missingS.join(", ")}`);
  assert(missingO.length === 0, `operators unused by recipes: ${missingO.join(", ")}`);
  for (const f of ["f1", "f2", "f2MinusF1", "cellId"]) assert(worleyFeatures.has(f), `worley feature ${f} used`);
  for (const b of ["value", "gradient", "simplex"]) assert(fbmBases.has(b), `fbm base ${b} used`);
  console.log(`  recipes use ${NOISE_SOURCES.length}/${NOISE_SOURCES.length} sources and ${NOISE_OPERATORS.length}/${NOISE_OPERATORS.length} operators`);
});

Deno.test("textures: bakes are deterministic, sized, finite, and spread to each recipe's targets", () => {
  const SIZE = 128;
  // Warm the JIT once so the printed timings are steady-state.
  bakeRecipe(TEXTURE_RECIPES[0], 32, 1);
  for (const r of TEXTURE_RECIPES) {
    const a = bakeRecipe(r, SIZE, 1234), b = bakeRecipe(r, SIZE, 1234), c = bakeRecipe(r, SIZE, 999);
    assert(a.data.length === SIZE * SIZE * 4 && a.size === SIZE, `${r.id}: RGBA size`);
    let same = true, differs = 0;
    for (let i = 0; i < a.data.length; i++) { if (a.data[i] !== b.data[i]) same = false; if (a.data[i] !== c.data[i]) differs++; }
    assert(same, `${r.id}: same seed -> same bytes`);
    assert(differs > a.data.length * 0.05, `${r.id}: different seed differs (${differs})`);
    const parts: string[] = [];
    for (const ch of TEXTURE_CHANNELS) {
      const s = a.stats[ch], raw = a.rawStats[ch], t = r.targetSpread[ch];
      assert(Number.isFinite(raw.min) && Number.isFinite(raw.max), `${r.id}.${ch}: finite raw values`);
      assert(s.max - s.min > 0.05, `${r.id}.${ch}: not flat (${s.min}..${s.max})`);
      if (t && "p20" in t) {
        const degenerate = raw.p80 - raw.p20 < 1e-9;
        assert(degenerate || (Math.abs(s.p20 - t.p20) < 0.02 && Math.abs(s.p80 - t.p80) < 0.02),
          `${r.id}.${ch}: p20/p80 ${s.p20}/${s.p80} vs target ${t.p20}/${t.p80}`);
        assert(!degenerate, `${r.id}.${ch}: a spread channel must not be degenerate`);
      }
      parts.push(`${ch} ${f2(raw.p20)}..${f2(raw.p80)}->${f2(s.p20)}..${f2(s.p80)}${t ? "" : "(mask)"}`);
    }
    console.log(`  ${r.id.padEnd(10)} ${f2(a.ms).padStart(6)} ms  ${parts.join("  ")}`);
  }
});

Deno.test("textures: one 128x128 bake stays under ~150 ms", () => {
  const r = textureRecipe("stone");
  bakeRecipe(r, 64, 1); // warm
  const times: number[] = [];
  for (const seed of [1, 2, 3]) times.push(bakeRecipe(r, 128, seed).ms);
  times.sort((a, b) => a - b);
  console.log(`  stone 128x128 bake: ${times.map(f2).join(", ")} ms (median ${f2(times[1])})`);
  assert(times[1] < 150, `median bake ${times[1]} ms < 150`);
});

Deno.test("textures: every channel is exactly periodic over the tile", () => {
  for (const r of TEXTURE_RECIPES) {
    const P = r.tile ?? TILE_PERIOD;
    for (const ch of TEXTURE_CHANNELS) {
      const f = compileNoise(r.expr[ch], 77, { period: P });
      let bad = 0;
      for (let i = 0; i < 1500; i++) {
        const x = Math.abs(Math.sin(i * 12.9898)) * P, z = Math.abs(Math.cos(i * 78.233)) * P;
        const v = f(x, BAKE_PLANE_Y, z);
        if (Math.abs(v - f(x + P, BAKE_PLANE_Y, z)) > 1e-6 || Math.abs(v - f(x, BAKE_PLANE_Y, z - P)) > 1e-6) bad++;
      }
      assert(bad <= 3, `${r.id}.${ch}: ${bad}/1500 points not periodic`);
    }
  }
});

Deno.test("textures: wrap-around seams are no rougher than the interior (x1.5)", () => {
  // Pooled over 4 seeds. Sparse masks make the seam mean noisy, so the bound is
  // 1.5 x interior mean + 3 standard errors of the seam mean (sd_interior / sqrt(seam pairs)).
  const SIZE = 128, SEEDS = [1, 2, 3, 4];
  let worst = 0, worstName = "";
  for (const r of TEXTURE_RECIPES) {
    const bakes = SEEDS.map((s) => bakeRecipe(r, SIZE, s).data);
    const parts: string[] = [];
    for (let c = 0; c < 4; c++) {
      let seam = 0, seamN = 0, inner = 0, inner2 = 0, innerN = 0;
      for (const d of bakes) {
        for (let j = 0; j < SIZE; j++) {
          seam += Math.abs(d[(j * SIZE) * 4 + c] - d[(j * SIZE + SIZE - 1) * 4 + c]); // left/right
          seam += Math.abs(d[j * 4 + c] - d[((SIZE - 1) * SIZE + j) * 4 + c]); // top/bottom
          seamN += 2;
          for (let i = 0; i < SIZE - 1; i++) {
            const h = Math.abs(d[(j * SIZE + i) * 4 + c] - d[(j * SIZE + i + 1) * 4 + c]);
            const v = Math.abs(d[(i * SIZE + j) * 4 + c] - d[((i + 1) * SIZE + j) * 4 + c]);
            inner += h + v; inner2 += h * h + v * v; innerN += 2;
          }
        }
      }
      const seamMean = seam / seamN, innerMean = inner / innerN;
      const sd = Math.sqrt(Math.max(0, inner2 / innerN - innerMean * innerMean));
      const bound = 1.5 * innerMean + 3 * sd / Math.sqrt(seamN);
      const ratio = seamMean / Math.max(1e-9, innerMean);
      if (ratio > worst) { worst = ratio; worstName = `${r.id}.${TEXTURE_CHANNELS[c]}`; }
      parts.push(`${TEXTURE_CHANNELS[c]} ${f2(ratio)}`);
      assert(seamMean <= bound, `${r.id}.${TEXTURE_CHANNELS[c]}: seam ${seamMean} > bound ${bound} (interior ${innerMean})`);
    }
    console.log(`  ${r.id.padEnd(10)} seam/interior ${parts.join("  ")}`);
  }
  console.log(`  worst seam/interior ratio ${f2(worst)} (${worstName})`);
});

Deno.test("textures: preview is an RGBA cel ramp through the palette", () => {
  const ramp = paletteRamp(["#000000", "#ffffff"]);
  assert(ramp.length === 256 * 3 && ramp[0] === 0 && ramp[255 * 3] === 255, "ramp endpoints");
  assert(ramp[128 * 3] > 128, "linear-light interpolation brightens the sRGB midpoint");
  for (const r of TEXTURE_RECIPES) {
    const baked = bakeRecipe(r, 64, 5);
    const p = bakePreview(r, 64, 5, baked), q = bakePreview(r, 64, 5);
    assert(p.data.length === 64 * 64 * 4 && p.size === 64, `${r.id}: preview size`);
    const colours = new Set<number>();
    for (let i = 0; i < p.data.length; i += 4) {
      assert(p.data[i + 3] === 255, "opaque");
      assert(p.data[i] === q.data[i] && p.data[i + 1] === q.data[i + 1], "re-baking gives the same preview");
      colours.add((p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2]);
    }
    assert(colours.size >= 2 && colours.size <= r.celLevels * r.celLevels, `${r.id}: ${colours.size} cel colours`);
  }
  assert(BAKE_ORIGIN[0] > 0 && BAKE_ORIGIN[0] < 1 && BAKE_ORIGIN[1] > 0 && BAKE_ORIGIN[1] < 1, "origin inside the tile");
});
