// UI tree: the interface as DATA, not as markup.
//
// Every screen is a tree of panels, and every panel is a tree of groups, and every group
// lists the control KEYS it owns. The renderer walks this tree, so the layout, the colour
// coding and the DOM data-attributes all come from one place — there is no second copy of
// the structure hiding in the markup.
//
// The questions this file answers, for every element:
//   WHAT   is it            -> `key` (the stable DOM id, `data-key`)
//   WHERE  does it live     -> screen > panel > group (the path)
//   WHY    is it there      -> `hint` (one line, shown as a tooltip)
//   WHEN   is it visible    -> `when` ("always" | "fight" | "spectate" | "idle")
//   WHO    owns it          -> `owner` ("player" | "opponent" | "both" | "system")
//   LEAST/MOST important    -> `weight` 0..2 (0 = advanced, hidden behind "advanced")
//   WHAT is it grouped with -> the group, and the panel's colour code
//
// Pure module: no Three.js, no DOM.

/** Screens the menu can show. */
export type ScreenId = "title" | "select" | "sheet" | "digest" | "victory";

/** The design palette's colour codes, used to tint panels and their headers. */
export type ColourCode = "ink" | "sand" | "grass" | "ocean" | "coral" | "positive" | "violet";

/** The hex for each colour code, matching DESIGN.md's palette. */
export const COLOUR_HEX: Record<ColourCode, string> = {
  ink: "#172128",
  sand: "#dfaa55",
  grass: "#82b970",
  ocean: "#4f8490",
  coral: "#ef7455",
  positive: "#a9ce7c",
  violet: "#a06cd5",
};

/** When a control applies. */
export type When = "always" | "fight" | "spectate" | "idle";

/** Who a control belongs to. */
export type Owner = "player" | "opponent" | "both" | "system";

/** Importance: 2 = essential, 1 = useful, 0 = advanced (behind the "advanced" toggle). */
export type Weight = 0 | 1 | 2;

/** One control. `key` is the DOM id and `data-key`; the tree owns it, not the markup. */
export interface UiControl {
  key: string;
  label: string;
  hint: string;
  when: When;
  owner: Owner;
  weight: Weight;
}

/** A group of controls inside a panel: the smallest labelled division. */
export interface UiGroup {
  id: string;
  label: string;
  hint: string;
  controls: UiControl[];
  /** Render this group's disclosure OPEN on a first visit. Absent means false: every
   *  option group is a CLOSED tree unless it is deliberately marked, so the visual
   *  default (closed) and the native <details> default cannot drift apart. */
  defaultOpen?: boolean;
}

/** A panel: one tab, one colour code, one or more groups. */
export interface UiPanel {
  id: string;
  label: string;
  hint: string;
  colour: ColourCode;
  groups: UiGroup[];
}

/** A screen: a set of panels. */
export interface UiScreen {
  id: ScreenId;
  label: string;
  hint: string;
  colour: ColourCode;
  panels: UiPanel[];
}

const c = (key: string, label: string, hint: string, when: When, owner: Owner, weight: Weight): UiControl =>
  ({ key, label, hint, when, owner, weight });

/**
 * The whole interface. Screens -> panels (tabs) -> groups -> controls.
 *
 * The creator is deliberately split into five panels rather than one long scroll: the
 * information stays visible (it is all one screen away) but each panel is short enough
 * to read at a glance, which is the "everything visible, reached through panels" brief.
 */
