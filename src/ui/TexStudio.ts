// TexStudio (Wave TEX, lane U, contract C-UI): the + New page's material tools under the viewer —
//   1. the CHANNEL VIEW switch (final / albedo / roughness / height / normal / ao / marks, R's debug views),
//   2. the MARKS panel (add / remove a scar or a tattoo, its kind/style, region and side, size, width, angle,
//      age, ink(s), mirror; PLACE it by clicking or dragging on the 3D model),
//   3. the LAYERS inspector (the active material stack: toggle, opacity, operator per channel, reorder by drag
//      or by keyboard, reset to the preset).
// Marks and layer edits are written on the profile (`appearance.marks`, `appearance.layerOverrides`) and saved
// with the hero; the channel view is a view setting (canvas `data-tex-view`), never saved.
//
// CSP (style-src 'self'): every string below is markup with classes only — no style attribute anywhere.
// Wiring: the host (Menu) gives the profile and a commit function; the canvas attributes and the bubbling
// TEX_PICK_EVENT connect to PreviewScene (see TexState.ts).

import type { CharacterProfile } from "../game/Characters.ts";
import { type Region } from "../graphics/body/contracts.ts";
import {
  addMark, ageText, angleDegOf, getMark, INK_LABEL, INK_NAMES, INK_SWATCH, MARK_KIND_LABEL, MARK_RANGES, MARK_REGIONS, MAX_MARKS,
  type MarkPatch, type MarkRef, markRows, type MarkSetRec, PAIRED_REGIONS, REGION_LABEL, removeMark, SCAR_KINDS, TATTOO_STYLES,
  regionsFor, scarFlags, scarStageText, TATTOO_SYMBOLS, type TattooRec, updateMark,
} from "./MarkEdit.ts";
import {
  applyLayerOverrides, CHANNEL_VIEW_HINT, CHANNEL_VIEW_LABEL, CHANNEL_VIEWS, type ChannelView, DEFAULT_CHANNEL_VIEW, isChannelView,
  type LayerOverride, type LayerRow, nextViewIndex, overrideCount, parseLayerOverrides, reorderOverride, resetOverrides,
  setOverride, TEX_PICK_EVENT,
} from "./TexState.ts";
import { CHANNEL_LABEL, coveredRegionsOf, INSPECTOR_CHANNELS, layerGroupsFor, layerRowsFor, markIssues, operatorChoices, shownMarks } from "./TexSources.ts";

/** The inspector opens on the skin's layers (the user's first question is "how is the skin painted"). */
export const DEFAULT_LAYER_FILTER = "skin";
import type { Scar } from "../graphics/paint/marks/Scar.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** A DOM-id-safe form of a layer id (`skin.wash` -> `skin-wash`). */
export const domId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "-");
export const refKey = (r: MarkRef) => `${r.type}:${r.index}`;
export function parseRefKey(k: string | undefined): MarkRef | null {
  const m = /^(scar|tattoo):(\d{1,3})$/.exec(k ?? "");
  return m ? { type: m[1] as MarkRef["type"], index: Number(m[2]) } : null;
}

/** The detail the PreviewScene sends on TEX_PICK_EVENT (a click/drag on the model in place mode). */
export interface TexPickDetail {
  phase: "down" | "move" | "up";
  region: Region | null;
  side: 0 | 1 | null;
  /** (u, v) in M's region frame, [-1, 1]^2; null when the solver could not frame the point. */
  anchor: [number, number] | null;
  /** The bind-pose point and normal on the skin (model metres). */
  point: [number, number, number];
  normal: [number, number, number] | null;
}

// ─── Markup ──────────────────────────────────────────────────────────────────────────────────────────────

export function channelViewsHtml(view: ChannelView): string {
  return `<div class="tex-views" id="tex-views" role="radiogroup" aria-label="Channel view">` +
    CHANNEL_VIEWS.map((v) => `<button type="button" class="tex-view-btn" role="radio" data-tex-view="${v}" aria-checked="${v === view}" tabindex="${v === view ? 0 : -1}" title="${esc(CHANNEL_VIEW_HINT[v])}">${esc(CHANNEL_VIEW_LABEL[v])}</button>`).join("") +
    `</div>`;
}

const opt = (value: string, label: string, sel: boolean) => `<option value="${esc(value)}"${sel ? " selected" : ""}>${esc(label)}</option>`;
const num = (id: string, label: string, unit: string, v: number, r: readonly number[], title: string) =>
  `<label class="field tex-field" title="${esc(title)}">${esc(label)} <input id="${id}" type="number" min="${r[0]}" max="${r[1]}" step="${r[2]}" value="${v}"> ${esc(unit)}</label>`;
const check = (id: string, label: string, on: boolean, title: string) =>
  `<label class="tex-check" title="${esc(title)}"><input id="${id}" type="checkbox"${on ? " checked" : ""}><span>${esc(label)}</span></label>`;

