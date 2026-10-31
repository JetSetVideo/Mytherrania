// src/game/ProfileLibrary.ts — the profile library: list, migrate, create and manage (pure).
//
// WHY this module exists: a saved Profile (Profiles.ts) carries a player identity and its
// telemetry, but NO APPEARANCE — no body colours, height, weight or hair. So a stored profile
// cannot be rendered as a MODEL at all today. This module resolves that missing appearance
// deterministically from what the record DOES carry (name seed + race + sub-species + calling),
// so every existing profile gets a stable, DISTINCT look instead of one shared default body.
//
// Pure module: no DOM, no THREE, no browser storage globals, no Math.random (the caller passes
// the rng, and the random roll reuses Wave L's rollProfile). Persistence is the injected ProfileRepo.
//
// Units, named once: heights are metres, weights are kilograms (matching Characters.Appearance).

import type { Appearance, CharacterProfile } from "./Characters.ts";
import { PALETTES } from "./Characters.ts";
import { createProfile, type Profile, type ProfileRepo } from "./Profiles.ts";
import type { ClassName } from "./Stats.ts";
import { HAIR_COLORS, mixHex, nameSeed, raceBuild, seededPick, SKIN_TONES } from "./RaceAppearance.ts";
import { randomSilhouette } from "./BodyProfile.ts";
import { startingStats } from "./Leveling.ts";
import { rng32 } from "../core/MathCore.ts";
import { rollProfile } from "../ui/CreatorRoll.ts";

export interface ProfileEntry {
  /** The stored record, exactly as the repo holds it. */
  profile: Profile;
  /** The CHARACTER it describes: appearance resolved, legacy records migrated. */
  character: CharacterProfile;
  level: number;
  matches: number;
  wins: number;
  losses: number;
}

/**
 * A Profile record plus the fields the library persists on it that Profiles.ts does not model:
 * the resolved `appearance` (once it has been materialised), the `palette` name, a `level`, and a
 * `removed` tombstone. All are absent on a legacy record, which is what makes it "migrated".
 */
type StoredProfile = Profile & {
  appearance?: Appearance;
  palette?: string;
  level?: number;
  /** The character's weapon type (a rolled fighter has one), kept so a loadout can match the model. */
  weaponType?: string;
  /** True once the profile has been deleted from the library (see deleteProfile for WHY). */
  removed?: boolean;
};

/** Eye colours drawn from the repo palette (DESIGN.md), so a migrated eye reads as one of the inks/sands. */
const EYES = ["#dfaa55", "#4f8490", "#ef7455", "#172128"];

/** One entry from a stored (non-removed) profile. */
function entryOf(profile: Profile): ProfileEntry {
  const character = toCharacter(profile);
  const t = profile.telemetry;
  return {
    profile,
    character,
    level: character.level,
    matches: t.matches,
    wins: t.wins,
    losses: t.losses,
  };
}

/** The repo's live (not removed) records, in storage order. */
function liveRecords(repo: ProfileRepo): Profile[] {
  return repo.list().filter((p) => !(p as StoredProfile).removed);
}

/** The live record for one id, or null (unknown OR removed). */
function liveRecord(repo: ProfileRepo, playerId: string): Profile | null {
  const p = repo.list().find((x) => x.playerId === playerId);
  if (!p || (p as StoredProfile).removed) return null;
  return p;
}

/** The derived palette NAME for a legacy record: stable for the record (same seed as appearanceFor). */
function paletteNameFor(profile: Profile): string {
  const seed = nameSeed(`${profile.name}|${profile.race}|${profile.subrace ?? ""}|${profile.className}`);
  return seededPick(Object.keys(PALETTES), seed);
}

/**
 * The appearance a LEGACY profile needs: deterministic from its name/race/sub-species/calling,
 * so the same record always yields the SAME look and two records differ. Reuses the arena's own
 * helpers (RaceAppearance/SKIN_TONES + BodyProfile.randomSilhouette), so a migrated fighter reads
 * with the same build rules the rig builds any other fighter with.
 */
