// Wave TEX lane M: scars and tattoos (src/graphics/paint/marks/{Scar,Tattoo,Placement,MarkLibrary}.ts and
// Appearance.marks). SPEC TX40-TX59. Pins the CONTRACT C-MARK (docs/wave-tex/BRIEF.md): determinism, bounds,
// stage monotonicity (older scars paler and flatter), Langer orientation, no overlap, face rule, save/load
// round trip, ancestry frequencies, decals in R's layout and layers in L's API. Prints the measured numbers.
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { REGIONS, type MeshData } from "../src/graphics/body/contracts.ts";
import type { CharacterProfile } from "../src/game/Characters.ts";
import { createFromCharacter, libraryEntries } from "../src/game/ProfileLibrary.ts";
import { ProfileRepo } from "../src/game/Profiles.ts";
import { evaluateStack } from "../src/graphics/paint/Evaluate.ts";
import { type LayerStackV2, validateStack } from "../src/graphics/paint/LayerStack.ts";
import { TATTOO_SYMBOLS } from "../src/graphics/paint/Symbols.ts";
import { DECAL_MAX, packDecals } from "../src/graphics/shaders/MaterialChannels.ts";
import {
  defaultMarks, generatedStats, hairlessAt, hairlessMask, markFields, marksForProfile, marksTables, marksToDecals,
  marksToFragmentDecals, marksToLayers, type MarkSet, mirrorMark, resolveMarks, sanitizeMarks, validateMarks,
} from "../src/graphics/paint/marks/MarkLibrary.ts";
import {
  anchorAt, faceZonesFromAnchors, footprintOf, footprintPoints, frameOf, MARK_REGIONS, pointToFrameMm, nominalFrames, overlapFraction, type PlacementItem, regionFrames,
  regionIssues, solvePlacement, uvToMm,
} from "../src/graphics/paint/marks/Placement.ts";
import {
  gapeFactor, hypertrophicChance, inkContrast, keloidChance, langerAngle, luma, rgbDistance, SCAR_KINDS, SCAR_STAGES, type Scar, sampleScar,
  scarColour, scarExtentMm, scarLook, scarStage, STAGE_START_DAYS, SUTURE_BITE_MM, SUTURE_PITCH_MM,
} from "../src/graphics/paint/marks/Scar.ts";
import {
  INK_NAMES, inkAge, motifsFor, sampleTattoo, type Tattoo, TATTOO_STYLES, tattooExtentMm,
} from "../src/graphics/paint/marks/Tattoo.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const HALF_PI = Math.PI / 2;
const SKINS: [string, number[]][] = [["human", [0.78, 0.6, 0.5]], ["elf", [0.9, 0.82, 0.75]], ["dwarf", [0.63, 0.42, 0.3]], ["ork", [0.36, 0.48, 0.24]], ["dark", [0.2, 0.15, 0.12]]];
const DAYS = [0, 1, 2, 4, 7, 14, 21, 30, 60, 90, 180, 365, 730, 1825, 3650, 36500];
const CLASSES = ["Barbarian", "Warrior", "Rogue", "Assassin", "Mage", "Necromancer", "Archer", "Priest"];
const RACES = ["human", "elf", "dwarf", "ork"];

/** Exact point-to-triangle distance (Ericson, Real-Time Collision Detection 5.1.5), min over the mesh. */
function distanceToMesh(mesh: MeshData, p: readonly number[]): number {
  const P = mesh.positions, I = mesh.indices;
  let best = Infinity;
  const v = (i: number) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const sub = (a: number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let t = 0; t < I.length; t += 3) {
    const a = v(I[t]), b = v(I[t + 1]), c = v(I[t + 2]);
    if (Math.hypot(...sub(a, p)) > best + 0.1) continue;
    const ab = sub(b, a), ac = sub(c, a), ap = sub([p[0], p[1], p[2]], a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    let q: number[];
    if (d1 <= 0 && d2 <= 0) q = a;
    else {
      const bp = sub([p[0], p[1], p[2]], b), d3 = dot(ab, bp), d4 = dot(ac, bp);
      if (d3 >= 0 && d4 <= d3) q = b;
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const w = d1 / (d1 - d3); q = [a[0] + w * ab[0], a[1] + w * ab[1], a[2] + w * ab[2]]; }
        else {
          const cp = sub([p[0], p[1], p[2]], c), d5 = dot(ab, cp), d6 = dot(ac, cp);
          if (d6 >= 0 && d5 <= d6) q = c;
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
              } else {
                const den = 1 / (va + vb + vc), vv = vb * den, ww = vc * den;
                q = [a[0] + ab[0] * vv + ac[0] * ww, a[1] + ab[1] * vv + ac[1] * ww, a[2] + ab[2] * vv + ac[2] * ww];
              }
            }
          }
        }
      }
    }
    best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
  }
  return best;
}

