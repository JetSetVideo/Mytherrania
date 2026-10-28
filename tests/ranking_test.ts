import { ARCHETYPE_LIST, expectedScore, Leaderboard, mmrAfter, START_MMR } from "../src/game/Ranking.ts";
import { makeRoster } from "../src/game/Identity.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
function ae(a: number, b: number, m = ""): void { if (Math.abs(a - b) > 0.5) throw new Error(`${m} expected ~${b}, got ${a}`); }

Deno.test("there are exactly four archetypes, each with a distinct personality", () => {
  assert(ARCHETYPE_LIST.length === 4, "four archetypes");
  const styles = new Set(ARCHETYPE_LIST.map((a) => a.id));
  assert(styles.size === 4, "distinct ids");
  // They must differ from one another in at least one personality knob.
  for (let i = 0; i < ARCHETYPE_LIST.length; i++) {
    for (let j = i + 1; j < ARCHETYPE_LIST.length; j++) {
      const a = ARCHETYPE_LIST[i], b = ARCHETYPE_LIST[j];
      const differ = a.engageRange !== b.engageRange || a.cowardice !== b.cowardice || a.aggression !== b.aggression || a.neuralTrust !== b.neuralTrust;
      assert(differ, `${a.id} and ${b.id} must have different personalities`);
    }
  }
});

Deno.test("the Elo logistic: equal ratings are even, a 400-point gap is ~91%", () => {
  ae(expectedScore(1000, 1000), 0.5);
  ae(expectedScore(1400, 1000), 0.909, "400 up should be ~0.909");
  ae(expectedScore(1000, 1400), 0.091, "400 down should be ~0.091");
});

Deno.test("a win raises MMR, a loss lowers it, and the king is the highest", () => {
  const lb = new Leaderboard();
  const [a, b, c, d] = makeRoster(4, 11);
  lb.register(a, "berserker");
  lb.register(b, "tactician");
  lb.register(c, "duelist");
  lb.register(d, "sentinel");
  // A beats everyone: A should climb to the top.
  lb.recordMatch(a.id, b.id, 0);
  lb.recordMatch(a.id, c.id, 0);
  lb.recordMatch(a.id, d.id, 0);
  assert(lb.get(a.id)!.mmr > START_MMR, "winner climbs");
  assert(lb.get(b.id)!.mmr < START_MMR, "loser drops");
  assert(lb.king()!.identity.id === a.id, "A is the king");
  assert(lb.placement(a.id) === 1, "A is ranked first");
  assert(lb.get(a.id)!.wins === 3 && lb.get(b.id)!.losses === 1, "records counted");
});

Deno.test("an upset moves more MMR than an expected win", () => {
  const strong = mmrAfter(1400, 1000, 1) - 1400;   // favourite wins: small gain
  const upset = mmrAfter(1000, 1400, 1) - 1000;     // underdog wins: big gain
  assert(upset > strong, `upset ${upset} should beat expected ${strong}`);
});

Deno.test("peak MMR tracks the highest point reached", () => {
  const lb = new Leaderboard();
  const [a, b] = makeRoster(2, 5);
  lb.register(a, "duelist");
  lb.register(b, "sentinel");
  lb.recordMatch(a.id, b.id, 0); // A up
  const peakAfter = lb.get(a.id)!.peak;
  lb.recordMatch(a.id, b.id, 1); // A back down
  assert(lb.get(a.id)!.peak === peakAfter, "peak holds the high-water mark");
  assert(lb.get(a.id)!.peak >= lb.get(a.id)!.mmr, "peak >= current");
});

Deno.test("placement and winRate handle an unranked id and a fresh ladder", () => {
  const lb = new Leaderboard();
  assert(lb.placement("nobody") === 0, "unranked is 0");
  assert(lb.king() === null, "empty ladder has no king");
  assert(lb.winRate("nobody") === 0.5, "unknown is undecided");
});
