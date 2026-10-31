// CreatorSync: the two PURE pieces behind the Creator's no-tab restructure (Wave P, lane P-0).
//
// WHY this module exists. The parent turns the Creator into ONE page: every group is visible,
// a CLOSED group header shows its CURRENT main values (the "global parameter" the user asked
// for), and a click opens the group for the details. Two facts have to live in a pure module
// (testable without a browser, no DOM, no THREE):
//
//   1. groupSummary  — the one-line CURRENT-VALUES string a closed header shows, for EVERY
//                      group in the Creator's tree, and never empty (a blank header is a bug).
//   2. applyEdit     — an edit that SYNCHRONISES the parameters that depend on it ("by change
//                      of colour… do some synchronisations"): a skin tone drags its crease /
//                      paint / eye tones with it, so a half-edited fighter cannot look broken,
//                      and a height/weight edit clamps into the race's OWN band.
//
// The tone relations are REUSED, not invented: `shadeHex` / `tintHex` are the exact helpers the
// paint stacks derive their crease, mottle, sole and nail tones with (src/graphics/paint/
// Recipes.ts on top of src/graphics/paint/Blend.ts). Both keep a colour's HUE and scale its
// chroma with the change, which is what stops a darkened skin from turning muddy-orange.
//
// Pure module: no DOM, no THREE, no Math.random. applyEdit is total (an unknown field or a bad
// value is a no-op, never a throw) and deterministic (it never mutates its input).
//
// Units: heights are metres, weights are kilograms, level is a dimensionless tier.

import type { CharacterProfile } from "../game/Characters.ts";
import { computeRaceStats, type RaceDef, raceById, type Subrace } from "../game/Races.ts";
import { ancestryOf } from "../game/Ancestry.ts";
import { raceBuild } from "../game/RaceAppearance.ts";
import { CLASSES } from "../game/Stats.ts";
import { birthsignById } from "../game/Birthsight.ts";
import { skillsForClass } from "../game/Skills.ts";
import { secondaryPreview } from "../game/SecondaryStats.ts";
import { weaponForClass, type WeaponType } from "../game/Weapon.ts";
import { PALETTES } from "../game/Characters.ts";
import { shadeHex, tintHex } from "../graphics/paint/Blend.ts";

// ─── the edit patch ────────────────────────────────────────────────────────────

/** One parameter edit: which field, and what the user set it to. */
export interface EditPatch {
  field: string;
  value: string | number | boolean | null;
}

// ─── the synchronised-tone law (reused from the paint stacks) ───────────────────

/**
 * Crease/paint tone from a skin tone: `shadeHex(skin, k)` multiplies every sRGB channel by k,
 * darkening the colour WHILE scaling its chroma by k — the same relation the paint stacks use
 * for their crease and mottle layers. Lowering HSL lightness instead would RAISE the chroma of
 * a light skin and turn the fold orange, which is why this helper exists at all.
 */
export const SKIN_CREASE_K = 0.58;
/**
 * Eye tone from a skin tone: `tintHex(skin, k)` moves every channel toward white by k, giving a
 * paler, lower-chroma tone (the paint stacks' sole/nail relation). The eye reads as sitting ON
 * the skin rather than floating, so it never has to be re-picked when the skin moves.
 */
export const SKIN_EYE_TINT = 0.22;

/**
 * The tones a skin tone drags with it. `accent` is the crease/paint tone (a darker, hue-kept
 * shade), `eyes` the eye tone (a paler, hue-kept tint). Both derive from the skin by the paint
 * stacks' own relations, so the trio stays harmonious across an edit.
 */
export function syncTonesFromSkin(skin: string): { accent: string; eyes: string } {
  return { accent: shadeHex(skin, SKIN_CREASE_K), eyes: tintHex(skin, SKIN_EYE_TINT) };
}

// ─── the rule table ─────────────────────────────────────────────────────────────

/** One sync rule: the field an edit names, the fields it drags, and the relation behind it. */
export interface SyncRule {
  field: string;
  dependents: string[];
  relation: string;
}

/**
 * The synchronised fields, as data. Every driver field names its dependents and the RELATION
 * that moves them, so the parent can render the rule table and a test can pin it. Fields not
 * listed here are LEAF edits (a class, a name, a birthsign) and drag nothing.
 */
export const SYNC_RULES: readonly SyncRule[] = [
  {
    field: "race",
    dependents: ["subrace"],
    relation: "a new race clears a sub-species that does not belong to it (a dwarf cannot hold an elf's nation)",
  },
  {
    field: "appearance.body",
    dependents: ["appearance.accent", "appearance.eyes"],
    relation: `accent = shadeHex(body, ${SKIN_CREASE_K}) (creasing/paint); eyes = tintHex(body, ${SKIN_EYE_TINT}) (eye tone); both keep the hue and scale chroma, the paint stacks' crease/ink relation`,
  },
];

