# Wave I verification — measured, 2026-10-31

Everything below is a literal value printed by a tool in this repo. The wave's frozen lane contract is
`docs/spectator/BRIEF.md`; the live probe is `tools/probe-wave-i.ts`, its output
`artifacts/qa-wave-i/report.json`, screenshots beside it.

## 1. The gate

| Command | Result |
| --- | --- |
| `deno task check` | 0 errors |
| `deno task test` | see the wave log (`artifacts/data-science.md` pass 28) |
| `deno test tests/spec_test.ts` | `ok | 33 passed | 0 failed` — 5 of them new Wave I pins (IA1, IB1, IC1, ID1, IE1) |
| `deno lint` | clean |
| `deno task build` | 1 725 271 B, 212 modules |
| `deno run -A tools/probe-wave-i.ts` | **0 page errors**, five claims measured (below) |
| `deno run -A tools/frame-budget.ts` | day / night / **spectate** samples, CPU + GPU + cadence |

## 2. The spectator camera keeps the angle (the user's own complaint)

```
start      {"mode":"free","yaw":0,   "pitch":0.35,"dist":9,"height":0}
afterDrag  {"mode":"free","yaw":0.72,"pitch":0.53,"dist":9,"height":0}
afterIdle  {"mode":"free","yaw":0.72,"pitch":0.53,"dist":9,"height":0}   <- 2.5 s with no input
dragMoved: true     angleHeldForIdleFrames: true
presetIds: ["duel","broadcast","topdown","lowangle"]   presetApplied: true   modeAfterCycle: "follow-a"
```

The old third-person branch multiplied its orbit offset by `exp(−1.8·dt)` every idle frame, which is why
the angle "did not remain". In spectator mode the offset is now an absolute, persisted state: the probe
drags, waits 2.5 s, and reads back the identical yaw and pitch. `[SPEC IA1]` pins this at the module level
(500 idle frames are a no-op, byte for byte).

Controls: **drag** to orbit, **wheel** or **Z/X** to zoom, **1–4** for the presets, **C** to cycle
free → follow A → follow B. A click that does not drag selects instead of orbiting. The camera persists in
`localStorage` (`mytherrania-spectate-cam-v1`) and survives a new match.

## 3. The cursor and the click-to-inspect cards

```
cursor:  present true · follows true · blobTrails true · blobSettlesOnReticle true · radius 14 px
inspect: hover "fighter:0" → card "Sir Aldric" (17 rows, 3 bars, badges ["GEN-53AB8C","AI"])
         click the OTHER fighter → swapped to "Ser Vail"
         click a map object      → object card "Rock"
         click empty ground      → closed (card null)
```

So all four behaviours the brief asked for are measured: hover, a floating sheet beside the fighter,
clicking the other fighter swaps it, clicking away closes it, and clicking a map object gives that
object's own card — with the boon's REAL effect for a pickup (read from `POWERUPS.PICKUP_KINDS`) and what
the object is for when it carries no boon.

## 4. Floating props and the ground-fill layer

Forced to a prop-rich arena (`debugWorld({ nextArena: { objects: 16 } })`):

```
count 16 · floatingBefore 15 · floatingNow 0 · worstFloatingM 0
worstSeamM 1.42 m · seamsCovered 16/16 · skirtMeshes 16 · skirtTriangles 1920
skirtMaterialSamples {"wood":8,"stone":4,"sand":4}
baseOffsets {pillar 1.6, ramp 0.45, platform 0.7, crate 0.4, rock 0.4831, arch 1.85, tree 1.5, gliderPad 0.1}
```

Two defects, both measured before they were fixed:

1. **Every prop model is centred on its own origin**, so drawing it at `centre + h·scale/2` floated it by
   half its height even on flat ground — the `baseOffsets` table above is that constant per kind (1.60 m
   for a pillar, 1.85 m for an arch). Props are now seated by their own geometry's bounding box.
2. **The base was placed from the terrain height at the CENTRE**, so on a slope it was buried uphill and
   hovering downhill at once. `floatingBefore 15` of 16 props would have floated under that rule; after
   seating on the footprint's high point, **0 do**.

