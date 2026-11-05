// deno-lint-ignore-file no-explicit-any -- QA capture tool (Wave TEX, lane C: photographer + QA tooling).
// Wave TEX C-CAP: the capture MATRIX — races x sexes x {reference, marked} x lighting x angles (+ close-ups) x channel
// views — every image with a burned-in software information HUD (src/graphics/CaptureHud.ts), one contact sheet per
// subject and sheet kind, an index.json for the verifiers, and a run-to-run diff (pixel diff % + changed-region boxes).
//
//   deno run -A tools/capture-wave-tex.ts capture --run <id> [--src head|<tree>] [--quick|--full] [--diff <prevRun>]
//                                                 [--port 8873] [--subjects human-male,...] [--tiles]
//   deno run -A tools/capture-wave-tex.ts diff --a <run> --b <run>     (diff two existing runs; writes into run b)
//   deno run -A tools/capture-wave-tex.ts prune [--dry]                (delete superseded quick runs not in keep.json)
//   deno run -A tools/capture-wave-tex.ts doc                          (docs/wave-tex/CAPTURE.md from every run's index.json)
//
// `--src head` extracts `git archive HEAD` into the scratch dir (skill pitfall 24: no stash, no worktree) and captures
// that tree: the BASELINE. Default src = this working tree (all lanes' uncommitted work). The capture page is generated
// TypeScript importing the tree's own modules plus the repo's CaptureHud.ts (pure), bundled with `deno bundle` into
// BUILD_OUT (default dist-capture). New-lane modules are FEATURE-DETECTED (R's MaterialChannels.setChannelView,
// M's appearance.marks, P's Presets, L's LayerStack): a tree without them captures what it can and says so in the HUD.
//
// Characters are built by `PreviewScene.buildPreviewRig` (the Creator's own call) and lit by the Creator's
// `PreviewStage.draw` for the "studio" setup (skill: never light game rigs with a QA headlight for a look verdict);
// the other setups write the shared cel uniforms for one draw and restore them, as PreviewStage does.
import { chromium, type Page } from "playwright";
import { encodeBase64 } from "@std/encoding/base64";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const OUT_ROOT = `${REPO}/artifacts/wave-tex/captures`;
const BUILD_OUT = Deno.env.get("BUILD_OUT") ?? "dist-capture";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = Deno.args;
const mode = args[0] ?? "capture";
const opt = (k: string, d?: string): string | undefined => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const flag = (k: string): boolean => args.includes(`--${k}`);
const exists = (p: string): boolean => {
  try { Deno.statSync(p); return true; } catch { return false; }
};
async function sh(cmd: string[], cwd = REPO): Promise<string> {
  const r = await new Deno.Command(cmd[0], { args: cmd.slice(1), cwd, stdout: "piped", stderr: "piped" }).output();
  if (!r.success) throw new Error(`failed: ${cmd.join(" ")}\n${new TextDecoder().decode(r.stderr)}`);
  return new TextDecoder().decode(r.stdout);
}
const rel = (p: string) => p.startsWith(REPO + "/") ? p.slice(REPO.length + 1) : p;
const b64png = (u: string) => Uint8Array.from(atob(u.split(",")[1]), (ch) => ch.charCodeAt(0));

// ---------------------------------------------------------------- the matrix
export const LIGHTS = ["studio", "rim", "flat", "daylight", "dusk"] as const;
export const CHANNELS = ["final", "albedo", "roughness", "height", "normal", "ao", "marks"] as const;
const RACES = ["human", "elf", "dwarf", "ork"];
const SEXES = ["male", "female"];
const QUICK_SUBJECTS = ["human-male", "ork-female", "elf-female", "dwarf-male"];

interface SheetPlan { kind: string; cols: number; tiles: { angle: string; light: string; channel: string }[] }
function sheetPlans(quick: boolean, hasChannels: boolean): SheetPlan[] {
  const angles = quick ? ["front", "back", "front-left-3q", "face", "forearm", "back-closeup"]
    : ["front", "back", "left", "right", "front-left-3q", "back-right-3q", "top", "face", "forearm", "back-closeup"];
  const plans: SheetPlan[] = [{ kind: "angles", cols: quick ? 6 : 5, tiles: angles.map((angle) => ({ angle, light: "studio", channel: "final" })) }];
  const lightAngles = quick ? ["front-left-3q"] : ["front-left-3q", "face"];
  plans.push({ kind: "lights", cols: 5, tiles: lightAngles.flatMap((angle) => LIGHTS.map((light) => ({ angle, light, channel: "final" }))) });
  if (hasChannels) {
    const chAngles = quick ? ["front-left-3q", "forearm"] : ["front-left-3q", "face", "forearm", "back-closeup"];
    plans.push({ kind: "channels", cols: 7, tiles: chAngles.flatMap((angle) => CHANNELS.map((channel) => ({ angle, light: "studio", channel }))) });
  }
  return plans;
}

/**
 * The "scarred + tattooed" capture set (M's C-MARK shapes), placed to land in the face / forearm / back close-ups.
 * Round 2 (QD Z-36): anchors moved until M's own validateMarks reports ok on all 4 races (face uMax 0.24; the
 * tribal sits at mid-back u = -1, below the claw). The capture re-validates it per subject and prints any issue.
 */
export const MARKED_SET = {
  scars: [
    // closing round (F Z-114 / QD Z-115): the 400-day laceration is the ORDINARY-healing probe, so its hypertrophic roll
    // is pinned off (seed 11 rolled hypertrophic on 3/4 races and the races were not comparable).
    { kind: "laceration", region: "foreArm", side: 0, anchor: [0.15, 0.1], lengthMm: 70, widthMm: 4, angle: null, ageDays: 400, keloid: false, hypertrophic: false, seed: 11 },
    { kind: "claw", region: "torso", side: 0, anchor: [0.85, 0.35], lengthMm: 130, widthMm: 5, angle: null, ageDays: 30, keloid: false, seed: 12 },
    { kind: "incision", region: "face", side: 0, anchor: [0.18, -0.4], lengthMm: 30, widthMm: 2, angle: null, ageDays: 3000, keloid: false, seed: 13 },
  ],
  tattoos: [
    { style: "band", motif: "serpent", region: "foreArm", side: 0, anchor: [0, -0.35], sizeMm: 55, angle: null, inks: ["blueBlack"], ageYears: 4, seed: 21 },
    { style: "tribal", motif: "sun", region: "torso", side: 0, anchor: [-1, -0.2], sizeMm: 130, angle: null, inks: ["black"], ageYears: 8, seed: 22 },
    { style: "dotwork", motif: "eye", region: "face", side: 1, anchor: [0, 0.45], sizeMm: 14, angle: null, inks: ["woad"], ageYears: 1, seed: 23, facial: true },
  ],
};

/** The capture subject's profile (Warrior, no sub-race, base height/weight x race build). `bare` = no garment colour:
 *  buildPreviewRig passes appearance.body as the garment, so "" paints no shirt/breeches (torso/back marks visible). */
function profileFor(raceBuild: (r: string, s: string | null) => any, race: string, sex: string, marks: unknown, bare: boolean): any {
  const BASE: any = { male: { h: 1.75, w: 72 }, female: { h: 1.65, w: 60 } };
  const b = raceBuild(race, null);
  const appearance: any = { body: bare ? "" : "#4f8490", accent: "#dfaa55", height: +(BASE[sex].h * b.heightMul).toFixed(3), weight: +(BASE[sex].w * b.weightMul).toFixed(1), eyes: "#2f6fb5", sex };
  if (marks) appearance.marks = marks;
  return { name: "TEX " + race + " " + sex, race, subrace: null, className: "Warrior", palette: "ember", birthsign: null, level: 1, allocated: {}, appearance };
}