let meshCache: MeshData | null = null;
function humanMesh(): MeshData {
  return meshCache ??= generateBody({ race: "human", subrace: null, className: "Warrior", height: 1.8, weight: 80, seed: 3 }).mesh;
}

Deno.test("TX40 marks: the C-MARK enums are exactly the brief's", () => {
  assert(JSON.stringify(SCAR_KINDS) === JSON.stringify(["incision", "laceration", "claw", "puncture", "burn", "stitched"]), "scar kinds");
  assert(JSON.stringify(TATTOO_STYLES) === JSON.stringify(["tribal", "runic", "sigil", "band", "script", "dotwork"]), "tattoo styles");
  assert(JSON.stringify(INK_NAMES) === JSON.stringify(["black", "blueBlack", "red", "ochre", "woad"]), "inks");
  assert(JSON.stringify(SCAR_STAGES) === JSON.stringify(["inflammatory", "proliferative", "remodelling", "mature"]), "stages");
  for (const r of MARK_REGIONS) assert((REGIONS as readonly string[]).includes(r), `region ${r}`);
  assert(!MARK_REGIONS.includes("hair") && !MARK_REGIONS.includes("nail") && !MARK_REGIONS.includes("sole"), "no marks on hair/nail/sole");
});

Deno.test("TX41 marks: generation, resolution and decals are deterministic from the seed", () => {
  let differ = 0;
  for (let s = 1; s <= 200; s++) {
    const inp = { race: RACES[s % 4], subrace: null, className: CLASSES[s % 8], birthsign: "storm", ageYears: null, seed: s };
    const a = JSON.stringify(defaultMarks(inp)), b = JSON.stringify(defaultMarks(inp));
    assert(a === b, `seed ${s} not deterministic`);
    if (a !== JSON.stringify(defaultMarks({ ...inp, seed: s + 1000 }))) differ++;
  }
  assert(differ > 150, `seeds should differ (${differ}/200)`);
  const set = defaultMarks({ race: "ork", className: "Barbarian", seed: 42, ageYears: 35 });
  const d1 = JSON.stringify(marksToDecals(resolveMarks(set, { race: "ork" })));
  const d2 = JSON.stringify(marksToDecals(resolveMarks(set, { race: "ork" })));
  assert(d1 === d2, "decals deterministic");
  console.log(`  200 seeds deterministic; ${differ}/200 differ from seed+1000`);
});

Deno.test("TX42 marks: stage boundaries follow wound healing (inflammation < 4 d, proliferation < 21 d, remodelling < 1 y)", () => {
  assert(scarStage(0) === "inflammatory" && scarStage(3.9) === "inflammatory", "inflammatory");
  assert(scarStage(4) === "proliferative" && scarStage(20) === "proliferative", "proliferative");
  assert(scarStage(21) === "remodelling" && scarStage(364) === "remodelling", "remodelling");
  assert(scarStage(365) === "mature" && scarStage(1e5) === "mature", "mature");
  assert(scarStage(NaN) === "inflammatory", "NaN safe");
  assert(STAGE_START_DAYS.proliferative < STAGE_START_DAYS.remodelling && STAGE_START_DAYS.remodelling < STAGE_START_DAYS.mature, "ordered");
});

Deno.test("TX43 marks: older scars are paler and flatter (monotone over age, every kind, every skin)", () => {
  let checks = 0;
  for (const kind of SCAR_KINDS) {
    for (let i = 1; i < DAYS.length; i++) {
      const a = scarLook(kind, DAYS[i - 1]), b = scarLook(kind, DAYS[i]);
      assert(b.redness <= a.redness + 1e-12, `${kind} redness rises ${DAYS[i]}`);
      assert(b.heightMm <= a.heightMm + 1e-12, `${kind} height rises ${DAYS[i]}`);
      assert(b.lift >= a.lift - 1e-12 && b.desat >= a.desat - 1e-12, `${kind} paleness falls ${DAYS[i]}`);
      for (const [name, skin] of SKINS) {
        const la = luma(scarColour(skin, a)), lb = luma(scarColour(skin, b));
        // Paler = lighter (luma non-decreasing), from the red day-0 wound to the silver mature line.
        assert(lb >= la - 1e-9, `${kind} ${name} luma falls ${DAYS[i - 1]}->${DAYS[i]}: ${la} -> ${lb}`);
        checks++;
      }
      assert(b.roughnessScale < 1 && a.roughnessScale < 1, "scar tissue is always shinier than skin");
    }
    assert(scarLook(kind, 3650).heightMm <= 0.001, `${kind}: a mature normal scar is flat or atrophic`);
  }
  const fresh = scarLook("incision", 1), mature = scarLook("incision", 730);
  console.log(`  ${checks} luma checks; incision day 1 redness ${fresh.redness.toFixed(3)} h ${fresh.heightMm.toFixed(2)} mm -> 2 y redness ${mature.redness.toFixed(3)} h ${mature.heightMm.toFixed(3)} mm`);
});

