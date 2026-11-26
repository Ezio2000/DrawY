import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { documentFor } from "./document.ts";
import { fixture } from "./fixture.ts";
import { capture, readText, render } from "../observation/capture.ts";
import { fit, zoom } from "../contracts/geometry.ts";
import { useOf } from "../materials/index.ts";
import type { Side } from "../contracts/index.ts";
import type { DrawingMaterial, Material } from "@drawy/materials/schema";
import { boil } from "../../materials/streets.ts";
import { importedPicture, sketchLine } from "../interchange/drawings.ts";

/** Curated materials as the library serves them. */
const seed = (name: string) =>
  (
    JSON.parse(
      readFileSync(
        new URL(`../../content/seed/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as Material[]
  ).map(
    (m) =>
      ({
        ...m,
        status: "ready",
        version: 1,
        // The seed names a picture's type as its role.
        ...("role" in m ? { type: (m as { role: string }).role } : {}),
        ...(m.kind === "picture"
          ? { file: { ...m.file, url: `/materials/files/${m.id}` } }
          : {}),
      }) as Material,
  );
/** Requests for the developing picture, held back until the test lets them through. */
const held: (() => void)[] = [];
const develop = () => held.splice(0).forEach((send) => send());

let browser: Browser, page: Page, server: Server, origin: string;
/** Street tiles answered with an error, or the connection dropped as when offline. */
let streetsDown: false | "error" | "offline" = false;
let work = fixture();
beforeAll(async () => {
  const bundle = await readFile("dist/runtime/runtime.js");
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/runtime/runtime.js") {
      res.setHeader("content-type", "application/javascript");
      res.end(bundle);
    } else if (url.pathname.startsWith("/materials/files/")) {
      const id = url.pathname.split("/").at(-1)!;
      const send = () => {
        // A user's icon drawn in currentColor, so it can be inked.
        if (id === "u-ring") {
          res.setHeader("content-type", "image/svg+xml");
          return res.end(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor"/></svg>`,
          );
        }
        // Curated icons are SVG; the rest are WebP.
        const svg = new URL(
          `../../content/seed/files/${id}.svg`,
          import.meta.url,
        );
        if (existsSync(svg)) {
          res.setHeader("content-type", "image/svg+xml");
          return res.end(readFileSync(svg));
        }
        res.setHeader("content-type", "image/webp");
        res.end(
          readFileSync(
            new URL(
              `../../content/seed/files/${id === "g-late" ? "apple" : id}.webp`,
              import.meta.url,
            ),
          ),
        );
      };
      if (id === "g-late") held.push(send);
      else send();
    } else if (url.pathname.startsWith("/materials/geo/streets/")) {
      // One real tile of central Guangzhou; every other tile empty, or all unreachable.
      const [z, x, y] = url.pathname.split("/").slice(-3).map(Number);
      if (streetsDown === "offline") return req.socket.destroy();
      if (streetsDown) {
        res.statusCode = 502;
        return res.end("{}");
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          boil(
            z === 14 && x === 13347 && y === 7110
              ? readFileSync(
                  new URL(
                    "../../materials/fixtures/streets-14-13347-7110.pbf",
                    import.meta.url,
                  ),
                )
              : new Uint8Array(),
            z,
            x,
            y,
          ),
        ),
      );
    } else if (url.pathname.startsWith("/materials/geo/")) {
      res.setHeader("content-type", "application/json");
      res.end(
        readFileSync(
          new URL(
            `../../content/seed/geo/${url.pathname.split("/").at(-1)}.json`,
            import.meta.url,
          ),
        ),
      );
    } else {
      res.setHeader("content-type", "text/html");
      res.end(documentFor(work, url.pathname.split("/").at(-1)!));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(async () => {
  work = fixture();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
afterEach(async () => {
  await page.close();
});
async function open() {
  await page.goto(origin + "/api/works/fixture/scenes/root?revision=1");
  await page.waitForFunction(() => window.drawyReady);
}
/** A library drawing as a work holds it, its code read from the seed. */
const libraryDrawing = (id: string) =>
  useOf({
    ...seed("drawings").find((m) => m.id === id)!,
    source: readFileSync(new URL(`../../content/seed/drawings/${id}.js`, import.meta.url), "utf8"),
  } as Material)!;
/** What the page kept of a canvas callback in `document.body.dataset`. */
const data = (key: string) => page.evaluate((k) => document.body.dataset[k], key);
/** Where a point of the scene is on screen now. */
const screen = (x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const v = window.drawyView,
        r = v.element.getBoundingClientRect(),
        c = v.view;
      return { x: r.left + c.x + x * c.scale, y: r.top + c.y + y * c.scale };
    },
    [x, y],
  );

it("fits the complete composition, keeps camera out of the work and anchors zoom at the pointer", async () => {
  await open();
  expect(await page.locator("[data-module-id]").count()).toBe(7);
  const { boxes, size } = await page.evaluate(() => ({
    boxes: [...document.querySelectorAll("[data-module-id]")].map((el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
    }),
    size: { width: innerWidth, height: innerHeight },
  }));
  expect(
    boxes.every(
      (b) =>
        b.x >= 0 &&
        b.y >= 0 &&
        b.right <= size.width &&
        b.bottom <= size.height,
    ),
  ).toBe(true);
  const initial = await page.evaluate(() =>
    JSON.stringify(window.drawyData.work),
  );
  const camera = await page.evaluate(() => window.drawyView.view);
  await page.mouse.move(50, 100);
  await page.mouse.wheel(80, 100);
  await page.waitForFunction(
    (old) => window.drawyView.view.x !== old.x,
    camera,
  );
  expect(await page.evaluate(() => JSON.stringify(window.drawyData.work))).toBe(
    initial,
  );
  const point = { x: 200, y: 400 },
    next = zoom(camera, point, 2);
  expect((point.x - next.x) / next.scale).toBeCloseTo(
    (point.x - camera.x) / camera.scale,
  );
  expect((point.y - next.y) / next.scale).toBeCloseTo(
    (point.y - camera.y) / camera.scale,
  );
  expect(
    fit({ x: -20, y: 40, width: 800, height: 600 }, 20, 20).scale,
  ).toBeGreaterThan(0);
});
it("draws a revision swapped in under a view that already fits it at that view", async () => {
  await open();
  const scale = await page.evaluate(async () => {
    const view = window.drawyView,
      work = structuredClone(window.drawyData.work),
      before = view.renderer;
    // Same extent, so the automatic view has nowhere to glide; style change forces a swap.
    work.revision += 1;
    work.style = { ...work.style, ink: "#222222" };
    work.scenes.root.modules[0].data = { ...work.scenes.root.modules[0].data, text: "新" };
    view.update(work, work.scenes.root);
    while (view.renderer === before) await new Promise((r) => setTimeout(r, 20));
    return view.view.scale;
  });
  const transform = await page.evaluate(
    () => window.drawyView.renderer.element.style.transform,
  );
  expect(Number(transform.match(/scale\(([\d.]+)\)/)?.[1])).toBeCloseTo(scale, 4);
});
it("awaits async scene events, opens separate details and renders structured diagrams in subscenes", async () => {
  await open();
  await page.locator('[data-action="emphasize"]').click();
  await page.evaluate(() => window.drawyView.renderer.settled());
  expect(
    await page.locator('[data-module-id="level-4"] svg').textContent(),
  ).toContain("已突出基础需要");
  expect(
    await page.evaluate(
      () => window.drawyData.work.scenes.root.modules[4].data.tip,
    ),
  ).toBe("食物与休息");
  // The marks of modules that open something belong to the app, not to this page.
  expect(await page.locator("button[data-target]").count()).toBe(0);
  await page.locator('[data-module-id="level-2"]').click();
  expect(await page.locator("article h1").innerText()).toBe("理解需求层次");
  // The page covers the screen and the article keeps its measure.
  const cover = (await page.locator("[data-drawy-detail]").boundingBox())!;
  expect(cover.width).toBe(1440);
  expect((await page.locator("article").boundingBox())!.width).toBe(680);
  await page.getByRole("button", { name: "← 返回图中" }).click();
  expect(await page.locator("article").count()).toBe(0);
  await page.locator('[data-action="explore"]').click();
  await page.waitForURL("**/child?revision=1");
  await page.waitForFunction(() => window.drawyReady);
  expect(await page.locator('[data-module-id="mermaid"] svg').count()).toBe(1);
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});
it("edits with the mouse: a press selects instead of operating, a box selects, handles resize a selection as one and move its links, drags snap, a right click asks for the menu, and a double click points at words and pictures", async () => {
  work.materials.apple = useOf(seed("pictures").find((m) => m.id === "apple")!)!;
  work.drawings.fruit = { id: "fruit", name: "果", source: 'return api.material("apple")' };
  work.scenes.root.modules.push({
    id: "fruit",
    drawingId: "fruit",
    label: "苹果",
    data: {},
    bounds: { x: 700, y: 120, width: 160, height: 160 },
  });
  work.scenes.root.links.push({
    id: "connection",
    drawingId: "connector",
    from: { moduleId: "level-0", at: "right" },
    to: { moduleId: "level-1", at: "right" },
    data: {},
  });
  await open();
  await page.evaluate(() => {
    const view = window.drawyView,
      body = document.body.dataset;
    view.setMovable(true);
    view.setEditing(true);
    view.options.select = (s) => (body.selected = s.map((x) => x.moduleId).join());
    view.options.open = (t) => (body.opened = t.id);
    view.options.point = (p) => (body.pointed = JSON.stringify(p));
    view.options.commit = (moves) => (body.moves = JSON.stringify(moves));
    view.options.menu = (at) => (body.menu = JSON.stringify(at));
    view.options.place = (at, box) => (body.placed = JSON.stringify({ at, box }));
  });
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  };
  const scale = await page.evaluate(() => window.drawyView.view.scale);
  // A level opens its explanation when explored; while editing, a press only selects: the
  // pyramid the level is grouped in, and with Cmd or Ctrl the level alone. Shift adds
  // another.
  const level0 = page.locator('[data-module-id="level-0"]'),
    level1 = page.locator('[data-module-id="level-1"]');
  await level0.click();
  expect(await data("selected")).toBe("level-0,level-1,level-2,level-3,level-4");
  await level0.click({ modifiers: ["ControlOrMeta"] });
  expect(await data("selected")).toBe("level-0");
  await level1.click({ modifiers: ["Shift"] });
  expect(await data("selected")).toBe("level-0,level-1");
  expect(await data("opened")).toBeUndefined();
  // The drawing's own button is pressed without acting.
  await page.getByRole("button", { name: "强调基础" }).click();
  expect(await data("selected")).toBe("control");
  await page.waitForTimeout(150);
  expect(await page.locator('[data-module-id="level-4"] text').nth(1).textContent()).toBe("食物与休息");
  // Dragging over the paper selects what lies wholly in the box, a group once all of it
  // does; with Alt, what the box touches, with its group.
  await drag(await screen(120, 95), await screen(320, 220));
  expect(await data("selected")).toBe("");
  await page.keyboard.down("Alt");
  await drag(await screen(120, 95), await screen(320, 220));
  await page.keyboard.up("Alt");
  expect(await data("selected")).toBe("level-0,level-1,level-2,level-3,level-4");
  await drag(await screen(40, 100), await screen(860, 620));
  expect(await data("selected")).toBe("level-0,level-1,level-2,level-3,level-4");
  await level0.click({ modifiers: ["ControlOrMeta"] });
  await level1.click({ modifiers: ["Shift"] });
  expect(await data("selected")).toBe("level-0,level-1");
  // The handles on the box around two modules resize both in proportion, and the link
  // between them follows.
  const before = await page.locator('[data-link-id="connection"] path').getAttribute("d");
  const corner = (await page.locator('[data-handle="se"]').boundingBox())!;
  const grip = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
  await drag(grip, { x: grip.x + 50, y: grip.y });
  await page.evaluate(() => window.drawyView.renderer.settled());
  const resized = JSON.parse((await data("moves"))!);
  expect(resized.map((m: { id: string }) => m.id)).toEqual(["level-0", "level-1"]);
  const was = work.scenes.root.modules;
  expect(resized[1].bounds.width).toBeGreaterThan(was[1].bounds.width);
  expect(resized[0].bounds.width / resized[1].bounds.width).toBeCloseTo(was[0].bounds.width / was[1].bounds.width);
  expect(await page.locator('[data-link-id="connection"] path').getAttribute("d")).not.toBe(before);
  // A dragged module snaps its edges to its neighbours' (the heading's left edge lines up
  // with the widest level's); Ctrl lets it go where it is dropped.
  const heading = await screen(400, 45);
  await page.mouse.click(heading.x, heading.y);
  await drag(heading, { x: heading.x + 3, y: heading.y + 30 });
  expect(JSON.parse((await data("moves"))!)[0].bounds.x).toBeCloseTo(100);
  const moved = await screen(400, 45 + 30 / scale);
  await page.keyboard.down("Control");
  await drag(moved, { x: moved.x + 5, y: moved.y });
  await page.keyboard.up("Control");
  expect(JSON.parse((await data("moves"))!)[0].bounds.x).toBeCloseTo(100 + 5 / scale);
  // A right click selects what it lands on (with its group) and asks for the menu there.
  const safety = await screen(450, 450);
  await page.mouse.click(safety.x, safety.y, { button: "right" });
  expect(await data("selected")).toBe("level-0,level-1,level-2,level-3,level-4");
  const menu = JSON.parse((await data("menu"))!);
  expect(Math.abs(menu.x - safety.x)).toBeLessThan(2);
  expect(Math.abs(menu.y - safety.y)).toBeLessThan(2);
  // A double click says which words or which picture it landed on.
  await page.locator('[data-module-id="level-3"] text', { hasText: "安全需求" }).dblclick();
  expect(JSON.parse((await data("pointed"))!)).toEqual({ kind: "text", moduleId: "level-3", text: "安全需求" });
  await page.getByRole("button", { name: "进入子场景" }).dblclick();
  expect(JSON.parse((await data("pointed"))!)).toMatchObject({ moduleId: "control", text: "进入子场景" });
  await page.locator('[data-module-id="fruit"] img').dblclick();
  expect(JSON.parse((await data("pointed"))!)).toEqual({ kind: "picture", moduleId: "fruit", material: "apple" });
  // A large module laid over others takes only the presses that land on what it draws.
  await page.evaluate(() => {
    const w = window.drawyView.renderer.work,
      scene = window.drawyView.renderer.scene;
    w.drawings.veil = {
      id: "veil",
      name: "罩",
      source:
        'return api.svg(`<svg viewBox="0 0 ${api.width} ${api.height}"><circle cx="20" cy="20" r="16" fill="#d97757"/></svg>`)',
    };
    window.drawyView.update(w, {
      ...scene,
      modules: [...scene.modules, { id: "veil", drawingId: "veil", label: "罩", data: {}, bounds: { x: 0, y: 0, width: 900, height: 600 } }],
    });
  });
  await page.waitForFunction(() => window.drawyView.renderer.instances.has("veil"));
  await page.waitForTimeout(100);
  const level = (await page.locator('[data-module-id="level-2"] text').first().boundingBox())!;
  await page.mouse.click(level.x + level.width / 2, level.y + level.height / 2);
  expect(await data("selected")).toBe("level-0,level-1,level-2,level-3,level-4");
  const veil = (await page.locator('[data-module-id="veil"] circle').boundingBox())!;
  await page.mouse.click(veil.x + veil.width / 2, veil.y + veil.height / 2);
  expect(await data("selected")).toBe("veil");
  // The drawing tool keeps a Shift-drawn shape square, on the grid too, even from between
  // its lines.
  await page.evaluate(() => window.drawyView.setTool("draw"));
  for (const grid of [20, 0]) {
    await page.evaluate((grid) => window.drawyView.setSnap({ guides: true, grid }), grid);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      await page.keyboard.down("Shift");
      await drag(await screen(909, 311), await screen(909 + sx * 92, 311 + sy * 60));
      await page.keyboard.up("Shift");
      const box = JSON.parse((await data("placed"))!).box;
      expect([box.width, box.height]).toEqual(grid ? [100, 100] : [92, 92]);
      if (grid) expect([box.x % grid, box.y % grid]).toEqual([0, 0]);
    }
  }
  await page.evaluate(() => window.drawyView.setTool("select"));
  // Leaving editing, the drawing works again.
  await page.evaluate(() => window.drawyView.setEditing(false));
  await page.getByRole("button", { name: "强调基础" }).click();
  await expect
    .poll(() => page.locator('[data-module-id="level-4"] text').nth(1).textContent())
    .toBe("已突出基础需要");
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});
it("selects a link by its line while editing, drags its ends onto other modules and retypes its words", async () => {
  work.drawings.line = {
    id: "line",
    name: "线",
    source:
      'const {from:a,to:b}=api;return api.svg(`<svg width="${api.width}" height="${api.height}"><path d="M${a.x} ${a.y}L${b.x} ${b.y}" stroke="#333" stroke-width="2" fill="none"/><text x="${(a.x+b.x)/2+8}" y="${(a.y+b.y)/2}" font-size="14">${api.data.label}</text></svg>`)',
  };
  work.scenes.root.links.push({
    id: "next",
    drawingId: "line",
    from: { moduleId: "level-0", at: "right" },
    to: { moduleId: "level-1", at: "right" },
    data: { label: "然后" },
  });
  await open();
  await page.evaluate(() => {
    const view = window.drawyView,
      body = document.body.dataset;
    view.setMovable(true);
    view.setEditing(true);
    view.options.select = (s, links) => {
      body.selected = s.map((x) => x.moduleId).join();
      body.link = links.join();
    };
    view.options.reconnect = (id, end, to) =>
      (body.reconnected = JSON.stringify({ id, end, to }));
    view.options.point = (p) => (body.pointed = JSON.stringify(p));
  });
  // A press a few pixels off the line, between the modules, takes the link in place of
  // the selected module.
  const first = await screen(420, 150);
  await page.mouse.click(first.x, first.y);
  expect(await data("selected")).toBe("level-0,level-1,level-2,level-3,level-4");
  const between = await screen(565, 207);
  await page.mouse.click(between.x + 3, between.y);
  expect(await data("link")).toBe("next");
  expect(await data("selected")).toBe("");
  expect(await page.evaluate(() => window.drawyView.selectedLinks)).toEqual(["next"]);
  // Its end is dragged into another module, which it then follows.
  const end = (await page.locator('[data-link-end="to"]').boundingBox())!;
  const target = await screen(160, 457);
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  expect(JSON.parse((await data("reconnected"))!)).toEqual({
    id: "next",
    end: "to",
    to: { moduleId: "level-3" },
  });
  // Its words are changed where they are drawn.
  const words = (await page.locator('[data-link-id="next"] text').boundingBox())!;
  await page.mouse.dblclick(words.x + words.width / 2, words.y + words.height / 2);
  expect(JSON.parse((await data("pointed"))!)).toMatchObject({
    kind: "text",
    moduleId: "next",
    link: true,
    text: "然后",
  });
  // Selecting a module leaves no link selected.
  const level = await screen(420, 150);
  await page.mouse.click(level.x, level.y);
  expect(await data("selected")).toBe("level-0,level-1,level-2,level-3,level-4");
  expect(await data("link")).toBe("");
  // Enter finds the words a module draws first; a double click on the paper puts words
  // where it lands.
  expect(
    await page.evaluate(() => window.drawyView.wordsIn("level-0")?.text),
  ).toBe("自我实现");
  await page.evaluate(() => {
    window.drawyView.options.place = (at) =>
      (document.body.dataset.placed = JSON.stringify(at));
  });
  const paper = await screen(1000, 300);
  await page.mouse.dblclick(paper.x, paper.y);
  const placed = JSON.parse((await data("placed"))!);
  expect(placed.x).toBeCloseTo(1000, 0);
  expect(placed.y).toBeCloseTo(300, 0);
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});
it("lays the person's own change over what is drawn, redrawing only what changed, and the scene's script passes over what was taken out", async () => {
  await open();
  const result = await page.evaluate(async () => {
    const view = window.drawyView,
      drawn = (id: string) =>
        document.querySelector<HTMLElement>(`[data-module-id="${id}"]`)!,
      inner = (id: string) => drawn(id).shadowRoot!.lastElementChild;
    const kept = { host: drawn("level-2"), inner: inner("level-2") },
      changed = inner("level-0"),
      moved = inner("heading");
    const work = structuredClone(window.drawyData.work),
      scene = work.scenes.root;
    scene.modules = scene.modules
      .filter((m) => m.id !== "level-4")
      .map((m) =>
        m.id === "level-0"
          ? { ...m, data: { ...m.data, label: "成长" } }
          : m.id === "heading"
            ? { ...m, bounds: { ...m.bounds, x: m.bounds.x + 40 } }
            : m,
      );
    // The heading goes to the back.
    scene.modules.unshift(...scene.modules.splice(scene.modules.findIndex((m) => m.id === "heading"), 1));
    const shown = new Promise<void>((resolve) => (view.options.shown = () => resolve()));
    view.update({ ...work, revision: work.revision + 1 }, scene, true);
    await shown;
    const order = [...document.querySelectorAll<HTMLElement>("[data-module-id]")].map(
      (e) => e.dataset.moduleId,
    );
    return {
      sameHost: drawn("level-2") === kept.host,
      sameDrawing: inner("level-2") === kept.inner,
      redrawn: inner("level-0") !== changed,
      label: drawn("level-0").shadowRoot!.textContent,
      movedOnly: inner("heading") === moved,
      left: drawn("heading").style.left,
      gone: !document.querySelector('[data-module-id="level-4"]'),
      first: order[0],
    };
  });
  expect(result).toEqual({
    sameHost: true,
    sameDrawing: true,
    redrawn: true,
    label: expect.stringContaining("成长"),
    movedOnly: true,
    left: "140px",
    gone: true,
    first: "heading",
  });
  // The scene's script passes over the module taken out.
  await page.getByRole("button", { name: "强调基础" }).click();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});
