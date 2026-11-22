import { DatabaseSync, type StatementSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  BODY,
  SEARCH_LIMITS,
  type Hit,
  type Material,
  type MaterialHead,
  type MaterialKind,
  type MaterialType,
  type Shelf,
} from "./schema.ts";
import { key, normalize, terms, units } from "./text.ts";
import { facets, phrases } from "./search.ts";

/** How much a word counts where it is found: a name says what a material is, a
 * description only mentions what is in it. bm25 weighs the columns in this order. */
const FIELDS = { name: 10, aliases: 7, tags: 3, about: 1 } as const;
type Field = keyof typeof FIELDS;
const COLUMNS = Object.keys(FIELDS) as Field[];

/** Who may see what: the user searching, and whether they see everyone's. */
export interface Scope {
  user?: string;
  all?: boolean;
  types?: string[];
  kinds?: MaterialKind[];
  shelf?: Shelf;
  style?: string;
}
/** The words of a material each field is searched by. */
function fieldsOf(m: Pick<Material, "name" | "aliases" | "tags" | "category" | "about">) {
  const names = `${m.name.zh} ${m.name.en}`,
    aliases = m.aliases.join(" ");
  return {
    // Names also by each Chinese character, so "马" finds "奔跑的马".
    name: [...terms(names), ...characters(names)],
    aliases: [...terms(aliases), ...characters(aliases)],
    tags: terms(`${m.tags.join(" ")} ${m.category.replace(/[/_-]/g, " ")}`),
    about: terms(m.about),
  } satisfies Record<Field, string[]>;
}
/** Each Chinese character of a text that is not a word on its own. */
const characters = (text: string) =>
  [...text.matchAll(/[㐀-鿿豈-﫿]{2,}/g)].flatMap(([run]) => [...run]);
/** Splits a material into what is searched and listed (its head) and what only reading it
 * in full needs (its body). */
export function split(m: Material): { head: MaterialHead; body: Record<string, unknown> } {
  const fields = (BODY as Record<string, readonly string[]>)[m.kind] ?? [];
  const head: Record<string, unknown> = {},
    body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) (fields.includes(k) ? body : head)[k] = v;
  return { head: head as MaterialHead, body };
}
interface Row {
  n: number;
  head: string;
  owner: string | null;
  status: string;
  uses: number;
  version: number;
}
const parse = (r: Row): MaterialHead => ({
  ...JSON.parse(r.head),
  owner: r.owner,
  status: r.status,
  uses: r.uses,
  version: r.version,
});
/** An FTS5 query matching any of the words, each taken literally. */
const anyOf = (words: string[]) => words.map((w) => `"${w.replaceAll('"', '""')}"`).join(" OR ");

/** The library's records on disk: every material's current head and body, its earlier
 * versions, and a persistent index to search them by. Nothing is held in memory but the
 * prepared statements, so the library may grow without the process growing with it. */
