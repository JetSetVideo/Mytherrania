// Lane O (V01): terrain clearance — a hill between the third-person camera and the character pulls
// the camera in front of it (or raises it), with an instant pull-in and an eased release.
import {
  CameraClearance, cameraClearance, createClearanceResult, DEFAULT_CLEARANCE, firstGroundHit, type HeightSampler,
} from "../src/game/CameraOcclusion.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

const flat: HeightSampler = () => 0;
/** A 3 m Gaussian hill (sigma 1 m) centred at z = 3, between the camera (z = 7) and the character (z = 0). */
const hill: HeightSampler = (x, z) => 3 * Math.exp(-((x * x + (z - 3) * (z - 3)) / 2));
/** The character's chest and a third-person camera behind it. */
const chest = { x: 0, y: 1.2, z: 0 };
const camera = () => ({ x: 0, y: 2.5, z: 7 });

/** Whether the straight ray target -> p stays groundClearance above the ground. */
function rayClear(target: typeof chest, p: { x: number; y: number; z: number }, h: HeightSampler): boolean {
  const dx = p.x - target.x, dy = p.y - target.y, dz = p.z - target.z;
  const l = Math.hypot(dx, dy, dz);
  return firstGroundHit(target.x, target.y, target.z, dx / l, dy / l, dz / l, l, h, DEFAULT_CLEARANCE) < 0;
}

Deno.test("flat ground: the camera is untouched", () => {
  const r = cameraClearance(camera(), chest, flat);
  assert(!r.blocked && r.fraction === 1 && r.lift === 0, "clear");
  assert(r.x === 0 && r.y === 2.5 && r.z === 7, "same position");
});

Deno.test("a hill between camera and character: the camera moves in front of the hill", () => {
  assert(!rayClear(chest, camera(), hill), "precondition: the hill hides the character");
  const r = cameraClearance(camera(), chest, hill);
  assert(r.blocked && r.fraction < 1, `pulled in: fraction ${r.fraction}`);
  assert(r.z < 3 && r.z > 0, `camera between the character and the hill crest: z ${r.z.toFixed(2)}`);
  assert(rayClear(chest, r, hill), "the new ray clears the hill");
  assert(r.y >= hill(r.x, r.z) + DEFAULT_CLEARANCE.groundClearance - 1e-9, "camera above the ground");
  // Still on the original ray (no lift needed here): same direction from the character.
  const k = r.fraction;
  assert(Math.abs(r.y - (1.2 + 1.3 * k + r.lift)) < 1e-9 && Math.abs(r.z - 7 * k) < 1e-9, "on the view ray");
});

Deno.test("a ridge hugging the character: the camera stops at minDistance and rises", () => {
  const ridge: HeightSampler = (_x, z) => (z > 0.9 && z < 2.5 ? 2 : 0);
  const r = cameraClearance(camera(), chest, ridge);
  const dist = Math.hypot(r.x - chest.x, r.z - chest.z);
  assert(r.blocked && r.lift > 0, `lifted ${r.lift}`);
  assert(dist >= DEFAULT_CLEARANCE.minDistance * 0.9, `not closer than minDistance horizontally-ish: ${dist.toFixed(2)}`);
  assert(rayClear(chest, r, ridge), "the raised ray clears the ridge");
});

Deno.test("a camera under a slope is lifted above the ground", () => {
  const slope: HeightSampler = (_x, z) => (z > 6 ? 3 : 0);
  const r = cameraClearance(camera(), chest, slope);
  assert(r.blocked && r.z < 6, `camera pulled in front of the step: z ${r.z.toFixed(2)}`);
  assert(r.y >= DEFAULT_CLEARANCE.groundClearance, "above the lower ground");
  assert(rayClear(chest, r, slope), "clear ray");
});

Deno.test("the void (NaN height) never blocks", () => {
  const r = cameraClearance(camera(), chest, () => NaN);
  assert(!r.blocked && r.fraction === 1, "void is clear");
});

Deno.test("CameraClearance: instant pull-in, eased release, reusable result", () => {
  const cc = new CameraClearance();
  const cam = camera();
  cc.apply(cam, chest, hill, 1 / 60);
  assert(cc.fraction < 1 && rayClear(chest, cam, hill), "pulled in on the first frame (no see-through frame)");
  const pulled = cc.fraction;
  // The hill disappears: the camera eases back out over ~4 half-lives, not at once.
  const back = camera();
  cc.apply(back, chest, flat, 1 / 60);
  assert(cc.fraction > pulled && cc.fraction < 1, `release eases: ${cc.fraction}`);
  for (let i = 0; i < 120; i++) { const c = camera(); cc.apply(c, chest, flat, 1 / 60); }
  assert(cc.fraction > 0.99, `back out after 2 s: ${cc.fraction}`);
  const out = createClearanceResult();
  assert(cameraClearance(camera(), chest, hill, out) === out, "writes into the given result");
});
