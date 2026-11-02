// src/ui/StatSheet.ts — Wave Z (lane S): the derived statistics sheet as an HTML string (C-SHEET).
//
// Input: DerivedSheet.derivedSheet(profile). Output: CSP-safe markup — NO inline `style` attribute
// (the page CSP is `style-src 'self'`), every text escaped, the tone of each (+/-) carried by the
// ValueTone data attributes so the caller colours it with `paintTones(el)` after insertion.
//
//   <div class="zs-sheet" [data-compact="1"]>
//     <section class="zs-group" data-group="attributes"><h4 class="zs-group-title">Attributes</h4>
//       <div class="zs-row" data-key="agility" data-group="mobility">
//         <span class="zs-label">Agility</span><span class="zs-value">14</span>
//         <span class="zs-delta" data-tone="2" data-tone-span="4" ...>(+2)</span></div> ...
//     </section>
//     <section class="zs-group" data-group="pools"> ... (pools, offence, defence, mobility, magic, body)
//   </div>
//
// Compact mode (phones): short labels (full label kept in `title`/`aria-label`) and `data-compact`
// on the root so the stylesheet (lane F) can pack two columns. Pure: no DOM, no THREE.

import type { DerivedSheet, Row, RowGroup } from "../game/DerivedSheet.ts";
import { toneAttrs } from "./ValueTone.ts";

export const SHEET_GROUPS: readonly RowGroup[] = ["pools", "offence", "defence", "mobility", "magic", "body"];
export const GROUP_TITLE: Readonly<Record<RowGroup | "attributes", string>> = {
  attributes: "Attributes", pools: "Pools", offence: "Offence", defence: "Defence", mobility: "Mobility", magic: "Magic", body: "Body",
};

/** Short labels for compact mode (phones). Missing keys keep the full label. */
export const SHORT_LABEL: Readonly<Record<string, string>> = {
  vitality: "VIT", resilience: "RES", focus: "FOC", reflex: "REF", strength: "STR", intelligence: "INT", agility: "AGI",
  maxHealth: "Health", maxMana: "Mana", maxStamina: "Stamina", manaRegen: "Mana/s", staminaRegen: "Stam/s",
  attackPower: "Power", attackInterval: "Interval", swingInterval: "Swing", attacksPerSecond: "Attacks",
  critChance: "Crit", dodge: "Graze", woundDealt: "Wounding", hitTaken: "Taken", critTaken: "Crit taken", woundTaken: "Wounds",
  staminaFatigue: "Stam. res.", effectiveAgility: "Eff. AGI", moveSpeed: "Speed", turnRate: "Turn",
  animSpeed: "Tempo", castTime: "Channel", powerTail: "Pwr rec.", manaFatigue: "Mana res.", cooldown: "Cooldown",
};

/** Escape text for HTML element content and double-quoted attributes. */
export function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** One row (the C-SHEET markup). */
export function rowHtml(r: Row, compact = false): string {
  const label = compact ? SHORT_LABEL[r.key] ?? r.label : r.label;
  const named = label !== r.label ? ` title="${esc(r.label)}" aria-label="${esc(r.label)}"` : "";
  const tone = toneAttrs(r.delta, { span: r.span ?? 5, ...(r.invert ? { invert: true } : {}) });
  return `<div class="zs-row" data-key="${esc(r.key)}" data-group="${esc(r.group)}">` +
    `<span class="zs-label"${named}>${esc(label)}</span>` +
    `<span class="zs-value">${esc(r.display)}</span>` +
    `<span class="zs-delta"${tone}>${esc(r.deltaDisplay)}</span>` +
    `</div>`;
}

function sectionHtml(group: RowGroup | "attributes", rows: readonly Row[], compact: boolean): string {
  if (!rows.length) return "";
  return `<section class="zs-group" data-group="${group}">` +
    `<h4 class="zs-group-title">${esc(GROUP_TITLE[group])}</h4>` +
    rows.map((r) => rowHtml(r, compact)).join("") +
    `</section>`;
}

/** C-SHEET: the whole sheet. The caller inserts it and runs ValueTone.paintTones(el). */
export function statSheetHtml(sheet: DerivedSheet, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact === true;
  return `<div class="zs-sheet"${compact ? ` data-compact="1"` : ""}>` +
    sectionHtml("attributes", sheet.attributes, compact) +
    SHEET_GROUPS.map((g) => sectionHtml(g, sheet.derived.filter((r) => r.group === g), compact)).join("") +
    `</div>`;
}
