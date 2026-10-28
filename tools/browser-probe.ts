// Test-only browser probe installed before app boot; no instrumentation in shipped bundle.
export function installProbe() {
  const state = {
    cpu: [] as number[],
    gpu: [] as number[],
    raf: [] as number[],
    errors: [] as string[],
    renderer: "unknown",
    gpuSupported: false,
    lcpMs: 0,
    cls: 0,
    lastRaf: 0,
    disjoint: 0,
  };
  Object.assign(globalThis, {
    __PROBE__: state,
    __RESET_PROBE__: () => {
      for (const query of pending) gl?.deleteQuery(query);
      pending.length = 0;
      state.cpu.length = 0;
      state.gpu.length = 0;
      state.raf.length = 0;
      state.lastRaf = 0;
      state.disjoint = 0;
    },
  });
  addEventListener("error", (event) => state.errors.push(event.message));
  addEventListener("unhandledrejection", (event) => state.errors.push(String(event.reason)));
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) state.lcpMs = entry.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
      if (!shift.hadRecentInput) state.cls += shift.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
  type Timer = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
  let gl: WebGL2RenderingContext | null = null;
  let ext: Timer | null = null;
  const pending: WebGLQuery[] = [];
  const nativeContext = HTMLCanvasElement.prototype.getContext;
  // Canvas overloads cannot express forwarding an arbitrary overload; runtime arguments unchanged.
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
    const result = Reflect.apply(nativeContext, this, args);
    if (args[0] === "webgl2" && result) {
      gl = result as WebGL2RenderingContext;
      ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      state.gpuSupported = !!ext;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      state.renderer = debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : String(gl.getParameter(gl.RENDERER));
    }
    return result;
  } as typeof nativeContext;
  const raf = requestAnimationFrame.bind(globalThis);
  function sample(array: number[], value: number) {
    if (array.length < 2400) array.push(value);
  }
  globalThis.requestAnimationFrame = (callback) =>
    raf((timestamp) => {
      if (state.lastRaf) sample(state.raf, timestamp - state.lastRaf);
      state.lastRaf = timestamp;
      if (gl && ext) {
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
          state.disjoint++;
          for (const query of pending) gl.deleteQuery(query);
          pending.length = 0;
        } else {
          while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
            const query = pending.shift()!;
            sample(state.gpu, gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(query);
          }
        }
      }
      const query = gl && ext && pending.length < 8 ? gl.createQuery() : null;
      if (query) gl!.beginQuery(ext!.TIME_ELAPSED_EXT, query);
      const start = performance.now();
      try {
        callback(timestamp);
      } finally {
        sample(state.cpu, performance.now() - start);
        if (query) {
          gl!.endQuery(ext!.TIME_ELAPSED_EXT);
          pending.push(query);
        }
      }
    });
}
