// Lane E: bodies meet the terrain floor correctly (step up, blocked by cliffs, fall into holes).
import { settleOnFloor, type FloorBody } from "../src/world/TerrainGround.ts";
import { circleOutline, generateHeightfield } from "../src/world/Heightfield.ts";
import { buildRingSurface, makeFloorSampler } from "../src/world/RingSurface.ts";
import { deriveTerrainRules } from "../src/world/TerrainRules.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const STEP = 0.35;
const CLIMB = Math.tan(Math.PI / 6) / 0.8; // tan(30 deg) / g
const body = (x: number, y: number): FloorBody => ({ x, y, z: 0, vx: 3, vy: -1, vz: 0, radius: 0.5 });
/** A floor with a 2 m cliff at x >= 1 and a 0.2 m ledge at x in [-1, 0). */
const floorAt = (x: number) => (x >= 1 ? 2 : x >= -1 && x < 0 ? 0.2 : 0);

Deno.test("a small ledge is stepped onto; resting bodies stay grounded", () => {
  const b = body(-0.5, 0.5);
  const c = settleOnFloor(b, -1.2, 0, (x) => floorAt(x), STEP, CLIMB);
  assert(c.grounded && !c.blocked && Math.abs(b.y - 0.7) < 1e-12 && b.vy === 0, `y ${b.y}`);
});

Deno.test("a cliff face is a wall from below: the move is undone and horizontal speed cancelled", () => {
  const b = body(1.05, 0.5);
  const c = settleOnFloor(b, 0.9, 0, (x) => floorAt(x), STEP, CLIMB);
  assert(c.blocked && b.x === 0.9 && b.vx === 0, "blocked at the face");
  assert(c.grounded && b.y === 0.5, "still standing on the low side");
});

Deno.test("walking off a cliff top or into a hole falls instead of snapping down", () => {
  const b = body(0.95, 2.5); // was on the cliff top, now over the low side
  const c = settleOnFloor(b, 1.05, 0, (x) => floorAt(x), STEP, CLIMB);
  assert(!c.grounded && !c.blocked && b.y === 2.5 && b.vy === -1, "airborne: gravity takes over");
  const nan = settleOnFloor(body(0, 0.5), 0, 0, () => NaN, STEP, CLIMB);
  assert(!nan.grounded && !nan.blocked, "no floor (void) -> untouched");
});

Deno.test("on generated terrain: a walker heading into a cliff face is stopped and never sinks", () => {
  const rules = deriveTerrainRules({ arenaRadius: 6 });
  let tested = 0, blocked = 0;
  for (let s = 0; s < 30; s++) {
    const f = generateHeightfield(500 + s * 31, rules, circleOutline(6));
    const floor = makeFloorSampler(buildRingSurface(f, circleOutline(6)), f, -1, true);
    for (const cliff of f.features.filter((x) => x.kind === "cliff")) {
      // Each cliff has a ramp through its centre: walk BESIDE it, on lines where the drawn
      // floor really jumps by more than two steps within a quarter metre.
      const side = rules.rampHalfWidth + 0.5 + f.cell;
      for (const lateral of [-side, side]) {
        const ox = cliff.x - cliff.dirZ * lateral, oz = cliff.z + cliff.dirX * lateral;
        let jump = 0;
        for (let t = -1; t <= 1; t += 0.05) {
          const h0 = floor(ox + cliff.dirX * t, oz + cliff.dirZ * t), h1 = floor(ox + cliff.dirX * (t + 0.25), oz + cliff.dirZ * (t + 0.25));
          if (!Number.isNaN(h0) && !Number.isNaN(h1)) jump = Math.max(jump, h1 - h0);
        }
        if (jump < 2 * rules.base.stepHeight) continue;
        tested++;
        const b: FloorBody = { x: ox - cliff.dirX * 2, z: oz - cliff.dirZ * 2, y: 0, vx: 0, vy: 0, vz: 0, radius: 0.5 };
        if (Number.isNaN(floor(b.x, b.z))) { tested--; continue; }
        b.y = floor(b.x, b.z) + b.radius;
        for (let k = 0; k < 90; k++) { // 90 frames at 4.2 m/s = 6.3 m: well past the face
          const px = b.x, pz = b.z;
          b.x += (cliff.dirX * 4.2) / 60; b.z += (cliff.dirZ * 4.2) / 60;
          b.vy -= 24 / 60; b.y += b.vy / 60;
          const c = settleOnFloor(b, px, pz, floor, rules.base.stepHeight, rules.maxClimbTan);
          const under = floor(b.x, b.z);
          if (!Number.isNaN(under)) assert(b.y >= under + b.radius - 1e-9, `seed ${s}: body sank ${under + b.radius - b.y} m`);
          if (c.blocked) { blocked++; break; }
        }
      }
    }
  }
  assert(tested >= 10, `only ${tested} cliff lines with a real face were found`);
  assert(blocked === tested, `${tested - blocked} of ${tested} walkers climbed a cliff face`);
});

