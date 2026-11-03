// Wave THEME (lane T): the generated textures of the theme — CSS gradient stacks and tiny SVG tiles,
// CSP-safe. index.html's CSP is `style-src 'self'; img-src 'self' data:` — so:
//   * no `style="..."` markup: the stacks are written as CUSTOM PROPERTIES through CSSOM
//     (`el.style.setProperty`), which `style-src` does not block, and styles.css consumes them;
//   * `data:image/svg+xml` tiles are images (img-src allows `data:`), used only where a gradient cannot
//     draw the shape (clay crackle, wood ripples, stone veins, sigils, leaves, flames, scales...).
// Pure string building (no DOM) except `applyTheme`/`paintThemeHooks`, which only call setProperty.
// Every painted stroke is listed as a TINT (colour, alpha, role) so tests can composite it over the base and
// check the ink: role "field" = may sit under text (ink contrast >= 4.5), "mark" = small sparse marks
// (knots, rivets, emblems' cores; ink contrast >= 3, WCAG's large/graphic floor), "edge" = painted only in the
// padding outside the text box (the sub-race chip's palette strip), never under a glyph.
import { rng32 } from "../core/MathCore.ts";
import {
  rgba, themeFor, themeSummary, classTheme, signTheme, weaponTheme, subraceSwatch, raceTheme, relation, relationAccent,
  RELATION_STYLE, typicalWeapon, type Material, type PatternId, type Relation, type Swatch, type ThemeProfile,
} from "./Theme.ts";

export interface Tint { color: string; alpha: number; role: "field" | "mark" | "edge" }
export interface Layer { img: string; size?: string; pos?: string; repeat?: string; tints: Tint[] }
export interface Stack { image: string; size: string; position: string; repeat: string; tints: Tint[]; layers: number }

const svgUrl = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;
const f1 = (x: number) => +x.toFixed(1);

export function stack(layers: Layer[]): Stack {
  return {
    image: layers.map((l) => l.img).join(","),
    size: layers.map((l) => l.size ?? "auto").join(","),
    position: layers.map((l) => l.pos ?? "0 0").join(","),
    repeat: layers.map((l) => l.repeat ?? "repeat").join(","),
    tints: layers.flatMap((l) => l.tints),
    layers: layers.length,
  };
}

