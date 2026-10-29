// Lane R test fixtures: stand-in Surroundings (lane S builds the real ones concurrently) —
// flat ground, a void, a water basin, a magma pool — coded against the contract only, and the
// REAL skinned rig (built once per test process) for the ragdoll tests.
// Not a test file itself (no `_test` suffix).
import type { BiomeSpec, Medium, Surroundings } from "../src/world/biomes/contracts.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import { hitboxesFromPlan } from "../src/combat/Hitboxes.ts";
import { defaultHumanoid, type Skeleton } from "../src/game/Skeleton.ts";
import type { HitboxSet } from "../src/combat/contracts.ts";

/** The default human Warrior rig, its 70 kg capsule hitboxes and a default Skeleton (cached). */
export interface RealBody { rig: ReturnType<typeof buildSkinnedHumanoid>; boxes: HitboxSet; skeleton: Skeleton }
let REAL: RealBody | null = null;
export function realBody(): RealBody {
  if (REAL) return REAL;
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), undefined, "fire", undefined, { paint: false });
  const skeleton = defaultHumanoid();
  rig.update(skeleton, 1 / 60);
  REAL = { rig, boxes: hitboxesFromPlan(rig.plan, { mass: 70 }), skeleton };
  return REAL;
}

/** Put the rig back in its standing pose at (x, y, z) facing yaw (rad), group transform set. */
export function poseRig(b: RealBody, x: number, y: number, z: number, yaw = 0): void {
  b.rig.update(b.skeleton, 1 / 60);
  b.rig.group.position.set(x, y, z);
  b.rig.group.rotation.set(0, yaw, 0);
  b.rig.group.updateMatrixWorld(true);
}

/** Per-medium coefficients from the contract's comments (water ~2 / 0.9, magma ~4 / 1.1, canopy ~1.5). */
const DRAG: Record<Medium, number> = { ground: 0, water: 2, magma: 4, canopy: 1.5, cloud: 0, void: 0 };
const BUOY: Record<Medium, number> = { ground: 0, water: 0.9, magma: 1.1, canopy: 0, cloud: 0, void: 0 };
const HAZARD: Record<Medium, number> = { ground: 0, water: 0, magma: 30, canopy: 0, cloud: 0, void: 0 };

/** Surroundings with one medium everywhere at surface height `y` (NaN for void/cloud). */
export function uniformSurroundings(medium: Medium, y: number, opts: { buoyancy?: number; drag?: number; killPlaneY?: number } = {}): Surroundings {
  const spec: BiomeSpec = {
    kind: medium === "water" ? "water" : medium === "magma" ? "magma" : medium === "canopy" ? "canopy" : medium === "ground" ? "meadow" : "void",
    seed: 1, surfaceDrop: y, extent: 200,
  };
  return {
    spec,
    surfaceAt: () => (medium === "void" || medium === "cloud" ? NaN : y),
    mediumAt: () => medium,
    drag: (m) => (m === medium && opts.drag !== undefined ? opts.drag : DRAG[m]),
    buoyancy: (m) => (m === medium && opts.buoyancy !== undefined ? opts.buoyancy : BUOY[m]),
    hazardDps: (m) => HAZARD[m],
    killPlaneY: opts.killPlaneY ?? -60,
  };
}
