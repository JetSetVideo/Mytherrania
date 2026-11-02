// Wave X: names that SOUND like their ancestry.
//
// Every sub-race owns a phonology: the onsets (word-initial consonant clusters), the vowel
// nuclei, the medial joins and the codas a name may end on, split by sex. A name is
// onset + nucleus (+ join + nucleus)* + coda, so an Imperial human reads Latin ("Cassian",
// "Valeria"), a Nomad steppe-Arabic ("Temuzar", "Sabira"), an Islander open-syllabled
// Polynesian ("Kaimalu"), a High Elf liquid ("Aelithar", "Sylwen"), a Wood Elf soft
// ("Fennalyr"), a Dark Elf sibilant ("Zhyriss"), dwarves stacked and hard ("Thrundur",
// "Khazgar", "Dhumgol"), orks guttural ("Grubnak", "Krudag", "Shrazka").
//
// A family/clan name follows the ancestry's own custom (an Imperial gens, a dwarf clan
// compound, an ork war-band, an elf house), drawn from the same stream.
//
// Pure module: no DOM, no THREE, no Math.random — `rng` is the only source of randomness.

import type { Sex } from "./BodyProfile.ts";

export interface Phonology {
  /** Word-initial consonant clusters (may be "" for a vowel-initial name). */
  onsets: readonly string[];
  /** Vowel nuclei. */
  vowels: readonly string[];
  /** Medial consonant joins between two nuclei. */
  joins: readonly string[];
  /** Name endings by sex. */
  codas: Readonly<Record<Sex, readonly string[]>>;
  /** Inclusive count of medial (join + vowel) groups. */
  medial: readonly [number, number];
  /** Chance of an apostrophe after the first syllable (dark elves, orks). */
  apostrophe?: number;
  /** Family-name parts: prefix + suffix ("Iron" + "fist"), or a full list via `families`. */
  familyA?: readonly string[];
  familyB?: readonly string[];
  /** How the family name is joined: "space" ("Thrain Ironfist"), "of" ("Kael of House Aerith"). */
  familyStyle?: "space" | "house" | "clan" | "gens";
}