Deno.test("TX44 marks: inflammatory red > proliferative pink > mature pale; punctures heal atrophic", () => {
  const inf = scarLook("laceration", 2), pro = scarLook("laceration", 14), mat = scarLook("laceration", 730);
  assert(inf.redness > pro.redness && pro.redness > mat.redness, "redness order");
  assert(inf.heightMm > 0 && pro.heightMm > 0, "fresh wounds are raised (oedema, granulation)");
  assert(mat.lift > 0.2 && mat.desat > 0.5, "mature: hypopigmented and desaturated");
  assert(inf.roughnessScale < pro.roughnessScale, "the wet fresh wound is glossier than granulation");
  assert(scarLook("puncture", 730).heightMm < -0.3, "puncture heals sunken");
  for (const [, skin] of SKINS) {
    const red = scarColour(skin, inf);
    assert(red[0] - skin[0] >= -1e-9 || red[1] < skin[1], "inflamed: green/blue drop faster than red");
    assert(red[1] / Math.max(1e-6, red[0]) <= skin[1] / skin[0] + 1e-9, "inflamed hue shifts to red");
  }
});

Deno.test("TX45 marks: keloids stay raised and spread; propensity by ancestry and site", () => {
  const k = scarLook("laceration", 730, true), n = scarLook("laceration", 730, false);
  assert(k.heightMm >= 2 && n.heightMm <= 0, `keloid ${k.heightMm} vs normal ${n.heightMm}`);
  assert(k.spread > 1.5 && n.spread === 1, "keloid spreads past the wound");
  assert(k.redness >= 0.35 && k.lift === 0, "keloid stays dark-pink, not hypopigmented");
  const site = (race: string) => keloidChance(race, null, "torso", "laceration");
  assert(site("ork") > site("dwarf") && site("dwarf") > site("human") && site("human") > site("elf"), "ancestry order");
  assert(keloidChance("human", null, "torso", "incision") > keloidChance("human", null, "hand", "incision"), "chest > hand");
  assert(keloidChance("human", null, "ear", "puncture") > keloidChance("human", null, "foreArm", "puncture"), "ear lobe piercing");
  assert(keloidChance("human", "islander", "torso", "burn") > keloidChance("human", "imperial", "torso", "burn"), "sub-race");
  for (const r of RACES) for (const reg of MARK_REGIONS) for (const kd of SCAR_KINDS) {
    const c = keloidChance(r, null, reg, kd); assert(c >= 0 && c <= 0.8, "chance in [0, 0.8]");
    const h = hypertrophicChance(r, null, reg, kd); assert(h >= 0 && h <= 0.8, "hypertrophic chance in [0, 0.8]");
  }
  // Hypertrophic (QD Z-24): raised and red within the border, peak at 3-6 months, regressing by 2 years.
  const hyp = (d: number) => scarLook("burn", d, false, true);
  let peakDay = 0, peak = -Infinity;
  for (let d = 0; d <= 730; d += 5) if (hyp(d).heightMm > peak) { peak = hyp(d).heightMm; peakDay = d; }
  assert(peakDay >= 90 && peakDay <= 180 && peak > 1.2, `hypertrophic peak ${peak} mm at day ${peakDay}`);
  assert(hyp(730).heightMm < 0.2 && hyp(180).spread === 1, "regresses by 2 y; stays inside the border");
  assert(hyp(120).redness > scarLook("burn", 120).redness, "stays red while active");
  for (let d = 130; d <= 3650; d += 20) assert(hyp(d).heightMm <= hyp(d - 20).heightMm + 1e-12, "monotone after the peak");
  assert(hypertrophicChance("human", null, "torso", "burn") > 0.3 && hypertrophicChance("human", null, "foreArm", "puncture") < 0.05, "burns hypertrophic");
  console.log(`  hypertrophic burn peak ${peak.toFixed(2)} mm at day ${peakDay}, ${hyp(730).heightMm.toFixed(3)} mm at 2 y`);
});

Deno.test("TX46 marks: the default angle follows Langer's lines per region", () => {
  assert(langerAngle("torso", 0, 0) === 0, "sternum / abdomen horizontal");
  assert(langerAngle("neck", 0.3, 0) === 0 && langerAngle("pelvis", 0, 0) === 0, "neck, pelvis horizontal");
  for (const r of ["upperArm", "foreArm", "thigh", "shin"] as const) {
    assert(langerAngle(r, 0, 0) === HALF_PI, `${r} longitudinal mid-segment`);
    assert(langerAngle(r, 0, 0.85) === 0 && langerAngle(r, 0.5, -0.9) === 0, `${r} transverse over the joint`);
  }
  assert(langerAngle("face", 0, 0.7) === 0, "forehead horizontal");
  const belowMouth = langerAngle("face", 0, -0.9);
  assert(Math.abs(Math.abs(belowMouth) - HALF_PI) < 1e-9, `radial below the mouth: ${belowMouth}`);
  assert(Math.abs(langerAngle("torso", 0.5, 0)) > 0.2, "flank oblique");
  // A scar left at angle null resolves to the region's line.
  const s: Scar = { kind: "incision", region: "foreArm", side: 0, anchor: [0.1, 0.1], lengthMm: 50, widthMm: 2, ageDays: 400, seed: 1, angle: null };
  const r = resolveMarks({ scars: [s], tattoos: [] }, { race: "human" });
  assert(r.marks[0].angle === langerAngle("foreArm", 0.1, 0.1), "null angle = Langer");
});

