import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Run, Step } from "../../../modules/contracts/index.ts";

/* The desktop work page as AGENTS.md describes it, checked in a real browser against the
 * real server and materials service (each on a free port, with data in a temporary
 * directory) and the built frontend: run `pnpm build` first (`pnpm test` does). Only the
 * author is not real: a request is answered with a run that has just ended, and the runs
 * the author would make are told to the page as the server tells them, on the channel its
 * events go through. The model menu is shown as connected.
 *
 * Set DRAWY_CHROMIUM to a Chromium executable where Playwright's own is not installed. */

vi.setConfig({ testTimeout: 60_000 });

const root = new URL("../../../", import.meta.url).pathname;
const tsx = join(root, "node_modules/.bin/tsx");
const processes: ChildProcess[] = [];
let data: string, base: string, browser: Browser, context: BrowserContext, userId: string;
let page: Page;
/** The requests the page made to the author, as posted. */
let asked: { prompt: string; sceneId: string }[];
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

beforeAll(async () => {
  data = mkdtempSync(join(tmpdir(), "drawy-desktop-"));
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
  context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 900 } });
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

const api = async (path: string, method = "GET", body?: unknown) => {
  const r = await context.request.fetch(base + "/api" + path, { method, data: body });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
};
function run(workId: string, id: string, status: Run["status"], steps: Step[]): Run {
  return { id, workId, sceneId: "root", status, steps, observations: [], startedAt: Date.now() };
}
const box = `return api.svg('<svg viewBox="0 0 '+api.width+' '+api.height+'"><rect width="100%" height="100%" fill="#cde"/><text x="20" y="40" font-size="28">'+api.data.label+'</text></svg>')`;
/** A work with two boxes, Alpha and Beta, saved as version 1; and an empty subscene
 * `sub` when asked, or one with a box in it. */
