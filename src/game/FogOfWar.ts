// Fog of war: each fighter's personal minimap.
//
// Two layers, the classic pair:
//   - `seen`    — ground the fighter has EVER looked at. Stays known, but dims.
//   - `visible` — ground it can see RIGHT NOW. Cleared every frame and re-marked.
//
// During the opening truce a fighter is busy filling this in, which is exactly why
// nobody attacks yet: they are discovering their own map.
//
// Pure module: no Three.js, no DOM.

export interface FogGrid {
  /** Cells across, and the world size of one cell. */
  cols: number;
  rows: number;
  cell: number;
  /** World half-extent the grid covers, in metres. */
  half: number;
  seen: Uint8Array;
  visible: Uint8Array;
  /** How many cells have ever been seen, kept incrementally. */
  seenCount: number;
}

export function createFog(half: number, cell = 1): FogGrid {
  const cols = Math.max(2, Math.ceil((half * 2) / cell));
  const rows = cols;
  return { cols, rows, cell, half, seen: new Uint8Array(cols * rows), visible: new Uint8Array(cols * rows), seenCount: 0 };
}

/** World metres -> grid cell. Returns null when outside the grid. */
export function cellAt(fog: FogGrid, x: number, z: number): number | null {
  const cx = Math.floor((x + fog.half) / fog.cell);
  const cz = Math.floor((z + fog.half) / fog.cell);
  if (cx < 0 || cz < 0 || cx >= fog.cols || cz >= fog.rows) return null;
  return cz * fog.cols + cx;
}

/**
 * Mark everything within `radius` of (x,z) as visible and seen. `shape` lets the
 * caller pass the same lens the senses use, so the minimap matches what the
 * fighter can actually perceive rather than a plain circle.
 */
export function reveal(
  fog: FogGrid,
  x: number,
  z: number,
  radius: number,
  shape?: (dx: number, dz: number, dist: number) => number,
): void {
  const r = Math.max(0, radius);
  const cx0 = Math.max(0, Math.floor((x - r + fog.half) / fog.cell));
  const cx1 = Math.min(fog.cols - 1, Math.floor((x + r + fog.half) / fog.cell));
  const cz0 = Math.max(0, Math.floor((z - r + fog.half) / fog.cell));
  const cz1 = Math.min(fog.rows - 1, Math.floor((z + r + fog.half) / fog.cell));
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const wx = cx * fog.cell + fog.cell / 2 - fog.half;
      const wz = cz * fog.cell + fog.cell / 2 - fog.half;
      const dx = wx - x, dz = wz - z;
      const dist = Math.hypot(dx, dz);
      if (dist > r) continue;
      if (shape && dist > 1e-6) {
        // `shape` returns a 0..1 factor; anything under a small threshold is not seen.
        if (shape(dx, dz, dist) < 0.06) continue;
      }
      const i = cz * fog.cols + cx;
      if (!fog.visible[i]) fog.visible[i] = 1;
      if (!fog.seen[i]) { fog.seen[i] = 1; fog.seenCount++; }
    }
  }
}

/** Drop the current-visibility layer. Call once per frame before revealing again. */
export function clearVisible(fog: FogGrid): void {
  fog.visible.fill(0);
}

export function isVisible(fog: FogGrid, x: number, z: number): boolean {
  const i = cellAt(fog, x, z);
  return i === null ? false : fog.visible[i] === 1;
}

export function isSeen(fog: FogGrid, x: number, z: number): boolean {
  const i = cellAt(fog, x, z);
  return i === null ? false : fog.seen[i] === 1;
}

/** Fraction of the arena ever seen, 0..1 — the exploration stat. */
export function exploredFraction(fog: FogGrid): number {
  return fog.seenCount / (fog.cols * fog.rows);
}

/** Fraction currently visible, 0..1. */
export function visibleFraction(fog: FogGrid): number {
  let n = 0;
  for (let i = 0; i < fog.visible.length; i++) n += fog.visible[i];
  return n / (fog.cols * fog.rows);
}

/**
 * A coarse ASCII minimap, for the QA manifest and the console. "." unseen,
 * "o" seen but not visible, "#" visible, "@" the fighter.
 */
export function fogAscii(fog: FogGrid, fx: number, fz: number, cols = 24): string {
  const step = Math.max(1, Math.floor(fog.cols / cols));
  const lines: string[] = [];
  const fi = cellAt(fog, fx, fz);
  for (let cz = 0; cz < fog.rows; cz += step) {
    let line = "";
    for (let cx = 0; cx < fog.cols; cx += step) {
      const i = cz * fog.cols + cx;
      line += i === fi ? "@" : fog.visible[i] ? "#" : fog.seen[i] ? "o" : ".";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