/** The editor of the selected mark ("" = none selected). */
export function markEditorHtml(set: MarkSetRec, ref: MarkRef | null, placing: boolean, who?: { race: string; subrace?: string | null }): string {
  const m = getMark(set, ref);
  if (!m || !ref) return `<p class="tex-empty">Add a scar or a tattoo, or pick one in the list.</p>`;
  const scar = ref.type === "scar";
  const kinds = scar ? SCAR_KINDS : TATTOO_STYLES;
  const kind = scar ? (m as Scar).kind : (m as TattooRec).style;
  const paired = (PAIRED_REGIONS as readonly string[]).includes(m.region);
  const ang = angleDegOf(m);
  let h = `<div class="tex-editor-grid">`;
  h += `<label class="field tex-field">${scar ? "Kind" : "Style"} <select id="tex-kind">${kinds.map((k) => opt(k, MARK_KIND_LABEL[k], k === kind)).join("")}</select></label>`;
  h += `<label class="field tex-field">Region <select id="tex-region">${regionsFor(ref.type).map((r) => opt(r, REGION_LABEL[r] ?? r, r === m.region)).join("")}</select></label>`;
  h += paired ? `<label class="field tex-field">Side <select id="tex-side">${opt("0", "Left", m.side !== 1)}${opt("1", "Right", m.side === 1)}</select></label>` : "";
  h += `</div>`;
  h += `<div class="tex-place-row">` +
    `<button type="button" class="menu-btn menu-btn-sm tex-place-btn" data-tex-place aria-pressed="${placing}" title="Then click or drag on the model; Esc stops">${placing ? "Placing: click the model" : "Place on the model"}</button>` +
    `</div>`;
  h += `<p class="tex-subhead" id="tex-pos-head">Position (or click the model)</p>`;
  h += `<div class="tex-editor-grid" role="group" aria-labelledby="tex-pos-head">`;
  h += num("tex-u", "Around", "", +m.anchor[0].toFixed(2), MARK_RANGES.anchor, "Position around the body part (-1 back-left … 0 front … 1)");
  h += num("tex-v", "Along", "", +m.anchor[1].toFixed(2), MARK_RANGES.anchor, "Position along the body part (-1 … 1, up the trunk / toward the shoulder)");
  h += `</div>`;
  h += `<div class="tex-editor-grid">`;
  if (scar) {
    const s = m as Scar;
    h += num("tex-size", "Length", "mm", Math.round(s.lengthMm), MARK_RANGES.scarLengthMm, "Scar length");
    h += num("tex-width", "Width", "mm", s.widthMm, MARK_RANGES.scarWidthMm, "Scar width");
    h += num("tex-age", "Age", "days", s.ageDays, MARK_RANGES.scarAgeDays, "Days since the wound: red and raised when fresh, pale and flat when mature");
    h += `<p class="tex-stage" id="tex-age-stage" aria-live="polite">${esc(scarStageText(s.ageDays, who ? scarFlags(s, who.race, who.subrace) : {}))}</p>`;
  } else {
    const t = m as TattooRec;
    h += num("tex-size", "Size", "mm", Math.round(t.sizeMm), MARK_RANGES.tattooSizeMm, "Design height");
    h += num("tex-age", "Age", "years", t.ageYears, MARK_RANGES.tattooAgeYears, "Years since it was inked: the ink blurs and fades");
    h += `<label class="field tex-field">Motif <select id="tex-motif">${TATTOO_SYMBOLS.map((s) => opt(s, s[0].toUpperCase() + s.slice(1), s === t.motif)).join("")}</select></label>`;
    h += `<label class="field tex-field">Ink <select id="tex-ink">${INK_NAMES.map((k) => opt(k, INK_LABEL[k], t.inks[0] === k)).join("")}</select></label>`;
    h += `<label class="field tex-field">Accent <select id="tex-ink2">${opt("", "None", !t.inks[1])}${INK_NAMES.map((k) => opt(k, INK_LABEL[k], t.inks[1] === k)).join("")}</select></label>`;
  }
  h += num("tex-angle", "Angle", "°", ang ?? 0, MARK_RANGES.angleDeg, "0 = around the limb, 90 = along it");
  h += `</div>`;
  h += `<div class="tex-check-row">` +
    check("tex-angle-auto", scar ? "Follow skin lines" : "Upright", ang === null, scar ? "Langer's lines: the angle a surgeon would cut along" : "Upright along the body part") +
    check("tex-mirror", "Mirror", !!m.mirror, "Also on the other side") + `</div>`;
  if (!scar) h += `<p class="tex-ink-chips" aria-hidden="true">${(m as TattooRec).inks.map((k) => `<span class="tex-ink-chip tex-ink-${k}"></span>`).join("")}</p>`;
  return h;
}

export function markListHtml(set: MarkSetRec, sel: MarkRef | null, issues: Record<string, string>): string {
  const rows = markRows(set);
  if (!rows.length) return `<li class="tex-empty">No marks: a clean skin.</li>`;
  return rows.map((r) => {
    const k = refKey(r.ref), on = !!sel && refKey(sel) === k, issue = issues[k];
    return `<li class="tex-mark-item" data-type="${r.ref.type}"${issue ? ` data-issue="true"` : ""}>` +
      `<button type="button" class="tex-mark-row" role="option" id="tex-mark-${r.ref.type}-${r.ref.index}" data-tex-mark="${k}" aria-selected="${on}">` +
      `<span class="tex-mark-label">${esc(r.label)}</span><span class="tex-mark-detail">${esc(r.detail)}${issue ? ` · ${esc(issue)}` : ""}</span></button>` +
      `<button type="button" class="tex-mark-remove" data-tex-remove="${k}" aria-label="Remove ${esc(r.label)}" title="Remove">×</button></li>`;
  }).join("");
}

