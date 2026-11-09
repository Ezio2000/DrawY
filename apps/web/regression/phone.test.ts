import { devices } from "playwright";
import { expect, it } from "vitest";
import {
  asked,
  base,
  composer,
  count,
  make,
  module,
  open,
  outlined,
  page,
  paintedAsLaidOut,
  pinch,
  press,
  rectOf,
  renders,
  run,
  settled,
  setup,
  statuses,
  swipe,
  tap,
  tell,
} from "./harness.ts";

/* The phone work page as AGENTS.md describes it, on an emulated phone held upright, with
 * fingers through the browser's own touch input (see harness.ts for how the app is run).
 * The page is picked by the screen's size and its coarse pointer, never by the browser's
 * name, so the phone's user agent here plays no part. */

setup({ ...devices["iPhone 13"] });

const center = (r: { cx: number; cy: number }) => ({ x: r.cx, y: r.cy });
const actions = () => page.getByRole("toolbar", { name: "Actions on the selection" });
const sheet = () => page.getByRole("dialog");
const top = () => page.locator("header").first();
const dock = () => page.locator("[data-dock]");

it("fills the screen without the side bar, and follows the window to the desktop page and back", async () => {
  await open(await make());
  expect(await page.locator("[data-shell=phone]").count()).toBe(1);
  expect(await page.getByRole("navigation", { name: "Navigation" }).isVisible()).toBe(false);
  // Turned into a tablet-sized screen, the same work shows on the desktop page.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(() => page.getByRole("button", { name: "Edit by hand" }).count()).toBe(1);
  expect(await page.locator("[data-shell=phone]").count()).toBe(0);
  await page.setViewportSize({ width: 390, height: 664 });
  await expect.poll(() => page.locator("[data-shell=phone]").count()).toBe(1);
});

it("paints the drawing's words as they are laid out, held upright and on its side, and after a pinch", async () => {
  await open(await make());
  for (const words of ["Alpha", "Beta"]) await paintedAsLaidOut(words);
  // Turned on its side, a phone keeps the phone page; the view follows the new shape.
  await page.setViewportSize({ width: 844, height: 390 });
  await settled();
  expect(await page.locator("[data-shell=phone]").count()).toBe(1);
  for (const words of ["Alpha", "Beta"]) await paintedAsLaidOut(words);
  await page.setViewportSize({ width: 390, height: 664 });
  await settled();
  const a = await rectOf("Alpha");
  await pinch({ x: a.cx, y: a.cy }, 80, 120);
  await settled();
  await paintedAsLaidOut("Alpha");
});

it("asks from the composer, shows the author drawing without covering the drawing, and opens the studio from the status line", async () => {
  const id = await make();
  await open(id);
  await composer().fill("Draw the route");
  await composer().press("Enter");
  await settled();
  expect(asked.map((a) => a.prompt)).toEqual(["Draw the route"]);
  const user = { kind: "message", role: "user", text: "Draw the route" } as const;
  await tell({ type: "run", run: run(id, "live", "running", [user, { kind: "thinking", text: "**Planning**" }]) });
  await settled();
  expect(await sheet().count()).toBe(0);
  await expect.poll(() => page.getByRole("button", { name: "Stop" }).count()).toBe(1);
  await dock().locator("[data-tone=live]").tap();
  await expect.poll(() => sheet().getAttribute("aria-label")).toBe("Studio");
  expect(await sheet().innerText()).toContain("Draw the route");
  await sheet().getByRole("button", { name: "Close" }).tap();
  await tell({
    type: "run",
    run: run(id, "live", "completed", [user, { kind: "message", role: "assistant", text: "Here is the route." }]),
  });
  await settled();
  expect(await dock().innerText()).toContain("Here is the route.");
  await dock().getByRole("button", { name: "Collapse" }).tap();
  await settled();
  expect(await dock().innerText()).not.toContain("Here is the route.");
});

it("selects a part with a tap and offers what a finger can do; a change described goes with the part", async () => {
  await open(await make());
  await tap(center(await rectOf("Alpha")));
  await expect.poll(() => actions().innerText()).toContain("Alpha");
  const offered = await actions().getByRole("button").allInnerTexts();
  expect(offered.map((t) => t.trim()).filter(Boolean)).toEqual(["Edit text", "Describe a change", "Delete"]);
  await actions().getByRole("button", { name: "Describe a change" }).tap();
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.matches("[data-dock] textarea")))
    .toBe(true);
  await page.keyboard.type("Make it red");
  await page.keyboard.press("Enter");
  await settled();
  expect(asked.map((a) => a.prompt)).toEqual(["Make it red\nSelected module: a\nAlpha"]);
});

