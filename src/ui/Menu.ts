import { CLASSES, type ClassName } from "../game/Stats.ts";
import { NPCS, PALETTES, PRESETS, randomProfile, type CharacterProfile } from "../game/Characters.ts";
import { RACES, raceById, computeRaceStats, type RaceDef } from "../game/Races.ts";
import { BIRTHSIGNS } from "../game/Birthsight.ts";
import { secondaryPreview } from "../game/SecondaryStats.ts";
import { ALL_SKILLS, skillsForClass, type Skill } from "../game/Skills.ts";
import type { HistorySummary, MatchRecord, Rate } from "../game/MatchHistory.ts";
import { objectSize, RING_SHAPES, type ArenaConfig, type ObjectKind } from "../game/ArenaConfig.ts";
import { surfaceFor } from "../game/Terrain.ts";
import { weaponForClass } from "../game/Weapon.ts";
import { COLOUR_HEX, screenPanels, type ScreenId } from "./UiTree.ts";
import { NavStack } from "./NavStack.ts";
import { birthsignIcon, icon } from "./Icons.ts";
import { ancestryView, initialAncestry, nextHeaderIndex, selectSubrace, toggleRace, type AncestryState } from "./AncestryState.ts";
import { weaponMenuOptions } from "../game/weapons/Loadout.ts";

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

export type Screen = "title" | "select" | "victory" | "digest" | "sheet";

