import { z } from "zod";

/* The data a drawing reads, declared as a schema. Drawing code is the author's, so the app
 * knows nothing of a drawing but this: what its data holds, what each value is called, how
 * a list's items are made and referred to. The editor builds its controls from it, the
 * workspace checks writes against it, and the library's packs carry it for every drawing.
 * Library parameters and a work's own drawings declare data the same way; this file is
 * shared by the library package and the app's protocol so both read one definition. */

export const fieldNamesSchema = z.object({ zh: z.string().min(1), en: z.string().min(1) });
export type FieldNames = z.infer<typeof fieldNamesSchema>;

/** What Enter or Tab makes after an item of a list: a copy keeping some fields, two fields
 * swapped (a reply runs back), and values set. */
export interface NextRule {
  keep?: string[];
  swap?: [string, string];
  set?: Record<string, unknown>;
}
interface Base {
  /** What a person editing the work calls it. */
  label?: FieldNames;
  /** Offered right beside the selection, not only in the panel. */
  quick?: boolean;
  /** What it means, for the author. */
  description?: string;
}
export interface ChoiceOption {
  value: string;
  label?: FieldNames;
  /** A glyph the editor draws beside it, by name. */
  icon?: string;
}
export type Field = Base &
  (
    | { type: "text"; long?: boolean }
    | { type: "number"; min?: number; max?: number; step?: number; unit?: string }
    | { type: "color" }
    | { type: "boolean" }
    | { type: "picture" }
    | { type: "effect" }
    | { type: "choice"; options: ChoiceOption[] }
    | { type: "id" }
    | { type: "ref"; to: string }
    | {
        type: "list";
        item: Field;
        /** The field of an item record that names it, read for references by name. */
        title?: string;
        /** What a new item starts as. */
        new?: unknown;
        min?: number;
        max?: number;
        /** References to this list's items, as `list.field`, whose items go when the item
         * they refer to goes. */
        cascade?: string[];
        next?: { enter?: NextRule; tab?: NextRule };
      }
    | {
        type: "record";
        fields: Record<string, Field>;
        /** What any other key holds, for a record keyed by names (a map's renamings). */
        rest?: Field;
      }
    | { type: "tree"; fields: Record<string, Field>; children?: string; title?: string }
    /** A place on Earth: [lon, lat], or an item of the list `to` names, by id. */
    | { type: "geo"; to?: string }
    /** A table cell: words, a number, a tick (true), a dash (false), or nothing. */
    | { type: "cell" }
  );
export type FieldType = Field["type"];
export type Fields = Record<string, Field>;
/** The kinds of value one control changes; the rest hold other values. */
export const plainTypes = ["text", "number", "boolean", "color", "picture", "effect", "choice"] as const;
export type PlainType = (typeof plainTypes)[number];
export const isPlain = (f: Field): f is Extract<Field, { type: PlainType }> =>
  (plainTypes as readonly string[]).includes(f.type);