export function marksPanelHtml(set: MarkSetRec, generated: boolean, sel: MarkRef | null, placing: boolean, issues: Record<string, string> = {}, who?: { race: string; subrace?: string | null }): string {
  const full = { scar: set.scars.length >= MAX_MARKS.scars, tattoo: set.tattoos.length >= MAX_MARKS.tattoos };
  return `<div class="tex-actions">` +
    `<button type="button" class="menu-btn menu-btn-sm" data-tex-add="scar"${full.scar ? " disabled" : ""}>+ Scar</button>` +
    `<button type="button" class="menu-btn menu-btn-sm" data-tex-add="tattoo"${full.tattoo ? " disabled" : ""}>+ Tattoo</button>` +
    `</div>` +
    `<p class="tex-note" id="tex-marks-note">${generated ? "Rolled with the fighter (ancestry, calling, age). Any edit keeps them as yours." : "Your marks, saved with the fighter."}</p>` +
    `<ul class="tex-mark-list" id="tex-mark-list" role="listbox" aria-label="Scars and tattoos">${markListHtml(set, sel, issues)}</ul>` +
    `<div class="tex-mark-editor" id="tex-mark-editor">${markEditorHtml(set, sel, placing, who)}</div>` +
    `<p class="tex-status" id="tex-mark-status" role="status" aria-live="polite"></p>`;
}

/** One inspector row: grip, On/Off, name (expands the row), opacity; the expanded row adds the opacity stepper and one operator picker per channel. */
export function layerRowHtml(r: LayerRow, i: number, n: number, base: LayerRow | undefined, expanded: boolean): string {
  const id = domId(r.id);
  const changed = !!base && (base.enabled !== r.enabled || Math.abs(base.opacity - r.opacity) > 1e-9 || Object.keys(r.blend).some((c) => r.blend[c] !== base.blend[c]));
  const chans = INSPECTOR_CHANNELS.filter((c) => c in r.blend);
  const ops = chans.map((c) => `${CHANNEL_LABEL[c] ?? c} ${r.blend[c]}`).join(" · ");
  const lock = !!r.editLocked;
  // Channels whose operator the game path can change (P's editableOps); the others are shown, not offered.
  const editable = chans.filter((c) => !lock && (!r.ops || (r.ops[c]?.length ?? 0) > 0));
  return `<li class="tex-layer" data-tex-layer="${esc(r.id)}" data-index="${i}" data-enabled="${r.enabled}"${changed ? ` data-changed="true"` : ""}${expanded ? ` data-expanded="true"` : ""}${lock ? ` data-locked="true"` : ""}>` +
    `<div class="tex-layer-head">` +
    `<button type="button" class="tex-layer-grip" id="tex-grip-${id}" data-tex-grip="${i}"${lock ? ` disabled aria-label="${esc(r.name)} is fixed in place"` : ` aria-label="Move ${esc(r.name)} (${i + 1} of ${n}): drag, or arrow up/down"`} title="${lock ? "Fixed: the paint's safety step" : "Drag to reorder (or arrow up/down)"}">${lock ? "🔒" : "⠿"}</button>` +
    `<button type="button" class="tex-layer-toggle" id="tex-toggle-${id}" data-tex-toggle="${esc(r.id)}" aria-pressed="${r.enabled}" aria-label="${r.enabled ? "Hide" : "Show"} ${esc(r.name)}"${lock ? " disabled" : ""}>${r.enabled ? "On" : "Off"}</button>` +
    `<button type="button" class="tex-layer-name" id="tex-open-${id}" data-tex-open="${esc(r.id)}" aria-expanded="${expanded}" aria-controls="tex-ops-${id}" title="Opacity and operators">` +
    `<span class="tex-layer-title">${esc(r.name)}</span><span class="tex-layer-src">${esc(`${Math.round(r.opacity * 100)} % · ${ops || r.source || ""}`)}</span></button>` +
    `</div>` +
    (expanded ? `<div class="tex-layer-ops" id="tex-ops-${id}">` +
      (lock ? `<p class="tex-note">A safety step of the paint (keeps colours in range): it cannot be edited.</p>` :
        `<label class="field tex-field">Opacity <input id="tex-op-${id}" data-tex-opacity="${esc(r.id)}" type="number" min="0" max="100" step="5" value="${Math.round(r.opacity * 100)}"> %</label>` +
        editable.map((c) => `<label class="field tex-field">${esc(CHANNEL_LABEL[c] ?? c)} <select id="tex-blend-${id}-${c}" data-tex-blend="${esc(r.id)}" data-channel="${c}">` +
          operatorChoices(c, base?.blend[c], r.ops?.[c]).map((op) => opt(op, op, op === r.blend[c])).join("") + `</select></label>`).join("") +
        (editable.length < chans.length ? `<p class="tex-note">${esc(chans.filter((c) => !editable.includes(c)).map((c) => CHANNEL_LABEL[c] ?? c).join(", "))}: fixed (fine detail drawn by the shader).</p>` : "")) +
      `</div>` : "") +
    `</li>`;
}

/** The inspector: the material filter, Reset, and the rows of the chosen material (all when "all"), bottom first. */
export function layersPanelHtml(rows: readonly LayerRow[], base: readonly LayerRow[], overrides: readonly LayerOverride[], groups: readonly { id: string; label: string; count: number }[] = [], filter = "all", expanded: string | null = null): string {
  const edits = overrideCount(overrides);
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => filter === "all" || (r.group ?? "*") === filter);
  return `<div class="tex-actions">` +
    (groups.length ? `<label class="field tex-field tex-filter">Material <select id="tex-layer-material">${opt("all", `All (${rows.length})`, filter === "all")}${groups.map((g) => opt(g.id, `${g.label} (${g.count})`, g.id === filter)).join("")}</select></label>` : "") +
    `<button type="button" class="menu-btn menu-btn-sm" data-tex-reset${edits ? "" : " disabled"}>Reset to preset</button>` +
    `<span class="tex-note" id="tex-layer-edits">${edits ? `${edits} edit${edits === 1 ? "" : "s"}` : "The preset as rolled"}</span>` +
    `</div>` +
    `<p class="tex-note" id="tex-layers-help">Bottom first: each layer paints over the ones above it. Open a layer for its opacity and operators.</p>` +
    (shown.length ? `<ol class="tex-layer-list" id="tex-layer-list">${shown.map(({ r, i }) => layerRowHtml(r, i, rows.length, base.find((b) => b.id === r.id), expanded === r.id)).join("")}</ol>`
      : `<p class="tex-empty">No material stack for this fighter yet.</p>`);
}

