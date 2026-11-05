// QD: what scar colour TexWiring draws when skinSrgb = appearance.body (the PALETTE / garment colour) vs the real skin.
import * as S from "../../../src/graphics/paint/marks/Scar.ts";
import { PALETTES } from "../../../src/game/Characters.ts";
const hex = (h: string) => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
const toHex = (c: number[]) => "#" + c.map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
const lab = (c: number[]) => { const l = c.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); const X = (0.4124*l[0]+0.3576*l[1]+0.1805*l[2])/0.95047, Y = 0.2126*l[0]+0.7152*l[1]+0.0722*l[2], Z = (0.0193*l[0]+0.1192*l[1]+0.9505*l[2])/1.08883; const f = (t: number) => t > 216/24389 ? Math.cbrt(t) : (24389/27*t+16)/116; return [116*f(Y)-16, 500*(f(X)-f(Y)), 200*(f(Y)-f(Z))]; };
const skins: Record<string, string> = { human: "#c88858", elf: "#e8c8a0", ork: "#78a858" };
const look = S.scarLook("laceration", 1500);
const rows = [];
for (const [race, sk] of Object.entries(skins)) for (const [pal, p] of Object.entries(PALETTES)) {
  const skin = hex(sk), right = S.scarColour(skin, look, 1), wrong = S.scarColour(hex(p.body), look, 1);
  const Ls = lab(skin), Lr = lab(right), Lw = lab(wrong);
  rows.push({ race, skin: sk, palette: pal, body: p.body, scarOnRealSkin: toHex(right), drawnFromBody: toHex(wrong), dL_right: +(Lr[0]-Ls[0]).toFixed(1), dL_drawn: +(Lw[0]-Ls[0]).toFixed(1), dE_drawn_vs_right: +Math.hypot(Lr[0]-Lw[0], Lr[1]-Lw[1], Lr[2]-Lw[2]).toFixed(1) });
}
console.table(rows);
await Deno.writeTextFile(new URL("./diag-skinsrc.json", import.meta.url), JSON.stringify(rows, null, 1));
