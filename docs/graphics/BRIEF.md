# Mytherrania graphics + world-climate wave — shared brief (2026-10-29)

Project root: `/Users/macmax/Desktop/Mytherrania` (Deno 2.9 + TypeScript strict + three@0.180).
Baseline at dispatch: `deno task check` green, `deno task test` 964/964 pass.

## The request, decoded (voice-transcribed; phonetic drift resolved)

| Id  | Requirement | User's words (abridged) |
|-----|-------------|-------------------------|
| G01 | **Render resolution** choice with the usual presets up to 4K (480p, 720p, 900p, 1080p, 1440p, 1800p, 2160p) plus Auto. | "add a resolution (with the usual resolution until 4k)" |
| G02 | **SSAO** (screen-space ambient occlusion). | "SSAO" |
| G03 | **Global illumination**: sky/ground hemisphere irradiance + a one-bounce screen-space GI (colour bleeding). | "global illumination" |
| G04 | **Ray tracing**: screen-space ray-marched reflections (water, wet ground) and ray-marched contact shadows. Hardware RT is not available in WebGL — say so. | "ray tracing" |
| G05 | **Better cel shading**: received shadows, anti-aliased bands, hemisphere ambient, banded specular, screen-space ink edges on all geometry. | "improve the cel-shading" |
| G06 | **Textures / patterns / noise**: a noise ALGEBRA (every source + every operator), tileable baked textures, recipes per material. | "improve … the textures, their patterns, the noise generation and combinaison (using all the operators)" |
| G07 | **Spreading**: value spread (histogram stretched to a target p20..p80 spread) AND spatial spread (blue-noise scatter with Pareto sizes). | "the spreading" |
| G08 | **Polygons**: denser, better-shaped meshes where it reads (rocks, pillars, trees, sky), scaled by quality. | "the polygons" |
| G09 | **Optimisation**: quality presets, half-resolution effects, dynamic resolution, measured GPU cost. | "optimisation" |
| G10 | **Shadows**: bigger stable maps (texel-snapped), soft PCF, cel bodies receive shadows, cloud shadows on the ground. | "shadows" |
| G11 | **Skybox**: new physically-inspired sky (Rayleigh/Mie gradient, sun limb, stars). | "the skybox" |
| G12 | **Time + calendar** drive the sun: time flows during play; a Mytherrania calendar (months, seasons) sets the day of year -> solar declination. | "time, calendar influencing the sun" |
| G13 | **Two moons** with real phases and colours that change as they cross the sky (reddened near the horizon). | "2 moons and their colors though the sky" |
| G14 | **Clouds**: 4 layers, 7 cloud types, all cel-shaded. | "4 layers of clouds, 7 different types of clouds with cel-shading" |
| G15 | **Wind waves** change shape with the storm cycle: more sinusoidal, then more looping (trochoidal crests, crossing seas) until the quiet before the storm, then straighter (long-crested, wind-aligned). | "the wind waves getting more sinusoidal, more looping until the quiet before the storm and turning straighter" |
| G16 | **World variables at the top**: one table of every world variable; they interact through equations using ALL the operators and named coefficients. | "all the variables at the top, interacting with all them with all the operators and coefficient in mathematic equations" |
| G17 | **Real-world-derived variables**: climate normals generated from typical real weather by place, season and hour (temperature, humidity, pressure, wind, cloud, rain, thunder). | "based on the world variables derivated partially from the real world variables … generate real world variables … from typical weathers, time, seasons" |
| G18 | **Iconic dwell**: dawn, dusk, thunder and blue sky last longer than in reality; the transitions between them pass quickly. | "Spread the iconic times a bit longer than in reality" |

Drift glossary: "combinaison" = combination; "though the sky" = through the sky; "imrpove" = improve.

## Lanes

| Lane | Ids | Owns (may create/edit) | Must NOT touch |
|------|-----|------------------------|----------------|
| C (climate) | G12 G13 G14(model) G15(sea-state input) G16 G17 G18 | `src/world/climate/*.ts` EXCEPT `contracts.ts`; `tests/climate_*_test.ts`; `docs/graphics/lane-C.md` | everything else (engine, graphics, ui, existing tests, deno.json) |
| N (noise) | G06 G07 | `src/graphics/paint/NoiseAlgebra.ts`, `src/graphics/paint/Spread.ts`, `src/graphics/textures/*.ts`; `tests/noise_algebra_test.ts`, `tests/noise_spread_test.ts`, `tests/textures_*_test.ts`; `docs/graphics/lane-N.md` | everything else (Noise.ts is read-only: import it) |
| parent | G01–G05 G08–G11 G14(renderer) G15(waves) + all integration | engine, graphics shaders, sky, settings, Waves.ts, contracts | — |

Shared contract (read-only for lanes): `src/world/climate/contracts.ts`.

## House rules (all lanes)

- Pure modules: no THREE, no DOM in `src/world/climate/` or the lane-N pure files
  (`src/graphics/textures/*` may be pure too — the parent wraps arrays into THREE.DataTexture).
- Use `src/core/MathCore.ts` (clamp, lerp, smoothstep, damp, summarize, rng32, paretoSample …)
  instead of re-implementing. Seeded randomness only (`rng32(seed)`) — same seed, same output.
- Derive constants from named base parameters, with the equation in a comment. Report generated
  quantities as min / max / mean / median / p20 / p80 against a stated target spread.
- Every export must have a live caller in the end; integration is the parent's job, so say in
  your lane doc which exports the parent must call.
- Strict TS: `noUnusedLocals`, `noUnusedParameters`. Use `globalThis`, never `window`.
- Check/test ONLY your own files:
  `deno check <your files>` and `NO_COLOR=1 deno test --allow-read <your test files>`.
  Do not run the whole suite, do not run `deno task build`, do not `git commit`.
- Finish with `docs/graphics/lane-<X>.md`: what you built, the exported API, measured numbers
  (from real runs you made), and an honest gap list.
