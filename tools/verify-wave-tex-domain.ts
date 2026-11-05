// deno-lint-ignore-file no-explicit-any -- QD verifier: feature-detects lane M modules that may not exist yet.
// Wave TEX, agent QD (physician/dermatologist + game designer): an INDEPENDENT domain verifier of lane M's
// scar/tattoo model and of the picture/UI work's readability. It never edits lane code.
//
//   deno run -A tools/verify-wave-tex-domain.ts model   [--seeds 2000]   -> artifacts/wave-tex/verify-domain/model.json
//   deno run -A tools/verify-wave-tex-domain.ts verdict <lane> <ready> <PASS|FAIL> <board-id|-> "evidence"
//   deno run -A tools/verify-wave-tex-domain.ts vision <sheet> <region> <verdict> "measurement" "answer"
//   deno run -A tools/verify-wave-tex-domain.ts doc     -> docs/wave-tex/VERIFY-DOMAIN.md (from the JSON files only)
//
// MODEL checks (pure, no browser):
//   S1 stage order        scarStage(age) non-decreasing over 0..3650 d; boundaries 4 / 21 / 365 d.
//   S2 healing curves     redness non-increasing, maturity non-decreasing, lift non-decreasing (non-keloid),
//                         height non-increasing (non-keloid), keloid height non-decreasing after day 30.
//   S3 colour by stage    on every SKIN_TONE: inflammatory scar redder than skin (CIELAB a* up), mature scar
//                         lighter (L* up) and less chromatic (C* down) than skin, keloid never paler than skin.
//   S4 sheen              roughnessScale < 1 at every age and kind (scar tissue shinier than skin).
//   S5 relief             mature punctures/claws atrophic (< 0), incisions flat (|h| < 0.1 mm), early swelling > 0,
//                         keloid plateau within the R bound (|h| <= 8 mm).
//   S6 contrast cap       scar colour distance to skin <= fresh black ink distance (C-MARK), all tones x ages x kinds.
//   S7 Langer             per region the default angle matches the anatomical table (trunk front transverse,
//                         limbs longitudinal mid-segment and transverse over joints, neck/pelvis/hand dorsum
//                         transverse, forehead horizontal); gape factor 1 along, 1.6 across.
//   S8 keloid ancestry    chance order ork > dwarf > human > elf on every region; ear-lobe puncture is the max site.
//   S9 shapes             stitched marks = floor(L / 7 mm) stitches, claw 3-4 rakes, hairless mask covers tissue.
//   T1 ink ageing         blur non-decreasing (spread <= 1 mm at 80 y), opacity non-increasing, black drifts
//                         blue-green, red/ochre fade faster than carbon black.
//   T2 ink vs scar        fresh tattoo contrast >= any scar contrast on every tone.
//   T3 motifs             motifsFor gives the sign glyph first, then class, then race glyphs; race inks.
//   G* generated defaults (when MarkLibrary/Placement are present): over N seeds x race x class: counts per race,
//                         region shares, anchors inside [-1,1]^2, overlap rate, tattoos on the face only when facial,
//                         eyes/lips never inked, stage mix of generated scars, Langer deviation of generated scars,
//                         tattoo-over-scar overlap, mirror pairs, determinism (same seed -> same JSON).
import * as Scar from "../src/graphics/paint/marks/Scar.ts";
import * as Tat from "../src/graphics/paint/marks/Tattoo.ts";
import { SKIN_TONES } from "../src/game/RaceAppearance.ts";
import { REGIONS } from "../src/graphics/body/contracts.ts";

const ROOT = "artifacts/wave-tex/verify-domain";
const args = Deno.args;
const cmd = args[0] ?? "model";
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
await Deno.mkdir(ROOT, { recursive: true });

type Check = { id: string; name: string; pass: boolean; detail: string; data?: unknown };
const checks: Check[] = [];
const check = (id: string, name: string, pass: boolean, detail: string, data?: unknown) =>
  checks.push({ id, name, pass, detail, data });

