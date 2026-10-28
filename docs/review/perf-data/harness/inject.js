// Measurement-only instrumentation injected before the game bundle (Playwright addInitScript).
// Counts real WebGL draw calls / primitives per frame, per render pass (shadow vs main) and per
// scene category (tagged through Object3D.onBeforeRender / onBeforeShadow), times every frame
// on the GPU with EXT_disjoint_timer_query_webgl2, and times the engine's rAF callback on the CPU.
(() => {
  if (globalThis.__PERF__) return;
  const P = globalThis.__PERF__ = {
    gl: null, ext: null, canvas: null, renderer: null, camera: null, scene: null,
    recording: false, full: false, pass: "pre", tag: "untagged", cur: null,
    frames: new Map(), pending: [], longtasks: [], offFrameDraws: 0, retagEvery: 10, n: 0,
  };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.longtasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ type: "longtask", buffered: true });
  } catch (_) { /* no longtask API */ }

  const oGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const c = oGet.call(this, type, attrs);
    if (type === "webgl2" && c && !P.gl) { P.gl = c; P.canvas = this; P.ext = c.getExtension("EXT_disjoint_timer_query_webgl2"); }
    return c;
  };

  // ---- GPU timer segments: one TIME_ELAPSED query per (frame, pass) segment ----
  let activeQ = null;
  function segStart(pass) {
    if (!P.ext || !P.cur || !P.full) return;
    const gl = P.gl, T = P.ext.TIME_ELAPSED_EXT;
    if (activeQ) gl.endQuery(T);
    const q = gl.createQuery();
    gl.beginQuery(T, q);
    activeQ = { q, pass, frame: P.cur };
    P.pending.push(activeQ);
  }
  function segEnd() { if (activeQ) { P.gl.endQuery(P.ext.TIME_ELAPSED_EXT); activeQ = null; } }
  function poll() {
    const gl = P.gl, ext = P.ext;
    if (!ext || !P.pending.length) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const keep = [];
    for (const s of P.pending) {
      if (s === activeQ || !gl.getQueryParameter(s.q, gl.QUERY_RESULT_AVAILABLE)) { keep.push(s); continue; }
      const ns = gl.getQueryParameter(s.q, gl.QUERY_RESULT);
      if (disjoint) s.frame.disjoint = true;
      else { s.frame.gpu[s.pass] = (s.frame.gpu[s.pass] || 0) + ns / 1e6; s.frame.gpuSeg++; }
      gl.deleteQuery(s.q);
    }
    P.pending = keep;
  }

  // ---- GL call accounting ----
  const G = WebGL2RenderingContext.prototype;
  const tri = (m, n) => (m === 4 ? n / 3 : (m === 5 || m === 6) ? Math.max(0, n - 2) : 0);
  function rec(m, n, inst) {
    const f = P.cur;
    if (!f) { P.offFrameDraws++; return; }
    const k = P.pass + "|" + P.tag;
    let e = f.calls[k];
    if (!e) e = f.calls[k] = [0, 0, 0];
    e[0]++; e[1] += tri(m, n) * inst; if (m < 4) e[2] += n * inst;
    P.tag = "untagged"; // an object without a hook shows up as 'untagged', never inherits a tag
  }
  const wrap = (name, pre) => {
    const o = G[name];
    if (!o) return;
    G[name] = function () { if (P.full && this === P.gl) pre.apply(this, arguments); return o.apply(this, arguments); };
  };
  wrap("drawElements", (m, c) => rec(m, c, 1));
  wrap("drawArrays", (m, _f, c) => rec(m, c, 1));
  wrap("drawElementsInstanced", (m, c, _t, _o, i) => rec(m, c, i));
  wrap("drawArraysInstanced", (m, _f, c, i) => rec(m, c, i));
  wrap("drawRangeElements", (m, _s, _e, c) => rec(m, c, 1));
  wrap("bindFramebuffer", (target, fb) => {
    if (target !== 0x8D40 && target !== 0x8CA9) return;
    const pass = fb ? "shadow" : "main";
    if (P.cur && pass !== P.pass) { P.pass = pass; segStart(pass); }
  });
  wrap("useProgram", () => { if (P.cur) P.cur.prog++; });
  wrap("texImage2D", () => { if (P.cur) P.cur.tex++; });
  wrap("texSubImage2D", () => { if (P.cur) P.cur.tex++; });
  wrap("bufferSubData", (_t, _o, d) => { if (P.cur) { P.cur.buf++; P.cur.bufBytes += (d && d.byteLength) || 0; } });
  wrap("bufferData", (_t, d) => { if (P.cur) { P.cur.buf++; P.cur.bufBytes += (d && d.byteLength) || 0; } });
  for (const u of ["uniform1f", "uniform1i", "uniform2f", "uniform3f", "uniform4f", "uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv", "uniform1iv", "uniformMatrix3fv", "uniformMatrix4fv"]) {
    wrap(u, () => { if (P.cur) P.cur.uni++; });
  }

  // ---- scene categories ----
  function tagOf(o) {
    const names = [];
    for (let n = o; n; n = n.parent) if (n.name) names.push(n.name);
    const has = (s) => names.includes(s);
    if (has("sky")) return "sky";
    if (names.some((s) => s.startsWith("fx-"))) return "fx";
    if (has("skinned-humanoid")) {
      const weapon = has("grip") || has("grip-mount");
      const outline = o.name === "cel-outline";
      return (weapon ? "weapon" : "body") + (outline ? "-outline" : "");
    }
    if (has("arena-outside")) return "terrain-outside";
    if (has("arena-floor")) return "terrain-ring";
    if (has("arena-wall")) return "wall";
    if (names.some((s) => s.startsWith("prop-"))) return "props";
    if (has("pickups")) return "pickups";
    if (has("void-plane")) return "void-plane";
    if (has("ragdoll")) return "ragdoll";
    if (has("coin")) return "coin";
    const g = o.geometry && o.geometry.type;
    if (g === "RingGeometry" || g === "CircleGeometry") return "aura+contact";
    return "other:" + (g || o.type);
  }
  P.tagOf = tagOf;
  // Every draw (main AND shadow pass) goes through renderer.renderBufferDirect(camera, scene, geometry,
  // material, object, group): tagging there catches objects created after the last retag.
  P.patchRenderer = (r) => {
    if (r.__perfPatched) return;
    r.__perfPatched = true;
    const o = r.renderBufferDirect;
    r.renderBufferDirect = function (cam, sc, g, m, obj, gr) {
      if (obj) { P.tag = obj.__perfTag || (obj.__perfTag = tagOf(obj)); if (P.full && P.cur && P.pass === "shadow" && m && m.isMaterial) { const k = P.tag; (P.cur.shadowObjs ??= {})[k] = ((P.cur.shadowObjs || {})[k] || 0) + 1; } }
      return o.call(this, cam, sc, g, m, obj, gr);
    };
  };
  P.retag = () => {
    const s = P.scene;
    if (!s) return;
    s.traverse((o) => {
      if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite) || o.__perfTag) return;
      const tag = tagOf(o);
      o.__perfTag = tag;
      const ob = o.onBeforeRender, os = o.onBeforeShadow;
      o.onBeforeRender = function (r, sc, cam, g, m, gr) { P.tag = tag; P.renderer = r; P.camera = cam; P.patchRenderer(r); return ob.call(this, r, sc, cam, g, m, gr); };
      if (os) o.onBeforeShadow = function () { P.tag = tag; return os.apply(this, arguments); };
    });
  };

  // ---- rAF wrapper: CPU time of the engine callback + frame boundaries ----
  const newFrame = (ts) => ({ ts, js: 0, calls: {}, gpu: {}, gpuSeg: 0, prog: 0, tex: 0, buf: 0, bufBytes: 0, uni: 0, info: null });
  const oRAF = globalThis.requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame = (cb) => oRAF((ts) => {
    if (!P.recording || !P.gl) return cb(ts);
    if (P.full && P.scene && (P.n++ % P.retagEvery === 0)) P.retag();
    let f = P.frames.get(ts);
    if (!f) { f = newFrame(ts); P.frames.set(ts, f); }
    P.cur = f; P.pass = "main"; P.tag = "untagged";
    segStart("main");
    const t0 = performance.now();
    try { cb(ts); } finally {
      f.js += performance.now() - t0;
      segEnd();
      if (P.full && P.renderer) { const i = P.renderer.info.render; f.info = [i.calls, i.triangles, i.lines, i.points]; }
      P.cur = null;
      poll();
    }
  });

  // ---- control + summaries ----
  P.start = (full) => { P.frames = new Map(); P.full = !!full; P.recording = true; P.n = 0; };
  P.stop = () => { P.recording = false; P.full = false; };
  const quant = (arr, p) => {
    const s = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!s.length) return null;
    const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
    return +(s[lo] + (s[hi] - s[lo]) * (i - lo)).toFixed(3);
  };
  const stats = (arr) => ({ n: arr.length, med: quant(arr, 0.5), p95: quant(arr, 0.95), max: quant(arr, 1), mean: arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : null });
  P.summary = () => {
    const fr = [...P.frames.values()].sort((a, b) => a.ts - b.ts);
    const dts = [];
    for (let i = 1; i < fr.length; i++) dts.push(fr[i].ts - fr[i - 1].ts);
    const jsArr = fr.map((f) => f.js);
    const out = { frames: fr.length, dt: stats(dts), js: stats(jsArr),
      long: { dtOver12_5: dts.filter((d) => d > 12.5).length, dtOver16_7: dts.filter((d) => d > 16.7).length, dtOver33: dts.filter((d) => d > 33.4).length, jsOver8_3: jsArr.filter((d) => d > 8.3).length } };
    if (fr.some((f) => f.gpuSeg)) {
      const done = fr.filter((f) => f.gpuSeg && !f.disjoint);
      const pass = (k) => done.map((f) => f.gpu[k] || 0);
      out.gpu = { frames: done.length, shadow: stats(pass("shadow")), main: stats(pass("main")),
        total: stats(done.map((f) => (f.gpu.shadow || 0) + (f.gpu.main || 0))) };
      const tags = {};
      const drawn = fr.filter((f) => Object.keys(f.calls).length);
      for (const f of drawn) for (const [k, e] of Object.entries(f.calls)) {
        const t = tags[k] ??= [0, 0, 0];
        t[0] += e[0]; t[1] += e[1]; t[2] += e[2];
      }
      const n = drawn.length || 1;
      out.perFrame = Object.fromEntries(Object.entries(tags).sort().map(([k, t]) => [k, { calls: +(t[0] / n).toFixed(2), tris: Math.round(t[1] / n), lines: Math.round(t[2] / n) }]));
      out.counters = { drawnFrames: drawn.length, prog: stats(drawn.map((f) => f.prog)).mean, tex: stats(drawn.map((f) => f.tex)).mean, buf: stats(drawn.map((f) => f.buf)).mean, bufKB: +(stats(drawn.map((f) => f.bufBytes)).mean / 1024).toFixed(1), uni: stats(drawn.map((f) => f.uni)).mean };
      const inf = drawn.filter((f) => f.info).map((f) => f.info);
      if (inf.length) out.threeInfo = { calls: stats(inf.map((i) => i[0])).mean, triangles: stats(inf.map((i) => i[1])).mean, lines: stats(inf.map((i) => i[2])).mean, points: stats(inf.map((i) => i[3])).mean };
    }
    return out;
  };

  // CPU profile (CDP Profiler.stop result) -> top self / inclusive time per function.
  P.aggProfile = (profile, topSelf = 40, topIncl = 60) => {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const keyOf = (n) => { const cf = n.callFrame; return (cf.functionName || "(anonymous)") + "|" + cf.url.replace(/^.*\//, "") + "|" + cf.lineNumber + "|" + cf.columnNumber; };
    const self = new Map(), incl = new Map();
    let total = 0;
    for (let i = 0; i < profile.samples.length; i++) {
      const us = profile.timeDeltas[i] || 0;
      total += us;
      const id = profile.samples[i];
      const k = keyOf(byId.get(id));
      self.set(k, (self.get(k) || 0) + us);
      const seen = new Set();
      for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
        const kk = keyOf(byId.get(cur));
        if (seen.has(kk)) continue;
        seen.add(kk);
        incl.set(kk, (incl.get(kk) || 0) + us);
      }
    }
    const fmt = ([k, us]) => { const [fn, url, line, col] = k.split("|"); return { fn, url, line: +line, col: +col, ms: +(us / 1000).toFixed(1), pct: +((100 * us) / total).toFixed(2) }; };
    return {
      totalMs: Math.round(total / 1000), samples: profile.samples.length,
      self: [...self].sort((a, c) => c[1] - a[1]).slice(0, topSelf).map(fmt),
      incl: [...incl].filter(([k]) => k.includes("app.js")).sort((a, c) => c[1] - a[1]).slice(0, topIncl).map(fmt),
    };
  };
  P.snapLite = () => {
    const s = globalThis.__MYTHERRANIA__.snapshot();
    return { phase: s.phase, winner: s.winner, polygons: s.polygons, fx: s.fx,
      terrain: s.terrain && { cols: s.terrain.cols, rows: s.terrain.rows, cell: s.terrain.cell, triangles: s.terrain.triangles },
      ring: { shape: s.ring.shape, size: s.ring.size, walled: s.ring.walled, props: s.ring.props, meshes: s.ring.meshes },
      minimap: s.minimap, camera: s.cameraInfo, elapsed: s.elapsed, canAttack: s.truce.canAttack, world: s.world,
      hp: [Math.round(s.player.hp), Math.round(s.opponent.hp)] };
  };
  P.save = (txt, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "application/json" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };

  // Static scene-graph census per category (world-visible meshes only for 'vis').
  P.sceneStats = () => {
    const out = {};
    const worldVisible = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
    P.scene.traverse((o) => {
      if (!(o.isMesh || o.isLine || o.isPoints)) return;
      const t = tagOf(o);
      const e = out[t] ??= { meshes: 0, visible: 0, tris: 0, visTris: 0, castShadow: 0, transparent: 0, skinned: 0, noCull: 0, mats: new Set() };
      const g = o.geometry;
      const idx = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      const n = Math.min(idx, g.drawRange.count) / 3;
      const vis = worldVisible(o);
      e.meshes++; e.tris += n;
      if (vis) { e.visible++; e.visTris += n; }
      if (o.castShadow && vis) e.castShadow++;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m && m.transparent)) e.transparent++;
      if (o.isSkinnedMesh) e.skinned++;
      if (!o.frustumCulled) e.noCull++;
      for (const m of mats) if (m) e.mats.add(m.uuid);
    });
    for (const e of Object.values(out)) { e.mats = e.mats.size; e.tris = Math.round(e.tris); e.visTris = Math.round(e.visTris); }
    return out;
  };

  P.rendererStats = () => {
    const r = P.renderer, gl = P.gl;
    let light = null;
    P.scene.traverse((o) => { if (!light && o.isDirectionalLight && o.shadow && o.shadow.map) light = o; });
    const sc = light && light.shadow.camera;
    return {
      canvas: [P.canvas.width, P.canvas.height], css: [P.canvas.clientWidth, P.canvas.clientHeight], dpr: globalThis.devicePixelRatio,
      pixelRatio: r && r.getPixelRatio(), antialias: gl.getContextAttributes().antialias, samples: gl.getParameter(gl.SAMPLES),
      shadowType: r && r.shadowMap.type, shadowEnabled: r && r.shadowMap.enabled,
      shadow: light ? { mapSize: [light.shadow.mapSize.x, light.shadow.mapSize.y], extent: [sc.left, sc.right, sc.bottom, sc.top], near: sc.near, far: sc.far } : null,
      programs: r && r.info.programs ? r.info.programs.length : null, memory: r && { ...r.info.memory },
      offFrameDraws: P.offFrameDraws,
      lights: (() => { const L = []; P.scene.traverse((o) => { if (o.isLight) L.push({ type: o.type, castShadow: o.castShadow, intensity: +o.intensity.toFixed(3), map: o.shadow && o.shadow.map ? [o.shadow.map.width, o.shadow.map.height] : null, mapSize: o.shadow ? [o.shadow.mapSize.x, o.shadow.mapSize.y] : null }); }); return L; })(),
    };
  };

  // Overdraw probe: re-render the current view into a small target with an additive counting
  // material (+1/255 red per fragment), keeping each mesh's face culling.
  //   raw    — depth test OFF: every rasterised fragment of the category counts.
  //   tested — depth test ON with the scene's real opaque depth (other opaque meshes write depth
  //            only, colour masked): fragments of the category that survive the depth test when
  //            opaques are drawn front-to-back (an immediate-mode GPU's early-z best case).
  P.overdraw = (W = 320) => {
    const r = P.renderer, cam = P.camera, sc = P.scene;
    if (!r || !cam) return { err: "no renderer/camera" };
    let basic = null, light = null;
    sc.traverse((o) => {
      if (!basic && o.isMesh && o.material && o.material.type === "MeshBasicMaterial") basic = o.material;
      if (!light && o.isLight && o.shadow && o.shadow.map) light = o;
    });
    const RT = light ? light.shadow.map.constructor : null;
    if (!basic || !RT) return { err: "no MeshBasicMaterial or shadow RT to clone" };
    const H = Math.round((W * P.canvas.height) / P.canvas.width);
    const rt = new RT(W, H);
    const cache = new Map();
    const matFor = (orig, mode) => {
      const side = orig.side ?? 0, tr = !!orig.transparent;
      const dt = mode === "raw" ? false : orig.depthTest !== false;
      const dw = mode === "raw" ? false : (mode === "mask" ? (!tr && orig.depthWrite !== false) : (orig.depthWrite !== false && !tr));
      const key = mode + side + dt + dw + tr;
      let m = cache.get(key);
      if (!m) {
        m = basic.clone();
        m.color.setRGB(1 / 255, 0, 0); m.side = side; m.opacity = 1; m.fog = false; m.map = null; m.vertexColors = false; m.toneMapped = false;
        m.depthTest = dt; m.depthWrite = dw; m.transparent = tr; m.blending = 2;
        if (mode === "mask") { m.colorWrite = false; m.blending = 0; }
        cache.set(key, m);
      }
      return m;
    };
    const others = [];
    sc.traverse((o) => { if ((o.isLine || o.isPoints || o.isSprite) && o.visible) { others.push(o); o.visible = false; } });
    const meshes = [];
    sc.traverse((o) => { if (o.isMesh) { const m0 = Array.isArray(o.material) ? o.material[0] : o.material; meshes.push({ o, mat: o.material, m0, vis: o.visible, tag: tagOf(o), tr: !!(m0 && m0.transparent) }); } });
    const groups = { "all": () => true, "opaque": (e) => !e.tr, "transparent": (e) => e.tr };
    for (const t of new Set(meshes.map((e) => e.tag))) groups[t] = (e) => e.tag === t;
    const prevRT = r.getRenderTarget(), prevAuto = r.shadowMap.autoUpdate;
    const prevClear = basic.color.clone(); r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    const buf = new Uint8Array(W * H * 4);
    const res = { raw: {}, tested: {} };
    const restore = () => { for (const e of meshes) { e.o.material = e.mat; e.o.visible = e.vis; } };
    r.shadowMap.autoUpdate = false;
    try {
      for (const mode of ["raw", "tested"]) {
        for (const [g, pick] of Object.entries(groups)) {
          for (const e of meshes) {
            if (!e.vis || !e.m0) { e.o.visible = false; continue; }
            if (pick(e)) { e.o.visible = true; e.o.material = matFor(e.m0, mode); }
            else if (mode === "tested" && !e.tr) { e.o.visible = true; e.o.material = matFor(e.m0, "mask"); }
            else e.o.visible = false;
          }
          r.setRenderTarget(rt); r.setClearColor(0x000000, 1); r.clear();
          r.render(sc, cam);
          r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
          let sum = 0, cov = 0, sat = 0;
          for (let i = 0; i < W * H; i++) { const v = buf[i * 4]; sum += v; if (v) cov++; if (v === 255) sat++; }
          res[mode][g] = { coverage: +(cov / (W * H)).toFixed(4), layers: +(sum / (W * H)).toFixed(4), saturated: sat };
          restore();
        }
      }
    } finally {
      restore();
      for (const o of others) o.visible = true;
      r.setRenderTarget(prevRT); r.setClearColor(prevClear, prevAlpha); r.shadowMap.autoUpdate = prevAuto;
      rt.dispose(); for (const m of cache.values()) m.dispose();
    }
    return { W, H, ...res };
  };
})();
