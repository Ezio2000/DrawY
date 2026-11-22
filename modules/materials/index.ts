import { MaterialsClient, MaterialsError } from "@drawy/materials/client";
import type {
  Bindings,
  Material,
  MaterialHead,
  Param,
  SearchRequest,
  SearchResult,
  StyleMaterial,
  Viewer,
} from "@drawy/materials/schema";
import {
  DomainError,
  blankStyle,
  calledIn,
  materialsOfPart,
  paramTypes,
  type Candidate,
  type MaterialUse,
  type ParamType,
  type Work,
} from "../contracts/index.ts";
import type { Item } from "../models/index.ts";
import { setBindings } from "../editing/bindings.ts";
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
        version: m.version,
        name: m.name.zh,
        type: m.type,
        style: m.style,
        // A pack's picture is addressed at its version, so a later pack's pixels under the
        // same id do not reach a work that took this one.
        url: m.pack ? `${m.file.url}?v=${m.version}` : m.file.url,
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
        // A withdrawn picture is no longer offered, but draws as it did.
        status: m.status === "withdrawn" ? "ready" : m.status,
      };
    }
    case "drawing":
      return {
        id: m.id,
        kind: "drawing",
        version: m.version,
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
      return { id: m.id, kind: "effect", version: m.version, name: m.name.zh, defs: m.defs };
    case "style":
      return null;
  }
}

// "--" is allowed: pictures generated before the slug was cut first carry it.
const ID = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/;
/** Ids the work's code calls literally, and id-like strings in its module data. */
const QUOTED = /["'`]([a-z0-9]+(?:-+[a-z0-9]+)*)["'`]/g;
function named(work: Work) {
  const called = new Set<string>(),
    drawings = new Set<string>(),
    mentioned = new Set<string>(),
    quoted = new Set<string>();
  for (const source of [
    ...Object.values(work.drawings).map((d) => d.source),
    ...Object.values(work.scenes).flatMap((s) => s.interaction ?? []),
  ]) {
    for (const id of calledIn(source)) called.add(id);
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
      if (!work.drawings[x.drawingId]) drawings.add(x.drawingId);
      scan(x.data);
    }
  for (const d of Object.values(work.drawings)) scan(d.defaults);
  return { called, drawings, mentioned, quoted };
}

/** The materials a module is drawn with; none means it is drawn by hand. */
export function drawnWith(work: Work, sceneId: string, moduleId: string) {
  const m = work.scenes[sceneId]?.modules.find((x) => x.id === moduleId);
  return m ? materialsOfPart(work, m) : [];
}

/** Brings the work's materials in line with what it names: takes in new ones, refreshes
 * pictures that were still developing and library code, and lets go of those no longer
 * named. Returns the ids newly taken and those that its code or the edit names but the
 * library does not have. `keep` leaves in place what nothing names yet, for a drawing copied
 * from the library in the same write. */
export async function take(work: Work, explicit: string[], user: Viewer, keep = false) {
  const { called, drawings, mentioned, quoted } = named(work);
  const drawingIds = new Set([...explicit, ...called, ...drawings]);
  // A material nothing in the work names any more leaves it, such as a picture an edit
  // replaced; one named only in code (an interaction switching pictures) stays.
  if (!keep)
    for (const [id, m] of Object.entries(work.materials)) {
      const kept =
        m.kind === "drawing"
          ? drawingIds.has(id) || quoted.has(id)
          : [explicit, called, mentioned, quoted].some((s) => [...s].includes(id));
      if (!kept) delete work.materials[id];
    }
  const strict = [...new Set([...explicit, ...called])];
  // A work keeps the version of each material it took: an update to the library reaches it
  // only when it is taken again on purpose. Only pictures still developing are fetched
  // again, for their finished form.
  const refresh = Object.values(work.materials)
    .filter((m) => m.kind === "picture" && m.status === "developing")
    .map((m) => m.id);
  const wanted = [...new Set([...strict, ...drawings, ...mentioned, ...refresh])].filter(
    (id) => !work.materials[id] || refresh.includes(id),
  );
  const found = wanted.length ? await library.get(wanted, user, true) : [];
  const added: string[] = [];
  for (const m of found) {
    // Module data values like { glyph: "gauge" } can collide with a library drawing id;
    // only a module/link drawingId, literal code call, explicit reference, or an already-held
    // drawing kept via code quotes takes a library drawing.
    if (m.kind === "drawing" && !drawingIds.has(m.id) && !work.materials[m.id]) continue;
    const use = useOf(m);
    if (!use) continue;
    if (!work.materials[m.id]) added.push(m.id);
    work.materials[m.id] = use;
  }
  const missing = strict.filter((id) => !found.some((m) => m.id === id) && !work.materials[id]);
  return { added, missing };
}
/** Records that a work now uses these materials. */
export function used(ids: string[], workId: string, user: string) {
  if (ids.length) void library.use(ids, workId, user).catch(() => {});
}

/** Styles read recently, by id: a few at a time, however many the library has. */
const styles = new Map<string, { at: number; style: Promise<StyleMaterial> }>();
/** A style by id, fresh within a minute. An unknown id is reported as such; the library's
 * styles are never listed in its place. */
export function styleOf(id: string): Promise<StyleMaterial> {
  const known = styles.get(id);
  if (known && Date.now() - known.at < 60_000) return known.style;
  const style = library.get([id]).then(([m]) => {
    // A withdrawn style is still read for works that hold it, but not taken for new ones.
    if (m?.kind !== "style" || m.status === "withdrawn")
      throw new DomainError(`未知风格 ${id}：用 find_materials 搜索 types ["style"]`);
    return m;
  }, (e) => {
    throw e instanceof MaterialsError && e.status === 404
      ? new DomainError(`未知风格 ${id}：用 find_materials 搜索 types ["style"]`)
      : e;
  });
  styles.set(id, { at: Date.now(), style });
  style.catch(() => styles.delete(id));
  // Kept bounded: the oldest goes first.
  if (styles.size > 64) styles.delete(styles.keys().next().value!);
  return style;
}
/** The style a brief names: its id, or the library style closest to a few words describing
 * the look, with the next closest named so the author can choose another. Words that match
 * no style as a whole are weighed one by one, and failing that the first style of the
 * register on the library's first page is taken: a brief is never refused for how it
 * describes a look. */
export async function resolveStyle(wanted: string, user: Viewer, register?: "formal" | "expressive") {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(wanted)) {
    const style = await styleOf(wanted).catch(() => undefined);
    if (style) return { style, chosen: false, others: [] as string[] };
  }
  // However long the description, what is searched is bounded.
  const text = wanted.slice(0, 200);
  const words = text.split(/[\s,，、/;；]+/).filter(Boolean).slice(0, 11);
  const results = await library.search(
    { subjects: [text, ...(words.length > 1 ? words : [])], types: ["style"], limit: 3 },
    user,
  );
  const score = new Map<string, number>();
  results.forEach((r, i) =>
    r.hits.forEach((h) => score.set(h.material.id, (score.get(h.material.id) ?? 0) + h.score * (i === 0 ? 3 : 1))),
  );
  let ranked = [...score].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (!ranked.length) {
    const page = await library.browse("", 1, user, ["style"], 24);
    const fits = page.items.filter(
      (m) => m.kind === "style" && (!register || m.register === register || m.register === "any"),
    );
    ranked = (fits.length ? fits : page.items).map((m) => m.id);
  }
  if (!ranked.length) throw new DomainError("素材库里还没有风格");
  return { style: await styleOf(ranked[0]), chosen: true, others: ranked.slice(1, 3) };
}
let bound: { at: number; bindings: Promise<Bindings> } | undefined;
/** Which library drawing the app's own editing uses for text, pictures and links, as the
 * library's material packs name them. */
