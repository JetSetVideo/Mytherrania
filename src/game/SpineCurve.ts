// Spine curve: the 33 vertebrae of the human spine, modelled as four curves so
// the back reads correctly from the side — the cervical lordosis (neck, C1-C7),
// the thoracic kyphosis (upper back, T1-T12), the lumbar lordosis (lower back,
// L1-L5), and the sacral curve (S1-S5, plus the fused coccyx as the 33rd point).
//
// From the side, a real spine is not straight: the neck and lower back curve
// forward (lordosis), the upper back curves backward (kyphosis). This module
// computes each vertebra's position along the column and its lateral offset from
// a straight line, so the torso mesh can follow the S-curve instead of a cylinder.
//
// Pure module: no Three.js, no DOM. Positions in metres up the column (0 = pelvis).

export interface Vertebra {
  /** Index 0..32 (C1..C7, T1..T12, L1..L5, S1..S5, coccyx). */
  index: number;
  /** Anatomical label, e.g. "C3", "T12", "L1", "S5". */
  label: string;
  /** Height up the column (m, 0 at the sacrum base). */
  y: number;
  /** Lateral offset from a straight column (m): + forward (lordosis), - back (kyphosis). */
  z: number;
  /** Which of the four curves this vertebra belongs to. */
  curve: "cervical" | "thoracic" | "lumbar" | "sacral";
}

export const SPINE_COUNT = 33;

/** Curve segment boundaries: [count, curve name, amplitude and direction]. */
const SEGMENTS: { count: number; curve: Vertebra["curve"]; label: string; amp: number }[] = [
  { count: 7, curve: "cervical", label: "C", amp: 0.035 },   // neck, forward (lordosis)
  { count: 12, curve: "thoracic", label: "T", amp: -0.055 }, // upper back, backward (kyphosis)
  { count: 5, curve: "lumbar", label: "L", amp: 0.05 },      // lower back, forward (lordosis)
  { count: 9, curve: "sacral", label: "S", amp: -0.03 },     // sacrum + coccyx, backward
];

/** Total spine length (m) from sacrum base to the skull. */
export const SPINE_LENGTH = 0.6;

/**
 * Build the 33-vertebra column. Each curve is a half-sine arch over its segment,
 * so adjacent curves meet at zero offset (smooth S-curve, no kinks). The lateral
 * amplitude follows the anatomical lordosis/kyphosis directions.
 */
export function spineColumn(): Vertebra[] {
  const out: Vertebra[] = [];
  let index = 0;
  for (const seg of SEGMENTS) {
    for (let i = 0; i < seg.count; i++) {
      // Position within the whole column and within this segment.
      const t = index / (SPINE_COUNT - 1);
      const segT = seg.count === 1 ? 0 : i / (seg.count - 1);
      // Half-sine arch: zero at both ends, peak (amp) at the segment middle.
      const arch = Math.sin(segT * Math.PI) * seg.amp;
      out.push({
        index,
        label: `${seg.label}${i + 1}`,
        y: t * SPINE_LENGTH,
        z: arch,
        curve: seg.curve,
      });
      index++;
    }
  }
  return out;
}

/**
 * The lateral (side-view) offset of the spine at a height t in [0,1], interpolating
 * the vertebra column. Positive = forward (lordosis), negative = back (kyphosis).
 * The torso mesh uses this to bow the back.
 */
export function spineOffset(t: number): number {
  const col = spineColumn();
  const x = Math.max(0, Math.min(1, t)) * (SPINE_COUNT - 1);
  const i = Math.floor(x);
  const j = Math.min(SPINE_COUNT - 1, i + 1);
  const f = x - i;
  return col[i].z + (col[j].z - col[i].z) * f;
}

/**
 * Smooth the column with a moving-average filter over the lateral offsets, so the
// curve is continuous and the mesh does not pinch at the segment joins. `passes`
 * controls the smoothing strength (1 = a single 3-point pass).
 */
export function smoothSpine(column: Vertebra[], passes = 1): Vertebra[] {
  let z = column.map((v) => v.z);
  for (let p = 0; p < passes; p++) {
    const next = [...z];
    for (let i = 1; i < z.length - 1; i++) next[i] = (z[i - 1] + z[i] * 2 + z[i + 1]) / 4;
    z = next;
  }
  return column.map((v, i) => ({ ...v, z: z[i] }));
}
