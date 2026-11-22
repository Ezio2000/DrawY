import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, normalize, isAbsolute } from "node:path";
import { z } from "zod";
import { blobHash, digest, Library, LibraryError } from "./library.ts";
import {
  capabilities,
  capabilityContract,
  kindSchema,
  materialTypeSchema,
  namesSchema,
  paramSchema,
  pictureTypes,
  typeIdSchema,
  unitBoxSchema,
  unitPointSchema,
  type Bindings,
  type Material,
} from "./schema.ts";

/** The format of a material pack: what a material project hands the library. A pack is a
 * directory holding
 * - manifest.json: the pack's format, source and release, the digest of every file in it,
 *   its types, its bindings, its data and the materials it withdraws;
 * - materials.ndjson: one material per line, every type alike;
 * - the files its pictures and data name.
 * A pack never carries owners, standing or uses: those are the library's. */
export const PACK_FORMAT = "drawy-material-pack/1";
const ID = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/;
const relative = z
  .string()
  .min(1)
  .refine((p) => !isAbsolute(p) && !normalize(p).startsWith(".."), "路径必须在包内");
export const manifestSchema = z.object({
  format: z.literal(PACK_FORMAT),
  /** Who makes the materials: one project, whose ids are its own. */
  source: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  /** This release of the source, such as a date or a version. */
  release: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  materials: relative.default("materials.ndjson"),
  /** Each file in the pack by its path, with its sha256. */
  files: z.record(relative, z.string().regex(/^[0-9a-f]{64}$/)),
  types: z.array(materialTypeSchema).default([]),
  /** Which drawing the app's own editing uses to add text, a picture and a link. */
  bindings: z.record(z.enum(capabilities), z.string()).optional(),
  /** Data drawings read, by name, such as geographic layers. */
  data: z.array(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9/._-]*$/), path: relative, mediaType: z.string() })).default([]),
  /** Phrases that name the same thing, each group in any language: "库存", "仓库",
   * "warehouse". Searching for one finds materials named by another. */
  synonyms: z.array(z.array(z.string().min(1)).min(2).max(16)).max(20000).default([]),
  /** Materials of this source no longer offered. A material left out of a pack is kept. */
  withdraw: z.array(z.string()).default([]),
  /** Where the source's materials came from and under what terms. */
  license: z.string().optional(),
});
export type Manifest = z.infer<typeof manifestSchema>;

const common = {
  id: z.string().regex(ID).max(96),
  type: typeIdSchema,
  name: namesSchema,
  aliases: z.array(z.string()).default([]),
  category: z.string().default(""),
  about: z.string().min(1),
  tags: z.array(z.string()).default([]),
  style: z.string().nullable().default(null),
  createdAt: z.number().optional(),
};
/** One line of materials.ndjson. */
export const packedSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("picture"),
    form: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
      background: z.enum(["transparent", "opaque"]),
      content: unitBoxSchema,
      view: z.enum(["front", "side", "three-quarter", "top", "portrait"]).optional(),
      facing: z.enum(["left", "right", "viewer", "none"]).optional(),
      anchors: z.record(z.string(), unitPointSchema).default({}),
      palette: z.array(z.string()).default([]),
      recolor: z.boolean().default(false),
    }),
    file: z.object({ path: relative, mediaType: z.string() }),
  }),
  z.object({
    ...common,
    kind: z.literal("drawing"),
    source: z.string().min(1),
    params: z.record(z.string(), paramSchema),
    use: z.enum(["module", "link"]),
    size: z.object({ width: z.number().positive(), height: z.number().positive() }),
    example: z.record(z.string(), z.unknown()),
  }),
  z.object({
    ...common,
    kind: z.literal("effect"),
    defs: z.string().min(1),
    apply: z.enum(["filter", "paint", "marker"]),
  }),
  z.object({
    ...common,
    kind: z.literal("style"),
    register: z.enum(["formal", "expressive", "any"]),
    prompt: z.string(),
    tokens: z.record(z.string(), z.string()),
    guide: z.string(),
    effects: z.array(z.string()).default([]),
    /** The pictures chosen to show the style first. */
    samples: z.array(z.string()).default([]),
  }),
]);
export type Packed = z.infer<typeof packedSchema>;

