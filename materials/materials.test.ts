import { it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Library } from "./library.ts";
import { createServer } from "./server.ts";

let dir: string, library: Library;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "drawy-materials-"));
  library = new Library(dir, new URL("./seed", import.meta.url).pathname);
});
afterAll(() => {
  library.close();
  rmSync(dir, { recursive: true });
});
const top = (subject: string, options = {}) =>
  library.search({ subjects: [subject], ...options })[0].hits;

it("finds the thing asked for in either language, ignoring request noise", () => {
  for (const [query, id] of [
    ["苹果", "apple"],
    ["apple", "apple"],
    ["红苹果", "apple"],
    ["sun", "sun"],
    ["太阳插图", "sun"],
    ["木星", "jupiter"],
    ["planets", "icon-planet"],
    ["显微镜", "microscope"],
    ["地球", "earth"],
    ["曲线 坐标轴", "plot"],
    ["循环箭头", "cycle"],
    ["铅笔颗粒", "pencil-grain"],
    ["水墨", "ink-wash"],
  ])
    expect(
      top(query).map((h) => h.material.id),
      query,
    ).toContain(id);
  expect(top("apple")[0]).toMatchObject({
    match: "exact",
    material: { kind: "picture" },
  });
  // A request only partly in the library is related, not the thing itself.
  expect(top("青苹果")[0]).toMatchObject({
    material: { id: "apple" },
    match: "related",
  });
  expect(top("订单服务").every((h) => h.match === "related")).toBe(true);
  expect(top("red apple")[0].match).not.toBe("related");
  // Words that only describe a request for pictures match nothing on their own.
  expect(top("illustration")).toEqual([]);
  // A queried part matching only a description does not outrank the thing itself.
  expect(
    top("sun planets solar system illustration")[0].material.id,
  ).not.toMatch(/general|folder/);
});
it("prefers the requested style and kind", () => {
  const pictures = top("apple", { kinds: ["picture"], style: "line-icon" });
  expect(pictures[0].material.id).toBe("line-apple");
  expect(top("planet", { style: "crayon" })[0].material.style).toBe("crayon");
  expect(top("arrow", { kinds: ["drawing"] })[0].material.id).toBe("arrow");
});
it("develops reserved pictures in the background and keeps private ones private", async () => {
  const reserved = library.reserve(
    {
      id: "g-test-cherry",
      role: "object",
      name: { zh: "咖啡樱桃", en: "coffee cherry" },
      aliases: ["coffee fruit"],
      about: "a branch of ripe coffee cherries",
      style: "colored-pencil",
      width: 1024,
      height: 1024,
      origin: { kind: "generated", prompt: "cherries" },
    },
    "alice",
  );
  expect(reserved).toMatchObject({ status: "developing", owner: null });
  // Others cannot find it until it is ready; its maker can.
  expect(top("咖啡樱桃")).toEqual([]);
  expect(
    library.search({ subjects: ["咖啡樱桃"] }, "alice")[0].hits,
  ).toHaveLength(1);
  const waiting = library.file("g-test-cherry", "bob");
  const png = await sharp({
    create: {
      width: 40,
      height: 20,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: { width: 10, height: 10, channels: 4, background: "#a33" },
        },
        left: 20,
        top: 5,
      },
    ])
    .png()
    .toBuffer();
  const ready = await library.develop(
    "g-test-cherry",
    png,
    "image/png",
    "alice",
  );
  expect(ready).toMatchObject({
    status: "ready",
    file: { mediaType: "image/webp" },
    form: {
      background: "transparent",
      content: { x: 0.5, y: 0.25, width: 0.25, height: 0.5 },
    },
  });
  expect((await waiting).material.status).toBe("ready");
  expect(top("coffee cherry")[0].material.id).toBe("g-test-cherry");

  const upload = await library.ingest(
    png,
    "image/png",
    {
      role: "object",
      name: { zh: "我的图", en: "my sketch" },
      style: "colored-pencil",
      origin: { kind: "upload" },
    },
    "alice",
  );
  expect(upload.owner).toBe("alice");
  expect(() => library.get(upload.id, "bob")).toThrow();
  library.reserve(
    {
      id: "g-test-fail",
      role: "object",
      name: { zh: "失败", en: "fail" },
      style: "colored-pencil",
      width: 8,
      height: 8,
      origin: { kind: "generated" },
    },
    "alice",
  );
  library.fail("g-test-fail", "quota", "alice");
  await expect(library.file("g-test-fail", "alice")).rejects.toThrow("quota");
});
it("serves recoloured icons and counts uses per work", async () => {
  const app = createServer(library);
  const r = await app.request("/files/line-apple?color=%23123456");
  expect(await r.text()).toContain("#123456");
  library.use(["apple", "apple"], "w1", "alice");
  library.use(["apple"], "w2", "alice");
  library.use(["apple"], "w2", "alice");
  expect(library.get("apple").uses).toBe(2);
  const styles = (await (await app.request("/styles")).json()) as {
    id: string;
    samples: string[];
    count: number;
  }[];
  expect(styles.find((s) => s.id === "colored-pencil")).toMatchObject({
    count: expect.any(Number),
  });
  expect(styles.find((s) => s.id === "colored-pencil")!.samples[0]).toBe(
    "lighthouse-colored-pencil",
  );
});