export function bindings() {
  if (!bound || Date.now() - bound.at > 60_000)
    bound = { at: Date.now(), bindings: library.bindings().then((b) => (setBindings(b), b)) };
  bound.bindings.catch(() => (bound = undefined));
  return bound.bindings;
}

/** How much of one description a search result carries: enough to judge a hit by. The
 * rest is on the material's card. */
const ABOUT = 180;
const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1).trimEnd() + "…" : text);
/** A material as the author reads it in a search result: what it is and whether it fits,
 * never its code or long instructions, so a result costs the same whatever it found. */
function brief(m: MaterialHead, match?: string) {
  const base = {
    id: m.id,
    type: m.type,
    name: `${m.name.zh} / ${m.name.en}`,
    ...(match ? { match } : {}),
  };
  switch (m.kind) {
    case "picture":
      return {
        ...base,
        style: m.style,
        size: `${Math.round(m.form.width * m.form.content.width)}×${Math.round(m.form.height * m.form.content.height)}`,
        ...(Object.keys(m.form.anchors).length ? { anchors: Object.keys(m.form.anchors).slice(0, 8) } : {}),
        ...(m.form.recolor ? { recolor: true } : {}),
        ...(m.status !== "ready" ? { status: m.status } : {}),
        about: clip(m.about, ABOUT),
      };
    case "drawing":
      return { ...base, use: m.use, about: clip(m.about, ABOUT) };
    case "effect":
      return { ...base, apply: m.apply, about: clip(m.about, ABOUT) };
    case "style":
      return { ...base, register: m.register, about: clip(m.about, ABOUT) };
  }
}
/** The most one read_materials answer carries, in characters; what does not fit is named
 * to be read in another call. */