it("moves a selected part with a finger, laying the saved move over it in place, and saves it as a version", async () => {
  await open(await make());
  const a = await rectOf("Alpha");
  await tap(center(a));
  const before = (await module("Alpha"))!;
  await swipe(center(a), { x: a.cx + 40, y: a.cy + 90 });
  await settled();
  const after = (await module("Alpha"))!;
  expect(after.left).not.toBe(before.left);
  expect(after.mark).toBe(before.mark);
  expect(await statuses()).toContain("1 change not saved\nDiscard\nSave");
  await dock().getByRole("button", { name: "Save", exact: true }).tap();
  await settled();
  expect(await statuses()).toContain("Saved as version 2");
});

it("changes words where they are with a double tap, and deletes a part from its actions", async () => {
  await open(await make());
  await tap(center(await rectOf("Alpha")), 2);
  await expect
    .poll(() => page.evaluate(() => (document.activeElement as HTMLTextAreaElement)?.value))
    .toBe("Alpha");
  await page.keyboard.type("Gamma");
  await page.keyboard.press("Enter");
  await settled();
  expect([await count("Gamma"), await count("Alpha")]).toEqual([1, 0]);
  await tap(center(await rectOf("Gamma")));
  await actions().getByRole("button", { name: "Delete" }).tap();
  await settled();
  expect(await count("Gamma")).toBe(0);
  expect(await actions().count()).toBe(0);
});

it("selects a part that leads elsewhere with a long press, without following it; a tap follows it", async () => {
  const id = await make({ sub: "drawn", leads: true });
  await open(id);
  await press(center(await rectOf("Alpha")));
  await settled();
  expect(new URL(page.url()).pathname).toBe(`/a/${id}`);
  await expect.poll(() => actions().innerText()).toContain("Alpha");
  await actions().getByRole("button", { name: "Deselect" }).tap();
  await settled();
  await tap(center(await rectOf("Alpha")));
  await settled();
  expect(new URL(page.url()).pathname).toBe(`/a/${id}/sub`);
});

it("moves the view with one finger on the paper, and zooms it with two", async () => {
  await open(await make());
  const a = await rectOf("Alpha"),
    b = await rectOf("Beta");
  const paper = { x: a.cx, y: (a.y + a.height + b.y) / 2 };
  const beta = (await module("Beta"))!;
  await swipe(paper, { x: paper.x - 30, y: paper.y + 80 });
  await settled();
  const moved = await rectOf("Beta");
  expect(Math.round(moved.y - b.y)).toBeGreaterThan(60);
  // The view moved; the part did not.
  expect((await module("Beta"))!.left).toBe(beta.left);
  await pinch({ x: 195, y: 330 }, 80, 240);
  await settled();
  expect((await rectOf("Beta")).width).toBeGreaterThan(moved.width * 1.8);
});

it("looks at a version from the versions sheet in place, goes back to it, and takes that back", async () => {
  await open(await make());
  const a = await rectOf("Alpha");
  await tap(center(a));
  const before = (await module("Alpha"))!;
  await swipe(center(a), { x: a.cx + 40, y: a.cy + 90 });
  await settled();
  const moved = (await module("Alpha"))!;
  await dock().getByRole("button", { name: "Save", exact: true }).tap();
  await settled();
  expect(await outlined()).toBe(1);
  await top().getByRole("button", { name: "Versions" }).tap();
  const rows = sheet().locator("li");
  await expect.poll(() => rows.count()).toBe(3);
  // The versions are looked at as wholes: the part selected is let go, with its actions.
  expect(await outlined()).toBe(0);
  expect(await actions().count()).toBe(0);
  await rows.nth(1).tap();
  await settled();
  // The sheet makes way for the version, shown in place rather than drawn again.
  expect(await sheet().count()).toBe(0);
  expect((await statuses()).join()).toContain("Viewing version 1");
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  await dock().getByRole("button", { name: "Go back to this version" }).tap();
  await settled();
  expect((await statuses()).join()).toContain("Back to version 1");
  await dock().getByRole("button", { name: "Undo", exact: true }).tap();
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: moved.left, mark: before.mark });
});

