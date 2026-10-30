import { z } from "zod";
import {
  boundsSchema,
  DomainError,
  type Work,
  type Observation,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
import type { Item } from "../models/index.ts";
import type { Shot } from "./capture.ts";
import { tracer } from "../trace/index.ts";
export const viewSchema = z.object({
  sceneId: z.string().optional(),
  region: boundsSchema.optional(),
  annotate: z.boolean().optional(),
  actions: z
    .array(z.object({ moduleId: z.string(), selector: z.string() }))
    .optional(),
});
export type ViewOptions = z.infer<typeof viewSchema>;
export async function observe(
  store: UserStore,
  workId: string,
  input: ViewOptions,
  signal: AbortSignal,
) {
  const options = viewSchema.parse(input),
    work = store.work(workId);
  if (options.actions?.length && !options.sceneId)
    throw new DomainError("交互操作需要指定 sceneId");
  const scenes = options.sceneId
    ? [work.scenes[options.sceneId]]
    : Object.values(work.scenes).filter((s) => s.modules.length);
  if (!scenes.length || scenes.some((s) => !s))
    throw new DomainError("没有可查看的场景");
  const origin = process.env.DRAWY_INTERNAL_URL || "http://127.0.0.1:8080";
  const token = store.storage.session(store.userId);
  return tracer.span(
    "capture",
    "view_canvas",
    { revision: work.revision, ...options },
    async (span) => {
      try {
        const response = await fetch(
          (process.env.DRAWY_CAPTURE_URL || "http://127.0.0.1:8091") +
            "/capture",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              origin,
              cookie: token,
              annotate: options.annotate,
              scenes: scenes.map((s) => ({
                id: s.id,
                url: `${origin}/api/works/${work.id}/scenes/${encodeURIComponent(s.id)}?revision=${work.revision}`,
                checks: s.checks,
                region: options.region,
                actions: options.actions,
              })),
            }),
            signal,
          },
        );
        if (!response.ok)
          throw Error("查看画布失败: " + (await response.text()));
        const { shots } = (await response.json()) as { shots: Shot[] };
        if (!shots.length) throw Error("截图服务没有返回画面");
        const screenshots = shots.map((s, i) =>
          store.putCapture(
            Buffer.from(s.base64, "base64"),
            `canvas-${work.revision}-${s.sceneId}-${i}`,
          ),
        );
        span.set({
          shots: shots.map((s, i) => ({
            view: s.label,
            url: screenshots[i].url,
            errors: s.errors,
          })),
        });
        const observation: Observation = {
          at: Date.now(),
          revision: work.revision,
          sceneIds: scenes.map((s) => s.id),
          overview: true,
          screenshots,
          errors: [...new Set(shots.flatMap((s) => s.errors))],
        };
        const content: Item[] = shots.flatMap((s) => [
          {
            type: "input_text",
            text: JSON.stringify({
              revision: work.revision,
              sceneId: s.sceneId,
              view: s.label,
              camera: s.camera,
              modules: s.modules,
              errors: s.errors,
            }),
          },
          {
            type: "input_image",
            image_url: "data:image/png;base64," + s.base64,
            detail: "high",
          },
        ]);
        return { observation, content };
      } finally {
        store.storage.db.prepare("DELETE FROM sessions WHERE id=?").run(token);
      }
    },
  );
}
export function requireObserved(work: Work, observations: Observation[]) {
  const scenes = Object.values(work.scenes).filter((s) => s.modules.length);
  if (!work.scenes[work.rootSceneId].modules.length)
    throw new DomainError("请先完成根场景");
  const missing = scenes.filter((s) => {
    const latest = observations.findLast(
      (o) =>
        o.revision === work.revision && o.overview && o.sceneIds.includes(s.id),
    );
    return !latest || latest.errors.length;
  });
  if (missing.length)
    throw new DomainError(
      "完成前需要查看最新版本并修复运行错误: " +
        missing.map((s) => s.id).join(", "),
    );
}
