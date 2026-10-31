// PathFinder: A* over the heightfield's nodes, then string pulling to a few waypoint
// VERTICES, then optional Catmull-Rom smoothing for the walker (R12).
//
// Graph: every heightfield node is a vertex; edges join 8-neighbours. A node is BLOCKED
// when it is a hole or a cliff, when any of its neighbour pairs is steeper than the
// walkable slope (so the agent keeps one node off every rim), when a solid obstacle
// circle (inflated by the agent radius and half a cell diagonal) covers it, or when an
// optional `inside(x, z)` test rejects it. An edge is legal when both ends are walkable,
// its slope |dh| / distance is within the limit, and, for a diagonal, both orthogonal
// neighbours are walkable (no corner cutting).
//
// Edge cost (metres-equivalent):
//   cost = distance * (1 + slopePenalty * s_up)          climbing,  s_up = dh / distance > 0
//   cost = distance * (1 + slopePenalty * k_down * s_dn)  descending, s_dn = -dh / distance
// with slopePenalty = 1 / tan(maxSlope) and k_down = d / g = 0.25 from TerrainRules: the
// sign of dh picks the coefficient. The octile-distance heuristic is admissible because
// every edge costs at least its length.
//
// Open set: a binary min-heap of node indices in typed arrays, with a position index for
// decrease-key (each node is queued at most once, so the heap never exceeds the node count); per-node scores are typed arrays reused across searches (a search stamp
// marks which entries are current), so a search allocates only its result.
// Pure module: no Three.js, no DOM.
import { objectSize, type ArenaObject } from "../game/ArenaConfig.ts";
import { FEATURE_CLIFF, FEATURE_HOLE, heightAt, type Heightfield } from "./Heightfield.ts";

/** A solid circle on the ground (prop footprint), world metres. */
export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

/** A point of a path: world x/z and the ground height y there, metres. */
export interface PathPoint {
  x: number;
  z: number;
  y: number;
}

/** Search tuning. Every field is optional; defaults are derived from the field's rules. */
export interface PathOptions {
  /** Body radius kept clear of obstacles, m. Default: rules.base.cellSize (one fighter radius). */
  agentRadius?: number;
  /** Restrict walking to a region (e.g. inside the ring). Default: everywhere. */
  inside?: (x: number, z: number) => boolean;
  /** How far (in nodes) a blocked start/goal may be moved to the nearest walkable node. Default 2. */
  snapNodes?: number;
  /** Expansion budget. Default: every node once. */
  maxExpanded?: number;
}

/** A found path. `points` are the string-pulled VERTICES (start and goal included). */
export interface PathResult {
  points: PathPoint[];
  /** Horizontal length of `points` as a polyline, m. */
  length: number;
  /** Nodes popped from the open set. */
  expanded: number;
  /** The raw A* node chain (indices) and its horizontal length, m. */
  gridPath: number[];
  gridLength: number;
}

const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];

/** Solid props of an arena as obstacle circles (radius = footprint radius * scale). */
export function obstaclesFromProps(props: readonly ArenaObject[]): Obstacle[] {
  return props.filter((p) => p.solid).map((p) => ({ x: p.x, z: p.z, radius: objectSize(p.kind).r * p.scale }));
}

/**
 * Reusable A* engine for one heightfield. Build once per arena, call `setObstacles` when
 * the props change, then `find` as often as needed.
 */
export class GridPathFinder {
  readonly field: Heightfield;
  /** 1 = walkable node, 0 = blocked. Rebuilt by setObstacles. */
  readonly walkable: Uint8Array;
  #obstacles: Obstacle[] = [];
  #agentRadius: number;
  #g: Float64Array;
  #f: Float64Array;
  #parent: Int32Array;
  #stamp: Uint32Array;
  #closed: Uint32Array;
  #heap: Int32Array;
  #heapPos: Int32Array;
  /** Equals the current search stamp while a node sits in the heap. */
  #queued: Uint32Array;
  #heapSize = 0;
  #search = 0;

