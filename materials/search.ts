import type { Hit, Material, MaterialKind, Role } from "./schema.ts";
import { key, terms, units } from "./text.ts";

/** How much a word counts where it is found: a name says what a picture is, a description
 * only mentions what is in it. */
const FIELDS = {
  name: 10,
  aliases: 7,
  tags: 3,
  category: 2,
  about: 1,
} as const;
type Field = keyof typeof FIELDS;
interface Entry {
  material: Material;
  fields: Record<Field, Set<string>>;
  /** Its names and aliases as exact keys. */
  names: Set<string>;
}
export interface Scope {
  /** The user searching; their private materials are included. */
  user?: string;
  /** Everyone's private materials are included too. */
  all?: boolean;
  style?: string;
  kinds?: MaterialKind[];
  /** Picture roles to keep; other kinds pass. */
  roles?: Role[];
}
/** Public and the user's own materials (everyone's, for one who sees all); a picture
 * still developing only to its maker. */
const visible = (m: Material, scope: Scope) =>
  m.status !== "failed" &&
  (m.owner === null || m.owner === scope.user || !!scope.all) &&
  (m.status === "ready" || (!!scope.user && m.origin.user === scope.user));

/** An in-memory index over every material, ranked by field-weighted term rarity. */
export class Index {
  private entries = new Map<string, Entry>();
  private df = new Map<string, number>();
  get size() {
    return this.entries.size;
  }
  put(material: Material) {
    this.remove(material.id);
    const fields: Entry["fields"] = {
      name: new Set(terms(`${material.name.zh} ${material.name.en}`)),
      aliases: new Set(terms(material.aliases.join(" "))),
      tags: new Set(terms(material.tags.join(" "))),
      category: new Set(terms(material.category.replace(/[/_-]/g, " "))),
      about: new Set(terms(material.about)),
    };
    const entry: Entry = {
      material,
      fields,
      names: new Set(
        [material.name.zh, material.name.en, ...material.aliases].map(key),
      ),
    };
    for (const t of this.vocabulary(entry))
      this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.entries.set(material.id, entry);
  }
  remove(id: string) {
    const old = this.entries.get(id);
    if (!old) return;
    for (const t of this.vocabulary(old)) {
      const n = this.df.get(t)! - 1;
      if (n) this.df.set(t, n);
      else this.df.delete(t);
    }
    this.entries.delete(id);
  }
  get(id: string) {
    return this.entries.get(id)?.material;
  }
  all(scope: Scope = {}) {
    return [...this.entries.values()]
      .map((e) => e.material)
      .filter((m) => visible(m, scope));
  }
  private vocabulary(e: Entry) {
    return new Set(Object.values(e.fields).flatMap((s) => [...s]));
  }
  private idf(t: string) {
    return Math.log(1 + this.entries.size / (this.df.get(t) ?? 1));
  }
  /** Pictures of one subject, best first. Words no material contains are ignored, so a
   * qualifier the library has never heard of does not hide the thing itself. */
  search(subject: string, scope: Scope, limit: number): Hit[] {
    const wanted = [...new Set(terms(subject, true))].filter((t) =>
      this.df.has(t),
    );
    if (!wanted.length) return [];
    const exact = key(subject);
    const total = wanted.reduce((sum, t) => sum + this.idf(t), 0);
    const parts = units(subject);
    const hits: Hit[] = [];
    for (const e of this.entries.values()) {
      const m = e.material;
      if (!visible(m, scope)) continue;
      if (scope.kinds?.length && !scope.kinds.includes(m.kind)) continue;
      if (
        scope.roles?.length &&
        m.kind === "picture" &&
        !scope.roles.includes(m.role)
      )
        continue;
      let matched = 0,
        weight = 0,
        named = false;
      for (const t of wanted) {
        let best = 0;
        for (const f of Object.keys(FIELDS) as Field[])
          if (e.fields[f].has(t) && FIELDS[f] > best) {
            best = FIELDS[f];
            if (f === "name" || f === "aliases") named = true;
          }
        if (!best) continue;
        const idf = this.idf(t);
        matched += idf;
        weight += idf * best;
      }
      const coverage = matched / total;
      if (coverage < 0.5) continue;
      const isExact = e.names.has(exact);
      // Close means nearly every part of the request is in this picture's own words: "订单
      // 服务" is not close to a service bell, nor "青苹果" to a red apple.
      const found = new Set(
        wanted.filter((t) =>
          (Object.keys(FIELDS) as Field[]).some((f) => e.fields[f].has(t)),
        ),
      );
      const spanned =
        parts.filter((p) => p.some((t) => found.has(t))).length /
        Math.max(1, parts.length);
      const match: Hit["match"] = isExact
        ? "exact"
        : coverage > 0.999 && spanned >= 0.75 && named
          ? "close"
          : "related";
      let score = (weight / total) * coverage + (isExact ? 20 : 0);
      if (scope.user && m.owner === scope.user) score *= 1.1;
      score *= 1 + 0.05 * Math.log1p(m.uses);
      hits.push({ material: m, score: Math.round(score * 100) / 100, match });
    }
    // Among pictures of the thing itself, the requested style comes first: a crayon planet
    // serves a crayon work better than an icon named exactly "planet".
    const tier = (h: Hit) =>
      (h.match === "related" ? 0 : 2) +
      (scope.style &&
      (h.material.style === scope.style || h.material.style === null)
        ? 1
        : 0);
    return hits
      .sort((a, b) => tier(b) - tier(a) || b.score - a.score)
      .slice(0, limit);
  }
}