const base = {
  label: fieldNamesSchema.optional().describe("What a person editing the work calls it: {zh, en}"),
  quick: z.boolean().optional().describe("Offer it beside the selection"),
  description: z.string().optional(),
};
const nextRule = z
  .object({
    keep: z.array(z.string()).optional(),
    swap: z.tuple([z.string(), z.string()]).optional(),
    set: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const fieldsRecord = (): z.ZodType<Fields> => z.record(z.string(), fieldSchema);
export const fieldSchema: z.ZodType<Field> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ ...base, type: z.literal("text"), long: z.boolean().optional() }).strict(),
    z
      .object({
        ...base,
        type: z.literal("number"),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().positive().optional(),
        unit: z.string().optional(),
      })
      .strict(),
    z.object({ ...base, type: z.literal("color") }).strict(),
    z.object({ ...base, type: z.literal("boolean") }).strict(),
    z.object({ ...base, type: z.literal("picture") }).strict(),
    z.object({ ...base, type: z.literal("effect") }).strict(),
    z
      .object({
        ...base,
        type: z.literal("choice"),
        options: z
          .array(
            z
              .object({ value: z.string().min(1), label: fieldNamesSchema.optional(), icon: z.string().optional() })
              .strict(),
          )
          .min(2),
      })
      .strict(),
    z.object({ ...base, type: z.literal("id") }).strict(),
    z.object({ ...base, type: z.literal("ref"), to: z.string().min(1).describe("The list it refers into, by its key") }).strict(),
    z
      .object({
        ...base,
        type: z.literal("list"),
        item: fieldSchema,
        title: z.string().optional().describe("The item field that names an item"),
        new: z.unknown().optional(),
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().positive().optional(),
        cascade: z.array(z.string()).optional().describe("References to its items, as list.field, whose items go with the item"),
        next: z.object({ enter: nextRule.optional(), tab: nextRule.optional() }).strict().optional(),
      })
      .strict(),
    z.object({ ...base, type: z.literal("record"), fields: fieldsRecord(), rest: fieldSchema.optional() }).strict(),
    z
      .object({
        ...base,
        type: z.literal("tree"),
        fields: fieldsRecord(),
        children: z.string().optional(),
        title: z.string().optional(),
      })
      .strict(),
    z.object({ ...base, type: z.literal("geo"), to: z.string().min(1).optional() }).strict(),
    z.object({ ...base, type: z.literal("cell") }).strict(),
  ]),
);
export const fieldsSchema = fieldsRecord();

/** Every field a schema declares, however deep, with where it is: the key path through
 * records, lists and trees. */
export function walkFields(fields: Fields, visit: (f: Field, at: string[]) => void, at: string[] = []) {
  for (const [key, f] of Object.entries(fields)) {
    visit(f, [...at, key]);
    if (f.type === "record" || f.type === "tree") walkFields(f.fields, visit, [...at, key]);
    else if (f.type === "list") {
      visit(f.item, [...at, key, "[]"]);
      if (f.item.type === "record" || f.item.type === "tree") walkFields(f.item.fields, visit, [...at, key, "[]"]);
    }
  }
}
/** Labels missing from a schema, as key paths: every field a library pack ships names
 * itself in both languages, and so does every option of a choice. */
export function unlabelled(fields: Fields): string[] {
  const missing: string[] = [];
  walkFields(fields, (f, at) => {
    if (at.at(-1) === "[]" || f.type === "id") return;
    if (!f.label) missing.push(at.join("."));
    if (f.type === "choice") for (const o of f.options) if (!o.label) missing.push(`${at.join(".")}=${o.value}`);
  });
  return missing;
}

/* Data read by its schema. A path names a value inside a part's data: keys through records,
 * `#id` for an item of a list of records, a position for an item of any other list
 * (`messages.#m3.label`, `axes.2`). */

export type PathStep = string | number | { id: string };
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isItemId = (v: unknown): v is string => typeof v === "string" && ITEM_ID.test(v);
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function parsePath(path: string): PathStep[] {
  return path
    .split(".")
    .filter(Boolean)
    .map((s) => (s.startsWith("#") ? { id: s.slice(1) } : /^\d+$/.test(s) ? Number(s) : s));
}
export const pathOf = (steps: PathStep[]) =>
  steps.map((s) => (typeof s === "object" ? "#" + s.id : String(s))).join(".");
/** Where an item stands in a list: by id among records, else by position. */
function placeIn(list: unknown[], step: PathStep) {
  if (typeof step === "object") return list.findIndex((x) => isRec(x) && x.id === step.id);
  return typeof step === "number" ? (step < list.length ? step : -1) : -1;
}
/** The value at a path, or undefined where it leads nowhere. */
export function getAt(data: unknown, path: string | PathStep[]): unknown {
  let at: unknown = data;
  for (const step of typeof path === "string" ? parsePath(path) : path) {
    if (Array.isArray(at)) {
      const i = placeIn(at, step);
      if (i < 0) return undefined;
      at = at[i];
    } else if (isRec(at) && typeof step !== "object") at = at[String(step)];
    else return undefined;
  }
  return at;
}
export const hasPath = (data: unknown, path: string | PathStep[]) => getAt(data, path) !== undefined;
/** The data with the value at a path set (undefined takes a key out, or an item), changed
 * along the way and nothing else. Null when the path leads nowhere. */
