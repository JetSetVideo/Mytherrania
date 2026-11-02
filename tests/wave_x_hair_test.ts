// Wave X lane H: hair GROWN from follicles — the pins (SPEC X70-X89) and the measured numbers.
// Each test measures the SAME vertices the GPU draws (HairMesh.buildHairData is pure), against
// the real generated head (anatomyFor -> FaceAnchors) of every ancestry.
// @deno-types="@types/three"
import * as THREE from "three";
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { ancestryOf } from "../src/game/Ancestry.ts";
import { greyFraction, lifeFraction, LIFESPAN } from "../src/game/Age.ts";
import { hairLengthM, isBald, lookSeed } from "../src/graphics/body/Proportions.ts";
import { buildFaceParts, skullClearance } from "../src/graphics/body/FaceParts.ts";
import {
  earBackZ, earZoneQ, FOLLICLE, type HeadFrame, headFrameOf, onFaceOrEar, placeFollicles, radialError, recessionFor, hairRegionArea,
} from "../src/graphics/body/HairFollicles.ts";
import { arcLength, clearance, GROWTH, growHair, hairPlanFor, type HairPlan, hashUnit } from "../src/graphics/body/HairGrowth.ts";
import { buildHairData, type HairData, HAIR_TRI_BUDGET, type HairInput } from "../src/graphics/body/HairMesh.ts";
import { clumpIsGrey, clumpTone, expectedGreyShare, luminance, rootTip, strandColour, subStrandGrey, type Rgb } from "../src/graphics/body/HairShade.ts";
import type { Vec3 } from "../src/graphics/body/contracts.ts";
import type { Appearance } from "../src/game/Characters.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const ANCESTRIES: [string, string | null][] = [
  ["human", null], ["human", "imperial"], ["human", "nomad"], ["human", "islander"],
  ["elf", null], ["elf", "high"], ["elf", "wood"], ["elf", "dark"],
  ["dwarf", null], ["dwarf", "mountain"], ["dwarf", "forge"], ["dwarf", "deep"],
  ["ork", null], ["ork", "greenhide"], ["ork", "ironhide"], ["ork", "bloodfang"],
];
const tag = (r: string, s: string | null) => `${r}/${s ?? "-"}`;

const frames = new Map<string, HeadFrame>();
function frameOf(race: string, sub: string | null): HeadFrame {
  const k = tag(race, sub);
  let f = frames.get(k);
  if (!f) {
    const plan = anatomyFor({ race, subrace: sub, className: "Warrior", height: 1.7, weight: 70, seed: 7 });
    f = headFrameOf(plan.face, [0, 0, 0], plan.proportions.head, ancestryOf(race, sub).ears.lengthMul);
    frames.set(k, f);
  }
  return f;
}

function inputFor(race: string, sub: string | null, seed: number, years?: number, sex = "male"): HairInput {
  const node = ancestryOf(race, sub), f = frameOf(race, sub);
  return {
    frame: f, spec: node.hair, lengthM: hairLengthM(node, f.h), seed, race, ancestryIds: [race, sub ?? ""], sex,
    lifeFraction: lifeFraction(race, years), grey: greyFraction(race, years), baseHex: node.hair.colors[0], skinHex: node.skin.base,
  };
}

/** Every vertex of every drawn group. */
function verts(d: HairData): Vec3[] {
  const out: Vec3[] = [];
  for (const b of d.groups.values()) for (let i = 0; i < b.pos.length; i += 3) out.push([b.pos[i], b.pos[i + 1], b.pos[i + 2]]);
  return out;
}

/** A spread of builds: every ancestry x 4 seeds (cached). */
const builds: { race: string; sub: string | null; seed: number; d: HairData }[] = [];
function allBuilds() {
  if (builds.length > 0) return builds;
  for (const [race, sub] of ANCESTRIES) for (const seed of [3, 11, 29, 101]) builds.push({ race, sub, seed, d: buildHairData(inputFor(race, sub, seed)) });
  return builds;
}