it("undoes the latest change from the top bar", async () => {
  await open(await make());
  const a = await rectOf("Alpha");
  await tap(center(a));
  const before = (await module("Alpha"))!;
  await swipe(center(a), { x: a.cx + 40, y: a.cy + 90 });
  await settled();
  await top().getByRole("button", { name: "Undo" }).tap();
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
});

it("holds a request while hand edits are unsaved, and sends it once they are saved", async () => {
  await open(await make());
  const a = await rectOf("Alpha");
  await tap(center(a));
  await swipe(center(a), { x: a.cx + 40, y: a.cy + 90 });
  await settled();
  await composer().fill("Bigger");
  await composer().press("Enter");
  await expect.poll(() => page.getByRole("alertdialog").innerText()).toContain("1 unsaved change");
  expect(asked).toEqual([]);
  await page.getByRole("button", { name: "Save and send" }).tap();
  await settled();
  expect(asked.map((a) => a.prompt)).toEqual(["Bigger\nSelected module: a\nAlpha"]);
});

it("renames the work and goes to a scene from the title's sheet", async () => {
  const id = await make({ sub: "empty" });
  await open(id);
  await top().getByRole("button", { name: "Scenes and title" }).tap();
  await sheet().getByRole("textbox").fill("Southern tea");
  await sheet().getByRole("button", { name: "Close" }).tap();
  await settled();
  expect(await top().innerText()).toContain("Southern tea");
  await top().getByRole("button", { name: "Scenes and title" }).tap();
  await sheet().getByRole("button", { name: "Sub", exact: true }).tap();
  await settled();
  expect(new URL(page.url()).pathname).toBe(`/a/${id}/sub`);
  expect(asked.map((a) => a.sceneId)).toEqual(["sub"]);
});

it("offers the exports in a sheet", async () => {
  await open(await make());
  await top().getByRole("button", { name: "Export and share" }).tap();
  const items = await sheet().getByRole("menuitem").allInnerTexts();
  expect(items.map((t) => t.trim())).toEqual(
    expect.arrayContaining(["PNG", "JPG", "Copy image", "Interactive page", "PDF"]),
  );
});

it("draws again only what shows the author's run as it goes, and only the composer while typing", async () => {
  const id = await make();
  await open(id);
  const user = { kind: "message", role: "user", text: "Draw" } as const;
  await tell({ type: "run", run: run(id, "live", "running", [user]) });
  await settled();
  const before = await renders();
  for (let i = 1; i <= 10; i++)
    await tell({ type: "run", run: run(id, "live", "running", [user, { kind: "thinking", text: "step " + i }]) });
  await settled();
  const after = await renders();
  const grew = (part: string) => (after[part] ?? 0) - (before[part] ?? 0);
  expect(grew("phone.canvas")).toBeGreaterThan(0);
  expect(grew("phone.status")).toBeGreaterThan(0);
  for (const part of ["phone.page", "phone.top", "phone.notes", "phone.composer"])
    expect([part, grew(part)]).toEqual([part, 0]);
  await tell({ type: "run", run: run(id, "live", "completed", [user]) });
  await settled();
  const quiet = await renders();
  await composer().pressSequentially("hello", { delay: 20 });
  await settled();
  const typed = await renders();
  const changed = (part: string) => (typed[part] ?? 0) - (quiet[part] ?? 0);
  expect(changed("phone.composer")).toBeGreaterThan(0);
  for (const part of ["phone.page", "phone.top", "phone.notes", "phone.canvas", "phone.status"])
    expect([part, changed(part)]).toEqual([part, 0]);
});

it("loads the phone page alone, when a work is opened", async () => {
  const chunks: string[] = [];
  page.on("request", (r) => r.url().includes("/assets/WorkPage") && r.url().endsWith(".js") && chunks.push(r.url()));
  await page.goto(base + "/");
  await settled();
  expect(chunks).toHaveLength(0);
  await open(await make());
  expect(await page.locator("[data-shell=phone]").count()).toBe(1);
  expect(chunks).toHaveLength(1);
});
