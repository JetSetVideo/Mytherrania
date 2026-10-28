// The icon set is markup that ships under CSP `style-src 'self'`: every icon must be a
// well-formed <svg> on the 24-unit grid, painted by `currentColor`, with no style attribute.
import {
  BIRTHSIGN_ICON, birthsignIcon, icon, ICON_GRID, ICON_NAMES, ICON_STROKE_WIDTH, SKILL_KIND_ICON, skillKindIcon,
} from "../src/ui/Icons.ts";
import { BIRTHSIGNS } from "../src/game/Birthsight.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

/**
 * Minimal XML well-formedness check: every opening tag is closed in order, self-closing tags
 * are balanced by construction, and attribute values are double-quoted. Returns the tag names
 * seen (outermost first) or throws with the first defect.
 */
function parseTags(svg: string): string[] {
  const stack: string[] = [];
  const seen: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let consumed = 0;
  for (const m of svg.matchAll(tag)) {
    const between = svg.slice(consumed, m.index);
    if (between.trim() !== "") throw new Error(`text outside tags: "${between}"`);
    consumed = m.index! + m[0].length;
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (open !== name) throw new Error(`</${name}> closes <${open}>`);
    } else {
      seen.push(name);
      if (!selfClosing) stack.push(name);
    }
  }
  if (consumed !== svg.length) throw new Error(`unparsed tail: "${svg.slice(consumed, consumed + 40)}"`);
  if (stack.length) throw new Error(`unclosed: ${stack.join(",")}`);
  return seen;
}

Deno.test("icons: every icon is a well-formed <svg> on the 24-unit grid", () => {
  assert(ICON_NAMES.length >= 10, `expected >= 10 icons, got ${ICON_NAMES.length}`);
  for (const name of ICON_NAMES) {
    const svg = icon(name);
    const tags = parseTags(svg);
    assert(tags[0] === "svg", `${name}: root is <${tags[0]}>`);
    assert(tags.filter((t) => t === "svg").length === 1, `${name}: nested <svg>`);
    assert(tags.length >= 2, `${name}: no drawing elements`);
    assert(svg.startsWith("<svg ") && svg.endsWith("</svg>"), `${name}: not a single <svg> element`);
    assert(svg.includes(`viewBox="0 0 ${ICON_GRID} ${ICON_GRID}"`), `${name}: missing viewBox`);
    assert(svg.includes(`stroke="currentColor"`), `${name}: stroke is not currentColor`);
    assert(svg.includes(`fill="none"`), `${name}: not a line icon (fill)`);
    assert(svg.includes(`stroke-width="${ICON_STROKE_WIDTH}"`), `${name}: stroke width`);
    assert(svg.includes(`stroke-linecap="round"`), `${name}: caps not round`);
    assert(svg.includes(`aria-hidden="true"`), `${name}: decorative icon must be aria-hidden`);
    assert(svg.includes(`class="icon icon-${name}"`), `${name}: class`);
  }
});

Deno.test("icons: no style attribute and no hard-coded colour anywhere (CSP + white via CSS)", () => {
  for (const name of ICON_NAMES) {
    const svg = icon(name, "sign-icon");
    assert(!/style\s*=/.test(svg), `${name}: contains a style attribute`);
    assert(!/<style/i.test(svg), `${name}: contains a <style> element`);
    assert(!/#[0-9a-f]{3,8}\b/i.test(svg), `${name}: hard-coded hex colour`);
    assert(!/(fill|stroke)="(?!none|currentColor)[^"]*"/.test(svg), `${name}: paint other than none/currentColor`);
    assert(!/<script|on\w+=/i.test(svg), `${name}: script or event handler`);
  }
});

Deno.test("icons: every coordinate in every path stays inside the 24-unit grid", () => {
  for (const name of ICON_NAMES) {
    const svg = icon(name);
    // Absolute coordinates only appear after M/L (and implicit repeats); relative deltas may be
    // negative, so check the conservative bound: no number exceeds the grid side.
    for (const n of svg.replace(/^<svg[^>]*>/, "").matchAll(/-?\d*\.?\d+/g)) {
      const v = Math.abs(Number(n[0]));
      assert(v <= ICON_GRID, `${name}: number ${n[0]} outside the grid`);
    }
  }
});

Deno.test("icons: every birth sign in the game has an icon, and unknown ids draw nothing", () => {
  for (const sign of BIRTHSIGNS) {
    assert(BIRTHSIGN_ICON[sign.id], `birth sign ${sign.id} has no icon`);
    const svg = birthsignIcon(sign.id, "sign-icon");
    assert(svg.includes(`icon-${BIRTHSIGN_ICON[sign.id]} sign-icon`), `${sign.id}: extra class not applied`);
  }
  assert(birthsignIcon("nope") === "", "unknown sign should draw nothing");
  assert(birthsignIcon(null) === "", "null sign should draw nothing");
});

Deno.test("icons: the three skill kinds and the Back chevron exist; unknown kinds fall back", () => {
  for (const kind of ["dash", "power", "defense"]) {
    assert(SKILL_KIND_ICON[kind] === kind, `skill kind ${kind} has no icon`);
    assert(skillKindIcon(kind).includes(`icon-${kind}`), `skillKindIcon(${kind})`);
  }
  assert(skillKindIcon("mystery").includes("icon-power"), "unknown kind should fall back to power");
  assert(icon("chevron-left").includes("icon-chevron-left"), "chevron-left");
});
