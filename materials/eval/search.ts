// Measures the library's search against a fixed set of labelled requests: whether what is
// wanted is found (recall@k, reciprocal rank), whether nothing is offered for what the
// library does not have, whether a partial match is passed off as the thing itself, and
// how long a search takes.
//
//   tsx materials/eval/search.ts <library data dir> [out.json]
//
// The library is opened as it stands; import a pack into it first.
import { readFileSync, writeFileSync } from "node:fs";
import { Library } from "../library.ts";
import type { MaterialKind } from "../schema.ts";

export interface Query {
  q: string;
  relevant: string[];
  group: string;
  types?: string[];
  notClose?: string[];
}
export interface Engine {
  search(q: string, types: string[] | undefined, limit: number): { id: string; match: string }[];
}
const kinds = new Set<string>(["drawing", "effect", "style"]);
export function evaluate(engine: Engine, queries: Query[], k = 5) {
  const rows = queries.map((query) => {
    // Warm once, then time the best of a few, as the result is the same each time.
    engine.search(query.q, query.types, k);
    const times: number[] = [];
    let hits: { id: string; match: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      hits = engine.search(query.q, query.types, k);
      times.push(performance.now() - t);
    }
    const ids = hits.map((h) => h.id);
    const rank = ids.findIndex((id) => query.relevant.includes(id)) + 1;
    const direct = hits.filter((h) => h.match !== "related");
    return {
      ...query,
      hits: hits.map((h) => `${h.id}:${h.match}`),
      found: rank > 0,
      rr: rank ? 1 / rank : 0,
      // Precision of the top hits among those the request has relevant answers for.
      precision: query.relevant.length ? ids.filter((id) => query.relevant.includes(id)).length / Math.max(1, Math.min(k, ids.length)) : null,
      // Offered as the thing itself, though it is not.
      falseDirect: direct.filter((h) => !query.relevant.includes(h.id) || query.notClose?.includes(h.id)).length,
      empty: !hits.length,
      ms: Math.min(...times),
    };
  });
  const answerable = rows.filter((r) => r.relevant.length);
  const absent = rows.filter((r) => !r.relevant.length);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))];
  const groups = Object.fromEntries(
    [...new Set(rows.map((r) => r.group))].map((g) => {
      const of = rows.filter((r) => r.group === g && r.relevant.length);
      return [g, { n: of.length, recall: mean(of.map((r) => +r.found)), mrr: mean(of.map((r) => r.rr)) }];
    }),
  );
  return {
    summary: {
      queries: rows.length,
      [`recall@${k}`]: mean(answerable.map((r) => +r.found)),
      mrr: mean(answerable.map((r) => r.rr)),
      [`precision@${k}`]: mean(answerable.map((r) => r.precision!)),
      noResultWhenAnswerable: mean(answerable.map((r) => +r.empty)),
      offeredForAbsent: mean(absent.map((r) => +!r.empty)),
      directForAbsent: mean(absent.map((r) => +(r.falseDirect > 0))),
      falseDirectPerQuery: mean(rows.map((r) => r.falseDirect)),
      p50ms: pct(50),
      p95ms: pct(95),
      maxms: ms.at(-1),
      groups,
    },
    rows,
  };
}
/** This library's engine. */
export const engineOf = (library: Library): Engine => ({
  search: (q, types, limit) =>
    library
      .search({ subjects: [q], limit, ...(types?.length ? { types } : {}) })[0]
      .hits.map((h) => ({ id: h.material.id, match: h.match })),
});
/** Requests a type the old library knew only as a kind. */
export const kindsOf = (types?: string[]) => types?.filter((t) => kinds.has(t)) as MaterialKind[] | undefined;

if (import.meta.main) {
  const [dir, out] = process.argv.slice(2);
  // A third argument names another query set: heldout.
  const queries = JSON.parse(readFileSync(new URL(`./${process.argv[4] || "queries"}.json`, import.meta.url), "utf8")) as Query[];
  const library = new Library(dir);
  const result = evaluate(engineOf(library), queries);
  console.log(JSON.stringify(result.summary, null, 1));
  if (out) writeFileSync(out, JSON.stringify(result, null, 1));
  library.close();
}
