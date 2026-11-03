// Wave GEN lane B: measure the stat morph, the race posture and the race digits on the generated bodies.
// Writes artifacts/wave-gen/anatomy/measure.json and regenerates the tables of docs/wave-gen/ANATOMY.md
// between the GENERATED markers (no number in that doc is typed by hand).
//
//   deno run -A tools/measure-wave-gen-anatomy.ts            # measure + write JSON + docs
//   deno run -A tools/measure-wave-gen-anatomy.ts --docs     # docs from the existing JSON only

import { anatomyFor, type DetailedAnatomy } from "../src/graphics/body/Anatomy.ts";
import { generateBody, skinField } from "../src/graphics/body/BodyMesh.ts";
import { measureMorph, type MorphMeasure } from "../src/graphics/body/Physique.ts";
import { statMorph } from "../src/graphics/body/StatMorph.ts";
import { handSize } from "../src/graphics/body/Hands.ts";
import type { BodySpec, GeneratorStats, MeshData } from "../src/graphics/body/contracts.ts";
import { hitboxCoverage, hitboxesFromPlan } from "../src/combat/Hitboxes.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import type { Appearance } from "../src/game/Characters.ts";

const OUT = "artifacts/wave-gen/anatomy/measure.json";
const DOC = "docs/wave-gen/ANATOMY.md";

/** The verifiers' reference bodies (tools/verify-wave-gen-geo.ts RACE_SPECS), seed 1234567, Warrior. */
export const BODIES: Record<string, { subrace: string; height: number; weight: number }> = {
  human: { subrace: "imperial", height: 1.75, weight: 75 },
  elf: { subrace: "high", height: 1.85, weight: 66 },
  dwarf: { subrace: "mountain", height: 1.38, weight: 82 },
  ork: { subrace: "ironhide", height: 1.95, weight: 118 },
};
const RACES = ["human", "elf", "dwarf", "ork"] as const;
const SEXES = ["male", "female"] as const;
const REF: GeneratorStats = { strength: 500, agility: 500, intelligence: 500, level: 500 };

export function specOf(race: string, sex: "male" | "female", stats: Partial<GeneratorStats> | null): BodySpec {
  const R = BODIES[race];
  return { race, subrace: R.subrace, className: "Warrior", height: R.height, weight: R.weight, seed: 1234567, sex, ...(stats ? { stats: { ...REF, ...stats } } : {}) };
}

