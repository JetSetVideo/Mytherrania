// Weapon model (W06): a cel-shaded THREE mesh built from a WeaponSpec. One merged geometry,
// two draw calls (cel surface + inverted-hull outline), <= WEAPON_TRIANGLE_BUDGET triangles.
// Optional: the elemental effect shell of the legacy mesh (EffectShader) for the same
// setEffect(strength, time) API as WeaponMesh, so the model is a drop-in replacement.
//
// Frame: WEAPON LOCAL (contracts.ts): grip at the origin, +y toward the tip, +z = edge side.
// Mount the group on HumanoidRig.weaponNode's parent exactly where WeaponMesh.group goes.

// @deno-types="@types/three"
import * as THREE from "three";
import type { ArchetypeId, StrikeFeature, V3, WeaponSpec } from "../../combat/contracts.ts";
import type { Element } from "../../game/Skills.ts";
import { METALS, type MetalName } from "../../game/WeaponGen.ts";
import { toGeneratedWeapon } from "../../game/weapons/Adapter.ts";
import { ARCHETYPES } from "../../game/weapons/Archetypes.ts";
import { halberdBlade, halberdFluke } from "../../game/weapons/Features.ts";
import { WOODS, type WoodName } from "../../game/weapons/Form.ts";
import { axesOfSpec, weaponForm } from "../../game/weapons/Generate.ts";
import { createEffectShell, type EffectShell } from "../shaders/EffectShader.ts";
import { MeshKit } from "./MeshKit.ts";
import { createWeaponCelMaterial, createWeaponOutlineMaterial } from "./WeaponMaterial.ts";
import {
  axeBit, blade, blockZ, bowLimb, chain, flangedHead, fluke, haft, hammerHead, hilt, knob, langets, leafHead, maulBlock,
  rod, spearPoint, spikedBall, type WeaponPalette, wrap,
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

/** Blade flats sit this far from the metal's dark tone toward its blade tone (linear mix): one
 * value step under the bright edge band, so a blade reads as "flat + edge" instead of a white bar. */
export const FLAT_MIX = 0.6;
/** Haft wood is drawn at this share of the wood tone (linear): a dark stick under a bright head. */
export const HAFT_SHADE = 0.4;
/** Halberd top spike half-width, m (a flat diamond point, not a needle). */
export const HALBERD_SPIKE_HALF = 0.024;
/** Bow string radius, m: thicker than a real string (~2 mm) so it survives as a line at 7 m. */
export const BOW_STRING_RADIUS = 0.004;
/** Bow limbs at this share of the raw wood tone: darker than the ground, under a bright string. */
export const BOW_LIMB_SHADE = 0.7;
/** The axe haft/eye is drawn this far below the form's haft top, m (the shaft feature's end
 * point stays within its radius + 2 cm of the eye's top face; the stub above the top horn is
 * then 1-2 cm, too short to read as a poleaxe spike). */
export const AXE_TOP_TRIM = 0.012;

/**
 * Gameplay view the readability rules are written for (lane W2): the third-person camera
 * (SettingsPanel default fov 50 deg, vertical), a 577 CSS px tall viewport, the rival ~7 m away.
 * A feature reads when it spans >= minPx pixels: minFeatureSize() metres.
 */
export const GAMEPLAY_VIEW = { fovDeg: 50, heightPx: 577, distance: 7, minPx: 6 } as const;
/** Smallest feature size (m) that spans GAMEPLAY_VIEW.minPx at GAMEPLAY_VIEW.distance (~0.068 m). */
export function minFeatureSize(view: { fovDeg: number; heightPx: number; distance: number; minPx: number } = GAMEPLAY_VIEW): number {
  return (view.minPx * 2 * view.distance * Math.tan((view.fovDeg * Math.PI) / 360)) / view.heightPx;
}
/**
 * The part(s) that tell each archetype from the others at a distance (MeshKit part tags). The
 * staff's identity is the bare pole itself, so its rule is on the whole weapon.
 */
export const READABLE_PARTS: Record<ArchetypeId, readonly string[]> = {
  dagger: ["head", "guard"], shortsword: ["head", "guard"], sabre: ["head", "guard"], rapier: ["guard"],
  longsword: ["guard"], greatsword: ["guard"], spear: ["head"], halberd: ["head"], scythe: ["head"],
  staff: ["head", "haft"], axe: ["head"], greataxe: ["head"], mace: ["head"], flail: ["head", "chain"],
  warhammer: ["head"], maul: ["head"], bow: ["head", "string"],
};

/** The palette of a metal / fitting / wood / wrap choice (FLAT_MIX, HAFT_SHADE, BOW_LIMB_SHADE). */
export function paletteOf(metal: string | undefined, fitting: string | undefined, wood: WoodName, wrap: string): WeaponPalette {
  const m = METALS[metalOf(metal)], f = METALS[metalOf(fitting)];
  const w = new THREE.Color(WOODS[wood]);
  return {
    blade: new THREE.Color(m.blade), flat: new THREE.Color(m.dark).lerp(new THREE.Color(m.blade), FLAT_MIX),
    edge: new THREE.Color(m.highlight), dark: new THREE.Color(m.dark), fitting: new THREE.Color(f.blade),
    wood: w.clone().multiplyScalar(HAFT_SHADE), woodLight: w.clone().multiplyScalar(BOW_LIMB_SHADE),
    wrap: new THREE.Color(wrap), string: new THREE.Color("#f6efd8"),
  };
}

/** The palette of a spec: metal ramp (flat / blade / edge / dark), fitting, wood, grip wrap. */
export function weaponPalette(spec: WeaponSpec): WeaponPalette {
  const d = weaponForm(spec).details;
  return paletteOf(spec.metal, spec.fitting, d.wood, d.wrap);
}

/**
 * Emit the whole weapon into a MeshKit and return it (geometry not built yet). Triangles are
 * tagged (MeshKit.setPart): "head" = the striking part, "guard" = a sword's guard/hilt furniture,
 * "chain", "string", "haft" = everything else; the readability probe measures the tagged parts.
 */
export function weaponKit(spec: WeaponSpec): MeshKit {
  const kit = new MeshKit();
  const a = ARCHETYPES[spec.archetype];
  const form = weaponForm(spec);
  const axes = axesOfSpec(spec);
  const pal = weaponPalette(spec);
  const H = spec.headLength, R = axes.headRadius, sr = form.details.shaftRadius;
  const gripYs = spec.grips.map((g) => g.y);
  const hy = form.headCentreY;

  const head = () => kit.setPart("head");
  kit.setPart("haft");
  switch (a.head) {
    case "blade":
      hilt(kit, form, pal);
      head();
      blade(kit, form, pal);
      break;
    case "leaf":
      haft(kit, form, form.forward - H + 0.03, gripYs, pal);
      head();
      leafHead(kit, form, H, R, pal);
      break;
    case "halberd": {
      haft(kit, form, form.shaftTopY, gripYs, pal);
      head();
      const { height: bladeH, centreY: cy } = halberdBlade(form.forward, H);
      langets(kit, cy - 0.6 * bladeH - 0.1, form.shaftTopY + 0.01, sr, pal);
      // The halberd blade is riveted along the socket (no neck): a flared neck reads as a pennon.
      axeBit(kit, cy + 0.1 * bladeH, bladeH, R, spec.curvature, sr, pal, false);
      spearPoint(kit, form.shaftTopY, form.forward, HALBERD_SPIKE_HALF, pal);
      const hook = halberdFluke(form.forward, H, R, sr);
      fluke(kit, hook.base, hook.tip, 0.12 * bladeH, pal);
      break;
    }
    case "scythe":
      haft(kit, form, form.shaftTopY, gripYs, pal);
      head();
      rod(kit, form.shaftTopY - 0.07, form.shaftTopY + 0.005, sr * 1.25, sr * 1.25, pal.dark, { segs: 6, end: true, specular: 0.85 });
      blade(kit, form, pal);
      break;
    case "axe": {
      // No eye block, no poll lug, no wooden stub: at 7 m any mass behind or above the bit turns
      // the axe into a hammer, a pick or a poleaxe. A thin iron band caps the haft just above the
      // top horn; the poll head feature (Features.ts, a blunt back strike) is not drawn.
      const top = form.shaftTopY - AXE_TOP_TRIM;
      haft(kit, form, top - 0.012, gripYs, pal);
      rod(kit, top - 0.012, top, sr * 1.08, sr * 1.08, pal.dark, { segs: 6, end: true, specular: 0.85 });
      head();
      axeBit(kit, hy, H, R, spec.curvature, sr - 0.002, pal, false);
      break;
    }
    case "flanged":
      haft(kit, form, hy - H / 2, gripYs, pal);
      langets(kit, hy - H / 2 - 0.025, hy - H / 2 + 0.002, sr, pal);
      head();
      flangedHead(kit, hy, H, R, form.details.flangeCount || 6, pal);
      break;
    case "ball": {
      haft(kit, form, form.shaftTopY, gripYs, pal);
      knob(kit, form.shaftTopY, sr * 1.25, pal.dark);
      kit.setPart("chain");
      chain(kit, form.shaftTopY + sr, hy - 0.72 * R, pal);
      head();
      spikedBall(kit, hy, R, pal);
      break;
    }
    case "hammer":
      haft(kit, form, hy + H / 2, gripYs, pal);
      langets(kit, hy - H / 2 - 0.12, hy - H / 2 + 0.005, sr, pal);
      head();
      hammerHead(kit, hy, H, R, sr, spec.curvature, pal);
      break;
    case "block":
      haft(kit, form, hy, gripYs, pal);
      langets(kit, hy - H / 2 - 0.08, hy - H / 2 + 0.002, sr, pal);
      head();
      maulBlock(kit, hy, H, R, pal);
      break;
    case "ferrule": {
      rod(kit, -form.tail + 0.08, form.forward - 0.08, sr, sr, pal.wood, { segs: 8 });
      head();
      rod(kit, form.forward - 0.08, form.forward, sr * 1.18, sr * 1.1, pal.blade, { segs: 8, end: true, specular: 0.85 });
      rod(kit, -form.tail, -form.tail + 0.08, sr * 1.1, sr * 1.18, pal.blade, { segs: 8, start: true, specular: 0.85 });
      kit.setPart("haft");
      for (const y of gripYs) wrap(kit, y, sr, pal);
      break;
    }
    default: {
      // Bow: riser + two limbs + horn nocks + the string between the tips (z = -brace side).
      const half = spec.length / 2;
      blockZ(kit, 0, -0.012, 0.02, 0.016, 0.08, pal.wrap, 0);
      head();
      const upTip = bowLimb(kit, half, form.braceHeight, spec.curvature, 1, pal);
      const downTip = bowLimb(kit, half, form.braceHeight, spec.curvature, -1, pal);
      knob(kit, upTip, 0.009, pal.string, 0);
      knob(kit, downTip, 0.009, pal.string, 0);
      kit.setSpecular(0);
      kit.setPart("string");
      const ring = (p: V3) => ({ pts: MeshKit.circle(p, [1, 0, 0], [0, 0, 1], BOW_STRING_RADIUS, BOW_STRING_RADIUS, 3), centre: p, colors: pal.string });
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