export function setAt(data: unknown, path: string | PathStep[], value: unknown): unknown {
  const steps = typeof path === "string" ? parsePath(path) : path;
  if (!steps.length) return value;
  const [step, ...rest] = steps;
  if (Array.isArray(data)) {
    const i = placeIn(data, step);
    if (i < 0) return null;
    const inner = rest.length ? setAt(data[i], rest, value) : value;
    if (inner === null) return null;
    return inner === undefined ? data.toSpliced(i, 1) : data.with(i, inner);
  }
  if (typeof step === "object") return null;
  const record: Record<string, unknown> = isRec(data) ? { ...data } : {};
  const key = String(step);
  const inner = rest.length ? setAt(record[key], rest, value) : value;
  if (inner === null && rest.length) return null;
  if (inner === undefined) delete record[key];
  else record[key] = inner;
  return record;
}
/** The schema of the value at a path. */
export function fieldAt(fields: Fields, path: string | PathStep[]): Field | undefined {
  const steps = typeof path === "string" ? parsePath(path) : path;
  let at: Field | undefined;
  let within: Fields | undefined = fields;
  for (const step of steps) {
    if (at?.type === "list") {
      at = at.item;
      within = at.type === "record" || at.type === "tree" ? at.fields : undefined;
      continue;
    }
    if (typeof step === "object" || typeof step === "number") {
      if (at?.type === "tree") continue;
      return undefined;
    }
    if (at?.type === "tree" && step === (at.children ?? "children")) {
      at = { type: "list", item: at, title: at.title };
      continue;
    }
    const next: Field | undefined = within?.[step] ?? (at?.type === "record" ? at.rest : undefined);
    if (!next) return undefined;
    at = next;
    within = next.type === "record" || next.type === "tree" ? next.fields : undefined;
  }
  return at;
}
/** The field an item record of a list is named by: the one declared, else its first text. */
export function titleOf(list: Extract<Field, { type: "list" }>): string | undefined {
  if (list.title) return list.title;
  const item = list.item;
  if (item.type !== "record" && item.type !== "tree") return undefined;
  return Object.entries(item.fields).find(([, f]) => f.type === "text")?.[0];
}
const isRecordList = (f: Field): f is Extract<Field, { type: "list" }> =>
  f.type === "list" && (f.item.type === "record" || f.item.type === "tree");

