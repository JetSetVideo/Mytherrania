// @deno-types="@types/three"
import * as THREE from "three";
import { createCelMesh, SPECULAR_METAL } from "./shaders/CelShader.ts";
import { createEffectShell, type EffectShell } from "./shaders/EffectShader.ts";
import type { GeneratedWeapon, WeaponPart } from "../game/WeaponGen.ts";
import type { Element } from "../game/Skills.ts";

export interface WeaponMesh {
  group: THREE.Group;
  /** Flare the elemental effect. `strength` 0..1.6, `time` in seconds. */
  setEffect(strength: number, time: number): void;
  triangleCount: number;
}

function partGeometry(p: WeaponPart): THREE.BufferGeometry {
  switch (p.shape) {
    case "cyl": return new THREE.CylinderGeometry(p.w / 2, p.w / 2, p.h, 10);
    case "cone": return new THREE.ConeGeometry(p.w / 2, p.h, 6);
    default: return new THREE.BoxGeometry(p.w, p.h, p.d);
  }
}

/**
 * Build the weapon mesh from the generator's part list. Parts are laid out along
 * the weapon's own +y axis, measured from the grip; `bend` shifts a part
 * sideways (curved blades) and `radial` places it around the axis (mace flanges).
 */
export function buildWeaponMesh(weapon: GeneratedWeapon, element: Element): WeaponMesh {
  const group = new THREE.Group();
  let tris = 0;
  for (const p of weapon.parts) {
    const geo = partGeometry(p);
    tris += geo.index ? geo.index.count / 3 : (geo.getAttribute("position")?.count ?? 0) / 3;
    // Metal parts (blade, head, guard, pommel, limb) get a specular highlight; the
    // leather grip stays matte.
    const shiny = p.kind === "shaft" || p.kind === "string" ? 0 : SPECULAR_METAL;
    const mesh = createCelMesh(geo, p.color, shiny);
    mesh.position.set(0, p.y, 0);
    if (p.bend) mesh.position.z = p.bend;
    if (p.sway) mesh.position.x = p.sway;
    // A bow's limbs must ROTATE into an arc about z, and sway in x, so the curve
    // faces the viewer. Offsetting them in depth leaves the bow edge-on.
    if (p.tilt) mesh.rotation.z = p.tilt;
    if (p.radial !== undefined) {
      mesh.position.x = Math.cos(p.radial) * 0.11;
      mesh.position.z = Math.sin(p.radial) * 0.11;
    }
    group.add(mesh);
  }
  const shell: EffectShell = createEffectShell(weapon, element);
  group.add(shell.group);
  return {
    group,
    triangleCount: tris,
    setEffect(strength, time) { shell.set(strength, time); },
  };
}
