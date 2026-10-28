// Weapon model (W06): a cel-shaded THREE mesh built from a WeaponSpec. One merged geometry,
// two draw calls (cel surface + inverted-hull outline), <= WEAPON_TRIANGLE_BUDGET triangles.
// Optional: the elemental effect shell of the legacy mesh (EffectShader) for the same
// setEffect(strength, time) API as WeaponMesh, so the model is a drop-in replacement.
//
// Frame: WEAPON LOCAL (contracts.ts): grip at the origin, +y toward the tip, +z = edge side.
// Mount the group on HumanoidRig.weaponNode's parent exactly where WeaponMesh.group goes.

// @deno-types="@types/three"
import * as THREE from "three";
import type { StrikeFeature, V3, WeaponSpec } from "../../combat/contracts.ts";
import type { Element } from "../../game/Skills.ts";
import { METALS, type MetalName } from "../../game/WeaponGen.ts";
import { toGeneratedWeapon } from "../../game/weapons/Adapter.ts";
import { ARCHETYPES } from "../../game/weapons/Archetypes.ts";
import { axePollRadius, halberdBlade, halberdFluke } from "../../game/weapons/Features.ts";
import { WOODS } from "../../game/weapons/Form.ts";
import { axesOfSpec, weaponForm } from "../../game/weapons/Generate.ts";
import { createEffectShell, type EffectShell } from "../shaders/EffectShader.ts";
import { MeshKit } from "./MeshKit.ts";
import { createWeaponCelMaterial, createWeaponOutlineMaterial } from "./WeaponMaterial.ts";
import {
  axeBit, blade, blockZ, bowLimb, chain, flangedHead, haft, hammerHead, hilt, knob, leafHead, maulBlock, rod,
  spike, spikedBall, type WeaponPalette, wrap,
} from "./WeaponParts.ts";

/** Triangle budget per weapon (R13: a weapon is a prop, not a character). */
export const WEAPON_TRIANGLE_BUDGET = 600;

/** The built model. */
export interface WeaponModel {
  group: THREE.Group;
  surface: THREE.Mesh;
  outline: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  triangleCount: number;
  /** Draw calls of the weapon itself (surface + outline); the optional shell is extra. */
  drawCalls: number;
  /** Flare the elemental effect (no-op without an element). `strength` 0..1.6, `time` s. */
  setEffect(strength: number, time: number): void;
  dispose(): void;
}

export interface WeaponModelOptions {
  /** Adds the elemental effect shell (EffectShader) driven by setEffect. */
  element?: Element;
  /** Ink width in view space, m (WeaponMaterial.WEAPON_OUTLINE_WIDTH by default). */
  outlineWidth?: number;
}

const metalOf = (name: string | undefined): MetalName =>
  name && Object.prototype.hasOwnProperty.call(METALS, name) ? name as MetalName : "steel";

/** The palette of a spec: metal ramp, fitting, wood, grip wrap. */
export function weaponPalette(spec: WeaponSpec): WeaponPalette {
  const form = weaponForm(spec);
  const m = METALS[metalOf(spec.metal)], f = METALS[metalOf(spec.fitting)];
  return {
    blade: new THREE.Color(m.blade), edge: new THREE.Color(m.highlight), dark: new THREE.Color(m.dark),
    fitting: new THREE.Color(f.blade), wood: new THREE.Color(WOODS[form.details.wood]),
    wrap: new THREE.Color(form.details.wrap), string: new THREE.Color("#f6efd8"),
  };
}