/** A short id from what an item says: its title in Latin letters, else a hash of it. */
function idFrom(content: unknown, taken: Set<string>, prefix: string) {
  const words = typeof content === "string" ? content : JSON.stringify(content ?? "");
  const latin = words
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  let hash = 0;
  for (const ch of words) hash = (Math.imul(hash, 31) + ch.codePointAt(0)!) >>> 0;
  const base = latin.length >= 2 && latin.length * 2 >= words.length ? latin : prefix + hash.toString(36).slice(0, 5);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
/** Something wrong with data, where it is. */
export interface DataProblem {
  at: string;
  problem: string;
}
/** The tree node fields with its children list declared, so a tree reads as nested lists. */
const nodeFields = (t: Extract<Field, { type: "tree" }>): Fields => ({
  ...t.fields,
  [t.children ?? "children"]: { type: "list", item: t, title: t.title },
});

/** Data as a drawing reads it: every item of a list of records with an id (a new one made
 * from what it says), a string written for such an item made a record of its title, and
 * a reference written as a name made the id of the item of that name. Items keep the ids
 * they have. Names that are ambiguous or name nothing are problems. */
export function normalizeData(fields: Fields, data: Record<string, unknown>, at: string, problems: DataProblem[]) {
  const next = structuredClone(data);
  const lists = new Map<string, Record<string, unknown>[]>();
  // Ids first, everywhere, so references can then be read against them.
  const identify = (f: Field, value: unknown): unknown => {
    if (f.type === "list" && Array.isArray(value)) {
      const item = f.item;
      if (!isRecordList(f)) return value.map((v) => identify(item, v));
      const title = titleOf(f);
      const items = value.map((v) => (typeof v === "string" && title ? { [title]: v } : v));
      const taken = new Set(items.flatMap((v) => (isRec(v) && isItemId(v.id) ? [v.id] : [])));
      const prefix = (title ?? "i").slice(0, 1);
      return items.map((v) => {
        if (!isRec(v)) return v;
        const item = identify(f.item, v) as Record<string, unknown>;
        return isItemId(item.id) ? item : { id: idFrom(title ? item[title] : item, taken, prefix), ...item };
      });
    }
    if ((f.type === "record" || f.type === "tree") && isRec(value)) {
      const own = f.type === "tree" ? nodeFields(f) : f.fields;
      const out: Record<string, unknown> = { ...value };
      for (const [k, v] of Object.entries(value)) {
        const inner = own[k] ?? (f.type === "record" ? f.rest : undefined);
        if (inner) out[k] = identify(inner, v);
      }
      return out;
    }
    return value;
  };
  for (const [key, f] of Object.entries(fields)) if (key in next) next[key] = identify(f, next[key]);
  for (const [key, f] of Object.entries(fields))
    if (isRecordList(f) && Array.isArray(next[key])) lists.set(key, next[key] as Record<string, unknown>[]);
  const resolve = (to: string, ref: unknown, where: string): unknown => {
    const list = lists.get(to);
    if (!list || typeof ref !== "string") return ref;
    if (list.some((x) => x.id === ref)) return ref;
    const title = titleOf(fields[to] as Extract<Field, { type: "list" }>);
    const named = title ? list.filter((x) => x[title] === ref) : [];
    if (named.length === 1) return named[0].id;
    problems.push({
      at: where,
      problem: named.length
        ? `${JSON.stringify(ref)} 在 ${to} 里有 ${named.length} 项同名，用 id 指明是哪一项（${named.map((x) => x.id).join("、")}）`
        : `${to} 里没有 ${JSON.stringify(ref)}：写它的 id 或名字（${list.map((x) => `${x.id}=${title ? x[title] : ""}`).join("、") || "列表是空的"}）`,
    });
    return ref;
  };
  const refs = (f: Field, value: unknown, where: string): unknown => {
    if (f.type === "ref") return resolve(f.to, value, where);
    if (f.type === "geo" && f.to && typeof value === "string") return resolve(f.to, value, where);
    if (f.type === "list" && Array.isArray(value))
      return value.map((v, i) => refs(f.item, v, `${where}.${i}`));
    if ((f.type === "record" || f.type === "tree") && isRec(value)) {
      const own = f.type === "tree" ? nodeFields(f) : f.fields;
      const out: Record<string, unknown> = { ...value };
      for (const [k, v] of Object.entries(value)) {
        const inner = own[k] ?? (f.type === "record" ? f.rest : undefined);
        if (inner) out[k] = refs(inner, v, `${where}.${k}`);
      }
      return out;
    }
    return value;
  };
  for (const [key, f] of Object.entries(fields)) if (key in next) next[key] = refs(f, next[key], `${at}.${key}`);
  return next;
}

/** Data with what referred to items now gone taken out with them: an item whose reference
 * is in the list's `cascade` goes; a reference among several in a list of references goes
 * alone, unless fewer than the list's `min` would be left. */
export function cascadeData(fields: Fields, before: Record<string, unknown>, after: Record<string, unknown>) {
  let next = after;
  for (let round = 0; round < 8; round++) {
    let changed = false;
    for (const [key, f] of Object.entries(fields)) {
      if (!isRecordList(f) || !f.cascade?.length) continue;
      const ids = (d: Record<string, unknown>) =>
        new Set((Array.isArray(d[key]) ? d[key] : []).flatMap((x) => (isRec(x) && typeof x.id === "string" ? [x.id] : [])));
      const was = ids(before),
        now = ids(next);
      const gone = new Set([...was].filter((id) => !now.has(id)));
      if (!gone.size) continue;
      for (const path of f.cascade) {
        const [list, field] = path.split(".");
        const items = next[list];
        const schema = fields[list];
        if (!Array.isArray(items) || schema?.type !== "list") continue;
        const inner = schema.item.type === "record" ? schema.item.fields[field] : undefined;
        const kept = items.flatMap((item) => {
          if (!isRec(item)) return [item];
          const v = item[field];
          if (Array.isArray(v) && inner?.type === "list") {
            const left = v.filter((r) => !gone.has(r as string));
            if (left.length === v.length) return [item];
            changed = true;
            return left.length < Math.max(1, inner.min ?? 1) ? [] : [{ ...item, [field]: left }];
          }
          if (typeof v === "string" && gone.has(v)) {
            changed = true;
            return [];
          }
          return [item];
        });
        next = { ...next, [list]: kept };
      }
      before = { ...before, [key]: next[key] };
    }
    if (!changed) break;
  }
  return next;
}

const kindOf = (v: unknown) => (Array.isArray(v) ? "列表" : v === null ? "null" : typeof v === "object" ? "记录" : typeof v);
/** Problems with data against its schema, for the keys given (all by default): each value
 * of the kind declared, a choice among its options, a number in its range, lists within
 * their bounds with ids unique, and every reference to an item that is there. */
export function validateData(
  fields: Fields,
  data: Record<string, unknown>,
  at: string,
  problems: DataProblem[],
  keys: string[] = Object.keys(data),
) {
  const lists = new Map<string, Set<string>>();
  for (const [key, f] of Object.entries(fields))
    if (isRecordList(f) && Array.isArray(data[key]))
      lists.set(key, new Set((data[key] as unknown[]).flatMap((x) => (isRec(x) && typeof x.id === "string" ? [x.id] : []))));
  const say = (where: string, problem: string) => problems.push({ at: where, problem });
  const check = (f: Field, v: unknown, where: string) => {
    if (v === undefined || v === null) return;
    switch (f.type) {
      case "text":
      case "picture":
      case "effect":
      case "color":
      case "id":
        if (typeof v !== "string") say(where, `应该是文字，现在是${kindOf(v)}`);
        return;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) return say(where, `应该是数字，现在是${kindOf(v)}`);
        if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max))
          say(where, `${v} 超出范围 ${f.min ?? "-∞"}..${f.max ?? "∞"}`);
        return;
      case "boolean":
        if (typeof v !== "boolean") say(where, `应该是 true 或 false，现在是${kindOf(v)}`);
        return;
      case "choice":
        if (!f.options.some((o) => o.value === v))
          say(where, `${JSON.stringify(v)} 不是可选值：${f.options.map((o) => o.value).join("、")}`);
        return;
      case "cell":
        if (!["string", "number", "boolean"].includes(typeof v)) say(where, `应该是文字、数字或 true/false，现在是${kindOf(v)}`);
        return;
      case "ref": {
        const ids = lists.get(f.to);
        if (typeof v !== "string") return say(where, `应该是 ${f.to} 里一项的 id，现在是${kindOf(v)}`);
        if (ids && !ids.has(v)) say(where, `${f.to} 里没有 id 为 ${v} 的一项`);
        return;
      }
      case "geo":
        if (typeof v === "string" && f.to) {
          const ids = lists.get(f.to);
          if (ids && !ids.has(v)) say(where, `${f.to} 里没有 id 为 ${v} 的一项`);
        } else if (!(Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number")))
          say(where, "应该是 [经度, 纬度]" + (f.to ? ` 或 ${f.to} 里一项的 id` : ""));
        return;
      case "list": {
        if (!Array.isArray(v)) return say(where, `应该是列表，现在是${kindOf(v)}`);
        if (f.max !== undefined && v.length > f.max) say(where, `最多 ${f.max} 项，现在有 ${v.length} 项`);
        const seen = new Set<string>();
        v.forEach((item, i) => {
          if (isRecordList(f) && isRec(item)) {
            if (!isItemId(item.id)) say(`${where}.${i}.id`, "每一项要有 id（字母、数字、- 或 _）");
            else if (seen.has(item.id)) say(`${where}.${i}.id`, `id ${item.id} 重复`);
            else seen.add(item.id);
          }
          check(f.item, item, `${where}.${i}`);
        });
        return;
      }
      case "record":
      case "tree": {
        if (!isRec(v)) return say(where, `应该是记录，现在是${kindOf(v)}`);
        const own = f.type === "tree" ? nodeFields(f) : f.fields;
        for (const [k, inner] of Object.entries(v)) {
          const schema = own[k] ?? (f.type === "record" ? f.rest : undefined);
          if (k === "id") continue;
          if (!schema) say(`${where}.${k}`, `不认识的字段 ${k}：可以写 ${Object.keys(own).join("、") || "（无）"}`);
          else check(schema, inner, `${where}.${k}`);
        }
        return;
      }
    }
  };
  for (const key of keys) {
    const f = fields[key];
    if (f) check(f, data[key], `${at}.${key}`);
  }
}
/** The words a part's data holds, by path, in the order its schema declares them: what a
 * drawing must mark as editable where it draws them. */