it("stops a drawing still running for a module taken out while it draws", async () => {
  await open();
  const ticks = await page.evaluate(async () => {
    const view = window.drawyView,
      work = structuredClone(window.drawyData.work),
      scene = work.scenes.root;
    const w = window as unknown as { ticks: number };
    w.ticks = 0;
    work.drawings.slow = {
      id: "slow",
      name: "慢",
      source:
        "await new Promise((r) => setTimeout(r, 200)); const t = setInterval(() => window.ticks++, 10); api.cleanup(() => clearInterval(t)); return api.svg('<svg></svg>');",
    };
    const slow = {
      ...scene.modules[0],
      id: "slow",
      label: "慢",
      drawingId: "slow",
    };
    view.update({ ...work, revision: 2 }, { ...scene, modules: [...scene.modules, slow] }, true);
    view.update({ ...work, revision: 3 }, scene, true);
    await new Promise((r) => setTimeout(r, 400));
    const after = w.ticks;
    await new Promise((r) => setTimeout(r, 200));
    return { after, later: w.ticks };
  });
  expect(ticks.later).toBe(ticks.after);
  expect(await page.locator('[data-module-id="slow"]').count()).toBe(0);
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});
it("draws links over a backdrop laid under the whole figure and under every other module", async () => {
  const drawing = (id: string, source: string) => ({ id, name: id, params: {}, source });
  work.drawings.box = drawing("box", `return api.svg('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')`);
  work.drawings.line = drawing("line", `return api.svg('<svg><line x1="'+api.from.x+'" y1="'+api.from.y+'" x2="'+api.to.x+'" y2="'+api.to.y+'" stroke="red"/></svg>')`);
  const module = (id: string, bounds: { x: number; y: number; width: number; height: number }) => ({
    id, label: id, bounds, drawingId: "box", data: {},
  });
  const parts = [module("a", { x: 100, y: 100, width: 100, height: 100 }), module("b", { x: 500, y: 100, width: 100, height: 100 })];
  const link = { id: "ab", drawingId: "line", from: { moduleId: "a", at: "right" as const }, to: { moduleId: "b", at: "left" as const }, data: {} };
  const depths = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>("[data-module-id],[data-link-id]")].map((h) => [
          h.dataset.moduleId ?? h.dataset.linkId,
          Number(h.style.zIndex),
        ]),
      ),
    );
  work.scenes.root = { ...work.scenes.root, modules: [module("world", { x: 0, y: 0, width: 800, height: 400 }), ...parts], links: [link], checks: [] };
  await open();
  const over = await depths();
  expect(over.world).toBeLessThan(over.ab);
  expect(over.ab).toBeLessThan(over.a);
  // A bottom module that does not lie under the figure is a part like the others.
  work.scenes.root = { ...work.scenes.root, modules: [module("note", { x: 0, y: 0, width: 80, height: 40 }), ...parts] };
  await open();
  const parted = await depths();
  expect(parted.note).toBe(parted.a);
  expect(parted.ab).toBeLessThan(parted.note);
});
it("disposes drawing and scene resources when leaving the canvas", async () => {
  work.drawings.title.source =
    `const timer=setInterval(()=>document.body.dataset.ticks=String(Number(document.body.dataset.ticks||0)+1),10);api.cleanup(()=>clearInterval(timer));` +
    work.drawings.title.source;
  work.scenes.root.interaction += `api.cleanup(()=>document.body.dataset.cleaned='yes');`;
  await open();
  await page.waitForFunction(() => Number(document.body.dataset.ticks) > 2);
  await page.evaluate(() => window.drawyView.dispose());
  const ticks = await page.getAttribute("body", "data-ticks");
  await page.waitForTimeout(60);
  expect(await page.getAttribute("body", "data-ticks")).toBe(ticks);
  expect(await page.getAttribute("body", "data-cleaned")).toBe("yes");
});
it("renders a picture to keep cropped to the drawing, with no paper around it", async () => {
  // One module painting its whole frame: every edge of the picture must be its colour.
  work.drawings.block = {
    id: "block",
    name: "色块",
    source: `return api.svg('<svg viewBox="0 0 '+api.width+' '+api.height+'" preserveAspectRatio="none"><rect width="'+api.width+'" height="'+api.height+'" fill="#2a6b4f"/></svg>');`,
  };
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      { id: "wall", drawingId: "block", data: {}, bounds: { x: -40, y: 30, width: 800, height: 440 } },
    ],
    links: [],
    checks: [],
    interaction: undefined,
  };
  const png = await render(browser, {
    origin,
    cookie: "fixture",
    url: origin + "/api/works/fixture/scenes/root?revision=1",
  });
  const seen = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
    const w = img.width - 1, h = img.height - 1, mx = Math.round(w / 2), my = Math.round(h / 2);
    return {
      width: img.width,
      height: img.height,
      edges: [at(0, 0), at(w, 0), at(0, h), at(w, h), at(mx, 0), at(mx, h), at(0, my), at(w, my)],
    };
  }, "data:image/png;base64," + png.toString("base64"));
  expect(seen.width / seen.height).toBeCloseTo(800 / 440, 1);
  for (const [r, g, b] of seen.edges) {
    expect(Math.abs(r - 0x2a)).toBeLessThan(6);
    expect(Math.abs(g - 0x6b)).toBeLessThan(6);
    expect(Math.abs(b - 0x4f)).toBeLessThan(6);
  }
});
it("captures full scenes and completed interaction states through the same runtime", async () => {
  const shots = await capture(browser, {
    origin,
    cookie: "fixture",
    annotate: true,
    scenes: [
      {
        id: "root",
        url: origin + "/api/works/fixture/scenes/root?revision=1",
        checks: work.scenes.root.checks,
        overview: true,
        regions: [{ x: 0, y: 0, width: 600, height: 100 }],
        actions: [
          { moduleId: "control", selector: '[data-action="emphasize"]' },
          { moduleId: "level-2", selector: "svg" },
          { moduleId: "control", selector: '[data-action="emphasize"]' },
        ],
      },
    ],
  });
  expect(shots).toHaveLength(7);
  // A click that opens a detail page names it instead of picturing it, and closes it so
  // the next click lands in the scene.
  expect(shots[5].base64).toBeUndefined();
  expect(shots[5].opened).toEqual({ detail: "explanation", byTarget: true });
  expect(shots[6].base64).toBeDefined();
  expect(shots[0].modules!.map((m) => m.id)).toContain("level-4");
  // Only the opening view carries the scene's modules.
  expect(shots.slice(1).every((s) => !s.modules)).toBe(true);
  expect(shots[3].camera.scale).toBeGreaterThan(shots[0].camera.scale);
  // Read the actual PNG dimensions from IHDR. Full views are scaled, close-ups keep their viewport.
  const pngSize = (shot: (typeof shots)[number]) => {
    const png = Buffer.from(shot.base64!, "base64");
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  };
  expect(pngSize(shots[0])).toEqual({ width: 1024, height: 640 });
  expect(shots[3].viewport).toEqual({ width: 1222, height: 240 });
  expect(pngSize(shots[3])).toEqual(shots[3].viewport);
  expect(shots[4].label).toContain("操作");
  expect(shots[4].viewport.width).toBe(1440);
  expect(pngSize(shots[4])).toEqual({ width: 1024, height: 640 });
  expect(shots.every((s) => s.errors.length === 0)).toBe(true);
  expect(shots.filter((s) => s.sceneId === "child")).toHaveLength(1);
  expect(shots[0].base64).not.toBe(shots[1].base64);
}, 30000);
it("moves a midpoint-initialized range slider when checking it via capture", async () => {
  work.materials.slider = libraryDrawing("slider");
  work.materials.label = libraryDrawing("label");
  work.scenes.root = {
    id: "root",
    title: "滑块检查",
    parentId: null,
    modules: [
      {
        id: "load",
        drawingId: "slider",
        bounds: { x: 40, y: 40, width: 320, height: 64 },
        data: { label: "荷载", min: 0, max: 30, step: 1, value: 15, unit: "kN/m" },
      },
      {
        id: "readout",
        drawingId: "label",
        bounds: { x: 40, y: 130, width: 320, height: 48 },
        data: { text: "推力 125 kN", size: 22 },
      },
    ],
    links: [],
    interaction: `api.on("load", "change", (v) => {
      api.set("readout", { text: "推力 " + Math.round(v * 10) + " kN" });
    });`,
    checks: [{ moduleId: "load", selector: 'input[type="range"]' }],
  };
  const shots = await capture(browser, {
    origin,
    cookie: "fixture",
    scenes: [
      {
        id: "root",
        url: origin + "/api/works/fixture/scenes/root?revision=1",
        checks: work.scenes.root.checks,
        overview: true,
      },
    ],
  });
  expect(shots).toHaveLength(2);
  expect(shots.every((s) => s.errors.length === 0)).toBe(true);
  expect(shots[0].base64).not.toBe(shots[1].base64);
}, 30000);
it("draws every library drawing with no data at all, and with each of its lists emptied or holding a blank entry, without an error", async () => {
  // A person can take a drawing in with nothing filled in, or empty a list in the editor;
  // the drawing then shows less, never an error in place of itself.
  const drawings = seed("drawings") as DrawingMaterial[];
  work.materials = Object.fromEntries(
    [
      ...drawings.map((m) => ({ ...m, source: readFileSync(new URL(`../../content/seed/drawings/${m.id}.js`, import.meta.url), "utf8") }) as Material),
      ...seed("pictures"),
      ...seed("effects"),
    ].map((m) => [m.id, useOf(m)!]),
  );
  let y = 0;
  const at = (id: string, m: DrawingMaterial, data: Record<string, unknown>) => {
    const placed = { id, label: id, drawingId: m.id, data, bounds: { x: 0, y, ...m.size } };
    y += m.size.height + 60;
    return placed;
  };
  work.scenes.root = {
    ...work.scenes.root,
    modules: drawings
      // The map draws from tiles a test has none of; its own tests cover it.
      .filter((m) => m.use !== "link" && m.id !== "geomap")
      .flatMap((m) => [
        at(`${m.id}.none`, m, {}),
        ...Object.entries(m.params)
          .filter(([, p]) => p.type === "list")
          .flatMap(([key]) => [
            at(`${m.id}.${key}.empty`, m, { ...m.example, [key]: [] }),
            // What the editor adds to a list emptied first: a blank entry.
            at(`${m.id}.${key}.blank`, m, { ...m.example, [key]: [""] }),
          ]),
      ]),
    links: [],
    checks: [],
  };
  await open();
  const failed = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-module-id][data-error]")].map((h) => `${h.dataset.moduleId}: ${h.shadowRoot!.textContent}`),
  );
  // Only a picture with no picture named says so: it is how an author learns it left the
  // id out, and a picture placed by hand always has one.
  expect(failed).toEqual(["picture.none: Error: 素材 undefined 不在作品中"]);
}, 60000);
it("draws every library drawing from its example with words uncut at large sizes, and reports what is cut", async () => {
  const drawings = seed("drawings") as DrawingMaterial[];
  work.materials = Object.fromEntries(
    [
      ...drawings.map(
        (m) =>
          ({
            ...m,
            source: readFileSync(
              new URL(`../../content/seed/drawings/${m.id}.js`, import.meta.url),
              "utf8",
            ),
          }) as Material,
      ),
      ...seed("pictures"),
      ...seed("effects"),
    ].map((m) => [m.id, useOf(m)!]),
  );
  const modules = (data: (m: DrawingMaterial) => Record<string, unknown>) => {
    let y = 0;
    return drawings
      .filter((m) => m.id !== "geomap")
      .map((m) => {
        const at = {
          id: m.id,
          label: m.id,
          drawingId: m.id,
          data: data(m),
          bounds: { x: 0, y, ...m.size },
        };
        y += m.size.height + 60;
        return at;
      });
  };
  // Words stated large, with a plot's axis names and a marker at its far edge.
  work.scenes.root = {
    ...work.scenes.root,
    modules: modules((m) => ({
      ...m.example,
      ...(m.params.size ? { size: 22 } : {}),
      ...(m.id === "plot"
        ? {
            x: { min: 0, max: 300, label: "每天卖出的杯数" },
            y: { min: -2000, max: 2000, label: "每天利润（元）" },
            marker: { x: 300, label: "卖 300 杯时赚得最多" },
            series: [{ points: [[0, -2000], [300, 2000]], label: "利润线" }],
          }
        : {}),
    })),
    links: [],
    checks: [],
  };
  await open();
  expect((await page.evaluate(readText, 14)).clipped).toEqual([]);
  // Every library drawing draws from its example without an error.
  expect(
    await page.evaluate(() => ({
      errors: window.drawyErrors,
      blank: [...document.querySelectorAll<HTMLElement>("[data-module-id]")]
        .filter((h) => !h.shadowRoot!.querySelector("svg,img,div"))
        .map((h) => h.dataset.moduleId),
    })),
  ).toEqual({ errors: [], blank: [] });
  // A plot's names and marker also stay within the box the author gave it.
  const plotted = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-module-id="plot"]')!;
    const box = host.getBoundingClientRect();
    return [...host.shadowRoot!.querySelectorAll("text")].every((t) => {
      const r = t.getBoundingClientRect();
      return r.left >= box.left && r.right <= box.right + 1 && r.top >= box.top && r.bottom <= box.bottom + 1;
    });
  });
  expect(plotted).toBe(true);
  // An upright arrow's label sits beside its line, not across it.
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      { id: "upper", label: "upper", drawingId: "node", data: { title: "上" }, bounds: { x: 300, y: 0, width: 160, height: 60 } },
      { id: "lower", label: "lower", drawingId: "node", data: { title: "下" }, bounds: { x: 300, y: 400, width: 160, height: 60 } },
    ],
    links: [
      { id: "down", drawingId: "arrow", from: { moduleId: "upper", at: "bottom" }, to: { moduleId: "lower", at: "top" }, data: { label: "返回一个很长的值", size: 22 } },
    ],
  };
  await open();
  const crossed = await page.evaluate(() => {
    const root = document.querySelector('[data-link-id="down"]')!.shadowRoot!;
    const text = root.querySelector("text")!.getBoundingClientRect();
    const line = root.querySelector("path")!.getBoundingClientRect();
    return text.right > line.left && text.left < line.right;
  });
  expect(crossed).toBe(false);
  // A drawing that keeps its words inside its svg and overruns it is reported.
  work.drawings.tight = {
    id: "tight",
    name: "tight",
    source: `return api.svg('<svg viewBox="0 0 100 40" width="100" height="40"><text x="60" y="20" font-size="30">超出外框的字</text></svg>');`,
  };
  work.scenes.root.modules = [
    {
      id: "tight",
      label: "tight",
      drawingId: "tight",
      data: {},
      bounds: { x: 0, y: 0, width: 100, height: 40 },
    },
  ];
  await open();
  const report = await page.evaluate(readText, 14);
  expect(report.clipped[0]).toMatchObject({ moduleId: "tight" });
  expect(report.smallest!.px).toBeGreaterThan(20);
}, 30000);
it("measures words as they are shown and reports those their own container cuts", async () => {
  const module = (id: string, width: number, height: number, x = 0) => ({
    id,
    label: id,
    drawingId: id,
    data: {},
    bounds: { x, y: 0, width, height },
  });
  const drawn = (id: string, source: string) => {
    work.drawings[id] = { id, name: id, source };
  };
  const lines = "很多行的文字".repeat(12);
  const scene = (...modules: ReturnType<typeof module>[]) => {
    work.scenes.root = { ...work.scenes.root, modules, links: [], checks: [], };
  };
  // Many lines of one size read as that size, whatever the height of the whole block.
  drawn("many", `return api.html('<div style="width:120px;font-size:20px;line-height:1.5">${lines}</div>');`);
  scene(module("many", 120, 600));
  await open();
  let report = await page.evaluate(readText, 14);
  const scale = await page.evaluate(() => window.drawyView.view.scale);
  expect(report.smallest!.px).toBe(Math.round(20 * scale));
  expect(report.clipped).toEqual([]);
  // In an svg its viewBox scales the words too, and each line is measured on its own.
  drawn(
    "lined",
    `return api.svg('<svg viewBox="0 0 100 100" width="200" height="200"><text x="5" y="20" font-size="10">外层<tspan x="5" dy="12">内一</tspan><tspan x="5" dy="12">内二</tspan></text></svg>');`,
  );
  scene(module("lined", 200, 200));
  await open();
  report = await page.evaluate(readText, 14);
  const svgScale = await page.evaluate(() => window.drawyView.view.scale);
  expect(report.smallest!.px).toBe(Math.round(20 * svgScale));
  // The element directly holding the words can be what cuts them off.
  drawn("cut", `return api.html('<div style="width:120px;height:30px;overflow:hidden;font-size:20px">${lines}</div>');`);
  drawn("ellipsis", `return api.html('<div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:20px">${lines}</div>');`);
  // A line height of one fits the words though their text box passes the container.
  drawn("tight", `return api.html('<div style="height:20px;line-height:1;overflow:hidden;font-size:20px;white-space:nowrap">刚好放下</div>');`);
  scene(module("cut", 120, 30), module("ellipsis", 80, 30, 200), module("tight", 120, 20, 400));
  await open();
  report = await page.evaluate(readText, 14);
  expect(report.clipped.map((c) => c.moduleId).sort()).toEqual(["cut", "ellipsis"]);
}, 30000);
it("leaves keyboard input inside a drawing control to that control", async () => {
  work.drawings.control.source = `return api.html('<input aria-label="angle" type="text">');`;
  await open();
  const input = page.getByRole("textbox", { name: "angle" });
  await input.pressSequentially("20");
  expect(await input.inputValue()).toBe("20");
});
it("swaps a later revision into the open canvas and reports the scene it shows", async () => {
  await open();
  const result = await page.evaluate(async () => {
    const view = window.drawyView,
      work = structuredClone(window.drawyData.work),
      scene = work.scenes.root,
      heading = scene.modules.find((m) => m.id === "heading")!;
    scene.modules = scene.modules.filter((m) => m.id !== "heading");
    scene.modules.push({
      ...heading,
      id: "added",
      bounds: { ...heading.bounds, x: heading.bounds.x + 1600 },
    });
    const before = view.view.scale;
    const shown = new Promise<string[]>((resolve) => {
      view.options.shown = (s) => resolve(s.modules.map((m) => m.id));
    });
    view.update(work, scene);
    const ids = await shown;
    return {
      ids,
      drawn: [...document.querySelectorAll<HTMLElement>("[data-module-id]")]
        .map((e) => e.dataset.moduleId)
        .sort(),
      zoomedOut: view.view.scale < before,
    };
  });
  expect(result.drawn).toEqual([...result.ids].sort());
  expect(result.drawn).toContain("added");
  expect(result.drawn).not.toContain("heading");
  expect(result.zoomedOut).toBe(true);
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});