Deno.test("TX47 marks: a wound across Langer's lines gapes and heals wider", () => {
  assert(gapeFactor(0, 0) === 1 && Math.abs(gapeFactor(HALF_PI, 0) - 1.6) < 1e-12, "1 along, 1.6 across");
  assert(gapeFactor(Math.PI, 0) < 1 + 1e-9, "lines have period pi");
  const base: Scar = { kind: "laceration", region: "foreArm", side: 0, anchor: [0, 0], lengthMm: 50, widthMm: 4, ageDays: 400, seed: 2 };
  const along = resolveMarks({ scars: [{ ...base, angle: HALF_PI }], tattoos: [] }, { race: "human" }).marks[0];
  const across = resolveMarks({ scars: [{ ...base, angle: 0 }], tattoos: [] }, { race: "human" }).marks[0];
  assert(across.scar!.widthMm > along.scar!.widthMm * 1.5, `across ${across.scar!.widthMm} vs along ${along.scar!.widthMm}`);
});

Deno.test("TX48 marks: scar albedo contrast never exceeds fresh-ink contrast on the same skin", () => {
  let worst = 0;
  for (const [, skin] of SKINS) for (const kind of SCAR_KINDS) for (const d of DAYS) for (const kel of [false, true]) {
    const c = scarColour(skin, scarLook(kind, d, kel), 1);
    const ratio = rgbDistance(c, skin) / inkContrast(skin);
    worst = Math.max(worst, ratio);
    assert(ratio <= 1 + 1e-9, `contrast ratio ${ratio}`);
    assert(c.every((v) => v >= 0 && v <= 1 && Number.isFinite(v)), "colour in range");
  }
  console.log(`  worst scar/ink contrast ratio ${worst.toFixed(3)}`);
});

Deno.test("TX49 marks: shapes are bounded, finite and drawn per kind (stitches, claw rakes)", () => {
  for (const kind of SCAR_KINDS) for (const kel of [false, true]) {
    const s: Scar = { kind, region: "torso", anchor: [0, 0], lengthMm: 60, widthMm: kind === "burn" ? 40 : 4, ageDays: 200, seed: 9 };
    const look = scarLook(kind, 200, kel);
    const [ex, ey] = scarExtentMm(s, look.spread);
    let inside = 0;
    for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) {
      const x = i / 40 * ex * 1.6, y = j / 40 * ey * 1.6;
      const o = sampleScar(s, look, x, y);
      assert(o.coverage >= 0 && o.coverage <= 1 && Number.isFinite(o.heightMm), "range");
      if (Math.abs(x) > ex + 0.5 || Math.abs(y) > ey + 0.5) assert(o.coverage === 0, `${kind} coverage outside its extent at ${x},${y}`);
      if (o.coverage > 0.5) inside++;
    }
    assert(inside > 0, `${kind} draws something`);
  }
  const st: Scar = { kind: "stitched", region: "torso", anchor: [0, 0], lengthMm: 70, widthMm: 2, ageDays: 400, seed: 4 };
  const look = scarLook("stitched", 400);
  const n = Math.floor(70 / SUTURE_PITCH_MM), first = -((n - 1) * SUTURE_PITCH_MM) / 2;
  assert(sampleScar(st, look, first, SUTURE_BITE_MM - 0.2).coverage > 0.5, "suture mark at the bite");
  assert(sampleScar(st, look, first + SUTURE_PITCH_MM / 2, SUTURE_BITE_MM - 0.2).coverage === 0, "nothing between stitches");
  const claw: Scar = { kind: "claw", region: "torso", anchor: [0, 0], lengthMm: 100, widthMm: 3, ageDays: 400, seed: 5 };
  let crossings = 0, prev = 0;
  for (let t = -40; t <= 40; t += 0.25) { const c = sampleScar(claw, scarLook("claw", 400), 0, t).coverage > 0.5 ? 1 : 0; if (c && !prev) crossings++; prev = c; }
  assert(crossings === 3 || crossings === 4, `claw rakes ${crossings}`);
});

