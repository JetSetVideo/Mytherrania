// TexState (Wave TEX, lane U): the Creator's MATERIAL editing state — pure (no DOM, no THREE, no clock, no
// Math.random), so every rule is a unit test (tests/wave_tex_ui_test.ts, SPEC TX70-79).
//
// Three things the + New page edits, all persisted on the profile's appearance (saved with the hero):
//   - `appearance.layerOverrides`: per-layer edits of the ACTIVE material stack (L's LayerStack / P's
//     presets): enabled, opacity, the blend operator per channel, the order. Sparse: only what the user
//     changed is stored, keyed by the layer's stable id; an override for a layer the stack no longer has is
//     kept (a race change may bring it back) but has no effect.
//   - `appearance.marks`: scars and tattoos (M's Scar / Tattoo, see MarksPanel.ts for the field mapping).
//   - the CHANNEL VIEW the viewer shows (albedo / roughness / height / normal / ao / marks / final, R's debug
//     views) — a view setting, NOT saved on the profile.
//
// Wiring (no Engine edit, the wave-GEN pattern): the Menu writes `data-tex-channel` and `data-tex-placing` on the
// preview canvas; PreviewScene reads them per frame, and answers a placement click with a bubbling
// `TEX_PICK_EVENT` (region + bind-pose point + anchor) the Menu turns into a mark edit.
//
// Saves are user-editable (localStorage), so every reader here is TOTAL: any garbage in -> a valid value out.

/** The channel debug views the viewer offers (R's C-REND list), `final` = the normal lit picture. */
export const CHANNEL_VIEWS = ["final", "albedo", "roughness", "height", "normal", "ao", "marks"] as const;
export type ChannelView = typeof CHANNEL_VIEWS[number];
export const DEFAULT_CHANNEL_VIEW: ChannelView = "final";
export const CHANNEL_VIEW_LABEL: Readonly<Record<ChannelView, string>> = {
  final: "Final", albedo: "Albedo", roughness: "Roughness", height: "Height", normal: "Normal", ao: "AO", marks: "Marks",
};
export const CHANNEL_VIEW_HINT: Readonly<Record<ChannelView, string>> = {
  final: "The lit, finished surface (what the arena shows)",
  albedo: "Base colour only, no light",
  roughness: "Glossy (dark) to matte (light)",
  height: "Relief: sunken (dark) to raised (light)",
  normal: "The surface direction the relief bends the light to",
  ao: "Baked occlusion: creases and hollows darken",
  marks: "Scars and tattoos alone, on a neutral body",
};
export function isChannelView(v: unknown): v is ChannelView {
  return typeof v === "string" && (CHANNEL_VIEWS as readonly string[]).includes(v);
}
/** Arrow / Home / End navigation along a radio row (the stage scrubber's law). null = not a navigation key. */
export function nextViewIndex(i: number, key: string, n: number = CHANNEL_VIEWS.length): number | null {
  if (n <= 0) return null;
  const k = Math.max(0, Math.min(n - 1, Number.isFinite(i) ? Math.trunc(i) : 0));
  switch (key) {
    case "ArrowRight": case "ArrowDown": return (k + 1) % n;
    case "ArrowLeft": case "ArrowUp": return (k - 1 + n) % n;
    case "Home": return 0;
    case "End": return n - 1;
    default: return null;
  }
}

/** Events / canvas attributes of the wiring (see the header). */
export const TEX_PICK_EVENT = "mytherrania:tex-pick";
export const TEX_VIEW_EVENT = "mytherrania:tex-view";

// ─── Layer overrides ────────────────────────────────────────────────────────────────────────────────────

/** Channels a layer can write (L's Channels: albedo, roughness, height, ao, emissive, subsurface, masks). */
export type ChannelId = string;
/** Operator id (L's Operators: colour blends for albedo/emissive, scalar ops for the rest). */
export type OperatorId = string;

/** One user edit of one layer. Every field optional: absent = the stack's own value. */
export interface LayerOverride {
  id: string;
  enabled?: boolean;
  /** 0..1 */
  opacity?: number;
  blend?: Record<ChannelId, OperatorId>;
  /** The layer's index in the edited order (0 = bottom, composited first). */
  order?: number;
}

