// @deno-types="@types/three"
import * as THREE from "three";
import { buildHumanoid } from "./Humanoid.ts";
import { createFighter } from "../game/Fighter.ts";
import { skillsForClass } from "../game/Skills.ts";
import { generateClassWeapon } from "../game/WeaponGen.ts";
import type { CharacterProfile } from "../game/Characters.ts";

const PLAYER_RADIUS = 0.5;

// Renders a small portrait (128x128) of a character's upper body
// and returns a data-URL PNG.
export function renderPortrait(profile: CharacterProfile): string {
  const size = 128;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.setClearColor("#172128");

  const scene = new THREE.Scene();
  const ambient = new THREE.AmbientLight("#e8dcc8", 0.8);
  const key = new THREE.DirectionalLight("#fff3cf", 1.2);
  key.position.set(1, 2, 2);
  const rim = new THREE.DirectionalLight("#dfaa55", 0.5);
  rim.position.set(-1, 0.5, -0.5);
  scene.add(ambient, key, rim);

  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  cam.position.set(0, 0.35, 1.3);
  cam.lookAt(0, 0.2, 0);

  const fighter = createFighter(profile.className, profile.name, 0, 0, PLAYER_RADIUS,
    profile.race, profile.subrace, profile.weaponType);
  const skills = skillsForClass(fighter.className);
  const rig = buildHumanoid(generateClassWeapon(fighter.className), profile.appearance, skills[0].element);
  scene.add(rig.group);
  rig.update(fighter.skeleton, 0);
  // Pose: slight lean forward, face camera
  rig.group.position.set(0, -0.1, 0);
  rig.group.rotation.y = 0;

  renderer.render(scene, cam);

  const dataUrl = renderer.domElement.toDataURL("image/png");

  renderer.dispose();
  // Clean up: Three.js doesn't auto-dispose child geometry/materials,
  // but for an offscreen one-shot this is acceptable.
  return dataUrl;
}