// ── Materials (the name plaque) ─────────────────────────────────────────────────────────────────
/** Clay: terracotta crazing (a seeded crack network), matte mottling, a fired gradient. */
function clay(s: Swatch): Layer[] {
  const rnd = rng32(0xc1a7);
  let cracks = "";
  // Crazing: polylines that wander and branch, like glaze cracks on fired earth.
  for (let i = 0; i < 9; i++) {
    let x = rnd() * 160, y = rnd() * 80, d = `M${f1(x)} ${f1(y)}`;
    const ang0 = rnd() * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const a = ang0 + (rnd() - 0.5) * 1.6, len = 8 + rnd() * 16;
      x += Math.cos(a) * len; y += Math.sin(a) * len; d += ` L${f1(x)} ${f1(y)}`;
    }
    cracks += `<path d='${d}' fill='none' stroke='${s.dark}' stroke-opacity='${(0.38 + rnd() * 0.2).toFixed(2)}' stroke-width='${(0.7 + rnd() * 0.6).toFixed(2)}' stroke-linejoin='bevel'/>`;
  }
  // Matte pits: a few darker grains.
  let pits = "";
  for (let i = 0; i < 26; i++) pits += `<circle cx='${f1(rnd() * 160)}' cy='${f1(rnd() * 80)}' r='${f1(0.5 + rnd() * 0.8)}' fill='${s.dark}' fill-opacity='0.35'/>`;
  return [
    { img: svgUrl(160, 80, cracks + pits), size: "160px 80px", tints: [{ color: s.dark, alpha: 0.58, role: "mark" }] },
    { img: `radial-gradient(ellipse 60% 90% at 18% 30%,${rgba(s.light, 0.32)},transparent 70%)`, tints: [{ color: s.light, alpha: 0.32, role: "field" }] },
    { img: `radial-gradient(ellipse 50% 80% at 82% 75%,${rgba(s.dark, 0.35)},transparent 70%)`, tints: [{ color: s.dark, alpha: 0.35, role: "field" }] },
    { img: `linear-gradient(180deg,${s.light} 0%,${s.base} 38%,${s.base} 70%,${s.dark} 100%)`, tints: [{ color: s.light, alpha: 1, role: "field" }, { color: s.dark, alpha: 1, role: "mark" }] },
  ];
}
/** Scroll: parchment fibres (two fine weaves + loose fibres), foxing, an edge tan; rolled ends are pseudo-elements. */
function scroll(s: Swatch): Layer[] {
  const rnd = rng32(0x5c20);
  let fibres = "";
  for (let i = 0; i < 34; i++) {
    const x = rnd() * 140, y = rnd() * 70, a = (rnd() - 0.5) * 0.5, l = 6 + rnd() * 14;
    fibres += `<path d='M${f1(x)} ${f1(y)} q${f1(l / 2)} ${f1((rnd() - 0.5) * 2)} ${f1(l * Math.cos(a))} ${f1(l * Math.sin(a))}' fill='none' stroke='${s.dark}' stroke-opacity='${(0.14 + rnd() * 0.12).toFixed(2)}' stroke-width='0.6'/>`;
  }
  return [
    { img: svgUrl(140, 70, fibres), size: "140px 70px", tints: [{ color: s.dark, alpha: 0.26, role: "field" }] },
    { img: `repeating-linear-gradient(1.5deg,${rgba(s.dark, 0.07)} 0 1px,transparent 1px 4px)`, tints: [{ color: s.dark, alpha: 0.07, role: "field" }] },
    { img: `repeating-linear-gradient(91deg,${rgba(s.dark, 0.05)} 0 1px,transparent 1px 9px)`, tints: [{ color: s.dark, alpha: 0.05, role: "field" }] },
    { img: `radial-gradient(circle at 9% 72%,${rgba(s.dark, 0.22)} 0,transparent 9%),radial-gradient(circle at 92% 22%,${rgba(s.dark, 0.18)} 0,transparent 7%)`, tints: [{ color: s.dark, alpha: 0.22, role: "mark" }] },
    { img: `radial-gradient(ellipse 75% 95% at 50% 50%,transparent 60%,${rgba(s.dark, 0.42)} 100%)`, tints: [{ color: s.dark, alpha: 0.42, role: "mark" }] },
    { img: `linear-gradient(180deg,${s.light},${s.base} 55%,${s.base})`, tints: [{ color: s.light, alpha: 1, role: "field" }] },
  ];
}
/**
 * Wood: figured grain — growth lines that wander (periodic so the tile seams) and BEND AROUND two knots (each
 * knot a dark heart with growth rings), soft earlywood/latewood bands (repeating-linear with soft stops),
 * a fine pore line pattern, a light plank gradient.
 */
