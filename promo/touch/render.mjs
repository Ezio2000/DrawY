// Renders 《请勿触摸》 frame by frame. Serves this folder (so the page reaches its fonts),
// opens the timeline in headless Chromium, asks for render(t) at each frame and captures it.
//
//   node render.mjs stills 4.7 12.3             → out/stills/t-4.700.png …
//   node render.mjs cues                        → out/cues.json
//   node render.mjs frames [fps] [workers]      → out/frames/00000.jpg …
//   node render.mjs lab cover                   → out/lab/cover.png (one painting on its own)
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)("playwright");
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.join(here, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(here) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/src`;

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"] });
async function open(url) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && console.error("console:", m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  return page;
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const [mode = "stills", ...rest] = process.argv.slice(2);
if (mode === "lab") {
  const dir = path.join(out, "lab");
  fs.mkdirSync(dir, { recursive: true });
  for (const what of rest) {
    const page = await open(`${base}/lab.html?what=${what}`);
    await settle(page);
    await page.screenshot({ path: path.join(dir, `${what}.png`) });
    console.log(path.join(dir, `${what}.png`));
    await page.close();
  }
} else if (mode === "stills") {
  const dir = path.join(out, "stills");
  fs.mkdirSync(dir, { recursive: true });
  const page = await open(`${base}/index.html?still`);
  for (const s of rest) {
    const t = parseFloat(s);
    await page.evaluate((t) => window.__render(t), t);
    await settle(page);
    const f = path.join(dir, `t-${t.toFixed(3)}.png`);
    await page.screenshot({ path: f });
    console.log(f);
  }
} else if (mode === "cues") {
  const page = await open(`${base}/index.html?still`);
  const cues = await page.evaluate(() => window.__cues);
  fs.writeFileSync(path.join(out, "cues.json"), JSON.stringify(cues, null, 1));
  console.log(cues.length, "cues");
} else if (mode === "frames") {
  const fps = parseInt(rest[0] || "60"),
    workers = parseInt(rest[1] || "4");
  const only = rest[2] ? rest[2].split("-").map(Number) : null;
  const dir = path.join(out, "frames");
  fs.mkdirSync(dir, { recursive: true });
  const probe = await open(`${base}/index.html?still`);
  const duration = await probe.evaluate(() => window.__duration);
  fs.writeFileSync(path.join(out, "cues.json"), JSON.stringify(await probe.evaluate(() => window.__cues), null, 1));
  await probe.close();
  const total = Math.round(duration * fps);
  const [a, b] = only ? [Math.round(only[0] * fps), Math.round(only[1] * fps)] : [0, total];
  const n = b - a,
    started = Date.now();
  let done = 0;
  await Promise.all(
    Array.from({ length: workers }, async (_, w) => {
      const page = await open(`${base}/index.html?still`);
      const lo = a + Math.floor((n * w) / workers),
        hi = a + Math.floor((n * (w + 1)) / workers);
      for (let i = lo; i < hi; i++) {
        await page.evaluate((t) => window.__render(t), i / fps);
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
