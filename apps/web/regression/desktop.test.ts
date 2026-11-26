import { expect, it } from "vitest";
import {
  api,
  asked,
  base,
  box,
  browser,
  cdp,
  composer,
  context,
  count,
  drag,
  editing,
  make,
  module,
  open,
  outlined,
  page,
  paintedAsLaidOut,
  rectOf,
  renders,
  run,
  settled,
  setup,
  statuses,
  tell,
} from "./harness.ts";

/* The desktop work page as AGENTS.md describes it, on a computer's screen with a mouse and
 * a keyboard (see harness.ts for how the app is run). */

setup({ viewport: { width: 1440, height: 900 } });

it("paints the drawing's words as laid out; shows a hand edit at once and lays the saved one over it in place; undoes it, throws it away and takes that back, and saves it by keyboard; its seal opens the versions, which are looked at and gone back to in place, which can be undone", async () => {
  await open(await make());
  for (const words of ["Alpha", "Beta"]) await paintedAsLaidOut(words);
  // The seal in the title block is the version in hand; it opens the versions and closes them.
  const seal = (name: string) => page.getByRole("button", { name, exact: true });
  expect(await seal("Version 1").innerText()).toBe("1");
  await seal("Version 1").click();
  await settled();
  const versions = page.getByRole("heading", { name: "Versions", exact: true });
  expect(await versions.isVisible()).toBe(true);
  expect(await seal("Version 1").getAttribute("aria-pressed")).toBe("true");
  await seal("Version 1").click();
  await settled();
  expect(await versions.count()).toBe(0);
  // A hand edit shows before the server has it, and the saved one is laid over it in place.
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
  const moved = (await module("Alpha"))!;
  expect(moved.left).not.toBe(before.left);
  release();
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: moved.left, mark: before.mark });
  // While editing by hand only the dot on the seal says the edits are not saved yet.
  expect(await seal("Version 1 · unsaved changes").count()).toBe(1);
  expect((await statuses()).join()).not.toContain("not saved");
  // A further edit is counted at once: the dot stays while the revisions catch up, rather
  // than leaving and coming back on every edit.
  let list!: () => void;
  const listed = new Promise<void>((r) => (list = r));
  await page.route("**/api/works/*/revisions", async (route) => {
    await listed;
    await route.continue();
  });
  await drag("Alpha");
  await expect.poll(async () => (await module("Alpha"))!.left).not.toBe(moved.left);
  await page.waitForTimeout(300);
  expect(await seal("Version 1 · unsaved changes").count()).toBe(1);
  list();
  await page.unroute("**/api/works/*/revisions");
  await settled();
  // Undone by keyboard, in place, a step at a time; moved again.
  await page.keyboard.press("Control+z");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: moved.left, mark: before.mark });
  await page.keyboard.press("Control+z");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  expect((await statuses()).join()).not.toContain("not saved");
  await drag("Alpha");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: moved.left, mark: before.mark });
  // Done editing, the edits not saved are said over the composer.
  await editing();
  expect(await statuses()).toContain("1 change not saved\nDiscard changes\nSave as version 2");
  // Thrown away, which can be undone.
  await page.getByRole("button", { name: "Discard changes" }).click();
  await settled();
  expect(await statuses()).toContain("Changes discarded\nUndo");
  expect((await module("Alpha"))!.left).toBe(before.left);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled();
  expect((await module("Alpha"))!.left).toBe(moved.left);
  // Saved by keyboard: the seal is the new version's.
  await page.keyboard.press("Control+s");
  await settled();
  expect(await statuses()).toContain("Saved as version 2");
  expect(await seal("Version 2").innerText()).toBe("2");
  // The versions are looked at as wholes: what was selected is let go.
  const alpha = await rectOf("Alpha");
  await page.mouse.click(alpha.cx, alpha.cy);
  expect(await outlined()).toBe(1);
  await page.getByRole("button", { name: "Versions" }).click();
  const rows = page.locator("[data-kind=drafts] li");
  await expect.poll(() => rows.allInnerTexts()).toHaveLength(3);
  expect(await outlined()).toBe(0);
  await rows.nth(1).click();
  await settled();
  expect(await statuses()).toContain("Viewing version 1\nBack to current\nGo back to this version");
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  await page.keyboard.press("Escape");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: moved.left });
  await rows.nth(1).click();
  await settled();
  await page.getByRole("button", { name: "Go back to this version" }).click();
  await settled();
  expect(await statuses()).toContain("Back to version 1\nUndo");
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: moved.left, mark: before.mark });
  expect((await statuses()).join()).not.toContain("Back to version");
});

it("holds a request while hand edits are unsaved, until they are saved, thrown away or kept", async () => {
  await open(await make());
  await editing();
  await drag("Alpha");
  await settled();
  // While editing the composer is put away until a change is to be described.
  expect(await composer().isVisible()).toBe(false);
  await page
    .getByRole("toolbar", { name: "The selection's look" })
    .getByRole("button", { name: "Describe a change" })
    .click();
  await expect.poll(() => composer().evaluate((el) => el === document.activeElement)).toBe(true);
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
  // Back on the board, the empty composer is put away again.
  const paper = (await page.locator("[data-canvas]").boundingBox())!;
  await page.mouse.click(paper.x + paper.width - 80, paper.y + 120);
  await expect.poll(() => composer().isVisible()).toBe(false);
  // The work's second save: the one the request waited for.
  const revisions: { cause: { kind: string } }[] = await api(`/works/${page.url().split("/a/")[1]}/revisions`);
  expect(revisions.filter((r) => r.cause.kind === "save")).toHaveLength(2);
});

it("places words ready to type on a blank canvas, and duplicates, copies and pastes them", async () => {
  // The blank canvas is a press away in the sidebar.
  await page.goto(base + "/");
  await page.getByRole("navigation", { name: "Navigation" }).getByRole("button", { name: "New blank canvas", exact: true }).click();
  await page.waitForURL(/\/new$/);
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
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await settled();
  expect(await count("Hello")).toBe(3);
  await page.keyboard.press("Delete");
  await settled();
  expect(await count("Hello")).toBe(2);
});

/** What the page is typing into, by its words. */
const typing = () => page.evaluate(() => (document.activeElement as HTMLTextAreaElement)?.value);
/** The work's root scene, as the server holds it. */
const rootOf = async (id: string) => (await api("/works/" + id)).scenes.root;

