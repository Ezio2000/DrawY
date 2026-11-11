import { z } from "zod";
import {
  boundsOf,
  boxOf,
  boxSchema,
  DomainError,
  drawingOf,
  type Work,
  type Observation,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
import type { Item } from "../models/index.ts";
import type { Shot } from "./capture.ts";
import { tracer } from "../trace/index.ts";
import { drawnWith } from "../materials/index.ts";
import { MIN_TEXT, opening, union } from "../contracts/geometry.ts";
export const viewSchema = z.object({
  sceneId: z.string().optional().describe("One scene; leave out to see every nonempty scene"),
  claims: z
    .array(z.string().min(1))
    .max(6)
    .optional()
    .describe(
      "The statements this figure makes about time, direction, proportion, cause or a number's conditions that would mislead if drawn wrong, each one specific enough to be checked against the picture",
    ),
  regions: z
    .array(boxSchema)
    .min(1)
    .max(3)
    .optional()
    .describe("Close-ups of areas you have a specific doubt about, each [x, y, width, height] in scene units"),
  annotate: z.boolean().optional().describe("Mark each object's id and bounds on the image"),
  actions: z
    .array(z.object({ moduleId: z.string(), selector: z.string() }))
    .optional()
    .describe("CSS-selector clicks to perform in order, in one scene"),
});
export type ViewOptions = z.infer<typeof viewSchema>;
/** The capture service cannot look right now; nothing about the work is wrong. */
export class Unavailable extends Error {}
/** What each module looked like when the author was last told, by scene and module: a look
 * repeats only what has changed since, as the rest is still above in the conversation. */
export type Reported = Record<string, Record<string, string>>;
/** A look's modules as the author reads them, leaving out what it was already told. */
function moduleReport(work: Work, shot: Shot, reported: Reported) {
  const known = (reported[shot.sceneId] ??= {});
  const modules = (shot.modules ?? []).map(({ bounds, pictures, ...m }) => {
    const uses = drawnWith(work, shot.sceneId, m.id);
    return {
      ...m,
      bounds: boxOf(bounds),
      ...(pictures
        ? { pictures: pictures.map(({ material, ...box }) => ({ material, bounds: boxOf(box) })) }
        : {}),
      ...(uses.length ? { uses } : {}),
    };
  });
  const changed = modules.filter((m) => known[m.id] !== JSON.stringify(m));
  for (const m of changed) known[m.id] = JSON.stringify(m);
  return {
    modules: changed,
    ...(changed.length < modules.length
      ? { unchangedModules: modules.length - changed.length }
      : {}),
  };
}
export async function observe(
  store: UserStore,
  workId: string,
  input: ViewOptions,
  signal: AbortSignal,
  /** This run's earlier looks, and what it has been told about the modules. */
  earlier: { observations: Observation[]; reported: Reported } = {
    observations: [],
    reported: {},
  },
) {
  const options = viewSchema.parse(input),
    work = store.work(workId);
  const populated = Object.values(work.scenes).filter((s) => s.modules.length);
  // A close-up or a click belongs to one scene; with only one drawn, that is the one.
  const focused = options.regions?.length || options.actions?.length;
  const sceneId =
    options.sceneId ?? (focused && populated.length === 1 ? populated[0].id : undefined);
  if (focused && !sceneId) throw new DomainError("局部查看和交互操作需要指定 sceneId");
  const scenes = sceneId ? [work.scenes[sceneId]] : populated;
  if (!scenes.length || scenes.some((s) => !s))
    throw new DomainError("没有可查看的场景");
  // A close-up of a revision already seen whole, without errors, is only that close-up.
  const closeUpOnly =
    !!focused &&
    !options.annotate &&
    earlier.observations.some(
      (o) =>
        o.revision === work.revision &&
        o.overview &&
        o.sceneIds.includes(scenes[0].id) &&
        !o.errors.length,
    );
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
                overview: !closeUpOnly,
                regions: options.regions?.map(boundsOf),
                actions: options.actions,
              })),
            }),
            signal,
          },
        ).catch((e) => {
          if (signal.aborted) throw e;
          throw new Unavailable("画布查看服务不可用: " + e.message);
        });
        if (!response.ok)
          throw new Unavailable(
            `画布查看服务不可用 (${response.status}): ${(await response.text()).slice(0, 300)}`,
          );
        const { shots } = (await response.json()) as { shots: Shot[] };
        if (!shots.length) throw Error("截图服务没有返回画面");
        const kept = shots.map((s, i) =>
          s.base64
            ? store.putCapture(
                Buffer.from(s.base64, "base64"),
                `canvas-${work.revision}-${s.sceneId}-${i}`,
              )
            : undefined,
        );
        const screenshots = kept.filter((c) => !!c);
        span.set({
          shots: shots.map((s, i) => ({
            view: s.label,
            ...(kept[i] ? { url: kept[i].url } : {}),
            ...(s.opened ? { opened: s.opened } : {}),
            camera: s.camera,
            modules: s.modules,
            errors: s.errors,
          })),
        });
        const observation: Observation = {
          at: Date.now(),
          revision: work.revision,
          sceneIds: scenes.map((s) => s.id),
          overview: !closeUpOnly,
          screenshots,
          errors: [...new Set(shots.flatMap((s) => s.errors))],
          ...(shots.some((s) => s.overview && s.text?.smallest)
            ? {
                smallestText: Object.fromEntries(
                  shots.flatMap((s) =>
                    s.overview && s.text?.smallest ? [[s.sceneId, s.text.smallest.px]] : [],
                  ),
                ),
              }
            : {}),
        };
        const content: Item[] = [
          // What the look is judged against, beside the pictures rather than far back in
          // the conversation.
          ...(work.brief
            ? [
                {
                  type: "input_text",
                  text: [
                    `Judge this look against the brief. Intent: ${work.brief.intent} Concept: ${work.brief.concept ?? "(none set)"}`,
                    options.claims?.length
                      ? `Before anything about how it looks, check in your reasoning whether the picture holds each claim, and fix the ones it does not; the user never reads these verdicts, so they stay out of your notes and closing words: ${options.claims.join(" | ")}`
                      : "Before anything about how it looks, check what the figure states about time, direction, proportion, cause and each number's conditions.",
                  ].join("\n"),
                },
              ]
            : []),
          ...shots.flatMap((s) => [
            {
              type: "input_text",
              text: JSON.stringify({
                revision: work.revision,
                sceneId: s.sceneId,
                view: s.label,
                camera: s.camera,
                ...(s.overview
                  ? {
                      figure: figure(work, s),
                      ...(s.text?.clipped.length ? { clippedText: s.text.clipped } : {}),
                      ...moduleReport(work, s, earlier.reported),
                    }
                  : {}),
                ...(s.opened ? { opened: openedPage(work, s.opened) } : {}),
                ...(s.errors.length ? { errors: s.errors } : {}),
              }),
            },
            ...(s.base64
              ? [
                  {
                    type: "input_image",
                    image_url: "data:image/png;base64," + s.base64,
                    detail: "high",
                  },
                ]
              : []),
          ]),
        ];
        return { observation, content };
      } finally {
        store.storage.db.prepare("DELETE FROM sessions WHERE id=?").run(token);
      }
    },
  );
}
/** A page a click opened, in words: the app lays out a detail page the same way for every
 * work, so a picture of it would only show the author's HTML back. A module's own target
 * opens without any script, so a check of it tests nothing the author wrote. */
