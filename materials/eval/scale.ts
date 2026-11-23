// How the library behaves as it grows: fills a library with N synthetic pictures made from
// the curated pack's own words, then, in a fresh process, measures opening it, the memory
// that takes, and searching it.
//
//   tsx materials/eval/scale.ts fill <dir> <N>     a library with the pack and N more
//   tsx materials/eval/scale.ts measure <dir>      open and search it; prints JSON
import { readFileSync } from "node:fs";
import { Library } from "../library.ts";
import { importPack } from "../pack.ts";
import { curatedPack } from "../curated.ts";
import type { Material, PictureMaterial } from "../schema.ts";

/** A small deterministic generator, so every run fills the same library. */
function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
export function synthetic(base: PictureMaterial[], n: number): PictureMaterial[] {
  const r = random(42);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const out: PictureMaterial[] = [];
  for (let i = 0; i < n; i++) {
    const a = pick(base),
      b = pick(base);
    out.push({
      ...a,
      id: `syn-${i}`,
      name: { zh: `${a.name.zh}${b.name.zh.slice(0, 2)}`, en: `${a.name.en} ${b.name.en.split(" ")[0]}` },
      aliases: [...a.aliases.slice(0, 3), ...b.aliases.slice(0, 2)],
      tags: [...a.tags.slice(0, 3), pick(b.tags) ?? "thing"],
      about: `${a.about} ${b.about.split(".")[0]}.`,
      style: a.style,
      origin: { kind: "generated", user: `u${i % 500}`, createdAt: 1_800_000_000_000 + i },
      // Most are their makers' own; one in five was published.
      owner: i % 5 === 0 ? null : `u${i % 500}`,
      pack: null,
      status: "ready",
      uses: Math.floor(r() * 20),
      version: 1,
      hash: `syn${i}`,
    });
  }
  return out;
}

if (import.meta.main) {
  const [command, dir, n] = process.argv.slice(2);
  if (command === "fill") {
    const library = new Library(dir);
    importPack(library, curatedPack());
    const base = library
      .browse("", 1, undefined, ["picture"], 200)
      .items.concat(library.browse("", 2, undefined, ["picture"], 200).items) as PictureMaterial[];
    const started = performance.now();
    const all = synthetic(base, Number(n));
    for (let i = 0; i < all.length; i += 2000)
      library.catalog.transaction(() => all.slice(i, i + 2000).forEach((m) => library.catalog.put(m as Material)));
    console.log(JSON.stringify({ filled: all.length, ms: Math.round(performance.now() - started) }));
    library.close();
  } else if (command === "measure") {
    const queries = JSON.parse(readFileSync(new URL("./queries.json", import.meta.url), "utf8")) as { q: string }[];
    global.gc?.();
    const before = process.memoryUsage().rss;
    const t0 = performance.now();
    const library = new Library(dir);
    const openMs = performance.now() - t0;
    const rss = process.memoryUsage().rss - before;
    const times: number[] = [];
    for (const viewer of [undefined, "u7"])
      for (const { q } of queries) {
        const t = performance.now();
        library.search({ subjects: [q], limit: 5 }, viewer);
        times.push(performance.now() - t);
      }
    times.sort((a, b) => a - b);
    const t1 = performance.now();
    library.browse("", 400, "u7", ["picture"], 48);
    const deepPageMs = performance.now() - t1;
    console.log(
      JSON.stringify({
        materials: library.size,
        openMs: Math.round(openMs),
        openRssMB: Math.round(rss / 1e6),
        searchP50ms: +times[Math.floor(times.length * 0.5)].toFixed(2),
        searchP95ms: +times[Math.floor(times.length * 0.95)].toFixed(2),
        searchMaxms: +times.at(-1)!.toFixed(2),
        deepPageMs: +deepPageMs.toFixed(2),
      }),
    );
    library.close();
  }
}
