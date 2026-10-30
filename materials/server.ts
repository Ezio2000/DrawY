import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { Library, LibraryError } from "./library.ts";
import {
  describeSchema,
  kindSchema,
  reserveSchema,
  searchSchema,
} from "./schema.ts";

/** The library over HTTP. Callers name the user they act for in `x-drawy-user`; requests
 * without one see only public materials. */
export function createServer(library: Library) {
  const app = new Hono();
  const user = (c: { req: { header: (k: string) => string | undefined } }) =>
    c.req.header("x-drawy-user") || undefined;
  const owner = (c: Parameters<typeof user>[0]) => {
    const id = user(c);
    if (!id) throw new LibraryError("需要用户身份");
    return id;
  };
  app.onError((e, c) =>
    c.json(
      { error: e.message },
      e instanceof LibraryError
        ? e.status
        : e instanceof z.ZodError
          ? 400
          : 500,
    ),
  );
  app.get("/health", (c) =>
    c.json({ ok: true, materials: library.index.size }),
  );
  app.get("/styles", (c) => c.json(library.styles()));
  app.post("/search", async (c) =>
    c.json(library.search(searchSchema.parse(await c.req.json()), user(c))),
  );
  app.get("/browse", (c) =>
    c.json(
      library.browse(
        c.req.query("q") || "",
        Number(c.req.query("page") || 1),
        user(c),
        kindSchema
          .array()
          .parse(c.req.query("kind")?.split(",").filter(Boolean) ?? []),
      ),
    ),
  );
  app.post("/materials/batch", async (c) => {
    const { ids, lenient } = z
      .object({ ids: z.array(z.string()), lenient: z.boolean().default(false) })
      .parse(await c.req.json());
    return c.json(library.many(ids, user(c), lenient));
  });
  app.get("/materials/:id", (c) =>
    c.json(library.get(c.req.param("id"), user(c))),
  );
  app.post("/materials/reserve", async (c) =>
    c.json(library.reserve(reserveSchema.parse(await c.req.json()), owner(c))),
  );
  app.put("/materials/:id/file", async (c) =>
    c.json(
      await library.develop(
        c.req.param("id"),
        new Uint8Array(await c.req.arrayBuffer()),
        c.req.header("content-type") || "application/octet-stream",
        owner(c),
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
    if (!(file instanceof File) || !file.type.startsWith("image/"))
      throw new LibraryError("请上传图片");
    const meta = describeSchema.parse(JSON.parse(String(form.get("meta"))));
    return c.json(
      await library.ingest(
        new Uint8Array(await file.arrayBuffer()),
        file.type,
        meta,
        owner(c),
      ),
    );
  });
  app.post("/uses", async (c) => {
    const { ids, work } = z
      .object({ ids: z.array(z.string()), work: z.string() })
      .parse(await c.req.json());
    library.use(ids, work, owner(c));
    return c.json({ ok: true });
  });
  app.get("/files/:id", async (c) => {
    const wait = Number(c.req.query("wait") ?? 240) * 1000;
    const { material, bytes } = await library.file(
      c.req.param("id"),
      user(c),
      c.req.query("color"),
      wait,
    );
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": material.file.mediaType,
      "Cache-Control":
        material.owner === null
          ? "public, max-age=86400"
          : "private, max-age=3600",
    });
  });
  app.get("/thumbs/:id", async (c) => {
    const size = Math.min(
      512,
      Math.max(32, Number(c.req.query("size") || 256)),
    );
    return c.body(
      new Uint8Array(await library.thumb(c.req.param("id"), user(c), size)),
      200,
      {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=86400",
      },
    );
  });
  return app;
}

if (import.meta.main) {
  const library = new Library(
    process.env.MATERIALS_DATA || "data/materials",
    new URL("./seed", import.meta.url).pathname,
  );
  serve({
    fetch: createServer(library).fetch,
    port: Number(process.env.PORT || 8090),
    hostname: "0.0.0.0",
  });
  process.on("SIGTERM", () => {
    library.close();
    process.exit(0);
  });
}
