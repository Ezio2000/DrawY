import { MaterialsClient } from "@drawy/materials/client";
import type {
  Material,
  SearchRequest,
  SearchResult,
  StyleMaterial,
} from "@drawy/materials/schema";
import {
  DomainError,
  type Candidate,
  type MaterialUse,
  type Work,
} from "../contracts/index.ts";
import type { Item } from "../models/index.ts";
import { tracer } from "../trace/index.ts";

export const library = new MaterialsClient(
  process.env.DRAWY_MATERIALS_URL || "http://localhost:8090",
);
const round = (n: number) => Math.round(n * 1000) / 1000;

/** How a work holds a library material; styles are applied, not held. */
export function useOf(m: Material): MaterialUse | null {
  switch (m.kind) {
    case "picture": {
      const c = m.form.content;
      return {
        id: m.id,
        kind: "picture",
        name: m.name.zh,
        role: m.role,
        style: m.style,
        url: m.file.url,
        width: Math.round(m.form.width * c.width),
        height: Math.round(m.form.height * c.height),
        content: c,
        anchors: Object.fromEntries(
          Object.entries(m.form.anchors).map(([k, a]) => [
            k,
            {
              x: round(Math.min(1, Math.max(0, (a.x - c.x) / c.width))),
              y: round(Math.min(1, Math.max(0, (a.y - c.y) / c.height))),
            },
          ]),
        ),
        recolor: m.form.recolor,
        opaque: m.form.background === "opaque",
        status: m.status,
      };
    }
    case "drawing":
      return {
        id: m.id,
        kind: "drawing",
        name: m.name.zh,
        source: m.source,
        defaults: Object.fromEntries(
          Object.entries(m.params)
            .filter(([, p]) => p.default !== undefined)
            .map(([k, p]) => [k, p.default]),
        ),
      };
    case "effect":
      return { id: m.id, kind: "effect", name: m.name.zh, defs: m.defs };
    case "style":
      return null;
  }
}