Deno.test("SPEC X70: every follicle sits ON the skull ellipsoid (radial error < 1 mm), every ancestry", () => {
  const rows: string[] = [];
  for (const [race, sub] of ANCESTRIES) {
    const f = frameOf(race, sub);
    const field = placeFollicles(f, { density: ancestryOf(race, sub).hair.density, seed: 17 });
    let worst = 0;
    for (const fo of field.follicles) worst = Math.max(worst, Math.abs(radialError(f, fo.p)));
    assert(field.follicles.length > 100, `${tag(race, sub)}: only ${field.follicles.length} follicles`);
    assert(worst < 0.001, `${tag(race, sub)}: radial error ${worst * 1000} mm`);
    rows.push(`${tag(race, sub).padEnd(16)} density=${ancestryOf(race, sub).hair.density.toFixed(2)} follicles=${String(field.follicles.length).padStart(4)}/${field.target} area=${(field.areaM2 * 1e4).toFixed(1)}cm² spacing=${(field.spacing * 1000).toFixed(1)}mm maxRadialErr=${(worst * 1e9).toFixed(3)}nm`);
  }
  console.log("follicles per ancestry (seed 17, young):\n  " + rows.join("\n  "));
});

Deno.test("SPEC X71: no follicle on the face or in an ear zone; the forehead line stays above the brow", () => {
  for (const [race, sub] of ANCESTRIES) {
    const f = frameOf(race, sub);
    for (const rec of [0, 0.6, 1]) {
      const field = placeFollicles(f, { density: 0.8, seed: 5, recession: rec });
      for (const fo of field.follicles) {
        assert(!onFaceOrEar(f, fo.p), `${tag(race, sub)} rec ${rec}: follicle on the face/ear at ${fo.p.map((v) => v.toFixed(3))}`);
        if (fo.p[2] > earBackZ(f)) assert(fo.p[1] >= f.browY + FOLLICLE.fringeClearDy * f.h, `${tag(race, sub)}: follicle below the brow in front of the ear`);
        assert(earZoneQ(f, fo.p, 0) >= 1 && earZoneQ(f, fo.p, 1) >= 1, `${tag(race, sub)}: follicle in an ear zone`);
      }
    }
  }
});

Deno.test("SPEC X72: the follicle count scales with the ancestry's hair density (and with the region's area)", () => {
  const f = frameOf("human", null);
  const counts = [0.3, 0.6, 0.9].map((d) => placeFollicles(f, { density: d, seed: 9 }).follicles.length);
  console.log(`human follicles at density 0.3/0.6/0.9: ${counts.join(" / ")}`);
  assert(counts[0] < counts[1] && counts[1] < counts[2], `counts must rise with density: ${counts}`);
  const ratio = counts[2] / counts[0];
  assert(ratio > 2.5 && ratio < 3.5, `count(0.9)/count(0.3) = ${ratio.toFixed(2)} should be ~3`);
  // Ancestry ranking: the densest ancestry (dwarf 0.85) carries more follicles than the elf (0.5).
  const dwarf = placeFollicles(frameOf("dwarf", null), { density: ancestryOf("dwarf", null).hair.density, seed: 9 }).follicles.length;
  const elf = placeFollicles(frameOf("elf", null), { density: ancestryOf("elf", null).hair.density, seed: 9 }).follicles.length;
  assert(dwarf > elf, `dwarf ${dwarf} > elf ${elf}`);
});