export const UI_TREE: UiScreen[] = [
  {
    id: "title",
    label: "Title",
    hint: "The entry screen: pick a saved fighter or start a new one.",
    colour: "ink",
    panels: [
      {
        id: "start",
        label: "Start",
        hint: "What you can do from here.",
        colour: "sand",
        groups: [
          {
            id: "profiles",
            label: "Saved fighters",
            // Wave R: this group no longer holds a button — its ≡ Profiles button merged with the ⚔
            // Fight button into ONE entry (the modes group below). It now holds only the picker: a
            // saved fighter loads into the generator, which shares a page with the roster.
            hint: "Saved fighters that load into the generator (the roster shares its page).",
            // Wave O: an ENTRY path (it opens the Profiles panel), so like the modes group it starts
            // open — a closed tree must never hide the way into the game or into your own saved fighters.
            defaultOpen: true,
            controls: [
              c("profile-picker", "Fighter", "Load a saved character into the creator.", "always", "player", 2),
            ],
          },
          {
            id: "modes",
            label: "Modes",
            hint: "The one entry to the fighters generator and the roster, plus the other ways in.",
            defaultOpen: true,
            controls: [
              // Wave R: the ≡ Profiles button and the ⚔ Fight button are ONE entry now. It opens the
              // roster AND the generator, which are the same screen, and stays a keyboard- and
              // screen-reader-reachable button in this group (the fight path into the ring).
              c("btn-enter", "Fighters", "Opens the roster and the generator on one page — roll, override or save.", "always", "player", 2),
              c("btn-spectate", "Spectate", "AI against AI, with a speed control.", "always", "system", 2),
              c("btn-train", "Auto-train", "Run matches headless and fast to gather data.", "always", "system", 1),
              c("btn-history", "History", "Past matches, with filters.", "always", "system", 1),
              c("btn-settings", "Settings", "Audio, motion and layout options.", "always", "system", 1),
            ],
          },
        ],
      },
    ],
  },
  {
    id: "select",
    label: "Create",
    hint: "Build the fighter: ancestry, calling, skills, star sign, arena.",
    colour: "coral",
    panels: [
      {
        id: "ancestry",
        label: "Ancestry",
        hint: "Race and sub-species. Drives the body, the hair, the beard, the tusks.",
        colour: "grass",
        groups: [
          { id: "race", label: "Race", hint: "The four peoples.", controls: [c("race-table", "Race", "Pick the people; the hero panel previews it.", "always", "player", 2)] },
          { id: "subrace", label: "Sub-species", hint: "A nation within the people.", controls: [c("subrace-table", "Sub-species", "Nested under the chosen race.", "always", "player", 1)] },
          { id: "hero", label: "Hero preview", hint: "Primary and secondary stats for the pick.", controls: [c("race-hero", "Preview", "Primary left, secondary right.", "always", "player", 2)] },
          { id: "lore", label: "Ancestry lore", hint: "What the hierarchy says about the pick: skin, hair, beard, tusks, ranks.", controls: [
            c("ancestry-lore", "Lore", "The race and sub-species name with its one-line lore.", "always", "player", 1),
            c("ancestry-skin", "Skin", "Skin tone swatches and the crease colour.", "always", "player", 1),
            c("ancestry-hair", "Hair", "Hair colours drawn from the ancestry.", "always", "player", 1),
            c("ancestry-beard", "Beard", "How much growth the ancestry allows or requires.", "always", "player", 0),
            c("ancestry-tusk", "Tusks", "Tusk count and direction for the ancestry.", "always", "player", 0),
            c("ancestry-ranks", "Ranks", "This ancestry's metric ranks against the other races.", "always", "player", 1),
          ] },
        ],
      },
      {
        id: "calling",
        label: "Calling",
        hint: "Class, weapon and the three techniques it brings.",
        colour: "sand",
        groups: [
          { id: "class", label: "Class", hint: "The eight callings.", controls: [c("class-table", "Class", "Each row shows its three techniques.", "always", "player", 2)] },
          { id: "weapon", label: "Weapon", hint: "Generated from the class, or chosen.", controls: [c("weapon-table", "Weapon", "Shaft, blade, curve, weight, metal.", "always", "player", 1)] },
          { id: "skills", label: "Techniques", hint: "Dash, power and defence.", controls: [c("skill-cards", "Techniques", "The three moves this calling brings.", "always", "player", 2)] },
        ],
      },
      {
        id: "sign",
        label: "Star sign",
        hint: "The birthsign, and the secondary stats it stacks.",
        colour: "violet",
        groups: [
          { id: "birthsign", label: "Birthsign", hint: "Stacks additively on the sub-species.", controls: [c("birthsign-table", "Birthsign", "Pick one of the twelve.", "always", "player", 1)] },
          { id: "secondary", label: "Secondary stats", hint: "Crit, haste, mastery, resistances, versatility.", controls: [c("secondary-rows", "Deltas", "Green up, coral down.", "always", "player", 1)] },
        ],
      },
      {
        id: "opponent",
        label: "Opponent",
        hint: "Who you fight, and the terms of the match.",
        colour: "ocean",
        groups: [
          { id: "rival", label: "Rival", hint: "The AI you face.", controls: [c("menu-opponent", "Rival", "Pick the opponent's calling.", "always", "opponent", 1)] },
          { id: "terms", label: "Match terms", hint: "Length and win condition.", controls: [c("match-length", "Length", "Shorter matches gather data faster.", "always", "system", 1), c("win-condition", "Win condition", "One condition is rolled per match.", "always", "system", 0)] },
          { id: "spectate", label: "Spectator card", hint: "The generated AI-vs-AI card, when the engine hands one over.", controls: [
            c("spectate-card", "Card", "The spectator card: levels, budgets, techniques and arena.", "spectate", "system", 1),
            c("spectate-level-a", "Level A", "Fighter A's generated level.", "spectate", "system", 0),
            c("spectate-level-b", "Level B", "Fighter B's generated level.", "spectate", "system", 0),
            c("spectate-budget-a", "Budget A", "Stat points spent on fighter A.", "spectate", "system", 0),
            c("spectate-budget-b", "Budget B", "Stat points spent on fighter B.", "spectate", "system", 0),
            c("spectate-techniques", "Techniques", "The technique ids the spent stats unlocked.", "spectate", "system", 0),
            c("spectate-arena", "Arena", "The generated arena's size in metres.", "spectate", "system", 0),
          ] },
          { id: "inspect", label: "Inspect overlay", hint: "The free spectator cursor and the floating cards a click opens.", controls: [
            c("inspect-cursor", "Cursor", "The custom reticle and its soft trailing blob.", "spectate", "system", 1),
            c("inspect-fighter-card", "Fighter card", "Click a fighter for a stat sheet floating beside them.", "spectate", "system", 1),
            c("inspect-fighter-rows", "Stat rows", "Primaries, derived combat numbers and fight telemetry.", "spectate", "both", 1),
            c("inspect-fighter-bars", "Resource bars", "Health, mana and stamina as value / max.", "spectate", "both", 1),
            c("inspect-card-badges", "Badges", "The generation id and the AI / PLAYER controller tag.", "spectate", "system", 0),
            c("inspect-object-card", "Object card", "Click a prop or boon to see what it is.", "spectate", "system", 1),
            c("inspect-object-effect", "Object effect", "What the boon does, or what the prop is for.", "spectate", "system", 0),
          ] },
        ],
      },
      {
        id: "arena",
        label: "Arena",
        hint: "Shape, walls, props and pickups.",
        colour: "positive",
        groups: [
          { id: "field", label: "Field", hint: "Shape and size of the ring.", controls: [c("arena-shape", "Shape", "Circle, polygon, oval, diamond.", "always", "system", 1), c("arena-size", "Size", "Metres across.", "always", "system", 1)] },
          { id: "walls", label: "Walls", hint: "A wall on 90% of arenas, with its own resistance.", controls: [c("arena-walls", "Walls", "On, off, or generated.", "always", "system", 1), c("wall-resistance", "Resistance", "How much impulse a wall absorbs.", "always", "system", 0)] },
          { id: "pickups", label: "Pickups", hint: "Coins and power-ups that spawn in the field.", controls: [c("pickup-rate", "Spawn rate", "How often a pickup appears.", "always", "system", 0), c("pickup-kinds", "Kinds", "Which buffs can spawn.", "always", "system", 0)] },
        ],
      },
    ],
  },
  {
    id: "sheet",
    label: "Sheet",
    hint: "The fighter's full stat sheet.",
    colour: "ocean",
    panels: [
      {
        id: "stats",
        label: "Stats",
        hint: "Primary and derived combat stats.",
        colour: "sand",
        groups: [
          { id: "primary", label: "Primary", hint: "The six attributes.", controls: [c("sheet-primary", "Primary", "Vitality, resilience, willpower, reflex, strength, intelligence.", "always", "both", 2)] },
          { id: "derived", label: "Derived", hint: "Health, power, interval, armour.", controls: [c("sheet-derived", "Derived", "Read-only: computed from the primaries.", "always", "both", 2)] },
        ],
      },
      {
        id: "resources",
        label: "Resources",
        hint: "Health, mana and stamina — the three pools.",
        colour: "grass",
        groups: [
          { id: "pools", label: "Pools", hint: "Maxima and regeneration.", controls: [c("sheet-pools", "Pools", "Health, mana, stamina and their regen.", "fight", "both", 1)] },
          { id: "costs", label: "Power costs", hint: "What each technique spends.", controls: [c("sheet-costs", "Costs", "Mana for arcane, stamina for martial.", "fight", "both", 1)] },
        ],
      },
    ],
  },
  {
    id: "digest",
    label: "History",
    hint: "Past matches, the leaderboard, and the training runs.",
    colour: "violet",
    panels: [
      {
        id: "filters",
        label: "Filters",
        hint: "Narrow the list before you read it.",
        colour: "sand",
        groups: [
          { id: "who", label: "Fighter", hint: "By name or id.", controls: [c("filter-name", "Name", "Substring match on either fighter.", "always", "system", 2)] },
          { id: "what", label: "Outcome", hint: "Who won, and how.", controls: [c("filter-outcome", "Outcome", "Win, loss or draw.", "always", "system", 1), c("filter-reason", "Ending", "KO, endurance, domination, sudden death.", "always", "system", 1)] },
          { id: "who2", label: "Ancestry", hint: "Race and calling.", controls: [c("filter-race", "Race", "Either fighter's race.", "always", "system", 1), c("filter-class", "Class", "Either fighter's calling.", "always", "system", 1)] },
          { id: "sort", label: "Order", hint: "How the rows are arranged.", controls: [c("filter-sort", "Sort", "Newest, fastest, biggest stat gap, widest margin, generation.", "always", "system", 0)] },
        ],
      },
      {
        id: "records",
        label: "Records",
        hint: "The match list and its summary.",
        colour: "ocean",
        groups: [
          { id: "summary", label: "Summary", hint: "Totals across the filtered set.", controls: [c("history-summary", "Summary", "Matches, win rate, average length.", "always", "system", 2)] },
          { id: "highlights", label: "Highlights", hint: "The standout matches at a glance.", controls: [c("history-highlights", "Highlights", "Fastest decided match, widest stat gap, ties and timeouts.", "always", "system", 1)] },
          { id: "list", label: "Matches", hint: "One row per fight.", controls: [c("history-list", "Matches", "Click a row for the full detail.", "always", "system", 2), c("history-badge", "Row badges", "TIE, TIMEOUT, generation id, stat gap and margin, shown when the record carries them.", "always", "system", 1)] },
        ],
      },
      {
        id: "ladder",
        label: "Ladder",
        hint: "Elo MMR, with a king at rank one.",
        colour: "coral",
        groups: [
          { id: "rank", label: "Ranking", hint: "Every AI profile, ranked.", controls: [c("leader-table", "Ladder", "Click a row for that AI's card.", "always", "system", 1)] },
          { id: "card", label: "AI card", hint: "One AI's record and style.", controls: [c("ai-card", "Card", "Rank, MMR, peak, W-L, archetype, style.", "always", "system", 0)] },
        ],
      },
    ],
  },
  {
    id: "victory",
    label: "Result",
    hint: "How the last match ended.",
    colour: "positive",
    panels: [
      {
        id: "outcome",
        label: "Outcome",
        hint: "The winner and the reason.",
        colour: "positive",
        groups: [
          { id: "verdict", label: "Verdict", hint: "Who won, and by what condition.", controls: [c("victory-title", "Verdict", "The rolled win condition that fired.", "always", "system", 2)] },
          { id: "again", label: "Next", hint: "Rematch or return.", controls: [c("btn-rematch", "Rematch", "Same fighters, new arena.", "always", "system", 2), c("btn-menu", "Menu", "Back to the title.", "always", "system", 2)] },
        ],
      },
    ],
  },
];

