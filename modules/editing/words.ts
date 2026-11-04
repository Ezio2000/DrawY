import { diffValue, usersOf, type Work, type WorkEdit } from "../contracts/index.ts";
import { drawingIds, fresh, sceneOf, syntaxError } from "./shared.ts";

/* Words or a picture a person pointed at, changed where they come from: the module's data
 * when it holds them, otherwise the one place its drawing's code names them. */

const escapeJs = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/[`'"]/g, "\\$&")
    .replace(/\$\{/g, "\\${")
    .replace(/\n/g, "\\n");
const escapeXml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const occurrences = (source: string, s: string) =>
  s ? source.split(s).length - 1 : 0;
/** A data value with one string in it replaced: the whole string, or one of its lines.
 * `named` when it was the whole of an entry's name, which other entries may refer to it by. */
function replaceIn(
  value: unknown,
  from: string,
  to: string,
  key?: string,
): { value: unknown; done: boolean; named?: boolean } {
  if (typeof value === "string") {
    if (value === from) return { value: to, done: true, named: key === "name" };
    const lines = value.split("\n");
    const i = lines.indexOf(from);
    if (i >= 0 && lines.length > 1) {
      lines[i] = to;
      return { value: lines.join("\n"), done: true };
    }
    return { value, done: false };
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = replaceIn(value[i], from, to);
      if (r.done) return { ...r, value: value.with(i, r.value) };
    }
    return { value, done: false };
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const r = replaceIn(v, from, to, k);
      if (r.done) return { ...r, value: { ...value, [k]: r.value } };
    }
  }
  return { value, done: false };
}
/** Every string in a data value that is exactly `from`, as `to`. */
function replaceAll(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) return value.map((v) => replaceAll(v, from, to));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceAll(v, from, to)]),
    );
  return value;
}

/** Changes words or a picture a person pointed at in a module to what they chose. The
 * module's own data is changed when it holds them; otherwise the module's drawing code,
 * when it names them exactly once. A drawing other modules share is copied for this one
 * first, so only what was pointed at changes. Null when they come from neither, such as
 * words a drawing composes or a library drawing writes itself. Given a link's id, only
 * the link's data is looked in. */
export function replace(
  work: Work,
  sceneId: string,
  moduleId: string,
  kind: "text" | "picture",
  from: string,
  to: string,
): WorkEdit | null {
  if (from === to) return null;
  const scene = sceneOf(work, sceneId);
  const module = scene.modules.find((m) => m.id === moduleId);
  const extra: Partial<WorkEdit> = kind === "picture" ? { materials: [to] } : {};
  // A link's words and pictures are changed in its data; its drawing is left alone.
  const link = !module && scene.links.find((l) => l.id === moduleId);
  if (link) {
    const r = replaceIn(link.data, from, to);
    if (!r.done) return null;
    return {
      links: [
        {
          id: link.id,
          scene: sceneId,
          data: diffValue(link.data, r.value as Record<string, unknown>),
        },
      ],
      ...extra,
    };
  }
  if (!module) return null;
  const first = replaceIn(module.data, from, to);
  // A renamed entry (a place on a map) takes the references to it along: routes and
  // areas that list it by name would otherwise lose it.
  const inData = first.named
    ? { ...first, value: replaceAll(first.value, from, to) }
    : first;
  if (inData.done)
    return {
      modules: [
        {
          id: moduleId,
          scene: sceneId,
          data: diffValue(module.data, inData.value as Record<string, unknown>),
        },
      ],
      ...extra,
    };
  const drawing = work.drawings[module.drawingId];
  if (!drawing) return null;
  const forms =
    kind === "picture"
      ? [`"${from}"`, `'${from}'`, `\`${from}\``]
      : [...new Set([from, escapeXml(from)])];
  const found = forms.filter((f) => occurrences(drawing.source, f) > 0);
  if (found.length !== 1 || occurrences(drawing.source, found[0]) !== 1)
    return null;
  const at = drawing.source.indexOf(found[0]);
  const markup =
    /^\s*$/.test(drawing.source.slice(0, at).split(">").at(-1)!) &&
    /^\s*</.test(drawing.source.slice(at + found[0].length));
  const written =
    kind === "picture"
      ? found[0][0] + to + found[0][0]
      : escapeJs(markup ? escapeXml(to) : to);
  if (syntaxError(drawing.source.replace(found[0], () => written))) return null;
  const change = { find: found[0], replace: written };
  // A drawing others share is copied for this module first, so only what was pointed at changes.
  if (usersOf(work, drawing.id).some((p) => p.id !== moduleId)) {
    const id = fresh(drawing.id, drawingIds(work));
    return {
      drawings: [{ id, from: drawing.id, edits: [change] }],
      modules: [{ id: moduleId, scene: sceneId, drawingId: id }],
      ...extra,
    };
  }
  return { drawings: [{ id: drawing.id, edits: [change] }], ...extra };
}