it("builds a figure by hand: a shape drawn to size and typed in, a side's plus growing it, the link tool, a copy dragged off, and the look given from the bar", async () => {
  const id = await make();
  await open(id);
  await editing();
  // The view makes room for the tools at its edges, and then stays where it is.
  await settled();
  // The tray holds the tools; R takes up the box, which is drawn by dragging its size out.
  const tray = page.getByRole("navigation", { name: "Editing tools" });
  expect(await tray.getByRole("button", { name: "Select", exact: true }).getAttribute("aria-pressed")).toBe("true");
  // A tool pressed takes no focus, so the keys go on taking up tools and no ring is left.
  await tray.getByRole("button", { name: "Box", exact: true }).click();
  await page.keyboard.press("h");
  expect(await tray.getByRole("button", { name: "Pan", exact: true }).getAttribute("aria-pressed")).toBe("true");
  expect(await tray.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  await page.keyboard.press("v");
  await page.keyboard.press("r");
  expect(await tray.getByRole("button", { name: "Box", exact: true }).getAttribute("aria-pressed")).toBe("true");
  const beta = await rectOf("Beta");
  const corner = { x: beta.x, y: beta.y + beta.height + 90 };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 80, corner.y + 30, { steps: 4 });
  await page.mouse.move(corner.x + beta.width, corner.y + beta.height, { steps: 4 });
  await page.mouse.up();
  // The library's node is taken in; once drawn its words are ready to type over.
  await expect.poll(typing, { timeout: 10_000 }).toBe("Type here");
  await page.keyboard.type("Gamma");
  await page.keyboard.press("Enter");
  await settled();
  expect(await count("Gamma")).toBe(1);
  // The hand has the selecting tool again, and the box is the size it was drawn.
  expect(await tray.getByRole("button", { name: "Select", exact: true }).getAttribute("aria-pressed")).toBe("true");
  const gamma = await rectOf("Gamma");
  expect(Math.abs(gamma.width - beta.width)).toBeLessThan(3);
  expect(Math.abs(gamma.x - corner.x)).toBeLessThan(3);
  // The selection is measured, and the plus of the side the pointer nears comes out: a
  // press on it grows the figure by a part like this one, linked to it.
  expect(await outlined()).toBe(1);
  await page.mouse.move(gamma.x + gamma.width - 6, gamma.cy);
  const plus = (await page.locator('[data-connect="right"]').boundingBox())!;
  await page.mouse.click(plus.x + plus.width / 2, plus.y + plus.height / 2);
  await expect.poll(typing, { timeout: 10_000 }).toBe("Type here");
  await page.keyboard.type("Delta");
  await page.keyboard.press("Enter");
  await settled();
  let root = await rootOf(id);
  const made = (words: string) => root.modules.find((m: { data: { title?: string } }) => m.data.title === words);
  expect(made("Delta")).toMatchObject({ drawingId: "node", bounds: { y: made("Gamma").bounds.y } });
  expect(made("Delta").bounds.x).toBeGreaterThan(made("Gamma").bounds.x + made("Gamma").bounds.width);
  expect(root.links).toMatchObject([
    { from: { moduleId: made("Gamma").id, at: "right" }, to: { moduleId: made("Delta").id, at: "left" } },
  ]);
  // The new part was beyond the canvas's edge: the view has moved to show it whole.
  const canvas = (await page.locator("[data-canvas]").boundingBox())!;
  const delta = await rectOf("Delta");
  expect(delta.x + delta.width).toBeLessThan(canvas.x + canvas.width);
  // The whole figure in view again, by its key. The link tool joins two parts as they face
  // each other.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit1");
  await settled();
  await page.keyboard.press("l");
  const alpha = await rectOf("Alpha"),
    beta2 = await rectOf("Beta");
  await page.mouse.move(alpha.cx, alpha.cy);
  await page.mouse.down();
  await page.mouse.move(alpha.cx + 60, alpha.cy + 10, { steps: 4 });
  await page.mouse.move(beta2.cx, beta2.cy, { steps: 6 });
  await page.mouse.up();
  await settled();
  root = await rootOf(id);
  expect(root.links.at(-1)).toMatchObject({ from: { moduleId: "a" }, to: { moduleId: "b" } });
  expect(root.links.at(-1).from.at).toBeUndefined();
  expect((await module("Alpha"))!.left).toBe("100px");
  // With Alt held, a drag takes a copy off and the part stays.
  await page.keyboard.press("v");
  await page.mouse.click(alpha.cx, alpha.cy);
  await page.keyboard.down("Alt");
  await page.mouse.move(alpha.cx, alpha.cy);
  await page.mouse.down();
  await page.mouse.move(alpha.cx - 10, alpha.cy - 40, { steps: 4 });
  await page.mouse.move(alpha.cx, alpha.cy - 110, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await settled();
  expect(await count("Alpha")).toBe(2);
  root = await rootOf(id);
  expect(root.modules.find((m: { id: string }) => m.id === "a").bounds).toMatchObject({ x: 100, y: 100 });
  // The bar under the selection gives everything selected one look.
  const g = await rectOf("Gamma"),
    d = await rectOf("Delta");
  await page.mouse.click(g.cx, g.cy);
  await page.keyboard.down("Shift");
  await page.mouse.click(d.cx, d.cy);
  await page.keyboard.up("Shift");
  const bar = page.getByRole("toolbar", { name: "The selection's look" });
  await bar.getByRole("button", { name: "Tone", exact: true }).click();
  await bar.getByRole("menuitemradio", { name: "Accent", exact: true }).click();
  await settled();
  root = await rootOf(id);
  expect(made("Gamma").data.tone).toBe("accent");
  expect(made("Delta").data.tone).toBe("accent");
});

it("selects as drawing tools do: a box over a zone takes what lies in it (with Alt what it touches) and the links among them, a zone pressed is selected and dragged with what it holds, a group is selected whole and entered by a second press, and links are selected together and taken out at once", async () => {
  const w = await api("/works", "POST", { title: "Zones" });
  const part = (id: string, label: string, bounds: number[], group?: string) => ({
    id,
    drawingId: "box",
    bounds,
    data: { label },
    ...(group ? { group } : {}),
  });
  await api(`/works/${w.id}/edits`, "POST", {
    baseRevision: w.revision,
    edit: {
      drawings: [{ id: "box", name: "Box", source: box }],
      // The zone is drawn first, under what it holds.
      modules: [
        part("zone", "Zone", [60, 60, 700, 300]),
        part("a", "Alpha", [100, 140, 160, 80]),
        part("b", "Beta", [460, 140, 160, 80]),
        part("g", "Gamma", [100, 460, 160, 80], "pair"),
        part("d", "Delta", [460, 460, 160, 80], "pair"),
      ],
      links: [
        { id: "ab", from: { moduleId: "a" }, to: { moduleId: "b" } },
        { id: "gd", from: { moduleId: "g" }, to: { moduleId: "d" } },
      ],
    },
  });
  await api(`/works/${w.id}/save`, "POST");
  await open(w.id);
  await editing();
  await settled();
  // What the request would be about: what is selected, by name.
  const quoted = async () => (await page.locator("[data-dock] [class*=quote] span").allInnerTexts()).join();
  const boxOver = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  };
  // A box begun on the zone selects what lies wholly in it, and the link between them,
  // not the zone; nothing moves.
  const zone = await rectOf("Zone"),
    alpha = await rectOf("Alpha"),
    beta = await rectOf("Beta");
  await boxOver({ x: alpha.x - 12, y: alpha.y - 12 }, { x: beta.x + beta.width + 12, y: beta.y + beta.height + 12 });
  expect(await quoted()).toBe("Alpha, Beta, Alpha → Beta");
  expect((await rectOf("Zone")).x).toBe(zone.x);
  // With Alt it takes what it touches.
  await page.keyboard.down("Alt");
  await boxOver({ x: alpha.x - 12, y: alpha.y - 12 }, { x: alpha.cx, y: alpha.cy });
  await page.keyboard.up("Alt");
  expect(await quoted()).toBe("Alpha");
  // A press on the zone, let go where it was, selects it; dragged, what it holds goes
  // with it, and nothing else.
  await page.mouse.click(zone.x + 20, zone.y + zone.height - 20);
  expect(await quoted()).toBe("Zone");
  await page.mouse.move(zone.x + 20, zone.y + zone.height - 20);
  await page.mouse.down();
  await page.mouse.move(zone.x + 40, zone.y + zone.height - 10, { steps: 4 });
  await page.mouse.move(zone.x + 60, zone.y + zone.height, { steps: 4 });
  await page.mouse.up();
  await settled();
  let root = await rootOf(w.id);
  const at = (id: string) => root.modules.find((m: { id: string }) => m.id === id).bounds;
  const dx = at("zone").x - 60,
    dy = at("zone").y - 60;
  expect(dx).toBeGreaterThan(20);
  expect(at("a")).toMatchObject({ x: 100 + dx, y: 140 + dy });
  expect(at("b")).toMatchObject({ x: 460 + dx, y: 140 + dy });
  expect(at("g")).toMatchObject({ x: 100, y: 460 });
  // A press on a grouped part selects the group; a second press, the part alone, which
  // then moves by itself.
  const gamma = await rectOf("Gamma");
  await page.mouse.click(gamma.cx, gamma.cy);
  expect(await quoted()).toBe("Gamma, Delta");
  await page.mouse.click(gamma.cx, gamma.cy);
  expect(await quoted()).toBe("Gamma");
  await drag("Gamma");
  await settled();
  root = await rootOf(w.id);
  expect(at("g").x).not.toBe(100);
  expect(at("d")).toMatchObject({ x: 460, y: 460 });
  // Links are selected together with Shift, and taken out at once.
  const a = await rectOf("Alpha"),
    b = await rectOf("Beta"),
    g = await rectOf("Gamma"),
    d = await rectOf("Delta");
  await page.mouse.click((a.x + a.width + b.x) / 2, a.cy);
  await page.keyboard.down("Shift");
  await page.mouse.click((g.x + g.width + d.x) / 2, (g.cy + d.cy) / 2);
  await page.keyboard.up("Shift");
  expect(await quoted()).toBe("Alpha → Beta, Gamma → Delta");
  expect(await page.getByRole("heading", { name: "2 connections selected" }).count()).toBe(1);
  await page.keyboard.press("Delete");
  await settled();
  root = await rootOf(w.id);
  expect(root.links).toEqual([]);
  expect(root.modules).toHaveLength(5);
});

