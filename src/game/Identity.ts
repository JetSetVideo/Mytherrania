// Fighter identity: a unique id and a generated name.
//
// Every combatant — player or bot — gets an id that is unique for the session and
// a name drawn from a deterministic generator, so a match log can name who fought
// whom and a replay can rebuild the same roster from a seed.
//
// Pure module: no Three.js, no DOM.

export interface Identity {
  /** Unique, stable for the session, e.g. "MY-7F3A21". */
  id: string;
  /** Given name, e.g. "Aldric". */
  name: string;
  /** Epithet, e.g. "the Unbroken". */
  title: string;
  /** Full display name, e.g. "Aldric the Unbroken". */
  full: string;
  /** Short tag for a crowded HUD, e.g. "Aldric U." */
  tag: string;
}

const FIRST = [
  "Aldric", "Vail", "Morwen", "Kael", "Bryn", "Sorin", "Yrsa", "Dorn", "Eira", "Fen",
  "Halric", "Ivar", "Jorunn", "Kestrel", "Lyra", "Marek", "Nessa", "Orin", "Pell", "Quill",
  "Rhea", "Sten", "Tova", "Ulric", "Vesna", "Wren", "Xan", "Yorick", "Zel", "Ash",
];
const TITLES = [
  "the Unbroken", "the Quiet", "of the Grey Fen", "the Lantern", "Twice-Buried",
  "the Patient", "of Low Water", "the Kind", "the Ninth", "Emberhand",
  "the Long Watch", "of Sunspire", "the Forge-Sworn", "the Unseen", "Half-Hand",
  "the Storm-Bound", "of the Salt Road", "the Remembered", "the Late", "Ironjaw",
];

/** Deterministic 32-bit hash, so a name is reproducible from a seed. */
function hash32(n: number): number {
  let x = n >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hex6(n: number): string {
  return n.toString(16).toUpperCase().padStart(6, "0").slice(-6);
}

/**
 * Build an identity from a seed. Two different seeds give two different names and
 * ids; the same seed always gives the same one.
 */
export function makeIdentity(seed: number, prefix = "MY"): Identity {
  const h = hash32(seed);
  const name = FIRST[h % FIRST.length];
  const title = TITLES[(h >>> 8) % TITLES.length];
  return {
    id: `${prefix}-${hex6(h)}`,
    name,
    title,
    full: `${name} ${title}`,
    tag: `${name} ${title.split(" ")[0][0].toUpperCase()}.`,
  };
}

/**
 * A roster of `count` identities with no duplicate ids or full names. Seeds are
 * walked forward until a fresh combination is found, so a 8-fighter brawl never
 * has two "Kael the Quiet".
 */
export function makeRoster(count: number, baseSeed = 1, prefix = "MY"): Identity[] {
  const out: Identity[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  let seed = baseSeed;
  let guard = 0;
  while (out.length < count && guard < count * 500) {
    const id = makeIdentity(seed, prefix);
    if (!seenIds.has(id.id) && !seenNames.has(id.full)) {
      seenIds.add(id.id);
      seenNames.add(id.full);
      out.push(id);
    }
    seed += 1;
    guard += 1;
  }
  return out;
}
