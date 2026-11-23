import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { build } from "../content/build.ts";
import { localize } from "../modules/contracts/messages.ts";
import { picture as picture_ } from "./testing.ts";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Library } from "./library.ts";
import { createServer } from "./server.ts";
import { Streets, type StreetTile } from "./streets.ts";
import { curatedPack, serveLibrary, testLibrary } from "./testing.ts";
import { MaterialsClient } from "./client.ts";
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
  const pictures = top("apple", { kinds: ["picture"], style: "ink-wash" });
  expect(pictures[0].material.id).toBe("apple-ink-wash");
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
  // A message bus is a queue, though no material says message bus.
  expect(top("消息总线").map((h) => h.material.id)).toContain("icon-queue");
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
  // An SVG drawn in currentColor is inked in the colour asked for.
  const icon = await library.ingest(
    new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor"/></svg>`,
    ),
    "image/svg+xml",
    { type: "icon", name: { zh: "圆圈", en: "ring" }, style: null, origin: { kind: "upload" } },
    "alice",
  );
  expect(icon.form.recolor).toBe(true);
  const r = await app.request(`/files/${icon.id}?color=%23123456`, { headers: { "x-drawy-user": "alice" } });
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
    expect(library.size).toBeGreaterThan(200);
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
    // An id keeps its payload: a picture does not become a drawing.
    const kind = packCopy((_, manifest, lines) => {
      manifest.release = "kind-change";
      const apple = lines.findIndex((l) => l.id === "apple");
      lines[apple] = { ...lines.find((l) => l.id === "label"), id: "apple" };
    });
    expect(() => importPack(library, kind)).toThrow(/apple: 已是 picture，不能改成 drawing/);
    // An id too long for a work to recognise in its data is refused at import.
    const long = packCopy((_, manifest, lines) => {
      manifest.release = "long-id";
      lines.push({ ...lines.find((l) => l.id === "label"), id: "a".repeat(64) });
    });
    expect(() => importPack(library, long)).toThrow(/第 \d+ 行/);
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
  const tech = library.browse("tech", 1, undefined, [], 5);
  expect(tech.pages).toBeGreaterThan(2);
  expect(library.browse("tech", tech.pages, undefined, [], 5).items.length).toBeGreaterThan(0);
  expect(library.browse("", 1, undefined, [], 10, undefined, ["figure"]).items.every((m) => m.type === "figure")).toBe(true);
});

it("keeps every version a material ever had, and shows a work the pixels of the version it holds", async () => {
  const { dir, library } = testLibrary();
  try {
    const first = library.get("label") as DrawingMaterial;
    const apple = await library.file("apple");
    const second = packCopy((out, manifest, lines) => {
      manifest.release = "v2";
      lines.find((l) => l.id === "label").about += " Second.";
      // The apple's picture is replaced by the moon's under the same id.
      cpSync(join(out, "files", "moon.webp"), join(out, "files", "apple.webp"));
      manifest.files["files/apple.webp"] = createHash("sha256").update(readFileSync(join(out, "files", "apple.webp"))).digest("hex");
    });
    importPack(library, second);
    expect(library.get("apple").version).toBe(2);
    // The version a work took still serves its own pixels.
    expect(Buffer.from((await library.file("apple", undefined, undefined, 0, 1)).bytes).equals(Buffer.from(apple.bytes))).toBe(true);
    expect(Buffer.from((await library.file("apple")).bytes).equals(Buffer.from(apple.bytes))).toBe(false);
    rollback(library, "drawy-curated", "test");
    const third = packCopy((_, manifest, lines) => {
      manifest.release = "v3";
      lines.find((l) => l.id === "label").about += " Third.";
    });
    importPack(library, third);
    // New content goes above every version given before; version 2 still means what it did.
    expect(library.get("label").version).toBe(first.version + 2);
    expect(library.get("label", undefined, first.version + 1).about).toMatch(/Second\.$/);
    expect(library.get("label", undefined, first.version).about).toBe(first.about);
    // Content a material had before keeps that version.
    rollback(library, "drawy-curated", "test");
    importPack(library, packCopy((_, manifest, lines) => {
      manifest.release = "v4";
      lines.find((l) => l.id === "label").about += " Second.";
    }));
    expect(library.get("label").version).toBe(first.version + 1);
  } finally {
    library.close();
    rmSync(dir, { recursive: true });
  }
});

