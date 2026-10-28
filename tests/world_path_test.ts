// Lane E (R12): A* over the heightfield, string pulling, smoothing, steering.
import { rng32 } from "../src/core/MathCore.ts";
import { makeArena, placeObjects } from "../src/game/ArenaConfig.ts";
import {
  circleOutline, FEATURE_CLIFF, FEATURE_HOLE, flatHeightfield, generateArenaTerrain, generateHeightfield, nearestNode,
  type Heightfield,
} from "../src/world/Heightfield.ts";
import { findPath, GridPathFinder, obstaclesFromProps, polylineLength, steerAlongPath, type Obstacle, type PathResult } from "../src/world/PathFinder.ts";
import { deriveTerrainRules } from "../src/world/TerrainRules.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const RADIUS = 6;
const RULES = deriveTerrainRules({ arenaRadius: RADIUS });
const OUTLINE = circleOutline(RADIUS);
const AGENT = RULES.base.cellSize;

/** Every invariant a returned path must satisfy. */
function checkPath(pf: GridPathFinder, p: PathResult, obstacles: readonly Obstacle[], label: string) {
  const f = pf.field;
  for (let k = 0; k < p.gridPath.length; k++) {
    const n = p.gridPath[k];
    assert(pf.walkable[n] === 1, `${label}: grid node ${n} is blocked`);
    assert(f.featureMask[n] !== FEATURE_HOLE && f.featureMask[n] !== FEATURE_CLIFF, `${label}: grid path enters a hole/cliff`);
    if (k > 0) assert(pf.edgeAllowed(p.gridPath[k - 1], n), `${label}: illegal grid edge ${p.gridPath[k - 1]} -> ${n}`);
  }
  assert(p.length <= p.gridLength + 1e-9, `${label}: string-pulled ${p.length} longer than grid ${p.gridLength}`);
  assert(Math.abs(polylineLength(p.points) - p.length) < 1e-9, `${label}: length mismatch`);
  for (let k = 1; k < p.points.length; k++) {
    const a = p.points[k - 1], b = p.points[k];
    assert(pf.lineWalkable(a.x, a.z, b.x, b.z), `${label}: segment ${k} is not walkable`);
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
    for (let s = 0; s <= steps; s++) {
      const x = a.x + ((b.x - a.x) * s) / steps, z = a.z + ((b.z - a.z) * s) / steps;
      for (const o of obstacles) assert(Math.hypot(x - o.x, z - o.z) >= o.radius + AGENT - 1e-9, `${label}: segment ${k} clips an obstacle`);
      const m = f.featureMask[nearestNode(f, x, z)];
      assert(m !== FEATURE_HOLE && m !== FEATURE_CLIFF, `${label}: segment ${k} crosses a hole/cliff`);
    }
  }
}

Deno.test("A* goes AROUND an obstacle; string pulling keeps a few vertices and is never longer", () => {
  const f = flatHeightfield(RULES, OUTLINE);
  const obstacles: Obstacle[] = [{ x: 0, z: 0, radius: 1.5 }];
  const pf = new GridPathFinder(f, obstacles);
  const p = pf.find({ x: -4, z: 0 }, { x: 4, z: 0 });
  assert(p, "a path exists around the pillar");
  checkPath(pf, p, obstacles, "pillar");
  assert(p.length > 8 + 1e-6, `must detour (length ${p.length})`);
  assert(p.points.length >= 3 && p.points.length < p.gridPath.length, `${p.points.length} vertices from ${p.gridPath.length} nodes`);
  assert(p.points[0].x === -4 && p.points[p.points.length - 1].x === 4, "exact endpoints kept");
  const direct = pf.find({ x: -4, z: 3 }, { x: 4, z: 3 });
  assert(direct && direct.points.length === 2, "clear line of sight -> a single segment");
});

