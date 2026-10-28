// Lane X (W05): StrikeTracker — one damage event per swing per target, only inside the window.
import { attackStrikeWindow, skillStrikeWindow, StrikeTracker } from "../src/combat/StrikeTracker.ts";
import type { HitboxSet } from "../src/combat/contracts.ts";
import { capsule, longsword, pose } from "./combat_fixtures.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("strike tracker: hits once per swing per target, only inside the window, with two samples", () => {
  const sword = longsword(), tr = new StrikeTracker();
  const target: HitboxSet = { mass: 70, boxes: [capsule([-0.15, 0.6, 0.45], [0.15, 0.6, 0.45], 0.05, "chest")] };
  const win = skillStrikeWindow({ hitAt: 0.4 });
  assert(win.start > 0.2 && win.start < 0.4 && win.end === 1, `window ${JSON.stringify(win)}`);
  tr.beginSwing(2);
  let hits = 0;
  // A swing about x through the target, sampled at 60 Hz over progress 0..1.
  for (let k = 0; k <= 30; k++) {
    const progress = k / 30, theta = -0.4 + 1.6 * progress;
    tr.sample(pose([1, 0, 0], theta, [0, 0, 0]), k / 60);
    tr.updateWindow(progress, win);
    if (progress < win.start) assert(!tr.active, "window must stay shut during the wind-up");
    if (tr.sweep(1, target, sword)) hits++;
  }
  assert(hits === 1, `hits per swing ${hits}`);
  assert(tr.struck(1) && tr.handsUsed === 2, "bookkeeping");
  // A new swing re-arms the target; outside the window nothing is tested.
  tr.beginSwing();
  assert(!tr.struck(1) && !tr.canStrike(1), "new swing starts unarmed until the window opens");
  tr.updateWindow(null, win);
  assert(!tr.active, "no animation, no window");
  tr.reset();
  tr.updateWindow(0.9, win);
  tr.sample(pose([1, 0, 0], 0.5, [0, 0, 0]), 1);
  assert(!tr.canStrike(1), "one sample after a reset is not a motion");
  const atk = attackStrikeWindow();
  assert(atk.start < 0.25 && atk.end > 0.25, `plain attack window ${JSON.stringify(atk)}`);
});
