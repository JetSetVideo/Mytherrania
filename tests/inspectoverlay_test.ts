// Tests for the spectator inspect overlay (Wave I, lane I-B): the anchor + pick geometry, the
// fighter/object card models, and the cursor blob easing. Pure logic, so no DOM and no canvas.
import {
  anchorCard,
  blobRadius,
  CURSOR_BLOB_LAG_MS,
  type CursorState,
  fighterCard,
  type FighterView,
  objectCard,
  type ObjectView,
  pickNearest,
  PRIMARY_ORDER,
  stepCursor,
} from "../src/ui/InspectOverlay.ts";
import { seededRng } from "../src/game/Items.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

/** A complete FighterView fixture with overridable fields and a below-average stat. */
function fighter(over: Partial<FighterView> = {}): FighterView {
  return {
    seat: 0, name: "Ash", ancestry: "Human", subrace: "Nomad", className: "Warrior", level: 3,
    controller: "AI", weapon: "Falchion",
    stats: { vitality: 8, resilience: 12, focus: 12, reflex: 12, strength: 12, intelligence: 12, agility: 12 },
    combat: { maxHealth: 120, attackPower: 24.5, attackInterval: 0.8, armor: 40 },
    hp: 90, mana: 30, manaMax: 60, stamina: 55, staminaMax: 70,
    dealt: 210, hits: 17, techniques: ["dash", "power"], generationId: null,
    telemetry: { travelledM: 132.4, avgDistanceM: 3.7, peak5sDamage: 88 },
    ...over,
  };
}

function object(over: Partial<ObjectView> = {}): ObjectView {
  return {
    id: "obj-1", kind: "crate", label: "Crate", detail: "", x: 4, z: -2,
    radiusM: 0.5, heightM: 0.8, scale: 1.1, boon: null,
    ...over,
  };
}

// ---- anchorCard ------------------------------------------------------------------------------

Deno.test("anchorCard: 2000 random triples never leave the viewport", () => {
  const rng = seededRng(0xC0FFEE);
  for (let i = 0; i < 2000; i++) {
    const vw = 320 + rng() * 1600;
    const vh = 240 + rng() * 1000;
    const cw = 80 + rng() * (vw - 80); // guaranteed <= vw, so a fit is always possible
    const ch = 60 + rng() * (vh - 60);
    const anchor = { x: rng() * vw, y: rng() * vh };
    const gap = rng() * 40;
    const r = anchorCard(anchor, { w: cw, h: ch }, { w: vw, h: vh }, gap);
    assert(r.left >= -1e-9, `left ${r.left}`);
    assert(r.top >= -1e-9, `top ${r.top}`);
    assert(r.left + cw <= vw + 1e-6, `right overflow: ${r.left + cw} > ${vw}`);
    assert(r.top + ch <= vh + 1e-6, `bottom overflow: ${r.top + ch} > ${vh}`);
    assert(r.side === "right" || r.side === "left", `side ${r.side}`);
  }
});

Deno.test("anchorCard: flips to the left when the right side would overflow", () => {
  const vp = { w: 1000, h: 800 };
  const right = anchorCard({ x: 20, y: 400 }, { w: 300, h: 200 }, vp);
  assert(right.side === "right", `near-left anchor should sit right, got ${right.side}`);
  const flipped = anchorCard({ x: 950, y: 400 }, { w: 300, h: 200 }, vp);
  assert(flipped.side === "left", `near-right anchor should flip, got ${flipped.side}`);
  assert(flipped.left >= 0 && flipped.left + 300 <= 1000, `flipped rect out of view: ${flipped.left}`);
});

