// Wave TEX lane U — the Creator's material UI (contract C-UI): SPEC TX70-TX79.
// Pure modules only (TexState, MarkEdit, TexSources, TexStudio markup) plus the preview's key and a real rig's
// skin for the placement raycast's frame anchor. The browser wiring is proven by tools/probe-wave-tex-ui.ts.
import { CHANNEL_VIEWS as R_VIEWS } from "../src/graphics/shaders/MaterialChannels.ts";
import { applyLayerOverrides as lApply, type LayerStackV2, type StackNode } from "../src/graphics/paint/LayerStack.ts";
import { INK_NAMES as M_INKS, TATTOO_STYLES as M_STYLES } from "../src/graphics/paint/marks/Tattoo.ts";
import { MARK_REGIONS as M_REGIONS, TATTOO_REGIONS as M_TATTOO_REGIONS } from "../src/graphics/paint/marks/Placement.ts";
import { MARK_RANGES as M_RANGES, MAX_SCARS, MAX_TATTOOS, sanitizeMarks } from "../src/graphics/paint/marks/MarkLibrary.ts";
import { REGIONS } from "../src/graphics/body/contracts.ts";
import {
  applyLayerOverrides, CHANNEL_VIEWS, type LayerOverride, type LayerRow, nextViewIndex, overrideCount, parseLayerOverrides, reorderOverride,
  resetOverrides, setOverride, texKey,
} from "../src/ui/TexState.ts";
import { addMark, getMark, INK_NAMES, MARK_RANGES, MAX_MARKS, type MarkSetRec, parseMarkSet, regionsFor, removeMark, TATTOO_STYLES, updateMark } from "../src/ui/MarkEdit.ts";
import { COVERED_TEXT, coveredRegionsOf, layerRowsFor, markIssues, operatorChoices, pickAnchor, type PickMesh } from "../src/ui/TexSources.ts";
import { channelViewsHtml, layersPanelHtml, marksPanelHtml, texStudioHtml } from "../src/ui/TexStudio.ts";
import { buildPreviewRig, previewKey } from "../src/graphics/PreviewScene.ts";
import { PRESETS, type CharacterProfile } from "../src/game/Characters.ts";
import { createProfile, ProfileRepo, type Store } from "../src/game/Profiles.ts";
import { createFromCharacter, libraryEntries } from "../src/game/ProfileLibrary.ts";
import { rollProfile } from "../src/ui/CreatorRoll.ts";
import { mulberry32 } from "../src/ui/Menu.ts";
import { frameOf, frameMmToPoint, regionFrames, uvToMm } from "../src/graphics/paint/marks/Placement.ts";
import type { MeshData } from "../src/graphics/body/contracts.ts";

