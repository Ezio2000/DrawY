import { z } from "zod";
import { headers } from "../models/index.ts";
import type { UserStore } from "../storage/index.ts";
import { DomainError, type Work } from "../contracts/index.ts";
import type { Material, StyleMaterial } from "@drawy/materials/schema";
import { library, styleOf } from "../materials/index.ts";
import { tracer } from "../trace/index.ts";

/** A picture the author wants made. */
export const pictureRequestSchema = z.object({
  name: z.object({ zh: z.string().min(1), en: z.string().min(1) }),
  aliases: z.array(z.string()).default([]),
  role: z.enum(["object", "figure", "scene", "texture", "icon"]),
  /** What is in the frame: the subject, its state, view and details. Not the style. */
  depicts: z.string().min(1),
  aspect: z.enum(["square", "landscape", "portrait"]).default("square"),
  /** A name other pictures in the same request can refer to. */
  key: z.string().optional(),
  /** Pictures to work from, to restyle, vary or keep consistent with: material ids, or
   * keys of pictures in the same request, which are then made first. */
  references: z.array(z.string()).default([]),
});
export type PictureRequest = z.input<typeof pictureRequestSchema>;
const sizes = {
  square: [1024, 1024],
  landscape: [1536, 1024],
  portrait: [1024, 1536],
} as const;

/** A picture being made in the background. */
export interface Development {
  id: string;
  name: string;
  done: Promise<{ status: "ready" | "failed"; error?: string }>;
  settled?: { status: "ready" | "failed"; error?: string; at: number };
}

/** Pictures sent only for their look, so a new picture matches the style's samples and
 * the pictures the work already has, rather than the model's idea of the style's name. */
const STYLE_REFERENCES = 2;

/** The pictures a new one is painted to look like: those the work already has in its
 * style, then the style's own samples, each of the same role first. A picture of the
 * request's own references is not repeated. */
export async function styleReferences(
  work: Work,
  style: Pick<StyleMaterial, "id" | "samples">,
  role: string,
  references: string[],
  user: string,
) {
  const samples = await library
    .get(style.samples, user, true)
    .catch(() => [] as Material[]);
  const own = Object.values(work.materials).filter(
    (m) => m.kind === "picture" && m.style === style.id && m.status === "ready",
  ) as { id: string; role: string }[];
  const shown = samples.filter(
    (m) => m.kind === "picture" && m.status === "ready",
  ) as { id: string; role: string }[];
  const ranked = [
    ...own.filter((m) => m.role === role),
    ...shown.filter((m) => m.role === role),
    ...own,
    ...shown,
  ].map((m) => m.id);
  return [...new Set(ranked)]
    .filter((id) => !references.includes(id))
    .slice(0, STYLE_REFERENCES);
}

/** Everything the picture model is asked: the subject in the work's style, composed to be
 * placed on the canvas. */
function promptFor(
  r: z.infer<typeof pictureRequestSchema>,
  style: string,
  direction: string,
  styled = 0,
) {
  // The role decides the background: a cut-out stands on transparency, a scene is whole.
  const framing = {
    object:
      "A single subject, centred, filling most of the frame with a small even margin, isolated on a transparent background; no ground, no frame.",
    figure:
      "One character, centred, filling most of the frame with a small even margin, isolated on a transparent background; no ground, no frame.",
    icon: "One simple symbol, centred, filling most of the frame, on a transparent background.",
    scene:
      "A self-contained vignette: the scene fills the frame, but its edges dissolve softly into plain off-white paper; no border, no frame.",
    texture: "A seamless full-bleed surface with no focal subject.",
  }[r.role];
  // The images are sent in this order: what to work from, then what to look like.
  const given = r.references.length,
    all = given + styled;
  const span = (from: number, to: number) =>
    from === to ? `Image ${from}` : `Images ${from}–${to}`;
  const shown = [
    given
      ? `${span(1, given)}: what to work from; keep the subject, character and details the subject line asks to keep.`
      : "",
    styled
      ? `${span(given + 1, all)}: style references only. Match their medium, line quality, stroke weight, palette, shading, texture and level of detail so the new picture sits beside them as one set; do not copy their subjects, objects or composition.`
      : "",
  ].filter(Boolean);
  // The medium comes first: picture models otherwise drift towards a realistic default.
  return `${style}\nSubject: ${r.depicts}\n${framing} Nothing else in the frame. No text, letters, numbers, arrows, labels or watermark.\nLook and mood only (adds nothing to the content): ${direction}${shown.length ? "\n" + shown.join("\n") : ""}`;
}