export class Catalog {
  readonly db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    // A library kept before material packs holds every material as one JSON column; it is
    // set aside here and what users made is carried over once the new tables exist.
    const legacy = (this.db.prepare("PRAGMA table_info(materials)").all() as { name: string }[]).some(
      (c) => c.name === "data",
    );
    if (legacy) this.db.exec("ALTER TABLE materials RENAME TO legacy_materials");
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS materials(
  n INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  type TEXT NOT NULL,
  style TEXT,
  owner TEXT,
  maker TEXT,
  status TEXT NOT NULL,
  source TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  head TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS materials_shelf ON materials(kind, owner, created);
-- Pages are read along these, without visiting the rows they skip.
CREATE INDEX IF NOT EXISTS materials_page ON materials(created, n, owner, status, maker, kind, type);
CREATE INDEX IF NOT EXISTS materials_kind_page ON materials(kind, created, n, owner, status, maker, type);
CREATE INDEX IF NOT EXISTS materials_type ON materials(type, owner, created);
CREATE INDEX IF NOT EXISTS materials_style ON materials(style, kind, owner, status, uses);
CREATE INDEX IF NOT EXISTS materials_source ON materials(source);
CREATE TABLE IF NOT EXISTS versions(id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL,
  head TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(id, version));
CREATE TABLE IF NOT EXISTS names(key TEXT NOT NULL, n INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS names_key ON names(key);
CREATE INDEX IF NOT EXISTS names_n ON names(n);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(name, aliases, tags, about,
  tokenize='unicode61 remove_diacritics 0');
CREATE TABLE IF NOT EXISTS df(term TEXT PRIMARY KEY, n INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS thesaurus(key TEXT NOT NULL, grp TEXT NOT NULL, source TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS thesaurus_key ON thesaurus(key);
CREATE INDEX IF NOT EXISTS thesaurus_grp ON thesaurus(grp);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS types(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uses(material_id TEXT NOT NULL, user_id TEXT NOT NULL, work_id TEXT NOT NULL,
  at INTEGER NOT NULL, PRIMARY KEY(material_id, user_id, work_id));
CREATE TABLE IF NOT EXISTS blobs(hash TEXT PRIMARY KEY, media TEXT NOT NULL, bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS data(name TEXT PRIMARY KEY, blob TEXT NOT NULL, media TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bindings(capability TEXT PRIMARY KEY, material TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS releases(source TEXT NOT NULL, release TEXT NOT NULL, digest TEXT NOT NULL,
  at INTEGER NOT NULL, items TEXT NOT NULL, data TEXT NOT NULL, bindings TEXT NOT NULL, thesaurus TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(source, release));`);
    if (legacy) this.migrate();
  }
  close() {
    this.db.close();
  }
  /** Carries the pictures users uploaded and generated over from a library kept before
   * material packs, with who owns them, how they stand and how often they are used. Curated
   * materials are left behind: they come back, versioned, when a pack is imported. */
  private migrate() {
    this.transaction(() => {
      const rows = this.db.prepare("SELECT data FROM legacy_materials").all() as { data: string }[];
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM uses WHERE material_id=?");
      for (const { data } of rows) {
        const old = JSON.parse(data) as Material & { role?: string };
        if (old.origin?.kind === "curated" || old.kind !== "picture") continue;
        const { role, ...rest } = old;
        const m = {
          ...rest,
          type: old.type ?? role ?? "object",
          version: 1,
          pack: null,
          uses: Number((count.get(old.id) as { n: number }).n),
        } as Material;
        this.put({ ...m, hash: createHash("sha256").update(data).digest("hex").slice(0, 32) });
      }
      this.db.exec("DROP TABLE legacy_materials");
    });
  }
  /** One prepared statement per query text, kept for the life of the catalog. */
  sql(text: string) {
    let s = this.statements.get(text);
    if (!s) this.statements.set(text, (s = this.db.prepare(text)));
    return s;
  }
  /** Runs `fn` in one transaction, or inside the one already open. */
  transaction<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  get size() {
    return Number(this.sql("SELECT value FROM meta WHERE key='count'").get()?.value ?? 0);
  }

  // —— records ——
  private row(id: string) {
    return this.sql("SELECT n, head, owner, status, uses, version FROM materials WHERE id=?").get(id) as
      | Row
      | undefined;
  }
  /** A material's current head, whoever may see it. */
  head(id: string): MaterialHead | undefined {
    const r = this.row(id);
    return r && parse(r);
  }
  /** A material in full, current or at a version it had. */
  full(id: string, version?: number): Material | undefined {
    const r = this.row(id);
    if (!r) return undefined;
    const at = version ?? r.version;
    const v = this.sql("SELECT head, body FROM versions WHERE id=? AND version=?").get(id, at) as
      | { head: string; body: string }
      | undefined;
    if (!v) return undefined;
    // An earlier version keeps its own content but today's standing: who owns it, how
    // used it is, whether it is still offered.
    const { error } = JSON.parse(r.head) as { error?: string };
    return {
      ...JSON.parse(v.head),
      ...JSON.parse(v.body),
      ...(error ? { error } : {}),
      owner: r.owner,
      status: r.status,
      uses: r.uses,
      version: at,
    } as Material;
  }
  /** The version of a material that had this content, if one did. */
  versionWith(id: string, hash: string) {
    return (this.sql("SELECT MAX(version) AS v FROM versions WHERE id=? AND hash=?").get(id, hash) as { v: number | null }).v ?? undefined;
  }
  /** The highest version a material ever had. */
  latestVersion(id: string) {
    return Number((this.sql("SELECT MAX(version) AS v FROM versions WHERE id=?").get(id) as { v: number | null }).v ?? 0);
  }
  versionHash(id: string, version: number) {
    return (this.sql("SELECT hash FROM versions WHERE id=? AND version=?").get(id, version) as { hash: string } | undefined)
      ?.hash;
  }
  /** Stores a material as its current version, indexing it again when its words changed.
   * `version` is the material's own; a new version is kept beside the earlier ones. */
  put(m: Material) {
    const { head, body } = split(m);
    const { owner, status, uses, version, ...rest } = head as MaterialHead;
    const headText = JSON.stringify(rest);
    return this.transaction(() => {
      const old = this.row(m.id);
      this.sql(
        "INSERT INTO versions VALUES(?,?,?,?,?,?) ON CONFLICT(id, version) DO UPDATE SET hash=excluded.hash, head=excluded.head, body=excluded.body",
      ).run(m.id, version, m.hash, headText, JSON.stringify(body), Date.now());
      if (old) {
        const before = JSON.parse(old.head) as Material;
        this.sql(
          "UPDATE materials SET version=?, kind=?, type=?, style=?, owner=?, maker=?, status=?, source=?, uses=?, head=? WHERE n=?",
        ).run(version, m.kind, m.type, m.style, owner, m.origin.user ?? null, status, m.pack, uses, headText, old.n);
        if (JSON.stringify(fieldsOf(before)) !== JSON.stringify(fieldsOf(m)) || !sameNames(before, m)) {
          this.unindex(old.n, before);
          this.index(old.n, m);
        }
        return old.n;
      }
      const { lastInsertRowid } = this.sql(
        "INSERT INTO materials(id, version, kind, type, style, owner, maker, status, source, uses, created, head) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(m.id, version, m.kind, m.type, m.style, owner, m.origin.user ?? null, status, m.pack, uses, m.origin.createdAt, headText);
      const n = Number(lastInsertRowid);
      this.index(n, m);
      this.sql("INSERT INTO meta VALUES('count', '1') ON CONFLICT(key) DO UPDATE SET value=value+1").run();
      return n;
    });
  }
  /** Changes how a material stands without touching its content. */
  stand(id: string, change: { owner?: string | null; status?: Material["status"]; uses?: number; error?: string }) {
    const r = this.row(id);
    if (!r) return;
    if ("owner" in change) this.sql("UPDATE materials SET owner=? WHERE n=?").run(change.owner ?? null, r.n);
    if (change.status) this.sql("UPDATE materials SET status=? WHERE n=?").run(change.status, r.n);
    if (change.uses !== undefined) this.sql("UPDATE materials SET uses=? WHERE n=?").run(change.uses, r.n);
    if (change.error !== undefined) {
      const head = { ...JSON.parse(r.head), error: change.error };
      this.sql("UPDATE materials SET head=? WHERE n=?").run(JSON.stringify(head), r.n);
    }
  }
  private index(n: number, m: Material) {
    const f = fieldsOf(m);
    this.sql("INSERT INTO search(rowid, name, aliases, tags, about) VALUES(?,?,?,?,?)").run(
      n,
      f.name.join(" "),
      f.aliases.join(" "),
      f.tags.join(" "),
      f.about.join(" "),
    );
    for (const t of new Set(Object.values(f).flat()))
      this.sql("INSERT INTO df VALUES(?, 1) ON CONFLICT(term) DO UPDATE SET n=n+1").run(t);
    for (const k of new Set([m.name.zh, m.name.en, ...m.aliases].map(key)))
      if (k) this.sql("INSERT INTO names VALUES(?,?)").run(k, n);
  }
  private unindex(n: number, m: Material) {
    this.sql("DELETE FROM search WHERE rowid=?").run(n);
    for (const t of new Set(Object.values(fieldsOf(m)).flat()))
      this.sql("UPDATE df SET n=n-1 WHERE term=?").run(t);
    this.sql("DELETE FROM df WHERE n<=0").run();
    this.sql("DELETE FROM names WHERE n=?").run(n);
  }

  // —— who sees what ——
  /** The conditions a viewer's scope puts on rows of `materials` named `m`. */
  private where(scope: Scope) {
    const clauses = [
      "m.status NOT IN ('failed', 'withdrawn')",
      "(m.owner IS NULL OR m.owner = :user OR :all)",
      "(m.status = 'ready' OR m.maker = :user)",
    ];
    const params: Record<string, string | number | null> = { user: scope.user ?? null, all: scope.all ? 1 : 0 };
    const list = (name: string, values: string[]) => {
      values.forEach((v, i) => (params[`${name}${i}`] = v));
      return values.map((_, i) => `:${name}${i}`).join(",");
    };
    if (scope.types?.length) clauses.push(`m.type IN (${list("type", scope.types)})`);
    if (scope.kinds?.length) clauses.push(`m.kind IN (${list("kind", scope.kinds)})`);
    if (scope.shelf === "public") clauses.push("m.owner IS NULL");
    if (scope.shelf === "mine") clauses.push("m.owner = :user");
    if (scope.shelf === "others") clauses.push("m.owner IS NOT NULL AND m.owner != COALESCE(:user, '')");
    return { sql: clauses.join(" AND "), params };
  }
  /** Whether a viewer may see a material at all, whatever its standing. */
  visible(m: Pick<MaterialHead, "owner">, scope: Scope) {
    return m.owner === null || m.owner === scope.user || !!scope.all;
  }

  // —— search ——
  private df(words: string[]) {
    const out = new Map<string, number>();
    for (const w of words) {
      const r = this.sql("SELECT n FROM df WHERE term=?").get(w) as { n: number } | undefined;
      if (r) out.set(w, r.n);
    }
    return out;
  }
  /** Phrases of the request a material source's thesaurus knows, each with the phrases it
   * gives as the same thing ("库存" → "仓库", "warehouse"). */
  private synonyms(text: string) {
    const out: { phrase: string; alts: string[] }[] = [];
    for (const p of phrases(text)) {
      const groups = this.sql("SELECT grp FROM thesaurus WHERE key=?").all(p) as { grp: string }[];
      if (!groups.length) continue;
      const alts = new Set<string>();
      for (const { grp } of groups)
        for (const { key: k } of this.sql("SELECT key FROM thesaurus WHERE grp=? LIMIT 16").all(grp) as { key: string }[])
          if (k !== p) alts.add(k);
      if (alts.size) out.push({ phrase: p, alts: [...alts] });
    }
    return out.slice(0, 12);
  }
  setThesaurus(source: string, groups: string[][]) {
    this.sql("DELETE FROM thesaurus WHERE source=?").run(source);
    groups.forEach((g, i) => {
      for (const phrase of new Set(g.map((w) => normalize(w).replace(/\s+/g, " ").trim()).filter(Boolean)))
        this.sql("INSERT INTO thesaurus VALUES(?,?,?)").run(phrase, `${source}:${i}`, source);
    });
  }
  /** One subject's hits, best first. Exact names are found through their own index, the
   * rest through the full-text index, with what the thesaurus gives as the same thing; either
   * way only a bounded number of candidates is read, after the viewer's scope has been
   * applied, and weighed again here: how much of the request a material answers, in which of
   * its words, and whether it meets the conditions stated (a cut-out, a side view). */
  search(subject: string, scope: Scope, limit: number): { hits: Hit[]; unknown: string[] } {
    const { rest, facets: conditions } = facets(subject);
    const wanted = [...new Set(terms(rest, true))];
    const synonyms = this.synonyms(rest).map((s) => ({
      terms: [...new Set(terms(s.phrase, true))],
      alts: s.alts.map((a) => [...new Set(terms(a, true))]).filter((a) => a.length),
      keys: s.alts.map(key),
      whole: key(s.phrase) === key(rest),
    }));
    const altTerms = [...new Set(synonyms.flatMap((s) => s.alts.flat()))].slice(0, 48);
    const df = this.df([...new Set([...wanted, ...altTerms])]);
    const known = wanted.filter((t) => df.has(t));
    // A word no material has and no synonym explains can only count against a material.
    const explained = new Set(synonyms.flatMap((s) => s.terms));
    const unknown = wanted.filter((t) => !df.has(t) && !explained.has(t));
    const exactKey = key(rest);
    const retrieval = [...new Set([...known, ...altTerms.filter((t) => df.has(t))])];
    if (!retrieval.length && !exactKey) return { hits: [], unknown };
    const { sql: where, params } = this.where(scope);
    const cap = SEARCH_LIMITS.candidates;
    const rows = new Map<number, Row>();
    /** Candidates by name and by words, within `extra` conditions, a bounded number each. */
    const gather = (extra: string, more: Record<string, string>) => {
      const byName = (k: string) => {
        for (const r of this.sql(
          `SELECT m.n, m.head, m.owner, m.status, m.uses, m.version FROM names x JOIN materials m ON m.n = x.n WHERE x.key = :key AND ${where}${extra} LIMIT ${cap}`,
        ).all({ ...params, ...more, key: k }) as unknown as Row[])
          rows.set(r.n, r);
      };
      if (exactKey) byName(exactKey);
      for (const s of synonyms) if (s.whole) s.keys.forEach(byName);
      if (retrieval.length)
        for (const r of this.sql(
          `SELECT m.n, m.head, m.owner, m.status, m.uses, m.version FROM search s JOIN materials m ON m.n = s.rowid
           WHERE search MATCH :q AND ${where}${extra} ORDER BY bm25(search, ${Object.values(FIELDS).join(", ")}) LIMIT ${cap}`,
        ).all({ ...params, ...more, q: anyOf(retrieval) }) as unknown as Row[])
          rows.set(r.n, r);
    };
    // The style asked for is gathered on its own first, so however many materials of other
    // styles match as well, its own are among those weighed.
    if (scope.style) gather(" AND (m.style = :style OR m.style IS NULL)", { style: scope.style });
    gather("", {});
    const total = Math.max(1, this.size);
    const idf = (t: string) => Math.log(1 + total / (df.get(t) ?? 0.5));
    const sum = (ts: Iterable<string>) => [...ts].reduce((s, t) => s + idf(t), 0);
    const allWeight = sum(wanted) || 1;
    const hopeless = new Set(unknown);
    const reachable = sum(wanted.filter((t) => !hopeless.has(t))) || 1;
    const parts = units(rest);
    const hits: Hit[] = [];
    for (const r of rows.values()) {
      const m = parse(r);
      const f = fieldsOf(m);
      const sets = Object.fromEntries(COLUMNS.map((c) => [c, new Set(f[c])])) as Record<Field, Set<string>>;
      /** The weight of the best field holding every one of `ts`, or 0. */
      const holds = (ts: string[]) => {
        let best = 0;
        for (const c of COLUMNS) if (FIELDS[c] > best && ts.every((t) => sets[c].has(t))) best = FIELDS[c];
        return best;
      };
      const nameKeys = new Set([m.name.zh, m.name.en].map(key));
      const aliasKeys = new Set(m.aliases.map(key));
      const byOwnName = !!exactKey && nameKeys.has(exactKey);
      const byAlias = !byOwnName && !!exactKey && aliasKeys.has(exactKey);
      const bySynonym =
        !byOwnName && !byAlias && synonyms.some((s) => s.whole && s.keys.some((k) => nameKeys.has(k) || aliasKeys.has(k)));
      let weight = 0,
        named = false;
      const covered = new Map<string, number>();
      for (const t of known) {
        const w = holds([t]);
        if (!w) continue;
        covered.set(t, w);
        // One character in a longer name ("马" in "马蹄形磁铁") does not name the thing.
        if (w >= FIELDS.aliases && t.length > 1) named = true;
      }
      let viaSynonym = false;
      // A phrase the material does not have in its own words may be there as a synonym.
      for (const s of synonyms) {
        if (s.terms.every((t) => covered.has(t))) continue;
        const w = Math.max(0, ...s.alts.map(holds)) * 0.8;
        if (!w) continue;
        for (const t of s.terms) if (!covered.has(t) || covered.get(t)! < w) covered.set(t, w);
        viaSynonym = true;
      }
      for (const [t, w] of covered) weight += idf(t) * w;
      const coverage = sum(covered.keys()) / reachable;
      const spanned = parts.filter((p) => p.some((t) => covered.has(t))).length / Math.max(1, parts.length);
      const direct = byOwnName || byAlias || bySynonym;
      if (!direct && coverage < 0.5) continue;
      const meets = conditions.every((c) => c.check(m));
      const full = sum(covered.keys()) / allWeight > 0.999;
      const match: Hit["match"] = !meets
        ? "related"
        : byOwnName
          ? "exact"
          : byAlias || bySynonym || (full && spanned >= 0.75 && named && !viaSynonym)
            ? "close"
            : "related";
      let score = (weight / allWeight) * coverage + (byOwnName ? 20 : byAlias ? 12 : bySynonym ? 9 : 0);
      if (!meets) score *= 0.6;
      if (scope.user && m.owner === scope.user) score *= 1.1;
      score *= 1 + 0.05 * Math.log1p(m.uses);
      hits.push({ material: m, score: Math.round(score * 100) / 100, match });
    }
    // Among materials of the thing itself, the requested style comes first: a crayon planet
    // serves a crayon work better than an icon named exactly "planet".
    const tier = (h: Hit) =>
      (h.match === "related" ? 0 : 2) +
      (scope.style && (h.material.style === scope.style || h.material.style === null) ? 1 : 0);
    return {
      hits: hits.sort((a, b) => tier(b) - tier(a) || b.score - a.score).slice(0, limit),
      unknown,
    };
  }
  /** A page of what a viewer may see: by a query's relevance, or newest first. The page is
   * read from the database, so a later page costs what the first does. */
  browse(query: string, scope: Scope, page: number, size: number) {
    const { sql: where, params } = this.where(scope);
    const words = [...new Set(terms(query, true))];
    if (query.trim() && !words.length) return { items: [], total: 0 };
    const offset = (page - 1) * size;
    if (!words.length) {
      // The viewer's own come first, then the rest, each newest first: two ranges an index
      // reads in order, so a deep page costs a walk along the index, not a sort of all.
      const count = (extra: string) =>
        Number((this.sql(`SELECT COUNT(*) AS c FROM materials m WHERE ${where} AND ${extra}`).get(params) as { c: number }).c);
      const page = (extra: string, limit: number, skip: number) =>
        limit <= 0
          ? []
          : (this.sql(
              `SELECT m.n, m.head, m.owner, m.status, m.uses, m.version FROM materials m WHERE ${where} AND ${extra}
               ORDER BY m.created DESC, m.n DESC LIMIT :size OFFSET :offset`,
            ).all({ ...params, size: limit, offset: skip }) as unknown as Row[]);
      const mine = "m.owner IS NOT NULL AND m.owner = COALESCE(:user, '')",
        rest = "(m.owner IS NULL OR m.owner != COALESCE(:user, ''))";
      const own = scope.user ? count(mine) : 0;
      const total = own + count(rest);
      const first = page(mine, Math.min(size, own - offset), offset);
      const rows = [...first, ...page(rest, size - first.length, Math.max(0, offset - own))];
      return { items: rows.map(parse), total };
    }
    // Every word must be there, as a person filtering a shelf expects.
    const q = words.map((w) => `"${w.replaceAll('"', '""')}"`).join(" AND ");
    const total = Number(
      (
        this.sql(`SELECT COUNT(*) AS c FROM search s JOIN materials m ON m.n = s.rowid WHERE search MATCH :q AND ${where}`).get({
          ...params,
          q,
        }) as { c: number }
      ).c,
    );
    const rows = this.sql(
      `SELECT m.n, m.head, m.owner, m.status, m.uses, m.version FROM search s JOIN materials m ON m.n = s.rowid
       WHERE search MATCH :q AND ${where}
       ORDER BY EXISTS(SELECT 1 FROM names x WHERE x.n = m.n AND x.key = :key) DESC,
         bm25(search, ${Object.values(FIELDS).join(", ")}), m.n LIMIT :size OFFSET :offset`,
    ).all({ ...params, q, key: key(query), size, offset }) as unknown as Row[];
    return { items: rows.map(parse), total };
  }
  /** A style's public pictures, most used first, a few at most. */
  styleSamples(style: string, limit: number) {
    return (
      this.sql(
        `SELECT id FROM materials WHERE style=? AND kind='picture' AND owner IS NULL AND status='ready' ORDER BY uses DESC, n LIMIT ?`,
      ).all(style, limit) as { id: string }[]
    ).map((r) => r.id);
  }
  styleCount(style: string) {
    return Number(
      (
        this.sql(
          `SELECT COUNT(*) AS c FROM materials WHERE style=? AND kind='picture' AND owner IS NULL AND status='ready'`,
        ).get(style) as { c: number }
      ).c,
    );
  }

  // —— types, bindings, uses ——
  types(): MaterialType[] {
    return (this.sql("SELECT data FROM types ORDER BY id").all() as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  type(id: string): MaterialType | undefined {
    const r = this.sql("SELECT data FROM types WHERE id=?").get(id) as { data: string } | undefined;
    return r && JSON.parse(r.data);
  }
  putType(t: MaterialType) {
    this.sql("INSERT INTO types VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, data=excluded.data").run(
      t.id,
      t.kind,
      JSON.stringify(t),
    );
  }
  use(id: string, user: string, work: string) {
    const r = this.row(id);
    if (!r) return;
    const added = this.sql("INSERT OR IGNORE INTO uses VALUES(?,?,?,?)").run(id, user, work, Date.now()).changes;
    if (added) this.sql("UPDATE materials SET uses=uses+1 WHERE n=?").run(r.n);
  }
}
const sameNames = (a: Material, b: Material) =>
  JSON.stringify([a.name, a.aliases]) === JSON.stringify([b.name, b.aliases]);
