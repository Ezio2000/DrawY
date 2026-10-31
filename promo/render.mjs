// Renders the film frame by frame. Serves the repository (so the page can reach the seed
// materials and the fonts), opens the timeline in headless Chromium, asks for render(t) at
// each frame and captures it.
//
//   node render.mjs stills 0 5.5 12            → out/stills/t-0.000.png …
//   node render.mjs cues                        → out/cues.json
//   node render.mjs frames [fps] [workers]      → out/frames/00000.jpg …
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// the pre-installed Playwright, which ESM resolution alone does not find
const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(here, "..");
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "max-age=3600" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/promo/src/index.html?still`;

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"] });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return page;
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const [mode = "stills", ...rest] = process.argv.slice(2);
if (mode === "stills") {
  const dir = path.join(out, "stills");
  fs.mkdirSync(dir, { recursive: true });
  const page = await openPage();
  for (const s of rest) {
    const t = parseFloat(s);
    await page.evaluate((t) => window.__render(t), t);
    await settle(page);
    const f = path.join(dir, `t-${t.toFixed(3)}.png`);
    await page.screenshot({ path: f });
    console.log(f);
  }
} else if (mode === "cues") {
  const page = await openPage();
  const cues = await page.evaluate(() => window.__cues);
  fs.writeFileSync(path.join(out, "cues.json"), JSON.stringify(cues, null, 1));
  console.log(cues.length, "cues");
} else if (mode === "frames") {
  const fps = parseInt(rest[0] || "30");
  const workers = parseInt(rest[1] || "4");
  const only = rest[2] ? rest[2].split("-").map(Number) : null;
  const dir = path.join(out, "frames");
  fs.mkdirSync(dir, { recursive: true });
  const probe = await openPage();
  const duration = await probe.evaluate(() => window.__duration);
  fs.writeFileSync(path.join(out, "cues.json"), JSON.stringify(await probe.evaluate(() => window.__cues), null, 1));
  await probe.close();
  const total = Math.round(duration * fps);
  const [a, b] = only ? [Math.round(only[0] * fps), Math.round(only[1] * fps)] : [0, total];
  const n = b - a;
  const started = Date.now();
  let done = 0;
  await Promise.all(
    Array.from({ length: workers }, async (_, w) => {
      const page = await openPage();
      // contiguous chunks keep each page's state close to the frame before
      const lo = a + Math.floor((n * w) / workers),
        hi = a + Math.floor((n * (w + 1)) / workers);
      for (let i = lo; i < hi; i++) {
        const t = i / fps;
        await page.evaluate((t) => window.__render(t), t);
        await settle(page);
        await page.screenshot({ path: path.join(dir, String(i).padStart(5, "0") + ".jpg"), type: "jpeg", quality: 94 });
        if (++done % 60 === 0) {
          const el = (Date.now() - started) / 1000;
          console.log(`${done}/${n} frames · ${(done / el).toFixed(1)} fps · eta ${Math.round(((n - done) * el) / done)}s`);
        }
      }
      await page.close();
    }),
  );
  console.log("frames done in", Math.round((Date.now() - started) / 1000), "s");
}
await browser.close();
server.close();
