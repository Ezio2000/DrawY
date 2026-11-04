import { z } from "zod";
import { headers } from "../models/index.ts";
import type { UserStore } from "../storage/index.ts";
import { DomainError, type Work, type ImageRole } from "../contracts/index.ts";
import type { Material, StyleMaterial } from "@drawy/materials/schema";
import { library, styleOf } from "../materials/index.ts";
import { MaterialsError } from "@drawy/materials/client";
import { tracer } from "../trace/index.ts";

/** A picture the author wants made. */
export const pictureRequestSchema = z.object({
  name: z.object({ zh: z.string().min(1), en: z.string().min(1) }),
  aliases: z.array(z.string()).default([]),
  role: z
    .enum(["object", "figure", "scene", "texture", "icon"])
    .describe(
      "How the picture will be used: object, figure and icon are cut-outs on transparency to place, move and label; scene is a vignette whose edges fade into paper; texture is a seamless surface",
    ),
  depicts: z
    .string()
    .min(1)
    .describe(
      "For a picture model that knows nothing about the work: the subject, its state, the view (side, from above, cut away), pose, gaze and what it holds or touches, and the materials and details that identify it; for a person or animal, how much of the body shows (\"full body, feet included\"), since the model crops otherwise. Not the style, which is added to every picture, and no words, which the picture cannot carry",
    ),
  aspect: z
    .enum(["square", "landscape", "portrait"])
    .default("square")
    .describe("The shape that fits the thing; size its module to it"),
  key: z
    .string()
    .optional()
    .describe("A name other pictures in the same request can refer to in their references, such as the first picture of a character the others must match"),
  references: z
    .array(z.string())
    .default([])
    .describe(
      "Pictures this one must be made from, to restyle, vary or keep one character consistent, since a description alone drifts between pictures: material ids, or keys of pictures in the same request, which this one then waits for. The work's pictures in its style are already sent as style references",
    ),
});
export type PictureRequest = z.input<typeof pictureRequestSchema>;
const sizes = {
  square: [1024, 1024],
  landscape: [1536, 1024],
  portrait: [1024, 1536],
} as const;

/** The token counts the Images API reports, input and output split by kind. */
type ImageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  output_tokens_details?: { text_tokens?: number; image_tokens?: number };
};
/** Two paintings' token counts as one. */
function added(a: ImageUsage | undefined, b: ImageUsage | undefined): ImageUsage | undefined {
  if (!a || !b) return a ?? b;
  const sum = (x?: number, y?: number) => (x ?? 0) + (y ?? 0);
  const details = (
    x?: { text_tokens?: number; image_tokens?: number },
    y?: { text_tokens?: number; image_tokens?: number },
  ) =>
    x || y
      ? {
          text_tokens: sum(x?.text_tokens, y?.text_tokens),
          image_tokens: sum(x?.image_tokens, y?.image_tokens),
        }
      : undefined;
  const input = details(a.input_tokens_details, b.input_tokens_details),
    output = details(a.output_tokens_details, b.output_tokens_details);
  return {
    input_tokens: sum(a.input_tokens, b.input_tokens),
    output_tokens: sum(a.output_tokens, b.output_tokens),
    ...(input ? { input_tokens_details: input } : {}),
    ...(output ? { output_tokens_details: output } : {}),
  };
}
/** A picture being made in the background. */
export interface Development {
  id: string;
  name: string;
  done: Promise<{
    status: "ready" | "failed";
    error?: string;
    /** Pictures returned by the model, including discarded opaque attempts, even if a
     * later retry fails. Each is billable by the picture. */
    count: number;
    /** The picture model's token counts, when it reports them (`imageTokensOf` splits
     * them as they are priced). */
    usage?: ImageUsage;
    /** A cut-out that came out with nothing clear around it, twice: it shows as a box. */
    opaque?: boolean;
  }>;
  settled?: { status: "ready" | "failed"; error?: string; opaque?: boolean; at: number };
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
      "A single subject, centred, filling most of the frame with a small even margin, isolated on a fully transparent background; no scenery, ground, cast shadow or frame.",
    figure:
      "One character, centred, filling most of the frame with a small even margin, isolated on a fully transparent background; no scenery, ground, cast shadow or frame.",
    icon: "One simple symbol, centred, filling most of the frame, on a fully transparent background; no scenery or frame.",
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
  return [
    style,
    `Subject: ${r.depicts}`,
    framing,
    `Look and mood only, adding nothing to the content: ${direction}`,
    ...shown,
    "Nothing else in the frame. No text, letters, numbers, arrows, labels, logos or watermark.",
  ].join("\n");
}

/** Calls the picture model and returns the bytes of one picture. */
async function paint(
  role: ImageRole,
  prompt: string,
  size: string,
  transparent: boolean,
  references: Uint8Array[],
) {
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
  const data = (await r.json()) as {
    data: { b64_json: string }[];
    usage?: ImageUsage;
  };
  return {
    bytes: Buffer.from(data.data[0].b64_json, "base64"),
    usage: data.usage,
  };
}