function assert(c: unknown, msg: string): asserts c {
  if (!c) throw new Error(msg);
}
/** JSON with sorted object keys (key order is not data). */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
}
function eq<T>(a: T, b: T, msg: string): void {
  const sa = canon(a), sb = canon(b);
  if (sa !== sb) throw new Error(`${msg}\n  got:  ${sa}\n  want: ${sb}`);
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hero: CharacterProfile = { ...PRESETS[0], appearance: { ...PRESETS[0].appearance } };

Deno.test("SPEC TX70: the channel view list is R's (same ids, same order) and the radio row's arrow law wraps", () => {
  eq([...CHANNEL_VIEWS], [...R_VIEWS], "U's views == R's CHANNEL_VIEWS");
  const n = CHANNEL_VIEWS.length;
  eq(nextViewIndex(0, "ArrowLeft"), n - 1, "left from the first wraps to the last");
  eq(nextViewIndex(n - 1, "ArrowRight"), 0, "right from the last wraps");
  eq([nextViewIndex(3, "Home"), nextViewIndex(3, "End"), nextViewIndex(3, "a")], [0, n - 1, null], "Home/End/other");
  eq(nextViewIndex(NaN, "ArrowDown"), 1, "garbage index reads as 0");
  const html = channelViewsHtml("roughness");
  eq((html.match(/role="radio"/g) ?? []).length, n, "one radio per view");
  eq((html.match(/aria-checked="true"/g) ?? []).length, 1, "exactly one checked");
  assert(/data-tex-view="roughness" aria-checked="true" tabindex="0"/.test(html), "the checked one is the tab stop");
});

Deno.test("SPEC TX71: parseLayerOverrides is TOTAL on hostile saves (never throws, clamps, dedupes, drops junk)", () => {
  const r = rng(71);
  const junk: unknown[] = [null, 1, "x", [], {}, { id: 5 }, { id: "a b" }, { id: "<script>" }, { id: "ok" }, { id: "x".repeat(65), enabled: true }];
  let n = 0;
  for (let k = 0; k < 2000; k++) {
    const list: unknown[] = [];
    for (let i = 0; i < 1 + Math.floor(r() * 6); i++) {
      const pick = r();
      list.push(pick < 0.3 ? junk[Math.floor(r() * junk.length)] : {
        id: ["skin.wash", "skin.edge", "garment.torso.glaze", "p:skin.varnish"][Math.floor(r() * 4)],
        enabled: r() < 0.5 ? r() < 0.5 : "yes", opacity: r() < 0.2 ? NaN : r() < 0.2 ? Infinity : (r() - 0.25) * 3,
        order: r() < 0.5 ? Math.floor((r() - 0.3) * 40) : "3", blend: r() < 0.5 ? { albedo: "multiply", roughness: r() < 0.5 ? "add" : 7, "bad key": "x" } : "multiply",
      });
    }
    const out = parseLayerOverrides(k % 50 === 0 ? "garbage" : list);
    for (const o of out) {
      n++;
      assert(typeof o.id === "string" && /^[A-Za-z0-9_.:\-]{1,64}$/.test(o.id), `id ${o.id}`);
      assert(o.opacity === undefined || (o.opacity >= 0 && o.opacity <= 1), `opacity ${o.opacity}`);
      assert(o.order === undefined || (Number.isInteger(o.order) && o.order >= 0), `order ${o.order}`);
      assert(o.enabled === undefined || typeof o.enabled === "boolean", "enabled bool");
      for (const [c, op] of Object.entries(o.blend ?? {})) assert(/^[\w.:-]+$/.test(c) && typeof op === "string", `blend ${c}=${op}`);
      assert(Object.keys(o).length > 1, "an override that changes nothing is dropped");
    }
    eq(new Set(out.map((o) => o.id)).size, out.length, "one entry per id");
  }
  assert(n > 1000, `exercised ${n} sanitised overrides`);
});

/** A LayerStackV2 with one constant-source layer per inspector row (to run L's applyLayerOverrides beside ours). */
function stackOfRows(rows: readonly LayerRow[]): LayerStackV2 {
  const nodes: StackNode[] = rows.map((r) => ({
    kind: "layer", id: r.id, name: r.name, enabled: r.enabled, opacity: r.opacity, source: { kind: "constant" },
    writes: Object.entries(r.blend).map(([channel, op]) => ({ channel, op })) as never,
  }));
  return { version: 2, nodes };
}

Deno.test("SPEC TX72: the inspector's view of the overrides == L's applyLayerOverrides (enabled, opacity, op per channel, order) on 400 random edit sets", () => {
  const profile = rollProfile(mulberry32(72)).profile;
  const base = layerRowsFor(profile);
  assert(base.length >= 6, `P's preset gives the inspector a real stack (${base.length} rows)`);
  const r = rng(72);
  let checked = 0;
  for (let k = 0; k < 400; k++) {
    const ov: LayerOverride[] = [];
    let movesLeft = k % 3 === 0 ? 3 : 1;
    for (const row of base) {
      if (r() > 0.35) continue;
      const o: LayerOverride = { id: row.id };
      if (r() < 0.5) o.enabled = r() < 0.5;
      if (r() < 0.5) o.opacity = Math.round(r() * 100) / 100;
      const chans = Object.keys(row.blend);
      if (chans.length && r() < 0.5) { const c = chans[Math.floor(r() * chans.length)]; const ops = operatorChoices(c); o.blend = { [c]: ops[Math.floor(r() * ops.length)] }; }
      if (movesLeft > 0 && r() < 0.3) { o.order = Math.floor(r() * base.length); movesLeft--; }
      ov.push(o);
    }
    const ours = applyLayerOverrides(base, ov).map((x) => [x.id, x.enabled, x.opacity, x.blend]);
    const theirs = (lApply(stackOfRows(base), ov as never).nodes as StackNode[]).map((n) => [n.id, n.enabled, n.opacity, n.kind === "layer" ? Object.fromEntries(n.writes.map((w) => [w.channel, w.op])) : {}]);
    // The inspector's per-node values must match L's exactly; the ORDER law is pinned where no two moves collide.
    const sortById = (a: unknown[][]) => [...a].sort((p, q) => String(p[0]).localeCompare(String(q[0])));
    eq(sortById(ours), sortById(theirs), `edit set ${k}: values`);
    const moves = ov.filter((o) => o.order !== undefined).length;
    if (moves <= 1) { eq(ours.map((x) => x[0]), theirs.map((x) => x[0]), `edit set ${k}: order (${moves} move)`); checked++; }
  }
  assert(checked > 200, `order compared on ${checked} sets`);
});

Deno.test("SPEC TX72b: any sequence of inspector drags (reorderOverride) renders in the SAME order under L's applyLayerOverrides (300 sequences x 1-6 drags)", () => {
  const base = layerRowsFor(rollProfile(mulberry32(721)).profile);
  const r = rng(722);
  for (let k = 0; k < 300; k++) {
    let ov: LayerOverride[] = [];
    const want = base.map((x) => x.id);
    for (let d = 0; d < 1 + Math.floor(r() * 6); d++) {
      const from = Math.floor(r() * base.length), to = Math.floor(r() * base.length);
      ov = reorderOverride(ov, base, from, to);
      const [x] = want.splice(from, 1); want.splice(to, 0, x);
    }
    eq(applyLayerOverrides(base, ov).map((x) => x.id), want, `sequence ${k}: inspector order`);
    eq((lApply(stackOfRows(base), ov as never).nodes as StackNode[]).map((n) => n.id), want, `sequence ${k}: L's order`);
  }
});

Deno.test("SPEC TX73: setOverride/reorder/reset — a value back at the preset drops the override; a drag moves exactly one row; Reset clears", () => {
  const base = layerRowsFor(hero);
  const id = base[2].id, ch = Object.keys(base[2].blend)[0];
  let ov = setOverride([], base, id, { enabled: !base[2].enabled });
  eq(overrideCount(ov), 1, "toggle = 1 edit");
  ov = setOverride(ov, base, id, { enabled: base[2].enabled });
  eq(ov, [], "toggle back = no override at all (the save stays clean)");
  ov = setOverride(ov, base, id, { opacity: 0.4 });
  eq(applyLayerOverrides(base, ov).find((r) => r.id === id)!.opacity, 0.4, "opacity applied");
  if (ch) {
    const alt = operatorChoices(ch).find((o) => o !== base[2].blend[ch])!;
    ov = setOverride(ov, base, id, { channel: ch, op: alt });
    eq(applyLayerOverrides(base, ov).find((r) => r.id === id)!.blend[ch], alt, "operator applied");
    ov = setOverride(ov, base, id, { channel: ch, op: base[2].blend[ch] });
    assert(!ov[0].blend, "operator back at the preset drops the blend entry");
  }
  for (let from = 0; from < base.length; from++) for (const to of [0, Math.floor(base.length / 2), base.length - 1]) {
    const moved = applyLayerOverrides(base, reorderOverride([], base, from, to)).map((r) => r.id);
    const want = base.map((r) => r.id); const [x] = want.splice(from, 1); want.splice(to, 0, x);
    eq(moved, want, `drag ${from} -> ${to}`);
  }
  // two successive drags compose
  const ov2 = reorderOverride(reorderOverride([], base, 0, 3), base, 5, 1);
  const want2 = base.map((r) => r.id); { const [a] = want2.splice(0, 1); want2.splice(3, 0, a); const [b] = want2.splice(5, 1); want2.splice(1, 0, b); }
  eq(applyLayerOverrides(base, ov2).map((r) => r.id), want2, "two drags compose");
  eq(overrideCount(reorderOverride([], base, 0, base.length - 1)), 1, "one drag = one edit, however many rows it displaced");
  eq(resetOverrides(ov2), [], "Reset to preset");
  eq(resetOverrides([...ov2, { id: "x.y", enabled: false }], "x.y").length, ov2.length, "per-layer reset");
});

Deno.test("SPEC TX74: marks editing — lists equal M's, add/remove/update stay inside the ranges, caps hold, a hostile save sanitises", () => {
  eq([...TATTOO_STYLES], [...M_STYLES], "styles == M's");
  eq([...INK_NAMES], [...M_INKS], "inks == M's");
  eq([...regionsFor("scar")], [...M_REGIONS], "scar regions == M's MARK_REGIONS");
  eq([...regionsFor("tattoo")], [...M_TATTOO_REGIONS], "tattoo regions == M's TATTOO_REGIONS");
  let set: MarkSetRec = { scars: [], tattoos: [] };
  for (let i = 0; i < 20; i++) { const a = addMark(set, "scar", "x"); if (a) set = a.set; }
  eq(set.scars.length, MAX_MARKS.scars, "scar cap");
  eq(new Set(set.scars.map((s) => s.seed)).size, set.scars.length, "every new mark has its own seed");
  for (let i = 0; i < 20; i++) { const a = addMark(set, "tattoo", "x"); if (a) set = a.set; }
  eq(set.tattoos.length, MAX_MARKS.tattoos, "tattoo cap");
  const r = rng(74);
  for (let k = 0; k < 3000; k++) {
    const ref = r() < 0.5 ? { type: "scar" as const, index: Math.floor(r() * set.scars.length) } : { type: "tattoo" as const, index: Math.floor(r() * set.tattoos.length) };
    const regions = regionsFor(ref.type);
    set = updateMark(set, ref, {
      size: (r() - 0.2) * 900, width: (r() - 0.2) * 90, age: (r() - 0.1) * 40000, angleDeg: r() < 0.2 ? "auto" : (r() - 0.5) * 720,
      anchor: [(r() - 0.5) * 5, (r() - 0.5) * 5], region: r() < 0.3 ? regions[Math.floor(r() * regions.length)] : r() < 0.1 ? "hair" : undefined,
      side: r() < 0.5 ? 0 : 1, mirror: r() < 0.5, ink: r() < 0.3 ? INK_NAMES[Math.floor(r() * INK_NAMES.length)] : r() < 0.05 ? "glitter" : undefined,
      ink2: r() < 0.2 ? null : undefined, kind: r() < 0.2 ? (ref.type === "scar" ? "burn" : "dotwork") : r() < 0.05 ? "laser" : undefined,
    });
    const m = getMark(set, ref)!;
    assert(m.anchor.every((v) => v >= -1 && v <= 1), `anchor ${m.anchor}`);
    assert(m.angle === null || (m.angle! > -Math.PI / 2 - 1e-9 && m.angle! <= Math.PI / 2 + 1e-9), `angle ${m.angle}`);
    assert((regionsFor(ref.type) as readonly string[]).includes(m.region), `region ${m.region}`);
    if (ref.type === "scar") {
      const s = set.scars[ref.index];
      assert(s.lengthMm >= MARK_RANGES.scarLengthMm[0] && s.lengthMm <= MARK_RANGES.scarLengthMm[1] && s.widthMm >= MARK_RANGES.scarWidthMm[0] && s.widthMm <= MARK_RANGES.scarWidthMm[1], "scar sizes");
      assert(s.ageDays >= 0 && s.ageDays <= MARK_RANGES.scarAgeDays[1] && Number.isInteger(s.ageDays), "scar age");
    } else {
      const t = set.tattoos[ref.index];
      assert(t.sizeMm >= MARK_RANGES.tattooSizeMm[0] && t.sizeMm <= MARK_RANGES.tattooSizeMm[1] && t.ageYears >= 0 && t.ageYears <= MARK_RANGES.tattooAgeYears[1], "tattoo ranges");
      assert(t.inks.length >= 1 && t.inks.length <= 2 && t.inks.every((i) => (INK_NAMES as readonly string[]).includes(i)), `inks ${t.inks}`);
    }
  }
  eq(parseMarkSet(JSON.parse(JSON.stringify(set))), set, "a sanitised set survives its own save unchanged");
  eq(sanitizeMarks(set), set as unknown, "the UI's set is a fixed point of M's sanitizeMarks (the game reads what the UI wrote)");
  const inside = (ui: readonly number[], m: readonly number[]) => ui[0] >= m[0] && ui[1] <= m[1];
  assert(inside(MARK_RANGES.scarLengthMm, M_RANGES.lengthMm) && inside(MARK_RANGES.scarWidthMm, M_RANGES.widthMm) && inside(MARK_RANGES.tattooSizeMm, M_RANGES.sizeMm) &&
    inside(MARK_RANGES.scarAgeDays, M_RANGES.ageDays) && inside(MARK_RANGES.tattooAgeYears, M_RANGES.ageYears), "every UI band sits inside M's legal range");
  eq([MAX_MARKS.scars, MAX_MARKS.tattoos], [MAX_SCARS, MAX_TATTOOS], "caps == M's");
  set = removeMark(set, { type: "scar", index: 0 });
  eq(set.scars.length, MAX_MARKS.scars - 1, "remove");
  for (const bad of [null, 3, "x", [], { scars: "no" }, { scars: [{ kind: "laser" }, { kind: "burn", region: "hair" }], tattoos: [{ style: "runic", region: "ear" }] }]) {
    const p = parseMarkSet(bad);
    assert(p === undefined || (p.scars.length === 0 && p.tattoos.length === 0), `hostile ${JSON.stringify(bad)} -> empty/absent`);
  }
});

Deno.test("SPEC TX75: the placement raycast's frame anchor on a REAL rig skin — every sampled skin vertex of a mark region maps to its own region, side by x, anchor in [-1,1]², and back onto the region cylinder near the point", () => {
  const { rig } = buildPreviewRig(hero);
  const skin = rig.skin as unknown as { geometry: { getAttribute(n: string): { array: Float32Array; count: number }; getIndex(): { array: Uint32Array }; userData: { region?: Uint8Array } } };
  const g = skin.geometry;
  const region = g.userData.region;
  assert(region && region.length === g.getAttribute("position").count, "R's rig.skin.geometry.userData.region is per vertex");
  const mesh: PickMesh = { positions: g.getAttribute("position").array, normals: g.getAttribute("normal").array, indices: g.getIndex().array, region };
  const frames = regionFrames(mesh as unknown as MeshData);
  let n = 0, far = 0, maxErrMm = 0;
  const errs: number[] = [];
  for (let i = 0; i < region.length; i += 7) {
    const r = REGIONS[region[i]];
    if (!(M_REGIONS as readonly string[]).includes(r)) continue;
    const p = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
    const a = pickAnchor(mesh, region[i], p);
    assert(a, `anchor for ${r} vertex ${i}`);
    eq(a.region, r, "same region");
    assert(a.anchor.every((v) => Number.isFinite(v) && v >= -1 && v <= 1), `anchor ${a.anchor}`);
    const f = frameOf(frames, a.region, (a.side ?? 0) as 0 | 1)!;
    const [x, y] = uvToMm(f, a.anchor[0], a.anchor[1]);
    const back = frameMmToPoint(f, x, y).p;
    // compare the ANGLE around the axis and the height along it (the radius differs: the frame is a cylinder)
    const rel = (q: number[]) => { const d = [q[0] - f.origin[0], q[1] - f.origin[1], q[2] - f.origin[2]]; const h = d[0] * f.axis[0] + d[1] * f.axis[1] + d[2] * f.axis[2]; return { h, ang: Math.atan2(d[0] * f.lateral[0] + d[1] * f.lateral[1] + d[2] * f.lateral[2], d[0] * f.front[0] + d[1] * f.front[1] + d[2] * f.front[2]) }; };
    const A = rel(p), B = rel(back);
    const angErr = Math.abs(Math.atan2(Math.sin(A.ang - B.ang), Math.cos(A.ang - B.ang)));
    const hErr = Math.abs(A.h - B.h) * 1000;
    if (Math.abs(a.anchor[1]) < 0.999) { errs.push(hErr); maxErrMm = Math.max(maxErrMm, hErr); if (angErr > 0.02) far++; }
    n++;
  }
  assert(n > 300, `sampled ${n} skin vertices`);
  assert(far === 0, `${far} vertices map back to a different angle around their region axis`);
  assert(maxErrMm < 0.5, `height along the axis round-trips (max ${maxErrMm.toFixed(3)} mm)`);
});

Deno.test("SPEC TX76: previewKey is byte-identical without marks/overrides and changes with them (the model rebuilds on a mark edit)", () => {
  const k0 = previewKey(hero);
  assert(!k0.includes("|tex:"), "pre-wave key has no tex suffix");
  eq(texKey(undefined, undefined), "", "no edits = empty suffix");
  eq(texKey(undefined, []), "", "an empty override list = empty suffix");
  const marked = { ...hero, appearance: { ...hero.appearance, marks: { scars: [], tattoos: [] } } } as CharacterProfile;
  assert(previewKey(marked) !== k0 && previewKey(marked).startsWith(k0), "an explicit (even empty) mark set is part of the key — empty means 'no marks', not 'generated'");
  const a = addMark({ scars: [], tattoos: [] }, "scar", "t")!;
  const k1 = previewKey({ ...hero, appearance: { ...hero.appearance, marks: a.set } } as CharacterProfile);
  const k2 = previewKey({ ...hero, appearance: { ...hero.appearance, marks: updateMark(a.set, a.ref, { anchor: [0.3, 0.1] }) } } as CharacterProfile);
  assert(k1 !== k2, "moving a mark changes the key");
  const k3 = previewKey({ ...hero, appearance: { ...hero.appearance, layerOverrides: [{ id: "skin.wash", enabled: false }] } } as CharacterProfile);
  assert(k3 !== k0, "a layer override changes the key");
});

Deno.test("SPEC TX77: the studio markup is CSP-clean (no style attribute, no script), ids unique, every control named, 44 px classes", () => {
  const profile = rollProfile(mulberry32(77)).profile;
  const a = addMark(addMark({ scars: [], tattoos: [] }, "scar", "a")!.set, "tattoo", "b")!;
  const withMarks = { ...profile, appearance: { ...profile.appearance, marks: a.set } } as CharacterProfile;
  const htmls = [texStudioHtml(profile), texStudioHtml(withMarks), marksPanelHtml(a.set, false, { type: "scar", index: 0 }, true), marksPanelHtml(a.set, false, a.ref, false),
    layersPanelHtml(layerRowsFor(profile), layerRowsFor(profile), [])];
  for (const h of htmls) {
    assert(!/\sstyle\s*=/.test(h), "no style attribute (CSP style-src 'self')");
    assert(!/<script|javascript:|\son[a-z]+\s*=/i.test(h), "no script / inline handlers");
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    eq(new Set(ids).size, ids.length, `unique ids (${ids.length})`);
    for (const m of h.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      const named = /aria-label="[^"]+"/.test(m[0]) || m[1].replace(/<[^>]+>/g, "").trim().length > 0;
      assert(named, `button has a name: ${m[0].slice(0, 80)}`);
    }
    for (const m of h.matchAll(/<(select|input)\b[^>]*>/g)) {
      const id = /id="([^"]+)"/.exec(m[0])?.[1];
      assert(id, `form control has an id: ${m[0]}`);
    }
  }
  const studio = texStudioHtml(withMarks);
  assert(/<label class="field tex-field"[^>]*>Length <input id="tex-size"/.test(marksPanelHtml(a.set, false, { type: "scar", index: 0 }, false)), "scar editor: length field labelled");
  assert(studio.includes('data-tex-add="scar"') && studio.includes('data-tex-add="tattoo"'), "add buttons");
  assert(/id="tex-age-stage"[^>]*>[^<]*(fresh|healing|maturing|mature)/.test(marksPanelHtml(a.set, false, { type: "scar", index: 0 }, false)), "a scar's age shows M's healing stage in words (QD Z-93)");
  assert(/role="group" aria-labelledby="tex-pos-head"/.test(marksPanelHtml(a.set, false, a.ref, false)), "Around/Along sit in a labelled Position group");
  assert(/tex-layer-grip[^>]*aria-label="Move /.test(studio), "every grip says how to move it by keyboard");
});

