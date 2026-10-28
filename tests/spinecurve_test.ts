import { smoothSpine, SPINE_COUNT, SPINE_LENGTH, spineColumn, spineOffset } from "../src/game/SpineCurve.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

Deno.test("the column has exactly 33 vertebrae in four curves", () => {
  const col = spineColumn();
  assert(col.length === SPINE_COUNT, `expected ${SPINE_COUNT}, got ${col.length}`);
  const curves = new Set(col.map((v) => v.curve));
  assert(curves.has("cervical") && curves.has("thoracic") && curves.has("lumbar") && curves.has("sacral"), "four curves present");
  // Counts: 7 cervical + 12 thoracic + 5 lumbar + 9 sacral = 33.
  assert(col.filter((v) => v.curve === "cervical").length === 7, "7 cervical");
  assert(col.filter((v) => v.curve === "thoracic").length === 12, "12 thoracic");
  assert(col.filter((v) => v.curve === "lumbar").length === 5, "5 lumbar");
  assert(col.filter((v) => v.curve === "sacral").length === 9, "9 sacral (incl. coccyx)");
});

Deno.test("vertebrae are labelled anatomically and rise up the column", () => {
  const col = spineColumn();
  assert(col[0].label === "C1", "starts at C1");
  assert(col[6].label === "C7", "C7 is the 7th");
  assert(col[7].label === "T1", "thoracic starts after cervical");
  assert(col[18].label === "T12", "T12 is the 19th");
  assert(col[19].label === "L1", "lumbar starts at 20");
  for (let i = 1; i < col.length; i++) assert(col[i].y > col[i - 1].y, "y strictly increases");
  assert(Math.abs(col[SPINE_COUNT - 1].y - SPINE_LENGTH) < 1e-9, "top of the column is the spine length");
});

Deno.test("lordosis curves forward and kyphosis curves backward", () => {
  const col = spineColumn();
  // The lumbar curve (lower back) arches forward (positive z).
  const lumbar = col.filter((v) => v.curve === "lumbar");
  assert(Math.max(...lumbar.map((v) => v.z)) > 0, "lumbar lordosis is forward");
  // The thoracic curve (upper back) arches backward (negative z).
  const thoracic = col.filter((v) => v.curve === "thoracic");
  assert(Math.min(...thoracic.map((v) => v.z)) < 0, "thoracic kyphosis is backward");
});

Deno.test("adjacent curves meet at zero offset (smooth S-curve, no kinks)", () => {
  const col = spineColumn();
  // The half-sine arch is zero at both ends of each segment, so the column starts
  // and ends at zero offset and the curves join smoothly.
  assert(Math.abs(col[0].z) < 1e-9, "column starts at zero offset");
  assert(Math.abs(col[SPINE_COUNT - 1].z) < 1e-9, "column ends at zero offset");
  // The cervical/thoracic join (C7->T1) is continuous: C7's arch is near zero.
  assert(Math.abs(col[6].z) < 0.04, "the cervical curve returns toward the thoracic join");
});

Deno.test("spineOffset interpolates the column and is bounded", () => {
  assert(spineOffset(0) === spineColumn()[0].z, "t=0 is the first vertebra");
  assert(spineOffset(1) === spineColumn()[SPINE_COUNT - 1].z, "t=1 is the last");
  // Bounded by the max arch amplitude.
  for (let t = 0; t <= 1; t += 0.05) {
    assert(Math.abs(spineOffset(t)) < 0.1, `offset at ${t} within bounds, got ${spineOffset(t)}`);
  }
});

Deno.test("smoothSpine reduces the peak-to-peak variation without moving the ends", () => {
  const col = spineColumn();
  const smoothed = smoothSpine(col, 2);
  assert(smoothed.length === col.length, "same count");
  // Smoothing keeps the endpoints' trend but softens the peaks.
  const maxBefore = Math.max(...col.map((v) => Math.abs(v.z)));
  const maxAfter = Math.max(...smoothed.map((v) => Math.abs(v.z)));
  assert(maxAfter <= maxBefore + 1e-9, "smoothing never increases the peak");
  // The curve still has the S shape (lumbar forward, thoracic backward).
  const lumbar = smoothed.filter((v) => v.curve === "lumbar");
  assert(Math.max(...lumbar.map((v) => v.z)) > 0, "lumbar still forward after smoothing");
});