export interface ImportReport {
  source: string;
  release: string;
  status: "imported" | "unchanged";
  added: number;
  updated: number;
  unchanged: number;
  withdrawn: number;
  files: number;
}
/** The types every library has, so the pictures the app makes always have one. */
const builtinTypes = [
  ...pictureTypes.map((id) => ({ id, kind: "picture" as const })),
  ...kindSchema.options.filter((k) => k !== "picture").map((id) => ({ id, kind: id })),
];

/** Reads and checks a pack completely before the library changes: every file against its
 * digest, every material against the schema, ids, types, styles and effects against each
 * other and against what the library already holds. */
export function readPack(dir: string, library: Library) {
  const raw = readFileSync(join(dir, "manifest.json"));
  const manifest = manifestSchema.parse(JSON.parse(raw.toString("utf8")));
  const problems: string[] = [];
  const file = (path: string) => {
    const want = manifest.files[path];
    if (!want) {
      problems.push(`文件不在清单中: ${path}`);
      return undefined;
    }
    const full = join(dir, path);
    if (!existsSync(full)) {
      problems.push(`缺少文件: ${path}`);
      return undefined;
    }
    const bytes = readFileSync(full);
    if (blobHash(bytes) !== want) problems.push(`文件校验不符: ${path}`);
    return bytes;
  };
  const lines = readFileSync(join(dir, manifest.materials), "utf8").split("\n").filter((l) => l.trim());
  const materials: Packed[] = [];
  lines.forEach((line, i) => {
    try {
      materials.push(packedSchema.parse(JSON.parse(line)));
    } catch (e) {
      problems.push(`第 ${i + 1} 行: ${e instanceof z.ZodError ? z.prettifyError(e) : String(e)}`);
    }
  });
  const ids = new Map<string, Packed>();
  for (const m of materials) {
    if (ids.has(m.id)) problems.push(`素材 ID 重复: ${m.id}`);
    ids.set(m.id, m);
  }
  // Types: the pack's own, those the library has, and the built-in ones.
  const types = new Map<string, string>(builtinTypes.map((t) => [t.id, t.kind]));
  for (const t of library.types()) types.set(t.id, t.kind);
  for (const t of manifest.types) types.set(t.id, t.kind);
  const existing = (id: string) => library.catalog.head(id);
  for (const m of materials) {
    if (types.get(m.type) !== m.kind) problems.push(`${m.id}: 类型 ${m.type} 不是 ${m.kind} 载荷`);
    const held = existing(m.id);
    if (held && held.pack !== manifest.source)
      problems.push(`${m.id}: 已属于${held.pack ? "素材源 " + held.pack : "用户素材"}，不能覆盖`);
    const isStyle = (id: string) => ids.get(id)?.kind === "style" || existing(id)?.kind === "style";
    if (m.style && !isStyle(m.style)) problems.push(`${m.id}: 未知风格 ${m.style}`);
    if (m.kind === "style")
      for (const e of m.effects)
        if (ids.get(e)?.kind !== "effect" && existing(e)?.kind !== "effect")
          problems.push(`${m.id}: 未知效果 ${e}`);
  }
  // Bindings name drawings that take what the app writes into them.
  if (manifest.bindings)
    for (const [capability, id] of Object.entries(manifest.bindings) as [keyof Bindings, string][]) {
      const d = ids.get(id) ?? (existing(id) && library.catalog.full(id));
      const contract = capabilityContract[capability];
      if (!d || d.kind !== "drawing") problems.push(`绑定 ${capability}: ${id} 不是画法`);
      else {
        if (d.use !== contract.use) problems.push(`绑定 ${capability}: ${id} 应为 ${contract.use}`);
        for (const [param, type] of Object.entries(contract.params))
          if (d.params[param]?.type !== type) problems.push(`绑定 ${capability}: ${id} 缺少 ${type} 参数 ${param}`);
      }
    }
  for (const id of manifest.withdraw) {
    const held = existing(id);
    if (!held || held.pack !== manifest.source) problems.push(`撤下的素材不属于本素材源: ${id}`);
  }
  const files = new Map<string, Buffer>();
  for (const m of materials)
    if (m.kind === "picture") {
      const bytes = file(m.file.path);
      if (bytes) files.set(m.file.path, bytes);
    }
  for (const d of manifest.data) {
    const bytes = file(d.path);
    if (bytes) files.set(d.path, bytes);
  }
  if (problems.length) throw new LibraryError(`素材包无效:\n${problems.slice(0, 40).join("\n")}`, 422);
  return { manifest, materials, files, digest: createHash("sha256").update(raw).digest("hex") };
}

