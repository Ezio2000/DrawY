import { expect, it } from "vitest";
import type { Step } from "../../../modules/contracts/index.ts";
import {
  api,
  asked,
  base,
  cdp,
  composer,
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

it("paints the drawing's words as they are laid out", async () => {
  await open(await make());
  for (const words of ["Alpha", "Beta"]) await paintedAsLaidOut(words);
});

it("shows a hand edit at once and lays the saved one over it without drawing it again", async () => {
  await open(await make());
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
  const drafted = (await module("Alpha"))!;
  expect(drafted.left).not.toBe(before.left);
  release();
  await settled();
  const saved = (await module("Alpha"))!;
  expect(saved.left).toBe(drafted.left);
  expect(saved.mark).toBe(before.mark);
  expect(await statuses()).toContain("1 change not saved\nDiscard changes\nSave as version 2");
});

it("holds a request while hand edits are unsaved, until they are saved, thrown away or kept", async () => {
  await open(await make());
  await editing();
  await drag("Alpha");
  await settled();
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
  // The work's second save: the one the request waited for.
  const revisions: { cause: { kind: string } }[] = await api(`/works/${page.url().split("/a/")[1]}/revisions`);
  expect(revisions.filter((r) => r.cause.kind === "save")).toHaveLength(2);
});

it("undoes and redoes by keyboard in place, and saves by keyboard", async () => {
  await open(await make());
  await editing();
  const before = (await module("Alpha"))!;
  await drag("Alpha");
  await settled();
  const moved = (await module("Alpha"))!;
  await page.keyboard.press("Control+z");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  expect((await statuses()).join()).not.toContain("not saved");
  await page.keyboard.press("Control+Shift+z");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: moved.left, mark: before.mark });
  await page.keyboard.press("Control+s");
  await settled();
  expect(await statuses()).toContain("Saved as version 2");
});

it("marks the version in hand with its seal in the title block, which opens the versions", async () => {
  await open(await make());
  const seal = (name: string) => page.getByRole("button", { name, exact: true });
  expect(await seal("Version 1").innerText()).toBe("1");
  // The seal opens the versions, and closes them again.
  await seal("Version 1").click();
  await settled();
  const versions = page.getByRole("heading", { name: "Versions", exact: true });
  expect(await versions.isVisible()).toBe(true);
  expect(await seal("Version 1").getAttribute("aria-pressed")).toBe("true");
  await seal("Version 1").click();
  await settled();
  expect(await versions.count()).toBe(0);
  // Hand edits waiting to be saved are told beside it; saved, the seal is the new version's.
  await editing();
  await drag("Alpha");
  await settled();
  expect(await seal("Version 1 · unsaved changes").count()).toBe(1);
  await page.keyboard.press("Control+s");
  await settled();
  expect(await seal("Version 2").innerText()).toBe("2");
});

it("looks at a version without drawing it again, and goes back to it, which can be undone", async () => {
  await open(await make());
  await editing();
  const before = (await module("Alpha"))!;
  await drag("Alpha");
  await settled();
  await page.keyboard.press("Control+s");
  await settled();
  const saved = (await module("Alpha"))!;
  expect(await outlined()).toBe(1);
  await page.getByRole("button", { name: "Versions" }).click();
  const rows = page.locator("[data-kind=drafts] li");
  await expect.poll(() => rows.allInnerTexts()).toHaveLength(3);
  // The versions are looked at as wholes: what was selected is let go.
  expect(await outlined()).toBe(0);
  await rows.nth(1).click();
  await settled();
  expect(await statuses()).toContain("Viewing version 1\nBack to current\nGo back to this version");
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  await page.keyboard.press("Escape");
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: saved.left });
  await rows.nth(1).click();
  await settled();
  await page.getByRole("button", { name: "Go back to this version" }).click();
  await settled();
  expect(await statuses()).toContain("Back to version 1\nUndo");
  expect(await module("Alpha")).toMatchObject({ left: before.left, mark: before.mark });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled();
  expect(await module("Alpha")).toMatchObject({ left: saved.left, mark: before.mark });
  expect((await statuses()).join()).not.toContain("Back to version");
});

it("throws hand edits away, which can be undone", async () => {
  await open(await make());
  await editing();
  const before = (await module("Alpha"))!;
  await drag("Alpha");
  await settled();
  const moved = (await module("Alpha"))!;
  await page.getByRole("button", { name: "Discard changes" }).click();
  await settled();
  expect(await statuses()).toContain("Changes discarded\nUndo");
  expect((await module("Alpha"))!.left).toBe(before.left);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled();
  expect((await module("Alpha"))!.left).toBe(moved.left);
});