async function make({ sub }: { sub?: "empty" | "drawn" } = {}) {
  const w = await api("/works", "POST", { title: "Check" });
  const edited = await api(`/works/${w.id}/edits`, "POST", {
    baseRevision: w.revision,
    edit: {
      drawings: [{ id: "box", name: "Box", source: box }],
      ...(sub ? { scenes: [{ id: "sub", title: "Sub", parentId: "root" }] } : {}),
      modules: [
        { id: "a", drawingId: "box", bounds: [100, 100, 240, 120], data: { label: "Alpha" } },
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
async function open(id: string) {
  await page.goto(base + "/a/" + id);
  await page.waitForSelector("[data-canvas]");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("*")].some((e) => e.shadowRoot?.textContent?.includes("Alpha")),
  );
  await page.waitForTimeout(500);
}
/** A drawn module by its words: the same element as long as it is not drawn anew. */
const module = (text: string) =>
  page.evaluate((text) => {
    const el = [...document.querySelectorAll("*")].find(
      (e) => e.shadowRoot?.textContent?.includes(text),
    ) as HTMLElement | undefined;
    if (!el) return undefined;
    el.dataset.mark ??= String(Math.random());
    const r = el.getBoundingClientRect();
    return { mark: el.dataset.mark, left: el.style.left, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
const count = (text: string) =>
  page.evaluate(
    (text) => [...document.querySelectorAll("*")].filter((e) => e.shadowRoot?.textContent?.includes(text)).length,
    text,
  );
const statuses = () => page.locator("[role=status]").allInnerTexts();
const renders = () => page.evaluate(() => ({ ...(window as any).__drawyRenders }) as Record<string, number>);
const composer = () => page.locator("[data-dock] textarea");
/** Tells the page an event as the server would, through the channel its events take. */
const tell = (event: unknown) =>
  page.evaluate(
    ([user, event]) => new BroadcastChannel("drawy-events:" + user).postMessage({ event }),
    [userId, event] as const,
  );
async function editing() {
  await page.getByRole("button", { name: "Edit by hand" }).click();
  await page.waitForTimeout(300);
}
/** Drags a module by 100 by 80 screen pixels. */
async function drag(text: string) {
  const at = (await module(text))!;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 50, at.y + 40, { steps: 5 });
  await page.mouse.move(at.x + 100, at.y + 80, { steps: 5 });
  await page.mouse.up();
}
const settled = () => page.waitForTimeout(1200);

it("shows a hand edit at once and lays the saved one over it without drawing it again", async () => {
  await open(await make());
  await editing();
  const before = (await module("Alpha"))!;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/works/*/edits", async (route) => {
    await held;
    await route.continue();
  });
  await drag("Alpha");
  await page.waitForTimeout(300);
  const drafted = (await module("Alpha"))!;
  expect(drafted.left).not.toBe(before.left);
  release();
  await settled();
  const saved = (await module("Alpha"))!;
  expect(saved.left).toBe(drafted.left);
  expect(saved.mark).toBe(before.mark);
  expect(await statuses()).toContain("1 change not saved\nDiscard changes\nSave as version 2");
});

it("holds a request while hand edits are unsaved, until they are saved, thrown away or kept", async () => {
  await open(await make());
  await editing();
  await drag("Alpha");
  await settled();
  await composer().fill("Make it blue");
  await composer().press("Enter");
  const asking = page.locator("[role=alertdialog]");
  await expect.poll(() => asking.innerText()).toContain("1 unsaved change");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(asked).toEqual([]);
  expect(await composer().inputValue()).toBe("Make it blue");
  await composer().press("Enter");
  await page.getByRole("button", { name: "Save and send" }).click();
  await settled();
  // Sent about what is selected (the module just dragged), once saved as a version.
  expect(asked.map((a) => a.prompt)).toEqual(["Make it blue\nSelected module: a\nAlpha"]);
  expect(await composer().inputValue()).toBe("");
  // The work's second save: the one the request waited for.
  const revisions: { cause: { kind: string } }[] = await api(`/works/${page.url().split("/a/")[1]}/revisions`);
  expect(revisions.filter((r) => r.cause.kind === "save")).toHaveLength(2);
});

it("undoes and redoes by keyboard in place, and saves by keyboard", async () => {
  await open(await make());
  await editing();
  const before = (await module("Alpha"))!;
  await drag("Alpha");
  await settled();
  const moved = (await module("Alpha"))!;
  await page.keyboard.press("Control+z");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  expect((await statuses()).join()).not.toContain("not saved");
  await page.keyboard.press("Control+Shift+z");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: moved.left, mark: before.mark });
  await page.keyboard.press("Control+s");
  await settled();
  expect(await statuses()).toContain("Saved as version 2");
});

it("looks at a version without drawing it again, and goes back to it, which can be undone", async () => {
  await open(await make());
  await editing();
  const before = (await module("Alpha"))!;
  await drag("Alpha");
  await settled();
  await page.keyboard.press("Control+s");
  await settled();
  const saved = (await module("Alpha"))!;
  await page.getByRole("button", { name: "Versions" }).click();
  const rows = page.locator("[data-kind=drafts] li");
  await expect.poll(() => rows.allInnerTexts()).toHaveLength(3);
  await rows.nth(1).click();
  await settled();
  expect(await statuses()).toContain("Viewing version 1\nBack to current\nGo back to this version");
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  await page.keyboard.press("Escape");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: saved.left });
  await rows.nth(1).click();
  await settled();
  await page.getByRole("button", { name: "Go back to this version" }).click();
  await settled();
  expect(await statuses()).toContain("Back to version 1\nUndo");
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: saved.left, mark: before.mark });
  expect((await statuses()).join()).not.toContain("Back to version");
});

it("throws hand edits away, which can be undone", async () => {
  await open(await make());
  await editing();
  const before = (await module("Alpha"))!;
  await drag("Alpha");
  await settled();
  const moved = (await module("Alpha"))!;
  await page.getByRole("button", { name: "Discard changes" }).click();
  await settled();
  expect(await statuses()).toContain("Changes discarded\nUndo");
  expect((await module("Alpha"))!.left).toBe(before.left);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled();
  expect((await module("Alpha"))!.left).toBe(moved.left);
});

it("places words ready to type on a blank canvas, and duplicates, copies and pastes them", async () => {
  await page.goto(base + "/");
  await page.getByRole("button", { name: "New blank canvas" }).first().click();
  await page.waitForURL(/\/a\//);
  await page.waitForSelector("[data-canvas]");
  await page.waitForTimeout(500);
  await editing();
  await page.keyboard.press("t");
  const canvas = (await page.locator("[data-canvas]").boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2 - 100);
  // The library's text drawing is taken in first; the words are retyped once drawn.
  await expect
    .poll(() => page.evaluate(() => (document.activeElement as HTMLTextAreaElement)?.value), { timeout: 10_000 })
    .toBe("Type here");
  await page.keyboard.type("Hello");
  await page.keyboard.press("Enter");
  await settled();
  expect(await count("Hello")).toBe(1);
  await page.keyboard.press("Control+d");
  await settled();
  expect(await count("Hello")).toBe(2);
  // The copy is what is selected now, so the request is about it.
  expect(await page.locator("[data-dock] [class*=quote] span").allInnerTexts()).toEqual(["Hello"]);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await settled();
  expect(await count("Hello")).toBe(3);
  await page.keyboard.press("Delete");
  await settled();
  expect(await count("Hello")).toBe(2);
});

it("makes a work for a request from the home page and sends the request there", async () => {
  await page.goto(base + "/");
  await page.locator("textarea").first().fill("A map of the tea route");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/a\//);
  await page.waitForSelector("[data-canvas]");
  await settled();
  expect(asked).toEqual([expect.objectContaining({ prompt: "A map of the tea route", sceneId: "root" })]);
  expect(await composer().inputValue()).toBe("");
  expect(await page.locator("header nav").first().innerText()).toContain("A map of the tea route");
});

it("asks for an empty subscene on entering it, and an address naming no scene falls back", async () => {
  const id = await make({ sub: "empty" });
  await open(id);
  await page.getByRole("button", { name: "Scenes" }).click();
  await page.getByRole("button", { name: "Sub", exact: true }).click();
  await settled();
  expect(new URL(page.url()).pathname).toBe(`/a/${id}/sub`);
  expect(asked).toEqual([{ prompt: "Expand the “Sub” scene in the work's style.", sceneId: "sub", materials: [] }]);
  await page.goto(base + `/a/${id}/nowhere`);
  await page.waitForSelector("[data-canvas]");
  await settled();
  expect(new URL(page.url()).pathname).toBe(`/a/${id}`);
});

it("while the author draws, opens the studio, folds the composer and waits; then shows its reply until put away", async () => {
  const id = await make();
  await open(id);
  const user = { kind: "message", role: "user", text: "Draw a map" } as const;
  await tell({ type: "run", run: run(id, "live", "running", [user, { kind: "thinking", text: "**Planning**" }]) });
  await settled();
  expect(await page.locator("[data-panel]").getAttribute("data-panel")).toBe("journal");
  await expect.poll(() => page.getByRole("button", { name: "Stop" }).count()).toBeGreaterThan(0);
  expect(await page.locator("[data-dock] textarea").count()).toBe(0);
  await tell({
    type: "run",
    run: run(id, "live", "completed", [user, { kind: "message", role: "assistant", text: "Here is the map." }]),
  });
  await settled();
  // The studio says it too, so the reply under the canvas shows once the studio is shut.
  await page.getByRole("button", { name: "Studio" }).click();
  await settled();
  expect((await page.locator("[data-dock]").innerText())).toContain("Here is the map.");
  await page.keyboard.press("Escape");
  await settled();
  expect((await page.locator("[data-dock]").innerText())).not.toContain("Here is the map.");
});

it("follows a run that drew only in a subscene there once it ends", async () => {
  const id = await make({ sub: "drawn" });
  await open(id);
  const wrote = { kind: "tool", id: "t1", name: "write_work", status: "done", drawings: [], scenes: [{ id: "sub", title: "Sub", modules: [] }], details: [], materials: [], removed: 0 };
  await tell({ type: "run", run: run(id, "live", "running", []) });
  await settled();
  await tell({ type: "run", run: run(id, "live", "completed", [wrote as Step]) });
  await settled();
  expect(new URL(page.url()).pathname).toBe(`/a/${id}/sub`);
  await expect.poll(() => count("Gamma")).toBe(1);
});

it("keeps the reply of a run from before the work was opened in the studio", async () => {
  const id = await make();
  await page.route(`**/api/works/${id}/runs`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: [run(id, "old", "completed", [{ kind: "message", role: "assistant", text: "An old reply." }])],
    });
  });
  await open(id);
  expect(await page.locator("[data-dock]").innerText()).not.toContain("An old reply.");
  await page.getByRole("button", { name: "Studio" }).click();
  await settled();
  expect(await page.locator("[data-kind=journal]").innerText()).toContain("An old reply.");
});

it("draws again only what shows the author's run as it goes, and only the composer while typing", async () => {
  const id = await make();
  await open(id);
  await editing();
  const user = { kind: "message", role: "user", text: "Draw" } as const;
  await tell({ type: "run", run: run(id, "live", "running", [user]) });
  await settled();
  const before = await renders();
  for (let i = 1; i <= 10; i++)
    await tell({ type: "run", run: run(id, "live", "running", [user, { kind: "thinking", text: "step " + i }]) });
  await settled();
  const after = await renders();
  const grew = (part: string) => (after[part] ?? 0) - (before[part] ?? 0);
  // The run is shown on the canvas and in the status line; nothing else changed.
  expect(grew("canvas")).toBeGreaterThan(0);
  expect(grew("status")).toBeGreaterThan(0);
  for (const part of ["page", "topbar", "tools", "editor", "bars", "composer"]) expect([part, grew(part)]).toEqual([part, 0]);
  await tell({ type: "run", run: run(id, "live", "completed", [user]) });
  await settled();
  const quiet = await renders();
  await composer().pressSequentially("hello", { delay: 20 });
  await settled();
  const typed = await renders();
  const changed = (part: string) => (typed[part] ?? 0) - (quiet[part] ?? 0);
  expect(changed("composer")).toBeGreaterThan(0);
  for (const part of ["page", "topbar", "tools", "editor", "bars", "canvas", "status"])
    expect([part, changed(part)]).toEqual([part, 0]);
});

it("loads the desktop page in a chunk of its own, when a work is opened", async () => {
  const chunks: string[] = [];
  page.on("request", (r) => r.url().includes("/assets/") && r.url().endsWith(".js") && chunks.push(r.url()));
  await page.goto(base + "/");
  await settled();
  expect(chunks.some((u) => u.includes("WorkPage"))).toBe(false);
  await open(await make());
  expect(chunks.some((u) => u.includes("WorkPage"))).toBe(true);
});
