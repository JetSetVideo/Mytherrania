# Security review (R11): Mytherrania as shipped

Scope: git HEAD `a976258`, working tree as of 2026-10-28 (CET). Reviewer: R11 security agent.
Read-only review. No source file was edited, no server was started, no build was run.

**Method.** I read the files cited below, ran `grep` on `src/**` and on `dist/app.js`, ran `deno info`,
`deno task audit` and `git grep` across all 17 commits, and checked the npm registry for the latest
`three` version. I also ran two throw-away Deno probes against the pure modules
(`MatchHistory.ts`, `Profiles.ts`) and a regex probe against `dist/app.js`. Their outputs are quoted
in [Commands run](#commands-run-real-output). Unless a finding says "probe" or "grep", the evidence
comes from reading the code. **Nothing was exploited in a live browser.** Every exploit sketch below
comes from reading the code.

Severity scale: **High** means remote compromise without user action. **Medium** means stored or
self-injected content reaches an HTML sink, or a policy gap enables one. **Low** means hardening,
robustness or hygiene with a plausible abuse path. **Info** means checked and acceptable, or a note.

| # | Sev | Finding |
|---|-----|---------|
| S1 | **Medium** | Character sheet and match history put typed and stored text into `innerHTML` without escaping |
| S2 | **Medium** | The CSP exists only as a `serve.ts` response header. `index.html` has no `<meta>` CSP, and the policy has no `form-action` |
| S3 | Low | Saves (`localStorage`) are loaded without schema validation. Malformed records crash History, Sheet and match end. Names have no length cap |
| S4 | Low | Undeclared network egress: every "Enter the ring" sends a `sendBeacon` POST of profile telemetry |
| S5 | Low | The build's "static from-URL check" covers one import form only |
| S6 | Low | The committed `dist/` is the pre-overhaul bundle (`c5b55af`) and contains a CSP-violating inline `style=""` |
| S7 | Low | The debug hook `globalThis.__MYTHERRANIA__` (whole `Engine`) ships in production |
| S8 | Low | `serve.ts`: no Host check (DNS rebinding can read the full-source map), a few missing headers, error responses have none |
| S9 | Info | Dependencies are pinned and locked, with no remote imports. `three` is 6 minors behind. The lock has stale playwright entries in a CVE range (not referenced) and is not frozen |
| S10 | Info | No secrets in any commit. Minor local-path leaks (username, macOS cache layout) |
| S11 | Info | Keyboard-layout detection, gamepad and pointer lock: no data leaves the page |
| S12 | Info | New lanes (body, paint, fx, world, minimap): no unbounded allocation from user-controlled values |
| S13 | Info | Latent: unescaped `value="${this.#player.name}"` at render time, and `esc()` does not escape `'` |

---

## S1 — Medium — Unescaped interpolation into `innerHTML` (sheet + history)

**Evidence.**

- `src/ui/Menu.ts:313` stores the creator's free-text name with no length cap or filtering:
  `nameInput.addEventListener("input", () => { this.#player.name = nameInput.value || "Fighter"; });`.
  `src/engine/Engine.ts:815` turns it into the fighter's name (`createFighter(player.className, player.name, …)`).
  `Engine.ts:365-374` passes `name: p.name` and `duels:` (built from the stored history) into `SheetData`.
- `src/ui/Menu.ts:580-595` (Character sheet) interpolates with **no `esc()`**:
  - `:586` `alt="${s.name}"`, an attribute breakout;
  - `:587` `<h3>${s.name}</h3>`;
  - `:588-591` `s.race`, `s.subrace`, `s.birthsign`, `s.className`, `s.hp`, `s.weapon`;
  - `:580` stat keys and values;
  - `:582` for every duel: `d.date`, `d.opponent`, `d.result`, `d.duration`, `d.dealt`, `d.received`,
    `d.weapon` and `d.arena`. These come from `localStorage` history via `Engine.ts:2645-2652`
    (`opponent: \`${foe.name} (${foe.className})\``, `weapon: self.weapon`, `arena: \`${r.place} · ${r.phase}\``).
- `src/ui/Menu.ts:637-642` (history table) escapes the strings but interpolates the stored "numbers"
  raw: `#${r.id}`, `${r.duration}s`, `${a.dealt}/${b.dealt}`, `${a.hits}/${b.hits}`, and every
  `a.stats.*` and `b.stats.*`. They are typed `number`, but `JSON.parse` does not enforce types
  (`MatchHistory.ts:42-43` only checks `fighters.length === 2`).
- The profile name is also a stored path. A tampered `mytherrania-profiles-v1` entry with a crafted
  `name` gets escaped by the title-screen chips (`Menu.ts:139`). But clicking it runs
  `#applyProfile` (`Engine.ts:2675-2681`), which copies `p.name` into `#playerProfile`. Rematch or R
  then builds the fighter with that name (`Engine.ts:358`, `:815`), and Sheet renders it raw.

**Exploit sketch.**

1. *Self-injection, typed.* Name =
   `"><a href="https://example.invalid">Session expired — sign in</a><img src=x onerror=alert(document.domain)>`
   → Enter the ring → finish → Sheet.
   - Under `serve.ts`, the header CSP's `script-src 'self'` (no `'unsafe-inline'`) blocks the `onerror`
     handler, but the link and any `<form>` markup render.
   - On any host that does not send that header (S2), the handler **runs**.
2. *Stored.* Some code running on origin `http://127.0.0.1:8788` writes a history record such as
   `{"id":"<a href=//example.invalid>x</a>","fighters":[…2 valid fighters…]}`. Note that
   `localStorage` is per **origin**, so any other project later served on port 8788 qualifies, as do a
   browser extension or devtools. The record renders on every visit to History (`Menu.ts:637`), and
   in the Sheet when a stored fighter name matches the current fighter.
3. With S2's missing `form-action`, injected `<form action="https://…">` posts cross-origin even under
   the header CSP.

**Fix.** Escape every interpolation and coerce stored numbers. Paste into `src/ui/Menu.ts`.

```ts
// Menu.ts:61 — replace esc, add num (numbers from storage are untrusted too)
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** A finite number as text, else an em dash. Use for every numeric field read from a save. */
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? String(n) : "—"; };
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
```

```ts
// Menu.ts:580-595 — sheet
const statKV = Object.entries(s.stats).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${num(v)}</td></tr>`).join("");
const duelsKV = (s.duels ?? []).slice(-5).reverse().map(d =>
  `<tr><td>${esc(String(d.date ?? "").slice(0, 10))}</td><td>${esc(d.opponent)}</td><td>${esc(d.result)}</td><td>${num(d.duration)}s</td><td>${num(d.dealt)}/${num(d.received)}</td><td>${esc(d.weapon ?? "-")}</td><td>${esc(d.arena ?? "-")}</td></tr>`
).join("");
this.#root.querySelector("#sheet-body")!.innerHTML = `
  <div class="sheet-grid">
    <div>${s.portrait && PNG_DATA_URL.test(s.portrait) ? `<img src="${s.portrait}" class="sheet-portrait" alt="${esc(s.name)}">` : ""}
    <h3>${esc(s.name)}</h3>
      <p><strong>Race:</strong> ${esc(s.race)} ${s.subrace ? "· " + esc(s.subrace) : ""}</p>
      <p><strong>Birthsign:</strong> ${esc(s.birthsign ?? "none")}</p>
      <p><strong>Class:</strong> ${esc(s.className)}</p>
      <p><strong>HP:</strong> ${num(s.hp)} | <strong>Weapon:</strong> ${esc(s.weapon)}</p>
    </div>
    <div><h3>Stats</h3><table class="digest-table"><tr><th>Stat</th><th>Value</th></tr>${statKV}</table></div>
  </div>
  ${duelsKV ? `<h3 class="digest-subhead">Recent Duels</h3><table class="digest-table"><tr><th>Date</th><th>Opponent</th><th>Result</th><th>Dur</th><th>Dmg</th><th>Weapon</th><th>Arena</th></tr>${duelsKV}</table>` : ""}`;
```

