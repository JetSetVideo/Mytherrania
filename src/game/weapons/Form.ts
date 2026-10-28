// Weapon form (W06): the geometry and the mass layout of one weapon, DERIVED from its physical
// axes. One function (buildForm) is shared by the generator (to compute balance and inertia),
// the strike features and the mesh, so the collision shape, the physics and the picture can
// never disagree. Pure module: no THREE, no DOM.
//
// Frame (contracts.ts): metres, +y from the main grip toward the striking end, main grip centre
// at the origin, +z = the side the primary edge / striking face looks at, +x = the flat.
//
// Mass model: a weapon is a few PARTS, each a uniform rod, a tapered rod (blade) or a lump.
// Some parts have masses fixed by geometry and density (a wooden haft, a grip); two "tunable"
// parts (FORE: blade or head, AFT: pommel or butt) share what is left of the total mass. Their
// split is SOLVED so the centre of mass lands on the sampled balance:
//     M * b = S_fixed + R * (s * y_fore + (1 - s) * y_aft)        (R = M - fixed mass)
//  => s = (M * b - S_fixed - R * y_aft) / (R * (y_fore - y_aft)),   clamped to the family's band.
// The moment of inertia about the swing axis through the grip (local x) is then
//     I = sum_i m_i * k2_i,   k2 = mean of (y^2 + z^2) over the part (its second moment per kg).

import type { ArchetypeId, GripPoint, V3 } from "../../combat/contracts.ts";
import { clamp, clamp01, invLerp, lerp, smoothstep } from "../../core/MathCore.ts";
import { ARCHETYPES, type AxisRange, type HeadStyle, type WeaponFamily } from "./Archetypes.ts";

/** The seven sampled axes of one weapon (see Archetypes.ts for definitions and units). */
export interface PhysicalAxes {
  length: number;
  mass: number;
  headLength: number;
  sharpness: number;
  curvature: number;
  headRadius: number;
  /** Centre of mass / forward length (main grip -> tip). */
  balanceFraction: number;
}

/** Half a palm width, m: the main grip centre sits this far below a guard (palm ~0.09 m). */
export const HAND_HALF_WIDTH = 0.045;
/** The off hand keeps this clearance from a butt end, m. */
export const BUTT_MARGIN = 0.05;
/** Shortest tail that fits two hands behind the main grip: two half palms + clearance, m. */
export const MIN_TWO_HAND_TAIL = 2 * HAND_HALF_WIDTH + BUTT_MARGIN;
/** Hand spread on a spear or staff (about shoulder width), m. */
export const POLE_HAND_SPREAD = 0.5;
/** Steel density, kg/m^3. */
export const STEEL_DENSITY = 7850;
/** Seasoned ash / hickory haft density, kg/m^3 (ash 650-700, hickory ~800). */
export const WOOD_DENSITY = 700;
/** Linear density of a sword grip, kg/m: a 28 mm wood-and-leather grip (~0.43) around a tang (~0.47). */
export const GRIP_LINEAR_DENSITY = 0.9;
/** Distal + profile taper: blade linear density at the tip is (1 - BLADE_TAPER) of the base. */
export const BLADE_TAPER = 0.6;
/** A lens/diamond section fills about this share of its width x thickness rectangle. */
export const BLADE_SECTION_FILL = 0.55;
/** Share of the blade length given to the final point taper. */
export const POINT_FRACTION = 0.12;
/** Blade half-width just before the point, as a share of the base half-width. */
export const TIP_WIDTH_RATIO = 0.62;
/** Haft left above an axe/hammer head, m (the head is wedged, not flush). */
export const HEAD_TOP_MARGIN = 0.02;
/** Chain linear density of a flail, kg/m. */
export const CHAIN_LINEAR_DENSITY = 0.5;
/** Riser share of a bow's mass (grip + arrow shelf). */
export const BOW_RISER_SHARE = 0.35;
/** Scythe blade start angle from the snath at curvature 0 and 1, rad (war scythe -> reaper). */
export const SCYTHE_START_ANGLE: AxisRange = { min: 0.1, max: 0.5 };
/** Scythe blade bend at curvature 1, rad: limited so the mean edge facing keeps +z > 0.5. */
export const SCYTHE_MAX_BEND = 0.9;

