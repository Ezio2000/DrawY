import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { chromium } from "playwright";
import { capture, render } from "../../modules/observation/capture.ts";
const app = new Hono();
const executablePath = process.env.DRAWY_CHROMIUM || process.env.CHROME_EXECUTABLE;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(executablePath ? { executablePath } : {}),
});
app.get("/health", (c) => c.json({ ok: browser.isConnected() }));
app.post("/capture", async (c) =>
  c.json({ shots: await capture(browser, await c.req.json()) }),
);
app.post("/render", async (c) => {
  const request = await c.req.json();
  return c.body(new Uint8Array(await render(browser, request)), 200, {
    "Content-Type": request.format === "pdf" ? "application/pdf" : "image/png",
  });
});
serve({ fetch: app.fetch, port: 8091, hostname: "0.0.0.0" });
process.on("SIGTERM", async () => {
  await browser.close();
  process.exit(0);
});