/** Emit the whole weapon into a MeshKit and return it (geometry not built yet). */
export function weaponKit(spec: WeaponSpec): MeshKit {
  const kit = new MeshKit();
  const a = ARCHETYPES[spec.archetype];
  const form = weaponForm(spec);
  const axes = axesOfSpec(spec);
  const pal = weaponPalette(spec);
  const H = spec.headLength, R = axes.headRadius, sr = form.details.shaftRadius;
  const gripYs = spec.grips.map((g) => g.y);
  const hy = form.headCentreY;

  switch (a.head) {
    case "blade":
      hilt(kit, form, pal);
      blade(kit, form, pal);
      break;
    case "leaf":
      haft(kit, form, form.forward - H + 0.03, gripYs, pal);
      leafHead(kit, form, H, R, pal);
      break;
    case "halberd": {
      haft(kit, form, form.shaftTopY, gripYs, pal);
      const { height: bladeH, centreY: cy } = halberdBlade(form.forward, H);
      rod(kit, cy - 0.6 * bladeH, form.shaftTopY + 0.01, sr * 1.2, sr * 1.2, pal.dark, { segs: 6, end: true, specular: 0.85 });
      axeBit(kit, cy + 0.1 * bladeH, bladeH, R, spec.curvature, sr, pal);
      spike(kit, [0, form.shaftTopY, 0], [1, 0, 0], [0, 0, 1], 0.016, [0, form.forward, 0], pal.edge);
      const fluke = halberdFluke(form.forward, H, R, sr);
      spike(kit, fluke.base, [1, 0, 0], [0, 1, 0], 0.012, fluke.tip, pal.edge);
      break;
    }
    case "scythe":
      haft(kit, form, form.shaftTopY, gripYs, pal);
      rod(kit, form.shaftTopY - 0.07, form.shaftTopY + 0.005, sr * 1.25, sr * 1.25, pal.dark, { segs: 6, end: true, specular: 0.85 });
      blade(kit, form, pal);
      break;
    case "axe": {
      haft(kit, form, form.shaftTopY, gripYs, pal);
      const poll = axePollRadius(H);
      blockZ(kit, hy, -(sr + 2 * poll), sr + 0.012, 0.016, 0.3 * H, pal.dark);
      axeBit(kit, hy, H, R, spec.curvature, sr + 0.012, pal);
      knob(kit, form.shaftTopY, sr * 1.05, pal.wood, 0);
      break;
    }
    case "flanged":
      haft(kit, form, hy - H / 2, gripYs, pal);
      rod(kit, hy - H / 2 - 0.04, hy - H / 2, sr * 1.3, sr * 1.3, pal.dark, { segs: 6, start: true, specular: 0.85 });
      flangedHead(kit, hy, H, R, form.details.flangeCount || 6, pal);
      break;
    case "ball": {
      haft(kit, form, form.shaftTopY, gripYs, pal);
      knob(kit, form.shaftTopY, sr * 1.25, pal.dark);
      chain(kit, form.shaftTopY + sr, hy - 0.72 * R, pal);
      spikedBall(kit, hy, R, form.details.flangeCount || 6, pal);
      break;
    }
    case "hammer":
      haft(kit, form, hy + H / 2, gripYs, pal);
      hammerHead(kit, hy, H, R, sr, spec.curvature, pal);
      break;
    case "block":
      haft(kit, form, hy, gripYs, pal);
      maulBlock(kit, hy, H, R, pal);
      break;
    case "ferrule": {
      rod(kit, -form.tail + 0.08, form.forward - 0.08, sr, sr, pal.wood, { segs: 8 });
      rod(kit, form.forward - 0.08, form.forward, sr * 1.18, sr * 1.1, pal.blade, { segs: 8, end: true, specular: 0.85 });
      rod(kit, -form.tail, -form.tail + 0.08, sr * 1.1, sr * 1.18, pal.blade, { segs: 8, start: true, specular: 0.85 });
      for (const y of gripYs) wrap(kit, y, sr, pal);
      break;
    }
    default: {
      // Bow: riser + two limbs + the string between the tips (z = -brace side).
      const half = spec.length / 2;
      blockZ(kit, 0, -0.012, 0.02, 0.016, 0.08, pal.wrap, 0);
      const upTip = bowLimb(kit, half, form.braceHeight, spec.curvature, 1, pal);
      const downTip = bowLimb(kit, half, form.braceHeight, spec.curvature, -1, pal);
      kit.setSpecular(0);
      const ring = (p: V3) => ({ pts: MeshKit.circle(p, [1, 0, 0], [0, 0, 1], 0.0025, 0.0025, 3), centre: p, colors: pal.string });
      kit.tube([ring(downTip), ring(upTip)]);
    }
  }
  return kit;
}

/** Build only the merged geometry (headless-safe; used by tests and tooling). */
export function buildWeaponGeometry(spec: WeaponSpec): { geometry: THREE.BufferGeometry; triangleCount: number } {
  const kit = weaponKit(spec);
  return { geometry: kit.build(), triangleCount: kit.triangleCount };
}

/** Build the cel model: one geometry, two draw calls (+ an optional effect shell). */
export function buildWeaponModel(spec: WeaponSpec, opts: WeaponModelOptions = {}): WeaponModel {
  const { geometry, triangleCount } = buildWeaponGeometry(spec);
  const surface = new THREE.Mesh(geometry, createWeaponCelMaterial());
  surface.name = "weapon-surface";
  const outline = new THREE.Mesh(geometry, createWeaponOutlineMaterial(opts.outlineWidth));
  outline.name = "weapon-outline";
  outline.castShadow = false; // R13: outlines stay out of the shadow pass
  const group = new THREE.Group();
  group.name = `weapon:${spec.id}`;
  group.add(surface, outline);
  let shell: EffectShell | null = null;
  if (opts.element) {
    shell = createEffectShell(toGeneratedWeapon(spec), opts.element);
    group.add(shell.group);
  }
  return {
    group, surface, outline, geometry, triangleCount, drawCalls: 2,
    setEffect(strength, time) { shell?.set(strength, time); },
    dispose() {
      geometry.dispose();
      (surface.material as THREE.Material).dispose();
      (outline.material as THREE.Material).dispose();
    },
  };
}

/** QA colours per feature kind. */
export const FEATURE_LINE_COLORS: Record<StrikeFeature["kind"], string> = {
  edge: "#ff3b30", point: "#ffd60a", head: "#32d2ff", shaft: "#9aa0a6",
};

/**
 * Debug helper: the strike features as THREE.Line objects in weapon local space (add the group
 * under the weapon node). Edges/shafts: their polyline; points: a 6 cm stub along the thrust
 * axis; heads: three great circles of the head sphere.
 */
export function strikeFeatureLines(spec: WeaponSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = "strike-features";
  for (const f of spec.features) {
    const mat = new THREE.LineBasicMaterial({ color: FEATURE_LINE_COLORS[f.kind], depthTest: false });
    let pts: THREE.Vector3[];
    if (f.kind === "point") {
      const p = f.points[0], d = f.facing ?? [0, 1, 0];
      pts = [new THREE.Vector3(p[0] - d[0] * 0.06, p[1] - d[1] * 0.06, p[2] - d[2] * 0.06), new THREE.Vector3(...p)];
    } else if (f.kind === "head") {
      const c = f.points[0];
      for (const plane of [0, 1, 2]) {
        const ring: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2, u = Math.cos(a) * f.radius, v = Math.sin(a) * f.radius;
          ring.push(new THREE.Vector3(c[0] + (plane === 0 ? 0 : u), c[1] + (plane === 1 ? 0 : plane === 0 ? u : v), c[2] + (plane === 2 ? 0 : v)));
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), mat);
        line.name = `feature-head-${plane}`;
        line.renderOrder = 10;
        g.add(line);
      }
      continue;
    } else {
      pts = f.points.map((p) => new THREE.Vector3(...p));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    line.name = `feature-${f.kind}`;
    line.renderOrder = 10;
    g.add(line);
  }
  return g;
}