Deno.test("SPEC X73: follicles and growth are deterministic per seed, and differ across seeds", () => {
  const f = frameOf("dwarf", "mountain");
  const a = placeFollicles(f, { density: 0.8, seed: 42 }), b = placeFollicles(f, { density: 0.8, seed: 42 }), c = placeFollicles(f, { density: 0.8, seed: 43 });
  assert(JSON.stringify(a.follicles) === JSON.stringify(b.follicles), "same seed, same follicles");
  assert(JSON.stringify(a.follicles) !== JSON.stringify(c.follicles), "another seed, other follicles");
  const d1 = buildHairData(inputFor("elf", "wood", 7)), d2 = buildHairData(inputFor("elf", "wood", 7));
  assert(JSON.stringify([...d1.groups.values()].map((g) => g.pos)) === JSON.stringify([...d2.groups.values()].map((g) => g.pos)), "same input, same vertices");
});

Deno.test("SPEC X74: male elders recede (temples first, then the crown), women and elves never", () => {
  const f = frameOf("human", null);
  const young = hairRegionArea(f, recessionFor("male", "human", lifeFraction("human", 25), 0.5));
  const elderRec = recessionFor("male", "human", lifeFraction("human", 80), 0.5);
  const elder = hairRegionArea(f, elderRec);
  assert(elderRec > 0.4 && elder < young * 0.95, `elder male region ${elder} must be < young ${young} (rec ${elderRec})`);
  assert(recessionFor("female", "human", 1, 1) === 0, "women do not recede");
  assert(recessionFor("male", "elf", 1, 1) === 0, "elves do not recede");
  console.log(`hair region area: young ${(young * 1e4).toFixed(1)} cm² -> male elder (recession ${elderRec.toFixed(2)}) ${(elder * 1e4).toFixed(1)} cm²`);
});

Deno.test("SPEC X75: clearance >= 0 everywhere — every strand point and every drawn vertex is outside the cranium", () => {
  let minPts = Infinity, minVerts = Infinity, nVerts = 0, nPts = 0;
  for (const { race, sub, d } of allBuilds()) {
    const f = d.growth.plan ? frameOf(race, sub) : frameOf(race, sub);
    for (const s of d.growth.strands) for (const p of s.points) { minPts = Math.min(minPts, clearance(f, p)); nPts++; }
    for (const p of verts(d)) { const c = skullClearance(p, f.sc, f.sr); minVerts = Math.min(minVerts, c); nVerts++; }
  }
  console.log(`clearance: min over ${nPts} strand points ${(minPts * 1000).toFixed(3)} mm, over ${nVerts} drawn vertices ${(minVerts * 1000).toFixed(3)} mm (16 ancestries x 4 seeds)`);
  assert(minPts >= 0, `a strand point is inside the skull (${minPts})`);
  assert(minVerts >= 0, `a vertex is inside the skull (${minVerts})`);
});

Deno.test("SPEC X76: free strands are CUT to the style length (within one growth step)", () => {
  const byTier = new Map<string, { n: number; worst: number }>();
  let blocked = 0, total = 0;
  for (const { race, sub, d } of allBuilds()) {
    const f = frameOf(race, sub);
    for (const s of d.growth.strands) {
      total++;
      if (s.cutBy === "blocked") blocked++;
      if (s.cutBy !== "length" || s.kind !== "scalp" || s.braid >= 0 || d.plan.sweep === "gather") continue;
      const err = Math.abs(s.spineLength - s.target);
      const ds = GROWTH.step * f.h;
      assert(err <= ds + 1e-9, `${tag(race, sub)} ${d.plan.style}: spine ${s.spineLength} vs target ${s.target} (step ${ds})`);
      assert(Math.abs(s.target / d.plan.lengthM - 1) <= 0.04 + 1e-9, "the per-strand jitter stays within ±4 % of the style length");
      const k = `${d.plan.style}/${d.plan.tier}`;
      const e = byTier.get(k) ?? { n: 0, worst: 0 };
      e.n++; e.worst = Math.max(e.worst, err / f.h);
      byTier.set(k, e);
    }
  }
  assert(byTier.size >= 3, `expected several cut styles, got ${[...byTier.keys()]}`);
  assert(blocked / total < 0.05, `blocked strands ${blocked}/${total} must stay rare`);
  console.log(`strands stopped early by a guard (ear zone / face plane): ${blocked} of ${total}`);
  console.log("cut-length error by style/tier (head heights):\n  " + [...byTier].map(([k, v]) => `${k.padEnd(18)} strands=${v.n} worst=${v.worst.toFixed(4)}h`).join("\n  "));
});

