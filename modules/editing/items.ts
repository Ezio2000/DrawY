import {
  cascadeData,
  diffValue,
  drawingOf,
  fieldAt,
  getAt,
  isItemId,
  isRecord,
  parsePath,
  pathOf,
  setAt as setIn,
  type Field,
  type FieldNames,
  type Fields,
  type Instance,
  type Link,
  type NextRule,
  type Work,
  type WorkEdit,
} from "../contracts/index.ts";
import { sceneOf } from "./shared.ts";

/* Changes to the data of one part where its drawing draws it: a value at a path (words
 * retyped where they stand, a reference dropped on another lifeline), and items of its
 * lists inserted, moved, copied and taken out with what referred to them. Each is the
 * smallest data patch that says it: an item by its id, a list given whole only when its
 * order changes. */

type Part = Instance | Link;
function partIn(work: Work, sceneId: string, id: string): { part: Part; kind: "modules" | "links" } {
  const scene = sceneOf(work, sceneId);
  const module = scene.modules.find((m) => m.id === id);
  if (module) return { part: module, kind: "modules" };
  const link = scene.links.find((l) => l.id === id);
  if (link) return { part: link, kind: "links" };
  throw Error("元素不存在");
}
/** The data a part draws from: its own over its drawing's defaults. */
const drawnData = (work: Work, part: Part) => ({ ...(drawingOf(work, part.drawingId)?.defaults ?? {}), ...part.data });
/** A schema for data its drawing does not declare, from what it holds, so it is edited the
 * same way: a list of words, a table, a record. */
export function guessedField(value: unknown): Field | undefined {
  if (Array.isArray(value)) {
    const first = value.find((v) => v !== null && v !== undefined);
    const item = first === undefined ? ({ type: "text" } as Field) : guessedField(first);
    return item ? { type: "list", item } : undefined;
  }
  if (isRecord(value)) {
    const fields: Fields = {};
    for (const [k, v] of Object.entries(value)) {
      const f = k === "id" ? ({ type: "id" } as Field) : guessedField(v);
      if (f) fields[k] = f;
    }
    return { type: "record", fields };
  }
  if (typeof value === "string") return { type: "text" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return undefined;
}
/** The schema of a part's data: what its drawing declares, and for lists and records it
 * holds that are not declared, a schema read from them, as the content panel shows them. */
function fieldsOf(work: Work, part: Part): Fields {
  const declared = drawingOf(work, part.drawingId)?.params ?? {};
  const fields: Fields = { ...declared };
  for (const [k, v] of Object.entries(drawnData(work, part))) {
    if (k in declared || !(Array.isArray(v) || isRecord(v))) continue;
    const f = guessedField(v);
    if (f) fields[k] = f;
  }
  return fields;
}

/** The patch that turns one list of records into another: items changed or gone by id
 * when the rest stand in the same order, else the list whole. */
function listPatch(before: unknown[], after: unknown[]): unknown {
  const ids = (list: unknown[]) => list.map((x) => (isRecord(x) && isItemId(x.id) ? x.id : null));
  const was = ids(before),
    now = ids(after);
  if (was.includes(null) || now.includes(null)) return after;
  const kept = was.filter((id) => now.includes(id));
  const order = now.filter((id) => was.includes(id));
  const added = now.filter((id) => !was.includes(id));
  // New items can only be appended by id; anywhere else the list is given whole.
  if (kept.join() !== order.join() || now.slice(now.length - added.length).join() !== added.join()) return after;
  const patch: Record<string, unknown> = {};
  for (const id of was) {
    const a = before.find((x) => isRecord(x) && x.id === id) as Record<string, unknown>;
    const b = after.find((x) => isRecord(x) && x.id === id) as Record<string, unknown> | undefined;
    if (!b) patch["#" + id] = null;
    else if (JSON.stringify(a) !== JSON.stringify(b)) {
      const inner: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(diffValue(a, b)))
        inner[k] = Array.isArray(a[k]) && Array.isArray(v) ? listPatch(a[k] as unknown[], v) : v;
      patch["#" + id] = inner;
    }
  }
  for (const id of added) {
    const { id: _, ...item } = after.find((x) => isRecord(x) && x.id === id) as Record<string, unknown>;
    patch["#" + id] = item;
  }
  return Object.keys(patch).length ? patch : undefined;
}
/** The data patch from one state of a part's data to another, lists of records by item. */
export function dataPatch(before: Record<string, unknown>, after: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key],
      b = after[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (b === undefined) patch[key] = null;
    else if (Array.isArray(a) && Array.isArray(b)) {
      const p = listPatch(a, b);
      if (p !== undefined) patch[key] = p;
    } else if (isRecord(a) && isRecord(b)) patch[key] = dataPatch(a, b);
    else patch[key] = b;
  }
  return patch;
}
/** The edit that gives a part other data, as the smallest patch; null when nothing changes. */
function rewritten(work: Work, sceneId: string, id: string, next: Record<string, unknown>): WorkEdit | null {
  const { part, kind } = partIn(work, sceneId, id);
  const data = dataPatch(part.data, next);
  if (!Object.keys(data).length) return null;
  return { [kind]: [{ id, scene: sceneId, data }] };
}
/** The part's own data with the value at a path set, a value it takes from its drawing's
 * defaults copied in first. */