```ts
// Menu.ts:634-642 — history rows: numbers through num(), `at` through String()
const statLine = (st: Partial<FighterRecord["stats"]> | undefined) =>
  `V${num(st?.vitality)} R${num(st?.resilience)} W${num(st?.willpower)} Rx${num(st?.reflex)} S${num(st?.strength)} I${num(st?.intelligence)}`;
// in the row template:
//   #${num(r.id)}<small>${esc(String(r.at ?? "").slice(0, 16).replace("T", " "))}</small>
//   ${num(r.duration)}s · 1st: ${esc(r.firstStrike ?? "—")}
//   ${num(a.dealt)}/${num(b.dealt)}<small>${num(a.hits)}/${num(b.hits)} hits</small>
//   ${statLine(a.stats)}<small>vs ${statLine(b.stats)}</small>
// (import type { FighterRecord } from "../game/MatchHistory.ts")
```

```ts
// Engine.ts:2649 — #duelRow must not assume `at` is a string
date: String(r.at ?? "").slice(0, 16).replace("T", " "),
```

Systemic follow-up, optional: replace hand-written templates with an auto-escaping tagged template.
Interpolations are then escaped by default, and trusted markup (icons) must be marked explicitly:

```ts
export class SafeHtml { constructor(readonly value: string) {} }
export const raw = (s: string) => new SafeHtml(s); // icons and other markup built from constants only
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  const part = (v: unknown): string => v instanceof SafeHtml ? v.value : Array.isArray(v) ? v.map(part).join("") : esc(v);
  return new SafeHtml(strings.reduce((out, s, i) => out + part(values[i - 1]) + s));
}
// el.innerHTML = html`<h3>${s.name}</h3>${raw(icon("chevron-left"))}`.value;
```

---

## S2 — Medium — CSP delivered only by `serve.ts`, and missing `form-action`

**Evidence.**

- `index.html:1` (copied verbatim to `dist/index.html` by `tools/build.ts:18`) has no
  `<meta http-equiv="Content-Security-Policy">`. A grep of `*.ts`, `*.html`, `*.sh` and `*.md` for
  `Content-Security-Policy` or `http-equiv` finds only `tools/serve.ts:22` and
  `tests/server_test.ts:11`.
