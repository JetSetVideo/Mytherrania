// Wave GEN lane U — the Creator's generator UI (SPEC G70-G79): pure parts only. The browser half (each stage drawn,
// canvas hash per stage, mouse/touch drags clamped, stat what-if rebuild latency, fit at 320..2560 px) is
// tools/probe-wave-gen-ui.ts.
// @deno-types="@types/three"
import * as THREE from "three";
import {
  applyEdit, BMI_BAND, BODY_KEYS, bandFor, bodyState, constrain, HEAD_BAND, raceBmi, RULE_EPS, RULES, settle, slacks, specOf, staticBand, valueOf,
  violations, withValue, type BodyState,
} from "../src/ui/Constraints.ts";
import { isScrubGesture, pxPerStep, SCRUB_FINE, SCRUB_MAX_PX_PER_STEP, SCRUB_MIN_PX_PER_STEP, SCRUB_THRESHOLD_PX, SCRUB_THRESHOLD_TOUCH_PX, scrubTarget, stepDecimals } from "../src/ui/DragScrub.ts";
import { GEN_STAGE_IDS, isGenStage, KEY_METRICS, metricLabel, metricValue, nextStageIndex, partialStages, READOUT_MAX, stageReadout, stageReadoutHtml, stageScrubberHtml, totalMs } from "../src/ui/GenStages.ts";
import { clampGenStat, clampGenStats, GEN_STAT_KEYS, parseWhatIf, statFraction, statViewHtml, whatIfAttr } from "../src/ui/StatView.ts";
import { STAGE_IDS, generateStaged } from "../src/graphics/body/Pipeline.ts";
import { buildStageView, inflateMeshOf, previewBody, previewKey, previewKeyWith } from "../src/graphics/PreviewScene.ts";
import { generatorStats } from "../src/game/StatScale.ts";
import { heightBand, weightBand } from "../src/ui/CreatorSync.ts";
import { proportionsFor } from "../src/graphics/body/Proportions.ts";
import { PRESETS, profileBodyStats, type CharacterProfile } from "../src/game/Characters.ts";
import { rng32 } from "../src/core/MathCore.ts";

function assert(c: unknown, msg: string): asserts c {
  if (!c) throw new Error(msg);
}
const RACES: [string, string | null][] = [["human", null], ["elf", null], ["dwarf", null], ["ork", null], ["human", "islander"], ["dwarf", "mountain"], ["ork", "bloodfang"], ["elf", "high"]];
const SEXES = ["male", "female"] as const;
const mid = (r: string, s: string | null, sex: "male" | "female"): BodyState => {
  const hb = heightBand(r, s), wb = weightBand(r, s);
  return bodyState({ race: r, subrace: s, sex, height: (hb[0] + hb[1]) / 2, weight: (wb[0] + wb[1]) / 2 });
};
/** A seeded random LEGAL state: every number drawn inside its static band, then settled. */
function randomState(rng: () => number, r: string, s: string | null, sex: "male" | "female"): BodyState {
  let st = mid(r, s, sex);
  for (const k of BODY_KEYS) { const [lo, hi] = staticBand(st, k); st = withValue(st, k, lo + (hi - lo) * rng()); }
  return settle(st).state;
}

Deno.test("SPEC G70: every race x sex reference body breaks no rule, and every number's band holds its current value", () => {
  let n = 0;
  for (const [r, s] of RACES) for (const sex of SEXES) {
    const st = mid(r, s, sex);
    assert(violations(st).length === 0, `${r}/${s}/${sex}: ${violations(st).join(",")} (slacks ${JSON.stringify(slacks(st))})`);
    for (const k of BODY_KEYS) {
      const b = bandFor(st, k), v = valueOf(st, k);
      assert(b.feasible && b.min <= v + 1e-9 && v <= b.max + 1e-9, `${r}/${sex} ${k}=${v} in [${b.min}, ${b.max}]`);
      assert(b.min >= b.staticMin - 1e-12 && b.max <= b.staticMax + 1e-12, `${k}: the neighbour band lies inside the static band`);
      n++;
    }
  }
  console.log(`G70: ${RACES.length * 2} bodies x ${BODY_KEYS.length} numbers = ${n} bands, 0 violations`);
});

