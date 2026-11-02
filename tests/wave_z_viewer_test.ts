// Wave Z lane G — the viewer and the portrait (SPEC Z40-Z49): pure parts only. The browser half (shadow on the plinth,
// floor visible, light direction, face luminance, frame/portrait time) is tools/probe-wave-z-viewer.ts.
// @deno-types="@types/three"
import * as THREE from "three";
import {
  buildFloor, buildPedestal, buildPreviewRig, CONTACT_SHADOW, faceFillDir, FLOOR_FADE, FLOOR_RADIUS, floorStonePixels, PEDESTAL_FRAME_PER_RADIUS,
  PEDESTAL_HEIGHT, PEDESTAL_RADIUS, pedestalStonePixels, PREVIEW_FACE_FILL, PREVIEW_KEY_DIR, previewFraming, previewLightVector, PreviewStage,
  SHADOW_HALF, shadowFrame,
} from "../src/graphics/PreviewScene.ts";
import { PORTRAIT_ASPECT, PORTRAIT_FRAME, portraitCamera, portraitFraming, portraitPixelSize, PortraitStudio, type PortraitRenderer } from "../src/graphics/PortraitStudio.ts";
import { celLighting, CEL_LIGHT_GLSL } from "../src/graphics/shaders/CelShader.ts";
import { PRESETS } from "../src/game/Characters.ts";

function assert(c: unknown, msg: string): asserts c {
  if (!c) throw new Error(msg);
}
const deg = (r: number) => (r * 180) / Math.PI;

Deno.test("SPEC Z40: the key light is from (almost) straight above with a slight FRONT bias", () => {
  const [x, y, z] = previewLightVector();
  const elev = deg(Math.asin(y));
  console.log(`key ${PREVIEW_KEY_DIR.join(", ")} -> elevation ${elev.toFixed(1)} deg, front ${z.toFixed(3)}, side ${x.toFixed(3)}`);
  assert(Math.abs(Math.hypot(x, y, z) - 1) < 1e-12, "unit vector");
  assert(elev >= 80 && elev < 88, `elevation ${elev} in [80, 88) — near-vertical, not the zenith (faces need a front bias)`);
  assert(z > 0 && z > Math.abs(x) * 2, "the horizontal part points to the FRONT (the camera's default side), not sideways");
});

Deno.test("SPEC Z41: the face fill is low, warm, from the viewer's side, and OFF (black) everywhere else", () => {
  for (const [cx, cz] of [[0, 4], [3, 3], [-4, 0.5]]) {
    const d = faceFillDir(cx, cz), e = deg(Math.asin(d[1]));
    assert(Math.abs(Math.hypot(...d) - 1) < 1e-9, "unit");
    assert(Math.abs(e - PREVIEW_FACE_FILL.elevationDeg) < 1e-9 && e < 20, `fill elevation ${e}`);
    assert(d[0] * cx + d[2] * cz > 0, "toward the camera's side");
  }
  const [r, g, b] = PREVIEW_FACE_FILL.colour;
  assert(r > g && g > b, "warm");
  assert(r < 0.6, "a fill, weaker than the key");
  // The arena never sets it: the shared default adds exactly 0.
  const c = celLighting.uFillColor.value as THREE.Color;
  assert(c.r === 0 && c.g === 0 && c.b === 0, "default fill colour is black (arena look unchanged)");
  assert(/base \* uFillColor \* fillN/.test(CEL_LIGHT_GLSL), "celShade adds the fill term");
});

Deno.test("SPEC Z42: the shadow camera covers the whole pedestal and every framed model, and looks along the key", () => {
  const f = shadowFrame();
  const cam = new THREE.OrthographicCamera(-f.half, f.half, f.half, -f.half, f.near, f.far);
  cam.position.set(...f.position);
  cam.lookAt(...f.target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const look = new THREE.Vector3();
  cam.getWorldDirection(look);
  const L = new THREE.Vector3(...previewLightVector());
  assert(look.dot(L) < -0.9999, "the shadow camera looks down the key light");
  const inside = (p: THREE.Vector3) => { const v = p.clone().project(cam); return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z >= -1 && v.z <= 1; };
  const top = PEDESTAL_FRAME_PER_RADIUS * PEDESTAL_RADIUS;
  let n = 0;
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    // The whole plinth (top rim, footing rim, its floor shadow ring) and a 0.5 m-radius column up to the frame top.
    for (const [r, y] of [[PEDESTAL_RADIUS, 0], [PEDESTAL_RADIUS * 1.14, -PEDESTAL_HEIGHT], [0.5, top], [0.5, top / 2], [0.9, -PEDESTAL_HEIGHT]]) {
      assert(inside(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a))), `(${r}, ${y}) at ${a.toFixed(2)} rad outside the shadow map`);
      n++;
    }
  }
  // Texel size on the plinth: fine enough for a crisp foot contact.
  const texelMm = (2 * SHADOW_HALF / 1024) * 1000;
  console.log(`shadow frame half ${f.half} m, ${n} probe points inside, texel ${texelMm.toFixed(1)} mm`);
  assert(texelMm < 4, "texel < 4 mm");
});