- The header policy at `tools/serve.ts:22-23` is
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
  It is good, but `form-action` does not fall back to `default-src`, so forms may post anywhere.
- Compliance of the *current* bundle with that policy (grep of `dist/app.js`, working tree):
  0 × `style="`, 0 × `cssText`, 0 × `setAttribute("style"`, 0 × `eval(`, 0 × `new Function`,
  0 × `new Worker`, 0 × `createObjectURL`, 0 × `import(`.
  - Dynamic styles go through CSSOM, which CSP does not restrict: `Menu.ts:408`
    (`tab.style.setProperty("--tab", …)`) and `Menu.ts:656-661`.
  - `data:` URLs are used only for images, which `img-src … data:` allows: the favicon
    (`index.html:1`), the portrait (`Portrait.ts:44` `toDataURL`) and skill art (`SkillArt.ts:138`).
  - **The current source and bundle are CSP-clean.** The committed bundle is not; see S6.

**Exploit sketch.** Serve `dist/` from any other static server, such as `python3 -m http.server`,
a CDN or GitHub Pages. The page then runs with **no CSP at all**, so S1's `onerror` payload executes.

**Fix.** Two parts:

1. Make the policy travel with the document. Add this as the first element of `<head>` in `index.html`.
   (`frame-ancestors` is ignored in `<meta>`, so it stays in the header.)

   ```html
   <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
   ```

2. Add `form-action 'none'` to the header in `serve.ts:23`. Once S4 removes the beacon, tighten both
   policies to `connect-src 'none'`. That turns the "no network" rule into a browser-enforced policy
   instead of a claim. The bundle has 0 `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource` (grep).

Optional, Chromium only: `require-trusted-types-for 'script'` plus a single `trustedTypes.createPolicy`
around the `html` helper (S1). Without that helper it would break all 15 `innerHTML` sites.

---

## S3 — Low — Saves loaded without schema validation, size limits or migrations

**Evidence.**

- `src/game/Profiles.ts:98-107`: `JSON.parse(raw)`, then keep anything with
  `typeof p.playerId === "string"`. No other field is checked.
- `src/game/MatchHistory.ts:39-47`: keep any record with `Array.isArray(r.fighters) && r.fighters.length === 2`.
  The fighters themselves are not checked.
- Crash paths. These were confirmed with the probe where marked; the rest come from reading the code.
  - `summarize()` throws on `fighters:[null,null]`. Probe output: `null fighters: THROWS Cannot read properties of null (reading 'race')`.
    `Engine.ts:360` calls `summarize(this.#history)` as an argument to `menu.show("digest", …)`,
    so **History never opens** until storage is cleared.
  - `ProfileRepo.recordMatch` throws for a profile without `telemetry`. Probe output:
    `missing telemetry: THROWS Cannot read properties of undefined (reading 'matches')`.
    It is called mid-frame at match end (`Engine.ts:1987-1991`), *before* `#recordMatch()` saves the
    history (`:1994`). `#loop` (`:2006`) has no try/catch. Reading only, not run live: the KO path
    aborts and the 100 ms heartbeat (`:416-418`) re-enters it.
  - `Menu.ts:637` and `Engine.ts:2649` call `r.at.slice`, which throws if `at` is not a string.
    `Menu.ts:642` reads `a.stats.vitality`, which throws if `stats` is missing.
  - A profile with an unknown `className` reaches `createFighter` → `weaponForClass(className)`.
    `CLASS_SPECS[className]` is `undefined`, so `spec.type` throws (`Weapon.ts:80-82`). The route is
    a profile chip click then Rematch or R (`Engine.ts:2675-2681`, `:358`). The probe shows such a
    profile loads unchanged: `profile loaded: <img src=x onerror=alert(1)> Hacker`.
- Size: the creator name has no `maxlength` (`Menu.ts:171`) and no cap (`:313`), and it is copied into
  every history record (up to `HISTORY_CAP = 500`, `MatchHistory.ts:37`). When the origin quota is
  exceeded, `setItem` throws and `Engine.ts:2642` swallows it (`/* storage unavailable */`), so
  **history silently stops persisting**. `ProfileRepo.#save` (`Profiles.ts:110`) is not wrapped,
  so a quota error there propagates.
- Versioning exists only in the key names (`mytherrania-profiles-v1`, `mytherrania-history-v2`).
  There is no per-record `v` and no migration.
- **Prototype pollution: not exploitable (Info).**
  - `JSON.parse` defines `"__proto__"` as an own data property.
  - The object spreads in `Profiles.ts:135` and `Engine.ts:2676` copy own properties without invoking setters.
  - `summarize`'s `count()` (`MatchHistory.ts:109`) only assigns numbers or strings, and the browser
    `__proto__` setter ignores non-objects.
  - The probe confirms no global effect (`global polluted: undefined`). Caveat: Deno removes the
    `__proto__` accessor, so the probe's `{"__proto__":1}` is not what a browser shows. The browser
    conclusion comes from reasoning about the spec, not from a run.
  - Inherited keys do corrupt counts. Probe: `{"constructor":"function Object() { [native code] }1"}`.
    That value is shown via `counts()` (`Menu.ts:633`, `<b>${v}</b>`). It is display-only and
    contains no markup.