Deno.test("anchorCard: vertically centred on the anchor when it fits, clamped when it does not", () => {
  const vp = { w: 1000, h: 800 };
  const centred = anchorCard({ x: 100, y: 400 }, { w: 300, h: 200 }, vp);
  assert(Math.abs(centred.top - 300) < 1e-9, `centred top ${centred.top}`);
  const topClamp = anchorCard({ x: 100, y: 0 }, { w: 300, h: 200 }, vp);
  assert(topClamp.top === 0, `top clamp ${topClamp.top}`);
  const bottomClamp = anchorCard({ x: 100, y: 800 }, { w: 300, h: 200 }, vp);
  assert(bottomClamp.top === 600, `bottom clamp ${bottomClamp.top}`);
});

// ---- pickNearest -----------------------------------------------------------------------------

Deno.test("pickNearest: null outside every radius, the nearest inside, nearest centre on overlap", () => {
  const cands = [{ id: "a", x: 0, y: 0, r: 100 }, { id: "b", x: 200, y: 0, r: 100 }];
  assert(pickNearest(cands, { x: 400, y: 400 }) === null, "outside every radius -> null");
  assert(pickNearest(cands, { x: 10, y: 0 }) === "a", "nearest radius wins");
  assert(pickNearest(cands, { x: 190, y: 0 }) === "b", "other radius wins near b");
  // Two overlapping: the NEARER CENTRE wins, even when the farther one has the bigger radius.
  const overlap = [{ id: "big", x: 0, y: 0, r: 1000 }, { id: "small", x: 50, y: 0, r: 60 }];
  assert(pickNearest(overlap, { x: 0, y: 0 }) === "big", "nearer centre beats bigger radius");
  // Boundary: a point exactly on a radius is inside (d <= r).
  assert(pickNearest([{ id: "edge", x: 30, y: 40, r: 50 }], { x: 0, y: 0 }) === "edge", "boundary included");
});

// ---- fighterCard -----------------------------------------------------------------------------

Deno.test("fighterCard: 7 primary rows (wave X: + agility) in a stable order and 3 bars", () => {
  const card = fighterCard(fighter());
  const primaryLabels = new Set(Object.values(PRIMARY_ORDER).map((k) => k[0].toUpperCase() + k.slice(1)));
  const found = card.rows.filter((r) => primaryLabels.has(r.label)).map((r) => r.label);
  assert(found.length === 7, `primary rows: ${found.length}`);
  const want = PRIMARY_ORDER.map((k) => k[0].toUpperCase() + k.slice(1));
  assert(found.join(",") === want.join(","), `stable order: ${found.join(",")}`);
  assert(card.bars.length === 3, `bars: ${card.bars.length}`);
  assert(card.bars.map((b) => b.label).join(",") === "HP,MP,SP", "hp/mana/stamina bars");
  assert(card.bars[0].max === 120 && card.bars[1].max === 60 && card.bars[2].max === 70, "bar maxima from the view");
});

Deno.test("fighterCard: tone bad only for a stat below the fighter's own average", () => {
  const card = fighterCard(fighter()); // vitality 8, the rest 12 -> average ~11.33
  const byLabel = new Map(card.rows.map((r) => [r.label, r]));
  assert(byLabel.get("Vitality")?.tone === "bad", "the below-average stat is bad-toned");
  assert(byLabel.get("Strength")?.tone === undefined, "an at-or-above-average stat is not bad-toned");
  assert(byLabel.get("Intelligence")?.tone === undefined, "an at-or-above-average stat is not bad-toned");
});

Deno.test("fighterCard: generation id when carried, else only the controller badge", () => {
  const withGen = fighterCard(fighter({ generationId: "gen-42", controller: "player" }));
  assert(withGen.badges.includes("gen-42"), `generation id missing: ${withGen.badges}`);
  assert(withGen.badges.includes("PLAYER"), `controller badge missing: ${withGen.badges}`);
  const without = fighterCard(fighter({ generationId: null, controller: "AI" }));
  assert(without.badges.length === 1 && without.badges[0] === "AI", `only controller badge: ${without.badges}`);
});

// ---- objectCard ------------------------------------------------------------------------------

