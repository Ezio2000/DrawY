import { devices } from "playwright";
import { expect, it } from "vitest";
import {
  api,
  asked,
  base,
  box,
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
/** Shows the whole drawing, when the view opened filled to the screen leaves part out. */
async function whole() {
  const button = page.getByRole("button", { name: "Whole drawing" });
  if (await button.count()) {
    await button.tap();
    await settled();
  }
}
/** A work as wide as a slide: one row of five boxes, its words at a slide's size. */
async function wide() {
  const w = await api("/works", "POST", { title: "Wide" });
  await api(`/works/${w.id}/edits`, "POST", {
    baseRevision: w.revision,
    edit: {
      drawings: [{ id: "box", name: "Box", source: box }],
      modules: ["One", "Two", "Three", "Four", "Five"].map((label, i) => ({
        id: "m" + i,
        drawingId: "box",
        bounds: [i * 320, 0, 280, 900],
        data: { label },
      })),
    },
  });
  await api(`/works/${w.id}/save`, "POST");
  await page.goto(base + "/a/" + w.id);
  await page.waitForSelector("[data-canvas]");
  await settled();
  return w.id as string;
}

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
  await whole();
  for (const words of ["Alpha", "Beta"]) await paintedAsLaidOut(words);
  // Turned on its side, a phone keeps the phone page; the view follows the new shape.
  await page.setViewportSize({ width: 844, height: 390 });
  await settled();
  await whole();
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
  // The versions are the other tab of the studio's sheet.
  await top().getByRole("button", { name: "Studio and versions" }).tap();
  await sheet().getByRole("button", { name: "Versions" }).tap();
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

it("opens a wide drawing filled to the screen from its left, large enough to read, and shows it whole on a tap", async () => {
  await wide();
  const one = await rectOf("One");
  // Filled: the first box starts at the left and is larger than it would be whole.
  expect(one.x).toBeGreaterThanOrEqual(0);
  expect(one.x).toBeLessThan(40);
  expect((await rectOf("Five")).x).toBeGreaterThan(390);
  await page.getByRole("button", { name: "Whole drawing" }).tap();
  await settled();
  const five = await rectOf("Five");
  expect(five.x + five.width).toBeLessThanOrEqual(390);
  expect((await rectOf("One")).width).toBeLessThan(one.width * 0.75);
  // Whole, the button is not needed until the view leaves part out again.
  expect(await page.getByRole("button", { name: "Whole drawing" }).count()).toBe(0);
  const at = await rectOf("Three");
  await pinch({ x: at.cx, y: at.cy }, 80, 240);
  await settled();
  expect(await page.getByRole("button", { name: "Whole drawing" }).count()).toBe(1);
});

it("keeps the studio a tap away from the top bar after the reply is put away and when the work is opened again", async () => {
  const id = await make();
  await open(id);
  await composer().fill("Draw the route");
  await composer().press("Enter");
  const user = { kind: "message", role: "user", text: "Draw the route" } as const;
  await tell({
    type: "run",
    run: run(id, "r1", "completed", [user, { kind: "message", role: "assistant", text: "Here is the route." }]),
  });
  await settled();
  await dock().getByRole("button", { name: "Collapse" }).tap();
  await settled();
  await top().getByRole("button", { name: "Studio and versions" }).tap();
  await expect.poll(() => sheet().getAttribute("aria-label")).toBe("Studio");
  expect(await sheet().getByRole("button", { name: "Studio" }).getAttribute("aria-pressed")).toBe("true");
});

it("closes a sheet when pulled down by its grip, and with the browser's way back without leaving the work", async () => {
  const id = await make();
  await open(id);
  await top().getByRole("button", { name: "Studio and versions" }).tap();
  await settled();
  const grip = (await sheet().locator("header").boundingBox())!;
  await swipe({ x: grip.x + 40, y: grip.y + 10 }, { x: grip.x + 40, y: grip.y + 200 });
  await settled();
  expect(await sheet().count()).toBe(0);
  await top().getByRole("button", { name: "Export and share" }).tap();
  await settled();
  expect(await sheet().count()).toBe(1);
  await page.goBack();
  await settled();
  expect(await sheet().count()).toBe(0);
  expect(new URL(page.url()).pathname).toBe(`/a/${id}`);
  // A sheet closed by its own button leaves no step behind: back then leaves the work.
  await top().getByRole("button", { name: "Export and share" }).tap();
  await settled();
  await sheet().getByRole("button", { name: "Close" }).tap();
  await settled();
  await page.goBack();
  await settled();
  expect(new URL(page.url()).pathname).not.toBe(`/a/${id}`);
});

it("keeps the way to let a selected part go in view, however long its name", async () => {
  const id = await make();
  await api(`/works/${id}/edits`, "POST", {
    baseRevision: (await api(`/works/${id}`)).revision,
    edit: { modules: [{ id: "a", label: "A part with a very long name that would push everything else off the screen" }] },
  });
  await open(id);
  await tap(center(await rectOf("Alpha")));
  const deselect = actions().getByRole("button", { name: "Deselect" });
  await expect.poll(() => deselect.count()).toBe(1);
  const r = (await deselect.boundingBox())!;
  expect(r.x + r.width).toBeLessThanOrEqual(390);
  expect(r.x).toBeGreaterThan(200);
});

it("types into fields at 16px, so iOS does not zoom the page in on them", async () => {
  await open(await make());
  const size = await composer().evaluate((e) => getComputedStyle(e).fontSize);
  expect(parseFloat(size)).toBeGreaterThanOrEqual(16);
});

it("shows only the first lines of a long reply over the drawing", async () => {
  const id = await make();
  await open(id);
  await composer().fill("Explain");
  await composer().press("Enter");
  const long = "The figure shows the route from the hills to the sea. ".repeat(12);
  await tell({
    type: "run",
    run: run(id, "r1", "completed", [
      { kind: "message", role: "user", text: "Explain" },
      { kind: "message", role: "assistant", text: long },
    ]),
  });
  await settled();
  const reply = (await dock().locator("button", { hasText: "The figure shows" }).first().boundingBox())!;
  expect(reply.height).toBeLessThan(60);
});

it("keeps a detail page's way back in view as it scrolls, and closes it with the browser's way back", async () => {
  const id = await make();
  await api(`/works/${id}/edits`, "POST", {
    baseRevision: (await api(`/works/${id}`)).revision,
    edit: {
      details: [{ id: "notes", title: "Notes", html: "<p>A long note on the route.</p>".repeat(80) }],
      modules: [{ id: "a", target: { kind: "detail", id: "notes" } }],
    },
  });
  await open(id);
  await tap(center(await rectOf("Alpha")));
  await settled();
  const back = page.getByRole("button", { name: "← Back to the picture" });
  await expect.poll(() => back.count()).toBe(1);
  await page.evaluate(() => {
    const layer = [...document.querySelectorAll<HTMLElement>("div")].find((d) => d.scrollHeight > d.clientHeight * 3);
    layer!.scrollTop = layer!.scrollHeight;
  });
  await settled();
  const r = (await back.boundingBox())!;
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.y).toBeLessThan(120);
  await page.goBack();
  await settled();
  expect(await back.count()).toBe(0);
  expect(new URL(page.url()).pathname).toBe(`/a/${id}`);
});

