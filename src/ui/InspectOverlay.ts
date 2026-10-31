// Inspect overlay: the pure logic behind the spectator-mode cursor, the floating fighter stat
// sheet and the object card (Wave I, lane I-B).
//
// WHY this file exists: in spectator mode the mouse is FREE (no pointer lock), so the user can
// hover and click. The engine does the raycast/pick and the DOM wiring; everything in here is
// pure and unit-tested so the geometry (anchor + pick) and the model (what the cards actually
// say) can be trusted without a browser. No Three.js, no DOM.
//
// It must read like a GAME UI, so the fighter card states what the fighter is and what it did,
// and an object card names the thing and says what it DOES — a boon's real effect comes from
// src/game/PowerUps.ts, never an invented one.

import { PICKUP_KINDS, type PickupDef } from "../game/PowerUps.ts";

/** What a click selected: one of the two seats, or a map object by id. */
export type InspectTarget = { kind: "fighter"; seat: 0 | 1 } | { kind: "object"; id: string };

/** One labelled line of a card. `tone` paints it (bad = below the fighter's own average). */
export interface InspectRow { label: string; value: string; tone?: "good" | "bad" | "muted" }
/** One resource bar: the value now and the most it can reach, in the given colour. */
export interface InspectBar { label: string; value: number; max: number; colour: string }
/** The whole card: a title, a subtitle, badges, text rows and bars. */
export interface InspectCard { title: string; subtitle: string; badges: string[]; rows: InspectRow[]; bars: InspectBar[] }

/** Everything the fighter card shows for one seat. */
export interface FighterView {
  seat: 0 | 1; name: string; ancestry: string; subrace: string | null; className: string; level: number;
  controller: string; weapon: string;
  stats: { vitality: number; resilience: number; willpower: number; reflex: number; strength: number; intelligence: number };
  combat: { maxHealth: number; attackPower: number; attackInterval: number; armor: number };
  hp: number; mana: number; manaMax: number; stamina: number; staminaMax: number;
  dealt: number; hits: number; techniques: string[]; generationId: string | null;
  telemetry: { travelledM: number; avgDistanceM: number; peak5sDamage: number };
}

/** Everything the object card shows for one prop or pickup. */
export interface ObjectView {
  id: string; kind: string; label: string; detail: string; x: number; z: number;
  radiusM: number; heightM: number; scale: number; boon: string | null;
}

/** The six primary attributes, in one stable order for the sheet. */
export const PRIMARY_ORDER = ["vitality", "resilience", "willpower", "reflex", "strength", "intelligence"] as const;
type PrimaryKey = typeof PRIMARY_ORDER[number];

const PRIMARY_LABEL: Record<PrimaryKey, string> = {
  vitality: "Vitality", resilience: "Resilience", willpower: "Willpower",
  reflex: "Reflex", strength: "Strength", intelligence: "Intelligence",
};

/** Bar colours, matching the HUD's life/mana/stamina tints. */
const BAR_COLOUR = { hp: "#d61f22", mana: "#1f55e0", stamina: "#22a338" } as const;

const num = (n: number): string => (Number.isFinite(n) ? String(Math.round(n)) : "—");
const num1 = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : "—");

/** "Human · Nomad · Warrior · Lv 3" — the sub-race left out when none was chosen. */
function identitySubtitle(v: FighterView): string {
  return [v.ancestry, v.subrace, v.className, `Lv ${Math.max(1, Math.round(v.level) || 1)}`]
    .filter(Boolean)
    .join(" · ");
}

/** "PLAYER" for a human-controlled seat, "AI" for a bot. */
function controllerBadge(controller: string): string {
  const c = controller.toLowerCase();
  return c.includes("player") || c.includes("human") ? "PLAYER" : "AI";
}

/** The fighter's card: identity, the six primaries (bad-toned below the average of the six), the
 *  four derived combat numbers, the fight telemetry, the techniques, and hp/mana/stamina bars. */
