import { blockDistance, occlusionAlpha } from "../src/game/CameraOcclusion.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

Deno.test("an object hugging the character fades to near-transparent", () => {
  const a = occlusionAlpha(0.5);
  assert(a <= 0.2, `close occluder alpha ${a} should be low`);
});

Deno.test("an object far from the character stays opaque", () => {
  assert(occlusionAlpha(10) === 1, "far object is solid");
  assert(occlusionAlpha(6) === 1, "at dMax the fade is complete");
});

Deno.test("alpha rises monotonically with distance from the character", () => {
  let prev = -1;
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    const a = occlusionAlpha(d);
    assert(a >= prev, `alpha should not decrease at d=${d}`);
    prev = a;
  }
});

Deno.test("blockDistance detects a wall on the camera-character line", () => {
  // Camera at origin, character 10m down +z, wall at (0, 5) radius 1: dead between.
  const d = blockDistance(0, 0, 0, 10, 0, 5, 1);
  assert(d !== null, "the wall blocks");
  assert(Math.abs(d! - 5) < 1e-6, "the wall is 5m back from the character");
});

Deno.test("blockDistance ignores geometry outside the view corridor", () => {
  // Wall 3m off to the side of the line: does not block.
  assert(blockDistance(0, 0, 0, 10, 3, 5, 1) === null, "off-axis wall is ignored");
  // Wall behind the camera: does not block.
  assert(blockDistance(0, 0, 0, 10, 0, -3, 1) === null, "behind-camera wall is ignored");
});

Deno.test("blockDistance handles a zero-length segment", () => {
  assert(blockDistance(2, 2, 2, 2, 0, 0, 5) === null, "camera on the character: no segment");
});