export const CARD_BUDGET = 14_000;
/** A material's card: all the author needs to use it, read on demand. */
export function card(m: Material): Record<string, unknown> {
  const base = { id: m.id, version: m.version, type: m.type, name: `${m.name.zh} / ${m.name.en}`, about: m.about };
  switch (m.kind) {
    case "drawing":
      return {
        ...base,
        use: m.use,
        params: Object.fromEntries(Object.entries(m.params).map(([k, p]) => [k, paramLine(p)])),
        size: `${m.size.width}×${m.size.height}`,
        example: m.example,
      };
    case "picture": {
      const c = m.form.content;
      return {
        ...base,
        style: m.style,
        size: `${Math.round(m.form.width * c.width)}×${Math.round(m.form.height * c.height)}`,
        ...(m.form.view ? { view: m.form.view } : {}),
        ...(m.form.facing ? { facing: m.form.facing } : {}),
        ...(Object.keys(m.form.anchors).length
          ? {
              anchors: Object.fromEntries(
                Object.entries(m.form.anchors).map(([k, a]) => [
                  k,
                  [round(Math.min(1, Math.max(0, (a.x - c.x) / c.width))), round(Math.min(1, Math.max(0, (a.y - c.y) / c.height)))],
                ]),
              ),
            }
          : {}),
        ...(m.form.recolor ? { recolor: true } : {}),
        background: m.form.background,
        ...(m.status !== "ready" ? { status: m.status } : {}),
      };
    }
    case "effect":
      return { ...base, apply: m.apply, use: `api.effect("${m.id}")` };
    case "style":
      return {
        ...base,
        register: m.register,
        tokens: m.tokens,
        guide: m.guide,
        effects: m.effects,
        samples: m.samples,
      };
  }
}
export const candidate = (m: MaterialHead): Candidate => ({
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
export async function look(ids: string[], user: Viewer, size = 256) {
  const images = await Promise.all(
    ids.map(async (id) => {
      try {
        const thumb = await library.thumb(id, user, size);
        return [
          { type: "input_text", text: `[${id}]` },
          {
            type: "input_image",
            image_url:
              "data:image/webp;base64," + Buffer.from(thumb).toString("base64"),
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
/** The most a search shows the author, whatever the library holds: hits in all, and
 * pictures looked at. */
export const FIND_LIMITS = { hits: 24, images: 6 } as const;
/** Searches the library and shows the author what it found: short descriptions, and the
 * best pictures as thumbnails. */
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
          type: h.material.type,
          style: h.material.style,
          match: h.match,
          score: h.score,
          ...(h.material.kind === "picture"
            ? { url: `/materials/thumbs/${h.material.id}?size=128` }
            : {}),
        })),
        ...(r.unknown.length ? { unknown: r.unknown } : {}),
      })),
    });
    // However many subjects were asked, a bounded number of hits is returned: each subject
    // keeps its best, the rest share what is left.
    let left = FIND_LIMITS.hits;
    const per = Math.max(1, Math.floor(FIND_LIMITS.hits / Math.max(1, results.length)));
    const kept = results.map((r) => {
      const hits = r.hits.slice(0, Math.min(per, left));
      left -= hits.length;
      return { ...r, hits };
    });
    const shown = kept
      .flatMap((r) =>
        r.hits
          .filter((h) => h.material.kind === "picture" && h.match !== "related")
          .slice(0, 2)
          .map((h) => h.material.id),
      )
      .filter((id, i, all) => all.indexOf(id) === i)
      .slice(0, FIND_LIMITS.images);
    return {
      output: kept.map((r) => ({
        subject: r.subject,
        hits: r.hits.map((h) => brief(h.material, h.match)),
        ...(r.hits.some((h) => h.match !== "related")
          ? {}
          : {
              note: r.unknown.length
                ? `Nothing here is ${r.unknown.join(" ")}: generate this picture, or search other words.`
                : "No direct match: generate this picture, or search a synonym.",
            }),
      })),
      images: await look(shown, user),
      // A partial match is not a picture of the thing; only direct ones are shown.
      found: kept.map((r) => ({
        subject: r.subject,
        candidates: r.hits
          .filter((h) => h.match !== "related")
          .map((h) => candidate(h.material)),
      })),
    };
  });
}
/** Pictures a user attached to a message, as the author sees them. */
export async function attached(ids: string[], user: Viewer): Promise<Item[]> {
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
          image_url: `data:${raster ? m.file.mediaType : "image/webp"};base64,${Buffer.from(bytes).toString("base64")}`,
        },
      ];
    }),
  );
  return parts.flat();
}
/** A drawing material drawn from its example data, as a work of one module. */
export async function preview(id: string, user: Viewer): Promise<Work> {
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
            data: m.example,
          },
        ],
        links: [],
        checks: [],
      },
    },
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
      type: "object",
      name: { zh: name, en: name },
      style: null,
      origin: { kind: "upload" },
    },
    user,
  );
}
/** The work with pictures that were developing when it was saved brought up to date, so it
 * draws them with their measured content. */
export async function freshen(work: Work, user: Viewer): Promise<Work> {
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
