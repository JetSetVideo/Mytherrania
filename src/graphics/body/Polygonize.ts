// Surface Nets polygoniser (lane A, R03). Pure module: no THREE.
//
// Vocabulary
//   grid corner: a sample point min + (i, j, k)·cell. Inside means d < 0.
//   active cell: a cube whose 8 corners do not all share one sign; it owns ONE vertex,
//   placed at the mean of the points where the surface crosses the cube's 12 edges
//   (linear interpolation of d along each edge). Every vertex is shared by all the quads
//   around it, so the output is an indexed mesh with no duplicated seams.
//   sign-change edge: a grid edge whose two corners differ in sign; it emits one quad
//   joining the vertices of the 4 cells around it. The quad is wound counter-clockwise
//   seen from OUTSIDE: for an edge along +a with the inside at its low end the outward
//   normal is +a, and the 4 cells are visited counter-clockwise about +a.
//   normal: the normalised SDF gradient (tetrahedral central differences, step h = NORMAL_STEP·cell).
//
// The bounds must leave at least one cell of outside around the solid; then every active
// cell is interior and the mesh is closed (boundaryEdges = 0).
//
// Manifold guarantee: a mesh edge joins the vertices of two face-adjacent cells and is used
// by one quad per sign-change grid edge on their shared face — 0, 2 or 4 of them. Four
// happens only on an AMBIGUOUS face (diagonal corners equal, neighbours opposite: two
// surface sheets closer than a cell). Before meshing, every ambiguous face is resolved
// TOWARD THE SOLID: its outside corner nearest the surface is set just inside (−ε). That
// bridges a sub-cell gap, only ever adds solid, so it can merge but never split components,
// and it terminates (the inside set grows monotonically). After it no face is ambiguous,
// so nonManifoldEdges = 0 by construction.
//
// Narrow band: the grid is visited in blocks of NARROW_BAND_BLOCK³ cells; a block whose
// centre lies farther than LIPSCHITZ_SAFETY × its half-diagonal from the surface cannot hold
// a sign change, so its corners take the centre's sign without being sampled.

import type { Bounds, MeshData, SdfSample, Vec3 } from "./contracts.ts";
import { fieldFromFunction, type BodyField } from "./Sdf.ts";

/** Central-difference step for normals as a fraction of the cell (small = sharp, noisy). */
export const NORMAL_STEP = 0.25;
/** Cells per side of a narrow-band block (bigger = fewer centre samples, coarser skipping). */
export const NARROW_BAND_BLOCK = 4;
/**
 * Bound on the field's Lipschitz constant: |∇d| ≤ 1 for exact SDFs and smooth-min unions;
 * the domain-warp brushes (pinch, twist, bend) stretch it by at most ~(1 + s/R) < 1.5.
 */
export const LIPSCHITZ_SAFETY = 1.5;
/** Value written into a corner flipped inside to resolve an ambiguous face (fraction of a cell). */
export const AMBIGUITY_EPSILON = 1e-3;

/** Options of one polygonise call. */
export interface PolygonizeOptions {
  /** Skip blocks far from the surface (default true; false samples every corner). */
  narrowBand?: boolean;
  /** Resolve ambiguous faces toward the solid (default true). */
  resolveAmbiguity?: boolean;
}

/** Wall-clock milliseconds spent in each phase of the last polygonise call. */
export interface PolygonizeTiming {
  sampleMs: number;
  /** Corners actually evaluated (the rest were filled by the narrow band). */
  sampled: number;
  /** Corners flipped inside to resolve ambiguous faces. */
  flipped: number;
  vertexMs: number;
  faceMs: number;
  normalMs: number;
  totalMs: number;
  /** Grid corners sampled (nx+1)(ny+1)(nz+1). */
  corners: number;
}

/** Timing of the most recent polygonize call (diagnostics; overwritten each call). */
export const lastPolygonizeTiming: PolygonizeTiming = { sampleMs: 0, sampled: 0, flipped: 0, vertexMs: 0, faceMs: 0, normalMs: 0, totalMs: 0, corners: 0 };

// Reused scratch: the corner grid and the cell -> vertex map grow, never shrink.
let gridScratch: Float32Array = new Float32Array(0);
let cellScratch: Int32Array = new Int32Array(0);
let posScratch: Float32Array = new Float32Array(0);
let idxScratch: Uint32Array = new Uint32Array(0);