/** Half length of a bow's riser (the rigid grip section), m. */
export const BOW_RISER_HALF = 0.07;
/** Forward flip of a recurve tip at curvature 1, m. */
export const BOW_RECURVE_FLIP = 0.06;

/**
 * Point on a bow limb at t in [0, 1] (riser -> tip); sign +1 = upper limb, -1 = lower. The limb
 * bends back toward the archer (-z) as t^1.6 so the tips sit `brace` behind the grip, where the
 * string runs; a recurve flips the last 30% forward again.
 */
export function bowLimbPoint(half: number, brace: number, recurve: number, sign: 1 | -1, t: number): V3 {
  return [
    0,
    sign * (BOW_RISER_HALF + (half - BOW_RISER_HALF) * t),
    -brace * Math.pow(t, 1.6) + recurve * BOW_RECURVE_FLIP * smoothstep(0.7, 1, t),
  ];
}

/** Handle and haft colours (wood) and grip wraps, by name. */
export const WOODS = { ash: "#b08d5f", yew: "#c8743f", oak: "#8a6a43", hickory: "#a77d4f", ebony: "#3a2c24" } as const;
export type WoodName = keyof typeof WOODS;
export const GRIP_WRAPS = ["#4a2f1b", "#5a3b22", "#2f3a2a", "#3a2f4a", "#1b181f", "#6b2a22"] as const;

/** One part of the mass model. */
export interface MassPart {
  name: string;
  mass: number;
  /** Centre of mass of the part (local y, z), m. */
  y: number;
  z: number;
  /** Second moment per kg about the grip's swing axis (local x), m^2. */
  k2: number;
}

/** Choices that only shape the look (drawn from a separate seeded stream). */
export interface FormDetails {
  wood: WoodName;
  wrap: string;
  /** Guard half span, m (blades). */
  guardHalfSpan: number;
  /** Haft radius, m (hafted, polearm, flail, staff, bow limbs). */
  shaftRadius: number;
  /** Mace flanges / flail spikes. */
  flangeCount: number;
}

/** Everything the features and the mesh need: positions along +y, sizes, masses. */
export interface WeaponForm {
  archetype: ArchetypeId;
  family: WeaponFamily;
  head: HeadStyle;
  /** Length behind the main grip (the butt/pommel end is at y = -tail), m. */
  tail: number;
  /** Length in front of the main grip along the weapon (blade arc for curved blades), m. */
  forward: number;
  details: FormDetails;
  // --- hilt (blades) ---
  handleLength: number;
  guardY: number;
  guardThickness: number;
  pommelY: number;
  pommelRadius: number;
  // --- blade (blade family, scythe) ---
  bladeBaseY: number;
  bladeLength: number;
  bladeHalfWidth: number;
  bladeThickness: number;
  /** Direction of the blade at its base, rad from +y toward +z. */
  bladeStartAngle: number;
  /** Signed total turn of the blade, rad (negative = bends toward -z, the spine side). */
  bladeTurn: number;
  singleEdged: boolean;
  fullered: boolean;
  // --- haft and head ---
  shaftBottomY: number;
  shaftTopY: number;
  headCentreY: number;
  /** Head centre offset along z (axe/halberd head mass sits toward the bit). */
  headCentreZ: number;
  // --- bow ---
  braceHeight: number;
  // --- mass model ---
  parts: MassPart[];
  /** Centre of mass along +y (m) and moment of inertia about the grip (kg m^2). */
  balance: number;
  inertia: number;
}