Deno.test("on generated terrain: ordinary ground and ramps never block a walker", () => {
  const rules = deriveTerrainRules({ arenaRadius: 6 });
  let steps = 0, falseBlocks = 0, rampWalks = 0;
  for (let s = 0; s < 20; s++) {
    const f = generateHeightfield(900 + s * 17, rules, circleOutline(6));
    const floor = makeFloorSampler(buildRingSurface(f, circleOutline(6)), f, -1, true);
    const nearFlag = (x: number, z: number) => {
      for (let dz = -1.5; dz <= 1.5; dz += f.cell) for (let dx = -1.5; dx <= 1.5; dx += f.cell) {
        const i = Math.round((x + dx - f.originX) / f.cell), j = Math.round((z + dz - f.originZ) / f.cell);
        if (i >= 0 && j >= 0 && i < f.cols && j < f.rows && f.featureMask[j * f.cols + i] !== 0) return true;
      }
      return false;
    };
    // Straight walks across the ring in 8 headings.
    for (let h = 0; h < 8; h++) {
      const a = (h * Math.PI) / 4, ux = Math.cos(a), uz = Math.sin(a);
      const b: FloorBody = { x: -ux * 5.5, z: -uz * 5.5, y: 0, vx: 0, vy: 0, vz: 0, radius: 0.5 };
      b.y = floor(b.x, b.z) + b.radius;
      for (let k = 0; k < 150; k++) {
        const px = b.x, pz = b.z;
        b.x += (ux * 4.2) / 60; b.z += (uz * 4.2) / 60;
        b.vy -= 24 / 60; b.y += b.vy / 60;
        const c = settleOnFloor(b, px, pz, floor, rules.base.stepHeight, rules.maxClimbTan);
        steps++;
        if (c.blocked) { if (!nearFlag(b.x, b.z)) falseBlocks++; break; }
        if (Math.hypot(b.x, b.z) > 5.5) break;
      }
    }
    // Walk up every ramp along its axis.
    for (const r of f.features.filter((x) => x.kind === "ramp")) {
      const b: FloorBody = { x: r.x - r.dirX * r.radius * 0.8, z: r.z - r.dirZ * r.radius * 0.8, y: 0, vx: 0, vy: 0, vz: 0, radius: 0.5 };
      if (Number.isNaN(floor(b.x, b.z))) continue;
      b.y = floor(b.x, b.z) + b.radius;
      let ok = true;
      for (let k = 0; k < Math.floor((r.radius * 1.6) / (4.2 / 60)); k++) {
        const px = b.x, pz = b.z;
        b.x += (r.dirX * 4.2) / 60; b.z += (r.dirZ * 4.2) / 60;
        b.vy -= 24 / 60; b.y += b.vy / 60;
        if (Number.isNaN(floor(b.x, b.z))) break;
        if (settleOnFloor(b, px, pz, floor, rules.base.stepHeight, rules.maxClimbTan).blocked) { ok = false; break; }
      }
      if (ok) rampWalks++;
    }
  }
  assert(steps > 1000, "walks happened");
  assert(falseBlocks === 0, `${falseBlocks} walkers blocked on ordinary ground (no flagged node within 1.5 m)`);
  assert(rampWalks >= 20, `only ${rampWalks} ramps walked to the top`);
});
