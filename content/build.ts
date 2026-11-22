// Builds this project's material pack from its sources: the pictures, drawing code,
// effects, styles and geographic data under seed/. The pack is all the library ever sees
// of this project; import it with `pnpm --dir materials pack:import <dir>`.
//
//   pnpm --dir content build [out dir] [release]
//
// The format is documented in materials/pack.ts.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const seed = join(here, "seed");
const read = <T>(path: string): T => JSON.parse(readFileSync(join(seed, path), "utf8"));
const media: Record<string, string> = {
  webp: "image/webp",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  json: "application/json",
};
/** Every file under a directory, relative to it. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path).map((p) => join(name, p)) : [name];
  });
}

/** Builds the pack into `out`. Without a release named, the release is the day and a digest
 * of the pack's content, so two builds of different content never share a release and the
 * same content built again is the same release. */
export function build(out: string, named?: string) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const files: Record<string, string> = {};
  const copy = (from: string, to: string) => {
    mkdirSync(dirname(join(out, to)), { recursive: true });
    cpSync(from, join(out, to));
    files[to] = createHash("sha256").update(readFileSync(from)).digest("hex");
  };
  type Picture = { id: string; role: string; file: { mediaType: string }; [k: string]: unknown };
  const lines: object[] = [];
  const createdAt = (m: { origin?: { createdAt?: number } }) => m.origin?.createdAt;
  for (const p of read<Picture[]>("pictures.json")) {
    const { role, origin, file, kind: _k, ...rest } = p as Picture & { origin?: { createdAt?: number } };
    const ext = Object.keys(media).find((e) => media[e] === file.mediaType)!;
    const path = `files/${p.id}.${ext}`;
    copy(join(seed, path), path);
    lines.push({ kind: "picture", ...rest, type: role, file: { path, mediaType: file.mediaType }, createdAt: createdAt({ origin }) });
  }
  for (const d of read<{ id: string; origin?: { createdAt: number } }[]>("drawings.json")) {
    const { origin, kind: _k, ...rest } = d as typeof d & { kind: string };
    lines.push({
      kind: "drawing",
      type: "drawing",
      ...rest,
      source: readFileSync(join(seed, "drawings", d.id + ".js"), "utf8"),
      createdAt: origin?.createdAt,
    });
  }
  for (const [file, kind] of [
    ["effects.json", "effect"],
    ["styles.json", "style"],
  ] as const)
    for (const m of read<{ origin?: { createdAt: number } }[]>(file)) {
      const { origin, kind: _k, count: _c, uses: _u, ...rest } = m as typeof m & { kind: string; count?: number; uses?: number };
      lines.push({ kind, type: kind, ...rest, createdAt: origin?.createdAt });
    }
  // Geographic layers the map drawing reads, and the relief tiles it lays over land.
  const data = walk(join(seed, "geo")).map((path) => {
    copy(join(seed, "geo", path), join("geo", path));
    const name = "geo/" + path.replace(/\.(json|webp)$/, "");
    return { name, path: join("geo", path), mediaType: media[path.split(".").pop()!] };
  });
  writeFileSync(join(out, "materials.ndjson"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  files["materials.ndjson"] = createHash("sha256").update(readFileSync(join(out, "materials.ndjson"))).digest("hex");
  copy(join(here, "LICENSE"), "LICENSE");
  const types = read<object[]>("types.json"),
    synonyms = read<string[][]>("synonyms.json"),
    bindings = { text: "label", picture: "picture", link: "arrow" };
  const content = createHash("sha256")
    .update(JSON.stringify([Object.entries(files).sort(), types, synonyms, bindings, data]))
    .digest("hex");
  const release = named ?? `${new Date().toISOString().slice(0, 10).replaceAll("-", ".")}-${content.slice(0, 10)}`;
  const manifest = {
    format: "drawy-material-pack/1",
    source: "drawy-curated",
    release,
    materials: "materials.ndjson",
    files,
    types,
    bindings,
    data,
    synonyms,
    withdraw: [],
    license: "LICENSE",
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
  return { out, release, materials: lines.length, files: Object.keys(files).length };
}

if (import.meta.main) {
  const [out = join(here, "dist", "pack"), release] = process.argv.slice(2);
  const r = build(out, release);
  console.log(`built ${relative(process.cwd(), r.out) || "."} (${r.release}): ${r.materials} materials, ${r.files} files`);
}
