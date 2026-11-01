import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { Storage, type UserStore } from "../../modules/storage/index.ts";
import { register, login } from "../../modules/identity/index.ts";
import {
  DomainError,
  settingsSchema,
  workEditSchema,
} from "../../modules/contracts/index.ts";
import {
  createWork,
  restore,
  undo,
  writeWork,
} from "../../modules/workspace/index.ts";
import { documentFor } from "../../modules/runtime/document.ts";
import {
  library,
  upload,
  freshen,
  preview,
} from "../../modules/materials/index.ts";
import { MaterialsError } from "@drawy/materials/client";
import { kindSchema } from "@drawy/materials/schema";
import { Agent } from "../../modules/agent/index.ts";
import { tracer } from "../../modules/trace/index.ts";
import { picture } from "../../modules/observation/index.ts";
import encoder from "plantuml-encoder";
import { localize, requestLocale } from "../../modules/contracts/messages.ts";
type Env = {
  Variables: { store: UserStore; user: { id: string; name: string } };
};
export function createApp(storage: Storage) {
  const app = new Hono<Env>();
  const listeners = new Map<string, Set<(event: object) => void>>();
  const publish = (user: string, event: object) =>
    listeners.get(user)?.forEach((fn) => fn(event));
  const agent = new Agent(publish);
  app.onError((e, c) =>
    c.json(
      {
        error: localize(
          e.message,
          requestLocale((k) => c.req.header(k)),
        ),
      },
      e instanceof DomainError || e instanceof MaterialsError
        ? (e.status as 400)
        : e instanceof z.ZodError
          ? 400
          : 500,
    ),
  );
  const userOf = (token?: string) =>
    token ? storage.userFor(token) : undefined;
  app.get("/api/health", (c) => c.json({ ok: true }));
  for (const action of ["register", "login"] as const)
    app.post("/api/auth/" + action, async (c) => {
      const { name, password } = z
        .object({ name: z.string(), password: z.string() })
        .parse(await c.req.json());
      const user =
        action === "register"
          ? register(storage, name, password)
          : login(storage, name, password);
      setCookie(c, "drawy_session", storage.session(user.id), {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
      });
      return c.json(user);
    });
  app.use("/api/*", async (c, next) => {
    const user = userOf(getCookie(c, "drawy_session"));
    if (!user)
      return c.json(
        {
          error: localize(
            "请先登录",
            requestLocale((k) => c.req.header(k)),
          ),
        },
        401,
      );
    c.set("user", user);
    c.set("store", storage.scoped(user.id));
    await next();
  });
  app.get("/api/auth/me", (c) => c.json(c.get("user")));
  app.post("/api/auth/logout", (c) => {
    storage.db
      .prepare("DELETE FROM sessions WHERE id=?")
      .run(getCookie(c, "drawy_session")!);
    deleteCookie(c, "drawy_session", { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/api/settings", (c) => c.json(c.get("store").settings()));
  app.put("/api/settings", async (c) => {
    c.get("store").saveSettings(settingsSchema.parse(await c.req.json()));
    return c.json({ ok: true });
  });
  app.get("/api/works", (c) =>
    c.json(
      c
        .get("store")
        .works()
        .map(({ id, title, revision, updatedAt }) => ({
          id,
          title,
          revision,
          updatedAt,
          cover: c.get("store").cover(id),
        })),
    ),
  );
  app.post("/api/works", async (c) => {
    const { title } = z
      .object({ title: z.string().min(1) })
      .parse(await c.req.json());
    return c.json(createWork(c.get("store"), title));
  });
  app.get("/api/works/:id", async (c) =>
    c.json(
      await freshen(c.get("store").work(c.req.param("id")), c.get("user").id),
    ),
  );
  app.patch("/api/works/:id", async (c) => {
    const { title } = z
      .object({ title: z.string().trim().min(1).max(80) })
      .parse(await c.req.json());
    const store = c.get("store");
    const work = await freshen(
      store.rename(c.req.param("id"), title),
      store.userId,
    );
    publish(store.userId, { type: "work", work });
    return c.json(work);
  });
  app.delete("/api/works/:id", (c) => {
    const store = c.get("store");
    for (const r of store.runs(c.req.param("id")))
      if (["running", "viewing", "waiting"].includes(r.status))
        throw new DomainError("请先取消当前任务", 409);
    store.delete(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/api/works/:id/revisions", (c) =>
    c.json(c.get("store").revisions(c.req.param("id"))),
  );
  /** Changing the drawing by hand waits for the author to finish or be stopped. */
  const idle = (store: UserStore, workId: string) => {
    if (
      store
        .runs(workId)
        .some((r) => ["running", "viewing", "waiting"].includes(r.status))
    )
      throw new DomainError("请先完成或取消当前任务", 409);
  };
  app.get("/api/works/:id/revisions/:revision", async (c) => {
    const store = c.get("store");
    return c.json(
      await freshen(
        store.revision(c.req.param("id"), Number(c.req.param("revision"))),
        store.userId,
      ),
    );
  });
  app.post("/api/works/:id/restore", async (c) => {
    const store = c.get("store"),
      workId = c.req.param("id");
    idle(store, workId);
    const { revision } = z
      .object({ revision: z.number().int().positive() })
      .parse(await c.req.json());
    const work = await freshen(restore(store, workId, revision), store.userId);
    publish(store.userId, { type: "work", work });
    return c.json(work);
  });
  app.post("/api/works/:id/undo", async (c) => {
    const store = c.get("store"),
      workId = c.req.param("id");
    idle(store, workId);
    const work = await freshen(undo(store, workId), store.userId);
    publish(store.userId, { type: "work", work });
    return c.json(work);
  });
  app.get("/api/works/:id/scenes/:scene", async (c) => {
    const store = c.get("store"),
      rev = c.req.query("revision");
    const work = await freshen(
      rev
        ? store.revision(c.req.param("id"), Number(rev))
        : store.work(c.req.param("id")),
      store.userId,
    );
    const sceneId = c.req.param("scene");
    if (!work.scenes[sceneId]) throw new DomainError("场景不存在", 404);
    return c.html(documentFor(work, sceneId));
  });
  app.get("/api/works/:id/scenes/:scene/picture", async (c) => {
    const store = c.get("store"),
      work = store.work(c.req.param("id")),
      scene = work.scenes[c.req.param("scene")];
    if (!scene) throw new DomainError("场景不存在", 404);
    const name =
      (scene.parentId ? `${work.title} - ${scene.title}` : work.title).replace(
        /[\\/:*?"<>|]+/g,
        " ",
      ) + ".png";
    return c.body(await picture(store, work.id, scene.id), 200, {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
  });
  // A hand edit on the canvas: any change to the work, committed like the author's.
  app.post("/api/works/:id/edits", async (c) => {
    const store = c.get("store"),
      workId = c.req.param("id");
    idle(store, workId);
    const { work } = await writeWork(
      store,
      workId,
      workEditSchema.parse(await c.req.json()),
      { kind: "edit" },
    );
    publish(store.userId, { type: "work", work });
    return c.json(work);
  });
  app.get("/api/works/:id/runs", (c) =>
    c.json(c.get("store").runs(c.req.param("id"))),
  );
  app.post("/api/works/:id/runs", async (c) => {
    const args = z
      .object({
        prompt: z.string(),
        sceneId: z.string(),
        materials: z.array(z.string()).default([]),
      })
      // Pictures alone are a request too: draw from them.
      .refine((r) => r.prompt.trim() || r.materials.length)
      .parse(await c.req.json());
    return c.json(
      await agent.start(
        c.get("store"),
        c.req.param("id"),
        args.sceneId,
        args.prompt,
        args.materials,
        requestLocale((k) => c.req.header(k)),
      ),
    );
  });
  app.post("/api/runs/:id/answer", async (c) => {
    const { answer, materials } = z
      .object({
        answer: z.string(),
        materials: z.array(z.string()).default([]),
      })
      .refine((r) => r.answer.trim() || r.materials.length)
      .parse(await c.req.json());
    return c.json(
      await agent.resume(
        c.get("store"),
        c.req.param("id"),
        answer,
        materials,
        requestLocale((k) => c.req.header(k)),
      ),
    );
  });
  app.post("/api/runs/:id/cancel", (c) =>
    c.json(agent.cancel(c.get("store"), c.req.param("id"))),
  );
  app.get("/api/captures/:id", (c) => {
    const store = c.get("store");
    return c.body(new Uint8Array(store.captureBytes(c.req.param("id"))), 200, {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=86400",
    });
  });
  app.get("/api/materials", async (c) =>
    c.json(
      await library.browse(
        c.req.query("q") || "",
        z.coerce
          .number()
          .int()
          .positive()
          .parse(c.req.query("page") || "1"),
        c.get("user").id,
        kindSchema
          .array()
          .parse(c.req.query("kind")?.split(",").filter(Boolean) ?? []),
        Number(c.req.query("size")) || undefined,
      ),
    ),
  );
  app.get("/api/materials/:id", async (c) =>
    c.json((await library.get([c.req.param("id")], c.get("user").id))[0]),
  );
  app.get("/api/materials/:id/preview", async (c) =>
    c.json(await preview(c.req.param("id"), c.get("user").id)),
  );
  app.post("/api/materials", async (c) => {
    const form = await c.req.formData(),
      file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/"))
      throw new DomainError("请选择图片");
    return c.json(
      await upload(
        new Uint8Array(await file.arrayBuffer()),
        file.type,
        file.name,
        c.get("user").id,
      ),
    );
  });
  app.get("/api/traces", (c) =>
    c.json(tracer.list(c.get("user").id, Number(c.req.query("limit") || 60))),
  );
  app.get("/api/traces/files/:name", (c) => {
    const file = tracer.file(c.req.param("name"));
    if (!file) throw new DomainError("没有这张图", 404);
    return c.body(new Uint8Array(file.bytes), 200, {
      "Content-Type": file.type,
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  });
  app.get("/api/traces/:id", (c) => {
    const trace = tracer.get(c.get("user").id, c.req.param("id"));
    if (!trace) throw new DomainError("没有这次运行的记录", 404);
    return c.json(trace);
  });
  app.post("/api/plantuml", async (c) => {
    const { source } = z
      .object({ source: z.string() })
      .parse(await c.req.json());
    const r = await fetch(
      (process.env.DRAWY_PLANTUML_URL || "http://localhost:8092") +
        "/svg/" +
        encoder.encode(source),
    );
    if (!r.ok) throw new DomainError("PlantUML 渲染失败: " + (await r.text()));
    return c.body(await r.text(), 200, { "Content-Type": "image/svg+xml" });
  });
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const userId = c.get("user").id;
      const set = listeners.get(userId) || new Set();
      listeners.set(userId, set);
      const write = (event: object) => {
        void stream.writeSSE({ data: JSON.stringify(event) });
      };
      set.add(write);
      write({ type: "connected" });
      const timer = setInterval(
        () => void stream.writeSSE({ event: "ping", data: "" }),
        20000,
      );
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(timer);
      set.delete(write);
      if (!set.size) listeners.delete(userId);
    }),
  );
  // Pictures and geographic data are served by the library, as the signed-in user when
  // there is one.
  app.get("/materials/:route{files|thumbs|geo}/:id", async (c) => {
    const user = userOf(getCookie(c, "drawy_session"));
    const tag = c.req.header("if-none-match");
    const r = await fetch(
      library.base +
        c.req.path.slice("/materials".length) +
        new URL(c.req.url).search,
      {
        headers: {
          ...(user ? { "x-drawy-user": user.id } : {}),
          ...(tag ? { "if-none-match": tag } : {}),
        },
      },
    );
    const etag = r.headers.get("etag");
    return new Response(r.status === 304 ? null : r.body, {
      status: r.status,
      headers: {
        "Content-Type":
          r.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": r.headers.get("cache-control") || "no-store",
        ...(etag ? { ETag: etag } : {}),
      },
    });
  });
  app.use("/runtime/*", serveStatic({ root: "dist" }));
  app.use("*", serveStatic({ root: "dist/web" }));
  app.get("*", async (c) =>
    c.html(await readFile("dist/web/index.html", "utf8")),
  );
  return { app, agent };
}
