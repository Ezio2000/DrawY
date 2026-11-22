import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Library } from "./library.ts";
import { createServer } from "./server.ts";
import { Streets, type StreetTile } from "./streets.ts";
import { curatedPack, testLibrary } from "./testing.ts";
import { importPack, releases, rollback, PACK_FORMAT } from "./pack.ts";
import type { DrawingMaterial, StyleMaterial } from "./schema.ts";

let dir: string, library: Library;
beforeAll(() => {
  ({ dir, library } = testLibrary());
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
      top(query, { limit: 8 }).map((h) => h.material.id),
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
it("prefers the requested style and type", () => {
  const pictures = top("apple", { kinds: ["picture"], style: "line-icon" });
  expect(pictures[0].material.id).toBe("line-apple");
  expect(top("planet", { style: "crayon" })[0].material.style).toBe("crayon");
  expect(top("arrow", { kinds: ["drawing"] })[0].material.id).toBe("arrow");
  expect(top("apple", { types: ["icon"] }).every((h) => h.material.type === "icon")).toBe(true);
  // Types are flat: a drawing is found by its type as a picture is by its own.
  expect(top("柱状图", { types: ["drawing"] })[0].material.id).toBe("bars");
});
it("weighs what a request states about the picture, and what the thesaurus gives as the same thing", () => {
  // A cut-out doctor is asked for, so the cut-out ranks as the thing; the condition is
  // not searched for as words.
  expect(top("透明背景的医生")[0].material.id).toBe("doctor");
  // A word the library has never seen still says what a hit is not.
  const [green] = library.search({ subjects: ["青苹果"] });
  expect(green.unknown).toContain("青苹");
  expect(green.hits.every((h) => h.match === "related")).toBe(true);
  // Inventory is a warehouse, though no material says inventory.
  expect(top("库存").map((h) => h.material.id)).toContain("line-warehouse");
  // A request's own name ranks above an alias of something else.
  expect(top("帆船")[0].match).toBe("exact");
  expect(top("帆船").find((h) => h.material.id === "lighthouse-crayon")?.match).not.toBe("exact");
});
it("develops reserved pictures in the background, private to their maker until published", async () => {
  const reserved = library.reserve(
    {
      id: "g-test-cherry",
      type: "object",
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
  expect(reserved).toMatchObject({ status: "developing", owner: "alice" });
  // Others cannot find it; its maker can, even while it develops.
  expect(top("咖啡樱桃")).toEqual([]);
  expect(
    library.search({ subjects: ["咖啡樱桃"] }, "alice")[0].hits,
  ).toHaveLength(1);
  const waiting = library.file("g-test-cherry", "alice");
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
  // Ready, it is still alice's alone; one who sees all finds it too.
  expect(top("coffee cherry").map((h) => h.material.id)).not.toContain(
    "g-test-cherry",
  );
  expect(() => library.get("g-test-cherry", "bob")).toThrow();
  expect(library.get("g-test-cherry", { id: "carol", all: true }).id).toBe(
    "g-test-cherry",
  );
  const shelf = (
    viewer: Parameters<typeof library.browse>[2],
    on: "public" | "mine" | "others",
  ) =>
    library.browse("", 1, viewer, ["picture"], 200, on).items.map((m) => m.id);
  expect(shelf("alice", "mine")).toContain("g-test-cherry");
  expect(shelf("alice", "public")).not.toContain("g-test-cherry");
  expect(shelf({ id: "carol", all: true }, "others")).toContain(
    "g-test-cherry",
  );
  expect(() => shelf("bob", "others")).toThrow();
  // Styles show only public pictures as samples.
  expect(library.style("colored-pencil").samples).not.toContain(
    "g-test-cherry",
  );
  // Published, everyone finds it; withdrawn, it is alice's again.
  library.publish("g-test-cherry", true);
  expect(top("coffee cherry")[0].material.id).toBe("g-test-cherry");
  expect(shelf("alice", "public")).toContain("g-test-cherry");
  expect(shelf("alice", "mine")).not.toContain("g-test-cherry");
  library.publish("g-test-cherry", false);
  expect(library.get("g-test-cherry", "alice").owner).toBe("alice");
  expect(() => library.publish("apple", false)).toThrow();

  const upload = await library.ingest(
    png,
    "image/png",
    {
      type: "object",
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
      type: "object",
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
  const style = (await (await app.request("/materials/colored-pencil")).json()) as StyleMaterial;
  expect(style.count).toBeGreaterThan(10);
  // A few samples, its own showcase first, however many pictures it has.
  expect(style.samples[0]).toBe("lighthouse-colored-pencil");
  expect(style.samples.length).toBeLessThanOrEqual(4);
  // An unknown style is reported without listing the others.
  const unknown = await (await app.request("/materials/nope")).json();
  expect(JSON.stringify(unknown)).not.toContain("colored-pencil");
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

it("declares every value a library drawing reads, so its card and the hand controls can offer it", () => {
  const seed = new URL("../content/seed/", import.meta.url);
  const drawings = JSON.parse(readFileSync(new URL("drawings.json", seed), "utf8")) as {
    id: string;
    params: Record<string, { type: string }>;
  }[];
  // The app names each value a person can change, in both languages.
  const words = readFileSync(new URL("../apps/web/src/i18n.tsx", import.meta.url), "utf8");
  const dictionaries = [...words.matchAll(/\n    params: \{\n      text:[\s\S]*?\n    \},/g)].map(
    ([block]) => new Set([...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1])),
  );
  expect(dictionaries).toHaveLength(2);
  for (const { id, params } of drawings) {
    const source = readFileSync(new URL(`drawings/${id}.js`, seed), "utf8");
    expect(source, id).toMatch(/const d = api\.data/);
    const reads = new Set([...source.matchAll(/\bd\.(\w+)/g)].map((m) => m[1]));
    expect([...reads].filter((key) => !params[key]), id).toEqual([]);
    for (const [key, p] of Object.entries(params))
      if (["text", "number", "boolean", "color", "picture", "choice"].includes(p.type))
        for (const named of dictionaries)
          expect(named.has(key), `${id}.${key}`).toBe(true);
  }
});

/** A copy of the curated pack to change, with its manifest's digests kept true. */
function packCopy(change: (dir: string, manifest: Record<string, any>, lines: Record<string, any>[]) => void) {
  const out = join(mkdtempSync(join(tmpdir(), "drawy-pack-copy-")), "pack");
  cpSync(curatedPack(), out, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  const lines = readFileSync(join(out, "materials.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  change(out, manifest, lines);
  writeFileSync(join(out, "materials.ndjson"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  manifest.files["materials.ndjson"] = createHash("sha256").update(readFileSync(join(out, "materials.ndjson"))).digest("hex");
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest));
  return out;
}

it("imports a pack once, versions what changed, and goes back to an earlier release", () => {
  const { dir, library } = testLibrary();
  try {
    expect(library.size).toBeGreaterThan(700);
    // The same release again changes nothing; the same release with other content is refused.
    expect(importPack(library, curatedPack())).toMatchObject({ status: "unchanged", added: 0, updated: 0 });
    const label = library.get("label") as DrawingMaterial;
    const changed = packCopy((_, manifest, lines) => {
      lines.find((l) => l.id === "label").about += " Now with a halo.";
      lines.push({ ...lines.find((l) => l.id === "label"), id: "label-two", name: { zh: "第二标签", en: "Second label" } });
    });
    expect(() => importPack(library, changed)).toThrow(/已导入过不同内容/);
    const next = packCopy((_, manifest, lines) => {
      manifest.release = "test-2";
      lines.find((l) => l.id === "label").about += " Now with a halo.";
      lines.push({ ...lines.find((l) => l.id === "label"), id: "label-two", name: { zh: "第二标签", en: "Second label" } });
      manifest.withdraw = ["apple"];
    });
    expect(importPack(library, next)).toMatchObject({ status: "imported", added: 1, updated: 1, withdrawn: 1 });
    // A changed material is a new version; the one a work took stays readable as it was.
    expect(library.get("label").version).toBe(label.version + 1);
    expect(library.get("label", undefined, label.version).about).toBe(label.about);
    // A withdrawn one is not offered, but a work that holds it can still read it.
    expect(library.search({ subjects: ["apple"] })[0].hits.map((h) => h.material.id)).not.toContain("apple");
    expect(library.get("apple").status).toBe("withdrawn");
    expect(releases(library).filter((r) => r.active).map((r) => r.release)).toEqual(["test-2"]);
    // Back to the first release: its versions, without what came later.
    rollback(library, "drawy-curated", "test");
    expect(library.get("label").about).toBe(label.about);
    expect(library.get("label-two").status).toBe("withdrawn");
    expect(library.get("apple").status).toBe("ready");
    expect(library.search({ subjects: ["apple"], limit: 12 })[0].hits.map((h) => h.material.id)).toContain("apple");
  } finally {
    library.close();
    rmSync(dir, { recursive: true });
  }
});

it("refuses a pack that is not whole, or that would take what is not its own", () => {
  const { dir, library } = testLibrary();
  try {
    const broken = packCopy((out) => writeFileSync(join(out, "files", "apple.webp"), "not the picture"));
    expect(() => importPack(library, broken)).toThrow(/文件校验不符: files\/apple.webp/);
    const other = packCopy((_, manifest) => (manifest.source = "someone-else"));
    expect(() => importPack(library, other)).toThrow(/已属于素材源 drawy-curated/);
    const bound = packCopy((_, manifest) => {
      manifest.release = "bad-binding";
      manifest.bindings.text = "bars";
    });
    expect(() => importPack(library, bound)).toThrow(/绑定 text: bars 缺少 text 参数 text/);
    const typed = packCopy((_, manifest, lines) => {
      manifest.release = "bad-type";
      lines.find((l) => l.id === "label").type = "object";
    });
    expect(() => importPack(library, typed)).toThrow(/类型 object 不是 drawing 载荷/);
    expect(() =>
      importPack(library, packCopy((_, manifest) => (manifest.format = "other"))),
    ).toThrow();
    expect(PACK_FORMAT).toMatch(/^drawy-material-pack\//);
  } finally {
    library.close();
    rmSync(dir, { recursive: true });
  }
});

it("starts from what is on disk, without reading a pack", () => {
  const again = new Library(dir);
  try {
    expect(again.size).toBe(library.size);
    expect(again.search({ subjects: ["木星"] })[0].hits[0].material.id).toBe("jupiter");
    expect(again.bindings()).toEqual({ text: "label", picture: "picture", link: "arrow" });
  } finally {
    again.close();
  }
});

it("pages through everything a viewer may see, and filters before it cuts", async () => {
  // Many private pictures of one user do not crowd another's search or pages.
  for (let i = 0; i < 300; i++)
    library.reserve(
      { id: `g-noise-apple-${i}`, type: "object", name: { zh: "苹果", en: "apple" }, style: null, width: 8, height: 8, origin: { kind: "generated" } },
      "mallory",
    );
  expect(top("apple", { limit: 24 }).some((h) => h.material.owner === "mallory")).toBe(false);
  expect(library.search({ subjects: ["apple"], limit: 24 }, "mallory")[0].hits.length).toBe(24);
  const all = library.browse("", 1, undefined, ["picture"], 50);
  const seen = new Set<string>();
  for (let page = 1; page <= all.pages; page++)
    for (const m of library.browse("", page, undefined, ["picture"], 50).items) seen.add(m.id);
  expect(seen.size).toBe(all.total);
  // A query's last page is reachable too.
  const food = library.browse("food", 1, undefined, [], 5);
  expect(food.pages).toBeGreaterThan(2);
  expect(library.browse("food", food.pages, undefined, [], 5).items.length).toBeGreaterThan(0);
  expect(library.browse("", 1, undefined, [], 10, undefined, ["figure"]).items.every((m) => m.type === "figure")).toBe(true);
});