function withValue(work: Work, part: Part, path: string, value: unknown) {
  const [first] = parsePath(path);
  const own = { ...part.data };
  if (typeof first === "string" && own[first] === undefined) {
    const inherited = drawnData(work, part)[first];
    if (inherited !== undefined) own[first] = structuredClone(inherited);
  }
  const next = setIn(own, path, value);
  if (next === null) throw Error(`数据里没有 ${path}`);
  return next as Record<string, unknown>;
}

/** Sets the value at a path in a part's data: words retyped where they are drawn, a number
 * dragged, a choice made. Undefined takes the value out. */
export function setAt(work: Work, sceneId: string, id: string, path: string, value: unknown): WorkEdit | null {
  const { part } = partIn(work, sceneId, id);
  // Words retyped where a number is drawn are that number; words that are none change nothing.
  if (typeof value === "string" && fieldAt(fieldsOf(work, part), path)?.type === "number") {
    const n = Number(value.trim());
    if (!value.trim() || !Number.isFinite(n)) return null;
    value = n;
  }
  return rewritten(work, sceneId, id, withValue(work, part, path, value));
}
/** Points a reference at another item, as a message's end dropped on another lifeline. */
export function retarget(work: Work, sceneId: string, id: string, path: string, to: string): WorkEdit | null {
  const { part } = partIn(work, sceneId, id);
  const f = fieldAt(fieldsOf(work, part), path);
  if (f?.type !== "ref") throw Error(`${path} 不是引用`);
  const list = getAt(drawnData(work, part), f.to);
  if (!Array.isArray(list) || !list.some((x) => isRecord(x) && x.id === to)) throw Error(`${f.to} 里没有 ${to}`);
  return setAt(work, sceneId, id, path, to);
}

/** The list at a path and its schema. */
function listAt(work: Work, part: Part, path: string) {
  const f = fieldAt(fieldsOf(work, part), path);
  const list = getAt(drawnData(work, part), path);
  if (f?.type !== "list") throw Error(`${path} 不是列表`);
  return { f, list: Array.isArray(list) ? list : [] };
}
const isRecordList = (f: Extract<Field, { type: "list" }>) => f.item.type === "record" || f.item.type === "tree";
/** An id no item of the list has, from its key: m1, m2… for messages. */
function freshId(list: unknown[], path: string) {
  const key = parsePath(path).filter((s): s is string => typeof s === "string").at(-1) ?? "item";
  const prefix = key.replace(/[^a-z]/gi, "").slice(0, 1).toLowerCase() || "i";
  const taken = new Set(list.flatMap((x) => (isRecord(x) && typeof x.id === "string" ? [x.id] : [])));
  let n = list.length + 1;
  while (taken.has(prefix + n)) n++;
  return prefix + n;
}
/** Where an item stands in its list, by id or place. */
function placeOf(list: unknown[], item: string | number) {
  const i = typeof item === "number" ? item : list.findIndex((x) => isRecord(x) && x.id === item);
  if (i < 0 || i >= list.length) throw Error("条目不存在");
  return i;
}
/** The least value a field takes that its schema accepts: nothing typed yet, off, its first
 * choice, a number in its range, a list of as few items as it holds. */
