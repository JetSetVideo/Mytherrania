# Wave TEX — the layer engine (lane L, contract C-MAT)

Files: `src/graphics/paint/{Channels,Operators,MaskAlgebra,LayerStack,Evaluate}.ts` (new, pure: no THREE, no DOM).
Tests: `tests/wave_tex_operators_test.ts` (TX1–TX10), `tests/wave_tex_layers_test.ts` (TX11–TX23).
Nothing existing was changed: `paintVertices`, `Blend.ts`, `PaintStack`, `PATTERNS`, `NoiseAlgebra` are untouched;
the v2 engine reads them.

```
deno test -A tests/wave_tex_operators_test.ts tests/wave_tex_layers_test.ts
WAVE_TEX_WRITE_DOC=1 deno test -A tests/wave_tex_layers_test.ts --filter TX23   # regenerate the tables below
```

## Model

- **Channel** (`Channels.ts`): `albedo` (sRGB-composited, delivered LINEAR in `color`), `roughness` (0 glossy … 1 matte),
  `height` (signed metres, ±8 mm), `ao` (multiplier), `subsurface` (thin-skin warmth), `emissive` (linear RGB), and
  `mask:<name>` scalar masks. Each declares range, default, neutral, space, storage and its attribute slot.
  `aMaterial` = vec4(roughness, height, ao, subsurface). The neutral values (0.5, 0, 1, 0) are lane R's "pre-TEX look"
  (R's dead zone, board Z-14): an albedo-only stack yields exactly them (TX13).
- **Layer** (`LayerStack.ts`): `{ kind:"layer", id, name, enabled, opacity, order?, source, mask?, regions?, writes[], stage? }`.
  The source is sampled once per vertex into (coverage, t); every write composites
  `value = lerp(colour|value, colour2|value2, t)` onto its channel with its operator and
  `alpha = clamp01(opacity) · coverage · mask · write.opacity`. One layer can darken albedo, lower roughness, raise
  height and set `mask:hairless` at once (a scar, TX14).
- **Sources**: constant, a v1 pattern (exactly the v1 sampler), a NoiseAlgebra expression, a mesh field
  (curvature / convex / concave / cavity / bodyHeight / up), a mark (lane M's vertex-level coverage by id).
- **Group**: `{ kind:"group", children, blend?: per-channel op }` — children composite on an ISOLATED transparent canvas
  (W3C source-over with backdrop alpha: `m = (1−αb)s + αb·B(cb,s)`, `αo = αs + αb(1−αs)`,
  `co = (αs·m + αb(1−αs)cb)/αo`), then the group lands on its parent with its opacity, mask and op.
  For normal-only content this equals the flat stack (associativity of normal-over, TX6 scalar, TX15 on a body: max
  error < 2·10⁻⁶ = float32 canvas rounding); with a multiply child the isolation is observable (TX15).
- **Order**: siblings evaluate bottom first, stably sorted by `order ?? index`.
- **Overrides** (lane U, `appearance.layerOverrides`): `applyLayerOverrides(stack, [{id, enabled?, opacity?, blend?, order?}])`
  returns a new stack; unknown ids ignored; NaN ignored; opacity clamped; `order` = new index among siblings (TX16).
  The order law: a moved node gets the key `order ∓ ½` (before/after the index it asks for), unmoved siblings keep
  their current index, ties break by current index, then all are renumbered 0..k−1. One move = "move this row to
  index k" exactly; several moves compose exactly when EVERY displaced sibling carries its new `order` (what U's
  inspector writes, TX72b 300/300); a lone hand-written `{order}` on a stack that already has moves can land elsewhere.
- **Evaluation** (`Evaluate.ts`): `evaluateStack(mesh, stack, { fields?, marks?, space?, background?, out? })` →
  `{ albedo (3n, linear), material (4n aMaterial), emissive? (3n), masks{name: n}, written[], fragment[] }`.
  Layers with `stage: "fragment"` skip the vertex pass and are listed in `fragment` (id, markId, writes, opacity ×
  every enclosing group's opacity, group path) for R's decal block (`FragmentDecal` / `packDecals`, board Z-14);
  M maps mark ids to decals.
- **v1 adapter**: `stackFromV1(PaintStack)` → one pattern layer per v1 layer writing albedo with the same mode
  (v1 codes 0..5 are the v2 codes 0..5). `evaluateStack(stackFromV1(s)).albedo` is **byte-identical** to
  `paintVertices(s)` (TX12: 125 stacks — every race × subrace × sign recipe on the mannequin, 12 recipes on 4 real
  bodies, all 10 patterns × 6 modes with regions, a custom background, the empty stack; linear and sRGB; compared as
  Uint32 bit patterns). Why it holds: the canvas is a Float32Array like v1's, the opaque composite is the v1
  expression `b + (B − b)·a`, the separable formulas for codes 0..5 are bit-identical to `blendChannelCode` on [0, 1]
  (TX2, 24 000 cases) and input saturation is the identity there.

## Operators

All pure and total: inputs are saturated (colour) or finite-ised (scalar: NaN → 0, ±∞ → ±10⁹) and results clamped to
the channel range — no NaN on any input including the 0/0 corners (TX3, TX8). Colour modes are defined in sRGB (the
W3C / Photoshop reference); `blendRgbLinear` is the linear-light variant; a write picks it with `space: "linear"`.
Scalar `screen`, `overlay`, `smoothstep`, `threshold` work on the range-normalised values u = (b−lo)/(hi−lo),
v = (s−lo)/(hi−lo); `invert` is lo + hi − b; the others act on raw channel units (so `add 0.001` on height is +1 mm).

**heightBlend** — "the taller layer wins, softly", as a C¹ quadratic smooth maximum:
smax_w(b, s') = b + w·g((s' − b)/w) with g(x) = 0 (x ≤ −1), (x + 1)²/4 (|x| < 1), x (x ≥ 1), and
r = b + a·(smax_w(b, s + p1) − b), w = |p0| the transition width in metres, p1 a lift added to the layer.
a = 0 is the identity; w = 0 is max(b, s + p1); outside the transition r is exactly the taller value; r is monotone
non-decreasing in s, b and a (0 violations in 3 × 4000 fuzzed steps, TX9) and commutative at a = 1, p1 = 0 because
g(−x) = g(x) − x (TX5). Inside the transition it overshoots max(b, s) by at most w/4 (at the crossing): being smooth
and monotone forces this — round 1's lerp-by-smoothstep stayed between b and s but dipped below the taller value when
the layer rose (QC OPS-12, 2015/50 000 pairs); fixed in round 2.

Laws pinned (seeded fuzz, ≥ 2000 cases each): identities (normal at α 0 bit-exact, multiply by white, screen by black,
add 0, every row of the identity column below; non-separable modes return C for B(C, C)); commutativity exactly where
the table says "yes", and a found counterexample for every "no"; associativity of normal-over and of multiply, screen,
add, darken, lighten, linearBurn (overlay counterexample); W3C reference values for hue/saturation/color/luminosity and
the separable light modes (TX7); determinism.

## Mask algebra

Masks are FIELDS over the mesh (one value per vertex) because feather and grow need neighbourhoods. Sources and
combinators are listed in the table below and documented in `MaskAlgebra.ts`.

- **feather(radiusMm)**: heat diffusion for time σ²/2 with σ = radius/2 (umbrella Laplacian, explicit Euler with dt
  sized for the median ring, per-vertex gain ≤ ½ so every step is a convex combination, ≤ 400 steps) = a Gaussian of standard deviation σ along the surface. Measured on a 1 mm grid: a 20 mm feather of
  a step has a 10–90 % width of 24.94 mm (Gaussian: 2.563σ = 25.63 mm); mass conserved within 2 % (TX19).
- **grow / shrink(mm)**: grey-scale geodesic dilation / erosion on the edge graph (mean edge h):
  grow_g(u)ᵢ = max(uᵢ, maxⱼ uⱼ·sat((g − dᵢⱼ)/h + min(1, g/h))), shrink_g(u) = 1 − grow_g(1 − u). Exact for that law
  (sources in decreasing value, a shared reach array prunes dominated paths). Continuous in g: 0.01 mm moves no value
  of a soft fBm mask by more than 0.01 (round 1 thresholded at ½ and jumped up to 0.606: QC MSK-3, fixed); monotone
  in u; grow(−x) = shrink(x); grow extensive, shrink anti-extensive. On a binary step (1 mm grid) grow 15 mm moves the
  ½ contour 15.07 mm and shrink 15 mm 15.07 mm (TX19). The edge-graph distance overestimates the geodesic by up to
  ~8 % on diagonals of a body mesh (not measured per mesh).
- Laws (TX18, 2000 pairs): and with 1 / or with 0 identities, De Morgan (min/max and product/probabilistic sum),
  invert involution, xor/subtract with 0 and 1, commutativity, feather 0 / grow 0 identity, mix at t = 0/1.
- Closure (TX17): 2000 random trees of depth ≤ 2 over every source and combinator (incl. NaN channel reads and a mark
  field returning ±10⁹) stay in [0, 1] and are deterministic.

## Performance (TX22, this M1, `deno test`)

12-layer stack (4 v1 pattern layers, fBm roughness, Worley pores into height, cavity wash into albedo + ao, convex edge
highlight, thin-skin subsurface, a garment group (2 children) under a 30 mm feathered region mask, a 4-channel scar,
2 fragment marks) on a 10 132-vertex human body: **median 29.0 ms** with cached `MeshFields`, 53 ms cold (adjacency,
curvature, cavity, ring lengths computed once per mesh). The same 12-layer v1 recipe: paintVertices 9.9 ms vs
evaluateStack 11.0 ms. Per-layer cost (5-run mean): a 4-octave fBm NoiseAlgebra source ≈ 5 ms, a Worley source ≈ 6 ms,
4 v1 pattern layers ≈ 7.5 ms, a 30 mm feathered group mask 2.5 ms (0.7 ms the feather itself, round 2: dt sized on the
median ring, ring lengths cached), field/constant layers 1.3–1.5 ms, empty stack 0.5 ms. This bench stack is heavier
than P's presets on purpose; lane R's bench times the real preset inside the rig-build budget (≤ +30 ms).
Inner loops allocate nothing (scratch per layer at setup; module-level scratch for the non-separable modes).

## Open points

- Fragment layers are lifted out of their groups (only the group opacity carries into `fragment[].opacity`);
  a group mask or a non-normal group op does not reach the shader.
- Mask `channel` and `height: channel` read the ROOT canvas as composited so far, not an enclosing group's canvas.
- Feather capped at 400 steps: radii above ≈ 20 × the median ring edge under-blur (≈ 300 mm on this body); rings
  smaller than the median saturate at gain ½ and diffuse slightly less than the exact law.
- Hostile JSON is total (TX24: unknown mask channel / write channel / op / source / pattern, NaN opacity, bad colours
  give finite output; round 1 threw on `{op:'channel', channel:'bogus'}`: QC STK-2, fixed).

## Generated tables

<!-- BEGIN GENERATED (tests/wave_tex_layers_test.ts) -->
### Channels

| id | kind | range | default | neutral | space | storage | attribute[component] |
|---|---|---|---|---|---|---|---|
| albedo | rgb | [0, 1] | (0.502, 0.502, 0.502) | (0.502, 0.502, 0.502) | srgb | vertex+fragment | color[0] |
| roughness | scalar | [0, 1] | 0.5 | 0.5 | scalar | vertex+fragment | aMaterial[0] |
| height | scalar | [-0.008, 0.008] | 0 | 0 | scalar | vertex+fragment | aMaterial[1] |
| ao | scalar | [0, 1] | 1 | 1 | scalar | vertex | aMaterial[2] |
| subsurface | scalar | [0, 1] | 0 | 0 | scalar | vertex | aMaterial[3] |
| emissive | rgb | [0, 1] | (0, 0, 0) | (0, 0, 0) | linear | vertex+fragment | aEmissive[0] |
| mask:<name> | scalar | [0, 1] | 0 | 0 | scalar | vertex | masks[name] |

### Colour blend modes (25 + alias linearDodge = add)

| mode | kind | B(b, s) | commutative | identity |
|---|---|---|---|---|
| normal | separable | s | no | alpha = 0 |
| multiply | separable | b·s | yes | s = 1 (white) |
| screen | separable | 1 − (1−b)(1−s) | yes | s = 0 (black) |
| overlay | separable | b<½ ? 2bs : 1−2(1−b)(1−s) | no | s = ½ |
| softLight | separable | s<½ ? 2bs+b²(1−2s) : 2b(1−s)+√b(2s−1) (Photoshop, v1) | no | s = ½ |
| add | separable | min(1, b+s) (= linearDodge) | yes | s = 0 |
| hardLight | separable | s<½ ? 2bs : 1−2(1−b)(1−s) | no | s = ½ |
| vividLight | separable | s<½ ? colorBurn(b,2s) : colorDodge(b,2s−1) | no | s = ½ |
| linearLight | separable | clamp(b + 2s − 1) | no | s = ½ |
| pinLight | separable | s<½ ? min(b,2s) : max(b,2s−1) | no | s = ½ |
| hardMix | separable | b+s ≥ 1 ? 1 : 0 | yes | — |
| colorDodge | separable | b=0 ? 0 : s=1 ? 1 : min(1, b/(1−s)) | no | s = 0 |
| colorBurn | separable | b=1 ? 1 : s=0 ? 0 : 1 − min(1,(1−b)/s) | no | s = 1 |
| linearBurn | separable | max(0, b+s−1) | yes | s = 1 |
| darken | separable | min(b, s) | yes | s = 1 |
| lighten | separable | max(b, s) | yes | s = 0 |
| difference | separable | \|b − s\| | yes | s = 0 |
| exclusion | separable | b + s − 2bs | yes | s = 0 |
| subtract | separable | max(0, b − s) | no | s = 0 |
| divide | separable | s=0 ? (b=0 ? 0 : 1) : min(1, b/s) | no | s = 1 |
| softLightW3C | separable | W3C soft light (D(b) = b≤¼ ? ((16b−12)b+4)b : √b) | no | s = ½ |
| hue | non-separable | SetLum(SetSat(Cs, Sat(Cb)), Lum(Cb)) | no | — |
| saturation | non-separable | SetLum(SetSat(Cb, Sat(Cs)), Lum(Cb)) | no | — |
| color | non-separable | SetLum(Cs, Lum(Cb)) | no | — |
| luminosity | non-separable | SetLum(Cb, Lum(Cs)) | no | — |

### Scalar ops (19)

| op | op(b, s) | commutative | identity |
|---|---|---|---|
| replace | s | no | alpha = 0 |
| add | b + s | yes | s = 0 |
| subtract | b − s | no | s = 0 |
| multiply | b·s | yes | s = 1 |
| divide | b / (\|s\|<1e−6 ? ±1e−6 : s) | no | s = 1 |
| min | min(b, s) | yes | s = hi |
| max | max(b, s) | yes | s = lo |
| average | (b + s)/2 | yes | — |
| lerp | b + (s − b)·p0 (commutes only at p0 = ½) | no | p0 = 0 |
| screen | lo + (hi−lo)(1 − (1−u)(1−v)) | yes | s = lo |
| overlay | lo + (hi−lo)·overlay(u, v) | no | v = ½ |
| difference | \|b − s\| | yes | — |
| power | sign(b)\|b\|^clamp(s,0,64) | no | s = 1 |
| clamp | clamp(b, min(p0,p1), max(p0,p1)) | no | — |
| remap | p2 + (p3−p2)·clamp01((b−p0)/(p1−p0)) | no | — |
| smoothstep | lo + (hi−lo)·S(p0, p1, u) | no | — |
| threshold | lo + (hi−lo)·S(p0−p1, p0+p1, u) | no | — |
| invert | lo + hi − b | no | — |
| heightBlend | b + a·(smax_w(b, s + p1) − b), smax_w(x,y) = x + w·g((y−x)/w), g = 0 (x ≤ −1), (x+1)²/4 (\|x\| < 1), x (x ≥ 1), w = \|p0\| | yes | alpha = 0 |

### Mask algebra

Sources (11): constant, region, curvature, ao, height, noise, pattern, mark, direction, distance, channel.

Combinators (12): and, or, xor, subtract, invert, feather, grow, shrink, remap, threshold, scale, mix.
<!-- END GENERATED -->