it("checks the materials file against the manifest like any other", () => {
  const { dir, library } = testLibrary();
  try {
    const out = join(mkdtempSync(join(tmpdir(), "drawy-pack-copy-")), "pack");
    cpSync(curatedPack(), out, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    manifest.release = "tampered";
    writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(out, "materials.ndjson"), readFileSync(join(out, "materials.ndjson"), "utf8").replace("Arrow", "Arrows"));
    expect(() => importPack(library, out)).toThrow(/文件校验不符: materials.ndjson/);
  } finally {
    library.close();
    rmSync(dir, { recursive: true });
  }
});

it("names a release by its content unless one is given", () => {
  const read = (p: string) => JSON.parse(readFileSync(join(p, "manifest.json"), "utf8")).release as string;
  const a = join(mkdtempSync(join(tmpdir(), "drawy-build-")), "pack"),
    b = join(mkdtempSync(join(tmpdir(), "drawy-build-")), "pack");
  build(a);
  build(b);
  expect(read(a)).toMatch(/^\d{4}\.\d{2}\.\d{2}-[0-9a-f]{10}$/);
  expect(read(b)).toBe(read(a));
  rmSync(join(a, ".."), { recursive: true });
  rmSync(join(b, ".."), { recursive: true });
});

it("carries what users made over from a library kept before material packs", async () => {
  const old = mkdtempSync(join(tmpdir(), "drawy-legacy-"));
  try {
    const db = new DatabaseSync(join(old, "materials.sqlite"));
    db.exec(`CREATE TABLE materials(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE uses(material_id TEXT NOT NULL,user_id TEXT NOT NULL,work_id TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(material_id,user_id,work_id));`);
    const base = { aliases: [], category: "", about: "a cherry", tags: [], style: null, uses: 0, status: "ready" };
    const picture = {
      ...base,
      id: "u-cherry-1",
      kind: "picture",
      role: "object",
      name: { zh: "樱桃", en: "cherry" },
      form: { width: 40, height: 20, background: "transparent", content: { x: 0, y: 0, width: 1, height: 1 }, anchors: {}, palette: [], recolor: false },
      file: { url: "/materials/files/u-cherry-1", mediaType: "image/png", bytes: 0 },
      origin: { kind: "upload", user: "alice", createdAt: 1 },
      owner: "alice",
    };
    const curated = { ...picture, id: "apple", origin: { kind: "curated", createdAt: 1 }, owner: null };
    for (const m of [picture, curated]) db.prepare("INSERT INTO materials VALUES(?,?)").run(m.id, JSON.stringify(m));
    db.prepare("INSERT INTO uses VALUES(?,?,?,?)").run("u-cherry-1", "alice", "w1", 1);
    // A curated material used before keeps its count once the pack brings it back.
    db.prepare("INSERT INTO uses VALUES(?,?,?,?)").run("apple", "alice", "w1", 1);
    db.prepare("INSERT INTO uses VALUES(?,?,?,?)").run("apple", "bob", "w2", 1);
    db.close();
    mkdirSync(join(old, "files"));
    writeFileSync(join(old, "files", "u-cherry-1.png"), await picture_());
    const library = new Library(old);
    try {
      expect(library.get("u-cherry-1", "alice")).toMatchObject({ type: "object", owner: "alice", uses: 1, version: 1, pack: null });
      expect(() => library.get("apple")).toThrow();
      expect((await library.file("u-cherry-1", "alice")).bytes.length).toBeGreaterThan(0);
      // The pack takes the curated ids back as its own.
      importPack(library, curatedPack());
      expect(library.get("apple").pack).toBe("drawy-curated");
      expect(library.get("apple").uses).toBe(2);
      expect(library.search({ subjects: ["樱桃"] }, "alice")[0].hits[0].material.id).toBe("u-cherry-1");
    } finally {
      library.close();
    }
  } finally {
    rmSync(old, { recursive: true });
  }
});