it("measures the drawing board: rulers, the view's scale and its settings, parts moved and resized on the squares, and the sheet of shortcuts", async () => {
  const id = await make();
  await open(id);
  const rulers = page.locator("canvas[data-axis]");
  expect(await rulers.count()).toBe(0);
  // The rulers are off until asked for, to leave the canvas room.
  await editing();
  expect(await rulers.count()).toBe(0);
  // The scale shows in figures and opens the scales to go to and the board's settings.
  const scale = page.getByRole("button", { name: /^Shown at \d+%/ });
  await scale.click();
  await page.getByRole("menuitem", { name: /^100%/ }).click();
  await expect.poll(() => scale.innerText()).toBe("100%");
  await scale.click();
  await page.getByRole("menuitemcheckbox", { name: "Rulers" }).click();
  expect(await rulers.count()).toBe(2);
  await page.getByRole("menuitemcheckbox", { name: "Rulers" }).click();
  expect(await rulers.count()).toBe(0);
  // On the squares, a dragged part ends on their lines.
  await page.getByRole("menuitemcheckbox", { name: "Snap to the squares" }).click();
  await page.keyboard.press("Escape");
  const alpha = await rectOf("Alpha");
  await page.keyboard.down("Shift");
  await page.mouse.move(alpha.cx, alpha.cy);
  await page.mouse.down();
  await page.mouse.move(alpha.cx + 20, alpha.cy, { steps: 3 });
  await page.mouse.move(alpha.cx + 47, alpha.cy, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settled();
  expect((await module("Alpha"))!.left).toBe("140px");
  await scale.click();
  await page.getByRole("menuitemcheckbox", { name: "Snap to the squares" }).click();
  await page.keyboard.press("Escape");
  // A resize on the squares ends its free side on their lines.
  await scale.click();
  await page.getByRole("menuitem", { name: /^100%/ }).click();
  await scale.click();
  await page.getByRole("menuitemcheckbox", { name: "Snap to the squares" }).click();
  await page.keyboard.press("Escape");
  const h = (await page.locator('[data-handle="se"]').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 47, h.y + h.height / 2 + 3, { steps: 8 });
  await page.mouse.up();
  await settled();
  expect((await rootOf(id)).modules.find((m: { id: string }) => m.id === "a").bounds).toMatchObject({ width: 280, height: 120 });
  // The whole drawing again, by its key; actual size by its own, on a focused canvas; and
  // the shortcuts, by theirs.
  await page.keyboard.press("Shift+Digit1");
  await expect.poll(() => scale.innerText()).not.toBe("100%");
  await page.locator("[data-canvas]").focus();
  await page.keyboard.press("ControlOrMeta+0");
  await expect.poll(() => scale.innerText()).toBe("100%");
  await page.keyboard.press("Shift+Slash");
  expect(await page.getByRole("heading", { name: "Shortcuts and gestures" }).count()).toBe(1);
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

it.each(["home", "dock"] as const)("keeps Chinese IME composition intact in the %s composer", async (place) => {
  if (place === "home") await page.goto(base + "/");
  else await open(await make());
  const field = place === "home" ? page.locator("textarea").first() : composer();
  await field.click();
  for (const text of ["n", "ni", "nihao"]) {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
    expect(await field.inputValue()).toBe(text);
  }
  await cdp.send("Input.insertText", { text: "你好" });
  expect(await field.inputValue()).toBe("你好");
  // Some IMEs end composition before the confirming keydown, leaving only keyCode 229.
  await field.dispatchEvent("keydown", { key: "Enter", keyCode: 229, isComposing: false });
  expect(asked).toEqual([]);
  await field.pressSequentially(" DrawY");
  expect(await field.inputValue()).toBe("你好 DrawY");
  expect(asked).toEqual([]);
  await field.press("Enter");
  await expect.poll(() => asked.map((a) => a.prompt)).toEqual(["你好 DrawY"]);
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
  // The composer, put away while editing, is asked for from the menu on the paper.
  const paper = (await page.locator("[data-canvas]").boundingBox())!;
  await page.mouse.click(paper.x + paper.width - 80, paper.y + 120, { button: "right" });
  await page.getByRole("menuitem", { name: "Describe a change to the drawing" }).click();
  await expect.poll(() => composer().evaluate((el) => el === document.activeElement)).toBe(true);
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

it("keeps a text tool's dragged bounds and turns default bold off", async () => {
  const id = await make();
  await open(id);
  await editing();
  const scale = page.getByRole("button", { name: /^Shown at \d+%/ });
  await scale.click();
  await page.getByRole("menuitem", { name: /^100%/ }).click();
  const beta = await rectOf("Beta");
  const x = beta.x, y = beta.y + beta.height + 80;
  await page.keyboard.press("t");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 240, y + 80, { steps: 8 });
  await page.mouse.up();
  await expect.poll(typing).toBe("Type here");
  await page.keyboard.type("Text box");
  await page.keyboard.press("Enter");
  await settled();
  const bounds = await rectOf("Text box");
  expect(Math.abs(bounds.width - 240)).toBeLessThan(3);
  expect(Math.abs(bounds.height - 80)).toBeLessThan(3);
  // A node falls back to bold by default; switching bold off must set a normal weight.
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await page.mouse.click(x - 100, y);
  await expect.poll(typing).toBe("Type here");
  await page.keyboard.type("Node");
  await page.keyboard.press("Enter");
  await settled();
  const node = await rectOf("Node"), text = await rectOf("Text box");
  await page.mouse.click(node.cx, node.cy);
  await page.keyboard.down("Shift");
  await page.mouse.click(text.cx, text.cy);
  await page.keyboard.up("Shift");
  const bar = page.getByRole("toolbar", { name: "The selection's look" });
  await bar.getByRole("button", { name: "Bold", exact: true }).click();
  await settled();
  await bar.getByRole("button", { name: "Bold", exact: true }).click();
  await settled();
  expect((await rootOf(id)).modules.find((m: any) => m.data.title === "Node").data.weight).toBe(400);
});

it("gives a dropped image only to the canvas or composer that received it", async () => {
  const id = await make();
  await open(id);
  await editing();
  let uploads = 0;
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/materials")) uploads++; });
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    canvas.getContext("2d")!.fillRect(0, 0, 32, 32);
    const bytes = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), c => c.charCodeAt(0));
    dt.items.add(new File([bytes], "pixel.png", { type: "image/png" }));
    return dt;
  });
  await page.locator("[data-canvas]").dispatchEvent("drop", { dataTransfer, clientX: 500, clientY: 400 });
  await expect.poll(async () => (await rootOf(id)).modules.length).toBe(3);
  await settled();
  expect(uploads).toBe(1);
  expect(await page.locator('[class*="attachments"] button').count()).toBe(0);
  await page.locator('[class*="composer"][data-place="dock"]').filter({ has: page.locator("textarea") }).last().dispatchEvent("drop", { dataTransfer });
  await expect.poll(() => uploads).toBe(2);
  await settled();
  expect((await rootOf(id)).modules).toHaveLength(3);
  await dataTransfer.dispose();
});

