// Wave TEX (lane R): bench + identity + channel-view pictures for the material channels (C-REND).
//
//   deno run -A tools/bench-wave-tex.ts [--src <tree>] [--out <dir>] [--frames 90] [--no-pictures]
//
// Generates a QA page (TypeScript importing <src>/src through relative paths), bundles it with `deno bundle`,
// and drives it in headless Chrome (ANGLE/Metal). It feature-detects the wave-TEX modules, so the SAME tool runs on
// a `git archive HEAD` scratch for the "before" column:
//   build    buildPreviewRig ms, cold (new body) and warm (body cache hit = the rig assembly R's wiring adds to)
//   frame    1280x800 preview (one rig) and 1280x800 arena (two rigs), PreviewStage.draw (shadow pass + main),
//            median of N frames, each synchronised with a 1-px readPixels (wall time incl. the GPU)
//   modes    legacy  = the skin surface swapped to the pre-TEX material (no USE_WAVE_TEX) — in-page "before"
//            neutral = the default build (neutral channels)
//            marks16 = 16 decals (worst case: every kind, relief on, glyphs) on the visible front
//   identity neutral vs legacy on 4 races x 2 sexes x 3 yaws: changed pixels (must be 0)
//   memory   GPU bytes of the skin geometry attributes + textures (glyph atlas) + the decal uniform block
// Pictures: artifacts/wave-tex/render/<run>/views-<race>-<sex>.png — every channel view of the marks16 body
// (front + back) with a burned-in info strip.
// deno-lint-ignore-file no-explicit-any
import { chromium } from "playwright";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = Deno.args;
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k: string) => args.includes(`--${k}`);
const src = (opt("src") ?? REPO).replace(/\/$/, "");
const runName = opt("run") ?? (src === REPO ? "work" : "src-" + src.split("/").pop());
const outDir = opt("out") ?? `${REPO}/artifacts/wave-tex/render/${runName}`;
const FRAMES = Number(opt("frames") ?? 90);
const exists = (p: string) => { try { Deno.statSync(p); return true; } catch { return false; } };