Deno.test("SPEC TX78: placement notes come from M's validator — overlap flagged, a tidy pair on bare skin is clean, a mark under the outfit says so (QD Z-37)", () => {
  const covered = coveredRegionsOf(hero);
  const bare = (M_REGIONS as readonly string[]).filter((r) => !covered.includes(r as never) && r !== "face" && (M_TATTOO_REGIONS as readonly string[]).includes(r)) as string[]; // the face centre is the nose/mouth zone
  assert(covered.length > 0 && bare.length >= 2, `the Warrior wears clothes (${covered.join(",")}) and shows skin (${bare.join(",")})`);
  const s0 = addMark({ scars: [], tattoos: [] }, "scar", "o")!;
  const s1 = addMark(s0.set, "scar", "p")!;
  const onBare = updateMark(updateMark(s1.set, { type: "scar", index: 0 }, { region: bare[0], anchor: [0, 0] }), { type: "scar", index: 1 }, { region: bare[0], anchor: [0, 0] });
  const issues = markIssues(hero, onBare);
  assert(/overlap/.test(issues["scar:1"] ?? ""), `second scar on the same spot overlaps: ${JSON.stringify(issues)}`);
  const apart = updateMark(onBare, { type: "scar", index: 1 }, { region: bare[1], anchor: [0, 0] });
  eq(markIssues(hero, apart), {}, `on two bare body parts (${bare[0]}, ${bare[1]}): no issue`);
  const under = updateMark(apart, { type: "scar", index: 1 }, { region: covered.find((r) => (M_REGIONS as readonly string[]).includes(r))!, anchor: [0, 0] });
  assert((markIssues(hero, under)["scar:1"] ?? "").includes(COVERED_TEXT), `a mark under the outfit is reported "${COVERED_TEXT}"`);
  eq(markIssues(hero, { scars: [], tattoos: [] }), {}, "no marks, no issues");
});