function wood(s: Swatch): Layer[] {
  const rnd = rng32(0x700d), W = 320, H = 84;
  const knots = [{ x: 70, y: 52, r: 7 }, { x: 236, y: 24, r: 5 }];
  let lines = "";
  for (let i = 0; i < 24; i++) {
    const y0 = 1.5 + i * 3.6 + rnd() * 1.4, amp = 0.8 + rnd() * 1.8, ph = rnd() * Math.PI * 2;
    let d = "";
    for (let x = 0; x <= W; x += 8) {
      let y = y0 + amp * Math.sin((x / W) * Math.PI * 2 + ph) + 0.6 * Math.sin((x / W) * Math.PI * 6 + ph * 2);
      for (const k of knots) {
        const dy = y - k.y, g = Math.exp(-(((x - k.x) / (k.r * 3.2)) ** 2));
        y += Math.sign(dy || 1) * g * (k.r * 2.4) / (1 + Math.abs(dy) / (k.r * 1.6));
      }
      d += `${x === 0 ? "M" : " L"}${x} ${f1(y)}`;
    }
    const o = (0.12 + rnd() * 0.16).toFixed(2), w = (0.5 + rnd() * 1.1).toFixed(2);
    lines += `<path d='${d}' fill='none' stroke='${s.dark}' stroke-opacity='${o}' stroke-width='${w}'/>`;
  }
  let rings = "";
  for (const k of knots) {
    rings += `<ellipse cx='${k.x}' cy='${k.y}' rx='${k.r * 0.9}' ry='${k.r * 0.55}' fill='${s.dark}' fill-opacity='0.55'/>`;
    for (let j = 1; j <= 3; j++) rings += `<ellipse cx='${k.x}' cy='${k.y}' rx='${f1(k.r * (0.9 + j * 0.55))}' ry='${f1(k.r * (0.55 + j * 0.32))}' fill='none' stroke='${s.dark}' stroke-opacity='${(0.36 - j * 0.07).toFixed(2)}' stroke-width='0.8'/>`;
  }
  return [
    { img: svgUrl(W, H, lines + rings), size: `${W}px ${H}px`, pos: "-30px -6px", tints: [{ color: s.dark, alpha: 0.28, role: "field" }, { color: s.dark, alpha: 0.55, role: "mark" }] },
    { img: `repeating-linear-gradient(179.3deg,${rgba(s.dark, 0)} 0,${rgba(s.dark, 0.13)} 5px,${rgba(s.dark, 0)} 9px,${rgba(s.light, 0.22)} 13px,${rgba(s.dark, 0)} 17px)`, tints: [{ color: s.dark, alpha: 0.13, role: "field" }, { color: s.light, alpha: 0.22, role: "field" }] },
    { img: `repeating-linear-gradient(180.6deg,${rgba(s.dark, 0.08)} 0 1px,transparent 1px 3px)`, tints: [{ color: s.dark, alpha: 0.08, role: "field" }] },
    { img: `linear-gradient(180deg,${s.light} 0%,${s.base} 35%,${s.base} 75%,${s.dark} 130%)`, tints: [{ color: s.light, alpha: 1, role: "field" }] },
  ];
}
/** Stone: slate cleavage, three speckle grains, iron veins (jagged SVG in the accent), a cut bevel (box-shadow). */
function stone(s: Swatch): Layer[] {
  const rnd = rng32(0x5707);
  let veins = "";
  for (let i = 0; i < 3; i++) {
    let x = rnd() * 40, y = rnd() * 90, d = `M${f1(x)} ${f1(y)}`;
    for (let k = 0; k < 9; k++) { x += 10 + rnd() * 14; y += (rnd() - 0.55) * 14; d += ` L${f1(x)} ${f1(y)}`; }
    veins += `<path d='${d}' fill='none' stroke='${s.accent}' stroke-opacity='${(0.42 + rnd() * 0.18).toFixed(2)}' stroke-width='${(0.8 + rnd() * 0.9).toFixed(2)}'/>`;
    veins += `<path d='${d}' fill='none' stroke='${s.dark}' stroke-opacity='0.5' stroke-width='0.5' transform='translate(0.8 1)'/>`;
  }
  return [
    { img: svgUrl(180, 90, veins), size: "180px 90px", tints: [{ color: s.accent, alpha: 0.6, role: "mark" }] },
    { img: `radial-gradient(circle,${rgba(s.light, 0.55)} 0 0.6px,transparent 1.1px)`, size: "7px 6px", tints: [{ color: s.light, alpha: 0.55, role: "mark" }] },
    { img: `radial-gradient(circle,${rgba(s.dark, 0.6)} 0 0.8px,transparent 1.3px)`, size: "11px 13px", pos: "3px 5px", tints: [{ color: s.dark, alpha: 0.6, role: "mark" }] },
    { img: `radial-gradient(circle,${rgba(s.accent, 0.35)} 0 0.7px,transparent 1.2px)`, size: "17px 19px", pos: "8px 2px", tints: [{ color: s.accent, alpha: 0.35, role: "mark" }] },
    { img: `repeating-linear-gradient(172deg,${rgba(s.light, 0.07)} 0 1px,transparent 1px 9px)`, tints: [{ color: s.light, alpha: 0.07, role: "field" }] },
    { img: `linear-gradient(160deg,${s.light} 0%,${s.base} 42%,${s.dark} 100%)`, tints: [{ color: s.light, alpha: 1, role: "mark" }, { color: s.base, alpha: 1, role: "field" }] },
  ];
}
function neutral(s: Swatch): Layer[] {
  return [{ img: `linear-gradient(180deg,${s.light},${s.base} 40%,${s.dark})`, tints: [{ color: s.base, alpha: 1, role: "field" }] }];
}
export function materialStack(material: Material, s: Swatch): Stack {
  return stack(material === "clay" ? clay(s) : material === "scroll" ? scroll(s) : material === "wood" ? wood(s) : material === "stone" ? stone(s) : neutral(s));
}
/** The plaque's relief (box-shadow) per material: matte fired rim, paper tan, waxed wood edge, cut-stone bevel. */
export function materialShadow(material: Material, s: Swatch): string {
  switch (material) {
    case "clay": return `inset 0 1px 0 ${rgba(s.light, 0.45)},inset 0 -3px 5px ${rgba(s.dark, 0.6)},inset 0 0 0 1px ${rgba(s.dark, 0.8)},0 2px 4px rgba(0,0,0,.55)`;
    case "scroll": return `inset 0 0 6px ${rgba(s.dark, 0.35)},0 2px 5px rgba(0,0,0,.5)`;
    case "wood": return `inset 0 1px 0 ${rgba(s.light, 0.7)},inset 0 -2px 0 ${rgba(s.dark, 0.5)},inset 0 0 0 1px ${rgba(s.dark, 0.55)},0 2px 4px rgba(0,0,0,.55)`;
    case "stone": return `inset 2px 2px 0 ${rgba(s.light, 0.45)},inset -2px -2px 0 ${rgba(s.dark, 0.85)},inset 0 0 0 1px #000,0 3px 6px rgba(0,0,0,.6)`;
    default: return `inset 0 0 0 1px ${rgba(s.dark, 0.8)}`;
  }
}