export function fighterCard(v: FighterView): InspectCard {
  const values = PRIMARY_ORDER.map((k) => v.stats[k]);
  const avg = values.reduce((a, b) => a + b, 0) / PRIMARY_ORDER.length;
  const statRows: InspectRow[] = PRIMARY_ORDER.map((k) => {
    const value = num(v.stats[k]);
    return v.stats[k] < avg ? { label: PRIMARY_LABEL[k], value, tone: "bad" } : { label: PRIMARY_LABEL[k], value };
  });
  const derived: InspectRow[] = [
    { label: "Max Health", value: num(v.combat.maxHealth) },
    { label: "Attack Power", value: num1(v.combat.attackPower) },
    { label: "Attack Interval", value: `${num1(v.combat.attackInterval)} s` },
    { label: "Armor", value: num(v.combat.armor) },
  ];
  const telemetry: InspectRow[] = [
    { label: "Damage Dealt", value: num(v.dealt) },
    { label: "Hits", value: num(v.hits) },
    { label: "Distance Travelled", value: `${num1(v.telemetry.travelledM)} m` },
    { label: "Avg Distance", value: `${num1(v.telemetry.avgDistanceM)} m` },
    { label: "Peak 5 s Damage", value: num(v.telemetry.peak5sDamage) },
  ];
  const techniques: InspectRow[] = v.weapon || v.techniques.length
    ? [{ label: "Weapon", value: v.weapon || "—" }].concat(
      v.techniques.length ? [{ label: "Techniques", value: v.techniques.join(", ") }] : [],
    )
    : [];
  // A generation id, when the view carries one, sits in front of the controller badge.
  const badges = v.generationId ? [v.generationId, controllerBadge(v.controller)] : [controllerBadge(v.controller)];
  const bars: InspectBar[] = [
    { label: "HP", value: v.hp, max: v.combat.maxHealth, colour: BAR_COLOUR.hp },
    { label: "MP", value: v.mana, max: v.manaMax, colour: BAR_COLOUR.mana },
    { label: "SP", value: v.stamina, max: v.staminaMax, colour: BAR_COLOUR.stamina },
  ];
  return {
    title: v.name,
    subtitle: identitySubtitle(v),
    badges,
    rows: [...statRows, ...derived, ...telemetry, ...techniques],
    bars,
  };
}

/** The REAL effect of each pickup, phrased in one line. Numbers come from the live table. */
const BOON_EFFECT: Record<string, (d: PickupDef) => string> = {
  health_orb: (d) => `Restores ${num(d.value)} health on pickup.`,
  mana_orb: (d) => `Restores ${num(d.value)} mana on pickup.`,
  stamina_draught: (d) => `Restores ${num(d.value)} stamina on pickup.`,
  rage: (d) => `Damage dealt ×${num1(d.value)} for ${num(d.duration)} s.`,
  swift: (d) => `Movement and attack speed ×${num1(d.value)} for ${num(d.duration)} s.`,
  ward: (d) => `Damage taken ×${num1(d.value)} for ${num(d.duration)} s.`,
  focus: (d) => `Technique power ×${num1(d.value)} for ${num(d.duration)} s.`,
  coin: (d) => `Adds ${num(d.value)} coin.`,
};

/** What a boon with this id actually does, read from the live pickup table (never invented). */
function boonLine(id: string): string {
  const def = PICKUP_KINDS.find((d) => d.id === id);
  if (!def) return `A boon (${id}) whose effect is not listed.`;
  return BOON_EFFECT[def.id]?.(def) ?? `A boon (${id}).`;
}

/** What a propless object is for, when the view carries no boon. */
const PROP_PURPOSE: Record<string, string> = {
  pillar: "Solid cover — blocks movement and breaks line of sight.",
  ramp: "A sloped ramp to change elevation.",
  platform: "A raised platform to stand on.",
  crate: "Solid cover — a crate to move around and hide behind.",
  rock: "Solid cover — a boulder in the field.",
  arch: "A gateway arch; decorative, but solid at its feet.",
  tree: "A tree — scenery and light cover.",
  gliderPad: "A launch pad — step on it to deploy a glider.",
};