Deno.test("SPEC Z43: the constant framing rule still holds (distance from PEDESTAL_RADIUS, not from the model)", () => {
  const ref = previewFraming(1.35);
  for (const h of [1.35, 1.8, 2.2, PEDESTAL_FRAME_PER_RADIUS * PEDESTAL_RADIUS]) assert(previewFraming(h).distance === ref.distance, `height ${h}`);
  // F's 3:4 plate: aspect 0.75 keeps the same distance (the narrow-canvas rule only starts below ~0.52).
  assert(previewFraming(1.8, 0.75).distance === ref.distance, "3:4 canvas, same distance");
  // Portrait: the same rule — every model under the frame top gets the SAME camera.
  const p0 = portraitFraming(1.35), p1 = portraitFraming(2.2);
  assert(p0.distance === p1.distance && p0.cameraY === p1.cameraY && !p0.clipped, "portrait distance constant under the frame top");
  const giant = portraitFraming(3);
  assert(giant.clipped && giant.distance > p0.distance, "a giant above the frame top is framed by its own top (no crop)");
});

Deno.test("SPEC Z44: portrait composition — frame top at 10 %, soles at 70 %, plinth inside the width (3:4)", () => {
  const rig = new THREE.Group();
  rig.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.3).translate(0, 0.9, 0)));
  const cam = portraitCamera(rig, PORTRAIT_ASPECT);
  const y = (p: THREE.Vector3) => (1 - (p.clone().project(cam).y * 0.5 + 0.5)) * 100; // % from the top
  const top = PEDESTAL_FRAME_PER_RADIUS * PEDESTAL_RADIUS;
  const yTop = y(new THREE.Vector3(0, top, 0)), ySole = y(new THREE.Vector3(0, 0, 0)), yHead = y(new THREE.Vector3(0, 1.8, 0));
  console.log(`portrait: frame top ${yTop.toFixed(2)} %, 1.8 m head ${yHead.toFixed(1)} %, soles ${ySole.toFixed(2)} %`);
  assert(Math.abs(yTop - PORTRAIT_FRAME.topFrac * 100) < 0.01 && Math.abs(ySole - PORTRAIT_FRAME.soleFrac * 100) < 0.01, "solved exactly");
  const yOrk = y(new THREE.Vector3(0, 2.2, 0));
  assert(yHead > 18 && yOrk > 16, `the LV badge band stays free above a 1.8 m head (${yHead.toFixed(1)} %) and a 2.2 m ork (${yOrk.toFixed(1)} %)`);
  assert(ySole <= 70.001, "the soles sit above the bottom 30 % (name/tags band)");
  // The plinth's full width fits inside the image at the axis depth.
  for (const s of [-1, 1]) {
    const v = new THREE.Vector3(s * PEDESTAL_RADIUS * 1.14, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), PORTRAIT_FRAME.yaw).project(cam);
    assert(Math.abs(v.x) < 0.8, `plinth edge at ndc x ${v.x.toFixed(2)}`);
  }
});

Deno.test("SPEC Z45: portrait pixel size is 3:4 and DPR-aware; old explicit size options stay square", () => {
  const a = portraitPixelSize(1), b = portraitPixelSize(2), c = portraitPixelSize(3), d = portraitPixelSize(NaN);
  console.log(`DPR 1 ${a.width}x${a.height}, DPR 2 ${b.width}x${b.height}, DPR 3 ${c.width}x${c.height}`);
  for (const s of [a, b, c, d]) assert(Math.abs(s.width / s.height - 0.75) < 0.01, "3:4");
  assert(b.width === 2 * a.width && c.width === b.width && d.width === a.width, "DPR scales, capped at 2, NaN -> 1");
  const sizes: [number, number][] = [];
  const fake = (): PortraitRenderer => ({ setSize(w: number, h: number) { sizes.push([w, h]); }, setPixelRatio() {}, setClearColor() {}, render() {}, domElement: { toDataURL: (t?: string) => `data:${t ?? "image/png"};base64,AA` }, dispose() {} });
  const square = new PortraitStudio({ size: 256, createRenderer: fake });
  square.portraitOf(PRESETS[0]);
  assert(sizes.at(-1)![0] === 256 && sizes.at(-1)![1] === 256, `explicit size stays square (${sizes.at(-1)})`);
  const card = new PortraitStudio({ createRenderer: fake });
  const url = card.portraitOf(PRESETS[0]);
  const last = sizes.at(-1)!;
  assert(Math.abs(last[0] / last[1] - 0.75) < 0.01 && last[0] >= 480, `default is the 3:4 card picture (${last})`);
  assert(url.startsWith("data:image/jpeg"), "opaque card picture as JPEG");
  const rect = new PortraitStudio({ width: 300, createRenderer: fake });
  rect.portraitOf(PRESETS[1]);
  assert(sizes.at(-1)![0] === 300 && sizes.at(-1)![1] === 400, "width alone follows 3:4");
});