Deno.test("TX50 marks: hair follicles are absent along the scar line (mask for the hair pass)", () => {
  const s: Scar = { kind: "incision", region: "torso", anchor: [0, 0], lengthMm: 60, widthMm: 3, ageDays: 400, seed: 3 };
  const look = scarLook("incision", 400);
  for (let x = -25; x <= 25; x += 1) for (let y = -6; y <= 6; y += 0.5) {
    const o = sampleScar(s, look, x, y);
    if (o.coverage > 0.05) assert(o.hairless === 1, "tissue is hairless");
  }
  assert(sampleScar(s, look, 0, 1.5 + 1.4).hairless === 1, "within the margin");
  assert(sampleScar(s, look, 0, 12).hairless === 0, "far away hair grows");
  const mesh = humanMesh(), frames = regionFrames(mesh);
  const set: MarkSet = { scars: [{ ...s, region: "foreArm", side: 0, lengthMm: 120, widthMm: 30, kind: "burn", anchor: [0, 0] }], tattoos: [] };
  const res = resolveMarks(set, { race: "human", frames });
  const mask = hairlessMask(mesh, res);
  let on = 0; for (const v of mask) on += v;
  assert(on > 0, "a burn clears follicles on some vertices");
  const f = frameOf(frames, "foreArm", 0)!, [cx, cy] = uvToMm(f, 0, 0);
  void cx; void cy;
  assert(hairlessAt(res, 0, 2, 0, REGIONS.indexOf("foreArm")) === 0, "off-region point keeps hair");
  console.log(`  burn on the forearm: ${on} hairless vertices of ${mask.length}`);
});

Deno.test("TX51 marks: ink ages (blur grows, opacity fades, black fades least and turns blue-green); bands wrap", () => {
  for (const ink of INK_NAMES) {
    let prev = inkAge(ink, 0);
    for (const y of [1, 5, 10, 20, 40, 80]) {
      const a = inkAge(ink, y);
      assert(a.blurMm >= prev.blurMm && a.opacity <= prev.opacity + 1e-12, `${ink} ${y}`);
      prev = a;
    }
  }
  assert(inkAge("black", 30).opacity > inkAge("red", 30).opacity && inkAge("black", 30).opacity > inkAge("ochre", 30).opacity, "black most stable");
  const b0 = inkAge("black", 0).srgb, b50 = inkAge("black", 50).srgb;
  assert(b50[2] - b50[0] > b0[2] - b0[0], "old black drifts blue");
  assert(inkAge("black", 40).blurMm > 0.5 && inkAge("black", 0).blurMm < 0.1, "spread mm");
  const band: Tattoo = { style: "band", motif: "ring", region: "upperArm", anchor: [0, 0], sizeMm: 30, inks: ["black"], ageYears: 5, seed: 1 };
  const C = 300;
  for (let s = -150; s < 150; s += 7.3) for (const t of [-14, -8, 0, 8, 14]) {
    const a = sampleTattoo(band, s, t, 0.2, C).coverage, b = sampleTattoo(band, s + C, t, 0.2, C).coverage;
    assert(Math.abs(a - b) < 1e-9, "band wraps with the circumference");
  }
  for (const style of TATTOO_STYLES) {
    const t: Tattoo = { style, motif: "flame", region: "foreArm", anchor: [0, 0], sizeMm: 50, inks: ["black"], ageYears: 5, seed: 3 };
    const [ex, ey] = tattooExtentMm(t, C);
    let ink = 0;
    for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) {
      const x = i / 30 * ex * 1.3, y = j / 30 * ey * 1.3, c = sampleTattoo(t, x, y, 0.3, C).coverage;
      assert(c >= 0 && c <= 1, "range");
      if (style !== "band" && (Math.abs(x) > ex + 1.5 || Math.abs(y) > ey + 1.5)) assert(c === 0, `${style} ink outside the extent`);
      ink += c;
    }
    assert(ink > 0, `${style} draws ink`);
  }
});

Deno.test("TX52 marks: motifs come from the sign / class / race symbol sets", () => {
  const m = motifsFor("dwarf", "Warrior", "mountain");
  assert(m[0] === "peaks", "sign first");
  assert(m.includes("sword") && m.includes("ring"), "class + race");
  for (const r of RACES) for (const c of CLASSES) for (const s of ["void", "mountain", "flame", "moon", "storm", "serpent", null]) {
    for (const g of motifsFor(r, c, s)) assert((TATTOO_SYMBOLS as readonly string[]).includes(g), g);
  }
  for (let s = 1; s <= 300; s++) {
    const set = defaultMarks({ race: "elf", className: "Mage", birthsign: "moon", seed: s });
    for (const t of set.tattoos) assert(motifsFor("elf", "Mage", "moon").includes(t.motif), `motif ${t.motif}`);
  }
});

Deno.test("TX53 marks: every generated mark lies inside its region bounds, clear of eyes and mouth, without overlap", () => {
  let marks = 0, n = 0;
  for (const race of RACES) for (let s = 1; s <= 250; s++) {
    const set = defaultMarks({ race, className: CLASSES[s % 8], birthsign: "flame", ageYears: null, seed: s * 31 });
    const res = resolveMarks(set, { race, fixed: true });
    n++;
    for (const r of res.placement.report) assert(r.ok, `${race} seed ${s * 31}: ${r.id} ${r.issues.join(",")}`);
    assert(res.marks.length === set.scars.length + set.tattoos.length + set.scars.filter((x) => x.mirror).length + set.tattoos.filter((x) => x.mirror).length, "nothing dropped");
    marks += res.marks.length;
  }
  console.log(`  ${n} characters, ${marks} marks placed with 0 issues`);
});

