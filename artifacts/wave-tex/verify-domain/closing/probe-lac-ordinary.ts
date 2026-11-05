// deno-lint-ignore-file no-explicit-any -- QA probe (Wave TEX closing, agent F), never game code.
// GPU meters for the closing round's WARNs, each measured as an ON/OFF toggle on the SAME rig and camera (so the
// number is what the feature adds on screen, not a cross-build difference), on the capture's own cameras
// (CaptureHud.CAPTURE_ANGLES, PreviewStage studio light, 420x560 tiles like tools/capture-wave-tex.ts).
//
//   deno run -A tools/probe-wave-tex-fix.ts [--src <tree>] [--out <file.json>] [--port 8895]
//
//   edge   final + albedo views, front-left-3q and forearm: preset edge layers on vs off (layerOverrides p:skin.edge,
//          p:skin.edge-form disabled). Skin px = the skin mesh's bare-skin vertices (mask pass: colour attribute painted
//          green on aSurface.x < 0.5); convex px = top-10 % fine curvature (Miniature.fineCurvature) skin vertices.
//          Reports skin brightest-5 % mean luma, convex-region mean luma, changed-pixel share (|dL| >= 2) and mean |dL|.
//   ao     ao view p5/p50/p95 over the body mesh; final view with aMaterial.z on vs forced to 1: mean dL over the
//          body and over the 10 % lowest-ao pixels.
//   scar   capture MARKED_SET on bare skin (garment off), forearm + back-closeup: relief on vs off (uDecalRelief 0):
//          per-mark-mask mean RGB distance in the normal view, mean |dL| in the final view; height view inside the
//          laceration mask minus a 4-px ring.
import { chromium } from "playwright";

const REPO = "/Users/macmax/Desktop/Mytherrania/".replace(/\/$/, "");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = Deno.args;
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const src = (opt("src") ?? REPO).replace(/\/$/, "");
const out = opt("out") ?? `${REPO}/artifacts/wave-tex/fix/probe-${src === REPO ? "work" : src.split("/").pop()}.json`;
const port = Number(opt("port", "8895"));
const marksOnly = args.includes("--marks-only");

const MARKED_SET = {
  scars: [
    { kind: "laceration", region: "foreArm", side: 0, anchor: [0.15, 0.1], lengthMm: 70, widthMm: 4, angle: null, ageDays: 400, keloid: false, hypertrophic: false, seed: 11 },
    { kind: "claw", region: "torso", side: 0, anchor: [0.85, 0.35], lengthMm: 130, widthMm: 5, angle: null, ageDays: 30, keloid: false, seed: 12 },
    { kind: "incision", region: "face", side: 0, anchor: [0.15, -0.05], lengthMm: 30, widthMm: 2, angle: null, ageDays: 3000, keloid: false, seed: 13 },
  ],
  tattoos: [],
};