it("places words ready to type on a blank canvas, and duplicates, copies and pastes them", async () => {
  await page.goto(base + "/");
  await page.getByRole("button", { name: "New blank canvas" }).first().click();
  await page.waitForURL(/\/a\//);
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
  // The bar over the selection gives everything selected one look.
  const g = await rectOf("Gamma"),
    d = await rectOf("Delta");
  await page.mouse.click(g.cx, g.cy);
  await page.keyboard.down("Shift");
  await page.mouse.click(d.cx, d.cy);
  await page.keyboard.up("Shift");
  const bar = page.getByRole("toolbar", { name: "The selection's look and actions" });
  await bar.getByRole("button", { name: "Tone", exact: true }).click();
  await bar.getByRole("menuitemradio", { name: "Accent", exact: true }).click();
  await settled();
  root = await rootOf(id);
  expect(made("Gamma").data.tone).toBe("accent");
  expect(made("Delta").data.tone).toBe("accent");
});

it("measures the drawing board: rulers, the view's scale and its settings, and the sheet of shortcuts", async () => {
  await open(await make());
  const rulers = page.locator("canvas[data-axis]");
  expect(await rulers.count()).toBe(0);
  await editing();
  expect(await rulers.count()).toBe(2);
  // The scale shows in figures and opens the scales to go to and the board's settings.
  const scale = page.getByRole("button", { name: /^Shown at \d+%/ });
  await scale.click();
  await page.getByRole("menuitem", { name: /^100%/ }).click();
  await expect.poll(() => scale.innerText()).toBe("100%");
  await scale.click();
  await page.getByRole("menuitemcheckbox", { name: "Rulers" }).click();
  expect(await rulers.count()).toBe(0);
  await page.getByRole("menuitemcheckbox", { name: "Rulers" }).click();
  expect(await rulers.count()).toBe(2);
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
  // The whole drawing again, by its key; and the shortcuts, by theirs.
  await page.keyboard.press("Shift+Digit1");
  await expect.poll(() => scale.innerText()).not.toBe("100%");
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

it("follows a run that drew only in a subscene there once it ends", async () => {
  const id = await make({ sub: "drawn" });
  await open(id);
  const wrote = { kind: "tool", id: "t1", name: "write_work", status: "done", drawings: [], scenes: [{ id: "sub", title: "Sub", modules: [] }], details: [], materials: [], removed: 0 };
  await tell({ type: "run", run: run(id, "live", "running", []) });
  await settled();
  await tell({ type: "run", run: run(id, "live", "completed", [wrote as Step]) });
  await settled();
  expect(new URL(page.url()).pathname).toBe(`/a/${id}/sub`);
  await expect.poll(() => count("Gamma")).toBe(1);
});

it("keeps the reply of a run from before the work was opened in the studio", async () => {
  const id = await make();
  await page.route(`**/api/works/${id}/runs`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: [run(id, "old", "completed", [{ kind: "message", role: "assistant", text: "An old reply." }])],
    });
  });
  await open(id);
  expect(await page.locator("[data-dock]").innerText()).not.toContain("An old reply.");
  await page.getByRole("button", { name: "Studio" }).click();
  await settled();
  expect(await page.locator("[data-kind=journal]").innerText()).toContain("An old reply.");
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
  const quiet = await renders();
  await composer().pressSequentially("hello", { delay: 20 });
  await settled();
  const typed = await renders();
  const changed = (part: string) => (typed[part] ?? 0) - (quiet[part] ?? 0);
  expect(changed("composer")).toBeGreaterThan(0);
  for (const part of ["page", "topbar", "tools", "editor", "bars", "canvas", "status"])
    expect([part, changed(part)]).toEqual([part, 0]);
});

it("loads the desktop page in a chunk of its own, when a work is opened", async () => {
  const chunks: string[] = [];
  page.on("request", (r) => r.url().includes("/assets/") && r.url().endsWith(".js") && chunks.push(r.url()));
  await page.goto(base + "/");
  await settled();
  expect(chunks.some((u) => u.includes("WorkPage"))).toBe(false);
  await open(await make());
  expect(chunks.some((u) => u.includes("WorkPage"))).toBe(true);
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
  const bar = page.getByRole("toolbar", { name: "The selection's look and actions" });
  await bar.getByRole("button", { name: "Bold", exact: true }).click();
  await settled();
  await bar.getByRole("button", { name: "Bold", exact: true }).click();
  await settled();
  expect((await rootOf(id)).modules.find((m: any) => m.data.title === "Node").data.weight).toBe(400);
});

