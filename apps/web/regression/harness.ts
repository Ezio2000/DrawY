import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type CDPSession,
  type Page,
  type Route,
} from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import type { Run, Step } from "../../../modules/contracts/index.ts";

/* What the work pages' regression suites share. Each suite checks a work page as AGENTS.md
 * describes it, in a real browser against the real server and materials service (each on
 * a free port, with data in a temporary directory) and the built frontend: run
 * `pnpm build` first (`pnpm test` does). Only the author is not real: a request is answered
 * with a run that has just ended, and the runs the author would make are told to the page
 * as the server tells them, on the channel its events go through. The model menu is shown
 * as connected.
 *
 * The bindings exported here (`page`, `asked` and the rest) are live: each test sees the
 * page made for it. Set DRAWY_CHROMIUM to a Chromium executable where Playwright's own is
 * not installed. */

const root = new URL("../../../", import.meta.url).pathname;
const tsx = join(root, "node_modules/.bin/tsx");
const processes: ChildProcess[] = [];
let data: string;
export let base: string, browser: Browser, context: BrowserContext, userId: string;
export let page: Page;
/** The page's DevTools session, for fingers on the screen. */
export let cdp: CDPSession;
/** The requests the page made to the author, as posted. */
export let asked: { prompt: string; sceneId: string }[];
let errors: string[];

async function freePort() {
  return new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}
async function until(url: string) {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("not up: " + url);
}
function start(args: string[], cwd: string, env: Record<string, string>) {
  const child = spawn(tsx, args, { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
  child.stderr?.on("data", () => {});
  processes.push(child);
}

/** Starts the app for a suite, with the browser as the device it is about. */
export function setup(device: BrowserContextOptions) {
vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  data = mkdtempSync(join(tmpdir(), "drawy-pages-"));
  const materials = await freePort(),
    port = await freePort();
  start(["server.ts"], join(root, "materials"), {
    PORT: String(materials),
    MATERIALS_DATA: join(data, "materials"),
  });
  await until(`http://127.0.0.1:${materials}/health`);
  start(["apps/server/main.ts"], root, {
    PORT: String(port),
    DRAWY_DATA: data,
    DRAWY_MATERIALS_URL: `http://127.0.0.1:${materials}`,
  });
  base = `http://127.0.0.1:${port}`;
  await until(base + "/api/auth/signup");
  browser = await chromium.launch(
    process.env.DRAWY_CHROMIUM ? { executablePath: process.env.DRAWY_CHROMIUM } : {},
  );
  context = await browser.newContext({ locale: "en-US", ...device });
  const me = await context.request.post(base + "/api/auth/register", {
    data: { name: "desk", password: "password123" },
  });
  userId = (await me.json()).id;
  // Parts of the page count how often they are drawn.
  await context.addInitScript(() => ((window as any).__drawyRenders = {}));
  await context.route("**/api/models", async (route) => {
    const menu = await (await route.fetch()).json();
    menu.labels = menu.labels.length
      ? menu.labels.map((l: object) => ({ ...l, ready: true }))
      : [{ id: "default", name: "Default", description: "", ready: true }];
    menu.chosen = { label: menu.labels[0].id };
    await route.fulfill({ json: menu });
  });
}, 120_000);
afterAll(async () => {
  await browser?.close();
  for (const p of processes) p.kill();
  rmSync(data, { recursive: true, force: true });
});
beforeEach(async () => {
  asked = [];
  errors = [];
  page = await context.newPage();
  cdp = await context.newCDPSession(page);
  page.on("pageerror", (e) => errors.push(String(e)));
  // A request is answered with a run that has ended, saying it is done.
  await page.route("**/api/works/*/runs", async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    asked.push(body);
    const workId = route.request().url().split("/works/")[1].split("/")[0];
    await route.fulfill({
      json: run(workId, "r" + asked.length, "completed", [
        { kind: "message", role: "user", text: body.prompt },
        { kind: "message", role: "assistant", text: "Done." },
      ]),
    });
  });
});
afterEach(async () => {
  await page.close();
  expect(errors).toEqual([]);
});
}


export const api = async (path: string, method = "GET", body?: unknown) => {
  const r = await context.request.fetch(base + "/api" + path, { method, data: body });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
};
export function run(workId: string, id: string, status: Run["status"], steps: Step[]): Run {
  return { id, workId, sceneId: "root", status, steps, observations: [], startedAt: Date.now() };
}
export const box = `return api.svg('<svg viewBox="0 0 '+api.width+' '+api.height+'"><rect width="100%" height="100%" fill="#cde"/><text x="20" y="40" font-size="28">'+api.data.label+'</text></svg>')`;
/** A work with two boxes, Alpha and Beta, saved as version 1; and an empty subscene
 * `sub` when asked, or one with a box in it; Alpha leads into it when `leads`. */