/** Short name of each screen, used by the breadcrumb next to the Back button. */
export const SCREEN_LABEL: Readonly<Record<Screen, string>> = {
  title: "Menu",
  select: "Create your fighter",
  victory: "Result",
  sheet: "Character sheet",
  digest: "Match history",
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

  /** The arena the player asked for (applied to the next match only). */
  arenaChoice(): Partial<ArenaConfig> {
    return { ...this.#arena };
  }

  constructor(callbacks: MenuCallbacks) {
    this.#root = document.createElement("div");
    this.#root.id = "menu";
    document.body.appendChild(this.#root);
    this.#render(callbacks);
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

  #render(cb: MenuCallbacks) {
    this.#cb = cb;
    const root = this.#root;
    root.innerHTML = `
      <div class="menu-screen" data-screen="title">
        <h1 class="menu-title">MYTHERRANIA</h1>
        <p class="menu-sub">Cel-shaded arena combat</p>
        <div id="profile-picker" class="profile-picker"></div>
        <button class="menu-btn" data-action="start">⚔ Fight</button>
        <button class="menu-btn menu-btn-alt" data-action="digest">📋 History</button>
        <button class="menu-btn menu-btn-alt" data-action="spectate">👁 Spectate</button>
        <button class="menu-btn menu-btn-alt" data-action="settings" title="Keyboard layout, mouse, camera, display, sound">${icon("gear", "menu-btn-icon")}Settings</button>
      </div>

      <div class="menu-screen" data-screen="select">${this.#backBar()}
        <header class="screen-head">
          <h2>Create your fighter</h2>
          <p class="screen-hint">Everything is one screen away: pick a panel, and the rest stays visible in the tabs.</p>
        </header>
        <nav class="panel-tabs" data-tabs="select"></nav>

        <section class="ui-panel" data-panel="ancestry" data-colour="grass">
          <h3 class="panel-head"><span class="dot"></span>Ancestry<span class="panel-hint">Click a race to open it, then pick its sub-species. They drive the body, hair, beard and tusks.</span></h3>
          <label class="field">Name <input id="creator-name" type="text" value="${esc(this.#player.name)}"></label>
          <div class="ancestry-list" id="ancestry-list">${RACES.map((r) => this.#raceBoxHtml(r)).join("")}</div>
          <div id="race-detail" class="race-detail"></div>
        </section>

        <section class="ui-panel" data-panel="calling" data-colour="sand">
          <h3 class="panel-head"><span class="dot"></span>Calling<span class="panel-hint">The class and the three techniques it brings.</span></h3>
          <table class="pick-table" id="class-table">
            <tbody>${CLASSES.map(c => `
              <tr class="pick-row" data-class="${c}" data-selected="${c === this.#player.className}">
                <td class="pick-name">${c}</td>
                <td class="pick-hint">${weaponForClass(c).name}</td>
              </tr>`).join("")}
            </tbody>
          </table>
          <div id="class-skills" class="class-skills"></div>
          <h4 class="group-head">Weapon</h4>
          <table class="pick-table" id="weapon-table">
            <tbody>${weaponMenuOptions().map(o => `
              <tr class="pick-row" data-weapon="${esc(o.value)}" data-selected="${(o.value || undefined) === this.#player.weaponType || (o.value === "" && !this.#player.weaponType)}">
                <td class="pick-name">${esc(o.label)}</td>
                <td class="pick-hint">${esc(o.hint)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
          <h4 class="group-head">Palette</h4>
          <div class="palettes">${Object.entries(PALETTES).map(([name]) =>
            `<button class="palette-chip palette-${name}" data-palette="${name}" title="${name}"></button>`).join("")}</div>
          <div class="creator-row">
            <button class="menu-btn menu-btn-sm" data-action="random">Random</button>
            ${PRESETS.map((p, i) => `<button class="menu-btn menu-btn-sm" data-preset="${i}">${p.name}</button>`).join("")}
          </div>
        </section>

        <section class="ui-panel" data-panel="sign" data-colour="violet">
          <h3 class="panel-head"><span class="dot"></span>Star sign<span class="panel-hint">The birthsign stacks additively on the sub-species.</span></h3>
          <table class="pick-table" id="birthsign-table">
            <tbody>${BIRTHSIGNS.map(b => `
              <tr class="pick-row" data-birthsign="${b.id}" data-selected="${b.id === this.#player.birthsign}">
                <td class="pick-name"><span class="sign-label">${birthsignIcon(b.id, "sign-icon")}<span>${esc(b.name)}</span></span></td>
                <td class="pick-hint">${b.lore}</td>
              </tr>`).join("")}
            </tbody>
          </table>
          <h4 class="group-head">Secondary stats</h4>
          <div id="hero-secondary" class="secondary-rows"></div>
        </section>

        <section class="ui-panel" data-panel="opponent" data-colour="ocean">
          <h3 class="panel-head"><span class="dot"></span>Opponent<span class="panel-hint">Who you face, and the terms of the match.</span></h3>
          <label class="field">Opponent
            <select id="menu-opponent">
              ${NPCS.map(n => `<option value="npc:${n.name}">${n.name} (${n.className})</option>`).join("")}
              ${CLASSES.map(c => `<option value="class:${c}">${c}</option>`).join("")}
            </select>
          </label>
          <label class="field">Match length
            <select id="match-length">
              <option value="1">Standard</option>
              <option value="0.5">Short (half health)</option>
              <option value="0.25">Blitz (quarter health)</option>
            </select>
          </label>
        </section>

        <section class="ui-panel" data-panel="arena" data-colour="positive">
          <h3 class="panel-head"><span class="dot"></span>Arena<span class="panel-hint">Shape, walls, props and pickups.</span></h3>
          <div class="arena-pick">
            <label>Ring shape
              <select id="arena-shape">
                <option value="">Random</option>
                ${RING_SHAPES.map((s, i) => `<option value="${i}">${s}</option>`).join("")}
              </select>
            </label>
            <label>Size <output id="arena-size-out">random</output>
              <input id="arena-size" type="range" min="${ARENA_SLIDER_RANDOM}" max="${LIVE_ARENA_MAX}" step="${ARENA_SIZE_STEP}" value="${ARENA_SLIDER_RANDOM}" aria-describedby="arena-size-hint">
              <small id="arena-size-hint" class="field-hint">Far left = random. Fixed sizes run ${LIVE_ARENA_MIN}–${LIVE_ARENA_MAX} m.</small>
            </label>
            <label>Wall
              <select id="arena-walls">
                <option value="">Random (90% walled)</option>
                <option value="1">Always</option>
                <option value="0">Never</option>
              </select>
            </label>
            <label>Wall resistance <output id="arena-res-out">random</output>
              <input id="arena-res" type="range" min="0" max="9000" step="100" value="0">
            </label>
          </div>
        </section>

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

      <div class="menu-screen" data-screen="digest">${this.#backBar()}
        <h2>Match History</h2>
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
    const list = root.querySelector<HTMLElement>("#ancestry-list")!;
    list.addEventListener("click", (e) => {
      const target = e.target as Element | null;
      const chip = target?.closest?.<HTMLElement>(".subrace-chip");
      if (chip) { this.#setAncestry(selectSubrace(this.#ancestry, chip.dataset.race!, chip.dataset.subrace!, RACES)); return; }
      const head = target?.closest?.<HTMLElement>(".race-toggle");
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

    // Random / presets
    root.querySelector('[data-action="random"]')!.addEventListener("click", () => {
      this.#player = randomProfile(Math.random);
      this.#syncCreatorUI();
    });
    root.querySelectorAll("[data-preset]").forEach(btn => btn.addEventListener("click", () => {
      this.#player = { ...PRESETS[parseInt((btn as HTMLElement).dataset.preset!)] };
      this.#syncCreatorUI();
    }));

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
        for (const panel of this.#root.querySelectorAll<HTMLElement>(`[data-panel]`)) {
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
            <div id="hero-secondary">${this.#secondaryRows()}</div>
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

  /** Re-render the secondary column + preview when sub-species or sign changes. */
  #refreshSecondary(): void {
    const col = this.#root.querySelector("#hero-secondary");
    if (col) col.innerHTML = this.#secondaryRows();
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
    this.#renderClassSkills(this.#player.className);
    // Ancestry: open the profile's race box with its sub-species chosen (a missing or foreign
    // sub-species falls back to the race's first, so the highlight is the real selection).
    this.#ancestry = initialAncestry(RACES, this.#player.race, this.#player.subrace);
    this.#player = { ...this.#player, race: this.#ancestry.race, subrace: this.#ancestry.subrace };
    this.#syncAncestry();
    const race = raceById(this.#player.race);
    if (race) this.#renderRaceDetail(race);
  }

  /** One race box of the Ancestry accordion: header button + collapsible sub-species region. */
  #raceBoxHtml(r: RaceDef): string {
    return `
            <div class="race-box" data-race-box="${esc(r.id)}">
              <h4 class="race-box-head">
                <button type="button" class="race-card race-toggle" id="race-toggle-${esc(r.id)}" data-race="${esc(r.id)}"
                  aria-expanded="false" aria-controls="race-panel-${esc(r.id)}">
                  <span class="race-box-text"><strong class="race-box-name" data-race-label>${esc(r.name)}</strong><small class="race-box-trait">${esc(r.traits[0] ?? "")}</small></span>
                  ${icon("chevron-left", "race-box-chevron")}
                </button>
              </h4>
              <div class="race-box-body" id="race-panel-${esc(r.id)}" role="region" aria-labelledby="race-toggle-${esc(r.id)}">
                <div class="race-box-inner">
                  <div class="subrace-row" role="group" aria-label="Sub-species of ${esc(r.name)}">${r.subspecies.map((s) =>
                    `<button type="button" class="subrace-chip" data-race="${esc(r.id)}" data-subrace="${esc(s.id)}" aria-pressed="false" title="${esc(s.desc)}">${esc(s.name)}</button>`).join("")}</div>
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

  #renderHistory({ list, summary: s }: HistoryView, leaderboard: LeaderRow[]) {
    const body = this.#root.querySelector<HTMLElement>("#digest-body")!;
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
      body.innerHTML = `${board}<p class="empty">No matches recorded yet. Fight or spectate a duel: every match is saved here with who, when, where, how, stats, AI and result.</p>`;
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
    const rows = [...list].reverse().slice(0, 60).map((r) => {
      const [a, b] = r.fighters;
      const who = (f: typeof a, i: number) => `<span class="${r.winner === i ? "won" : "lost"}">${esc(f.name)}</span><small>${esc(f.race)} ${esc(f.className)} · ${esc(f.weapon)} · ${f.controller === "human" ? "Player" : "AI tree"}</small>`;
      return `<tr><td>#${num(r.id)}<small>${esc(r.at.slice(0, 16).replace("T", " "))}</small><small>in-world ${String(Math.floor(r.hour)).padStart(2, "0")}:${String(Math.round((r.hour % 1) * 60) % 60).padStart(2, "0")}</small></td>
        <td>${who(a, 0)}</td><td>${who(b, 1)}</td>
        <td>${esc(r.place)}<small>${esc(r.arena)} · ${esc(r.phase)} ${String(Math.floor(r.hour)).padStart(2, "0")}h</small></td>
        <td>${esc(r.reason)}<small>${num(r.duration)}s · 1st: ${esc(r.firstStrike ?? "—")}</small></td>
        <td>${num(a.dealt)}/${num(b.dealt)}<small>${num(a.hits)}/${num(b.hits)} hits</small></td>
        <td>V${num(a.stats.vitality)} R${num(a.stats.resilience)} W${num(a.stats.willpower)} Rx${num(a.stats.reflex)} S${num(a.stats.strength)} I${num(a.stats.intelligence)}<small>vs V${num(b.stats.vitality)} R${num(b.stats.resilience)} W${num(b.stats.willpower)} Rx${num(b.stats.reflex)} S${num(b.stats.strength)} I${num(b.stats.intelligence)}</small></td></tr>`;
    }).join("");
    body.innerHTML = `
      ${board}
      <div class="kpis">
        <div><b>${s.matches}</b><span>${s.matches === 1 ? "match" : "matches"}</span></div>
        <div><b>${d.mean.toFixed(1)}s</b><span>mean (median ${d.median.toFixed(1)}s, sd ${d.sd.toFixed(1)})</span></div>
        <div><b>${pct(s.firstStrikeWinRate.rate)}</b><span>first-strike wins (n=${s.firstStrikeWinRate.n})</span></div>
      </div>
      <div class="chips">${counts(s.reasons)}${counts(s.byPhase)}${counts(s.byPlace)}</div>
      ${rateTable("By Race", s.byRace)}${rateTable("By Class", s.byClass)}${rateTable("By Weapon", s.byWeapon)}${rateTable("By Controller", s.byController)}
      <h3 class="digest-subhead">Matches (newest first) <small class="scroll-hint">scroll ↔ ↕</small></h3>
      <div class="table-scroll"><table class="digest-table match-table"><tr><th>When</th><th>Fighter A</th><th>Fighter B</th><th>Where</th><th>How</th><th>Dmg A/B</th><th>Stats A vs B</th></tr>${rows}</table></div>`;
    // CSP forbids inline style attributes; position the bars through CSSOM instead.
    body.querySelectorAll<HTMLElement>(".ci-range").forEach((el) => {
      const lo = Number(el.dataset.lo), hi = Number(el.dataset.hi);
      el.style.left = `${lo * 100}%`;
      el.style.width = `${Math.max(0.5, (hi - lo) * 100)}%`;
    });
    body.querySelectorAll<HTMLElement>(".ci-point").forEach((el) => { el.style.left = `${Number(el.dataset.at) * 100}%`; });
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