Deno.test("a steep wall is crossed only through its gap", () => {
  const f = flatHeightfield(RULES, OUTLINE);
  const wallI = Math.round(-f.originX / f.cell); // column at x = 0
  for (let j = 0; j < f.rows; j++) {
    const z = f.originZ + j * f.cell;
    if (Math.abs(z - 3) > 0.6) f.heights[j * f.cols + wallI] = 2; // a 2 m wall with a gap near z = 3
  }
  const pf = new GridPathFinder(f);
  const p = pf.find({ x: -3, z: -2 }, { x: 3, z: -2 });
  assert(p, "path through the gap");
  checkPath(pf, p, [], "wall");
  const crossing = p.gridPath.find((n) => n % f.cols === wallI);
  assert(crossing !== undefined && Math.abs(f.originZ + Math.floor(crossing / f.cols) * f.cell - 3) <= 0.6, "crosses at the gap");
});

Deno.test("unreachable goals return null (enclosed goal, start in a sealed pen, goal in a deep hole)", () => {
  const f = flatHeightfield(RULES, OUTLINE);
  const ring: Obstacle[] = [];
  for (let k = 0; k < 16; k++) ring.push({ x: 3 + Math.cos((k * Math.PI) / 8) * 1.8, z: 3 + Math.sin((k * Math.PI) / 8) * 1.8, radius: 0.6 });
  const pf = new GridPathFinder(f, ring);
  assert(pf.walkable[nearestNode(f, 3, 3)] === 1, "the goal itself is open ground");
  assert(pf.find({ x: -4, z: -4 }, { x: 3, z: 3 }) === null, "enclosed goal -> null");
  assert(pf.find({ x: 3, z: 3 }, { x: -4, z: -4 }) === null, "sealed start -> null");
  const g = flatHeightfield(RULES, OUTLINE);
  for (let n = 0; n < g.heights.length; n++) {
    const i = n % g.cols, j = Math.floor(n / g.cols);
    if (Math.hypot(g.originX + i * g.cell - 3, g.originZ + j * g.cell) < 2) { g.heights[n] = -3; g.featureMask[n] = FEATURE_HOLE; }
  }
  assert(new GridPathFinder(g).find({ x: -4, z: 0 }, { x: 3, z: 0 }) === null, "goal deep inside a hole -> null");
});

/** Connected components of the walkable graph (BFS over legal edges), -1 for blocked nodes. */
function components(pf: GridPathFinder): Int32Array {
  const f = pf.field, comp = new Int32Array(f.cols * f.rows).fill(-1);
  let label = 0;
  for (let seed = 0; seed < comp.length; seed++) {
    if (!pf.walkable[seed] || comp[seed] >= 0) continue;
    const queue = [seed];
    comp[seed] = label;
    while (queue.length) {
      const a = queue.pop()!, ai = a % f.cols, aj = (a - ai) / f.cols;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const bi = ai + di, bj = aj + dj;
          if ((di === 0 && dj === 0) || bi < 0 || bj < 0 || bi >= f.cols || bj >= f.rows) continue;
          const b = bj * f.cols + bi;
          if (comp[b] < 0 && pf.edgeAllowed(a, b)) { comp[b] = label; queue.push(b); }
        }
      }
    }
    label++;
  }
  return comp;
}

Deno.test("50 generated arenas: A* finds a path IFF one exists, and every path is legal and only shortened", () => {
  let found = 0, unreachable = 0;
  for (let s = 0; s < 50; s++) {
    const seed = 2000 + s * 104729;
    const f = generateHeightfield(seed, RULES, OUTLINE);
    const props = placeObjects(makeArena({ size: 2 * RADIUS, objects: 3 }), rng32(seed));
    const obstacles = obstaclesFromProps(props);
    const pf = new GridPathFinder(f, obstacles, { inside: (x, z) => Math.hypot(x, z) < RADIUS - AGENT });
    const comp = components(pf);
    const open: number[] = [];
    for (let n = 0; n < comp.length; n++) if (comp[n] >= 0) open.push(n);
    assert(open.length > 0, `seed ${seed}: nothing walkable`);
    const rng = rng32(seed ^ 0x5bd1e995);
    for (let q = 0; q < 6; q++) {
      const a = open[Math.floor(rng() * open.length)], b = open[Math.floor(rng() * open.length)];
      const at = (n: number) => ({ x: f.originX + (n % f.cols) * f.cell, z: f.originZ + Math.floor(n / f.cols) * f.cell });
      const p = pf.find(at(a), at(b));
      assert((p !== null) === (comp[a] === comp[b]), `seed ${seed} query ${q}: found=${p !== null} but same component=${comp[a] === comp[b]}`);
      if (!p) { unreachable++; continue; }
      found++;
      checkPath(pf, p, obstacles, `seed ${seed} query ${q}`);
    }
  }
  assert(found >= 200, `only ${found} of 300 queries connected (${unreachable} in different components)`);
});