it("shows guests the home page with its works drawn live, and no sign-in wall", async () => {
  const guest = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 900 } });
  const guestPage = await guest.newPage();
  await guestPage.goto(base + "/");
  expect(await guestPage.getByRole("heading", { level: 1 }).innerText()).toContain("say it and it's drawn");
  expect(await guestPage.getByRole("dialog").count()).toBe(0);
  // The first screen is only for asking; what DrawY draws waits below, works drawn by the
  // canvas, not pictures of them.
  expect(await guestPage.locator("[data-canvas]").count()).toBe(0);
  await guestPage.getByRole("button", { name: "See what it can draw" }).click();
  await guestPage.waitForSelector("[data-canvas]");
  // An example goes into the box to send.
  await guestPage.getByRole("button", { name: "How does the solar system work?" }).first().click();
  expect(await guestPage.locator("textarea").first().inputValue()).toBe("How does the solar system work?");
  // The footer's kinds take the reader to their chapter along the range, whose sheet shows
  // that work and nothing else.
  await guestPage.getByRole("navigation", { name: "What it draws" }).getByRole("button", { name: "Map" }).click();
  await expect
    .poll(() => guestPage.locator("#l-chapter-coast").getAttribute("data-on"), { timeout: 8000 })
    .toBe("true");
  expect(await guestPage.getByRole("button", { name: /^Ask this yourself/ }).count()).toBe(0);
  const range = guestPage.getByRole("navigation", { name: "Switch pictures" });
  const ticks = range.locator("div").first().getByRole("button");
  const rows = await ticks.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(rows).toHaveLength(11);
  expect(new Set(rows).size).toBe(1);
  await ticks.last().click();
  const board = guestPage.locator('[class*="l-story-slot"]:not([inert]) [data-shown]');
  await board.getByText("The Lighthouse Stevensons", { exact: true }).first().waitFor();
  await guestPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await guestPage.getByRole("button", { name: "Language · 中文" }).click();
  await guestPage.keyboard.press("Escape");
  await board.getByText("造灯塔的一家人", { exact: true }).first().waitFor();
  await guestPage.getByRole("navigation", { name: "切换作品" }).getByRole("button").first().click();
  await guestPage.waitForSelector("#l-chapter-reference[data-on]");
  await guest.close();
});

it("opens the blank canvas for guests and prompts sign-in only when sending, then continues", async () => {
  const guest = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 900 } });
  const guestPage = await guest.newPage();
  await guestPage.goto(base + "/new");
  await guestPage.waitForSelector("[data-canvas]");
  // No login wall on arrival; the composer is ready to type in.
  expect(await guestPage.getByRole("dialog").count()).toBe(0);
  const box = guestPage.locator("[data-dock] textarea");
  await box.fill("Draw a solar system");
  await guestPage.getByRole("button", { name: "Send" }).click();
  // Contextual login modal pops up without losing what was typed.
  const dialog = guestPage.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  expect(await dialog.innerText()).toContain("what you wrote will be kept");
  await dialog.getByLabel("Username").fill("desk");
  await dialog.getByLabel("Password", { exact: true }).fill("password123");
  await guestPage.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        labels: [{ id: "default", name: "Default", description: "", ready: true }],
        chosen: { label: "default" },
      },
    }),
  );
  await guestPage.route("**/api/works/*/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ json: { id: "r-guest", workId: "w", sceneId: "root", status: "done", prompt: "Draw a solar system", steps: [], createdAt: Date.now() } });
  });
  await dialog.getByRole("button", { name: "Log in" }).click();
  await guestPage.waitForURL(/\/a\//);
  await guest.close();
});

