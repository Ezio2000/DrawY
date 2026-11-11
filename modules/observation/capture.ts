import type { Browser, Page } from "playwright";
import type { Bounds, Scene } from "../contracts/index.ts";
import { MIN_TEXT, OPENING_VIEW } from "../contracts/geometry.ts";
import type { StructureReport } from "../runtime/scene.ts";

export interface CaptureRequest {
  scenes: {
    id: string;
    url: string;
    checks: Scene["checks"];
    /** Whether to take the opening view and try the checks; a close-up of a revision
     * already seen whole has no need of them. */
    overview: boolean;
    regions?: Bounds[];
    actions?: Scene["checks"];
  }[];
  annotate?: boolean;
  cookie: string;
  origin: string;
}
/** What the words of a drawn scene look like on screen, measured instead of judged from
 * a picture: the smallest text and any cut off by what holds it or by the view. */
export interface TextReport {
  smallest?: { moduleId: string; text: string; px: number };
  /** The smallest text of each part below `MIN_TEXT`, smallest first, so one write can raise
   * them all. */
  small: { moduleId: string; text: string; px: number }[];
  clipped: { moduleId: string; text: string }[];
}
export interface Shot {
  camera: { x: number; y: number; scale: number };
  /** The scene's modules, on its opening view; other views show the same scene. */
  modules?: {
    id: string;
    bounds: Bounds;
    /** Where each picture's visible content actually is, in scene units. */
    pictures?: ({ material: string } & Bounds)[];
  }[];
  /** On the opening view. */
  text?: TextReport;
  /** On the opening view: what the scene's geometry shows is wrong with its structure. */
  structure?: StructureReport;
  sceneId: string;
  label: string;
  /** The opening view of the whole scene, as the canvas first shows it. */
  overview: boolean;
  /** The screenshot's size in pixels. */
  viewport: { width: number; height: number };
  /** None when a click opened a page of the work: the page is the author's own HTML, laid
   * out by the app, so it is named instead of pictured. */
  base64?: string;
  /** The page a click opened, and whether the click only opened the module's own target,
   * which the app does by itself without any script. */
  opened?: { detail: string; byTarget: boolean };
  errors: string[];
}
/** Runs in the page, so its helpers live inside it: reads every part's text. A size is the
 * font's own, scaled as the camera and any viewBox or transform above it scale it. */