function pageSource(R: string, hasTex: boolean, hasWiring: boolean): string {
  return `
// @ts-nocheck generated QA page (tools/bench-wave-tex.ts)
import * as THREE from "three";
import { buildPreviewRig, PreviewStage } from "${R}/src/graphics/PreviewScene.ts";
import { createCelSkinnedSurfaceMaterial } from "${R}/src/graphics/shaders/CelSkinned.ts";
${hasTex ? `import * as MR from "${R}/src/graphics/shaders/MaterialRender.ts";
import * as MC from "${R}/src/graphics/shaders/MaterialChannels.ts";
import { REGIONS } from "${R}/src/graphics/body/contracts.ts";` : "const MR = null, MC = null, REGIONS = [];"}
${hasWiring ? `import { TEX_DEFAULTS } from "${R}/src/graphics/shaders/TexWiring.ts";` : "const TEX_DEFAULTS = null;"}

const W = 1280, H = 800;
const canvas = document.getElementById("c");
canvas.width = W; canvas.height = H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(new THREE.Color(0.15, 0.16, 0.19), 1);
const gl = renderer.getContext();
const stage = new PreviewStage();
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
let scene = new THREE.Scene();
let rigs = [];
const BASE = { male: { h: 1.75, w: 72 }, female: { h: 1.65, w: 60 } };
const HM = { human: 1, elf: 1.06, dwarf: 0.78, ork: 1.08 };
// A mark set on BARE skin of a Warrior (QD Z-36/37: face anchors inside the face frame, nothing under the tunic).
const MARKED = {
  scars: [
    { kind: "laceration", region: "foreArm", side: 0, anchor: [0.15, 0.1], lengthMm: 70, widthMm: 4, angle: null, ageDays: 400, keloid: null, seed: 11 },
    { kind: "claw", region: "upperArm", side: 1, anchor: [0.2, 0.2], lengthMm: 90, widthMm: 4, angle: null, ageDays: 30, keloid: null, seed: 12 },
    { kind: "incision", region: "face", side: 0, anchor: [0.18, -0.4], lengthMm: 30, widthMm: 2, angle: null, ageDays: 3000, keloid: null, seed: 13 },
    { kind: "stitched", region: "thigh", side: 1, anchor: [0.0, -0.5], lengthMm: 60, widthMm: 3, angle: null, ageDays: 60, keloid: null, seed: 14 },
  ],
  tattoos: [
    { style: "band", motif: "serpent", region: "foreArm", side: 1, anchor: [0, -0.35], sizeMm: 30, angle: null, inks: ["blueBlack"], ageYears: 4, seed: 21 },
    { style: "tribal", motif: "sun", region: "upperArm", side: 0, anchor: [-0.1, 0.1], sizeMm: 70, angle: null, inks: ["black"], ageYears: 8, seed: 22 },
    { style: "dotwork", motif: "eye", region: "face", side: 0, anchor: [0, 0.45], sizeMm: 14, angle: null, inks: ["woad"], ageYears: 1, seed: 23, facial: true },
    { style: "runic", motif: "bolt", region: "shin", side: 0, anchor: [0, 0.2], sizeMm: 40, angle: null, inks: ["red"], ageYears: 2, seed: 24 },
  ],
};
function profile(race, sex, name, marks) {
  return { name, race, subrace: null, className: "Warrior", palette: "ember", birthsign: null, level: 1, allocated: {},
    appearance: { body: "#4f8490", accent: "#dfaa55", height: +(BASE[sex].h * (HM[race] ?? 1)).toFixed(3), weight: BASE[sex].w, eyes: "#2f6fb5", sex, ...(marks ? { marks } : {}) } };
}
const legacyMats = new Map();
function setMode(rig, mode) {
  const skin = rig.skin;
  if (!skin.userData.wtNeutral) skin.userData.wtNeutral = skin.material;
  if (mode === "legacy") {
    let m = legacyMats.get(rig);
    if (!m) {
      const src = skin.userData.wtNeutral;
      m = createCelSkinnedSurfaceMaterial("#ffffff", { vertexColors: src.vertexColors, detail: true });
      m.uniforms.uAbs.value.copy(src.uniforms.uAbs.value);
      m.uniforms.uDetailGain.value.copy(src.uniforms.uDetailGain.value);
      legacyMats.set(rig, m);
    }
    skin.material = m;
    return;
  }
  skin.material = skin.userData.wtNeutral;
  if (!MR || mode === "asBuilt") return;
  if (rig.material) rig.material.setDecals(mode === "marks16" ? demoDecals(rig) : []);
  else MR.setDecals(skin, mode === "marks16" ? demoDecals(rig) : []);
}
// 16 decals on the bind skin: every kind, relief on, two wrapped (band + forearm glyph), mostly on the front.
function demoDecals(rig) {
  const g = rig.skin.geometry, P = g.getAttribute("position"), N = g.getAttribute("normal"), reg = g.userData.region;
  let ymin = 1e9, ymax = -1e9;
  for (let i = 0; i < P.count; i++) { ymin = Math.min(ymin, P.getY(i)); ymax = Math.max(ymax, P.getY(i)); }
  const Hb = ymax - ymin;
  function anchor(region, yf, side, dir) {
    let best = -1, score = -1e9;
    const ri = REGIONS.indexOf(region);
    for (let i = 0; i < P.count; i++) {
      if (ri >= 0 && reg && reg[i] !== ri) continue;
      if (side && Math.sign(P.getX(i)) !== side) continue;
      const n = [N.getX(i), N.getY(i), N.getZ(i)];
      const s = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] - 6 * Math.abs((P.getY(i) - ymin) / Hb - yf);
      if (s > score) { score = s; best = i; }
    }
    return { c: [P.getX(best), P.getY(best), P.getZ(best)], n: [N.getX(best), N.getY(best), N.getZ(best)] };
  }
  const up = [0, 1, 0], side = [1, 0, 0];
  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const d = [];
  const add = (a, o) => d.push({ center: a.c, normal: a.n, tangent: o.tangent ?? up, ...o });
  // scars
  add(anchor("torso", 0.66, 1, [0.3, 0, 1]), { kind: "line", halfLength: 0.07, halfWidth: 0.0035, blur: 0.0008, albedo: lin("#c98a86"), albedoOpacity: 0.8, roughness: 0.2, roughnessOpacity: 1, height: 0.0018, seed: 0.37, tangent: [0.8, -0.6, 0] });
  add(anchor("torso", 0.58, -1, [-0.3, 0, 1]), { kind: "stitched", halfLength: 0.06, halfWidth: 0.0015, blur: 0.0004, albedo: lin("#b5726f"), albedoOpacity: 0.85, roughness: 0.25, roughnessOpacity: 1, height: 0.0012, spacing: 0.012, tangent: up });
  add(anchor("torso", 0.62, -1, [-0.4, 0, -1]), { kind: "line", count: 4, spacing: 0.018, halfLength: 0.08, halfWidth: 0.0025, blur: 0.0006, albedo: lin("#a85f5a"), albedoOpacity: 0.85, roughness: 0.2, roughnessOpacity: 1, height: 0.0015, seed: 0.6, tangent: [0.5, -0.85, 0] });
  add(anchor("pelvis", 0.5, 1, [0.3, 0, 1]), { kind: "disc", halfLength: 0.012, halfWidth: 0.01, blur: 0.001, albedo: lin("#d9a7a0"), albedoOpacity: 0.7, roughness: 0.3, roughnessOpacity: 1, height: -0.0012 });
  add(anchor("thigh", 0.4, 1, [0, 0, 1]), { kind: "disc", halfLength: 0.035, halfWidth: 0.025, blur: 0.003, albedo: lin("#e2b9b0"), albedoOpacity: 0.75, roughness: 0.15, roughnessOpacity: 1, height: 0.001, seed: 0.81 });
  add(anchor("face", 0.93, 1, [0.3, 0, 1]), { kind: "line", halfLength: 0.018, halfWidth: 0.0012, blur: 0.0003, albedo: lin("#d8b0aa"), albedoOpacity: 0.85, roughness: 0.2, roughnessOpacity: 1, height: -0.0006, tangent: [0.2, -1, 0] });
  // tattoos
  add(anchor("torso", 0.7, -1, [-0.2, 0.2, 1]), { kind: "glyph", glyph: 7, halfLength: 0.045, halfWidth: 0.0022, blur: 0.0005, albedo: lin("#1f2a44"), albedoOpacity: 0.9, tangent: up });
  add(anchor("torso", 0.7, 1, [0, 0.2, -1]), { kind: "dots", glyph: 0, halfLength: 0.06, halfWidth: 0.0016, spacing: 0.006, blur: 0.0003, albedo: lin("#202124"), albedoOpacity: 0.9, tangent: up });
  add(anchor("upperArm", 0.72, 1, [1, 0, 0.3]), { kind: "glyph", glyph: 4, halfLength: 0.03, halfWidth: 0.0025, blur: 0.0008, albedo: lin("#7a2320"), albedoOpacity: 0.85, tangent: up, wrapRadius: 0.045 });
  add(anchor("foreArm", 0.55, -1, [-1, 0, 0.3]), { kind: "band", glyph: 1, halfLength: 0.018, halfWidth: 0.0018, blur: 0.0004, albedo: lin("#203a6a"), albedoOpacity: 0.9, tangent: up, wrapRadius: 0.035 });
  add(anchor("foreArm", 0.5, 1, [1, 0, 0.3]), { kind: "band", halfLength: 0.006, halfWidth: 0.001, albedo: lin("#202124"), albedoOpacity: 0.9, tangent: up, wrapRadius: 0.035 });
  add(anchor("torso", 0.75, 1, [0.5, 0.3, 0.8]), { kind: "glyph", glyph: 2, halfLength: 0.03, halfWidth: 0.002, blur: 0.0004, albedo: lin("#ff8a2a"), albedoOpacity: 0.9, emissive: 0.6, tangent: up });
  add(anchor("shin", 0.2, -1, [0, 0, 1]), { kind: "glyph", glyph: 9, halfLength: 0.03, halfWidth: 0.002, albedo: lin("#3a5a2a"), albedoOpacity: 0.85, tangent: up });
  add(anchor("thigh", 0.42, -1, [0, 0, 1]), { kind: "glyph", glyph: 10, halfLength: 0.04, halfWidth: 0.0022, albedo: lin("#1a1a1a"), albedoOpacity: 0.9, tangent: up });
  add(anchor("neck", 0.84, 1, [0.6, 0, 0.8]), { kind: "glyph", glyph: 6, halfLength: 0.015, halfWidth: 0.0012, albedo: lin("#20304a"), albedoOpacity: 0.9, tangent: up });
  add(anchor("torso", 0.68, 0, [0, 0, 1]), { kind: "line", halfLength: 0.03, halfWidth: 0.002, albedo: lin("#c98a86"), albedoOpacity: 0.6, roughness: 0.25, roughnessOpacity: 1, height: 0.0008, tangent: side });
  return d;
}
// The packed block back to FragmentDecal records (so a sheet can isolate one decal at a time).
function decodeDecals(rig) {
  const d = rig.skin.material.uniforms.uDecals.value, n = rig.material.packed.count, out = [];
  for (let i = 0; i < n; i++) {
    const o = i * MC.DECAL_VEC4 * 4, g = (k) => d[o + k];
    const kind = MC.DECAL_KINDS[Math.round(g(16))];
    const glyphKind = kind === "glyph" || kind === "dots" || kind === "band";
    const t = [g(4), g(5), g(6)], nn = [g(8), g(9), g(10)];
    const b = [nn[1] * t[2] - nn[2] * t[1], nn[2] * t[0] - nn[0] * t[2], nn[0] * t[1] - nn[1] * t[0]];
    out.push({ kind, kindCode: Math.round(g(16)), center: [g(0), g(1), g(2)], tangent: t, normal: nn, halfLength: g(7), halfWidth: g(11),
      albedo: [g(12), g(13), g(14)], albedoOpacity: g(15), glyph: glyphKind ? g(17) : undefined, count: glyphKind ? g(27) : g(17), blur: g(18), seed: g(19),
      roughness: g(20), roughnessOpacity: g(21), height: g(22), emissive: g(23), spacing: g(24), wrapRadius: g(25), wrapAxis: g(26) > 0.5 ? b : undefined });
  }
  return out;
}
function frameCam(objs, yawDeg, pad = 1.08) {
  const box = new THREE.Box3();
  for (const o of objs) box.expandByObject(o);
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.y / 2, (s.x / 2) / camera.aspect, (s.z / 2) / camera.aspect) * pad;
  const dist = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  camera.position.set(c.x + Math.sin(yaw) * dist, c.y + s.y * 0.05, c.z + Math.cos(yaw) * dist);
  camera.lookAt(c);
  camera.updateMatrixWorld(true);
}
function draw() { stage.draw(renderer, scene, camera); }
function readAll() { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; }
function sync() { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function frameMs(n) {
  for (let i = 0; i < 8; i++) { draw(); sync(); }
  const t = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); draw(); sync(); t.push(performance.now() - t0); }
  return { median: +median(t).toFixed(3), mean: +(t.reduce((a, b) => a + b, 0) / n).toFixed(3) };
}
function memBytes() {
  let geo = 0, tex = 0;
  const seenG = new Set(), seenT = new Set();
  for (const r of rigs) {
    const g = r.skin.geometry;
    if (seenG.has(g)) continue; seenG.add(g);
    for (const [name, a] of Object.entries(g.attributes)) geo += a.array.byteLength;
    if (g.index) geo += g.index.array.byteLength;
    const u = r.skin.material.uniforms;
    for (const k of Object.keys(u)) { const v = u[k].value; if (v && v.isDataTexture && !seenT.has(v)) { seenT.add(v); tex += v.image.data.byteLength; } }
  }
  const attr = (n) => rigs.reduce((s, r) => s + (r.skin.geometry.getAttribute(n)?.array.byteLength ?? 0), 0);
  return { geometry: geo, textures: tex, aMaterial: attr("aMaterial"), aEmissive: attr("aEmissive"), decalUniformBytes: MC ? rigs.length * MC.DECAL_FLOATS * 4 : 0 };
}
function setup(list) {
  scene = new THREE.Scene();
  scene.add(stage.group);
  rigs = [];
  const builds = [];
  list.forEach((p, i) => {
    const t0 = performance.now();
    const { rig, fighter } = buildPreviewRig(profile(p.race, p.sex, p.name, p.marks));
    builds.push(+(performance.now() - t0).toFixed(1));
    rig.update(fighter.skeleton, 0);
    rig.group.position.x = list.length > 1 ? (i - (list.length - 1) / 2) * 1.1 : 0;
    rig.group.rotation.y = list.length > 1 ? (i === 0 ? 0.5 : -0.5) : 0;
    rig.group.updateMatrixWorld(true);
    scene.add(rig.group);
    rigs.push(rig);
  });
  stage.group.visible = list.length === 1;
  return builds;
}
globalThis.__WTB__ = {
  hasTex: !!MR,
  defaults(o) { if (TEX_DEFAULTS) Object.assign(TEX_DEFAULTS, o); return TEX_DEFAULTS ? { ...TEX_DEFAULTS } : null; },
  build(race, sex, n) {
    // cold: a new body (cache miss); warm: the same profile again (body cache hit: rig assembly only)
    const cold = [], warm = [];
    for (let i = 0; i < n; i++) {
      const name = "bench " + race + " " + sex + " " + i + " " + Math.random().toString(36).slice(2, 6);
      let t0 = performance.now(); buildPreviewRig(profile(race, sex, name)); cold.push(performance.now() - t0);
      t0 = performance.now(); buildPreviewRig(profile(race, sex, name)); warm.push(performance.now() - t0);
    }
    return { cold: +median(cold).toFixed(1), warm: +median(warm).toFixed(1) };
  },
  frames(kind, modes, n) {
    // modes: legacy (pre-TEX material swapped in), neutral (no decal), marks16 (16 demo decals), asBuilt (as the wiring built it)
    const list = kind === "arena" ? [{ race: "human", sex: "male", name: "Bench Aldo" }, { race: "ork", sex: "female", name: "Bench Urza" }] : [{ race: "human", sex: "male", name: "Bench Aldo" }];
    setup(list);
    frameCam(rigs.map((r) => r.group), kind === "arena" ? 20 : 25, kind === "arena" ? 1.15 : 1.05);
    const out = {};
    for (const m of modes) { for (const r of rigs) setMode(r, m); out[m] = { ...frameMs(n), mem: memBytes() }; }
    for (const r of rigs) setMode(r, "neutral");
    return out;
  },
  // Raw renders of the DEFAULT build (no material swap: three sorts opaque draws by material.id, so swapping a
  // material in the page reorders equal-depth fragments — the identity is measured across builds instead).
  async shots(race, sex, yaws) {
    setup([{ race, sex, name: "Ident " + race + " " + sex }]);
    const out = [];
    for (const yaw of yaws) {
      frameCam([rigs[0].group], yaw);
      draw(); draw();
      const px = readAll();
      const gz = await new Response(new Blob([px]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
      let bin = "";
      const u8 = new Uint8Array(gz);
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      out.push({ yaw, gz: btoa(bin) });
    }
    return out;
  },
  // Close-ups (focus bone, metres of view height): every channel view, front + back, of one subject.
  closeup(race, sex, info, variant, focus, span) {
    setup([{ race, sex, name: "Views " + race + " " + sex, marks: variant === "marked" ? MARKED : undefined }]);
    const rig = rigs[0];
    if (variant === "demo16") setMode(rig, "marks16");
    const bone = rig.bones.get(focus);
    const c = new THREE.Vector3();
    bone.getWorldPosition(c);
    const views = MC.CHANNEL_VIEWS, TW = 360, TH = 360, LAB = 22, INFO = 48;
    const sheet = document.createElement("canvas");
    sheet.width = TW * views.length; sheet.height = (TH + LAB) * 2 + INFO;
    const ctx = sheet.getContext("2d");
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, sheet.width, sheet.height);
    const dist = (span / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    [0, 180].forEach((yaw, row) => {
      const y = THREE.MathUtils.degToRad(yaw);
      camera.position.set(c.x + Math.sin(y) * dist, c.y, c.z + Math.cos(y) * dist);
      camera.lookAt(c); camera.updateMatrixWorld(true);
      views.forEach((v, col) => {
        MR.setChannelView(rig, v); draw();
        ctx.drawImage(canvas, (W - H) / 2, 0, H, H, col * TW, row * (TH + LAB) + LAB, TW, TH);
        ctx.fillStyle = "#ddd"; ctx.font = "15px monospace";
        ctx.fillText(v + (row ? "  back" : "  front"), col * TW + 6, row * (TH + LAB) + 16);
      });
    });
    // High-frequency meter on the front final view: mean |luma Laplacian| over the body pixels, with the material
    // details on and off (uMatDetail amplitudes zeroed) — how much fine texture the details add.
    const hf = () => {
      const y0 = THREE.MathUtils.degToRad(0);
      camera.position.set(c.x + Math.sin(y0) * dist, c.y, c.z + Math.cos(y0) * dist);
      camera.lookAt(c); camera.updateMatrixWorld(true);
      MR.setChannelView(rig, "final"); draw();
      const a = readAll(), lum = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) lum[i] = 0.2126 * a[i * 4] + 0.7152 * a[i * 4 + 1] + 0.0722 * a[i * 4 + 2];
      let sum = 0, cnt = 0;
      for (let y = 1; y < H - 1; y++) for (let x = (W - H) / 2 + 1; x < (W + H) / 2 - 1; x++) {
        const i = y * W + x;
        const lap = Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - W] - lum[i + W]);
        if (lap < 60) { sum += lap; cnt++; } // skip ink outlines / silhouette edges
      }
      return +(sum / Math.max(1, cnt)).toFixed(3);
    };
    const det = rig.skin.material.uniforms.uMatDetail?.value;
    const hfOn = hf();
    let hfOff = hfOn;
    if (det) { const keep = det.slice(); for (let k = 2; k < det.length; k += 4) det[k] = 0; hfOff = hf(); det.set(keep); }
    MR.setChannelView(rig, "final");
    ctx.fillStyle = "#bbb"; ctx.font = "13px monospace";
    ctx.fillText("wave TEX lane R  " + info.commit + "  close-up " + focus + " span " + span + " m (" + (span * 1000 / H).toFixed(2) + " mm/px)  " + race + " " + sex + " Warrior  variant " + variant, 8, (TH + LAB) * 2 + 18);
    ctx.fillText("paint " + (rig.material.stack?.paint ?? "v1") + "  details " + (rig.material.stack?.details ?? []).join(" ") + "  decals " + rig.material.packed.count, 8, (TH + LAB) * 2 + 36);
    return { png: sheet.toDataURL("image/png"), hfOn, hfOff };
  },
  // Every channel view of the marks16 body, front + back, as one labelled sheet (PNG data URL).
  views(race, sex, info, variant) {
    setup([{ race, sex, name: "Views " + race + " " + sex, marks: variant === "marked" ? MARKED : undefined }]);
    const rig = rigs[0];
    if (variant === "demo16") setMode(rig, "marks16");
    const views = MC.CHANNEL_VIEWS;
    const TW = 360, TH = 560, LAB = 22, INFO = 64;
    const sheet = document.createElement("canvas");
    sheet.width = TW * views.length; sheet.height = (TH + LAB) * 2 + INFO;
    const ctx = sheet.getContext("2d");
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, sheet.width, sheet.height);
    const stats = [];
    [0, 180].forEach((yaw, row) => {
      frameCam([rig.group], yaw, 1.02);
      views.forEach((v, col) => {
        MR.setChannelView(rig, v);
        draw();
        // crop the central body region of the 1280x800 frame into the tile (aspect kept)
        const sh = H, sw = Math.round(sh * TW / TH), sx = Math.round((W - sw) / 2);
        ctx.drawImage(canvas, sx, 0, sw, sh, col * TW, row * (TH + LAB) + LAB, TW, TH);
        ctx.fillStyle = "#ddd"; ctx.font = "15px monospace";
        ctx.fillText(v + (row ? "  back" : "  front"), col * TW + 6, row * (TH + LAB) + 16);
      });
    });
    // Per decal: pixels its coverage reaches in the marks view (yaw 0/90/180/270), one decal at a time — 0 = hidden
    // (under a garment, or facing away from both cameras).
    const all = rig.material.packed.count ? decodeDecals(rig) : [];
    const perDecal = [];
    MR.setChannelView(rig, "marks");
    const grey = Math.round(255 * 0.82);
    for (let k = 0; k < all.length; k++) {
      rig.material.setDecals([all[k]]);
      let px = 0;
      for (const yaw of [0, 90, 180, 270]) {
        frameCam([rig.group], yaw, 1.02); draw();
        const a = readAll();
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - grey) > 6 || Math.abs(a[i + 1] - grey) > 6 || Math.abs(a[i + 2] - grey) > 6) px++;
      }
      perDecal.push({ k, kind: MC.DECAL_KINDS[all[k].kindCode], px });
    }
    // baseline: no decal at all (hands / face parts / weapon are not channel materials and draw normally)
    rig.material.setDecals([]);
    let base = 0;
    for (const yaw of [0, 90, 180, 270]) {
      frameCam([rig.group], yaw, 1.02); draw();
      const a = readAll();
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - grey) > 6 || Math.abs(a[i + 1] - grey) > 6 || Math.abs(a[i + 2] - grey) > 6) base++;
    }
    for (const d of perDecal) d.px -= base;
    rig.material.setDecals(all);
    MR.setChannelView(rig, "final");
    ctx.fillStyle = "#bbb"; ctx.font = "13px monospace";
    const lines = [
      "wave TEX lane R  " + info.commit + "  " + new Date().toISOString() + "  tools/bench-wave-tex.ts views",
      race + " " + sex + " Warrior  variant " + variant + "  paint " + (rig.material.stack?.paint ?? "v1") + "  marks " + (rig.material.stack?.marksSource ?? "-") + "  decals " + rig.material.packed.count + "/16 (dropped " + rig.material.packed.dropped.length + ")  light PreviewStage  fov 30  1280x800 crop",
      "views: final albedo roughness(grey=r) height(0.5 + h/8mm) normal(view, rgb) ao marks(decal colour x coverage; magenta = relief-only)",
    ];
    lines.forEach((l, i) => ctx.fillText(l, 8, (TH + LAB) * 2 + 18 + i * 17));
    return { png: sheet.toDataURL("image/png"), decals: rig.material.packed.count, perDecal, ids: rig.material.stack?.marks ?? null, stack: rig.material.stack ? { paint: rig.material.stack.paint, marksSource: rig.material.stack.marksSource, marks: rig.material.stack.marks, dropped: rig.material.stack.dropped, ms: rig.material.stack.ms } : null };
  },
};
`;
}

