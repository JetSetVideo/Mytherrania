await Deno.mkdir("dist", { recursive: true });
const result = await new Deno.Command(Deno.execPath(), {
  args: [
    "bundle",
    "--platform=browser",
    "--format=esm",
    "--minify",
    "--keep-names",
    "--sourcemap=linked",
    "--output=dist/app.js",
    "main.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!result.success) Deno.exit(result.code);
await Promise.all([
  Deno.copyFile("index.html", "dist/index.html"),
  Deno.copyFile("styles.css", "dist/styles.css"),
]);
const js = await Deno.readTextFile("dist/app.js");
if (/\bfrom\s*["']https?:/.test(js)) throw Error("Runtime remote import in bundle");
console.log(
  `Built local browser bundle: ${
    (await Deno.stat("dist/app.js")).size
  } bytes. Static from-URL check passed; runtime network isolation requires browser verification.`,
);
