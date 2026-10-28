import { CombatLog } from "../src/game/CombatLog.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("combat log records first strike with when/where/from/to/what/why", () => {
  const log = new CombatLog();
  log.start(10);
  log.record({ kind: "hit", from: "You", to: "Warrior", x: -2.5, z: 0, damage: 14, weapon: "Greataxe" }, 10.4);
  log.record({ kind: "hit", from: "Warrior", to: "You", damage: 11 }, 10.9);
  log.record({ kind: "ring-out", from: "You", to: "Warrior", reason: "knocked off edge" }, 12.0);

  const d = log.digest();
  assert(d.firstStrike?.kind === "first-strike", "first hit becomes first-strike");
  assert(d.firstStrike?.from === "You" && d.firstStrike?.to === "Warrior", "from/to captured");
  assert(Math.abs((d.firstStrike?.time ?? -1) - 0.4) < 1e-9, "when = relative time");
  assert(d.firstStrike?.x === -2.5 && d.firstStrike?.z === 0, "where captured");
  assert(d.firstStrike?.damage === 14 && d.firstStrike?.weapon === "Greataxe", "what captured");
  assert(d.totalHits === 2 && d.totalDamage === 25, "hit/damage totals");
  assert(d.ringOuts === 1, "ring-out counted");
});

Deno.test("combat log digests decision distribution", () => {
  const log = new CombatLog();
  log.start(0);
  for (const action of ["attack", "attack", "advance", "block"]) {
    log.record({ kind: "decision", action }, 0);
  }
  const d = log.digest();
  assert(d.decisions.attack === 2, "attack counted twice");
  assert(d.decisions.advance === 1 && d.decisions.block === 1, "each action tallied");
});

Deno.test("combat log serializes to JSON and is append-only per match", () => {
  const log = new CombatLog();
  log.start(0);
  log.record({ kind: "hit", from: "A", to: "B", damage: 5 }, 1);
  log.record({ kind: "hit", from: "A", to: "B", damage: 5 }, 2);
  const json = JSON.parse(log.toJSON());
  assert(json.length === 2, "two events serialized");
  log.start(5); // new match resets
  assert(log.digest().totalHits === 0, "start clears history");
});
