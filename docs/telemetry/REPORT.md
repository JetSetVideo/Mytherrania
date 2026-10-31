# Wave M — report

**What you asked (your words).** *"add variables that are processed by the frontend to fit the backend… the
AI models of the behaviors of the characters… number of seconds without eating anything, the maximum…, the
minimum…, without eating two players… the average distance and the median distance… I tried to solve the
problem where the characters, they kind of move, but they don't really move and they don't serve each other…
with one click one button on the spectator in the reading page, run a batch of matches… choose like 10 or 20
matches, and the computer doesn't even run the graphics, only runs the simulator. Improve this prompt with a
lot more min/max statistics: number of jumps, highest damages dealt/taken, damage absorbed, per weapon, etc.
make thousands of trees and branches from the initial arena with victory conditions and match-up combinations
… the distances, the difference in the fighters, their evolutions, the objects taken or destroyed or defended,
attacked… The AI models also need to know the behaviors of the enemy (all their data and then probable
strategies). To avoid streaming everything… the frontend does the preprocessing during the game and shares its
report at the end… Right now this is development mode so the updates can be done automatically but… I will
need to review the updates… accept them or push them for later or refuse them."*

**Two decodes** (full table in `docs/telemetry/BRIEF.md`): **"without eating anything"** = without *landing* a
hit (a dry streak) — built that way, and the other reading is a one-line swap if you meant it; **"they don't
serve each other"** = they don't engage/answer each other.

**Where / what.**

- **The stall you described is now a number, and it moved.** `standoffMaxS` — the longest stretch with no hit
  while the pair is apart — went **143.97 s → 10.5 s** on the same 80-match seed (−92.7 %), and time spent
  beyond the circling band **213.9 s → 32.1 s**. `src/game/Engagement.ts` gives each fighter an intent
  (approach / hold / circle / disengage / bait) whose pull to close is `clamp(quietS / 3 s, 0, 1)`, and the
  engine now feeds it the quiet time every substep (without that wire the fix existed only in the batch).
- **The variables the frontend computes**, live, per substep, in one accumulator (`src/game/FightTelemetry.ts`):
  dry streaks per fighter with **max and min**, the pair's mutual-dry and quiet time with its longest stretch,
  distance **mean / median / min / max / p10 / p90**, time in the contact / striking / circling / apart bands,
  **jumps** (count + peak height), damage dealt / taken / **absorbed** with the highest single hit, the same
  **per weapon**, the object events (taken / destroyed / defended / attacked), the fighters' evolution — and a
  non-finite step is refused rather than poisoning a median.
- **One click on the reading page runs the simulator only.** 10/20/50/100 matches, in-page, chunked so the
  game keeps its frame loop (p50 16.8 ms while 100 matches ran). Measured from that click: 100 matches,
  7 variables with min/p10/median/mean/p90/max, endings **ringout 67 · ko 24 · time 9** — so the 300 s-limit
  ending you flagged as an AI failure is **9 %** of matches, and it is now a number the button prints.
- **The report at the bell** is one payload, sent once: **6 962 bytes** against an 8 KiB cap, schema 1, both
  seats' telemetry, an opponent model whose probable strategies are real decision-tree leaves
  (`block / attack / advance / retreat`, weights summing to 1) with measured habits (opening move, seconds to
  first contact, retreat threshold, favoured band), and a *tested* privacy claim — no name, no personal id, no
  position. In this build there is no back end to post to, so it is queued locally and the hand-off is one
  call when you have one.
- **The tree.** From an initial arena across victory conditions and match-ups: **1 189 nodes in 3.34 s**, depth
  histogram 1/45/127/508/508, every node carrying its telemetry, outcome, distances, fighter gap and object
  events, summarised per depth (win rate 0.864 at depth 1 → 0.481 at depth 4; stall and damage per depth).
- **The update gate** exists with accept / defer / refuse and an auto mode that records why; there is no review
  **screen** yet.

**What I broke and fixed on the way (all caught by tools, not by luck).** Two lanes had mirrored the telemetry
type while it was still in flight — single-sourced now, so a drift is a compile error. I clipped one interface
in M-D's file while removing those duplicates and restored it. The engine's `MatchRecord` collided with the
batch back end's and is now aliased. The assembled report was being wiped by the next match (`#startFight`
cleared it) — a spectate match rolling into the next one destroyed the evidence, and only the probe's
`assembled: false` found it.

**Verified by:** `deno task check` 0 errors · `deno task test` — see the log in
`artifacts/telemetry/VERIFICATION.md` · `deno lint` 499 files · `deno task build` 1 817 375 B ·
`tools/probe-wave-m.ts` with **0 page errors** and the numbers above · `tests/wave_m_wiring_test.ts` (the
parent's own joints). Contract `docs/telemetry/BRIEF.md`; spec §11E; evidence
`artifacts/telemetry/VERIFICATION.md`.

**What is NOT done, plainly.** A **batch summary cannot yet show the dry streaks** — the rich telemetry is
computed in the LIVE match, and the headless back end does not attach it to its records yet; that is the next
wave's first job. There is no review UI for the update gate. And no human eye has looked at the new batch bar
— the machine says nothing clips and the buttons are 40–44 px, which is not the same as it looking right.
