import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { Library, LibraryError } from "./library.ts";
import { Streets, StreetsError } from "./streets.ts";
import { kindSchema, shelfSchema, typeIdSchema } from "./schema.ts";

/** The library over HTTP. Callers name the user they act for in `x-drawy-user`; requests
 * without one see only public materials. `x-drawy-access: all` lets the user see and use
 * everyone's materials; the app sends it only for roles allowed to. Nothing here lists the
 * whole library: every list is a page or a bounded search. */
export function createServer(library: Library, streets = new Streets(library.streetsDir)) {
  const app = new Hono();
  const user = (c: { req: { header: (k: string) => string | undefined } }) =>
    c.req.header("x-drawy-user") || undefined;
  const viewer = (c: Parameters<typeof user>[0]) => {
    const id = user(c);
    return id ? { id, all: c.req.header("x-drawy-access") === "all" } : undefined;
  };
  const owner = (c: Parameters<typeof user>[0]) => {
    const id = user(c);
    if (!id) throw new LibraryError("需要用户身份");
    return id;
  };
  const list = <T extends z.ZodType>(schema: T, value: string | undefined) =>
    z.array(schema).parse(value?.split(",").filter(Boolean) ?? []) as z.infer<T>[];
  app.onError((e, c) =>
    c.json(
      { error: e.message },
      e instanceof LibraryError || e instanceof StreetsError ? e.status : e instanceof z.ZodError ? 400 : 500,
    ),
  );
  app.get("/health", (c) => c.json({ ok: true, materials: library.size }));
  app.get("/types", (c) => c.json(library.types()));
  app.get("/bindings", (c) => c.json(library.bindings()));
  app.post("/search", async (c) => c.json(library.search(await c.req.json(), viewer(c))));
  app.get("/browse", (c) =>
    c.json(
      library.browse(
        c.req.query("q") || "",
        Number(c.req.query("page") || 1),
        viewer(c),
        list(kindSchema, c.req.query("kind")),
        Number(c.req.query("size")) || undefined,
        shelfSchema.optional().parse(c.req.query("shelf") || undefined),
        list(typeIdSchema, c.req.query("type")),
      ),
    ),
  );
  app.post("/materials/batch", async (c) => {
    const { ids, lenient } = z
      .object({
        ids: z.array(z.union([z.string(), z.object({ id: z.string(), version: z.number().int().positive().optional() })])).max(200),
        lenient: z.boolean().default(false),
      })
      .parse(await c.req.json());
    return c.json(library.many(ids, viewer(c), lenient));
  });
  app.get("/materials/:id", (c) => {
    const version = c.req.query("version");
    return c.json(library.get(c.req.param("id"), viewer(c), version ? Number(version) : undefined));
  });
  app.post("/materials/:id/owner", async (c) => {
    const { published } = z.object({ published: z.boolean() }).parse(await c.req.json());
    return c.json(library.publish(c.req.param("id"), published));
  });
  app.post("/materials/reserve", async (c) => c.json(library.reserve(await c.req.json(), owner(c))));
  app.put("/materials/:id/file", async (c) =>
    c.json(
      await library.develop(
        c.req.param("id"),
        new Uint8Array(await c.req.arrayBuffer()),
        c.req.header("content-type") || "application/octet-stream",
        owner(c),
        c.req.query("transparent") === "1",
      ),
    ),
  );
  app.post("/materials/:id/fail", async (c) => {
    const { error } = z.object({ error: z.string() }).parse(await c.req.json());
    return c.json(library.fail(c.req.param("id"), error, owner(c)));
  });
  app.post("/materials", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/")) throw new LibraryError("请上传图片");
    const meta = JSON.parse(String(form.get("meta")));
    return c.json(await library.ingest(new Uint8Array(await file.arrayBuffer()), file.type, meta, owner(c)));
  });
  app.post("/uses", async (c) => {
    const { ids, work } = z.object({ ids: z.array(z.string()), work: z.string() }).parse(await c.req.json());
    library.use(ids, work, owner(c));
    return c.json({ ok: true });
  });
  app.get("/files/:id", async (c) => {
    const wait = Number(c.req.query("wait") ?? 240) * 1000;
    const version = c.req.query("v") ? Number(c.req.query("v")) : undefined;
    const { material, bytes } = await library.file(c.req.param("id"), viewer(c), c.req.query("color"), wait, version);
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": material.file.mediaType,
      "Cache-Control": material.owner === null ? "public, max-age=86400" : "private, max-age=3600",
    });
  });
  // City-scale ground from OpenStreetMap, one web-map tile at a time.
  app.get("/geo/streets/:z/:x/:y", async (c) => {
    const [z, x, y] = ["z", "x", "y"].map((k) => Number(c.req.param(k)));
    return c.body(new Uint8Array(await streets.tile(z, x, y)), 200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=604800",
    });
  });
  // Data a material pack carries for its drawings, by name: geographic layers and relief.
  const data = (c: Parameters<typeof user>[0] & { req: { header: (k: string) => string | undefined } }, name: string) => {
    if (!/^geo\/[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(name)) throw new LibraryError("没有这份地理数据: " + name, 404);
    const { bytes, media, etag } = library.data(name);
    const headers = { "Content-Type": media, "Cache-Control": "no-cache", ETag: etag };
    return c.req.header("if-none-match") === etag
      ? new Response(null, { status: 304, headers })
      : new Response(new Uint8Array(bytes), { status: 200, headers });
  };
  app.get("/geo/relief/:tile", (c) => data(c, "geo/relief/" + c.req.param("tile")));
  app.get("/geo/:layer", (c) => data(c, "geo/" + c.req.param("layer")));
  app.get("/thumbs/:id", async (c) => {
    const size = Math.min(512, Math.max(32, Number(c.req.query("size") || 256)));
    const version = c.req.query("v") ? Number(c.req.query("v")) : undefined;
    return c.body(new Uint8Array(await library.thumb(c.req.param("id"), viewer(c), size, version)), 200, {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=86400",
    });
  });
  return app;
}

if (import.meta.main) {
  // Starting opens the library as it stands; packs are imported apart, with cli.ts.
  const library = new Library(process.env.MATERIALS_DATA || "data/materials");
  serve({ fetch: createServer(library).fetch, port: Number(process.env.PORT || 8090), hostname: "0.0.0.0" });
  process.on("SIGTERM", () => {
    library.close();
    process.exit(0);
  });
}