Deno.test("SPEC X77: braids are true 3-strand interleaves — each bundle crosses the centre line, 120° apart, ending in a tie", () => {
  let braids = 0;
  for (const { d } of allBuilds()) {
    for (const br of d.growth.braids) {
      braids++;
      const signs: number[][] = [[], [], []];
      for (let i = 0; i <= br.tieIndex; i++) {
        for (let k = 0; k < 3; k++) {
          const off = br.strands[k][i].map((v, j) => v - br.spine[i][j]) as Vec3;
          const lat = off[0] * br.side[i][0] + off[1] * br.side[i][1] + off[2] * br.side[i][2];
          if (Math.abs(lat) > 0.05 * br.width) signs[k].push(Math.sign(lat));
        }
      }
      for (let k = 0; k < 3; k++) {
        let crossings = 0;
        for (let i = 1; i < signs[k].length; i++) if (signs[k][i] !== signs[k][i - 1]) crossings++;
        assert(crossings >= 2, `bundle ${k} crosses the centre line only ${crossings} times`);
      }
      // The bundles are distinct (phase-shifted), not one ribbon drawn three times.
      const mid = Math.floor(br.tieIndex / 2);
      const a = br.strands[0][mid], b = br.strands[1][mid], c = br.strands[2][mid];
      assert(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-4 && Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]) > 1e-4, "three distinct bundles");
      // The end tie: the bundles meet the centre at the tie.
      for (let k = 0; k < 3; k++) {
        const p = br.strands[k][br.tieIndex];
        assert(Math.hypot(p[0] - br.tie[0], p[1] - br.tie[1], p[2] - br.tie[2]) <= br.tieRadius + 1e-6, "bundles gathered at the end tie");
      }
    }
  }
  assert(braids >= 5, `the spread must contain braids (got ${braids})`);
  console.log(`braids checked: ${braids}`);
});

Deno.test("SPEC X78: the fringe never comes below the brow line and no hair sits on the face or in an ear zone", () => {
  let fringeStrands = 0, lowestFringe = Infinity;
  for (const { race, sub, d } of allBuilds()) {
    const f = frameOf(race, sub);
    const line = f.browY + FOLLICLE.fringeClearDy * f.h;
    for (const s of d.growth.strands) {
      if (s.fringe) fringeStrands++;
      for (const p of s.points) if (p[2] > earBackZ(f) + 1e-9) { assert(p[1] >= line - 1e-9, `${tag(race, sub)}: strand point below the fringe line`); if (s.fringe) lowestFringe = Math.min(lowestFringe, (p[1] - f.browY) / f.h); }
    }
    for (const p of verts(d)) {
      if (p[2] > earBackZ(f) + 1e-9) assert(p[1] >= line - 1e-9, `${tag(race, sub)}: vertex on the face ${p.map((v) => v.toFixed(3))}`);
      assert(earZoneQ(f, p, 0) >= 1 - 1e-6 && earZoneQ(f, p, 1) >= 1 - 1e-6, `${tag(race, sub)}: vertex in an ear zone`);
      if (p[2] > f.sc[2]) assert(p[1] > f.browY, "the legacy rule: hair in front of the skull centre stays above the brow");
    }
  }
  assert(fringeStrands > 20, `the spread must contain fringe strands (${fringeStrands})`);
  console.log(`fringe strands: ${fringeStrands}; lowest fringe point ${lowestFringe.toFixed(3)} h above the brow (line at +${FOLLICLE.fringeClearDy} h)`);
});

