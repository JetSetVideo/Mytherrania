# Wave G — graphics, sky and world climate (status, 2026-10-29)

Brief: `docs/graphics/BRIEF.md` (requirements G01–G18). Lane reports: `lane-C.md` (climate),
`lane-N.md` (noise/textures). Evidence: `artifacts/qa-graphics/` (PNGs + `manifest.json` with the
engine snapshot per shot), produced by `deno task build && deno run -A tools/probe-graphics.ts`
(Metal-backed headless Chrome, Apple M1 Pro).

## Where to find it in the game (mouse path)

Gear icon (top right, left of the minimap) → **Display → Resolution** (Auto, 480p … 2160p 4K) and
**Graphics** section: Preset (Low/Medium/High/Ultra), Ambient occlusion (SSAO), Global
illumination, Ray tracing (screen-space) — each Preset/On/Off — and **Time of day**
(Flows: 1 day = 24 min, Slow, Fast, Real time, Frozen).

## What each requirement became

| Id | Status | Where | What |
|----|--------|-------|------|
| G01 | LIVE | `render/Quality.ts`, SettingsPanel | 480p/720p/900p/1080p/1440p/1800p/2160p by output ROWS (the window's aspect is kept) + Auto (pixel budget) |
| G02 | LIVE | `render/PostShaders.ts` EFFECTS | SSAO (Alchemy estimator) at half resolution, depth-aware blur, normals rebuilt from depth |
| G03 | LIVE | same + Engine | screen-space one-bounce GI sharing the AO taps; hemisphere irradiance (sky hue + ground albedo × sun bounce) |
| G04 | LIVE | SSR + EFFECTS | ray-marched reflections (water via an alpha mask, wet ground via render.wetness) with bisection refine; ray-marched contact shadows. WebGL has no hardware ray tracing: this is screen-space |
| G05 | LIVE | `shaders/CelShader.ts`, `ToonLambert.ts`, composite ink | one shared cel chunk: received shadow (3×3 PCF) pushed through the bands, fwidth-anti-aliased bands, hemisphere ambient, crisp rim, banded metal specular; terrain/props/walls get toon bands; screen-space ink on every surface |
| G06 | LIVE | lane N + Engine `#detailFor` | noise algebra (13 sources × 46 operators), 15 recipes; 8 baked 128² tileable textures applied triplanar on terrain, walls and props (Medium and up) |
| G07 | LIVE | lane N `Spread.ts` + Engine `#scatterPebbles` | value spread (every channel at its p20/p80 target) + blue-noise Pareto scatter of pebbles (80/20 by area, alpha from `alphaForTopShare`) |
| G08 | LIVE | `props/PropModels.ts` | lathe pillars with entasis, noise-displaced rocks, layered trees, rounded crates/slabs, arched gates, bevelled pads; tessellation × preset polygonDetail |
| G09 | LIVE | Quality presets, dynamic resolution | low = no post pass; dynamic resolution on Low/Medium (0.5..1 render scale) |
| G10 | LIVE | Engine, CelShader | shadow map 1024/2048/4096 by preset, cel bodies receive it, cloud shadows on the ground in the composite |
| G11 | LIVE | `Sky.ts` | turbidity-driven gradient + Mie halo, limb-darkened sun, stars fading under cloud |
| G12 | LIVE | lane C Climate/TimeWarp/Calendar | time flows (default 1 game day = 24 real minutes); 12-month calendar; day of year → solar declination |
| G13 | LIVE | lane C Moons + Sky | Ilun (29.5 d) and Vesh (11 d) with phases drawn from the phase angle, sky colour reddening toward the horizon (air-mass extinction), drawn ×2.4 their angular size |
| G14 | LIVE | `sky/CloudField.ts` + Sky | 4 layers (low, mid, high, towering) × 7 types, cel-banded, coverage standardised so drawn cover = requested cover (±0.03, tested for all 6 planar types) |
| G15 | LIVE | `Waves.ts` seaShape/reshapeWaves, Engine | sea follows the storm cycle: sinusoidal → looping (sharp trochoids, crossing seas) → lull (energy drops) → storm (long-crested, straight); spectrum/phases fixed so nothing pops |
| G16 | LIVE | lane C `WorldVars.ts` | 83 variables at the top of the file, 111 coefficients, 58 equations using all 26 operators, topologically ordered |
| G17 | LIVE | lane C `RealClimate.ts` | approximate monthly normals from Niamey, Paris, Algiers, Östersund (typical values, not station data) |
| G18 | LIVE | lane C TimeWarp + Weather; Environment | blue/golden hours dwell 2.1–2.4×, midday 1.3×, climbs 0.6×; clear/storm/lull dwell longer than building/clearing; golden hour lit warm |

## Measured (tools/probe-graphics.ts, 1440×900 window, M1 Pro, synced render benchmark)

`bench` = 20 frames, each followed by a 1-pixel readPixels (GPU sync): CPU submit + GPU time, no vsync.
Pessimistic and noisy (±1 ms between runs: the per-effect rows below do not order cleanly), but it
separates the presets and resolutions. 0 shader programs failed to compile in every shot.

| Shot | Output | Passes | AO samples | GI | SSR steps | Shadow map | Triangles | ms/frame |
|------|--------|--------|-----------|----|-----------|-----------|-----------|----------|
| Low | 1728×1080 | 1 | 0 | – | 0 | 1024 | 137 708 | 2.59 |
| Medium | 1728×1080 | 5 | 6 | – | 0 | 2048 | 138 964 | 4.08 |
| High | 1728×1080 | 6 | 8 | yes | 24 | 2048 | 140 726 | 6.55 |
| Ultra | 1728×1080 | 6 | 12 | yes | 40 | 4096 | 145 782 | 8.94 |
| High 480p | 768×480 | 6 | 8 | yes | 24 | 2048 | | 3.03 |
| High 720p | 1152×720 | 6 | 8 | yes | 24 | 2048 | | 3.86 |
| High 1440p | 2304×1440 | 6 | 8 | yes | 24 | 2048 | | 9.69 |
| High 2160p | 3456×2160 | 6 | 8 | yes | 24 | 2048 | | 20.48 |

(The window is 16:10, so "1080p" is 1728×1080 and "2160p" 3456×2160; on a 16:9 window 2160p is
3840×2160 — tested in `tests/render_quality_test.ts`.) 4K High at ~20 ms synced is over a 60 Hz
budget on an M1 Pro: use Medium (dynamic resolution) or 1440p there.

Light by time of day (pinned place Verdant Hills, day 200, fair; world region of the frame;
mean sRGB luminance / mean R−B warmth): noon 0.40 / +0.041, golden evening 0.30 / **+0.071**
(warmest), dusk 0.23 / −0.016, night 0.23 / −0.046 (coolest). A night vision review rated
readability 7/10 (was 2/10 before the night floors).

Climate (weather pinned per regime, sea-state target from the snapshot): agitation clear 0.10,
building 0.51 (looping 1), lull 0.25 (looping 1: the quiet before the storm), storm 0.97
(straightness 1), clearing 0.59. Drawn cloud cover tracks the requested cover within 0.03 for all six
planar types. Storm sky vision review: 7/10 (was 3/10 "stone mosaic" before the rim/darkness fix).

## Wave G2 — equations refined + situational events (2026-10-29)

**Equations (lane E, `docs/graphics/lane-E.md`):** the world equations are now continuous and
total. A Lipschitz probe (25 inputs × 6 seeds × 2000 steps) found **9 true discontinuities** before
(frozen ←T 100 % of range, summerness ←latitude 48.5 %, wetness ←T 41 %, albedo, GI, apparent
temperature, saturation, ambient, scene EV) and **0** after. Hard `step`/`select`/`floor` remain
only where a quantity is discrete by nature (Beaufort display number, precipitation kind). Handover
between weather regimes is C2 (smootherstep) with per-pair durations; inputs are periodic (hour,
day) or clamped, NaN/±∞ safe; `step(1e6 s)` 45.9 → 0.19 ms. New couplings: surface (radiative)
temperature → frost; wind disperses fog; storm towers raise gusts; rain evaporation cools via the
wet bulb; washed-out air after rain clears the sky; heat shimmer = hot × dry × sun × calm; frost and
snow raise albedo → GI and scene brightness.

**Situational events (`src/world/events/WorldEvents.ts`, maths in `src/core/Fuzzy.ts`):** 16
events (golden hour, blue hour, rainbow, 22° halo, the calm before the storm, thunderstorm,
lightning strike, fog bank, frost, heat shimmer, snowfall, moonrise, the moons meet, starry night, the
sun breaks through, gale). Each = fuzzy score (C2 ramps/windows, product t-norm AND, probabilistic
OR) → Schmitt gate (no flicker) → attack/hold/release envelope shaped by smootherstep (fades start
and end with zero slope; dt clamped so a returning tab fades rather than snaps). Effects compose
order-independently: multipliers as ∏(1 + k·e), tints as a normalised weighted mean.
Wired to: sky (double rainbow at 42°/51° around the antisolar point with Alexander's band, 22° halo
with red inner edge around the sun or the bright moon, star and moon-glow boosts), post composite
(grade tint, heat shimmer on far pixels only, snowfall, wind slant of rain/snow), toon materials
(frost / snow on up-facing surfaces, smooth value-noise drifts), fog distance, exposure,
saturation, audio (thunder after distance / 343 m/s, near = crack, far = rumble), HUD (most
important live event replaces the day phase).

**Rates at real game speed** (1 day = 24 min, Greywall lat 48, 60 spring days, drawn clouds):
golden hour 93, blue hour 87, moonrise 52, lightning strikes 42, starry night 25, halo 9, sun breaks
through 7, thunderstorm 5, lull 5, gale 5, frost 2, rainbow 2 (tightened from 129 in 90 days: needs
showery weather and a sun clearly out). Tested (`tests/world_events_test.ts`).

**Vision QA of staged events** (`PROBE_ONLY=events`): frost 8/10, halo 7/10, rainbow 5.5–6/10
(visible, red outside; secondary bow too faint to read), snowfall 5/10 (round flakes, ground dusted;
wind slant weak in a still), heat shimmer subtle in a still (it is a motion effect).

**Found and fixed along the way:** the climate's statistical `sunOcclusion` never lets the sun out
during rain (median 0.85) so rainbows/sun-breaks could never happen — the events take the DRAWN sun
occlusion; smootherstep rounds to 1 + 1e-15 just below 1 (clamped, tested); events lingered across
time jumps (reset on place/clock jumps); debugView `skyAim` is not sticky across calls.

## Honest gaps

- Ray tracing is screen-space only (nothing off screen is reflected); WebGPU/hardware RT not used.
- The climate's own render.sunMul / render.ambientMul double-count elevation, clouds and night with
  Environment; the engine uses only their non-overlapping parts (beam transmittance, rain curtain,
  ambient ratio to a clear sky at the same hour). Fog distances are real metres × 0.3.
- Exposure eye-adaptation is applied at half strength (0.8–1.3) so nights stay dark.
- Fade variants of toon materials (walls fading for the camera) lose the toon patch while fading.
- `UniformsUtils: Textures of render targets cannot be cloned` warning: the occlusion fade clones a
  cel material whose uniforms reference the shadow map; the variant re-shares the source uniforms
  right after, so it is harmless, but the warning is still printed once per faded material.
- Vision reviews disagree between rounds on shadows/AO; the pixel stats in this doc are the arbiter.
- Not verified by a human: the look in a real (non-headless) browser, at a real 4K display, by ear
  (thunder is synthesised noise, never listened to), on battery.
- Events are scored from the arena's sun occlusion; a rainbow is drawn wherever the antisolar point
  is, even if the shower is elsewhere. Lightning strikes are distance-estimated from the flash's
  sky direction and the cloud base, not from a simulated position.
- setPlace is still a teleport for temperature/humidity (events reset on purpose).