Deno.test("SPEC G71: band edges are exact — the rule that stops a number holds AT the edge and breaks just past it (seeded states)", () => {
  const rng = rng32(7071);
  let edges = 0, ruled = 0;
  for (const [r, s] of RACES) for (const sex of SEXES) for (let t = 0; t < 3; t++) {
    const st = randomState(rng, r, s, sex);
    assert(violations(st).length === 0, `${r}/${sex} settled state is legal`);
    for (const k of BODY_KEYS) {
      const b = bandFor(st, k);
      for (const [edge, by, dir] of [[b.min, b.lowBy, -1], [b.max, b.highBy, 1]] as const) {
        const at = withValue(st, k, edge), sl = slacks(at);
        for (const rule of RULES.filter((q) => q.clamps.includes(k))) assert(sl[rule.id] >= -RULE_EPS, `${k} edge ${edge}: ${rule.id} holds (${sl[rule.id]})`);
        edges++;
        if (by.length) {
          ruled++;
          const past = withValue(st, k, edge + dir * Math.max(1e-4, Math.abs(edge) * 1e-3));
          assert(by.some((id) => slacks(past)[id] < 0), `${k} just past ${edge}: ${by.join(",")} breaks`);
        }
      }
    }
  }
  console.log(`G71: ${edges} band edges checked, ${ruled} set by a neighbour rule (the rest by the static band)`);
  assert(ruled > 0, "some band edges come from neighbour rules");
});

Deno.test("SPEC G72: waist <= hips — the hips' lower limit moves with the waist (a neighbour clamp, measured on Proportions)", () => {
  const st = mid("dwarf", "mountain", "male");
  const b = bandFor(st, "hip");
  assert(b.lowBy.includes("waist<=hips"), `mountain dwarf: the hips' floor is set by the waist (lowBy ${b.lowBy})`);
  const p = proportionsFor(specOf(withValue(st, "hip", b.min)));
  assert(Math.abs(p.halfWidth.hip - p.halfWidth.waist) < 1e-4, `at the floor hip ${p.halfWidth.hip} == waist ${p.halfWidth.waist} (within 0.1 mm)`);
  // A pinched waist (a larger pinch = a narrower waist) frees the hips: the floor drops.
  const pinched = withValue(st, "waist", staticBand(st, "waist")[1]);
  assert(bandFor(pinched, "hip").min < b.min - 1e-6, "a narrower waist lowers the hips' floor");
  const c = constrain(st, "hip", 0);
  assert(Math.abs(c.value - b.min) < 1e-12 && c.clampedBy === "waist<=hips", `asking for no hips stops at the waist (${c.clampedBy})`);
  console.log(`G72: mountain dwarf hip floor ${b.min.toFixed(4)} (static ${b.staticMin.toFixed(4)}), with the waist pinched ${bandFor(pinched, "hip").min.toFixed(4)}`);
});