/** Calls the picture model and returns the bytes of one picture. */
async function paint(
  store: UserStore,
  prompt: string,
  size: string,
  transparent: boolean,
  references: Uint8Array[],
) {
  const role = store.settings().image;
  if (!role.credential) throw Error("请在模型设置中配置生图凭证");
  const attempt = async (background: string) => {
    const params = {
      model: role.model,
      prompt,
      n: 1,
      size,
      quality: "auto",
      background,
    };
    let body: BodyInit;
    const h: Record<string, string> = headers(role);
    if (references.length && role.channel === "api") {
      const form = new FormData();
      for (const [k, v] of Object.entries(params)) form.append(k, String(v));
      references.forEach((bytes, i) =>
        form.append(
          "image[]",
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          `reference-${i}.png`,
        ),
      );
      body = form;
      delete h["Content-Type"];
    } else
      body = JSON.stringify({
        ...params,
        ...(references.length
          ? {
              images: references.map((bytes) => ({
                image_url: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
              })),
            }
          : {}),
      });
    if (role.channel === "oauth")
      h["x-codex-image-turn-id"] = crypto.randomUUID();
    return fetch(
      role.baseUrl.replace(/\/$/, "") +
        "/images/" +
        (references.length ? "edits" : "generations"),
      {
        method: "POST",
        headers: h,
        body,
        signal: AbortSignal.timeout(10 * 60_000),
      },
    );
  };
  // A dropped connection, a rate limit or a server error is retried; any other answer
  // is final.
  const send = async (background: string) => {
    for (const wait of [3000, 10000, 0]) {
      const began = Date.now();
      const r = await attempt(background).catch((e) => {
        tracer.note(
          "request",
          { background, ms: Date.now() - began },
          e instanceof Error ? e.message : String(e),
        );
        if (!wait) throw e;
        return undefined;
      });
      if (r)
        tracer.note(
          "request",
          { background, status: r.status, ms: Date.now() - began },
          r.ok ? undefined : `HTTP ${r.status}`,
        );
      if (r && (r.ok || (r.status !== 429 && r.status < 500) || !wait))
        return r;
      await r?.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    throw Error("unreachable");
  };
  let r = await send(transparent ? "transparent" : "opaque");
  // Not every picture model can leave the background clear.
  if (r.status === 400 && transparent) {
    const text = await r.text();
    if (!/background/i.test(text)) throw Error(`生图失败 400: ${text}`);
    r = await send("auto");
  }
  if (!r.ok) throw Error(`生图失败 ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { data: { b64_json: string }[] };
  return Buffer.from(data.data[0].b64_json, "base64");
}

/** Reserves each picture in the library and develops it in the background, in the work's
 * style. The ids are usable at once; each development settles on its own. */
export async function develop(
  store: UserStore,
  work: Work,
  input: PictureRequest[],
): Promise<Development[]> {
  if (!work.brief)
    throw new DomainError("请先用 set_brief 确定风格，再生成图片");
  const requests = input.map((r) => pictureRequestSchema.parse(r));
  const style = await styleOf(work.brief.style);
  const model = store.settings().image.model;
  const ids = requests.map(
    (r) =>
      `g-${
        r.name.en
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 28) || "picture"
      }-${crypto.randomUUID().slice(0, 4)}`,
  );
  const keyed = new Map(
    requests.flatMap((r, i) => (r.key ? [[r.key, ids[i]] as const] : [])),
  );
  return Promise.all(
    requests.map(async (request, i) => {
      // A reference to a picture in this request waits for that picture to develop.
      const r = {
        ...request,
        references: request.references.map((ref) => keyed.get(ref) ?? ref),
      };
      const id = ids[i];
      const styled = await styleReferences(
        work,
        style,
        r.role,
        r.references,
        store.userId,
      );
      const prompt = promptFor(
        r,
        style.prompt,
        work.brief!.direction,
        styled.length,
      );
      const [width, height] = sizes[r.aspect];
      await library.reserve(
        {
          id,
          role: r.role,
          name: r.name,
          aliases: r.aliases,
          about: r.depicts,
          tags: [],
          category: "",
          style: style.id,
          width,
          height,
          origin: {
            kind: "generated",
            prompt,
            model,
            ...(r.references.length ? { references: r.references } : {}),
            ...(styled.length ? { styleReferences: styled } : {}),
          },
        },
        store.userId,
      );
      const transparent = r.role !== "scene" && r.role !== "texture";
      const development: Development = {
        id,
        name: r.name.zh,
        done: tracer
          .span(
            "generation",
            id,
            {
              prompt,
              size: `${width}x${height}`,
              model,
              references: r.references,
              styleReferences: styled,
            },
            async (span) => {
              const references = await Promise.all(
                [...r.references, ...styled].map((ref) =>
                  library.thumb(ref, store.viewer, 512),
                ),
              );
              if (references.length)
                span.set({
                  referenceImages: references.map(
                    (b) =>
                      "data:image/png;base64," +
                      Buffer.from(b).toString("base64"),
                  ),
                });
              const bytes = await paint(
                store,
                prompt,
                `${width}x${height}`,
                transparent,
                references,
              );
              const made = await library.develop(
                id,
                bytes,
                "image/png",
                store.userId,
              );
              span.set({
                bytes: bytes.length,
                url: made.kind === "picture" ? made.file.url : undefined,
              });
              return { status: "ready" as const };
            },
          )
          .catch(async (e) => {
            const error = e instanceof Error ? e.message : String(e);
            await library
              .fail(id, error.slice(0, 500), store.userId)
              .catch(() => {});
            return { status: "failed" as const, error };
          })
          .then((result) => {
            development.settled = { ...result, at: Date.now() };
            return result;
          }),
      };
      return development;
    }),
  );
}