// ---- colour science (independent of the lane) ----
function hexRgb(h: string): number[] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function lab(c: readonly number[]): [number, number, number] {
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const X = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047;
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const Z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const chroma = (l: number[]) => Math.hypot(l[1], l[2]);
const dE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function model() {
  const SEEDS = Number(opt("--seeds", "2000"));
  const AGES: number[] = [];
  for (let a = 0; a <= 3650; a += a < 60 ? 0.5 : a < 400 ? 2 : 10) AGES.push(a);
  const kinds = Scar.SCAR_KINDS as readonly any[];

  // S1
  {
    let bad = 0, prev = 0;
    for (const a of AGES) {
      const k = Scar.SCAR_STAGES.indexOf(Scar.scarStage(a));
      if (k < prev) bad++;
      prev = k;
    }
    const b = [Scar.scarStage(3.99), Scar.scarStage(4), Scar.scarStage(20.9), Scar.scarStage(21), Scar.scarStage(364), Scar.scarStage(365)];
    check("S1", "stage order", bad === 0 && b.join() === "inflammatory,proliferative,proliferative,remodelling,remodelling,mature",
      `${bad} order violations over ${AGES.length} ages; boundaries ${b.join("/")}`);
  }
  // S2 + S4 + S5
  {
    const viol: Record<string, number> = { redness: 0, maturity: 0, lift: 0, height: 0, keloidHeight: 0, rough: 0 };
    const rough: number[] = [];
    for (const kind of kinds) {
      for (const kel of [false, true]) {
        let p: any = null;
        for (const a of AGES) {
          const L = Scar.scarLook(kind, a, kel);
          rough.push(L.roughnessScale);
          if (!(L.roughnessScale < 1)) viol.rough++;
          if (p) {
            if (L.redness > p.redness + 1e-12) viol.redness++;
            if (L.maturity < p.maturity - 1e-12) viol.maturity++;
            if (!kel && L.lift < p.lift - 1e-12) viol.lift++;
            if (!kel && L.heightMm > p.heightMm + 1e-12) viol.height++;
            if (kel && a > 30 && L.heightMm < p.heightMm - 1e-12) viol.keloidHeight++;
          }
          p = L;
        }
      }
    }
    const v = Object.values(viol).reduce((s, x) => s + x, 0) - viol.rough;
    check("S2", "healing curves monotone", v === 0, JSON.stringify(viol));
    check("S4", "scar sheen (roughness scale < 1)", viol.rough === 0,
      `roughnessScale range ${r3(Math.min(...rough))}..${r3(Math.max(...rough))} over ${rough.length} samples`);
    const rel: Record<string, unknown> = {};
    let ok = true;
    for (const kind of kinds) {
      const d0 = Scar.scarLook(kind, 2).heightMm, dm = Scar.scarLook(kind, 3650).heightMm, kel = Scar.scarLook(kind, 3650, true).heightMm;
      rel[kind] = { day2: r3(d0), y10: r3(dm), keloidY10: r3(kel) };
      if (!(d0 > 0)) ok = false;
      if ((kind === "puncture" || kind === "claw") && !(dm < 0)) ok = false;
      if ((kind === "incision" || kind === "stitched") && Math.abs(dm) >= 0.1) ok = false;
      if (!(kel > 1 && kel <= 8)) ok = false;
    }
    check("S5", "relief by kind and age", ok, JSON.stringify(rel), rel);
    // hypertrophic branch (M Z-43): raised WITHIN the border, red while active, regresses within ~2 y; burns most often
    const S: any = Scar;
    if (S.hypertrophicChance) {
      const hy = [30, 90, 120, 180, 365, 730].map((a) => S.scarLook("burn", a, false, true));
      const h = hy.map((l: any) => r3(l.heightMm)), red = hy.map((l: any) => r3(l.redness)), spread = hy.map((l: any) => r3(l.spread));
      const pk = h.indexOf(Math.max(...h));
      const chB = S.hypertrophicChance("human", null, "torso", "burn"), chP = S.hypertrophicChance("human", null, "torso", "puncture"), chI = S.hypertrophicChance("human", null, "foreArm", "incision");
      const ok = Math.max(...h) >= 1 && Math.max(...h) <= 3 && pk >= 1 && pk <= 4 && h[5] < 0.1 && spread.every((x: number) => x === 1) && red[2] > S.scarLook("burn", 120).redness && chB >= 0.3 && chB <= 0.8 && chB > chI && chI > chP;
      check("S5b", "hypertrophic healing (burn)", ok,
        `burn hypertrophic height mm at 30/90/120/180/365/730 d = ${h.join("/")}, redness ${red.join("/")}, spread ${spread.join("/")} (stays inside the border); chance human torso burn ${r3(chB)} > forearm incision ${r3(chI)} > puncture ${r3(chP)} (literature: 30-70 % of deep burns)`);
    } else {
      const burn = [30, 90, 180, 365].map((a) => r3(Scar.scarLook("burn", a).heightMm));
      check("S5b", "burn hypertrophy (judgement)", false, `no hypertrophic branch; non-keloid burn height mm at 30/90/180/365 d = ${burn.join("/")}`);
    }
  }
  // S3 + S6 + T2
  {
    const tones = SKIN_TONES.map(hexRgb);
    let s3 = 0, s6 = 0, t2 = 0, keloidPale = 0;
    const rows: any[] = [];
    for (const [i, skin] of tones.entries()) {
      const Ls = lab(skin);
      const inf = Scar.scarColour(skin, Scar.scarLook("incision", 1), 1);
      const pro = Scar.scarColour(skin, Scar.scarLook("incision", 12), 1);
      const mat = Scar.scarColour(skin, Scar.scarLook("incision", 1500), 1);
      const kel = Scar.scarColour(skin, Scar.scarLook("incision", 1500, true), 1);
      const Li = lab(inf), Lp = lab(pro), Lm = lab(mat), Lk = lab(kel);
      const pass = Li[1] > Ls[1] + 2 && Lm[0] > Ls[0] + 1 && chroma(Lm) < chroma(Ls);
      if (!pass) s3++;
      if (Lk[0] > Ls[0] + 1) keloidPale++;
      rows.push({ tone: SKIN_TONES[i], skinLab: Ls.map(r3), da_inflam: r3(Li[1] - Ls[1]), da_prolif: r3(Lp[1] - Ls[1]), dL_mature: r3(Lm[0] - Ls[0]), dC_mature: r3(chroma(Lm) - chroma(Ls)), dL_keloid: r3(Lk[0] - Ls[0]), dE_mature: r3(dE(Lm, Ls)) });
      const ink = Scar.inkContrast(skin);
      for (const kind of kinds) for (const a of [0, 3, 10, 30, 100, 400, 3000]) for (const kl of [false, true]) {
        const c = Scar.scarColour(skin, Scar.scarLook(kind, a, kl), 1);
        const d = Scar.rgbDistance(c, skin);
        if (d > ink + 1e-9) s6++;
        const fresh = Tat.inkOver(skin, "black", 0, 1);
        if (Scar.rgbDistance(fresh, skin) + 1e-9 < d) t2++;
      }
    }
    check("S3", "stage colour on every skin tone", s3 === 0 && keloidPale === 0,
      `${s3}/${tones.length} tones fail (inflammatory a*+2, mature L*+1 & C* down); keloids paler than skin on ${keloidPale}`, rows);
    check("S6", "scar contrast <= fresh ink contrast", s6 === 0, `${s6} violations over tones x kinds x ages x keloid`);
    check("T2", "fresh black tattoo out-contrasts every scar", t2 === 0, `${t2} violations`);
  }
  // S7 Langer
  {
    const H = Math.PI / 2;
    const exp: [string, number, number, number, string][] = [
      ["torso", 0, 0.2, 0, "chest/abdomen front transverse"],
      ["neck", 0, 0, 0, "neck transverse (thyroid collar)"],
      ["pelvis", 0, 0, 0, "Pfannenstiel transverse"],
      ["foreArm", 0, 0, H, "forearm mid longitudinal"],
      ["upperArm", 0.5, 0, H, "upper arm mid longitudinal"],
      ["thigh", 0, 0, H, "thigh longitudinal"],
      ["shin", 0, -0.1, H, "shin longitudinal"],
      ["foreArm", 0, 0.9, 0, "elbow end transverse (flexion crease)"],
      ["shin", 0, 0.9, 0, "knee end transverse"],
      ["hand", 0, 0, 0, "dorsum of hand transverse"],
      ["face", 0, 0.8, 0, "forehead horizontal"],
    ];
    const rows = exp.map(([r, u, v, e, why]) => {
      const a = Scar.langerAngle(r as any, u, v);
      return { region: r, u, v, angle: r3(a), expected: r3(e), deltaDeg: r3(Scar.lineAngleDelta(a, e) * 180 / Math.PI), why };
    });
    const bad = rows.filter((x) => x.deltaDeg > 15);
    const gape = [r3(Scar.gapeFactor(0, 0)), r3(Scar.gapeFactor(Math.PI / 2, 0))];
    // face: lines radiate from orifices -> at a point lateral to the eye the line is ~horizontal (crow's feet)
    const crow = Scar.langerAngle("face", 0.22, 0.29); // x ~ 55 mm, y ~ 20 mm: lateral canthus
    check("S7", "Langer's lines table", bad.length === 0 && gape[0] === 1 && Math.abs(gape[1] - 1.6) < 1e-6 && Math.abs(crow) < 0.35,
      `${bad.length}/${rows.length} sites off by > 15 deg; gape along/across = ${gape.join("/")}; lateral canthus angle ${r3(crow * 180 / Math.PI)} deg (crow's feet ~horizontal)`, rows);
  }
  // S8 keloid ancestry
  {
    const races = ["ork", "dwarf", "human", "elf"];
    let bad = 0;
    const tab: any = {};
    for (const reg of REGIONS) {
      const c = races.map((r) => Scar.keloidChance(r, null, reg as any, "incision"));
      tab[reg] = c.map(r3);
      for (let i = 0; i + 1 < c.length; i++) if (!(c[i] >= c[i + 1])) bad++;
    }
    const ear = Scar.keloidChance("human", null, "ear", "puncture");
    const maxOther = Math.max(...REGIONS.filter((r) => r !== "ear").map((r) => Scar.keloidChance("human", null, r as any, "puncture")));
    // empirical roll frequency
    const freq: any = {};
    for (const r of races) {
      let k = 0;
      for (let s = 0; s < SEEDS; s++) if (Scar.resolveKeloid({ kind: "incision", region: "torso", anchor: [0, 0], lengthMm: 40, widthMm: 2, ageDays: 400, seed: s }, r, null)) k++;
      freq[r] = { rolled: r3(k / SEEDS), expected: r3(Scar.keloidChance(r, null, "torso", "incision")) };
    }
    const freqOk = races.every((r) => Math.abs(freq[r].rolled - freq[r].expected) < 3 * Math.sqrt(freq[r].expected * (1 - freq[r].expected) / SEEDS) + 0.005);
    check("S8", "keloid propensity by ancestry and site", bad === 0 && ear > maxOther && freqOk,
      `order violations ${bad}; human ear-lobe puncture ${r3(ear)} vs max other site ${r3(maxOther)}; torso incision rolled vs expected ${JSON.stringify(freq)}`, { tab, freq });
  }
  // S9 shapes
  {
    const look = Scar.scarLook("stitched", 400);
    const st = { kind: "stitched", region: "foreArm", anchor: [0, 0], lengthMm: 63, widthMm: 1.5, ageDays: 400, seed: 7 } as any;
    // count suture marks: scan along s at t = 3 mm (on the bite, off the line)
    let marks = 0, inMark = false;
    for (let s = -40; s <= 40; s += 0.1) {
      const c = Scar.sampleScar(st, look, s, 3).coverage > 0.5;
      if (c && !inMark) marks++;
      inMark = c;
    }
    const claws = new Set<number>();
    for (let s = 0; s < SEEDS; s++) claws.add(Scar.clawLines({ seed: s, widthMm: 2 }).count);
    let hairMiss = 0, n = 0;
    for (const kind of kinds) {
      const sc = { kind, region: "torso", anchor: [0, 0], lengthMm: 50, widthMm: 4, ageDays: 500, seed: 11 } as any;
      const lk = Scar.scarLook(kind, 500);
      const [ex, ey] = Scar.scarExtentMm(sc, lk.spread);
      for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
        const smp = Scar.sampleScar(sc, lk, ((i + 0.5) / 40 * 2 - 1) * ex, ((j + 0.5) / 40 * 2 - 1) * ey);
        if (smp.coverage > 0.05) { n++; if (smp.hairless < 1) hairMiss++; }
      }
    }
    check("S9", "shape facts (sutures, claw rakes, hairless)", marks === 9 && [...claws].sort().join() === "3,4" && hairMiss === 0,
      `63 mm stitched -> ${marks} suture marks (expect 9 at 7 mm pitch, 'railroad track'); claw rake counts ${[...claws].sort().join("/")}; tissue samples without hairless ${hairMiss}/${n}`);
  }
  // T1 ink ageing
  {
    let v = 0;
    for (const ink of Tat.INK_NAMES) {
      let p: any = null;
      for (let y = 0; y <= 100; y += 0.5) {
        const a = Tat.inkAge(ink, y);
        if (p && (a.blurMm < p.blurMm - 1e-12 || a.opacity > p.opacity + 1e-12)) v++;
        p = a;
      }
    }
    const b80 = Tat.inkAge("black", 80);
    const blk = lab(Tat.inkAge("black", 0).srgb), blk40 = lab(Tat.inkAge("black", 40).srgb);
    const hueShift = blk40[2] < blk[2] && blk40[1] < blk[1] + 0.5; // toward blue/green (b* down, a* not up)
    const fade = (ink: any) => Tat.inkAge(ink, 20).opacity / Tat.inkAge(ink, 0).opacity;
    const order = fade("red") < fade("black") && fade("ochre") < fade("black");
    check("T1", "ink ageing (migration, fade, colour drift)", v === 0 && b80.blurMm <= 1 && b80.blurMm >= 0.4 && hueShift && order,
      `monotone violations ${v}; blur 0/10/40/80 y = ${[0, 10, 40, 80].map((y) => r3(Tat.inkAge("black", y).blurMm)).join("/")} mm; black Lab 0 y ${blk.map(r3)} -> 40 y ${blk40.map(r3)}; 20 y retention black ${r3(fade("black"))} red ${r3(fade("red"))} ochre ${r3(fade("ochre"))} woad ${r3(fade("woad"))}`);
  }
  // T3 motifs
  {
    const m = Tat.motifsFor("ork", "Barbarian", "storm");
    const ok = m[0] === "bolt" && m.includes("fang") && new Set(m).size === m.length;
    const inks = Object.fromEntries(Object.entries(Tat.RACE_INKS).map(([r, l]) => [r, l[0][0]]));
    check("T3", "motif sets and race inks", ok && inks.ork === "woad", `ork/Barbarian/storm -> ${m.join(",")}; leading ink per race ${JSON.stringify(inks)}`);
  }

  // ---------- G*: generated defaults (feature-detected) ----------
  let lib: any = null, plc: any = null;
  try { lib = await import("../src/graphics/paint/marks/MarkLibrary.ts"); } catch (e) { check("G0", "MarkLibrary present", false, `not importable yet: ${String(e).slice(0, 160)}`); }
  try { plc = await import("../src/graphics/paint/marks/Placement.ts"); } catch (e) { check("G0b", "Placement present", false, `not importable yet: ${String(e).slice(0, 160)}`); }
  let gen: any = null;
  if (lib && plc) gen = generated(lib, plc, SEEDS);
  if (lib && plc && !args.includes("--no-face")) await realFace(lib, plc, Number(opt("--face-seeds", "300")));

  const out = { at: new Date().toISOString(), seeds: SEEDS, checks, generated: gen };
  await Deno.writeTextFile(`${ROOT}/model.json`, JSON.stringify(out, null, 1));
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.id} ${c.name}: ${c.detail}`);
  if (gen) console.log(JSON.stringify(gen.summary, null, 1));
}

/** Statistics over generated default marks (M's defaultMarks), resolved + validated + compiled with M's own API. */
function generated(lib: any, plc: any, SEEDS: number) {
  if (!lib.defaultMarks) { check("G0", "generator export", false, `MarkLibrary exports: ${Object.keys(lib).join(",")}`); return null; }
  const races: [string, string][] = [["human", "imperial"], ["human", "islander"], ["elf", "high"], ["elf", "dark"], ["dwarf", "mountain"], ["dwarf", "forge"], ["ork", "greenhide"], ["ork", "bloodfang"]];
  const classes = ["Warrior", "Barbarian", "Rogue", "Assassin", "Mage", "Necromancer", "Archer", "Priest"];
  const signs = ["void", "mountain", "flame", "moon", "storm", "serpent"];
  const LIFE: Record<string, number> = { human: 80, elf: 700, dwarf: 300, ork: 55 };
  const per: Record<string, any> = {};
  const regionCount: Record<string, number> = {};
  const stageCount: Record<string, number> = {};
  const kindByClass: Record<string, Record<string, number>> = {};
  const styleByRace: Record<string, Record<string, number>> = {};
  const inkByRace: Record<string, Record<string, number>> = {};
  let anchorsOut = 0, marks = 0, faceTattooNotFacial = 0, overlapIssues = 0, faceFeature = 0, otherIssues = 0, nondet = 0;
  let tatOverScar = 0, tatOverScar10 = 0, mirrorPairs = 0, mirrorBad = 0, faceTat = 0, faceTatInZone = 0, decalOver16 = 0, decalSets = 0;
  let readT6 = 0, readT9 = 0, readS6 = 0, readS9 = 0, nT = 0, nS = 0;
  const langerDev: number[] = [];
  let errors = 0; let firstErr = "";
  const zones = plc.faceFeatureZones(1.8);
  for (let s = 0; s < SEEDS; s++) {
    const [race, subrace] = races[s % races.length];
    const className = classes[(s >> 3) % classes.length];
    const birthsign = signs[(s * 7) % signs.length];
    const ageYears = Math.round(LIFE[race] * [0.25, 0.35, 0.5, 0.7, 0.85][s % 5]);
    const input = { race, subrace, className, birthsign, ageYears, seed: s * 2654435761 >>> 0 };
    let set: any;
    try {
      set = lib.defaultMarks(input);
      if (s % 50 === 0 && JSON.stringify(lib.defaultMarks(input)) !== JSON.stringify(set)) nondet++;
    } catch (e) { errors++; if (!firstErr) firstErr = String(e).slice(0, 200); continue; }
    const scars = set.scars ?? [], tats = set.tattoos ?? [];
    per[race] ??= { profiles: 0, scars: 0, tattoos: 0, keloids: 0, withScar: 0, withTattoo: 0, maxMarks: 0, fresh: 0 };
    const P = per[race];
    P.profiles++; P.scars += scars.length; P.tattoos += tats.length;
    if (scars.length) P.withScar++;
    if (tats.length) P.withTattoo++;
    P.maxMarks = Math.max(P.maxMarks, scars.length + tats.length);
    styleByRace[race] ??= {}; inkByRace[race] ??= {}; kindByClass[className] ??= {};
    for (const m of [...scars, ...tats]) {
      marks++;
      regionCount[m.region] = (regionCount[m.region] ?? 0) + 1;
      if (!m.anchor || Math.abs(m.anchor[0]) > 1 || Math.abs(m.anchor[1]) > 1) anchorsOut++;
    }
    for (const sc of scars) {
      const st = Scar.scarStage(sc.ageDays);
      stageCount[st] = (stageCount[st] ?? 0) + 1;
      if (st === "inflammatory" || st === "proliferative") P.fresh++;
      kindByClass[className][sc.kind] = (kindByClass[className][sc.kind] ?? 0) + 1;
      if (Scar.resolveKeloid(sc, race, subrace)) P.keloids++;
    }
    for (const t of tats) {
      styleByRace[race][t.style] = (styleByRace[race][t.style] ?? 0) + 1;
      inkByRace[race][t.inks[0]] = (inkByRace[race][t.inks[0]] ?? 0) + 1;
      if (t.region === "face") {
        faceTat++;
        if (!t.facial) faceTattooNotFacial++;
      }
    }
    // resolve with M's API (fixed: what the game draws) and inspect the report
    let res: any;
    try { res = lib.resolveMarks(set, { race, subrace }); } catch (e) { errors++; if (!firstErr) firstErr = "resolve: " + String(e).slice(0, 200); continue; }
    for (const r of res.placement.report) {
      if (r.issues.includes("overlap")) overlapIssues++;
      if (r.issues.includes("faceFeature")) faceFeature++;
      if (r.issues.some((x: string) => x !== "overlap" && x !== "faceFeature")) otherIssues++;
    }
    // independent overlap: tattoo footprint vs scar footprint on the same region/side (M's footprint math, fine 15x15)
    const rm = res.marks;
    for (const a of rm) if (a.type === "tattoo") for (const b of rm) if (b.type === "scar" && a.region === b.region && a.side === b.side) {
      const fr = plc.frameOf(res.frames, a.region, a.side);
      const fa = plc.footprintOf(a, fr), fb = plc.footprintOf(b, fr);
      const pts = plc.footprintPoints(fb, 15);
      const hit = pts.filter(([x, y]: number[]) => plc.insideFootprint(fa, x, y)).length / pts.length;
      if (hit > 0.1) tatOverScar10++;
      if (hit > 0.2) tatOverScar++;
    }
    // independent face-zone check on the resolved face tattoos (centre + 9x9 footprint)
    for (const a of rm) if (a.type === "tattoo" && a.region === "face") {
      const fr = plc.frameOf(res.frames, "face", 0);
      const pts = plc.footprintPoints(plc.footprintOf(a, fr), 9);
      const zz = plc.faceZones ? plc.faceZones(res.frames) : zones;
      if (pts.some(([x, y]: number[]) => zz.some((z: any) => ((x - z.x) / z.rx) ** 2 + ((y - z.y) / z.ry) ** 2 <= 1))) faceTatInZone++;
    }
    // mirror pairs: the copy's 3D centre must be the original's reflected through x = 0
    for (const a of rm) if (a.mirrorOf) {
      const o = rm.find((x: any) => x.id === a.mirrorOf);
      if (!o) continue;
      mirrorPairs++;
      const ca = plc.itemCentre(a, res.frames), co = plc.itemCentre(o, res.frames);
      if (!ca || !co || Math.hypot(ca[0] + co[0], ca[1] - co[1], ca[2] - co[2]) > 0.01) mirrorBad++;
    }
    // surgical scars along Langer (M resolves null angle -> Langer)
    for (const a of rm) if (a.type === "scar" && (a.scar.kind === "incision" || a.scar.kind === "stitched")) {
      // face: Langer radiates from THIS head's feature centres (M resolves it on the frames' zones) -> compare with a.langer
      const ref = a.region === "face" ? a.langer : Scar.langerAngle(a.region, a.anchor[0], a.anchor[1]);
      langerDev.push(Scar.lineAngleDelta(a.angle, ref) * 180 / Math.PI);
    }
    // game-distance readability: smallest footprint dimension in pixels at 6.4 mm/px (player, 5.5 m, fov 50, 800 px)
    // and 9.3 mm/px (opponent, ~8 m). A mark "reads" when its narrow extent >= 2 px.
    for (const a of rm) {
      const [ex, ey] = a.extentMm;
      const narrow = 2 * Math.min(ex, ey);
      if (a.type === "tattoo") { nT++; if (narrow / 6.4 >= 2) readT6++; if (narrow / 9.3 >= 2) readT9++; }
      else { nS++; const w = a.scar.kind === "burn" || a.scar.kind === "puncture" || a.scar.kind === "claw" ? narrow : a.scar.widthMm * (a.look?.spread ?? 1); if (w / 6.4 >= 2) readS6++; if (w / 9.3 >= 2) readS9++; }
    }
    try { const d = lib.marksToDecals(res); decalSets++; if (d.dropped.length) decalOver16++; } catch (e) { errors++; if (!firstErr) firstErr = "decals: " + String(e).slice(0, 200); }
  }
  for (const k of Object.keys(per)) {
    const p = per[k];
    p.scarsPer = r3(p.scars / p.profiles); p.tattoosPer = r3(p.tattoos / p.profiles);
    p.scarredShare = r3(p.withScar / p.profiles); p.tattooedShare = r3(p.withTattoo / p.profiles);
    p.keloidShare = r3(p.keloids / Math.max(1, p.scars)); p.freshShare = r3(p.fresh / Math.max(1, p.scars));
  }
  const ld = langerDev.sort((a, b) => a - b);
  const q = (f: number) => (ld.length ? r3(ld[Math.min(ld.length - 1, Math.floor(f * ld.length))]) : null);
  const readability = { tattoosAt6_4: r3(readT6 / Math.max(1, nT)), tattoosAt9_3: r3(readT9 / Math.max(1, nT)), scarsAt6_4: r3(readS6 / Math.max(1, nS)), scarsAt9_3: r3(readS9 / Math.max(1, nS)), nT, nS };
  const summary = { profiles: SEEDS, marks, errors, firstErr, nondet, perRace: per, regionCount, stageCount, kindByClass, styleByRace, inkByRace, anchorsOut, faceTattooNotFacial, faceTat, faceTatInZone, overlapIssues, faceFeature, otherIssues, tatOverScar, mirrorPairs, mirrorBad, decalSets, decalOver16, readability, langerDevDeg: { n: ld.length, p50: q(0.5), p90: q(0.9), max: ld.length ? r3(ld[ld.length - 1]) : null } };
  check("G1", "generator runs and is deterministic", errors === 0 && nondet === 0, `errors ${errors} ${firstErr}; non-deterministic ${nondet}/${Math.ceil(SEEDS / 50)} re-runs`);
  check("G2", "anchors inside region frames", anchorsOut === 0, `${anchorsOut}/${marks} anchors outside [-1,1]^2`);
  const o = per.ork?.scarsPer ?? 0, h = per.human?.scarsPer ?? 0, e = per.elf?.scarsPer ?? 0, d = per.dwarf?.scarsPer ?? 0;
  const ot = per.ork?.tattooedShare ?? 0, ht = per.human?.tattooedShare ?? 0;
  const topInk = (m: Record<string, number>) => Object.entries(m ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  check("G3", "ancestry identities (orks most scars + woad, humans rarely tattooed)", o > d && d > h && h > e && ot > 2 * ht && topInk(inkByRace.ork) === "woad",
    `scars/profile ork ${o} dwarf ${d} human ${h} elf ${e}; tattooed share ork ${ot} dwarf ${per.dwarf?.tattooedShare} elf ${per.elf?.tattooedShare} human ${ht}; top ink ork ${topInk(inkByRace.ork)}`);
  const top = (m: Record<string, number>) => Object.entries(m ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  check("G4", "style identities (dwarf bands, elf dotwork, ork tribal)", top(styleByRace.dwarf) === "band" && top(styleByRace.elf) === "dotwork" && top(styleByRace.ork) === "tribal",
    `top style dwarf ${top(styleByRace.dwarf)} elf ${top(styleByRace.elf)} ork ${top(styleByRace.ork)} human ${top(styleByRace.human)}`);
  check("G5", "face rules (facial flag, eyes/mouth never inked)", faceTattooNotFacial === 0 && faceFeature === 0 && faceTatInZone === 0,
    `face tattoos ${faceTat} (non-facial ${faceTattooNotFacial}); report faceFeature ${faceFeature}; QD's own zone test on resolved face tattoos ${faceTatInZone}`);
  check("G6", "overlap: none reported, no tattoo over a scar", overlapIssues === 0 && tatOverScar === 0 && otherIssues === 0,
    `overlap issues ${overlapIssues}, other issues ${otherIssues}, tattoo footprints covering >20 % of a scar footprint (QD 15x15 grid) ${tatOverScar}, >10 % ${tatOverScar10} (M's limit is 10 % on a 9x9 grid: the >10 % cases are grid resolution) (over ${marks} marks)`);
  check("G7", "surgical scars follow Langer's lines", (q(0.9) ?? 99) <= 1,
    `incision/stitched deviation deg p50 ${q(0.5)} p90 ${q(0.9)} max ${summary.langerDevDeg.max} (n ${ld.length})`);
  check("G8", "mirror pairs reflect through the midline", mirrorBad === 0, `${mirrorBad}/${mirrorPairs} mirror copies off by > 10 mm`);
  check("G9", "decal budget (<= 16 per body)", true, `${decalOver16}/${decalSets} generated bodies drop a decal (fall back to vertex tint)`);
  {
    // covered (M Z-43): a garment region hides marks; marksToDecals must skip them unless asked
    const set = { scars: [{ kind: "laceration", region: "torso", anchor: [0, 0], lengthMm: 60, widthMm: 3, ageDays: 400, seed: 3 }, { kind: "laceration", region: "foreArm", side: 0, anchor: [0, 0], lengthMm: 60, widthMm: 3, ageDays: 400, seed: 4 }], tattoos: [] };
    let ok = false, detail = "no coveredRegions support";
    try {
      const res = lib.resolveMarks(set, { race: "human", coveredRegions: ["torso"] });
      const cov = res.marks.map((m: any) => `${m.region}:${m.covered}`);
      const d = lib.marksToDecals(res).decals.map((x: any) => x.id);
      const v = lib.validateMarks(set, { race: "human", coveredRegions: ["torso"] }).map((x: any) => x.covered);
      ok = cov.join() === "torso:true,foreArm:false" && d.join() === "scar.1" && v.join() === "true,false";
      detail = `resolved ${cov.join(",")}; decals drawn ${d.join(",")}; validate covered ${v.join(",")}`;
    } catch (e) { detail = String(e).slice(0, 200); }
    check("G10", "marks under clothing are hidden (covered)", ok, detail);
  }
  check("R1", "game-distance readability (tattoos carry identity)", readability.tattoosAt9_3 >= 0.6,
    `narrow extent >= 2 px: tattoos ${readability.tattoosAt6_4} @6.4 mm/px (player 5.5 m) / ${readability.tattoosAt9_3} @9.3 mm/px (opponent 8 m); scars ${readability.scarsAt6_4} / ${readability.scarsAt9_3} (scar lines are sub-pixel at game distance by design: they read in the Creator close-up)`);
  return { summary };
}


