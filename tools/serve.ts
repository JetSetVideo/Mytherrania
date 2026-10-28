const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/app.js.map", ["app.js.map", "application/json"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

export async function serveAsset(request: Request, root = "dist"): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const asset = assets.get(new URL(request.url).pathname);
  if (!asset) return new Response("Not found", { status: 404 });
  try {
    const body = await Deno.readFile(`${root}/${asset[0]}`);
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "Content-Type": asset[1],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return new Response("Not found", { status: 404 });
    console.error("Static asset read failed", error);
    return new Response("Asset unavailable", { status: 500 });
  }
}

if (import.meta.main) {
  Deno.serve({ hostname: "127.0.0.1", port: 8788 }, (request) => serveAsset(request));
}