// ---------------------------------------------------------------- the capture page (generated source)
function pageSource(R: string, hud: string, f: { channels: boolean; marks: boolean; presets: boolean; layers: boolean }): string {
  return `// GENERATED by tools/capture-wave-tex.ts (Wave TEX lane C) — QA only, not game code.
// @deno-types="@types/three"
import * as THREE from "three";
import { buildPreviewRig, PreviewStage } from "${R}/src/graphics/PreviewScene.ts";
import { celLighting } from "${R}/src/graphics/shaders/CelShader.ts";
import { environmentAt, PLACES } from "${R}/src/graphics/Environment.ts";
import { stackFor } from "${R}/src/graphics/paint/Recipes.ts";
import * as HUD from "${hud}";
${f.channels ? `import * as CH from "${R}/src/graphics/shaders/MaterialRender.ts";` : "const CH: any = null;"}
${f.presets ? `import * as PRE from "${R}/src/graphics/paint/Presets.ts";` : "const PRE: any = null;"}
${f.layers ? `import * as LS from "${R}/src/graphics/paint/LayerStack.ts";` : "const LS: any = null;"}

const TW = 420, TH = 560, FONT = 10, LIST_LINES = 3;
const HUD_H = HUD.hudMaxHeight(FONT, LIST_LINES);
const BG = [112, 114, 118];
const canvas = document.getElementById("c") as HTMLCanvasElement;
canvas.width = TW; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(TW, TH, false);
renderer.setClearColor(new THREE.Color().setRGB(BG[0] / 255, BG[1] / 255, BG[2] / 255, THREE.SRGBColorSpace), 1);
const scene = new THREE.Scene();
// Non-cel parts (hands' ToonLambert, eyes) read THREE lights: a hemisphere + a key that follow each setup.
const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8070, 0.9);
const key = new THREE.DirectionalLight(0xffffff, 1.6);
scene.add(hemi, key, key.target);
const stage = new PreviewStage();
const cam = new THREE.PerspectiveCamera(24, TW / TH, 0.05, 60);
let meta: any = { run: "?", commit: "?", dirty: false, buildTime: "?" };
let cur: any = null;


// L's LayerStackV2 ({nodes}, groups flattened as "group/child"), P's MaterialPreset ({layers}) or a plain list.
const opsOf = (l: any): string => Array.isArray(l.writes) ? l.writes.map((w: any) => (w.channel ?? "?") + ":" + (w.op ?? "?")).join(" ")
  : l.writes && typeof l.writes === "object" ? Object.entries(l.writes).map(([ch, o]) => ch + ":" + o).join(" ")
  : l.target ? Object.entries(l.target).map(([ch, w]: any) => ch + ":" + (w?.op ?? w?.blend ?? w)).join(" ")
  : l.blend && typeof l.blend === "object" ? Object.entries(l.blend).map(([ch, b]) => ch + ":" + b).join(" ")
  : String(l.op ?? l.blend ?? l.step ?? "normal");
const fromV2 = (st: any): any[] => {
  const out: any[] = [];
  const walk = (nodes: any[], pre: string) => { for (const l of nodes) {
    out.push({ name: pre + String(l.id ?? l.name), enabled: l.enabled !== false, opacity: l.opacity, ops: l.kind === "group" ? "group" + (l.blend ? " " + opsOf(l) : "") : opsOf(l) });
    if (Array.isArray(l.children)) walk(l.children, pre + String(l.id ?? l.name) + "/");
  } };
  walk(st.nodes ?? st.finish?.layers ?? st.layers ?? st, "");
  return out;
};
/** The layer stack the rig RENDERED: the rig's own stack when it exposes one (rig.material.stack), else the v1 recipe (stackFor). */
function layersOf(profile: any, rig: any): any[] {
  const v2 = rig?.material?.stack ?? rig?.layerStack ?? rig?.materialStack ?? rig?.skin?.userData?.layerStack ?? null;
  try { if (v2) return fromV2(v2); } catch { /* fall through */ }
  return v1Layers(profile, rig);
}
/** P's preset for the profile (index.json only: NOT necessarily what the rig rendered). */
function presetLayersOf(profile: any): any[] | null {
  if (PRE) {
    for (const fn of ["presetForProfile", "presetFor", "skinPreset", "presetStack"]) {
      if (typeof PRE[fn] !== "function") continue;
      try { const st = PRE[fn](profile); if (st && (st.finish?.layers ?? st.layers ?? Array.isArray(st))) return fromV2(st); } catch { /* signature differs */ }
    }
  }
  return null;
}
function v1Layers(profile: any, rig: any): any[] {
  const st = stackFor({ race: profile.race, subrace: profile.subrace, className: profile.className, birthsign: profile.birthsign, hair: rig?.appearance?.hair ?? "#000000", accent: profile.appearance.accent, garment: profile.appearance.body, height: profile.appearance.height, seed: 0 } as any);
  return st.layers.map((l: any) => ({ name: l.name, ops: "v1:" + l.blend + "/" + l.pattern, opacity: l.opacity }));
}

function marksOf(m: any, issues: any, flags?: any[]): any[] {
  if (!m) return [];
  const bad = (id: string) => { const r = (issues ?? []).find((x: any) => x.id === id); return (r?.covered ? " (covered)" : "") + (r && !r.ok ? " !" + r.issues.join("!") : ""); };
  const side = (s: any) => s === 1 ? "R" : s === 0 ? "L" : "";
  return [
    ...(m.scars ?? []).map((s: any, i: number) => ({ kind: "scar:" + s.kind, detail: s.region + side(s.side) + " " + s.lengthMm + "mm " + s.ageDays + "d" + (flags?.[i]?.keloid ? " keloid" : flags?.[i]?.hypertrophic ? (flags[i].active === false ? " hypertrophic regressed" : " hypertrophic") : "") + bad("scar." + i) })),
    ...(m.tattoos ?? []).map((t: any, i: number) => ({ kind: "tattoo:" + t.style, detail: t.motif + " " + t.region + side(t.side) + " " + t.sizeMm + "mm " + (t.inks ?? []).join("+") + " " + t.ageYears + "y" + bad("tattoo." + i) })),
  ];
}

function boneWorld(name: string): THREE.Vector3 | null {
  const b = cur.rig.bones?.get?.(name);
  return b ? b.getWorldPosition(new THREE.Vector3()) : null;
}

/** Close-up targets from the rig's own bones (world = model space: the group sits at the origin). */
function targets(): any {
  const box = cur.box, c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const head = boneWorld("head") ?? new THREE.Vector3(0, box.max.y - 0.15, 0);
  const neck = boneWorld("neck") ?? head;
  const spine = boneWorld("spine") ?? new THREE.Vector3(0, c.y, 0);
  const sL = boneWorld("shoulderL"), sR = boneWorld("shoulderR"), eL = boneWorld("elbowL");
  const headTop = box.max.y;
  const faceR = Math.max(0.13, (headTop - head.y) * 0.75);
  const face = { c: new THREE.Vector3(head.x, (head.y + headTop) / 2, head.z + 0.03), r: faceR };
  const upper = sL && eL ? eL.clone().sub(sL) : new THREE.Vector3(0, -0.3, 0);
  const fore = eL ? { c: eL.clone().addScaledVector(upper, 0.55), r: Math.max(0.16, upper.length() * 0.75) } : { c: c.clone(), r: 0.3 };
  const shW = sL && sR ? sL.distanceTo(sR) : 0.4;
  const back = { c: spine.clone().lerp(neck, 0.55), r: Math.max(0.25, shW * 0.95) };
  const body = { c, r: Math.max(s.y / 2, s.x / 2 * TH / TW, s.z / 2 * TH / TW), tall: true };
  return { body, face, forearm: fore, back };
}

function prepare(s: any): any {
  cur?.rig && scene.remove(cur.rig.group);
  const profile = s.profile; // built by the tool (profileFor), so its validation + covered regions use the same object
  const t0 = performance.now();
  const { rig } = buildPreviewRig(profile);
  const buildMs = performance.now() - t0;
  rig.weaponNode.visible = false; // the blade is not the subject (and would widen the frame: Box3 counts hidden meshes)
  rig.weaponNode.parent?.remove(rig.weaponNode);
  rig.group.updateMatrixWorld(true);
  scene.add(rig.group);
  const box = new THREE.Box3().setFromObject(rig.group);
  cur = { s, profile, rig, box, buildMs, tris: rig.triangleCount, weaponTris: 0 };
  cur.layers = layersOf(profile, rig);
  cur.layerSource = rig?.material?.stack ? "rig.material.stack" : "v1 stackFor (recipe)";
  cur.marks = marksOf(s.marks, s.markIssues, s.scarFlags);
  const packed = (rig as any).material?.packed;
  cur.marksDrawn = (rig as any).material ? Number(packed?.count ?? 0) : undefined;
  cur.t = targets();
  const views = (rig as any).material?.setChannelView || (CH && typeof CH.setChannelView === "function") ? ["final", "albedo", "roughness", "height", "normal", "ao", "marks"] : ["final"];
  return { buildMs: +buildMs.toFixed(1), bodyTiming: rig.timing ?? null, triangles: rig.triangleCount, layers: cur.layers, layerSource: cur.layerSource, presetLayers: presetLayersOf(profile), marks: cur.marks, views,
    bbox: { min: box.min.toArray().map((v: number) => +v.toFixed(4)), max: box.max.toArray().map((v: number) => +v.toFixed(4)) },
    marksRequested: cur.marks.length, decalsPacked: cur.marksDrawn ?? null, marksCovered: (s.markIssues ?? []).filter((r: any) => r.covered).length, decalsDropped: (rig as any).material?.packed?.dropped ?? null, appearanceHasMarks: !!profile.appearance.marks, markIssues: s.markIssues ?? null };
}

// ---- lighting setups (all restore the shared cel uniforms after the draw)
function hueOf(c: readonly number[], out: THREE.Color): THREE.Color {
  const m = (c[0] + c[1] + c[2]) / 3 || 1;
  return out.setRGB(0.5 + 0.5 * c[0] / m, 0.5 + 0.5 * c[1] / m, 0.5 + 0.5 * c[2] / m);
}
/** The sun of an environment, its elevation kept, its azimuth turned to 35 deg front-left of the subject (+Z front). */
function sunSetup(hour: number): any {
  const env: any = environmentAt(hour, 172, PLACES[0]);
  const el = env.sun.elevation, az = 35 * Math.PI / 180;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  const kI = env.sunIntensity;
  return {
    dir, colour: new THREE.Color(env.sunColor[0] * kI, env.sunColor[1] * kI, env.sunColor[2] * kI),
    amb: new THREE.Color(env.ambientColor[0] * 1.5, env.ambientColor[1] * 1.5, env.ambientColor[2] * 1.5),
    sky: hueOf(env.zenith, new THREE.Color()), ground: hueOf([0.4, 0.4, 0.4], new THREE.Color()),
    detail: "env " + PLACES[0].id + " h" + hour + " elev " + (el * 180 / Math.PI).toFixed(1) + "deg",
  };
}
const DAY = sunSetup(13);
const DUSK = (() => { let best = 18, bd = 99; for (let h = 15; h <= 22; h += 0.25) { const e: any = environmentAt(h, 172, PLACES[0]); const d = Math.abs(e.sun.elevation * 180 / Math.PI - 4); if (d < bd) { bd = d; best = h; } } return sunSetup(best); })();

function drawWith(setup: string, camDir: THREE.Vector3): string {
  const L: any = celLighting;
  if (setup === "studio") {
    key.position.copy(stage.lightDir).multiplyScalar(5); key.target.position.set(0, 0, 0); key.intensity = 1.6; hemi.intensity = 0.9;
    stage.draw(renderer as any, scene, cam);
    return "PreviewStage key [" + stage.lightDir.toArray().map((v: number) => v.toFixed(2)).join(",") + "] +fill, shadow";
  }
  const saved = { dir: L.lightDirection.value, col: L.lightColor.value, amb: L.ambientColor.value, sky: L.uSkyTint.value, gnd: L.uGroundTint.value, on: L.uShadowOn.value, fc: L.uFillColor.value };
  let detail = "";
  try {
    L.uShadowOn.value = 0; L.uFillColor.value = new THREE.Color(0, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    if (setup === "rim") {
      const right = new THREE.Vector3().crossVectors(up, camDir).normalize();
      const d = camDir.clone().multiplyScalar(-0.85).addScaledVector(up, 0.45).addScaledVector(right, 0.25).normalize();
      L.lightDirection.value = d; L.lightColor.value = new THREE.Color(1.7, 1.6, 1.45); L.ambientColor.value = new THREE.Color(0.26, 0.27, 0.31);
      L.uSkyTint.value = new THREE.Color(1, 1, 1); L.uGroundTint.value = new THREE.Color(1, 1, 1);
      detail = "camera-relative back key, ambient 0.27, no shadow";
    } else if (setup === "flat") {
      L.lightDirection.value = camDir.clone(); L.lightColor.value = new THREE.Color(0, 0, 0); L.ambientColor.value = new THREE.Color(1 / 1.15, 1 / 1.15, 1 / 1.15);
      L.uSkyTint.value = new THREE.Color(1, 1, 1); L.uGroundTint.value = new THREE.Color(1, 1, 1);
      detail = "headlight band, key 0, ambient 1 (albedo x paint)";
    } else {
      const S = setup === "dusk" ? DUSK : DAY;
      L.lightDirection.value = S.dir; L.lightColor.value = S.colour; L.ambientColor.value = S.amb; L.uSkyTint.value = S.sky; L.uGroundTint.value = S.ground;
      detail = S.detail + ", no shadow";
    }
    key.position.copy(L.lightDirection.value).multiplyScalar(5); key.target.position.set(0, 0, 0);
    key.intensity = setup === "flat" ? 0 : 1.6; hemi.intensity = setup === "flat" ? 1.6 : setup === "rim" ? 0.3 : 0.9;
    renderer.render(scene, cam);
  } finally {
    L.lightDirection.value = saved.dir; L.lightColor.value = saved.col; L.ambientColor.value = saved.amb; L.uSkyTint.value = saved.sky; L.uGroundTint.value = saved.gnd; L.uShadowOn.value = saved.on; L.uFillColor.value = saved.fc;
  }
  return detail;
}

function setChannel(view: string): boolean {
  const m = cur.rig.material;
  try {
    if (m && typeof m.setChannelView === "function") { m.setChannelView(view); return true; }
    if (CH && typeof CH.setChannelView === "function") { CH.setChannelView(cur.rig, view); return true; }
  } catch { return false; }
  return view === "final";
}

function project(p: THREE.Vector3): [number, number] {
  const v = p.clone().project(cam);
  return [(v.x * 0.5 + 0.5) * TW, (0.5 - v.y * 0.5) * TH];
}
function sphereBox(t: any): number[] | null {
  const [x, y] = project(t.c);
  const d = cam.position.distanceTo(t.c);
  const rp = t.r / (d * Math.tan(cam.fov * Math.PI / 360)) * TH / 2;
  const b = [x - rp, y - rp, x + rp, y + rp].map((v) => Math.round(v));
  if (b[2] < 0 || b[3] < 0 || b[0] > TW || b[1] > TH) return null;
  return [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(TW, b[2]), Math.min(TH, b[3])];
}

function readTile(): Uint8ClampedArray {
  const gl = renderer.getContext();
  const px = new Uint8Array(TW * TH * 4);
  gl.readPixels(0, 0, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out = new Uint8ClampedArray(TW * TH * 4);
  for (let y = 0; y < TH; y++) out.set(px.subarray((TH - 1 - y) * TW * 4, (TH - y) * TW * 4), y * TW * 4);
  return out;
}
function tileStats(px: Uint8ClampedArray): any {
  const lum: number[] = [];
  for (let i = 0; i < TW * TH; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    if (Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]) > 6) lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  lum.sort((a, b) => a - b);
  const q = (p: number) => lum.length ? +lum[Math.min(lum.length - 1, Math.floor(p * lum.length))].toFixed(1) : null;
  return { coverage: +(lum.length / (TW * TH)).toFixed(4), lumaMean: lum.length ? +(lum.reduce((a, b) => a + b, 0) / lum.length).toFixed(1) : null, lumaP5: q(0.05), lumaP50: q(0.5), lumaP95: q(0.95) };
}

const ANG: Record<string, any> = Object.fromEntries(HUD.CAPTURE_ANGLES.map((a: any) => [a.id, a]));

function renderTile(t: any): any {
  const a = ANG[t.angle];
  const tgt = a.closeUp ? cur.t[a.closeUp] : cur.t.body;
  const dir = new THREE.Vector3(...HUD.orbitDirection(a.yawDeg, a.pitchDeg));
  // whole body: its half-height (or aspect-scaled half-width) fills the vertical fov; close-ups: the sphere fits the narrow (horizontal) fov
  const dist = tgt.tall ? HUD.fitDistance(tgt.r, cam.fov, 1.04) : HUD.fitDistance(tgt.r, cam.fov * Math.min(1, TW / TH));
  cam.position.copy(tgt.c).addScaledVector(dir, dist);
  cam.up.set(0, 1, 0);
  if (a.pitchDeg > 80) cam.up.set(0, 0, -1);
  cam.near = Math.max(0.02, dist - 3); cam.far = dist + 3;
  cam.lookAt(tgt.c); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const chOk = setChannel(t.channel);
  const gl = renderer.getContext();
  let detail = drawWith(t.light, dir); // warm-up (shader compile on the first draw of a material/view)
  gl.finish();
  const f0 = performance.now();
  detail = drawWith(t.light, dir);
  const px = readTile(); // readPixels syncs: frame ms = CPU submit + GPU to completion
  const frameMs = performance.now() - f0;
  setChannel("final");
  const orbit = HUD.orbitOf(cam.position.toArray(), tgt.c.toArray());
  const regions: any = {};
  for (const k of ["face", "forearm", "back"]) { const b = sphereBox(cur.t[k]); if (b) regions[k] = b; }
  const info: any = {
    run: meta.run, commit: meta.commit, dirty: meta.dirty, buildTime: meta.buildTime,
    race: cur.s.race, subrace: cur.profile.subrace, sex: cur.s.sex, className: cur.profile.className, variant: cur.s.bare ? cur.s.variant + " (no garment)" : cur.s.variant,
    layers: cur.layers, layerSource: cur.layerSource === "rig.material.stack" ? "rig" : "v1 recipe", marks: cur.marks, marksDecals: cur.s.marks ? cur.marksDrawn : undefined, marksCovered: (cur.s.markIssues ?? []).filter((r: any) => r.covered).length, channel: chOk ? t.channel : t.channel + " (unsupported: final)", light: t.light, lightDetail: detail,
    camera: { angle: t.angle, yawDeg: orbit.yawDeg, pitchDeg: orbit.pitchDeg, distanceM: orbit.distanceM, fovDeg: cam.fov },
    triangles: cur.tris, buildMs: cur.buildMs, frameMs,
  };
  return { px, info, regions, stats: tileStats(px), channelOk: chOk };
}

function sheet(spec: any): any {
  const grid = HUD.sheetGrid(spec.tiles.length, spec.cols, TW, TH + HUD_H, 28, 4);
  const out = document.createElement("canvas");
  out.width = grid.width; out.height = grid.height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#08090b"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = "#f0e6d0"; ctx.font = "bold 16px monospace"; ctx.fillText(spec.title, 8, 20);
  const tiles: any[] = [];
  spec.tiles.forEach((t: any, i: number) => {
    const r = renderTile(t);
    const cell = grid.cells[i];
    ctx.putImageData(new ImageData(r.px, TW, TH), cell.x, cell.y);
    const lay = HUD.layoutHud(r.info, TW, FONT, LIST_LINES);
    ctx.fillStyle = lay.background; ctx.fillRect(cell.x, cell.y + TH, TW, HUD_H);
    ctx.font = lay.fontPx + "px Menlo, monospace";
    for (const l of lay.lines) { ctx.fillStyle = l.colour; ctx.fillText(l.text, cell.x + l.x, cell.y + TH + l.y); }
    tiles.push({ ...t, rect: [cell.x, cell.y, TW, TH + HUD_H], render: [cell.x, cell.y, TW, TH], hudRect: [cell.x, cell.y + TH, TW, HUD_H],
      camera: r.info.camera, lightDetail: r.info.lightDetail, frameMs: +r.info.frameMs.toFixed(3), channelOk: r.channelOk, regions: r.regions, stats: r.stats,
      hud: Object.fromEntries(HUD.HUD_FIELDS.map((f: string) => [f, lay.lines.filter((l: any) => l.field === f).map((l: any) => l.text).join(" | ")])) });
    if (spec.tilePngs) { const c = document.createElement("canvas"); c.width = TW; c.height = TH + HUD_H; c.getContext("2d")!.drawImage(out, cell.x, cell.y, TW, TH + HUD_H, 0, 0, TW, TH + HUD_H); tiles[i].png = c.toDataURL("image/png"); }
  });
  return { png: out.toDataURL("image/png"), width: out.width, height: out.height, tiles };
}

/** Diff the RENDER rects of two sheets (the HUD bands always differ: run id, commit, timings). */
async function diff(aUrl: string, bUrl: string, rects: number[][]): Promise<any> {
  const load = (u: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
  const [ia, ib] = await Promise.all([load(aUrl), load(bUrl)]);
  if (ia.width !== ib.width || ia.height !== ib.height) return { sameSize: false, a: [ia.width, ia.height], b: [ib.width, ib.height] };
  const W = ia.width, H = ia.height;
  const read = (im: HTMLImageElement) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d")!; x.drawImage(im, 0, 0); return x.getImageData(0, 0, W, H).data; };
  const A = read(ia), B = read(ib);
  const vis = document.createElement("canvas"); vis.width = W; vis.height = H;
  const vx = vis.getContext("2d")!;
  const o = vx.createImageData(W, H), od = o.data;
  for (let i = 0; i < W * H; i++) { const g = (B[i * 4] + B[i * 4 + 1] + B[i * 4 + 2]) / 6 + 40; od[i * 4] = od[i * 4 + 1] = od[i * 4 + 2] = g; od[i * 4 + 3] = 255; }
  const tiles: any[] = [];
  let ch = 0, tot = 0;
  for (const [x, y, w, h] of rects) {
    const ta = new Uint8ClampedArray(w * h * 4), tb = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) { ta.set(A.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4); tb.set(B.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4); }
    const d = HUD.diffImages(ta, tb, w, h, { threshold: 16, cell: 16, minPixels: 4, maxBoxes: 12 });
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const i = (r * w + c) * 4;
      const m = (Math.abs(ta[i] - tb[i]) + Math.abs(ta[i + 1] - tb[i + 1]) + Math.abs(ta[i + 2] - tb[i + 2])) / 3;
      if (m > 16) { const j = ((y + r) * W + x + c) * 4; od[j] = 255; od[j + 1] = 30; od[j + 2] = 30; }
    }
    ch += d.changed; tot += d.total;
    tiles.push({ changedPct: d.changedPct, meanAbs: d.meanAbs, boxes: d.boxes.map((b: any) => [b.x0, b.y0, b.x1, b.y1, b.pixels]) });
  }
  vx.putImageData(o, 0, 0);
  vx.strokeStyle = "#ffe14a"; vx.lineWidth = 2;
  rects.forEach(([x, y], k) => { for (const b of tiles[k].boxes) vx.strokeRect(x + b[0] - 1.5, y + b[1] - 1.5, b[2] - b[0] + 3, b[3] - b[1] + 3); });
  return { sameSize: true, changedPct: tot ? +(100 * ch / tot).toFixed(4) : 0, tiles, png: ch > 0 ? vis.toDataURL("image/png") : null };
}

(globalThis as any).__TEXCAP__ = { setMeta: (m: any) => { meta = m; }, prepare, sheet, diff, hudHeight: HUD_H, tile: [TW, TH] };
`;
}

