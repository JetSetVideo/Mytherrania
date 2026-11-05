// TexSources (Wave TEX, lane U): the ONE place the Creator's material UI reads the other lanes' modules —
// P's presets (the active stack the Layers inspector lists), L's operator vocabularies (the per-channel
// pickers) and M's marks (generated defaults, placement validation). Pure (no DOM/THREE).
//
// Kept separate so a lane's API change touches one file, and so the panel (TexStudio.ts) stays testable
// with fakes.

import type { CharacterProfile } from "../game/Characters.ts";
import { EDIT_LOCKED, editableOps, presetForProfile, type PresetLayer, skinRegionsOf } from "../graphics/paint/Presets.ts";
import { COLOR_OPS, SCALAR_OP_IDS } from "../graphics/paint/LayerStack.ts";
import type { LayerRow } from "./TexState.ts";
import { type MeshData, type Region, REGIONS } from "../graphics/body/contracts.ts";
import { anchorAt, frameOf, isPaired, markExtentMm, nominalFrames, type PlacementIssue, type PlacementItem, type RegionFrames, regionFrames, solvePlacement } from "../graphics/paint/marks/Placement.ts";
import { langerAngle } from "../graphics/paint/marks/Scar.ts";
import { marksForProfile, validateMarks } from "../graphics/paint/marks/MarkLibrary.ts";
import { nameSeed } from "../game/RaceAppearance.ts";
import { type MarkSetRec, parseMarkSet } from "./MarkEdit.ts";

/** The channel order the inspector shows (P's PRESET_CHANNELS + L's extras). */
export const INSPECTOR_CHANNELS = ["albedo", "roughness", "height", "ao", "subsurface", "emissive"] as const;
export const CHANNEL_LABEL: Readonly<Record<string, string>> = {
  albedo: "Colour", roughness: "Rough", height: "Relief", ao: "AO", subsurface: "Warmth", emissive: "Glow",
};

/** Is this channel composited with colour blends (else scalar ops)? */
export function isColourChannel(channel: string): boolean {
  return channel === "albedo" || channel === "emissive";
}

/** The operators a channel's picker offers: the game path's list (P's editableOps) or L's list for its kind, with the layer's own op first if missing. */
export function operatorChoices(channel: string, current?: string, allowed?: readonly string[]): string[] {
  const base = [...(allowed ?? (isColourChannel(channel) ? COLOR_OPS : SCALAR_OP_IDS))] as string[];
  return current && !base.includes(current) ? [current, ...base] : base;
}

/** One preset layer as an inspector row (stable id `<material>.<step>`). */
export function rowOfPresetLayer(l: PresetLayer): LayerRow {
  const blend: Record<string, string> = {};
  for (const ch of INSPECTOR_CHANNELS) {
    const op = (l.writes as Record<string, string | undefined>)[ch];
    if (op) blend[ch] = op;
  }
  const op = (l as { opacity?: number }).opacity;
  const ops = editableOps(l) as Record<string, readonly string[]>;
  return {
    editLocked: EDIT_LOCKED.has(l.id) || undefined, ops, id: `p:${l.id}`, group: l.material, name: l.name, enabled: l.enabled, opacity: typeof op === "number" && Number.isFinite(op) ? Math.max(0, Math.min(1, op)) : 1, blend, source: `${l.step} · ${l.storage}` };
}

/** The materials of a profile's stack, in stack order, for the inspector's material filter ("*" = shared steps). */
export function layerGroupsFor(profile: CharacterProfile): { id: string; label: string; count: number }[] {
  const rows = layerRowsFor(profile);
  let labels: Record<string, string> = {};
  try { labels = Object.fromEntries(presetForProfile(profile).finish.materials.map((m) => [m.id, m.label])); } catch { /* labels are cosmetic */ }
  const out: { id: string; label: string; count: number }[] = [];
  for (const r of rows) {
    const g = r.group ?? "*";
    const e = out.find((x) => x.id === g);
    if (e) e.count++; else out.push({ id: g, label: g === "*" ? "Whole body" : labels[g] ?? g, count: 1 });
  }
  return out;
}

const rowsCache = new Map<string, LayerRow[]>();
/** The ACTIVE stack of a profile, bottom first (P's presetForProfile finish layers). [] if P's module throws. */
export function layerRowsFor(profile: CharacterProfile): LayerRow[] {
  const a = profile.appearance;
  const key = `${profile.name}|${profile.race}|${profile.subrace ?? ""}|${profile.className}|${profile.birthsign ?? ""}|${a.body}|${a.accent}|${a.hair ?? ""}|${a.sex ?? ""}|${a.height}`;
  const hit = rowsCache.get(key);
  if (hit) return hit.map((r) => ({ ...r, blend: { ...r.blend } }));
  let rows: LayerRow[] = [];
  try {
    rows = presetForProfile(profile).finish.layers.map(rowOfPresetLayer);
  } catch {
    rows = [];
  }
  if (rowsCache.size > 32) rowsCache.clear();
  rowsCache.set(key, rows);
  return rows.map((r) => ({ ...r, blend: { ...r.blend } }));
}

/** The marks the profile SHOWS: its saved set, else M's generated defaults (empty until M's library lands). */
export function shownMarks(profile: CharacterProfile): { set: MarkSetRec; generated: boolean } {
  const saved = parseMarkSet((profile.appearance as { marks?: unknown }).marks);
  if (saved) return { set: saved, generated: false };
  return { set: generatedMarks(profile), generated: true };
}

