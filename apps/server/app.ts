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
  boundsSchema,
} from "../../modules/contracts/index.ts";
import {
  createWork,
  restore,
  moveModules,
} from "../../modules/workspace/index.ts";
import { documentFor } from "../../modules/runtime/document.ts";
import { browseMaterials, catalogue } from "../../modules/materials/index.ts";
import { Agent } from "../../modules/agent/index.ts";
import encoder from "plantuml-encoder";
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
      { error: e.message },
      e instanceof DomainError
        ? (e.status as 400)
        : e instanceof z.ZodError
          ? 400
          : 500,
    ),
  );
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
    const token = getCookie(c, "drawy_session");
    const user = token ? storage.userFor(token) : undefined;
    if (!user) return c.json({ error: "请先登录" }, 401);
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
        })),
    ),
  );
  app.post("/api/works", async (c) => {
    const { title } = z
      .object({ title: z.string().min(1) })
      .parse(await c.req.json());
    return c.json(createWork(c.get("store"), title));
  });
  app.get("/api/works/:id", (c) =>
    c.json(c.get("store").work(c.req.param("id"))),
  );
  app.delete("/api/works/:id", (c) => {
    const store = c.get("store");
    for (const r of store.runs(c.req.param("id")))
      if (["running", "reviewing", "waiting"].includes(r.status))
        throw new DomainError("请先取消当前任务", 409);
    store.delete(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/api/works/:id/revisions", (c) =>
    c.json(c.get("store").revisions(c.req.param("id"))),
  );
  app.post("/api/works/:id/restore", async (c) => {
    const store = c.get("store"),
      workId = c.req.param("id");
    if (
      store
        .runs(workId)
        .some((r) => ["running", "reviewing", "waiting"].includes(r.status))
    )
      throw new DomainError("请先完成或取消当前任务", 409);
    const { revision } = z
      .object({ revision: z.number().int().positive() })
      .parse(await c.req.json());
    const work = restore(store, workId, revision);
    publish(store.userId, { type: "work", work });
    return c.json(work);
  });
  app.get("/api/works/:id/scenes/:scene", (c) => {
    const store = c.get("store"),
      rev = c.req.query("revision");
    const work = rev
      ? store.revision(c.req.param("id"), Number(rev))
      : store.work(c.req.param("id"));
    const sceneId = c.req.param("scene");
    if (!work.scenes[sceneId]) throw new DomainError("场景不存在", 404);
    return c.html(documentFor(work, sceneId));
  });
  app.patch("/api/works/:id/modules", async (c) => {
    const store = c.get("store"),
      workId = c.req.param("id");
    if (
      store
        .runs(workId)
        .some((r) => ["running", "reviewing", "waiting"].includes(r.status))
    )
      throw new DomainError("请先完成当前任务", 409);
    const args = z
      .object({
        sceneId: z.string(),
        baseRevision: z.number().int(),
        moves: z.array(z.object({ id: z.string(), bounds: boundsSchema })),
      })
      .parse(await c.req.json());
    const work = moveModules(
      store,
      workId,
      args.sceneId,
      args.baseRevision,
      args.moves,
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
        prompt: z.string().min(1),
        sceneId: z.string(),
        assets: z.array(z.string()).default([]),
      })
      .parse(await c.req.json());
    return c.json(
      agent.start(
        c.get("store"),
        c.req.param("id"),
        args.sceneId,
        args.prompt,
        args.assets,
      ),
    );
  });
  app.post("/api/runs/:id/answer", async (c) => {
    const { answer } = z
      .object({ answer: z.string().min(1) })
      .parse(await c.req.json());
    return c.json(agent.resume(c.get("store"), c.req.param("id"), answer));
  });
  app.post("/api/runs/:id/cancel", (c) =>
    c.json(agent.cancel(c.get("store"), c.req.param("id"))),
  );
  app.get("/api/assets/:id", (c) => {
    const store = c.get("store"),
      asset = store.asset(c.req.param("id"));
    return c.body(new Uint8Array(store.bytes(asset.id)), 200, {
      "Content-Type": asset.mediaType,
      "Cache-Control": "private, no-store",
    });
  });
  app.post("/api/assets", async (c) => {
    const form = await c.req.formData(),
      file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/"))
      throw new DomainError("请选择图片");
    return c.json(
      c
        .get("store")
        .putAsset(
          new Uint8Array(await file.arrayBuffer()),
          file.name,
          file.type,
        ),
    );
  });
  app.get("/api/materials", async (c) =>
    c.json(
      await browseMaterials(
        c.get("store"),
        c.req.query("q") || "",
        z.coerce
          .number()
          .int()
          .positive()
          .parse(c.req.query("page") || "1"),
      ),
    ),
  );
  app.get("/api/catalogue", async (c) => c.json(await catalogue()));
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
  app.get("/materials/*", async (c) => {
    const path = c.req.path.slice("/materials".length);
    const r = await fetch(
      (process.env.DRAWY_MATERIALS_URL || "http://localhost:8090") + path,
    );
    return new Response(r.body, {
      status: r.status,
      headers: {
        "Content-Type":
          r.headers.get("content-type") || "application/octet-stream",
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