// ---------------------------------------------------------------- source trees + bundle
async function headTree(): Promise<{ dir: string; sha: string }> {
  const sha = (await sh(["git", "rev-parse", "HEAD"])).trim();
  const scratch = `${Deno.env.get("HOME")}/.hermes/cache/scratch`;
  const dir = `${scratch}/wave-tex-head-${sha.slice(0, 10)}`;
  if (!exists(`${dir}/src/graphics/PreviewScene.ts`)) {
    await Deno.mkdir(dir, { recursive: true });
    const p = new Deno.Command("sh", { args: ["-c", `git archive HEAD | tar -x -C '${dir}'`], cwd: REPO }).spawn();
    if (!(await p.status).success) throw new Error("git archive failed");
  }
  return { dir, sha };
}

/** Commit id for the HUD: HEAD sha, plus a short hash of the uncommitted src/ diff when the tree is the working tree. */
async function commitOf(src: string, headSha: string | null): Promise<{ commit: string; dirty: boolean; dirtyFiles: string[] }> {
  if (headSha) return { commit: headSha.slice(0, 10), dirty: false, dirtyFiles: [] };
  const sha = (await sh(["git", "rev-parse", "HEAD"])).trim();
  const status = (await sh(["git", "status", "--porcelain", "--", "src", "styles.css", "index.html"])).split("\n").filter(Boolean);
  if (!status.length) return { commit: sha.slice(0, 10), dirty: false, dirtyFiles: [] };
  const files = status.map((l) => l.slice(3)).sort();
  const parts: string[] = [await sh(["git", "diff", "HEAD", "--", "src", "styles.css", "index.html"])];
  for (const l of status) if (l.startsWith("??")) {
    const p = `${src}/${l.slice(3)}`;
    try { if (Deno.statSync(p).isFile) parts.push(p, Deno.readTextFileSync(p)); else for (const f of (await sh(["git", "ls-files", "-o", "--exclude-standard", l.slice(3)])).split("\n").filter(Boolean)) parts.push(f, Deno.readTextFileSync(`${src}/${f}`)); } catch { /* vanished */ }
  }
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(parts.join("\0"))));
  return { commit: `${sha.slice(0, 7)}+${[...h.slice(0, 3)].map((b) => b.toString(16).padStart(2, "0")).join("")}`, dirty: true, dirtyFiles: files };
}