function blankOf(f: Field): unknown {
  switch (f.type) {
    case "record":
    case "tree":
      return {};
    case "number":
      return Math.min(Math.max(0, f.min ?? 0), f.max ?? Infinity);
    case "boolean":
      return false;
    case "choice":
      return f.options[0].value;
    case "geo":
      return [0, 0];
    case "list":
      return Array.from({ length: f.min ?? 0 }, () => blankOf(f.item));
    default:
      return "";
  }
}
/** A new item as the schema makes one, or as a rule makes it after another. */
function made(f: Extract<Field, { type: "list" }>, list: unknown[], path: string, data: Record<string, unknown>, values?: Record<string, unknown>) {
  const item = f.item;
  // A reference refers to the first item it does not yet, or else the first; a place or a
  // pair added after others starts as a copy of the last, to be changed from there: nothing
  // empty is one.
  if (item.type === "ref" && f.new === undefined && values?.value === undefined) {
    const targets = getAt(data, item.to);
    const ids = (Array.isArray(targets) ? targets : []).flatMap((x) => (isRecord(x) && typeof x.id === "string" ? [x.id] : []));
    const id = ids.find((x) => !list.includes(x)) ?? ids[0];
    if (id !== undefined) return id;
  }
  const copied = ["geo", "list"].includes(item.type) && list.length ? list.at(-1) : undefined;
  const base = structuredClone(f.new ?? copied ?? blankOf(item));
  if (!isRecordList(f)) return values?.value ?? base;
  return { id: freshId(list, path), ...(isRecord(base) ? base : {}), ...(values ?? {}) };
}
/** What Enter or Tab makes after an item: some of its values kept, two swapped, some set. */
export function following(item: unknown, rule?: NextRule): Record<string, unknown> {
  if (!isRecord(item) || !rule) return {};
  const out: Record<string, unknown> = {};
  for (const k of rule.keep ?? []) if (item[k] !== undefined) out[k] = structuredClone(item[k]);
  if (rule.swap) {
    const [a, b] = rule.swap;
    if (item[b] !== undefined) out[a] = structuredClone(item[b]);
    if (item[a] !== undefined) out[b] = structuredClone(item[a]);
  }
  return { ...out, ...structuredClone(rule.set ?? {}) };
}

/** Inserts a new item into a list at a place (its end by default), made as the schema makes
 * new items with `values` over that. Returns the edit and the new item's path. */
export function insertItem(
  work: Work,
  sceneId: string,
  id: string,
  path: string,
  at?: number,
  values?: Record<string, unknown>,
): { edit: WorkEdit; path: string } {
  const { part } = partIn(work, sceneId, id);
  const { f, list } = listAt(work, part, path);
  const place = Math.max(0, Math.min(at ?? list.length, list.length));
  return insertItemAs(work, sceneId, id, part, path, f, list, place, made(f, list, path, drawnData(work, part), values));
}
/** Moves an item of a list to another place, counted in the list as it stands. */
export function moveItem(work: Work, sceneId: string, id: string, path: string, item: string | number, to: number) {
  const { part } = partIn(work, sceneId, id);
  const { list } = listAt(work, part, path);
  const from = placeOf(list, item);
  const place = Math.max(0, Math.min(to, list.length - 1));
  if (from === place) return null;
  const moved = list.toSpliced(from, 1).toSpliced(place, 0, list[from]);
  return rewritten(work, sceneId, id, withValue(work, part, path, moved));
}
/** Copies an item next to itself, under a new id. */
export function duplicateItem(work: Work, sceneId: string, id: string, path: string, item: string | number) {
  const { part } = partIn(work, sceneId, id);
  const { f, list } = listAt(work, part, path);
  const from = placeOf(list, item);
  const copy = isRecord(list[from]) ? { ...structuredClone(list[from]), id: freshId(list, path) } : structuredClone(list[from]);
  return insertItemAs(work, sceneId, id, part, path, f, list, from + 1, copy);
}
/** The edit that puts an item into a list at a place, and the item's path. */
function insertItemAs(
  work: Work,
  sceneId: string,
  id: string,
  part: Part,
  path: string,
  f: Extract<Field, { type: "list" }>,
  list: unknown[],
  place: number,
  item: unknown,
) {
  if (f.max !== undefined && list.length >= f.max) throw Error(`最多 ${f.max} 项`);
  const edit = rewritten(work, sceneId, id, withValue(work, part, path, list.toSpliced(place, 0, item)))!;
  return { edit, path: `${path}.${isRecord(item) && isItemId(item.id) ? "#" + item.id : place}` };
}
/** Takes an item out of a list, and with it whatever its drawing's schema says goes with
 * it: messages to a participant taken out go too. Returns the edit and how many other items
 * went with it. */