function memStore(): Store {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

Deno.test("SPEC TX79: save/load round trip — appearance.marks and appearance.layerOverrides survive the profile library (JSON) and re-parse unchanged", () => {
  const store = memStore();
  const repo = new ProfileRepo(store);
  repo.add(createProfile(1, "Seed", "Warrior"));
  let set: MarkSetRec = { scars: [], tattoos: [] };
  set = addMark(set, "scar", "a")!.set;
  set = addMark(set, "tattoo", "b")!.set;
  set = updateMark(set, { type: "tattoo", index: 0 }, { region: "upperArm", side: 1, anchor: [0.25, -0.4], ink: "woad", ink2: "red", mirror: true, angleDeg: 30 });
  const base = layerRowsFor(hero);
  const ov = reorderOverride(setOverride([], base, base[1].id, { opacity: 0.35 }), base, 0, 2);
  const c = { ...hero, appearance: { ...hero.appearance, marks: set, layerOverrides: ov } } as CharacterProfile;
  const saved = createFromCharacter(repo, c, c.name, "2026-11-04T00:00:00.000Z");
  // a fresh repo on the SAME storage = a reload
  const again = libraryEntries(new ProfileRepo(store)).find((e) => e.profile.playerId === saved.profile.playerId)!;
  const app = again.character.appearance as typeof c.appearance & { marks?: unknown; layerOverrides?: unknown };
  eq(parseMarkSet(app.marks), parseMarkSet(set), "marks round trip");
  eq(app.marks, set as unknown, "stored verbatim (JSON)");
  eq(parseLayerOverrides(app.layerOverrides), parseLayerOverrides(ov), "overrides round trip");
  eq(applyLayerOverrides(base, parseLayerOverrides(app.layerOverrides)).map((r) => [r.id, r.opacity]), applyLayerOverrides(base, ov).map((r) => [r.id, r.opacity]), "the reloaded stack reads the same");
  eq(previewKey(again.character), previewKey(c), "the reloaded hero builds the same model key");
});