function features(src: string): { channels: boolean; marks: boolean; presets: boolean; layers: boolean } {
  const has = (p: string, re: RegExp) => exists(`${src}/${p}`) && re.test(Deno.readTextFileSync(`${src}/${p}`));
  return {
    channels: has("src/graphics/shaders/MaterialRender.ts", /export\s+function\s+setChannelView/),
    marks: has("src/game/Characters.ts", /\bmarks\?\s*:/) || has("src/graphics/body/contracts.ts", /\bmarks\?\s*:/),
    presets: exists(`${src}/src/graphics/paint/Presets.ts`),
    layers: exists(`${src}/src/graphics/paint/LayerStack.ts`),
  };
}

async function bundlePage(src: string, f: ReturnType<typeof features>): Promise<{ js: Uint8Array; ms: number }> {
  const pageDir = src === REPO ? `${OUT_ROOT}/_page` : `${src}/.texcap`;
  await Deno.mkdir(pageDir, { recursive: true });
  const R = pageDir.startsWith(src + "/") ? pageDir.slice(src.length + 1).split("/").map(() => "..").join("/") : src;
  const hud = `${REPO}/src/graphics/CaptureHud.ts`;
  const entry = `${pageDir}/capture-entry.ts`;
  await Deno.writeTextFile(entry, pageSource(R, hud, f));
  const outDir = `${REPO}/${BUILD_OUT}`;
  await Deno.mkdir(outDir, { recursive: true });
  const t0 = Date.now();
  await sh([Deno.execPath(), "bundle", "--platform=browser", "--format=esm", "--minify", `--output=${outDir}/texcap.js`, entry], src);
  return { js: await Deno.readFile(`${outDir}/texcap.js`), ms: Date.now() - t0 };
}

