import { CLASSES, type ClassName } from "../game/Stats.ts";
import { NPCS, PALETTES, PRESETS, type CharacterProfile } from "../game/Characters.ts";
import { RACES, raceById, computeRaceStats, type RaceDef } from "../game/Races.ts";
import { BIRTHSIGNS } from "../game/Birthsight.ts";
import { secondaryPreview } from "../game/SecondaryStats.ts";
import { ALL_SKILLS, skillsForClass, type Skill } from "../game/Skills.ts";
import type { HistorySummary, MatchRecord, Rate, WinReason } from "../game/MatchHistory.ts";
import { ancestryOf, rankOf, METRICS, type AncestryNode } from "../game/Ancestry.ts";
import type { SpectateCard } from "../game/SpectateGen.ts";
import { objectSize, RING_SHAPES, type ArenaConfig, type ObjectKind } from "../game/ArenaConfig.ts";
import { surfaceFor } from "../game/Terrain.ts";
import { weaponForClass } from "../game/Weapon.ts";
import { COLOUR_HEX, screenPanels, UI_TREE, type ScreenId, type UiGroup, type UiPanel } from "./UiTree.ts";
import { HISTORY_SORTS, HISTORY_SORT_LABEL, highlightSummary, rowBadges, sortHistory, type HistoryRowLike, type HistorySort } from "./HistoryView.ts";
import { NavStack } from "./NavStack.ts";
import { birthsignIcon, icon } from "./Icons.ts";
import { ancestryView, initialAncestry, nextHeaderIndex, selectSubrace, toggleRace, type AncestryState } from "./AncestryState.ts";
import type { ProfilePanelView } from "./ProfilePanel.ts";
import { weaponMenuOptions } from "../game/weapons/Loadout.ts";
import { raceBanner } from "./RaceBanners.ts";
import { creatorSheet, rollProfile, type CreatorSheet, type SheetRow } from "./CreatorRoll.ts";
import { DISCLOSURE_STORAGE_KEY, decodeDisclosure, encodeDisclosure, groupKey, initialDisclosure, isOpen, openGroup, type DisclosureState } from "./Disclosure.ts";

/** Largest arena (m across) the live engine builds; the creator's size slider tops out here. */
export const LIVE_ARENA_MAX = 120;

/** The arena-size slider's step, metres. */
export const ARENA_SIZE_STEP = 2;

/**
 * Base parameters of the minimum arena (W04), each read from where the game defines it:
 * - spawnOffset: fighters start this far from the centre (Engine.#startFight `spawn` = 2.5 m).
 * - longestDash: the longest skill lunge in the roster (Skills `animation.lunge`, metres).
 * - throwSpeed: the knockback speed at which a body is thrown into a ragdoll (Engine.#tickWorld,
 *   7 m/s) — the hardest shove that still slides instead of tumbling.
 * - slideTime: the time constant of that slide on stone, the reference ground (Terrain
 *   `stone.stop`, s): Engine decays knockback as v *= exp(-dt / stop), so it travels v x stop.
 * - largestProp: the widest arena prop's diameter (ArenaConfig object sizes, 2 x radius).
 * - bodyRadius: a fighter's collision radius (Engine PLAYER_RADIUS = 0.5 m).
 */
export interface ArenaMinimumTerms {
  spawnOffset: number; longestDash: number; throwSpeed: number; slideTime: number;
  largestProp: number; bodyRadius: number;
  /** One fighter's half of the field: s + d + v x tau + (prop + 2r) + r, metres. */
  half: number;
  /** The minimum size across: ceil(2 x half / step) x step, metres. */
  size: number;
}

/** Every arena prop kind (a Record so the compiler flags a kind added to ArenaConfig). */
const PROP_KINDS: Readonly<Record<ObjectKind, true>> = {
  pillar: true, ramp: true, platform: true, crate: true, rock: true, arch: true, tree: true, gliderPad: true,
};

/**
 * Derive the smallest live arena from gameplay. Along a line from the centre to the wall,
 * one fighter's half of the field must hold, end to end:
 *   half = spawnOffset                 (where it starts)
 *        + longestDash                 (a full dash away from the rival)
 *        + throwSpeed x slideTime      (then the hardest non-ragdoll knockback slide)
 *        + largestProp + 2 x bodyRadius (room to walk AROUND the widest prop on that line)
 *        + bodyRadius                  (clearance to the wall)
 *   size = ceil(2 x half / ARENA_SIZE_STEP) x ARENA_SIZE_STEP
 * With today's data: 2.5 + 3.4 + 7 x 0.7 + (3.8 + 1.0) + 0.5 = 16.1 m -> 32.2 -> 34 m.
 */
export function liveArenaMinimum(): ArenaMinimumTerms {
  const spawnOffset = 2.5, throwSpeed = 7, bodyRadius = 0.5;
  const longestDash = Math.max(...ALL_SKILLS.map((s) => s.animation.lunge));
  const slideTime = surfaceFor("stone").stop;
  const largestProp = Math.max(...(Object.keys(PROP_KINDS) as ObjectKind[]).map((k) => 2 * objectSize(k).r));
  const half = spawnOffset + longestDash + throwSpeed * slideTime + largestProp + 2 * bodyRadius + bodyRadius;
  // Round the product first: 2 x 16.1 is 32.2000…01 in floating point.
  const size = Math.ceil(Math.round(2 * half * 1e6) / 1e6 / ARENA_SIZE_STEP) * ARENA_SIZE_STEP;
  return { spawnOffset, longestDash, throwSpeed, slideTime, largestProp, bodyRadius, half, size };
}

/**
 * Smallest arena (m across) the live engine builds — 34 m today, derived in
 * {@link liveArenaMinimum} (it was 8 m). The size slider starts here, and a random arena
 * is clamped up to it by the engine ({@link clampLiveArenaSize}).
 */
export const LIVE_ARENA_MIN = liveArenaMinimum().size;

/** Clamp an arena size (m across) into the live range [LIVE_ARENA_MIN, LIVE_ARENA_MAX]. */
export function clampLiveArenaSize(size: number): number {
  return Math.min(LIVE_ARENA_MAX, Math.max(LIVE_ARENA_MIN, Number.isFinite(size) ? size : LIVE_ARENA_MIN));
}

/**
 * The slider's lowest notch (one step below LIVE_ARENA_MIN) means "random"; any value
 * below LIVE_ARENA_MIN (including 0) is random (null); the rest clamp into the live range.
 */
export function arenaSizeFromSlider(value: number): number | null {
  return Number.isFinite(value) && value >= LIVE_ARENA_MIN ? clampLiveArenaSize(value) : null;
}

/** The slider's "random" notch: one step below the minimum size. */
export const ARENA_SLIDER_RANDOM = LIVE_ARENA_MIN - ARENA_SIZE_STEP;

export type Screen = "title" | "select" | "victory" | "digest" | "sheet" | "profiles";

/** Short name of each screen, used by the breadcrumb next to the Back button. */
export const SCREEN_LABEL: Readonly<Record<Screen, string>> = {
  title: "Menu",
  select: "Create your fighter",
  victory: "Result",
  sheet: "Character sheet",
  digest: "Match history",
  profiles: "Profiles",
};

export interface MenuCallbacks {
  onStart(player: CharacterProfile, opponent: CharacterProfile): void;
  onRematch(): void;
  onMenu(): void;
  onDigest?(): void;
  onSheet?(): void;
  onSpectate?(player: CharacterProfile, opponent: CharacterProfile): void;
  /** A profile was selected; the engine loads its character state + keybindings. */
  onProfile?(playerId: string): void;
  /** The title's Settings button: open the settings panel over the menu. */
  onSettings?(): void;
  /** Wave M: run a headless batch of `size` matches (the reading page's one-click button). */
  onBatch?(size: number): void;
  /**
   * Wave O: one hook for the Profiles panel — `action` is one of open, select, new-random, new-specific,
   * save-creator, load, duplicate, rename, delete, and `playerId` is the row it acted on (null when the
   * action is not about a row).
   */
  onProfileAction?(action: string, playerId: string | null): void;
  /**
   * A complete fighter was rolled by the Creator's dice (L-B's `rollProfile`); the engine draws
   * its 3D model into `#creator-preview`. Fired AFTER the whole Creator step has been refreshed,
   * so a listener reading the DOM sees the rolled race/class/sign/sheet already in place.
   */
  onRoll?(profile: CharacterProfile): void;
}

export interface SheetData {
  name: string;
  race: string;
  subrace: string | null;
  birthsign: string | null;
  className: string;
  stats: Record<string, number>;
  weapon: string;
  hp: number;
  portrait?: string;
  duels?: { date: string; opponent: string; result: string; duration: number; dealt: number; received: number; weapon?: string; arena?: string; condition?: string }[];
}

export interface HistoryView { list: MatchRecord[]; summary: HistorySummary }

/** One row of the AI leaderboard (from Engine.leaderboardView). */
export interface LeaderRow {
  rank: number; king: boolean; id: string; name: string;
  archetype: string; style: string;
  mmr: number; wins: number; losses: number; peak: number;
}

const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/**
 * A saved NUMBER for HTML: saves are user-editable (localStorage), so a "number" field may
 * hold markup. Finite numbers print as-is; anything else prints as an escaped string.
 */
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : esc(v ?? "—"));
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/**
 * A History row (H-G): the structural shape HistoryView sorts and badges, plus the source
 * record (for the cells) and a display label (for the summary strip). Extra fields are fine —
 * HistoryRowLike is structural.
 */
interface HistoryUiRow extends HistoryRowLike {
  label: string;
  record: MatchRecord;
}

/**
 * Map a MatchHistory end reason onto the UI's reason union. Only "time-limit" drives a badge
 * (TIMEOUT); the rest collapse to the four legacy reasons so an old record still reads.
 */
const HISTORY_END: Readonly<Record<WinReason, HistoryRowLike["endReason"]>> = {
  ko: "ko",
  "ring-out": "ko",
  ringout: "ko",
  timed: "time-limit",
  koth: "domination",
  forfeit: "sudden-death",
  "time-limit": "time-limit",
};

/** Adapt a match record to the History UI row (telemetry fields are all optional — H-D back-compat). */
function historyRow(r: MatchRecord): HistoryUiRow {
  const [a, b] = r.fighters;
  return {
    record: r,
    label: `${a.name} v ${b.name}`,
    durationS: r.duration,
    endReason: HISTORY_END[r.reason],
    statGap: { distance: r.statGap?.distance, dominance: r.margin ?? r.statGap?.dominance },
    generation: r.generation ? { id: r.generation.id } : undefined,
    tie: r.tie,
  };
}