/** What the library makes of a packed material: the same content always the same hash. */
function material(p: Packed, manifest: Manifest, blob?: { hash: string; bytes: number }): Omit<Material, "version" | "hash"> {
  const { createdAt, ...rest } = p;
  const base = {
    ...rest,
    origin: { kind: "curated" as const, createdAt: createdAt ?? 0 },
    owner: null,
    status: "ready" as const,
    uses: 0,
    pack: manifest.source,
  };
  if (p.kind === "picture")
    return {
      ...base,
      file: { url: `/materials/files/${p.id}`, mediaType: p.file.mediaType, bytes: blob!.bytes, blob: blob!.hash },
    } as unknown as Omit<Material, "version" | "hash">;
  if (p.kind === "style") return { ...base, count: 0 } as unknown as Omit<Material, "version" | "hash">;
  return base as unknown as Omit<Material, "version" | "hash">;
}

/** Imports a pack. Its files are stored first, by content, which changes nothing anyone
 * sees; then one transaction makes the release current: new materials, new versions of
 * changed ones, types, bindings and data. Importing the same release again changes nothing;
 * a release already imported with other content is refused. */
export function importPack(library: Library, dir: string): ImportReport {
  const { manifest, materials, files, digest: packDigest } = readPack(dir, library);
  const catalog = library.catalog;
  const prior = catalog.sql("SELECT digest FROM releases WHERE source=? AND release=?").get(manifest.source, manifest.release) as
    | { digest: string }
    | undefined;
  const report: ImportReport = {
    source: manifest.source,
    release: manifest.release,
    status: "unchanged",
    added: 0,
    updated: 0,
    unchanged: 0,
    withdrawn: 0,
    files: 0,
  };
  if (prior) {
    if (prior.digest !== packDigest)
      throw new LibraryError(`素材源 ${manifest.source} 的版本 ${manifest.release} 已导入过不同内容，请换一个版本号`, 409);
    return { ...report, unchanged: materials.length };
  }
  const media = new Map<string, string>(manifest.data.map((d) => [d.path, d.mediaType]));
  for (const m of materials) if (m.kind === "picture") media.set(m.file.path, m.file.mediaType);
  const blobs = new Map<string, { hash: string; bytes: number }>();
  for (const [path, bytes] of files) {
    blobs.set(path, { hash: library.keepBlob(bytes, media.get(path)!), bytes: bytes.length });
    report.files++;
  }
  catalog.transaction(() => {
    for (const t of manifest.types) catalog.putType(t);
    for (const p of materials) {
      const next = material(p, manifest, p.kind === "picture" ? blobs.get(p.file.path) : undefined);
      const hash = digest(next as Material);
      const held = catalog.head(p.id);
      if (held && held.hash === hash && held.status !== "withdrawn") {
        report.unchanged++;
        continue;
      }
      // An unchanged one taken back keeps its version; a changed one gets the next.
      const version = held ? (held.hash === hash ? held.version : held.version + 1) : 1;
      catalog.put({ ...next, hash, version, uses: held?.uses ?? 0 } as Material);
      if (held) report.updated++;
      else report.added++;
    }
    for (const id of manifest.withdraw) {
      catalog.stand(id, { status: "withdrawn" });
      report.withdrawn++;
    }
    for (const d of manifest.data)
      catalog
        .sql("INSERT INTO data VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET blob=excluded.blob, media=excluded.media, source=excluded.source")
        .run(d.name, blobs.get(d.path)!.hash, d.mediaType, manifest.source);
    if (manifest.bindings)
      for (const [capability, id] of Object.entries(manifest.bindings))
        catalog
          .sql("INSERT INTO bindings VALUES(?,?,?) ON CONFLICT(capability) DO UPDATE SET material=excluded.material, source=excluded.source")
          .run(capability, id, manifest.source);
    catalog.setThesaurus(manifest.source, manifest.synonyms);
    record(library, manifest.source, manifest.release, packDigest, manifest.synonyms);
  });
  return { ...report, status: "imported" };
}
/** Notes a release as the source's current one, with what it holds, so it can be gone
 * back to. */