/** What the inspector lists per layer (the stack's view, before or after the overrides). */
export interface LayerRow {
  id: string;
  name: string;
  enabled: boolean;
  opacity: number;
  /** Channel -> operator, in the channel order the layer declares. */
  blend: Record<ChannelId, OperatorId>;
  /** Group layers and locked base layers cannot be reordered below the base (kept simple: a flag). */
  locked?: boolean;
  /** What the layer is (pattern / noise / mark / curvature ...), shown as a small caption. */
  source?: string;
  /** The material it belongs to (P's material id: skin, hair, garment.torso...; "*" = every material). */
  group?: string;
  /** Evaluator-only step (P's EDIT_LOCKED: clamp / guard): listed, never edited (no toggle, opacity, op or drag). */
  editLocked?: boolean;
  /** Per channel, the operators the GAME path can run (P's editableOps); absent channel = no picker. */
  ops?: Record<ChannelId, readonly OperatorId[]>;
}

export const OPACITY_STEP = 0.05;
export const MAX_OVERRIDES = 64;
const ID_RE = /^[A-Za-z0-9_.:*\-]{1,64}$/; // P's shared steps are "*.prime", "*.guard"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round = (v: number, step: number) => Math.round(v / step) * step;

/** A saved overrides list, sanitised: unknown fields dropped, numbers clamped, one entry per id (last wins). */
export function parseLayerOverrides(raw: unknown): LayerOverride[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, LayerOverride>();
  for (const r of raw.slice(0, MAX_OVERRIDES * 4)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !ID_RE.test(o.id)) continue;
    const out: LayerOverride = { id: o.id };
    if (typeof o.enabled === "boolean") out.enabled = o.enabled;
    if (typeof o.opacity === "number" && Number.isFinite(o.opacity)) out.opacity = clamp01(o.opacity);
    if (typeof o.order === "number" && Number.isFinite(o.order)) out.order = Math.max(0, Math.min(255, Math.trunc(o.order)));
    if (o.blend && typeof o.blend === "object" && !Array.isArray(o.blend)) {
      const b: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.blend as Record<string, unknown>)) {
        if (ID_RE.test(k) && typeof v === "string" && ID_RE.test(v)) b[k] = v;
      }
      if (Object.keys(b).length) out.blend = b;
    }
    if (Object.keys(out).length > 1) byId.set(o.id, out);
  }
  return [...byId.values()].slice(0, MAX_OVERRIDES);
}

/**
 * The stack as the user edited it: each row with its override applied, then the order. Ordering law: rows
 * with an override `order` take that slot (ties: the stack's order), the rest fill the remaining slots in
 * their own order. Total and stable; an override for an unknown id is ignored; an operator the row's channel
 * does not list in `allowed` (when given) is ignored.
 */
export function applyLayerOverrides(rows: readonly LayerRow[], overrides: readonly LayerOverride[], allowed?: (channel: ChannelId) => readonly OperatorId[]): LayerRow[] {
  const byId = new Map(overrides.map((o) => [o.id, o]));
  const edited = rows.map((r, i) => {
    const o = byId.get(r.id);
    const blend: Record<string, string> = { ...r.blend };
    if (o?.blend) for (const [ch, op] of Object.entries(o.blend)) {
      if (!(ch in blend)) continue;
      if (allowed && !allowed(ch).includes(op)) continue;
      blend[ch] = op;
    }
    return {
      row: { ...r, enabled: o?.enabled ?? r.enabled, opacity: o?.opacity !== undefined ? clamp01(o.opacity) : r.opacity, blend },
      want: o?.order, i,
    };
  });
  const n = edited.length;
  const slots: (LayerRow | null)[] = new Array(n).fill(null);
  const pinned = edited.filter((e) => e.want !== undefined && !e.row.locked).sort((a, b) => (a.want! - b.want!) || (a.i - b.i));
  const placed = new Set<number>();
  for (const e of pinned) {
    let s = Math.max(0, Math.min(n - 1, e.want!));
    // A locked row keeps its own slot; an occupied slot pushes the pinned row to the next free one.
    while (s < n && (slots[s] !== null || edited[s]?.row.locked)) s++;
    if (s >= n) { s = 0; while (s < n && (slots[s] !== null || edited[s]?.row.locked)) s++; }
    if (s < n) { slots[s] = e.row; placed.add(e.i); }
  }
  for (const e of edited) if (e.row.locked) { slots[e.i] = slots[e.i] ?? e.row; placed.add(e.i); }
  let k = 0;
  for (const e of edited) {
    if (placed.has(e.i)) continue;
    while (k < n && slots[k] !== null) k++;
    slots[k] = e.row;
  }
  return slots.filter((r): r is LayerRow => r !== null);
}

