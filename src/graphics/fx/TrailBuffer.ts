// Ribbon-trail sample history and strip builder. PURE: no Three.js, no DOM, and
// no allocation after construction — every per-frame path writes into typed
// arrays that were sized once.
//
// Vocabulary (used the same way in every fx file):
//   edge      one of the two lines a ribbon is stretched between. Edge 0 / edge 1
//             are e.g. blade BASE / blade TIP, or HIP / SHOULDER for a body trail.
//   sample    one recorded instant: the two edge points (metres, world space) and
//             the time it was taken (seconds, any monotonic clock).
//   live head the most recent pushed position. It is drawn as the newest row even
//             when it was too close to the last stored sample to be stored, so the
//             ribbon stays glued to the blade instead of lagging one sample behind.
//   age       now - sample time (s). lifetime = age at which a row is fully
//             transparent and its sample is dropped.
//   row       one emitted cross-section of the strip = 2 vertices (edge 0, edge 1).
//   along     strip parameter: 0 at the head (newest row), 1 at the oldest row.
//   turn      angle (rad) the ribbon swings through between two samples; the
//             larger of the edge-vector rotation and the path-tangent rotation.
//
// Vertex layout ("triangle-strip order"): row r writes vertex 2r = edge 0 and
// vertex 2r+1 = edge 1. `stripIndices(maxRows)` gives the matching static index
// buffer (two triangles per row gap), because WebGL2 three.js meshes draw indexed
// triangle lists, not GL_TRIANGLE_STRIP.

import { clamp, lerp, smoothstep } from "../../core/MathCore.ts";

/** Anything with x/y/z in metres (THREE.Vector3 satisfies it). */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Construction parameters for a {@link TrailBuffer}. Distances in metres, times in seconds. */
export interface TrailBufferOptions {
  /** Maximum number of STORED samples kept in the ring (the live head is extra). */
  capacity: number;
  /** Seconds a sample lives: alpha = 1 at age 0 and reaches 0 at `lifetime`. */
  lifetime: number;
  /**
   * Metres EITHER edge must travel from the last stored sample before a new
   * sample is stored. Stops a slow or still blade from piling samples on one spot.
   * Default {@link DEFAULT_MIN_SPAWN_DISTANCE}.
   */
  minSpawnDistance?: number;
  /** Radians of turn represented by one Catmull-Rom sub-step. Default {@link DEFAULT_RADIANS_PER_SUBDIVISION}. */
  radiansPerSubdivision?: number;
  /** Upper bound on rows INSERTED between two samples. Default {@link DEFAULT_MAX_SUBDIVISIONS}. */
  maxSubdivisions?: number;
  /**
   * Rows the output strip can hold (vertex capacity = 2 * maxRows). Default is the
   * worst case `(capacity + 1) * (maxSubdivisions + 1)` (every stored sample plus
   * the live head, each followed by the maximum inserted rows), so nothing is
   * clipped; a smaller value clips the OLDEST rows first.
   */
  maxRows?: number;
  /** 0..1 — how much a row narrows as it ages (0 = constant width, 1 = collapses at lifetime). */
  taper?: number;
  /** 0..1 — point the taper shrinks toward: 0 = edge 0, 0.5 = midpoint, 1 = edge 1. */
  taperPivot?: number;
  /** Scale of every row's spread about its taper pivot (1 = the exact pushed edges). */
  widthScale?: number;
}

/**
 * Two centimetres: a step smaller than ~1 px on a 1080p screen at the 5 m gameplay
 * camera distance (vertical FOV 50 deg -> 2*5*tan(25 deg)/1080 ≈ 4.3 mm/px, and the
 * ribbon also spans many pixels), so skipping it is invisible but saves rows.
 */
export const DEFAULT_MIN_SPAWN_DISTANCE = 0.02;
/**
 * 7.5 deg per sub-step. A chord spanning angle θ on a circle of radius r misses
 * the arc by r * (1 - cos(θ/2)); for a 1 m blade that is 2.1 mm — below a pixel
 * at gameplay distance, so the arc reads round.
 */
export const DEFAULT_RADIANS_PER_SUBDIVISION = Math.PI / 24;
/** At most 6 inserted rows (= 52.5 deg per sample gap before the cap engages). */
export const DEFAULT_MAX_SUBDIVISIONS = 6;