/** Sub-race id -> phonology. Unknown sub-races fall back to the race's first entry. */
export const PHONOLOGY: Readonly<Record<string, Phonology>> = {
  // ── Humans ──────────────────────────────────────────────
  imperial: {
    onsets: ["Aur", "Cass", "Mar", "Val", "Luc", "Oct", "Sev", "Tib", "Fl", "Corn", "Dec", "Ser", "Quint", "Hadr"],
    vowels: ["i", "e", "a", "o"],
    joins: ["l", "r", "n", "t", "v", "ll", "nt"],
    codas: { male: ["us", "ius", "ian", "or", "ex", "anus"], female: ["a", "ia", "ella", "ina", "illa", "ora"] },
    medial: [0, 1],
    familyA: ["Aur", "Val", "Corv", "Sever", "Clar", "Mars", "Flav", "Ant"],
    familyB: ["elius", "erian", "inus", "onius", "ellan", "atus"],
    familyStyle: "gens",
  },
  nomad: {
    onsets: ["Kh", "Z", "T", "Sh", "B", "S", "K", "J", "Q", "R", "D", "Y"],
    vowels: ["a", "a", "u", "i", "ai", "e"],
    joins: ["r", "m", "z", "h", "s", "l", "q", "rk"],
    codas: { male: ["ir", "an", "ur", "im", "ad", "ek", "ar"], female: ["a", "ira", "ana", "eh", "isa", "ai"] },
    medial: [0, 2],
    familyA: ["ibn ", "al-", "al-"],
    familyB: ["Sahr", "Qadim", "Zaruk", "Tamir", "Rashid", "Hakim", "Barak", "Yusar"],
    familyStyle: "space",
  },
  islander: {
    onsets: ["K", "M", "N", "L", "H", "T", "P", "W", "", "Ke", "Ma"],
    vowels: ["a", "o", "i", "u", "ai", "oa", "e", "au"],
    joins: ["k", "l", "n", "m", "h", "p", "w", "t"],
    codas: { male: ["o", "a", "u", "ui", "aka"], female: ["a", "i", "ani", "ela", "oa"] },
    medial: [1, 2],
    familyA: ["Tide", "Salt", "Reef", "Storm", "Pearl", "Coral"],
    familyB: ["caller", "born", "singer", "keel", "walker", "ward"],
    familyStyle: "space",
  },
  // ── Elves ───────────────────────────────────────────────
  high: {
    onsets: ["Ae", "Th", "S", "L", "El", "Gal", "Ilm", "Er", "Fa", "Cel", "Ny"],
    vowels: ["a", "e", "i", "ae", "ie", "ë", "y"],
    joins: ["l", "r", "n", "th", "ld", "nd", "lv", "s"],
    codas: { male: ["ion", "ar", "anor", "dil", "thas", "or", "iel"], female: ["iel", "wen", "ëa", "ith", "ae", "ira", "ethil"] },
    medial: [1, 2],
    familyA: ["Aerith", "Sunstrider", "Starweave", "Elunar", "Dawnsong", "Silverbough"],
    familyStyle: "house",
  },
  wood: {
    onsets: ["F", "L", "W", "Y", "N", "Ar", "El", "Syl", "Br", "Tal"],
    vowels: ["a", "e", "i", "y", "ae", "ia"],
    joins: ["l", "n", "r", "w", "v", "nn", "lw"],
    codas: { male: ["wyn", "lin", "or", "as", "eth", "yr"], female: ["ra", "wyn", "eth", "lia", "a", "iel"] },
    medial: [1, 2],
    familyA: ["Leaf", "Moss", "Fern", "Ash", "Willow", "Thorn", "Briar"],
    familyB: ["whisper", "runner", "shade", "song", "step", "bough"],
    familyStyle: "space",
  },
  dark: {
    onsets: ["Z", "X", "V", "Q", "Ny", "Dr", "Sz", "Ilz", "Vh", "Ch"],
    vowels: ["y", "i", "a", "ae", "e", "ë"],
    joins: ["z", "zz", "r", "x", "v", "th", "ss", "lv"],
    codas: { male: ["ryn", "ith", "ax", "orn", "ez", "zar"], female: ["iss", "vra", "yth", "ira", "aeth", "ra"] },
    medial: [1, 2],
    apostrophe: 0.3,
    familyA: ["Vel'", "Xor'", "Zhaun'", "Q'", "Mal'", "Ny'"],
    familyB: ["Draeth", "Vyrr", "Ithzal", "Sorn", "Azvyr", "Ral"],
    familyStyle: "house",
  },
  // ── Dwarves ─────────────────────────────────────────────
  mountain: {
    onsets: ["Thr", "Br", "Dw", "Gr", "K", "B", "D", "Th", "St", "Gl"],
    vowels: ["u", "o", "a", "i", "ai"],
    joins: ["rn", "nd", "rg", "m", "rd", "l", "mb"],
    codas: { male: ["in", "ur", "grim", "dur", "rak", "or", "ain"], female: ["a", "is", "ra", "hild", "dis", "una"] },
    medial: [0, 1],
    familyA: ["Iron", "Stone", "Granite", "Oak", "Anvil", "Bronze", "Deep"],
    familyB: ["fist", "beard", "shield", "brow", "helm", "hewer"],
    familyStyle: "clan",
  },
  forge: {
    onsets: ["Kh", "D", "G", "Z", "Khaz", "Dor", "Bal", "Kr", "Tor"],
    vowels: ["a", "o", "u", "e"],
    joins: ["k", "d", "g", "z", "rk", "zg", "nd"],
    codas: { male: ["dok", "gar", "rin", "ak", "dun", "ek"], female: ["a", "ka", "rin", "ga", "dra", "isk"] },
    medial: [0, 1],
    familyA: ["Ember", "Rune", "Hammer", "Flame", "Slag", "Bellows"],
    familyB: ["forge", "wright", "fall", "heart", "smith", "brand"],
    familyStyle: "clan",
  },
  deep: {
    onsets: ["Dh", "M", "Gh", "N", "B", "Dr", "Ul", "Hr", "Th"],
    vowels: ["u", "o", "u", "a", "ou"],
    joins: ["m", "g", "l", "n", "mg", "ld", "nd"],
    codas: { male: ["gund", "mur", "ol", "un", "um", "rund"], female: ["a", "un", "ola", "ma", "rid", "ulla"] },
    medial: [0, 1],
    familyA: ["Dark", "Root", "Delve", "Hollow", "Cave", "Echo"],
    familyB: ["delver", "listener", "warden", "kin", "born", "deep"],
    familyStyle: "clan",
  },
  // ── Orks ────────────────────────────────────────────────
  greenhide: {
    onsets: ["Gr", "G", "Ug", "Z", "Br", "Sn", "Gh", "M", "Og"],
    vowels: ["u", "o", "a", "u"],
    joins: ["b", "g", "z", "r", "bb", "rg", "zg"],
    codas: { male: ["nak", "ub", "ag", "ug", "rok", "uz"], female: ["ga", "za", "uba", "ka", "agh", "ra"] },
    medial: [0, 1],
    apostrophe: 0.15,
    familyA: ["Bog", "Mud", "Gut", "Rot", "Marsh"],
    familyB: ["stompers", "biters", "rippers", "gnawers", "smashers"],
    familyStyle: "space",
  },
  ironhide: {
    onsets: ["Kr", "Dr", "Thr", "Gr", "Kh", "Vr", "Mug", "Gor"],
    vowels: ["u", "a", "o"],
    joins: ["g", "k", "d", "rk", "gg", "dh"],
    codas: { male: ["uk", "ag", "gor", "dush", "ruk", "akh"], female: ["ga", "ka", "dra", "ush", "akha", "gra"] },
    medial: [0, 1],
    apostrophe: 0.1,
    familyA: ["Slag", "Iron", "Scrap", "Rivet", "Chain"],
    familyB: ["jaws", "skulls", "hides", "breakers", "spikes"],
    familyStyle: "space",
  },
  bloodfang: {
    onsets: ["Sk", "Shr", "Zh", "Sn", "Vash", "Ras", "Skr", "Ash"],
    vowels: ["a", "i", "a", "u"],
    joins: ["z", "sh", "k", "zh", "sk", "r"],
    codas: { male: ["ka", "zhak", "ruk", "ash", "ik", "rak"], female: ["ka", "zha", "ska", "ira", "isha", "akka"] },
    medial: [0, 2],
    apostrophe: 0.25,
    familyA: ["Red", "Blood", "Fang", "Swift", "Steppe"],
    familyB: ["fangs", "howlers", "runners", "claws", "maws"],
    familyStyle: "space",
  },
};

