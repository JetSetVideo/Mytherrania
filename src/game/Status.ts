// Status effects: the conditions a fighter can be under, how long they last, what
// they take away, and what can clear them. Pure module, unit-testable.
//
// The brief asks for stun, hypnosis and being controlled by another fighter, and
// for spells that can change those. Each status therefore carries: a duration, a
// set of control flags, and the spell "schools" that dispel it.

export type StatusName = "stunned" | "hypnotised" | "controlled" | "burning" | "poisoned" | "chilled" | "blessed" | "hasted" | "slowed";

export interface StatusDef {
  name: StatusName;
  /** Can the victim act at all? */
  disables: boolean;
  /** Who steers them: "self" normally, "caster" when controlled. */
  control: "self" | "caster";
  /** Movement multiplier while active. */
  speedMul: number;
  /** Attack-rate multiplier while active. */
  attackMul: number;
  /** Damage per second, positive or negative (blessed heals). */
  dps: number;
  /** Default duration in seconds. */
  duration: number;
  /** Spell schools that remove it. */
  clearedBy: string[];
  /** True when the effect is beneficial. */
  good: boolean;
}

export const STATUS_DEFS: Record<StatusName, StatusDef> = {
  stunned:     { name: "stunned",     disables: true,  control: "self",   speedMul: 0,    attackMul: 0,    dps: 0,  duration: 1.5, clearedBy: ["holy", "arcane"],            good: false },
  hypnotised:  { name: "hypnotised",  disables: true,  control: "self",   speedMul: 0,    attackMul: 0,    dps: 0,  duration: 3.0, clearedBy: ["holy", "arcane"],            good: false },
  controlled:  { name: "controlled",  disables: false, control: "caster", speedMul: 1,    attackMul: 1,    dps: 0,  duration: 4.0, clearedBy: ["holy", "arcane", "necrotic"], good: false },
  burning:     { name: "burning",     disables: false, control: "self",   speedMul: 0.9,  attackMul: 1,    dps: 6,  duration: 4.0, clearedBy: ["holy", "wind"],              good: false },
  poisoned:    { name: "poisoned",    disables: false, control: "self",   speedMul: 0.85, attackMul: 0.9,  dps: 4,  duration: 6.0, clearedBy: ["holy"],                      good: false },
  chilled:     { name: "chilled",     disables: false, control: "self",   speedMul: 0.6,  attackMul: 0.75, dps: 1,  duration: 3.0, clearedBy: ["fire"],                      good: false },
  blessed:     { name: "blessed",     disables: false, control: "self",   speedMul: 1.1,  attackMul: 1.1,  dps: -5, duration: 8.0, clearedBy: [],                            good: true },
  hasted:      { name: "hasted",      disables: false, control: "self",   speedMul: 1.4,  attackMul: 1.3,  dps: 0,  duration: 5.0, clearedBy: [],                            good: true },
  slowed:      { name: "slowed",      disables: false, control: "self",   speedMul: 0.55, attackMul: 0.8,  dps: 0,  duration: 4.0, clearedBy: ["holy", "arcane"],            good: false },
};

export interface ActiveStatus {
  name: StatusName;
  remaining: number;
  /** Who applied it, for the controlled status. */
  source: number | null;
}

export interface StatusState {
  active: ActiveStatus[];
}

export function createStatusState(): StatusState {
  return { active: [] };
}

/** Apply a status, refreshing the timer if it is already present. */
export function applyStatus(st: StatusState, name: StatusName, duration?: number, source: number | null = null): void {
  const def = STATUS_DEFS[name];
  const d = duration ?? def.duration;
  const existing = st.active.find((a) => a.name === name);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, d);
    if (source !== null) existing.source = source;
    return;
  }
  st.active.push({ name, remaining: d, source });
}

/** Advance timers and return the total damage dealt this tick. */
export function tickStatuses(st: StatusState, dt: number): number {
  let dmg = 0;
  for (const a of st.active) {
    dmg += STATUS_DEFS[a.name].dps * dt;
    a.remaining -= dt;
  }
  st.active = st.active.filter((a) => a.remaining > 0);
  return dmg;
}

/** Clear everything a given spell school can dispel. Returns what was cleared. */
export function cleanse(st: StatusState, school: string): StatusName[] {
  const cleared: StatusName[] = [];
  st.active = st.active.filter((a) => {
    if (STATUS_DEFS[a.name].clearedBy.includes(school)) { cleared.push(a.name); return false; }
    return true;
  });
  return cleared;
}

export function hasStatus(st: StatusState, name: StatusName): boolean {
  return st.active.some((a) => a.name === name);
}

/** Can the fighter act? Blocked by anything that disables. */
export function canAct(st: StatusState): boolean {
  return !st.active.some((a) => STATUS_DEFS[a.name].disables);
}

/** Who is steering the fighter: itself, or the caster of a control effect. */
export function controller(st: StatusState): { by: "self" } | { by: "caster"; source: number | null } {
  const c = st.active.find((a) => STATUS_DEFS[a.name].control === "caster");
  return c ? { by: "caster", source: c.source } : { by: "self" };
}

export function speedMultiplier(st: StatusState): number {
  return st.active.reduce((m, a) => m * STATUS_DEFS[a.name].speedMul, 1);
}

export function attackMultiplier(st: StatusState): number {
  return st.active.reduce((m, a) => m * STATUS_DEFS[a.name].attackMul, 1);
}

/** A short label for the HUD, e.g. "stunned 0.8s". */
export function statusLabel(st: StatusState): string {
  return st.active.map((a) => `${a.name} ${a.remaining.toFixed(1)}s`).join(", ");
}

/**
 * Which status a skill of each element inflicts (on the target) or grants (to the
 * caster). `clearedBy` lists use the same element names, so the vocabulary is one set.
 *
 *   power skill → full duration · dash → half · defense → the self-buff only
 */
export interface ElementStatus { target: "enemy" | "self"; status: StatusName; duration: number }
export const ELEMENT_STATUS: Record<string, ElementStatus> = {
  fire:     { target: "enemy", status: "burning",    duration: 3.0 },
  poison:   { target: "enemy", status: "poisoned",   duration: 4.0 },
  shadow:   { target: "enemy", status: "hypnotised", duration: 1.6 },
  necrotic: { target: "enemy", status: "controlled", duration: 2.0 },
  arcane:   { target: "enemy", status: "slowed",     duration: 2.5 },
  fury:     { target: "enemy", status: "chilled",    duration: 1.5 },
  wind:     { target: "self",  status: "hasted",     duration: 3.0 },
  holy:     { target: "self",  status: "blessed",    duration: 4.0 },
};

export function statusForSkill(element: string, kind: "dash" | "power" | "defense"): ElementStatus | null {
  const e = ELEMENT_STATUS[element];
  if (!e) return null;
  if (kind === "defense") return e.target === "self" ? e : null;
  return { ...e, duration: kind === "dash" ? e.duration / 2 : e.duration };
}