it("snaps an unguided resize axis to the grid and honors actual size on a focused canvas", async () => {
  const id = await make();
  await open(id);
  await editing();
  const scale = page.getByRole("button", { name: /^Shown at \d+%/ });
  await scale.click();
  await page.getByRole("menuitem", { name: /^100%/ }).click();
  await scale.click();
  await page.getByRole("menuitemcheckbox", { name: "Snap to the squares" }).click();
  await page.keyboard.press("Escape");
  const alpha = await rectOf("Alpha");
  await page.mouse.click(alpha.cx, alpha.cy);
  const handle = page.locator('[data-handle="se"]');
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 47, h.y + h.height / 2 + 3, { steps: 8 });
  await page.mouse.up();
  await settled();
  expect((await rootOf(id)).modules.find((m: any) => m.id === "a").bounds).toMatchObject({ width: 280, height: 120 });
  await page.keyboard.press("Shift+Digit1");
  await expect.poll(() => scale.innerText()).not.toBe("100%");
  await page.locator("[data-canvas]").focus();
  await page.keyboard.press("ControlOrMeta+0");
  await expect.poll(() => scale.innerText()).toBe("100%");
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
it("drags a frame with what stands on it, and tidies a figure by its links", async () => {
  const w = await api("/works", "POST", { title: "Check" });
  await api(`/works/${w.id}/edits`, "POST", {
    baseRevision: w.revision,
    edit: {
      style: { route: "elbow" },
      modules: [
        { id: "tier", drawingId: "frame", bounds: [60, 60, 560, 200], data: { title: "Tier" } },
        { id: "a", drawingId: "node", bounds: [100, 130, 160, 70], data: { title: "Alpha" } },
        { id: "b", drawingId: "node", bounds: [400, 130, 160, 70], data: { title: "Beta" } },
        { id: "c", drawingId: "node", bounds: [760, 420, 160, 70], data: { title: "Gamma" } },
      ],
      links: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    },
  });
  await api(`/works/${w.id}/save`, "POST");
  await open(w.id);
  await editing();
  // Where a module stands on the paper, whatever the view does.
  const place = (text: string) =>
    page.evaluate((text) => {
      const host = [...document.querySelectorAll<HTMLElement>("*")].find((e) => e.shadowRoot?.textContent?.includes(text))!;
      return { x: Math.round(parseFloat(host.style.left)), y: Math.round(parseFloat(host.style.top)) };
    }, text);
  const before = { tier: await place("Tier"), a: await place("Alpha"), b: await place("Beta"), c: await place("Gamma") };
  // The frame is taken by the paper inside it, below the link that crosses its middle.
  const [alpha, beta] = [(await module("Alpha"))!, (await module("Beta"))!];
  const scale = (beta.x - alpha.x) / 300;
  const name = { x: alpha.x + 160 * scale, y: alpha.y + 72 * scale };
  await page.mouse.move(name.x, name.y);
  await page.mouse.down();
  await page.mouse.move(name.x + 30, name.y + 40, { steps: 5 });
  await page.mouse.move(name.x + 60, name.y + 80, { steps: 5 });
  await page.mouse.up();
  await settled();
  const carried = { a: await place("Alpha"), b: await place("Beta"), c: await place("Gamma") };
  // What stands on the frame goes with it; what stands elsewhere stays.
  // The pointer went 60 pixels right, which is this many units at the view's scale.
  expect(carried.a.x - before.a.x).toBeGreaterThan(60 / scale - 5);
  expect(carried.a.x - before.a.x).toBe(carried.b.x - before.b.x);
  expect(carried.a.y - before.a.y).toBe(carried.b.y - before.b.y);
  expect(carried.c).toEqual(before.c);
  // Tidied, the three stand in a row in the order their links run.
  const gamma = (await module("Gamma"))!;
  await page.mouse.click(gamma.x, gamma.y);
  await page.keyboard.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Tidy by the links" }).click();
  await settled();
  const tidy = { a: await place("Alpha"), b: await place("Beta"), c: await place("Gamma") };
  expect(Math.abs(tidy.a.y - tidy.b.y)).toBeLessThan(3);
  expect(Math.abs(tidy.b.y - tidy.c.y)).toBeLessThan(3);
  expect(tidy.a.x).toBeLessThan(tidy.b.x);
  expect(tidy.b.x).toBeLessThan(tidy.c.x);
});