export function readText(limit: number): TextReport {
  const report: TextReport = { small: [], clipped: [] };
  const seen = new Set<string>();
  const least = new Map<string, { moduleId: string; text: string; px: number }>();
  const view = { right: innerWidth, bottom: innerHeight };
  const scaleOf = (element: Element) => {
    let scale = 1;
    for (let at: Element | undefined = element; at; at = at.parentElement ?? (at.getRootNode() as ShadowRoot).host) {
      // The matrix down from the screen already holds everything above an svg element.
      const matrix = at instanceof SVGGraphicsElement ? at.getScreenCTM() : new DOMMatrix(getComputedStyle(at).transform);
      if (matrix) scale *= Math.hypot(matrix.a, matrix.b);
      if (at instanceof SVGGraphicsElement) break;
    }
    return scale;
  };
  for (const host of document.querySelectorAll<HTMLElement>(
    "[data-module-id],[data-link-id]",
  )) {
    const moduleId = host.dataset.moduleId ?? host.dataset.linkId!;
    if (!host.shadowRoot) continue;
    const walker = document.createTreeWalker(host.shadowRoot, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent?.trim();
      if (!parent || !text || parent.closest("defs,title,desc,style,script")) continue;
      const shown = getComputedStyle(parent);
      if (shown.visibility === "hidden" || shown.display === "none" || Number(shown.opacity) === 0)
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = parent instanceof SVGElement ? parent.getBoundingClientRect() : range.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const size = parseFloat(shown.fontSize) * scaleOf(parent);
      const px = Math.round(size);
      if (!report.smallest || px < report.smallest.px)
        report.smallest = { moduleId, text: text.slice(0, 30), px };
      if (px < limit && px < (least.get(moduleId)?.px ?? Infinity))
        least.set(moduleId, { moduleId, text: text.slice(0, 30), px });
      // A text box reaches past its glyphs, by about this much above and below, and a tight
      // line height lets it pass its own container without cutting anything.
      const top = box.top + size * 0.2,
        bottom = box.bottom - size * 0.2;
      let cut = box.left < -1 || top < -1 || box.right > view.right + 1 || bottom > view.bottom + 1;
      for (let at: Element | null = parent; at && !cut; at = at.parentElement) {
        const overflow = getComputedStyle(at).overflow;
        if (overflow === "visible" || overflow === "clip visible") continue;
        const edge = at.getBoundingClientRect();
        cut =
          box.left < edge.left - 1.5 ||
          top < edge.top - 1.5 ||
          box.right > edge.right + 1.5 ||
          bottom > edge.bottom + 1.5;
      }
      const key = moduleId + text;
      if (cut && !seen.has(key) && report.clipped.length < 8) {
        seen.add(key);
        report.clipped.push({ moduleId, text: text.slice(0, 30) });
      }
    }
  }
  report.small = [...least.values()].sort((a, b) => a.px - b.px).slice(0, 12);
  return report;
}
async function ready(page: Page) {
  await page.waitForFunction(() => window.drawyReady, {}, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.drawyView.renderer.settled();
    await window.drawyView.renderer.developed();
  });
}
export async function capture(
  browser: Browser,
  request: CaptureRequest,
): Promise<Shot[]> {
  const context = await browser.newContext();
  // The service runs under tsx, which names functions with a helper; code it sends into
  // pages finds the same helper there.
  await context.addInitScript({ content: "globalThis.__name = (f) => f;" });
  await context.addCookies([
    { name: "drawy_session", value: request.cookie, url: request.origin },
  ]);
  const shots: Shot[] = [];
  try {
    const { width, height } = OPENING_VIEW;
    for (const scene of request.scenes) {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("requestfailed", (req) =>
        errors.push(`${req.url()}: ${req.failure()?.errorText}`),
      );
      await page.setViewportSize({ width, height });
      const load = async () => {
        errors.length = 0;
        // The runtime says when it is ready; a developing picture would hold up "load".
        await page.goto(scene.url, { waitUntil: "domcontentloaded" });
        try {
          await ready(page);
        } catch (e) {
          errors.push(String(e));
        }
      };
      const shot = async (
        label: string,
        overview = false,
        size = { width, height },
      ) => {
        const geometry = await page.evaluate(() => {
          const camera = window.drawyView.view;
          const { materials } = window.drawyData.work;
          return {
            camera,
            modules: [...window.drawyView.renderer.instances.values()].map(
              ({ id, bounds }) => {
                const host = document.querySelector(
                  `[data-module-id="${CSS.escape(id)}"]`,
                );
                // A picture's frame includes its margins; only its content is seen.
                const pictures = [
                  ...(host?.shadowRoot?.querySelectorAll<HTMLElement>(
                    "[data-material]",
                  ) ?? []),
                ].flatMap((frame) => {
                  const m = materials[frame.dataset.material!];
                  const img = frame.querySelector("img");
                  if (m?.kind !== "picture" || !img) return [];
                  const r = img.getBoundingClientRect(),
                    c = m.content;
                  return [
                    {
                      material: m.id,
                      x: Math.round(
                        (r.left + r.width * c.x - camera.x) / camera.scale,
                      ),
                      y: Math.round(
                        (r.top + r.height * c.y - camera.y) / camera.scale,
                      ),
                      width: Math.round((r.width * c.width) / camera.scale),
                      height: Math.round((r.height * c.height) / camera.scale),
                    },
                  ];
                });
                return {
                  id,
                  bounds,
                  ...(pictures.length ? { pictures } : {}),
                };
              },
            ),
          };
        });
        if (request.annotate)
          await page.evaluate(({ camera, modules }) => {
            const overlay = document.createElement("div");
            overlay.id = "drawy-annotations";
            overlay.style.cssText =
              "position:fixed;inset:0;pointer-events:none;z-index:9999";
            for (const m of modules) {
              const box = document.createElement("div");
              box.style.cssText = `position:absolute;left:${camera.x + m.bounds.x * camera.scale}px;top:${camera.y + m.bounds.y * camera.scale}px;width:${m.bounds.width * camera.scale}px;height:${m.bounds.height * camera.scale}px;border:1px dashed #c44;box-sizing:border-box`;
              const label = document.createElement("span");
              label.textContent = `${m.id} (${Math.round(m.bounds.x)},${Math.round(m.bounds.y)})`;
              label.style.cssText =
                "font:12px monospace;background:#fff;color:#b22";
              box.append(label);
              overlay.append(box);
            }
            document.body.append(overlay);
          }, geometry);
        shots.push({
          camera: geometry.camera,
          ...(overview
            ? {
                modules: geometry.modules,
                text: await page.evaluate(readText, MIN_TEXT),
                structure: await page.evaluate(() => window.drawyView.renderer.structure?.() ?? {}),
              }
            : {}),
          sceneId: await page.evaluate(() => window.drawyData.sceneId),
          label: `${size.width}px / ${label}`,
          overview,
          viewport: size,
          base64: (await page.screenshot()).toString("base64"),
          errors: [
            ...new Set([
              ...errors,
              ...(await page.evaluate(() => window.drawyErrors)),
            ]),
          ],
        });
        await page.evaluate(() =>
          document.getElementById("drawy-annotations")?.remove(),
        );
      };
      /** What a click led to: the scene as it now looks, or the page it opened named. The
       * page is closed again, so a sequence of clicks goes on in the scene. */
      const after = async (label: string, moduleId: string) => {
        const opened = await page.evaluate((moduleId) => {
          const at = document.querySelector<HTMLElement>("[data-drawy-detail]");
          if (!at) return undefined;
          at.remove();
          const detail = at.dataset.drawyDetail!;
          const target = window.drawyView.renderer.instances.get(moduleId)?.target;
          return {
            detail,
            byTarget: target?.kind === "detail" && target.id === detail,
          };
        }, moduleId);
        if (!opened) return shot(label);
        shots.push({
          camera: await page.evaluate(() => window.drawyView.view),
          sceneId: await page.evaluate(() => window.drawyData.sceneId),
          label,
          overview: false,
          viewport: page.viewportSize()!,
          opened,
          errors: [
            ...new Set([
              ...errors,
              ...(await page.evaluate(() => window.drawyErrors)),
            ]),
          ],
        });
      };
      await load();
      if (scene.overview) {
        await shot("全图", true);
        for (const check of scene.checks) {
          await load();
          try {
            const host = page.locator(
              `[data-module-id=${JSON.stringify(check.moduleId)}]`,
            );
            await host.locator(check.selector).click({ timeout: 5000 });
            await ready(page);
          } catch (e) {
            errors.push(String(e));
          }
          await after(`交互 ${check.moduleId} ${check.selector}`, check.moduleId);
        }
      }
      if (scene.regions?.length) {
        if (scene.overview && scene.checks.length) await load();
        for (const region of scene.regions) {
          // A close-up is framed to its area, so nothing outside what was asked for is
          // sent to be read.
          const scale = Math.min(2, 1100 / region.width, 800 / region.height);
          await page.setViewportSize({
            width: Math.max(320, Math.round((region.width * scale) / 0.9)),
            height: Math.max(240, Math.round((region.height * scale) / 0.92)),
          });
          await page.evaluate(
            ({ region, scale }) => window.drawyView.focus(region, scale),
            { region, scale },
          );
          await ready(page);
          const seen = page.viewportSize()!;
          await shot(`局部 ${Math.round(region.x)},${Math.round(region.y)}`, false, seen);
        }
        await page.setViewportSize({ width, height });
      }
      if (scene.actions?.length) {
        await load();
        for (const action of scene.actions) {
          try {
            await page
              .locator(`[data-module-id=${JSON.stringify(action.moduleId)}]`)
              .locator(action.selector)
              .click({ timeout: 5000 });
            await ready(page);
          } catch (e) {
            errors.push(String(e));
          }
          await after(`操作 ${action.moduleId} ${action.selector}`, action.moduleId);
        }
      }
      await page.close();
    }
    return shots;
  } finally {
    await context.close();
  }
}
/** The whole scene as a picture to keep: cropped to its drawing, at twice the screen's
 * pixel density, with the longest side at most 4800 pixels. */
