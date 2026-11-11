import type { Instance, Link, TextEdit, Work } from "./index.ts";

/* What laying an edit on a work needs besides the schemas: how a change to data merges, how
 * a change to text lands, and how a refusal says everything wrong with it at once. */

export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
/** Something an edit cannot do: where it is, what is wrong, and what would fix it. */
export interface Problem {
  /** The record and field it is in, such as links.l-a1.from. */
  at: string;
  problem: string;
}
/** An edit refused whole: nothing of it was saved, and every problem found is listed, so one
 * correction can settle them all. */
export class EditRejected extends DomainError {
  constructor(public problems: Problem[]) {
    const [first] = problems;
    super(
      problems.length > 1
        ? `${first.problem}（还有 ${problems.length - 1} 处问题）`
        : first.problem,
    );
  }
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const POSITION = /^\d+$/;
/** A list with items changed by position. Positions mean the list as it stands before this
 * change, however many of them delete, and one past its end appends. */
function mergedList(
  list: unknown[],
  patch: Record<string, unknown>,
  at: string,
  problems: Problem[],
) {
  const next = [...list];
  const gone: number[] = [];
  const places = Object.keys(patch)
    .map(Number)
    .sort((a, b) => a - b);
  let end = list.length;
  for (const place of places) {
    const change = patch[place];
    if (place > end || (place === end && change === null)) {
      problems.push({
        at: `${at}.${place}`,
        problem: `${at} 只有 ${list.length} 项，没有位置 ${place}`,
      });
      continue;
    }
    if (change === null) gone.push(place);
    else if (place === end) {
      next.push(isRecord(change) ? mergeValue({}, change, `${at}.${place}`, problems) : change);
      end++;
    } else next[place] = mergeValue(list[place], change, `${at}.${place}`, problems);
  }
  for (const place of gone.reverse()) next.splice(place, 1);
  return next;
}
/** A value with a change laid on it: objects merge key by key with null deleting a key
 * (RFC 7386), a list takes an object keyed by position to change some items, and anything
 * else replaces what was there. */
export function mergeValue(
  base: unknown,
  patch: unknown,
  at: string,
  problems: Problem[],
): unknown {
  if (Array.isArray(base) && isRecord(patch) && Object.keys(patch).every((k) => POSITION.test(k)))
    return mergedList(base, patch, at, problems);
  if (!isRecord(patch)) return patch;
  const next: Record<string, unknown> = isRecord(base) ? { ...base } : {};
  for (const [key, change] of Object.entries(patch))
    if (change === null) delete next[key];
    else next[key] = mergeValue(next[key], change, `${at}.${key}`, problems);
  return next;
}
export const mergeRecord = <T>(
  base: Record<string, T>,
  patch: Record<string, unknown>,
  at: string,
  problems: Problem[],
) => mergeValue(base, patch, at, problems) as Record<string, T>;
/** The change that turns one value into another: what mergeValue undoes. Keys gone become
 * null; a list or anything else that differs is given whole. */
export function diffValue(before: Record<string, unknown>, after: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(before))
    if (after[key] === undefined) patch[key] = null;
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    const was = before[key];
    if (JSON.stringify(was) === JSON.stringify(value)) continue;
    patch[key] = isRecord(was) && isRecord(value) ? diffValue(was, value) : value;
  }
  return patch;
}
/** How many times text occurs. */
const count = (text: string, part: string) => text.split(part).length - 1;
/** The line of the text that shares the longest start with what was looked for, to show
 * what stands there instead. */
function closest(text: string, find: string) {
  for (let n = Math.min(find.length, 60); n >= 6; n = Math.floor(n * 0.7)) {
    const at = text.indexOf(find.slice(0, n));
    if (at >= 0) {
      const start = Math.max(0, at - 20);
      return text.slice(start, at + Math.min(160, n + 100));
    }
  }
  return undefined;
}
/** Long text with changes applied in order. Text that is not there, or is there more than
 * once without `all`, is a problem at that edit, and the rest still apply. */
export function editedText(
  text: string,
  edits: TextEdit[],
  at: string,
  problems: Problem[],
) {
  edits.forEach(({ find, replace, all }, i) => {
    const n = count(text, find);
    if (n === 1 || (n > 1 && all)) text = text.replaceAll(find, () => replace);
    else {
      const near = n ? undefined : closest(text, find);
      problems.push({
        at: `${at}.${i}`,
        problem:
          n === 0
            ? `找不到 ${JSON.stringify(find.slice(0, 80))}${near ? `；最接近的一段是 ${JSON.stringify(near)}` : ""}`
            : `${JSON.stringify(find.slice(0, 80))} 出现了 ${n} 次：多带一些前后文让它只出现一次，或加 all: true 全部替换`,
      });
    }
  });
  return text;
}
/** Data keys that hold a module's words, in the order they name it. */
const NAMING = ["title", "name", "text", "label"];
/** What a person editing the work calls a module: the name it was given, or else its words,
 * or else its id. Its words change and the name follows, as nothing stores it twice. */
export function labelOf(m: Pick<Instance, "id" | "label" | "data">) {
  if (m.label) return m.label;
  for (const key of NAMING) {
    const words = m.data[key];
    if (typeof words === "string" && words) return words;
  }
  return m.id;
}
/** What the interface calls a module: its name or words as `labelOf` reads them, or else
 * the name of the drawing it is drawn with. Its id is the author's handle, which means
 * nothing to a person reading a list of layers. */
export function shownName(work: Work, m: Pick<Instance, "id" | "label" | "data" | "drawingId">) {
  const named = labelOf(m);
  return named !== m.id ? named : (drawingOf(work, m.drawingId)?.name ?? m.id);
}
/** The drawing an id means: one of the work's own, or else a library drawing the work holds.
 * Both read the same way; a part of a work is drawn with `defaults` under its own data. */
export function drawingOf(work: Work, id: string) {
  const own = work.drawings[id];
  if (own)
    return {
      name: own.name,
      source: own.source,
      defaults: own.defaults ?? {},
      params: own.params ?? {},
      size: own.size ? { width: own.size[0], height: own.size[1] } : undefined,
      fit: own.fit,
      own,
    };
  const use = work.materials[id];
  if (use?.kind === "drawing")
    return {
      name: use.name,
      source: use.source,
      defaults: use.defaults,
      params: use.params,
      size: use.size,
      fit: use.fit,
    };
  return undefined;
}
/** Every part in a work drawn with a drawing, by scene. */
export const usersOf = (work: Work, drawingId: string) =>
  Object.values(work.scenes).flatMap((s) =>
    [...s.modules, ...s.links]
      .filter((p) => p.drawingId === drawingId)
      .map((p) => ({ sceneId: s.id, id: p.id })),
  );
/** Every string in a value, however it nests. */
export function stringsIn(value: unknown, into = new Set<string>()) {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, into));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => stringsIn(v, into));
  return into;
}
const CALLED = /api\.(?:material|draw|effect)\(\s*["'`]([a-z0-9-]+)["'`]/g;
/** The ids a drawing's code calls literally. */
export const calledIn = (source: string) => [...source.matchAll(CALLED)].map((m) => m[1]);
/** The materials a part shows: the drawing it uses, the ids its data holds and those its
 * own drawing's code calls. */
export function materialsOfPart(work: Work, part: Pick<Link, "drawingId" | "data">) {
  const ids = new Set([part.drawingId, ...stringsIn(part.data)]);
  for (const id of calledIn(work.drawings[part.drawingId]?.source ?? "")) ids.add(id);
  return [...ids].filter((id) => work.materials[id]);
}