  constructor(field: Heightfield, obstacles: readonly Obstacle[] = [], options: PathOptions = {}) {
    this.field = field;
    const n = field.cols * field.rows;
    this.walkable = new Uint8Array(n);
    this.#g = new Float64Array(n);
    this.#f = new Float64Array(n);
    this.#parent = new Int32Array(n);
    this.#stamp = new Uint32Array(n);
    this.#closed = new Uint32Array(n);
    this.#heap = new Int32Array(n);
    this.#heapPos = new Int32Array(n);
    this.#queued = new Uint32Array(n);
    this.#agentRadius = options.agentRadius ?? field.rules.base.cellSize;
    this.setObstacles(obstacles, options);
  }

  /** Recompute the walkable mask for a new obstacle set (and optional region/agent radius). */
  setObstacles(obstacles: readonly Obstacle[], options: PathOptions = {}): void {
    const f = this.field, r = f.rules;
    this.#obstacles = obstacles.map((o) => ({ ...o }));
    if (options.agentRadius !== undefined) this.#agentRadius = options.agentRadius;
    const pad = this.#agentRadius + (f.cell * Math.SQRT2) / 2; // node test is conservative by half a diagonal
    const limitTan = r.maxSlopeTan * (1 + 1e-6);
    for (let j = 0; j < f.rows; j++) {
      for (let i = 0; i < f.cols; i++) {
        const n = j * f.cols + i, x = f.originX + i * f.cell, z = f.originZ + j * f.cell;
        let ok = f.featureMask[n] !== FEATURE_HOLE && f.featureMask[n] !== FEATURE_CLIFF;
        for (let k = 0; ok && k < 8; k++) {
          const ni = i + DI[k], nj = j + DJ[k];
          if (ni < 0 || nj < 0 || ni >= f.cols || nj >= f.rows) continue;
          const dist = k < 4 ? f.cell : f.cell * Math.SQRT2;
          if (Math.abs(f.heights[nj * f.cols + ni] - f.heights[n]) / dist > limitTan) ok = false;
        }
        for (const o of this.#obstacles) if (ok && Math.hypot(x - o.x, z - o.z) < o.radius + pad) ok = false;
        if (ok && options.inside && !options.inside(x, z)) ok = false;
        this.walkable[n] = ok ? 1 : 0;
      }
    }
  }

  /** May the agent step from node a to its 8-neighbour b? (both walkable, slope, no corner cutting) */
  edgeAllowed(a: number, b: number): boolean {
    const f = this.field, w = this.walkable;
    if (!w[a] || !w[b]) return false;
    const ai = a % f.cols, aj = (a - ai) / f.cols, bi = b % f.cols, bj = (b - bi) / f.cols;
    const di = bi - ai, dj = bj - aj;
    if (Math.abs(di) > 1 || Math.abs(dj) > 1) return false;
    const diagonal = di !== 0 && dj !== 0;
    if (diagonal && (!w[aj * f.cols + bi] || !w[bj * f.cols + ai])) return false;
    const dist = diagonal ? f.cell * Math.SQRT2 : f.cell;
    return Math.abs(f.heights[b] - f.heights[a]) <= f.rules.maxSlopeTan * dist * (1 + 1e-6);
  }

  /**
   * Is the straight segment a -> b walkable? Samples every quarter cell: each sample's
   * nearest node must be walkable, each change of nearest node must be a legal edge, and
   * no sample may be inside an obstacle inflated by the agent radius. Every edge A* uses
   * passes this test, so string pulling can always fall back to the grid path.
   */
  lineWalkable(ax: number, az: number, bx: number, bz: number): boolean {
    const f = this.field;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (f.cell * 0.25)));
    let prev = this.#nearest(ax, az);
    if (!this.walkable[prev]) return false;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const n = this.#nearest(x, z);
      if (n !== prev) {
        if (!this.edgeAllowed(prev, n)) return false;
        prev = n;
      }
      for (const o of this.#obstacles) if (Math.hypot(x - o.x, z - o.z) < o.radius + this.#agentRadius) return false;
    }
    return true;
  }

  /** A* from world `from` to world `to`, then string pulling. null when no path exists. */
  find(from: { x: number; z: number }, to: { x: number; z: number }, options: PathOptions = {}): PathResult | null {
    const f = this.field, r = f.rules;
    const snap = options.snapNodes ?? 2;
    const start = this.#snap(from.x, from.z, snap), goal = this.#snap(to.x, to.z, snap);
    if (start < 0 || goal < 0) return null;
    const search = ++this.#search;
    const budget = options.maxExpanded ?? f.cols * f.rows;
    const gi = goal % f.cols, gj = (goal - gi) / f.cols;
    const heuristic = (n: number) => {
      const i = n % f.cols, j = (n - i) / f.cols;
      const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
      return f.cell * (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)); // octile distance
    };
    this.#heapSize = 0;
    this.#stamp[start] = search;
    this.#g[start] = 0;
    this.#parent[start] = -1;
    this.#push(start, heuristic(start));
    let expanded = 0, found = false;
    while (this.#heapSize > 0 && expanded < budget) {
      const a = this.#pop();
      this.#closed[a] = search;
      expanded++;
      if (a === goal) { found = true; break; }
      const ai = a % f.cols, aj = (a - ai) / f.cols;
      for (let k = 0; k < 8; k++) {
        const bi = ai + DI[k], bj = aj + DJ[k];
        if (bi < 0 || bj < 0 || bi >= f.cols || bj >= f.rows) continue;
        const b = bj * f.cols + bi;
        if (this.#closed[b] === search || !this.edgeAllowed(a, b)) continue;
        const dist = k < 4 ? f.cell : f.cell * Math.SQRT2;
        const s = (f.heights[b] - f.heights[a]) / dist; // signed: + climbs, - descends
        const cost = dist * (1 + r.slopePenalty * (s > 0 ? s : -s * r.downhillFactor));
        const g = this.#g[a] + cost;
        if (this.#stamp[b] === search && g >= this.#g[b]) continue;
        this.#stamp[b] = search;
        this.#g[b] = g;
        this.#parent[b] = a;
        this.#push(b, g + heuristic(b));
      }
    }
    if (!found) return null;
    const gridPath: number[] = [];
    for (let n = goal; n !== -1; n = this.#parent[n]) gridPath.push(n);
    gridPath.reverse();
    const raw: PathPoint[] = gridPath.map((n) => this.#point(n));
    // Use the exact endpoints when the straight hop to them is walkable.
    if (this.lineWalkable(from.x, from.z, raw[0].x, raw[0].z)) raw[0] = { x: from.x, z: from.z, y: heightAt(f, from.x, from.z) };
    const last = raw.length - 1;
    if (this.lineWalkable(raw[last].x, raw[last].z, to.x, to.z)) raw[last] = { x: to.x, z: to.z, y: heightAt(f, to.x, to.z) };
    const points = this.stringPull(raw);
    return { points, length: polylineLength(points), expanded, gridPath, gridLength: polylineLength(raw) };
  }

  /**
   * String pulling: from each anchor, jump to the farthest following point the straight
   * line still reaches walkably (forward scan, stops at the first blocked line). Keeps
   * only the VERTICES where the path must turn. Never longer than the input polyline.
   */
  stringPull(points: PathPoint[]): PathPoint[] {
    if (points.length <= 2) return points.slice();
    const out: PathPoint[] = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let best = anchor + 1;
      for (let k = anchor + 2; k < points.length; k++) {
        if (this.lineWalkable(points[anchor].x, points[anchor].z, points[k].x, points[k].z)) best = k;
        else break;
      }
      out.push(points[best]);
      anchor = best;
    }
    return out;
  }

  /**
   * Centripetal Catmull-Rom through the vertices, `samplesPerSpan` points per span, for a
   * walker that should not turn on a dime. A span whose curve leaves walkable ground is
   * replaced by its straight segment, so smoothing never cuts a corner into an obstacle.
   */
  smooth(points: PathPoint[], samplesPerSpan = 6): PathPoint[] {
    if (points.length < 3) return points.slice();
    const f = this.field;
    const out: PathPoint[] = [points[0]];
    for (let s = 0; s < points.length - 1; s++) {
      const p0 = points[Math.max(0, s - 1)], p1 = points[s], p2 = points[s + 1], p3 = points[Math.min(points.length - 1, s + 2)];
      // Centripetal knots: spacing |dp|^0.5 (never cusps or self-loops within a span).
      const t1 = knotGap(p0, p1), t2 = t1 + knotGap(p1, p2), t3 = t2 + knotGap(p2, p3);
      const span: PathPoint[] = [];
      let ok = true, px = p1.x, pz = p1.z;
      for (let k = 1; k <= samplesPerSpan; k++) {
        const u = t1 + (t2 - t1) * (k / samplesPerSpan);
        const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t1, t2, t3, u);
        const z = catmullRom(p0.z, p1.z, p2.z, p3.z, t1, t2, t3, u);
        if (!this.lineWalkable(px, pz, x, z)) { ok = false; break; }
        span.push({ x, z, y: heightAt(f, x, z) });
        px = x; pz = z;
      }
      if (ok) out.push(...span);
      else out.push(p2);
    }
    return out;
  }

  #nearest(x: number, z: number): number {
    const f = this.field;
    const i = Math.max(0, Math.min(f.cols - 1, Math.round((x - f.originX) / f.cell)));
    const j = Math.max(0, Math.min(f.rows - 1, Math.round((z - f.originZ) / f.cell)));
    return j * f.cols + i;
  }

  #point(n: number): PathPoint {
    const f = this.field, i = n % f.cols, j = (n - i) / f.cols;
    return { x: f.originX + i * f.cell, z: f.originZ + j * f.cell, y: f.heights[n] };
  }

  /** Nearest walkable node within `radius` nodes of world (x, z) (Chebyshev rings), or -1. */
  #snap(x: number, z: number, radius: number): number {
    const f = this.field, n0 = this.#nearest(x, z);
    if (this.walkable[n0]) return n0;
    const i0 = n0 % f.cols, j0 = (n0 - i0) / f.cols;
    let best = -1, bestD = Infinity;
    for (let ring = 1; ring <= radius && best < 0; ring++) {
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const i = i0 + di, j = j0 + dj;
          if (i < 0 || j < 0 || i >= f.cols || j >= f.rows) continue;
          const n = j * f.cols + i;
          const d = Math.hypot(f.originX + i * f.cell - x, f.originZ + j * f.cell - z);
          if (this.walkable[n] && d < bestD) { best = n; bestD = d; }
        }
      }
    }
    return best;
  }

  /** Insert node n with priority f, or lower its priority if it is already queued (decrease-key). */
  #push(n: number, f: number): void {
    this.#f[n] = f;
    if (this.#queued[n] === this.#search) { this.#siftUp(this.#heapPos[n]); return; }
    this.#queued[n] = this.#search;
    const i = this.#heapSize++;
    this.#heap[i] = n;
    this.#heapPos[n] = i;
    this.#siftUp(i);
  }

  /** Remove and return the node with the lowest priority. */
  #pop(): number {
    const top = this.#heap[0];
    this.#queued[top] = 0;
    const last = this.#heap[--this.#heapSize];
    if (this.#heapSize > 0) {
      this.#heap[0] = last;
      this.#heapPos[last] = 0;
      this.#siftDown(0);
    }
    return top;
  }

  #siftUp(i: number): void {
    const n = this.#heap[i], fn = this.#f[n];
    while (i > 0) {
      const p = (i - 1) >> 1, pn = this.#heap[p];
      if (this.#f[pn] <= fn) break;
      this.#heap[i] = pn;
      this.#heapPos[pn] = i;
      i = p;
    }
    this.#heap[i] = n;
    this.#heapPos[n] = i;
  }

  #siftDown(i: number): void {
    const n = this.#heap[i], fn = this.#f[n], size = this.#heapSize;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= size) break;
      const r = l + 1;
      const c = r < size && this.#f[this.#heap[r]] < this.#f[this.#heap[l]] ? r : l;
      const cn = this.#heap[c];
      if (this.#f[cn] >= fn) break;
      this.#heap[i] = cn;
      this.#heapPos[cn] = i;
      i = c;
    }
    this.#heap[i] = n;
    this.#heapPos[n] = i;
  }
}