/** The whole studio (inserted under the generator's stage scrubber). */
export function texStudioHtml(profile: CharacterProfile, view: ChannelView = DEFAULT_CHANNEL_VIEW): string {
  const { set, generated } = shownMarks(profile);
  const base = layerRowsFor(profile);
  const ov = parseLayerOverrides((profile.appearance as { layerOverrides?: unknown }).layerOverrides);
  return `<section class="tex-studio" id="tex-studio" aria-label="Skin and material">` +
    `<h4 class="group-head tex-head">Surface</h4>` +
    channelViewsHtml(view) +
    `<p class="tex-note tex-view-note" id="tex-view-note">${esc(CHANNEL_VIEW_HINT[view])}</p>` +
    `<details class="tex-block" id="tex-marks"><summary class="tex-summary"><span class="tex-summary-title">Scars &amp; tattoos</span><span class="tex-count" id="tex-marks-count">${set.scars.length + set.tattoos.length}</span></summary>` +
    `<div class="tex-body" id="tex-marks-body">${marksPanelHtml(set, generated, null, false, markIssues(profile, set), { race: profile.race, subrace: profile.subrace })}</div></details>` +
    `<details class="tex-block" id="tex-layers"><summary class="tex-summary"><span class="tex-summary-title">Material layers</span><span class="tex-count" id="tex-layers-count">${base.length}</span></summary>` +
    `<div class="tex-body" id="tex-layers-body">${layersPanelHtml(applyLayerOverrides(base, ov), base, ov, layerGroupsFor(profile), DEFAULT_LAYER_FILTER)}</div></details>` +
    `</section>`;
}

// ─── Controller ─────────────────────────────────────────────────────────────────────────────────────────

export interface TexHost {
  profile(): CharacterProfile;
  /** Write the edited profile; `quiet` = do not rebuild the model yet (a drag in progress). */
  commit(next: CharacterProfile, quiet?: boolean): void;
  canvas(): HTMLElement | null;
  /** The generator stage shown (wave GEN scrubber) and a way to switch it to Paint. */
  genStage(): string;
  showPaintStage(): void;
}

/** QA view of the studio (Menu exposes it). */
export interface TexDebug { covered: string[]; filter: string; expanded: string | null; view: ChannelView; placing: boolean; selected: string | null; marks: MarkSetRec; generated: boolean; overrides: LayerOverride[]; rows: { id: string; enabled: boolean; opacity: number; blend: Record<string, string> }[]; picks: number; lastPick: TexPickDetail | null; status: string }

export class TexStudio {
  #el: HTMLElement;
  #host: TexHost;
  #view: ChannelView = DEFAULT_CHANNEL_VIEW;
  #sel: MarkRef | null = null;
  #placing = false;
  #builtFor = "";
  #picks = 0;
  #lastPick: TexPickDetail | null = null;
  #drag: { from: number; pointer: number; to: number } | null = null;
  #layerFilter = DEFAULT_LAYER_FILTER;
  #expanded: string | null = null;
  #abort = new AbortController();

