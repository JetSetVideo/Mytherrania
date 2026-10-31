// Wave J (lane J-B): a small grid A* around solid props for the headless simulator — the stand-in
// for the engine's GridPathFinder (src/world/PathFinder.ts, which needs a heightfield the flat sim
// does not build). Obstacles are the digest's solid prop circles inflated by the body footprint;
// nodes outside the ring (rim − margin) are blocked. 8-neighbour moves, no corner cutting, octile
// heuristic, then string pulling with an exact segment–circle test. Pure, allocation-light.

import type { PropDigest } from "../game/arena/contracts.ts";

export interface PathPt { x: number; z: number }

const SQRT2 = Math.SQRT2;

export class PropGrid {
  readonly cell: number;
  readonly n: number;
  readonly origin: number;
  readonly #circles: { x: number; z: number; r: number }[];
  readonly #blocked: Uint8Array;
  readonly #g: Float64Array;
  readonly #from: Int32Array;
  readonly #closed: Uint8Array;

  /**
   * `extent` = half-width of the square covered (≥ the largest rim), `inflate` = body footprint,
   * `inside(x, z)` = the ring test (with its own margin). The grid is at most `maxCells`² nodes.
   */
  constructor(props: readonly PropDigest[], extent: number, inflate: number, inside: (x: number, z: number) => boolean, maxCells = 81) {
    this.#circles = props.filter((p) => p.solid).map((p) => ({ x: p.x, z: p.z, r: p.r + inflate }));
    this.n = maxCells;
    this.cell = Math.max(0.1, (2 * extent) / (maxCells - 1));
    this.origin = -extent;
    const N = this.n * this.n;
    this.#blocked = new Uint8Array(N);
    this.#g = new Float64Array(N);
    this.#from = new Int32Array(N);
    this.#closed = new Uint8Array(N);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const x = this.origin + i * this.cell, z = this.origin + j * this.cell;
      this.#blocked[j * this.n + i] = !inside(x, z) || this.#inCircle(x, z, this.cell * 0.5) ? 1 : 0;
    }
  }

  get hasObstacles(): boolean { return this.#circles.length > 0; }

  #inCircle(x: number, z: number, pad = 0): boolean {
    for (const c of this.#circles) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
    return false;
  }

  /** True when the straight segment misses every inflated prop circle. */
  lineClear(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
    for (const c of this.#circles) {
      let t = L2 > 1e-12 ? ((c.x - x0) * dx + (c.z - z0) * dz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x0 + dx * t - c.x, z0 + dz * t - c.z) < c.r) return false;
    }
    return true;
  }

  #node(x: number, z: number): number {
    const i = Math.max(0, Math.min(this.n - 1, Math.round((x - this.origin) / this.cell)));
    const j = Math.max(0, Math.min(this.n - 1, Math.round((z - this.origin) / this.cell)));
    return j * this.n + i;
  }

  /**
   * Nearest walkable node within `r` rings of a node that the point (fx, fz) can SEE (a straight,
   * prop-free segment), or -1 — so a body pressed against a prop never snaps to a node on the far
   * side of that prop.
   */
  #snap(k: number, fx: number, fz: number, r = 6): number {
    if (!this.#blocked[k] && this.lineClear(fx, fz, this.origin + (k % this.n) * this.cell, this.origin + Math.floor(k / this.n) * this.cell)) return k;
    const i0 = k % this.n, j0 = Math.floor(k / this.n);
    let best = -1, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
      const q = j * this.n + i;
      if (this.#blocked[q]) continue;
      const d = di * di + dj * dj;
      if (d >= bd || !this.lineClear(fx, fz, this.origin + i * this.cell, this.origin + j * this.cell)) continue;
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  /** A* from (sx, sz) to (tx, tz): string-pulled waypoints (start excluded), or null. */
  find(sx: number, sz: number, tx: number, tz: number): PathPt[] | null {
    const n = this.n, N = n * n;
    const s = this.#snap(this.#node(sx, sz), sx, sz), t = this.#snap(this.#node(tx, tz), tx, tz);
    if (s < 0 || t < 0) return null;
    this.#g.fill(Infinity);
    this.#closed.fill(0);
    this.#from.fill(-1);
    const ti = t % n, tj = Math.floor(t / n);
    const h = (k: number) => {
      const dx = Math.abs(k % n - ti), dz = Math.abs(Math.floor(k / n) - tj);
      return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * this.cell;
    };
    // Binary heap on f = g + h.
    const heap: number[] = [s], fval = new Float64Array(N);
    this.#g[s] = 0; fval[s] = h(s);
    const push = (k: number) => {
      heap.push(k);
      let c = heap.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (fval[heap[p]] <= fval[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < heap.length && fval[heap[l]] < fval[heap[m]]) m = l;
          if (r < heap.length && fval[heap[r]] < fval[heap[m]]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
        }
      }
      return top;
    };
    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    let found = false;
    while (heap.length > 0) {
      const k = pop();
      if (this.#closed[k]) continue;
      this.#closed[k] = 1;
      if (k === t) { found = true; break; }
      const i = k % n, j = Math.floor(k / n);
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d], nj = j + DJ[d];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const q = nj * n + ni;
        if (this.#blocked[q] || this.#closed[q]) continue;
        if (d >= 4 && (this.#blocked[j * n + ni] || this.#blocked[nj * n + i])) continue; // no corner cutting
        const g = this.#g[k] + (d >= 4 ? SQRT2 : 1) * this.cell;
        if (g < this.#g[q]) { this.#g[q] = g; this.#from[q] = k; fval[q] = g + h(q); push(q); }
      }
    }
    if (!found) return null;
    const chain: PathPt[] = [];
    for (let k = t; k !== -1; k = this.#from[k]) chain.push({ x: this.origin + (k % n) * this.cell, z: this.origin + Math.floor(k / n) * this.cell });
    chain.reverse();
    chain.push({ x: tx, z: tz });
    // String pulling: from the current anchor, jump to the farthest visible point.
    const out: PathPt[] = [];
    let ax = sx, az = sz, idx = 0;
    while (idx < chain.length - 1) {
      let far = idx + 1;
      for (let q = chain.length - 1; q > idx + 1; q--) if (this.lineClear(ax, az, chain[q].x, chain[q].z)) { far = q; break; }
      out.push(chain[far]);
      ax = chain[far].x; az = chain[far].z; idx = far;
    }
    if (out.length === 0) out.push({ x: tx, z: tz });
    return out;
  }
}
