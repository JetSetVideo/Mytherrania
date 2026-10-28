// QA screenshot tool: captures all screens for visual critique
import { chromium } from "playwright";

const OUT = "artifacts/qa";
const URL = "http://127.0.0.1:8788/";

await Deno.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

console.log("1. Navigating to game...");
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// Screenshot 1: Title screen
console.log("2. Title screen...");
await page.screenshot({ path: `${OUT}/01-title-screen.png`, fullPage: false });
console.log("   -> 01-title-screen.png");

// Click Fight to enter character creator
console.log("3. Clicking Fight -> character creator...");
await page.click('[data-action="start"]');
await page.waitForTimeout(800);

// Screenshot 2: Race selection (character creator)
console.log("4. Race selection screen...");
await page.screenshot({ path: `${OUT}/02-race-selection.png`, fullPage: false });
console.log("   -> 02-race-selection.png");

// Click Ork race card
console.log("5. Clicking Ork race card...");
const orkCard = page.locator('[data-race="ork"]');
await orkCard.click();
await page.waitForTimeout(500);

// Screenshot 3: Ork race detail
console.log("6. Ork race detail...");
await page.screenshot({ path: `${OUT}/03-ork-race-detail.png`, fullPage: false });
console.log("   -> 03-ork-race-detail.png");

// Click Enter the ring
console.log("7. Clicking Enter the ring...");
await page.click('[data-action="begin"]');
await page.waitForTimeout(3000); // Wait for fight to start

// Open settings dialog to access camera select
console.log("8. Opening settings dialog...");
await page.keyboard.press("Escape"); // Usually opens settings
await page.waitForTimeout(500);

// Check if settings dialog is visible; if not, try clicking the gear
const settingsVisible = await page.evaluate(() => {
  return !!document.querySelector("#settings-dlg") && 
    (document.querySelector("#settings-dlg") as HTMLElement).style.display !== "none";
});

if (!settingsVisible) {
  console.log("   Settings not opened via Escape, trying gear button...");
  // Try clicking any settings gear icon
  const gearBtn = page.locator('[title="Settings"], .settings-btn, #btn-settings');
  if (await gearBtn.count() > 0) {
    await gearBtn.first().click();
    await page.waitForTimeout(500);
  }
}

// Screenshot 4: Third-person (default camera)
console.log("9. Third-person camera...");
await page.screenshot({ path: `${OUT}/04-fight-third-person.png`, fullPage: false });
console.log("   -> 04-fight-third-person.png");

// Switch cameras
const cameraModes = ["close", "isometric", "birds-eye"] as const;
const modeLabels: Record<string, string> = {
  "close": "Close-up",
  "isometric": "Isometric",
  "birds-eye": "Birds-eye",
};

for (const mode of cameraModes) {
  console.log(`10. Switching to ${modeLabels[mode]} camera...`);
  try {
    await page.evaluate((m) => {
      const sel = document.querySelector("#sel-camera") as HTMLSelectElement;
      if (sel) { sel.value = m; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    }, mode);
    await page.waitForTimeout(600);
  } catch (e) {
    console.log(`   Warning: camera switch to ${mode} failed: ${e}`);
  }
  await page.screenshot({ 
    path: `${OUT}/05-fight-${mode}.png`, 
    fullPage: false 
  });
  console.log(`   -> 05-fight-${mode}.png`);
}

// First-person (V key) - switch back to third first, then toggle
console.log("11. First-person (V key)...");
await page.evaluate(() => {
  const sel = document.querySelector("#sel-camera") as HTMLSelectElement;
  if (sel) { sel.value = "third"; sel.dispatchEvent(new Event("change", { bubbles: true })); }
});
await page.waitForTimeout(300);
await page.keyboard.press("v");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-fight-first-person.png`, fullPage: false });
console.log("   -> 06-fight-first-person.png");

// Wait for fight to end (approximately 15-20 seconds max)
console.log("12. Waiting for fight to end...");
// Try to detect victory screen or wait max time
let victoryFound = false;
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(1000);
  const hasVictory = await page.evaluate(() => {
    const v = document.querySelector('[data-screen="victory"]');
    return v && (v as HTMLElement).classList.contains("active");
  });
  if (hasVictory) {
    victoryFound = true;
    console.log("   Victory screen detected!");
    break;
  }
}

if (victoryFound) {
  console.log("13. Victory screen...");
  await page.screenshot({ path: `${OUT}/07-victory-screen.png`, fullPage: false });
  console.log("   -> 07-victory-screen.png");
  
  // Click Menu to go back
  await page.click('[data-action="menu"]');
  await page.waitForTimeout(500);
} else {
  console.log("   Fight may still be ongoing, pressing Escape to force menu...");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
}

// Go to digest
console.log("14. Digest page...");
// First make sure menu is showing
const menuVisible = await page.evaluate(() => {
  const m = document.querySelector("#menu") as HTMLElement;
  return m && m.style.display !== "none";
});

if (!menuVisible) {
  console.log("   Menu not visible, reloading...");
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
}

// Click Digest
const digestBtn = page.locator('[data-action="digest"]');
if (await digestBtn.count() > 0) {
  await digestBtn.first().click();
  await page.waitForTimeout(800);
} else {
  console.log("   Digest button not found on title, trying from menu...");
}

// Screenshot digest
await page.screenshot({ path: `${OUT}/08-digest.png`, fullPage: false });
console.log("   -> 08-digest.png");

// Also capture a fight mid-action with third-person for better coverage
console.log("15. Starting another fight for mid-action capture...");
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.click('[data-action="start"]');
await page.waitForTimeout(500);
await page.click('[data-action="begin"]');
await page.waitForTimeout(2000);
// Ensure third-person
await page.evaluate(() => {
  const sel = document.querySelector("#sel-camera") as HTMLSelectElement;
  if (sel) { sel.value = "third"; sel.dispatchEvent(new Event("change", { bubbles: true })); }
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/09-fight-mid-action.png`, fullPage: false });
console.log("   -> 09-fight-mid-action.png");

await browser.close();
console.log("\nDone! All screenshots saved to artifacts/qa/");