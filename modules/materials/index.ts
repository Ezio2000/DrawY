import { MaterialsClient } from "@drawy/materials/client";
import type {
  Material,
  Param,
  SearchRequest,
  SearchResult,
  StyleMaterial,
} from "@drawy/materials/schema";
import {
  DomainError,
  blankStyle,
  paramTypes,
  type Candidate,
  type MaterialUse,
  type ParamType,
  type Work,
} from "../contracts/index.ts";
import type { Item } from "../models/index.ts";
import { tracer } from "../trace/index.ts";

export const library = new MaterialsClient(
  process.env.DRAWY_MATERIALS_URL || "http://localhost:8090",
);
const round = (n: number) => Math.round(n * 1000) / 1000;
/** A library drawing's parameter as the author reads it: its type (a choice as its
 * options), default and description. */
export const paramLine = (p: Param) =>
  `${p.type === "choice" ? p.options!.join("|") : p.type}${p.default !== undefined ? " = " + JSON.stringify(p.default) : ""} (${p.description})`;
/** Parameter types a person can change by hand; the rest are structure. */
const editable = new Set<Param["type"]>(paramTypes);

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
        params: Object.fromEntries(
          Object.entries(m.params).flatMap(([k, p]) =>
            editable.has(p.type)
              ? [
                  [
                    k,
                    {
                      type: p.type as ParamType,
                      ...(p.options ? { options: p.options } : {}),
                      ...(p.min !== undefined ? { min: p.min } : {}),
                      ...(p.max !== undefined ? { max: p.max } : {}),
                      ...(p.step !== undefined ? { step: p.step } : {}),
                    },
                  ],
                ]
              : [],
          ),
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
const QUOTED = /["'`]([a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g;
function named(work: Work) {
  const called = new Set<string>(),
    mentioned = new Set<string>(),
    quoted = new Set<string>();
  for (const { source } of [
    ...Object.values(work.drawings),
    ...Object.values(work.interactions),
  ]) {
    for (const [, id] of source.matchAll(CALL)) called.add(id);
    for (const [, id] of source.matchAll(QUOTED)) quoted.add(id);
  }
  const scan = (v: unknown) => {
    if (typeof v === "string") {
      if (ID.test(v) && v.length < 64) mentioned.add(v);
    } else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  };
  for (const scene of Object.values(work.scenes))
    for (const x of [...scene.modules, ...scene.links]) {
      // A module or link may be drawn by a library drawing as it is; one that is in
      // neither is reported by the work's validation.
      if (!work.drawings[x.drawingId]) mentioned.add(x.drawingId);
      scan(x.data);
    }
  return { called, mentioned, quoted };
}

/** The materials a module is drawn with; none means it is drawn by hand. */
export function drawnWith(work: Work, sceneId: string, moduleId: string) {
  const m = work.scenes[sceneId]?.modules.find((x) => x.id === moduleId);
  if (!m) return [];
  const ids = new Set<string>([m.drawingId]);
  for (const [, id] of (work.drawings[m.drawingId]?.source ?? "").matchAll(
    CALL,
  ))
    ids.add(id);
  const scan = (v: unknown) => {
    if (typeof v === "string") ids.add(v);
    else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  };
  scan(m.data);
  return [...ids].filter((id) => work.materials[id]);
}

/** Brings the work's materials in line with what it names: takes in new ones, refreshes
 * pictures that were still developing and library code, and lets go of those no longer
 * named. Returns the ids newly taken. */
export async function take(work: Work, explicit: string[], user: string) {
  const { called, mentioned, quoted } = named(work);
  // A material nothing in the work names any more leaves it, such as a picture an edit
  // replaced; one named only in code (an interaction switching pictures) stays.
  for (const id of Object.keys(work.materials))
    if (![explicit, called, mentioned, quoted].some((s) => [...s].includes(id)))
      delete work.materials[id];
  const strict = [...new Set([...explicit, ...called])];
  // Library code (drawings and effects) is taken again each time the work is written, so
  // it is the version the author's catalog describes; a work left alone keeps rendering
  // with the version it was saved with.
  const refresh = Object.values(work.materials)
    .filter(
      (m) =>
        (m.kind === "picture" && m.status === "developing") ||
        m.kind === "drawing" ||
        m.kind === "effect",
    )
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
          Object.entries(m.params).map(([k, p]) => [k, paramLine(p)]),
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
        hits: r.hits.map((h) => ({
          id: h.material.id,
          name: h.material.name.zh,
          kind: h.material.kind,
          style: h.material.style,
          match: h.match,
          score: h.score,
          ...(h.material.kind === "picture"
            ? { url: `/materials/thumbs/${h.material.id}?size=128` }
            : {}),
        })),
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
  const found = ids.length ? await library.get(ids, user) : [];
  const parts = await Promise.all(
    found.map(async (m): Promise<Item[]> => {
      const note = {
        type: "input_text",
        text: `Attached ${m.kind} ${m.id}「${m.name.zh}」${
          m.kind === "picture"
            ? ": place it by this id like any library picture, or pass it to generate_images as a reference; when the user asks to copy it, redraw it instead"
            : m.kind === "style"
              ? ": the user wants the work in this style"
              : ": the user wants the work to use it"
        }`,
      };
      const shown =
        m.kind === "picture" ? m.id : m.kind === "style" ? m.samples[0] : null;
      if (!shown) return [note];
      const raster =
        m.kind === "picture" && m.file.mediaType !== "image/svg+xml";
      const bytes = raster
        ? await library.file(shown, user)
        : await library.thumb(shown, user, 512);
      return [
        note,
        {
          type: "input_image",
          image_url: `data:${raster ? m.file.mediaType : "image/png"};base64,${Buffer.from(bytes).toString("base64")}`,
        },
      ];
    }),
  );
  return parts.flat();
}
/** A drawing material drawn from its example data, as a work of one module. */
export async function preview(id: string, user: string): Promise<Work> {
  const [m] = await library.get([id], user);
  if (m.kind !== "drawing") throw new DomainError("只有画法素材有预览");
  const work: Work = {
    id: "preview-" + m.id,
    title: m.name.zh,
    rootSceneId: "root",
    drawings: {},
    scenes: {
      root: {
        id: "root",
        title: m.name.zh,
        parentId: null,
        modules: [
          {
            id: m.id,
            label: m.name.zh,
            bounds: { x: 0, y: 0, ...m.size },
            drawingId: m.id,
            group: null,
            target: null,
            anchors: {},
            data: m.example,
          },
        ],
        links: [],
        interactionId: null,
        checks: [],
      },
    },
    interactions: {},
    details: {},
    brief: null,
    materials: {},
    style: { ...blankStyle },
    revision: 0,
    updatedAt: m.origin.createdAt,
  };
  await take(work, [], user);
  return work;
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