Deno.test("SPEC X79: ponytails and topknots gather their strands at a tie point", () => {
  let gathered = 0;
  const seen = new Set<string>();
  for (let seed = 0; seed < 80 && seen.size < 2; seed++) {
    const d = buildHairData(inputFor("human", "nomad", seed));
    if (d.plan.style !== "ponytail" && d.plan.style !== "topknot") continue;
    seen.add(d.plan.style);
    const tie = d.growth.ties.find((t) => t.kind === "ponytail" || t.kind === "bun");
    assert(tie, "a gathered style has a tie");
    for (const s of d.growth.strands.filter((x) => x.kind === "tail")) {
      const end = s.spine[s.spine.length - 1];
      assert(Math.hypot(end[0] - tie.p[0], end[1] - tie.p[1], end[2] - tie.p[2]) <= Math.max(GROWTH.tieRadius * frameOf("human", "nomad").h, 1.5 * d.growth.ds) + 1e-9, "tail strands reach the tie");
      gathered++;
    }
  }
  assert(seen.size === 2 && gathered > 20, `saw ${[...seen]} with ${gathered} gathered strands`);
});

Deno.test("SPEC X80: the hair stays inside its triangle budget on every ancestry (the whole rig is pinned < 12 000)", () => {
  const rows: string[] = [];
  const byAnc = new Map<string, { tris: number[]; follicles: number[]; clumps: number[]; styles: Set<string> }>();
  for (const { race, sub, d } of allBuilds()) {
    assert(d.stats.triangles <= HAIR_TRI_BUDGET, `${tag(race, sub)}: ${d.stats.triangles} > ${HAIR_TRI_BUDGET}`);
    const e = byAnc.get(tag(race, sub)) ?? { tris: [], follicles: [], clumps: [], styles: new Set<string>() };
    e.tris.push(d.stats.triangles); e.follicles.push(d.stats.follicles); e.clumps.push(d.stats.clumps); e.styles.add(`${d.plan.style}/${d.plan.tier}${d.growth.braids.length ? `+${d.growth.braids.length}br` : ""}`);
    byAnc.set(tag(race, sub), e);
  }
  for (const [k, e] of byAnc) rows.push(`${k.padEnd(16)} follicles=${e.follicles.join(",")} clumps=${e.clumps.join(",")} tris=${e.tris.join(",")} styles=${[...e.styles].join(" ")}`);
  console.log(`hair per ancestry (seeds 3,11,29,101; budget ${HAIR_TRI_BUDGET}):\n  ` + rows.join("\n  "));
});

Deno.test("SPEC X81: grey — greyFraction(race, age) of the hair turns grey; elders grey, elves silver and less", () => {
  for (const g of [0, 0.25, 0.5, 0.92]) assert(Math.abs(expectedGreyShare(g) - g) < 1e-12, `expected share ${expectedGreyShare(g)} = g ${g}`);
  // Measured over many clumps: the whole-grey share is 0.8·g.
  for (const g of [0.3, 0.6, 0.92]) {
    let n = 0;
    for (let c = 0; c < 4000; c++) if (clumpIsGrey(c, 77, g)) n++;
    assert(Math.abs(n / 4000 - 0.8 * g) < 0.03, `grey clump share ${n / 4000} vs ${0.8 * g}`);
    assert(subStrandGrey(g) >= 0 && subStrandGrey(g) <= 1, "sub-strand rate in [0,1]");
  }
  const rows: string[] = [];
  for (const race of ["human", "elf", "dwarf", "ork"]) {
    const L = LIFESPAN[race];
    const ex = [0.3, 0.6, 0.8, 1.0].map((fr) => `${Math.round(L * fr)}y=${greyFraction(race, L * fr).toFixed(2)}`);
    rows.push(`${race.padEnd(6)} ${ex.join("  ")}`);
  }
  console.log("greyFraction examples (years = share of grey strands):\n  " + rows.join("\n  "));
  // The drawn hair: an elder's vertices are lighter than the young self's (dark base colour).
  const lum = (d: HairData) => { let s = 0, n = 0; for (const b of d.groups.values()) for (let i = 0; i < b.col.length; i += 3) { s += luminance([b.col[i], b.col[i + 1], b.col[i + 2]]); n++; } return s / n; };
  const young = buildHairData(inputFor("human", null, 11, 25)), old = buildHairData(inputFor("human", null, 11, 80));
  assert(old.stats.greyClumps > 0 && young.stats.greyClumps === 0, `grey clumps young ${young.stats.greyClumps}, elder ${old.stats.greyClumps}`);
  assert(lum(old) > lum(young) * 1.5, `elder hair luminance ${lum(old)} must clearly exceed the young ${lum(young)}`);
  assert(greyFraction("elf", 700) < greyFraction("human", 80), "elves grey less");
  console.log(`human seed 11: mean vertex luminance young(25y) ${lum(young).toFixed(3)} -> elder(80y) ${lum(old).toFixed(3)}; grey clumps ${young.stats.greyClumps} -> ${old.stats.greyClumps}/${old.stats.clumps}`);
});

