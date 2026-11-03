import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { documentFor } from "./document.ts";
import { fixture } from "./fixture.ts";
import { capture, readText } from "../observation/capture.ts";
import { fit, zoom } from "../contracts/geometry.ts";
import { useOf } from "../materials/index.ts";
import type { DrawingMaterial, Material } from "@drawy/materials/schema";
import { boil } from "../../materials/streets.ts";

/** Curated materials as the library serves them. */
const seed = (name: string) =>
  (
    JSON.parse(
      readFileSync(
        new URL(`../../materials/seed/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as Material[]
  ).map(
    (m) =>
      ({
        ...m,
        status: "ready",
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
        // Curated icons are SVG; the rest are WebP.
        const svg = new URL(
          `../../materials/seed/files/${id}.svg`,
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
              `../../materials/seed/files/${id === "g-late" ? "apple" : id}.webp`,
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
    } else if (url.pathname.startsWith("/materials/geo/relief/")) {
      res.setHeader("content-type", "image/webp");
      res.end(
        readFileSync(
          new URL(
            `../../materials/seed/geo/relief/${url.pathname.split("/").at(-1)}.webp`,
            import.meta.url,
          ),
        ),
      );
    } else if (url.pathname.startsWith("/materials/geo/")) {
      res.setHeader("content-type", "application/json");
      res.end(
        readFileSync(
          new URL(
            `../../materials/seed/geo/${url.pathname.split("/").at(-1)}.json`,
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
  await page.locator('[data-module-id="level-2"]').click();
  expect(await page.locator("article h1").innerText()).toBe("理解需求层次");
  await page.getByRole("button", { name: "← 返回图中" }).click();
  expect(await page.locator("article").count()).toBe(0);
  await page.locator('[data-action="explore"]').click();
  await page.waitForURL("**/child?revision=1");
  await page.waitForFunction(() => window.drawyReady);
  expect(await page.locator('[data-module-id="mermaid"] svg').count()).toBe(1);
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});
it("moves groups, resizes an isolated module and recomputes connected anchors", async () => {
  work.scenes.root.links.push({
    id: "connection",
    drawingId: "connector",
    from: { moduleId: "level-0", anchor: "right" },
    to: { moduleId: "level-4", anchor: "right" },
    data: {},
  });
  await open();
  await page.evaluate(() => {
    window.drawyView.setMovable(true);
    // A module follows a drag once it is selected.
    window.drawyView.select(["level-0"]);
    window.drawyView.options.commit = (moves) => {
      document.body.dataset.moves = JSON.stringify(moves);
    };
  });
  const scale = await page.evaluate(() => window.drawyView.view.scale);
  const box = (await page.locator('[data-module-id="level-0"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 40,
    box.y + box.height / 2 + 20,
    { steps: 4 },
  );
  await page.mouse.up();
  const moves = JSON.parse((await page.getAttribute("body", "data-moves"))!);
  expect(moves).toHaveLength(5);
  expect(moves[0].bounds.x).toBeCloseTo(
    work.scenes.root.modules[0].bounds.x + 40 / scale,
  );
  const before = await page
    .locator('[data-link-id="connection"] path')
    .getAttribute("d");
  // The handle at the selection's lower right corner resizes it.
  const handle = (await page.locator('[data-handle="se"]').boundingBox())!;
  const hx = handle.x + handle.width / 2,
    hy = handle.y + handle.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 60, hy + 20, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => window.drawyView.renderer.settled());
  const resized = JSON.parse((await page.getAttribute("body", "data-moves"))!);
  expect(resized).toHaveLength(1);
  expect(resized[0].bounds.width).toBeCloseTo(
    work.scenes.root.modules[0].bounds.width + 60 / scale,
  );
  expect(
    await page.locator('[data-link-id="connection"] path').getAttribute("d"),
  ).not.toBe(before);
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});
it("selects what is pressed while editing, instead of opening or operating it, and points at words and pictures", async () => {
  work.materials.apple = useOf(
    seed("pictures").find((m) => m.id === "apple")!,
  )!;
  work.drawings.fruit = {
    id: "fruit",
    name: "果",
    source: 'return api.material("apple")',
  };
  work.scenes.root.modules.push({
    id: "fruit",
    drawingId: "fruit",
    label: "苹果",
    data: {},
    bounds: { x: 700, y: 120, width: 160, height: 160 },
    anchors: {},
    group: null,
    target: null,
  });
  await open();
  await page.evaluate(() => {
    const view = window.drawyView,
      body = document.body.dataset;
    view.setMovable(true);
    view.setEditing(true);
    view.options.select = (s) =>
      (body.selected = s.map((x) => x.moduleId).join());
    view.options.open = (t) => (body.opened = t.id);
    view.options.point = (p) => (body.pointed = JSON.stringify(p));
  });
  const data = (key: string) =>
    page.evaluate((k) => document.body.dataset[k], key);
  // A level opens its explanation when explored; while editing, a press only selects it,
  // and Shift adds another.
  await page.locator('[data-module-id="level-0"]').click();
  expect(await data("selected")).toBe("level-0");
  await page
    .locator('[data-module-id="level-1"]')
    .click({ modifiers: ["Shift"] });
  expect(await data("selected")).toBe("level-0,level-1");
  expect(await data("opened")).toBeUndefined();
  // The drawing's own button is pressed without acting.
  await page.getByRole("button", { name: "强调基础" }).click();
  expect(await data("selected")).toBe("control");
  await page.waitForTimeout(150);
  await expect
    .poll(() =>
      page.locator('[data-module-id="level-4"] text').nth(1).textContent(),
    )
    .toBe("食物与休息");
  // Any module can be dragged at once.
  await page.evaluate(() => {
    window.drawyView.options.commit = (moves) =>
      (document.body.dataset.moves = JSON.stringify(moves.map((m) => m.id)));
  });
  const box = (await page.locator('[data-module-id="heading"]').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  expect(await data("moves")).toBe('["heading"]');
  // A double click says which words or which picture it landed on.
  await page
    .locator('[data-module-id="level-3"] text', { hasText: "安全需求" })
    .dblclick();
  expect(JSON.parse((await data("pointed"))!)).toEqual({
    kind: "text",
    moduleId: "level-3",
    text: "安全需求",
  });
  await page.getByRole("button", { name: "进入子场景" }).dblclick();
  expect(JSON.parse((await data("pointed"))!)).toMatchObject({
    moduleId: "control",
    text: "进入子场景",
  });
  await page.locator('[data-module-id="fruit"] img').dblclick();
  expect(JSON.parse((await data("pointed"))!)).toEqual({
    kind: "picture",
    moduleId: "fruit",
    material: "apple",
  });
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
      modules: [
        ...scene.modules,
        {
          id: "veil",
          drawingId: "veil",
          label: "罩",
          data: {},
          bounds: { x: 0, y: 0, width: 900, height: 600 },
          anchors: {},
          group: null,
          target: null,
        },
      ],
    });
  });
  await page.waitForFunction(() =>
    window.drawyView.renderer.instances.has("veil"),
  );
  await page.waitForTimeout(100);
  const level = (await page
    .locator('[data-module-id="level-2"] text')
    .first()
    .boundingBox())!;
  await page.mouse.click(level.x + level.width / 2, level.y + level.height / 2);
  expect(await data("selected")).toBe("level-2");
  const veil = (await page
    .locator('[data-module-id="veil"] circle')
    .boundingBox())!;
  await page.mouse.click(veil.x + veil.width / 2, veil.y + veil.height / 2);
  expect(await data("selected")).toBe("veil");
  // Leaving editing, the drawing works again.
  await page.evaluate(() => window.drawyView.setEditing(false));
  await page.getByRole("button", { name: "强调基础" }).click();
  await expect
    .poll(() =>
      page.locator('[data-module-id="level-4"] text').nth(1).textContent(),
    )
    .toBe("已突出基础需要");
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});
it("edits like a drawing app: a box selects, handles resize a selection as one, drags snap, dots draw links, and a right click asks for the menu", async () => {
  await open();
  await page.evaluate(() => {
    const view = window.drawyView,
      body = document.body.dataset;
    view.setMovable(true);
    view.setEditing(true);
    view.options.select = (s) =>
      (body.selected = s.map((x) => x.moduleId).join());
    view.options.commit = (moves) => (body.moves = JSON.stringify(moves));
    view.options.connect = (from, to) =>
      (body.linked = JSON.stringify({ from, to }));
    view.options.menu = (at) => (body.menu = JSON.stringify(at));
    view.options.place = (at) => (body.placed = JSON.stringify(at));
  });
  const data = (key: string) =>
    page.evaluate((k) => document.body.dataset[k], key);
  // Where a point of the scene is on screen now.
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
  const drag = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  };
  const scale = await page.evaluate(() => window.drawyView.view.scale);
  // Dragging over the paper selects what the box touches.
  await drag(await screen(120, 95), await screen(320, 220));
  expect(await data("selected")).toBe("level-0,level-1");
  // The handles on the box around two modules resize both in proportion.
  const corner = (await page.locator('[data-handle="se"]').boundingBox())!;
  await drag(
    { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 },
    { x: corner.x + corner.width / 2 + 50, y: corner.y + corner.height / 2 },
  );
  const resized = JSON.parse((await data("moves"))!);
  expect(resized.map((m: { id: string }) => m.id)).toEqual(["level-0", "level-1"]);
  const was = work.scenes.root.modules;
  expect(resized[1].bounds.width).toBeGreaterThan(was[1].bounds.width);
  expect(resized[0].bounds.width / resized[1].bounds.width).toBeCloseTo(
    was[0].bounds.width / was[1].bounds.width,
  );
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
  // A dot beside the selected module draws a link to the module it is dropped on.
  const dot = (await page.locator('[data-connect="right"]').boundingBox())!;
  const level = await screen(500, 350);
  await drag({ x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 }, level);
  expect(JSON.parse((await data("linked"))!)).toEqual({
    from: { moduleId: "heading", side: "right" },
    to: { moduleId: "level-2", side: expect.any(String) },
  });
  // A right click selects what it lands on and asks for the menu there.
  const safety = await screen(450, 450);
  await page.mouse.click(safety.x, safety.y, { button: "right" });
  expect(await data("selected")).toBe("level-3");
  const menu = JSON.parse((await data("menu"))!);
  expect(Math.abs(menu.x - safety.x)).toBeLessThan(2);
  expect(Math.abs(menu.y - safety.y)).toBeLessThan(2);
  // The placing tool says where in the scene it was pressed.
  await page.evaluate(() => window.drawyView.setTool("place"));
  const spot = await screen(900, 300);
  await page.mouse.click(spot.x, spot.y);
  const placed = JSON.parse((await data("placed"))!);
  expect(placed.x).toBeCloseTo(900, 0);
  expect(placed.y).toBeCloseTo(300, 0);
  await page.evaluate(() => {
    window.drawyView.setTool("select");
    window.drawyView.selectAll();
  });
  expect((await data("selected"))!.split(",")).toHaveLength(7);
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
    from: { moduleId: "level-0", anchor: "right" },
    to: { moduleId: "level-1", anchor: "right" },
    data: { label: "然后" },
  });
  await open();
  await page.evaluate(() => {
    const view = window.drawyView,
      body = document.body.dataset;
    view.setMovable(true);
    view.setEditing(true);
    view.options.select = (s) => (body.selected = s.map((x) => x.moduleId).join());
    view.options.selectLink = (id) => (body.link = id ?? "");
    view.options.reconnect = (id, end, to) =>
      (body.reconnected = JSON.stringify({ id, end, to }));
    view.options.point = (p) => (body.pointed = JSON.stringify(p));
  });
  const data = (key: string) =>
    page.evaluate((k) => document.body.dataset[k], key);
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
  // A press a few pixels off the line, between the modules, takes the link in place of
  // the selected module.
  const first = await screen(420, 150);
  await page.mouse.click(first.x, first.y);
  expect(await data("selected")).toBe("level-0");
  const between = await screen(565, 207);
  await page.mouse.click(between.x + 3, between.y);
  expect(await data("link")).toBe("next");
  expect(await data("selected")).toBe("");
  expect(await page.evaluate(() => window.drawyView.selectedLink)).toBe("next");
  // Its end is dragged onto another module, to the side facing where it is dropped.
  const end = (await page.locator('[data-link-end="to"]').boundingBox())!;
  const target = await screen(160, 457);
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  expect(JSON.parse((await data("reconnected"))!)).toEqual({
    id: "next",
    end: "to",
    to: { moduleId: "level-3", side: "left" },
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
  expect(await data("selected")).toBe("level-0");
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
it("lays the person's own change over what is drawn, redrawing only what changed", async () => {
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
      group: null,
      target: null,
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
it("passes over modules an interaction names once they are taken out of the scene", async () => {
  work.scenes.root.modules = work.scenes.root.modules.filter(
    (m) => m.id !== "level-4",
  );
  await open();
  await page.getByRole("button", { name: "强调基础" }).click();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
});
it("disposes drawing and scene resources when leaving the canvas", async () => {
  work.drawings.title.source =
    `const timer=setInterval(()=>document.body.dataset.ticks=String(Number(document.body.dataset.ticks||0)+1),10);api.cleanup(()=>clearInterval(timer));` +
    work.drawings.title.source;
  work.interactions.explore.source += `api.cleanup(()=>document.body.dataset.cleaned='yes');`;
  await open();
  await page.waitForFunction(() => Number(document.body.dataset.ticks) > 2);
  await page.evaluate(() => window.drawyView.dispose());
  const ticks = await page.getAttribute("body", "data-ticks");
  await page.waitForTimeout(60);
  expect(await page.getAttribute("body", "data-ticks")).toBe(ticks);
  expect(await page.getAttribute("body", "data-cleaned")).toBe("yes");
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
        regions: [work.scenes.root.modules[4].bounds],
        actions: [
          { moduleId: "control", selector: '[data-action="emphasize"]' },
        ],
      },
    ],
  });
  expect(shots).toHaveLength(5);
  expect(shots[0].modules!.map((m) => m.id)).toContain("level-4");
  // Only the opening view carries the scene's modules.
  expect(shots.slice(1).every((s) => !s.modules)).toBe(true);
  expect(shots[3].camera.scale).toBeGreaterThan(shots[0].camera.scale);
  // A close-up is framed to the area it was asked for, not to the whole screen.
  expect(shots[3].viewport.width).toBeLessThan(1440);
  expect(shots[4].label).toContain("操作");
  expect(shots[4].viewport.width).toBe(1440);
  expect(shots.every((s) => s.errors.length === 0)).toBe(true);
  expect(shots.filter((s) => s.sceneId === "child")).toHaveLength(1);
  expect(shots[0].base64).not.toBe(shots[1].base64);
}, 30000);
it("keeps words uncut at large sizes and at the edges of every library drawing, and reports what is cut", async () => {
  const drawings = seed("drawings") as DrawingMaterial[];
  work.materials = Object.fromEntries(
    [
      ...drawings.map(
        (m) =>
          ({
            ...m,
            source: readFileSync(
              new URL(`../../materials/seed/drawings/${m.id}.js`, import.meta.url),
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
          anchors: {},
          group: null,
          target: null,
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
    interactionId: null,
  };
  await open();
  expect((await page.evaluate(readText)).clipped).toEqual([]);
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
      { id: "upper", label: "upper", drawingId: "node", data: { title: "上" }, bounds: { x: 300, y: 0, width: 160, height: 60 }, anchors: { bottom: { x: 0.5, y: 1 } }, group: null, target: null },
      { id: "lower", label: "lower", drawingId: "node", data: { title: "下" }, bounds: { x: 300, y: 400, width: 160, height: 60 }, anchors: { top: { x: 0.5, y: 0 } }, group: null, target: null },
    ],
    links: [
      { id: "down", drawingId: "arrow", from: { moduleId: "upper", anchor: "bottom" }, to: { moduleId: "lower", anchor: "top" }, data: { label: "返回一个很长的值", size: 22 } },
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
      anchors: {},
      group: null,
      target: null,
    },
  ];
  await open();
  const report = await page.evaluate(readText);
  expect(report.clipped[0]).toMatchObject({ moduleId: "tight" });
  expect(report.smallest!.px).toBeGreaterThan(20);
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
  const arrow = seed("drawings").find((m) => m.id === "arrow")!;
  work.materials = {
    apple,
    "g-late": {
      ...(apple as Extract<typeof apple, { kind: "picture" }>),
      id: "g-late",
      url: "/materials/files/g-late",
      status: "developing",
    },
    arrow: useOf({
      ...arrow,
      source: readFileSync(
        new URL("../../materials/seed/drawings/arrow.js", import.meta.url),
        "utf8",
      ),
    } as Material)!,
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
    anchors: {},
    group: null,
    target: null,
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
    interactionId: null,
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
  const slider = seed("drawings").find((m) => m.id === "slider")!;
  work.materials = {
    apple,
    slider: useOf({
      ...slider,
      source: readFileSync(
        new URL("../../materials/seed/drawings/slider.js", import.meta.url),
        "utf8",
      ),
    } as Material)!,
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
  work.interactions.react = {
    id: "react",
    source:
      'api.on("length", "change", (v) => api.set("readout", { value: v }));',
  };
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
    anchors: {},
    group: null,
    target: null,
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
    interactionId: "react",
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

it("draws every library drawing from its example data and routes elbow arrows at right angles", async () => {
  const drawings = seed("drawings") as DrawingMaterial[];
  const source = (id: string) =>
    readFileSync(
      new URL(`../../materials/seed/drawings/${id}.js`, import.meta.url),
      "utf8",
    );
  work.materials = Object.fromEntries(
    [
      ...drawings.map((m) => ({ ...m, source: source(m.id) }) as Material),
      ...seed("pictures"),
      ...seed("effects"),
    ].map((m) => [m.id, useOf(m)!]),
  );
  let y = 0;
  const place = (
    id: string,
    drawingId: string,
    bounds: { x: number; y: number; width: number; height: number },
    data: Record<string, unknown>,
    anchors = {},
  ) => ({
    id,
    label: id,
    drawingId,
    data,
    bounds,
    anchors,
    group: null,
    target: null,
  });
  const modules = drawings.map((m) => {
    const at = place(m.id, m.id, { x: 0, y, ...m.size }, m.example);
    y += m.size.height + 40;
    return at;
  });
  const sides = { left: { x: 0, y: 0.5 }, right: { x: 1, y: 0.5 } };
  modules.push(
    place(
      "from",
      "node",
      { x: 1000, y: 0, width: 180, height: 70 },
      { title: "下单" },
      sides,
    ),
    place(
      "to",
      "node",
      { x: 1300, y: 240, width: 180, height: 70 },
      { title: "支付" },
      sides,
    ),
  );
  work.scenes.root = {
    ...work.scenes.root,
    modules,
    links: [
      {
        id: "route",
        drawingId: "arrow",
        from: { moduleId: "from", anchor: "right" },
        to: { moduleId: "to", anchor: "left" },
        data: { route: "elbow" },
      },
    ],
    checks: [],
    interactionId: null,
  };
  await open();
  // Whatever a library drawing's example says, none of it is cut off by the drawing itself.
  expect((await page.evaluate(readText)).clipped).toEqual([]);
  const result = await page.evaluate(() => {
    const words = (id: string) =>
      document.querySelector(`[data-module-id="${id}"]`)!.shadowRoot!
        .textContent;
    const path = document
      .querySelector('[data-link-id="route"]')!
      .shadowRoot!.querySelector("path")!;
    const length = path.getTotalLength();
    const at = (l: number) => path.getPointAtLength(l);
    return {
      errors: window.drawyErrors,
      blank: [...document.querySelectorAll<HTMLElement>("[data-module-id]")]
        .filter((h) => !h.shadowRoot!.querySelector("svg,img,div"))
        .map((h) => h.dataset.moduleId),
      words: Object.fromEntries(
        Object.entries({
          node: "订单服务",
          hierarchy: "真菌",
          layers: "对象存储",
          quadrant: "立即去做",
          compare: "纯电",
          pyramid: "自我实现",
          venn: "好产品",
          mindmap: "估算",
          steps: "完善资料",
          swimlanes: "后厨",
          bars: "蛋白质",
          donut: "氮气",
          gauge: "空气质量指数",
          stat: "8848",
          fishbone: "交付延期",
          sequence: "返回令牌",
          gantt: "上线",
          callout: "为什么天空是蓝色的？",
          checklist: "带好证件",
          radar: "耐力",
          concentric: "怎么做",
          geomap: "新迦太基",
        }).map(([id, w]) => [id, words(id)!.includes(w)]),
      ),
      // It leaves and arrives level, turning twice in between.
      leaves: Math.abs(at(10).y - at(0).y),
      arrives: Math.abs(at(length).y - at(length - 10).y),
      turns: (path.getAttribute("d")!.match(/Q/g) || []).length,
    };
  });
  expect(result).toMatchObject({
    errors: [],
    blank: [],
    words: {
      node: true,
      hierarchy: true,
      layers: true,
      quadrant: true,
      compare: true,
      pyramid: true,
      venn: true,
      mindmap: true,
      ...Object.fromEntries(
        "steps swimlanes bars donut gauge stat fishbone sequence gantt callout checklist radar concentric geomap"
          .split(" ")
          .map((id) => [id, true]),
      ),
    },
    turns: 2,
  });
  expect(result.leaves).toBeLessThan(0.01);
  expect(result.arrives).toBeLessThan(0.01);
});

it("maps across the 180th meridian in one piece and names what the view shows", async () => {
  const drawings = seed("drawings") as DrawingMaterial[];
  const geomap = drawings.find((m) => m.id === "geomap")!;
  work.materials = {
    geomap: useOf({
      ...geomap,
      source: readFileSync(
        new URL("../../materials/seed/drawings/geomap.js", import.meta.url),
        "utf8",
      ),
    } as Material)!,
  };
  const map = (id: string, y: number, data: Record<string, unknown>) => ({
    id,
    label: id,
    drawingId: "geomap",
    data,
    bounds: { x: 0, y, width: 960, height: 600 },
    anchors: {},
    group: null,
    target: null,
  });
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      // From Chukotka to Alaska: the view centres on the 180th meridian.
      map("bering", 0, {
        borders: "countries",
        routes: [
          {
            points: [
              [170, 64],
              [-150, 64],
            ],
            color: "#123456",
          },
        ],
      }),
      // A close view of China's south-west: provinces are named, so China is not.
      map("divisions", 700, {
        borders: "subdivisions",
        bounds: [100, 24, 108, 30],
        // The Yangtze between Yibin and Chongqing, about two degrees of longitude.
        highlights: [
          {
            river: "长江",
            from: [104.6, 28.77],
            to: [106.55, 29.56],
            color: "#654321",
          },
        ],
      }),
      // A coast seen close, drawn from the finer tiles (closer still, a region's view, the
      // ground comes from OpenStreetMap's tiles instead).
      map("coast", 1400, { bounds: [-8, 46, 4, 52] }),
    ],
    links: [],
  };
  await open();
  const seen = await page.evaluate(() => {
    const root = (id: string) =>
      document.querySelector(`[data-module-id="${id}"]`)!.shadowRoot!;
    const route = root("bering").querySelector<SVGPathElement>(
      'path[stroke="#123456"]',
    )!;
    const text = (id: string) =>
      [...root(id).querySelectorAll("text")].map((t) => t.textContent);
    return {
      errors: window.drawyErrors,
      routes: root("bering").querySelectorAll('path[stroke="#123456"]').length,
      width: route.getBBox().width,
      stretch: root("divisions")
        .querySelector<SVGPathElement>('path[stroke="#654321"]')
        ?.getBBox().width,
      bering: text("bering"),
      divisions: text("divisions"),
      tiles: performance
        .getEntriesByType("resource")
        .filter((e) => /\/materials\/geo\/detail-/.test(e.name)).length,
      shore:
        root("coast")
          .querySelectorAll('path[fill="none"]')[0]
          ?.getAttribute("d")?.length ?? 0,
    };
  });
  expect(seen.errors).toEqual([]);
  // One piece, about two thirds of the view wide, not a line across the whole world.
  expect(seen.routes).toBe(1);
  expect(seen.width).toBeGreaterThan(400);
  expect(seen.width).toBeLessThan(800);
  // Both countries are named though neither's label point is in view.
  expect(seen.bering).toEqual(expect.arrayContaining(["俄罗斯", "美国"]));
  expect(seen.divisions).toEqual(expect.arrayContaining(["贵州省", "四川省"]));
  expect(seen.divisions).not.toContain("中国");
  expect(seen.tiles).toBeGreaterThan(0);
  // About 90 px a degree once the view widens to the module: the stretch (about 175
  // px), not the whole river.
  expect(seen.stretch).toBeGreaterThan(140);
  expect(seen.stretch).toBeLessThan(240);
  expect(seen.shore).toBeGreaterThan(1000);
});

it("draws a city's real streets under a walk through it, and says so when they cannot load", async () => {
  const drawings = seed("drawings") as DrawingMaterial[];
  const geomap = drawings.find((m) => m.id === "geomap")!;
  work.materials = {
    geomap: useOf({
      ...geomap,
      source: readFileSync(
        new URL("../../materials/seed/drawings/geomap.js", import.meta.url),
        "utf8",
      ),
    } as Material)!,
  };
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
        anchors: {},
        group: null,
        target: null,
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

it("draws the world in a rounded projection and a country in relief, naming what the map is about", async () => {
  const drawings = seed("drawings") as DrawingMaterial[];
  const geomap = drawings.find((m) => m.id === "geomap")!;
  work.materials = {
    geomap: useOf({
      ...geomap,
      source: readFileSync(
        new URL("../../materials/seed/drawings/geomap.js", import.meta.url),
        "utf8",
      ),
    } as Material)!,
  };
  const map = (id: string, y: number, data: Record<string, unknown>) => ({
    id,
    label: id,
    drawingId: "geomap",
    data,
    bounds: { x: 0, y, width: 960, height: 600 },
    anchors: {},
    group: null,
    target: null,
  });
  work.scenes.root = {
    ...work.scenes.root,
    modules: [
      map("world", 0, {
        borders: "countries",
        bounds: [-180, -60, 180, 85],
        names: { 巴西: "Brasil" },
      }),
      map("china", 700, { borders: "subdivisions", bounds: [73, 17, 135, 54] }),
    ],
    links: [],
  };
  await open();
  const seen = await page.evaluate(() => {
    const root = (id: string) =>
      document.querySelector(`[data-module-id="${id}"]`)!.shadowRoot!;
    const text = (id: string) =>
      [...root(id).querySelectorAll("text")].map((t) => t.textContent!);
    // The earth's rim: where it meets the top and bottom of the view, how far in.
    const rim = root("world").querySelector<SVGPathElement>("path")!;
    const box = rim.getBBox();
    const top = rim
      .getAttribute("d")!
      .match(/[\d.]+ [\d.]+/g)!
      .map((p) => p.split(" ").map(Number))
      .filter(([, y]) => y < box.y + 2);
    return {
      errors: window.drawyErrors,
      world: text("world"),
      china: text("china"),
      corner: Math.min(...top.map(([x]) => x)) - box.x,
      relief: root("china").querySelectorAll("image").length,
      reliefTiles: performance
        .getEntriesByType("resource")
        .filter((e) => /\/materials\/geo\/relief\//.test(e.name)).length,
    };
  });
  expect(seen.errors).toEqual([]);
  // Rounded at its sides: the rim is well in from the corners at the top.
  expect(seen.corner).toBeGreaterThan(100);
  // Each country once, and no unit too small to be outlined.
  expect(seen.world.filter((t) => t === "澳大利亚")).toHaveLength(1);
  expect(seen.world).not.toContain("黄岩岛");
  expect(seen.world).toEqual(expect.arrayContaining(["俄罗斯", "Brasil"]));
  // China's provinces are named, its neighbours as countries, not by their provinces.
  expect(seen.china).toEqual(expect.arrayContaining(["四川省", "蒙古"]));
  expect(seen.china).not.toContain("科布多省");
  expect(seen.relief).toBe(1);
  expect(seen.reliefTiles).toBeGreaterThan(0);
});
