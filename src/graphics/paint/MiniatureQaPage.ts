// Wave GEN lane S — QA ONLY (not game behaviour): the miniature-paint test page. tools/probe-wave-gen-paint.ts
// bundles this into dist-paint/paintqa.js. Each character is built through the game's own Creator path
// (PreviewScene.buildPreviewRig -> buildSkinnedHumanoid -> paintSkin -> FormShade + Miniature) and drawn on the
// game's PreviewStage (the viewer's cel light, cast shadow, plinth). FORM_SHADE_QA.miniature flips the
// miniature pass off for the "before" picture of the SAME bundle, so before/after differ by that pass only.

// @deno-types="@types/three"
import * as THREE from "three";
import { buildPreviewRig, PreviewStage } from "../PreviewScene.ts";
import type { CharacterProfile } from "../../game/Characters.ts";
import type { Sex } from "../../game/BodyProfile.ts";
import { ageBounds } from "../../game/Age.ts";
import { FORM_SHADE_QA } from "./FormShade.ts";

interface ShowArgs {
  race: string; sex: Sex; miniature: number; view: "front" | "back" | "three" | "torso" | "head";
  intelligence?: number; elder?: boolean; name?: string;
}

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(canvas.width, canvas.height, false);
renderer.setClearColor(0x2b241d, 1);
const scene = new THREE.Scene();
const stage = new PreviewStage();
scene.add(stage.group);
const camera = new THREE.PerspectiveCamera(28, canvas.width / canvas.height, 0.05, 20);
let current: THREE.Object3D | null = null;

function profileFor(a: ShowArgs): CharacterProfile {
  const b = ageBounds(a.race);
  return {
    name: a.name ?? `Paint ${a.race}`, race: a.race, subrace: null, className: "Warrior", palette: "ember", birthsign: null, level: 1, allocated: {},
    appearance: { body: "#4f6f8a", accent: "#dfaa55", height: 1.75, weight: 75, eyes: "#2f6fb5", sex: a.sex, age: a.elder ? Math.round(b.max * 0.8) : b.min + 4 },
  };
}

function show(a: ShowArgs) {
  if (current) scene.remove(current);
  FORM_SHADE_QA.miniature = a.miniature;
  const t0 = performance.now();
  const stats = a.intelligence === undefined ? null : { strength: 500, agility: 500, intelligence: a.intelligence, level: 500 };
  const { rig } = buildPreviewRig(profileFor(a), stats);
  const buildMs = performance.now() - t0;
  FORM_SHADE_QA.miniature = 1;
  rig.weaponNode.visible = false;
  current = rig.group;
  scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig.group);
  const h = box.max.y - box.min.y, cy = box.min.y + h / 2;
  let target = new THREE.Vector3(0, cy, 0), dist = h * 2.25, yaw = 0.0;
  if (a.view === "back") yaw = Math.PI;
  if (a.view === "three") yaw = 0.75;
  if (a.view === "torso") { target = new THREE.Vector3(0, box.min.y + 0.62 * h, 0); dist = h * 1.05; yaw = 0.5; }
  if (a.view === "head") {
    // Frame the head bone (the bounding box can include the raised weapon even when hidden).
    const hb = (rig as unknown as { bones: Map<string, THREE.Object3D> }).bones.get("head");
    const hp = hb ? hb.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, box.max.y - 0.12 * h, 0);
    target = hp.add(new THREE.Vector3(0, 0.06 * h, 0)); dist = h * 0.6; yaw = 2.5;
  }
  camera.position.set(target.x + Math.sin(yaw) * dist, target.y + 0.12 * h, target.z + Math.cos(yaw) * dist);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  stage.draw(renderer as unknown as Parameters<PreviewStage["draw"]>[0], scene, camera);
  // Frame cost: 30 timed draws (the paint is a vertex attribute: the shader is the same with or without it).
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const t1 = performance.now();
  for (let i = 0; i < 30; i++) stage.draw(renderer as unknown as Parameters<PreviewStage["draw"]>[0], scene, camera);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const frameMs = (performance.now() - t1) / 30;
  let hair: unknown = null;
  rig.group.traverse((o: THREE.Object3D) => { if (!hair && o.name.startsWith("hair-")) hair = (o as THREE.Mesh).userData.hair ?? null; });
  return { ok: true, buildMs, frameMs, tris: rig.triangleCount, hair };
}

/** Mean sRGB luminance + std-dev of the non-background pixels in a rectangle (0..1 fractions of the canvas). */
function figureStats(x0 = 0, y0 = 0, x1 = 1, y1 = 1) {
  const gl = renderer.getContext();
  const W = canvas.width, H = canvas.height, px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let s = 0, s2 = 0, n = 0;
  for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y++) for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x++) {
    const i = ((H - 1 - y) * W + x) * 4;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    if (Math.abs(r - 0x2b) + Math.abs(g - 0x24) + Math.abs(b - 0x1d) < 6) continue; // the clear colour
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    s += l; s2 += l * l; n++;
  }
  const m = s / Math.max(1, n);
  return { mean: m, std: Math.sqrt(Math.max(0, s2 / Math.max(1, n) - m * m)), n };
}

(globalThis as unknown as Record<string, unknown>).__PAINTQA__ = { show, figureStats };
