export type GroundMaterial = "stone" | "sand" | "ice" | "wood";

export interface Surface {
  material: GroundMaterial;
  speed: number;  // movement speed multiplier
  turn: number;   // turning speed multiplier
  stop: number;   // stop-time multiplier (higher = slides longer before stopping)
  step: "stone" | "sand" | "ice" | "wood"; // step sound id
}

const SURFACES: Record<GroundMaterial, Surface> = {
  stone: { material: "stone", speed: 1.0, turn: 1.0, stop: 0.7, step: "stone" },
  sand:  { material: "sand",  speed: 0.7, turn: 0.8, stop: 0.4, step: "sand" },
  ice:   { material: "ice",   speed: 1.25, turn: 0.5, stop: 2.2, step: "ice" },
  wood:  { material: "wood",  speed: 1.0, turn: 0.9, stop: 0.9, step: "wood" },
};

export function surfaceFor(m: GroundMaterial): Surface {
  return { ...SURFACES[m] };
}

// Arena floor zoning: concentric bands from the centre platform outward.
// Ice sits at the rim, so edge-fighting is slippery (risk/reward).
export function materialAt(x: number, z: number, ringHalf: number): GroundMaterial {
  const band = Math.hypot(x, z) / ringHalf; // 0 centre -> 1 edge
  if (band < 0.35) return "stone";
  if (band < 0.6) return "wood";
  if (band < 0.85) return "sand";
  return "ice";
}
