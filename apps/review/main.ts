import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { chromium } from "playwright";
import { capture } from "../../modules/review/capture.ts";
const app = new Hono();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
app.get("/health", (c) => c.json({ ok: browser.isConnected() }));
app.post("/capture", async (c) =>
  c.json({ shots: await capture(browser, await c.req.json()) }),
);
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