export function textsIn(fields: Fields, data: Record<string, unknown>) {
  const found: { path: string; text: string }[] = [];
  const walk = (f: Field, v: unknown, path: string) => {
    if (v === undefined || v === null) return;
    if (f.type === "text" && typeof v === "string" && v.trim()) found.push({ path, text: v });
    else if (f.type === "cell" && typeof v === "string" && v.trim()) found.push({ path, text: v });
    else if (f.type === "list" && Array.isArray(v))
      v.forEach((item, i) => walk(f.item, item, `${path}.${isRec(item) && isItemId(item.id) ? "#" + item.id : i}`));
    else if ((f.type === "record" || f.type === "tree") && isRec(v)) {
      const own = f.type === "tree" ? nodeFields(f) : f.fields;
      for (const [k, inner] of Object.entries(own)) walk(inner, v[k], `${path}.${k}`);
    }
  };
  for (const [key, f] of Object.entries(fields)) walk(f, data[key], key);
  return found;
}
/** Data with every colour its schema declares that names a style token (accent, ink…)
 * given that token's colour, so a part coloured by the work's palette follows it. */
export function withTokens(fields: Fields, data: Record<string, unknown>, style: Record<string, string>) {
  const walk = (f: Field, v: unknown): unknown => {
    if (f.type === "color") return typeof v === "string" && /^[a-z][a-z0-9]*$/i.test(v) && style[v] ? style[v] : v;
    if (f.type === "list" && Array.isArray(v)) return v.map((x) => walk(f.item, x));
    if ((f.type === "record" || f.type === "tree") && isRec(v)) {
      const own = f.type === "tree" ? nodeFields(f) : f.fields;
      const out: Record<string, unknown> = { ...v };
      for (const [k, x] of Object.entries(v)) {
        const inner = own[k] ?? (f.type === "record" ? f.rest : undefined);
        if (inner) out[k] = walk(inner, x);
      }
      return out;
    }
    return v;
  };
  const out: Record<string, unknown> = { ...data };
  for (const [k, f] of Object.entries(fields)) if (k in out) out[k] = walk(f, out[k]);
  return out;
}
