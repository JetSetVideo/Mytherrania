// StatView (Wave GEN, lane U): the generator's 0..1000 view of a fighter — strength, agility, intelligence
// and level as the body generator reads them (P's StatScale.generatorStats: the game's own sheet/level
// mapped onto 0..1000, the reference fighter = 500) — shown beside the viewer with a bar each.
//
// Decision (documented in docs/wave-gen/UI.md): the four rows are EDITABLE as a preview-only "what if".
// Moving one rebuilds the 3D preview with that stat (the morph updates live) but never writes the
// profile: the game derives these numbers from the class/race/attributes/level, so a saved hero always
// carries the generator stats its sheet implies. "Reset" returns to the fighter's own numbers, and any
// roll or edit of the fighter resets the what-if (the view always starts from the fighter shown).
//
// Wiring: the Menu writes the override to the preview canvas as `data-gen-stats` (JSON, "" = none);
// PreviewScene reads it and builds the preview body with those stats.
// Pure module (markup with no style attribute; bar widths are written through CSSOM by the Menu).

/** The generator's stat block (contracts.GeneratorStats, structurally). */
export interface GenStats { strength: number; agility: number; intelligence: number; level: number }
export const GEN_STAT_KEYS: readonly (keyof GenStats)[] = ["strength", "agility", "intelligence", "level"];
export const GEN_STAT_LABEL: Readonly<Record<keyof GenStats, string>> = { strength: "Strength", agility: "Agility", intelligence: "Intelligence", level: "Level" };
/** What each stat does to the body (the row's title). */
export const GEN_STAT_HINT: Readonly<Record<keyof GenStats, string>> = {
  strength: "Muscle volume, bone density, shoulder breadth",
  agility: "Joint range (the animation's limits)",
  intelligence: "Brow, hair length and density, silver",
  level: "Maturity: stature, mass, posture",
};
export const GEN_STAT_MIN = 0;
export const GEN_STAT_MAX = 1000;
/** The stepper's step and the drag's resolution. */
export const GEN_STAT_STEP = 10;

/** Clamp one generator stat to 0..1000, integer; non-finite -> `fallback`. */
export function clampGenStat(v: number, fallback = 500): number {
  const x = Number.isFinite(v) ? v : fallback;
  return Math.round(Math.max(GEN_STAT_MIN, Math.min(GEN_STAT_MAX, x)));
}

/** A full, clamped stat block (missing keys = `base`'s). */
export function clampGenStats(s: Partial<GenStats>, base: GenStats): GenStats {
  return {
    strength: clampGenStat(s.strength ?? base.strength, base.strength),
    agility: clampGenStat(s.agility ?? base.agility, base.agility),
    intelligence: clampGenStat(s.intelligence ?? base.intelligence, base.intelligence),
    level: clampGenStat(s.level ?? base.level, base.level),
  };
}

/** True when two blocks are equal stat by stat. */
export function sameStats(a: GenStats, b: GenStats): boolean {
  return GEN_STAT_KEYS.every((k) => a[k] === b[k]);
}

/** The canvas attribute for a what-if: "" when it equals the fighter's own block (no override). */
export function whatIfAttr(base: GenStats, current: GenStats): string {
  return sameStats(base, current) ? "" : JSON.stringify(clampGenStats(current, base));
}

/** Parse the canvas attribute back (null = no override / malformed). */
export function parseWhatIf(attr: string | undefined | null): GenStats | null {
  if (!attr) return null;
  try {
    const o = JSON.parse(attr) as Partial<GenStats>;
    if (!o || typeof o !== "object") return null;
    if (!GEN_STAT_KEYS.every((k) => typeof o[k] === "number" && Number.isFinite(o[k]))) return null;
    return clampGenStats(o, o as GenStats);
  } catch {
    return null;
  }
}

/** The bar's fill fraction 0..1. */
export function statFraction(v: number): number {
  return clampGenStat(v, 0) / GEN_STAT_MAX;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The view: a heading with Reset, then one row per stat (a native number input upgraded to a stepper, and a bar). */
export function statViewHtml(stats: GenStats): string {
  return `<div class="gen-stats" id="gen-stats" role="group" aria-labelledby="gen-stats-title">` +
    `<h4 class="group-head gen-stats-head" id="gen-stats-title">Generator stats <span class="gen-stats-scale">0–1000</span></h4>` +
    `<div class="gen-stats-note"><p>What the body is built from. Change one to preview it — the fighter keeps its own.</p>` +
    `<button type="button" class="menu-btn menu-btn-sm menu-btn-alt gen-stats-reset" data-gen-stats-reset hidden>Reset</button></div>` +
    `<div class="gen-stats-rows">` +
    GEN_STAT_KEYS.map((k) =>
      `<div class="gen-stat" data-gen-stat-row="${k}" title="${esc(GEN_STAT_HINT[k])}">` +
      `<label class="field">${GEN_STAT_LABEL[k]} <input id="gen-stat-${k}" data-gen-stat="${k}" type="number" min="${GEN_STAT_MIN}" max="${GEN_STAT_MAX}" step="${GEN_STAT_STEP}" value="${clampGenStat(stats[k])}"></label>` +
      `<span class="gen-stat-bar" aria-hidden="true"><span class="gen-stat-ref"></span><span class="gen-stat-fill" data-gen-fill="${k}"></span></span>` +
      `</div>`).join("") +
    `</div></div>`;
}
