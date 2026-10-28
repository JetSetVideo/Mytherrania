import { serveAsset } from "../tools/serve.ts";

Deno.test("server exposes only bundled assets and never source or traversal", async () => {
  const root = await Deno.makeTempDir({ dir: "artifacts", prefix: "server-test-" });
  try {
    await Deno.writeTextFile(`${root}/index.html`, "<title>Mytherrania</title>");
    const ok = await serveAsset(new Request("http://localhost/"), root);
    if (ok.status !== 200 || !(await ok.text()).includes("Mytherrania")) {
      throw Error("index missing");
    }
    if (!ok.headers.get("Content-Security-Policy")?.includes("default-src 'self'")) {
      throw Error("CSP missing");
    }
    for (const path of ["/deno.json", "/src/engine/Engine.ts", "/%2e%2e/deno.json", "/unknown"]) {
      const response = await serveAsset(new Request(`http://localhost${path}`), root);
      if (response.status !== 404) throw Error(`exposed ${path}`);
    }
    const post = await serveAsset(new Request("http://localhost/", { method: "POST" }), root);
    if (post.status !== 405) throw Error("POST accepted");
    const missing = await serveAsset(new Request("http://localhost/app.js"), root);
    if (missing.status !== 404) throw Error("missing asset not 404");
    const head = await serveAsset(new Request("http://localhost/", { method: "HEAD" }), root);
    if (head.status !== 200 || await head.text() !== "") throw Error("HEAD body");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