/** One resolved node path, for the renderer and for QA. */
export interface UiNode {
  path: string;
  screen: ScreenId;
  panel: string;
  group: string;
  control: UiControl;
  colour: ColourCode;
}

/** Flatten the tree into every control with its full path. */
export function flattenTree(): UiNode[] {
  const out: UiNode[] = [];
  for (const s of UI_TREE) {
    for (const p of s.panels) {
      for (const g of p.groups) {
        for (const ctl of g.controls) {
          out.push({ path: `${s.id}/${p.id}/${g.id}/${ctl.key}`, screen: s.id, panel: p.id, group: g.id, control: ctl, colour: p.colour });
        }
      }
    }
  }
  return out;
}

/** Every control key in the tree. Used to check the markup against the model. */
export function allKeys(): string[] {
  return flattenTree().map((n) => n.control.key);
}

/** The controls of one screen, optionally filtered by importance. */
export function screenControls(screen: ScreenId, maxWeight: Weight = 2): UiControl[] {
  return flattenTree()
    .filter((n) => n.screen === screen && n.control.weight <= maxWeight)
    .map((n) => n.control);
}

/** The panels of one screen, in order. */
export function screenPanels(screen: ScreenId): UiPanel[] {
  return (UI_TREE.find((s) => s.id === screen)?.panels ?? []);
}

/** Count the nodes in the tree: screens, panels, groups, controls. */
export function treeSize(): { screens: number; panels: number; groups: number; controls: number } {
  let panels = 0, groups = 0, controls = 0;
  for (const s of UI_TREE) {
    panels += s.panels.length;
    for (const p of s.panels) {
      groups += p.groups.length;
      for (const g of p.groups) controls += g.controls.length;
    }
  }
  return { screens: UI_TREE.length, panels, groups, controls };
}

/**
 * The `screen/panel/group` keys of every group the tree marks `defaultOpen`.
 *
 * Exactly ONE group is open on a first visit — `title/start/modes` — because the entry
 * paths (Fight / Spectate / …) must never hide behind a closed tree; every other option
 * group starts closed. The key string is built here, with the same `${screen}/${panel}/${group}`
 * shape `Disclosure.groupKey` produces, so the tree stays the single source of the marked set.
 */
export function defaultOpenGroups(): string[] {
  const out: string[] = [];
  for (const s of UI_TREE) {
    for (const p of s.panels) {
      for (const g of p.groups) {
        if (g.defaultOpen) out.push(`${s.id}/${p.id}/${g.id}`);
      }
    }
  }
  return out;
}