export async function render(
  browser: Browser,
  request: {
    url: string;
    cookie: string;
    origin: string;
    /** A PNG at twice the size, or a one-page PDF that keeps the drawing as vectors. */
    format?: "png" | "pdf";
  },
): Promise<Buffer> {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await context.addInitScript({ content: "globalThis.__name = (f) => f;" });
  await context.addCookies([
    { name: "drawy_session", value: request.cookie, url: request.origin },
  ]);
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(request.url, { waitUntil: "domcontentloaded" });
    await ready(page);
    const bounds = await page.evaluate(() => window.drawyView.renderer.bounds);
    const scale = Math.min(1.5, 2400 / Math.max(bounds.width, bounds.height));
    // Framed to the drawing's edges with no paper around it: the picture is kept as a
    // wallpaper or put in a document, where a white border is in the way.
    await page.setViewportSize({
      width: Math.max(1, Math.round(bounds.width * scale)),
      height: Math.max(1, Math.round(bounds.height * scale)),
    });
    await page.evaluate((bounds) => window.drawyView.crop(bounds), bounds);
    // The paper's dot grid is for working on the canvas, not part of the picture.
    await page.evaluate(() => {
      window.drawyView.element.style.backgroundImage = "none";
    });
    await ready(page);
    if (request.format === "pdf") {
      // Printed as the screen shows it, on one page the size of the view.
      await page.emulateMedia({ media: "screen" });
      const size = page.viewportSize()!;
      return await page.pdf({
        width: size.width + "px",
        height: size.height + 1 + "px",
        printBackground: true,
        pageRanges: "1",
      });
    }
    return await page.screenshot({ type: "png" });
  } finally {
    await context.close();
  }
}