export function removeItem(work: Work, sceneId: string, id: string, path: string, item: string | number) {
  const { part } = partIn(work, sceneId, id);
  const { list } = listAt(work, part, path);
  const place = placeOf(list, item);
  const before = withValue(work, part, path, list);
  const after = withValue(work, part, path, list.toSpliced(place, 1));
  const settled = cascadeData(fieldsOf(work, part), before, after);
  const count = (d: Record<string, unknown>) =>
    Object.values(d).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  return {
    edit: rewritten(work, sceneId, id, settled)!,
    along: Math.max(0, count(after) - count(settled)),
  };
}
/** The list path and item step of an item's path, if it names an item of a list. */
export function itemOf(path: string): { list: string; item: string | number } | undefined {
  const steps = parsePath(path);
  const last = steps.at(-1);
  if (last === undefined || typeof last === "string") return undefined;
  const list = pathOf(steps.slice(0, -1));
  return { list, item: typeof last === "object" ? last.id : last };
}
/** The way into a part of a module's data, as a person reads it: each list it passes with
 * the item's place in it (counted from 1), each record by its field. */
export function trailOf(work: Work, part: Part, path: string): { key: string; label?: FieldNames; place?: number }[] {
  const steps = parsePath(path);
  const fields = fieldsOf(work, part);
  const data = drawnData(work, part);
  const trail: { key: string; label?: FieldNames; place?: number }[] = [];
  steps.forEach((step, i) => {
    if (typeof step !== "string") return;
    const f = fieldAt(fields, steps.slice(0, i + 1));
    const next = steps[i + 1];
    const entry: { key: string; label?: FieldNames; place?: number } = { key: step, ...(f?.label ? { label: f.label } : {}) };
    if (next !== undefined && typeof next !== "string") {
      const list = getAt(data, steps.slice(0, i + 1));
      const at = Array.isArray(list)
        ? typeof next === "number"
          ? next
          : list.findIndex((x) => isRecord(x) && x.id === next.id)
        : -1;
      if (at >= 0) entry.place = at + 1;
    }
    trail.push(entry);
  });
  return trail;
}
/** Puts an item of a tree under the item before it, last among its children: Tab in an
 * outline. Null when it is the first, with nothing to go under. */
export function indentItem(work: Work, sceneId: string, id: string, path: string): { edit: WorkEdit; path: string } | null {
  const at = itemOf(path);
  if (!at) return null;
  const { part } = partIn(work, sceneId, id);
  const { list } = listAt(work, part, at.list);
  const place = placeOf(list, at.item);
  if (place < 1) return null;
  const children = parsePath(at.list).at(-1) as string;
  const before = list[place - 1] as Record<string, unknown>;
  const moved = list[place];
  const next = list.toSpliced(place, 1).with(place - 1, { ...before, [children]: [...(Array.isArray(before[children]) ? (before[children] as unknown[]) : []), moved] });
  const edit = rewritten(work, sceneId, id, withValue(work, part, at.list, next));
  const beforePath = `${at.list}.${isRecord(before) && isItemId(before.id) ? "#" + before.id : place - 1}`;
  return edit && { edit, path: `${beforePath}.${children}.${isRecord(moved) && isItemId(moved.id) ? "#" + moved.id : 0}` };
}
/** Takes an item of a tree out from under its parent, to stand right after it: Shift+Tab in
 * an outline. Null when its parent is the root. */
