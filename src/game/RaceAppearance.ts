// Race and sub-species appearance model: the physical build, hair, and facial
// features that distinguish the four races and their sub-species, so the 3D model
// and the portraits diversify by ancestry, not just by palette.
//
// Pure data + a lookup: no Three.js, no DOM. The Humanoid rig reads this through
// raceAppearance() to scale the body, grow the hair, add beards, and set the ork
// underbite.

/** Hair length tiers, shortest to longest. */
export type HairLength = "bald" | "short" | "medium" | "long" | "verylong";

/** How the hair is cut/shaped. */
export type HairStyle = "shaved" | "crop" | "bob" | "flowing" | "braided" | "topknot" | "mohawk" | "wild";

export interface RaceBuild {
  /** Height and weight multipliers on the base human frame. */
  heightMul: number;
  weightMul: number;
  /** Hair: length tier, allowed styles, and whether facial hair grows. */
  hairLength: HairLength;
  hairStyles: HairStyle[];
  beard: boolean;
  moustache: boolean;
  /** Ork underbite: the lower teeth/jaw protrude past the upper (0 = none). */
  underbite: number;
  /** Ear length multiplier (elves have long ears). */
  earMul: number;
  /** Skin tint shift (a hue nudge so races read differently even at one palette). */
  tint: string;
}

/** The four races' base builds. */
export const RACE_BUILDS: Record<string, RaceBuild> = {
  human: { heightMul: 1.0, weightMul: 1.0, hairLength: "medium", hairStyles: ["crop", "bob", "topknot"], beard: true, moustache: true, underbite: 0, earMul: 1.0, tint: "#e0a884" },
  elf:   { heightMul: 1.04, weightMul: 0.88, hairLength: "verylong", hairStyles: ["flowing", "braided"], beard: false, moustache: false, underbite: 0, earMul: 1.9, tint: "#e8c8a0" },
  dwarf: { heightMul: 0.82, weightMul: 1.35, hairLength: "long", hairStyles: ["braided", "wild"], beard: true, moustache: true, underbite: 0.05, earMul: 0.9, tint: "#d89870" },
  ork:   { heightMul: 1.12, weightMul: 1.55, hairLength: "short", hairStyles: ["mohawk", "shaved", "wild"], beard: false, moustache: false, underbite: 0.35, earMul: 0.8, tint: "#88b060" },
};

/** Sub-species tweaks layered on the race build (height/hair/tint shift). */
export const SUBRACE_TWEAKS: Record<string, Partial<RaceBuild>> = {
  imperial: { heightMul: 1.02, tint: "#e8b490" },
  nomad: { hairLength: "long", tint: "#d8a078" },
  islander: { weightMul: 0.95, tint: "#e0b088" },
  high: { heightMul: 1.05, hairLength: "verylong", tint: "#f0d0a8" },
  wood: { hairLength: "long", tint: "#d8c090" },
  dark: { tint: "#b8a8c8" },
  mountain: { weightMul: 1.1, tint: "#d09060" },
  forge: { beard: true, tint: "#c88858" },
  deep: { heightMul: 0.95, tint: "#b8a088" },
  greenhide: { tint: "#90c068" },
  ironhide: { weightMul: 1.1, tint: "#78a858" },
  bloodfang: { underbite: 0.45, tint: "#98b868" },
};

/** Expanded skin/hair palette, so colours diversify beyond the five base palettes. */
export const HAIR_COLORS = ["#172128", "#3a2a1a", "#6a4a2a", "#a87a4a", "#d8b87a", "#e8e0d0", "#8a9098", "#4a5a6a", "#6a3a4a", "#3a6a4a"];
export const SKIN_TONES = ["#e0a884", "#d89870", "#c88858", "#b87a50", "#e8c8a0", "#f0d0a8", "#88b060", "#98b868", "#78a858", "#a89890"];

/** The effective build for a race + sub-species (tweaks layered on the base). */
export function raceBuild(raceId: string, subraceId: string | null): RaceBuild {
  const base = RACE_BUILDS[raceId] ?? RACE_BUILDS.human;
  const tweak = subraceId ? SUBRACE_TWEAKS[subraceId] : undefined;
  if (!tweak) return { ...base, hairStyles: [...base.hairStyles] };
  return { ...base, ...tweak, hairStyles: tweak.hairStyles ? [...tweak.hairStyles] : [...base.hairStyles] } as RaceBuild;
}

/** Hair length in metres (scalp-to-tip), for the rig to grow the hair by. */
export const HAIR_LENGTH_M: Record<HairLength, number> = {
  bald: 0.0, short: 0.08, medium: 0.22, long: 0.48, verylong: 0.72,
};

/** Deterministic pick from a list by seed, so a character's style is reproducible. */
export function seededPick<T>(list: T[], seed: number): T {
  const h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0);
  return list[h % list.length];
}

/**
 * Blend two `#rrggbb` colours, t = 0 → a, t = 1 → b. Used to give a race's base skin
 * tint per-character variation from the expanded SKIN_TONES palette, so two members of
 * one race are not the same flat colour.
 */
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const va = (pa >> shift) & 0xff, vb = (pb >> shift) & 0xff;
    return Math.round(va + (vb - va) * k);
  };
  return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("");
}

/** A stable seed from a character name, so appearance variation is reproducible. */
export function nameSeed(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