it("draws with materials: fitted pictures, library drawing code, effects, and pictures that develop later", async () => {
  const pictures = seed("pictures");
  const apple = useOf(pictures.find((m) => m.id === "apple")!)!;
  work.materials = {
    apple,
    "g-late": {
      ...(apple as Extract<typeof apple, { kind: "picture" }>),
      id: "g-late",
      url: "/materials/files/g-late",
      status: "developing",
    },
    arrow: libraryDrawing("arrow"),
    "pencil-grain": useOf(
      seed("effects").find((m) => m.id === "pencil-grain")!,
    )!,
  };
  work.drawings.picture = {
    id: "picture",
    name: "图",
    source: "return api.material(api.data.id)",
  };
  work.drawings.flow = {
    id: "flow",
    name: "流",
    source: `const svg = await api.draw("arrow", { label: "光", flow: true });
svg.querySelector("path").setAttribute("filter", api.effect("pencil-grain"));
return svg;`,
  };
  const at = (id: string, x: number, drawingId: string) => ({
    id,
    label: id,
    drawingId,
    data: { id },
    bounds: { x, y: 0, width: 300, height: 150 },
  });
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      at("apple", 0, "picture"),
      at("g-late", 400, "picture"),
      at("flow", 800, "flow"),
    ],
    links: [],
    checks: [],
  };
  // A developing picture holds up the page's load event, but not the canvas.
  await page.goto(origin + "/api/works/fixture/scenes/root?revision=1", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.drawyReady);
  const result = await page.evaluate(() => {
    const host = (id: string) =>
      document.querySelector(`[data-module-id="${id}"]`)!.shadowRoot!;
    const img = host("apple").querySelector("img")!;
    const frame = host("apple")
      .querySelector<HTMLElement>("[data-material]")!
      .getBoundingClientRect();
    const b = img.getBoundingClientRect();
    return {
      // The picture's visible content fills the box's height: its frame is a little larger.
      contained: b.height >= frame.height && b.height < frame.height * 1.05,
      late: host("g-late")
        .querySelector("img")!
        .hasAttribute("data-developing"),
      arrow:
        !!host("flow").querySelector("path.flow") &&
        !!host("flow").querySelector("text"),
      effect: !!host("flow").querySelector("filter#fx-pencil-grain"),
      errors: window.drawyErrors,
    };
  });
  expect(result).toEqual({
    contained: true,
    late: true,
    arrow: true,
    effect: true,
    errors: [],
  });
  // The canvas was ready before the late picture; the capture waits for it.
  const developed = page.evaluate(() => window.drawyView.renderer.developed());
  develop();
  await developed;
  expect(
    await page.evaluate(() =>
      document
        .querySelector('[data-module-id="g-late"]')!
        .shadowRoot!.querySelector("img")!
        .hasAttribute("data-developing"),
    ),
  ).toBe(false);
});
it("stands pictures on their box, reports where they are seen and wires library controls to the scene", async () => {
  const apple = useOf(seed("pictures").find((m) => m.id === "apple")!)!;
  work.materials = {
    apple,
    slider: libraryDrawing("slider"),
  };
  work.drawings.picture = {
    id: "picture",
    name: "图",
    source: 'return api.material("apple")',
  };
  work.drawings.control = {
    id: "control",
    name: "滑块",
    source: 'return api.draw("slider", api.data)',
  };
  work.drawings.readout = {
    id: "readout",
    name: "读数",
    source: "return api.html(`<b>${api.data.value}</b>`)",
  };
  const reactScript =
    'api.on("length", "change", (v) => api.set("readout", { value: v }));';
  const at = (
    id: string,
    drawingId: string,
    y: number,
    height: number,
    data = {},
  ) => ({
    id,
    label: id,
    drawingId,
    data,
    bounds: { x: 0, y, width: 300, height },
  });
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      at("apple", "picture", 0, 400),
      at("length", "control", 420, 56, {
        label: "摆长",
        min: 0,
        max: 2,
        step: 0.5,
        value: 1,
        unit: "m",
      }),
      at("readout", "readout", 500, 40, { value: 1 }),
    ],
    links: [],
    checks: [],
    interaction: reactScript,
  };
  const [shot] = await capture(browser, {
    origin,
    cookie: "fixture",
    scenes: [
      {
        id: "root",
        url: origin + "/api/works/fixture/scenes/root?revision=1",
        checks: [],
        overview: true,
      },
    ],
  });
  const seen = shot.modules!.find((m) => m.id === "apple")!.pictures![0];
  // The box is taller than the apple: the apple fills its width and rests on the bottom.
  expect(seen.material).toBe("apple");
  expect(seen.x).toBeLessThanOrEqual(2);
  expect(Math.abs(seen.y + seen.height - 400)).toBeLessThanOrEqual(2);
  expect(seen.height).toBeLessThan(330);
  await open();
  await page.evaluate(() => {
    const input = document
      .querySelector('[data-module-id="length"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = "1.5";
    input.dispatchEvent(new Event("input"));
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-module-id="readout"]')!
        .shadowRoot!.querySelector("b")?.textContent === "1.5",
  );
  expect(
    await page.evaluate(
      () =>
        document
          .querySelector('[data-module-id="length"]')!
          .shadowRoot!.querySelector(".v")!.textContent,
    ),
  ).toBe("1.5 m");
});