export async function make({ sub, leads }: { sub?: "empty" | "drawn"; leads?: boolean } = {}) {
  const w = await api("/works", "POST", { title: "Check" });
  const edited = await api(`/works/${w.id}/edits`, "POST", {
    baseRevision: w.revision,
    edit: {
      drawings: [{ id: "box", name: "Box", source: box }],
      ...(sub ? { scenes: [{ id: "sub", title: "Sub", parentId: "root" }] } : {}),
      modules: [
        {
          id: "a",
          drawingId: "box",
          bounds: [100, 100, 240, 120],
          data: { label: "Alpha" },
          ...(leads ? { target: { kind: "scene", id: "sub" } } : {}),
        },
        { id: "b", drawingId: "box", bounds: [500, 100, 240, 120], data: { label: "Beta" } },
        ...(sub === "drawn"
          ? [{ id: "c", scene: "sub", drawingId: "box", bounds: [0, 0, 200, 100], data: { label: "Gamma" } }]
          : []),
      ],
    },
  });
  expect(edited.revision).toBeGreaterThan(w.revision);
  await api(`/works/${w.id}/save`, "POST");
  return w.id as string;
}
export async function open(id: string) {
  await page.goto(base + "/a/" + id);
  await page.waitForSelector("[data-canvas]");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("*")].some((e) => e.shadowRoot?.textContent?.includes("Alpha")),
  );
  await page.waitForTimeout(500);
}
/** A drawn module by its words: the same element as long as it is not drawn anew. */
export const module = (text: string) =>
  page.evaluate((text) => {
    const el = [...document.querySelectorAll("*")].find(
      (e) => e.shadowRoot?.textContent?.includes(text),
    ) as HTMLElement | undefined;
    if (!el) return undefined;
    el.dataset.mark ??= String(Math.random());
    const r = el.getBoundingClientRect();
    return { mark: el.dataset.mark, left: el.style.left, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
export const count = (text: string) =>
  page.evaluate(
    (text) => [...document.querySelectorAll("*")].filter((e) => e.shadowRoot?.textContent?.includes(text)).length,
    text,
  );
/** How many modules the canvas shows as selected, by their outlines. */
export const outlined = () =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>("[data-canvas] > div")].filter(
        (d) => d.style.borderColor === "rgb(51, 102, 214)" && d.style.display !== "none",
      ).length,
  );
export const statuses = () => page.locator("[role=status]").allInnerTexts();
export const renders = () => page.evaluate(() => ({ ...(window as any).__drawyRenders }) as Record<string, number>);
export const composer = () => page.locator("[data-dock] textarea");
/** Tells the page an event as the server would, through the channel its events take. */
export const tell = (event: unknown) =>
  page.evaluate(
    ([user, event]) => new BroadcastChannel("drawy-events:" + user).postMessage({ event }),
    [userId, event] as const,
  );
export async function editing() {
  await page.getByRole("button", { name: "Edit by hand" }).click();
  await page.waitForTimeout(300);
}
/** Drags a module by 100 by 80 screen pixels. */
export async function drag(text: string) {
  const at = (await module(text))!;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 50, at.y + 40, { steps: 5 });
  await page.mouse.move(at.x + 100, at.y + 80, { steps: 5 });
  await page.mouse.up();
}
export const settled = () => page.waitForTimeout(1200);


type At = { x: number; y: number };
const touchPoints = (points: At[]) => points.map((p, id) => ({ x: p.x, y: p.y, id }));
/** Fingers on the glass, through the browser's own touch input: each step lists where every
 * finger is, and an empty step lifts them all. */