// ── Patterns (class / sign / weapon chips) ──────────────────────────────────────────────────────
const PATTERN_ALPHA = 0.3;
function patternLayers(p: PatternId, s: Swatch): Layer[] {
  const a = PATTERN_ALPHA, ac = s.accent, li = s.light;
  const mark = (color: string, alpha = a): Tint => ({ color, alpha, role: "mark" });
  const tile = (w: number, h: number, body: string, tints: Tint[], extra: Partial<Layer> = {}): Layer => ({ img: svgUrl(w, h, body), size: `${w}px ${h}px`, tints, ...extra });
  const st = (c: string, o = a, w = 1) => `fill='none' stroke='${c}' stroke-opacity='${o}' stroke-width='${w}' stroke-linecap='round'`;
  switch (p) {
    case "fur": return [tile(22, 14, `<path d='M2 12 q3 -6 1 -10 M7 13 q2 -6 0 -9 M12 12 q4 -5 2 -10' ${st(li, 0.34)}/><path d='M15 3 l5 6 M17 2 l5 6' ${st(ac, 0.4, 0.9)}/>`, [mark(li, 0.34), mark(ac, 0.4)])];
    case "plates": return [
      { img: `radial-gradient(circle at 3px 3px,${rgba(li, 0.7)} 0 1.2px,${rgba(s.dark, 0.6)} 1.6px,transparent 2.2px)`, size: "18px 100%", tints: [mark(li, 0.7)] },
      { img: `linear-gradient(90deg,transparent 0 16px,${rgba(s.dark, 0.7)} 16px 17px,${rgba(li, 0.25)} 17px 18px)`, size: "18px 100%", tints: [mark(s.dark, 0.7)] },
      { img: `linear-gradient(180deg,${rgba(li, 0.22)},transparent 50%,${rgba(s.dark, 0.3)})`, tints: [{ color: li, alpha: 0.22, role: "field" }] },
    ];
    case "stitch": return [
      { img: `repeating-linear-gradient(90deg,${rgba(ac, 0.58)} 0 4px,transparent 4px 7px)`, size: "100% 1px", pos: "0 3px", repeat: "no-repeat", tints: [mark(ac, 0.58)] },
      { img: `repeating-linear-gradient(90deg,${rgba(ac, 0.58)} 0 4px,transparent 4px 7px)`, size: "100% 1px", pos: "0 calc(100% - 3px)", repeat: "no-repeat", tints: [] },
      { img: `repeating-linear-gradient(35deg,${rgba(li, 0.06)} 0 1px,transparent 1px 3px)`, tints: [{ color: li, alpha: 0.06, role: "field" }] },
    ];
    case "crossstitch": return [tile(10, 10, `<path d='M2 2 l4 4 M6 2 l-4 4' ${st(ac, 0.42)}/>`, [mark(ac, 0.42)])];
    case "sigils": return [tile(28, 20, `<circle cx='7' cy='8' r='4.5' ${st(ac, 0.42, 0.8)}/><path d='M7 3.5 l3.9 6.8 h-7.8 z' ${st(ac, 0.42, 0.8)}/><path d='M18 4 v8 M15 6 h6 M16 14 l4 3 M21 14 l-4 3' ${st(li, 0.32, 0.8)}/>`, [mark(ac, 0.42), mark(li, 0.32)])];
    case "bones": return [tile(30, 16, `<path d='M4 8 h12' ${st(s.ink, 0.22, 1.6)}/><circle cx='4' cy='6.6' r='1.5' fill='${s.ink}' fill-opacity='0.22'/><circle cx='4' cy='9.4' r='1.5' fill='${s.ink}' fill-opacity='0.22'/><circle cx='16' cy='6.6' r='1.5' fill='${s.ink}' fill-opacity='0.22'/><circle cx='16' cy='9.4' r='1.5' fill='${s.ink}' fill-opacity='0.22'/><path d='M22 4 v8 l4 -4 M24 3 l3 3' ${st(ac, 0.4, 0.8)}/>`, [mark(s.ink, 0.22), mark(ac, 0.4)])];
    case "fletching": return [tile(20, 14, `<path d='M2 12 q6 -10 14 -10 q-4 8 -14 10 z' fill='${ac}' fill-opacity='0.26'/><path d='M2 12 L16 2' ${st(li, 0.38, 0.6)}/><path d='M8 9 l-2 -3 M11 7 l-2 -3' ${st(li, 0.3, 0.6)}/>`, [mark(ac, 0.26), mark(li, 0.38)])];
    case "halo": return [
      { img: `radial-gradient(circle at 1.1em 50%,transparent 0 .62em,${rgba(ac, 0.55)} .66em .74em,transparent .78em 1em,${rgba(ac, 0.3)} 1.02em 1.08em,transparent 1.12em)`, repeat: "no-repeat", size: "100% 100%", tints: [mark(ac, 0.55)] },
      { img: `radial-gradient(circle,${rgba(ac, 0.45)} 0 .7px,transparent 1.2px)`, size: "9px 7px", tints: [mark(ac, 0.45)] },
      { img: `linear-gradient(180deg,${rgba("#ffffff", 0.35)},transparent 60%)`, tints: [{ color: "#ffffff", alpha: 0.35, role: "field" }] },
    ];
    case "scales": return [tile(12, 8, `<path d='M0 8 a6 6 0 0 1 12 0 M-6 4 a6 6 0 0 1 12 0 M6 4 a6 6 0 0 1 12 0' ${st(ac, 0.4, 0.8)}/>`, [mark(ac, 0.4)])];
    case "peaks": return [tile(16, 10, `<path d='M0 9 l4 -6 l4 6 l4 -6 l4 6' ${st(ac, 0.42, 0.9)}/><path d='M3 4.5 l1 -1.5 l1 1.5' ${st(li, 0.4, 0.7)}/>`, [mark(ac, 0.42), mark(li, 0.4)])];
    case "flames": return [tile(14, 18, `<path d='M7 18 c-5 -3 -4 -8 0 -13 c1 4 4 5 3 9 c2 -1 2 -3 2 -4 c2 4 0 7 -5 8 z' fill='${ac}' fill-opacity='0.3'/>`, [mark(ac, 0.3)], { pos: "0 100%", repeat: "repeat-x" })];
    case "crescents": return [tile(26, 18, `<path d='M8 4 a5 5 0 1 0 4 9 a4 4 0 1 1 -4 -9 z' fill='${ac}' fill-opacity='0.34'/><circle cx='20' cy='5' r='0.9' fill='${ac}' fill-opacity='0.45'/><circle cx='23' cy='13' r='0.6' fill='${li}' fill-opacity='0.6'/>`, [mark(ac, 0.45), mark(li, 0.6)])];
    case "bolts": return [tile(18, 16, `<path d='M10 1 l-5 7 h4 l-3 7 l7 -9 h-4 l3 -5 z' fill='${ac}' fill-opacity='0.32'/>`, [mark(ac, 0.32)])];
    case "rings": return [{ img: `repeating-radial-gradient(circle at 1.1em 50%,${rgba(ac, 0.34)} 0 1px,transparent 1px 6px)`, tints: [mark(ac, 0.34)] }];
    case "fuller": return [
      { img: `linear-gradient(180deg,transparent 0 44%,${rgba(s.dark, 0.6)} 44% 47%,${rgba(li, 0.38)} 47% 53%,${rgba(s.dark, 0.5)} 53% 56%,transparent 56%)`, tints: [mark(s.dark, 0.6), mark(li, 0.38)] },
      tile(24, 10, `<path d='M0 5 q3 -4 6 0 t6 0 t6 0 t6 0' ${st(li, 0.18, 0.8)}/>`, [{ color: li, alpha: 0.18, role: "field" }]),
    ];
    case "shaft": return [{ img: `repeating-linear-gradient(90deg,transparent 0 14px,${rgba(ac, 0.42)} 14px 16px,${rgba(s.dark, 0.5)} 16px 17px)`, tints: [mark(ac, 0.42), mark(s.dark, 0.5)] }];
    case "hammered": return [
      { img: `radial-gradient(circle at 40% 35%,${rgba(li, 0.3)} 0 1.4px,transparent 2.6px)`, size: "8px 7px", tints: [mark(li, 0.3)] },
      { img: `radial-gradient(circle at 60% 65%,${rgba(s.dark, 0.45)} 0 1.4px,transparent 2.8px)`, size: "8px 7px", pos: "4px 3px", tints: [mark(s.dark, 0.45)] },
    ];
    case "chain": return [tile(16, 10, `<rect x='1' y='2.5' width='9' height='5' rx='2.5' ${st(li, 0.36, 0.9)}/><path d='M9 5 h6' ${st(ac, 0.36, 1.2)}/>`, [mark(li, 0.36), mark(ac, 0.36)])];
    case "grain": return [
      { img: `repeating-linear-gradient(178deg,${rgba(li, 0.18)} 0 1px,transparent 1px 5px)`, tints: [{ color: li, alpha: 0.18, role: "field" }] },
      { img: `repeating-linear-gradient(181deg,${rgba(s.dark, 0.3)} 0 1px,transparent 1px 9px)`, tints: [{ color: s.dark, alpha: 0.3, role: "field" }] },
    ];
    case "string": return [tile(24, 20, `<path d='M2 1 q10 9 0 18' ${st(ac, 0.4, 0.9)}/><path d='M2 1 v18' ${st(li, 0.3, 0.5)}/>`, [mark(ac, 0.4), mark(li, 0.3)])];
    default: return [];
  }
}
export function chipStack(p: PatternId, s: Swatch): Stack {
  return stack([...patternLayers(p, s), { img: `linear-gradient(180deg,${s.light} -40%,${s.base} 45%,${s.dark} 140%)`, tints: [{ color: s.base, alpha: 1, role: "field" }] }]);
}
/** The sub-race chip: its swatch flat, a band of its accent and light (the palette as a sample strip). */
export function swatchChipStack(s: Swatch, material: Material): Stack {
  return stack([
    { img: `linear-gradient(90deg,${s.accent} 0 5px,${s.light} 5px 8px,transparent 8px)`, repeat: "no-repeat", size: "100% 100%", tints: [{ color: s.accent, alpha: 1, role: "edge" }] },
    ...materialStackLayers(material, s).slice(-2),
  ]);
}
function materialStackLayers(material: Material, s: Swatch): Layer[] {
  return material === "clay" ? clay(s) : material === "scroll" ? scroll(s) : material === "wood" ? wood(s) : material === "stone" ? stone(s) : neutral(s);
}