**Fix.** Sanitize on load and drop what does not fit; S1's escaping stays required. `Profiles.ts`:

```ts
import { CLASSES, type ClassName } from "./Stats.ts";
export const MAX_NAME_LENGTH = 24;   // characters; fits the chip and the HUD line
export const MAX_PROFILES = 32;
const str = (v: unknown, max: number): string | null => typeof v === "string" ? v.slice(0, max) : null;
const fin = (v: unknown, fallback = 0): number => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const isClass = (v: unknown): v is ClassName => (CLASSES as readonly unknown[]).includes(v);

/** A stored profile coerced to the current schema, or null when it cannot be one. */
export function sanitizeProfile(x: unknown): Profile | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const playerId = str(o.playerId, 16);
  if (!playerId || !/^PL-[0-9A-F]{6}$/.test(playerId)) return null;
  const kb = (o.keybindings && typeof o.keybindings === "object" ? o.keybindings : {}) as Record<string, unknown>;
  const keybindings = { ...DEFAULT_KEYBINDINGS };
  for (const k of Object.keys(DEFAULT_KEYBINDINGS) as (keyof Keybindings)[]) {
    const v = kb[k];
    if (typeof v === "string" && /^[A-Za-z0-9]{1,24}$/.test(v)) keybindings[k] = v;
  }
  const t = (o.telemetry && typeof o.telemetry === "object" ? o.telemetry : {}) as Record<string, unknown>;
  return {
    playerId,
    name: str(o.name, MAX_NAME_LENGTH) || "Hero",
    className: isClass(o.className) ? o.className : "Warrior",
    race: str(o.race, 32) ?? "human",          // validate against RACES in the Engine (raceById) before use
    subrace: str(o.subrace, 32),
    birthsign: str(o.birthsign, 32),
    keybindings,
    telemetry: { matches: fin(t.matches), wins: fin(t.wins), losses: fin(t.losses), damageDealt: fin(t.damageDealt),
                 favouriteClass: isClass(t.favouriteClass) ? t.favouriteClass : null },
    createdAt: str(o.createdAt, 40) ?? new Date(0).toISOString(),
  };
}
// #load(): return Array.isArray(data)
//   ? data.slice(0, MAX_PROFILES).map(sanitizeProfile).filter((p): p is Profile => p !== null) : [];
// #save(): wrap setItem in try/catch like Engine.ts:2642, and surface the failure once in the UI.
```

`MatchHistory.ts`:

```ts
const str = (v: unknown, max: number): string | null => typeof v === "string" ? v.slice(0, max) : null;
const fin = (v: unknown, fallback = 0): number => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const REASONS: readonly WinReason[] = ["ko", "ring-out", "timed", "koth"];
function sanitizeFighter(x: unknown): FighterRecord | null {
  if (!x || typeof x !== "object") return null;
  const f = x as Record<string, unknown>;
  const s = (f.stats && typeof f.stats === "object" ? f.stats : {}) as Record<string, unknown>;
  return {
    name: str(f.name, 24) ?? "?", race: str(f.race, 32) ?? "?", subrace: str(f.subrace, 32),
    className: str(f.className, 32) ?? "?", weapon: str(f.weapon, 32) ?? "?", level: fin(f.level, 1),
    controller: f.controller === "human" ? "human" : "decision-tree",
    stats: { vitality: fin(s.vitality), resilience: fin(s.resilience), willpower: fin(s.willpower), reflex: fin(s.reflex),
             strength: fin(s.strength), intelligence: fin(s.intelligence), maxHealth: fin(s.maxHealth),
             attackPower: fin(s.attackPower), armor: fin(s.armor) },
    dealt: fin(f.dealt), hits: fin(f.hits), hpLeft: fin(f.hpLeft),
  };
}
/** A stored match coerced to the current schema, or null. */
export function sanitizeRecord(x: unknown): MatchRecord | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!Array.isArray(r.fighters) || r.fighters.length !== 2) return null;
  const a = sanitizeFighter(r.fighters[0]), b = sanitizeFighter(r.fighters[1]);
  if (!a || !b) return null;
  return {
    id: fin(r.id), at: str(r.at, 40) ?? "", hour: fin(r.hour), phase: str(r.phase, 16) ?? "?",
    place: str(r.place, 48) ?? "?", arena: str(r.arena, 32) ?? "?",
    reason: REASONS.includes(r.reason as WinReason) ? r.reason as WinReason : "ko",
    duration: fin(r.duration), firstStrike: str(r.firstStrike, 24),
    winner: r.winner === 0 || r.winner === 1 ? r.winner : null,
    fighters: [a, b],
  };
}
export function parseHistory(raw: string | null): MatchRecord[] {
  if (!raw || raw.length > 2_000_000) return [];               // 500 records * ~1 kB, with headroom
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data)
      ? data.slice(-HISTORY_CAP).map(sanitizeRecord).filter((r): r is MatchRecord => r !== null) : [];
  } catch { return []; }
}
// summarize(): count into Object.create(null) so "constructor"/"toString" keys count correctly:
//   list.reduce<Record<string, number>>((o, r) => { const key = k(r); o[key] = (o[key] ?? 0) + 1; return o; }, Object.create(null))
```

