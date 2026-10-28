async (page) => {
  const ctx = await page.context().browser().newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true });
  await ctx.addInitScript({ path: "/Users/macmax/.hermes/cache/scratch/perf/inject.js" });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const out = {};
  try {
    await p.goto("http://127.0.0.1:8788/", { waitUntil: "load" });
    await p.waitForFunction(() => globalThis.__MYTHERRANIA__ && globalThis.__PERF__, null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    out.load = await p.evaluate(() => ({ lt: __PERF__.longtasks.slice(), dcl: Math.round(performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd) }));
    const click = async (re) => { const b = p.getByRole("button", { name: re }).first(); await b.waitFor({ state: "visible", timeout: 15000 }); await b.scrollIntoViewIfNeeded(); const bb = await b.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); };
    await click(/Fight/);
    await p.waitForTimeout(800);
    let n = await p.evaluate(() => __PERF__.longtasks.length);
    await click(/Enter the ring/);
    await p.waitForFunction(() => __MYTHERRANIA__.snapshot().phase === "fight", null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    out.enter = await p.evaluate((k) => __PERF__.longtasks.slice(k), n);
    for (const size of [12, 120]) {
      n = await p.evaluate((s) => { __MYTHERRANIA__.engine.debugWorld({ nextArena: { size: s } }); return __PERF__.longtasks.length; }, size);
      await p.keyboard.press("KeyR");
      await p.waitForFunction((s) => __MYTHERRANIA__.snapshot().ring.size === s, size, { timeout: 30000 });
      await p.waitForTimeout(1500);
      out["restart" + size] = await p.evaluate((k) => __PERF__.longtasks.slice(k), n);
    }
  } catch (e) { out.err = String(e.message).slice(0, 300); }
  await ctx.close();
  return JSON.stringify(out);
}
