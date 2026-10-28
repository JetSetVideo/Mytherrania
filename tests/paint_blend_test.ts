// Lane B paint: blend modes match the Photoshop formulas at known values; the colour
// helpers agree with three.js's own colour management.
// @deno-types="@types/three"
import * as THREE from "three";
import {
  BLEND_MODES, blendChannel, compositeChannel, contrastRatio, hexToHsl, hexToLinear, hexToRgb, hslToHex,
  linearToSrgb, relativeLuminance, rgbToHex, shadeHex, srgbToLinear, tintHex,
} from "../src/graphics/paint/Blend.ts";
import { boundColour, INK_BOUNDS, insideBounds, measureHex, SKIN_BOUNDS } from "../src/graphics/paint/Relevance.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
function near(a: number, b: number, eps = 1e-9, m = ""): void {
  assert(Math.abs(a - b) <= eps, `${m} expected ${b}, got ${a}`);
}

Deno.test("blend: every mode at hand-computed values (base, top -> result)", () => {
  const table: [typeof BLEND_MODES[number], number, number, number][] = [
    ["normal", 0.3, 0.8, 0.8],
    ["multiply", 0.5, 0.5, 0.25],
    ["multiply", 0.8, 1, 0.8],                // white is multiply's identity
    ["screen", 0.5, 0.5, 0.75],               // 1 - 0.5 * 0.5
    ["screen", 0.3, 0, 0.3],                  // black is screen's identity
    ["overlay", 0.25, 0.8, 0.4],              // base < 0.5: 2 * 0.25 * 0.8
    ["overlay", 0.75, 0.2, 0.6],              // base >= 0.5: 1 - 2 * 0.25 * 0.8
    ["softLight", 0.25, 0, 0.0625],           // s < 0.5: 2bs + b^2 (1 - 2s) = 0.0625
    ["softLight", 0.25, 1, 0.5],              // s >= 0.5: 2b(1 - s) + sqrt(b)(2s - 1) = 0.5
    ["softLight", 0.64, 0.75, 0.32 + 0.4],    // 2*.64*.25 + .8*.5 = 0.72
    ["add", 0.3, 0.4, 0.7],
    ["add", 0.8, 0.5, 1],                     // clamped at 1
  ];
  for (const [mode, b, s, want] of table) near(blendChannel(mode, b, s), want, 1e-12, `${mode}(${b}, ${s})`);
});

Deno.test("blend: soft light with a 0.5 top and normal at alpha 0 leave the base unchanged", () => {
  for (let b = 0; b <= 1; b += 0.125) {
    near(blendChannel("softLight", b, 0.5), b, 1e-12, "soft light identity");
    for (const mode of BLEND_MODES) near(compositeChannel(mode, b, 0.9, 0), b, 1e-12, `${mode} alpha 0`);
  }
  near(compositeChannel("normal", 0.2, 0.6, 0.5), 0.4, 1e-12, "alpha 0.5 is the midpoint");
  near(compositeChannel("normal", 0.2, 0.6, 1), 0.6, 1e-12, "alpha 1 is the top");
});

Deno.test("blend: every mode stays inside 0..1 for inputs inside 0..1", () => {
  for (const mode of BLEND_MODES) {
    for (let b = 0; b <= 1; b += 0.05) for (let s = 0; s <= 1; s += 0.05) {
      const v = blendChannel(mode, b, s);
      assert(v >= -1e-12 && v <= 1 + 1e-12, `${mode}(${b}, ${s}) = ${v}`);
    }
  }
});

Deno.test("colour: sRGB transfer matches IEC 61966-2-1 and three.js", () => {
  near(srgbToLinear(0.5), 0.21404114048223255, 1e-12, "sRGB 0.5");
  near(srgbToLinear(0.04045), 0.04045 / 12.92, 1e-12, "linear toe");
  for (let c = 0; c <= 1; c += 0.01) near(linearToSrgb(srgbToLinear(c)), c, 1e-9, "round trip");
  for (const hex of ["#e0a884", "#88b060", "#172128", "#808080"]) {
    const ours = hexToLinear(hex), three = new THREE.Color(hex); // ColorManagement converts sRGB hex -> linear
    near(ours[0], three.r, 1e-6, `${hex} r`); near(ours[1], three.g, 1e-6, `${hex} g`); near(ours[2], three.b, 1e-6, `${hex} b`);
  }
});

Deno.test("colour: hex, HSL, luminance and contrast helpers", () => {
  const rgb = hexToRgb("#ff8000");
  near(rgb[0], 1); near(rgb[1], 128 / 255); near(rgb[2], 0);
  assert(rgbToHex(1, 128 / 255, 0) === "#ff8000", "hex round trip");
  for (const hex of ["#e0a884", "#88b060", "#b8a8c8", "#172128"]) {
    const c = hexToHsl(hex);
    assert(hslToHex(c.h, c.s, c.l) === hex, `HSL round trip ${hex}`);
  }
  near(relativeLuminance(1, 1, 1), 1, 1e-12, "white Y = 1");
  near(contrastRatio(1, 0), 21, 1e-12, "WCAG black/white = 21:1");
  const shade = measureHex(shadeHex("#e0a884", 0.5)), base = measureHex("#e0a884");
  near(shade.chroma, base.chroma * 0.5, 0.005, "shade scales chroma by k");
  const tint = measureHex(tintHex("#e0a884", 0.5));
  near(tint.chroma, base.chroma * 0.5, 0.005, "tint scales chroma by 1 - k");
});

Deno.test("relevance: boundColour pulls neon and blown-out colours inside a box, keeps the hue", () => {
  for (const hex of ["#00ff00", "#ff00ff", "#ffffff", "#000000", "#9b72cf", "#ef7455"]) {
    const out = boundColour(hex, INK_BOUNDS);
    assert(insideBounds(out, INK_BOUNDS), `${hex} -> ${out} inside INK_BOUNDS ${JSON.stringify(measureHex(out))}`);
  }
  const neon = hexToHsl("#00ff00"), tamed = hexToHsl(boundColour("#00ff00", SKIN_BOUNDS));
  near(tamed.h, neon.h, 0.01, "hue kept");
  assert(boundColour("#b8a088", SKIN_BOUNDS) === "#b8a088", "a colour already inside is untouched");
  const forge = measureHex(boundColour("#c88858", SKIN_BOUNDS)); // the forge-dwarf tint, C 0.44
  assert(forge.chroma <= SKIN_BOUNDS.chroma[1] + 0.004, `chroma capped, got ${forge.chroma}`);
});