function growF32(a: Float32Array, n: number): Float32Array {
  if (a.length >= n) return a;
  const b = new Float32Array(Math.max(n, a.length * 2));
  b.set(a);
  return b;
}
function growU32(a: Uint32Array, n: number): Uint32Array {
  if (a.length >= n) return a;
  const b = new Uint32Array(Math.max(n, a.length * 2));
  b.set(a);
  return b;
}

// The 12 cube edges as corner pairs; corner c = (c & 1, (c >> 1) & 1, (c >> 2) & 1).
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

/** Contract entry point: polygonise `field` over `bounds` with cubic cells of `cell` m. */
export function polygonize(field: (p: Vec3) => SdfSample, bounds: Bounds, cell: number, options?: PolygonizeOptions): MeshData {
  return polygonizeField(fieldFromFunction(field), bounds, cell, options);
}

/** Grid dimensions (cells per axis) for bounds and cell. */
function gridSize(bounds: Bounds, cell: number): [number, number, number] {
  return [
    Math.max(1, Math.ceil((bounds.max[0] - bounds.min[0]) / cell)),
    Math.max(1, Math.ceil((bounds.max[1] - bounds.min[1]) / cell)),
    Math.max(1, Math.ceil((bounds.max[2] - bounds.min[2]) / cell)),
  ];
}

/**
 * Sample the field at every grid corner into `grid` (narrow band optional). Returns how
 * many corners were actually evaluated.
 */
function sampleGrid(field: BodyField, bounds: Bounds, cell: number, grid: Float32Array, narrowBand: boolean): number {
  const [x0, y0, z0] = bounds.min;
  const [nx, ny, nz] = gridSize(bounds, cell);
  const sx = nx + 1, sxy = (nx + 1) * (ny + 1);
  const s: SdfSample = { d: 0, region: 0, bone: 0 };
  let sampled = 0;
  if (!narrowBand) {
    for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) {
      let o = j * sx + k * sxy;
      for (let i = 0; i <= nx; i++, o++) grid[o] = field.sample(x0 + i * cell, y0 + j * cell, z0 + k * cell, s).d;
    }
    return (nx + 1) * (ny + 1) * (nz + 1);
  }
  const B = NARROW_BAND_BLOCK;
  grid.fill(NaN, 0, sxy * (nz + 1));
  for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
    const ei = Math.min(nx, bi + B), ej = Math.min(ny, bj + B), ek = Math.min(nz, bk + B);
    const half = 0.5 * cell * Math.hypot(ei - bi, ej - bj, ek - bk);
    const dc = field.sample(x0 + (bi + ei) * 0.5 * cell, y0 + (bj + ej) * 0.5 * cell, z0 + (bk + ek) * 0.5 * cell, s).d;
    sampled++;
    // Every corner of the block and every edge leaving it lies within half + cell of the centre.
    const far = Math.abs(dc) > LIPSCHITZ_SAFETY * (half + cell);
    for (let k = bk; k <= ek; k++) for (let j = bj; j <= ej; j++) {
      let o = bi + j * sx + k * sxy;
      for (let i = bi; i <= ei; i++, o++) {
        if (!Number.isNaN(grid[o])) continue; // shared corner already set by a neighbour
        if (far) grid[o] = dc > 0 ? dc - half : dc + half; // sign-correct lower bound
        else { grid[o] = field.sample(x0 + i * cell, y0 + j * cell, z0 + k * cell, s).d; sampled++; }
      }
    }
  }
  return sampled;
}

/**
 * Resolve every ambiguous face toward the solid (see the module comment). Returns how many
 * corners were flipped inside.
 */