function pageSource(R: string): string {
  return `// @ts-nocheck generated QA page (tools/probe-wave-tex-fix.ts)
import * as THREE from "three";
import { buildPreviewRig, PreviewStage } from "${R}/src/graphics/PreviewScene.ts";
import { raceBuild } from "${R}/src/game/RaceAppearance.ts";
import { fineCurvature } from "${R}/src/graphics/paint/Miniature.ts";
import { vertexRings } from "${R}/src/graphics/paint/FormShade.ts";
import * as HUD from "${REPO}/src/graphics/CaptureHud.ts";
const TW = 420, TH = 560, BG = [112, 114, 118];
const canvas = document.getElementById("c"); canvas.width = TW; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
renderer.setClearColor(new THREE.Color().setRGB(BG[0] / 255, BG[1] / 255, BG[2] / 255, THREE.SRGBColorSpace), 1);
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8070, 0.9), key = new THREE.DirectionalLight(0xffffff, 1.6);
scene.add(hemi, key, key.target);
const stage = new PreviewStage();
const cam = new THREE.PerspectiveCamera(24, TW / TH, 0.05, 60);
const ANG = Object.fromEntries(HUD.CAPTURE_ANGLES.map((a) => [a.id, a]));
const gl = renderer.getContext();
let cur = null;
function profileFor(race, sex, marks, bare, overrides) {
  const BASE = { male: { h: 1.75, w: 72 }, female: { h: 1.65, w: 60 } };
  const b = raceBuild(race, null);
  const appearance = { body: bare ? "" : "#4f8490", accent: "#dfaa55", height: +(BASE[sex].h * b.heightMul).toFixed(3), weight: +(BASE[sex].w * b.weightMul).toFixed(1), eyes: "#2f6fb5", sex };
  if (marks) appearance.marks = marks;
  if (overrides) appearance.layerOverrides = overrides;
  return { name: "TEX " + race + " " + sex, race, subrace: null, className: "Warrior", palette: "ember", birthsign: null, level: 1, allocated: {}, appearance };
}
function bone(name) { const b = cur.rig.bones?.get?.(name); return b ? b.getWorldPosition(new THREE.Vector3()) : null; }
function targets() {
  const box = cur.box, c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const head = bone("head") ?? new THREE.Vector3(0, box.max.y - 0.15, 0), neck = bone("neck") ?? head, spine = bone("spine") ?? new THREE.Vector3(0, c.y, 0);
  const sL = bone("shoulderL"), sR = bone("shoulderR"), eL = bone("elbowL");
  const upper = sL && eL ? eL.clone().sub(sL) : new THREE.Vector3(0, -0.3, 0);
  const fore = eL ? { c: eL.clone().addScaledVector(upper, 0.55), r: Math.max(0.16, upper.length() * 0.75) } : { c: c.clone(), r: 0.3 };
  const shW = sL && sR ? sL.distanceTo(sR) : 0.4;
  return { body: { c, r: Math.max(s.y / 2, s.x / 2 * TH / TW, s.z / 2 * TH / TW), tall: true }, forearm: fore, back: { c: spine.clone().lerp(neck, 0.55), r: Math.max(0.25, shW * 0.95) } };
}
function build(race, sex, o = {}) {
  if (cur?.rig) scene.remove(cur.rig.group);
  const { rig } = buildPreviewRig(profileFor(race, sex, o.marks, o.bare, o.overrides));
  rig.weaponNode.visible = false; rig.weaponNode.parent?.remove(rig.weaponNode);
  rig.group.updateMatrixWorld(true); scene.add(rig.group);
  cur = { rig, box: new THREE.Box3().setFromObject(rig.group) };
  cur.t = targets();
  const g = rig.skin.geometry;
  cur.col0 = g.getAttribute("color") ? g.getAttribute("color").array.slice() : null;
  cur.mat0 = g.getAttribute("aMaterial") ? g.getAttribute("aMaterial").array.slice() : null;
  return { decals: rig.material?.packed?.count ?? 0, stack: rig.material?.stack?.paint ?? null };
}
function place(angle) {
  const a = ANG[angle], tgt = a.closeUp ? cur.t[a.closeUp] : cur.t.body;
  const dir = new THREE.Vector3(...HUD.orbitDirection(a.yawDeg, a.pitchDeg));
  const dist = tgt.tall ? HUD.fitDistance(tgt.r, cam.fov, 1.04) : HUD.fitDistance(tgt.r, cam.fov * Math.min(1, TW / TH));
  cam.position.copy(tgt.c).addScaledVector(dir, dist); cam.up.set(0, 1, 0);
  cam.near = Math.max(0.02, dist - 3); cam.far = dist + 3; cam.lookAt(tgt.c); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
}
function shot(angle, view) {
  place(angle);
  cur.rig.material?.setChannelView?.(view);
  key.position.copy(stage.lightDir).multiplyScalar(5); key.target.position.set(0, 0, 0);
  stage.draw(renderer, scene, cam); gl.finish(); stage.draw(renderer, scene, cam);
  const px = new Uint8Array(TW * TH * 4); gl.readPixels(0, 0, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, px);
  cur.rig.material?.setChannelView?.("final");
  return px;
}
const L = (px, i) => 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
// A mask pass: paint the colour attribute (1 = green, 0 = black) and read the albedo view.
function maskPass(angle, perVertex) {
  const g = cur.rig.skin.geometry, ca = g.getAttribute("color");
  if (!ca) return null;
  const n = ca.count;
  for (let i = 0; i < n; i++) { const m = perVertex(i); ca.array[i * 3] = 0; ca.array[i * 3 + 1] = m; ca.array[i * 3 + 2] = 0; }
  ca.needsUpdate = true;
  // decals composite over the albedo: off for the mask pass, or the marks themselves fall out of the mask
  const u = cur.rig.skin.material.uniforms, dc = u.uDecalCount ? u.uDecalCount.value : 0;
  if (u.uDecalCount) u.uDecalCount.value = 0;
  // ... and the fine edge highlight lifts the albedo toward white: zero its weight for the mask pass too
  const ea = g.getAttribute("aEdge"), e0 = ea ? ea.array.slice() : null;
  if (ea) { ea.array.fill(0); ea.needsUpdate = true; }
  const px = shot(angle, "albedo");
  if (ea) { ea.array.set(e0); ea.needsUpdate = true; }
  if (u.uDecalCount) u.uDecalCount.value = dc;
  ca.array.set(cur.col0); ca.needsUpdate = true;
  const mask = new Uint8Array(TW * TH);
  for (let i = 0; i < TW * TH; i++) mask[i] = px[i * 4 + 1] > 128 && px[i * 4] < 60 && px[i * 4 + 2] < 60 ? 1 : 0;
  return mask;
}
// Erode a mask by r px (drops the anti-aliased silhouette pixels where the ink hull blends into the surface).
function erode(m, r = 2) {
  const o = new Uint8Array(TW * TH);
  for (let y = r; y < TH - r; y++) for (let x = r; x < TW - r; x++) {
    let ok = m[y * TW + x];
    for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) if (!m[(y + dy) * TW + x + dx]) { ok = 0; break; }
    o[y * TW + x] = ok;
  }
  return o;
}
function stats(px, mask) {
  const v = [];
  for (let i = 0; i < TW * TH; i++) if (mask[i]) v.push(L(px, i));
  v.sort((a, b) => a - b);
  const n = v.length, top = v.slice(Math.floor(n * 0.95));
  return { n, mean: n ? +(v.reduce((a, b) => a + b, 0) / n).toFixed(2) : null, bright5: top.length ? +(top.reduce((a, b) => a + b, 0) / top.length).toFixed(2) : null };
}
function delta(a, b, mask, thr = 2) {
  let ch = 0, n = 0, s = 0; const d = [];
  for (let i = 0; i < TW * TH; i++) { if (!mask[i]) continue; n++; const x = Math.abs(L(a, i) - L(b, i)); s += x; if (x >= thr) { ch++; d.push(x); } }
  d.sort((p, q) => p - q);
  return { n, changedShare: n ? +(ch / n).toFixed(4) : 0, meanAbsDL: n ? +(s / n).toFixed(3) : 0, p95ChangedDL: d.length ? +d[Math.floor(d.length * 0.95)].toFixed(1) : 0 };
}
function rgbDist(a, b, mask) { let s = 0, n = 0; for (let i = 0; i < TW * TH; i++) if (mask[i]) { n++; s += Math.hypot(a[i * 4] - b[i * 4], a[i * 4 + 1] - b[i * 4 + 1], a[i * 4 + 2] - b[i * 4 + 2]); } return n ? +(s / n).toFixed(3) : 0; }
function bodyMask(px) { const m = new Uint8Array(TW * TH); for (let i = 0; i < TW * TH; i++) m[i] = Math.abs(px[i * 4] - BG[0]) + Math.abs(px[i * 4 + 1] - BG[1]) + Math.abs(px[i * 4 + 2] - BG[2]) > 6 ? 1 : 0; return m; }
function curvatureVerts() {
  const g = cur.rig.skin.geometry, P = g.getAttribute("position").array, N = g.getAttribute("normal").array, S = g.getAttribute("aSurface").array;
  const mesh = { positions: P, normals: N, indices: g.index.array, region: g.userData.region };
  const k = fineCurvature(mesh, vertexRings(mesh), cur.rig.plan?.cell ?? 0.028);
  const skinK = []; for (let i = 0; i < P.length / 3; i++) if (S[i * 2] < 0.5) skinK.push(k[i]);
  skinK.sort((a, b) => a - b);
  const q90 = skinK[Math.floor(skinK.length * 0.9)];
  return { k, q90, S };
}
globalThis.__FIX__ = {
  lac(race, sex, marks) {
    build(race, sex, { marks, bare: true });
    const angle = "forearm";
    const u = cur.rig.skin.material.uniforms;
    const mk = shot(angle, "marks");
    const skinM = erode(maskPass(angle, () => 1), 2);
    const mask = new Uint8Array(TW * TH);
    for (let i = 0; i < TW * TH; i++) { const r = mk[i * 4], g2 = mk[i * 4 + 1], b = mk[i * 4 + 2]; mask[i] = skinM[i] && (Math.abs(r - 209) + Math.abs(g2 - 209) + Math.abs(b - 209) > 18) && Math.abs(r - g2) + Math.abs(g2 - b) < 60 && r > 150 ? 1 : 0; }
    const ring = new Uint8Array(TW * TH);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) { const i = y * TW + x; if (mask[i] || !skinM[i]) continue; let near = 0; for (let dy = -7; dy <= 7 && !near; dy++) for (let dx = -7; dx <= 7; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < TW && yy < TH && mask[yy * TW + xx]) { near = 1; break; } } ring[i] = near && Math.abs(mk[i * 4] - 209) < 4 ? 1 : 0; }
    const Ls = (px, m) => { let s = 0, n = 0; for (let i = 0; i < TW * TH; i++) if (m[i]) { const lin = [0, 1, 2].map((c) => { const v = px[i * 4 + c] / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); s += 116 * Math.cbrt(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]) - 16; n++; } return n ? +(s / n).toFixed(2) : null; };
    const a = shot(angle, "albedo");
    const g = cur.rig.skin.geometry, ea = g.getAttribute("aEdge");
    let b = null; if (ea) { const e0 = ea.array.slice(); ea.array.fill(0); ea.needsUpdate = true; b = shot(angle, "albedo"); ea.array.set(e0); ea.needsUpdate = true; }
    return { maskPx: mask.reduce((p, q) => p + q, 0), ringPx: ring.reduce((p, q) => p + q, 0), scarL: Ls(a, mask), ringL: Ls(a, ring), scarLnoCrest: b && Ls(b, mask), ringLnoCrest: b && Ls(b, ring) };
  },
  dbg2(race, sex, marks, angle) {
    build(race, sex, { marks, bare: true });
    const u = cur.rig.skin.material.uniforms;
    const a = shot(angle, "height"); const dc = u.uDecalCount.value; u.uDecalCount.value = 0; const b = shot(angle, "height"); u.uDecalCount.value = dc;
    const hist = {}; let mx = -999, mn = 999, n = 0;
    for (let i = 0; i < TW * TH; i++) { const d = a[i * 4 + 1] - b[i * 4 + 1]; if (d) { n++; mx = Math.max(mx, d); mn = Math.min(mn, d); hist[d] = (hist[d] ?? 0) + 1; } }
    const png = (px) => { const c = document.createElement("canvas"); c.width = TW; c.height = TH; const x = c.getContext("2d"); const im = x.createImageData(TW, TH); for (let y = 0; y < TH; y++) im.data.set(px.subarray((TH - 1 - y) * TW * 4, (TH - y) * TW * 4), y * TW * 4); x.putImageData(im, 0, 0); return c.toDataURL("image/png"); };
    const mk = shot(angle, "marks"), fin = shot(angle, "final"), nrm = shot(angle, "normal");
    return { n, mx, mn, hist, pngs: { height: png(a), marks: png(mk), final: png(fin), normal: png(nrm) } };
  },
  dbg(race, sex, marks, angle) {
    build(race, sex, { marks, bare: true });
    const u = cur.rig.skin.material.uniforms;
    const a = shot(angle, "normal"); u.uDecalRelief.value = 0; const b = shot(angle, "normal"); u.uDecalRelief.value = 1;
    const c = shot(angle, "height");
    let d = 0, mx = 0; for (let i = 0; i < a.length; i++) { const x = Math.abs(a[i] - b[i]); if (x) d++; mx = Math.max(mx, x); }
    return { changed: d, max: mx, defines: Object.keys(cur.rig.skin.material.defines), relief: u.uDecalRelief.value, count: u.uDecalCount.value };
  },
  edge(race, sex) {
    const off = [{ id: "p:skin.edge", enabled: false }, { id: "p:skin.edge-form", enabled: false }];
    const res = {};
    for (const angle of ["front-left-3q", "forearm"]) {
      const r = {};
      build(race, sex, { overrides: off });
      const offF = shot(angle, "final"), offA = shot(angle, "albedo");
      build(race, sex);
      const onF = shot(angle, "final"), onA = shot(angle, "albedo");
      const { k, q90, S } = curvatureVerts();
      const skin = erode(maskPass(angle, (i) => (S[i * 2] < 0.5 ? 1 : 0)), 2);
      const convex = erode(maskPass(angle, (i) => (S[i * 2] < 0.5 && k[i] >= q90 ? 1 : 0)), 1);
      for (const [view, a, b] of [["final", onF, offF], ["albedo", onA, offA]]) {
        r[view] = { on: { skin: stats(a, skin), convex: stats(a, convex) }, off: { skin: stats(b, skin), convex: stats(b, convex) }, skinDelta: delta(a, b, skin) };
      }
      res[angle] = r;
    }
    return res;
  },
  ao(race, sex) {
    build(race, sex);
    const res = {};
    for (const angle of ["front-left-3q", "forearm"]) {
      const aoV = shot(angle, "ao"), onF = shot(angle, "final");
      const g = cur.rig.skin.geometry, ma = g.getAttribute("aMaterial");
      const body = erode(maskPass(angle, () => 1), 2);
      const v = []; for (let i = 0; i < TW * TH; i++) if (body[i]) v.push(aoV[i * 4 + 1]);
      v.sort((a, b) => a - b);
      const q = (p) => v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null;
      let offF = null;
      if (ma) { for (let i = 0; i < ma.count; i++) ma.array[i * 4 + 2] = 1; ma.needsUpdate = true; offF = shot(angle, "final"); ma.array.set(cur.mat0); ma.needsUpdate = true; }
      const lo = new Uint8Array(TW * TH), thr = q(0.1);
      for (let i = 0; i < TW * TH; i++) lo[i] = body[i] && aoV[i * 4 + 1] <= thr ? 1 : 0;
      res[angle] = { aoView: { n: v.length, p5: q(0.05), p10: thr, p50: q(0.5), p95: q(0.95), below240: v.length ? +(v.filter((x) => x < 240).length / v.length).toFixed(4) : 0 },
        final: offF ? { body: delta(onF, offF, body, 1), lowest10: delta(onF, offF, lo, 1), lowest10Lum: { on: stats(onF, lo).mean, off: stats(offF, lo).mean } } : null };
    }
    return res;
  },
  scar(race, sex, marks) {
    const info = build(race, sex, { marks, bare: true });
    const res = { decals: info.decals };
    const u = cur.rig.skin.material.uniforms;
    for (const angle of ["forearm", "back-closeup"]) {
      const mk = shot(angle, "marks");
      const mask = new Uint8Array(TW * TH);
      const grey = 0.82 * 255; // marks view background (sRGB byte of linear 0.82 pre-linearised = 209)
      for (let i = 0; i < TW * TH; i++) { const r = mk[i * 4], g2 = mk[i * 4 + 1], b = mk[i * 4 + 2]; mask[i] = (Math.abs(r - 209) + Math.abs(g2 - 209) + Math.abs(b - 209) > 18) && !(r === mk[0] && g2 === mk[1] && b === mk[2]) ? 1 : 0; }
      // only the skin mesh (hands, face parts and hair keep their final colours in every debug view)
      const skinM = erode(maskPass(angle, () => 1), 2);
      for (let i = 0; i < TW * TH; i++) mask[i] &= skinM[i];
      const nOn = shot(angle, "normal"), fOn = shot(angle, "final"), hOn = shot(angle, "height");
      const rel = u.uDecalRelief.value; u.uDecalRelief.value = 0;
      const nOff = shot(angle, "normal"), fOff = shot(angle, "final");
      u.uDecalRelief.value = rel;
      const dc = u.uDecalCount.value; u.uDecalCount.value = 0; const hNo = shot(angle, "height"); u.uDecalCount.value = dc;
      // ring = pixels within 4 px of the mask, outside it
      const ring = new Uint8Array(TW * TH);
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) { const i = y * TW + x; if (mask[i] || !skinM[i]) continue; let near = 0; for (let dy = -4; dy <= 4 && !near; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < TW && yy < TH && mask[yy * TW + xx]) { near = 1; break; } } ring[i] = near; }
      const mean = (px, m) => { let s = 0, n = 0; for (let i = 0; i < TW * TH; i++) if (m[i]) { s += px[i * 4 + 1]; n++; } return n ? s / n : 0; };
      res[angle] = { maskPx: mask.reduce((a, b) => a + b, 0), normalDistOnOff: rgbDist(nOn, nOff, mask), normalInsideVsRing: +Math.hypot(...[0, 1, 2].map((c) => { let s = 0, n = 0, t = 0, m2 = 0; for (let i = 0; i < TW * TH; i++) { if (mask[i]) { s += nOn[i * 4 + c]; n++; } else if (ring[i]) { t += nOn[i * 4 + c]; m2++; } } return (n ? s / n : 0) - (m2 ? t / m2 : 0); })).toFixed(2),
        finalDelta: delta(fOn, fOff, mask, 2), heightInsideMinusRing: +(mean(hOn, mask) - mean(hOn, ring)).toFixed(2), heightNoDecalsInsideMinusRing: +(mean(hNo, mask) - mean(hNo, ring)).toFixed(2), heightDecalOnly: +(mean(hOn, mask) - mean(hNo, mask)).toFixed(2) };
    }
    return res;
  },
};
`;
}

