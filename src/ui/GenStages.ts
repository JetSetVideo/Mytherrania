// GenStages (Wave GEN, lane U): the Creator's STAGE SCRUBBER — the seven steps of the body generator
// (P's Pipeline.generateStaged: Skeleton -> Cage -> Inflate -> Carve -> Skin -> Hitboxes -> Paint) as a
// compact segmented control under the viewer, and the readout of the shown stage (its wall time and its
// key metrics, read from the StageRecord the pipeline returned).
//
// Wiring (no Engine edit): the Menu writes the chosen stage to the preview canvas as `data-gen-view`;
// PreviewScene reads it on its next frame, renders that stage, and dispatches `GEN_STAGES_EVENT` on the
// canvas with the stage records; the Menu paints the readout from that event.
//
// Pure module (the markup is a string with NO style attribute: the page CSP is style-src 'self').

/** The pipeline's stage ids, in order (mirrors Pipeline.STAGE_IDS; pinned equal in tests). */
export const GEN_STAGE_IDS = ["skeleton", "cage", "inflate", "carve", "skin", "hitboxes", "paint"] as const;
export type GenStageId = typeof GEN_STAGE_IDS[number];
/** The stage shown by default (the finished, painted fighter = the pre-wave view). */
export const DEFAULT_GEN_STAGE: GenStageId = "paint";
/** Event PreviewScene dispatches on its canvas after it (re)computed or switched the stage view. */
export const GEN_STAGES_EVENT = "mytherrania:gen-stages";

/** A stage record as the pipeline reports it (Pipeline.StageRecord, structurally). */
export interface GenStageRecord { id: string; label: string; ms: number; metrics: Record<string, number>; warnings: string[] }
/** The event's detail. */
export interface GenStagesDetail {
  stage: GenStageId;
  /** The staged body's records (empty until a stage view computed them for the current body). */
  stages: GenStageRecord[];
  /** generateStaged wall time and the shown view's build time, ms. */
  buildMs: number;
  viewMs: number;
  /** idle = nothing computed yet, pending = recomputing after an edit, ready = the view matches the body. */
  state: "idle" | "pending" | "ready";
  /** The last rig rebuild (build + first draw), ms. */
  rebuildMs: number;
}

export const GEN_STAGE_LABEL: Readonly<Record<GenStageId, string>> = {
  skeleton: "Skeleton", cage: "Cage", inflate: "Inflate", carve: "Carve", skin: "Skin", hitboxes: "Hitboxes", paint: "Paint",
};
/** What each stage view draws (the button's title and the readout's caption). */
export const GEN_STAGE_HINT: Readonly<Record<GenStageId, string>> = {
  skeleton: "Bones and cross-section disks, shown in a T-pose",
  cage: "The six-sided cage of every body part (wire boxes)",
  inflate: "Volumes inflated inside the cage, before carving",
  carve: "Muscles and landmarks carved (brush centres marked)",
  skin: "The polygon skin, coloured by the bone that moves each vertex",
  hitboxes: "Combat capsules over the skin",
  paint: "The finished, painted fighter",
};

/**
 * The metrics the readout shows first, per stage (any other metric follows, up to READOUT_MAX). Names are
 * the pipeline's; an absent one is skipped, so a renamed metric degrades to "the first ones reported".
 */
export const KEY_METRICS: Readonly<Record<GenStageId, readonly string[]>> = {
  skeleton: ["bones", "disks", "heightM", "armAbductionDeg"],
  cage: ["parts", "meanWidthMm"],
  inflate: ["primitives", "cageViolationMm", "cageFill", "clampedPrimitives"],
  carve: ["strokes", "strokeReachMm", "physiqueParts"],
  skin: ["triangles", "vertices", "weightSumMaxErr", "components"],
  hitboxes: ["capsules", "coveragePct", "overshootP95Mm", "uncoveredMaxMm"],
  paint: ["ridgeCavityContrast", "ridgeRatio", "cavityRatio", "weatheredShare"],
};
export const READOUT_MAX = 4;

/** True when `s` names a stage. */
export function isGenStage(s: unknown): s is GenStageId {
  return typeof s === "string" && (GEN_STAGE_IDS as readonly string[]).includes(s);
}

/** A metric's display label: camelCase -> words, a unit suffix (Mm, Ms, Pct, M, L) as its symbol. */
export function metricLabel(key: string): string {
  const units: [RegExp, string][] = [[/Mm$/, " (mm)"], [/Deg$/, " (°)"], [/Ms$/, " (ms)"], [/Pct$/, " (%)"], [/L$/, " (L)"], [/M$/, " (m)"]];
  let base = key, unit = "";
  for (const [re, u] of units) if (re.test(key) && key.length > 2) { base = key.replace(re, ""); unit = u; break; }
  const words = base.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1) + unit;
}

