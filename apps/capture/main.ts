import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { chromium } from "playwright";
import { capture } from "../../modules/observation/capture.ts";
const app = new Hono();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
app.get("/health", (c) => c.json({ ok: browser.isConnected() }));
app.post("/capture", async (c) =>
  c.json({ shots: await capture(browser, await c.req.json()) }),
);
serve({ fetch: app.fetch, port: 8091, hostname: "0.0.0.0" });
process.on("SIGTERM", async () => {
  await browser.close();
  process.exit(0);
});