Deno.test("SPEC Z46: the stone — deterministic textures, height in alpha, tileable floor, plinth worn lip at radius R", () => {
  const t1 = pedestalStonePixels(64), t2 = pedestalStonePixels(64);
  assert(t1.every((v, i) => v === t2[i]), "plinth texture deterministic");
  const f = floorStonePixels(64), f2 = floorStonePixels(64);
  assert(f.every((v, i) => v === f2[i]), "floor texture deterministic");
  let aMin = 255, aMax = 0, g = 0;
  for (let i = 0; i < f.length; i += 4) { aMin = Math.min(aMin, f[i + 3]); aMax = Math.max(aMax, f[i + 3]); g += f[i + 1]; }
  const mean = g / (f.length / 4) / 255;
  console.log(`floor height alpha ${aMin}..${aMax}, mean green ${mean.toFixed(3)}`);
  assert(aMax - aMin > 120, "the floor's alpha carries a real height range (slabs vs mortar)");
  assert(mean > 0.12 && mean < 0.45, "the floor is mid-dark");
  // Tileable: across the wrap the texture continues like across any INNER slab-cell boundary (n = 160: 5 cells of
  // 32 px, so the seam 159|0 and the inner pairs 31|32, 63|64 ... sit at the same phase of the jittered Voronoi lattice,
  // where joints cluster). The seam's step must fall inside the inner boundaries' range.
  const n = 160, big = floorStonePixels(n), at = (x: number, y: number) => big[((y * n) + x) * 4 + 3];
  const col = (a: number) => { let s = 0; for (let k = 0; k < n; k++) s += Math.abs(at(a, k) - at((a + n - 1) % n, k)); return s; };
  const row = (a: number) => { let s = 0; for (let k = 0; k < n; k++) s += Math.abs(at(k, a) - at(k, (a + n - 1) % n)); return s; };
  const innerX = [32, 64, 96, 128].map(col), innerY = [32, 64, 96, 128].map(row);
  console.log(`height steps: x seam ${col(0)} vs inner ${innerX.join("/")}; y seam ${row(0)} vs inner ${innerY.join("/")}`);
  assert(col(0) <= 1.25 * Math.max(...innerX) && row(0) <= 1.25 * Math.max(...innerY), "the floor texture tiles without a seam");
  const ped = buildPedestal();
  const plinth = ped.getObjectByName("pedestal-plinth") as THREE.Mesh;
  plinth.geometry.computeBoundingBox();
  const bb = plinth.geometry.boundingBox!;
  assert(Math.abs(bb.max.y) < 1e-6 && Math.abs(bb.max.x - PEDESTAL_RADIUS * 1.02) < 0.01, `plinth top at y 0, outer ${bb.max.x}`);
  assert(ped.getObjectByName("pedestal-top") && CONTACT_SHADOW.strength > 0, "walking disc with the contact shadow");
  const floor = buildFloor();
  assert(floor.position.y === -PEDESTAL_HEIGHT && FLOOR_FADE[1] < FLOOR_RADIUS && FLOOR_FADE[0] > PEDESTAL_RADIUS * 1.14, "floor under the footing, fades out before its edge");
});

