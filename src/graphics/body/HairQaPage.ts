// Wave X lane H — QA ONLY (not game behaviour): a head-close-up test page for the grown hair.
// tools/probe-wave-x-hair.ts bundles this file into dist-hair/hairqa.js and drives it from
// Playwright. It builds each character through the SAME path the Creator preview and the arena use
// (PreviewScene.buildPreviewRig -> buildSkinnedHumanoid -> FaceParts -> HairMesh), so the pictures
// are of the hair the game draws, then frames the HEAD (front, back and side views) — the creator
// has no age control yet, so this page is how an elder is put in front of the camera.

// @deno-types="@types/three"
import * as THREE from "three";
import { buildPreviewRig } from "../PreviewScene.ts";
import type { CharacterProfile } from "../../game/Characters.ts";
import type { Sex } from "../../game/BodyProfile.ts";
import { ageBounds } from "../../game/Age.ts";

interface ShowArgs { race: string; subrace: string | null; sex: Sex; age: "young" | "elder"; name: string; view: "front" | "back" | "side" | "three" | "detail" }
interface ShowResult { ok: boolean; name: string; hairTris: number; rigTris: number; hairMeshes: number; meshes: string; age: number; hair: Record<string, unknown> | null }

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(canvas.width, canvas.height, false);
renderer.setClearColor(0x3a3026, 1);
const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight("#e8dcc8", 0.85));
const key = new THREE.DirectionalLight("#fff3cf", 1.15);
key.position.set(1, 2, 2);
scene.add(key);
const camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.05, 10);
let current: THREE.Object3D | null = null;

function profileFor(a: ShowArgs, name: string): CharacterProfile {
  const b = ageBounds(a.race);
  return {
    name, race: a.race, subrace: a.subrace, className: "Warrior", palette: "ember", birthsign: null, level: 1, allocated: {},
    appearance: { body: "#4f8490", accent: "#dfaa55", height: 1.7, weight: 70, eyes: "#2f6fb5", sex: a.sex, age: a.age === "elder" ? Math.round(b.max * 0.95) : b.min + 2 },
  };
}

function show(a: ShowArgs): ShowResult {
  if (current) scene.remove(current);
  // A bald draw has nothing to show: walk a few deterministic name variants until one has hair.
  let rig = null as ReturnType<typeof buildPreviewRig>["rig"] | null;
  let used = a.name;
  let hair: THREE.Mesh[] = [];
  for (let k = 0; k < 12; k++) {
    used = k === 0 ? a.name : `${a.name} ${k}`;
    rig = buildPreviewRig(profileFor(a, used)).rig;
    hair = [];
    rig.group.traverse((o: THREE.Object3D) => { if (o instanceof THREE.Mesh && o.name.startsWith("hair-")) hair.push(o); });
    if (hair.length > 0) break;
  }
  if (!rig) return { ok: false, name: used, hairTris: 0, rigTris: 0, hairMeshes: 0, meshes: "", age: 0, hair: null };
  current = rig.group;
  rig.weaponNode.visible = false; // QA: the blade would hide the back of the head
  scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  const head = new THREE.Vector3();
  (hair[0]?.parent ?? rig.group).getWorldPosition(head);
  const box = new THREE.Box3();
  for (const m of hair) box.expandByObject(m);
  const centre = box.isEmpty() ? head.clone().add(new THREE.Vector3(0, 0.08, 0)) : box.getCenter(new THREE.Vector3());
  centre.y = Math.max(centre.y, head.y + 0.02);
  const dist = a.view === "detail" ? 0.5 : 0.78;
  const yaw = a.view === "front" || a.view === "detail" ? 0.35 : a.view === "back" ? Math.PI + 0.35 : a.view === "side" ? Math.PI / 2 : 0.9;
  camera.position.set(centre.x + Math.sin(yaw) * dist, centre.y + 0.12, centre.z + Math.cos(yaw) * dist);
  camera.lookAt(centre.x, centre.y - 0.04, centre.z);
  renderer.render(scene, camera);
  let hairTris = 0;
  for (const m of hair) hairTris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) / 3;
  const p = profileFor(a, used);
  return { ok: true, name: used, hairTris, rigTris: rig.triangleCount, hairMeshes: hair.length, meshes: hair.map((m) => m.name).join(","), age: p.appearance.age ?? 0, hair: (hair[0]?.userData.hair as Record<string, unknown>) ?? null };
}

(globalThis as unknown as Record<string, unknown>).__HAIRQA__ = { show };