it("routes elbow arrows out of their modules before turning, going round when the ends face away", async () => {
  const drawings = seed("drawings") as DrawingMaterial[];
  work.materials = Object.fromEntries(
    drawings
      .filter((m) => m.id === "node" || m.id === "arrow")
      .map((m) => [
        m.id,
        useOf({
          ...m,
          source: readFileSync(
            new URL(`../../content/seed/drawings/${m.id}.js`, import.meta.url),
            "utf8",
          ),
        } as Material)!,
      ]),
  );
  const box = (id: string, x: number, y: number) => ({
    id,
    label: id,
    drawingId: "node",
    data: { title: id },
    bounds: { x, y, width: 200, height: 60 },
  });
  const link = (
    id: string,
    from: [string, Side],
    to: [string, Side],
    data: Record<string, unknown> = {},
  ) => ({
    id,
    drawingId: "arrow",
    from: { moduleId: from[0], at: from[1] },
    to: { moduleId: to[0], at: to[1] },
    data: { route: "elbow", ...data },
  });
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      // The order flowchart's out-of-stock branch: left side to left side, below and right.
      box("lack", 0, 0),
      box("end", 400, 600),
      // Back to back: the right side of one to the left side of one further left.
      box("late", 1200, 0),
      box("early", 900, 300),
      // Out of the bottom into the left side of one above.
      box("low", 0, 1000),
      box("high", 400, 800),
    ],
    links: [
      link("same", ["lack", "left"], ["end", "left"], { bend: -0.5 }),
      link("back", ["late", "right"], ["early", "left"]),
      link("up", ["low", "bottom"], ["high", "left"]),
    ],
    checks: [],
  };
  await open();
  const routes = await page.evaluate(() => {
    const bounds = (id: string) => {
      const s = document.querySelector<HTMLElement>(`[data-module-id="${id}"]`)!.style;
      return {
        x: parseFloat(s.left),
        y: parseFloat(s.top),
        right: parseFloat(s.left) + parseFloat(s.width),
        bottom: parseFloat(s.top) + parseFloat(s.height),
      };
    };
    return Object.fromEntries(
      [
        ["same", "lack", "end"],
        ["back", "late", "early"],
        ["up", "low", "high"],
      ].map(([id, from, to]) => {
        const host = document.querySelector<HTMLElement>(`[data-link-id="${id}"]`)!;
        const path = host.shadowRoot!.querySelector("path")!;
        const length = path.getTotalLength();
        const points = Array.from({ length: 201 }, (_, i) => {
          const p = path.getPointAtLength((length * i) / 200);
          return { x: p.x + parseFloat(host.style.left), y: p.y + parseFloat(host.style.top) };
        });
        const boxes = [bounds(from), bounds(to)];
        return [
          id,
          {
            // Points of the line strictly inside either module, or on its edge.
            inside: points.filter((p) =>
              boxes.some((b) => p.x > b.x - 1 && p.x < b.right + 1 && p.y > b.y - 1 && p.y < b.bottom + 1),
            ).length,
            start: points[0],
            first: (({ x, y }) => ({
              x: x + parseFloat(host.style.left),
              y: y + parseFloat(host.style.top),
            }))(path.getPointAtLength(4)),
          },
        ];
      }),
    );
  });
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
  for (const route of Object.values(routes)) expect(route.inside).toBe(0);
  // Each leaves straight out of its side: left, right and down.
  expect(routes.same.first.x).toBeLessThan(routes.same.start.x);
  expect(Math.abs(routes.same.first.y - routes.same.start.y)).toBeLessThan(0.01);
  expect(routes.back.first.x).toBeGreaterThan(routes.back.start.x);
  expect(routes.up.first.y).toBeGreaterThan(routes.up.start.y);
  expect(Math.abs(routes.up.first.x - routes.up.start.x)).toBeLessThan(0.01);
});

