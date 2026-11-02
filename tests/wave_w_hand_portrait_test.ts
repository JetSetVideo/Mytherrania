// Wave W lane H — the hero portrait / creator preview background fits the medieval UI (not the old cold
// blue-grey #172128).
// @deno-types="@types/three"
import * as THREE from "three";
import { backdropColour, backdropPixels, readsBlue, UI_WALNUT, UI_WALNUT_DEEP } from "../src/graphics/PortraitBackdrop.ts";
import { BACKDROP_TEXELS, backdropTexture, PORTRAIT_CLEAR, PortraitStudio, type PortraitRenderer } from "../src/graphics/PortraitStudio.ts";
import { PRESETS } from "../src/game/Characters.ts";

function assert(ok: unknown, msg = "assertion failed"): asserts ok { if (!ok) throw new Error(msg); }
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

Deno.test("portrait backdrop: warm walnut corners, never blue (the old clear colour was)", () => {
  assert(readsBlue(hex("#172128")), "control: the old portrait clear colour #172128 reads blue (B 40 > R 23)");
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0, 0.5]]) {
    const c = backdropColour(u, v);
    assert(!readsBlue(c), `(${u},${v}) reads blue: ${c}`);
    assert(c[0] > c[2] && c[1] > c[2], `(${u},${v}) is not warm: ${c}`);
    // Corners are the UI's deep walnut within a few levels.
    if ((u === 0 || u === 1) && (v === 0 || v === 1)) {
      const w = hex(UI_WALNUT_DEEP);
      assert(c.every((x, i) => Math.abs(x - w[i]) <= 6), `corner ${c} vs ${w}`);
    }
  }
  // The centre is lighter than the corners (a vignette) and stays a dark warm leather.
  const mid = backdropColour(0.5, 0.45), corner = backdropColour(0, 0);
  assert(mid[0] > corner[0] + 15 && mid[0] < 110, `centre ${mid}`);
  const px = backdropPixels(8, 8);
  assert(px.length === 8 * 8 * 4 && px[3] === 255, "opaque RGBA");
  console.log(`backdrop: corner ${corner} centre ${mid} (walnut ${hex(UI_WALNUT)}, deep ${hex(UI_WALNUT_DEEP)}); old clear ${hex("#172128")}`);
});

Deno.test("portrait studio: clears to the walnut and draws the vignette behind the figure", () => {
  let clear = "";
  let background: unknown = null;
  const fake: PortraitRenderer = {
    setSize() {}, setPixelRatio() {}, setClearColor(c: string | number) { clear = String(c); },
    render(scene: THREE.Scene) { background = scene.background; },
    domElement: { toDataURL: () => "data:image/png;base64,AAAA" }, dispose() {},
  };
  const studio = new PortraitStudio({ createRenderer: () => fake });
  const url = studio.portraitOf(PRESETS[0]);
  assert(url.startsWith("data:image/png"), "a portrait was rendered");
  assert(clear === PORTRAIT_CLEAR && !readsBlue(hex(clear)), `clear colour ${clear}`);
  assert(background instanceof THREE.DataTexture, "the scene background is the backdrop texture");
  const tex = background as THREE.DataTexture, d = tex.image.data as Uint8Array, n = BACKDROP_TEXELS;
  // GL rows run bottom-up: texel row 0 is the image's bottom row.
  const top = backdropPixels(n, n);
  for (const [x, yTop] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]]) {
    const gl = ((n - 1 - yTop) * n + x) * 4, im = (yTop * n + x) * 4;
    assert(d[gl] === top[im] && d[gl + 1] === top[im + 1] && d[gl + 2] === top[im + 2], `texel (${x},${yTop}) flipped wrong`);
    assert(!readsBlue([d[gl], d[gl + 1], d[gl + 2]]), "corner texel reads blue");
  }
  assert(tex.colorSpace === THREE.SRGBColorSpace && backdropTexture(4).image.width === 4, "sRGB texture of the asked size");
  studio.dispose();
});