const rod = (name: string, mass: number, y0: number, y1: number, z = 0): MassPart => ({
  name, mass, y: (y0 + y1) / 2, z, k2: (y0 * y0 + y0 * y1 + y1 * y1) / 3 + z * z,
});
const lump = (name: string, mass: number, y: number, z: number, radius: number): MassPart => ({
  name, mass, y, z, k2: y * y + z * z + 0.4 * radius * radius,
});

/** Mean arc position and mean squared arc position (per unit length^1, ^2) of a tapered rod. */
const TAPER_MEAN = (0.5 - BLADE_TAPER / 3) / (1 - BLADE_TAPER / 2);
const TAPER_MEAN_SQ = (1 / 3 - BLADE_TAPER / 4) / (1 - BLADE_TAPER / 2);

/** Tail (behind the grip) for the family; blades derive it from the hilt. */
export function tailLength(id: ArchetypeId, axes: PhysicalAxes): number {
  const a = ARCHETYPES[id];
  if (a.hilt) {
    const handle = axes.length - axes.headLength - a.hilt.guardThickness - a.hilt.pommelLength;
    return handle + a.hilt.pommelLength - HAND_HALF_WIDTH;
  }
  const h = a.haft!;
  const t = h.tailFraction * axes.length;
  return a.hands === 2 && a.family !== "bow" ? Math.max(t, MIN_TWO_HAND_TAIL) : Math.max(t, BUTT_MARGIN);
}

/** Forward length (main grip -> tip, along the weapon), m. balanceFraction is relative to it. */
export function forwardLength(id: ArchetypeId, axes: PhysicalAxes): number {
  return axes.length - tailLength(id, axes);
}

/** Blade direction angle (rad from +y toward +z) at arc length s. */
export function bladeAngleAt(form: WeaponForm, s: number): number {
  return form.bladeStartAngle + form.bladeTurn * clamp01(s / Math.max(1e-6, form.bladeLength));
}

/** Point on the blade centreline at arc length s from the blade base, written into `out`. */
export function bladePointAt(form: WeaponForm, s: number, out: V3): V3 {
  const phi0 = form.bladeStartAngle;
  const k = form.bladeTurn / Math.max(1e-6, form.bladeLength); // signed curvature, 1/m
  if (Math.abs(k) < 1e-6) {
    out[0] = 0; out[1] = form.bladeBaseY + s * Math.cos(phi0); out[2] = s * Math.sin(phi0);
    return out;
  }
  const phi = phi0 + k * s;
  out[0] = 0;
  out[1] = form.bladeBaseY + (Math.sin(phi) - Math.sin(phi0)) / k;
  out[2] = -(Math.cos(phi) - Math.cos(phi0)) / k;
  return out;
}

/** Unit normal on the EDGE side at arc length s: tangent turned +90 deg about +x (= +z at angle 0). */
export function bladeEdgeNormalAt(form: WeaponForm, s: number, out: V3): V3 {
  const phi = bladeAngleAt(form, s);
  out[0] = 0; out[1] = -Math.sin(phi); out[2] = Math.cos(phi);
  return out;
}

/** Unit tangent of the blade at arc length s. */
export function bladeTangentAt(form: WeaponForm, s: number, out: V3): V3 {
  const phi = bladeAngleAt(form, s);
  out[0] = 0; out[1] = Math.cos(phi); out[2] = Math.sin(phi);
  return out;
}

/**
 * Blade half-width at arc length s: tapers linearly from headRadius to TIP_WIDTH_RATIO of it,
 * then closes to 0 over the last POINT_FRACTION (the point).
 */
export function bladeHalfWidthAt(form: WeaponForm, s: number): number {
  const t = clamp01(s / Math.max(1e-6, form.bladeLength));
  const shoulder = 1 - POINT_FRACTION;
  const atShoulder = form.bladeHalfWidth * TIP_WIDTH_RATIO;
  if (t <= shoulder) return lerp(form.bladeHalfWidth, atShoulder, t / shoulder);
  return atShoulder * (1 - (t - shoulder) / POINT_FRACTION);
}