it("draws a city's real streets under a walk through it, and says so when they cannot load", async () => {
  work.materials = { geomap: libraryDrawing("geomap") };
  // A walk of a few kilometres with no bounds given: the view fits the stops, not a
  // region around them.
  const walk = {
    places: [
      { name: "北京路", lon: 113.2695, lat: 23.1232 },
      { name: "海珠桥", lon: 113.2727, lat: 23.1145 },
      { name: "二沙岛", lon: 113.2985, lat: 23.1122 },
    ],
    routes: [{ points: ["北京路", "海珠桥", "二沙岛"], color: "#123456" }],
    // A name the data gives, shown in another language, and picked out by that name.
    names: { 珠江: "Pearl River" },
    highlights: [{ river: "Pearl River", color: "#abcdef" }],
  };
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      {
        id: "walk",
        label: "walk",
        drawingId: "geomap",
        data: walk,
        bounds: { x: 0, y: 0, width: 960, height: 600 },
      },
    ],
    links: [],
  };
  const look = () =>
    page.evaluate(() => {
      const root = document.querySelector(
        '[data-module-id="walk"]',
      )!.shadowRoot!;
      return {
        errors: window.drawyErrors,
        text: [...root.querySelectorAll("text")].map((t) => t.textContent),
        tiles: root.querySelectorAll('clipPath[id^="geomap-tile-"]').length,
        highlight: root.querySelectorAll('path[stroke="#abcdef"]').length,
        scale: [...root.querySelectorAll("text")]
          .map((t) => t.textContent!)
          .find((t) => / km$/.test(t)),
      };
    });
  await open();
  const city = await look();
  expect(city.errors).toEqual([]);
  expect(city.tiles).toBeGreaterThan(1);
  // The Pearl River under the name given for it, the roads the tile names, and the
  // data's credit; the river picked out by its new name.
  expect(city.text).toEqual(
    expect.arrayContaining(["Pearl River", "© OpenStreetMap"]),
  );
  expect(city.text).not.toContain("珠江");
  expect(city.highlight).toBe(1);
  expect(city.text.length).toBeGreaterThan(6);
  expect(parseFloat(city.scale!)).toBeLessThanOrEqual(2);

  // A historical map leaves today's roads off but keeps OpenStreetMap's coast and water,
  // rather than falling back to Natural Earth's coarse one.
  const paths = () =>
    page.evaluate(
      () =>
        document
          .querySelector('[data-module-id="walk"]')!
          .shadowRoot!.querySelectorAll('clipPath[id^="geomap-tile-"] + g path')
          .length,
    );
  const withRoads = await paths();
  await page.evaluate(() => {
    const work = structuredClone(window.drawyData.work),
      scene = work.scenes.root;
    scene.modules[0].data = { ...scene.modules[0].data, roads: false };
    window.drawyView.update(work, scene);
  });
  await page.waitForFunction(
    (n) =>
      document
        .querySelector('[data-module-id="walk"]')!
        .shadowRoot!.querySelectorAll('clipPath[id^="geomap-tile-"] + g path')
        .length < n,
    withRoads,
    { timeout: 2500 },
  );
  const plain = await look();
  expect(plain.errors).toEqual([]);
  expect(plain.tiles).toBe(city.tiles);
  expect(plain.text).toEqual(
    expect.arrayContaining(["Pearl River", "© OpenStreetMap"]),
  );
  expect(plain.text.length).toBeLessThan(city.text.length);
  expect(await paths()).toBeGreaterThan(0);

  try {
    for (const down of ["error", "offline"] as const) {
      streetsDown = down;
      await page.reload();
      await page.waitForFunction(() => window.drawyReady);
      const blank = await look();
      expect(blank.errors).toEqual([]);
      expect(blank.tiles).toBe(0);
      expect(blank.text).toContain("街道底图暂时读取失败");
    }
    // Back online, the same page draws the streets the next time the map is drawn.
    streetsDown = false;
    await page.evaluate(() => {
      const work = structuredClone(window.drawyData.work),
        scene = work.scenes.root;
      scene.modules[0].data = { ...scene.modules[0].data, size: 15 };
      window.drawyView.update(work, scene);
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-module-id="walk"]')
          ?.shadowRoot?.querySelectorAll('clipPath[id^="geomap-tile-"]').length,
      null,
      { timeout: 2500 },
    );
  } finally {
    streetsDown = false;
  }
});