`Menu.ts:171` and `:313` (cap the name at the source):

```ts
<input id="creator-name" type="text" maxlength="24" autocomplete="off" value="${esc(this.#player.name)}">
nameInput.addEventListener("input", () => {
  this.#player.name = nameInput.value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24) || "Fighter";
});
```

Tests: `sanitizeProfile` and `sanitizeRecord` are pure, so they can be unit-tested in Deno. Feed them
the probe's inputs (`[null,null]` fighters, no `telemetry`, `className:"Hacker"`, string `id`) and
assert that a value is returned and nothing throws.

---

## S4 — Low — Undeclared telemetry beacon (network egress)

**Evidence.**

- `src/game/CreationTelemetry.ts:14`: `TELEMETRY_ENDPOINT = "/api/telemetry/character-creation"`.
  `:81-92` sends it with `navigator.sendBeacon(endpoint, JSON.stringify(payload))`.
- `Engine.ts:211` (`#telemetry = beaconSink()`) and `:355` (`this.#sendCreationTelemetry(p)` on
  every `onStart`) wire it up. `:2692-2705` builds the payload: the stable pseudonymous `playerId`,
  class, race, sub-race, birthsign and stats.
- The bundle contains it: grep `sendBeacon` = 1 in `dist/app.js` (both HEAD and working tree).
  `serve.ts:10-12` answers POST with 405, so locally the data goes nowhere. On any host that accepts
  POST, it is logged there.
- This contradicts BRIEF rule 3 ("No network"), and the build's isolation check does not see it (S5).

**Fix.** Default to a local queue and keep the beacon behind an explicit opt-in:

```ts
// CreationTelemetry.ts — new default sink: never leaves the page
export function localQueueSink(cap = 50): TelemetrySink & { drain(): CharacterCreationEvent[] } {
  const queue: CharacterCreationEvent[] = [];
  return {
    send(_endpoint, payload) { queue.push(payload); if (queue.length > cap) queue.shift(); },
    drain() { return queue.splice(0); },
  };
}
// Engine.ts:211
#telemetry = localQueueSink();
```

Then set `connect-src 'none'` (S2).

---

## S5 — Low — The "static from-URL check" is narrow

**Evidence.** `tools/build.ts:22`: `if (/\bfrom\s*["']https?:/.test(js)) throw …`. It misses
side-effect imports (`import "https://…"`), `import("…")`, protocol-relative `//host`, `fetch`,
`sendBeacon`, `WebSocket`, `EventSource`, `Worker` and `eval`/`Function`. `:26` admits that
"runtime network isolation requires browser verification".

The regex probe below, run on the current `dist/app.js`, matches only `sendBeacon`, so adopting it now
fails the build until S4 is fixed. That is intended.

**Fix** (`tools/build.ts`, replacing `:22`):

```ts
const FORBIDDEN_IN_BUNDLE: [string, RegExp][] = [
  ["remote static import", /\b(?:from|import)\s*["'](?:https?:)?\/\//],
  ["dynamic import", /\bimport\s*\(/],
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["WebSocket", /\bWebSocket\b/],
  ["EventSource", /\bEventSource\b/],
  ["sendBeacon", /\bsendBeacon\b/],
  ["Worker", /\bnew\s+(?:Shared)?Worker\b/],
  ["eval / new Function", /\beval\s*\(|\bnew\s+Function\s*\(/],
  ["RTCPeerConnection", /\bRTCPeerConnection\b/],
  ["inline style attribute", /\sstyle=\\?["']/],
];
const hits = FORBIDDEN_IN_BUNDLE.filter(([, re]) => re.test(js)).map(([name]) => name);
if (hits.length) throw Error(`Bundle uses forbidden APIs: ${hits.join(", ")}`);
```

---

## S6 — Low — Committed `dist/` is stale and violates the CSP

**Evidence.** `git log -- dist/app.js` lists only `c5b55af … Snapshot before 2026-10-28 overhaul`.

- The committed `HEAD:dist/app.js` is 765,717 B. It contains 0 × `getLayoutMap`, so the R14 fix is
  not in it, and 1 × `style="`:
  `t.innerHTML=n.map(…\`<button class="tab" … style="--tab:${$p[r.colour]}" …\`)`.
  That is the pre-overhaul `Menu.ts` tab code, and `style-src 'self'` blocks it, so the tab colours
  silently drop.
- The working tree `dist/app.js` (1,259,118 B, built 19:31, `git status`: ` M dist/app.js`) is current
  and has 0 × `style="`.
- So the shipped artifact in git does not match the reviewed source. Anyone who checks out HEAD and
  runs `serve.ts` without building gets the old game.

**Fix.** Pick one. Either stop tracking build output
(`git rm -r --cached dist && printf 'dist/\n' >> .gitignore`, with `deno task dev` building first,
as it already does). Or commit `dist/` in the same commit as every source change it reflects.

---