function resolveAmbiguousFaces(grid: Float32Array, nx: number, ny: number, nz: number, cell: number): number {
  const sx = nx + 1, sxy = (nx + 1) * (ny + 1);
  const eps = -AMBIGUITY_EPSILON * cell;
  let flipped = 0;
  // Face corner offsets for the three orientations: [c00, c10, c01, c11] relative to o.
  const faces: [number, number, number, number, number, number, number][] = [
    // offsets..., then the axis ranges' limits as (di, dj, dk) for valid o
    [0, 1, sx, sx + 1, 1, 1, 0],          // xy face
    [0, 1, sxy, sxy + 1, 1, 0, 1],        // xz face
    [0, sx, sxy, sx + sxy, 0, 1, 1],      // yz face
  ];
  for (let pass = 0; pass < 64; pass++) {
    let changed = 0;
    for (const [a, b, c, d, di, dj, dk] of faces) {
      for (let k = 0; k <= nz - dk; k++) for (let j = 0; j <= ny - dj; j++) {
        let o = j * sx + k * sxy;
        for (let i = 0; i <= nx - di; i++, o++) {
          const v00 = grid[o + a], v10 = grid[o + b], v01 = grid[o + c], v11 = grid[o + d];
          const i00 = v00 < 0, i11 = v11 < 0, i10 = v10 < 0, i01 = v01 < 0;
          if (i00 !== i11 || i10 !== i01 || i00 === i10) continue;
          // The outside pair is (00, 11) or (10, 01): flip the one nearer the surface.
          if (!i00) { if (v00 <= v11) grid[o + a] = eps; else grid[o + d] = eps; }
          else { if (v10 <= v01) grid[o + b] = eps; else grid[o + c] = eps; }
          changed++;
        }
      }
    }
    flipped += changed;
    if (changed === 0) break;
  }
  return flipped;
}

/**
 * Count the sign-change grid edges at `cell` (narrow-band sampled). Surface Nets emits two
 * triangles per such edge, so 2 × this is the triangle count the cell would produce.
 */
export function countSignChanges(field: BodyField, bounds: Bounds, cell: number): number {
  const [nx, ny, nz] = gridSize(bounds, cell);
  const sx = nx + 1, sxy = (nx + 1) * (ny + 1);
  gridScratch = growF32(gridScratch, sxy * (nz + 1));
  const grid = gridScratch;
  sampleGrid(field, bounds, cell, grid, true);
  let n = 0;
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) {
    let o = j * sx + k * sxy;
    for (let i = 0; i <= nx; i++, o++) {
      const inside = grid[o] < 0;
      if (i < nx && inside !== (grid[o + 1] < 0)) n++;
      if (j < ny && inside !== (grid[o + sx] < 0)) n++;
      if (k < nz && inside !== (grid[o + sxy] < 0)) n++;
    }
  }
  return n;
}