export function appearanceFor(profile: Profile): Appearance {
  const seed = nameSeed(`${profile.name}|${profile.race}|${profile.subrace ?? ""}|${profile.className}`);
  const build = raceBuild(profile.race, profile.subrace);
  const palette = PALETTES[seededPick(Object.keys(PALETTES), seed)];
  const skin = seededPick(SKIN_TONES, seed ^ 0x9e3779b9);
  // A per-record seeded stream for the continuous values (height/weight/beard/silhouette) so the
  // migration is reproducible without touching Math.random.
  const rng = rng32(seed);
  return {
    // The body colour is the palette tone nudged toward the race's skin tone (0.3 mix), so two
    // profiles of one race are not the same flat colour, and the accent stays the palette's own.
    body: mixHex(palette.body, skin, 0.3),
    accent: palette.accent,
    // A base human frame (1.5–2.1 m tall, 50–140 kg) scaled by the race's build multipliers.
    height: (1.5 + rng() * 0.6) * build.heightMul,
    weight: (50 + rng() * 90) * build.weightMul,
    hair: seededPick(HAIR_COLORS, seed ^ 0x85ebca6b),
    // An ancestry that never grows a beard/moustache stays bare, whatever the record says.
    beard: build.beard && rng() < 0.3,
    moustache: build.moustache && rng() < 0.25,
    eyes: seededPick(EYES, seed ^ 0xc2b2ae35),
    race: profile.race,
    subrace: profile.subrace,
    // Per-record proportions from the same seeded stream, so bodies differ within a race.
    silhouette: randomSilhouette(rng, profile.race, profile.subrace),
  };
}

/**
 * Migrate a stored record to the CHARACTER it describes.
 *
 * PRECEDENCE: a stored appearance WINS; the deterministic `appearanceFor` resolve is used ONLY
 * when the record has none (a legacy profile). This is why a profile saved WITH an appearance is
 * never repainted by the migration, and why a legacy record keeps one stable look.
 */
function toCharacter(profile: Profile): CharacterProfile {
  const stored = profile as StoredProfile;
  const appearance = stored.appearance ?? appearanceFor(profile);
  return {
    name: profile.name,
    race: profile.race,
    subrace: profile.subrace,
    className: profile.className,
    appearance,
    palette: stored.palette ?? paletteNameFor(profile),
    birthsign: profile.birthsign,
    // A legacy record has no level; the fight starts every fighter at level 1.
    level: stored.level ?? 1,
    // The same allocation the Creator's own default uses (Characters.defaultAlloc), from Leveling.
    allocated: startingStats(profile.className, profile.race, profile.subrace).allocated,
    weaponType: stored.weaponType,
  };
}