// ── Tokens -> CSSOM ─────────────────────────────────────────────────────────────────────────────
function stackTokens(prefix: string, st: Stack, out: Record<string, string>): void {
  out[`--th-${prefix}-img`] = st.image;
  out[`--th-${prefix}-size`] = st.size;
  out[`--th-${prefix}-pos`] = st.position;
  out[`--th-${prefix}-repeat`] = st.repeat;
}
/** Every `--th-*` token of a profile: Theme.themeFor's colours + the background stacks of plaque and chips. */
export function themeTokens(p: ThemeProfile): Record<string, string> {
  const out: Record<string, string> = { ...themeFor(p) };
  const t = themeSummary(p), mat = raceTheme(p.race).material;
  stackTokens("plaque", materialStack(mat, t.plaque), out);
  out["--th-plaque-shadow"] = materialShadow(mat, t.plaque);
  stackTokens("chip-race", materialStack(mat, t.plaque), out);
  stackTokens("chip-subrace", swatchChipStack(t.plaque, mat), out);
  stackTokens("chip-class", chipStack(t.cls.pattern, t.cls.swatch), out);
  stackTokens("chip-sign", chipStack(t.sign.pattern, t.sign.swatch), out);
  stackTokens("chip-weapon", chipStack(t.weapon.pattern, t.weapon.swatch), out);
  return out;
}
/** Write tokens on an element through CSSOM (CSP-safe) and mark it with the material for CSS hooks. */
export function applyTheme(el: HTMLElement, p: ThemeProfile): void {
  const tokens = themeTokens(p);
  for (const [k, v] of Object.entries(tokens)) el.style.setProperty(k, v);
  el.dataset.thMaterial = raceTheme(p.race).material;
  const s = themeSummary(p);
  el.dataset.thRelClass = s.relations["race-class"];
  el.dataset.thRelSign = s.relations["class-sign"];
  el.dataset.thRelWeapon = s.relations["class-weapon"];
}

