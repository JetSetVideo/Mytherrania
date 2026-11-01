// Wave J (lane J-B): the ArenaProvider backed by lane J-T's generator — the wall plan from the
// config's combined rules (walls.wallPlanFor), the symmetry (symmetry.symmetryFor), symmetric props
// (placeObjects + symmetrizeObjects), the spawn plan (spawns.spawnPlan) and the digest
// (digest.arenaDigest). Flat terrain (no heightfield): the headless sim has no relief.
//
// The batch's wall ladder sets ONE rule (wallRule = the kind, wallRule2/3 = −1) so a gradient step
// is one rule; the J-T builder still applies its own resistance/bounce scaling per segment.

import { WALL_RULE_KINDS } from "../game/arena/contracts.ts";
import { placeObjects } from "../game/ArenaConfig.ts";
import { wallPlanFor } from "../game/arena/walls.ts";
import { symmetryFor, symmetrizeObjects } from "../game/arena/symmetry.ts";
import { spawnPlan } from "../game/arena/spawns.ts";
import { arenaDigest } from "../game/arena/digest.ts";
import type { ArenaProvider } from "./ArenaFixtures.ts";
import { randomSource } from "./ArenaHarness.ts";

export const buildLaneJTArena: ArenaProvider = (cfg, wall, baseHeight, seed) => {
  const c = {
    ...cfg,
    walls: wall === "none" ? 0 : 1,
    wallRule: Math.max(0, WALL_RULE_KINDS.indexOf(wall)),
    // The config's own secondary rules are kept (default −1 = one rule, as the ladder designs use),
    // so a vars design can combine rules; before wave J2 they were forced to −1 here.
    wallRule2: Number.isFinite(cfg.wallRule2) ? cfg.wallRule2 : -1,
    wallRule3: Number.isFinite(cfg.wallRule3) ? cfg.wallRule3 : -1,
    wallHeight: baseHeight,
  };
  // Write the resolved wall keys back so the record's ArenaConfig is the one the plan came from.
  Object.assign(cfg, c);
  const symmetry = symmetryFor(cfg);
  const walls = wallPlanFor(cfg, seed >>> 0, symmetry);
  const objects = symmetrizeObjects(placeObjects(cfg, randomSource((seed ^ 0x2c1b3c6d) >>> 0)), symmetry, cfg);
  const spawns = spawnPlan(cfg, symmetry, null, 2, objects);
  const digest = arenaDigest(cfg, walls, null, objects, symmetry, spawns);
  return { walls, digest, symmetry };
};