/** A player id not already taken, derived from a seed hash; a collision is RESOLVED, not overwritten. */
function uniqueId(repo: ProfileRepo, seed: number, name: string, className: ClassName): string {
  const taken = new Set(repo.list().map((p) => p.playerId));
  // 4096 tries: hash32 spreads ids over 2^24 slots, so a live repo collides far below this.
  for (let i = 0; i < 4096; i++) {
    const id = createProfile((seed + i) >>> 0, name, className).playerId;
    if (!taken.has(id)) return id;
  }
  // Astronomically unlikely fallback: extend rather than overwrite an existing profile.
  const base = createProfile(seed, name, className).playerId;
  let n = 1;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Build a StoredProfile from a fully-formed character, persisting its appearance so it is fixed. */
function storedFromCharacter(
  repo: ProfileRepo,
  c: CharacterProfile,
  name: string,
  seed: number,
  nowIso: string,
): StoredProfile {
  const base = createProfile(seed, name, c.className);
  return {
    ...base,
    playerId: uniqueId(repo, seed, name, c.className),
    name,
    className: c.className,
    race: c.race,
    subrace: c.subrace,
    birthsign: c.birthsign,
    // WHY: the record carries the character's OWN appearance + palette + level, so the migration
    // precedence (stored wins) fixes this look forever instead of re-deriving it later.
    appearance: c.appearance,
    palette: c.palette,
    level: c.level,
    weaponType: c.weaponType,
    // The caller stamps the time, so the module stays free of Date().
    createdAt: nowIso,
  };
}

/** The library's whole view of the repo: migrated, ordered active-first then newest. */
export function libraryEntries(repo: ProfileRepo): ProfileEntry[] {
  const active = repo.active();
  const activeId = active && !(active as StoredProfile).removed ? active.playerId : null;
  const entries = liveRecords(repo).map(entryOf);
  entries.sort((a, b) => {
    // Active first, then newest (createdAt desc); a stable id tiebreak so the order never wobbles.
    const aActive = a.profile.playerId === activeId ? 1 : 0;
    const bActive = b.profile.playerId === activeId ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const c = (b.profile.createdAt ?? "").localeCompare(a.profile.createdAt ?? "");
    if (c !== 0) return c;
    return a.profile.playerId.localeCompare(b.profile.playerId);
  });
  return entries;
}

/** Roll a complete fighter (Wave L's rollProfile) and SAVE it as a new profile. */
export function createRandomProfile(repo: ProfileRepo, rng: () => number, nowIso: string): ProfileEntry {
  const { profile: rolled, seed } = rollProfile(rng);
  const stored = storedFromCharacter(repo, rolled, rolled.name, seed, nowIso);
  repo.add(stored);
  return entryOf(stored);
}

/** Save a deliberately built character (from the Creator) as a new profile. */
export function createFromCharacter(repo: ProfileRepo, c: CharacterProfile, name: string, nowIso: string): ProfileEntry {
  // A seed from the character + name + time, so the id is reproducible from its inputs.
  const seed = nameSeed(`${name}|${c.race}|${c.subrace ?? ""}|${c.className}|${nowIso}`);
  const stored = storedFromCharacter(repo, c, name, seed, nowIso);
  repo.add(stored);
  return entryOf(stored);
}

/** Rename a profile: trims, refuses an empty name, and NEVER changes the id. */
export function renameProfile(repo: ProfileRepo, playerId: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  const p = liveRecord(repo, playerId);
  if (!p) return false;
  const patch: Partial<Profile> & Partial<StoredProfile> = { name: trimmed };
  // WHY freeze the look: a legacy profile's appearance is derived from its NAME, so renaming would
  // otherwise repaint the model. Persist the current appearance so a rename changes only the name.
  if (!(p as StoredProfile).appearance) patch.appearance = appearanceFor(p);
  repo.update(playerId, patch);
  return true;
}

/** Duplicate a profile into a new, uniquely-id'd one that keeps the source's look and record. */
export function duplicateProfile(repo: ProfileRepo, playerId: string, nowIso: string): ProfileEntry | null {
  const p = liveRecord(repo, playerId);
  if (!p) return null;
  const character = toCharacter(p);
  const copyName = `${p.name} (copy)`;
  const seed = nameSeed(`${p.playerId}|${copyName}|${nowIso}`);
  const base = createProfile(seed, copyName, p.className);
  const copy: StoredProfile = {
    ...base,
    playerId: uniqueId(repo, seed, copyName, p.className),
    name: copyName,
    className: p.className,
    race: p.race,
    subrace: p.subrace,
    birthsign: p.birthsign,
    keybindings: { ...p.keybindings },
    telemetry: { ...p.telemetry },
    createdAt: nowIso,
    // The copy keeps the source's RESOLVED look (stored), so a duplicate looks identical.
    appearance: character.appearance,
    palette: character.palette,
    level: character.level,
    weaponType: character.weaponType,
  };
  repo.add(copy);
  return entryOf(copy);
}

/**
 * Delete a profile. Returns false, with the reason, when: it is unknown/removed, or it is the LAST
 * profile (the library never empties — the game needs an identity to run).
 *
 * WHY a tombstone: Profiles.ProfileRepo exposes no remove and this wave may not modify it. update()
 * is the only write path, so removal marks the record `removed`; every reader here (libraryEntries,
 * liveRecord) skips it, so the profile leaves the library for good.
 */
export function deleteProfile(repo: ProfileRepo, playerId: string): boolean {
  const live = liveRecords(repo);
  if (live.length <= 1) return false; // never empty the library
  const target = live.find((p) => p.playerId === playerId);
  if (!target) return false;
  const patch: Partial<Profile> & Partial<StoredProfile> = { removed: true };
  repo.update(playerId, patch);
  // If the deleted profile was active, move the active id to a survivor so the library keeps one.
  if (repo.active()?.playerId === playerId) {
    const survivor = live.find((p) => p.playerId !== playerId);
    if (survivor) repo.select(survivor.playerId);
  }
  return true;
}

/** Select the active profile; false when the id is unknown or removed. */
export function setActive(repo: ProfileRepo, playerId: string): boolean {
  if (!liveRecord(repo, playerId)) return false;
  return repo.select(playerId) !== null;
}

/** A compact summary of the library: its size, its names in order, and the active id. */
export function librarySummary(repo: ProfileRepo): { count: number; names: string[]; activeId: string | null } {
  const entries = libraryEntries(repo);
  return {
    count: entries.length,
    names: entries.map((e) => e.profile.name),
    // libraryEntries orders the active first, so the active id is the first entry's.
    activeId: entries[0]?.profile.playerId ?? null,
  };
}