async function run(cmd: string[], cwd: string) {
  const p = await new Deno.Command(cmd[0], { args: cmd.slice(1), cwd, stdout: "piped", stderr: "piped" }).output();
  if (!p.success) throw new Error(new TextDecoder().decode(p.stderr));
}

// --compare <dirA> <dirB>: pixel identity of two --save runs (no browser).
if (opt("compare")) {
  const i = args.indexOf("--compare");
  const [da, db] = [args[i + 1], args[i + 2]];
  const gunzip = async (f: string) => new Uint8Array(await new Response((await Deno.open(f)).readable.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const rows: any[] = [];
  for (const e of [...Deno.readDirSync(da)].filter((e) => e.name.endsWith(".rgba.gz")).sort((x, y) => x.name.localeCompare(y.name))) {
    const a = await gunzip(`${da}/${e.name}`), b = await gunzip(`${db}/${e.name}`);
    let changed = 0, maxd = 0;
    for (let k = 0; k < a.length; k += 4) {
      const d = Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2]));
      if (d) { changed++; if (d > maxd) maxd = d; }
    }
    rows.push({ shot: e.name.replace(".rgba.gz", ""), pixels: a.length / 4, sameSize: a.length === b.length, changed, maxDiff: maxd });
  }
  const total = rows.reduce((s, r) => s + r.changed, 0);
  const res = { a: da, b: db, shots: rows.length, changedTotal: total, rows };
  if (opt("out")) await Deno.writeTextFile(`${opt("out")}/identity.json`, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, rows: rows.map((r) => `${r.shot}: ${r.changed}/${r.pixels} max ${r.maxDiff}`) }, null, 1));
  Deno.exit(total === 0 ? 0 : 1);
}