/** Enclosed volume of a closed mesh (divergence theorem), m³. */
export function meshVolume(m: MeshData): number {
  const p = m.positions, ix = m.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

const S = { d: 0, region: 0, bone: 0 };
function measurePlan(plan: DetailedAnatomy): MorphMeasure {
  const f = skinField(plan);
  return measureMorph((x, y, z) => f.sample(x, y, z, S).d, plan);
}
const physKey = (p: DetailedAnatomy) => JSON.stringify([p.root, p.bones, p.bounds]);

async function measure() {
  const strength: unknown[] = [], posture: unknown[] = [], brow: unknown[] = [], maturity: unknown[] = [], digits: unknown[] = [];
  for (const race of RACES) for (const sex of SEXES) {
    const refPhys = physKey(anatomyFor(specOf(race, sex, null)));
    for (const st of [0, 500, 1000]) {
      const spec = specOf(race, sex, { strength: st });
      const b = generateBody(spec);
      const m = measurePlan(b.plan);
      // The combat capsules fitted from the plan (lane P: hitRoot ?? root) against the RENDERED skin.
      const cov = hitboxCoverage(hitboxesFromPlan(b.plan, { mass: spec.weight }), b.mesh.positions, skinField(b.plan), 3);
      // The whole live rig (body + face + hands + hair + weapon), the < 12 000 budget's subject.
      const look = { body: "#c98a63", accent: "#6b4130", height: spec.height, weight: spec.weight, hair: "#1a1a1a", eyes: "#2f6fb5", race, subrace: spec.subrace, sex } as Appearance;
      const rigTris = st === 250 ? 0 : buildSkinnedHumanoid(generateClassWeapon("Warrior"), look, "fire", spec).triangleCount;
      strength.push({
        rigTriangles: rigTris, skinCell: (b.plan as { skinCell?: number }).skinCell ?? b.plan.cell, cell: b.plan.cell,
        hitCoveragePct: cov.coveragePct, hitUncoveredMaxMm: cov.uncoveredMaxMm, hitOvershootP95Mm: cov.overshootP95Mm,
        race, sex, strength: st, ...m, volume: meshVolume(b.mesh), triangles: b.stats.triangles, components: b.stats.components,
        boundaryEdges: b.stats.boundaryEdges, nonManifoldEdges: b.stats.nonManifoldEdges, physicsIdentical: physKey(b.plan) === refPhys,
        hitRoot: !!b.plan.hitRoot, head: b.plan.proportions.head,
      });
      console.log(race, sex, st, b.stats.triangles, b.stats.components);
    }
    if (sex === "male") {
      // Posture: the race's curve vs the same body built erect (a human posture/digit morph).
      const spec = specOf(race, sex, null);
      const erect = anatomyFor(spec, { physique: { morph: statMorph(null, "human", null, sex) } });
      const own = anatomyFor(spec);
      const me = measurePlan(erect), mo = measurePlan(own);
      posture.push({
        race, subrace: BODIES[race].subrace, head: own.proportions.head, curve: own.morph.posture,
        headForwardErect: me.headForward, headForward: mo.headForward, neckFrontErect: me.neckFrontZ, neckFront: mo.neckFrontZ,
        lumbarErect: me.lumbarDepth, lumbar: mo.lumbarDepth, trapErect: me.trapeziusTopY, trap: mo.trapeziusTopY,
        eyeShift: own.face.eye[0][2] - erect.face.eye[0][2],
      });
      for (const iq of [0, 500, 1000]) {
        const p = anatomyFor(specOf(race, sex, { intelligence: iq }));
        brow.push({ race, intelligence: iq, browFrontZ: measurePlan(p).browFrontZ, recessMm: p.morph.browRecessMm, anchorZ: p.face.brow[0][2] });
      }
      for (const lv of [0, 500, 1000]) {
        const b = generateBody(specOf(race, sex, { level: lv }));
        const m = measurePlan(b.plan);
        maturity.push({ race, level: lv, mass: b.plan.morph.maturity.mass, lift: b.plan.morph.maturity.liftPerHead, height: b.plan.morph.maturity.height, pectoralFrontZ: m.pectoralFrontZ, volume: meshVolume(b.mesh), crown: b.stats.maxY });
      }
      // Digits: the rendered hand from the race's own proportions and digit distribution.
      const P = own.proportions;
      const inp = { hand: P.hand, palmHalfWidth: P.radius.palmHalfWidth, palmHalfThickness: P.radius.palmHalfThickness, wrist: P.radius.wrist, thumb: 1 as const };
      const hs = handSize({ ...inp, digits: own.morph.digits }), h0 = handSize(inp);
      const fl = (x: ReturnType<typeof handSize>) => x.phalanx[1][0] + x.phalanx[1][1] + x.phalanx[1][2];
      digits.push({
        race, distribution: own.morph.digits, hand: P.hand,
        fingerR: hs.fingerR[1], fingerRNeutral: h0.fingerR[1], knuckleR: hs.fingerR[1] * (hs.knuckleK ?? 1), middleLen: fl(hs), middleLenNeutral: fl(h0),
        palmHalfW: hs.halfW, palmHalfWNeutral: h0.halfW, palmHalfT: hs.halfT, lenPerRadius: fl(hs) / hs.fingerR[1],
      });
    }
  }
  const data = { generated: new Date().toISOString(), bodies: BODIES, strength, posture, brow, maturity, digits };
  await Deno.mkdir("artifacts/wave-gen/anatomy", { recursive: true });
  await Deno.writeTextFile(OUT, JSON.stringify(data, null, 1));
  return data;
}

// ---------------------------------------------------------------------------------------------
// docs
type Row = Record<string, number | string | boolean>;
const mm = (v: number) => (Math.round(v * 10000) / 10).toFixed(1);
const pct = (a: number, b: number) => `${((a / b - 1) * 100).toFixed(1)} %`;

function tables(d: { strength: Row[]; posture: Row[]; brow: Row[]; maturity: Row[]; digits: Row[] }): string {
  const out: string[] = [];
  out.push("### Strength: muscle girths, shoulder breadth, mass (mm; volume = mesh volume, mass change at constant density)\n");
  out.push("| race | sex | str | biceps | quadriceps | calf | pec front z | back z at the lats | trapezius top y | shoulder breadth | arm-trunk gap | volume (L) | mass vs ref | skin tris | skin cell / cell | live rig tris | comps | physics = ref |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of d.strength) {
    const ref = d.strength.find((q) => q.race === r.race && q.sex === r.sex && q.strength === 500)!;
    out.push(`| ${r.race} | ${r.sex} | ${r.strength} | ${mm(r.bicepsGirth as number)} | ${mm(r.quadricepsGirth as number)} | ${mm(r.calfGirth as number)} | ${mm(r.pectoralFrontZ as number)} | ${mm(r.latBackZ as number)} | ${mm(r.trapeziusTopY as number)} | ${mm(r.shoulderBreadth as number)} | ${mm(r.armGap as number)} | ${((r.volume as number) * 1000).toFixed(2)} | ${pct(r.volume as number, ref.volume as number)} | ${r.triangles} | ${((r.skinCell as number) / (r.cell as number)).toFixed(3)} | ${r.rigTriangles} | ${r.components} | ${r.physicsIdentical} |`);
  }
  out.push("\n### Combat capsules vs the rendered skin (Hitboxes fitted from hitRoot ?? root; every 3rd skin vertex)\n");
  out.push("| race | sex | str | hitRoot | coverage (r + slack) | worst uncovered (mm) | overshoot p95 (mm) |");
  out.push("|---|---|---|---|---|---|---|");
  for (const r of d.strength) out.push(`| ${r.race} | ${r.sex} | ${r.strength} | ${r.hitRoot} | ${(r.hitCoveragePct as number).toFixed(2)} % | ${(r.hitUncoveredMaxMm as number).toFixed(1)} | ${(r.hitOvershootP95Mm as number).toFixed(1)} |`);
  out.push("\n### Landmarks under inflation (mm; every max-strength value >= its reference value)\n");
  out.push("| race | sex | str | clavicle valley | sternal groove | kneecap groove | inguinal (iliac) groove |");
  out.push("|---|---|---|---|---|---|---|");
  for (const r of d.strength) out.push(`| ${r.race} | ${r.sex} | ${r.strength} | ${mm(r.clavicleValley as number)} | ${mm(r.sternalGroove as number)} | ${mm(r.kneecapProud as number)} | ${mm(r.iliacGroove as number)} |`);
  out.push("\n### Race posture (male, stats absent; \"erect\" = the same body sculpted with the human curve)\n");
  out.push("| race / sub-race | head h (mm) | neck fwd (h) | lumbar (h) | trap x | head fwd erect -> own | neck front erect -> own | lumbar depth erect -> own | trapezius top erect -> own | face anchors moved |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of d.posture) {
    const c = r.curve as unknown as Row;
    out.push(`| ${r.race} / ${r.subrace} | ${mm(r.head as number)} | ${c.neckForwardPerHead} | ${c.lumbarDepthPerHead} | ${c.trapezius} | ${mm(r.headForwardErect as number)} -> ${mm(r.headForward as number)} | ${mm(r.neckFrontErect as number)} -> ${mm(r.neckFront as number)} | ${mm(r.lumbarErect as number)} -> ${mm(r.lumbar as number)} | ${mm(r.trapErect as number)} -> ${mm(r.trap as number)} | ${mm(r.eyeShift as number)} |`);
  }
  out.push("\n### Intelligence -> brow recess (male; brow ridge front z on the field at the brow anchor)\n");
  out.push("| race | int | morph recess (mm) | brow front z (mm) | change vs 500 (mm) |");
  out.push("|---|---|---|---|---|");
  for (const r of d.brow) {
    const ref = d.brow.find((q) => q.race === r.race && q.intelligence === 500)!;
    out.push(`| ${r.race} | ${r.intelligence} | ${(r.recessMm as number).toFixed(2)} | ${mm(r.browFrontZ as number)} | ${mm((r.browFrontZ as number) - (ref.browFrontZ as number))} |`);
  }
  out.push("\n### Level -> maturity (male)\n");
  out.push("| race | level | mass term | chest lift (h) | height term | pec front z (mm) | volume (L) | vs ref | crown y (mm) |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of d.maturity) {
    const ref = d.maturity.find((q) => q.race === r.race && q.level === 500)!;
    out.push(`| ${r.race} | ${r.level} | ${(r.mass as number).toFixed(3)} | ${(r.lift as number).toFixed(4)} | ${r.height} | ${mm(r.pectoralFrontZ as number)} | ${((r.volume as number) * 1000).toFixed(2)} | ${pct(r.volume as number, ref.volume as number)} | ${mm(r.crown as number)} |`);
  }
  out.push("\n### Race digit distribution (rendered hand from the race's own proportions; middle finger)\n");
  out.push("| race | length x | radius x | knuckle x | palm x | finger r (mm) | knuckle r (mm) | middle length (mm) | length / radius | palm half-width (mm) | palm half-thickness (mm) |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of d.digits) {
    const D = r.distribution as unknown as Row;
    out.push(`| ${r.race} | ${D.length} | ${D.radius} | ${D.knuckle} | ${D.palm} | ${mm(r.fingerR as number)} | ${mm(r.knuckleR as number)} | ${mm(r.middleLen as number)} | ${(r.lenPerRadius as number).toFixed(2)} | ${mm(r.palmHalfW as number)} | ${mm(r.palmHalfT as number)} |`);
  }
  return out.join("\n");
}

const BEGIN = "<!-- GENERATED:BEGIN tools/measure-wave-gen-anatomy.ts -->", END = "<!-- GENERATED:END -->";
async function writeDocs(d: Parameters<typeof tables>[0]) {
  let doc = "";
  try { doc = await Deno.readTextFile(DOC); } catch { doc = `# Wave GEN — lane B: anatomy\n\n${BEGIN}\n${END}\n`; }
  const i = doc.indexOf(BEGIN), j = doc.indexOf(END);
  const body = `${BEGIN}\n\n${tables(d)}\n\n${END}`;
  doc = i >= 0 && j > i ? doc.slice(0, i) + body + doc.slice(j + END.length) : doc + "\n" + body + "\n";
  await Deno.writeTextFile(DOC, doc);
}

if (import.meta.main) {
  const data = Deno.args.includes("--docs") ? JSON.parse(await Deno.readTextFile(OUT)) : await measure();
  await writeDocs(data);
  console.log(`wrote ${OUT} and ${DOC}`);
}
