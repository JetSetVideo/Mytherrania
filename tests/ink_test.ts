// Lane P-A: the ink / manga law (src/graphics/shaders/Ink.ts) is pure and unit-tested here. Every
// assertion is on the PURE functions; the shaders only mirror them via uniforms.
import {
  FACE_SUPPRESS_VIEW,
  INK_BASE_WIDTH,
  INK_FACE_KEEP,
  INK_MAX_WIDTH,
  inkStrength,
  inkWidth,
  MANGA_BANDS,
  MANGA_SHADE,
  MANGA_WRAP,
  mangaRamp,
} from "../src/graphics/shaders/Ink.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const DEG = Math.PI / 180;
const cos = (deg: number) => Math.cos(deg * DEG);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

Deno.test("inkStrength is bounded in [0,1] and falls off with BOTH angles", () => {
  for (let ld = 0; ld <= 180; ld += 5) {
    for (let vd = 0; vd <= 90; vd += 5) {
      const s = inkStrength({ lightDotN: cos(ld), viewDotN: cos(vd), depth: 2, isFace: false, materialInk: 1 });
      assert(s >= 0 && s <= 1, `strength in [0,1] at light ${ld} view ${vd}: ${s}`);
    }
  }
  // A surface facing BOTH the light and the camera is barely marked; a silhouette edge (view 90°) is fully marked.
  const closeUp = inkStrength({ lightDotN: 1, viewDotN: 1, depth: 2, isFace: false, materialInk: 1 });
  const silhouette = inkStrength({ lightDotN: 1, viewDotN: 0, depth: 2, isFace: false, materialInk: 1 });
  assert(closeUp < 0.05, `lit close-up barely marked, got ${closeUp}`);
  assert(silhouette > 0.9, `silhouette fully marked, got ${silhouette}`);
  // Monotone in viewDotN at fixed light: as the surface turns TOWARD the camera (viewDotN → 1) the
  // mark must not rise (viewDotN 0 = silhouette, fully marked; viewDotN 1 = facing camera, barely).
  let prev = inkStrength({ lightDotN: 1, viewDotN: 0, depth: 2, isFace: false, materialInk: 1 });
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const s = inkStrength({ lightDotN: 1, viewDotN: t, depth: 2, isFace: false, materialInk: 1 });
    assert(s <= prev + 1e-9, `strength must not rise as the surface turns toward the camera (t=${t}): ${s} > ${prev}`);
    prev = s;
  }
});

Deno.test("inkStrength suppresses a front-facing face below the threshold", () => {
  const base = { lightDotN: 1, viewDotN: 1, depth: 2, materialInk: 1 };
  const body = inkStrength({ ...base, isFace: false });
  const face = inkStrength({ ...base, isFace: true });
  assert(face <= body * INK_FACE_KEEP + 1e-9, `face keeps at most INK_FACE_KEEP, got ${face}`);
  // Below the suppression threshold the face is not reduced.
  const grazing = inkStrength({ lightDotN: 1, viewDotN: cos(70), depth: 2, isFace: true, materialInk: 1 });
  const grazingBody = inkStrength({ lightDotN: 1, viewDotN: cos(70), depth: 2, isFace: false, materialInk: 1 });
  assert(Math.abs(grazing - grazingBody) < 1e-9, "a face turned past FACE_SUPPRESS_VIEW is not reduced");
  assert(FACE_SUPPRESS_VIEW > 0 && FACE_SUPPRESS_VIEW < 1, "threshold is a cosine in (0,1)");
  // materialInk 0 mutes the mark entirely.
  assert(inkStrength({ ...base, isFace: false, materialInk: 0 }) === 0, "materialInk 0 mutes ink");
});

