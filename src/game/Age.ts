// Wave X: a fighter's AGE, relative to its ancestry's lifespan.
//
// `Appearance.age` is in years. What a year MEANS depends on the race (an elf of 200 is a young
// adult, a human of 70 an elder), so everything downstream reads the LIFE FRACTION or the stage,
// never raw years. The hair lane greys with `greyFraction`; the body lane may sag/thin with
// `lifeStage`; the roll draws a plausible adult age with `rollAge`.
//
// Pure module: no DOM, no THREE, no Math.random.

/** Typical lifespan in years per race (unknown -> human). */
export const LIFESPAN: Readonly<Record<string, number>> = { human: 80, elf: 700, dwarf: 300, ork: 55 };

/** Age of majority as a fraction of the lifespan (a fighter is never younger). */
export const ADULT_FRACTION = 0.2;

export type LifeStage = "young" | "adult" | "mature" | "elder";

export function lifespanOf(race: string | null | undefined): number {
  return LIFESPAN[race ?? ""] ?? LIFESPAN.human;
}

/** 0 at birth, 1 at the typical lifespan (may exceed 1 for the very old). Non-finite -> adult default. */
export function lifeFraction(race: string | null | undefined, years: number | null | undefined): number {
  if (years === null || years === undefined || !Number.isFinite(years)) return 0.35;
  return Math.max(0, years) / lifespanOf(race);
}

/** young < 0.3 <= adult < 0.55 <= mature < 0.75 <= elder. */
export function lifeStage(race: string | null | undefined, years: number | null | undefined): LifeStage {
  const f = lifeFraction(race, years);
  if (f < 0.3) return "young";
  if (f < 0.55) return "adult";
  if (f < 0.75) return "mature";
  return "elder";
}

/**
 * Share of grey strands, 0..1: none before 45 % of the lifespan, rising smoothly to ~0.9 by the
 * full lifespan. Elves grey later and less (their hair silvers, it does not whiten).
 */
export function greyFraction(race: string | null | undefined, years: number | null | undefined): number {
  const f = lifeFraction(race, years);
  const start = race === "elf" ? 0.7 : 0.45;
  const t = Math.max(0, Math.min(1, (f - start) / (1 - start)));
  const s = t * t * (3 - 2 * t);
  return (race === "elf" ? 0.6 : 0.92) * s;
}

/** Legal age band for the creator's control, in years: majority .. 1.1 x lifespan. */
export function ageBounds(race: string | null | undefined): { min: number; max: number } {
  const L = lifespanOf(race);
  return { min: Math.round(L * ADULT_FRACTION), max: Math.round(L * 1.1) };
}

/** A rolled adult age: most fighters young-to-mature, ~12 % elders. */
export function rollAge(rng: () => number, race: string | null | undefined): number {
  const L = lifespanOf(race);
  const u = rng();
  const f = u < 0.88 ? ADULT_FRACTION + (u / 0.88) * (0.55 - ADULT_FRACTION) : 0.75 + ((u - 0.88) / 0.12) * 0.3;
  return Math.round(L * f);
}
