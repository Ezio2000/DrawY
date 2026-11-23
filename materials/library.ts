import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Catalog } from "./catalog.ts";
import { measure, recolor, thumbnail } from "./media.ts";
import {
  capabilities,
  describeSchema,
  pictureTypes,
  reserveSchema,
  searchSchema,
  type Bindings,
  type Describe,
  type Material,
  type MaterialHead,
  type MaterialKind,
  type MaterialPage,
  type MaterialRef,
  type PictureMaterial,
  type Reserve,
  type SearchRequest,
  type SearchResult,
  type Shelf,
  type StyleMaterial,
  type Viewer,
  viewerOf,
} from "./schema.ts";

export class LibraryError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 410 | 422 | 504 = 400,
  ) {
    super(message);
  }
}
export const extensions: Record<string, string> = {
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};
const PAGE = 48;
/** How many pictures a style shows of itself, however many it has. */
const SAMPLES = 4;
/** How long a reserved picture may take to develop before it is given up. */
const DEVELOP_MS = 15 * 60 * 1000;
/** A digest of a material's content: what it is, not how it stands. */
export function digest(m: Omit<Material, "hash" | "version" | "owner" | "status" | "uses"> & Partial<Material>) {
  const { hash: _h, version: _v, owner: _o, status: _s, uses: _u, error: _e, ...content } = m as Material;
  if (content.kind === "style") {
    const { count: _c, ...style } = content as StyleMaterial;
    return sha(JSON.stringify(style));
  }
  return sha(JSON.stringify(content));
}
const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex").slice(0, 32);
export const blobHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The material library: pictures, drawing code, effects and styles of any number of types,
 * what each is for and who may use it. Its records and index are kept in `dir`; material
 * packs are imported into it (see pack.ts), never read at start, so starting does not
 * depend on how much the library holds. */
export class Library {
  readonly catalog: Catalog;
  /** Where street tiles fetched from OpenStreetMap are kept. */
  readonly streetsDir: string;
  private waiters = new Map<string, Set<() => void>>();
  constructor(readonly dir: string) {
    this.streetsDir = join(dir, "streets");
    for (const d of ["files", "thumbs", "blobs"]) mkdirSync(join(dir, d), { recursive: true });
    this.catalog = new Catalog(join(dir, "materials.sqlite"));
    // Pictures whose making was cut off by a restart are given up, as they will not arrive.
    const stale = this.catalog
      .sql("SELECT id FROM materials WHERE status='developing' AND created < ?")
      .all(Date.now() - DEVELOP_MS) as { id: string }[];
    for (const { id } of stale) this.catalog.stand(id, { status: "failed", error: "生成被中断" });
  }
  close() {
    this.catalog.close();
  }
  get size() {
    return this.catalog.size;
  }

  // —— files kept by content ——
  blobPath(hash: string) {
    return join(this.dir, "blobs", hash.slice(0, 2), hash);
  }
  /** Keeps bytes under their digest, once however many materials or releases name them. */
  keepBlob(bytes: Uint8Array, media: string) {
    const hash = blobHash(bytes);
    const path = this.blobPath(hash);
    if (!existsSync(path)) {
      mkdirSync(join(this.dir, "blobs", hash.slice(0, 2)), { recursive: true });
      writeFileSync(path, bytes);
    }
    this.catalog.sql("INSERT OR IGNORE INTO blobs VALUES(?,?,?)").run(hash, media, bytes.length);
    return hash;
  }
  /** A named piece of data a drawing reads, such as a geographic layer, with a tag of its
   * content so an unchanged one is only revalidated. */
  data(name: string) {
    const r = this.catalog.sql("SELECT blob, media FROM data WHERE name=?").get(name) as
      | { blob: string; media: string }
      | undefined;
    if (!r) throw new LibraryError("没有这份数据: " + name, 404);
    return { bytes: readFileSync(this.blobPath(r.blob)), media: r.media, etag: `"${r.blob.slice(0, 27)}"` };
  }