/** Race id -> its sub-race ids in order (the first is the fallback). */
const RACE_SUBRACES: Readonly<Record<string, readonly string[]>> = {
  human: ["imperial", "nomad", "islander"],
  elf: ["high", "wood", "dark"],
  dwarf: ["mountain", "forge", "deep"],
  ork: ["greenhide", "ironhide", "bloodfang"],
};

/** The phonology a race + sub-race speaks; total (unknown -> Imperial human). */
export function phonologyFor(race: string | null | undefined, subrace: string | null | undefined): Phonology {
  if (subrace && PHONOLOGY[subrace]) return PHONOLOGY[subrace];
  const first = RACE_SUBRACES[race ?? ""]?.[0];
  return PHONOLOGY[first ?? "imperial"];
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
}

/** Collapse any letter tripled by a join ("Thrrr" -> "Thrr") and capitalise. */
function tidy(raw: string): string {
  let s = raw.replace(/(.)\1\1+/g, "$1$1").replace(/'+/g, "'").replace(/^'|'$/g, "");
  // One diaeresis per name reads Elvish; three read as noise ("Aeëndëlvior" -> "Aeëndelvior").
  let seen = false;
  s = s.replace(/ë/g, () => (seen ? "e" : (seen = true, "ë")));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A given name in the ancestry's phonology. Same rng stream -> same name. */
export function givenName(rng: () => number, race: string | null | undefined, subrace: string | null | undefined, sex: Sex = "male"): string {
  const p = phonologyFor(race, subrace);
  const [lo, hi] = p.medial;
  const n = lo + Math.floor(rng() * (hi - lo + 1));
  let s = pick(rng, p.onsets) + pick(rng, p.vowels);
  const apos = (p.apostrophe ?? 0) > 0 && rng() < (p.apostrophe ?? 0);
  if (apos) s += "'";
  for (let i = 0; i < n; i++) s += pick(rng, p.joins) + pick(rng, p.vowels);
  // A coda that starts with a vowel after a vowel-ending stem drops the stem's last vowel
  // ("Cassi" + "ius" -> "Cassius"), which keeps the Latin/Elvish endings clean.
  const coda = pick(rng, p.codas[sex] ?? p.codas.male);
  if (/[aeiouyë]$/i.test(s) && /^[aeiouyë]/i.test(coda)) s = s.slice(0, -1);
  return tidy(s + coda);
}

/** The family / clan / house name, by the ancestry's custom. */
export function familyName(rng: () => number, race: string | null | undefined, subrace: string | null | undefined): string {
  const p = phonologyFor(race, subrace);
  const a = p.familyA ?? [];
  if (a.length === 0) return "";
  const b = p.familyB ?? [];
  const head = pick(rng, a);
  switch (p.familyStyle) {
    case "house": return b.length ? `of House ${head}${pick(rng, b)}` : `of House ${head}`;
    case "clan": return `${head}${b.length ? pick(rng, b) : ""}`;
    case "gens": return `${head}${b.length ? pick(rng, b) : ""}`;
    default: {
      const tail = b.length ? pick(rng, b) : "";
      // "ibn Sahr", "al-Qadim", "of the Red Dune" keep their separator; compounds join.
      if (/[ -]$/.test(head)) return `${head}${tail}`;
      return /^[a-z]/.test(tail) ? `${head}${tail}` : `${head} ${tail}`;
    }
  }
}

/** A full display name: given name + family name in the ancestry's style. */
export function generateName(rng: () => number, race: string | null | undefined, subrace: string | null | undefined, sex: Sex = "male"): string {
  const given = givenName(rng, race, subrace, sex);
  const fam = familyName(rng, race, subrace);
  if (!fam) return given;
  // Orks only sometimes name a war-band ("Grubnak of the Bog stompers" is a mouthful).
  const p = phonologyFor(race, subrace);
  if (race === "ork" && rng() < 0.5) return given;
  return p.familyStyle === "space" && /^(Bog|Mud|Gut|Rot|Marsh|Slag|Iron|Scrap|Rivet|Chain|Red|Blood|Fang|Swift|Steppe)/.test(fam)
    ? `${given} of the ${fam}`
    : `${given} ${fam}`;
}
