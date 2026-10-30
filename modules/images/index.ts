import { z } from "zod";
import { headers } from "../models/index.ts";
import type { UserStore } from "../storage/index.ts";
import { DomainError, type Work } from "../contracts/index.ts";
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
  /** Materials to work from: a picture to restyle, vary or keep consistent with. */
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

/** Everything the picture model is asked: the subject in the work's style, composed to be
 * placed on the canvas. */
function promptFor(
  r: z.infer<typeof pictureRequestSchema>,
  style: string,
  direction: string,
) {
  const framing = {
    object:
      "A single subject, centred, filling most of the frame with a small even margin; no ground, no frame.",
    figure:
      "One character, centred, filling most of the frame with a small even margin; no ground, no frame.",
    icon: "One simple symbol, centred, filling most of the frame.",
    scene:
      "A self-contained vignette: the scene fills the frame, but its edges dissolve softly into plain off-white paper; no border, no frame.",
    texture: "A seamless full-bleed surface with no focal subject.",
  }[r.role];
  // The medium comes first: picture models otherwise drift towards a realistic default.
  return `${style}\nSubject: ${r.depicts}\n${framing} Nothing else in the frame. No text, letters, numbers, arrows, labels or watermark.\nLook and mood only (adds nothing to the content): ${direction}`;
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
  let r = await attempt(transparent ? "transparent" : "opaque");
  // Not every picture model can leave the background clear.
  if (r.status === 400 && transparent) {
    const text = await r.text();
    if (!/background/i.test(text)) throw Error(`生图失败 400: ${text}`);
    r = await attempt("auto");
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
  return Promise.all(
    requests.map(async (r) => {
      const slug =
        r.name.en
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 28) || "picture";
      const id = `g-${slug}-${crypto.randomUUID().slice(0, 4)}`;
      const prompt = promptFor(r, style.prompt, work.brief!.direction);
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
            },
            async (span) => {
              const references = await Promise.all(
                r.references.map((ref) =>
                  library.thumb(ref, store.userId, 512),
                ),
              );
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
