// Weapon integrity: is a generated weapon a whole, connected body?
//
// The owner's rule: "in valid state it's the opposite of broken as a whole body —
// il faut avoir le pommeau, the guard, and the blade connected to one another at
// the right points." A weapon is a chain: pommel → grip → guard → blade. Each part
// offers ONE socket — the connection point at its mating end — carrying a position,
// an outward normal and the section radius there. Two sockets may be JOINED only
// when they are neighbours in that chain, close enough, and of a compatible section.
//
// Everything else is the "cannot be passed through" case. A blade thrust through
// the guard's centre is not a joined weapon, it is a broken one: the guard has no
// socket facing the blade's tip, and routing the blade past its neighbour produces
// the interpenetration a broken mesh shows. So a pair that is not adjacent in the
// chain is FORBIDDEN, and the model says so rather than quietly averaging two rims
// that were never meant to meet.
//
// Pure module: no Three.js, no DOM. Positions are plain {x,y,z} in metres, exactly
// like PalmWeapon. This reuses Stitch's decision shape (pair only when close enough,
// refuse rather than force) but stays off the mesh so it can run before any geometry
// exists. The engine's first call is `integrity` — see the note at the foot of the
// file for where it belongs in graphics/WeaponMesh.ts.

export type Vec3 = { x: number; y: number; z: number };

/** The four parts of a bladed weapon, hilt → tip. */
export type WeaponPartId = "pommel" | "grip" | "guard" | "blade";

/** The connection point a part offers: where it meets its neighbour, and how wide. */
export type PartSocket = {
  part: WeaponPartId;
  /** The mating point, in the weapon's local frame. */
  position: Vec3;
  /** The outward face at that point (the direction the part offers to the neighbour). */
  normal: Vec3;
  /** The section radius at the socket, so two sockets only mate if their radii fit. */
  radius: number;
};

/** The verdict on one candidate joint between two sockets. */
export type Connection = {
  a: WeaponPartId;
  b: WeaponPartId;
  aSocket: PartSocket;
  bSocket: PartSocket;
  /** Distance between the two mating points, metres (Infinity if either socket is invalid). */
  gap: number;
  /** Relative radius difference |ra-rb| / max(ra,rb), 0 = identical sections. */
  radiusDelta: number;
  legal: boolean;
  reason: string;
};

/** The legal adjacency of a bladed weapon: each part joins only its chain neighbours. */
export const WEAPON_CHAIN: [WeaponPartId, WeaponPartId][] = [
  ["pommel", "grip"],
  ["grip", "guard"],
  ["guard", "blade"],
];

/** Every part the chain expects, so a missing one can be named. */
const ALL_PARTS: WeaponPartId[] = ["pommel", "grip", "guard", "blade"];

const DEFAULT_MAX_GAP = 0.02;
const DEFAULT_MAX_RADIUS_DELTA = 0.35;

/** Order-independent key for an unordered part pair, so adjacency is a set lookup. */
const pairKey = (x: WeaponPartId, y: WeaponPartId): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** The adjacency table, built once from the chain — no branching on part names. */
const ADJACENT: ReadonlySet<string> = new Set(WEAPON_CHAIN.map(([x, y]) => pairKey(x, y)));

/** True only when the two parts are a legal chain adjacency (never a part with itself). */
function isAdjacent(x: WeaponPartId, y: WeaponPartId): boolean {
  return x !== y && ADJACENT.has(pairKey(x, y));
}

const finiteVec = (v: Vec3): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** A socket can only mate if it carries a finite position and a positive finite radius. */
const finiteSocket = (s: PartSocket): boolean =>
  finiteVec(s.position) && Number.isFinite(s.radius) && s.radius > 0;

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Relative radius difference; the larger radius normalises, so 0 means a perfect fit. */
const relDelta = (ra: number, rb: number): number => Math.abs(ra - rb) / Math.max(ra, rb);

/**
 * The forbidden pairs: every non-adjacent pair of parts. State why each is barred.
 *
 * - pommel ↔ guard: the guard sits past the grip; reaching it from the pommel means
 *   routing the pommel through the grip, so the grip is passed through, not joined.
 * - pommel ↔ blade: the two chain ends; a blade run from the pommel skips grip AND
 *   guard — the whole hilt is passed through, which is a broken weapon.
 * - grip ↔ blade: the blade mounts at the guard, not the grip; a blade through the
 *   grip's centre interpenetrates the hilt and reads as broken, not joined.
 *
 * A generator that tries any of these is building an interpenetration, so it must be
 * rejected (see `canPass`) rather than welded.
 */
export const CANNOT_PASS_THROUGH: [WeaponPartId, WeaponPartId][] = [
  ["pommel", "guard"],
  ["pommel", "blade"],
  ["grip", "blade"],
];

/**
 * Decide whether two sockets may be joined. Refusal is the default: the pair must be
 * a legal adjacency, the mating points within `maxGap`, and the sections within
 * `maxRadiusDelta`. Every refusal carries a human-readable reason. Non-finite
 * positions or radii are refused BEFORE any arithmetic, so a NaN can never leak into
 * `gap` or `radiusDelta`.
 */