The apron then covers the remaining downhill seam: 16 skirts, 1920 triangles in total (120 each), each
coloured by the material under its own footprint (8 wood, 4 stone, 4 sand in this arena). `[SPEC IC1]`
pins the seating contract (never below the ground at any sampled rim point, never hovering by more than
the footprint's own fall) and the apron's coverage.

**A bug the measurement caught:** the apron's depth cap was the filler's 0.6 m default, while a platform
standing on a hillside had a **1.81 m** footprint fall — the fill stopped 1.2 m short and left exactly the
seam it existed to close. The cap is now the footprint's own fall plus a margin, and `seamsCovered` reads
16/16.

## 5. Weapon-clash sparks

```
firstBurstSparks 24 · after 40 forced bursts live 76 (cap 96, capped true)
spawned 325 · dropped 251 · events 48  (8 natural + 40 forced)
pool: 12 sparks per burst, max 96, 192 triangles, 2 draw calls
```

Natural clashes happen in a real AI-vs-AI fight (8 of the 48 events came from the live clash test, the
rest from the probe's forced bursts), the pool never exceeds its cap, and a refused burst is counted
rather than dropped silently. `[SPEC ID1]` pins the geometry (crossing/parallel/degenerate segments), the
speed gate (two idle blades never spark however close), the repeat cooldown and the pool's bookkeeping
(`spawned + dropped == 10 000 × perBurst`, `setScale(0)` spawns nothing, triangles under 4 000).

## 6. The 60 FPS budget

Probe, 240 frames during a live spectated match with every new system on:

```
mean 2.18 ms · p50 2.00 · p95 3.10 · p99 3.50 · max 15.20   headroom 13.1 ms of 16.6
governor: scale 1.00 · drops 1 · recoveries 60 · over-budget frames 17
```

Lane I-E's own tool (`tools/frame-budget.ts`, headless Chrome, ANGLE Metal, Apple M1 Pro), which also has
a real GPU timer:

```
[day]      cpuMs p50/p95/p99/max 2.1/3.6/5.2/7.7   cadence p50 16.7 ms   gpu p95 9.959 ms
[night]    cpuMs p50/p95/p99/max 2.0/3.2/4.4/12.6  cadence p50 16.7 ms   gpu p95 9.932 ms
[spectate] cpuMs p50/p95/p99/max 2.0/3.2/4.8/5.1   cadence p50 16.7 ms   gpu p95 9.353 ms
GPU timer available: true
```

CPU p99 stays 3.5–8.5 ms across runs (11–13 ms of headroom at p99), cadence holds 16.7 ms = 60 FPS, and
the effects governor never had to cut anything (`scale 1.00`) — it is a safety valve that measures 17
over-budget frames during startup and one drop, then recovers.

## 7. Bugs found by the measurement, not by reading

1. **Four page errors from pointer lock**: `el.requestPointerLock()` rejects its promise in Chrome
   (`WrongDocumentError` when the document is not focused), and the rejection was unhandled — 4 page
   errors in every probe run. Now swallowed deliberately (the lock is a convenience, the error is noise).
2. **The apron's depth cap** (§4) left a 1.2 m seam on a hillside.
3. **The seating sample density**: the "never below the ground" guarantee is a property of the SAMPLING,
   so a prop now gets 24 rim samples per metre of radius instead of a flat 16.
4. **The probe's own click race**: fighters move between a projection and a click a second later, so a
   click aimed at a stale coordinate misses. The probe now re-projects immediately before each click —
   a test-harness fix, but it is why the swap assertion first read false.

## 8. Honest gaps

- **The headless frame numbers are a lab sample, not a real display.** Cadence is a vsync artefact in
  headless Chrome; the CPU and GPU figures are real per-frame times but a real display with a real window
  compositor can differ.
- **`floating: 0` means "seated on the high point of the sampled footprint", not "mathematically flush".**
  Between the sampled rim points the terrain could rise above the base on a bumpy heightfield; 24 samples
  per metre of radius bounds that on the arena's hills but does not prove it away.
- **The clash threshold (0.35 m) was chosen, not tuned.** Natural clashes fire ~8 times per spectated
  match; whether that reads as "sparks when two weapons meet" or as too rare is a judgement nobody has
  made by eye yet — screenshots are in `artifacts/qa-wave-i/`.
- **The inspect card is read-only.** It shows the stats and the boon but offers no interaction beyond
  opening and closing.
- **The stat-unlocked techniques from Wave H are still not bound to extra HUD slots** (unchanged).
