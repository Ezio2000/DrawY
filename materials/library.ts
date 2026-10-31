import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Index } from "./search.ts";
import { measure, recolor, thumbnail } from "./media.ts";
import {
  describeSchema,
  reserveSchema,
  searchSchema,
  type Describe,
  type Material,
  type MaterialKind,
  type MaterialPage,
  type PictureMaterial,
  type Reserve,
  type SearchRequest,
  type SearchResult,
  type StyleMaterial,
} from "./schema.ts";

export class LibraryError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 410 | 504 = 400,
  ) {
    super(message);
  }
}
const extensions: Record<string, string> = {
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};
const PAGE = 48;
/** How long a reserved picture may take to develop before it is given up. */
const DEVELOP_MS = 15 * 60 * 1000;
type Curated = Omit<Material, "uses" | "owner" | "status">;
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));

/** The material library: pictures, drawing code, effects and styles, what each is for and
 * who may use it. Curated materials ship in `seed`; generated and uploaded pictures are
 * kept in `dir`. */
export class Library {
  readonly index = new Index();
  private db: DatabaseSync;
  private waiters = new Map<string, Set<() => void>>();
  constructor(
    private dir: string,
    private seed: string,
  ) {
    mkdirSync(join(dir, "files"), { recursive: true });
    mkdirSync(join(dir, "thumbs"), { recursive: true });
    this.db = new DatabaseSync(join(dir, "materials.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS materials(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS uses(material_id TEXT NOT NULL,user_id TEXT NOT NULL,work_id TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(material_id,user_id,work_id));`);
    const uses = this.db.prepare(
      "SELECT COUNT(*) AS n FROM uses WHERE material_id=?",
    );
    for (const c of this.curated())
      this.save({
        ...c,
        owner: null,
        status: "ready",
        uses: Number((uses.get(c.id) as { n: number }).n),
      } as Material);
    const now = Date.now();
    for (const row of this.db.prepare("SELECT data FROM materials").all()) {
      const m: Material = JSON.parse(row.data as string);
      if (m.status === "developing" && now - m.origin.createdAt > DEVELOP_MS)
        this.save({ ...m, status: "failed", error: "生成被中断" });
      else this.index.put(m);
    }
  }
  private curated(): Curated[] {
    const pictures = read<Curated[]>(join(this.seed, "pictures.json")).map(
      (p) => ({
        ...p,
        file: {
          ...(p as PictureMaterial).file,
          url: `/materials/files/${p.id}`,
        },
      }),
    );
    const drawings = read<Curated[]>(join(this.seed, "drawings.json")).map(
      (d) => ({
        ...d,
        source: readFileSync(join(this.seed, "drawings", d.id + ".js"), "utf8"),
      }),
    );
    const all = [
      ...pictures,
      ...drawings,
      ...read<Curated[]>(join(this.seed, "effects.json")),
      ...read<Curated[]>(join(this.seed, "styles.json")),
    ] as Curated[];
    const ids = new Set<string>();
    for (const m of all) {
      if (ids.has(m.id)) throw Error("素材 ID 重复: " + m.id);
      ids.add(m.id);
    }
    return all;
  }
  close() {
    this.db.close();
  }
  private save<T extends Material>(m: T) {
    this.db
      .prepare(
        "INSERT INTO materials VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(m.id, JSON.stringify(m));
    this.index.put(m);
    return m;
  }
  private path(m: Pick<PictureMaterial, "id" | "origin" | "file">) {
    const name = `${m.id}.${extensions[m.file.mediaType]}`;
    return m.origin.kind === "curated"
      ? join(this.seed, "files", name)
      : join(this.dir, "files", name);
  }
  /** Styles with the pictures that show them best: the style's own showcase first, then
   * the most used. */
  styles(): StyleMaterial[] {
    const pictures = this.index
      .all()
      .filter((m): m is PictureMaterial => m.kind === "picture");
    return this.index
      .all()
      .filter((m): m is StyleMaterial => m.kind === "style")
      .map((s) => {
        const own = pictures
          .filter((p) => p.style === s.id)
          .sort((a, b) => b.uses - a.uses);
        const shown = [
          ...s.samples.filter((id) => own.some((p) => p.id === id)),
          ...own.map((p) => p.id).filter((id) => !s.samples.includes(id)),
        ];
        return { ...s, samples: shown.slice(0, 4), count: own.length };
      });
  }
  style(id: string) {
    const s = this.styles().find((s) => s.id === id);
    if (!s)
      throw new LibraryError(
        `未知风格 ${id}，可用：${this.styles()
          .map((s) => s.id)
          .join(", ")}`,
      );
    return s;
  }
  get(id: string, user?: string): Material {
    const m = this.index.get(id);
    if (!m || (m.owner !== null && m.owner !== user))
      throw new LibraryError(`素材不存在: ${id}`, 404);
    return m.kind === "style" ? this.style(m.id) : m;
  }
  private picture(id: string, user?: string) {
    const m = this.get(id, user);
    if (m.kind !== "picture") throw new LibraryError(`${id} 不是图片素材`);
    return m;
  }
  /** Several materials at once; leniently, the ones that exist. */
  many(ids: string[], user?: string, lenient = false) {
    return ids.flatMap((id) => {
      try {
        return [this.get(id, user)];
      } catch (e) {
        if (lenient && e instanceof LibraryError) return [];
        throw e;
      }
    });
  }
  search(input: SearchRequest, user?: string): SearchResult[] {
    const req = searchSchema.parse(input);
    return req.subjects.map((subject) => ({
      subject,
      hits: this.index.search(
        subject,
        { user, style: req.style, kinds: req.kinds, roles: req.roles },
        req.limit,
      ),
    }));
  }
  browse(
    query: string,
    page: number,
    user?: string,
    kinds?: MaterialKind[],
    /** How many to a page: as many as the shelf showing them holds. */
    size = PAGE,
  ): MaterialPage {
    size = Math.min(Math.max(1, Math.floor(size) || PAGE), 200);
    const items = query.trim()
      ? this.index.search(query, { user, kinds }, 10_000).map((h) => h.material)
      : this.index
          .all({ user })
          .filter((m) => !kinds?.length || kinds.includes(m.kind))
          .sort(
            (a, b) =>
              Number(b.owner === user) - Number(a.owner === user) ||
              b.origin.createdAt - a.origin.createdAt ||
              b.uses - a.uses,
          );
    const pages = Math.max(1, Math.ceil(items.length / size));
    const at = Math.min(Math.max(1, page), pages);
    const shown = items.slice((at - 1) * size, at * size);
    // Styles are shown with their pictures, as everywhere else.
    const styles = shown.some((m) => m.kind === "style")
      ? new Map(this.styles().map((s) => [s.id, s]))
      : undefined;
    return {
      items: shown.map((m) => styles?.get(m.id) ?? m),
      total: items.length,
      page: at,
      pages,
    };
  }
  private record(
    id: string,
    d: ReturnType<typeof describeSchema.parse>,
    user: string,
    size: { width: number; height: number },
  ): PictureMaterial {
    // Uploads and pictures made from a user's private pictures stay theirs; the rest join
    // the library.
    const owner =
      d.origin.kind === "upload" ||
      d.origin.references?.some((ref) => this.index.get(ref)?.owner)
        ? user
        : null;
    return {
      id,
      kind: "picture",
      role: d.role,
      name: d.name,
      aliases: d.aliases,
      category: d.category,
      about: d.about,
      tags: d.tags,
      style: d.style,
      form: {
        ...size,
        background:
          d.role === "scene" || d.role === "texture" ? "opaque" : "transparent",
        content: { x: 0, y: 0, width: 1, height: 1 },
        ...(d.view ? { view: d.view } : {}),
        ...(d.facing ? { facing: d.facing } : {}),
        anchors: d.anchors,
        palette: [],
        recolor: false,
      },
      file: {
        url: `/materials/files/${id}`,
        mediaType: "image/webp",
        bytes: 0,
      },
      origin: { ...d.origin, user, createdAt: Date.now() },
      owner,
      status: "developing",
      uses: 0,
    };
  }
  /** Holds a place for a picture that is being generated, so a work can use it at once. */
  reserve(input: Reserve, user: string) {
    const r = reserveSchema.parse(input);
    if (r.style) this.style(r.style);
    if (this.index.get(r.id)) throw new LibraryError("素材 ID 已存在", 409);
    return this.save(
      this.record(r.id, r, user, { width: r.width, height: r.height }),
    );
  }
  /** The finished pixels of a reserved picture. */
  async develop(
    id: string,
    bytes: Uint8Array,
    mediaType: string,
    user: string,
  ) {
    const m = this.picture(id, user);
    if (m.status !== "developing")
      throw new LibraryError("素材不在生成中", 409);
    const done = await this.store(m, await measure(bytes, mediaType));
    this.wake(id);
    return done;
  }
  fail(id: string, error: string, user: string) {
    const m = this.picture(id, user);
    if (m.status !== "developing") return m;
    const failed = this.save({ ...m, status: "failed", error });
    this.wake(id);
    return failed;
  }
  /** Adds a finished picture, such as an upload. */
  async ingest(
    bytes: Uint8Array,
    mediaType: string,
    input: Describe,
    user: string,
  ) {
    const d = describeSchema.parse(input);
    if (d.style) this.style(d.style);
    const measured = await measure(bytes, mediaType);
    const slug =
      d.name.en
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32) || "picture";
    const id = `${d.origin.kind === "upload" ? "u" : "g"}-${slug}-${crypto.randomUUID().slice(0, 6)}`;
    // An opaque upload is a whole picture, not a cut-out.
    const role =
      d.origin.kind === "upload" && measured.background === "opaque"
        ? "scene"
        : d.role;
    return this.store(
      this.record(id, { ...d, role }, user, measured),
      measured,
    );
  }
  private async store(
    m: PictureMaterial,
    measured: Awaited<ReturnType<typeof measure>>,
  ) {
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
      file: {
        ...m.file,
        mediaType: measured.mediaType,
        bytes: measured.bytes.length,
      },
    };
    writeFileSync(this.path(next), measured.bytes);
    return this.save(next);
  }
  private wake(id: string) {
    for (const fn of this.waiters.get(id) ?? []) fn();
    this.waiters.delete(id);
  }
  /** Waits for a developing picture, up to `ms`. */
  async ready(id: string, user: string | undefined, ms: number) {
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
    if (m.status === "failed")
      throw new LibraryError(m.error || "素材生成失败", 410);
    return m;
  }
  /** The picture itself; an SVG drawn in currentColor can be inked in `color`. */
  async file(id: string, user?: string, color?: string, wait = 240_000) {
    const m = await this.ready(id, user, wait);
    const bytes = readFileSync(this.path(m));
    return {
      material: m,
      bytes: color && m.form.recolor ? recolor(bytes, color) : bytes,
    };
  }
  async thumb(id: string, user: string | undefined, size: number) {
    const m = await this.ready(id, user, 240_000);
    const cached = join(this.dir, "thumbs", `${id}-${size}.png`);
    if (existsSync(cached)) return readFileSync(cached);
    const png = await thumbnail(
      readFileSync(this.path(m)),
      m.file.mediaType,
      size,
    );
    writeFileSync(cached, png);
    return png;
  }
  /** Records that a work uses these materials; popular ones rank a little higher. */
  use(ids: string[], work: string, user: string) {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO uses VALUES(?,?,?,?)",
    );
    const count = this.db.prepare(
      "SELECT COUNT(*) AS n FROM uses WHERE material_id=?",
    );
    for (const id of new Set(ids)) {
      const m = this.index.get(id);
      if (!m) continue;
      if (insert.run(id, user, work, Date.now()).changes)
        this.save({ ...m, uses: Number((count.get(id) as { n: number }).n) });
    }
  }
}