it("draws links from ends they hold, following their modules, and every drawing with its defaults", async () => {
  const box = (id: string, x: number, y: number) => ({
    id,
    drawingId: "tinted",
    bounds: { x, y, width: 100, height: 60 },
    data: id === "own" ? { fill: "#00ff00" } : {},
  });
  work.drawings.tinted = {
    id: "tinted",
    name: "带默认值",
    defaults: { fill: "#ff0000", size: 30 },
    source: "return api.html(`<div id='t' style='width:${api.width}px;height:${api.height}px;background:${api.data.fill};font-size:${api.data.size}px'>字</div>`)",
  };
  work.drawings.tally = {
    id: "tally",
    name: "组合",
    source: "const inner = await api.draw('tinted', {size: 40}, {width: 50, height: 20}); const root = api.html(''); root.append(inner); return root;",
  };
  work.scenes.root = {
    ...work.scenes.root,
    modules: [box("a", 0, 0), box("b", 400, 0), box("own", 0, 300), { ...box("nest", 400, 300), drawingId: "tally" }],
    links: [
      { id: "auto", drawingId: "connector", from: { moduleId: "a" }, to: { moduleId: "b" }, data: {} },
      { id: "point", drawingId: "connector", from: { moduleId: "a", at: [0.25, 1] }, to: { moduleId: "b", at: "bottom" }, data: {} },
    ],
    checks: [],
  };
  delete work.scenes.root.interaction;
  await open();
  const read = () =>
    page.evaluate(() => {
      const r = window.drawyView.renderer;
      const ends = (id: string) => r.ends(r.links.get(id)!);
      const fill = (id: string, q = "#t") =>
        document.querySelector(`[data-module-id="${id}"]`)!.shadowRoot!.querySelector<HTMLElement>(q)!.style;
      return {
        errors: window.drawyErrors,
        auto: ends("auto"),
        point: ends("point"),
        colors: [fill("a").background, fill("own").background],
        nested: fill("nest").fontSize,
      };
    });
  const before = await read();
  expect(before.errors).toEqual([]);
  expect(before.auto).toEqual({ from: { x: 100, y: 30, side: "right" }, to: { x: 400, y: 30, side: "left" } });
  expect(before.point).toEqual({ from: { x: 25, y: 60, side: "bottom" }, to: { x: 450, y: 60, side: "bottom" } });
  // The default shows until a module's own data says otherwise; a drawing draws another of the work's.
  expect(before.colors).toEqual(["rgb(255, 0, 0)", "rgb(0, 255, 0)"]);
  expect(before.nested).toBe("40px");
  await page.evaluate(() => window.drawyView.renderer.move([{ id: "b", bounds: { x: 0, y: 500, width: 100, height: 60 } }]));
  const after = await read();
  // Only the end with no place of its own changes side; the one with a place stays on it.
  expect(after.auto).toEqual({ from: { x: 50, y: 60, side: "bottom" }, to: { x: 50, y: 500, side: "top" } });
  expect(after.point).toEqual({ from: { x: 25, y: 60, side: "bottom" }, to: { x: 50, y: 560, side: "bottom" } });
});

it("tints recolourable picture icons with the picture drawing's color parameter", async () => {
  const pictureSource = readFileSync(new URL("../../content/seed/drawings/picture.js", import.meta.url), "utf8");
  work.drawings.picture = { id: "picture", name: "图片", defaults: {}, source: pictureSource };
  work.materials["u-ring"] = {
    id: "u-ring",
    kind: "picture",
    name: "圆圈图标",
    type: "icon",
    style: null,
    url: "/materials/files/u-ring",
    width: 24,
    height: 24,
    content: { x: 0, y: 0, width: 1, height: 1 },
    anchors: {},
    opaque: false,
    recolor: true,
    status: "ready",
  };
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      {
        id: "icon",
        label: "图标",
        drawingId: "picture",
        data: { material: "u-ring", color: "#275DAD" },
        bounds: { x: 40, y: 40, width: 64, height: 64 },
      },
    ],
    links: [],
    checks: [],
  };
  delete work.scenes.root.interaction;
  await open();
  const src = await page.evaluate(() =>
    document.querySelector('[data-module-id="icon"]')?.shadowRoot?.querySelector("img")?.getAttribute("src"),
  );
  expect(src).toBe("/materials/files/u-ring?color=%23275DAD");
});

it("draws a picture brought in from another tool as its whole file fills the box, margins and hard edges kept", async () => {
  work.drawings[importedPicture.id] = importedPicture;
  work.materials["u-photo"] = {
    id: "u-photo",
    kind: "picture",
    name: "照片",
    type: "scene",
    style: null,
    url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="25" y="25" width="50" height="50"/></svg>')}`,
    width: 50,
    height: 50,
    content: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    anchors: {},
    opaque: true,
    recolor: false,
    status: "ready",
  };
  work.scenes.root = {
    ...work.scenes.root,
    modules: [{ id: "photo", label: "照片", drawingId: importedPicture.id, data: { material: "u-photo" }, bounds: { x: 40, y: 40, width: 120, height: 120 } }],
    links: [],
    checks: [],
  };
  delete work.scenes.root.interaction;
  await open();
  const drawn = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-module-id="photo"]')!;
    const img = host.shadowRoot!.querySelector("img")!;
    const [a, b] = [host.getBoundingClientRect(), img.getBoundingClientRect()];
    return { width: b.width / a.width, height: b.height / a.height, left: b.left - a.left, top: b.top - a.top, mask: getComputedStyle(img).maskImage };
  });
  expect(drawn).toEqual({ width: 1, height: 1, left: 0, top: 0, mask: "none" });
});

