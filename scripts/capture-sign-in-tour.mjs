// Takes the sign-in tour's screenshots from the UI previews (#/mocks) and saves them as WebP images
// in apps/client/src/online/tour/. Run it against `pnpm web:dev` (or the live site) whenever a screen
// in the tour visibly changes:
//
//   node scripts/capture-sign-in-tour.mjs [base-url]
//
// The base URL defaults to http://localhost:5173/. Playwright is not a project dependency: install it
// anywhere and point PLAYWRIGHT_MODULE at it (for example ~/.npm/_npx/<id>/node_modules/playwright), and
// set CHROMIUM_PATH if Playwright's own browser is not installed.
import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "apps/client/src/online/tour");
const baseUrl = (process.argv[2] ?? "http://localhost:5173/").replace(/\/?$/, "/");

/** Each slide: its file name, the preview it is taken from, and anything to click first. Keep in step with tour.ts. */
const slides = [
  { file: "hints", mock: 18, prepare: async (page) => {
    await page.getByRole("switch", { name: /hints/i }).or(page.getByRole("button", { name: /hints/i })).first().click();
    await page.locator("button.seat-auction-call").first().click();
  } },
  { file: "declaring", mock: 19 },
  // Preview 22 opens on the claim dialog after a finished trick: close it, then lay the last trick out.
  { file: "last-trick", mock: 22, prepare: async (page) => {
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.locator(".last-trick-button").click();
  } },
  { file: "auto-play", mock: 21 },
  { file: "result", mock: 26 },
  { file: "replay", mock: 32 },
  { file: "lobby", mock: 1 }
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
await mkdir(outputDir, { recursive: true });
for (const slide of slides) {
  await page.goto(`${baseUrl}#/mocks/${slide.mock}`);
  await page.reload();
  await page.waitForTimeout(1500);
  const hide = page.getByRole("button", { name: "Hide preview controls" });
  if (await hide.count()) await hide.click();
  await page.addStyleTag({ content: ".preview-reveal { display: none !important; }" });
  if (slide.prepare) await slide.prepare(page);
  await page.waitForTimeout(800);
  const png = (await page.screenshot()).toString("base64");
  // Chromium encodes the WebP itself, so no image tools are needed.
  const webp = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.8).split(",")[1];
  }, png);
  const target = path.join(outputDir, `${slide.file}.webp`);
  await writeFile(target, Buffer.from(webp, "base64"));
  console.log(`#/mocks/${slide.mock} -> ${path.relative(projectRoot, target)}`);
}
await browser.close();