const CALL = /api\.(?:material|draw|effect)\(\s*["'`]([a-z0-9-]+)["'`]/g;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Ids the work's code calls literally, and id-like strings in its module data. */
function named(work: Work) {
  const called = new Set<string>(),
    mentioned = new Set<string>();
  for (const { source } of [
    ...Object.values(work.drawings),
    ...Object.values(work.interactions),
  ])
    for (const [, id] of source.matchAll(CALL)) called.add(id);
  const scan = (v: unknown) => {
    if (typeof v === "string") {
      if (ID.test(v) && v.length < 64) mentioned.add(v);
    } else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  };
  for (const scene of Object.values(work.scenes))
    for (const x of [...scene.modules, ...scene.links]) scan(x.data);
  return { called, mentioned };
}

/** Takes into the work every material it names, refreshing pictures that were still
 * developing. Returns the ids newly taken. */
export async function take(work: Work, explicit: string[], user: string) {
  const { called, mentioned } = named(work);
  const strict = [...new Set([...explicit, ...called])];
  const refresh = Object.values(work.materials)
    .filter((m) => m.kind === "picture" && m.status === "developing")
    .map((m) => m.id);
  const lenient = [...new Set([...mentioned, ...refresh])].filter(
    (id) =>
      !strict.includes(id) && (!work.materials[id] || refresh.includes(id)),
  );
  const missing = strict.filter(
    (id) => !work.materials[id] || refresh.includes(id),
  );
  let found: Material[] = [];
  try {
    found = [
      ...(missing.length ? await library.get(missing, user) : []),
      ...(lenient.length ? await library.get(lenient, user, true) : []),
    ];
  } catch (e) {
    throw new DomainError(
      `${e instanceof Error ? e.message : e}。素材 ID 需来自 find_materials、set_brief 或 generate_images 的结果`,
    );
  }
  const added: string[] = [];
  for (const m of found) {
    const use = useOf(m);
    if (!use) continue;
    if (!work.materials[m.id]) added.push(m.id);
    work.materials[m.id] = use;
  }
  return added;
}
/** Records that a work now uses these materials. */
export function used(ids: string[], workId: string, user: string) {
  if (ids.length) void library.use(ids, workId, user).catch(() => {});
}

let styles: { at: number; list: Promise<StyleMaterial[]> } | undefined;
/** The library's styles, refreshed every minute. */
export function styleList() {
  if (!styles || Date.now() - styles.at > 60_000)
    styles = { at: Date.now(), list: library.styles() };
  styles.list.catch(() => (styles = undefined));
  return styles.list;
}
export async function styleOf(id: string) {
  const style = (await styleList()).find((s) => s.id === id);
  if (!style)
    throw new DomainError(
      `未知风格 ${id}，可用：${(await styleList()).map((s) => s.id).join(", ")}`,
    );
  return style;
}

/** A material as the author reads it in a search result. */
function brief(m: Material, match?: string) {
  const name = `${m.name.zh} / ${m.name.en}`;
  switch (m.kind) {
    case "picture":
      return {
        id: m.id,
        kind: `picture/${m.role}`,
        name,
        style: m.style,
        ...(match ? { match } : {}),
        size: `${Math.round(m.form.width * m.form.content.width)}×${Math.round(m.form.height * m.form.content.height)}`,
        ...(Object.keys(m.form.anchors).length
          ? { anchors: Object.keys(m.form.anchors) }
          : {}),
        ...(m.form.recolor ? { recolor: true } : {}),
        ...(m.status !== "ready" ? { status: m.status } : {}),
        about: m.about,
      };
    case "drawing":
      return {
        id: m.id,
        kind: "drawing",
        name,
        ...(match ? { match } : {}),
        use: m.use,
        about: m.about,
        params: Object.fromEntries(
          Object.entries(m.params).map(([k, p]) => [
            k,
            `${p.type}${p.default !== undefined ? " = " + JSON.stringify(p.default) : ""}; ${p.description}`,
          ]),
        ),
      };
    case "effect":
      return { id: m.id, kind: "effect", name, apply: m.apply, about: m.about };
    case "style":
      return {
        id: m.id,
        kind: "style",
        name,
        register: m.register,
        about: m.about,
      };
  }
}
export const candidate = (m: Material): Candidate => ({
  id: m.id,
  kind: m.kind,
  name: m.name.zh,
  ...(m.kind === "picture"
    ? { url: m.file.url }
    : m.kind === "style" && m.samples[0]
      ? { url: `/materials/files/${m.samples[0]}` }
      : {}),
});
/** Thumbnails the author can look at, each preceded by its id. */
export async function look(ids: string[], user: string, size = 256) {
  const images = await Promise.all(
    ids.map(async (id) => {
      try {
        const png = await library.thumb(id, user, size);
        return [
          { type: "input_text", text: `[${id}]` },
          {
            type: "input_image",
            image_url:
              "data:image/png;base64," + Buffer.from(png).toString("base64"),
            detail: "low",
          },
        ];
      } catch {
        return [];
      }
    }),
  );
  return images.flat() as Item[];
}
/** Searches the library and shows the author what it found: descriptions, and the best
 * pictures for each subject as thumbnails. */
export async function find(request: SearchRequest, user: string) {
  return tracer.span("search", "materials", { ...request }, async (span) => {
    const results: SearchResult[] = await library.search(request, user);
    span.set({
      results: results.map((r) => ({
        subject: r.subject,
        hits: r.hits.map((h) => `${h.material.id} ${h.match} ${h.score}`),
      })),
    });
    const shown = results
      .flatMap((r) =>
        r.hits
          .filter((h) => h.material.kind === "picture" && h.match !== "related")
          .slice(0, 3)
          .map((h) => h.material.id),
      )
      .filter((id, i, all) => all.indexOf(id) === i)
      .slice(0, 12);
    return {
      output: results.map((r) => ({
        subject: r.subject,
        hits: r.hits.map((h) => brief(h.material, h.match)),
        ...(r.hits.some((h) => h.match !== "related")
          ? {}
          : {
              note: "No direct match: generate this picture, or search a synonym.",
            }),
      })),
      images: await look(shown, user),
      // A partial match is not a picture of the thing; only direct ones are shown.
      found: results.map((r) => ({
        subject: r.subject,
        candidates: r.hits
          .filter((h) => h.match !== "related")
          .map((h) => candidate(h.material)),
      })),
    };
  });
}
/** Pictures a user attached to a message, as the author sees them. */
export async function attached(ids: string[], user: string): Promise<Item[]> {
  return Promise.all(
    ids.map(async (id) => {
      const [m] = await library.get([id], user);
      const raster =
        m.kind === "picture" && m.file.mediaType !== "image/svg+xml";
      const bytes = raster
        ? await library.file(id, user)
        : await library.thumb(id, user, 512);
      return {
        type: "input_image",
        image_url: `data:${raster ? (m as { file: { mediaType: string } }).file.mediaType : "image/png"};base64,${Buffer.from(bytes).toString("base64")}`,
      };
    }),
  );
}
/** Adds a user's picture to their library. */
export function upload(
  bytes: Uint8Array,
  mediaType: string,
  filename: string,
  user: string,
) {
  const name = filename.replace(/\.[a-z0-9]+$/i, "") || "图片";
  return library.ingest(
    bytes,
    mediaType,
    {
      role: "object",
      name: { zh: name, en: name },
      style: null,
      origin: { kind: "upload" },
    },
    user,
  );
}
/** The catalogue of drawing code and effects, for the author's instructions. */
export async function kit() {
  return (await library.browse("", 1, undefined, ["drawing", "effect"])).items;
}

/** The work with pictures that were developing when it was saved brought up to date, so it
 * draws them with their measured content. */
export async function freshen(work: Work, user: string): Promise<Work> {
  const stale = Object.values(work.materials)
    .filter((m) => m.kind === "picture" && m.status === "developing")
    .map((m) => m.id);
  if (!stale.length) return work;
  const found = await library.get(stale, user, true).catch(() => []);
  const materials = { ...work.materials };
  for (const m of found) {
    const use = useOf(m);
    if (use) materials[m.id] = use;
  }
  return { ...work, materials };
}