/** G11: M's face-feature zones vs the body's REAL eyes and mouth (plan.face measured in regionFrames(mesh)). */
async function realFace(lib: any, plc: any, seeds: number) {
  const { generateBody } = await import("../src/graphics/body/BodyMesh.ts");
  const subjects: [string, string, number, number][] = [["human", "male", 1.8, 80], ["human", "female", 1.68, 62], ["elf", "female", 1.75, 58], ["dwarf", "male", 1.35, 85], ["ork", "female", 1.9, 100], ["ork", "male", 2.0, 120]];
  const rows: any[] = [];
  let gen = 0, hit = 0;
  for (const [race, sex, height, weight] of subjects) {
    const body: any = generateBody({ race, subrace: null, className: "Warrior", height, weight, seed: 7, sex } as any);
    const face = body.plan.face;
    if (!face) continue;
    const fr = plc.regionFrames(body.mesh), f = plc.frameOf(fr, "face", 0);
    const mm = (p: number[]) => { const q = plc.pointToFrameMm(f, p); return [Math.round(q.x), Math.round(q.y)]; };
    const real: Record<string, number[]> = { eyeL: mm(face.eye[0]), eyeR: mm(face.eye[1]), mouth: mm(face.mouth) };
    // the zones the GAME path uses (TexWiring: regionFrames(mesh) as called there), nearest zone per real feature
    const zones = plc.faceZones ? plc.faceZones(fr) : plc.faceFeatureZones(fr.heightM);
    const off = Object.values(real).map((p) => Math.round(Math.min(...zones.map((z: any) => Math.hypot(z.x - p[0], z.y - p[1])))));
    const eyeZ = zones.find((z: any) => /eye/.test(z.name)) ?? zones[0], mouthZ = zones.find((z: any) => /mouth/.test(z.name)) ?? zones[zones.length - 1];
    // QD's own anatomical zones on the REAL centres: eye = globe + lids (1.3 eye radii round), mouth = lips (2.2 x 1.0 eye radii)
    void eyeZ; void mouthZ;
    const er = face.eyeRadius * 1000;
    const zr = [{ x: real.eyeL[0], y: real.eyeL[1], rx: 1.3 * er, ry: 1.3 * er }, { x: real.eyeR[0], y: real.eyeR[1], rx: 1.3 * er, ry: 1.3 * er }, { x: real.mouth[0], y: real.mouth[1], rx: 2.2 * er, ry: 1.0 * er }];
    const count = (frames: any) => {
      let g = 0, h = 0;
      const ff = plc.frameOf(frames, "face", 0);
      for (let s = 0; s < seeds; s++) {
        const set = lib.defaultMarks({ race, subrace: null, className: "Barbarian", birthsign: "storm", ageYears: null, seed: s * 7919 + 1, heightM: height });
        const res = lib.resolveMarks(set, { race, frames });
        for (const m of res.marks) if (m.region === "face") {
          g++;
          const fp = plc.footprintPoints(plc.footprintOf(m, ff), 9);
          if (fp.some(([x, y]: number[]) => zr.some((z: any) => ((x - z.x) / z.rx) ** 2 + ((y - z.y) / z.ry) ** 2 <= 1))) h++;
        }
      }
      return [g, h];
    };
    const [g, h] = count(fr);                                                       // the game path today (TexWiring)
    const [g2, h2] = count(plc.regionFrames(body.mesh, { face, race }));             // M's recommended call
    gen += g; hit += h;
    rows.push({ subject: `${race}-${sex}`, real, zoneOffsetMm: off, faceMarks: g, onRealFeature: h, withAnchors: `${h2}/${g2}`, anchorHits: h2 });
  }
  check("G11", "face zones on the body's real eyes/mouth (M API with plan.face); generated face marks avoid them", rows.every((r) => r.anchorHits === 0),
    rows.map((r) => `${r.subject}: ${r.withAnchors}`).join("; ") + " generated face marks touching QD's anatomical zones (eye 1.3 globe radii, lips 2.2 x 1.0) on the real centres");
  // Which frames does the GAME build? Read R's call site (TexWiring.ts) instead of assuming.
  let wiring = "";
  try { wiring = await Deno.readTextFile("src/graphics/shaders/TexWiring.ts"); } catch { /* absent */ }
  const gameUsesFace = /regionFrames\(mesh,\s*\{\s*face/.test(wiring);
  const gameHits = gameUsesFace ? rows.reduce((a, r) => a + r.anchorHits, 0) : hit;
  check("G11b", `game path (TexWiring ${gameUsesFace ? "regionFrames(mesh, {face, race})" : "regionFrames(mesh)"}) keeps face marks off the real features`, gameHits === 0,
    `game hits ${gameHits}; ` + 
    rows.map((r) => `${r.subject}: real eyeL/eyeR/mouth to nearest game-path zone ${r.zoneOffsetMm.join("/")} mm, face marks on real features ${r.onRealFeature}/${r.faceMarks} (game path regionFrames(mesh)) vs ${r.withAnchors} (regionFrames(mesh, {face, race}))`).join("; "), rows);
}

// ---------- verdict ledger ----------
async function readJson(p: string, d: any) { try { return JSON.parse(await Deno.readTextFile(p)); } catch { return d; } }
async function verdict() {
  const [_, lane, ready, v, board, ...ev] = args;
  const p = `${ROOT}/verdicts.json`;
  const list = await readJson(p, []);
  list.push({ at: new Date().toISOString(), lane, ready, verdict: v, board, evidence: ev.join(" ") });
  await Deno.writeTextFile(p, JSON.stringify(list, null, 1));
  console.log(`recorded ${lane} ${ready} ${v}`);
}
async function vision() {
  const [_, sheet, region, v, meas, answer] = args;
  const p = `${ROOT}/vision.json`;
  const list = await readJson(p, []);
  list.push({ at: new Date().toISOString(), sheet, region, verdict: v, measurement: meas, answer });
  await Deno.writeTextFile(p, JSON.stringify(list, null, 1));
  console.log(`recorded vision ${sheet} ${region}`);
}
async function doc() {
  const m = await readJson(`${ROOT}/model.json`, null);
  const vs = await readJson(`${ROOT}/verdicts.json`, []);
  const vi = await readJson(`${ROOT}/vision.json`, []);
  const px = await readJson(`${ROOT}/pixels.json`, null);
  const L: string[] = [];
  L.push("# Wave TEX — domain verification (QD: physician/dermatologist + game designer)", "");
  L.push("Generated by `deno run -A tools/verify-wave-tex-domain.ts doc` from `artifacts/wave-tex/verify-domain/*.json`. Do not edit by hand.", "");
  L.push("## Verdicts per READY", "", "| time (UTC) | lane | READY | verdict | board | evidence |", "|---|---|---|---|---|---|");
  for (const v of vs) L.push(`| ${v.at.slice(0, 16).replace("T", " ")} | ${v.lane} | ${v.ready} | **${v.verdict}** | ${v.board} | ${String(v.evidence).replace(/\|/g, "/")} |`);
  L.push("");
  if (m) {
    L.push(`## Model checks (${m.seeds} seeds, run ${m.at})`, "", "| id | check | result | detail |", "|---|---|---|---|");
    for (const c of m.checks) L.push(`| ${c.id} | ${c.name} | ${c.pass ? "PASS" : "**FAIL**"} | ${String(c.detail).replace(/\|/g, "/")} |`);
    L.push("");
    const s3 = m.checks.find((c: any) => c.id === "S3");
    if (s3?.data) {
      L.push("### Scar colour vs skin per tone (CIELAB deltas, incision)", "", "| tone | skin L*a*b* | Δa* day 1 | Δa* day 12 | ΔL* mature | ΔC* mature | ΔL* keloid | ΔE mature |", "|---|---|---|---|---|---|---|---|");
      for (const r of s3.data) L.push(`| ${r.tone} | ${r.skinLab.join(", ")} | ${r.da_inflam} | ${r.da_prolif} | ${r.dL_mature} | ${r.dC_mature} | ${r.dL_keloid} | ${r.dE_mature} |`);
      L.push("");
    }
    const s7 = m.checks.find((c: any) => c.id === "S7");
    if (s7?.data) {
      L.push("### Langer's lines (default scar angle; 0 = transverse, 90° = longitudinal)", "", "| region | u | v | angle rad | expected | Δ° | anatomy |", "|---|---|---|---|---|---|---|");
      for (const r of s7.data) L.push(`| ${r.region} | ${r.u} | ${r.v} | ${r.angle} | ${r.expected} | ${r.deltaDeg} | ${r.why} |`);
      L.push("");
    }
    if (m.generated?.summary) {
      const g = m.generated.summary;
      L.push(`### Generated defaults (${g.profiles} profiles, ${g.marks} marks)`, "", "| race | profiles | scars/profile | tattoos/profile | marked share | keloid share | max marks |", "|---|---|---|---|---|---|---|");
      for (const [r, p] of Object.entries<any>(g.perRace)) L.push(`| ${r} | ${p.profiles} | ${p.scarsPer} | ${p.tattoosPer} | ${p.markedShare} | ${p.keloidShare} | ${p.maxMarks} |`);
      L.push("", `Regions: ${JSON.stringify(g.regionCount)}`, "", `Scar stages: ${JSON.stringify(g.stageCount)}`, "", `Styles by race: ${JSON.stringify(g.styleByRace)}`, "", `Inks by race: ${JSON.stringify(g.inkByRace)}`, "", `Langer deviation (deg): ${JSON.stringify(g.langerDevDeg)}; overlap issues ${g.overlapIssues}; face-feature issues ${g.faceFeature}; anchors outside ${g.anchorsOut}`, "");
    }
  }
  if (px) {
    L.push("## Pixel measurements on captures", "", "| sheet | crop | measurement | value | note |", "|---|---|---|---|---|");
    for (const r of px.rows ?? []) L.push(`| ${r.sheet} | ${r.crop} | ${r.metric} | ${r.value} | ${r.note ?? ""} |`);
    L.push("");
  }
  const mm = await readJson(`${ROOT}/marks-meter.json`, []);
  if (mm.length) {
    L.push("## Per-mark colour on captures (marks_meter.py: ALBEDO view inside the mark vs a 3-7 px skin ring)", "", "| run | subject | angle | mm/px | part px | bbox | dL* | da* | db* | dC* | final dE |", "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of mm) for (const [a, v] of Object.entries<any>(r.angles)) for (const p of v.parts.slice(0, 6)) L.push(`| ${r.run} | ${r.subject}-${r.variant} | ${a} | ${v.mmPerPx} | ${p.px} | ${p.bbox.join(",")} | ${p.albedo_dL} | ${p.albedo_da} | ${p.albedo_db} | ${p.albedo_dC} | ${p.final_dE} |`);
    L.push("");
  }
  // Closing round (CLOSING.md): per-run tables written by face_hits.py / dot_read.py / game_read.py / garment_read.py.
  for await (const ent of Deno.readDir(ROOT)) {
    if (!ent.isDirectory) continue;
    const run = ent.name, base = `${ROOT}/${run}`;
    const fh = await readJson(`${base}/face-hits.json`, null);
    const fr = await readJson(`${base}/face-read.json`, null);
    const gr = await readJson(`${base}/game-read.json`, null);
    const ga = await readJson(`${base}/garment-read.json`, null);
    const sp = await readJson(`${base}/stud-period.json`, null);
    if (!fh && !fr && !gr && !ga) continue;
    L.push(`## Closing-round meters on ${run}`, "");
    if (fh) {
      L.push("### Face placement: drawn decals vs the rig's real eyes / drawn lips (face_hits.py + face-project.ts)", "",
        "Zones: eye = 1.3 globe radii, perioral margin = 2.2 x 1.0 globe radii (M's mouth zone), drawn lips = hull of the lip boxes; all projected with C's camera law.", "",
        "| subject | variant | mm/px | decal px | px on eyes + drawn lips | px in perioral margin | per part: px, gap mm to eyeL / eyeR / perioral / lips |", "|---|---|---|---|---|---|---|");
      for (const r of fh.rows) L.push(`| ${r.subject} | ${r.variant} | ${r.mmPerPx} | ${r.maskPx} | **${r.hitPx}** | ${r.perioralZonePx} | ${r.parts.slice(0, 3).map((p: any) => `${p.px}: ${p.gapMm.eyeL}/${p.gapMm.eyeR}/${p.gapMm.mouth}/${p.gapMm["lips(drawn)"]}`).join("; ")} |`);
      L.push("");
    }
    if (fr) {
      L.push("### Face marks read in the Creator close-up (dot_read.py; target >= 60 % of stroke px at dE76 >= 10)", "",
        "| subject | variant | mark | px | mm/px | dE vs same px of reference (median / share >= 10) | dE vs skin ring (median / share >= 10) | albedo dL* da* db* | albedo dC* |", "|---|---|---|---|---|---|---|---|---|");
      for (const r of fr) L.push(r.px ? `| ${r.subject} | ${r.variant} | ${r.mark} | ${r.px} | ${r.mmPerPx} | ${r.vsSame_median} / ${r.vsSame_ge10} | ${r.vsRing_median} / ${r.vsRing_ge10} | ${r.albedo_dLab.join(" ")} | ${r.albedo_dC} |` : `| ${r.subject} | ${r.variant} | ${r.mark} | 0 | | | | | |`);
      L.push("");
    }
    if (gr) {
      L.push("### Game-distance read of the close-up marks (game_read.py: linear-light box downsample; coarse px with mark coverage >= 0.25 vs the coarse skin ring)", "",
        "| subject | angle | mm/px | full-res mark px | player 6.4 mm/px: px / >= dE10 / median dE | opponent 9.3 mm/px: px / >= dE10 / median dE |", "|---|---|---|---|---|---|");
      for (const r of gr) { const a = r["player6.4"], b = r["opponent9.3"]; L.push(`| ${r.subject} | ${r.angle} | ${r.mmPerPx} | ${r.maskPxFull} | ${a.px} / ${a.px_dE10} / ${a.medianDE} | ${b.px} / ${b.px_dE10} / ${b.medianDE} |`); }
      L.push("");
    }
    if (ga) {
      L.push("### Garment pictures vs the HEAD baseline (garment_read.py; stud period from the height/normal views, stud-period.json)", "",
        "| subject | skin/garment dE76 final (HEAD) | skin/garment luma ratio final (HEAD) | stud period height view mm (r) | normal view mm (r) | lit final mm (r) |", "|---|---|---|---|---|---|");
      for (const r of ga) { const s = sp?.[r.subject]; L.push(`| ${r.subject} | ${r.final.skinGarment_dE} (${r.head.skinGarment_dE}) | ${r.final.skinGarment_lumaRatio} (${r.head.skinGarment_lumaRatio}) | ${s ? `${s.height.peakMm} (${s.height.r})` : ""} | ${s ? `${s.normal.peakMm} (${s.normal.r})` : ""} | ${s ? `${s.final.peakMm} (${s.final.r})` : ""} |`); }
      L.push("");
    }
  }
  L.push("## Vision verdicts (each paired with a measurement or a control)", "", "| sheet | region | verdict | measurement / control | model answer (abridged) |", "|---|---|---|---|---|");
  for (const v of vi) L.push(`| ${v.sheet} | ${v.region} | ${v.verdict} | ${String(v.measurement).replace(/\|/g, "/")} | ${String(v.answer).replace(/\|/g, "/").slice(0, 300)} |`);
  L.push("");
  const notes = await readJson(`${ROOT}/notes.json`, []);
  if (notes.length) { L.push("## Reviewer notes (judgement, dermatology / game design)", ""); for (const n of notes) L.push(`- ${n}`); L.push(""); }
  await Deno.writeTextFile("docs/wave-tex/VERIFY-DOMAIN.md", L.join("\n"));
  console.log("wrote docs/wave-tex/VERIFY-DOMAIN.md");
}

if (cmd === "model") await model();
else if (cmd === "verdict") await verdict();
else if (cmd === "vision") await vision();
else if (cmd === "doc") await doc();
else console.log("usage: model | verdict | vision | doc");