/** The fields an edit must drag along so a half-edited fighter cannot look broken. */
export function dependentFields(field: string): string[] {
  const rule = SYNC_RULES.find((r) => r.field === field);
  return rule ? [...rule.dependents] : [];
}

// ─── edit application ───────────────────────────────────────────────────────────

/** The base human frame the race's own multipliers scale the body band from (metres / kg). */
export const BASE_FRAME = { minHeight: 1.5, maxHeight: 2.1, minWeight: 50, maxWeight: 140 } as const;

/** The height band (metres) a race's own build allows: base frame x the race's height multiplier. */
export function heightBand(raceId: string, subraceId: string | null): [number, number] {
  const m = raceBuild(raceId, subraceId).heightMul;
  return [BASE_FRAME.minHeight * m, BASE_FRAME.maxHeight * m];
}

/** The weight band (kg) a race's own build allows: base frame x the race's weight multiplier. */
export function weightBand(raceId: string, subraceId: string | null): [number, number] {
  const m = raceBuild(raceId, subraceId).weightMul;
  return [BASE_FRAME.minWeight * m, BASE_FRAME.maxWeight * m];
}

const HEX = /^#?[0-9a-fA-F]{6}$/;
const WEAPON_TYPES: readonly WeaponType[] = ["axe", "sword", "dagger", "staff", "scythe", "bow", "mace"];