/** Surface Nets over an allocation-free BodyField (see the module comment). */
export function polygonizeField(field: BodyField, bounds: Bounds, cell: number, options: PolygonizeOptions = {}): MeshData {
  if (!(cell > 0)) throw new Error(`cell must be > 0, got ${cell}`);
  const t0 = performance.now();
  const [x0, y0, z0] = bounds.min;
  const [nx, ny, nz] = gridSize(bounds, cell);
  const sx = nx + 1, sxy = (nx + 1) * (ny + 1);
  const corners = sxy * (nz + 1);
  gridScratch = growF32(gridScratch, corners);
  const grid = gridScratch;
  const s: SdfSample = { d: 0, region: 0, bone: 0 };
  const sampled = sampleGrid(field, bounds, cell, grid, options.narrowBand ?? true);
  const flipped = (options.resolveAmbiguity ?? true) ? resolveAmbiguousFaces(grid, nx, ny, nz, cell) : 0;
  const t1 = performance.now();

  // Vertices: one per active cell.
  const cells = nx * ny * nz;
  if (cellScratch.length < cells) cellScratch = new Int32Array(Math.max(cells, cellScratch.length * 2));
  const cellVertex = cellScratch;
  cellVertex.fill(-1, 0, cells);
  let nv = 0;
  const cd = new Float64Array(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const base = i + j * sx + k * sxy;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = grid[base + (c & 1) + ((c >> 1) & 1) * sx + ((c >> 2) & 1) * sxy];
          cd[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0, py = 0, pz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const da = cd[a], db = cd[b];
          if ((da < 0) === (db < 0)) continue;
          const t = da / (da - db);
          px += (a & 1) + t * ((b & 1) - (a & 1));
          py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          pz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          n++;
        }
        posScratch = growF32(posScratch, (nv + 1) * 3);
        posScratch[nv * 3] = x0 + (i + px / n) * cell;
        posScratch[nv * 3 + 1] = y0 + (j + py / n) * cell;
        posScratch[nv * 3 + 2] = z0 + (k + pz / n) * cell;
        cellVertex[i + nx * (j + ny * k)] = nv++;
      }
    }
  }
  const t2 = performance.now();

  // Faces: one quad per interior sign-change edge, wound CCW about the outward normal.
  let ni = 0;
  const cellAt = (i: number, j: number, k: number): number => cellVertex[i + nx * (j + ny * k)];
  const quad = (a: number, b: number, c: number, d: number, inLow: boolean): void => {
    if (!inLow) { const t = b; b = d; d = t; } // reverse the cycle: a d c b
    idxScratch = growU32(idxScratch, ni + 6);
    const P = posScratch;
    const d02 = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const d13 = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    const I = idxScratch;
    if (d02 <= d13) { I[ni++] = a; I[ni++] = b; I[ni++] = c; I[ni++] = a; I[ni++] = c; I[ni++] = d; }
    else { I[ni++] = a; I[ni++] = b; I[ni++] = d; I[ni++] = b; I[ni++] = c; I[ni++] = d; }
  };
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const o = i + j * sx + k * sxy;
        const inside = grid[o] < 0;
        // x-edge (i,j,k)->(i+1,j,k): cells (i, j-1..j, k-1..k); CCW about +x is (y-,z-)(y+,z-)(y+,z+)(y-,z+).
        if (i < nx && j > 0 && k > 0 && j < ny && k < nz && inside !== (grid[o + 1] < 0)) {
          quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k), inside);
        }
        // y-edge: cells (i-1..i, j, k-1..k); CCW about +y is (z-,x-)(z+,x-)(z+,x+)(z-,x+).
        if (j < ny && i > 0 && k > 0 && i < nx && k < nz && inside !== (grid[o + sx] < 0)) {
          quad(cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1), inside);
        }
        // z-edge: cells (i-1..i, j-1..j, k); CCW about +z is (x-,y-)(x+,y-)(x+,y+)(x-,y+).
        if (k < nz && i > 0 && j > 0 && i < nx && j < ny && inside !== (grid[o + sxy] < 0)) {
          quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k), inside);
        }
      }
    }
  }
  const t3 = performance.now();

  // Normals from the SDF gradient; region/bone from the sample at the vertex.
  const positions = posScratch.slice(0, nv * 3);
  const normals = new Float32Array(nv * 3);
  const region = new Uint8Array(nv);
  const bone = new Uint8Array(nv);
  // Tetrahedral central difference (4 samples, Quilez): ∇d ∝ Σ kᵢ·d(p + h·kᵢ) over the
  // tetrahedron kᵢ ∈ {(1,−1,−1), (−1,−1,1), (−1,1,−1), (1,1,1)}.
  const h = NORMAL_STEP * cell;
  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const a = field.sample(x + h, y - h, z - h, s).d;
    const b = field.sample(x - h, y - h, z + h, s).d;
    const c = field.sample(x - h, y + h, z - h, s).d;
    const e = field.sample(x + h, y + h, z + h, s).d;
    const gx = a - b - c + e, gy = -a - b + c + e, gz = -a + b - c + e;
    const l = Math.hypot(gx, gy, gz);
    if (l > 1e-12) { normals[v * 3] = gx / l; normals[v * 3 + 1] = gy / l; normals[v * 3 + 2] = gz / l; }
    else normals[v * 3 + 1] = 1;
    field.sample(x, y, z, s);
    region[v] = s.region;
    bone[v] = s.bone;
  }
  const t4 = performance.now();
  lastPolygonizeTiming.sampleMs = t1 - t0;
  lastPolygonizeTiming.sampled = sampled;
  lastPolygonizeTiming.flipped = flipped;
  lastPolygonizeTiming.vertexMs = t2 - t1;
  lastPolygonizeTiming.faceMs = t3 - t2;
  lastPolygonizeTiming.normalMs = t4 - t3;
  lastPolygonizeTiming.totalMs = t4 - t0;
  lastPolygonizeTiming.corners = corners;
  return { positions: positions as Float32Array<ArrayBuffer>, normals, indices: idxScratch.slice(0, ni) as Uint32Array<ArrayBuffer>, region, bone };
}