## S7 — Low — Debug hook shipped in production

**Evidence.** `main.ts:10-13` unconditionally sets
`globalThis.__MYTHERRANIA__ = { snapshot, engine }`, and the bundle contains it (grep = 1). Through
`engine`, any page-context script can call:

- `debugWorld` (`Engine.ts:2448-2465`):
  - `{coin:true}` pushes items with no cap. Natural spawns are capped at 3 (`:1362`); `:2464` is not.
  - `{itemRate}` is written without `clampParam`.
  - `{nextArena}` is clamped by `makeArena` (S12).
- `debugSetModel` (`:2472-2480`) passes arbitrary race and class strings into `#startFight`. An
  unknown class throws (S3).
- `debugView` (`:2513`) and `debugScene()` (`:2656`, the whole THREE scene).

**Impact.** Only same-origin page scripts can reach a page global, and the header CSP restricts
scripts to `'self'`. So the hook gives an attacker **no new capability**. It is attack surface and a
cheat or DoS convenience. 26 files in `tools/` and `tests/` use it.

**Fix.** Gate it, then add `?qa=1` to the QA tools' `goto(…/index.html)` URLs:

```ts
// main.ts:10-13
const qa = new URLSearchParams(globalThis.location?.search ?? "").has("qa");
if (qa) {
  Object.defineProperty(globalThis, "__MYTHERRANIA__", {
    value: Object.freeze({ snapshot: () => engine.snapshot(), engine } satisfies MythDiagnostics),
    writable: false, configurable: false,
  });
}
```

Also clamp inside the debug methods themselves, for example
`itemRate: clampParam("itemRate", opts.itemRate)` and a cap on `#items.length` in the `coin` branch.

---

## S8 — Low — `tools/serve.ts` hardening

**Verified good.**

- An exact-path allow-list of 5 assets (`:1-7`, `:13-14`) means no path traversal; `tests/server_test.ts:14-17`
  covers `/%2e%2e/deno.json` and source paths.
- GET and HEAD only (`:10-12`).
- Binds `127.0.0.1:8788` (`:34`), so it is not on the LAN.
- Least-privilege run flags (`--allow-net=127.0.0.1:8788 --allow-read=dist`, `deno.json:26`,
  `tools/start-server.sh:3`).
- Correct MIME types plus `nosniff`, `no-store` and CSP (`:18-24`).
- `dist/*` are regular files, not symlinks (`ls -la dist`).

**Gaps.**

- No Host-header check. A DNS-rebinding page can read every served asset, including `/app.js.map`
  (6.0 MB, with `sourcesContent` for all 132 sources, i.e. the full source). Nothing secret is there
  today (S10), but the exposure is avoidable.
- No `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` or
  `Permissions-Policy`.
- The 404, 405 and 500 responses (`:11`, `:14`, `:27`, `:29`) carry no security headers. They are
  `text/plain`, so this is low impact.

**Fix:**

```ts
const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), payment=()",
};
// use { ...SECURITY_HEADERS, "Content-Type": … } on every Response, including 404/405/500.

const ALLOWED_HOSTS = new Set(["127.0.0.1:8788", "localhost:8788"]);
if (import.meta.main) {
  Deno.serve({ hostname: "127.0.0.1", port: 8788 }, (request) =>
    ALLOWED_HOSTS.has(new URL(request.url).host)            // Deno builds request.url from the Host header
      ? serveAsset(request)
      : new Response("Misdirected request", { status: 421, headers: SECURITY_HEADERS }));
}
```

Keeping the Host check in the `import.meta.main` handler leaves `serveAsset` unit-testable with the
existing `http://localhost/` requests. Optionally, serve `/app.js.map` only when started with `--maps`.

---

## S9 — Info — Third-party dependencies

- `deno.json:12-16` pins exact versions: `three` `npm:three@0.180.0`, `@types/three` `0.180.0`,
  `playwright` `1.56.1`.
- `deno.lock` is v5 and has a `sha512` integrity for every npm package.
- `deno info --json main.ts`: 132 modules, **0 remote** (`http(s):` or `jsr:`).
- The bundle's only URL strings are the SVG and XHTML XML namespaces (grep).
- Versions: the npm registry today returns `three` **0.186.1** and `@types/three` **0.186.0**, so the
  pins are 6 minors behind. The two `three` advisories found affect `< 0.125.0` (CVE-2020-28496) and
  `< 0.137.0` (CVE-2022-0177, withdrawn), so neither applies. This is not an exhaustive advisory scan.
  Upgrade for maintenance, not urgency, and rerun the visual QA after.
- Playwright (dev-only, 30 imports via the import map) is 1.56.1, which is past the fix for
  CVE-2025-59288 (GHSA-7mvr-c777-76hp, `< 1.55.1`, `curl -k` browser installers). `deno.lock` still
  has the specifiers `npm:playwright@1.49` → 1.49.1 and `npm:playwright@1.52.0`, both in the
  vulnerable range. No file references them (grep of `*.ts`, `*.json` and `*.sh`). Prune them by
  regenerating the lock.
- The lock is not frozen. Add `"lock": { "frozen": true }` to `deno.json` so a drifted resolution
  fails instead of silently rewriting the lock.
