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

// ---------------------------------------------------------------------------------------------
// Wave GEN lane B: sub-race posture curves. The canonical column above is the erect human; each
// race scales its curves and adds the two posture terms the generator sculpts on the rendered skin
// (StatMorph.posture): the cervical FORWARD offset of the head over the shoulders and the lumbar
// hollow's extra depth, both in head heights (so a dwarf and an ork get proportionate curves), plus
// the trapezius' share of the neck-to-shoulder slope. Human and elf are erect: every term 0 / 1.

/** One race's posture curve: amplitude multipliers per curve plus the sculpt terms (head heights). */
export interface PostureCurve {
  /** Multipliers on SEGMENTS' amplitudes (1 = the canonical human column). */
  cervical: number; thoracic: number; lumbar: number;
  /** Head displacement forward of the erect column at the head pivot (head heights). */
  neckForwardPerHead: number;
  /** Extra depth of the lumbar hollow behind the waist (head heights). */
  lumbarDepthPerHead: number;
  /** Trapezius girth multiplier (neck-to-shoulder slope). */
  trapezius: number;
}

/** Erect: the canonical column, no posture sculpt. */
export const ERECT_POSTURE: PostureCurve = { cervical: 1, thoracic: 1, lumbar: 1, neckForwardPerHead: 0, lumbarDepthPerHead: 0, trapezius: 1 };

/**
 * Race posture (sub-races inherit their race unless SUBRACE_POSTURE overrides). Ork: the head carried
 * forward of the shoulders on a heavy trapezius (cervical forward, thoracic rounder). Dwarf: a deep
 * lumbar curve under a barrel chest. Human and elf: erect, minimal deviation.
 */
export const RACE_POSTURE: Record<string, PostureCurve> = {
  human: ERECT_POSTURE,
  elf: ERECT_POSTURE,
  dwarf: { cervical: 1, thoracic: 1.1, lumbar: 1.6, neckForwardPerHead: 0, lumbarDepthPerHead: 0.07, trapezius: 1.08 },
  ork: { cervical: 1.8, thoracic: 1.35, lumbar: 1, neckForwardPerHead: 0.13, lumbarDepthPerHead: 0, trapezius: 1.3 },
};
/** Sub-race overrides (partial, layered on the race's curve). */
export const SUBRACE_POSTURE: Record<string, Partial<PostureCurve>> = {
  ironhide: { neckForwardPerHead: 0.15, trapezius: 1.36 },
  mountain: { lumbarDepthPerHead: 0.08 },
};
/** Bounds every posture term is clamped into (the sculpt never exceeds them). */
export const POSTURE_BOUNDS = { neckForwardPerHead: [0, 0.2], lumbarDepthPerHead: [0, 0.12], trapezius: [1, 1.5] } as const;

export function postureCurve(race: string, subrace: string | null = null): PostureCurve {
  const base = RACE_POSTURE[race] ?? ERECT_POSTURE;
  const p = { ...base, ...(subrace ? SUBRACE_POSTURE[subrace] ?? {} : {}) };
  const cl = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));
  return {
    ...p,
    neckForwardPerHead: cl(p.neckForwardPerHead, POSTURE_BOUNDS.neckForwardPerHead),
    lumbarDepthPerHead: cl(p.lumbarDepthPerHead, POSTURE_BOUNDS.lumbarDepthPerHead),
    trapezius: cl(p.trapezius, POSTURE_BOUNDS.trapezius),
  };
}

/** The race's 33-vertebra column: the canonical curves scaled by the race's posture multipliers. */
export function raceSpineColumn(race: string, subrace: string | null = null): Vertebra[] {
  const p = postureCurve(race, subrace);
  const k: Record<Vertebra["curve"], number> = { cervical: p.cervical, thoracic: p.thoracic, lumbar: p.lumbar, sacral: 1 };
  return spineColumn().map((v) => ({ ...v, z: v.z * k[v.curve] }));
}