it("loads the sidebar on demand, keeps its scroll, and updates only the changed work across a snapshot", async () => {
  for (let i = 0; i < 32; i++) await api("/works", "POST", { title: "Rail " + i });
  const first = await api("/works", "POST", { title: "Original title" });
  const removed = await api("/works", "POST", { title: "Removed while loading" });
  const requests: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((done) => { release = done; });
  let captured!: () => void;
  const snapshot = new Promise<void>((done) => { captured = done; });
  await page.route(/\/api\/works(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    requests.push(route.request().url());
    const response = await route.fetch();
    if (requests.length === 1) {
      captured();
      await held;
    }
    await route.fulfill({ response });
  });
  // The tab is listening before the shelf is opened.
  await cdp.send("Network.enable");
  const connected = new Promise<void>((resolve) => {
    cdp.on("Network.eventSourceMessageReceived", (event) => {
      if (event.eventName === "message" && JSON.parse(event.data).type === "connected") resolve();
    });
  });
  await page.goto(base + "/new");
  await connected;
  const nav = page.locator("nav[data-open]");
  const list = nav.locator("ul");
  const toggle = (name: string) => nav.getByRole("button", { name, exact: true }).click();
  expect(requests).toHaveLength(0);
  expect(await nav.locator("li").count()).toBe(0);
  await toggle("Open sidebar");
  await snapshot;
  await api("/works/" + first.id, "PATCH", { title: "Renamed during load" });
  await api("/works/" + removed.id, "DELETE");
  const added = await api("/works", "POST", { title: "Created during load" });
  release();
  await nav.getByText("Renamed during load", { exact: true }).waitFor();
  await nav.getByText("Created during load", { exact: true }).waitFor();
  expect(await nav.getByText("Removed while loading").count()).toBe(0);
  expect(requests.map((url) => new URL(url).search)).toEqual(["?covers=0"]);

  const before = (await renders())["rail-row"];
  await api("/works/" + added.id, "PATCH", { title: "One changed row" });
  await nav.getByText("One changed row", { exact: true }).waitFor();
  expect((await renders())["rail-row"] - before).toBe(1);
  const user = { kind: "message", role: "user", text: "A new prompt" } as const;
  const [summary] = (await api("/works?covers=0")).filter((row: { id: string }) => row.id === added.id);
  const progress = { ...summary.progress, prompt: user.text };
  await tell({ type: "summary", summary: { ...summary, progress: { ...progress, run: "running" } } });
  await nav.locator('button[title="A new prompt"]').getByText("Drawing…").waitFor();
  const drawn = (await renders())["rail-row"];
  await tell({ type: "run", run: run(added.id, "ongoing", "running", [user, { kind: "thinking", text: "Thinking" }]) });
  await tell({ type: "summary", summary: { ...summary, progress: { ...progress, run: "completed" } } });
  await expect.poll(() => nav.getByText("Drawing…").count()).toBe(0);
  expect((await renders())["rail-row"] - drawn).toBe(1);

  await list.evaluate((el) => { el.scrollTop = 250; });
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(250);
  await toggle("Close sidebar");
  expect(await nav.locator("li").count()).toBe(0);
  await api("/works/" + first.id, "PATCH", { title: "Changed while closed" });
  await toggle("Open sidebar");
  await nav.getByText("Changed while closed", { exact: true }).waitFor();
  expect(await list.evaluate((el) => el.scrollTop)).toBe(250);
  expect(requests).toHaveLength(1);

  await toggle("Close sidebar");
  await tell({ type: "connected" });
  await settled();
  expect(requests).toHaveLength(1);
  await toggle("Open sidebar");
  await expect.poll(() => requests.length).toBe(2);
}, 20_000);

it("requests covers only in work records and restores the sidebar row on undo or a failed deletion", async () => {
  const work = await api("/works", "POST", { title: "Undo this deletion" });
  let lists = 0;
  page.on("request", (req) => {
    if (req.method() === "GET" && new URL(req.url()).pathname === "/api/works") lists++;
  });
  await page.goto(base + "/traces");
  await page.getByRole("button", { name: "Runs", exact: true }).waitFor();
  expect(lists).toBe(0);
  const withCovers = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/works");
  await page.getByRole("button", { name: "Works", exact: true }).click();
  const recordRows = await (await withCovers).json();
  expect(recordRows.find((row: { id: string }) => row.id === work.id)).toHaveProperty("cover");
  const nav = page.locator("nav[data-open]");
  const withoutCovers = page.waitForResponse((r) => r.url().endsWith("/api/works?covers=0"));
  await nav.getByRole("button", { name: "Open sidebar" }).click();
  const railRows = await (await withoutCovers).json();
  expect(railRows.find((row: { id: string }) => row.id === work.id)).not.toHaveProperty("cover");
  const row = nav.locator("li").filter({ hasText: work.title });
  const remove = nav.getByRole("button", { name: "Delete " + work.title, exact: true });
  await row.hover();
  await remove.click();
  expect(await row.count()).toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await row.waitFor();
  await page.route("**/api/works/" + work.id, (route) => route.fulfill({ status: 409, json: { error: "Work is busy" } }));
  await row.hover();
  await remove.click();
  await row.waitFor({ timeout: 10_000 });
  await page.getByText("Work is busy", { exact: true }).waitFor();
  expect(lists).toBe(2);
}, 20_000);

it("draws by hand with the pen, the arrow and the eraser; brings Mermaid and Excalidraw in by pasting; and sends the scene out as Excalidraw and Mermaid", async () => {
  const id = await open(await make()).then(() => page.url().split("/a/")[1]);
  await editing();
  await settled();
  const tray = page.getByRole("navigation", { name: "Editing tools" });
  const own = async (kind: string) => {
    const w = await api("/works/" + id);
    return w.scenes.root.modules.filter((m: { drawingId: string }) => w.drawings[m.drawingId]?.source.startsWith("// drawy:" + kind));
  };
  // The pen draws where it goes and stays in hand for the next line.
  await page.keyboard.press("p");
  const alpha = await rectOf("Alpha"),
    beta = await rectOf("Beta");
  const y = alpha.y + alpha.height + 120;
  await page.mouse.move(alpha.x, y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(alpha.x + i * 15, y + Math.sin(i / 3) * 30);
  await page.mouse.up();
  await settled();
  const [stroke] = await own("sketch-line");
  expect(stroke.data).toMatchObject({ smooth: true });
  expect(await tray.getByRole("button", { name: "Pen", exact: true }).getAttribute("aria-pressed")).toBe("true");
  // An arrow drawn from one part onto another links them, and the hand selects again.
  await page.keyboard.press("a");
  await page.mouse.move(alpha.cx, alpha.cy);
  await page.mouse.down();
  await page.mouse.move(beta.cx, beta.cy, { steps: 8 });
  await page.mouse.up();
  await settled();
  expect((await rootOf(id)).links).toEqual([expect.objectContaining({ from: { moduleId: "a" }, to: { moduleId: "b" } })]);
  expect(await tray.getByRole("button", { name: "Select", exact: true }).getAttribute("aria-pressed")).toBe("true");
  // The eraser takes out what it went over once it is lifted.
  await page.keyboard.press("e");
  await page.mouse.move(alpha.x + 140, y - 60);
  await page.mouse.down();
  await page.mouse.move(alpha.x + 160, y + 60, { steps: 10 });
  await page.mouse.up();
  await settled();
  expect(await own("sketch-line")).toEqual([]);
  await page.keyboard.press("Escape");
  // A drawing taken from the library comes in with its example data, though the library
  // is browsed without it.
  await tray.getByRole("button", { name: "Diagram library", exact: true }).click();
  const shelf = page.getByRole("dialog", { name: "Diagram library" });
  await shelf.getByRole("textbox").fill("concentric");
  await shelf.locator('button[data-tip="Concentric rings"]').click();
  await expect
    .poll(async () => (await rootOf(id)).modules.find((m: { drawingId: string }) => m.drawingId === "concentric")?.data.rings?.length, { timeout: 10_000 })
    .toBe(3);
  await page.keyboard.press("Escape");
  // Mermaid pasted onto the canvas: a flowchart comes in as blocks and links beside what
  // is drawn, selected.
  const paste = (text: string) =>
    page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    }, text);
  await paste("flowchart LR\n  S([Start]) --> D{Ready?}\n  D -->|yes| E[Ship]");
  await expect.poll(async () => (await rootOf(id)).modules.filter((m: { drawingId: string }) => m.drawingId === "node").length, { timeout: 15_000 }).toBe(3);
  const root = await rootOf(id);
  const ship = root.modules.find((m: { data: { title?: string } }) => m.data.title === "Ship");
  expect(ship.bounds.x).toBeGreaterThan(740);
  expect(root.links.filter((l: { data: { label?: string } }) => l.data.label === "yes")).toHaveLength(1);
  // An Excalidraw shape keeps its hand-drawn look and its words; turned there, it comes in
  // upright, and the page says so.
  await paste(
    JSON.stringify({
      type: "excalidraw/clipboard",
      elements: [
        { id: "r", type: "rectangle", x: 0, y: 0, width: 160, height: 80, angle: 0.3, strokeColor: "#1971c2", backgroundColor: "#a5d8ff", fillStyle: "hachure", roughness: 1, boundElements: [{ id: "t", type: "text" }] },
        { id: "t", type: "text", x: 40, y: 30, width: 80, height: 25, text: "Sketch", fontSize: 20, containerId: "r" },
      ],
      files: {},
    }),
  );
  await expect.poll(() => page.getByText("Imported. 1 element was rotated in the original", { exact: false }).count(), { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await own("sketch-shape")).length, { timeout: 10_000 }).toBe(1);
  // The drawings the work made for itself are named in the language of the page.
  const names = Object.values((await api("/works/" + id)).drawings as Record<string, { source: string; name: string }>)
    .filter((d) => d.source.startsWith("// drawy:"))
    .map((d) => d.name)
    .sort();
  expect(names).toEqual(["Hand-drawn line", "Hand-drawn shape"]);
  await expect.poll(() => count("Sketch")).toBe(1);
  // Out again: an Excalidraw file with the drawn parts as pictures and the link bound to
  // them, and the blocks and links as a Mermaid flowchart.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const menu = () => page.getByRole("button", { name: "Export & share", exact: true }).click();
  await menu();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Excalidraw file" }).click()]);
  expect(file.suggestedFilename()).toBe("Check.excalidraw");
  const scene = JSON.parse(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()));
  const of = (id: string) => scene.elements.find((e: { id: string }) => e.id === id);
  expect(of("a")).toMatchObject({ type: "image" });
  expect(scene.files[of("a").fileId].mimeType).toBe("image/svg+xml");
  expect(scene.elements.find((e: { type: string; startBinding?: { elementId: string } }) => e.type === "arrow" && e.startBinding?.elementId === "a")).toMatchObject({ endBinding: { elementId: "b" } });
  expect(scene.elements.find((e: { type: string; text?: string }) => e.type === "text" && e.text === "Sketch")).toBeTruthy();
  await menu();
  await page.getByRole("menuitem", { name: "Copy Mermaid code" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("  a --> b\n");
  const mermaid = await page.evaluate(() => navigator.clipboard.readText());
  for (const line of ['a["Alpha"]', '(["Start"])', '-->|"yes"|']) expect(mermaid).toContain(line);
}, 90_000);