/** Floats per stored sample: x0, y0, z0, x1, y1, z1. */
const FLOATS_PER_SAMPLE = 6;
/**
 * Largest step-length ratio between neighbouring samples for which the strip's
 * end is extended quadratically; 2:1 keeps the uniform Catmull-Rom parameter
 * within its no-cusp range for the phantom end point.
 */
const UNIFORM_SPACING_RATIO = 2;

/**
 * Alpha of a row of the given age: 1 - smoothstep(0, lifetime, age).
 * Exactly 1 at age 0, exactly 0 at age >= lifetime, C1-smooth in between.
 */
export function fadeAlpha(age: number, lifetime: number): number {
  if (lifetime <= 0) return 0;
  return 1 - smoothstep(0, lifetime, age);
}

/**
 * Rows to insert between two samples whose ribbon turns by `turn` radians:
 *   n = clamp(ceil(turn / radiansPerSubdivision) - 1, 0, maxSubdivisions)
 * A turn of one step or less needs no extra row (the segment itself is the step).
 */
export function subdivisionCount(turn: number, radiansPerSubdivision: number, maxSubdivisions: number): number {
  if (!(turn > 0) || !(radiansPerSubdivision > 0)) return 0;
  return clamp(Math.ceil(turn / radiansPerSubdivision - 1e-9) - 1, 0, maxSubdivisions);
}

/** Angle in radians between vectors (ax,ay,az) and (bx,by,bz); 0 if either is zero. Robust near 0 and π. */
export function angleBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const cross = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const dot = ax * bx + ay * by + az * bz;
  if (cross === 0 && dot === 0) return 0;
  return Math.atan2(cross, dot);
}

/** Uniform Catmull-Rom on one coordinate: the curve through p1 (t=0) and p2 (t=1). */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

/**
 * Static index buffer for a strip of `maxRows` rows in the vertex layout above:
 * for each gap r -> r+1 the triangles (2r, 2r+1, 2r+2) and (2r+1, 2r+3, 2r+2).
 * Length = 6 * (maxRows - 1). Draw `6 * (rows - 1)` indices for `rows` rows.
 */
export function stripIndices(maxRows: number): Uint16Array | Uint32Array {
  const gaps = Math.max(0, maxRows - 1);
  const out = maxRows * 2 > 65535 ? new Uint32Array(gaps * 6) : new Uint16Array(gaps * 6);
  for (let r = 0; r < gaps; r++) {
    const v = r * 2, o = r * 6;
    out[o] = v; out[o + 1] = v + 1; out[o + 2] = v + 2;
    out[o + 3] = v + 1; out[o + 4] = v + 3; out[o + 5] = v + 2;
  }
  return out;
}

/**
 * Fixed-capacity ring of ribbon samples plus the strip it emits.
 * `push*` records, `build(now)` expires old samples and writes `positions`,
 * `alphas`, `along` and `bounds`. Nothing allocates after the constructor.
 */
export class TrailBuffer {
  readonly capacity: number;
  readonly maxRows: number;
  lifetime: number;
  minSpawnDistance: number;
  radiansPerSubdivision: number;
  maxSubdivisions: number;
  taper: number;
  taperPivot: number;
  widthScale: number;

  /** Output: 3 floats per vertex, 2 vertices per row (edge 0 then edge 1). */
  readonly positions: Float32Array;
  /** Output: per-vertex alpha = fadeAlpha(age, lifetime). */
  readonly alphas: Float32Array;
  /** Output: per-vertex strip parameter, 0 at the head row, 1 at the oldest row. */
  readonly along: Float32Array;
  /** Output: axis-aligned bounds of the emitted vertices [minX,minY,minZ,maxX,maxY,maxZ]. */
  readonly bounds = new Float32Array(6);
  /** Rows written by the last build (0 when fewer than two points exist). */
  rows = 0;

  readonly #samples: Float32Array;
  readonly #times: Float64Array;
  /** Ring index of the newest stored sample. */
  #head = -1;
  #count = 0;
  readonly #live = new Float64Array(FLOATS_PER_SAMPLE);
  #liveTime = 0;
  #hasLive = false;
  /** True when the live head IS the newest stored sample (do not draw it twice). */
  #liveStored = false;
  /** Scratch: the four Catmull-Rom control samples (P0..P3), 6 floats each. */
  readonly #cp = new Float64Array(FLOATS_PER_SAMPLE * 4);
  readonly #cpTime = new Float64Array(4);