export async function fingers(steps: At[][], pause = 16) {
  let down = 0;
  for (const points of steps) {
    const type = !points.length ? "touchEnd" : points.length > down ? "touchStart" : "touchMove";
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: touchPoints(points) });
    down = points.length;
    await new Promise((r) => setTimeout(r, pause));
  }
}
/** One finger drawn from a point to another. */
export async function swipe(from: At, to: At, steps = 12) {
  const path: At[][] = [[from]];
  for (let i = 1; i <= steps; i++)
    path.push([{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
  await fingers([...path, []]);
}
/** Two fingers spread apart (or closed) about a point, from one distance to another. */
export async function pinch(at: At, from: number, to: number, steps = 12) {
  const path: At[][] = [];
  for (let i = 0; i <= steps; i++) {
    const half = (from + ((to - from) * i) / steps) / 2;
    path.push([
      { x: at.x - half, y: at.y },
      { x: at.x + half, y: at.y },
    ]);
  }
  await fingers([[path[0][0]], ...path, []]);
}
/** A finger held still on a point for a while. */
export async function press(at: At, ms = 700) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoints([at]) });
  await new Promise((r) => setTimeout(r, ms));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
/** A tap, or two in quick succession. */
export async function tap(at: At, times = 1) {
  for (let i = 0; i < times; i++) {
    await fingers([[at], []], 30);
    await new Promise((r) => setTimeout(r, 60));
  }
}
/** Where a drawn module is on screen now, by its words. */
export const rectOf = (text: string) =>
  page.evaluate((text) => {
    const el = [...document.querySelectorAll("*")].find(
      (e) => e.shadowRoot?.textContent?.includes(text),
    );
    const r = el!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, text);

/** Where a module's words are laid out and where their ink actually lands on screen, in
 * CSS pixels. Layout alone cannot tell a drawing that is painted wrong (text at a stale
 * size, or clipped): this looks at the pixels. The screen is taken first, because asking
 * the page where things are (a hit test above all) can lay the text out again and hide
 * what the person would see. The words must be dark on a light drawing, as in `box`, and
 * not covered by the page. */
export async function inkOf(text: string) {
  const png = (await page.screenshot({ scale: "css" })).toString("base64");
  const laid = await page.evaluate((text) => {
    const host = [...document.querySelectorAll("*")].find(
      (e) => e.shadowRoot?.textContent?.includes(text),
    ) as HTMLElement;
    const words = [...host.shadowRoot!.querySelectorAll("text")].find((t) => t.textContent?.includes(text))!;
    const rect = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    const at = words.getBoundingClientRect();
    const seen = [
      [at.left + 1, at.top + 1],
      [at.right - 1, at.bottom - 1],
    ].every(([x, y]) => {
      const top = document.elementFromPoint(x, y);
      return top === host || host.contains(top);
    });
    return { words: rect(at), host: rect(host.getBoundingClientRect()), seen };
  }, text);
  expect(laid.seen, `the words "${text}" are covered or off screen`).toBe(true);
  // The dark pixels' extent within the module, read back in the page from the screen.
  const ink = await page.evaluate(
    async ({ png, host }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + png;
      await image.decode();
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      const g = c.getContext("2d")!;
      g.drawImage(image, 0, 0);
      const x0 = Math.max(0, Math.floor(host.x)),
        y0 = Math.max(0, Math.floor(host.y)),
        x1 = Math.min(c.width, Math.ceil(host.x + host.width)),
        y1 = Math.min(c.height, Math.ceil(host.y + host.height));
      const { data } = g.getImageData(0, 0, c.width, c.height);
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (let py = y0; py < y1; py++)
        for (let px = x0; px < x1; px++) {
          const i = (py * c.width + px) * 4;
          const [r, gr, b] = [data[i], data[i + 1], data[i + 2]];
          // Dark and grey, as words are; not the blue of a selection.
          if (r * 0.3 + gr * 0.59 + b * 0.11 > 110 || Math.max(r, gr, b) - Math.min(r, gr, b) > 48) continue;
          left = Math.min(left, px);
          right = Math.max(right, px + 1);
          top = Math.min(top, py);
          bottom = Math.max(bottom, py + 1);
        }
      return right < left ? null : { x: left, y: top, width: right - left, height: bottom - top };
    },
    { png, host: laid.host },
  );
  return { laid: laid.words, ink };
}
/** Expects the words to be painted where and as large as they are laid out: their ink
 * inside the box layout gives them (a pixel or two either way) and filling most of its
 * width. Text painted larger spills out of it, and text clipped leaves part of it bare. */
export async function paintedAsLaidOut(text: string) {
  const { laid, ink } = await inkOf(text);
  const where = `"${text}" laid out at ${JSON.stringify(laid)}, inked at ${JSON.stringify(ink)}`;
  expect(ink, where).not.toBeNull();
  const slack = 2;
  expect(ink!.x, where).toBeGreaterThanOrEqual(laid.x - slack);
  expect(ink!.y, where).toBeGreaterThanOrEqual(laid.y - slack);
  expect(ink!.x + ink!.width, where).toBeLessThanOrEqual(laid.x + laid.width + slack);
  expect(ink!.y + ink!.height, where).toBeLessThanOrEqual(laid.y + laid.height + slack);
  expect(ink!.width, where).toBeGreaterThan(laid.width * 0.75);
  expect(ink!.height, where).toBeGreaterThan(laid.height * 0.4);
}
