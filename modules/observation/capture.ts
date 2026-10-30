import type { Browser, Page } from "playwright";
import type { Bounds, Scene } from "../contracts/index.ts";

export interface CaptureRequest {
  scenes: {
    id: string;
    url: string;
    checks: Scene["checks"];
    region?: Bounds;
    actions?: Scene["checks"];
  }[];
  annotate?: boolean;
  cookie: string;
  origin: string;
}
export interface Shot {
  camera: { x: number; y: number; scale: number };
  modules: { id: string; label: string; bounds: Bounds }[];
  sceneId: string;
  label: string;
  base64: string;
  errors: string[];
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
  await context.addCookies([
    { name: "drawy_session", value: request.cookie, url: request.origin },
  ]);
  const shots: Shot[] = [];
  try {
    const width = 1440;
    for (const scene of request.scenes) {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("requestfailed", (req) =>
        errors.push(`${req.url()}: ${req.failure()?.errorText}`),
      );
      await page.setViewportSize({ width, height: 900 });
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
      const shot = async (label: string) => {
        const geometry = await page.evaluate(() => ({
          camera: window.drawyView.view,
          modules: [...window.drawyView.renderer.instances.values()].map(
            ({ id, label, bounds }) => ({ id, label, bounds }),
          ),
        }));
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
          ...geometry,
          sceneId: await page.evaluate(() => window.drawyData.sceneId),
          label: `${width}px / ${label}`,
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
      await load();
      await shot("全图");
      const { bounds, scale } = await page.evaluate(() => ({
        bounds: window.drawyView.renderer.bounds,
        scale: window.drawyView.view.scale,
      }));
      // Large works need readable close-ups in addition to an honest overview.
      if (scale < 0.8) {
        for (let y = bounds.y; y < bounds.y + bounds.height; y += 740)
          for (let x = bounds.x; x < bounds.x + bounds.width; x += 1280) {
            await page.evaluate(
              (region: Bounds) => window.drawyView.focus(region, 1),
              { x, y, width: 1376, height: 836 },
            );
            await shot(`局部 ${x},${y}`);
          }
      }
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
        await shot(`交互 ${check.moduleId} ${check.selector}`);
      }
      if (scene.region) {
        await load();
        await page.evaluate(
          (region) => window.drawyView.focus(region),
          scene.region,
        );
        await shot("指定区域");
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
          await shot(`操作 ${action.moduleId} ${action.selector}`);
        }
      }
      await page.close();
    }
    return shots;
  } finally {
    await context.close();
  }
}