  constructor(el: HTMLElement, host: TexHost, eventRoot: HTMLElement) {
    this.#el = el;
    this.#host = host;
    const sig = this.#abort.signal;
    el.addEventListener("click", (e) => this.#onClick(e), { signal: sig });
    el.addEventListener("input", (e) => this.#onInput(e), { signal: sig });
    el.addEventListener("change", (e) => { if ((e.target as HTMLInputElement).type === "checkbox") this.#onInput(e); }, { signal: sig });
    el.addEventListener("keydown", (e) => this.#onKey(e), { signal: sig });
    el.addEventListener("pointerdown", (e) => this.#onGripDown(e), { signal: sig });
    eventRoot.addEventListener(TEX_PICK_EVENT, (e) => this.#onPick((e as CustomEvent<TexPickDetail>).detail), { signal: sig });
    // Esc anywhere stops placing (the canvas is outside this section).
    globalThis.addEventListener?.("keydown", (e: Event) => { if ((e as KeyboardEvent).key === "Escape" && this.#placing) this.setPlacing(false); }, { signal: sig } as AddEventListenerOptions);
    this.#builtFor = this.#identity();
    this.#writeCanvas();
  }

  dispose(): void { this.#abort.abort(); }

  get view(): ChannelView { return this.#view; }

  /** The profile changed from outside (roll, preset, load): rebuild lists if its material identity changed. */
  sync(): void {
    const id = this.#identity();
    if (id === this.#builtFor) return;
    this.#builtFor = id;
    const { set } = shownMarks(this.#host.profile());
    if (this.#sel && !getMark(set, this.#sel)) { this.#sel = null; this.setPlacing(false); }
    this.#renderMarks();
    this.#renderLayers();
  }

  /** Everything the panel shows depends on: marks, overrides, and the preset's inputs. */
  #identity(): string {
    const p = this.#host.profile(), a = p.appearance as CharacterProfile["appearance"] & { marks?: unknown; layerOverrides?: unknown };
    return `${p.name}|${p.race}|${p.subrace}|${p.className}|${p.birthsign}|${a.body}|${a.accent}|${a.hair}|${a.sex}|${a.height}|${JSON.stringify(a.marks ?? null)}|${JSON.stringify(a.layerOverrides ?? null)}`;
  }

  // ── channel view ──
  setView(v: ChannelView): void {
    if (!isChannelView(v)) return;
    this.#view = v;
    // The material channels exist on the finished body only: a channel view brings the scrubber to 7 Paint.
    if (v !== "final" && this.#host.genStage() !== "paint") this.#host.showPaintStage();
    this.#el.querySelectorAll<HTMLElement>("[data-tex-view]").forEach((b) => {
      const on = b.dataset.texView === v;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const note = this.#el.querySelector("#tex-view-note");
    if (note) note.textContent = CHANNEL_VIEW_HINT[v];
    this.#writeCanvas();
  }

  /** Called by the host when the GEN stage changes: channel views are shown on Paint only. */
  onGenStage(stage: string): void {
    this.#el.dataset.genStage = stage;
    const note = this.#el.querySelector("#tex-view-note");
    if (note) note.textContent = stage !== "paint" && this.#view !== "final" ? `${CHANNEL_VIEW_LABEL[this.#view]} shows on 7 Paint (the finished body).` : CHANNEL_VIEW_HINT[this.#view];
    this.#writeCanvas();
  }

  #writeCanvas(): void {
    const c = this.#host.canvas();
    if (!c) return;
    // Canvas attribute names differ from the studio's own data-tex-* hooks (a page-wide selector must never hit the canvas).
    c.dataset.texChannel = this.#view;
    c.dataset.texPlacing = this.#placing && this.#sel ? this.#sel.type : "";
    c.dataset.texSelected = this.#sel ? refKey(this.#sel) : "";
  }

  // ── marks ──
  #marks(): { set: MarkSetRec; generated: boolean } { return shownMarks(this.#host.profile()); }

  #commitMarks(set: MarkSetRec, quiet = false): void {
    const p = this.#host.profile();
    const next = { ...p, appearance: { ...p.appearance, marks: set } } as CharacterProfile;
    this.#host.commit(next, quiet);
    this.#builtFor = this.#identity();
  }

  select(ref: MarkRef | null): void {
    this.#sel = ref && getMark(this.#marks().set, ref) ? ref : null;
    if (!this.#sel) this.#placing = false;
    this.#renderMarks();
  }

  setPlacing(on: boolean): void {
    this.#placing = on && !!this.#sel;
    const b = this.#el.querySelector<HTMLElement>("[data-tex-place]");
    if (b) { b.setAttribute("aria-pressed", String(this.#placing)); b.textContent = this.#placing ? "Placing: click the model" : "Place on the model"; }
    this.#status(this.#placing ? "Click or drag on the model to place it. Esc stops." : "");
    this.#writeCanvas();
  }

  add(type: MarkRef["type"]): boolean {
    const p = this.#host.profile();
    const motif = TATTOO_SYMBOLS[0];
    const r = addMark(this.#marks().set, type, p.name, motif);
    if (!r) { this.#status(`At most ${type === "scar" ? MAX_MARKS.scars : MAX_MARKS.tattoos} ${type}s.`); return false; }
    this.#commitMarks(r.set);
    this.#sel = r.ref;
    this.#placing = true;
    this.#renderMarks();
    this.#status("Added. Click or drag on the model to place it. Esc stops.");
    return true;
  }

  remove(ref: MarkRef): void {
    const set = removeMark(this.#marks().set, ref);
    this.#commitMarks(set);
    if (this.#sel && refKey(this.#sel) === refKey(ref)) { this.#sel = null; this.#placing = false; }
    else if (this.#sel && this.#sel.type === ref.type && this.#sel.index > ref.index) this.#sel = { ...this.#sel, index: this.#sel.index - 1 };
    this.#renderMarks();
    this.#status("Removed.");
    this.#el.querySelector<HTMLElement>("[data-tex-add]")?.focus({ preventScroll: true });
  }

  edit(patch: MarkPatch, quiet = false): void {
    if (!this.#sel) return;
    const before = this.#marks().set;
    const set = updateMark(before, this.#sel, patch);
    this.#commitMarks(set, quiet);
    // A region/type change re-renders the editor (the side picker, the units); a value edit only the list row.
    const prev = getMark(before, this.#sel), now = getMark(set, this.#sel);
    if (patch.region !== undefined && prev?.region !== now?.region) this.#renderMarks();
    else this.#refreshMarkRows(set);
  }

  #onPick(d: TexPickDetail): void {
    if (!this.#placing || !this.#sel || !d) return;
    this.#picks++;
    this.#lastPick = d;
    if (!d.region || !(regionsFor(this.#sel.type) as readonly string[]).includes(d.region)) {
      if (d.phase !== "move") this.#status(d.region && (MARK_REGIONS as readonly string[]).includes(d.region) ? `No tattoos on the ${(REGION_LABEL[d.region] ?? d.region).toLowerCase()}: try another spot.` : "No skin there (hair, nails or gear): try another spot.");
      return;
    }
    const patch: MarkPatch = { region: d.region, anchor: d.anchor ?? [0, 0] };
    if (d.side !== null) patch.side = d.side;
    const cur = getMark(this.#marks().set, this.#sel);
    const regionChanged = cur?.region !== d.region || (cur?.side ?? 0) !== (d.side ?? cur?.side ?? 0);
    const set = updateMark(this.#marks().set, this.#sel, patch);
    // The drag follows live (quiet: no model rebuild per move); the release rebuilds once.
    this.#commitMarks(set, d.phase === "move");
    if (regionChanged || d.phase === "up") this.#renderMarks(); else this.#syncEditorValues(set);
    const m = getMark(set, this.#sel);
    if (m && d.phase !== "move") this.#status(`Placed on the ${(REGION_LABEL[m.region] ?? m.region).toLowerCase()} at ${m.anchor[0].toFixed(2)}, ${m.anchor[1].toFixed(2)}.`);
  }

  #syncEditorValues(set: MarkSetRec): void {
    const m = getMark(set, this.#sel);
    if (!m) return;
    const put = (id: string, v: string) => { const el = this.#el.querySelector<HTMLInputElement>(`#${id}`); if (el && el.value !== v) el.value = v; };
    put("tex-u", String(+m.anchor[0].toFixed(2)));
    put("tex-v", String(+m.anchor[1].toFixed(2)));
    this.#refreshMarkRows(set);
  }

  #refreshMarkRows(set: MarkSetRec): void {
    const list = this.#el.querySelector("#tex-mark-list");
    if (list) list.innerHTML = markListHtml(set, this.#sel, markIssues(this.#host.profile(), set));
    const count = this.#el.querySelector("#tex-marks-count");
    if (count) count.textContent = String(set.scars.length + set.tattoos.length);
    const note = this.#el.querySelector("#tex-marks-note");
    if (note) note.textContent = "Your marks, saved with the fighter.";
  }

  #renderMarks(): void {
    const body = this.#el.querySelector("#tex-marks-body");
    const { set, generated } = this.#marks();
    const p = this.#host.profile();
    if (body) body.innerHTML = marksPanelHtml(set, generated, this.#sel, this.#placing, markIssues(p, set), { race: p.race, subrace: p.subrace });
    const count = this.#el.querySelector("#tex-marks-count");
    if (count) count.textContent = String(set.scars.length + set.tattoos.length);
    this.#writeCanvas();
  }

  #status(msg: string): void {
    const s = this.#el.querySelector("#tex-mark-status");
    if (s) s.textContent = msg;
  }

  // ── layers ──
  #base(): LayerRow[] { return layerRowsFor(this.#host.profile()); }
  #overrides(): LayerOverride[] { return parseLayerOverrides((this.#host.profile().appearance as { layerOverrides?: unknown }).layerOverrides); }
  rows(): LayerRow[] { return applyLayerOverrides(this.#base(), this.#overrides()); }

  #commitOverrides(list: LayerOverride[], rerender: boolean): void {
    const p = this.#host.profile();
    const appearance = { ...p.appearance } as CharacterProfile["appearance"] & { layerOverrides?: LayerOverride[] };
    if (list.length) appearance.layerOverrides = list; else delete appearance.layerOverrides;
    this.#host.commit({ ...p, appearance } as CharacterProfile);
    this.#builtFor = this.#identity();
    if (rerender) this.#renderLayers(); else this.#paintLayerMeta();
  }

  toggleLayer(id: string): void {
    const row = this.rows().find((r) => r.id === id);
    if (!row) return;
    this.#commitOverrides(setOverride(this.#overrides(), this.#base(), id, { enabled: !row.enabled }), false);
    const li = this.#el.querySelector<HTMLElement>(`[data-tex-layer="${CSS.escape(id)}"]`);
    const b = li?.querySelector<HTMLElement>("[data-tex-toggle]");
    if (li && b) { li.dataset.enabled = String(!row.enabled); b.setAttribute("aria-pressed", String(!row.enabled)); b.textContent = !row.enabled ? "On" : "Off"; b.setAttribute("aria-label", `${!row.enabled ? "Hide" : "Show"} ${row.name}`); }
  }

  setOpacity(id: string, pct: number): void {
    this.#commitOverrides(setOverride(this.#overrides(), this.#base(), id, { opacity: pct / 100 }), false);
  }

  setBlend(id: string, channel: string, op: string): void {
    this.#commitOverrides(setOverride(this.#overrides(), this.#base(), id, { channel, op }), false);
  }

  move(from: number, to: number): void {
    const before = this.rows()[from];
    const next = reorderOverride(this.#overrides(), this.#base(), from, to);
    this.#commitOverrides(next, true);
    const moved = before ?? this.rows()[Math.max(0, Math.min(this.rows().length - 1, to))];
    if (moved) this.#el.querySelector<HTMLElement>(`#tex-grip-${domId(moved.id)}`)?.focus({ preventScroll: true });
  }

  resetLayers(): void { this.#commitOverrides(resetOverrides(this.#overrides()), true); }

  /** Show one material's layers ("all" = the whole stack). */
  setLayerFilter(f: string): void { this.#layerFilter = f || "all"; this.#renderLayers(); this.#el.querySelector<HTMLElement>("#tex-layer-material")?.focus({ preventScroll: true }); }

  /** Open / close a layer's opacity + operator pickers (one open at a time keeps the list short). */
  toggleExpanded(id: string): void {
    this.#expanded = this.#expanded === id ? null : id;
    this.#renderLayers();
    this.#el.querySelector<HTMLElement>(`#tex-open-${domId(id)}`)?.focus({ preventScroll: true });
  }

  /** The VISIBLE rows' global indices, in list order (filter applied). */
  #visibleIndices(): number[] {
    return [...this.#el.querySelectorAll<HTMLElement>("#tex-layer-list [data-tex-layer]")].map((li) => Number(li.dataset.index));
  }

  #paintLayerMeta(): void {
    const ov = this.#overrides(), n = overrideCount(ov);
    const edits = this.#el.querySelector("#tex-layer-edits");
    if (edits) edits.textContent = n ? `${n} edit${n === 1 ? "" : "s"}` : "The preset as rolled";
    const reset = this.#el.querySelector<HTMLButtonElement>("[data-tex-reset]");
    if (reset) reset.disabled = n === 0;
    const base = this.#base();
    for (const r of this.rows()) {
      const li = this.#el.querySelector<HTMLElement>(`[data-tex-layer="${CSS.escape(r.id)}"]`);
      const b = base.find((x) => x.id === r.id);
      if (!li || !b) continue;
      const changed = b.enabled !== r.enabled || Math.abs(b.opacity - r.opacity) > 1e-9 || Object.keys(r.blend).some((c) => r.blend[c] !== b.blend[c]);
      if (changed) li.dataset.changed = "true"; else delete li.dataset.changed;
    }
  }

  #renderLayers(): void {
    const body = this.#el.querySelector("#tex-layers-body");
    const base = this.#base(), ov = this.#overrides(), groups = layerGroupsFor(this.#host.profile());
    if (this.#layerFilter !== "all" && !groups.some((g) => g.id === this.#layerFilter)) this.#layerFilter = "all";
    if (body) body.innerHTML = layersPanelHtml(applyLayerOverrides(base, ov), base, ov, groups, this.#layerFilter, this.#expanded);
    const count = this.#el.querySelector("#tex-layers-count");
    if (count) count.textContent = String(base.length);
  }

  // ── events ──
  #onClick(e: Event): void {
    const t = e.target as Element | null;
    const v = t?.closest<HTMLElement>("[data-tex-view]");
    if (v) { this.setView(v.dataset.texView as ChannelView); return; }
    const add = t?.closest<HTMLElement>("[data-tex-add]");
    if (add) { this.add(add.dataset.texAdd as MarkRef["type"]); return; }
    const rm = t?.closest<HTMLElement>("[data-tex-remove]");
    if (rm) { const r = parseRefKey(rm.dataset.texRemove); if (r) this.remove(r); return; }
    const row = t?.closest<HTMLElement>("[data-tex-mark]");
    if (row) { const r = parseRefKey(row.dataset.texMark); this.select(r); this.#el.querySelector<HTMLElement>(`[data-tex-mark="${row.dataset.texMark}"]`)?.focus({ preventScroll: true }); return; }
    if (t?.closest("[data-tex-place]")) { this.setPlacing(!this.#placing); return; }
    if (t?.closest("[data-tex-reset]")) { this.resetLayers(); return; }
    const tog = t?.closest<HTMLElement>("[data-tex-toggle]");
    if (tog) { this.toggleLayer(tog.dataset.texToggle!); return; }
    const open = t?.closest<HTMLElement>("[data-tex-open]");
    if (open) { this.toggleExpanded(open.dataset.texOpen!); return; }
  }

  #onInput(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (!t || !t.id) return;
    const n = Number(t.value);
    const layer = (t as HTMLElement).dataset;
    if (layer.texOpacity !== undefined) { if (Number.isFinite(n)) { this.setOpacity(layer.texOpacity, n); this.#paintRowCaption(layer.texOpacity); } return; }
    if (layer.texBlend !== undefined) { this.setBlend(layer.texBlend, layer.channel ?? "", t.value); this.#paintRowCaption(layer.texBlend); return; }
    if (t.id === "tex-layer-material") { this.setLayerFilter(t.value); return; }
    switch (t.id) {
      case "tex-kind": this.edit({ kind: t.value }); break;
      case "tex-region": this.edit({ region: t.value }); break;
      case "tex-side": this.edit({ side: t.value === "1" ? 1 : 0 }); break;
      case "tex-u": case "tex-v": {
        const m = getMark(this.#marks().set, this.#sel);
        if (m && Number.isFinite(n)) this.edit({ anchor: t.id === "tex-u" ? [n, m.anchor[1]] : [m.anchor[0], n] });
        break;
      }
      case "tex-size": if (Number.isFinite(n)) this.edit({ size: n }); break;
      case "tex-width": if (Number.isFinite(n)) this.edit({ width: n }); break;
      case "tex-age": {
        if (!Number.isFinite(n)) break;
        this.edit({ age: n });
        const st = this.#el.querySelector("#tex-age-stage"), m = getMark(this.#marks().set, this.#sel);
        const p = this.#host.profile();
        if (st && m && this.#sel?.type === "scar") st.textContent = scarStageText((m as Scar).ageDays, scarFlags(m as Scar, p.race, p.subrace));
        break;
      }
      case "tex-angle": if (Number.isFinite(n)) { this.edit({ angleDeg: n }); const a = this.#el.querySelector<HTMLInputElement>("#tex-angle-auto"); if (a) a.checked = false; } break;
      case "tex-angle-auto": {
        const angle = this.#el.querySelector<HTMLInputElement>("#tex-angle");
        this.edit({ angleDeg: (t as HTMLInputElement).checked ? "auto" : Number(angle?.value ?? 0) });
        break;
      }
      case "tex-mirror": this.edit({ mirror: (t as HTMLInputElement).checked }); break;
      case "tex-motif": this.edit({ motif: t.value }); break;
      case "tex-ink": this.edit({ ink: t.value }); this.#paintInkChips(); break;
      case "tex-ink2": this.edit({ ink2: t.value || null }); this.#paintInkChips(); break;
    }
  }

  /** Refresh one row's caption (opacity · operators) after an edit inside its open pickers. */
  #paintRowCaption(id: string): void {
    const r = this.rows().find((x) => x.id === id);
    const src = this.#el.querySelector(`#tex-open-${domId(id)} .tex-layer-src`);
    if (!r || !src) return;
    const ops = INSPECTOR_CHANNELS.filter((c) => c in r.blend).map((c) => `${CHANNEL_LABEL[c] ?? c} ${r.blend[c]}`).join(" · ");
    src.textContent = `${Math.round(r.opacity * 100)} % · ${ops || r.source || ""}`;
  }

  #paintInkChips(): void {
    const m = getMark(this.#marks().set, this.#sel) as TattooRec | null;
    const p = this.#el.querySelector(".tex-ink-chips");
    if (p && m?.inks) p.innerHTML = m.inks.map((k) => `<span class="tex-ink-chip tex-ink-${k}"></span>`).join("");
  }

  #onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    const v = t?.closest<HTMLElement>("[data-tex-view]");
    if (v) {
      const i = CHANNEL_VIEWS.indexOf(v.dataset.texView as ChannelView), next = nextViewIndex(i, e.key);
      if (next === null) return;
      e.preventDefault();
      this.setView(CHANNEL_VIEWS[next]);
      this.#el.querySelector<HTMLElement>(`[data-tex-view="${CHANNEL_VIEWS[next]}"]`)?.focus();
      return;
    }
    const grip = t?.closest<HTMLElement>("[data-tex-grip]");
    if (grip && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const i = Number(grip.dataset.texGrip), vis = this.#visibleIndices(), k = vis.indexOf(i);
      const j = vis[k + (e.key === "ArrowUp" ? -1 : 1)];
      if (j !== undefined) this.move(i, j);
      return;
    }
    const row = t?.closest<HTMLElement>("[data-tex-mark]");
    if (row && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const all = [...this.#el.querySelectorAll<HTMLElement>("[data-tex-mark]")];
      const i = all.indexOf(row), j = i + (e.key === "ArrowUp" ? -1 : 1);
      if (j >= 0 && j < all.length) { e.preventDefault(); all[j].focus(); }
      return;
    }
    if (row && (e.key === "Delete" || e.key === "Backspace")) {
      const r = parseRefKey(row.dataset.texMark);
      if (r) { e.preventDefault(); this.remove(r); }
    }
  }

  // Drag to reorder: pointer capture on the grip; the drop slot = the row under the pointer's y.
  #onGripDown(e: PointerEvent): void {
    const grip = (e.target as Element | null)?.closest<HTMLElement>("[data-tex-grip]");
    if (!grip || (e.pointerType === "mouse" && e.button !== 0)) return;
    const from = Number(grip.dataset.texGrip);
    this.#drag = { from, pointer: e.pointerId, to: from };
    try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const list = this.#el.querySelector<HTMLElement>("#tex-layer-list");
    list?.setAttribute("data-dragging", "true");
    const move = (ev: PointerEvent) => {
      if (!this.#drag || ev.pointerId !== this.#drag.pointer) return;
      ev.preventDefault();
      const items = [...(list?.querySelectorAll<HTMLElement>("[data-tex-layer]") ?? [])];
      // The drop slot among the OTHER visible rows (the list may be filtered by material, so slots map to GLOBAL
      // indices): insert before the first row whose middle is below the pointer. Moving up -> that row's index;
      // moving down -> the index of the row just above the slot (splice semantics: remove, then insert).
      const others = items.filter((it) => Number(it.dataset.index) !== from);
      let j = 0;
      while (j < others.length) { const r = others[j].getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) break; j++; }
      const below = others[j] ? Number(others[j].dataset.index) : Infinity, above = j > 0 ? Number(others[j - 1].dataset.index) : -Infinity;
      const to = below < from ? below : above > from ? above : from;
      this.#drag.to = to;
      items.forEach((it) => { const gi = Number(it.dataset.index); if (gi === to && to !== from) it.dataset.dropTarget = to < from ? "before" : "after"; else delete it.dataset.dropTarget; });
    };
    const up = (ev: PointerEvent) => {
      if (!this.#drag || ev.pointerId !== this.#drag.pointer) return;
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      const d = this.#drag;
      this.#drag = null;
      list?.removeAttribute("data-dragging");
      if (ev.type === "pointerup" && d.to !== d.from) this.move(d.from, d.to);
      else list?.querySelectorAll<HTMLElement>("[data-drop-target]").forEach((x) => delete x.dataset.dropTarget);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  /** QA: what the studio holds. */
  debug(): TexDebug {
    const { set, generated } = this.#marks();
    return {
      covered: coveredRegionsOf(this.#host.profile()), filter: this.#layerFilter, expanded: this.#expanded, view: this.#view, placing: this.#placing, selected: this.#sel ? refKey(this.#sel) : null, marks: set, generated, overrides: this.#overrides(),
      rows: this.rows().map((r) => ({ id: r.id, enabled: r.enabled, opacity: r.opacity, blend: { ...r.blend } })), picks: this.#picks, lastPick: this.#lastPick,
      status: this.#el.querySelector("#tex-mark-status")?.textContent ?? "",
    };
  }
}

/** Ink swatch colours (CSS classes .tex-ink-<name> carry them; listed for the docs/tests). */
export const INK_CHIP = INK_SWATCH;
export { ageText };