it("catches up on what changed while the page was hidden, as a phone does with a page put away", async () => {
  const id = await make();
  await open(id);
  const shown = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await shown(true);
  await settled();
  // Renamed elsewhere while this page cannot hear it.
  await api(`/works/${id}`, "PATCH", { title: "Renamed elsewhere" });
  await shown(false);
  await expect.poll(() => top().innerText(), { timeout: 10_000 }).toContain("Renamed elsewhere");
});

it("lays the home page out for a phone: it scrolls to every work, and its menus open inside the screen", async () => {
  for (let i = 0; i < 5; i++) await make();
  await page.goto(base + "/");
  await settled();
  const works = page.locator("ul li button", { hasText: "Check" });
  // Every work is there to scroll to (the other tests made some too).
  await expect.poll(() => works.count()).toBeGreaterThanOrEqual(5);
  const last = works.last();
  await last.scrollIntoViewIfNeeded();
  const r = (await last.boundingBox())!;
  expect(r.y + r.height).toBeLessThanOrEqual(664);
  // The composer stays at the foot, over the works.
  const field = (await page.locator("textarea").boundingBox())!;
  expect(field.y + field.height).toBeLessThanOrEqual(664);
  for (const name of ["Add", "Style"]) {
    await page.getByRole("button", { name, exact: true }).tap();
    await settled();
    const menu = (await page.getByRole("menu").boundingBox())!;
    expect([name, menu.x >= 0 && menu.y >= 0 && menu.x + menu.width <= 390 && menu.y + menu.height <= 664]).toEqual([name, true]);
    await page.getByRole("button", { name, exact: true }).tap();
    await settled();
  }
});