Deno.test("inkWidth is bounded by INK_MAX_WIDTH and 0 when suppressed", () => {
  assert(inkWidth({ strength: 0, baseWidth: INK_BASE_WIDTH, farFade: false }) === 0, "no strength, no width");
  const full = inkWidth({ strength: 1, baseWidth: INK_BASE_WIDTH, farFade: false });
  assert(full === INK_BASE_WIDTH, `full strength gives the base width, got ${full}`);
  // A base width above the maximum is capped.
  assert(inkWidth({ strength: 1, baseWidth: 1, farFade: false }) === INK_MAX_WIDTH, "cap holds");
  // Far fade thins the mark but never breaks the bound.
  const far = inkWidth({ strength: 1, baseWidth: INK_BASE_WIDTH, farFade: true });
  assert(far < full && far <= INK_MAX_WIDTH, "far fade thins the mark");
  for (let s = 0; s <= 1; s += 0.05) {
    const w = inkWidth({ strength: s, baseWidth: 0.2, farFade: false });
    assert(w <= INK_MAX_WIDTH + 1e-12, `never exceeds INK_MAX_WIDTH at strength ${s}`);
  }
});

Deno.test("mangaRamp gives flat bands, a hard terminator and shade <= 1", () => {
  for (let ld = 0; ld <= 180; ld += 3) {
    const r = mangaRamp({ lightDotN: cos(ld), bands: MANGA_BANDS, shadeTone: MANGA_SHADE, wrap: MANGA_WRAP });
    assert(Number.isInteger(r.band) && r.band >= 0 && r.band <= MANGA_BANDS - 1, `band in range: ${r.band}`);
    assert(r.shade >= 0 && r.shade <= 1, `shade <= 1: ${r.shade}`);
    assert(r.terminator >= 0 && r.terminator < 1, `terminator: ${r.terminator}`);
  }
  // Hard terminator: all three bands appear, and shade only changes when the band does.
  const bands = new Set<number>();
  let lastBand = -1;
  let lastShade = -1;
  for (let ld = 0; ld <= 180; ld += 1) {
    const r = mangaRamp({ lightDotN: cos(ld), bands: 3, shadeTone: MANGA_SHADE, wrap: MANGA_WRAP });
    bands.add(r.band);
    if (r.band === lastBand) assert(r.shade === lastShade, "shade is flat within a band");
    lastBand = r.band;
    lastShade = r.shade;
  }
  assert(bands.size === 3, `3 flat bands, got ${bands.size}`);
  // bands = 1 is degenerate-safe (single full surface).
  const one = mangaRamp({ lightDotN: 0.2, bands: 1, shadeTone: 0.4, wrap: 0 });
  assert(one.band === 0 && one.shade === 1, "one band = full surface");
});

Deno.test("printed ink strength / width table across the angle range", () => {
  const lightAngles = [0, 45, 90, 135, 180];
  const viewAngles = [0, 45, 90];
  console.log("INK TABLE  depth=2m materialInk=1 isFace=false  cell = strength / width(m)");
  console.log(`           ${viewAngles.map((v) => `view ${v}°`.padStart(16)).join("")}`);
  for (const ld of lightAngles) {
    const cells = viewAngles.map((vd) => {
      const s = inkStrength({ lightDotN: cos(ld), viewDotN: cos(vd), depth: 2, isFace: false, materialInk: 1 });
      const w = inkWidth({ strength: s, baseWidth: INK_BASE_WIDTH, farFade: false });
      return `${r3(s)} / ${r3(w)}`.padStart(16);
    });
    console.log(`light ${String(ld).padStart(3)}°  ${cells.join("")}`);
  }
});

Deno.test("printed manga ramp table across the light range for 3 bands", () => {
  console.log(`MANGA RAMP  bands=${MANGA_BANDS} shadeTone=${MANGA_SHADE} wrap=${MANGA_WRAP}`);
  console.log("light°   dotN    band  shade  terminator");
  for (let ld = 0; ld <= 180; ld += 30) {
    const r = mangaRamp({ lightDotN: cos(ld), bands: MANGA_BANDS, shadeTone: MANGA_SHADE, wrap: MANGA_WRAP });
    console.log(`${String(ld).padStart(5)}°  ${String(r3(cos(ld))).padStart(6)}  ${String(r.band).padStart(4)}  ${String(r3(r.shade)).padStart(5)}  ${String(r3(r.terminator)).padStart(10)}`);
  }
});