export function outdentItem(work: Work, sceneId: string, id: string, path: string): { edit: WorkEdit; path: string } | null {
  const at = itemOf(path);
  const parentAt = at && itemOf(parsePath(at.list).slice(0, -1).map((s) => (typeof s === "object" ? "#" + s.id : String(s))).join("."));
  if (!at || !parentAt) return null;
  const { part } = partIn(work, sceneId, id);
  const data = drawnData(work, part);
  const outer = getAt(data, parentAt.list);
  const inner = getAt(data, at.list);
  if (!Array.isArray(outer) || !Array.isArray(inner)) return null;
  const parentPlace = placeOf(outer, parentAt.item);
  const place = placeOf(inner, at.item);
  const moved = inner[place];
  const children = parsePath(at.list).at(-1) as string;
  const parent = { ...(outer[parentPlace] as Record<string, unknown>), [children]: inner.toSpliced(place, 1) };
  const next = outer.with(parentPlace, parent).toSpliced(parentPlace + 1, 0, moved);
  const edit = rewritten(work, sceneId, id, withValue(work, part, parentAt.list, next));
  return edit && { edit, path: `${parentAt.list}.${isRecord(moved) && isItemId(moved.id) ? "#" + moved.id : parentPlace + 1}` };
}
/** The schema of the list an item's path is in, and the item, for what Enter and Tab make. */
export function listOf(work: Work, part: Part, path: string) {
  const at = itemOf(path);
  if (!at) return undefined;
  const f = fieldAt(fieldsOf(work, part), at.list);
  const list = getAt(drawnData(work, part), at.list);
  if (f?.type !== "list" || !Array.isArray(list)) return undefined;
  return { ...at, field: f, place: placeOf(list, at.item), value: list[placeOf(list, at.item)], tree: parsePath(at.list).length > 1 && fieldAt(fieldsOf(work, part), at.list.split(".").slice(0, -1).join("."))?.type === "tree" || f.item.type === "tree" };
}
/** The lists whose items span a run of another list's items, by two references into it (a
 * sequence diagram's fragments round its messages), with the choice that says what kind of
 * span each is. */
export function spansOf(work: Work, part: Part, list: string) {
  const fields = fieldsOf(work, part);
  return Object.entries(fields).flatMap(([key, f]) => {
    if (f.type !== "list" || f.item.type !== "record") return [];
    const refs = Object.entries(f.item.fields).filter(([, x]) => x.type === "ref" && x.to === list);
    if (refs.length !== 2) return [];
    const choice = Object.entries(f.item.fields).find(([, x]) => x.type === "choice") as [string, Extract<Field, { type: "choice" }>] | undefined;
    return [{ list: key, field: f, from: refs[0][0], to: refs[1][0], choice }];
  });
}
/** Wraps a run of items in a new item of a list that spans them, from the first of them to
 * the last as their list orders them, of the kind given. */
export function wrapItems(work: Work, sceneId: string, id: string, paths: string[], span: string, kind?: string) {
  const { part } = partIn(work, sceneId, id);
  const at = paths.map(itemOf);
  const list = at[0]?.list;
  if (!list || at.some((x) => !x || x.list !== list)) throw Error("要选同一列表里的条目");
  const s = spansOf(work, part, list).find((x) => x.list === span);
  if (!s) throw Error(`${span} 不能包住 ${list}`);
  const items = getAt(drawnData(work, part), list) as unknown[];
  const places = at.map((x) => placeOf(items, x!.item)).sort((a, b) => a - b);
  const idOf = (i: number) => (items[i] as { id: string }).id;
  const values: Record<string, unknown> = { [s.from]: idOf(places[0]), [s.to]: idOf(places.at(-1)!) };
  if (s.choice && kind) values[s.choice[0]] = kind;
  return insertItem(work, sceneId, id, span, undefined, values);
}
