// Wave J lane J-T: the arena digest the AI reads (src/game/arena/digest.ts).
import { makeArena, placeObjects, randomArena, ringRadiusAt } from "../src/game/ArenaConfig.ts";
import { seededRng } from "../src/game/Items.ts";
import { generateArenaTerrain } from "../src/world/Heightfield.ts";
import { DIGEST_DIRS, WALL_BLOCK_HEIGHT, type ArenaDigest } from "../src/game/arena/contracts.ts";
import { arenaDigest, digestFeatures, RING_OUT_FATAL_DROP, rimRay } from "../src/game/arena/digest.ts";
import { spawnPlan } from "../src/game/arena/spawns.ts";
import { symmetrizeHeightfield, symmetrizeObjects, symmetryFor } from "../src/game/arena/symmetry.ts";
import { wallPlanFor, wallHeightAt } from "../src/game/arena/walls.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

/** Every number anywhere in a value is finite (JSON would turn NaN/Infinity into null). */
function allFinite(v: unknown, path = "digest"): void {
  if (typeof v === "number") { assert(Number.isFinite(v), `${path} = ${v}`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => allFinite(x, `${path}[${i}]`)); return; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) allFinite(x, `${path}.${k}`);
}

/** The whole pipeline in the order the engine will run it (docs/arena/wave-J-T-engine-notes.md). */
function build(seed: number, withField: boolean, over = {}) {
  const cfg = randomArena(seededRng(seed), over);
  const sym = symmetryFor(cfg);
  const plan = wallPlanFor(cfg, seed, sym);
  const nominal = spawnPlan(cfg, sym, null);
  const field = withField ? symmetrizeHeightfield(generateArenaTerrain(seed, cfg, {}, { fairSpots: nominal.spawns.map((s) => ({ x: s.x, z: s.z })) }), sym) : null;
  const objects = symmetrizeObjects(placeObjects(cfg, seededRng(seed ^ 0x55)), sym, cfg, nominal.zones);
  const spawns = withField ? spawnPlan(cfg, sym, field, 2, objects) : nominal;
  return { cfg, sym, plan, field, objects, spawns, digest: arenaDigest(cfg, plan, field, objects, sym, spawns) };
}

Deno.test("digest totality: every field present, arrays of DIGEST_DIRS, all finite, JSON round-trip (500 arenas)", () => {
  for (let seed = 0; seed < 500; seed++) {
    const { digest: d, cfg, plan } = build(seed, false);
    for (const k of ["rim", "wallHeight", "open"] as const) assert(d[k].length === DIGEST_DIRS, `seed ${seed}: ${k} length ${d[k].length}`);
    allFinite(d);
    assert(JSON.stringify(JSON.parse(JSON.stringify(d))) === JSON.stringify(d), `seed ${seed}: JSON round trip`);
    for (let k = 0; k < DIGEST_DIRS; k++) {
      assert(d.rim[k] > 0, "positive rim");
      assert(d.open[k] === (d.wallHeight[k] < WALL_BLOCK_HEIGHT ? 1 : 0), `seed ${seed}: open[${k}] disagrees with wallHeight`);
      const want = cfg.walls >= 1 ? wallHeightAt(plan, (k / DIGEST_DIRS) * Math.PI * 2) : 0;
      assert(Math.abs(d.wallHeight[k] - want) < 1e-4, `seed ${seed}: wallHeight[${k}]`);
    }
    assert(Math.abs(d.openFraction - d.open.reduce((a, b) => a + b, 0) / DIGEST_DIRS) < 1e-4, "openFraction");
    assert(d.spawns.spawns.length === 2 && d.spawns.zones.length === 2, "spawns carried");
    const expectDrop = cfg.outsideGround >= 1 && cfg.outsideCollision >= 1 ? Math.max(0, -cfg.outsideHeight) : cfg.pitDepth;
    assert(Math.abs(d.outsideDrop - expectDrop) < 1e-4, `seed ${seed}: outsideDrop`);
    assert(d.ringOutFatal === (cfg.outsideGround < 1 || cfg.outsideCollision < 1 || expectDrop >= RING_OUT_FATAL_DROP), "ringOutFatal");
  }
});

Deno.test("digest on generated terrain: terrain stats are real, symmetry and spawns reach the AI", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { digest: d, sym } = build(seed, true, { size: 34 });
    allFinite(d);
    assert(d.terrain.max > d.terrain.min && d.terrain.mean >= d.terrain.min && d.terrain.mean <= d.terrain.max, `seed ${seed}: terrain ${JSON.stringify(d.terrain)}`);
    assert(d.terrain.slope > 0 && d.terrain.slope < Math.PI / 2, "mean slope angle");
    assert(d.symmetry.kind === sym.kind && d.symmetry.order === sym.order, "symmetry carried");
    assert(JSON.parse(JSON.stringify(d)).spawns.fair === (sym.kind !== "none"), "fair flag survives JSON");
  }
});

