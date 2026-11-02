// Wave W: the fluid hierarchy by depth and the full-window widths, pinned from styles.css itself.
function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const css = await Deno.readTextFile(new URL("../styles.css", import.meta.url));

/** Evaluate a `clamp(minPx, calc(a rem + b vw), maxPx)` token at a viewport width (rem = 16 px). */
function token(name: string, vw: number): number {
  const m = css.match(new RegExp(`--${name}:clamp\\(([\\d.]+)px,calc\\(([\\d.]+)rem \\+ ([\\d.]+)vw\\),([\\d.]+)px\\)`));
  assert(m, `token --${name} is a clamp(px, calc(rem + vw), px)`);
  const [lo, rem, v, hi] = m!.slice(1).map(Number);
  return Math.max(lo, Math.min(hi, rem * 16 + (v / 100) * vw));
}

Deno.test("wave W: the type scale falls with depth at every width (L0 > L1 > L2 > L3 > L4)", () => {
  for (const vw of [320, 390, 844, 1280, 1920, 2560, 3840]) {
    const t = ["t0", "t1", "t2", "t3", "t4"].map((n) => token(n, vw));
    for (let i = 1; i < t.length; i++) assert(t[i] < t[i - 1], `at ${vw}px: --t${i} ${t[i].toFixed(1)} < --t${i - 1} ${t[i - 1].toFixed(1)}`);
    assert(t[4] >= 11.5, `at ${vw}px the smallest text is >= 11.5px (${t[4]})`);
  }
});

Deno.test("wave W: every screen spans the window minus a gutter; the title, victory and settings keep >= 80 %", () => {
  assert(css.includes("#menu .menu-screen{width:calc(100vw - 2 * var(--w-gutter));max-width:none"), "screens fill the window");
  assert(css.includes("#menu[data-active] .menu-screen{width:calc(100vw - 2 * var(--w-gutter));max-width:none}"), "beats the per-active-screen rules");
  assert(/#settings-dialog\{width:max\(80vw,/.test(css), "settings >= 80vw");
  assert(/\[data-screen="title"\],#menu\[data-active\] \.menu-screen\[data-screen="victory"\]\{width:max\(80vw,/.test(css), "title + victory >= 80vw");
  assert(/--w-gutter:clamp\(4px,/.test(css), "phone gutter is 4px at the minimum");
});

Deno.test("wave W: icons are 1.2 × their label and sit beside it", () => {
  assert(css.includes(".menu-btn .menu-btn-icon,.title-modes .entry-btn .menu-btn-icon,.title-modes-row .menu-btn .menu-btn-icon{width:1.2em;height:1.2em;flex:none}"), "icon size");
});