it("draws a sequence freehand: lines pulled down from boxes hang from them, messages between them stay where drawn and follow the boxes", async () => {
  const id = await make();
  await open(id);
  await editing();
  await settled();
  const alpha = await rectOf("Alpha"),
    beta = await rectOf("Beta");
  // A scene unit on screen, and a point of the scene from one on screen.
  const k = alpha.height / 120;
  const sceneY = (y: number) => 100 + (y - alpha.y) / k;
  const line = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.keyboard.press("a");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await settled();
  };
  // Pulled down from each box's bottom edge into the paper: a link bound to the box, its
  // other end free, drawn as a line.
  await line({ x: alpha.cx, y: alpha.y + alpha.height }, { x: alpha.cx, y: alpha.y + alpha.height + 340 });
  await line({ x: beta.cx, y: beta.y + beta.height }, { x: beta.cx, y: beta.y + beta.height + 340 });
  let root = await rootOf(id);
  expect(root.links).toMatchObject([
    { from: { moduleId: "a", at: "bottom" }, data: { head: "none" } },
    { from: { moduleId: "b", at: "bottom" }, data: { head: "none" } },
  ]);
  expect(root.links.every((l: { to: object }) => "x" in l.to && "y" in l.to)).toBe(true);
  const [la, lb] = root.links.map((l: { id: string }) => l.id);
  // Two messages from one line to the other, each where it was drawn.
  const heights = [alpha.y + alpha.height + 100, alpha.y + alpha.height + 240];
  for (const y of heights) await line({ x: alpha.cx, y }, { x: beta.cx, y });
  root = await rootOf(id);
  const messages = root.links.slice(2);
  expect(messages).toMatchObject([
    { from: { linkId: la }, to: { linkId: lb } },
    { from: { linkId: la }, to: { linkId: lb } },
  ]);
  const lifeline = root.links[0];
  const yOn = (along: number) => 220 + along * (lifeline.to.y - 220);
  messages.forEach((m: { from: { along: number } }, i: number) => expect(Math.abs(yOn(m.from.along) - sceneY(heights[i]))).toBeLessThan(2));
  // Dragging the first box takes its line along whole, and the messages' ends ride with it.
  await page.keyboard.press("v");
  const before = lifeline.to;
  await drag("Alpha");
  await settled();
  root = await rootOf(id);
  const moved = root.modules.find((m: { id: string }) => m.id === "a").bounds;
  expect(root.links[0].to).toEqual({ x: before.x + (moved.x - 100), y: before.y + (moved.y - 100) });
  expect(root.links.slice(2).map((m: { from: object }) => m.from)).toEqual(messages.map((m: { from: object }) => m.from));
  // The message is drawn where its ends are now: its left end under the moved line.
  const host = (await page.locator(`[data-link-id="${messages[0].id}"]`).boundingBox())!;
  const shifted = await rectOf("Alpha");
  expect(Math.abs(host.x + 48 * k - shifted.cx)).toBeLessThan(4);
});