export function connectionBetween(
  a: PartSocket,
  b: PartSocket,
  maxGap = DEFAULT_MAX_GAP,
  maxRadiusDelta = DEFAULT_MAX_RADIUS_DELTA,
): Connection {
  const base = { a: a.part, b: b.part, aSocket: a, bSocket: b };

  // Guard 1 — an invalid socket offers nothing to mate with. Refuse here, so `gap`
  // and `radiusDelta` stay non-NaN (Infinity marks "unbounded", as Stitch does).
  if (!finiteSocket(a) || !finiteSocket(b)) {
    return {
      ...base,
      gap: Infinity,
      radiusDelta: Infinity,
      legal: false,
      reason: "socket has a non-finite position or a non-positive radius — nothing to mate",
    };
  }

  const gap = dist(a.position, b.position);
  const radiusDelta = relDelta(a.radius, b.radius);

  // Guard 2 — only chain neighbours may join; anything else is "cannot be passed through".
  if (!isAdjacent(a.part, b.part)) {
    return {
      ...base,
      gap,
      radiusDelta,
      legal: false,
      reason: a.part === b.part
        ? `a ${a.part} cannot be joined to itself`
        : `${a.part} and ${b.part} are not adjacent in WEAPON_CHAIN (cannot be passed through)`,
    };
  }

  // Guard 3 — the mating points must actually touch.
  if (gap > maxGap) {
    return {
      ...base,
      gap,
      radiusDelta,
      legal: false,
      reason: `gap ${gap.toFixed(4)} m exceeds maxGap ${maxGap} m`,
    };
  }

  // Guard 4 — the sections must fit together.
  if (radiusDelta > maxRadiusDelta) {
    return {
      ...base,
      gap,
      radiusDelta,
      legal: false,
      reason: `radius delta ${radiusDelta.toFixed(3)} exceeds maxRadiusDelta ${maxRadiusDelta}`,
    };
  }

  return {
    ...base,
    gap,
    radiusDelta,
    legal: true,
    reason: `adjacent, gap ${gap.toFixed(4)} m <= ${maxGap} m, radius delta ${radiusDelta.toFixed(3)} <= ${maxRadiusDelta}`,
  };
}

/** A whole weapon is either valid or broken — nothing in between. */
export type WeaponState = "valid" | "broken";

/** A stand-in socket for a part the build forgot, so the chain still yields a verdict. */
const MISSING = (part: WeaponPartId): PartSocket => ({
  part,
  position: { x: NaN, y: NaN, z: NaN },
  normal: { x: 0, y: 1, z: 0 },
  radius: NaN,
});

/**
 * The whole weapon. VALID means every part is present, every consecutive pair in
 * WEAPON_CHAIN has a legal connection, and no part is orphaned. `brokenAt` names the
 * parts where the chain fails: a missing part names itself, an illegal joint between
 * two present parts names both, and a present part joined to nothing is named too.
 * One connection is reported per consecutive chain pair, so the list is stable.
 */
export function integrity(sockets: PartSocket[]): {
  state: WeaponState;
  connections: Connection[];
  brokenAt: WeaponPartId[];
} {
  const byPart = new Map<WeaponPartId, PartSocket>();
  for (const s of sockets) byPart.set(s.part, s);

  const connections: Connection[] = [];
  const broken = new Set<WeaponPartId>();
  const connected = new Set<WeaponPartId>();

  for (const [x, y] of WEAPON_CHAIN) {
    const sx = byPart.get(x);
    const sy = byPart.get(y);
    const raw = connectionBetween(sx ?? MISSING(x), sy ?? MISSING(y));
    const absent = [sx ? null : x, sy ? null : y].filter((p): p is WeaponPartId => p !== null);
    const conn: Connection = absent.length
      ? { ...raw, legal: false, reason: `missing part${absent.length > 1 ? "s" : ""}: ${absent.join(", ")}` }
      : raw;
    connections.push(conn);

    if (conn.legal) {
      connected.add(x);
      connected.add(y);
      continue;
    }
    if (absent.length) {
      for (const p of absent) broken.add(p);
      continue;
    }
    broken.add(x);
    broken.add(y);
  }

  // A part present but joined to nothing is orphaned — the body is not whole.
  for (const p of ALL_PARTS) {
    if (byPart.has(p) && !connected.has(p)) broken.add(p);
  }

  return { state: broken.size === 0 ? "valid" : "broken", connections, brokenAt: [...broken] };
}

/**
 * May `part` be joined to `through`? True only for a legal chain adjacency — false for
 * every forbidden pair in CANNOT_PASS_THROUGH and for a part against itself.
 */
export function canPass(part: WeaponPartId, through: WeaponPartId): boolean {
  return isAdjacent(part, through);
}

// ENGINE CALL: the first call is `integrity(sockets)`, at the top of
// buildWeaponMesh(weapon, element) in src/graphics/WeaponMesh.ts — BEFORE the
// `for (const p of weapon.parts)` loop and before createEffectShell. Derive the four
// sockets from weapon.parts (kind "pommel"/"shaft"→grip/"guard"/"blade", position
// from y and bend, radius from the part's half-width) and, if the state is "broken",
// reject or flag the build instead of welding geometry onto a weapon that cannot hold
// together. `connectionBetween` and `canPass` are the per-joint checks the generator
// uses while placing parts; `integrity` is the whole-body gate the engine runs first.