/** Solve the FORE/AFT split so the centre of mass lands on `targetBalance` (see header). */
function solveSplit(
  fixedParts: MassPart[], fore: MassPart, aft: MassPart, mass: number, targetBalance: number,
  band: AxisRange,
): MassPart[] {
  let fixedMass = 0, fixedMoment = 0;
  for (const p of fixedParts) { fixedMass += p.mass; fixedMoment += p.mass * p.y; }
  // Fixed parts may never eat the whole budget: scale them to at most 85% of the mass.
  const cap = 0.85 * mass;
  if (fixedMass > cap) {
    const k = cap / fixedMass;
    for (const p of fixedParts) p.mass *= k;
    fixedMoment *= k; fixedMass = cap;
  }
  const rest = mass - fixedMass;
  const span = fore.y - aft.y;
  const s = clamp((mass * targetBalance - fixedMoment - rest * aft.y) / (rest * span), band.min, band.max);
  fore.mass = rest * s;
  aft.mass = rest * (1 - s);
  return [...fixedParts, fore, aft];
}

/** Pick from a list with a uniform draw. */
function pick<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))];
}

/** The look-only choices, from a stream seeded by the weapon seed (stable for one seed). */
export function formDetails(id: ArchetypeId, axes: PhysicalAxes, rng: () => number): FormDetails {
  const a = ARCHETYPES[id];
  const massT = clamp01(invLerp(a.axes.mass.min, a.axes.mass.max, axes.mass));
  const woods = Object.keys(WOODS) as WoodName[];
  const wood = pick(woods, rng());
  const wrap = pick(GRIP_WRAPS, rng());
  const g = a.hilt?.guardHalfSpan ?? { min: 0, max: 0 };
  const guardHalfSpan = lerp(g.min, g.max, rng());
  const sr = a.haft?.shaftRadius ?? { min: 0.014, max: 0.014 };
  // Heavier weapons get thicker hafts: 60% follows the mass, 40% free.
  const shaftRadius = lerp(sr.min, sr.max, clamp01(0.6 * massT + 0.4 * rng()));
  const flangeCount = a.head === "flanged" ? (rng() < 0.5 ? 6 : 8) : a.head === "ball" ? 6 : 0;
  return { wood, wrap, guardHalfSpan, shaftRadius, flangeCount };
}

/**
 * Build the form: positions, sizes, the part masses solved for the target balance, and the
 * resulting balance and inertia. `axes.balanceFraction` is the TARGET; form.balance is the
 * achieved value (equal unless the split hit its band).
 */