/** For each request, the requests in the same batch it works from. A circle of them could
 * never start, and a reference that is neither would fail after pictures were paid for, so
 * both are refused before anything is painted. */
async function dependencies(
  requests: { key?: string; references: string[] }[],
  ids: string[],
  viewer: Parameters<typeof library.get>[1],
) {
  const inBatch = new Map(
    requests.flatMap((r, i) => [
      [ids[i], i] as const,
      ...(r.key ? [[r.key, i] as const] : []),
    ]),
  );
  const outside = [
    ...new Set(requests.flatMap((r) => r.references.filter((ref) => !inBatch.has(ref)))),
  ];
  if (outside.length) {
    const found = new Set((await library.get(outside, viewer, true)).map((m) => m.id));
    const missing = outside.filter((id) => !found.has(id));
    if (missing.length) throw new DomainError(`参考图不存在: ${missing.join(", ")}`);
  }
  const needs = requests.map((r) =>
    r.references.flatMap((ref) => (inBatch.has(ref) ? [inBatch.get(ref)!] : [])),
  );
  const state = new Map<number, "open" | "closed">();
  const visit = (i: number) => {
    if (state.get(i) === "closed") return;
    if (state.get(i) === "open") throw new DomainError("图片之间的引用不能循环");
    state.set(i, "open");
    needs[i].forEach(visit);
    state.set(i, "closed");
  };
  needs.forEach((_, i) => visit(i));
  return needs;
}

/** Reserves every picture in the library at once, so the ids are usable, then develops each
 * in the background, in the work's style: a picture that works from another in the batch
 * starts when that one has developed, and the rest run side by side. */
export async function develop(
  store: UserStore,
  role: ImageRole,
  work: Work,
  input: PictureRequest[],
): Promise<Development[]> {
  if (!work.brief)
    throw new DomainError("请先用 set_brief 确定风格，再生成图片");
  const requests = input.map((r) => pictureRequestSchema.parse(r));
  const style = await styleOf(work.brief.style);
  const model = role.model;
  const ids = requests.map(
    (r) =>
      `g-${
        r.name.en
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          // Cut first: a cut that lands on a hyphen would leave "--" before the suffix.
          .slice(0, 28)
          .replace(/^-+|-+$/g, "") || "picture"
      }-${crypto.randomUUID().slice(0, 4)}`,
  );
  const keyed = new Map(
    requests.flatMap((r, i) => (r.key ? [[r.key, ids[i]] as const] : [])),
  );
  const needs = await dependencies(requests, ids, store.viewer);
  const reserved = await Promise.all(
    requests.map(async (request, i) => {
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
      return { r, id, prompt, styled, width, height };
    }),
  );
  const developments = new Map<number, Development>();
  const start = (i: number): Development => {
    const known = developments.get(i);
    if (known) return known;
    const { r, id, prompt, styled, width, height } = reserved[i];
    const transparent = r.role !== "scene" && r.role !== "texture";
    let count = 0;
    let usage: ImageUsage | undefined;
    const development: Development = {
      id,
      name: r.name.zh,
      done: Promise.all(needs[i].map((n) => start(n).done))
        .then((references) => {
          const failed = references.findIndex((d) => d.status !== "ready");
          if (failed >= 0) throw Error(`参考图 ${ids[needs[i][failed]]} 没有生成成功`);
          return tracer.span(
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
              const painting = async () => {
                const result = await paint(role, prompt, `${width}x${height}`, transparent, references);
                count++;
                usage = added(usage, result.usage);
                // Preserve the charge in the trace before validation or a retry can fail.
                span.set({ count, ...(usage ? { usage } : {}) });
                return result.bytes;
              };
              let bytes = await painting();
              // A cut-out that came out with a background around it is painted once more,
              // since a label cannot rescue a box; a second one is kept, and said to be one.
              let opaque = false;
              const keep = (cutOut: boolean) =>
                library.develop(id, bytes, "image/png", store.userId, cutOut);
              let made: Material;
              try {
                made = await keep(transparent);
              } catch (e) {
                if (!(transparent && e instanceof MaterialsError && e.status === 422)) throw e;
                tracer.note("opaque cut-out", { id }, "painted again");
                bytes = await painting();
                try {
                  made = await keep(true);
                } catch (e) {
                  if (!(e instanceof MaterialsError && e.status === 422)) throw e;
                  opaque = true;
                  made = await keep(false);
                }
              }
              span.set({
                bytes: bytes.length,
                url: made.kind === "picture" ? made.file.url : undefined,
                ...(opaque ? { opaque } : {}),
              });
              return {
                status: "ready" as const,
                ...(opaque ? { opaque } : {}),
              };
            },
          );
        })
        .catch(async (e) => {
          const error = e instanceof Error ? e.message : String(e);
          await library
            .fail(id, error.slice(0, 500), store.userId)
            .catch(() => {});
          return { status: "failed" as const, error };
        })
        .then((result) => {
          const billed = { ...result, count, ...(usage ? { usage } : {}) };
          development.settled = { ...billed, at: Date.now() };
          return billed;
        }),
    };
    developments.set(i, development);
    return development;
  };
  return reserved.map((_, i) => start(i));
}