/** M's generated defaults for a profile (MarkLibrary.marksForProfile with no saved set; seed = nameSeed(name), as the body). */
export function generatedMarks(profile: CharacterProfile): MarkSetRec {
  try {
    const a = profile.appearance;
    const set = marksForProfile({ race: profile.race, subrace: profile.subrace, className: profile.className, birthsign: profile.birthsign, appearance: { marks: null, age: a.age, height: a.height } }, nameSeed(profile.name));
    return parseMarkSet(set) ?? { scars: [], tattoos: [] };
  } catch {
    return { scars: [], tattoos: [] };
  }
}

/** The skin as the viewer's raycast sees it: bind positions/normals, triangles, region index per vertex. */
export interface PickMesh { positions: Float32Array; normals: Float32Array; indices: Uint32Array | Uint16Array; region: Uint8Array }

/**
 * A bind-pose skin point -> M's region frame anchor (adapter over Placement.anchorAt; frames cached per mesh).
 * null = no frame for that region (the panel then keeps the region and centres the mark).
 */
const framesCache = new WeakMap<PickMesh, RegionFrames>();
export function pickAnchor(mesh: PickMesh, regionIndex: number, point: readonly number[]): { region: Region; side: 0 | 1 | null; anchor: [number, number] } | null {
  let frames = framesCache.get(mesh);
  if (!frames) {
    try { frames = regionFrames(mesh as unknown as MeshData); } catch { return null; }
    framesCache.set(mesh, frames);
  }
  const r = anchorAt(frames, regionIndex, [point[0], point[1], point[2]]);
  return r ? { region: r.region, side: isPaired(r.region) ? r.side : null, anchor: r.anchor } : null;
}

/** Placement issues per mark (adapter over M's solver): key `scar:0` / `tattoo:1` -> a short reason. */
/** What the panel says for a mark under the outfit (M's `covered`, QD Z-37): kept and saved, drawn when bare. */
export const COVERED_TEXT = "hidden under the outfit";

/** The regions the fighter's outfit covers = every mark region that is not bare skin in P's preset. */
export function coveredRegionsOf(profile: CharacterProfile): Region[] {
  try {
    const skin = new Set(skinRegionsOf(presetForProfile(profile)));
    return REGIONS.filter((r) => !skin.has(r) && r !== "hair" && r !== "nail" && r !== "sole") as Region[];
  } catch {
    return [];
  }
}

export const ISSUE_TEXT: Readonly<Record<PlacementIssue, string>> = {
  overlap: "overlaps another mark",
  outOfRegion: "runs off this body part",
  faceFeature: "over the eyes or mouth",
  faceNotAllowed: "face: pick a facial style",
  regionNotAllowed: "not on this body part",
};

/** The placement items of a set (user marks are FIXED: the solver reports, never moves them). */
export function placementItems(set: MarkSetRec, frames: RegionFrames): PlacementItem[] {
  const items: PlacementItem[] = [];
  set.scars.forEach((s, i) => {
    const side = (isPaired(s.region) ? s.side ?? 0 : 0) as 0 | 1;
    const frame = frameOf(frames, s.region, side);
    items.push({ id: `scar:${i}`, type: "scar", region: s.region, side, anchor: [s.anchor[0], s.anchor[1]], angle: s.angle ?? langerAngle(s.region, s.anchor[0], s.anchor[1]), extentMm: markExtentMm("scar", s, frame), facial: true, fixed: true });
  });
  set.tattoos.forEach((t, i) => {
    const side = (isPaired(t.region) ? t.side ?? 0 : 0) as 0 | 1;
    const frame = frameOf(frames, t.region, side);
    items.push({ id: `tattoo:${i}`, type: "tattoo", region: t.region, side, anchor: [t.anchor[0], t.anchor[1]], angle: t.angle ?? (t.style === "band" ? 0 : Math.PI / 2), extentMm: markExtentMm("tattoo", t, frame), facial: !!t.facial || t.region === "face", fixed: true });
  });
  return items;
}

/**
 * Placement issues per mark (M's validateMarks on the nominal frames of the fighter's height; ids `scar.0` ->
 * the panel's `scar:0`). User marks are fixed: issues are REPORTED, the mark is never moved.
 */
export function markIssues(profile: CharacterProfile, set: MarkSetRec): Record<string, string> {
  const out: Record<string, string> = {};
  if (!set.scars.length && !set.tattoos.length) return out;
  try {
    const frames = nominalFrames(profile.appearance.height || 1.8, profile.race);
    for (const r of validateMarks(set, { race: profile.race, subrace: profile.subrace, frames, fixed: true, coveredRegions: coveredRegionsOf(profile) })) {
      const m = /^(scar|tattoo)\.(\d+)(\.m)?$/.exec(r.id);
      const texts = [...new Set(r.issues)].map((i) => ISSUE_TEXT[i] ?? i);
      if ((r as { covered?: boolean }).covered) texts.push(COVERED_TEXT);
      if (!m || !texts.length) continue;
      const key = `${m[1]}:${m[2]}`, text = texts.join(", ") + (m[3] ? " (mirror copy)" : "");
      out[key] = out[key] ? `${out[key]}; ${text}` : text;
    }
  } catch {
    // M's solver missing or throwing never blocks editing; fall back to the raw solver on the same items.
    try {
      const frames = nominalFrames(profile.appearance.height || 1.8, profile.race);
      for (const r of solvePlacement(placementItems(set, frames), frames).report) if (r.issues.length) out[r.id] = r.issues.map((i) => ISSUE_TEXT[i] ?? i).join(", ");
    } catch { /* nothing to report */ }
  }
  return out;
}
