import { it, expect } from "vitest";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { documentFor } from "./document.ts";
import type { Page } from "../contracts/index.ts";
it("renders Mermaid and follows child hotspots on ordinary HTTP", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const bundle = await readFile("dist/runtime/runtime.js", "utf8");
    const root: Page = {
      id: "root",
      title: "root",
      parentId: null,
      html: '<html><head></head><body><div data-drawy-diagram="flow"></div><a data-drawy-open="child">Open child</a></body></html>',
      assetIds: [],
      diagrams: [
        { id: "flow", format: "mermaid", source: "flowchart TD\nA-->B" },
      ],
      checkSelectors: [],
    };
    await context.route("http://drawy.test/**", (route) =>
      route.fulfill({
        contentType: route.request().url().includes("runtime.js")
          ? "application/javascript"
          : "text/html",
        body: route.request().url().includes("runtime.js")
          ? bundle
          : documentFor(
              route.request().url().includes("/child")
                ? {
                    ...root,
                    id: "child",
                    html: `<h1>Loading</h1><script>window.drawy.waitUntil(new Promise(resolve => setTimeout(() => {document.querySelector("h1").textContent="Child page";resolve()}, 100)))</script>`,
                    diagrams: [],
                  }
                : root,
              true,
            ),
      }),
    );
    const page = await context.newPage();
    await page.goto("http://drawy.test/api/works/work/pages/root?revision=1");
    await page.waitForFunction(() => window.drawyReady);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    expect(await page.locator("svg").count()).toBe(1);
    expect(await page.evaluate(() => window.drawyErrors)).toEqual([]);
    await page.locator("[data-drawy-open]").click();
    await page.waitForURL("**/child?revision=1");
    await page.waitForFunction(() => window.drawyReady);
    expect(await page.locator("h1").innerText()).toBe("Child page");
  } finally {
    await browser.close();
  }
}, 30000);