export function buildForm(id: ArchetypeId, axes: PhysicalAxes, details: FormDetails): WeaponForm {
  const a = ARCHETYPES[id];
  const L = axes.length, M = axes.mass, H = axes.headLength, R = axes.headRadius;
  const tail = tailLength(id, axes);
  const forward = L - tail;
  const target = axes.balanceFraction * forward;
  const f: WeaponForm = {
    archetype: id, family: a.family, head: a.head, tail, forward, details,
    handleLength: 0, guardY: 0, guardThickness: 0, pommelY: 0, pommelRadius: 0,
    bladeBaseY: 0, bladeLength: 0, bladeHalfWidth: 0, bladeThickness: 0, bladeStartAngle: 0,
    bladeTurn: 0, singleEdged: false, fullered: false,
    shaftBottomY: -tail, shaftTopY: forward, headCentreY: 0, headCentreZ: 0, braceHeight: 0,
    parts: [], balance: 0, inertia: 0,
  };
  const sr = details.shaftRadius;
  const haftMass = (y0: number, y1: number) => {
    const raw = WOOD_DENSITY * Math.PI * sr * sr * (y1 - y0);
    const share = a.haft!.haftShare;
    return clamp(raw, share.min * M, share.max * M);
  };

  if (a.family === "blade") {
    const h = a.hilt!;
    f.handleLength = L - H - h.guardThickness - h.pommelLength;
    f.guardY = HAND_HALF_WIDTH;
    f.guardThickness = h.guardThickness;
    f.pommelY = HAND_HALF_WIDTH - f.handleLength - h.pommelLength / 2;
    f.bladeBaseY = HAND_HALF_WIDTH + h.guardThickness;
    f.bladeLength = H;
    f.bladeHalfWidth = R;
    f.bladeTurn = -axes.curvature * h.maxBend; // curves toward the spine (-z): convex edge
    f.singleEdged = h.singleEdged;
    f.fullered = h.fullered;
    f.shaftBottomY = HAND_HALF_WIDTH - f.handleLength;
    f.shaftTopY = HAND_HALF_WIDTH;
    const grip = rod("grip", GRIP_LINEAR_DENSITY * f.handleLength, f.shaftBottomY, f.shaftTopY);
    const guard = lump("guard", h.guardShare * M, f.guardY + h.guardThickness / 2, 0, 0);
    const p = bladePointAt(f, H * TAPER_MEAN, [0, 0, 0]);
    const b0 = f.bladeBaseY;
    const blade: MassPart = {
      name: "blade", mass: 0, y: p[1], z: p[2],
      k2: b0 * b0 + 2 * b0 * H * TAPER_MEAN + H * H * TAPER_MEAN_SQ + p[2] * p[2],
    };
    const pommel = lump("pommel", 0, f.pommelY, 0, h.pommelLength / 2);
    f.parts = solveSplit([grip, guard], blade, pommel, M, target, { min: 0.3, max: 0.97 });
    const pm = f.parts.find((q) => q.name === "pommel")!.mass;
    f.pommelRadius = clamp(Math.cbrt((3 * pm) / (4 * Math.PI * STEEL_DENSITY)), 0.008, 0.035);
    const bm = f.parts.find((q) => q.name === "blade")!.mass;
    // Thickness from mass: m = rho * fill * (mean width * length) * t.
    const meanWidth = 2 * R * (1 + TIP_WIDTH_RATIO) / 2;
    f.bladeThickness = clamp(bm / (STEEL_DENSITY * BLADE_SECTION_FILL * meanWidth * H), 0.002, 0.014);
  } else if (a.family === "polearm") {
    const headBase = forward - H;
    if (a.head === "scythe") {
      f.shaftTopY = forward;
      f.bladeBaseY = forward;
      f.bladeLength = H;
      f.bladeHalfWidth = R;
      f.bladeStartAngle = lerp(SCYTHE_START_ANGLE.min, SCYTHE_START_ANGLE.max, axes.curvature);
      f.bladeTurn = axes.curvature * SCYTHE_MAX_BEND; // curves toward the edge (+z then -y)
      f.singleEdged = true;
      f.bladeThickness = 0.004;
      const c = bladePointAt(f, H * TAPER_MEAN, [0, 0, 0]);
      f.headCentreY = c[1]; f.headCentreZ = c[2];
    } else {
      f.shaftTopY = a.head === "leaf" ? headBase + 0.05 : forward - 0.45 * H; // spear socket / halberd spike base
      f.headCentreY = a.head === "leaf" ? headBase + 0.4 * H : forward - 0.6 * H;
      f.headCentreZ = a.head === "halberd" ? 0.3 * R : 0;
    }
    const shaft = rod("shaft", haftMass(-tail, f.shaftTopY), -tail, f.shaftTopY);
    const head = lump("head", 0, f.headCentreY, f.headCentreZ, Math.max(R, 0.3 * H));
    const butt = lump("butt", 0, -tail + 0.04, 0, 0.02);
    f.parts = solveSplit([shaft], head, butt, M, target, { min: 0.1, max: 0.97 });
  } else if (a.family === "hafted") {
    f.shaftTopY = forward;
    f.headCentreY = forward - H / 2 - (a.head === "axe" || a.head === "hammer" ? HEAD_TOP_MARGIN : 0);
    f.headCentreZ = a.head === "axe" ? 0.35 * R : 0;
    const shaft = rod("shaft", haftMass(-tail, forward), -tail, forward);
    const head = lump("head", 0, f.headCentreY, f.headCentreZ, Math.max(R, H / 2));
    const butt = lump("butt", 0, -tail + 0.02, 0, 0.02);
    f.parts = solveSplit([shaft], head, butt, M, target, { min: 0.3, max: 0.98 });
  } else if (a.family === "flail") {
    const ballY = forward - R;
    f.shaftTopY = forward - H; // handle top; the chain runs from here to the ball
    f.headCentreY = ballY;
    const handle = rod("handle", haftMass(-tail, f.shaftTopY), -tail, f.shaftTopY);
    const chain = rod("chain", CHAIN_LINEAR_DENSITY * Math.max(0, ballY - R - f.shaftTopY), f.shaftTopY, ballY - R);
    const ball = lump("ball", 0, ballY, 0, R);
    const butt = lump("butt", 0, -tail + 0.02, 0, 0.02);
    f.parts = solveSplit([handle, chain], ball, butt, M, target, { min: 0.3, max: 0.98 });
  } else if (a.family === "staff") {
    const shaft = rod("shaft", haftMass(-tail, forward), -tail, forward);
    const top = lump("ferrule-top", 0, forward - 0.04, 0, sr);
    const butt = lump("ferrule-butt", 0, -tail + 0.04, 0, sr);
    f.headCentreY = forward - 0.04;
    f.parts = solveSplit([shaft], top, butt, M, target, { min: 0.02, max: 0.98 });
  } else {
    // Bow: riser at the grip, one limb each way; the split is upper vs lower limb.
    const half = L / 2;
    f.braceHeight = 0.12 + 0.04 * clamp01(invLerp(a.axes.length.min, a.axes.length.max, L)); // fistmele ~0.15 m
    const riser = lump("riser", BOW_RISER_SHARE * M, 0, 0, 0.05);
    const upper = rod("limb-upper", 0, 0, half, -0.3 * f.braceHeight);
    const lower = rod("limb-lower", 0, -half, 0, -0.3 * f.braceHeight);
    f.parts = solveSplit([riser], upper, lower, M, target, { min: 0.4, max: 0.6 });
  }

  let moment = 0, inertia = 0, total = 0;
  for (const p of f.parts) { total += p.mass; moment += p.mass * p.y; inertia += p.mass * p.k2; }
  f.balance = moment / total;
  f.inertia = inertia;
  return f;
}