/** Centripetal knot gap between two points: sqrt of their horizontal distance (floored). */
function knotGap(p: PathPoint, q: PathPoint): number {
  return Math.max(1e-4, Math.sqrt(Math.hypot(q.x - p.x, q.z - p.z)));
}

/**
 * One Catmull-Rom coordinate at knot parameter u in [t1, t2] (Barry-Goldman pyramid),
 * control values a, b, c, d at knots 0, t1, t2, t3.
 */
function catmullRom(a: number, b: number, c: number, d: number, t1: number, t2: number, t3: number, u: number): number {
  const a1 = ((t1 - u) * a + u * b) / t1;
  const a2 = ((t2 - u) * b + (u - t1) * c) / (t2 - t1);
  const a3 = ((t3 - u) * c + (u - t2) * d) / (t3 - t2);
  const b1 = ((t2 - u) * a1 + u * a2) / t2;
  const b2 = ((t3 - u) * a2 + (u - t1) * a3) / (t3 - t1);
  return ((t2 - u) * b1 + (u - t1) * b2) / (t2 - t1);
}

/** Horizontal length of a polyline, m. */
export function polylineLength(points: readonly PathPoint[]): number {
  let len = 0;
  for (let k = 1; k < points.length; k++) len += Math.hypot(points[k].x - points[k - 1].x, points[k].z - points[k - 1].z);
  return len;
}