- Tasks with `-A`: `build`, `verify:*`, `test:browser-probe` and `qa:matrix` (`deno.json:24-38`).
  `build` needs only to read `.`, write `dist` and run `deno`; not tried here.
- `fsevents@2.3.2` is marked `"scripts": true`. Deno does not run npm lifecycle scripts unless
  `--allow-scripts` is given.

## S10 — Info — Secrets and path leaks

- **Secrets: none found.**
  - `git grep` over all 17 commits for AWS, GitHub, OpenAI/Anthropic, Slack and Google key formats
    and `PRIVATE KEY` blocks found 0 hits.
  - A keyword grep (`secret|password|token|api_key|bearer|authorization|…`) in the current tree hit
    only lore text ("Whispered secrets", `Birthsight.ts:30`) and the minimap's `drawToken`.
  - No `.env`, `.pem`, `.key`, `id_rsa`, `.npmrc` or `.netrc` files are tracked.
- **Paths.**
  - `dist/app.js` contains 0 × `/Users/`.
  - `dist/app.js.map` uses relative sources, but `../../../Library/Caches/deno/npm/…` reveals a macOS
    home layout, and it embeds all sources.
  - `artifacts/verification-plan.json:3` and `tools/start-server.sh:2` contain
    `/Users/macmax/Desktop/Mytherrania` (the username), as do `docs/overhaul/*.md`.
  - Harmless locally. Scrub them before publishing the repo, and make `start-server.sh` use
    `cd "$(dirname "$0")/.."`.

## S11 — Info — Keyboard layout, gamepad and pointer lock

- `src/input/KeyboardLayout.ts:126-134` reads `navigator.language` and, in Chromium,
  `navigator.keyboard.getLayoutMap()`. Failures are swallowed. The result is used only to relabel
  hints (`Engine.ts:902-906`, `:966-979`). It is not stored (no storage API in `src/input`) and not
  sent: `CharacterCreationEvent` (`CreationTelemetry.ts:17-34`) has no layout field. The fingerprint
  surface is the browser's, and the app does not exfiltrate it.
- Gamepad (`Engine.ts:2663-2671`) reads `axes[0..1]` only, with nothing stored or sent.
- Pointer lock (`Engine.ts:921-922`) is requested only from `click`/`mousedown` on the canvas (a user
  gesture), and Esc releases it (browser-enforced).

## S12 — Info — Allocation bounds in the new lanes

- Arena size from the menu is capped by a range input with `max=LIVE_ARENA_MAX` = 120
  (`Menu.ts:15`, `:249`).
- Any override, including the debug hook, is clamped by `makeArena` → `clampParam` to `size ≤ 320` m
  (`ArenaConfig.ts:35`, `:99-103`, `:131-138`, applied at `:335`).
- The heightfield grid is `gridAxis = ceil(2·domainHalf / cell) + 1`, where
  `cell ≥ 2·domainHalf / (maxGridAxis − 1)`, with `maxGridAxis ∈ [16, 512]`
  (`TerrainRules.ts:81`, `:353-354`). So the node count is bounded at ≈ 512² regardless of size.
- Ring segments are capped at 768 (`RingSurface.ts:85`).
- FX uses fixed pools: `MAX_GHOSTS = 5` and `MAX_SPEED_LINES = 10` (`ChargeFx.ts:64-65`), a ring trail
  buffer, and 2 fighter slots (`FxDirector.ts:37`, which throws on exhaustion at `:154`).
- The minimap backing store is the CSS size × DPR (`Minimap.ts:241-296`).
- `src/graphics/{body,paint,fx}`, `src/world` and `src/game/anim` touch no DOM, storage or globals
  (grep). Their inputs are engine constants.
- Note: `clampParam` passes `NaN` through (`Math.max(min, Math.min(max, NaN))` is `NaN`). That is
  reachable only via the debug hook, and typed arrays of `NaN` length are empty, so it is not a DoS.

## S13 — Info — Latent template issues

- `Menu.ts:171`: `value="${this.#player.name}"` is unescaped. It is static today, since `#render` runs
  once with `PRESETS[0]`, but it breaks if `#render` is ever re-run after typing. The fix is in S3's snippet.
- `esc` (`Menu.ts:61`) does not escape `'`. Every current attribute is double-quoted, so this is safe
  today; S1's `esc` adds `&#39;`.
- Static, constant-only `innerHTML` sites (no action needed): `Engine.ts:930` and `:985`, `Menu.ts:152`
  (except `:171`), `:402-403` (UiTree constants), `SkillBar.ts:275` (`skillKindIcon` maps the kind
  through a fixed table, `Icons.ts:110-111`).

### `innerHTML` inventory (15 in `src`, which matches 15 in `dist/app.js`)