/** A metric value: integers plain with thin-space thousands, fractions to 3 significant decimals. */
export function metricValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Number.isInteger(v)) return Math.abs(v) >= 10000 ? v.toLocaleString("en-US").replace(/,/g, "\u2009") : String(v);
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
}

/** Milliseconds, one decimal under 100 ms. */
export function msText(ms: number): string {
  if (!Number.isFinite(ms)) return "— ms";
  return `${ms >= 100 ? Math.round(ms) : ms.toFixed(1)} ms`;
}

export interface StageReadout { id: GenStageId; title: string; hint: string; ms: string; metrics: { key: string; label: string; value: string }[]; warnings: string[] }

/** The readout of one stage from the pipeline's records (null when the stage was not reported). */
export function stageReadout(id: GenStageId, stages: readonly GenStageRecord[]): StageReadout | null {
  const r = stages.find((s) => s.id === id);
  if (!r) return null;
  const keys = Object.keys(r.metrics ?? {});
  const first = KEY_METRICS[id].filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !first.includes(k));
  const pick = [...first, ...rest].slice(0, READOUT_MAX);
  return {
    id, title: r.label || GEN_STAGE_LABEL[id], hint: GEN_STAGE_HINT[id], ms: msText(r.ms),
    metrics: pick.map((k) => ({ key: k, label: metricLabel(k), value: metricValue(r.metrics[k]) })),
    warnings: [...(r.warnings ?? [])],
  };
}

/** True when a stage reported a skip (its time is not in the total yet). */
export function partialStages(stages: readonly GenStageRecord[]): boolean {
  return stages.some((r) => (r.warnings ?? []).some((w) => /^skipped/.test(w)));
}

/** The total generation time of the reported stages. */
export function totalMs(stages: readonly GenStageRecord[]): number {
  return stages.reduce((s, r) => s + (Number.isFinite(r.ms) ? r.ms : 0), 0);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The segmented control (a radio group of seven buttons) and its (empty) readout. */
export function stageScrubberHtml(active: GenStageId = DEFAULT_GEN_STAGE): string {
  return `<div class="gen-stages" id="gen-stages">` +
    `<div class="gen-stage-seg" role="radiogroup" aria-label="Generation stage shown in the viewer">` +
    GEN_STAGE_IDS.map((id, i) =>
      `<button type="button" class="gen-stage-btn" role="radio" data-gen-stage="${id}" aria-checked="${id === active}" tabindex="${id === active ? 0 : -1}" title="${esc(`${i + 1}. ${GEN_STAGE_LABEL[id]} — ${GEN_STAGE_HINT[id]}`)}">` +
      `<span class="gen-stage-num" aria-hidden="true">${i + 1}</span><span class="gen-stage-name">${GEN_STAGE_LABEL[id]}</span></button>`).join("") +
    `</div>` +
    `<div class="gen-stage-readout" id="gen-stage-readout" aria-live="polite"></div>` +
    `</div>`;
}

/** The readout's markup (title + ms, the caption, the metrics as a definition list, warnings). */
export function stageReadoutHtml(r: StageReadout | null, total?: number, partial = false): string {
  if (!r) return `<p class="gen-readout-wait">Generating…</p>`;
  // `partial`: some stage was skipped (the hitbox fit runs only for the Hitboxes view), so the total is "so far".
  return `<p class="gen-readout-head"><span class="gen-readout-title">${esc(r.title)}</span><span class="gen-readout-ms">${esc(r.ms)}</span>` +
    (total !== undefined ? `<span class="gen-readout-total">of ${esc(msText(total))}${partial ? " so far" : ""}</span>` : "") + `</p>` +
    `<p class="gen-readout-hint">${esc(r.hint)}</p>` +
    (r.metrics.length ? `<dl class="gen-readout-metrics">${r.metrics.map((m) => `<div class="gen-metric" data-metric="${esc(m.key)}"><dt>${esc(m.label)}</dt><dd>${esc(m.value)}</dd></div>`).join("")}</dl>` : "") +
    (r.warnings.length ? `<ul class="gen-readout-warn">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "");
}

/** Arrow-key navigation inside the radio group: the next index (wraps), or null for other keys. */
export function nextStageIndex(i: number, key: string, n = GEN_STAGE_IDS.length): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (i + 1) % n;
  if (key === "ArrowLeft" || key === "ArrowUp") return (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}