Deno.test("Catmull-Rom smoothing passes through the vertices and never leaves walkable ground", () => {
  const f = flatHeightfield(RULES, OUTLINE);
  const obstacles: Obstacle[] = [{ x: 0, z: 0, radius: 1.5 }, { x: 2.5, z: 2.5, radius: 0.8 }];
  const pf = new GridPathFinder(f, obstacles);
  const p = pf.find({ x: -4, z: 0.3 }, { x: 4, z: 3.5 });
  assert(p, "path");
  const smooth = pf.smooth(p.points, 8);
  assert(smooth.length > p.points.length, "smoothing adds samples");
  assert(smooth[0] === p.points[0], "starts at the start");
  const end = smooth[smooth.length - 1], goal = p.points[p.points.length - 1];
  assert(Math.hypot(end.x - goal.x, end.z - goal.z) < 1e-9, "ends at the goal");
  for (let k = 1; k < smooth.length; k++) assert(pf.lineWalkable(smooth[k - 1].x, smooth[k - 1].z, smooth[k].x, smooth[k].z), `smoothed step ${k} not walkable`);
});

Deno.test("steerAlongPath walks an agent to the goal; findPath caches one finder per field", () => {
  const f = flatHeightfield(RULES, OUTLINE);
  const obstacles: Obstacle[] = [{ x: 0, z: 0, radius: 1.5 }];
  const p = findPath(f, { x: -4, z: 0 }, { x: 4, z: 0 }, obstacles);
  assert(p, "path");
  const again = findPath(f, { x: -4, z: 0 }, { x: 4, z: 0 }, obstacles);
  assert(again && again.length === p.length, "cached finder gives the same answer");
  const cursor = { index: 1 }, out = { dirX: 0, dirZ: 0, done: false };
  let x = -4, z = 0, steps = 0;
  const speed = 4.2, dt = 1 / 60; // the engine's AI walking speed
  while (!steerAlongPath(p.points, cursor, x, z, 0.1, out).done && steps < 2000) {
    x += out.dirX * speed * dt;
    z += out.dirZ * speed * dt;
    assert(Math.hypot(x, z) >= 1.5 + AGENT - 0.1, `walker clipped the pillar at (${x}, ${z})`);
    steps++;
  }
  assert(out.done && Math.hypot(x - 4, z) < 0.2, `walker ended at (${x}, ${z}) after ${steps} steps`);
});

Deno.test("hole exits: a fighter at the bottom of a hole finds a path out over its ramp", () => {
  let holes = 0, exits = 0;
  for (let s = 0; s < 30; s++) {
    const f: Heightfield = generateHeightfield(1000 + s * 7919, RULES, OUTLINE);
    const pf = new GridPathFinder(f);
    for (const h of f.features.filter((x) => x.kind === "hole")) {
      const ramp = f.features.find((r) => r.kind === "ramp" && Math.hypot(r.x - r.dirX * r.radius - h.x, r.z - r.dirZ * r.radius - h.z) < 1e-6);
      assert(ramp, `seed ${s}: hole without a ramp`);
      holes++;
      if (pf.find({ x: h.x + ramp.dirX * h.radius * 0.5, z: h.z + ramp.dirZ * h.radius * 0.5 }, { x: 0, z: 0 }, { snapNodes: 3 })) exits++;
    }
  }
  assert(holes >= 25 && exits === holes, `${exits} of ${holes} holes have a walkable exit`);
});

Deno.test("generateArenaTerrain + props: the default arena is pathable centre to rim", () => {
  const cfg = makeArena({ objects: 8 });
  const f = generateArenaTerrain(77, cfg);
  const obstacles = obstaclesFromProps(placeObjects(cfg, rng32(77)));
  const p = findPath(f, { x: -2.5, z: 0 }, { x: 2.5, z: 0 }, obstacles);
  assert(p && p.points.length >= 2, "spawn to spawn");
});