const pageDir = `${src}/dist-wtfix-page`;
await Deno.mkdir(pageDir, { recursive: true });
await Deno.writeTextFile(`${pageDir}/entry.ts`, pageSource(".."));
const bundle = `${REPO}/dist-wtfix/${src === REPO ? "work" : src.split("/").pop()}.js`;
await Deno.mkdir(`${REPO}/dist-wtfix`, { recursive: true });
const b = await new Deno.Command(Deno.execPath(), { args: ["bundle", "--platform=browser", "--format=esm", `--output=${bundle}`, `${pageDir}/entry.ts`], cwd: src, stdout: "piped", stderr: "piped" }).output();
await Deno.remove(pageDir, { recursive: true });
if (!b.success) { console.error(new TextDecoder().decode(b.stderr)); Deno.exit(1); }
const js = await Deno.readFile(bundle);
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><canvas id="c"></canvas><script type="module" src="b.js"></script></body></html>`;
const server = Deno.serve({ hostname: "127.0.0.1", port, onListen() {} }, (req) => {
  const p = new URL(req.url).pathname;
  if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
  if (p === "/b.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
  return new Response("nf", { status: 404 });
});
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 420, height: 560 } });
page.setDefaultTimeout(600000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" || /THREE\.WebGLProgram|shader/i.test(m.text())) errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
await page.waitForFunction(() => (globalThis as any).__FIX__, null, { timeout: 60000 });
const ev = (f: string, ...a: unknown[]) => page.evaluate(([f, a]) => (globalThis as any).__FIX__[f as string](...(a as unknown[])), [f, a] as const);
if (args.includes("--dbg")) { console.log(JSON.stringify(await ev("dbg", "human", "male", MARKED_SET, "forearm"))); for (const ang of ["forearm", "back-closeup"]) { const r: any = await ev("dbg2", "human", "male", MARKED_SET, ang); for (const [k, v] of Object.entries(r.pngs)) await Deno.writeFile(`${REPO}/artifacts/wave-tex/fix/dbg-${ang}-${k}.png`, Uint8Array.from(atob((v as string).split(",")[1]), (c) => c.charCodeAt(0))); delete r.pngs; console.log(ang, JSON.stringify(r)); } await browser.close(); await server.shutdown(); Deno.exit(0); }
if (args.includes("--lac")) {
  const src2 = Deno.readTextFileSync(`${REPO}/tools/capture-wave-tex.ts`);
  const body = src2.slice(src2.indexOf("export const MARKED_SET = ") + 26, src2.indexOf("};", src2.indexOf("export const MARKED_SET")) + 1).replace(/\/\/[^\n]*/g, "");
  const set = eval("(" + body + ")");
  for (const [race, sex] of [["human", "male"], ["ork", "female"], ["elf", "female"], ["dwarf", "male"]]) console.log(race, sex, JSON.stringify(await ev("lac", race, sex, { scars: [set.scars[0]], tattoos: [] })));
  await browser.close(); await server.shutdown(); Deno.exit(0);
}
const report: any = { src, when: new Date().toISOString(), edge: {}, ao: {}, scar: {}, errors };
for (const [race, sex] of [["human", "male"], ["ork", "female"], ["elf", "female"], ["dwarf", "male"]]) {
  const k = `${race}-${sex}`;
  if (!marksOnly) {
    report.edge[k] = await ev("edge", race, sex);
    report.ao[k] = await ev("ao", race, sex);
  }
  report.scar[k] = await ev("scar", race, sex, MARKED_SET);
  console.log(k, "done");
}
await Deno.mkdir(out.slice(0, out.lastIndexOf("/")), { recursive: true });
await Deno.writeTextFile(out, JSON.stringify(report, null, 1));
await browser.close();
await server.shutdown();
console.log(`wrote ${out}; errors ${errors.length}`, errors.slice(0, 3));