Deno.test("objectCard: names the boon and states the real effect", () => {
  const card = objectCard(object({ boon: "rage", kind: "pickup", label: "Rage" }));
  assert(card.badges.includes("rage"), `boon named in badges: ${card.badges}`);
  const effect = card.rows.find((r) => r.label === "Effect");
  assert(effect !== undefined, "an effect row exists");
  assert(effect!.value.includes("Damage dealt"), `rage effect wrong: ${effect!.value}`);
  assert(effect!.value.includes("12 s"), `rage duration wrong: ${effect!.value}`);
  const size = card.rows.find((r) => r.label === "Size");
  assert(size?.value.includes("m"), `size in metres: ${size?.value}`);
});

Deno.test("objectCard: with no boon says what the object is for", () => {
  const crate = objectCard(object({ kind: "crate", boon: null }));
  const purpose = crate.rows.find((r) => r.label === "What it's for");
  assert(purpose !== undefined && purpose.value.toLowerCase().includes("cover"), `crate purpose: ${purpose?.value}`);
  const pad = objectCard(object({ kind: "gliderPad", label: "Glider Pad", boon: null }));
  const padPurpose = pad.rows.find((r) => r.label === "What it's for");
  assert(padPurpose !== undefined && padPurpose.value.toLowerCase().includes("glider"), `pad purpose: ${padPurpose?.value}`);
});

// ---- cursor ----------------------------------------------------------------------------------

Deno.test("stepCursor: converges within 1 px after 1 s of 60 Hz steps", () => {
  let s: CursorState = { x: 0, y: 0, blobX: 0, blobY: 0, down: false, hoverId: null };
  for (let i = 0; i < 60; i++) s = stepCursor(s, { x: 1000, y: 500 }, 1 / 60);
  assert(Math.abs(s.blobX - 1000) < 1, `blobX ${s.blobX}`);
  assert(Math.abs(s.blobY - 500) < 1, `blobY ${s.blobY}`);
  assert(s.x === 1000 && s.y === 500, "the reticle snaps to the target");
});

Deno.test("stepCursor: dt-independent (1 x 0.1 s agrees with 10 x 0.01 s within 1%)", () => {
  const start: CursorState = { x: 0, y: 0, blobX: 0, blobY: 0, down: false, hoverId: null };
  const one = stepCursor(start, { x: 1000, y: 0 }, 0.1);
  let ten = start;
  for (let i = 0; i < 10; i++) ten = stepCursor(ten, { x: 1000, y: 0 }, 0.01);
  const rel = Math.abs(one.blobX - ten.blobX) / 1000;
  assert(rel < 0.01, `relative difference ${rel}`);
});

Deno.test("stepCursor: finite for a huge dt, and the lag constant is set", () => {
  const start: CursorState = { x: 0, y: 0, blobX: 0, blobY: 0, down: false, hoverId: null };
  const s = stepCursor(start, { x: 100, y: 100 }, 1e9);
  assert(Number.isFinite(s.blobX) && Number.isFinite(s.blobY), "finite for huge dt");
  assert(Math.abs(s.blobX - 100) < 1e-6, "a huge dt lands the blob on the reticle");
  assert(Number.isFinite(CURSOR_BLOB_LAG_MS) && CURSOR_BLOB_LAG_MS > 0, "lag constant set");
});

Deno.test("blobRadius: bigger down and hovering than at rest, always finite", () => {
  const rest: CursorState = { x: 0, y: 0, blobX: 0, blobY: 0, down: false, hoverId: null };
  const down: CursorState = { ...rest, down: true };
  const hover: CursorState = { ...rest, hoverId: "seat-1" };
  const r = blobRadius(rest);
  assert(blobRadius(down) > r, "down is bigger at rest");
  assert(blobRadius(hover) > r, "hover is bigger at rest");
  assert(Number.isFinite(r) && r > 0, "rest radius is finite and positive");
  assert(Number.isFinite(blobRadius({ ...rest, x: 1e300, blobX: 1e300 })), "finite for extreme state");
});