| Site | Untrusted values interpolated | Escaped? |
|------|-------------------------------|----------|
| `Menu.ts:137-139` profile chips | stored profile `playerId`, `name`, `className` | yes |
| `Menu.ts:152` screens | `#player.name` at `:171` (static at render time) | **no** (latent, S13) |
| `Menu.ts:402` tabs | constants | n/a |
| `Menu.ts:433` race detail | constants (race, subspecies, signs) | yes |
| `Menu.ts:503`, `:505` secondary rows and sign preview | constants | yes |
| `Menu.ts:542` class skills | constants | partly; constants only |
| `Menu.ts:584` **sheet** | typed name and stored history fields | **no** (S1) |
| `Menu.ts:623`, `:644` **history** | stored history strings (escaped); stored "numbers" | **numbers no** (S1) |
| `Menu.ts:675` AI card | ladder names and ids | yes |
| `SkillBar.ts:275` | kind → fixed icon | n/a |
| `Engine.ts:930`, `:985` | none | n/a |

---

## Prioritised fix list

1. **S1:** escape the sheet (`Menu.ts:580-595`) and coerce the history numbers (`:637-642`) and
   `#duelRow` `at` (`Engine.ts:2649`). This is the only path from user or stored text to markup.
2. **S2:** add the `<meta>` CSP to `index.html`, and add `form-action 'none'` to both policies.
   This closes script execution on every host, not just `serve.ts`.
3. **S3:** add `sanitizeProfile` and `sanitizeRecord` plus their unit tests, the name `maxlength=24`
   with trim, and the guarded `#save`. This fixes the History, Sheet and match-end crashes caused by
   corrupt saves.
4. **S4 + S5:** replace the beacon with `localQueueSink`, set `connect-src 'none'`, and adopt the
   forbidden-API bundle check. The "no network" rule then becomes enforced and tested.
5. **S6:** untrack `dist/`, or commit the rebuilt bundle with the source.
6. **S7:** gate `__MYTHERRANIA__` behind `?qa`, update the QA tools' URLs, and clamp inside the debug methods.
7. **S8:** add the Host allow-list, the shared security headers on every response, and optional source maps.
8. **S9/S10:** freeze and prune the lock, plan the `three` 0.186 upgrade, narrow the `build`
   permissions, and scrub `/Users/macmax` before any public release.

## Commands run (real output)

```text
$ grep -oF '<pat>' dist/app.js | wc -l      # working tree bundle, 1,259,118 B
fetch( 0 | XMLHttpRequest 0 | WebSocket 0 | sendBeacon 1 | EventSource 0 | import( 0 | new Worker 0
importScripts 0 | eval( 0 | new Function 0 | createObjectURL 0 | innerHTML 15 | outerHTML 0
insertAdjacentHTML 0 | document.write 0 | __MYTHERRANIA__ 1 | getLayoutMap 1 | requestPointerLock 2
getGamepads 1 | localStorage 3 | indexedDB 0 | style=" 0 | cssText 0 | javascript: 0 | onerror= 0
$ git show HEAD:dist/app.js | grep -oF …   # committed bundle, 765,717 B
sendBeacon 1 | innerHTML 15 | __MYTHERRANIA__ 1 | style=" 1 | getLayoutMap 0
$ grep -oE 'https?://[A-Za-z0-9./_-]+' dist/app.js | sort | uniq -c
   1 http://www.w3.org/2000/svg
   1 http://www.w3.org/1999/xhtml
$ deno info --json main.ts | (python summary)
modules 132 / remote [] / npm: three@0.180.0, @types/three@0.180.0, meshoptimizer@0.22.0, … playwright@1.49.1, 1.52.0, 1.56.1
$ deno run --allow-read <probe on src/game/MatchHistory.ts + Profiles.ts>
polluted after summarize: undefined true {"__proto__":1} {"__proto__":1} {"constructor":"function Object() { [native code] }1"}
numeric race: ok
null fighters: THROWS Cannot read properties of null (reading 'race')
profile loaded: <img src=x onerror=alert(1)> Hacker own __proto__ key: true global polluted: undefined
recordMatch ok {"matches":null,"wins":null,"damageDealt":null,"favouriteClass":"Warrior"}
missing telemetry: THROWS Cannot read properties of undefined (reading 'matches')
$ deno run --allow-read <S5 regex list on dist/app.js>
remote static import false | dynamic import false | fetch false | XMLHttpRequest false | WebSocket false
EventSource false | sendBeacon true | Worker false | eval/Function false | RTCPeerConnection false
old build check (from https): false
$ git grep -nIE '<key formats>' $(git rev-list --all)   # 17 commits
(no output)
$ deno task audit        # static reachability audit (not a security audit); exit 0, wrote artifacts/reachability.json
$ npm registry /latest: three 0.186.1, @types/three 0.186.0
```

(The `recordMatch ok` line shows a profile whose `telemetry` is `{}` being "updated" into `null`
counters. `NaN` serialises as `null`, so this is silent corruption rather than a crash.)

## Not verified

- No live-browser run, by instruction. The S1 rendering, the CSP blocking the `onerror`, the S3
  match-end freeze and meta-refresh or form behaviour under injection all come from reading the code.
- The `__proto__` behaviour in browsers comes from reasoning about the spec, because Deno deletes the
  accessor. Advisory coverage for `three` comes from one search, not a full database scan.
- Whether `--allow-read=dist` blocks a symlink that points outside `dist` was not tested. Today the
  files are regular files.
