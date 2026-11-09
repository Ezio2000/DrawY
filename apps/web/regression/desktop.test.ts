import { expect, it } from "vitest";
import type { Step } from "../../../modules/contracts/index.ts";
import {
  api,
  asked,
  base,
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
