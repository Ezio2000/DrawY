import { devices } from "playwright";
import { expect, it } from "vitest";
import {
  editing,
  make,
  module,
  open,
  page,
  pinch,
  press,
  rectOf,
  settled,
  setup,
  statuses,
  swipe,
  tap,
} from "./harness.ts";

/* A tablet gets the desktop page, whose canvas takes fingers: the gestures are the canvas's
 * own, so every page that draws a work has them (see harness.ts for how the app is run). */

setup({ ...devices["iPad Mini"] });

const center = (r: { cx: number; cy: number }) => ({ x: r.cx, y: r.cy });

it("gives a tablet held either way the desktop page", async () => {
  await open(await make());
  expect(await page.locator("[data-shell=phone]").count()).toBe(0);
  expect(await page.getByRole("button", { name: "Edit by hand" }).count()).toBe(1);
  await page.setViewportSize({ width: 1024, height: 768 });
  await settled();
  expect(await page.locator("[data-shell=phone]").count()).toBe(0);
});

it("edits with fingers: a part moves with one, the paper moves the view, and a long press opens the menu", async () => {
  await open(await make());
  await editing();
  const a = await rectOf("Alpha");
  const before = (await module("Alpha"))!;
  await swipe(center(a), { x: a.cx + 60, y: a.cy + 40 });
  await settled();
  const after = (await module("Alpha"))!;
  expect(after.left).not.toBe(before.left);
  expect(after.mark).toBe(before.mark);
  expect(await statuses()).toContain("1 change not saved\nDiscard changes\nSave as version 2");
  // The handles on the selection are as big as a fingertip.
  const handle = await page.evaluate(() => {
    const h = [...document.querySelectorAll<HTMLElement>("[data-handle]")].find((h) => h.offsetParent);
    return h?.getBoundingClientRect().width;
  });
  expect(handle).toBe(44);
  // A finger on the paper (left of the parts: the editor's panel covers the canvas's
  // right side on a screen this narrow) moves the view rather than drawing a box to select.
  const a2 = await rectOf("Alpha");
  await swipe({ x: a2.x - 60, y: a2.y - 40 }, { x: a2.x - 60, y: a2.y + 60 });
  await settled();
  expect((await rectOf("Alpha")).y - a2.y).toBeGreaterThan(80);
  expect((await module("Alpha"))!.left).toBe(after.left);
  await press(center(await rectOf("Alpha")));
  await expect.poll(() => page.getByRole("menu").count()).toBe(1);
});

it("changes words with a double tap, and zooms the drawing with two fingers", async () => {
  await open(await make());
  await tap(center(await rectOf("Beta")), 2);
  await expect
    .poll(() => page.evaluate(() => (document.activeElement as HTMLTextAreaElement)?.value))
    .toBe("Beta");
  await page.keyboard.press("Escape");
  await settled();
  const before = await rectOf("Alpha");
  await pinch({ x: before.cx, y: before.cy }, 100, 260);
  await settled();
  expect((await rectOf("Alpha")).width).toBeGreaterThan(before.width * 1.8);
});