/** The words a relation chip's tooltip uses ("Bow with Archer: typical pair (shared accent)"). */
export function relationTitle(rel: Relation, a: string, b: string): string {
  return `${a} with ${b}: ${RELATION_STYLE[rel].word}`;
}

/**
 * The Creator's pick lists (+ New page): class rows carry their class swatch, weapon/sign rows their own swatch
 * AND their relation to the current class (`data-relation` + an accent the CSS shows as a ring), sub-race chips
 * their sub-race swatch on the race material, race toggles their material. CSSOM only.
 */
export function paintThemeHooks(root: ParentNode, current: { race: string; className: string }): void {
  const set = (el: HTMLElement, sw: Swatch, img?: Stack) => {
    el.style.setProperty("--th-row-base", sw.base); el.style.setProperty("--th-row-ink", sw.ink);
    el.style.setProperty("--th-row-accent", sw.accent); el.style.setProperty("--th-row-light", sw.light);
    if (img) { el.style.setProperty("--th-row-img", img.image); el.style.setProperty("--th-row-size", img.size); el.style.setProperty("--th-row-pos", img.position); el.style.setProperty("--th-row-repeat", img.repeat); }
  };
  const anchor = classTheme(current.className).swatch.accent;
  root.querySelectorAll<HTMLElement>("#class-table .pick-row[data-class]").forEach((r) => {
    const t = classTheme(r.dataset.class); set(r, t.swatch, chipStack(t.pattern, t.swatch));
    const rel = relation("race-class", current.race, r.dataset.class); r.dataset.relation = rel;
    r.style.setProperty("--th-row-rel", relationAccent(rel, subraceSwatch(current.race, null).accent));
  });
  root.querySelectorAll<HTMLElement>("#weapon-table .pick-row[data-weapon]").forEach((r) => {
    const id = r.dataset.weapon || typicalWeapon(current.className);
    const t = weaponTheme(id); set(r, t.swatch, chipStack(t.pattern, t.swatch));
    const rel = relation("class-weapon", current.className, id); r.dataset.relation = rel;
    r.style.setProperty("--th-row-rel", relationAccent(rel, anchor));
  });
  root.querySelectorAll<HTMLElement>("#birthsign-table .pick-row[data-birthsign]").forEach((r) => {
    const t = signTheme(r.dataset.birthsign); set(r, t.swatch, chipStack(t.pattern, t.swatch));
    const rel = relation("class-sign", current.className, r.dataset.birthsign); r.dataset.relation = rel;
    r.style.setProperty("--th-row-rel", relationAccent(rel, anchor));
  });
  root.querySelectorAll<HTMLElement>(".subrace-chip[data-race][data-subrace]").forEach((c) => {
    const sw = subraceSwatch(c.dataset.race, c.dataset.subrace);
    set(c, sw, materialStack(raceTheme(c.dataset.race).material, sw));
    c.dataset.thMaterial = raceTheme(c.dataset.race).material;
  });
}