  // —— reading ——
  /** A material as the viewer may see it, at a version it had or the current one. */
  get(id: string, user?: Viewer, version?: number): Material {
    const v = viewerOf(user);
    const head = this.catalog.head(id);
    if (!head || !this.catalog.visible(head, { user: v?.id, all: v?.all }))
      throw new LibraryError(`素材不存在: ${id}`, 404);
    const m = this.catalog.full(id, version);
    if (!m) throw new LibraryError(`素材 ${id} 没有版本 ${version}`, 404);
    return m.kind === "style" ? this.shown(m) : m;
  }
  /** Several materials at once; leniently, the ones that exist. */
  many(refs: (string | MaterialRef)[], user?: Viewer, lenient = false) {
    return refs.flatMap((ref) => {
      const { id, version } = typeof ref === "string" ? { id: ref, version: undefined } : ref;
      try {
        return [this.get(id, user, version)];
      } catch (e) {
        if (lenient && e instanceof LibraryError) return [];
        throw e;
      }
    });
  }
  /** A style with the public pictures that show it best: its own showcase first, then the
   * most used, a few only. Private pictures are never shown to others. */
  private shown<S extends Pick<StyleMaterial, "id" | "samples" | "count">>(s: S): S {
    const showcase = s.samples.filter((id) => {
      const p = this.catalog.head(id);
      return p?.kind === "picture" && p.owner === null && p.status === "ready" && p.style === s.id;
    });
    const used = this.catalog.styleSamples(s.id, SAMPLES + showcase.length).filter((id) => !showcase.includes(id));
    return { ...s, samples: [...showcase, ...used].slice(0, SAMPLES), count: this.catalog.styleCount(s.id) };
  }
  /** A style by id. An unknown one is reported as such, never with the list of all. */
  style(id: string): StyleMaterial {
    const head = this.catalog.head(id);
    if (!head || head.kind !== "style" || head.status === "withdrawn")
      throw new LibraryError(`未知风格 ${id}：用 kinds ["style"] 搜索风格`, 404);
    return this.get(id) as StyleMaterial;
  }
  search(input: SearchRequest, user?: Viewer): SearchResult[] {
    const req = searchSchema.parse(input),
      v = viewerOf(user);
    return req.subjects.map((subject) => {
      const { hits, unknown } = this.catalog.search(
        subject,
        { user: v?.id, all: v?.all, style: req.style, types: req.types, kinds: req.kinds },
        req.limit,
      );
      return {
        subject,
        hits: hits.map((h) => (h.material.kind === "style" ? { ...h, material: this.shown(h.material) } : h)),
        unknown,
      };
    });
  }
  browse(
    query: string,
    page: number,
    viewer?: Viewer,
    kinds?: MaterialKind[],
    /** How many to a page: as many as the shelf showing them holds. */
    size = PAGE,
    /** One shelf only; without one, everything the viewer may see. */
    shelf?: Shelf,
    types?: string[],
  ): MaterialPage {
    size = Math.min(Math.max(1, Math.floor(size) || PAGE), 200);
    page = Math.max(1, Math.floor(page) || 1);
    const v = viewerOf(viewer);
    if (shelf === "others" && !v?.all) throw new LibraryError("没有查看其他用户素材的权限");
    const scope = { user: v?.id, all: v?.all, kinds, types, shelf };
    let { items, total } = this.catalog.browse(query, scope, page, size);
    const pages = Math.max(1, Math.ceil(total / size));
    // Past the end, the last page, as a pager that held more pages before expects.
    if (page > pages && total) {
      page = pages;
      items = this.catalog.browse(query, scope, page, size).items;
    }
    return {
      items: items.map((m) => (m.kind === "style" ? this.shown(m) : m)),
      total,
      page,
      pages,
    };
  }
  /** The material types the library holds, from its packs. */
  types() {
    return this.catalog.types();
  }
  /** Which drawing the app's own editing uses for each thing it adds by hand. */
  bindings(): Bindings {
    const rows = this.catalog.sql("SELECT capability, material FROM bindings").all() as {
      capability: string;
      material: string;
    }[];
    const out = Object.fromEntries(rows.map((r) => [r.capability, r.material])) as Partial<Bindings>;
    for (const c of capabilities) if (!out[c]) throw new LibraryError(`素材库没有为 ${c} 指定画法`, 404);
    return out as Bindings;
  }