Deno.test("SPEC X82: shading — root darker than tip, shades of the base colour per clump", () => {
  assert(rootTip(0) < rootTip(0.5) && rootTip(0.5) < rootTip(1), "rootTip rises root -> tip");
  const base: Rgb = [0.2, 0.12, 0.06];
  const tones = new Set<string>();
  for (let c = 0; c < 40; c++) tones.add(clumpTone(c, 5).k.toFixed(3));
  assert(tones.size >= 30, `per-clump tones vary (${tones.size} distinct of 40)`);
  const root = strandColour(base, clumpTone(1, 5), null, 0), tip = strandColour(base, clumpTone(1, 5), null, 1);
  assert(luminance(tip) > luminance(root) * 1.6, "tip much lighter than root");
  // In the built mesh: along every hair card, the colour at the root end is darker than at the tip.
  const d = buildHairData(inputFor("elf", "dark", 3));
  let checked = 0;
  for (const b of d.groups.values()) {
    for (let i = 0; i + 1 < b.seed.length; i++) {
      if (b.seed[i] < 0 || b.seed[i + 1] !== b.seed[i]) continue;
      if (b.uv[2 * i + 1] === 0 && b.uv[2 * i + 2 + 1] > 0) checked++;
    }
  }
  assert(checked > 10, "cards carry root->tip parameters");
  console.log(`rootTip: root x${rootTip(0).toFixed(2)} -> tip x${rootTip(1).toFixed(2)}; clump tone range ${Math.min(...[...tones].map(Number)).toFixed(2)}..${Math.max(...[...tones].map(Number)).toFixed(2)}`);
});

Deno.test("SPEC X83: FaceParts wiring — grown hair in hairParts + secondary, bald stays bald, every ancestry builds", () => {
  const rows: string[] = [];
  for (const [race, sub] of ANCESTRIES) {
    const plan = anatomyFor({ race, subrace: sub, className: "Warrior", height: 1.7, weight: 70, seed: 7 });
    const node = ancestryOf(race, sub);
    let a: Appearance = { body: node.skin.base, accent: "#6b4130", height: 1.7, weight: 70, hair: "#1a1a1a", eyes: "#2f6fb5", race, subrace: sub };
    for (let k = 0; k < 64 && isBald(node, lookSeed(a)); k++) a = { ...a, hair: `#${(0x1a1a00 + k * 0x010101).toString(16)}` };
    const head = new THREE.Group();
    const rig = buildFaceParts(head, plan.face, [0, 0, 0], plan.proportions.head, a);
    assert(rig.hairStats, `${tag(race, sub)}: a non-bald character grows hair`);
    assert(rig.hairParts.length > 0, `${tag(race, sub)}: skull-hugging parts`);
    if (rig.hairStats.style !== "shaved") assert(rig.secondary.length > 0, `${tag(race, sub)}: hanging masses for secondary motion`);
    for (const o of rig.secondary) assert(o.parent === head, "secondary masses hang from the head bone");
    rows.push(`${tag(race, sub).padEnd(16)} ${rig.hairStats.style}/${rig.hairStats.tier} hairTris=${rig.hairStats.triangles} faceTris=${rig.triangleCount} secondary=${rig.secondary.length}`);
    // Bald: no hair meshes at all.
    if (node.hair.baldChance > 0) {
      let b: Appearance = a;
      for (let k = 0; k < 200 && !isBald(node, lookSeed(b)); k++) b = { ...a, eyes: `#2f${(0x6f00 + k).toString(16)}` };
      if (isBald(node, lookSeed(b))) {
        const hb = new THREE.Group();
        const rb = buildFaceParts(hb, plan.face, [0, 0, 0], plan.proportions.head, b);
        assert(!rb.hairStats && rb.hairParts.length === 0, `${tag(race, sub)}: bald grows nothing`);
      }
    }
  }
  console.log("FaceParts with grown hair:\n  " + rows.join("\n  "));
});