async function openPage(js: Uint8Array, port: number): Promise<{ page: Page; close: () => Promise<void>; errors: string[] }> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>TEX capture</title></head><body style="margin:0;background:#111"><canvas id="c"></canvas><script type="module" src="texcap.js"></script></body></html>`;
  const server = Deno.serve({ hostname: "127.0.0.1", port, onListen() {} }, (req) => {
    const p = new URL(req.url).pathname;
    if (p === "/" || p === "/index.html") return new Response(html, { headers: { "content-type": "text/html" } });
    if (p === "/texcap.js") return new Response(js as unknown as BodyInit, { headers: { "content-type": "text/javascript" } });
    return new Response("nf", { status: 404 });
  });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.setDefaultTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => (globalThis as any).__TEXCAP__, null, { timeout: 60000 });
  return { page, errors, close: async () => { await browser.close(); await server.shutdown(); } };
}

// ---------------------------------------------------------------- capture
async function capture(): Promise<void> {
  const runId = opt("run") ?? `r-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  const quick = !flag("full");
  const port = Number(opt("port") ?? "8873");
  const srcArg = opt("src");
  let src = REPO, headSha: string | null = null;
  if (srcArg === "head") { const h = await headTree(); src = h.dir; headSha = h.sha; } else if (srcArg) src = srcArg.replace(/\/$/, "");
  const f = features(src);
  const { commit, dirty, dirtyFiles } = await commitOf(src, headSha);
  const buildTime = new Date().toISOString().slice(0, 19) + "Z";
  const outDir = `${OUT_ROOT}/${runId}`;
  if (exists(outDir) && !flag("overwrite")) throw new Error(`run ${runId} exists (use --overwrite)`);
  await Deno.mkdir(outDir, { recursive: true });
  console.log(`run ${runId}: src ${rel(src)} commit ${commit} ${quick ? "quick" : "full"} features ${JSON.stringify(f)}`);
  const { js, ms: bundleMs } = await bundlePage(src, f);
  const { page, errors, close } = await openPage(js, port);
  await page.evaluate((m) => (globalThis as any).__TEXCAP__.setMeta(m), { run: runId, commit, dirty, buildTime });

  // marked-bare = marked without the garment (torso/back marks are under the shirt otherwise; QD Z-36): angles + channels only.
  const variants = f.marks ? ["reference", "marked", "marked-bare"] : ["reference"];
  const markLib: any = exists(`${src}/src/graphics/paint/marks/MarkLibrary.ts`) ? await import(`file://${src}/src/graphics/paint/marks/MarkLibrary.ts`) : null;
  const pre: any = f.presets ? await import(`file://${src}/src/graphics/paint/Presets.ts`) : null;
  const recipes: any = await import(`file://${src}/src/graphics/paint/Recipes.ts`);
  const { raceBuild } = await import(`file://${src}/src/game/RaceAppearance.ts`);
  const REGIONS_ALL: string[] = [...(await import(`file://${src}/src/graphics/body/contracts.ts`)).REGIONS];
  const wanted = opt("subjects")?.split(",") ?? (quick ? QUICK_SUBJECTS : RACES.flatMap((r) => SEXES.map((s) => `${r}-${s}`)));
  const subjects: any[] = [], images: any[] = [], sheets: any[] = [];
  const plans = sheetPlans(quick, f.channels);
  const t0 = Date.now();
  for (const rs of wanted) for (const variant of variants) {
    const [race, sex] = rs.split("-");
    const id = `${race}-${sex}-${variant}`;
    const marked = variant.startsWith("marked");
    const bare = variant === "marked-bare";
    const profile = profileFor(raceBuild, race, sex, marked ? MARKED_SET : f.marks ? { scars: [], tattoos: [] } : undefined, bare);
    // Covered regions = the outfit: P's preset skin complement when the tree has it, else the v1 recipe's garment regions.
    const covered: string[] = bare ? [] : pre?.presetForProfile && pre?.skinRegionsOf
      ? REGIONS_ALL.filter((r: string) => !pre.skinRegionsOf(pre.presetForProfile(profile)).includes(r)) : [...(recipes.GARMENT_REGIONS ?? [])];
    const markIssues = marked && markLib?.validateMarks ? markLib.validateMarks(MARKED_SET, { race, coveredRegions: covered }) : null;
    // The RESOLVED keloid / hypertrophic flag of every scar (M's seeded rolls), so the HUD says why a scar is raised (QD Z-115).
    const scarLib: any = marked && exists(`${src}/src/graphics/paint/marks/Scar.ts`) ? await import(`file://${src}/src/graphics/paint/marks/Scar.ts`) : null;
    const scarFlags = scarLib?.resolveHypertrophic ? (MARKED_SET.scars as any[]).map((sc) => {
      const keloid = scarLib.resolveKeloid(sc, race, null);
      const hyp = scarLib.resolveHypertrophic(sc, race, null, keloid);
      // 'hypertrophic' only while it is still active (raised); a regressed one says so (it is flat again).
      const active = hyp && (scarLib.hypertrophicActivity ? scarLib.hypertrophicActivity(sc.ageDays) >= (scarLib.HYPERTROPHIC_ACTIVE ?? 0.1) : true);
      return { keloid, hypertrophic: hyp, active };
    }) : null;
    const s = { race, sex, variant, bare, markIssues, covered, profile, marks: profile.appearance.marks, scarFlags };
    const info = await page.evaluate((x) => (globalThis as any).__TEXCAP__.prepare(x), s);
    subjects.push({ id, race, sex, variant, coveredRegions: s.covered, ...info });
    for (const plan of plans) {
      if (variant === "marked-bare" && plan.kind === "lights") continue;
      const title = `${id} · ${plan.kind} · ${runId} · ${commit}`;
      const r = await page.evaluate((spec) => (globalThis as any).__TEXCAP__.sheet(spec), { title, cols: plan.cols, tiles: plan.tiles, tilePngs: flag("tiles") });
      const file = `${outDir}/${id}-${plan.kind}.png`;
      await Deno.writeFile(file, b64png(r.png));
      sheets.push({ id: `${id}-${plan.kind}`, path: rel(file), subject: id, kind: plan.kind, width: r.width, height: r.height, tiles: r.tiles.length });
      r.tiles.forEach((t: any, k: number) => {
        const imgId = `${id}/${plan.kind}/${t.angle}/${t.light}/${t.channel}`;
        let tilePath: string | undefined;
        if (t.png) { tilePath = `${outDir}/tiles/${id}-${plan.kind}-${k}.png`; Deno.mkdirSync(`${outDir}/tiles`, { recursive: true }); Deno.writeFileSync(tilePath, b64png(t.png)); delete t.png; }
        images.push({ id: imgId, path: rel(file), tilePath: tilePath ? rel(tilePath) : undefined, sheet: `${id}-${plan.kind}`, subject: id, race, sex, variant, light: t.light, angle: t.angle, view: t.channel, channelOk: t.channelOk,
          rect: t.rect, render: t.render, hudRect: t.hudRect, camera: t.camera, lightDetail: t.lightDetail, frameMs: t.frameMs, regions: t.regions, stats: t.stats, hud: t.hud,
          triangles: info.triangles, buildMs: info.buildMs });
      });
    }
    console.log(`${id}: build ${info.buildMs} ms, tris ${info.triangles}, layers ${info.layers.length}, marks ${info.marks.length} req / ${info.decalsPacked ?? "-"} decals / ${info.marksCovered} covered${markIssues?.some((r: any) => !r.ok) ? " ISSUES " + JSON.stringify(markIssues.filter((r: any) => !r.ok)) : ""}, views ${info.views.join("/")}`);
  }
  const index: any = { run: runId, mode: quick ? "quick" : "full", src: rel(src), commit, dirty, dirtyFiles, buildTime, bundleMs, captureMs: Date.now() - t0, features: f,
    tile: await page.evaluate(() => (globalThis as any).__TEXCAP__.tile), hudHeight: await page.evaluate(() => (globalThis as any).__TEXCAP__.hudHeight),
    markedSet: f.marks ? MARKED_SET : null, subjects, sheets, images, errors };
  const prev = opt("diff");
  if (prev) index.diff = await diffRuns(page, prev, runId, index);
  if (f.marks) {
    index.marksEffect = await marksEffect(page, index, runId);
    console.log("marks effect (marked vs reference, same run):");
    for (const r of index.marksEffect) console.log(`  ${r.sheet.padEnd(36)} ${String(r.changedPct).padStart(8)} %  ${r.tiles.map((t: any) => t.image.split("/")[2] + ":" + t.changedPct).join(" ")}`);
  }
  await close();
  index.errors = errors;
  await Deno.writeTextFile(`${outDir}/index.json`, JSON.stringify(index, null, 1));
  const bytes = [...Deno.readDirSync(outDir)].filter((e) => e.isFile).reduce((a, e) => a + Deno.statSync(`${outDir}/${e.name}`).size, 0);
  console.log(`sheets ${sheets.length}, images ${images.length}, ${(bytes / 1e6).toFixed(1)} MB, errors ${errors.length}${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  if (index.diff) printDiff(index.diff);
  console.log(`wrote ${rel(outDir)}/index.json`);
}

/** Diff every sheet of run b against the same sheet of run a (a marked subject falls back to a's reference subject). */
async function diffRuns(page: Page, a: string, b: string, bIndex: any): Promise<any> {
  const aIdx = JSON.parse(Deno.readTextFileSync(`${OUT_ROOT}/${a}/index.json`));
  const aSheets = new Map<string, any>(aIdx.sheets.map((s: any) => [s.id, s]));
  const rows: any[] = [];
  for (const s of bIndex.sheets) {
    // marked -> the previous reference when the previous run had no marked subject (what the marks changed);
    // marked-bare has its own garment-off look, so it compares only with a previous marked-bare.
    const fallback = s.id.includes("-marked-bare-") ? null : s.id.replace("-marked-", "-reference-");
    const sa = aSheets.get(s.id) ?? (fallback ? aSheets.get(fallback) : undefined);
    if (!sa) { rows.push({ sheet: s.id, vs: null, note: "no counterpart" }); continue; }
    if (!exists(`${REPO}/${sa.path}`)) { rows.push({ sheet: s.id, vs: sa.id, note: "baseline png pruned" }); continue; }
    const tilesB = bIndex.images.filter((i: any) => i.sheet === s.id);
    const tilesA = aIdx.images.filter((i: any) => i.sheet === sa.id);
    // compare only tiles with the same settings (angle/light/view) at the same position
    const pairs = tilesB.map((t: any, k: number) => ({ t, k, ok: tilesA[k] && tilesA[k].angle === t.angle && tilesA[k].light === t.light && tilesA[k].view === t.view }));
    if (sa.width !== s.width || sa.height !== s.height || pairs.some((p: any) => !p.ok)) {
      rows.push({ sheet: s.id, vs: sa.id, note: `layout differs (${sa.width}x${sa.height} vs ${s.width}x${s.height})` });
      continue;
    }
    const au = `data:image/png;base64,${encodeBase64(await Deno.readFile(`${REPO}/${sa.path}`))}`;
    const bu = `data:image/png;base64,${encodeBase64(await Deno.readFile(`${REPO}/${s.path}`))}`;
    const d = await page.evaluate(([x, y, r]) => (globalThis as any).__TEXCAP__.diff(x, y, r), [au, bu, tilesB.map((t: any) => t.render)] as const);
    let diffPath: string | null = null;
    if (d.png) { diffPath = `${OUT_ROOT}/${b}/${s.id}.diff.png`; await Deno.writeFile(diffPath, b64png(d.png)); }
    const perTile = tilesB.map((t: any, k: number) => ({ image: t.id, changedPct: d.tiles[k].changedPct, meanAbs: d.tiles[k].meanAbs, boxes: d.tiles[k].boxes }));
    for (const pt of perTile) { const img = bIndex.images.find((i: any) => i.id === pt.image); if (img) img.vsPrev = { run: a, changedPct: pt.changedPct, meanAbs: pt.meanAbs, boxes: pt.boxes }; }
    rows.push({ sheet: s.id, vs: sa.id, changedPct: d.changedPct, diffPath: diffPath ? rel(diffPath) : null, tiles: perTile });
  }
  return { against: a, threshold: 16, rows };
}

/**
 * Within one run: each `marked` sheet vs the `reference` sheet of the same subject and kind (same garment, same
 * camera, same light) = what the marks changed on screen. marked-bare has no garment-off reference, so it is skipped.
 */
async function marksEffect(page: Page, idx: any, runId: string): Promise<any[]> {
  const rows: any[] = [];
  for (const s of idx.sheets) {
    if (!s.id.includes("-marked-") || s.id.includes("-marked-bare-")) continue;
    const r = idx.sheets.find((x: any) => x.id === s.id.replace("-marked-", "-reference-"));
    if (!r) continue;
    const tiles = idx.images.filter((i: any) => i.sheet === s.id);
    const au = `data:image/png;base64,${encodeBase64(await Deno.readFile(`${REPO}/${r.path}`))}`;
    const bu = `data:image/png;base64,${encodeBase64(await Deno.readFile(`${REPO}/${s.path}`))}`;
    const d = await page.evaluate(([x, y, rr]) => (globalThis as any).__TEXCAP__.diff(x, y, rr), [au, bu, tiles.map((t: any) => t.render)] as const);
    let diffPath: string | null = null;
    if (d.png) { diffPath = `${OUT_ROOT}/${runId}/${s.id}.marks.png`; await Deno.writeFile(diffPath, b64png(d.png)); }
    const per = tiles.map((t: any, k: number) => ({ image: t.id, changedPct: d.tiles[k].changedPct, boxes: d.tiles[k].boxes }));
    for (const pt of per) { const img = idx.images.find((i: any) => i.id === pt.image); if (img) img.marksVsReference = { changedPct: pt.changedPct, boxes: pt.boxes }; }
    rows.push({ sheet: s.id, vs: r.id, changedPct: d.changedPct, diffPath: diffPath ? rel(diffPath) : null, tiles: per });
  }
  return rows;
}

function printDiff(d: any): void {
  console.log(`diff vs ${d.against} (render rects only, pixel changed when mean |dRGB| > ${d.threshold}):`);
  for (const r of d.rows) {
    if (r.changedPct === undefined) { console.log(`  ${r.sheet.padEnd(36)} ${r.note}`); continue; }
    const worst = [...r.tiles].sort((x: any, y: any) => y.changedPct - x.changedPct)[0];
    console.log(`  ${r.sheet.padEnd(36)} ${String(r.changedPct).padStart(8)} %  worst ${worst.image.split("/").slice(2).join("/")} ${worst.changedPct}% boxes ${worst.boxes.length}${r.diffPath ? "  " + r.diffPath : ""}`);
  }
}

async function diffMode(): Promise<void> {
  const a = opt("a"), b = opt("b");
  if (!a || !b) throw new Error("diff --a <run> --b <run>");
  const bPath = `${OUT_ROOT}/${b}/index.json`;
  const bIdx = JSON.parse(Deno.readTextFileSync(bPath));
  const { js } = await bundlePage(REPO, { channels: false, marks: false, presets: false, layers: false });
  const { page, close } = await openPage(js, Number(opt("port") ?? "8873"));
  bIdx.diff = await diffRuns(page, a, b, bIdx);
  await close();
  await Deno.writeTextFile(bPath, JSON.stringify(bIdx, null, 1));
  printDiff(bIdx.diff);
}

// ---------------------------------------------------------------- prune + doc
function runs(): any[] {
  if (!exists(OUT_ROOT)) return [];
  const out: any[] = [];
  for (const e of Deno.readDirSync(OUT_ROOT)) {
    const f = `${OUT_ROOT}/${e.name}/index.json`;
    if (e.isDirectory && exists(f)) { const j = JSON.parse(Deno.readTextFileSync(f)); j._dir = `${OUT_ROOT}/${e.name}`; out.push(j); }
  }
  return out.sort((x, y) => String(x.buildTime).localeCompare(String(y.buildTime)));
}

/** keep.json: run ids a verdict cites (never pruned). Quick runs superseded by a later quick run lose their PNGs unless kept or cited. */
function prune(): void {
  const keep: string[] = exists(`${OUT_ROOT}/keep.json`) ? JSON.parse(Deno.readTextFileSync(`${OUT_ROOT}/keep.json`)) : [];
  // Runs cited anywhere on the board or in verifier docs are kept too.
  const cited = new Set<string>(keep);
  const texts = [`${REPO}/artifacts/wave-tex/BOARD.md`, ...["VERIFY-ART", "VERIFY-DOMAIN", "VERIFY-CODE", "UI", "RENDER", "MARKS", "ART", "LAYERS"].map((n) => `${REPO}/docs/wave-tex/${n}.md`)].filter(exists).map((p) => Deno.readTextFileSync(p)).join("\n");
  const all = runs();
  for (const r of all) if (texts.includes(r.run)) cited.add(r.run);
  const quick = all.filter((r) => r.mode === "quick");
  const latest = quick[quick.length - 1]?.run;
  for (const r of quick) {
    if (r.run === latest || cited.has(r.run)) continue;
    // PNGs only: index.json stays, so CAPTURE.md still lists the run (its sheets as "pngs pruned").
    const pngs = [...Deno.readDirSync(r._dir)].filter((e) => e.isFile && e.name.endsWith(".png"));
    if (!pngs.length && !exists(`${r._dir}/tiles`)) continue;
    console.log(`${flag("dry") ? "would prune" : "pruned"} ${r.run} (${pngs.length} png)`);
    if (flag("dry")) continue;
    for (const e of pngs) Deno.removeSync(`${r._dir}/${e.name}`);
    if (exists(`${r._dir}/tiles`)) Deno.removeSync(`${r._dir}/tiles`, { recursive: true });
  }
}

function doc(): void {
  const L: string[] = [];
  const all = runs();
  L.push("# Wave TEX — capture runs (lane C)", "");
  L.push("GENERATED by `deno run -A tools/capture-wave-tex.ts doc` from `artifacts/wave-tex/captures/*/index.json`. Do not edit by hand.", "");
  L.push("## How a run is made", "");
  L.push("- `tools/capture-wave-tex.ts capture --run <id> [--src head] [--quick|--full] [--diff <prev>]` bundles a QA page (BUILD_OUT=dist-capture, port 8873) that builds each");
  L.push("  subject with `PreviewScene.buildPreviewRig` (the Creator's call), removes the weapon, and renders tiles of 420x560 px with a 24 deg");
  L.push("  perspective camera at a fixed distance per framing target (whole body / face / left forearm / upper back, from the rig's own bones).");
  L.push("- Each tile carries the HUD band (src/graphics/CaptureHud.ts, 10 px Menlo) BELOW the render: run, commit (+hash of uncommitted src/ when dirty),");
  L.push("  build time, race/sub-race/sex/class, variant, active layers + operators, marks, channel view, light setup, camera yaw/pitch/distance/fov,");
  L.push("  triangles (rig incl. the removed weapon), rig build ms and frame ms (second draw, `readPixels`-synchronised).");
  L.push("- Lights: `studio` = the Creator's `PreviewStage.draw` (overhead key + face fill + shadow pass); `rim` = camera-relative back key, ambient 0.27;");
  L.push("  `flat` = no key, ambient 1 (the albedo x paint read, cel rim kept); `daylight`/`dusk` = `environmentAt` sun colour/intensity/ambient at 13 h and at");
  L.push("  4 deg elevation, azimuth turned to 35 deg front-left of the subject. Non-studio setups have no cast shadow.");
  L.push("- Subjects: 4 races x 2 sexes (Warrior, no sub-race, base height/weight x race build) x `reference` (marks = none), `marked` (the fixed");
  L.push("  `MARKED_SET`: forearm laceration + band tattoo, back claw scar + tribal tattoo, face incision + dotwork; validated per race with M's");
  L.push("  `validateMarks`, issues printed in the HUD as `!issue`) and `marked-bare` (same marks, garment off so torso/back marks are visible;");
  L.push("  angles + channels only), the marked variants only when the tree has `appearance.marks`. HUD `marks(n req, m decals, k under garment)`:");
  L.push("  m = decals the rig packed (`rig.material.packed.count`), k = marks M's validateMarks calls covered by the outfit (R's skin mask hides them).");
  L.push("  `reference` = an EXPLICIT empty set (R's TEX_DEFAULTS would otherwise draw generated marks). `index.marksEffect` = marked vs reference");
  L.push("  sheets of the same run (what the marks changed on screen; `<sheet>.marks.png`). `--quick` = 4 subjects (human-m, ork-f, elf-f, dwarf-m), 6 angles, lights at 3/4, channels at 3/4 + forearm.");
  L.push("- Channel views (`final albedo roughness height normal ao marks`) only when the tree exports R's `setChannelView`.");
  L.push("- `index.json`: per image {id, path (sheet), rect/render/hudRect in the sheet, race, sex, variant, light, angle, view, camera, regions (face/forearm/back");
  L.push("  boxes in render px), stats (coverage, luma mean/p5/p50/p95 of subject pixels), hud text per field, vsPrev}.");
  L.push("- Diff: render rects only (HUD bands always differ), pixel changed when mean |dRGB| > 16 (0..255); changed-region boxes = 16 px grid cells with");
  L.push("  >= 4 changed px, 8-connected (`CaptureHud.diffImages`). Diff PNG: the new run in grey, changed pixels red, boxes yellow.", "");
  L.push("## Runs", "");
  L.push("| run | when (UTC) | mode | src | commit | features | sheets / images | errors | diff vs | sheets changed (max %) |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const r of all) {
    const fe = Object.entries(r.features).filter(([, v]) => v).map(([k]) => k).join(",") || "-";
    const d = r.diff;
    const changed = d ? d.rows.filter((x: any) => x.changedPct > 0) : [];
    const mx = changed.length ? Math.max(...changed.map((x: any) => x.changedPct)) : 0;
    L.push(`| \`${r.run}\` | ${r.buildTime} | ${r.mode} | ${r.src.replace(/^\/Users\/[^/]+/, "~")} | ${r.commit} | ${fe} | ${r.sheets.length} / ${r.images.length} | ${r.errors.length} | ${d ? d.against : "-"} | ${d ? `${changed.length}/${d.rows.length} (${mx})` : "-"} |`);
  }
  L.push("");
  for (const r of all) {
    L.push(`### \`${r.run}\``, "");
    L.push(`Sheets (${r.sheets.length}):`, "");
    const ex = r.sheets.filter((s: any) => exists(`${REPO}/${s.path}`));
    L.push(ex.map((s: any) => `[${s.id}](../../${s.path})`).join(" · ") || "(pngs pruned)", "");
    const subj = r.subjects.map((s: any) => `${s.id} ${s.triangles} tris ${s.buildMs} ms`).join("; ");
    L.push(`Subjects: ${subj}`, "");
    if (r.diff) {
      L.push(`Diff vs \`${r.diff.against}\`:`, "", "| sheet | changed % | worst tile | boxes | diff png |", "|---|---|---|---|---|");
      for (const x of r.diff.rows) {
        if (x.changedPct === undefined) { L.push(`| ${x.sheet} | - | ${x.note} | - | - |`); continue; }
        const w = [...x.tiles].sort((p: any, q: any) => q.changedPct - p.changedPct)[0];
        L.push(`| ${x.sheet} | ${x.changedPct} | ${w.image.split("/").slice(2).join("/")} ${w.changedPct} % | ${w.boxes.length} | ${x.diffPath && exists(`${REPO}/${x.diffPath}`) ? `[diff](../../${x.diffPath})` : "-"} |`);
      }
      L.push("");
    }
  }
  Deno.writeTextFileSync(`${REPO}/docs/wave-tex/CAPTURE.md`, L.join("\n") + "\n");
  console.log(`wrote docs/wave-tex/CAPTURE.md (${all.length} runs)`);
}

if (import.meta.main) {
  if (mode === "capture") await capture();
  else if (mode === "diff") await diffMode();
  else if (mode === "prune") prune();
  else if (mode === "doc") doc();
  else console.error("modes: capture | diff | prune | doc");
}
