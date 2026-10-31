import { PortraitStudio } from "./PortraitStudio.ts";
import type { CharacterProfile } from "../game/Characters.ts";

/**
 * Portrait.ts — the one-shot portrait the character SHEET shows.
 *
 * This used to be the stale path: it called `buildHumanoid` (a body the game no longer renders)
 * and constructed a WHOLE new `WebGLRenderer` per call. It is now a thin delegation to ONE
 * module-level `PortraitStudio`, whose rig comes from `buildPreviewRig` — the same build path the
 * arena runs — and whose renderer/cache are shared across every call. The export signature is
 * unchanged so `Engine.onSheet` keeps working; a headless caller (no WebGL) gets an empty string
 * rather than a thrown error.
 */

/** One studio for the whole page: one WebGL context, a cache that turns the sheet into a hit after the first. */
const STUDIO = new PortraitStudio();

/** A PNG data URL of `profile`'s upper body (head and shoulders), or "" when no GL context exists. */
export function renderPortrait(profile: CharacterProfile): string {
  return STUDIO.portraitOf(profile);
}