it("keeps the drawing large on a phone turned on its side with a reply open, and takes the room back when it is put away", async () => {
  const id = await make();
  await open(id);
  await composer().fill("Explain");
  await composer().press("Enter");
  await tell({
    type: "run",
    run: run(id, "r1", "completed", [
      { kind: "message", role: "user", text: "Explain" },
      { kind: "message", role: "assistant", text: "The figure shows the route from the hills to the sea. ".repeat(6) },
    ]),
  });
  await settled();
  await page.setViewportSize({ width: 844, height: 390 });
  await settled();
  await whole();
  const shown = await rectOf("Alpha");
  // Not a dot: the drawing keeps at least half the screen's height to show in.
  expect(shown.width).toBeGreaterThan(120);
  await dock().getByRole("button", { name: "Collapse" }).tap();
  await settled();
  expect((await rectOf("Alpha")).width).toBeGreaterThanOrEqual(shown.width - 1);
});

it("changes the words a part was selected by, not the first it draws", async () => {
  const w = await api("/works", "POST", { title: "Steps" });
  const step = `return api.svg('<svg viewBox="0 0 '+api.width+' '+api.height+'"><circle cx="40" cy="40" r="26" fill="#3a6fd8"/><text x="40" y="52" font-size="32" fill="#fff" text-anchor="middle">'+api.data.n+'</text><text x="84" y="54" font-size="30">'+api.data.label+'</text></svg>')`;
  await api(`/works/${w.id}/edits`, "POST", {
    baseRevision: w.revision,
    edit: {
      drawings: [{ id: "step", name: "Step", source: step }],
      modules: [{ id: "s", drawingId: "step", bounds: [0, 0, 300, 90], data: { n: "1", label: "Measure" } }],
    },
  });
  await page.goto(base + "/a/" + w.id);
  await page.waitForSelector("[data-canvas]");
  await settled();
  const words = await page.evaluate(() => {
    const host = [...document.querySelectorAll("*")].find((e) => e.shadowRoot?.textContent?.includes("Measure"))!;
    const r = [...host.shadowRoot!.querySelectorAll("text")].find((t) => t.textContent === "Measure")!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await tap(words);
  await actions().getByRole("button", { name: "Edit text" }).tap();
  await expect
    .poll(() => page.evaluate(() => (document.activeElement as HTMLTextAreaElement)?.value))
    .toBe("Measure");
});

it("keeps the send button on screen however long the request, with the keyboard up", async () => {
  await open(await make());
  // The keyboard takes the bottom of the screen.
  await page.setViewportSize({ width: 390, height: 360 });
  await settled();
  await composer().fill(Array.from({ length: 8 }, (_, i) => `Line ${i + 1} of what to draw`).join("\n"));
  await settled();
  const send = (await page.getByRole("button", { name: "Send" }).boundingBox())!;
  expect(send.y).toBeGreaterThanOrEqual(0);
  expect(send.y + send.height).toBeLessThanOrEqual(360);
});