/** The CSS class a badge string maps to (TIE / TIMEOUT / generation / gap / margin). */
const badgeKind = (b: string): string =>
  b === "TIE" ? "TIE" : b === "TIMEOUT" ? "TIMEOUT" : b.startsWith("GEN-") ? "generation" : b.startsWith("GAP") ? "gap" : "margin";

/** A row's badges (H-G). An empty list for a legacy row, so it renders exactly as before. */
const badgeHtml = (row: HistoryRowLike): string =>
  rowBadges(row).map((b) => `<span class="history-badge" data-key="history-badge" data-badge="${badgeKind(b)}">${esc(b)}</span>`).join("");

/* ── Pure render helpers (L-D) ────────────────────────────────────────────────────────────
   The markup below is built by these functions so it can be unit-tested without a DOM. The page
   runs under `style-src 'self'`, which BLOCKS any `style="…"` attribute (a previous wave's History
   bars rendered empty because of it), so every one of these strings carries classes and SVG
   presentation attributes only — never an inline style. */

/**
 * mulberry32 — a 32-bit seeded PRNG (pure). The dice needs randomness tests can replay: the same
 * seed must yield the same fighter, which is exactly why the roll never touches `Math.random`.
 * Each call returns a value in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pluralised option count for an opt-group header: "1 option" / "N options". */
export function optionCount(n: number): string {
  return `${n} ${n === 1 ? "option" : "options"}`;
}

/** The inputs to {@link optGroupHtml}: one tree group's identity, colour, size and open state. */
export interface OptGroupSpec {
  screen: string;
  panel: string;
  id: string;
  label: string;
  hint: string;
  colour: string;
  /** How many controls the group owns (the header's "N options"). */
  count: number;
  /** Open on this visit (from Disclosure); the native `<details>` default is CLOSED. */
  open: boolean;
  /** Optional leading glyph (an icon or a race banner `<svg>`), inside `.opt-glyph`. */
  glyph?: string;
  /** The group's controls, already rendered. */
  body: string;
}

/**
 * One option group as a native `<details>` closed tree (L-C's renderer contract). Native
 * `<details>` is used deliberately: keyboard and screen-reader behaviour come for free, and
 * "closed" is the element's OWN default, so the visual default and the accessibility default
 * cannot drift apart.
 */
export function optGroupHtml(g: OptGroupSpec): string {
  const key = groupKey(g.screen, g.panel, g.id);
  const open = g.open ? " open" : "";
  return `<details class="opt-group" data-group="${esc(key)}" data-colour="${esc(g.colour)}"${open}>` +
    `<summary class="opt-head">` +
    `<span class="opt-glyph" aria-hidden="true">${g.glyph ?? ""}</span>` +
    `<span class="opt-label">${esc(g.label)}</span>` +
    `<span class="opt-count">${esc(optionCount(g.count))}</span>` +
    `<span class="opt-hint">${esc(g.hint)}</span>` +
    `<span class="opt-chevron" aria-hidden="true">${icon("chevron-down", "opt-chevron-svg")}</span>` +
    `</summary><div class="opt-body">${g.body}</div></details>`;
}

/** The purple, rocky dice button. Icon + label, classes only — no inline style attribute. */
export function diceButtonHtml(): string {
  return `<button type="button" class="dice-btn dice-btn-rocky" data-action="dice"` +
    ` title="Roll a complete random fighter and refresh the Creator step">` +
    `${icon("dice", "dice-glyph")}<span class="dice-label">Roll</span></button>`;
}

/** One sheet row: label, value, and the WHY hint when the source carries one. */
function sheetRowHtml(r: SheetRow): string {
  return `<div class="sheet-row"><span class="sheet-row-label">${esc(r.label)}</span>` +
    `<b class="sheet-row-value">${esc(r.value)}</b>` +
    (r.hint ? `<span class="sheet-row-hint">${esc(r.hint)}</span>` : "") + `</div>`;
}

/** One sheet column: a heading and its rows. */
function sheetColHtml(title: string, rows: SheetRow[]): string {
  return `<div class="sheet-col"><h4 class="sheet-col-head">${esc(title)}</h4>${rows.map(sheetRowHtml).join("")}</div>`;
}

/**
 * The rolled fighter's stat sheet as HTML (L-B's {@link CreatorSheet}): the identity line and three
 * columns — the six attributes, the derived combat numbers, and the modifiers. Every label and
 * value comes from `creatorSheet`, which reads the real game maths.
 */
export function creatorSheetHtml(sheet: CreatorSheet): string {
  const sub = sheet.subraceLabel && sheet.subraceLabel !== "—" ? ` · ${esc(sheet.subraceLabel)}` : "";
  return `<div class="sheet-ident">` +
    `<b class="sheet-name">${esc(sheet.name)}</b>` +
    `<span class="sheet-meta">${esc(sheet.raceLabel)}${sub} · ${esc(sheet.className)}</span>` +
    `<span class="sheet-meta">${esc(sheet.weaponLabel)} · sign ${esc(sheet.signLabel)}</span>` +
    `</div>` +
    `<div class="sheet-cols">` +
    sheetColHtml("Attributes", sheet.primary) +
    sheetColHtml("Derived", sheet.derived) +
    sheetColHtml("Modifiers", sheet.secondary) +
    `</div>`;
}

export class Menu {
  #root: HTMLDivElement;
  #player: CharacterProfile = PRESETS[0];
  #opponent: CharacterProfile = { name: "Ser Vail", race: "human", subrace: "imperial", className: "Warrior", palette: "Ember", birthsign: "mountain", level: 1, allocated: {}, appearance: NPCS[1].appearance };
  #visible = false;
  /**
   * Navigation history: every screen change goes through it, so Back (button or Esc) returns
   * to the PREVIOUS screen. The title is the root: showing it resets the trail.
   */
  #nav = new NavStack<Screen>("title");
  #cb!: MenuCallbacks;
  /** Arena parameters chosen in the creator; empty = fully random. */
  #arena: Partial<ArenaConfig> = {};
  /** Ancestry accordion: which race box is open and which race + sub-species are chosen (W01). */
  #ancestry: AncestryState = initialAncestry(RACES, PRESETS[0].race, PRESETS[0].subrace);
  /** The generated spectator card the engine last handed over (H-E); null until one arrives. */
  #spectateCard: SpectateCard | null = null;
  /** The technique ids the spectator card's spent stats unlocked (H-E), shown beside the card. */
  #spectateTechniques: string[] = [];
  /** The History page's current order (H-G); the sort control changes it live. */
  #historySort: HistorySort = "newest";
  /** The last History view + leaderboard, kept so a sort change re-renders without fresh data. */
  #history: { view: HistoryView; leaderboard: LeaderRow[] } | null = null;
  /** Which option groups are open (L-C's `Disclosure`); every group is CLOSED unless remembered. */
  #disclosure: DisclosureState = initialDisclosure(UI_TREE);
  /** Mixed into the seed so two dice clicks within one millisecond never roll the same fighter. */
  #rollCount = 0;

  /** Show the engine's generated spectator card (H-E), or clear it with null. */
  setSpectateCard(card: SpectateCard | null, techniques: string[] = []): void {
    this.#spectateCard = card;
    this.#spectateTechniques = techniques;
    this.#renderSpectateCard();
  }