  constructor(options: TrailBufferOptions) {
    this.capacity = Math.max(2, Math.floor(options.capacity));
    this.lifetime = options.lifetime;
    this.minSpawnDistance = options.minSpawnDistance ?? DEFAULT_MIN_SPAWN_DISTANCE;
    this.radiansPerSubdivision = options.radiansPerSubdivision ?? DEFAULT_RADIANS_PER_SUBDIVISION;
    this.maxSubdivisions = Math.max(0, Math.floor(options.maxSubdivisions ?? DEFAULT_MAX_SUBDIVISIONS));
    this.maxRows = Math.max(2, Math.floor(options.maxRows ?? (this.capacity + 1) * (this.maxSubdivisions + 1)));
    this.taper = clamp(options.taper ?? 0, 0, 1);
    this.taperPivot = clamp(options.taperPivot ?? 0.5, 0, 1);
    this.widthScale = options.widthScale ?? 1;
    this.#samples = new Float32Array(this.capacity * FLOATS_PER_SAMPLE);
    this.#times = new Float64Array(this.capacity);
    this.positions = new Float32Array(this.maxRows * 2 * 3);
    this.alphas = new Float32Array(this.maxRows * 2);
    this.along = new Float32Array(this.maxRows * 2);
  }

  /** Stored samples currently in the ring (excludes an unstored live head). */
  get count(): number {
    return this.#count;
  }

  /** Vertices written by the last build = 2 * rows. Never exceeds 2 * maxRows. */
  get vertexCount(): number {
    return this.rows * 2;
  }

  /** Forget every sample (the ribbon disappears on the next build). */
  clear(): void {
    this.#head = -1;
    this.#count = 0;
    this.#hasLive = false;
    this.#liveStored = false;
    this.rows = 0;
  }

