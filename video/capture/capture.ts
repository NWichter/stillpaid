// Records both demo flows in a real browser with the throwaway demo wallet.
//   BASE=http://localhost:4050 npm run capture
// Writes public/clips/{freelancer,client}.webm and src/clips.json (event times in seconds).
import { chromium, type Page } from "playwright";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = (process.env.BASE ?? "http://localhost:4050").replace(/\/+$/, "");
const SIZE = { width: 1440, height: 900 };
const OUT = resolve("public/clips");
mkdirSync(OUT, { recursive: true });

const CURSOR = `
addEventListener("DOMContentLoaded", () => {
  const c = document.createElement("div");
  c.id = "__cursor";
  c.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(22,23,27,.28);border:2px solid #16171b;z-index:99999;pointer-events:none;transition:transform .12s";
  document.body.appendChild(c);
  addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; });
  addEventListener("mousedown", () => { c.style.transform = "scale(.7)"; });
  addEventListener("mouseup", () => { c.style.transform = ""; });
});`;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function click(page: Page, selector: string) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.evaluate((n) =>
    n.scrollIntoView({ behavior: "smooth", block: "center" }),
  );
  await pause(700);
  const box = await el.boundingBox();
  if (!box) throw new Error(`not visible: ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 25,
  });
  await pause(250);
  await page.mouse.down();
  await pause(90);
  await page.mouse.up();
}

async function type(page: Page, selector: string, text: string) {
  await click(page, selector);
  await page.locator(selector).first().fill("");
  await page.keyboard.type(text, { delay: 35 });
}

async function record(
  name: string,
  flow: (page: Page, mark: (k: string) => void) => Promise<void>,
) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: OUT, size: SIZE },
    colorScheme: "light",
  });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const t0 = Date.now();
  const marks: Record<string, number> = {};
  const mark = (k: string) => {
    marks[k] = +((Date.now() - t0) / 1000).toFixed(2);
    console.log(`${name}: ${k} @ ${marks[k]} s`);
  };
  try {
    await flow(page, mark);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) renameSync(await video.path(), resolve(OUT, `${name}.webm`));
  }
  return marks;
}

const freelancer = await record("freelancer", async (page, mark) => {
  await page.goto(`${BASE}/demo`);
  mark("demo");
  await pause(3500);
  await click(page, "#demo-freelancer");
  await page.waitForURL(/\/j\//, { timeout: 60_000 });
  mark("hired");
  await pause(2500);
  await click(page, "[data-act=accept]");
  await page.locator("[data-act=submit]").waitFor({ timeout: 60_000 });
  mark("accepted");
  await pause(1500);
  await click(page, "[data-act=submit]");
  await page.locator(".clock").first().waitFor({ timeout: 60_000 });
  mark("submitted");
  await page.getByText("Silent Yes: paid").waitFor({ timeout: 240_000 });
  mark("paid");
  await pause(1500);
  await click(page, "details.activity summary");
  await pause(3500);
  mark("end");
});

const client = await record("client", async (page, mark) => {
  await page.goto(`${BASE}/demo`);
  mark("demo");
  await pause(2700);
  await click(page, "#demo-client");
  await page.waitForURL(/\/new/, { timeout: 60_000 });
  mark("form");
  await pause(2500);
  await click(page, "#create-btn");
  await page.waitForURL(/\/j\//, { timeout: 60_000 });
  mark("created");
  await page.locator("[data-act=approve]").waitFor({ timeout: 90_000 });
  mark("delivered");
  await pause(2000);
  await type(page, "#t-revision-0", "Please add the opening hours.");
  await click(page, "[data-act=revision]");
  await page.getByText("Delivery (version 2)").waitFor({ timeout: 90_000 });
  mark("v2");
  await pause(2000);
  await type(page, "#t-dispute-0", "Opening hours are still missing.");
  await click(page, "[data-act=dispute]");
  await page.locator("[data-act=acceptSplit]").waitFor({ timeout: 90_000 });
  mark("offer");
  await pause(2000);
  await click(page, "[data-act=acceptSplit]");
  await page.getByText("Split agreed").first().waitFor({ timeout: 60_000 });
  mark("settled");
  await pause(3500);
  mark("end");
});

writeFileSync(
  resolve("src/clips.json"),
  JSON.stringify({ fps: 25, freelancer, client }, null, 2) + "\n",
);
console.log("clips written to public/clips, marks to src/clips.json");