Deno.test("SPEC G73: weight within the BMI band of the height — the band is BMI_BAND x the race's mid BMI x height^2", () => {
  for (const [r, s] of RACES) {
    const hb = heightBand(r, s), wb = weightBand(r, s), c = raceBmi(r, s);
    let prevMin = -Infinity;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const st = withValue(mid(r, s, "male"), "height", hb[0] + (hb[1] - hb[0]) * t), h = st.height;
      const b = bandFor(st, "weight");
      const lo = Math.max(wb[0], BMI_BAND[0] * c * h * h), hi = Math.min(wb[1], BMI_BAND[1] * c * h * h);
      assert(Math.abs(b.min - lo) < 0.01 && Math.abs(b.max - hi) < 0.01, `${r} h=${h.toFixed(2)}: band [${b.min.toFixed(2)}, ${b.max.toFixed(2)}] vs [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
      assert(b.min >= prevMin - 1e-9, "a taller body never allows a lighter floor");
      prevMin = b.min;
    }
  }
});

Deno.test("SPEC G74: a height edit is a DRIVER — the height is kept and the weight / head settle into their new bands", () => {
  let settledWeight = 0, settledHead = 0;
  for (const [r, s] of RACES) for (const sex of SEXES) {
    const st = mid(r, s, sex), [lo, hi] = staticBand(st, "height");
    for (const h of [lo, hi]) {
      const e = applyEdit(withValue(st, "weight", staticBand(st, "weight")[0]), "height", h);
      assert(Math.abs(e.value - h) < 1e-12, `${r}: the height ${h} is not refused by the weight (got ${e.value})`);
      assert(violations(e.state).length === 0, `${r}/${sex} h=${h}: ${violations(e.state)}`);
      if (e.settled.includes("weight")) settledWeight++;
      if (e.settled.includes("head")) settledHead++;
    }
  }
  // The head band depends on the height: the tallest body allows a smaller maximum head than the shortest.
  const st = mid("human", null, "male"), [lo, hi] = staticBand(st, "height");
  const short = bandFor(withValue(st, "height", lo), "head"), tall = bandFor(withValue(st, "height", hi), "head");
  assert(tall.max < short.max - 1e-3 && tall.highBy.includes("head~height"), `head max ${tall.max.toFixed(3)} (tall) < ${short.max.toFixed(3)} (short), set by head~height`);
  assert(HEAD_BAND[0] < 1 && HEAD_BAND[1] > 1, "the reference head is inside its band");
  console.log(`G74: weight settled in ${settledWeight}, head in ${settledHead} of ${RACES.length * 4} extreme height edits; human head max short ${short.max.toFixed(3)} / tall ${tall.max.toFixed(3)}`);
  assert(settledWeight > 0 && settledHead > 0, "both dependents actually settle somewhere");
});

Deno.test("SPEC G75: drag-to-scrub arithmetic — whole steps from the start, clamped, Shift is finer, a short or vertical travel is no drag", () => {
  assert(pxPerStep(1.5, 2.1, 0.01) >= SCRUB_MIN_PX_PER_STEP && pxPerStep(1.5, 2.1, 0.01) <= SCRUB_MAX_PX_PER_STEP, "px per step inside its bounds");
  assert(pxPerStep(1, 20, 1) === SCRUB_MAX_PX_PER_STEP || pxPerStep(1, 20, 1) === 260 / 19, "a 19-step band spans <= SCRUB_SPAN_PX");
  const o = { min: 1.5, max: 2.1, step: 0.01, px: 4 };
  assert(scrubTarget(1.8, 0, o) === 1.8 && scrubTarget(1.8, 3.9, o) === 1.8, "under one step: unchanged");
  assert(scrubTarget(1.8, 40, o) === 1.9 && scrubTarget(1.8, -40, o) === 1.7, `10 steps either way (${scrubTarget(1.8, 40, o)})`);
  assert(scrubTarget(1.8, 4000, o) === 2.1 && scrubTarget(1.8, -4000, o) === 1.5, "clamped to the input's band");
  assert(scrubTarget(1.8, 40, { ...o, fine: true }) === Number((1.8 + 0.01 * Math.trunc(40 / (4 * SCRUB_FINE))).toFixed(2)), "Shift = SCRUB_FINE x finer");
  assert(scrubTarget(0.091, 9, { min: 0.091, max: 0.109, step: 0.002, px: 3 }) === 0.097, "no float noise on a 0.002 grid");
  assert(stepDecimals(0.002) === 3 && stepDecimals(1) === 0 && stepDecimals(1e-7) === 7, "step decimals");
  assert(!isScrubGesture(SCRUB_THRESHOLD_PX - 1, 0, "mouse") && isScrubGesture(SCRUB_THRESHOLD_PX, 0, "mouse"), "mouse threshold");
  assert(!isScrubGesture(SCRUB_THRESHOLD_TOUCH_PX - 1, 0, "touch") && isScrubGesture(SCRUB_THRESHOLD_TOUCH_PX, 0, "touch"), "touch threshold is longer");
  assert(!isScrubGesture(10, 12, "touch"), "a mostly vertical swipe stays a scroll");
});

Deno.test("SPEC G76: the stage scrubber — the pipeline's seven stages in order, a radio group, readouts with ms + key metrics, CSP-safe", () => {
  assert(JSON.stringify(GEN_STAGE_IDS) === JSON.stringify(STAGE_IDS), "the UI's stages ARE the pipeline's (Pipeline.STAGE_IDS)");
  const html = stageScrubberHtml("cage");
  assert(!/style=/.test(html), "no inline style (CSP style-src 'self')");
  assert((html.match(/role="radio"/g) ?? []).length === 7 && (html.match(/aria-checked="true"/g) ?? []).length === 1 && /data-gen-stage="cage" aria-checked="true"/.test(html), "7 radios, one checked");
  assert(nextStageIndex(6, "ArrowRight") === 0 && nextStageIndex(0, "ArrowLeft") === 6 && nextStageIndex(3, "Home") === 0 && nextStageIndex(3, "End") === 6 && nextStageIndex(3, "a") === null, "arrow keys wrap");
  assert(isGenStage("skin") && !isGenStage("Skin") && !isGenStage(null), "isGenStage");
  const recs = [{ id: "cage", label: "Cage", ms: 1.234, metrics: { meanWidthMm: 251.4, parts: 16, other: 0.5, extra: 2, more: 3 }, warnings: ["w"] }];
  const ro = stageReadout("cage", recs)!;
  assert(ro.metrics[0].key === "parts" && ro.metrics[1].key === "meanWidthMm" && ro.metrics.length === READOUT_MAX, `key metrics first (${ro.metrics.map((m) => m.key)})`);
  assert(ro.ms === "1.2 ms" && metricLabel("meanWidthMm") === "Mean width (mm)" && metricLabel("armAbductionDeg") === "Arm abduction (°)" && metricValue(16) === "16" && metricValue(0.4677) === "0.468", "formatting");
  assert(stageReadout("skin", recs) === null && totalMs(recs) === 1.234, "absent stage -> null; total");
  assert(!/style=/.test(stageReadoutHtml(ro, 10)) && /<dl/.test(stageReadoutHtml(ro, 10)), "readout markup");
  assert(partialStages([{ ...recs[0], warnings: ["skipped (option hitboxes: false)"] }]) && !partialStages(recs) && /so far/.test(stageReadoutHtml(ro, 10, true)), "a skipped stage marks the total 'so far'");
  for (const id of GEN_STAGE_IDS) assert(KEY_METRICS[id].length > 0, `${id} names its key metrics`);
});

Deno.test("SPEC G77: the 0..1000 stat view — clamped integers, the what-if attribute is empty at the fighter's own numbers, CSP-safe", () => {
  assert(clampGenStat(-5) === 0 && clampGenStat(1004.6) === 1000 && clampGenStat(NaN, 321) === 321 && clampGenStat(499.5) === 500, "clamp");
  const base = { strength: 640, agility: 410, intelligence: 450, level: 500 };
  assert(whatIfAttr(base, { ...base }) === "", "no override at the base");
  const w = whatIfAttr(base, { ...base, strength: 900 });
  assert(JSON.stringify(parseWhatIf(w)) === JSON.stringify({ ...base, strength: 900 }) && parseWhatIf("") === null && parseWhatIf("{bad") === null && parseWhatIf('{"strength":1}') === null, "round trip / malformed");
  assert(JSON.stringify(clampGenStats({ strength: 2000 }, base)) === JSON.stringify({ ...base, strength: 1000 }), "missing keys from the base");
  assert(statFraction(250) === 0.25, "bar fraction");
  const html = statViewHtml(generatorStats(PRESETS[0]));
  assert(!/style=/.test(html), "no inline style");
  for (const k of GEN_STAT_KEYS) assert(new RegExp(`id="gen-stat-${k}"[^>]*min="0" max="1000"`).test(html), `${k} input 0..1000`);
});

Deno.test("SPEC G78: every stage view builds from the real pipeline — distinct content, T-pose arms, one capsule per hitbox, finite geometry", () => {
  const profile: CharacterProfile = { ...PRESETS[0] };
  const { spec } = previewBody(profile);
  const staged = generateStaged(spec, { hitboxes: true, coverageStride: 8 });
  const sig: string[] = [];
  for (const id of GEN_STAGE_IDS) {
    const g = buildStageView(staged, id, id === "inflate" ? { inflateMesh: inflateMeshOf(staged) } : {});
    const names: string[] = [];
    let verts = 0, finite = true;
    g.traverse((o: THREE.Object3D) => {
      if (o !== g && o.name) names.push(o.name);
      const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      const pos = geo?.attributes?.position;
      if (pos) { verts += pos.count; for (let i = 0; i < pos.array.length; i += 97) if (!Number.isFinite(pos.array[i])) finite = false; }
    });
    assert(finite, `${id}: finite positions`);
    if (id === "paint") { assert(names.length === 0, "paint = the rig itself (empty view)"); continue; }
    assert(names.length > 0 && verts > 0, `${id}: non-empty (${names})`);
    sig.push(`${names.join("+")}:${verts}`);
  }
  assert(new Set(sig).size === sig.length, `six distinct views (${sig.join(" | ")})`);
  // T-pose: the elbow joint bead is at shoulder height (the bind pose's arms hang down by the abduction).
  const sk = buildStageView(staged, "skeleton");
  const bones = (sk.getObjectByName("skeleton-bones") as THREE.LineSegments).geometry.attributes.position;
  const sh = staged.carved.bones.findIndex((b) => b.id === "shoulderL"), el = staged.carved.bones.findIndex((b) => b.id === "elbowL");
  assert(Math.abs(bones.getY(2 * sh) - bones.getY(2 * el)) < 0.02, `T-pose: elbow y ${bones.getY(2 * el).toFixed(3)} ~ shoulder y ${bones.getY(2 * sh).toFixed(3)}`);
  const hb = buildStageView(staged, "hitboxes").getObjectByName("hitboxes-capsules")!;
  assert(hb.children.length === staged.hitboxes!.boxes.length && hb.children.length > 10, `one capsule per hitbox (${hb.children.length})`);
  console.log(`G78: ${sig.join(" | ")}`);
});

Deno.test("SPEC G79: the preview builds with the generator stats (StatScale), and an attribute or what-if change rebuilds it", () => {
  const p: CharacterProfile = { ...PRESETS[0] };
  const { spec } = previewBody(p);
  assert(JSON.stringify(spec.stats) === JSON.stringify(profileBodyStats(p)) && JSON.stringify(spec.stats) === JSON.stringify(generatorStats(p)), "spec.stats = the Engine's profileBodyStats(profile) = StatScale.generatorStats");
  const k0 = previewKey(p);
  const strong: CharacterProfile = { ...p, allocated: { ...(p.allocated ?? {}), strength: 18 } };
  assert(previewKey(strong) !== k0, "an attribute edit changes the preview key (the model rebuilds)");
  const whatIf = { ...generatorStats(p), intelligence: 950 };
  assert(previewKeyWith(p, whatIf) !== k0 && JSON.stringify(previewBody(p, whatIf).spec.stats) === JSON.stringify(whatIf), "a what-if changes the key and reaches the spec");
  assert(previewKeyWith(p, generatorStats(p)) === k0 && previewKey(p) === previewKeyWith(p, null), "a what-if equal to the fighter's own stats is no change");
});

