import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Library } from "./library.ts";
import { createServer } from "./server.ts";
import { Streets, type StreetTile } from "./streets.ts";

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

it("serves the geographic layers the map drawing projects, and nothing else from disk", async () => {
  const app = createServer(library);
  const physical = (await (await app.request("/geo/physical")).json()) as {
    rivers: { zh?: string }[];
  };
  expect(physical.rivers.some((r) => r.zh === "大渡河")).toBe(true);
  const divisions = (await (await app.request("/geo/subdivisions")).json()) as {
    names: { zh: string }[];
  };
  expect(divisions.names.map((p) => p.zh)).toContain("贵州省");
  // Revalidated by content, so a rebuilt layer is never served stale.
  const first = await app.request("/geo/countries");
  const etag = first.headers.get("etag")!;
  expect(first.headers.get("cache-control")).toBe("no-cache");
  expect(
    (
      await app.request("/geo/countries", {
        headers: { "if-none-match": etag },
      })
    ).status,
  ).toBe(304);
  expect((await app.request("/geo/nowhere")).status).toBe(404);
  // Shaded relief: an index of the tiles kept, each a picture.
  const relief = (await (await app.request("/geo/relief")).json()) as {
    levels: { tiles: string[] }[];
  };
  const tile = await app.request(`/geo/relief/1-${relief.levels[1].tiles[0]}`);
  expect(tile.headers.get("content-type")).toBe("image/webp");
  expect((await app.request("/geo/relief/1-..-0")).status).toBe(404);
  expect((await app.request("/geo/..%2Fdrawings")).status).toBe(404);
});

it("boils a city's OpenStreetMap tile down to its water, ways and names, fetched once", async () => {
  const tile = readFileSync(
    new URL("./fixtures/streets-14-13347-7110.pbf", import.meta.url),
  );
  const cache = mkdtempSync(join(tmpdir(), "drawy-streets-"));
  const asked: string[] = [];
  let up = true;
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(String(url));
    if (!up) throw Error("offline");
    return String(url).endsWith("/14/13347/7110.pbf")
      ? new Response(tile)
      : new Response(null, { status: 204 });
  });
  try {
    const app = createServer(
      library,
      new Streets(cache, "https://tiles.test/{z}/{x}/{y}.pbf"),
    );
    const r = await app.request("/geo/streets/14/13347/7110");
    expect(r.status).toBe(200);
    const city = (await r.json()) as StreetTile;
    // Central Guangzhou: the Pearl River as water and by name, its main roads named.
    expect(city.extent).toBe(4096);
    expect(city.water.length).toBeGreaterThan(0);
    expect(city.waterways.map((w) => w.name)).toContain("珠江");
    expect(city.roads.map((w) => w.class)).toEqual(
      expect.arrayContaining(["trunk", "primary", "secondary"]),
    );
    expect(city.names.length).toBeGreaterThan(5);
    // Kept on disk: asked again, even with the source gone, it is not fetched again.
    up = false;
    expect((await app.request("/geo/streets/14/13347/7110")).status).toBe(200);
    expect(asked).toHaveLength(1);
    // Open sea has no tile, which is an empty one, not an error.
    up = true;
    const sea = (await (
      await app.request("/geo/streets/14/0/0")
    ).json()) as StreetTile;
    expect(sea.water).toEqual([]);
    // Nothing beyond the schema's finest zoom or outside the world, and a source that
    // cannot be reached is reported as such.
    expect((await app.request("/geo/streets/15/0/0")).status).toBe(400);
    expect((await app.request("/geo/streets/2/4/0")).status).toBe(400);
    up = false;
    expect((await app.request("/geo/streets/14/1/1")).status).toBe(502);
    // Another source keeps tiles of its own: a tile kept from the first is fetched again.
    up = true;
    const fetched = asked.length;
    await new Streets(cache, "https://other.test/{z}/{x}/{y}.pbf").tile(
      14,
      13347,
      7110,
    );
    expect(asked.slice(fetched)).toEqual([
      "https://other.test/14/13347/7110.pbf",
    ]);
  } finally {
    vi.unstubAllGlobals();
    rmSync(cache, { recursive: true });
  }
});