it("goes back to a release's own bindings, dropping one a later release added", () => {
  const { dir, library } = testLibrary();
  try {
    // A later release binds links to a drawing of its own.
    importPack(
      library,
      packCopy((_, manifest, lines) => {
        manifest.release = "with-link";
        lines.push({ ...lines.find((l) => l.id === "arrow"), id: "arrow-two", name: { zh: "新箭头", en: "New arrow" } });
        manifest.bindings.link = "arrow-two";
      }),
    );
    expect(library.bindings().link).toBe("arrow-two");
    rollback(library, "drawy-curated", "test");
    expect(library.bindings().link).toBe("arrow");
    // A release that bound nothing leaves nothing bound by its source.
    const unbound = packCopy((_, manifest) => {
      manifest.release = "unbound";
      delete manifest.bindings;
    });
    const other = testLibrary();
    try {
      other.library.catalog.sql("DELETE FROM bindings").run();
      other.library.catalog.sql("DELETE FROM releases").run();
      importPack(other.library, unbound);
      importPack(other.library, packCopy((_, manifest) => (manifest.release = "bound")));
      rollback(other.library, "drawy-curated", "unbound");
      expect(() => other.library.bindings()).toThrow(/没有为 text 指定画法/);
    } finally {
      other.library.close();
      rmSync(other.dir, { recursive: true });
    }
  } finally {
    library.close();
    rmSync(dir, { recursive: true });
  }
});

it("says its new errors in English too", () => {
  for (const [zh, en] of [
    ["素材库没有为 link 指定画法", "The material library names no drawing for link"],
    ['未知风格 nope：用 kinds ["style"] 搜索风格', "Unknown style nope; search for styles to find one"],
    ["素材 label 没有版本 9", "Material label has no version 9"],
    ["没有这份数据: geo/x", "No data named geo/x"],
    ["未知图片类型 blob", "Unknown picture type blob"],
    ["素材库里还没有风格", "The material library has no styles yet"],
    ["素材库还没有告诉应用用哪些画法编辑，请稍后再试", "The material library hasn't said which drawings editing uses yet; try again shortly"],
  ])
    expect(localize(zh, "en")).toBe(en);
});

it("reads more materials at once than one batch holds", async () => {
  const served = serveLibrary("http://library.test");
  try {
    const client = new MaterialsClient("http://library.test");
    const ids = [...Array.from({ length: 230 }, (_, i) => `no-such-${i}`), "apple", "label"];
    const found = await client.get(ids, undefined, true);
    expect(found.map((m) => m.id)).toEqual(["apple", "label"]);
  } finally {
    served.close();
  }
});

it("weighs the style asked for, however many of other styles match", () => {
  const { dir, library } = testLibrary();
  try {
    const apple = library.get("apple");
    const crayon = library.search({ subjects: ["苹果"], style: "crayon", limit: 24 })[0].hits.find((h) => h.material.style === "crayon");
    expect(crayon).toBeTruthy();
    // Three hundred more apples, all of another style and used more.
    library.catalog.transaction(() => {
      for (let i = 0; i < 300; i++)
        library.catalog.put({ ...apple, id: `more-apple-${i}`, hash: `more${i}`, uses: 50, origin: { ...apple.origin, createdAt: i } });
    });
    const [found] = library.search({ subjects: [apple.name.zh], style: "crayon", limit: 4 });
    expect(found.hits[0].material.style).toBe("crayon");
  } finally {
    library.close();
    rmSync(dir, { recursive: true });
  }
});