Deno.test("SPEC Z47: the stage restores the shared cel uniforms after a draw (the arena's sun is untouched)", () => {
  const stage = new PreviewStage();
  const before = { dir: celLighting.lightDirection.value, fill: celLighting.uFillColor.value, on: celLighting.uShadowOn.value, map: celLighting.uShadowMap.value };
  let seen: { dirY: number; fillR: number } | null = null;
  const scene = new THREE.Scene();
  scene.add(stage.group);
  stage.draw({ render: () => { seen = { dirY: (celLighting.lightDirection.value as THREE.Vector3).y, fillR: (celLighting.uFillColor.value as THREE.Color).r }; } }, scene, new THREE.PerspectiveCamera());
  assert(seen !== null && (seen as { dirY: number }).dirY > 0.98 && (seen as { fillR: number }).fillR > 0, "during the draw: overhead key + face fill");
  assert(celLighting.lightDirection.value === before.dir && celLighting.uFillColor.value === before.fill && celLighting.uShadowOn.value === before.on && celLighting.uShadowMap.value === before.map, "restored by reference");
  // A painted background is hidden for the depth pass only (it would be read back as blockers) and restored.
  const bgTex = new THREE.Texture();
  scene.background = bgTex;
  const seenBg: unknown[] = [];
  stage.draw({ render: (s) => { seenBg.push(s.background); }, setRenderTarget() {}, setClearColor() {}, getClearColor: (c) => c, getClearAlpha: () => 1, clear() {} }, scene, new THREE.PerspectiveCamera());
  assert(seenBg.length === 2 && seenBg[0] === null && seenBg[1] === bgTex && scene.background === bgTex, "depth pass without the background, main pass with it");
  // A throwing draw still restores.
  try { stage.draw({ render: () => { throw new Error("boom"); } }, scene, new THREE.PerspectiveCamera()); } catch { /* expected */ }
  assert(celLighting.lightDirection.value === before.dir && celLighting.uFillColor.value === before.fill, "restored after a throw");
  stage.dispose();
});

Deno.test("SPEC Z48: the portrait frames the REAL rig on the plinth (every race), head below the badge band", () => {
  for (const race of ["human", "elf", "dwarf", "ork"]) {
    const { rig, fighter } = buildPreviewRig({ ...PRESETS[0], name: `Z48 ${race}`, race, subrace: null });
    fighter.skeleton.update(0);
    rig.update(fighter.skeleton, 0); // the studio's own settle before the shot
    rig.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig.group);
    const cam = portraitCamera(rig.group);
    // The crown: the head bone (skull base) + 0.25 m; the model's box top can be a carried blade's tip.
    const crown = rig.bones.get("head" as never)!.getWorldPosition(new THREE.Vector3()).y + 0.25;
    const pct = (yy: number) => (1 - (new THREE.Vector3(0, yy, 0).project(cam).y * 0.5 + 0.5)) * 100;
    console.log(`${race}: crown ${crown.toFixed(2)} m at ${pct(crown).toFixed(1)} %, model top ${box.max.y.toFixed(2)} m at ${pct(box.max.y).toFixed(1)} %`);
    assert(pct(crown) > 16 && pct(crown) < 45, `${race}: crown at ${pct(crown).toFixed(1)} %`);
    assert(pct(box.max.y) >= PORTRAIT_FRAME.topFrac * 100 - 1e-6, `${race}: nothing above the frame top`);
    assert(Math.abs(box.min.y) < 0.05, `${race}: soles on the plinth top (min y ${box.min.y.toFixed(3)})`);
  }
});

Deno.test("SPEC Z49: a foot reserve (lane F's floating band) keeps the plinth above the band, one distance for every race", () => {
  // reserve 0 is the wave-X framing exactly.
  assert(previewFraming(1.8, 0.75, 38, PEDESTAL_RADIUS, 0).distance === previewFraming(1.8, 0.75).distance, "default unchanged");
  const t = Math.tan((19 * Math.PI) / 180), top = PEDESTAL_FRAME_PER_RADIUS * PEDESTAL_RADIUS;
  for (const reserve of [0.15, 0.25, 0.3]) {
    const f = previewFraming(1.35, 0.75, 38, PEDESTAL_RADIUS, reserve);
    assert(previewFraming(2.2, 0.75, 38, PEDESTAL_RADIUS, reserve).distance === f.distance, "same distance for every model under the frame top");
    // Straight-on frame: fraction from the top of a height y = (yTop - y) / span, span = 2 d tan(fov/2).
    const span = 2 * f.distance * t, yTopFrame = f.targetY + span / 2;
    const plinthBottom = (yTopFrame + PEDESTAL_HEIGHT) / span;
    assert(Math.abs(yTopFrame - top) < 1e-9, "the frame top stays the tallest model's");
    assert(plinthBottom <= 1 - reserve + 0.05, `reserve ${reserve}: plinth bottom at ${(plinthBottom * 100).toFixed(1)} % (band starts at ${((1 - reserve) * 100).toFixed(0)} %)`);
  }
  assert(previewFraming(1.8, 0.75, 38, PEDESTAL_RADIUS, 9).distance === previewFraming(1.8, 0.75, 38, PEDESTAL_RADIUS, 0.4).distance, "clamped to 0.4");
});
