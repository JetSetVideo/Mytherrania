async (page) => {
  const CFG = {"name": "laptop 1440x900 @2", "w": 1440, "h": 900, "dpr": 2, "sizes": [12, 120], "profile": true, "key": "laptop"};
  const ctx = await page.context().browser().newContext({ viewport: { width: CFG.w, height: CFG.h }, deviceScaleFactor: CFG.dpr, isMobile: !!CFG.mobile, acceptDownloads: true });
  await ctx.addInitScript({ path: "/Users/macmax/.hermes/cache/scratch/perf/inject.js" });
  const p = await ctx.newPage();
  const out = { cfg: CFG, at: new Date().toISOString(), runs: [], errors: [] };
  p.on("pageerror", (e) => out.errors.push(String(e.message).slice(0, 200)));
  const sleep = (ms) => p.waitForTimeout(ms);
  const E = (fn, arg) => p.evaluate(fn, arg);
  let digest = "";
  try {
    const cdp = await ctx.newCDPSession(p);
    await p.goto("http://127.0.0.1:8788/", { waitUntil: "load" });
    await p.waitForFunction(() => globalThis.__MYTHERRANIA__ && globalThis.__PERF__ && globalThis.__PERF__.gl, null, { timeout: 20000 });
    await sleep(800);
    out.load = await E(() => { const n = performance.getEntriesByType("navigation")[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), loadEnd: Math.round(n.loadEventEnd), appJs: performance.getEntriesByType("resource").filter((r) => r.name.includes("app.js")).map((r) => ({ dur: Math.round(r.duration), transfer: r.transferSize })), longtasks: __PERF__.longtasks.slice(), inner: [innerWidth, innerHeight], vvScale: visualViewport.scale, vis: document.visibilityState }; });
    const click = async (re) => { const b = p.getByRole("button", { name: re }).first(); await b.waitFor({ state: "visible", timeout: 10000 }); await b.scrollIntoViewIfNeeded(); const bb = await b.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); };
    await click(/Fight/);
    await sleep(600);
    const lt0 = await E(() => __PERF__.longtasks.length);
    await click(/Enter the ring/);
    await p.waitForFunction(() => __MYTHERRANIA__.snapshot().phase === "fight", null, { timeout: 20000 });
    await sleep(1500);
    out.matchStart = await E((n) => __PERF__.longtasks.slice(n), lt0);
    for (const size of CFG.sizes) {
      const n0 = await E((s) => { __MYTHERRANIA__.engine.debugWorld({ nextArena: { size: s } }); return __PERF__.longtasks.length; }, size);
      await p.keyboard.press("KeyR");
      await p.waitForFunction((s) => __MYTHERRANIA__.snapshot().ring.size === s, size, { timeout: 20000 });
      await E(() => { __MYTHERRANIA__.engine.debugView({ hour: 12, freeze: false }); __PERF__.scene = __MYTHERRANIA__.engine.debugScene(); __PERF__.retag(); });
      await sleep(2000);
      const run = { size, restartLongtasks: await E((n) => __PERF__.longtasks.slice(n), n0) };
      if (CFG.throttle) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CFG.throttle });
      await E(() => { __PERF__.retag(); __PERF__.start(false); });
      await sleep(5000);
      run.light = await E(() => { __PERF__.stop(); return __PERF__.summary(); });
      await E(() => { __PERF__.retag(); __PERF__.start(true); });
      await sleep(3000);
      run.full = await E(() => { __PERF__.stop(); return __PERF__.summary(); });
      if (CFG.profile) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
        await E(() => __PERF__.start(false));
        await cdp.send("Profiler.start");
        await sleep(5000);
        const { profile } = await cdp.send("Profiler.stop");
        const fr = await E(() => { __PERF__.stop(); return __PERF__.summary(); });
        run.profile = { ...(await E((pr) => __PERF__.aggProfile(pr), profile)), frames: fr.frames, dt: fr.dt, js: fr.js };
      }
      if (CFG.throttle) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      run.scene = await E(() => __PERF__.sceneStats());
      run.renderer = await E(() => __PERF__.rendererStats());
      run.overdraw = await E(() => __PERF__.overdraw(320));
      run.snap = await E(() => __PERF__.snapLite());
      out.runs.push(run);
      digest += `[${size}m dt ${run.light.dt.med}/${run.light.dt.p95} js ${run.light.js.med}/${run.light.js.p95} gpu ${run.full.gpu ? run.full.gpu.total.med + "/" + run.full.gpu.total.p95 : "-"} calls ${run.full.threeInfo ? Math.round(run.full.threeInfo.calls) : "-"} tris ${run.full.threeInfo ? Math.round(run.full.threeInfo.triangles) : "-"} hour ${run.snap.world.hour} shadowMap ${run.renderer.shadow ? run.renderer.shadow.mapSize : "-"}] `;
    }
  } catch (e) {
    out.errors.push("RUNNER: " + String(e && e.message).slice(0, 400));
  }
  try {
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 10000 }), E(([t, n]) => __PERF__.save(t, n), [JSON.stringify(out), CFG.key + ".json"])]);
    await dl.saveAs("/Users/macmax/.hermes/cache/scratch/perf/out/" + CFG.key + ".json");
    digest = "saved " + CFG.key + ".json " + digest;
  } catch (e) { digest = "SAVE FAILED " + String(e.message).slice(0, 200) + " " + digest; }
  await ctx.close();
  return digest + " errors=" + JSON.stringify(out.errors);
}