Deno.test("TX54 marks: the solver moves a colliding movable mark and reports a fixed one", () => {
  const frames = nominalFrames(1.8);
  const mk = (id: string, fixed: boolean, a: [number, number]): PlacementItem => ({ id, type: "tattoo", region: "torso", side: 0, anchor: a, angle: 0, extentMm: [25, 25], facial: false, fixed });
  const r = solvePlacement([mk("a", true, [0, 0]), mk("b", false, [0, 0])], frames);
  assert(r.placed.length === 2 && r.moved.includes("b"), "b moved");
  const fa = footprintOf(r.placed[0], frameOf(frames, "torso", 0)!), fb = footprintOf(r.placed[1], frameOf(frames, "torso", 0)!);
  assert(overlapFraction(fa, fb) <= 0.1, "moved clear");
  const fixed = solvePlacement([mk("a", true, [0, 0]), mk("b", true, [0.01, 0])], frames);
  assert(fixed.report[1].issues.includes("overlap") && fixed.placed.length === 2, "fixed overlap is reported, not moved");
  // Overlap is symmetric-ish and 0 for far marks, 1 for identical.
  assert(overlapFraction(fa, fa) === 1, "identical = 1");
  // A movable mark too long for the region is rejected.
  const huge = solvePlacement([{ ...mk("h", false, [0, 0]), extentMm: [40, 400] }], frames);
  assert(huge.rejected.length === 1 && huge.rejected[0].issues.includes("outOfRegion"), "out of region rejected");
});

Deno.test("TX55 marks: face rule — no tattoo on the face unless facial, nothing over the eyes or mouth", () => {
  const frames = nominalFrames(1.8);
  const base: PlacementItem = { id: "t", type: "tattoo", region: "face", side: 0, anchor: [0, 0.68], angle: 0, extentMm: [10, 10], facial: false, fixed: true };
  assert(regionIssues(base, frameOf(frames, "face", 0), 1.8).includes("faceNotAllowed"), "non-facial refused");
  assert(regionIssues({ ...base, facial: true }, frameOf(frames, "face", 0), 1.8).length === 0, "facial on the forehead ok");
  const eyeU = 32 / (Math.PI * 120), eyeV = 25 / 75;
  assert(regionIssues({ ...base, facial: true, anchor: [eyeU, eyeV] }, frameOf(frames, "face", 0), 1.8).includes("faceFeature"), "eye refused");
  assert(regionIssues({ ...base, type: "scar", anchor: [0, -40 / 75] }, frameOf(frames, "face", 0), 1.8).includes("faceFeature"), "scar over the mouth refused");
  const v = validateMarks({ scars: [], tattoos: [{ style: "sigil", motif: "eye", region: "face", anchor: [0, 0.7], sizeMm: 20, inks: ["black"], ageYears: 1, seed: 1 }] }, { race: "human" });
  assert(!v[0].ok && v[0].issues.includes("faceNotAllowed"), "validateMarks reports");
  // QD Z-37: a mark under the outfit is kept but flagged covered, and draws no decal.
  const torsoScar: MarkSet = { scars: [{ kind: "incision", region: "torso", anchor: [0, 0], lengthMm: 60, widthMm: 2, ageDays: 400, seed: 1 }], tattoos: [] };
  const vc = validateMarks(torsoScar, { race: "human", coveredRegions: ["torso", "pelvis", "thigh"] });
  assert(vc[0].ok && vc[0].covered, "covered note");
  const rc = resolveMarks(torsoScar, { race: "human", coveredRegions: ["torso"] });
  assert(rc.marks[0].covered && marksToDecals(rc).decals.length === 0 && marksToDecals(rc, { includeCovered: true }).decals.length === 1, "hidden under cloth");
  // QD Z-69: the zones are the REAL eyes and mouth of each stylised head (plan.face), and no generated
  // face mark resolved on the real body touches them (4 races x 2 sexes x 150 seeds).
  let faceMarks = 0, hits = 0, worstEye = 0;
  for (const race of RACES) for (const sex of ["male", "female"] as const) {
    const body = generateBody({ race, subrace: null, className: "Barbarian", height: race === "dwarf" ? 1.35 : race === "ork" ? 1.95 : 1.75, weight: race === "ork" ? 110 : 70, seed: 7, sex });
    const fr = regionFrames(body.mesh, { face: body.plan.face, race }), f = frameOf(fr, "face", 0)!;
    const real = faceZonesFromAnchors(f, body.plan.face);
    const eyeMm = pointToFrameMm(f, body.plan.face.eye[0]);
    worstEye = Math.max(worstEye, Math.hypot(eyeMm.x - real[0].x, eyeMm.y - real[0].y));
    for (let sd = 1; sd <= 150; sd++) {
      const set = defaultMarks({ race, className: "Barbarian", birthsign: "storm", seed: sd * 7919 + 1, ageYears: null, heightM: fr.heightM });
      const res = resolveMarks(set, { race, frames: fr });
      for (const m of res.marks) {
        if (m.region !== "face") continue;
        faceMarks++;
        const pts = footprintPoints(footprintOf({ ...m, facial: true, fixed: true }, f), 9);
        if (pts.some(([x, y]) => real.some((z) => ((x - z.x) / z.rx) ** 2 + ((y - z.y) / z.ry) ** 2 <= 1))) hits++;
      }
    }
  }
  assert(worstEye < 1e-6, "zones centred on the anchors");
  assert(faceMarks > 50 && hits === 0, `${hits} of ${faceMarks} generated face marks on a real eye/mouth`);
  console.log(`  ${faceMarks} generated face marks on 8 real heads, ${hits} touching the real eye/mouth zones`);
});