it("patches untouched modules in place on AI updates and developing-to-ready picture transitions", async () => {
  const pictureSource = readFileSync(new URL("../../content/seed/drawings/picture.js", import.meta.url), "utf8");
  const svgData = (fill: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`)}`;
  work.drawings.picture = { id: "picture", name: "图片", defaults: {}, source: pictureSource };
  work.drawings.card = {
    id: "card",
    name: "卡片",
    defaults: {},
    source: "return api.html(`<div class='card'>${api.data.text}</div>`)",
  };
  work.materials["pic-ready"] = {
    id: "pic-ready",
    kind: "picture",
    name: "已就绪图",
    type: "icon",
    style: "colored-pencil",
    url: svgData("#317369"),
    width: 64,
    height: 64,
    content: { x: 0, y: 0, width: 1, height: 1 },
    anchors: {},
    opaque: false,
    recolor: false,
    status: "ready",
  };
  work.materials["pic-dev"] = {
    id: "pic-dev",
    kind: "picture",
    name: "生成中图",
    type: "icon",
    style: "colored-pencil",
    url: svgData("#c8553d"),
    width: 64,
    height: 64,
    content: { x: 0, y: 0, width: 1, height: 1 },
    anchors: {},
    opaque: false,
    recolor: false,
    status: "developing",
  };
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      { id: "steady", label: "不变", drawingId: "card", data: { text: "steady" }, bounds: { x: 40, y: 40, width: 120, height: 60 } },
      { id: "pic1", label: "图1", drawingId: "picture", data: { material: "pic-ready" }, bounds: { x: 200, y: 40, width: 64, height: 64 } },
      { id: "pic2", label: "图2", drawingId: "picture", data: { material: "pic-dev" }, bounds: { x: 300, y: 40, width: 64, height: 64 } },
      { id: "mover", label: "平移", drawingId: "card", data: { text: "move" }, bounds: { x: 40, y: 160, width: 120, height: 60 } },
    ],
    links: [],
    checks: [],
  };
  delete work.scenes.root.interaction;
  await open();

  // Capture existing DOM references before updates.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const pick = (id: string) => {
      const host = document.querySelector(`[data-module-id="${id}"]`)!;
      return { host, inner: host.shadowRoot!.lastElementChild! };
    };
    w.__before = {
      renderer: window.drawyView.renderer,
      steady: pick("steady"),
      pic1: pick("pic1"),
      pic2: pick("pic2"),
      mover: pick("mover"),
    };
  });

  // 1) Picture transitions from developing -> ready on the same revision (quiet = false).
  await page.evaluate(async () => {
    const next = structuredClone(window.drawyData.work);
    const pic = next.materials["pic-dev"];
    if (pic.kind === "picture") {
      pic.status = "ready";
      pic.width = 80;
      pic.height = 80;
    }
    window.drawyView.update(next, next.scenes.root, false);
    await window.drawyView.drawn(["pic2"], next.revision);
  });

  const afterDevelop = await page.evaluate(() => {
    const w = window as unknown as {
      __before: {
        renderer: unknown;
        steady: { host: Element; inner: Element };
        pic1: { host: Element; inner: Element };
        pic2: { host: Element; inner: Element };
        mover: { host: Element; inner: Element };
      };
    };
    const sameInner = (id: string, prev: { host: Element; inner: Element }) => {
      const host = document.querySelector(`[data-module-id="${id}"]`)!;
      return host === prev.host && host.shadowRoot!.lastElementChild === prev.inner;
    };
    return {
      errors: window.drawyErrors,
      sameRenderer: window.drawyView.renderer === w.__before.renderer,
      steadyUnchanged: sameInner("steady", w.__before.steady),
      pic1Unchanged: sameInner("pic1", w.__before.pic1),
      pic2Redrawn:
        document.querySelector('[data-module-id="pic2"]') === w.__before.pic2.host &&
        document.querySelector('[data-module-id="pic2"]')!.shadowRoot!.lastElementChild !== w.__before.pic2.inner,
      pic2DevelopingAttr: document
        .querySelector('[data-module-id="pic2"]')!
        .shadowRoot!.querySelector("[data-developing]") !== null,
    };
  });
  expect(afterDevelop).toEqual({
    errors: [],
    sameRenderer: true,
    steadyUnchanged: true,
    pic1Unchanged: true,
    pic2Redrawn: true,
    pic2DevelopingAttr: false,
  });

  // 2) AI revision update (quiet = false) edits one module and moves another without recreating untouched ones.
  await page.evaluate(async () => {
    const next = structuredClone(window.drawyData.work);
    next.revision += 1;
    const pic = next.materials["pic-dev"];
    if (pic.kind === "picture") {
      pic.status = "ready";
      pic.width = 80;
      pic.height = 80;
    }
    const steady = next.scenes.root.modules.find((m) => m.id === "steady")!;
    steady.data = { text: "updated" };
    const mover = next.scenes.root.modules.find((m) => m.id === "mover")!;
    mover.bounds = { ...mover.bounds, x: 80, y: 200 };
    window.drawyView.update(next, next.scenes.root, false);
    await window.drawyView.drawn(["steady", "mover"], next.revision);
  });

  const afterRevision = await page.evaluate(() => {
    const w = window as unknown as {
      __before: {
        renderer: unknown;
        pic1: { host: Element; inner: Element };
        mover: { host: Element; inner: Element };
      };
    };
    const steadyText = document
      .querySelector('[data-module-id="steady"]')!
      .shadowRoot!.querySelector(".card")!.textContent;
    const moverHost = document.querySelector<HTMLElement>('[data-module-id="mover"]')!;
    const pic1Host = document.querySelector('[data-module-id="pic1"]')!;
    return {
      errors: window.drawyErrors,
      sameRenderer: window.drawyView.renderer === w.__before.renderer,
      steadyText,
      pic1Unchanged:
        pic1Host === w.__before.pic1.host &&
        pic1Host.shadowRoot!.lastElementChild === w.__before.pic1.inner,
      moverMovedInPlace:
        moverHost === w.__before.mover.host &&
        moverHost.shadowRoot!.lastElementChild === w.__before.mover.inner &&
        moverHost.style.left === "80px" &&
        moverHost.style.top === "200px",
    };
  });
  expect(afterRevision).toEqual({
    errors: [],
    sameRenderer: true,
    steadyText: "updated",
    pic1Unchanged: true,
    moverMovedInPlace: true,
  });
});

it("lays out plans, comparisons, part labels, group frames and replicas from the library", async () => {
  work.materials = Object.fromEntries(
    ["swimlanes", "compare", "leader-label", "region", "node"].map((id) => [id, libraryDrawing(id)]),
  );
  const at = (id: string, drawingId: string, x: number, y: number, width: number, height: number, data: Record<string, unknown>) => ({
    id,
    label: id,
    drawingId,
    data,
    bounds: { x, y, width, height },
  });
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      at("plan", "swimlanes", 0, 0, 500, 236, {
        lanes: ["平台", { label: "AI", color: "#2f6fd6" }],
        stages: ["Q1", "Q2", { label: "Q3", accent: true }, "Q4"],
        header: 100,
        size: 14,
      }),
      at("grid", "compare", 0, 260, 500, 200, {
        columns: [{ label: "Kafka", color: "#7137c4" }, "RocketMQ"],
        numbered: true,
        labelWidth: 140,
        headerHeight: 40,
        rows: [
          { label: "延迟消息", values: [false, true] },
          { label: "消费进度", values: [null, "Broker"] },
        ],
      }),
      at("part", "leader-label", 520, 0, 200, 120, { text: "胃", side: "left", textAt: 0.2, target: { x: 0.9, y: 0.8 } }),
      at("host", "region", 520, 140, 240, 160, { shape: "box", label: "应用主机", color: "#667780" }),
      at("api", "node", 540, 320, 180, 90, { title: "API", stack: 2 }),
    ],
    links: [],
  };
  await open();
  const look = await page.evaluate(() => {
    const root = (id: string) => document.querySelector(`[data-module-id="${id}"]`)!.shadowRoot!;
    const texts = (id: string) =>
      [...root(id).querySelectorAll("text")].map((t) => ({
        text: t.textContent,
        x: Number(t.getAttribute("x")),
        y: Number(t.getAttribute("y")),
      }));
    return {
      errors: window.drawyErrors,
      plan: texts("plan"),
      dashes: root("plan").querySelectorAll("path[stroke-dasharray]").length,
      grid: texts("grid"),
      tints: [...root("grid").querySelectorAll("rect")].map((r) => r.getAttribute("fill")),
      leader: root("part").querySelector("path")!.getAttribute("d"),
      part: texts("part"),
      host: { dash: root("host").querySelector("rect")!.getAttribute("stroke-dasharray"), label: texts("host")[0] },
      copies: root("api").querySelectorAll("svg > g").length,
    };
  });
  expect(look.errors).toEqual([]);
  // Stages cross the lanes: named along the top, each centred over its quarter of the run.
  const q2 = look.plan.find((t) => t.text === "Q2")!;
  expect(q2.x).toBeCloseTo(100 + (400 * 1.5) / 4);
  expect(q2.y).toBeLessThan(14 * 2.6);
  expect(look.dashes).toBe(3);
  // A false shows a dash and an empty cell stays clear; the coloured column has its band.
  expect(look.grid.map((t) => t.text)).toEqual(["Kafka", "RocketMQ", "1", "延迟消息", "2", "消费进度", "Broker"]);
  expect(look.tints).toContain("#7137c4");
  // The leader bends once and runs level into text set at a fifth of the side.
  expect(look.leader!.match(/L/g)).toHaveLength(2);
  expect(look.part[0].y).toBeCloseTo(24);
  expect(look.host.dash).not.toBe("none");
  expect(look.host.label).toMatchObject({ text: "应用主机", x: 15 * 0.8 });
  // Two copies, the paper under the block, and the block itself.
  expect(look.copies).toBe(4);
});
it("problem 3B: a numbered message's words are marked as its data, the number drawn apart", async () => {
  const sequence = seed("drawings").find((m) => m.id === "sequence") as DrawingMaterial;
  work.materials = { sequence: libraryDrawing("sequence") };
  work.scenes.root = {
    ...work.scenes.root,
    modules: [{ id: "seq", label: "seq", drawingId: "sequence", data: { ...sequence.example, numbered: true }, bounds: { x: 0, y: 0, ...sequence.size } }],
    links: [],
    checks: [],
  };
  await open();
  const marked = await page.evaluate(() =>
    [...document.querySelector('[data-module-id="seq"]')!.shadowRoot!.querySelectorAll("[data-edp-text]")].map((el) => el.textContent),
  );
  // The words a person retypes are the label alone; "1." is drawn in an element of its own.
  expect(marked).toContain("登录请求");
});

