import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { documentFor } from "./document.ts";
import { fixture } from "./fixture.ts";
import { capture } from "../observation/capture.ts";
import { fit, zoom } from "../contracts/geometry.ts";
import { useOf } from "../materials/index.ts";
import type { Material } from "@drawy/materials/schema";

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
    } else if (url.pathname === "/api/plantuml") {
      res.setHeader("content-type", "image/svg+xml");
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text x="10" y="30">Alice → Bob</text></svg>',
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
  expect(
    await page.locator('[data-module-id="uml"] svg').textContent(),
  ).toContain("Alice");
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
    window.drawyView.setEditing(true);
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
  const handle = (await page
    .getByRole("button", { name: "调整模块大小" })
    .boundingBox())!;
  await page.mouse.move(handle.x + 6, handle.y + 6);
  await page.mouse.down();
  await page.mouse.move(handle.x + 66, handle.y + 26, { steps: 4 });
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
        region: work.scenes.root.modules[4].bounds,
        actions: [
          { moduleId: "control", selector: '[data-action="emphasize"]' },
        ],
      },
    ],
  });
  expect(shots).toHaveLength(5);
  expect(shots[0].modules.map((m) => m.id)).toContain("level-4");
  expect(shots[3].camera.scale).toBeGreaterThan(shots[0].camera.scale);
  expect(shots[4].label).toContain("操作");
  expect(shots.every((s) => s.label.startsWith("1440px"))).toBe(true);
  expect(shots.every((s) => s.errors.length === 0)).toBe(true);
  expect(shots.filter((s) => s.sceneId === "child")).toHaveLength(1);
  expect(shots[0].base64).not.toBe(shots[1].base64);
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