function record(library: Library, source: string, release: string, packDigest: string, synonyms: string[][]) {
  const c = library.catalog;
  const items = c.sql("SELECT id, version FROM materials WHERE source=? AND status != 'withdrawn'").all(source);
  const data = c.sql("SELECT name, blob, media FROM data WHERE source=?").all(source);
  const bindings = c.sql("SELECT capability, material FROM bindings WHERE source=?").all(source);
  c.sql("UPDATE releases SET active=0 WHERE source=?").run(source);
  c.sql(
    "INSERT INTO releases VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(source, release) DO UPDATE SET active=1",
  ).run(source, release, packDigest, Date.now(), JSON.stringify(items), JSON.stringify(data), JSON.stringify(bindings), JSON.stringify(synonyms));
}
export function releases(library: Library) {
  return (
    library.catalog.sql("SELECT source, release, at, active, items FROM releases ORDER BY at").all() as {
      source: string;
      release: string;
      at: number;
      active: number;
      items: string;
    }[]
  ).map((r) => ({ source: r.source, release: r.release, at: r.at, active: !!r.active, materials: JSON.parse(r.items).length }));
}
/** Makes an earlier release of a source current again: each of its materials at the
 * version it had then, the source's later ones withdrawn, its data and bindings as they
 * were. Works keep the versions they hold either way. */
export function rollback(library: Library, source: string, release: string) {
  const c = library.catalog;
  const r = c.sql("SELECT items, data, bindings, thesaurus FROM releases WHERE source=? AND release=?").get(source, release) as
    | { items: string; data: string; bindings: string; thesaurus: string }
    | undefined;
  if (!r) throw new LibraryError(`没有素材源 ${source} 的版本 ${release}`, 404);
  const items = new Map((JSON.parse(r.items) as { id: string; version: number }[]).map((i) => [i.id, i.version]));
  c.transaction(() => {
    const current = c.sql("SELECT id FROM materials WHERE source=?").all(source) as { id: string }[];
    for (const { id } of current) {
      const version = items.get(id);
      if (version === undefined) {
        c.stand(id, { status: "withdrawn" });
        continue;
      }
      const m = c.full(id, version)!;
      c.put({ ...m, status: "ready", version, hash: c.versionHash(id, version)! });
    }
    c.sql("DELETE FROM data WHERE source=?").run(source);
    for (const d of JSON.parse(r.data) as { name: string; blob: string; media: string }[])
      c.sql("INSERT INTO data VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET blob=excluded.blob, media=excluded.media, source=excluded.source").run(d.name, d.blob, d.media, source);
    for (const b of JSON.parse(r.bindings) as { capability: string; material: string }[])
      c.sql("INSERT INTO bindings VALUES(?,?,?) ON CONFLICT(capability) DO UPDATE SET material=excluded.material, source=excluded.source").run(b.capability, b.material, source);
    c.setThesaurus(source, JSON.parse(r.thesaurus));
    c.sql("UPDATE releases SET active = (release = ?) WHERE source=?").run(release, source);
  });
}