Deno.test("TX56 marks: mirror swaps the side (paired) or negates u (midline); decals land mirrored on the mesh", () => {
  const t: Tattoo = { style: "band", motif: "peaks", region: "upperArm", side: 0, anchor: [0, -0.3], sizeMm: 25, inks: ["black"], ageYears: 3, seed: 7, mirror: true };
  assert(mirrorMark(t).side === 1 && mirrorMark(t).anchor[1] === -0.3, "paired swap");
  const s: Scar = { kind: "laceration", region: "torso", anchor: [0.3, 0.2], lengthMm: 40, widthMm: 3, ageDays: 400, seed: 1, angle: 0.4 };
  const ms = mirrorMark(s);
  assert(ms.anchor[0] === -0.3 && ms.angle === -0.4, "midline negation");
  const mesh = humanMesh(), frames = regionFrames(mesh);
  const res = resolveMarks({ scars: [], tattoos: [t] }, { race: "dwarf", frames });
  assert(res.marks.length === 2, "two marks");
  const { decals } = marksToDecals(res, { mesh });
  const [a, b] = decals;
  assert(Math.abs(a.center[0] + b.center[0]) < 0.02 && Math.abs(a.center[1] - b.center[1]) < 0.02, `mirrored centres ${a.center} ${b.center}`);
});