/** Clamp a finite number into [lo, hi]; a non-finite input falls back to `fallback` (never NaN). */
function clamp(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

/** Normalise a "rrggbb"/"#rrggbb" string to "#rrggbb", or null when it is not a colour. */
function asHex(value: string | number | boolean | null): string | null {
  if (typeof value !== "string" || !HEX.test(value)) return null;
  return value.startsWith("#") ? value.toLowerCase() : `#${value.toLowerCase()}`;
}

/** A structural copy: applyEdit never mutates its input. */
function copy(p: CharacterProfile): CharacterProfile {
  return { ...p, appearance: { ...p.appearance }, allocated: { ...p.allocated } };
}

/**
 * Apply one edit and SYNCHRONISE its dependents. Total and deterministic: an unknown field or an
 * out-of-domain value is a no-op (the profile comes back unchanged), never a throw and never a
 * NaN — so a caller can feed a slider, a swatch or a rolled value without a guard.
 *
 * Colour edits: a skin (`appearance.body`) edit rewrites `appearance.accent` and `appearance.eyes`
 * by `syncTonesFromSkin`. Height/weight edits clamp into the race's own band. A `race` edit clears a
 * sub-species that does not belong to the new race. Applying the same edit twice is idempotent.
 */
export function applyEdit(p: CharacterProfile, patch: EditPatch): CharacterProfile {
  const next = copy(p);
  const { field, value } = patch;

  const setColour = (onto: string): boolean => {
    const hex = asHex(value);
    if (hex === null) return false;
    if (onto === "appearance.body") {
      next.appearance.body = hex;
      const tones = syncTonesFromSkin(hex);
      next.appearance.accent = tones.accent;
      next.appearance.eyes = tones.eyes;
    } else if (onto === "appearance.accent") next.appearance.accent = hex;
    else if (onto === "appearance.eyes") next.appearance.eyes = hex;
    else if (onto === "appearance.hair") next.appearance.hair = hex;
    return true;
  };

  switch (field) {
    case "appearance.body":
    case "appearance.accent":
    case "appearance.eyes":
    case "appearance.hair":
      setColour(field);
      break;

    case "appearance.height": {
      const [lo, hi] = heightBand(next.race, next.subrace);
      if (typeof value === "number") next.appearance.height = clamp(value, lo, hi, next.appearance.height);
      break;
    }
    case "appearance.weight": {
      const [lo, hi] = weightBand(next.race, next.subrace);
      if (typeof value === "number") next.appearance.weight = clamp(value, lo, hi, next.appearance.weight);
      break;
    }
    case "appearance.beard":
      if (typeof value === "boolean") next.appearance.beard = value;
      break;
    case "appearance.moustache":
      if (typeof value === "boolean") next.appearance.moustache = value;
      break;

    case "race": {
      if (typeof value !== "string") break;
      const race = raceById(value);
      if (!race) break; // unknown race: keep the current one
      next.race = race.id;
      next.appearance.race = race.id;
      // SYNCHRONISED: a sub-species that does not belong to the new race is cleared.
      const keep = next.subrace && race.subspecies.some((s) => s.id === next.subrace) ? next.subrace : null;
      next.subrace = keep;
      next.appearance.subrace = keep;
      break;
    }

    case "subrace": {
      if (value === null) {
        next.subrace = null;
        next.appearance.subrace = null;
        break;
      }
      if (typeof value !== "string") break;
      const race = raceById(next.race);
      if (!race || !race.subspecies.some((s) => s.id === value)) break; // foreign id: keep
      next.subrace = value;
      next.appearance.subrace = value;
      break;
    }

    case "className":
      if (typeof value === "string" && (CLASSES as readonly string[]).includes(value)) {
        next.className = value as CharacterProfile["className"];
      }
      break;

    case "birthsign":
      if (value === null) next.birthsign = null;
      else if (typeof value === "string" && birthsignById(value)) next.birthsign = value;
      break;

    case "weaponType":
      if (typeof value === "string" && (WEAPON_TYPES as readonly string[]).includes(value)) {
        next.weaponType = value;
      }
      break;

    case "palette":
      if (typeof value === "string" && value in PALETTES) next.palette = value;
      break;

    case "name":
      if (typeof value === "string" && value.length > 0) next.name = value;
      break;

    case "level":
      if (typeof value === "number") next.level = Math.round(clamp(value, 1, 100, next.level));
      break;

    default:
      break; // unknown field: total no-op
  }

  return next;
}

// ─── the group summary (the "global parameter" a closed header shows) ────────────

/** The one Creator screen's group ids, in tree order; a summary is defined for every one. */
export const CREATOR_GROUP_IDS: readonly string[] = [
  "race", "subrace", "hero", "lore",
  "class", "weapon", "skills",
  "birthsign", "secondary",
  "rival", "terms", "spectate", "inspect",
  "field", "walls", "pickups",
];

/** Fixed one-liners for the group whose current value lives in the ENGINE, not the profile. */
const STATIC_SUMMARY: Record<string, string> = {
  rival: "AI opponent — its calling is rolled per match",
  terms: "Match terms — length and win condition rolled per match",
  spectate: "Spectator card — generated when an AI-vs-AI match runs",
  inspect: "Inspect overlay — click a fighter or prop in spectate",
  field: "Arena field — shape and size rolled per match",
  walls: "Walls — present on ~90% of arenas, with their own resistance",
  pickups: "Pickups — coins and power-ups spawn in the field",
};

/**
 * The one-line CURRENT-VALUES summary a CLOSED group header shows. Never empty: an unknown or
 * engine-owned group falls back to a descriptive or identity line, so a header is never blank.
 * `race`/`subrace` are the resolved objects (null when the caller has not looked them up), and
 * a null race falls back to a lookup by `p.race` so the summary reflects the profile either way.
 */
export function groupSummary(
  groupId: string,
  p: CharacterProfile,
  race: RaceDef | null,
  subrace: Subrace | null,
): string {
  const rdef = race ?? raceById(p.race);
  const raceName = rdef?.name ?? p.race;
  const subName = subrace?.name ?? (p.subrace ?? "No sub-species");

  if (STATIC_SUMMARY[groupId]) return STATIC_SUMMARY[groupId];

  switch (groupId) {
    case "race":
      return `${raceName} — ${rdef?.subspecies.length ?? 0} sub-species`;
    case "subrace":
      return subrace ? `${subName} · ${subrace.desc.split(" — ")[0]}` : "No sub-species chosen";
    case "hero": {
      if (!rdef) return `${raceName} — stats unavailable`;
      const s = computeStatsLine(rdef, subrace);
      return s;
    }
    case "lore": {
      const node = ancestryOf(rdef?.id ?? p.race, subrace?.id ?? p.subrace ?? null);
      return node?.lore ?? `${raceName} — ${subName}`;
    }
    case "class":
      return `${p.className} — ${weaponForClass(p.className).name}`;
    case "weapon": {
      const w = weaponForClass(p.className);
      return `${w.name} (${p.weaponType ?? w.type})`;
    }
    case "skills": {
      const skills = skillsForClass(p.className);
      return skills.length ? skills.map((s) => s.name).join(" · ") : `${p.className} techniques`;
    }
    case "birthsign": {
      const sign = p.birthsign ? birthsignById(p.birthsign) : undefined;
      return sign ? `${sign.name}` : "No star sign";
    }
    case "secondary": {
      const rows = secondaryPreview(p.subrace, p.birthsign);
      return rows.map((r) => `${r.label} ${r.text}`).join(" · ");
    }
    default:
      // A group id we do not know still yields a non-empty identity line rather than "".
      return `${groupId}: ${p.name}`;
  }
}

/** The six primary stats, as one line: "VIT 9 · RES 9 · …" from the race's computed ranges. */
function computeStatsLine(race: RaceDef, subrace: Subrace | null): string {
  const stats = computeRaceStats(race, subrace);
  return [
    `VIT ${Math.round(stats.vitality.avg)}`,
    `RES ${Math.round(stats.resilience.avg)}`,
    `WIL ${Math.round(stats.willpower.avg)}`,
    `REF ${Math.round(stats.reflex.avg)}`,
    `STR ${Math.round(stats.strength.avg)}`,
    `INT ${Math.round(stats.intelligence.avg)}`,
  ].join(" · ");
}
