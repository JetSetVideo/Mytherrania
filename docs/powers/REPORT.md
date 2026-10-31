# Wave N — report

**What you asked (your words).** *"one of the ending condition is the 300sec limit. It's an important
indicator that the AIs probably both failed probably because of navigating the terrain and generating a
good valid pathfinding… the goal is also to have the same AIs system be able to kite and find strategies
that allow them to hide or push the temporality… assassin can become invisible server side so the opponent
cannot cheat and the AI must understand that the disparition of the opponent visually is probably an effect
of his strategy. And a sound queue is played like in world of warcraft. Also the mages have an animation
loading and globally some strong powers have longer animations to cast (with the cast bar). The cast time
can be interrupted by some special powers from classes or generally extended if the caster is being hit by a
weapon depending on all the variables… Add autoattack and numbers of damages popping out of the victim with
their styles, colors, boldness, size, speed, brightness, hueness, etc depending on all the statistics."*

**The uncomfortable headline first.** Your read of the 300 s ending was measured and is **mostly wrong**:
the timeout rate is **29 per 100 before and 29 per 100 after** the navigation work, because **85 of those 87
timeouts had already traded hits** — the fighters reach each other, fight, and don't finish. The pathing was
not the failure; the *finishing* is. The pilot still earns its place where navigation is the cause (a body
pinned on a prop, a wall or the rim frees itself within 2 s, measured on three scripted fixtures), and the
"server side" decode is noted below.

**Where / what.**

- **Casting, live.** A caster's heavy technique now CHANNELS instead of firing at once: an Assassin's
  Execution measured **1.830 s**, a Mage's Arcane Nova **2.567 s**, with the cast bar on screen
  (`#cast-0`/`#cast-1`, state `cast`, label, fill %) painted from a pure view model — never an inline style
  attribute. A Mage's spell is the longest in the game (2.629 s, 1.753 s at 50 % haste) and martial powers
  sit near 1.7 s. **Being hit pushes the cast back** (observed live: +0.002 s on a mid-channel hit) by a
  bounded function of the hit's own variables — its share of the pool and how front-on it came (0.0782 s
  square-on at a 25 % hit vs 0.6253 s full-power from behind) — and **a heavy technique cuts the channel
  outright**. An interrupted channel costs time, not resources.
- **Invisibility that no client can read.** The Vanish is authoritative in the simulation. Measured live:
  `conceal.active: true`, and the enemy's belief reads **`knowsPosition: false`**, confidence **0.737**
  (decaying from 0.85), probable strategy **`"hide"`** — the AI inferring, exactly as you asked, that the
  disappearance is a strategy — and it hunts the **last known place**, not the truth. A concealed
  opponent's model is not drawn, and the cue (`playVanish`, a 0.55 s descending sweep unlike anything else
  in the set) announces it.
- **Damage numbers.** Every landed blow pops a number out of the victim: measured `● 826` at 22.76 px /
  weight 428 / hue 10, `● 1 202` at 25.25 px, `● 410` at 19.61 px — size, weight, lightness, hue, rise
  speed and lifetime all come from the blow's statistics, and the outcome is carried by a **glyph** as well
  as by colour, so it reads without colour vision.
- **Strategies.** brawl / kite / hide / stall / bait / trade exist as one vocabulary with stated
  parameters, a deterministic chooser, and a switch that stops a losing seat from stalling forever. Each
  seat picks one at the bell and the plan is recorded — **but they do not yet steer movement**.
- **Autoattack.** A fighter in reach swings by itself on its weapon's interval, suppressed while stunned or
  channelling.

**Two honest caveats, and one harness lesson.**
1. The strategies are a **decision and a plan, not yet behaviour** — wiring `strategyAdvice` into movement
   is the next step, and it is also what the timeout finding says actually matters.
2. The autoattack runs on **both** seats, so a player's technique press can be refused while the automatic
   swing is mid-flight; a press should arguably cancel the swing instead of being dropped.
3. A headless page never takes pointer lock, the engine opens the settings panel when the lock is lost
   mid-fight, and **that pauses the match** — a cast's elapsed time freezes and the whole game looks broken.
   It cost two probe runs; the probe now resumes with Escape and presses techniques through an engine QA
   path rather than key events, and the pitfall is in the wave skill.

**Verified by:** `deno task check` 0 errors · `deno task test` **1520 passed / 0 failed** · `deno lint`
525 files clean · `deno task build` 1 822 116 B · `tools/probe-wave-n.ts` with **0 page errors**.
Contract `docs/powers/BRIEF.md`; spec §11F; evidence `artifacts/powers/VERIFICATION.md`.