/**
 * Grip points resolved on the form (contract GripPoint): main at 0; the off hand behind the
 * main hand (two hands on a long grip, or near the butt of a pole); a choke grip up the haft.
 * Bow: the "off" hand is the draw hand on the string at the nocking point (string at
 * z = -braceHeight; GripPoint only carries y).
 */
export function resolveGrips(id: ArchetypeId, form: WeaponForm): GripPoint[] {
  const a = ARCHETYPES[id];
  const out: GripPoint[] = [];
  for (const g of a.grips) {
    let y = 0;
    if (g.id === "off") {
      if (a.family === "blade") y = -(form.handleLength - 2 * HAND_HALF_WIDTH);
      else if (a.family === "bow") y = HAND_HALF_WIDTH;
      else if (a.family === "staff" || a.head === "leaf") y = -Math.min(POLE_HAND_SPREAD, form.tail - BUTT_MARGIN);
      else y = -(form.tail - BUTT_MARGIN);
    } else if (g.id === "choke") {
      const reachable = (a.family === "hafted" ? form.headCentreY : form.shaftTopY) - 0.1;
      y = Math.min(0.4, Math.max(2 * HAND_HALF_WIDTH, 0.5 * reachable));
    }
    out.push({ id: g.id, y, modes: [...g.modes] });
  }
  return out;
}