function openedPage(work: Work, opened: NonNullable<Shot["opened"]>) {
  const title = work.details[opened.detail]?.title;
  return {
    detail: opened.detail,
    ...(title ? { title } : {}),
    note: opened.byTarget
      ? "This click opened the module's own target, which the app opens by itself; details are not pictured. Take this check out of the scene's checks."
      : "The click opened this detail page; details are not pictured, as the app lays them out.",
  };
}
/** How the scene's figure sits in the opening view: its extent in scene units, the share of
 * the view it covers, which drops as its proportions stray from the view's, and the text
 * too small to read there with the size in scene units that would be readable. */
function figure(work: Work, shot: Shot) {
  const scene = work.scenes[shot.sceneId];
  const box = union(scene.modules.map((m) => m.bounds));
  /** A part's size parameter, and the size at which its smallest text would read: what
   * changing it takes, whatever share of the size that text is drawn at. */
  const remedy = (id: string, px: number) => {
    const part = [...scene.modules, ...scene.links].find((p) => p.id === id);
    const size = part && (part.data.size ?? drawingOf(work, part.drawingId)?.defaults.size);
    return typeof size === "number" ? { size, sizeThatReads: Math.ceil((size * MIN_TEXT) / px) } : {};
  };
  const { scale } = shot.camera;
  return {
    width: Math.round(box.width),
    height: Math.round(box.height),
    ...(shot.text?.smallest ? { smallestText: shot.text.smallest } : {}),
    ...(shot.text?.small.length
      ? {
          tooSmall: shot.text.small.map((t) => ({ ...t, ...remedy(t.moduleId, t.px) })),
          readableFrom: `text reads at ${MIN_TEXT}px here from size ${opening(box).smallestSize} in scene units`,
        }
      : {}),
    ...(shot.structure && Object.keys(shot.structure).length
      ? {
          structure: {
            ...shot.structure,
            note: "Measured from what is drawn, so no close-up is needed. Links are routed round modules by the scene itself: clear a crossing, a covered or crossed label or a struck name by giving the modules more room (move them, or arrange again with a larger gap), by route \"elbow\" for a straight or curved line that passes through something, by labelAt for words another line runs through, or, for two lines laid on one another (shared), by moving a module so their ways part or giving one end another side (at); never by a link drawing of your own. Give an overflowing part the size in needs, or fewer words.",
          },
        }
      : {}),
    viewFilled:
      Math.round(
        ((box.width * scale * box.height * scale) /
          (shot.viewport.width * shot.viewport.height)) *
          100,
      ) / 100,
  };
}
/** The scene as a PNG to download, drawn by the capture service at full resolution. */
export async function picture(
  store: UserStore,
  workId: string,
  sceneId: string,
  format: "png" | "pdf" = "png",
) {
  const work = store.work(workId);
  if (!work.scenes[sceneId]?.modules.length)
    throw new DomainError("没有可查看的场景");
  const origin = process.env.DRAWY_INTERNAL_URL || "http://127.0.0.1:8080";
  const token = store.storage.session(store.userId);
  try {
    const response = await fetch(
      (process.env.DRAWY_CAPTURE_URL || "http://127.0.0.1:8091") + "/render",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          cookie: token,
          format,
          url: `${origin}/api/works/${work.id}/scenes/${encodeURIComponent(sceneId)}?revision=${work.revision}`,
        }),
      },
    ).catch((e) => {
      throw new Unavailable("画布查看服务不可用: " + e.message);
    });
    if (!response.ok)
      throw new Unavailable(
        `画布查看服务不可用 (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    store.storage.db.prepare("DELETE FROM sessions WHERE id=?").run(token);
  }
}
export function requireObserved(work: Work, observations: Observation[]) {
  const scenes = Object.values(work.scenes).filter((s) => s.modules.length);
  if (!work.scenes[work.rootSceneId].modules.length)
    throw new DomainError("请先完成根场景");
  const missing = scenes.filter((s) => {
    const looks = observations.filter(
      (o) => o.revision === work.revision && o.sceneIds.includes(s.id),
    );
    return !looks.some((o) => o.overview) || looks.at(-1)!.errors.length;
  });
  if (missing.length)
    throw new DomainError(
      "完成前需要查看最新版本并修复运行错误: " +
        missing.map((s) => s.id).join(", "),
    );
}
