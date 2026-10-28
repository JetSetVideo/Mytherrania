// Generated skill artwork. Each skill gets a deterministic procedural icon drawn
// from its element palette and its kind (dash = chevrons, power = burst,
// defence = shield), so the 24 skills are visually distinct without any image
// assets — the project ships no binary art.

import { ELEMENTS, type Skill } from "../game/Skills.ts";

/** Stable hash of a string, used to seed the per-skill randomness. */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The glyph shape, as a path on a 0..1 canvas, per skill kind. */
function drawGlyph(ctx: CanvasRenderingContext2D, skill: Skill, size: number, rand: () => number): void {
  const style = ELEMENTS[skill.element];
  const cx = size / 2, cy = size / 2;
  ctx.save();
  ctx.translate(cx, cy);

  if (skill.kind === "dash") {
    // Three chevrons pushing forward, offset by the lunge direction.
    const forward = skill.animation.lunge >= 0 ? 1 : -1;
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * size * 0.13 * forward;
      ctx.beginPath();
      ctx.moveTo(-size * 0.16 + off, -size * 0.16);
      ctx.lineTo(size * 0.10 + off, 0);
      ctx.lineTo(-size * 0.16 + off, size * 0.16);
      ctx.lineWidth = size * 0.055;
      ctx.strokeStyle = i === 1 ? style.core : style.edge;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  } else if (skill.kind === "power") {
    // A burst: spikes whose length follows the skill's damage multiplier.
    const spikes = 8;
    const len = size * (0.20 + 0.10 * Math.min(2.6, skill.payload.damageMul) / 2.6);
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + rand() * 0.08;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * size * 0.08, Math.sin(a) * size * 0.08);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.lineWidth = size * (i % 2 ? 0.05 : 0.028);
      ctx.strokeStyle = i % 2 ? style.core : style.edge;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.10, 0, Math.PI * 2);
    ctx.fillStyle = style.core;
    ctx.fill();
  } else {
    // A shield with a vertical seam, thicker when the armour boost is bigger.
    const w = size * 0.22, h = size * 0.28;
    const armour = Math.min(2.6, skill.payload.armorMul ?? 1.2) / 2.6;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(w, -h * 0.45);
    ctx.lineTo(w * 0.75, h * 0.65);
    ctx.lineTo(0, h);
    ctx.lineTo(-w * 0.75, h * 0.65);
    ctx.lineTo(-w, -h * 0.45);
    ctx.closePath();
    ctx.fillStyle = style.edge;
    ctx.fill();
    ctx.lineWidth = size * (0.02 + 0.05 * armour);
    ctx.strokeStyle = style.core;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.75);
    ctx.lineTo(0, h * 0.8);
    ctx.lineWidth = size * 0.022;
    ctx.strokeStyle = style.core;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Render one skill's icon to a PNG data URL. `size` is the canvas edge in pixels.
 * Uses a plain HTML canvas: OffscreenCanvas has no synchronous toDataURL, so it
 * cannot produce a data URL without going async. Returns "" if 2D is unavailable.
 */
export function renderSkillArt(skill: Skill, size = 96): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const style = ELEMENTS[skill.element];
  const rand = rng(hashSeed(skill.id));

  // Background: dark vignette with the element's tint bleeding in from one corner.
  const bg = ctx.createRadialGradient(size * 0.5, size * 0.45, size * 0.05, size * 0.5, size * 0.5, size * 0.75);
  bg.addColorStop(0, "#202d35");
  bg.addColorStop(1, "#10161b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  const tint = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.6);
  tint.addColorStop(0, `${style.edge}55`);
  tint.addColorStop(1, "#00000000");
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, size, size);

  // Embers: a few element-coloured specks, seeded per skill.
  for (let i = 0; i < 14; i++) {
    const x = rand() * size, y = rand() * size, r = size * (0.006 + rand() * 0.014);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rand() > 0.5 ? style.trail : style.edge;
    ctx.globalAlpha = 0.25 + rand() * 0.5;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawGlyph(ctx, skill, size, rand);

  // Frame.
  ctx.strokeStyle = style.edge;
  ctx.lineWidth = size * 0.02;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth);

  return canvas.toDataURL("image/png");
}