// --doc <workRun> <headRun>: write docs/wave-tex/RENDER.md from the JSON of two runs (numbers never typed by hand).
if (opt("doc")) {
  const i = args.indexOf("--doc");
  const [wr, hr] = [args[i + 1], args[i + 2]];
  const W = JSON.parse(Deno.readTextFileSync(`${REPO}/artifacts/wave-tex/render/${wr}/bench.json`));
  const Hd = JSON.parse(Deno.readTextFileSync(`${REPO}/artifacts/wave-tex/render/${hr}/bench.json`));
  const idf = `${REPO}/artifacts/wave-tex/render/${wr}/identity.json`;
  const ID = exists(idf) ? JSON.parse(Deno.readTextFileSync(idf)) : null;
  const MC = await import("../src/graphics/shaders/MaterialChannels.ts");
  const L: string[] = [];
  const ms = (x: number) => x.toFixed(2);
  L.push("# Wave TEX — rendering of the material channels (lane R, contract C-REND)", "");
  L.push(`Generated by \`deno run -A tools/bench-wave-tex.ts --doc ${wr} ${hr}\` from \`artifacts/wave-tex/render/${wr}/bench.json\` (work tree, commit base ${W.commit}, ${W.when}) and \`artifacts/wave-tex/render/${hr}/bench.json\` (git archive HEAD). Numbers in this file are printed by code.`, "");
  L.push("## What renders", "");
  L.push("Every skinned body material (`CelSkinned.createCelSkinnedSurfaceMaterial({ material })`, `#define USE_WAVE_TEX`) reads:", "");
  L.push("| channel | source | shader effect |", "|---|---|---|");
  L.push("| roughness | `aMaterial.x` (vertex), decal lerp (fragment) | r < 0.5: cel highlight band on a Phong lobe, exponent mix(6, 48, g), band softness mix(0.2, 0.05, g), peak 0.3 x light, g = 2(0.5 - r); a wider rim (edge 0.5, 0.1 g). r > 0.5: the rim fades to 40 % at r = 1. 0.5 = the pre-TEX look. |");
  L.push("| height | `aMaterial.y` (m, per-triangle gradient) + decal relief (bind-frame finite differences) | perturbed normal (perturbNormalArb on screen derivatives), tilt clamped at MAX_TILT = " + MC.MAX_TILT + " rad; the lambert change also modulates the albedo x " + "0.9 (clamped 0.7..1.3) so relief reads inside a flat band |");
  L.push("| ao | `aMaterial.z` (P's cavity share x geometric occlusion, MeshOcclusion) | multiplies the whole lit term (ambient + bands + rim + spec + fill); not emissive |");
  L.push("| edge crest | `aEdge` (vertex, optional; P's masks.crest) | per-fragment smoothstep of the interpolated weight lifts the albedo toward white (`USE_WAVE_TEX_EDGE`) |");
  L.push("| subsurface | `aMaterial.w` | warm wrap at the terminator: base x (1, 0.42, 0.28) x light x smoothstep(-0.35, 0, n.l)(1 - smoothstep(0, 0.3, n.l)) x 0.35 x sss |");
  L.push("| emissive | `aEmissive` (vertex, optional) + decal albedo x emissive | added after lighting |");
  L.push("| marks | fragment decals (<= 16) | albedo normal-over, roughness lerp, relief, emissive; hidden under garments (`aSurface.x`, the preset's skin mask) |", "");
  L.push("Dead zones (neutral): " + `|r - 0.5| < ${MC.DEAD_ZONE.roughness}, ao > ${MC.DEAD_ZONE.ao}, subsurface < ${MC.DEAD_ZONE.subsurface}, |emissive| < ${MC.DEAD_ZONE.emissive}, height == 0.`, "");
  L.push("### The lit path is compiled only when something is off-neutral", "");
  L.push("`USE_WAVE_TEX_LIT` is defined when the vertex channels are off-neutral, an emissive attribute exists, or a decal is set (`MaterialRender.setDecals` toggles it, one recompile). Without it the fragment runs the pre-TEX statement verbatim (`celShade(baseColor * vPaint, ...) * detailK`).");
  L.push("Why: three attempts that kept the old arithmetic inside a richer function (a re-typed copy with guarded terms; `celShade(...)` plus guarded terms; an early `return celShade(...)` beside the extended path) all moved 8-9 pixels by 1/255 in Chrome/ANGLE-Metal — the GPU compiler re-associates (fast math) once more terms share the value. Only the separate compile is bit-exact.", "");
  L.push("## Fragment decals (layout posted on the board Z-14 / Z-19)", "");
  L.push(`\`uniform vec4 uDecals[${MC.DECAL_MAX * MC.DECAL_VEC4}]\` = ${MC.DECAL_MAX} decals x ${MC.DECAL_VEC4} vec4, \`uDecalCount\`, \`uDecalRelief\`, \`uGlyphAtlas\` (R8 256x256, 13 Symbols glyphs, distance field).`, "");
  L.push("| vec4 | x | y | z | w |", "|---|---|---|---|---|");
  L.push("| D0 | center.x | center.y | center.z | bounding radius |", "| D1 | tangent.x | tangent.y | tangent.z | halfLength |", "| D2 | normal.x | normal.y | normal.z | halfWidth |");
  L.push("| D3 | albedo.r (linear) | albedo.g | albedo.b | albedoOpacity |", "| D4 | kind | glyph (glyph/dots/band) or stroke count | blur (m) | seed 0..1 |");
  L.push("| D5 | roughness | roughnessOpacity | height (m) | emissive |", "| D6 | spacing (m) | wrapRadius (m) | wrapMode (0 tangent, 1 bitangent) | glyphs in a row |", "");
  L.push(`Kinds: ${MC.DECAL_KINDS.map((k, i) => `${i} ${k}`).join(", ")}. Coverage = 1 - smoothstep(-a, a, s), a = sqrt((0.7 px)^2 + blur^2), px = |dFdx(vBind)| + |dFdy(vBind)| (bind metres per pixel); a stroke thinner than a pixel keeps its area (coverage x clamp(2W/px, 0.25, 1)). Each decal: early reject by its bounding sphere, facing weight smoothstep(0.15, 0.45, n.N), one atlas fetch for glyph kinds. Relief: a plateau of the decal height with steep shoulders, half width max(min(${MC.RELIEF_SHOULDER} W, ${MC.RELIEF_SHOULDER_MAX * 1000} mm), blur, px/2) (closing round F; the first law spread it over max(W, blur, px) and a 0.4 mm scar barely tilted the normal); three evaluations (p, p + e t1, p + e t2, e = max(px/2, 0.15 mm)) only where a relief decal's sphere contains the fragment. Stitched decals draw one centred line (count = stitches; QC REN-9). Glyph kinds (glyph / dots / band) carry no relief (the packer zeroes their height), so a glyph costs exactly one atlas fetch per fragment it touches (QC Z-89).`, "");
  L.push("## Channel debug views", "");
  L.push("`setChannelView(rig | mesh | material, view)` / `rig.material.setChannelView(view)` — a uniform (`uChannelView`), no recompile; `final` restores the game look exactly (the branch is skipped).", "");
  L.push("| code | view | encoding (screen byte = value x 255: data views are pre-linearised against the sRGB output) |", "|---|---|---|");
  const enc: Record<string, string> = { final: "the game", albedo: "albedo after decals (colour)", roughness: "grey = roughness", height: `grey = 0.5 + h / ${(2 * MC.HEIGHT_VIEW_RANGE * 1000).toFixed(0)} mm (vertex + decal relief)`, normal: "view-space shading normal x 0.5 + 0.5", ao: "grey = ao", marks: "decal colour x coverage over grey 0.82 (magenta = relief-only decal)" };
  MC.CHANNEL_VIEWS.forEach((v: string, i: number) => L.push(`| ${i} | ${v} | ${enc[v]} |`));
  L.push("", "## Identity (neutral channels)", "");
  if (ID) {
    L.push(`Method: \`--save\` raw RGBA renders (1280x800, PreviewStage light incl. shadow pass) of the DEFAULT build of 4 races x 2 sexes x yaw {0, 135, 270} from a \`git archive HEAD\` tree and from the work tree with TEX_DEFAULTS off (no preset, no generated marks = neutral channels), then \`--compare\`. In-page material swapping is NOT a valid A/B: three sorts opaque draws by material.id, so a swapped material reorders equal-depth fragments (40 px moved that way with identical shaders).`, "");
    L.push(`**Result: ${ID.changedTotal} changed pixels** over ${ID.shots} renders (${ID.rows[0].pixels} px each). Determinism control HEAD vs HEAD: 0.`, "");
  }
  L.push("## Budget (M1, headless Chrome ANGLE/Metal)", "");
  L.push("Frame = median wall time of `PreviewStage.draw` (shadow pass + main) + a 1-px readPixels sync, 1280x800. Build = `buildPreviewRig` median; warm = body cache hit (rig assembly, where the wiring runs).", "");
  L.push("| measure | HEAD | work: neutral | work: 16 decals each | work: shipped defaults (preset + generated marks) |", "|---|---|---|---|---|");
  const f = (o: any) => o ? ms(o.median) : "-";
  L.push(`| preview frame ms (1 rig) | ${f(Hd.preview.legacy)} | ${f(W.preview.neutral)} | ${f(W.preview.marks16)} | ${f(W.previewDefaults?.asBuilt)} |`);
  L.push(`| arena frame ms (2 rigs) | ${f(Hd.arena.legacy)} | ${f(W.arena.neutral)} | ${f(W.arena.marks16)} | ${f(W.arenaDefaults?.asBuilt)} |`);
  for (const k of Object.keys(W.build)) {
    const h = Hd.build[k], w = W.build[k];
    L.push(`| build ${k} warm / cold ms | ${h.warm} / ${h.cold} | ${w.defaultsOff.warm} / ${w.defaultsOff.cold} | - | ${w.defaultsOn.warm} / ${w.defaultsOn.cold} |`);
  }
  const mN = W.arena.neutral.mem, mD = W.arenaDefaults?.asBuilt.mem, mH = Hd.arena.legacy.mem;
  L.push(`| GPU bytes, 2 skins: geometry | ${mH.geometry} | ${mN.geometry} | ${mN.geometry} | ${mD?.geometry ?? "-"} |`);
  L.push(`| ... of which aMaterial | 0 | ${mN.aMaterial} | ${mN.aMaterial} | ${mD?.aMaterial ?? "-"} |`);
  L.push(`| textures (glyph atlas, shared) | 0 | ${mN.textures} | 65536 | ${mD?.textures ?? "-"} |`);
  L.push(`| decal uniform block | 0 | ${mN.decalUniformBytes} | ${mN.decalUniformBytes} | ${mD?.decalUniformBytes ?? "-"} |`, "");
  L.push("Budget: frame <= +1 ms, build <= +30 ms. Timer resolution in headless Chrome is 0.1 ms; repeated runs moved medians by about 0.3 ms.", "");
  L.push("## WebGL limits", "");
  L.push("- three r180 is WebGL2-only: GLSL ES 3.00 fragment shaders always have highp (decal geometry in bind metres needs it; mediump would quantise 1 m to ~0.5 mm).");
  const { CEL_SKINNED_SHADERS } = await import("../src/graphics/shaders/CelSkinned.ts");
  let rows = 7, samplers = 0; // 7 = three's prefix: viewMatrix (4), cameraPosition, isOrthographic, toneMappingExposure
  const seen = new Set<string>();
  for (const m of CEL_SKINNED_SHADERS.surfaceFragment.matchAll(/uniform\s+(\w+)\s+(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*;/g)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const n = m[3] ? Number(m[3]) : 1;
    if (m[1].startsWith("sampler")) samplers += n; else rows += n * (m[1] === "mat4" ? 4 : m[1] === "mat3" ? 3 : 1);
  }
  L.push(`- Fragment uniforms: ${rows} vec4 rows incl. three's prefix, against the guaranteed ${MC.WEBGL2_MIN_FRAGMENT_VEC4} (TX33, conservative count: every scalar a row); samplers ${samplers} of 16.`);
  L.push("- Loops have constant bounds (16 decals, 8 strokes) with an early break on uDecalCount; no derivative inside the decal functions (TX39).", "");
  L.push("## Pictures", "");
  for (const p of (W.pictures ?? []).filter((q: any) => q.closeup)) L.push(`- \`${p.file}\` — close-up (${p.focus}, ${p.span} m tall = ${(p.span * 1000 / 800).toFixed(2)} mm/px), ${p.variant} ${p.race} ${p.sex}, shipped defaults`);
  for (const p of (W.pictures ?? []).filter((q: any) => !q.closeup)) L.push(`- \`${p.file}\` — ${p.variant}, ${p.stack ? `${p.stack.paint}, marks ${p.stack.marksSource}` : "neutral + 16 demo decals"}, ${p.decals} decals; visible px per decal over 4 yaws: ${p.perDecal.map((d: any, k: number) => `${p.ids?.[k] ?? d.kind}=${d.px}`).join(" ")}`);
  L.push("", "Each sheet: 7 views (final albedo roughness height normal ao marks) x front/back, info strip burned in. A decal with 0 visible px sits under a garment (Warrior: torso studded leather, pelvis+thigh wool, forearm metal bracers) — hidden by design (QD Z-37).", "");
  L.push("## Wiring (TexWiring.ts; SkinnedHumanoid default path)", "");
  L.push("`options.material` (explicit) wins; else `texMaterialFor`: P's `presetFor(subjectOfSpec)` + `applyPresetOverrides(appearance.layerOverrides)` -> `presetBuffers` (albedo replaces the v1 paint, aMaterial, masks.skin -> aSurface.x) and M's `marksForProfile(…, spec.seed)` -> `resolveMarks(regionFrames(mesh))` -> `marksToDecals({ mesh, skinSrgb: appearance.body, skinRoughness: mean skin roughness })`. `TEX_DEFAULTS = { generatedMarks: true, preset: true }` decides what an appearance without explicit marks/overrides gets; both false + no explicit marks/overrides = neutral (identity above). `rig.material.stack` reports what was evaluated (C's HUD).", "");
  L.push("## Material relief details (P's FragmentDetail)", "");
  L.push("`USE_WAVE_TEX_DETAILS`: up to 4 materials x 2 details (`uniform vec4 uMatDetail[8]` = kind, period m, amplitude m, octaves) with a one-hot `aDetailW` vertex weight per material (blends across seams). Drawn kinds, all procedural from the bind position (no texture fetch), each fading out as its period nears the pixel footprint: **pores** (sparse dimples), **weave** (twill on the facing plane), **grain** (fbm, octaves), **hammered** (shallow dents), **strands** (noise stretched along the bind up axis), **plates** (jittered lattice, sunken seams), **studs** (domes, radius 0.16 period, on the facing plane). Features with a period < 20 mm send 30 % of their bump to the band normal and the rest through the albedo (+-20 %, as wave X); coarser ones (studs) are full bumps under the tilt bound. When P's details are present the generic wave-X skin grain / cloth twill gains are set to 0 (abs relief kept).", "");
  const cl = (W.pictures ?? []).filter((q: any) => q.closeup && q.hfDetailsOn !== undefined);
  if (cl.length) {
    L.push("Fine-texture meter (close-ups, front final view, mean |luma Laplacian| over body pixels, outlines excluded): " + cl.map((q: any) => `${q.race}-${q.sex} ${q.focus}: details on ${q.hfDetailsOn} / off ${q.hfDetailsOff}`).join("; ") + ".", "");
  }
  L.push("## Tests", "", "`NO_COLOR=1 deno test -A tests/wave_tex_render_test.ts` — SPEC TX30-39 (+TX37b wiring): decal packing layout + totality, bounded normal (20 000 random pairs: tilt <= MAX_TILT, |dLambert| <= 2 sin(MAX_TILT/2) = 0.2989 < band gap 0.38), uniform budget, neutral path text, profiles + coverage law, glyph atlas vs Symbols (<= 1 texel), rig wiring (neutral attribute, region per vertex, live decals in place, view codes, LIT toggling), CPU cost, shader structure.", "");
  L.push("## Known limits", "");
  L.push("- Hands (HandRig, static CelShader meshes), face parts, hair and weapons are not channel materials: debug views show them in their final colours, and marks never reach the fingers.");
  L.push("- In the preset path the hands keep the v1 skin paint (no finish), so a glazed skin can differ slightly at the wrist.");
  L.push("- Vertex height (`aMaterial.y`) gives a per-triangle gradient: at the 22-35 mm cell its normals are soft/faceted, so relief claims rest on decals (scars) and P's fragment details, not on vertex height (L Z-87).");
  L.push("- The Layers inspector's edits reach the render through P's `applyPresetOverrides` on the preset (ids `p:<material>.<step>`), not through `evaluateStack(presetToV2)`: the inspector stack is a view, the game path is `presetBuffers` (L Z-87, QC PRE-5).");
  L.push("- Inside the lit branch celShade's terms are evaluated once (one shadow lookup; closing round F: the second 9-tap PCF lookup was most of the +1.3 ms arena cost); the band AA width there is fwidth(n.l) x the shadow term, taken in uniform flow (fwidth(light) would include the shadow edge but must not be taken after the neutral branch).");
  L.push("- Generated marks often land under the class outfit and are hidden (correct, but a Warrior shows few marks); captures need bare-skin anchors for torso/thigh marks.");
  Deno.writeTextFileSync(`${REPO}/docs/wave-tex/RENDER.md`, L.join("\n") + "\n");
  console.log(`wrote docs/wave-tex/RENDER.md (${L.length} lines)`);
  Deno.exit(0);
}

await Deno.mkdir(outDir, { recursive: true });
const hasTex = exists(`${src}/src/graphics/shaders/MaterialRender.ts`);
const hasWiring = exists(`${src}/src/graphics/shaders/TexWiring.ts`);
const pageDir = `${src}/dist-wtbench-page`;
await Deno.mkdir(pageDir, { recursive: true });
await Deno.writeTextFile(`${pageDir}/bench-entry.ts`, pageSource("..", hasTex, hasWiring));
const bundle = `${REPO}/dist-wtbench/${runName}.js`;
await Deno.mkdir(`${REPO}/dist-wtbench`, { recursive: true });
await run([Deno.execPath(), "bundle", "--platform=browser", "--format=esm", `--output=${bundle}`, `${pageDir}/bench-entry.ts`], src);
await Deno.remove(pageDir, { recursive: true });
const js = await Deno.readFile(bundle);
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><canvas id="c"></canvas><script type="module" src="b.js"></script></body></html>`;
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (req) => {
  const p = new URL(req.url).pathname;
  if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
  if (p === "/b.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
  return new Response("nf", { status: 404 });
});
const port = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(300000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (/favicon|404 \(Not Found\)/.test(m.text())) return; if (m.type() === "error" || /THREE\.WebGLProgram|shader/i.test(m.text())) errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__WTB__, null, { timeout: 60000 });
const commit = new TextDecoder().decode((await new Deno.Command("git", { args: ["rev-parse", "--short", "HEAD"], cwd: REPO, stdout: "piped" }).output()).stdout).trim();
const report: any = { run: runName, src, hasTex, commit, when: new Date().toISOString(), frames: FRAMES };
const ev = (f: string, ...a: unknown[]) => page.evaluate(([f, a]) => (globalThis as any).__WTB__[f as string](...(a as unknown[])), [f, a] as const);
const only = opt("only"); // "frames" | "shots" | "views" | undefined (= everything)
// Defaults OFF first (neutral bodies: the identity + the decal worst case), then ON (the shipped look).
const OFF = { generatedMarks: false, preset: false }, ON = { generatedMarks: true, preset: true };
report.build = {};
if (!only) {
  for (const [race, sex] of [["human", "male"], ["ork", "female"]]) {
    await ev("defaults", OFF);
    const off = await ev("build", race, sex, 7) as Record<string, number>;
    let on: Record<string, number> | null = null;
    if (hasWiring) { await ev("defaults", ON); on = await ev("build", race, sex, 7) as Record<string, number>; }
    report.build[`${race}-${sex}`] = hasWiring ? { defaultsOff: off, defaultsOn: on } : off;
  }
}
const modes = hasTex ? ["legacy", "neutral", "marks16"] : ["legacy"];
if (!only || only === "frames") {
  await ev("defaults", OFF);
  report.preview = await ev("frames", "preview", modes, FRAMES);
  report.arena = await ev("frames", "arena", modes, FRAMES);
  if (hasWiring) {
    await ev("defaults", ON);
    report.previewDefaults = await ev("frames", "preview", ["asBuilt"], FRAMES);
    report.arenaDefaults = await ev("frames", "arena", ["asBuilt"], FRAMES);
  }
}
await ev("defaults", OFF);
if (opt("save") && (!only || only === "shots")) {
  const dir = opt("save")!;
  await Deno.mkdir(dir, { recursive: true });
  let n = 0;
  for (const race of ["human", "elf", "dwarf", "ork"]) for (const sex of ["male", "female"]) {
    for (const r of await ev("shots", race, sex, [0, 135, 270]) as any[]) {
      await Deno.writeFile(`${dir}/${race}-${sex}-${r.yaw}.rgba.gz`, Uint8Array.from(atob(r.gz), (c) => c.charCodeAt(0)));
      n++;
    }
  }
  report.shots = { dir, n };
}
if (hasTex && !flag("no-pictures") && (!only || only === "views")) {
  report.pictures = [];
  const variants: [string, Record<string, boolean>][] = [["demo16", OFF], ...(hasWiring ? [["default", ON], ["marked", ON]] as [string, Record<string, boolean>][] : [])];
  for (const [variant, defs] of variants) {
    await ev("defaults", defs);
    for (const [race, sex] of [["human", "male"], ["ork", "female"], ["elf", "female"], ["dwarf", "male"]]) {
      const r = await ev("views", race, sex, { commit }, variant) as any;
      const file = `${outDir}/views-${variant}-${race}-${sex}.png`;
      await Deno.writeFile(file, Uint8Array.from(atob(r.png.split(",")[1]), (c) => c.charCodeAt(0)));
      report.pictures.push({ file: file.slice(REPO.length + 1), variant, race, sex, decals: r.decals, stack: r.stack, ids: r.ids, perDecal: r.perDecal });
    }
  }
  await ev("defaults", ON);
  for (const [race, sex, variant, focus, span] of [["ork", "female", "marked", "spine", 0.5], ["human", "male", "marked", "shoulderL", 0.45], ["dwarf", "male", "default", "spine", 0.5], ["elf", "female", "marked", "head", 0.3]] as [string, string, string, string, number][]) {
    const r = await ev("closeup", race, sex, { commit }, variant, focus, span) as any;
    const file = `${outDir}/closeup-${variant}-${race}-${sex}-${focus}.png`;
    await Deno.writeFile(file, Uint8Array.from(atob(r.png.split(",")[1]), (c) => c.charCodeAt(0)));
    report.pictures.push({ file: file.slice(REPO.length + 1), variant, race, sex, focus, span, closeup: true, perDecal: [], hfDetailsOn: r.hfOn, hfDetailsOff: r.hfOff });
  }
  await ev("defaults", OFF);
}
report.errors = errors;
// A partial run (--only) merges into an existing report of the same run instead of overwriting it.
if (opt("only") && exists(`${outDir}/bench.json`)) {
  const prev = JSON.parse(Deno.readTextFileSync(`${outDir}/bench.json`));
  for (const [k, v] of Object.entries(report)) if (v !== undefined && !(k === "build" && Object.keys(v as object).length === 0)) prev[k] = v;
  report.merged = true;
  Object.assign(report, prev);
}
await Deno.writeTextFile(`${outDir}/bench.json`, JSON.stringify(report, null, 1));
await browser.close();
await server.shutdown();
console.log(JSON.stringify(report, (k, v) => (k === "mem" ? JSON.stringify(v) : v), 1));
console.log(`report: ${outDir}/bench.json`);