Deno.test("TX57 marks: appearance.marks round-trips through JSON and the profile library; saves are sanitized", () => {
  const set = defaultMarks({ race: "ork", subrace: "bloodfang", className: "Barbarian", birthsign: "storm", ageYears: 30, seed: 77 });
  assert(set.scars.length + set.tattoos.length > 0, "non-empty");
  const back = sanitizeMarks(JSON.parse(JSON.stringify(set)));
  assert(JSON.stringify(back) === JSON.stringify(set), "JSON + sanitize identity");
  const store = new Map<string, string>();
  const repo = new ProfileRepo({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
  const c: CharacterProfile = {
    name: "Gash", race: "ork", subrace: "bloodfang", className: "Barbarian", palette: "Ember", birthsign: "storm", level: 1, allocated: {},
    appearance: { body: "#5d7a3e", accent: "#dfaa55", height: 2, weight: 120, eyes: "#172128", marks: set },
  };
  createFromCharacter(repo, c, "Gash", "2026-11-04T21:00:00Z");
  const reload = new ProfileRepo({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
  const e = libraryEntries(reload)[0];
  assert(JSON.stringify(e.character.appearance.marks) === JSON.stringify(set), "saved and loaded");
  assert(JSON.stringify(marksForProfile(e.character, 1)) === JSON.stringify(set), "stored marks override the defaults");
  const noMarks = marksForProfile({ ...e.character, appearance: { ...e.character.appearance, marks: undefined } }, 1);
  assert(JSON.stringify(noMarks) !== JSON.stringify(set) || set.scars.length === 0, "absent = generated");
  // Garbage in: unknown kinds dropped, numbers clamped, junk ignored.
  const g = sanitizeMarks({ scars: [{ kind: "bite", region: "torso" }, { kind: "burn", region: "torso", anchor: [9, -9], lengthMm: 1e9, widthMm: NaN, ageDays: -5, seed: 1.7 }, null], tattoos: [{ style: "sigil", motif: "nope" }, "x"] })!;
  assert(g.scars.length === 1 && g.tattoos.length === 0, "dropped unknowns");
  assert(g.scars[0].anchor[0] === 1 && g.scars[0].anchor[1] === -1 && g.scars[0].lengthMm === 300 && g.scars[0].widthMm === 3 && g.scars[0].ageDays === 0 && g.scars[0].seed === 1, "clamped");
  assert(sanitizeMarks(null) === null && sanitizeMarks(5) === null, "non-object");
});

Deno.test("TX58 marks: generated frequencies by ancestry (orks most scars + woad tribal, dwarves clan bands, elves dotwork, humans rare)", () => {
  const st = Object.fromEntries(RACES.map((r) => [r, generatedStats(r, 2000)]));
  const top = (rec: Record<string, number>) => Object.entries(rec).sort((a, b) => b[1] - a[1])[0][0];
  assert(st.ork.meanScars > st.dwarf.meanScars && st.dwarf.meanScars > st.human.meanScars && st.human.meanScars > st.elf.meanScars, "scar order");
  assert(st.ork.tattooedShare > 0.7 && st.dwarf.tattooedShare > 0.6, "orks and dwarves tattooed");
  assert(st.elf.tattooedShare > st.human.tattooedShare && st.human.tattooedShare < 0.3, "humans rare");
  assert(top(st.ork.styles) === "tribal" && top(st.ork.inks) === "woad", "ork woad tribal");
  assert(top(st.dwarf.styles) === "band", "dwarf clan bands");
  assert(top(st.elf.styles) === "dotwork", "elf dotwork");
  assert(st.ork.keloidShare > st.human.keloidShare && st.human.keloidShare > st.elf.keloidShare, "keloid order");
  assert(st.human.facialShare === 0 && st.dwarf.facialShare === 0 && st.ork.facialShare > 0, "facial: orks (and elves) only");
  for (const r of RACES) console.log(`  ${r.padEnd(5)} scars ${st[r].meanScars.toFixed(2)} tattooed ${(st[r].tattooedShare * 100).toFixed(1)} % keloid ${(st[r].keloidShare * 100).toFixed(1)} % top ${top(st[r].styles)}/${top(st[r].inks)}`);
});

Deno.test("TX59 marks: decals fit R's layout and the skin; layers validate and evaluate in L's API; MARKS.md tables in sync", async () => {
  const mesh = humanMesh(), frames = regionFrames(mesh);
  let maxOff = 0, total = 0;
  for (let s = 1; s <= 30; s++) {
    const set = defaultMarks({ race: RACES[s % 4], className: CLASSES[s % 8], birthsign: "void", seed: s * 13, ageYears: null });
    const res = resolveMarks(set, { race: RACES[s % 4], frames });
    const { decals, dropped } = marksToDecals(res, { mesh });
    assert(decals.length <= DECAL_MAX, "budget");
    assert(decals.length + dropped.length === res.marks.length, "every mark has a decal or is listed as dropped");
    const packed = packDecals(decals);
    assert(packed.count === decals.length && packed.dropped.length === 0, `R packs all (${packed.dropped})`);
    for (const d of decals) {
      // Centre on the skin: distance to the nearest TRIANGLE of the mesh <= 6 mm.
      const best = distanceToMesh(mesh, d.center);
      maxOff = Math.max(maxOff, best); total++;
      assert(best < 0.006, `${d.id} ${best}`);
      assert(Math.abs(Math.hypot(...d.normal) - 1) < 1e-6, "unit normal");
    }
    const layers = marksToLayers(res, { dropped });
    const stack: LayerStackV2 = { version: 2, nodes: layers };
    const issues = validateStack(stack);
    assert(issues.length === 0, issues.join("; "));
    const buf = evaluateStack(mesh, stack, { marks: markFields(res) });
    for (const v of buf.albedo) assert(Number.isFinite(v), "finite albedo");
  }
  // R's one-call entry gives the same decals as the two-step path.
  const one = marksToFragmentDecals(defaultMarks({ race: "ork", className: "Barbarian", seed: 99, ageYears: 30 }), { race: "ork", mesh, skinSrgb: [0.36, 0.48, 0.24] });
  const two = marksToDecals(resolveMarks(defaultMarks({ race: "ork", className: "Barbarian", seed: 99, ageYears: 30 }), { race: "ork", frames: regionFrames(mesh, { race: "ork" }) }), { mesh, skinSrgb: [0.36, 0.48, 0.24] }).decals;
  assert(JSON.stringify(one) === JSON.stringify(two), "marksToFragmentDecals == resolve + marksToDecals");
  const doc = await Deno.readTextFile(new URL("../docs/wave-tex/MARKS.md", import.meta.url));
  assert(doc.includes(marksTables(2000)), "docs/wave-tex/MARKS.md tables are stale: regenerate them");
  // anchorAt inverts uvToMm on the frame (creator raycast).
  const f = frameOf(frames, "foreArm", 0)!;
  const q = anchorAt(frames, "foreArm", [f.origin[0] + f.front[0] * f.radiusM, f.origin[1] + f.front[1] * f.radiusM, f.origin[2] + f.front[2] * f.radiusM]);
  assert(q && q.side === 0 && Math.abs(q.anchor[0]) < 1e-6 && Math.abs(q.anchor[1]) < 1e-6, "anchorAt");
  console.log(`  ${total} decals on a human mesh, worst centre-to-skin (nearest triangle) ${(maxOff * 1000).toFixed(2)} mm`);
});
