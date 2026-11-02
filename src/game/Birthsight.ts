import type { StatName } from "./Races.ts";

export interface Birthsign {
  id: string;
  name: string;
  symbol: string;    // emoji or single char
  mods: Partial<Record<StatName, number>>;
  lore: string;
}

export const BIRTHSIGNS: Birthsign[] = [
  {
    id: "serpent", name: "The Serpent", symbol: "🐍",
    // Wave X: the serpent is SUPPLE — one point of its reflex became agility (sum still 3).
    mods: { reflex: 1, focus: 1, agility: 1 },
    lore: "Born under the Shedding Moon — supple, quick to strike, slow to yield.",
  },
  {
    id: "mountain", name: "The Mountain", symbol: "⛰",
    mods: { resilience: 3 },
    lore: "Carved from the world's spine — endurance is your birthright.",
  },
  {
    id: "flame", name: "The Flame", symbol: "🔥",
    mods: { strength: 2, vitality: 1 },
    lore: "Kindled in the heart of a dying star — your blood runs hot.",
  },
  {
    id: "moon", name: "The Moon", symbol: "🌙",
    mods: { intelligence: 3 },
    lore: "Whispered secrets of the deep tide — your mind touches the arcane.",
  },
  {
    id: "storm", name: "The Storm", symbol: "⚡",
    mods: { reflex: 1, strength: 1, intelligence: 1 },
    lore: "Split the sky on the night you were born — you are chaos bound to form.",
  },
  {
    id: "void", name: "The Void", symbol: "🕳",
    mods: { focus: 3 },
    lore: "The space between stars claims you — your will outlasts the flesh.",
  },
];

export function birthsignById(id: string): Birthsign | undefined { return BIRTHSIGNS.find(b => b.id === id); }