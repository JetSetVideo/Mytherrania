// Measures the cast shadow in a screenshot, independently of any vision model.
// The PNG is decoded in a headless browser (canvas) and the dark, low-saturation
// pixels that are clearly darker than the arena floor are counted and bounded.
//   deno run -A tools/measure-shadow.ts <png> [png...]
import { chromium } from "playwright";

const files = Deno.args;
if (files.length === 0) {
  console.error("usage: deno run -A tools/measure-shadow.ts <png> [png...]");
  Deno.exit(1);
}

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage();

for (const file of files) {
  const bytes = await Deno.readFile(file);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const dataUrl = `data:image/png;base64,${btoa(bin)}`;
  const stats = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const isFloor = (r: number, g: number, b: number) => {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return lum > 120 && r > g && g > b; // the tan arena floor
    };
    let dark = 0, total = 0, shadow = 0, floorPx = 0;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    // Only count a dark pixel as SHADOW when arena floor is near it, so the walls,
    // the valley and the black outlines do not pollute the measurement.
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        total++;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (!(lum > 12 && lum < 80 && (mx - mn) < 45)) continue;
        dark++;
        let nearFloor = false;
        for (let dy = -24; dy <= 24 && !nearFloor; dy += 6) {
          for (let dx = -24; dx <= 24; dx += 6) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= c.width || ny >= c.height) continue;
            const j = (ny * c.width + nx) * 4;
            if (isFloor(d[j], d[j + 1], d[j + 2])) { nearFloor = true; break; }
          }
        }
        if (!nearFloor) continue;
        shadow++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        if (isFloor(d[i], d[i + 1], d[i + 2])) floorPx++;
      }
    }
    return { w: c.width, h: c.height, dark, shadow, floorPx, total, minX, minY, maxX, maxY };
  }, dataUrl);
  const shadowPct = (100 * stats.shadow / stats.total).toFixed(3);
  const perFloor = stats.floorPx ? (100 * stats.shadow / stats.floorPx).toFixed(1) : "n/a";
  const spanX = stats.maxX - stats.minX, spanY = stats.maxY - stats.minY;
  console.log(`${file.split("/").pop()!.padEnd(24)} shadow=${shadowPct}% of frame  ${perFloor}% of floor px  bbox span ${spanX}x${spanY}`);
}

await browser.close();
