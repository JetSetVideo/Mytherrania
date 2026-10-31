// Disclosure: which option groups are OPEN, as DATA (pure).
//
// The interface is a tree of screens -> panels -> groups -> controls (UiTree.ts). Every
// group renders as a CLOSED <details> tree by default; this module is the one place that
// says, for each group key, whether it is open — and it is the model, not the DOM.
//
// Keeping this pure has two payoffs the tests lean on:
//   * the "closed by default" promise is provable without a browser (the renderer lane
//     owns the markup, and a policy-blocked panel is invisible to unit tests anyway), and
//   * the persistence format is just data: `encodeDisclosure`/`decodeDisclosure` deal in
//     strings, and the caller owns the ONE window/localStorage call, per the house rule
//     that the pure module never touches a browser global.
//
// No DOM, no THREE, no Math.random.

import { UI_TREE, type UiScreen } from "./UiTree.ts";

/** Which option groups are open: group key -> open. Read-only so a caller cannot mutate it in place. */
export type DisclosureState = Readonly<Record<string, boolean>>;

/**
 * The localStorage key the open/closed state round-trips through. It lives here, as data,
 * so the renderer never keeps a second copy of the string; the renderer owns the actual
 * `window.localStorage` call.
 */
export const DISCLOSURE_STORAGE_KEY = "mytherrania-ui-open";

/** The stable key for one group: "select/ancestry/race" (screen/panel/group). */
export function groupKey(screen: string, panel: string, group: string): string {
  return `${screen}/${panel}/${group}`;
}

/** Every group's key, walking the tree in DOM order, so a state carries one entry per group. */
function allGroupKeys(tree: UiScreen[]): string[] {
  const keys: string[] = [];
  for (const s of tree) {
    for (const p of s.panels) {
      for (const g of p.groups) keys.push(groupKey(s.id, p.id, g.id));
    }
  }
  return keys;
}

/**
 * The state a first visit starts from: every group CLOSED, except the ones the tree marks
 * `defaultOpen` (exactly one today — the title screen's modes, the entry paths). `tree`
 * defaults to the real `UI_TREE` so a caller can ignore the argument, and is injectable so
 * tests can pin the shape without the production tree.
 */
export function initialDisclosure(tree: UiScreen[] = UI_TREE): DisclosureState {
  // Mark the open set by walking the tree we were given — `defaultOpenGroups` reads the
  // global UI_TREE, so it would ignore an injected tree and mark the wrong groups open.
  const openSet = new Set<string>();
  for (const s of tree) {
    for (const p of s.panels) {
      for (const g of p.groups) if (g.defaultOpen) openSet.add(groupKey(s.id, p.id, g.id));
    }
  }
  const state: Record<string, boolean> = {};
  for (const key of allGroupKeys(tree)) state[key] = openSet.has(key);
  return state;
}

/** Is this group open? Absent or non-true reads as closed — closed is the safe default. */
export function isOpen(state: DisclosureState, key: string): boolean {
  return state[key] === true;
}

/** Flip one group. A key not in the state (e.g. a fresh group) opens on the first toggle. */
export function toggleGroup(state: DisclosureState, key: string): DisclosureState {
  return { ...state, [key]: !isOpen(state, key) };
}

/** Force one group open (or closed, with `open = false`). */
export function openGroup(state: DisclosureState, key: string, open = true): DisclosureState {
  return { ...state, [key]: open };
}

/** The keys currently open, sorted, so the list is stable for a caller that diffs it. */
export function openKeys(state: DisclosureState): string[] {
  return Object.keys(state).filter((k) => state[k] === true).sort();
}

/**
 * Serialise the state for localStorage. Keys are sorted so two equal states encode to the
 * same string — an equality the tests assert and that keeps a future diff noise-free.
 */
export function encodeDisclosure(state: DisclosureState): string {
  const ordered: Record<string, boolean> = {};
  for (const key of Object.keys(state).sort()) ordered[key] = state[key] === true;
  return JSON.stringify(ordered);
}

/**
 * Parse a stored payload back into a state. A `null`/absent payload, malformed JSON, a
 * non-object, or a non-boolean value all resolve to the initial state — decoding NEVER
 * throws, because a corrupt localStorage entry must not be able to blank the options.
 * Unknown keys from an older tree are dropped; the result always covers the current tree.
 */
export function decodeDisclosure(raw: string | null, tree: UiScreen[] = UI_TREE): DisclosureState {
  const initial = initialDisclosure(tree);
  if (raw === null) return initial;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return initial;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return initial;

  const stored = parsed as Record<string, unknown>;
  const state: Record<string, boolean> = {};
  // Start from the initial state so every current-tree key has a value, then overlay only
  // the stored entries whose key still exists AND whose value is a real boolean.
  for (const key of Object.keys(initial)) {
    const value = stored[key];
    state[key] = typeof value === "boolean" ? value : initial[key];
  }
  return state;
}