  /**
   * Wave M: the batch controls' state. The MODEL behind them is lane M-C's `BatchPanel`
   * (`batchPlan`/`batchProgress`/`batchSummary`); this class only paints it — through CSSOM and
   * classes, never an inline style attribute (the page's CSP blocks those).
   */
  #batchSize = 10;
  #batchRunning = false;
  /** The size the picker currently selects. */
  get batchSize(): number { return this.#batchSize; }
  setBatchRunning(running: boolean): void { this.#batchRunning = running; }
  /** Paint the progress bar: a fraction 0..1, a count and an ETA in seconds. */
  setBatchProgress(p: { fraction: number; done: number; total: number; etaS: number }): void {
    const wrap = this.#root.querySelector<HTMLElement>("#batch-progress");
    const fill = this.#root.querySelector<HTMLElement>("#batch-fill");
    const status = this.#root.querySelector<HTMLElement>("#batch-status");
    if (!wrap || !fill || !status) return;
    wrap.hidden = false;
    const f = Number.isFinite(p.fraction) ? Math.max(0, Math.min(1, p.fraction)) : 0;
    fill.style.width = `${(f * 100).toFixed(1)}%`;
    status.textContent = `${p.done} / ${p.total}${p.etaS > 0.05 ? ` · ~${p.etaS.toFixed(1)} s left` : ""}`;
  }
  /** Paint the finished batch's summary: one row per variable, min / p10 / median / mean / p90 / max. */
  setBatchSummary(s: { matches: number; variables: Record<string, { min: number; max: number; mean: number; median: number; p10: number; p90: number }>; reasons: Record<string, number> } | null): void {
    const el = this.#root.querySelector<HTMLElement>("#batch-summary");
    if (!el) return;
    if (!s) { el.innerHTML = ""; return; }
    const rows = Object.entries(s.variables).map(([k, v]) =>
      `<tr class="sheet-row" data-row="${esc(k)}"><td class="sheet-row-label">${esc(k)}</td>` +
      `<td class="sheet-row-value">${v.min.toFixed(1)}</td><td class="sheet-row-value">${v.p10.toFixed(1)}</td>` +
      `<td class="sheet-row-value">${v.median.toFixed(1)}</td><td class="sheet-row-value">${v.mean.toFixed(1)}</td>` +
      `<td class="sheet-row-value">${v.p90.toFixed(1)}</td><td class="sheet-row-value">${v.max.toFixed(1)}</td></tr>`).join("");
    const ends = Object.entries(s.reasons).map(([k, n]) => `${esc(k)} ${n}`).join(" · ");
    el.innerHTML = `<p class="batch-note">${s.matches} matches · endings: ${ends}</p>` +
      `<table class="pick-table batch-table"><thead><tr><th>variable</th><th>min</th><th>p10</th><th>median</th><th>mean</th><th>p90</th><th>max</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /**
   * Wave O: the Profiles panel. `view` is lane O-C's pure model and `portraits` maps a profile id to a
   * PNG data URL the engine rendered (img-src allows `data:`, so an <img> is the right element). Every
   * interactive piece reports back through `onProfileAction(action, playerId)`.
   */
  showProfiles(view: ProfilePanelView, portraits: Record<string, string>): void {
    const body = this.#root.querySelector<HTMLElement>("#profiles-body");
    if (!body) return;
    this.#profilesView = view;
    const rows = view.rows.map((r) => {
      const portrait = portraits[r.playerId];
      const manage = (r.selected ? view.selected?.actions ?? [] : [])
        .map((a) => `<button class="${this.#profileActionClass(a.id)}" data-profile-action="${esc(a.id)}" data-profile-id="${esc(r.playerId)}"${a.disabled ? " disabled" : ""} title="${esc(a.hint)}">${esc(a.label)}</button>`)
        .join("");
      return `<li class="profile-row${r.active ? " is-active" : ""}${r.selected ? " is-selected" : ""}" data-profile-id="${esc(r.playerId)}">` +
        (portrait ? `<img class="profile-portrait" src="${esc(portrait)}" alt="" width="56" height="56">` : `<span class="profile-portrait profile-portrait-empty" aria-hidden="true"></span>`) +
        `<span class="profile-banner" aria-hidden="true">${r.banner}</span>` +
        `<span class="profile-ident"><strong class="profile-name">${esc(r.name)}</strong>` +
        `<small class="profile-level">${esc(r.raceLabel)}${r.subraceLabel ? ` · ${esc(r.subraceLabel)}` : ""} · ${esc(r.className)} · lv ${r.level}</small>` +
        `<small class="profile-record">${esc(r.record)}${r.active ? " · active" : ""}</small></span>` +
        `<span class="profile-manage">${manage}</span></li>`;
    }).join("");
    const toolbar = view.actions.map((a) =>
      `<button class="${this.#profileActionClass(a.id)}" data-profile-action="${esc(a.id)}">${esc(a.label)}</button>`).join("");
    const sheet = view.selected ? this.#profileSheetHtml(view.selected.sheet) : "";
    const empty = view.empty.show ? `<p class="profiles-empty">${esc(view.empty.text)}</p>` : "";
    body.innerHTML =
      `<header class="profiles-head"><h2 class="profiles-title">${esc(view.title)}</h2>` +
      `<span class="profiles-count">${view.count} saved</span><p class="profiles-hint">${esc(view.hint)}</p></header>` +
      `<div class="profiles-actions">${toolbar}</div>${empty}` +
      `<ul class="profiles-list">${rows}</ul>` +
      (sheet ? `<div class="profile-sheet">${sheet}</div>` : "");
    this.#wireProfilePanel();
  }

  /** The selected profile's statistics, in the same three columns the Creator shows. */
  #profileSheetHtml(sheet: CreatorSheet): string {
    const col = (label: string, rows: SheetRow[]) =>
      `<div class="sheet-col"><h4 class="sheet-col-head">${esc(label)}</h4>` +
      rows.map((r) => `<div class="sheet-row"><span class="sheet-row-label">${esc(r.label)}</span>` +
        `<span class="sheet-row-value">${esc(r.value)}</span></div>`).join("") + `</div>`;
    return `<div class="sheet-ident"><strong class="sheet-name">${esc(sheet.name)}</strong>` +
      `<small class="sheet-meta">${esc(sheet.raceLabel)}${sheet.subraceLabel ? ` · ${esc(sheet.subraceLabel)}` : ""} · ${esc(sheet.className)} · ${esc(sheet.weaponLabel)} · ${esc(sheet.signLabel)}</small></div>` +
      `<div class="sheet-cols">${col("Attributes", sheet.primary)}${col("Derived", sheet.derived)}${col("Modifiers", sheet.secondary)}</div>`;
  }

  /** The lane's documented class vocabulary: random / specific / manage. */
  #profileActionClass(id: string): string {
    if (id === "new-random") return "profile-action profile-action-random";
    if (id === "new-specific") return "profile-action profile-action-specific";
    return "profile-action profile-action-manage";
  }

  #wireProfilePanel(): void {
    const body = this.#root.querySelector<HTMLElement>("#profiles-body");
    if (!body) return;
    body.querySelectorAll<HTMLElement>("[data-profile-action]").forEach((el) => el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#cb.onProfileAction?.(el.dataset.profileAction ?? "", el.dataset.profileId ?? null);
    }));
    body.querySelectorAll<HTMLElement>(".profile-row").forEach((row) => row.addEventListener("click", () => {
      this.#cb.onProfileAction?.("select", row.dataset.profileId ?? null);
    }));
  }
  #profilesView: ProfilePanelView | null = null;
  /** QA: the view the panel last painted (the engine's probe reads the panel through this). */
  get profilesView(): ProfilePanelView | null { return this.#profilesView; }
  /** The Creator's fighter as a CharacterProfile, for the panel's "save what I built" path. */
  get playerProfile(): CharacterProfile { return this.#player; }

  /** The arena the player asked for (applied to the next match only). */
  arenaChoice(): Partial<ArenaConfig> {
    return { ...this.#arena };
  }

  constructor(callbacks: MenuCallbacks) {
    this.#root = document.createElement("div");
    this.#root.id = "menu";
    document.body.appendChild(this.#root);
    // The remembered open/closed state of every option group (L-C), read once; a corrupt or
    // absent payload decodes to the initial state and never throws.
    this.#disclosure = decodeDisclosure(this.#readStoredDisclosure(), UI_TREE);
    this.#render(callbacks);
  }

  /** The stored disclosure payload, or null when storage is unavailable (private mode, CSP). */
  #readStoredDisclosure(): string | null {
    try {
      return globalThis.localStorage?.getItem(DISCLOSURE_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  /** Persist the open/closed state; a blocked storage write is not an error worth surfacing. */
  #persistDisclosure(): void {
    try {
      globalThis.localStorage?.setItem(DISCLOSURE_STORAGE_KEY, encodeDisclosure(this.#disclosure));
    } catch { /* storage disabled: the trees still work, they just will not be remembered */ }
  }

  get visible(): boolean { return this.#visible; }

  /** The screen on display (top of the navigation history). */
  get screen(): Screen { return this.#nav.current; }

  /** True when Back would leave the current screen (it is not the title). */
  get canGoBack(): boolean { return this.#visible && this.#nav.canGoBack; }

  /**
   * Go back one step: close an open AI profile card first, else return to the previous screen.
   * Returning to the title runs the same path as the "Menu" button (`onMenu`), so the engine
   * leaves a finished fight. Returns false when there is nothing to go back to (the menu is
   * hidden, or the title is showing) so the caller can fall through to its own Esc handling.
   */
  back(): boolean {
    if (!this.#visible) return false;
    const modal = this.#root.querySelector<HTMLElement>("#ai-profile.open");
    if (modal) { modal.classList.remove("open"); return true; }
    if (!this.#nav.canGoBack) return false;
    const target = this.#nav.back();
    if (target === this.#nav.root) this.#toTitle();
    else this.#activate(target);
    return true;
  }

  /** Leave for the title through the engine (`onMenu`), as the "Menu" button does. */
  #toTitle(): void {
    this.#visible = false;
    this.#root.style.display = "none";
    this.#cb.onMenu();
    // The engine normally re-shows the title from onMenu; never leave the player on a blank menu.
    if (!this.#visible) this.show("title");
  }

  /** The Back control + breadcrumb that heads every non-title screen. */
  #backBar(): string {
    return `
        <div class="screen-nav">
          <button type="button" class="screen-back" data-action="back" title="Back to the previous screen (Esc)">${icon("chevron-left", "back-icon")}<span>Back</span></button>
          <span class="screen-crumb" data-crumb></span>
        </div>`;
  }

  /** Render the profile picker on the title screen: one chip per saved profile. */
  renderProfiles(profiles: { playerId: string; name: string; className: string; active: boolean }[], onProfile: (playerId: string) => void): void {
    const el = this.#root.querySelector("#profile-picker");
    if (!el) return;
    if (!profiles.length) { el.innerHTML = ""; return; }
    el.innerHTML = `<span class="profile-label">Profile</span>` + profiles.map((p) =>
      `<button class="profile-chip ${p.active ? "selected" : ""}" data-profile="${esc(p.playerId)}" title="${esc(p.playerId)}">${esc(p.name)}<small>${esc(p.className)}</small></button>`
    ).join("");
    el.querySelectorAll(".profile-chip").forEach(chip => chip.addEventListener("click", () => {
      const id = (chip as HTMLElement).dataset.profile!;
      el.querySelectorAll(".profile-chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      onProfile(id);
    }));
  }

  /** The title screen's one panel: its groups are closed trees (modes open, the entry paths). */
  #titlePanelHtml(): string {
    const panel = screenPanels("title")[0];
    if (!panel) return "";
    return `<section class="ui-panel ui-panel-title" data-panel="${esc(panel.id)}" data-colour="${esc(panel.colour)}">` +
      panel.groups.map((g) => this.#optGroup("title", panel.id, panel.colour, g)).join("") +
      `</section>`;
  }

  /** One select-screen panel: a headed section whose groups are closed trees, in tree order. */
  #panelHtml(panel: UiPanel): string {
    return `<section class="ui-panel" data-panel="${esc(panel.id)}" data-colour="${esc(panel.colour)}">` +
      `<h3 class="panel-head"><span class="dot"></span>${esc(panel.label)}<span class="panel-hint">${esc(panel.hint)}</span></h3>` +
      panel.groups.map((g) => this.#optGroup("select", panel.id, panel.colour, g)).join("") +
      `</section>`;
  }

  /** One tree group as an opt-group `<details>`: glyph, count, hint and the group's controls. */
  #optGroup(screen: ScreenId, panelId: string, colour: string, g: UiGroup): string {
    return optGroupHtml({
      screen,
      panel: panelId,
      id: g.id,
      label: g.label,
      hint: g.hint,
      colour,
      count: g.controls.length,
      open: isOpen(this.#disclosure, groupKey(screen, panelId, g.id)),
      glyph: this.#groupGlyph(panelId, g.id),
      body: this.#groupBody(panelId, g.id),
    });
  }

  /**
   * The preview panel: the shape the parent draws the rolled fighter's MODEL into
   * (`#creator-preview`, written by the engine — this panel never draws into it) and the stat
   * sheet (`#creator-sheet`, from L-B's `creatorSheet`). Pinned (`data-pinned`): it is not a
   * tab, so it stays visible under whichever Creator panel is open.
   */
  #previewPanelHtml(): string {
    return `<section class="ui-panel ui-panel-preview" data-panel="preview" data-colour="violet" data-pinned>` +
      `<h3 class="panel-head"><span class="dot"></span>Preview<span class="panel-hint">The rolled fighter: the model above the sheet below.</span></h3>` +
      `<div class="preview-grid">` +
      `<div class="preview-stage">` +
      `<canvas id="creator-preview" width="360" height="440" class="preview-canvas" role="img" aria-label="3D preview of the rolled fighter"></canvas>` +
      `<p class="preview-hint">The model is the fighter the dice rolled — the engine draws it here.</p></div>` +
      `<div class="preview-stats">` +
      diceButtonHtml() +
      `<div class="creator-row">${PRESETS.map((p, i) => `<button class="menu-btn menu-btn-sm" data-preset="${i}">${p.name}</button>`).join("")}</div>` +
      `<h4 class="group-head">Palette</h4>` +
      `<div class="palettes">${Object.entries(PALETTES).map(([name]) =>
        `<button class="palette-chip palette-${name}" data-palette="${name}" title="${name}" aria-pressed="false"></button>`).join("")}</div>` +
      `<div id="creator-sheet" class="creator-sheet"></div>` +
      `</div></div></section>`;
  }

  /** An opt-group's leading glyph: an étendard where the ancestry appears, an icon elsewhere. */
  #groupGlyph(panelId: string, groupId: string): string {
    switch (`${panelId}/${groupId}`) {
      case "ancestry/race": return raceBanner(this.#player.race, null, "opt-banner");
      case "ancestry/subrace": return raceBanner(this.#player.race, this.#player.subrace, "opt-banner");
      case "ancestry/hero": return icon("defense", "opt-icon");
      case "ancestry/lore": return icon("flag", "opt-icon");
      case "calling/class": return icon("power", "opt-icon");
      case "calling/weapon": return icon("dash", "opt-icon");
      case "calling/skills": return icon("flame", "opt-icon");
      case "sign/birthsign": return birthsignIcon(this.#player.birthsign, "opt-icon");
      case "sign/secondary": return icon("storm", "opt-icon");
      case "opponent/rival": return icon("close", "opt-icon");
      case "opponent/terms": return icon("gear", "opt-icon");
      case "opponent/spectate": return icon("play", "opt-icon");
      case "opponent/inspect": return icon("play", "opt-icon");
      case "arena/field": return icon("mountain", "opt-icon");
      case "arena/walls": return icon("defense", "opt-icon");
      case "arena/pickups": return icon("flame", "opt-icon");
      case "start/profiles": return icon("flag", "opt-icon");
      case "start/modes": return icon("play", "opt-icon");
      default: return "";
    }
  }

  /** The controls of one opt-group. The panel id disambiguates the shared group ids. */
  #groupBody(panelId: string, groupId: string): string {
    switch (`${panelId}/${groupId}`) {
      case "start/profiles":
        return `<div id="profile-picker" class="profile-picker"></div>` +
          `<button class="menu-btn menu-btn-alt profiles-open" data-action="profiles">≡ Profiles<span class="btn-note">Models, statistics, roll or manage</span></button>`;
      case "start/modes":
        return `<div class="title-modes">` +
          `<button class="menu-btn" data-action="start">⚔ Fight</button>` +
          `<button class="menu-btn menu-btn-alt" data-action="digest">📋 History</button>` +
          `<button class="menu-btn menu-btn-alt" data-action="spectate">👁 Spectate</button>` +
          `<button class="menu-btn menu-btn-alt" data-action="settings" title="Keyboard layout, mouse, camera, display, sound">${icon("gear", "menu-btn-icon")}Settings</button>` +
          `</div>`;
      case "ancestry/race":
        return `<label class="field">Name <input id="creator-name" type="text" value="${esc(this.#player.name)}"></label>` +
          `<div class="ancestry-list" id="ancestry-list">${RACES.map((r) => this.#raceBoxHtml(r)).join("")}</div>`;
      case "ancestry/subrace":
        return `<p class="opt-note">Sub-species open inside each race box above — pick the nation within the people.</p>`;
      case "ancestry/hero":
        return `<div id="race-detail" class="race-detail"></div>`;
      case "ancestry/lore":
        return `<div id="ancestry-lore" class="ancestry-lore"></div>`;
      case "calling/class":
        return `<table class="pick-table" id="class-table"><tbody>${CLASSES.map(c => `
              <tr class="pick-row" data-class="${c}" data-selected="${c === this.#player.className}">
                <td class="pick-name">${c}</td>
                <td class="pick-hint">${weaponForClass(c).name}</td>
              </tr>`).join("")}</tbody></table>`;
      case "calling/weapon":
        return `<table class="pick-table" id="weapon-table"><tbody>${weaponMenuOptions().map(o => `
              <tr class="pick-row" data-weapon="${esc(o.value)}" data-selected="${(o.value || undefined) === this.#player.weaponType || (o.value === "" && !this.#player.weaponType)}">
                <td class="pick-name">${esc(o.label)}</td>
                <td class="pick-hint">${esc(o.hint)}</td>
              </tr>`).join("")}</tbody></table>`;
      case "calling/skills":
        return `<div id="class-skills" class="class-skills"></div>`;
      case "sign/birthsign":
        return `<table class="pick-table" id="birthsign-table"><tbody>${BIRTHSIGNS.map(b => `
              <tr class="pick-row" data-birthsign="${b.id}" data-selected="${b.id === this.#player.birthsign}">
                <td class="pick-name"><span class="sign-label">${birthsignIcon(b.id, "sign-icon")}<span>${esc(b.name)}</span></span></td>
                <td class="pick-hint">${b.lore}</td>
              </tr>`).join("")}</tbody></table>`;
      case "sign/secondary":
        return `<div id="hero-secondary-sign" class="secondary-rows">${this.#secondaryRows()}</div>`;
      case "opponent/rival":
        return `<label class="field">Opponent<select id="menu-opponent">` +
          `${NPCS.map(n => `<option value="npc:${n.name}">${n.name} (${n.className})</option>`).join("")}` +
          `${CLASSES.map(c => `<option value="class:${c}">${c}</option>`).join("")}</select></label>`;
      case "opponent/terms":
        return `<label class="field">Match length<select id="match-length">` +
          `<option value="1">Standard</option><option value="0.5">Short (half health)</option><option value="0.25">Blitz (quarter health)</option>` +
          `</select></label>`;
      case "opponent/spectate":
        return `<section class="spectate-card" id="spectate-card"></section>`;
      case "opponent/inspect":
        return `<p class="opt-note">The inspect overlay (cursor, fighter and object cards) appears over a spectator match.</p>`;
      case "arena/field":
        return `<div class="arena-pick">` +
          `<label>Ring shape<select id="arena-shape"><option value="">Random</option>` +
          `${RING_SHAPES.map((s, i) => `<option value="${i}">${s}</option>`).join("")}</select></label>` +
          `<label>Size <output id="arena-size-out">random</output>` +
          `<input id="arena-size" type="range" min="${ARENA_SLIDER_RANDOM}" max="${LIVE_ARENA_MAX}" step="${ARENA_SIZE_STEP}" value="${ARENA_SLIDER_RANDOM}" aria-describedby="arena-size-hint">` +
          `<small id="arena-size-hint" class="field-hint">Far left = random. Fixed sizes run ${LIVE_ARENA_MIN}–${LIVE_ARENA_MAX} m.</small></label></div>`;
      case "arena/walls":
        return `<div class="arena-pick">` +
          `<label>Wall<select id="arena-walls"><option value="">Random (90% walled)</option>` +
          `<option value="1">Always</option><option value="0">Never</option></select></label>` +
          `<label>Wall resistance <output id="arena-res-out">random</output>` +
          `<input id="arena-res" type="range" min="0" max="9000" step="100" value="0"></label></div>`;
      case "arena/pickups":
        return `<p class="opt-note">Pickups and power-ups are generated with the arena.</p>`;
      default:
        return "";
    }
  }

  #render(cb: MenuCallbacks) {
    this.#cb = cb;
    const root = this.#root;
    root.innerHTML = `
      <div class="menu-screen" data-screen="title">
        <h1 class="menu-title">MYTHERRANIA</h1>
        <p class="menu-sub">Cel-shaded arena combat</p>
        ${this.#titlePanelHtml()}
      </div>

      <div class="menu-screen" data-screen="select">${this.#backBar()}
        <header class="screen-head">
          <h2>Create your fighter</h2>
          <p class="screen-hint">Everything is one screen away: pick a panel, and the rest stays visible in the tabs.</p>
        </header>
        <nav class="panel-tabs" data-tabs="select"></nav>

        ${screenPanels("select").map((p) => this.#panelHtml(p)).join("")}

        ${this.#previewPanelHtml()}

        <div class="creator-row">
          <button class="menu-btn menu-btn-sm" data-action="save-profile" title="Save this fighter into your profile library">Save as profile</button>
        </div>
        <button class="menu-btn menu-btn-primary" data-action="begin">Enter the ring</button>
      </div>

      <div class="menu-screen" data-screen="victory">${this.#backBar()}
        <h2 id="victory-text">Victory!</h2>
        <p id="victory-detail" class="menu-sub"></p>
        <button class="menu-btn" data-action="rematch">Rematch</button>
        <button class="menu-btn menu-btn-alt" data-action="sheet">📋 Sheet</button>
        <button class="menu-btn menu-btn-alt" data-action="history">📜 History</button>
        <button class="menu-btn menu-btn-alt" data-action="menu">Menu</button>
      </div>

      <div class="menu-screen" data-screen="sheet">${this.#backBar()}
        <h2>Character Sheet</h2>
        <div id="sheet-body" class="sheet-body"></div>
        <button class="menu-btn menu-btn-alt" data-action="menu">Main menu</button>
      </div>

      <div class="menu-screen" data-screen="profiles">${this.#backBar()}
        <!-- Wave O: the Profiles panel. Every saved fighter as a row with a REAL portrait (rendered by
             the engine's PortraitStudio off the same rig the arena builds), its ancestry standard, its
             calling, level and record, and the selected one's full stat sheet beside it. -->
        <div id="profiles-body" class="profiles-panel"></div>
      </div>

      <div class="menu-screen" data-screen="digest">${this.#backBar()}
        <h2>Match History</h2>
        <!-- Wave M: the one-click batch. The button runs the headless SIMULATOR only — no graphics —
             in this page, chunked so the frame loop keeps running, and prints the min/max/median. -->
        <section class="batch-bar" id="batch-bar">
          <div class="batch-head">
            <span class="batch-title">Run a batch</span>
            <span class="batch-note">Simulator only — no rendering. One click, then the summary below.</span>
          </div>
          <div class="batch-sizes" id="batch-sizes">
            ${[10, 20, 50, 100].map((n, i) => `<button class="batch-btn${i === 0 ? " selected" : ""}" data-batch-size="${n}">${n}</button>`).join("")}
            <button class="dice-btn dice-btn-rocky batch-run" data-action="run-batch" title="Run the selected batch">${icon("dice", "dice-glyph")}<span class="dice-label">Run</span></button>
          </div>
          <div class="batch-progress" id="batch-progress" hidden>
            <div class="batch-track"><span class="batch-fill" id="batch-fill"></span></div>
            <span class="batch-status" id="batch-status">—</span>
          </div>
          <div class="batch-summary" id="batch-summary"></div>
        </section>
        <div id="digest-body" class="digest-body">No fights recorded yet.</div>
        <button class="menu-btn menu-btn-alt" data-action="menu">Main menu</button>
      </div>`;

    // Title buttons
    root.querySelector('[data-action="start"]')!.addEventListener("click", () => this.show("select"));
    root.querySelector('[data-action="digest"]')!.addEventListener("click", () => { cb.onDigest?.(); });
    root.querySelector('[data-action="spectate"]')!.addEventListener("click", () => { this.hide(); cb.onSpectate?.(this.#player, this.#opponent); });
    root.querySelector('[data-action="settings"]')!.addEventListener("click", () => { cb.onSettings?.(); });

    // Arena choices: an empty value or 0 means "let the generator decide".
    const arenaSel = (id: string) => root.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
    const readArena = () => {
      const a: Partial<ArenaConfig> = {};
      const shape = arenaSel("arena-shape").value;
      if (shape !== "") a.shape = Number(shape);
      const size = arenaSizeFromSlider(Number(arenaSel("arena-size").value));
      if (size !== null) a.size = size;
      const walls = arenaSel("arena-walls").value;
      if (walls !== "") a.walls = Number(walls);
      const res = Number(arenaSel("arena-res").value);
      if (res > 0) a.wallResistance = res;
      this.#arena = a;
      (root.querySelector("#arena-size-out") as HTMLOutputElement).value = size !== null ? `${size} m` : "random";
      (root.querySelector("#arena-res-out") as HTMLOutputElement).value = res > 0 ? `${res} N·s` : "random";
    };
    for (const id of ["arena-shape", "arena-size", "arena-walls", "arena-res"]) arenaSel(id).addEventListener("input", readArena);

    // Creator: name + class/weapon tables.
    const nameInput = root.querySelector("#creator-name") as HTMLInputElement;
    nameInput.addEventListener("input", () => { this.#player.name = nameInput.value || "Fighter"; });
    const pickRow = (tableId: string, attr: string, onPick: (value: string) => void) => {
      root.querySelectorAll(`#${tableId} .pick-row`).forEach(row => row.addEventListener("click", () => {
        const value = (row as HTMLElement).dataset[attr]!;
        onPick(value);
        root.querySelectorAll(`#${tableId} .pick-row`).forEach(r => r.setAttribute("data-selected", String(r === row)));
      }));
    };
    pickRow("class-table", "class", (value) => {
      this.#player = { ...this.#player, className: value as ClassName };
      this.#renderClassSkills(value as ClassName);
    });
    pickRow("weapon-table", "weapon", (value) => {
      this.#player = { ...this.#player, weaponType: value || undefined };
    });
    // Star sign: the birthsign stacks on the sub-species, so the secondary rows refresh.
    pickRow("birthsign-table", "birthsign", (value) => {
      this.#player = { ...this.#player, birthsign: value };
      this.#refreshSecondary();
    });

    // Palette chips
    root.querySelectorAll(".palette-chip").forEach(chip => chip.addEventListener("click", () => {
      const palette = (chip as HTMLElement).dataset.palette!;
      this.#player = { ...this.#player, palette, appearance: { ...this.#player.appearance, ...PALETTES[palette] } };
      root.querySelectorAll(".palette-chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
    }));

    // Ancestry accordion (W01): a race header opens its box in place (the others close) and
    // selects the race; a sub-species chip inside the box selects both. Arrow keys / Home /
    // End move between the race headers; Enter / Space toggle (native button behaviour).
    //
    // Wave L: the race CARDS became heraldic boxes (a banner, a name, a trait, a chevron) wrapped
    // around the toggle button, so a click can land on the box itself (its padding, its heading, its
    // banner) instead of the button. That click is a click on the race: resolving it through the box's
    // own toggle keeps the whole card one target, and without it the race never changed (the Wave H
    // lore probe read the previous race's panel and called it a difference).
    const list = root.querySelector<HTMLElement>("#ancestry-list")!;
    const toggleFromBox = (el: Element | null): HTMLElement | null =>
      el?.closest?.<HTMLElement>(".race-toggle") ?? el?.closest?.<HTMLElement>("[data-race-box]")?.querySelector<HTMLElement>(".race-toggle") ?? null;
    list.addEventListener("click", (e) => {
      const target = e.target as Element | null;
      const chip = target?.closest?.<HTMLElement>(".subrace-chip");
      if (chip) { this.#setAncestry(selectSubrace(this.#ancestry, chip.dataset.race!, chip.dataset.subrace!, RACES)); return; }
      const head = toggleFromBox(target);
      if (head) this.#setAncestry(toggleRace(this.#ancestry, head.dataset.race!, RACES));
    });
    list.addEventListener("keydown", (e) => {
      const head = (e.target as Element | null)?.closest?.<HTMLElement>(".race-toggle");
      if (!head) return;
      const heads = [...list.querySelectorAll<HTMLElement>(".race-toggle")];
      const next = nextHeaderIndex(heads.indexOf(head), e.key, heads.length);
      if (next === null) return;
      e.preventDefault();
      heads[next].focus();
    });

    // The dice (purple, rocky): one click rolls a complete fighter and refreshes the Creator step.
    // A legacy `data-action="random"` control, if one survives, rolls through the same path.
    root.querySelector('[data-action="dice"]')?.addEventListener("click", () => this.rollCreator());
    // Wave O: the title button opens the Profiles panel, and every control inside it reports through
    // ONE hook (action + the row it acted on), so the engine owns the library and this class only paints.
    root.querySelector('[data-action="profiles"]')?.addEventListener("click", () => cb.onProfileAction?.("open", null));
    root.querySelector('[data-action="save-profile"]')?.addEventListener("click", () => cb.onProfileAction?.("save-creator", null));
    // Wave M: the batch size picker and the Run button. The size is read at the click, so the
    // selection can change while a batch is running without corrupting the one in flight.
    root.querySelectorAll("[data-batch-size]").forEach((b) => b.addEventListener("click", () => {
      this.#batchSize = Number((b as HTMLElement).dataset.batchSize);
      root.querySelectorAll("[data-batch-size]").forEach((x) => x.classList.toggle("selected", x === b));
    }));
    root.querySelector('[data-action="run-batch"]')?.addEventListener("click", () => {
      if (this.#batchRunning) return;
      this.setBatchProgress({ fraction: 0, done: 0, total: this.#batchSize, etaS: 0 });
      cb.onBatch?.(this.#batchSize);
    });
    root.querySelector('[data-action="random"]')?.addEventListener("click", () => this.rollCreator());
    root.querySelectorAll("[data-preset]").forEach(btn => btn.addEventListener("click", () => {
      this.#player = { ...PRESETS[parseInt((btn as HTMLElement).dataset.preset!)] };
      this.#syncCreatorUI();
    }));

    // Option groups (L-C): a native <details> toggle writes straight back through Disclosure and
    // localStorage, so the closed-by-default trees remember what was opened.
    root.querySelectorAll<HTMLDetailsElement>("details.opt-group").forEach((d) => {
      d.addEventListener("toggle", () => {
        this.#disclosure = openGroup(this.#disclosure, d.dataset.group ?? "", d.open);
        this.#persistDisclosure();
      });
    });

    // Opponent
    root.querySelector("#menu-opponent")!.addEventListener("change", e => {
      const v = (e.target as HTMLSelectElement).value;
      if (v.startsWith("npc:")) {
        const npc = NPCS.find(n => n.name === v.slice(4))!;
        this.#opponent = { name: npc.name, race: npc.race, subrace: npc.subrace, className: npc.className, palette: "Ember", birthsign: "mountain", level: 1, allocated: {}, appearance: npc.appearance };
      } else {
        const c = v.slice(6) as ClassName;
        this.#opponent = { name: c, race: "human", subrace: null, className: c, palette: "Ember", birthsign: null, level: 1, allocated: {}, appearance: { body: "#b9c9c8", accent: "#dfaa55", height: 1.75, weight: 75, hair: "#172128", eyes: "#172128" } };
      }
    });

    // Fight / rematch / menu
    root.querySelector('[data-action="begin"]')!.addEventListener("click", () => { this.hide(); cb.onStart(this.#player, this.#opponent); });
    root.querySelector('[data-action="rematch"]')!.addEventListener("click", () => { this.hide(); cb.onRematch(); });
    root.querySelector('[data-action="sheet"]')!.addEventListener("click", () => { cb.onSheet?.(); });
    root.querySelector('[data-action="history"]')!.addEventListener("click", () => { cb.onDigest?.(); });
    root.querySelectorAll('[data-action="menu"]').forEach(b => b.addEventListener("click", () => this.#toTitle()));
    // Back (top-left of every non-title screen): the previous screen in the history.
    root.querySelectorAll('[data-action="back"]').forEach(b => b.addEventListener("click", () => { this.back(); }));
    // Mouse clicks must not leave focus on a button: Space/E would re-press it mid-fight.
    // Keyboard-activated clicks (detail 0) keep focus so Tab navigation still works.
    root.addEventListener("click", (e) => {
      const btn = (e.target as Element | null)?.closest?.("button");
      if (btn && e.detail > 0) btn.blur();
    });

    this.#syncCreatorUI();
    this.#wireTabs();
    this.#renderSpectateCard();
  }

  /**
   * Build the panel tabs from the UI tree and wire them. The tabs are generated, not
   * written by hand, so the tree is the single source of truth for the hierarchy: add a
   * panel to `UI_TREE` and it appears here.
   */
  #wireTabs() {
    for (const nav of this.#root.querySelectorAll<HTMLElement>("[data-tabs]")) {
      const screen = nav.dataset.tabs as ScreenId;
      const panels = screenPanels(screen);
      nav.innerHTML = panels.map((p, i) =>
        `<button class="tab" data-tab="${p.id}" data-colour="${p.colour}" title="${p.hint}" data-selected="${i === 0}">${p.label}</button>`,
      ).join("");
      // CSP (style-src 'self') blocks style="" attributes: set the tab colour through CSSOM.
      nav.querySelectorAll<HTMLElement>("[data-tab]").forEach((tab) => {
        const panel = panels.find((p) => p.id === tab.dataset.tab);
        if (panel) tab.style.setProperty("--tab", COLOUR_HEX[panel.colour]);
      });
      const show = (id: string) => {
        // Scope to THIS screen's panels: the title screen also carries `data-panel` sections, and
        // a pinned panel (the Creator preview) is never tab-controlled, so it must stay visible.
        const scope = nav.closest<HTMLElement>(".menu-screen") ?? this.#root;
        for (const panel of scope.querySelectorAll<HTMLElement>(`[data-panel]`)) {
          if (panel.hasAttribute("data-pinned")) continue;
          panel.hidden = panel.dataset.panel !== id;
        }
        for (const tab of nav.querySelectorAll<HTMLElement>("[data-tab]")) {
          tab.dataset.selected = String(tab.dataset.tab === id);
        }
      };
      nav.querySelectorAll<HTMLElement>("[data-tab]").forEach((tab) => {
        tab.addEventListener("click", () => show(tab.dataset.tab!));
      });
      if (panels.length) show(panels[0].id);
    }
  }

  #renderRaceDetail(race: RaceDef) {
    const el = this.#root.querySelector("#race-detail")!;
    const stats = computeRaceStats(race, null);
    const statRow = (label: string, s: { min: number; max: number; avg: number; median: number }) =>
      `<div class="stat-row"><span>${label}</span><b>${s.min}–${s.max}</b></div>`;
    // Race hero: the name centred in a hero box, flanked by primary + secondary stat
    // columns; the birth-sign row drives a live delta preview. The sub-species are picked in
    // the race's own box in the accordion above (W01), not here.
    el.innerHTML = `
      <div class="race-hero">
        <div class="race-hero-name">${esc(race.name)}</div>
        <div class="race-hero-sub">${esc(race.traits[0] ?? "")}</div>
        <p class="race-lore">${esc(race.lore)}</p>
        <div class="race-hero-stats">
          <div class="race-hero-col"><h4>Primary</h4>
            ${statRow("Vitality", stats.vitality)}
            ${statRow("Resilience", stats.resilience)}
            ${statRow("Willpower", stats.willpower)}
            ${statRow("Reflex", stats.reflex)}
            ${statRow("Strength", stats.strength)}
            ${statRow("Intelligence", stats.intelligence)}
          </div>
          <div class="race-hero-col"><h4>Secondary (sub-species + sign)</h4>
            <div id="hero-secondary" class="secondary-rows">${this.#secondaryRows()}</div>
          </div>
        </div>
        <div class="sign-row"><strong>Birth Sign:</strong>
          ${BIRTHSIGNS.map(s => `<button class="sign-chip ${this.#player.birthsign === s.id ? "selected" : ""}" data-sign="${s.id}" title="${esc(s.lore)}">${birthsignIcon(s.id, "sign-icon")}<span>${esc(s.name)}</span></button>`).join("")}
        </div>
        <div id="birthsign-preview">${this.#birthsignPreview()}</div>
      </div>`;
    el.classList.remove("hidden");
    el.querySelectorAll(".sign-chip").forEach(btn =>
      btn.addEventListener("click", () => {
        this.#player = { ...this.#player, birthsign: (btn as HTMLElement).dataset.sign! };
        el.querySelectorAll(".sign-chip").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        this.#refreshSecondary();
      }));
    this.#renderAncestryLore();
  }

  /**
   * The ancestry lore panel (H-G): what the hierarchy (H-A's `ancestryOf`/`rankOf`) says about
   * the selected race/sub-species — name, lore line, skin swatches + crease colour, hair
   * colours, beard mode, tusk count, and this race's metric ranks against the other races.
   * Swatch fills go through CSSOM (the server CSP blocks inline `style=""`).
   */
  #renderAncestryLore(): void {
    const el = this.#root.querySelector<HTMLElement>("#ancestry-lore");
    if (!el) return;
    const node: AncestryNode = ancestryOf(this.#player.race, this.#player.subrace);
    const swatch = (col: string, cls = "") => `<span class="anc-swatch ${cls}" data-colour="${esc(col)}" title="${esc(col)}"></span>`;
    const swatches = (cols: readonly string[]) => cols.map((c) => swatch(c)).join("");
    const ranks = METRICS.map((m) => {
      const order = rankOf(m);
      const rank = node.ranks[m] || order.findIndex((o) => o.id === node.race) + 1;
      return `<div class="anc-rank" title="${esc(order.map((o) => o.id).join(" › "))}"><span>${esc(m)}</span><b>${rank}/4</b></div>`;
    }).join("");
    const beard = node.beard.required ? "required" : node.beard.allowed ? "optional" : "never";
    el.innerHTML = `
      <h4 class="anc-name">${esc(node.name)}</h4>
      <p class="anc-line">${esc(node.lore)}</p>
      <div class="anc-block" id="ancestry-skin"><span class="anc-block-label">Skin</span>
        <div class="anc-swatches">${swatches(node.skin.range)}<span class="anc-note">crease</span>${swatch(node.skin.crease, "anc-crease")}</div>
        <span class="anc-note">${esc(node.skin.zones.join(", "))} · crease strength ${pct(node.skin.creaseStrength)}</span></div>
      <div class="anc-block" id="ancestry-hair"><span class="anc-block-label">Hair</span>
        <div class="anc-swatches">${swatches(node.hair.colors)}</div>
        <span class="anc-note">${esc(node.hair.length)} · curl ${pct(node.hair.curl)} · bald chance ${pct(node.hair.baldChance)}</span></div>
      <div class="anc-block" id="ancestry-beard"><span class="anc-block-label">Beard</span>
        <span class="anc-note">${esc(node.beard.mode)} (${beard})</span></div>
      <div class="anc-block" id="ancestry-tusk"><span class="anc-block-label">Tusks</span>
        <span class="anc-note">${node.tusk.count === 0 ? "none" : `${node.tusk.count} · ${esc(node.tusk.direction)}`}</span></div>
      <div class="anc-block" id="ancestry-ranks"><span class="anc-block-label">Ranks vs the other races</span>
        <div class="anc-ranks">${ranks}</div></div>`;
    el.querySelectorAll<HTMLElement>(".anc-swatch").forEach((s) => { s.style.background = s.dataset.colour ?? "transparent"; });
  }

  /**
   * The spectator card (H-E): both fighters' generated levels and stat budgets, the technique
   * ids the spent stats unlocked, and the arena size. The panel always exists (so the UI-tree
   * probe finds it) and shows a placeholder until the engine hands a card over.
   */
  #renderSpectateCard(): void {
    const el = this.#root.querySelector<HTMLElement>("#spectate-card");
    if (!el) return;
    const card = this.#spectateCard;
    if (!card) {
      // Keep the keyed elements in the DOM even before a card arrives, so the UI-tree probe
      // still finds them; the values read as em-dashes until the engine hands one over.
      el.innerHTML = `
        <h4 class="sp-head">Spectator card <span class="sp-gen">—</span></h4>
        <div class="sp-row">
          <div class="sp-fighter"><b id="spectate-level-a">Level —</b><span id="spectate-budget-a">— stat points</span></div>
          <div class="sp-fighter"><b id="spectate-level-b">Level —</b><span id="spectate-budget-b">— stat points</span></div>
        </div>
        <div class="sp-meta"><span class="sp-tag" id="spectate-arena">— m arena</span></div>
        <p class="sp-techniques" id="spectate-techniques"></p>
        <p class="sp-empty">No generated card yet: start a spectate match and the generator's levels, budgets, techniques and arena appear here.</p>`;
      return;
    }
    const techs = this.#spectateTechniques;
    el.innerHTML = `
      <h4 class="sp-head">Spectator card <span class="sp-gen">${esc(card.generationId)}</span></h4>
      <div class="sp-row">
        <div class="sp-fighter"><b id="spectate-level-a">Level ${num(card.levelA)}</b><span id="spectate-budget-a">${num(card.budgetA)} stat points</span></div>
        <div class="sp-fighter"><b id="spectate-level-b">Level ${num(card.levelB)}</b><span id="spectate-budget-b">${num(card.budgetB)} stat points</span></div>
      </div>
      <div class="sp-meta"><span class="sp-tag" id="spectate-arena">${Math.round(card.arenaSize)} m arena</span><span class="sp-tag">seed ${num(card.seed)}</span></div>
      <p class="sp-techniques" id="spectate-techniques">${techs.length ? esc(techs.join(" · ")) : ""}</p>`;
  }

  /** The secondary-stat rows (sub-species + birth-sign deltas) for the hero column. */
  #secondaryRows(): string {
    return secondaryPreview(this.#player.subrace, this.#player.birthsign)
      .map((r) => {
        const cls = r.delta > 0 ? "pos" : r.delta < 0 ? "neg" : "zero";
        return `<div class="bp-delta"><span>${esc(r.label)}</span><b class="${cls}">${r.text}</b></div>`;
      }).join("");
  }

  /** The dynamic birth-sign preview box (deltas + lore) for the selected sign. */
  #birthsignPreview(): string {
    const sign = BIRTHSIGNS.find((s) => s.id === this.#player.birthsign);
    if (!sign) return `<p class="bp-lore">Choose a birth sign to preview its astral alignment.</p>`;
    return `
      <div class="birthsign-preview">
        <div class="bp-head"><span class="bp-symbol">${birthsignIcon(sign.id, "sign-icon")}</span><b>${esc(sign.name)}</b><span class="bp-tag">Stat deltas</span></div>
        <p class="bp-lore">${esc(sign.lore)}</p>
        <div class="bp-deltas">${this.#secondaryRows()}</div>
      </div>`;
  }

  /** Re-render every secondary column + the sign preview when the sub-species or sign changes. */
  #refreshSecondary(): void {
    const rows = this.#secondaryRows();
    this.#root.querySelectorAll<HTMLElement>(".secondary-rows").forEach((col) => { col.innerHTML = rows; });
    const prev = this.#root.querySelector("#birthsign-preview");
    if (prev) prev.innerHTML = this.#birthsignPreview();
  }

  /** Display `screen` (no history change) and refresh its breadcrumb from the history. */
  #activate(screen: Screen) {
    this.#root.querySelectorAll("[data-screen]").forEach(el => (el as HTMLElement).classList.remove("active"));
    const el = this.#root.querySelector(`[data-screen="${screen}"]`)!;
    el.classList.add("active");
    this.#root.dataset.active = screen;
    const crumb = el.querySelector("[data-crumb]");
    if (crumb) crumb.textContent = this.#nav.trail().map((s) => SCREEN_LABEL[s]).join("  ›  ");
  }

  /**
   * Roll a COMPLETE fighter and refresh the whole Creator step in one call: name, the race box +
   * sub-species chips + `#race-detail` + `#ancestry-lore`, the class/weapon/birthsign tables, the
   * palette chips, `#hero-secondary`, the stat sheet (`#creator-sheet`) — then fire the parent's
   * `onRoll` hook so the engine can re-seat the 3D preview. `seed` is for tests and the parent;
   * the dice omits it and a fresh seed is mixed on every click (never `Math.random`).
   */
  rollCreator(seed?: number): void {
    this.#refreshCreator(seed);
  }

  #refreshCreator(seed?: number): void {
    const mixed = seed ?? ((Date.now() ^ (this.#rollCount++ * 0x9e3779b9)) >>> 0);
    const rolled = rollProfile(mulberry32(mixed));
    this.#player = rolled.profile;
    this.#syncCreatorUI();
    this.#cb.onRoll?.(rolled.profile);
  }

  #syncCreatorUI() {
    (this.#root.querySelector("#creator-name") as HTMLInputElement).value = this.#player.name;
    // Highlight the matching class and weapon rows in the tables.
    this.#root.querySelectorAll("#class-table .pick-row").forEach(r => {
      r.setAttribute("data-selected", String((r as HTMLElement).dataset.class === this.#player.className));
    });
    this.#root.querySelectorAll("#weapon-table .pick-row").forEach(r => {
      const w = (r as HTMLElement).dataset.weapon ?? "";
      r.setAttribute("data-selected", String((w || undefined) === this.#player.weaponType || (w === "" && !this.#player.weaponType)));
    });
    // Birthsign table + palette chips: a roll or preset must visibly move the selection.
    this.#root.querySelectorAll("#birthsign-table .pick-row").forEach(r => {
      r.setAttribute("data-selected", String((r as HTMLElement).dataset.birthsign === this.#player.birthsign));
    });
    this.#root.querySelectorAll(".palette-chip").forEach(c => {
      const on = (c as HTMLElement).dataset.palette === this.#player.palette;
      c.classList.toggle("selected", on);
      c.setAttribute("aria-pressed", String(on));
    });
    this.#renderClassSkills(this.#player.className);
    // Ancestry: open the profile's race box with its sub-species chosen (a missing or foreign
    // sub-species falls back to the race's first, so the highlight is the real selection).
    this.#ancestry = initialAncestry(RACES, this.#player.race, this.#player.subrace);
    this.#player = { ...this.#player, race: this.#ancestry.race, subrace: this.#ancestry.subrace };
    this.#syncAncestry();
    const race = raceById(this.#player.race);
    if (race) this.#renderRaceDetail(race);
    // The rolled fighter's stat sheet (real game maths) and the ancestry group étendards.
    this.#renderCreatorSheet();
    this.#refreshGroupGlyphs();
  }

  /** Draw the rolled fighter's stat sheet from L-B's `creatorSheet` (the real game maths). */
  #renderCreatorSheet(): void {
    const el = this.#root.querySelector<HTMLElement>("#creator-sheet");
    if (!el) return;
    el.innerHTML = creatorSheetHtml(creatorSheet(this.#player));
  }

  /**
   * Re-banner the group glyphs after a roll: the ancestry trees show the rolled race's standard,
   * and the birthsign tree its sign icon. Glyphs are baked at render time, so a roll must redraw
   * them by hand (CSSOM/`innerHTML` once per roll, never per frame).
   */
  #refreshGroupGlyphs(): void {
    const glyph = (key: string): HTMLElement | null =>
      this.#root.querySelector<HTMLElement>(`details.opt-group[data-group="${key}"] .opt-glyph`);
    const race = glyph("select/ancestry/race");
    if (race) race.innerHTML = raceBanner(this.#player.race, null, "opt-banner");
    const sub = glyph("select/ancestry/subrace");
    if (sub) sub.innerHTML = raceBanner(this.#player.race, this.#player.subrace, "opt-banner");
    const sign = this.#root.querySelector<HTMLElement>('details.opt-group[data-group="select/sign/birthsign"] .opt-glyph');
    if (sign) sign.innerHTML = birthsignIcon(this.#player.birthsign, "opt-icon");
  }

  /** One race box of the Ancestry accordion: header button + collapsible sub-species region. */
  #raceBoxHtml(r: RaceDef): string {
    return `
            <div class="race-box" data-race-box="${esc(r.id)}">
              <h4 class="race-box-head">
                <button type="button" class="race-card race-toggle" id="race-toggle-${esc(r.id)}" data-race="${esc(r.id)}"
                  aria-expanded="false" aria-controls="race-panel-${esc(r.id)}">
                  <span class="race-box-banner" aria-hidden="true">${raceBanner(r.id, null, "race-banner")}</span>
                  <span class="race-box-text"><strong class="race-box-name" data-race-label>${esc(r.name)}</strong><small class="race-box-trait">${esc(r.traits[0] ?? "")}</small></span>
                  ${icon("chevron-down", "race-box-chevron")}
                </button>
              </h4>
              <div class="race-box-body" id="race-panel-${esc(r.id)}" role="region" aria-labelledby="race-toggle-${esc(r.id)}">
                <div class="race-box-inner">
                  <div class="subrace-row" role="group" aria-label="Sub-species of ${esc(r.name)}">${r.subspecies.map((s) =>
                    `<button type="button" class="subrace-chip" data-race="${esc(r.id)}" data-subrace="${esc(s.id)}" aria-pressed="false" title="${esc(s.desc)}"><span class="subrace-banner" aria-hidden="true">${raceBanner(r.id, s.id, "subrace-banner-svg")}</span><span class="subrace-name">${esc(s.name)}</span></button>`).join("")}</div>
                  <p class="subrace-desc" data-subrace-desc></p>
                </div>
              </div>
            </div>`;
  }

  /**
   * Apply a new accordion state: copy race + sub-species into the profile, redraw the race
   * detail when the race changed (else refresh the sub-species-driven secondary rows), then
   * sync the boxes' highlight, labels and open state.
   */
  #setAncestry(next: AncestryState): void {
    const prev = this.#ancestry;
    this.#ancestry = next;
    if (next.race !== prev.race || next.subrace !== prev.subrace) {
      this.#player = { ...this.#player, race: next.race, subrace: next.subrace };
      const race = raceById(next.race);
      if (next.race !== prev.race && race) this.#renderRaceDetail(race);
      else this.#refreshSecondary();
    }
    this.#renderAncestryLore();
    this.#syncAncestry();
  }

  /**
   * Draw `#ancestry` into the boxes without rebuilding them: the selected box and chip share
   * the accent (class `selected`, `aria-pressed`), the selected header reads
   * "Race · Sub-species", and a collapsed body is `inert` so Tab skips its hidden chips.
   */
  #syncAncestry(): void {
    for (const box of ancestryView(this.#ancestry, RACES)) {
      const el = this.#root.querySelector<HTMLElement>(`[data-race-box="${box.raceId}"]`);
      if (!el) continue;
      el.classList.toggle("selected", box.selected);
      el.classList.toggle("expanded", box.expanded);
      const head = el.querySelector<HTMLElement>(".race-toggle")!;
      head.classList.toggle("selected", box.selected);
      head.setAttribute("aria-expanded", String(box.expanded));
      el.querySelector("[data-race-label]")!.textContent = box.label;
      el.querySelector<HTMLElement>(".race-box-body")!.inert = !box.expanded;
      let desc = "";
      for (const chip of box.chips) {
        const c = el.querySelector<HTMLElement>(`.subrace-chip[data-subrace="${chip.id}"]`);
        if (!c) continue;
        c.classList.toggle("selected", chip.selected);
        c.setAttribute("aria-pressed", String(chip.selected));
        if (chip.selected) desc = c.title;
      }
      el.querySelector("[data-subrace-desc]")!.textContent = desc;
    }
  }

  /** Show the selected class's three skills (dash / power / defense) with their details. */
  #renderClassSkills(className: ClassName) {
    const el = this.#root.querySelector("#class-skills")!;
    const skills = skillsForClass(className);
    const KIND_LABEL: Record<string, string> = { dash: "Dash", power: "Power", defense: "Defense" };
    el.innerHTML = `
      <h4 class="skills-head">${className} techniques</h4>
      <div class="skills-grid">${skills.map((s: Skill) => {
        const p = s.payload;
        const stats: string[] = [];
        if (p.damageMul && p.damageMul !== 1) stats.push(`×${p.damageMul} dmg`);
        if (p.stun) stats.push(`${p.stun}s stun`);
        if (p.knockbackMul && p.knockbackMul !== 1) stats.push(`×${p.knockbackMul} knock`);
        if (p.armorMul && p.armorMul !== 1) stats.push(`×${p.armorMul} armour`);
        if (p.lifesteal) stats.push(`${Math.round(p.lifesteal * 100)}% leech`);
        if (p.dot) stats.push(`${p.dot.total} over ${p.dot.seconds}s`);
        return `
        <div class="skill-card element-${s.element}">
          <div class="skill-top"><span class="skill-kind">${KIND_LABEL[s.kind] ?? s.kind}</span><span class="skill-element">${s.element}</span></div>
          <div class="skill-name">${esc(s.name)}</div>
          <div class="skill-blurb">${esc(s.blurb)}</div>
          <div class="skill-stats">${stats.length ? stats.join(" · ") : "—"} · ${s.cooldown}s cd</div>
        </div>`;
      }).join("")}
      </div>`;
  }

  /**
   * Show `screen` and record it in the navigation history: the title resets the history (it is
   * the root), any other screen is pushed on top (re-showing the current screen adds nothing).
   */
  show(screen: Screen, opts?: { winner?: "player" | "opponent"; result?: { title: string; detail: string }; history?: HistoryView; sheet?: SheetData; leaderboard?: LeaderRow[] }) {
    this.#visible = true;
    this.#root.style.display = "flex";
    this.#nav.push(screen);
    this.#activate(screen);
    if (screen === "victory" && opts?.result) {
      this.#root.querySelector("#victory-text")!.textContent = opts.result.title;
      this.#root.querySelector("#victory-detail")!.textContent = opts.result.detail;
    }
    if (screen === "digest" && opts?.history) this.#renderHistory(opts.history, opts.leaderboard ?? []);
    if (screen === "sheet" && opts?.sheet) {
      const s = opts.sheet;
      const statKV = Object.entries(s.stats).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${num(v)}</td></tr>`).join("");
      const duelsKV = (s.duels ?? []).slice(-5).reverse().map(d =>
        `<tr><td>${esc(String(d.date ?? "").slice(0, 10))}</td><td>${esc(d.opponent)}</td><td>${esc(d.result)}</td><td>${num(d.duration)}s</td><td>${num(d.dealt)}/${num(d.received)}</td><td>${esc(d.weapon ?? "-")}</td><td>${esc(d.arena ?? "-")}</td></tr>`
      ).join("");
      this.#root.querySelector("#sheet-body")!.innerHTML = `
        <div class="sheet-grid">
          <div>${s.portrait && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s.portrait) ? `<img src="${s.portrait}" class="sheet-portrait" alt="${esc(s.name)}">` : ""}
          <h3>${esc(s.name)}</h3>
            <p><strong>Race:</strong> ${esc(s.race)} ${s.subrace ? "· " + esc(s.subrace) : ""}</p>
            <p><strong>Birthsign:</strong> ${esc(s.birthsign ?? "none")}</p>
            <p><strong>Class:</strong> ${esc(s.className)}</p>
            <p><strong>HP:</strong> ${num(s.hp)} | <strong>Weapon:</strong> ${esc(s.weapon)}</p>
          </div>
          <div><h3>Stats</h3><table class="digest-table"><tr><th>Stat</th><th>Value</th></tr>${statKV}</table></div>
        </div>
        ${duelsKV ? `<h3 class="digest-subhead">Recent Duels</h3><table class="digest-table"><tr><th>Date</th><th>Opponent</th><th>Result</th><th>Dur</th><th>Dmg</th><th>Weapon</th><th>Arena</th></tr>${duelsKV}</table>` : ""}`;
    }
  }

  #renderHistory(view: HistoryView, leaderboard: LeaderRow[]) {
    this.#history = { view, leaderboard };
    this.#renderHistoryBody();
  }

  /** The History page's sort control (H-G), built from HistoryView's orders. */
  #historySortHtml(): string {
    const opts = HISTORY_SORTS.map((s) => `<option value="${s}"${s === this.#historySort ? " selected" : ""}>${esc(HISTORY_SORT_LABEL[s])}</option>`).join("");
    return `<div class="history-sort"><label for="filter-sort">Order</label><select id="filter-sort">${opts}</select></div>`;
  }

  /** The History summary strip (H-G): fastest decided match, widest stat gap, ties and timeouts. */
  #highlightsHtml(rows: HistoryUiRow[]): string {
    const lines = highlightSummary(rows, (r) => r.label)
      .map((l) => `<div class="hl" data-hl="${l.id}"><span class="hl-label">${esc(l.label)}</span><b class="hl-value">${esc(l.value)}</b></div>`).join("");
    return `<div class="history-highlights" id="history-highlights">${lines}</div>`;
  }

  /** Re-wire the sort control after a (re)render: a change re-draws the page in the new order. */
  #wireHistoryControls(): void {
    const sel = this.#root.querySelector<HTMLSelectElement>("#filter-sort");
    if (!sel) return;
    sel.addEventListener("change", () => {
      this.#historySort = sel.value as HistorySort;
      this.#renderHistoryBody();
    });
  }

  /** Draw the History page from the cached view: board, highlights, sort control and rows. */
  #renderHistoryBody() {
    const body = this.#root.querySelector<HTMLElement>("#digest-body");
    if (!body || !this.#history) return;
    const { view: { list, summary: s }, leaderboard } = this.#history;
    const uiRows = sortHistory(list.map(historyRow), this.#historySort);
    const strip = this.#highlightsHtml(list.map(historyRow));
    const sortBar = this.#historySortHtml();
    // The AI leaderboard always renders when bots are ranked, even before any
    // recorded match (a spectate fight registers the ladder but a stalled or
    // in-progress one may not have produced a record yet).
    const boardRows = leaderboard.map((r) => `
      <tr class="leader-row ${r.king ? "is-king" : ""}" data-ai="${esc(r.id)}">
        <td class="leader-rank">${r.king ? "👑" : ""} #${r.rank}</td>
        <td class="leader-name">${esc(r.name)}<small>${esc(r.id)}</small></td>
        <td>${esc(r.archetype)}</td>
        <td class="leader-mmr">${Math.round(r.mmr)}</td>
        <td>${r.wins}–${r.losses}</td>
        <td>${Math.round(r.peak)}</td>
      </tr>`).join("");
    const board = leaderboard.length ? `
      <h3 class="digest-subhead">AI Leaderboard <small class="scroll-hint">click a fighter for their profile</small></h3>
      <table class="digest-table leader-table"><tr><th>Rank</th><th>Fighter</th><th>Style</th><th>MMR</th><th>W–L</th><th>Peak</th></tr>${boardRows}</table>` : "";
    const wireBoard = () => {
      body.querySelectorAll<HTMLElement>(".leader-row").forEach((row) => row.addEventListener("click", () => {
        const ai = leaderboard.find((r) => r.id === row.dataset.ai);
        if (ai) this.#showAiProfile(ai);
      }));
    };
    if (!s.matches) {
      body.innerHTML = `${board}${sortBar}${strip}<p class="empty">No matches recorded yet. Fight or spectate a duel: every match is saved here with who, when, where, how, stats, AI and result.</p>`;
      this.#wireHistoryControls();
      wireBoard();
      return;
    }
    {
    const d = s.duration;
    const rateTable = (title: string, rows: Rate[]) => `<h3 class="digest-subhead">${title}</h3>
      <table class="digest-table"><tr><th>${title.replace("By ", "")}</th><th>Games</th><th>Wins</th><th>Win %</th><th>95% CI</th><th class="bar-col"></th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.games}</td><td>${r.wins}</td><td>${pct(r.rate)}</td><td>${pct(r.lo)}–${pct(r.hi)}</td>
        <td class="bar-col"><span class="ci-track"><span class="ci-range" data-lo="${r.lo}" data-hi="${r.hi}"></span><span class="ci-point" data-at="${r.rate}"></span></span></td></tr>`).join("")}</table>`;
    const counts = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `<span class="chip">${esc(k)} <b>${v}</b></span>`).join("");
    const rows = uiRows.slice(0, 60).map((row) => {
      const r = row.record;
      const [a, b] = r.fighters;
      const who = (f: typeof a, i: number) => `<span class="${r.winner === i ? "won" : "lost"}">${esc(f.name)}</span><small>${esc(f.race)} ${esc(f.className)} · ${esc(f.weapon)} · ${f.controller === "human" ? "Player" : "AI tree"}</small>`;
      return `<tr><td>#${num(r.id)}<small>${esc(r.at.slice(0, 16).replace("T", " "))}</small><small>in-world ${String(Math.floor(r.hour)).padStart(2, "0")}:${String(Math.round((r.hour % 1) * 60) % 60).padStart(2, "0")}</small></td>
        <td>${who(a, 0)}</td><td>${who(b, 1)}</td>
        <td>${esc(r.place)}<small>${esc(r.arena)} · ${esc(r.phase)} ${String(Math.floor(r.hour)).padStart(2, "0")}h</small></td>
        <td>${esc(r.reason)}<small>${num(r.duration)}s · 1st: ${esc(r.firstStrike ?? "—")}</small><span class="history-badges">${badgeHtml(row)}</span></td>
        <td>${num(a.dealt)}/${num(b.dealt)}<small>${num(a.hits)}/${num(b.hits)} hits</small></td>
        <td>V${num(a.stats.vitality)} R${num(a.stats.resilience)} W${num(a.stats.willpower)} Rx${num(a.stats.reflex)} S${num(a.stats.strength)} I${num(a.stats.intelligence)}<small>vs V${num(b.stats.vitality)} R${num(b.stats.resilience)} W${num(b.stats.willpower)} Rx${num(b.stats.reflex)} S${num(b.stats.strength)} I${num(b.stats.intelligence)}</small></td></tr>`;
    }).join("");
    body.innerHTML = `
      ${board}
      ${sortBar}
      ${strip}
      <div class="kpis" id="history-summary">
        <div><b>${s.matches}</b><span>${s.matches === 1 ? "match" : "matches"}</span></div>
        <div><b>${d.mean.toFixed(1)}s</b><span>mean (median ${d.median.toFixed(1)}s, sd ${d.sd.toFixed(1)})</span></div>
        <div><b>${pct(s.firstStrikeWinRate.rate)}</b><span>first-strike wins (n=${s.firstStrikeWinRate.n})</span></div>
      </div>
      <div class="chips">${counts(s.reasons)}${counts(s.byPhase)}${counts(s.byPlace)}</div>
      ${rateTable("By Race", s.byRace)}${rateTable("By Class", s.byClass)}${rateTable("By Weapon", s.byWeapon)}${rateTable("By Controller", s.byController)}
      <h3 class="digest-subhead">Matches (newest first) <small class="scroll-hint">scroll ↔ ↕</small></h3>
      <div class="table-scroll" id="history-list"><table class="digest-table match-table"><tr><th>When</th><th>Fighter A</th><th>Fighter B</th><th>Where</th><th>How</th><th>Dmg A/B</th><th>Stats A vs B</th></tr>${rows}</table></div>`;
    // CSP forbids inline style attributes; position the bars through CSSOM instead.
    body.querySelectorAll<HTMLElement>(".ci-range").forEach((el) => {
      const lo = Number(el.dataset.lo), hi = Number(el.dataset.hi);
      el.style.left = `${lo * 100}%`;
      el.style.width = `${Math.max(0.5, (hi - lo) * 100)}%`;
    });
    body.querySelectorAll<HTMLElement>(".ci-point").forEach((el) => { el.style.left = `${Number(el.dataset.at) * 100}%`; });
    this.#wireHistoryControls();
    // Leaderboard rows open the fighter's profile card.
    wireBoard();
    }
  }

  /** The floating profile card for one AI: placement, MMR, style and record. */
  #showAiProfile(r: LeaderRow) {
    let modal = this.#root.querySelector<HTMLElement>("#ai-profile");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "ai-profile";
      this.#root.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="ai-card">
        <div class="ai-crown">${r.king ? "👑" : ""}</div>
        <h3 class="ai-name">${esc(r.name)}</h3>
        <p class="ai-id">${esc(r.id)}</p>
        <p class="ai-style"><b>${esc(r.archetype)}</b> — ${esc(r.style)}</p>
        <div class="ai-stats">
          <div><b>#${r.rank}</b><span>rank</span></div>
          <div><b>${Math.round(r.mmr)}</b><span>MMR</span></div>
          <div><b>${Math.round(r.peak)}</b><span>peak</span></div>
          <div><b>${r.wins}</b><span>wins</span></div>
          <div><b>${r.losses}</b><span>losses</span></div>
          <div><b>${r.wins + r.losses === 0 ? "—" : Math.round((r.wins / (r.wins + r.losses)) * 100) + "%"}</b><span>win rate</span></div>
        </div>
        <button class="menu-btn menu-btn-sm ai-close">Close</button>
      </div>`;
    modal.classList.add("open");
    modal.querySelector(".ai-close")!.addEventListener("click", () => modal!.classList.remove("open"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal!.classList.remove("open"); });
  }

  hide() {
    this.#visible = false;
    this.#root.style.display = "none";
  }
}