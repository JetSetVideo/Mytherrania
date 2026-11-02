// Wave X: BUILD_OUT lets parallel lanes build into their own folder (default dist/).
const OUT = Deno.env.get("BUILD_OUT") || "dist";
await Deno.mkdir(OUT, { recursive: true });
const result = await new Deno.Command(Deno.execPath(), {
  args: [
    "bundle",
    "--platform=browser",
    "--format=esm",
    "--minify",
    "--keep-names",
    "--sourcemap=linked",
    `--output=${OUT}/app.js`,
    "main.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!result.success) Deno.exit(result.code);
await Promise.all([
  Deno.copyFile("index.html", `${OUT}/index.html`),
  Deno.copyFile("styles.css", `${OUT}/styles.css`),
]);
const js = await Deno.readTextFile(`${OUT}/app.js`);
if (/\bfrom\s*["']https?:/.test(js)) throw Error("Runtime remote import in bundle");
console.log(
  `Built local browser bundle: ${
    (await Deno.stat(`${OUT}/app.js`)).size
  } bytes. Static from-URL check passed; runtime network isolation requires browser verification.`,
);