Deno.test("open fraction: no wall = 1, a full wall above the block height = 0, gates in between", () => {
  const sym = { kind: "none" as const, order: 1, axisDeg: 0 };
  const sp = (cfg: ReturnType<typeof makeArena>) => spawnPlan(cfg, sym, null);
  const dig = (over: Parameters<typeof makeArena>[0]) => { const cfg = makeArena({ size: 30, ...over }); return arenaDigest(cfg, wallPlanFor(cfg, 1, sym), null, [], sym, sp(cfg)); };
  assert(dig({ walls: 0 }).openFraction === 1, "no wall: every direction open");
  assert(dig({ walls: 1, wallRule: 2, wallHeight: 1 }).openFraction === 0, "full 1 m wall: no direction open");
  assert(dig({ walls: 1, wallRule: 1, wallLow: 0.45 }).openFraction === 1, "a 0.45 m curb does not stop a knocked body");
  const g = dig({ walls: 1, wallRule: 5, wallGate: 30, wallHeight: 1 });
  assert(g.openFraction > 0 && g.openFraction < 0.25, `two 30° gates: ${g.openFraction}`);
});

Deno.test("digestFeatures: rim distances, the wall there, a ring-out lane when one exists, cover from props", () => {
  const sym = { kind: "none" as const, order: 1, axisDeg: 0 };
  const half = makeArena({ size: 30, shape: 0, walls: 1, wallRule: 6, wallArc: 180, wallArcCentre: 0, wallHeight: 1, spawnAngle: 180 });
  const plan = wallPlanFor(half, 1, sym);
  const d: ArenaDigest = arenaDigest(half, plan, null, [{ kind: "pillar", x: 0, z: 0, y: 0, rotation: 0, scale: 1, solid: true }], sym, spawnPlan(half, sym, null));
  // Radial ray on a circle: the rim distance is R − |p| (the 32-gon is within the chord sagitta).
  const R = ringRadiusAt(half, 0);
  const f = digestFeatures(d, 5, 0, 0, 0); // attacker at the centre: knocked toward +x
  assert(Math.abs(f.edgeAway - (R - 5)) < R * (1 - Math.cos(Math.PI / DIGEST_DIRS)) + 1e-6, `edgeAway ${f.edgeAway} vs ${R - 5}`);
  assert(Math.abs(f.edgeToward - (R + 5)) < R * (1 - Math.cos(Math.PI / DIGEST_DIRS)) + 1e-6, `edgeToward ${f.edgeToward}`);
  for (const v of Object.values(f)) assert(Number.isFinite(v), "finite features");
  // The half wall stands on one side: the features report the wall where the ray meets the rim.
  const walledDir = d.open.findIndex((o) => o === 0), openDir = d.open.findIndex((o) => o === 1);
  assert(walledDir >= 0 && openDir >= 0, "a half wall has both walled and open directions");
  const aim = (k: number) => { const a = (k / DIGEST_DIRS) * Math.PI * 2; return { x: -3 * Math.cos(a), z: -3 * Math.sin(a) }; };
  const fw = digestFeatures(d, 0.01, 0.01, aim(walledDir).x, aim(walledDir).z);
  assert(fw.openAway === 0 && fw.wallAway >= WALL_BLOCK_HEIGHT, `knocked into the wall: ${JSON.stringify(fw)}`);
  const fo = digestFeatures(d, 0.01, 0.01, aim(openDir).x, aim(openDir).z);
  assert(fo.openAway === 1 && fo.wallAway < WALL_BLOCK_HEIGHT, `knocked through the open side: ${JSON.stringify(fo)}`);
  // A ring-out lane exists and points at an open rim direction.
  assert(f.hasOpen === 1 && f.openDist > 0, "an open direction is found");
  const ray = rimRay(d, 5, 0, Math.cos(f.openAngle), Math.sin(f.openAngle));
  assert(d.open[ray.dir] === 1, `the lane bearing ${f.openAngle.toFixed(3)} meets an open rim (dir ${ray.dir})`);
  // Fully walled: no lane.
  const shut = makeArena({ size: 30, shape: 0, walls: 1, wallRule: 2, wallHeight: 1.2 });
  const ds = arenaDigest(shut, wallPlanFor(shut, 1, sym), null, [], sym, spawnPlan(shut, sym, null));
  const fs = digestFeatures(ds, 2, 2, 0, 0);
  assert(fs.hasOpen === 0 && fs.openDist === -1 && fs.cover === 0, `enclosed: ${JSON.stringify(fs)}`);
  // Cover: the pillar at the centre stands between (−4, 0) and (4, 0), not between (−4, 3) and (4, 3).
  assert(digestFeatures(d, -4, 0, 4, 0).cover > 0.5, "the pillar covers");
  assert(digestFeatures(d, -4, 3, 4, 3).cover === 0, "no cover off to the side");
  // Degenerate input: standing on the attacker, or at the centre.
  for (const v of Object.values(digestFeatures(d, 0, 0, 0, 0))) assert(Number.isFinite(v), "finite at the centre");
});
