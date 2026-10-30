import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { chromium } from "playwright";
const app = new Hono();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
app.get("/health", (c) => c.json({ ok: browser.isConnected() }));
app.post("/capture", async (c) => {
  const { pages, cookie, origin } = (await c.req.json()) as {
    pages: { id: string; url: string; selectors: string[] }[];
    cookie: string;
    origin: string;
  };
  const context = await browser.newContext();
  await context.addCookies([
    { name: "drawy_session", value: cookie, url: origin },
  ]);
  const shots: {
    pageId: string;
    label: string;
    base64: string;
    errors: string[];
  }[] = [];
  try {
    for (const info of pages)
      for (const width of [1440, 390]) {
        const page = await context.newPage();
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(info.url, { waitUntil: "load" });
        try {
          await page.waitForFunction(
            () => window.drawyReady,
            {},
            { timeout: 30000 },
          );
        } catch {
          errors.push("页面未在 30 秒内完成渲染");
        }
        errors.push(...(await page.evaluate(() => window.drawyErrors || [])));
        const height = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        for (let y = 0; y < height; y += 900) {
          await page.evaluate((y) => scrollTo(0, y), y);
          shots.push({
            pageId: info.id,
            label: `${width}px / ${y}`,
            base64: Buffer.from(await page.screenshot()).toString("base64"),
            errors,
          });
        }
        for (const selector of info.selectors) {
          await page.locator(selector).click({ timeout: 5000 });
          await page.waitForLoadState("load");
          await page.waitForFunction(
            () => window.drawyReady,
            {},
            { timeout: 30000 },
          );
          await page.evaluate(async () => {
            await Promise.all(window.drawy.pending);
            await document.fonts.ready;
          });
          shots.push({
            pageId: decodeURIComponent(
              new URL(page.url()).pathname.split("/").at(-1)!,
            ),
            label: `${width}px / ${selector}`,
            base64: Buffer.from(await page.screenshot()).toString("base64"),
            errors,
          });
        }
        await page.close();
      }
    return c.json({ shots });
  } finally {
    await context.close();
  }
});
app.post("/crop", async (c) => {
  const { base64, x, y, width, height } = await c.req.json();
  const page = await browser.newPage();
  try {
    await page.setContent("<canvas></canvas>");
    const cropped = await page.evaluate(
      async ({ base64, x, y, width, height }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const canvas = document.querySelector("canvas")!;
        canvas.width = width;
        canvas.height = height;
        canvas
          .getContext("2d")!
          .drawImage(image, x, y, width, height, 0, 0, width, height);
        return canvas.toDataURL().split(",")[1];
      },
      { base64, x, y, width, height },
    );
    return c.json({ base64: cropped });
  } finally {
    await page.close();
  }
});
serve({ fetch: app.fetch, port: 8091, hostname: "0.0.0.0" });
process.on("SIGTERM", async () => {
  await browser.close();
  process.exit(0);
});
