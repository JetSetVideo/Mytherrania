// QD (wave TEX closing): project the rig's REAL eye globes + lips into C's face close-up tile (r06f-final camera law,
// tools/capture-wave-tex.ts targets()/renderTile()) as QD's anatomical zones (eye = 1.3 globe radii, lips = 2.2 x 1.0
// globe radii, in the face plane at the feature's depth), so the DRAWN decals can be tested against the features in pixels.
//   deno run -A --config deno.json artifacts/wave-tex/verify-domain/face-project.ts > artifacts/wave-tex/verify-domain/r06f-final/face-project.json
// deno-lint-ignore-file no-explicit-any
import * as THREE from "three";
import { buildPreviewRig } from "../../../src/graphics/PreviewScene.ts";
import { raceBuild } from "../../../src/game/RaceAppearance.ts";
import * as HUD from "../../../src/graphics/CaptureHud.ts";
const TW = 420, TH = 560;
const out: any = {};
for (const race of ["human", "elf", "dwarf", "ork"]) for (const sex of ["male", "female"]) {
  const BASE: any = { male: { h: 1.75, w: 72 }, female: { h: 1.65, w: 60 } };
  const b = raceBuild(race, null);
  const appearance: any = { body: "", accent: "#dfaa55", height: +(BASE[sex].h * b.heightMul).toFixed(3), weight: +(BASE[sex].w * b.weightMul).toFixed(1), eyes: "#2f6fb5", sex, marks: { scars: [], tattoos: [] } };
  const profile: any = { name: "TEX " + race + " " + sex, race, subrace: null, className: "Warrior", palette: "ember", birthsign: null, level: 1, allocated: {}, appearance };
  const { rig } = buildPreviewRig(profile) as any;
  rig.weaponNode.parent?.remove(rig.weaponNode);
  rig.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig.group);
  const head = rig.bones.get("head").getWorldPosition(new THREE.Vector3());
  const faceR = Math.max(0.13, (box.max.y - head.y) * 0.75);
  const c = new THREE.Vector3(head.x, (head.y + box.max.y) / 2, head.z + 0.03);
  const a: any = HUD.CAPTURE_ANGLES.find((x: any) => x.id === "face");
  const cam = new THREE.PerspectiveCamera(24, TW / TH, 0.02, 10);
  const dir = new THREE.Vector3(...HUD.orbitDirection(a.yawDeg, a.pitchDeg));
  const dist = HUD.fitDistance(faceR, cam.fov * Math.min(1, TW / TH));
  cam.position.copy(c).addScaledVector(dir, dist); cam.lookAt(c); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const proj = (v: THREE.Vector3) => { const p = v.clone().project(cam); return [+((p.x + 1) / 2 * TW).toFixed(2), +((1 - p.y) / 2 * TH).toFixed(2)]; };
  const eyes: THREE.Vector3[] = []; let er = 0; let mouth: THREE.Vector3 | null = null; const lipPts: number[][] = [];
  rig.bones.get("head").traverse((o: any) => {
    if (!o.isMesh) return;
    const col = o.material?.color?.getHexString?.();
    if (o.geometry.type === "SphereGeometry" && col === "f6f1e6") { eyes.push(o.getWorldPosition(new THREE.Vector3())); er = o.geometry.parameters.radius; }
    if (o.geometry.type === "BoxGeometry" && col === "3a1210") mouth = o.getWorldPosition(new THREE.Vector3());
    if (o.geometry.type === "BoxGeometry" && ["9e3d3a", "3a1210", "b8504a"].includes(col)) {
      const p = o.geometry.attributes.position; // the drawn lip boxes: every corner projected (hull taken in face_hits.py)
      for (let k = 0; k < p.count; k++) lipPts.push(proj(new THREE.Vector3().fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld)));
    }
  });
  const zone = (cx: THREE.Vector3, rx: number, ry: number, z: number) => Array.from({ length: 32 }, (_, k) => {
    const t = k / 32 * Math.PI * 2; return proj(new THREE.Vector3(cx.x + rx * Math.cos(t), cx.y + ry * Math.sin(t), z));
  });
  const zones = [
    ...eyes.map((e, i) => ({ name: e.x > 0 ? "eyeL" : "eyeR", centre: proj(e), poly: zone(e, 1.3 * er, 1.3 * er, e.z + er), i })),
    ...(mouth ? [{ name: "mouth", centre: proj(mouth), poly: zone(mouth, 2.2 * er, 1.0 * er, (mouth as THREE.Vector3).z) }] : []),
  ];
  const mmPerPx = 2 * dist * Math.tan(12 * Math.PI / 180) * 1000 / TH;
  out[race + "-" + sex] = { lipPts, distM: +dist.toFixed(3), mmPerPx: +mmPerPx.toFixed(3), eyeRadiusMm: +(er * 1000).toFixed(1), zones };
}
console.log(JSON.stringify(out));