/** The library drawings whose every word from their data is marked as that data, so a
 * person changes it where it is drawn. Every structured drawing joins as it is upgraded. */
const STRUCTURED = [
  ...["sequence", "steps", "timeline", "mindmap", "hierarchy", "swimlanes", "compare", "checklist"],
  ...["bars", "donut", "plot", "gantt", "radar"],
  ...["quadrant", "pyramid", "venn", "layers", "fishbone", "cycle", "concentric"],
];
// The map's example needs tiles these tests do not hold; it is checked on a city below.
/** Drawings without lists in their examples that mark their words all the same. */
const EDITABLE = [...STRUCTURED, "node", "callout", "gauge", "stat", "leader-label", "region"];
it("marks every word a structured library drawing draws from its example as the data it comes from", async () => {
  const drawings = (seed("drawings") as DrawingMaterial[]).filter((m) => EDITABLE.includes(m.id));
  work.materials = Object.fromEntries([...drawings.map((m) => libraryDrawing(m.id)), ...seed("effects").map((m) => useOf(m)!)].map((m) => [m.id, m]));
  let y = 0;
  work.scenes.root = {
    ...work.scenes.root,
    modules: drawings.flatMap((m) =>
      [m.example, { ...m.example, numbered: true }].map((data, i) => {
        const placed = { id: `${m.id}-${i}`, label: m.id, drawingId: m.id, data, bounds: { x: 0, y, ...m.size } };
        y += m.size.height + 60;
        return placed;
      }),
    ),
    links: [],
    checks: [],
  };
  await open();
  const found = await page.evaluate(() => {
    const view = window.drawyView;
    return [...document.querySelectorAll<HTMLElement>("[data-module-id]")].map((h) => {
      const id = h.dataset.moduleId!;
      const map = view.editMap(id);
      return { id, unmarked: view.unmarked(id).map((t) => t.path), parts: map?.parts.length ?? 0, texts: map?.texts.length ?? 0, slots: map?.slots.length ?? 0, anchors: map?.anchors.length ?? 0 };
    });
  });
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
  for (const f of found) {
    expect(f.unmarked, f.id).toEqual([]);
    if (STRUCTURED.includes(f.id.replace(/-\d+$/, ""))) expect(f.parts, f.id).toBeGreaterThan(0);
    expect(f.texts, f.id).toBeGreaterThan(0);
  }
  // The sequence diagram: three participants and five messages and a note are parts, with
  // slots round both lists and a lifeline for each participant.
  expect(found.find((f) => f.id === "sequence-0")).toMatchObject({ parts: 9, slots: 4 + 6, anchors: 3 });
});
it("marks a map's places and routes as its data, with handles that move them in longitude and latitude", async () => {
  work.materials = { geomap: libraryDrawing("geomap") };
  const data = {
    places: [
      { id: "road", name: "北京路", lon: 113.2695, lat: 23.1232, note: "起点" },
      { id: "bridge", name: "海珠桥", lon: 113.2727, lat: 23.1145 },
      { id: "isle", name: "二沙岛", lon: 113.2985, lat: 23.1122 },
    ],
    routes: [{ id: "walk", points: ["road", [113.28, 23.118], "isle"], label: "步行" }],
  };
  work.scenes.root = {
    ...work.scenes.root,
    modules: [{ id: "map", label: "map", drawingId: "geomap", data, bounds: { x: 0, y: 0, width: 960, height: 600 } }],
    links: [],
    checks: [],
  };
  delete work.scenes.root.interaction;
  await open();
  const found = await page.evaluate(() => {
    const view = window.drawyView;
    const map = view.editMap("map")!;
    const place = map.handles.find((h) => h.path === "places.#bridge")!;
    const turn = map.handles.find((h) => h.path === "routes.#walk.points.1")!;
    return {
      unmarked: view.unmarked("map").map((t) => t.path),
      parts: map.parts.map((p) => p.path).sort(),
      texts: map.texts.map((t) => t.path).sort(),
      handles: map.handles.map((h) => h.path).sort(),
      // Where the handle stands reads back as the place it stands for.
      place: place.unproject!(place.at.x, place.at.y),
      turn: turn.unproject!(turn.at.x, turn.at.y),
    };
  });
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
  expect(found.unmarked).toEqual([]);
  expect(found.parts).toEqual(["places.#bridge", "places.#isle", "places.#road", "routes.#walk"]);
  expect(found.texts).toEqual(["places.#bridge.name", "places.#isle.name", "places.#road.name", "places.#road.note", "routes.#walk.label"]);
  expect(found.handles).toEqual(["places.#bridge", "places.#isle", "places.#road", "routes.#walk.points.1"]);
  expect(found.place).toEqual({ lon: 113.27, lat: 23.11 });
  expect(found.turn).toEqual([113.28, 23.12]);
});
it("reports to the author the words from a drawing's data it draws without marking them", async () => {
  const card = (marked: boolean) =>
    `return api.svg('<svg viewBox="0 0 200 80"><text x="10" y="30"${marked ? "' + api.text('title') + '" : ""}>' + api.data.title + '</text><text x="10" y="60">' + api.data.tag + '</text></svg>')`;
  const params = { title: { type: "text", label: { zh: "标题", en: "Title" } }, tag: { type: "text", label: { zh: "标签", en: "Tag" } } };
  work.drawings.card = { id: "card", name: "卡片", params, source: card(false) } as never;
  work.drawings.marked = { id: "marked", name: "标好的卡片", params, source: card(true) } as never;
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      { id: "plain", drawingId: "card", bounds: { x: 0, y: 0, width: 200, height: 80 }, data: { title: "心脏", tag: "器官" } },
      { id: "kept", drawingId: "marked", bounds: { x: 0, y: 120, width: 200, height: 80 }, data: { title: "肺", tag: "器官" } },
    ],
    links: [],
    checks: [],
  };
  delete work.scenes.root.interaction;
  await open();
  const { unmarked } = await page.evaluate(readText, 14);
  expect(unmarked).toEqual([
    { moduleId: "plain", path: "title", text: "心脏" },
    { moduleId: "plain", path: "tag", text: "器官" },
    { moduleId: "kept", path: "tag", text: "器官" },
  ]);
});
it("draws links along a drawn line's own path, riding on other links and to free points, and moves a line hanging from a module with it", async () => {
  work.drawings["sketch-line"] = sketchLine;
  work.drawings.tinted = { id: "tinted", name: "块", source: "return api.html(`<div style='width:${api.width}px;height:${api.height}px;background:#cde'></div>`)" };
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      { id: "a", drawingId: "tinted", bounds: { x: 0, y: 0, width: 100, height: 60 }, data: {} },
      // A line drawn corner to corner of its box: links meet it along its path, not the box.
      { id: "line", drawingId: "sketch-line", bounds: { x: 300, y: 0, width: 200, height: 200 }, data: { points: [[0, 0], [1, 1]] } },
    ],
    links: [
      { id: "life", drawingId: "connector", from: { moduleId: "a", at: "bottom" }, to: { x: 50, y: 400 }, data: {} },
      { id: "msg", drawingId: "connector", from: { linkId: "life", along: 0.5 }, to: { moduleId: "line", at: { along: 0.5 } }, data: {} },
    ],
    checks: [],
  };
  delete work.scenes.root.interaction;
  await open();
  const read = () =>
    page.evaluate(() => {
      const r = window.drawyView.renderer;
      return { life: r.ends(r.links.get("life")!), msg: r.ends(r.links.get("msg")!), outline: window.drawyView.editMap("line")?.outline.length };
    });
  const before = await read();
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
  expect(before.life).toEqual({ from: { x: 50, y: 60, side: "bottom" }, to: { x: 50, y: 400, side: null } });
  expect(before.msg.from).toEqual({ x: 50, y: 230, side: null });
  // Halfway along the drawn diagonal, the middle of its box, not a point of the box's edge.
  expect(before.msg.to.x).toBeCloseTo(400, 0);
  expect(before.msg.to.y).toBeCloseTo(100, 0);
  expect(before.outline).toBeGreaterThan(8);
  // Moving the box moves the line hanging from it whole, and the message riding on it.
  await page.evaluate(() => window.drawyView.renderer.move([{ id: "a", bounds: { x: 20, y: 40, width: 100, height: 60 } }]));
  const after = await read();
  expect(after.life).toEqual({ from: { x: 70, y: 100, side: "bottom" }, to: { x: 70, y: 440, side: null } });
  expect(after.msg.from).toEqual({ x: 70, y: 270, side: null });
  // A link listed before the one it rides on is drawn from that one's new place.
  await page.evaluate(async () => {
    const next = structuredClone(window.drawyData.work);
    const scene = next.scenes.root;
    // The box stays where it was moved: only the lifeline changes.
    scene.modules.find((m) => m.id === "a")!.bounds = { x: 20, y: 40, width: 100, height: 60 };
    const life = scene.links.find((l) => l.id === "life")!;
    life.to = { x: 90, y: 640 };
    scene.links = [scene.links.find((l) => l.id === "msg")!, life];
    window.drawyView.update(next, scene, false);
    await new Promise((r) => setTimeout(r, 100));
  });
  const reordered = await page.evaluate(() => {
    const r = window.drawyView.renderer;
    const host = document.querySelector<HTMLElement>('[data-link-id="msg"]')!;
    return { ends: r.ends(r.links.get("msg")!), left: parseFloat(host.style.left), top: parseFloat(host.style.top), bounds: r.bounds };
  });
  // The scene reaches down to the lifeline's free end, far below every module, so an export
  // and fitting the view take it in.
  expect(reordered.bounds.y + reordered.bounds.height).toBe(640);
  // Halfway down the lengthened lifeline, from (70, 100) to (90, 640).
  expect(reordered.ends.from).toEqual({ x: 80, y: 370, side: null });
  expect(reordered.left).toBeCloseTo(80 - 48, 0);
  expect(reordered.top).toBeCloseTo(Math.min(350, reordered.ends.to.y) - 48, 0);
});