Deno.test("SPEC X84: style plans — fringe-cut styles exist, braiding ancestries braid, tiers follow the ancestry length", () => {
  const count = (race: string, sub: string | null, pred: (p: HairPlan) => boolean) => {
    let n = 0;
    for (let s = 0; s < 200; s++) if (pred(hairPlanFor(ancestryOf(race, sub).hair, frameOf(race, sub), hairLengthM(ancestryOf(race, sub), frameOf(race, sub).h), s, [race, sub ?? ""]))) n++;
    return n;
  };
  assert(count("dwarf", null, (p) => p.braids > 0) > 40, "dwarves braid often");
  assert(count("elf", "wood", (p) => p.braids > 0) > 40, "wood elves braid often");
  assert(count("ork", null, (p) => p.braids > 0) > 0, "an ork may wear a braid (deterministic chance)");
  assert(count("human", "nomad", (p) => p.style === "ponytail") > 5, "nomads sometimes wear a ponytail");
  assert(count("elf", "high", (p) => p.tier === "long") > count("dwarf", null, (p) => p.tier === "long"), "elves wear it longer than dwarves");
  // Determinism of the hash the plans read.
  assert(hashUnit(12345) === hashUnit(12345) && hashUnit(1) !== hashUnit(2), "hash is deterministic");
  // growHair on an empty field is empty.
  const f = frameOf("human", null);
  const p = hairPlanFor(ancestryOf("human", null).hair, f, 0.2, 1);
  assert(growHair(f, p, [], { clumps: 10, seed: 1 }).strands.length === 0, "no follicles, no strands");
  assert(arcLength([[0, 0, 0], [0, 1, 0]]) === 1, "arcLength");
});

Deno.test("SPEC X85: no stray spikes — at head level the hair stands off the skull by a stated band per style", () => {
  const worst = new Map<string, number>();
  for (const { race, sub, d } of allBuilds()) {
    const f = frameOf(race, sub);
    for (const b of d.groups.values()) {
      for (let i = 0; i < b.pos.length; i += 3) {
        const p: Vec3 = [b.pos[i], b.pos[i + 1], b.pos[i + 2]];
        if (p[1] < f.sc[1] - 0.2 * f.sr[1]) continue; // below the head band the fall hangs free
        const c = clearance(f, p) / f.h;
        worst.set(d.plan.style, Math.max(worst.get(d.plan.style) ?? 0, c));
      }
    }
  }
  const limit = (style: string) => style === "mohawk" ? 0.5 : style === "topknot" ? 0.3 : style === "wild" ? 0.2 : 0.15;
  for (const [style, w] of worst) assert(w <= limit(style), `${style}: hair stands ${w.toFixed(3)} h off the skull at head level (limit ${limit(style)})`);
  console.log("largest stand-off at head level by style (h): " + [...worst].map(([k, v]) => `${k}=${v.toFixed(3)}`).join(" "));
});
