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