  // —— pictures users make ——
  private picture(id: string, user?: Viewer) {
    const m = this.get(id, user);
    if (m.kind !== "picture") throw new LibraryError(`${id} 不是图片素材`);
    return m;
  }
  private save<T extends Material>(m: T): T {
    const next = { ...m, hash: digest(m) };
    this.catalog.put(next);
    return next;
  }
  private checkStyle(style: string | null) {
    if (style) this.style(style);
  }
  private checkType(type: string) {
    const known = this.catalog.type(type);
    if (known ? known.kind !== "picture" : !(pictureTypes as readonly string[]).includes(type))
      throw new LibraryError(`未知图片类型 ${type}`);
  }
  private record(
    id: string,
    d: ReturnType<typeof describeSchema.parse>,
    user: string,
    size: { width: number; height: number },
  ): PictureMaterial {
    // What a user uploads or generates is theirs alone; it becomes public only when
    // someone who manages materials publishes it.
    return {
      id,
      version: 1,
      hash: "",
      kind: "picture",
      type: d.type,
      name: d.name,
      aliases: d.aliases,
      category: d.category,
      about: d.about,
      tags: d.tags,
      style: d.style,
      form: {
        ...size,
        background: d.type === "scene" || d.type === "texture" ? "opaque" : "transparent",
        content: { x: 0, y: 0, width: 1, height: 1 },
        ...(d.view ? { view: d.view } : {}),
        ...(d.facing ? { facing: d.facing } : {}),
        anchors: d.anchors,
        palette: [],
        recolor: false,
      },
      file: { url: `/materials/files/${id}`, mediaType: "image/webp", bytes: 0 },
      origin: { ...d.origin, user, createdAt: Date.now() },
      owner: user,
      status: "developing",
      uses: 0,
      pack: null,
    };
  }
  /** Holds a place for a picture that is being generated, so a work can use it at once. */
  reserve(input: Reserve, user: string) {
    const r = reserveSchema.parse(input);
    this.checkStyle(r.style);
    this.checkType(r.type);
    if (this.catalog.head(r.id)) throw new LibraryError("素材 ID 已存在", 409);
    return this.save(this.record(r.id, r, user, { width: r.width, height: r.height }));
  }
  /** The finished pixels of a reserved picture. */
  async develop(
    id: string,
    bytes: Uint8Array,
    mediaType: string,
    user: string,
    /** A cut-out: refused, and left developing, when nothing in it is clear. */
    transparent = false,
  ) {
    const m = this.picture(id, user);
    if (m.status !== "developing") throw new LibraryError("素材不在生成中", 409);
    const measured = await measure(bytes, mediaType);
    if (transparent && measured.background === "opaque") throw new LibraryError("图片背景不透明", 422);
    const done = await this.store(m, measured);
    this.wake(id);
    return done;
  }
  fail(id: string, error: string, user: string) {
    const m = this.picture(id, user);
    if (m.status !== "developing") return m;
    this.catalog.stand(id, { status: "failed", error });
    this.wake(id);
    return this.get(id, user);
  }
  /** Adds a finished picture, such as an upload. */
  async ingest(bytes: Uint8Array, mediaType: string, input: Describe, user: string) {
    const d = describeSchema.parse(input);
    this.checkStyle(d.style);
    const measured = await measure(bytes, mediaType).catch(() => {
      throw new LibraryError("无法读取这张图片，请换一张");
    });
    const slug =
      d.name.en
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        // Cut first: a cut that lands on a hyphen would leave "--" before the suffix.
        .slice(0, 32)
        .replace(/^-+|-+$/g, "") || "picture";
    const id = `${d.origin.kind === "upload" ? "u" : "g"}-${slug}-${crypto.randomUUID().slice(0, 6)}`;
    // An opaque upload is a whole picture, not a cut-out.
    const type = d.origin.kind === "upload" && measured.background === "opaque" ? "scene" : d.type;
    return this.store(this.record(id, { ...d, type }, user, measured), measured);
  }
  private async store(m: PictureMaterial, measured: Awaited<ReturnType<typeof measure>>) {
    const next: PictureMaterial = {
      ...m,
      status: "ready",
      form: {
        ...m.form,
        width: measured.width,
        height: measured.height,
        background: measured.background,
        content: measured.content,
        palette: measured.palette,
        recolor: measured.recolor,
      },
      file: { ...m.file, mediaType: measured.mediaType, bytes: measured.bytes.length },
    };
    writeFileSync(this.path(next), measured.bytes);
    return this.save(next);
  }
  private path(m: Pick<PictureMaterial, "id" | "file">) {
    return m.file.blob
      ? this.blobPath(m.file.blob)
      : join(this.dir, "files", `${m.id}.${extensions[m.file.mediaType]}`);
  }
  private wake(id: string) {
    for (const fn of this.waiters.get(id) ?? []) fn();
    this.waiters.delete(id);
  }
  /** Makes a user's picture public, or gives a published one back to whoever made it.
   * Materials from a pack are always public. */
  publish(id: string, published: boolean) {
    const m = this.catalog.head(id);
    if (!m) throw new LibraryError(`素材不存在: ${id}`, 404);
    if (m.pack || !m.origin.user) throw new LibraryError("精选素材始终公开", 409);
    this.catalog.stand(id, { owner: published ? null : m.origin.user });
    return this.catalog.full(id)!;
  }
  /** Waits for a developing picture, up to `ms`. */
  async ready(id: string, user: Viewer, ms: number) {
    let m = this.picture(id, user);
    if (m.status === "developing" && ms > 0) {
      await new Promise<void>((resolve) => {
        const set = this.waiters.get(id) ?? new Set();
        const done = () => {
          clearTimeout(timer);
          set.delete(done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        set.add(done);
        this.waiters.set(id, set);
      });
      m = this.picture(id, user);
    }
    if (m.status === "developing") throw new LibraryError("素材仍在生成", 504);
    if (m.status === "failed") throw new LibraryError(m.error || "素材生成失败", 410);
    return m;
  }
  /** The picture itself; an SVG drawn in currentColor can be inked in `color`. */
  /** The picture as it was at `version`, once the current one is ready: a work shows the
   * pixels it took, whatever a later pack put under the same id. */
  private async at(id: string, user: Viewer, wait: number, version?: number) {
    const m = await this.ready(id, user, wait);
    if (version === undefined || version === m.version) return m;
    const old = this.get(id, user, version);
    if (old.kind !== "picture") throw new LibraryError(`${id} 不是图片素材`);
    return old;
  }
  /** The picture itself, at a version it had or the current one; an SVG drawn in
   * currentColor can be inked in `color`. */
  async file(id: string, user?: Viewer, color?: string, wait = 240_000, version?: number) {
    const m = await this.at(id, user, wait, version);
    const bytes = readFileSync(this.path(m));
    return { material: m, bytes: color && m.form.recolor ? recolor(bytes, color) : bytes };
  }
  async thumb(id: string, user: Viewer, size: number, version?: number) {
    const m = await this.at(id, user, 240_000, version);
    const cached = join(this.dir, "thumbs", `${id}-${m.hash}-${size}.webp`);
    if (existsSync(cached)) return readFileSync(cached);
    const webp = await thumbnail(readFileSync(this.path(m)), m.file.mediaType, size);
    writeFileSync(cached, webp);
    return webp;
  }
  /** Records that a work uses these materials; popular ones rank a little higher. */
  use(ids: string[], work: string, user: string) {
    for (const id of new Set(ids)) this.catalog.use(id, user, work);
  }
  /** Takes a material out of what is offered; works holding it keep it. */
  withdraw(id: string) {
    const m = this.catalog.head(id);
    if (!m) throw new LibraryError(`素材不存在: ${id}`, 404);
    this.catalog.stand(id, { status: "withdrawn" });
  }
}
