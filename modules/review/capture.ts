import type { Browser, Page } from "playwright";
import type { Bounds, Scene } from "../contracts/index.ts";

export interface CaptureRequest {
  scenes: { id: string; url: string; checks: Scene["checks"] }[];
  cookie: string;
  origin: string;
}
export interface Shot {
  sceneId: string;
  label: string;
  base64: string;
  errors: string[];
}
async function ready(page: Page) {
  await page.waitForFunction(() => window.drawyReady, {}, { timeout: 30000 });
  await page.evaluate(() => window.drawyView.renderer.settled());
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
        await page.goto(scene.url, { waitUntil: "load" });
        try {
          await ready(page);
        } catch (e) {
          errors.push(String(e));
        }
      };
      const shot = async (label: string) => {
        shots.push({
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
      await page.close();
    }
    return shots;
  } finally {
    await context.close();
  }
}
