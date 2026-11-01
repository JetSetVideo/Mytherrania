// Wave J (lane J-B): the batch back end — design points -> full MatchConditions -> the headless
// simulator -> MatchRecord, one per match, every record carrying the complete conditions it was
// played under (arena config, wall plan, digest, both fighter specs with the stats actually used,
// the design cell, the gradient position, the seed and the code hash).

import type { MatchRecord } from "../game/arena/contracts.ts";
import { buildFallbackArena, type ArenaProvider } from "./ArenaFixtures.ts";
import { designPoints, toConditions, type DesignKind } from "./Gradient.ts";
import { simulateMatch, type SimOptions } from "./MatchSim.ts";
import { fighterStats } from "./FighterBuild.ts";
import { WAVE_J_RULES, type MatchRules } from "./MatchRules.ts";
import { resolveTimeLimit } from "../game/MatchControl.ts";
import { truceSeconds } from "../game/Disposition.ts";

export interface BatchOptions {
  matches: number;
  seed: number;
  design: DesignKind;
  rules?: MatchRules;
  provider?: ArenaProvider;
  codeHash?: string;
  sim?: Omit<SimOptions, "rules">;
  /** Called with every record as it is produced (stream to disk). */
  onRecord?: (r: MatchRecord, i: number) => void;
}

/** Run a batch; returns the records (also streamed through onRecord). */
export function runBatch(o: BatchOptions): MatchRecord[] {
  const rules = o.rules ?? WAVE_J_RULES;
  const provider = o.provider ?? buildFallbackArena;
  const out: MatchRecord[] = [];
  const points = designPoints(o.design, o.matches, o.seed);
  points.forEach((p, i) => {
    const conditions = toConditions(p, provider, o.codeHash ?? "unhashed");
    for (const f of conditions.fighters) f.stats = fighterStats(f, rules);
    // The record states the clock the simulator ACTUALLY plays (MatchSim takes the truce from
    // Disposition and the limit from MatchControl, never from the arena config): before wave J2 the
    // record said timeLimit 90 / roamSeconds 6 from the config while the match ran 6 + 180 s.
    conditions.arena.timeLimit = resolveTimeLimit(o.sim?.timeLimit);
    conditions.arena.roamSeconds = truceSeconds();
    const outcome = simulateMatch(conditions, { ...o.sim, rules });
    const rec: MatchRecord = { conditions, outcome };
    o.onRecord?.(rec, i);
    out.push(rec);
  });
  return out;
}

/**
 * sha256 over every .ts file under `dirs` (sorted paths; path + NUL + content), hex. Ties a record
 * to the simulation sources that produced it. Needs --allow-read.
 */
export async function codeHash(dirs: readonly string[] = ["src/balance", "src/game"]): Promise<string> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for await (const e of Deno.readDir(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (e.isFile && e.name.endsWith(".ts")) files.push(p);
    }
  };
  for (const d of dirs) await walk(d);
  files.sort();
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const f of files) { parts.push(enc.encode(f + "\0")); parts.push(await Deno.readFile(f)); }
  const total = parts.reduce((t, p) => t + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