/** Write one field of one layer's override (returns a new list; a value equal to the base drops the field). */
export function setOverride(list: readonly LayerOverride[], base: readonly LayerRow[], id: string, patch: { enabled?: boolean; opacity?: number; channel?: ChannelId; op?: OperatorId }): LayerOverride[] {
  const row = base.find((r) => r.id === id);
  if (!row) return list.map((o) => ({ ...o }));
  const cur: LayerOverride = { ...(list.find((o) => o.id === id) ?? { id }) };
  if (cur.blend) cur.blend = { ...cur.blend };
  if (patch.enabled !== undefined) { if (patch.enabled === row.enabled) delete cur.enabled; else cur.enabled = patch.enabled; }
  if (patch.opacity !== undefined && Number.isFinite(patch.opacity)) {
    const v = clamp01(round(patch.opacity, 0.01));
    if (Math.abs(v - row.opacity) < 1e-9) delete cur.opacity; else cur.opacity = v;
  }
  if (patch.channel !== undefined && patch.op !== undefined && patch.channel in row.blend) {
    const b = { ...(cur.blend ?? {}) };
    if (row.blend[patch.channel] === patch.op) delete b[patch.channel]; else b[patch.channel] = patch.op;
    if (Object.keys(b).length) cur.blend = b; else delete cur.blend;
  }
  return writeOverride(list, cur);
}

/** Move the layer at `from` (edited order) to `to`; writes `order` for every row whose slot changed. */
export function reorderOverride(list: readonly LayerOverride[], base: readonly LayerRow[], from: number, to: number, allowed?: (channel: ChannelId) => readonly OperatorId[]): LayerOverride[] {
  const view = applyLayerOverrides(base, list, allowed);
  const n = view.length;
  if (!(from >= 0 && from < n) || !Number.isFinite(to)) return list.map((o) => ({ ...o }));
  const dest = Math.max(0, Math.min(n - 1, Math.trunc(to)));
  if (dest === from || view[from].locked || view[dest].locked) return list.map((o) => ({ ...o }));
  const next = view.slice();
  const [moved] = next.splice(from, 1);
  next.splice(dest, 0, moved);
  let out = list.map((o) => ({ ...o }));
  next.forEach((r, i) => {
    const baseIndex = base.findIndex((b) => b.id === r.id);
    const cur: LayerOverride = { ...(out.find((o) => o.id === r.id) ?? { id: r.id }) };
    if (baseIndex === i) delete cur.order; else cur.order = i;
    out = writeOverride(out, cur);
  });
  return out;
}

/** Drop every override of one layer (id given) or all of them (no id): "Reset to preset". */
export function resetOverrides(list: readonly LayerOverride[], id?: string): LayerOverride[] {
  return id === undefined ? [] : list.filter((o) => o.id !== id).map((o) => ({ ...o }));
}

function writeOverride(list: readonly LayerOverride[], cur: LayerOverride): LayerOverride[] {
  const rest = list.filter((o) => o.id !== cur.id).map((o) => ({ ...o }));
  return Object.keys(cur).length > 1 ? [...rest, cur].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : rest;
}

/** Number of user edits in a list (the inspector's "n edits" badge, and whether Reset is offered). */
export function overrideCount(list: readonly LayerOverride[]): number {
  // A drag writes `order` on every displaced row; the user made ONE edit (the new order), so it counts once.
  let n = 0, reordered = false;
  for (const o of list) { n += (o.enabled !== undefined ? 1 : 0) + (o.opacity !== undefined ? 1 : 0) + Object.keys(o.blend ?? {}).length; if (o.order !== undefined) reordered = true; }
  return n + (reordered ? 1 : 0);
}

/**
 * A stable string of the material edits for the preview's build key (PreviewScene.previewKeyWith): "" when
 * the profile has none, so every pre-wave key is byte-identical.
 */
export function texKey(marks: unknown, overrides: unknown): string {
  const m = marks && typeof marks === "object" ? JSON.stringify(marks) : "";
  const o = Array.isArray(overrides) && overrides.length ? JSON.stringify(overrides) : "";
  return m || o ? `|tex:${m}#${o}` : "";
}

/** Opacity as the inspector prints it (percent). */
export function opacityLabel(v: number): string {
  return `${Math.round(clamp01(Number.isFinite(v) ? v : 1) * 100)} %`;
}
