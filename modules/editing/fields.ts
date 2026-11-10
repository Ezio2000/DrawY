import {
  drawingOf,
  type Instance,
  type Link,
  type Param,
  type ParamType,
  type Work,
} from "../contracts/index.ts";

/* The values of a part a person can change in plain controls: those its drawing declares,
 * then the plain values in its data. What is left (lists, tables, nested records) is
 * changed in the data editor, as the author would write it. */

/** A value of a module or link that a person can change, and the control it takes. */
export interface Field {
  key: string;
  /** The author's name for it; without one the app names it by its key. */
  label?: string;
  type: ParamType;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  value: unknown;
  /** Whether the part sets it itself rather than taking its drawing's default. */
  set: boolean;
  /** Whether the drawing still draws without it: a default it has, or for a library
   * drawing's colour the work's style. Only such a value can be given back. */
  optional: boolean;
}
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]*\))$/i;
/** Data keys that hold words to read, whatever drawing they belong to. */
const WORDS = new Set([
  "text",
  "label",
  "title",
  "subtitle",
  "sub",
  "heading",
  "caption",
  "note",
  "name",
  "description",
  "detail",
  "word",
  "main",
  "unit",
  "date",
  "quote",
  "message",
  "content",
  "summary",
  "tag",
  "badge",
]);
const rank: Record<ParamType, number> = {
  text: 0,
  picture: 1,
  choice: 2,
  color: 3,
  number: 4,
  boolean: 5,
};
/** What kind of value an undeclared data entry holds, if it is one a person can change:
 * words, a picture, a colour, a number or a switch. Lowercase tokens are left alone, as
 * they are usually states the drawing code tests for. */
function guess(key: string, value: unknown, work: Work): ParamType | null {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number")
    return Number.isFinite(value) ? "number" : null;
  if (typeof value !== "string" || value.length > 400) return null;
  if (work.materials[value]?.kind === "picture") return "picture";
  if (COLOR.test(value.trim())) return "color";
  if (WORDS.has(key) || /[^\x00-\x7f]|\s|[A-Z0-9]/.test(value)) return "text";
  return null;
}
function fits(type: ParamType, value: unknown) {
  if (value === undefined) return true;
  switch (type) {
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    default:
      return typeof value === "string";
  }
}
/** The values of a module or link a person can change: those its drawing declares or has a
 * default for, then the other plain values in its data, words first and switches last. */
export function fieldsOf(work: Work, part: Instance | Link): Field[] {
  const drawing = drawingOf(work, part.drawingId);
  const declared: Record<string, Param> = drawing?.params ?? {};
  const defaults = drawing?.defaults ?? {};
  const fields: Field[] = [];
  const optional = (key: string, type: ParamType) =>
    key in defaults || (!!drawing && !drawing.own && type === "color");
  for (const [key, p] of Object.entries(declared)) {
    const value = part.data[key] ?? defaults[key];
    if (fits(p.type, value))
      fields.push({
        key,
        ...p,
        value,
        set: part.data[key] !== undefined,
        optional: optional(key, p.type),
      });
  }
  for (const [key, value] of Object.entries({ ...defaults, ...part.data })) {
    if (key in declared) continue;
    const type = guess(key, value, work);
    if (type)
      fields.push({
        key,
        type,
        value,
        set: part.data[key] !== undefined,
        optional: optional(key, type),
      });
  }
  return fields.sort((a, b) => rank[a.type] - rank[b.type]);
}

/** The data entries a part holds that no plain control shows: lists, records and
 * anything else, changed in the data editor. */
export function restOf(work: Work, part: Instance | Link) {
  const shown = new Set(fieldsOf(work, part).map((f) => f.key));
  return Object.keys(part.data).filter((k) => !shown.has(k));
}

/** How a part looks, apart from what it says and shows: the values it sets that are choices,
 * colours, numbers and switches, with the drawing they belong to. Copied from one part and
 * given to others, as a format painter does. */
export interface Look {
  workId: string;
  drawingId: string;
  data: Record<string, unknown>;
}
export function lookOf(work: Work, part: Instance | Link): Look {
  const data: Record<string, unknown> = {};
  for (const f of fieldsOf(work, part))
    if (f.set && f.type !== "text" && f.type !== "picture")
      data[f.key] = structuredClone(part.data[f.key]);
  return { workId: work.id, drawingId: part.drawingId, data };
}
/** The values of a look that a part can take: all of them within the same work and
 * drawing (those the look leaves to the drawing are given back to it too), and elsewhere
 * those its own drawing has under the same name and kind. */
export function lookFor(work: Work, part: Instance | Link, look: Look): Record<string, unknown> {
  const fields = fieldsOf(work, part).filter((f) => f.type !== "text" && f.type !== "picture");
  const kind = (v: unknown) =>
    typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
  const patch: Record<string, unknown> = {};
  if (work.id === look.workId && part.drawingId === look.drawingId) {
    for (const f of fields) if (f.set && f.optional && !(f.key in look.data)) patch[f.key] = undefined;
    Object.assign(patch, structuredClone(look.data));
    return patch;
  }
  for (const f of fields) {
    const value = look.data[f.key];
    if (value === undefined) continue;
    const fits =
      f.type === "number" || f.type === "boolean"
        ? kind(value) === f.type
        : f.type === "choice"
          ? typeof value === "string" && !!f.options?.includes(value)
          : typeof value === "string";
    if (fits) patch[f.key] = structuredClone(value);
  }
  return patch;
}

/** A value several parts can be given at once, with whether they now differ in it. */
export type SharedField = Field & { mixed: boolean };
/** How the parts given look, as the values they can all be given at once: the choices,
 * colours, numbers and switches every one of them has under the same name and of the same
 * kind (a choice among the same options). What each says and shows is its own. A field's
 * value is the first part's; `mixed` says the others differ. */
export function sharedFields(work: Work, parts: (Instance | Link)[]): SharedField[] {
  if (!parts.length) return [];
  const each = parts.map((p) => fieldsOf(work, p));
  return each[0]
    .filter((f) => f.type !== "text" && f.type !== "picture")
    .flatMap((f) => {
      const same = each.map((fields) =>
        fields.find(
          (x) =>
            x.key === f.key &&
            x.type === f.type &&
            (x.options ?? []).join() === (f.options ?? []).join(),
        ),
      );
      if (same.some((x) => !x)) return [];
      return [
        {
          ...f,
          set: same.some((x) => x!.set),
          optional: same.every((x) => x!.optional),
          mixed: same.some((x) => JSON.stringify(x!.value) !== JSON.stringify(f.value)),
        },
      ];
    });
}
/** The few values of a look worth a control right beside the selection, in the order a
 * person reaches for them: what shape, what colour, how filled, how large its words, how its
 * line runs. The names are those the library's drawings share; a drawing of the work's own
 * that declares the same names gets the same controls. */
const QUICK = [
  "shape",
  "tone",
  "color",
  "fillStyle",
  "size",
  "route",
  "head",
  "dashed",
  "both",
  "align",
  "weight",
];
export function quickFields(fields: SharedField[], most = 5): SharedField[] {
  return fields
    .filter(
      (f) =>
        QUICK.includes(f.key) &&
        (f.type !== "number" || (f.min !== undefined && f.max !== undefined)),
    )
    .sort((a, b) => QUICK.indexOf(a.key) - QUICK.indexOf(b.key))
    .slice(0, most);
}