  /**
   * Record the ribbon's two edges at `time` (s). Returns true when the sample was
   * STORED; false when it only moved the live head because neither edge travelled
   * `minSpawnDistance` from the last stored sample.
   */
  push(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, time: number): boolean {
    const live = this.#live;
    live[0] = x0; live[1] = y0; live[2] = z0; live[3] = x1; live[4] = y1; live[5] = z1;
    this.#liveTime = time;
    this.#hasLive = true;
    if (this.#count > 0) {
      const o = this.#head * FLOATS_PER_SAMPLE, s = this.#samples;
      const d0 = Math.hypot(x0 - s[o], y0 - s[o + 1], z0 - s[o + 2]);
      const d1 = Math.hypot(x1 - s[o + 3], y1 - s[o + 4], z1 - s[o + 5]);
      if (Math.max(d0, d1) < this.minSpawnDistance) {
        this.#liveStored = false;
        return false;
      }
    }
    this.#head = (this.#head + 1) % this.capacity;
    const o = this.#head * FLOATS_PER_SAMPLE, s = this.#samples;
    s[o] = x0; s[o + 1] = y0; s[o + 2] = z0; s[o + 3] = x1; s[o + 4] = y1; s[o + 5] = z1;
    this.#times[this.#head] = time;
    if (this.#count < this.capacity) this.#count++;
    this.#liveStored = true;
    return true;
  }

  /** {@link push} taking the two edges as points (e.g. THREE.Vector3). Allocation-free. */
  pushEdges(edge0: Vec3Like, edge1: Vec3Like, time: number): boolean {
    return this.push(edge0.x, edge0.y, edge0.z, edge1.x, edge1.y, edge1.z, time);
  }

  /**
   * Copy stored sample `i` (0 = newest stored, count-1 = oldest) into `out`
   * (6 floats: edge 0 xyz, edge 1 xyz) and return its time. Throws when out of range.
   */
  sampleAt(i: number, out: Float32Array | Float64Array | number[]): number {
    if (i < 0 || i >= this.#count) throw new RangeError(`sample ${i} outside 0..${this.#count - 1}`);
    const slot = (this.#head - i + this.capacity) % this.capacity;
    const o = slot * FLOATS_PER_SAMPLE;
    for (let k = 0; k < FLOATS_PER_SAMPLE; k++) out[k] = this.#samples[o + k];
    return this.#times[slot];
  }

  /** Drop every stored sample (and the live head) whose age at `now` is >= lifetime. */
  expire(now: number): void {
    while (this.#count > 0) {
      const oldest = (this.#head - this.#count + 1 + this.capacity) % this.capacity;
      if (now - this.#times[oldest] < this.lifetime) break;
      this.#count--;
    }
    if (this.#count === 0) {
      this.#head = -1;
      this.#liveStored = false;
    }
    if (this.#hasLive && now - this.#liveTime >= this.lifetime) this.#hasLive = false;
  }

  /** Control points available to the strip: the unstored live head (if any) + stored samples. */
  get pointCount(): number {
    return this.#count + (this.#hasLive && !this.#liveStored ? 1 : 0);
  }

  /** Copy control point k (0 = newest) into the scratch slot `slot` (0..3); returns its time. */
  #loadPoint(k: number, slot: number): number {
    const dst = slot * FLOATS_PER_SAMPLE;
    const extra = this.#hasLive && !this.#liveStored ? 1 : 0;
    if (k < extra) {
      for (let c = 0; c < FLOATS_PER_SAMPLE; c++) this.#cp[dst + c] = this.#live[c];
      this.#cpTime[slot] = this.#liveTime;
      return this.#liveTime;
    }
    const ring = (this.#head - (k - extra) + this.capacity) % this.capacity;
    const src = ring * FLOATS_PER_SAMPLE;
    for (let c = 0; c < FLOATS_PER_SAMPLE; c++) this.#cp[dst + c] = this.#samples[src + c];
    this.#cpTime[slot] = this.#times[ring];
    return this.#times[ring];
  }

  /**
   * Turn (rad) of the segment P1 -> P2 held in scratch slots 1 and 2, using P0/P3
   * for the path tangents: max(edge rotation, path-tangent rotation).
   */
  #segmentTurn(): number {
    const c = this.#cp;
    // Edge vectors (edge1 - edge0) at P1 and P2: the blade's own rotation.
    const edgeTurn = angleBetween(
      c[9] - c[6], c[10] - c[7], c[11] - c[8],
      c[15] - c[12], c[16] - c[13], c[17] - c[14],
    );
    // Midpoint path tangents at P1 (P2 - P0) and at P2 (P3 - P1): the swept path's bend.
    const pathTurn = angleBetween(
      this.#mid(2, 0) - this.#mid(0, 0), this.#mid(2, 1) - this.#mid(0, 1), this.#mid(2, 2) - this.#mid(0, 2),
      this.#mid(3, 0) - this.#mid(1, 0), this.#mid(3, 1) - this.#mid(1, 1), this.#mid(3, 2) - this.#mid(1, 2),
    );
    return Math.max(edgeTurn, pathTurn);
  }

  /**
   * Extrapolate the missing end neighbour `dst` beyond `near` (the end point),
   * away from `mid`. With a third point `far` and near-uniform spacing, the
   * quadratic through far, mid, near is continued (dst = 3*near - 3*mid + far),
   * which keeps a swing's curvature to the very end of the strip. Otherwise the
   * linear mirror dst = 2*near - mid is used: uneven spacing (the live head sits
   * closer than a spawn step) would make the quadratic overshoot and loop.
   */
  #phantom(dst: number, near: number, mid: number, far: number): void {
    const c = this.#cp;
    let quadratic = far >= 0;
    if (quadratic) {
      const d1 = this.#slotDistance(near, mid), d2 = this.#slotDistance(mid, far);
      // Uniform Catmull-Rom assumes equal steps; outside a 2:1 ratio fall back to linear.
      quadratic = d1 > 0 && d2 > 0 && d1 / d2 < UNIFORM_SPACING_RATIO && d2 / d1 < UNIFORM_SPACING_RATIO;
    }
    for (let k = 0; k < FLOATS_PER_SAMPLE; k++) {
      const a = c[near * 6 + k], b = c[mid * 6 + k];
      c[dst * 6 + k] = quadratic ? 3 * a - 3 * b + c[far * 6 + k] : 2 * a - b;
    }
  }

  /** Larger of the two edge displacements between scratch slots `a` and `b` (metres). */
  #slotDistance(a: number, b: number): number {
    const c = this.#cp, oa = a * 6, ob = b * 6;
    const d0 = Math.hypot(c[oa] - c[ob], c[oa + 1] - c[ob + 1], c[oa + 2] - c[ob + 2]);
    const d1 = Math.hypot(c[oa + 3] - c[ob + 3], c[oa + 4] - c[ob + 4], c[oa + 5] - c[ob + 5]);
    return Math.max(d0, d1);
  }

  /** Midpoint of the two edges of scratch slot `slot` on `axis` (0 = x, 1 = y, 2 = z). */
  #mid(slot: number, axis: number): number {
    return (this.#cp[slot * 6 + axis] + this.#cp[slot * 6 + 3 + axis]) * 0.5;
  }

  /** Write one row at Catmull-Rom parameter t of the loaded segment; returns false when full. */
  #emitRow(t: number, now: number): boolean {
    if (this.rows >= this.maxRows) return false;
    const c = this.#cp, pos = this.positions, r = this.rows;
    const time = lerp(this.#cpTime[1], this.#cpTime[2], t);
    const age = now - time;
    const alpha = fadeAlpha(age, this.lifetime);
    // Width factor: the row shrinks toward its taper pivot as it ages.
    const width = this.widthScale * (1 - this.taper * clamp(age / this.lifetime, 0, 1));
    const b = this.bounds;
    for (let axis = 0; axis < 3; axis++) {
      const e0 = t === 0 ? c[6 + axis] : catmullRom(c[axis], c[6 + axis], c[12 + axis], c[18 + axis], t);
      const e1 = t === 0
        ? c[9 + axis]
        : catmullRom(c[3 + axis], c[9 + axis], c[15 + axis], c[21 + axis], t);
      const pivot = lerp(e0, e1, this.taperPivot);
      const v0 = pivot + (e0 - pivot) * width;
      const v1 = pivot + (e1 - pivot) * width;
      pos[r * 6 + axis] = v0;
      pos[r * 6 + 3 + axis] = v1;
      const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
      if (lo < b[axis]) b[axis] = lo;
      if (hi > b[axis + 3]) b[axis + 3] = hi;
    }
    this.alphas[r * 2] = alpha;
    this.alphas[r * 2 + 1] = alpha;
    this.rows++;
    return true;
  }

  /**
   * Expire samples older than `lifetime`, then write the strip newest -> oldest
   * with Catmull-Rom rows inserted where the ribbon turns. Returns the vertex
   * count (2 per row; 0 when fewer than two control points remain).
   */
  build(now: number): number {
    this.expire(now);
    this.rows = 0;
    const b = this.bounds;
    b[0] = b[1] = b[2] = Infinity;
    b[3] = b[4] = b[5] = -Infinity;
    const n = this.pointCount;
    if (n < 2) {
      b.fill(0);
      return 0;
    }
    let full = false;
    for (let j = 0; j < n - 1 && !full; j++) {
      // Load P0..P3 for the segment P1 = point j -> P2 = point j+1. A missing end
      // neighbour is a PHANTOM point extrapolated from the real ones (#phantom).
      this.#loadPoint(j, 1);
      this.#loadPoint(j + 1, 2);
      const hasBefore = j > 0, hasAfter = j + 2 < n;
      if (hasBefore) this.#loadPoint(j - 1, 0);
      if (hasAfter) this.#loadPoint(j + 2, 3);
      if (!hasBefore) this.#phantom(0, 1, 2, hasAfter ? 3 : -1);
      if (!hasAfter) this.#phantom(3, 2, 1, hasBefore ? 0 : -1);
      if (!this.#emitRow(0, now)) break;
      const inserts = subdivisionCount(this.#segmentTurn(), this.radiansPerSubdivision, this.maxSubdivisions);
      for (let s = 1; s <= inserts; s++) {
        if (!this.#emitRow(s / (inserts + 1), now)) {
          full = true;
          break;
        }
      }
      // The final control point closes the strip after the last segment.
      if (!full && j === n - 2) this.#emitRow(1, now);
    }
    const last = Math.max(1, this.rows - 1);
    for (let r = 0; r < this.rows; r++) {
      const a = r / last;
      this.along[r * 2] = a;
      this.along[r * 2 + 1] = a;
    }
    if (this.rows < 2) {
      this.rows = 0;
      b.fill(0);
    }
    return this.rows * 2;
  }
}