it("lays the editing panel out by schema: one screen for a structured drawing, a part of it, a block and a link, with no data keys, JSON or code", async () => {
  // A drawing from the library, drawn from its example, with two blocks linked beside it.
  const w = await api("/works", "POST", { title: "面板" });
  const sequence = (await api("/materials/sequence")).example;
  await api(`/works/${w.id}/edits`, "POST", {
    baseRevision: w.revision,
    edit: {
      modules: [
        { id: "seq", drawingId: "sequence", bounds: [100, 100, 640, 360], data: sequence },
        { id: "n1", drawingId: "node", bounds: [100, 560, 200, 84], data: { title: "订单服务" } },
        { id: "n2", drawingId: "node", bounds: [500, 560, 200, 84], data: { title: "库存服务" } },
      ],
      links: [{ id: "l1", from: "n1", to: "n2", data: { label: "扣减" } }],
    },
  });
  await page.goto(base + "/");
  await page.evaluate(() => localStorage.setItem("drawy.locale", "zh"));
  try {
    await page.goto(base + "/a/" + w.id);
    await page.waitForFunction(() => [...document.querySelectorAll("*")].some((e) => e.shadowRoot?.textContent?.includes("登录请求")));
    await settled();
    await page.getByRole("button", { name: "手动编辑" }).click();
    await settled();
    const keys = ["participants", "messages", "notes", "fragments", "numbered", "label", "kind", "accent", "from", "to", "title", "tone", "shape", "head", "route"];
    /** What the panel shows: whether it fits without scrolling, and any data key, JSON or code in it. */
    const scan = () =>
      page.evaluate((keys) => {
        const panel = document.querySelector<HTMLElement>("[data-side-body]")!;
        const text = panel.innerText;
        const words = new Set(text.split(/[^A-Za-z_]+/).filter(Boolean));
        const spelled = (k: string) => k[0].toUpperCase() + k.slice(1);
        return {
          fits: panel.scrollHeight <= panel.clientHeight + 1,
          height: panel.scrollHeight,
          keys: keys.filter((k) => words.has(k) || words.has(spelled(k))),
          json: /[{[]\s*"|":\s*[\[{"]/.test(text) || [...panel.querySelectorAll("textarea")].some((t) => /^\s*[{[]/.test(t.value)),
          code: /\bapi\.|return\s|=>|<\/?svg|function\s*\(/.test(text + [...panel.querySelectorAll("textarea")].map((t) => t.value).join("\n")),
        };
      }, keys);
    const tab = (name: string) => page.getByRole("tab", { name, exact: true }).click();
    const check = async (what: string) => {
      for (const name of ["设计", "内容"]) {
        await tab(name);
        await page.waitForTimeout(250);
        const found = await scan();
        expect(found, `${what} · ${name}`).toMatchObject({ fits: true, keys: [], json: false, code: false });
      }
    };
    // The sequence diagram, then one of its messages selected inside it.
    const seq = await wordsAt("登录请求");
    await page.mouse.click(seq.cx, seq.cy);
    await settled();
    await check("时序图");
    // A note opened shows whom it is over as participants to choose, not an empty form.
    const over = await page.evaluate(async () => {
      const panel = document.querySelector("[data-side-body]")!;
      const row = [...panel.querySelectorAll("li")].find((li) => [...li.querySelectorAll("input")].some((i) => i.value === "密码加盐哈希"))!;
      row.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click();
      await new Promise((r) => setTimeout(r, 250));
      return [...row.querySelectorAll("select")].map((s) => s.value);
    });
    expect(over).toContain("server");
    // A cell changed and then Escape pressed keeps what it had.
    await page.evaluate(() => {
      const panel = document.querySelector("[data-side-body]")!;
      [...panel.querySelectorAll("input")].find((i) => i.value === "浏览器")!.setAttribute("data-probe", "");
    });
    const cellBox = page.locator("[data-probe]");
    await cellBox.click();
    await page.keyboard.press("Meta+A");
    await page.keyboard.type("改了");
    await page.keyboard.press("Escape");
    await expect.poll(() => cellBox.inputValue()).toBe("浏览器");
    await settled();
    expect((await sequenceOf(w.id))!.participants.map((p: { label: string }) => p.label)).toContain("浏览器");
    await page.mouse.click(seq.cx, seq.cy);
    await settled();
    expect(await page.locator("[data-part-crumbs]").innerText()).toMatch(/消息\s*1/);
    await check("消息");
    // A block of a flowchart, and the link between two.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const block = await rectOf("订单服务");
    await page.mouse.click(block.cx, block.cy);
    await settled();
    await check("方框");
    const a = await rectOf("订单服务"),
      b = await rectOf("库存服务");
    await page.keyboard.press("Escape");
    await page.mouse.click((a.x + a.width + b.x) / 2, a.cy);
    await settled();
    await check("连线");
  } finally {
    await page.evaluate(() => localStorage.setItem("drawy.locale", "en"));
  }
});

/** Where words a drawing draws are on screen, by what they say. */
const wordsAt = (text: string) =>
  page.evaluate((text) => {
    for (const host of document.querySelectorAll("[data-module-id]")) {
      const el = [...host.shadowRoot!.querySelectorAll("text,[data-edp-text]")].find((e) => e.textContent?.trim() === text);
      if (el) {
        const r = el.getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    throw Error("no words " + text);
  }, text);

/** The sequence diagram of a scene, as saved. */
const sequenceOf = async (id: string) =>
  (await rootOf(id)).modules.find((m: { drawingId: string }) => m.drawingId === "sequence")?.data as
    | { participants: { id: string; label: string }[]; messages: { id: string; from: string; to: string; label: string; kind?: string }[]; notes?: { over: string[] }[] }
    | undefined;

it("builds a sequence diagram from a blank canvas with the canvas and the keyboard alone: three participants, six messages", async () => {
  const w = await api("/works", "POST", { title: "Login" });
  await page.goto(base + "/a/" + w.id);
  await page.waitForSelector("[data-canvas]");
  let steps = 0;
  const click = async (x: number, y: number, n = 1) => {
    steps++;
    await page.mouse.click(x, y, { clickCount: n });
    if (n === 2) await page.mouse.dblclick(x, y);
  };
  const type = async (text: string) => {
    steps++;
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  };
  // Start drawing, and take the sequence diagram from the library.
  steps++;
  await page.getByRole("button", { name: "Start drawing" }).click();
  await settled();
  const tray = page.getByRole("navigation", { name: "Editing tools" });
  steps++;
  await tray.getByRole("button", { name: "Diagram library", exact: true }).click();
  const shelf = page.getByRole("dialog", { name: "Diagram library" });
  steps++;
  await shelf.getByRole("textbox").fill("sequence");
  steps++;
  await shelf.locator('button[data-tip="Sequence diagram"]').click();
  await expect.poll(async () => (await sequenceOf(w.id))?.messages.length, { timeout: 15_000 }).toBe(5);
  await page.keyboard.press("Escape");
  await settled();
  // Each participant renamed where its name is drawn.
  for (const [was, now] of [["浏览器", "App"], ["服务器", "Gateway"], ["数据库", "Users"]]) {
    const at = await wordsAt(was);
    steps++;
    await page.mouse.dblclick(at.cx, at.cy);
    await page.keyboard.press("Meta+A");
    await type(now);
    await settled();
  }
  // The first message selected inside the diagram; Enter makes the next one between the same
  // two, ready to type into.
  const first = await wordsAt("登录请求");
  await click(first.cx, first.cy);
  await click(first.cx, first.cy);
  await settled();
  steps++;
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sequenceOf(w.id))?.messages.length, { timeout: 10_000 }).toBe(6);
  await type("Check token");
  await settled();
  const data = (await sequenceOf(w.id))!;
  expect(data.participants.map((p) => p.label)).toEqual(["App", "Gateway", "Users"]);
  expect(data.messages).toHaveLength(6);
  expect(data.messages[1]).toMatchObject({ from: data.messages[0].from, to: data.messages[0].to, label: "Check token" });
  // Every message runs between participants that are there.
  const ids = new Set(data.participants.map((p) => p.id));
  expect(data.messages.every((m) => ids.has(m.from) && ids.has(m.to))).toBe(true);
  expect(steps).toBeLessThanOrEqual(16);
  console.log(`sequence from a blank canvas: ${steps} steps`);
});

it("keeps a sequence diagram whole as it is changed on the canvas: renamed, reordered, reconnected, a participant taken out and brought back", async () => {
  const w = await api("/works", "POST", { title: "Flows" });
  await api(`/works/${w.id}/edits`, "POST", {
    baseRevision: w.revision,
    edit: { modules: [{ id: "seq", drawingId: "sequence", bounds: [100, 100, 640, 360], data: (await api("/materials/sequence")).example }] },
  });
  await page.goto(base + "/a/" + w.id);
  await page.waitForFunction(() => [...document.querySelectorAll("*")].some((e) => e.shadowRoot?.textContent?.includes("登录请求")));
  await editing();
  await settled();
  const valid = async () => {
    const d = (await sequenceOf(w.id))!;
    const ids = new Set(d.participants.map((p) => p.id));
    expect(d.messages.every((m) => ids.has(m.from) && ids.has(m.to))).toBe(true);
    return d;
  };
  // Renamed where it is drawn: the messages keep to it (problem 3A).
  const server = await wordsAt("服务器");
  await page.mouse.dblclick(server.cx, server.cy);
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("API 网关");
  await page.keyboard.press("Enter");
  await settled();
  let d = await valid();
  expect(d.participants[1].label).toBe("API 网关");
  expect(d.messages.filter((m) => m.from === "server" || m.to === "server")).toHaveLength(5);
  // A message dragged below the next one changes places with it.
  const m1 = await wordsAt("登录请求");
  await page.mouse.click(m1.cx, m1.cy);
  await page.mouse.click(m1.cx, m1.cy);
  await settled();
  const m2 = await wordsAt("查询用户");
  await page.mouse.move(m1.cx, m1.cy);
  await page.mouse.down();
  await page.mouse.move(m1.cx, (m1.cy + m2.cy) / 2, { steps: 4 });
  await page.mouse.move(m1.cx, m2.cy + 30, { steps: 6 });
  await page.mouse.up();
  await settled();
  d = await valid();
  expect(d.messages.slice(0, 2).map((m) => m.id)).toEqual(["m2", "m1"]);
  // Its end dragged to another lifeline points it at that participant.
  const moved = await wordsAt("登录请求");
  await page.mouse.click(moved.cx, moved.cy);
  await settled();
  const handles = await page.locator("[data-edit-handle]").evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).style.display !== "none").map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
  expect(handles).toHaveLength(2);
  const db = await wordsAt("数据库");
  await page.mouse.move(handles[1].x, handles[1].y);
  await page.mouse.down();
  await page.mouse.move((handles[1].x + db.cx) / 2, handles[1].y, { steps: 4 });
  await page.mouse.move(db.cx, handles[1].y, { steps: 6 });
  await page.mouse.up();
  await settled();
  d = await valid();
  expect(d.messages.find((m) => m.id === "m1")).toMatchObject({ from: "browser", to: "db" });
  // The database taken out takes the messages to and from it along; undone, all come back.
  await page.keyboard.press("Escape");
  await page.mouse.click(db.cx, db.cy);
  await page.mouse.click(db.cx, db.cy);
  await settled();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await sequenceOf(w.id))?.participants.length, { timeout: 10_000 }).toBe(2);
  d = await valid();
  expect(d.messages.map((m) => m.id)).toEqual(["m4", "m5"]);
  expect(await page.getByRole("status").allInnerTexts()).toEqual(expect.arrayContaining([expect.stringMatching(/Also deleted 3/)]));
  await page.keyboard.press("Meta+Z");
  await expect.poll(async () => (await sequenceOf(w.id))?.participants.length, { timeout: 10_000 }).toBe(3);
  d = await valid();
  expect(d.messages).toHaveLength(5);
});

it("undoes and redoes hand edits at once, a gesture a step: arrow keys pressed in a row, a drag", async () => {
  const id = await make();
  await open(id);
  await editing();
  await settled();
  const x = async () => (await rootOf(id)).modules.find((m: { id: string }) => m.id === "a").bounds.x;
  const alpha = await rectOf("Alpha");
  await page.mouse.click(alpha.cx, alpha.cy);
  // A press moves a pixel on screen, whatever the view's scale.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(x, { timeout: 5_000 }).toBeGreaterThan(100);
  await settled();
  const nudged = await x();
  await drag("Alpha");
  await settled();
  const dragged = await x();
  expect(dragged).toBeGreaterThan(150);
  // Back over the drag, then over all five presses at once; and forward again.
  await page.keyboard.press("Meta+Z");
  await expect.poll(x, { timeout: 5_000 }).toBe(nudged);
  await page.keyboard.press("Meta+Z");
  await expect.poll(x, { timeout: 5_000 }).toBe(100);
  await page.keyboard.press("Meta+Shift+Z");
  await expect.poll(x, { timeout: 5_000 }).toBe(nudged);
  await page.keyboard.press("Meta+Y");
  await expect.poll(x, { timeout: 5_000 }).toBe(dragged);
});

it("changes a chart's values on the canvas: a bar's top dragged, its number retyped, a gauge's needle dragged with only the gauge selected", async () => {
  const w = await api("/works", "POST", { title: "Charts" });
  await api(`/works/${w.id}/edits`, "POST", {
    baseRevision: w.revision,
    edit: {
      modules: [
        { id: "bars", drawingId: "bars", bounds: [100, 100, 520, 300], data: (await api("/materials/bars")).example },
        { id: "gauge", drawingId: "gauge", bounds: [700, 100, 300, 220], data: (await api("/materials/gauge")).example },
      ],
    },
  });
  await page.goto(base + "/a/" + w.id);
  await page.waitForFunction(() => [...document.querySelectorAll("*")].some((e) => e.shadowRoot?.textContent?.includes("蛋白质")));
  await editing();
  await settled();
  const dataOf = async (id: string) => (await rootOf(w.id)).modules.find((m: { id: string }) => m.id === id)!.data;
  const shown = () =>
    page.locator("[data-edit-handle]").evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).style.display !== "none").map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }),
    );
  // The bar selected, its top drags its value up.
  const water = await wordsAt("水");
  await page.mouse.click(water.cx, water.cy);
  await page.mouse.click(water.cx, water.cy);
  await settled();
  const [top] = await shown();
  expect(top).toBeTruthy();
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(top.x, top.y - 20, { steps: 4 });
  await page.mouse.move(top.x, top.y - 40, { steps: 4 });
  await page.mouse.up();
  await settled();
  const raised = (await dataOf("bars")).items[0].value;
  expect(raised).toBeGreaterThan(71);
  // Its number retyped where it is drawn is a number.
  const number = await wordsAt(String(raised));
  await page.mouse.dblclick(number.cx, number.cy);
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("80");
  await page.keyboard.press("Enter");
  await settled();
  expect((await dataOf("bars")).items[0].value).toBe(80);
  // A drag the system takes away leaves the bar drawn as it was, nothing kept.
  const [again] = await shown();
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await page.mouse.move(again.x, again.y - 40, { steps: 6 });
  await expect.poll(() => wordsAt("80").then(() => true, () => false)).toBe(false);
  await page.evaluate(({ x, y }) => {
    document.elementFromPoint(x, y)!.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1, pointerType: "mouse" }));
  }, { x: again.x, y: again.y - 40 });
  await page.mouse.up();
  await expect.poll(() => wordsAt("80").then(() => true, () => false)).toBe(true);
  await settled();
  expect((await dataOf("bars")).items[0].value).toBe(80);
  // The gauge selected alone shows its needle's handle; dragged past the right end, below
  // the dial, the reading goes to the top of the scale.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const label = await wordsAt("空气质量指数");
  await page.mouse.click(label.cx, label.cy);
  await settled();
  const handles = await shown();
  expect(handles).toHaveLength(1);
  const right = (await page.locator('[data-module-id="gauge"]').boundingBox())!;
  await page.mouse.move(handles[0].x, handles[0].y);
  await page.mouse.down();
  await page.mouse.move(right.x + right.width * 0.8, right.y + right.height * 0.3, { steps: 4 });
  await page.mouse.move(right.x + right.width + 40, right.y + right.height + 20, { steps: 4 });
  await page.mouse.up();
  await settled();
  expect((await dataOf("gauge")).value).toBe(100);
});