/**
 * Shortest horizontal distance from (x, z) to the polyline `points`, m. This is how far a body
 * has STRAYED off its route: 0 on the line, growing to one side. Total: an empty polyline returns
 * Infinity, a single point returns the point distance, a NaN input returns Infinity (never NaN),
 * so a caller can compare it against a threshold without a guard.
 */
export function distanceToPolyline(points: readonly PathPoint[], x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z) || points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(points[0].x - x, points[0].z - z);
  let best = Infinity;
  for (let k = 1; k < points.length; k++) best = Math.min(best, distanceToSegment(points[k - 1], points[k], x, z));
  return best;
}

/** Shortest distance from (x, z) to the segment a -> b, m. */
export function distanceToSegment(a: PathPoint, b: PathPoint, x: number, z: number): number {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
  return Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
}

const finders = new WeakMap<Heightfield, GridPathFinder>();

/**
 * One-call path query: A* + string pulling on `field` around `obstacles`. Reuses a cached
 * GridPathFinder per field (its walkable mask is rebuilt for the given obstacles). Returns
 * null when either end has no walkable node within `snapNodes` or the goal is unreachable.
 */
export function findPath(
  field: Heightfield, from: { x: number; z: number }, to: { x: number; z: number },
  obstacles: readonly Obstacle[] = [], options: PathOptions = {},
): PathResult | null {
  let finder = finders.get(field);
  if (!finder) { finder = new GridPathFinder(field, obstacles, options); finders.set(field, finder); }
  else finder.setObstacles(obstacles, options);
  return finder.find(from, to, options);
}

/** Cursor of a walker along a path: the index of the vertex it is heading for. */
export interface PathCursor {
  index: number;
}

/** Steering output: unit direction toward the current vertex and whether the path is done. */
export interface Steer {
  dirX: number;
  dirZ: number;
  done: boolean;
}

/**
 * Follow a path: advance `cursor` past every vertex within `arriveRadius` (m) of (x, z),
 * then write the unit direction to the next vertex into `out`. Allocation-free.
 */
export function steerAlongPath(points: readonly PathPoint[], cursor: PathCursor, x: number, z: number, arriveRadius: number, out: Steer): Steer {
  while (cursor.index < points.length && Math.hypot(points[cursor.index].x - x, points[cursor.index].z - z) <= arriveRadius) cursor.index++;
  if (cursor.index >= points.length) { out.dirX = 0; out.dirZ = 0; out.done = true; return out; }
  const dx = points[cursor.index].x - x, dz = points[cursor.index].z - z, d = Math.hypot(dx, dz) || 1;
  out.dirX = dx / d; out.dirZ = dz / d; out.done = false;
  return out;
}