/** What an object without a boon is for. */
function propLine(kind: string): string {
  return PROP_PURPOSE[kind] ?? "A solid object placed in the arena.";
}

/** The object card: names the kind and label, states its size and scale, and says what it does —
 *  a boon's real effect, or what the prop is for. */
export function objectCard(v: ObjectView): InspectCard {
  const rows: InspectRow[] = [
    { label: "Size", value: `${num1(v.radiusM)} m wide · ${num1(v.heightM)} m tall` },
    { label: "Scale", value: `${num1(v.scale)}×` },
  ];
  if (v.detail) rows.push({ label: "Detail", value: v.detail });
  const effect = v.boon ? boonLine(v.boon) : propLine(v.kind);
  rows.push({ label: v.boon ? "Effect" : "What it's for", value: effect });
  return {
    title: v.label,
    subtitle: v.kind,
    badges: v.boon ? [v.boon] : [],
    rows,
    bars: [],
  };
}

/** Clamp v into [lo, hi]; when the range is inverted (card bigger than the viewport) it collapses
 *  to lo, so the result stays finite and never NaN. */
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Anchor a card beside a screen point without ever leaving the viewport: try the right side, flip
 * to the left when the right would overflow, then clamp both axes. Vertically the card is centred
 * on the anchor and clamped when it would not fit. `gap` defaults to 18 px.
 */
export function anchorCard(
  anchor: { x: number; y: number },
  card: { w: number; h: number },
  viewport: { w: number; h: number },
  gap = 18,
): { left: number; top: number; side: "right" | "left" } {
  const side: "right" | "left" = anchor.x + gap + card.w > viewport.w ? "left" : "right";
  const rawLeft = side === "right" ? anchor.x + gap : anchor.x - gap - card.w;
  const left = clamp(rawLeft, 0, viewport.w - card.w);
  const top = clamp(anchor.y - card.h / 2, 0, viewport.h - card.h);
  return { left, top, side };
}

/**
 * The nearest candidate whose own radius contains the point, else null. When two overlap, the one
 * with the nearer centre wins.
 */
export function pickNearest(
  cands: readonly { id: string; x: number; y: number; r: number }[],
  p: { x: number; y: number },
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of cands) {
    const dist = Math.hypot(c.x - p.x, c.y - p.y);
    if (dist <= c.r && dist < bestDist) {
      best = c.id;
      bestDist = dist;
    }
  }
  return best;
}

/** The cursor: the reticle position, the trailing blob position, the down state, what is hovered. */
export interface CursorState { x: number; y: number; blobX: number; blobY: number; down: boolean; hoverId: string | null }

/** The blob's lag time constant (ms). Smaller = snappier trail. */
export const CURSOR_BLOB_LAG_MS = 120;

/**
 * Frame-rate independent ease of the blob toward the reticle. The exponential form makes the total
 * travel after t seconds a function of t alone, so one 0.1 s step equals ten 0.01 s steps; it also
 * stays finite for a huge dt (k saturates at 1). The reticle itself snaps to the target.
 */
export function stepCursor(s: CursorState, target: { x: number; y: number }, dt: number): CursorState {
  const tau = CURSOR_BLOB_LAG_MS / 1000;
  const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
  return {
    x: target.x,
    y: target.y,
    blobX: s.blobX + (target.x - s.blobX) * k,
    blobY: s.blobY + (target.y - s.blobY) * k,
    down: s.down,
    hoverId: s.hoverId,
  };
}

const BLOB_BASE = 14;
const BLOB_DOWN_GAIN = 6;
const BLOB_HOVER_GAIN = 4;

/** The blob's own visual size: grows while the pointer is down and while hovering a target. */
export function blobRadius(s: CursorState): number {
  return BLOB_BASE + (s.down ? BLOB_DOWN_GAIN : 0) + (s.hoverId !== null ? BLOB_HOVER_GAIN : 0);
}
