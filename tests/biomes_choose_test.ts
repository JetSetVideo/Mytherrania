// Lane S (V04): chooseBiome — every place x outsideGround yields a valid, coherent biome;
// derived parameters follow the arena (wind -> agitation, pit -> drop); determinism per seed.
import { rng32 } from "../src/core/MathCore.ts";
import { makeArena } from "../src/game/ArenaConfig.ts";
import { PLACES } from "../src/graphics/Environment.ts";
import { chooseBiome, PIT_RANGE } from "../src/world/biomes/Biomes.ts";
import { BIOME_CHOICES, FOG_FAR, WIND_FOR_STORM } from "../src/world/biomes/BiomeTables.ts";
import type { BiomeKind } from "../src/world/biomes/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

const KINDS: BiomeKind[] = ["water", "meadow", "hills", "magma", "clouds", "canopy", "void"];
const FALL_KINDS = new Set<BiomeKind>(["water", "magma", "clouds", "canopy", "void"]);
const SOLID_KINDS = new Set<BiomeKind>(["meadow", "hills", "canopy"]);
const SEEDS = 200;

Deno.test("every place x outsideGround x seed yields a valid biome of the right family", () => {
  const seen: Record<string, Set<string>> = {};
  for (const place of PLACES) {
    for (const outsideGround of [0, 1]) {
      const key = `${place.id}/${outsideGround}`;
      seen[key] = new Set();
      for (let seed = 1; seed <= SEEDS; seed++) {
        const rng = rng32(seed * 7919);
        const cfg = makeArena({ outsideGround, outsideHeight: -6 * rng(), pitDepth: 40 * rng(), wind: 0.6 * rng(), cloud: rng(), size: 34 + 86 * rng() });
        const spec = chooseBiome(cfg, place.id, rng);
        assert(KINDS.includes(spec.kind), `${key}: unknown kind ${spec.kind}`);
        assert((outsideGround ? SOLID_KINDS : FALL_KINDS).has(spec.kind), `${key}: ${spec.kind} is not in its family`);
        assert(Number.isFinite(spec.surfaceDrop) && spec.surfaceDrop <= 0, `${key}: surfaceDrop ${spec.surfaceDrop}`);
        assert(spec.extent > FOG_FAR, `${key}: extent ${spec.extent} must pass the fog far plane`);
        assert(Number.isInteger(spec.seed) && spec.seed >= 0, `${key}: seed`);
        assert(spec.agitation !== undefined && spec.agitation >= 0 && spec.agitation <= 1, `${key}: agitation ${spec.agitation}`);
        assert(spec.place === place.id && typeof spec.variant === "string", `${key}: place/variant`);
        assert(spec.outsideGround === (outsideGround === 1), `${key}: outsideGround flag`);
        if (spec.kind === "meadow" || spec.kind === "hills") assert((spec.relief ?? 0) > 0, `${key}: relief`);
        if (spec.kind === "canopy") {
          assert((spec.density ?? 0) > 0 && (spec.density ?? 2) <= 1, `${key}: density ${spec.density}`);
          assert((spec.groundDepth ?? 0) > 0, `${key}: groundDepth`);
        }
        if (outsideGround) assert(spec.surfaceDrop === Math.min(0, cfg.outsideHeight), `${key}: solid drop follows outsideHeight`);
        else assert(-spec.surfaceDrop >= 2 && -spec.surfaceDrop <= PIT_RANGE[1], `${key}: fall drop ${spec.surfaceDrop}`);
        seen[key].add(`${spec.kind}:${spec.variant}`);
      }
    }
  }
  // Coverage: every option of the table occurs for its place within SEEDS draws.
  for (const [place, table] of Object.entries(BIOME_CHOICES)) {
    for (const [fam, ground] of [["fall", 0], ["solid", 1]] as const) {
      for (const o of table[fam]) {
        const hit = [...seen[`${place}/${ground}`]].some((k) => k.startsWith(`${o.kind}:`));
        assert(hit, `${place}/${fam}: ${o.kind} never chosen in ${SEEDS} seeds`);
      }
    }
  }
  console.log(Object.entries(seen).map(([k, v]) => `${k}: ${[...v].sort().join(", ")}`).join("\n"));
});

Deno.test("place coherence: frostford falls into icy water or clouds, sunspire into magma (or void)", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const cfg = makeArena({ outsideGround: 0 });
    const frost = chooseBiome(cfg, "frostford", rng32(seed));
    assert(frost.kind === "clouds" || (frost.kind === "water" && frost.variant === "icy"), `frostford -> ${frost.kind}/${frost.variant}`);
    const sun = chooseBiome(cfg, "sunspire", rng32(seed));
    assert(sun.kind === "magma" || sun.kind === "void", `sunspire -> ${sun.kind}`);
    const dry = chooseBiome(makeArena({ outsideGround: 1 }), "sunspire", rng32(seed));
    assert((dry.kind === "hills" || dry.kind === "meadow") && dry.variant === "dry", `sunspire solid -> ${dry.kind}/${dry.variant}`);
  }
});

Deno.test("water agitation: still at wind 0, rises monotonically with wind, storm at WIND_FOR_STORM", () => {
  const waterSpec = (wind: number) => {
    for (let seed = 1; seed < 500; seed++) {
      const spec = chooseBiome(makeArena({ outsideGround: 0, wind, cloud: 0.5 }), "greywall", rng32(seed));
      if (spec.kind === "water") return spec;
    }
    throw new Error("no water rolled");
  };
  assert(waterSpec(0).agitation === 0, "wind 0 must give still water");
  let last = -1;
  for (const wind of [0, 0.1, 0.2, 0.3, 0.45, 0.6]) {
    const a = waterSpec(wind).agitation ?? -1;
    assert(a >= last, `agitation must not fall with wind (${wind}: ${a} < ${last})`);
    last = a;
  }
  assert(waterSpec(WIND_FOR_STORM).agitation === 1, "wind at WIND_FOR_STORM and mean cloud is a full storm");
});

Deno.test("determinism: the same rng stream gives the same spec; a different seed can differ", () => {
  const cfg = makeArena({ outsideGround: 0, wind: 0.3, cloud: 0.7, pitDepth: 18 });
  for (const place of PLACES) {
    const a = chooseBiome(cfg, place.id, rng32(1234));
    const b = chooseBiome(cfg, place.id, rng32(1234));
    assert(JSON.stringify(a) === JSON.stringify(b), `${place.id}: not deterministic`);
  }
  const specs = new Set<string>();
  for (let s = 0; s < 20; s++) specs.add(JSON.stringify(chooseBiome(cfg, "verdant", rng32(s))));
  assert(specs.size > 1, "seeds must vary the outcome");
});

Deno.test("unknown place falls back without throwing", () => {
  const spec = chooseBiome(makeArena({ outsideGround: 0 }), "nowhere", rng32(5));
  assert(spec.kind === "clouds" || spec.kind === "void", `fallback ${spec.kind}`);
  const solid = chooseBiome(makeArena({ outsideGround: 1 }), "NoWhere", rng32(5));
  assert(solid.kind === "meadow", `solid fallback ${solid.kind}`);
});
