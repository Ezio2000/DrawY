import { boxOf, diffValue, type Drawing, type Instance, type Link, type Scene, type Work, type WorkEdit } from "../contracts/index.ts";
import { dataPatch } from "./items.ts";

/* Going back and forth over hand edits: the edit that turns one state of a work into another,
 * found from the two. Undoing a step lays on the work the edit back to how it was before
 * the step; redoing lays the edit forward to how it was after. Taken from the works rather
 * than from the edit that was sent, it says exactly what the workspace made of the step
 * (ids given, references read, items cascaded), and it holds after any number of steps. */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A changed value as an edit writes it: what is gone is null. */
const kept = <T>(was: T | undefined, now: T | undefined) => (now === undefined ? (was === undefined ? undefined : null) : now);

function moduleEdit(sceneId: string, a: Instance | undefined, b: Instance) {
  if (!a) {
    const { bounds, ...rest } = b;
    return { ...rest, scene: sceneId, bounds: boxOf(bounds) };
  }
  const edit: Record<string, unknown> = { id: b.id, scene: sceneId };
  if (!same(a.label, b.label)) edit.label = kept(a.label, b.label);
  if (!same(a.bounds, b.bounds)) edit.bounds = boxOf(b.bounds);
  if (a.drawingId !== b.drawingId) edit.drawingId = b.drawingId;
  if (!same(a.group, b.group)) edit.group = kept(a.group, b.group);
  if (!same(a.target, b.target)) edit.target = kept(a.target, b.target);
  if (!same(a.data, b.data)) edit.data = dataPatch(a.data, b.data);
  return Object.keys(edit).length > 2 ? edit : null;
}
function linkEdit(sceneId: string, a: Link | undefined, b: Link) {
  if (!a) return { ...structuredClone(b), scene: sceneId };
  const edit: Record<string, unknown> = { id: b.id, scene: sceneId };
  if (a.drawingId !== b.drawingId) edit.drawingId = b.drawingId;
  if (!same(a.from, b.from)) edit.from = b.from;
  if (!same(a.to, b.to)) edit.to = b.to;
  if (!same(a.data, b.data)) edit.data = dataPatch(a.data, b.data);
  return Object.keys(edit).length > 2 ? edit : null;
}
function sceneEdit(a: Scene | undefined, b: Scene) {
  const edit: Record<string, unknown> = { id: b.id };
  if (!a || a.title !== b.title) edit.title = b.title;
  if (!a || a.parentId !== b.parentId) edit.parentId = b.parentId ?? undefined;
  if ((a?.interaction ?? null) !== (b.interaction ?? null)) edit.interaction = b.interaction ?? null;
  if (!a || !same(a.checks, b.checks)) edit.checks = structuredClone(b.checks);
  // The stacking as it is to be: every module takes its place among the others.
  const order = b.modules.map((m) => m.id);
  if (!a || !same(a.modules.map((m) => m.id), order)) edit.order = order;
  return Object.keys(edit).length > 1 ? edit : null;
}
function drawingEdit(a: Drawing | undefined, b: Drawing) {
  if (!a) return structuredClone(b);
  const edit: Record<string, unknown> = { id: b.id };
  if (a.name !== b.name) edit.name = b.name;
  if (!same(a.params ?? {}, b.params ?? {}))
    edit.params = Object.fromEntries(
      [...new Set([...Object.keys(a.params ?? {}), ...Object.keys(b.params ?? {})])].flatMap((k) =>
        same(a.params?.[k], b.params?.[k]) ? [] : [[k, b.params?.[k] ?? null]],
      ),
    );
  if (!same(a.defaults ?? {}, b.defaults ?? {})) edit.defaults = diffValue(a.defaults ?? {}, b.defaults ?? {});
  if (a.source !== b.source) edit.source = b.source;
  return Object.keys(edit).length > 1 ? edit : null;
}

/** The edit that turns `from` into `to`: scenes, modules and links added, changed and taken
 * out, the stacking, drawings, details, the style and the title. Materials `to` holds stay
 * held; what only `from` holds is left, as taking a material out changes nothing drawn. */
export function revert(from: Work, to: Work): WorkEdit {
  const edit: Record<string, unknown[]> & WorkEdit = {};
  const push = (key: "scenes" | "modules" | "links" | "drawings" | "details", value: unknown) =>
    ((edit[key] ??= [] as never) as unknown[]).push(value);
  const remove: NonNullable<WorkEdit["remove"]> = {};
  const gone = (key: keyof NonNullable<WorkEdit["remove"]>, id: string) => (remove[key] ??= []).push(id);
  if (from.title !== to.title) edit.title = to.title;
  // Scenes come first, so the modules of a scene brought back have it to stand in.
  for (const s of Object.values(to.scenes)) {
    const change = sceneEdit(from.scenes[s.id], s);
    if (change) push("scenes", change);
  }
  for (const id of Object.keys(from.scenes)) if (!to.scenes[id]) gone("scenes", id);
  for (const s of Object.values(to.scenes)) {
    const was = from.scenes[s.id];
    const modules = new Map(was?.modules.map((m) => [m.id, m]));
    const links = new Map(was?.links.map((l) => [l.id, l]));
    for (const m of s.modules) {
      const change = moduleEdit(s.id, modules.get(m.id), m);
      if (change) push("modules", change);
    }
    for (const l of s.links) {
      const change = linkEdit(s.id, links.get(l.id), l);
      if (change) push("links", change);
    }
    for (const m of was?.modules ?? []) if (!s.modules.some((x) => x.id === m.id)) gone("modules", m.id);
    for (const l of was?.links ?? []) if (!s.links.some((x) => x.id === l.id)) gone("links", l.id);
  }
  for (const d of Object.values(to.drawings)) {
    const change = drawingEdit(from.drawings[d.id], d);
    if (change) push("drawings", change);
  }
  for (const id of Object.keys(from.drawings)) if (!to.drawings[id]) gone("drawings", id);
  for (const d of Object.values(to.details))
    if (!same(from.details[d.id], d)) push("details", { id: d.id, title: d.title, html: d.html });
  for (const id of Object.keys(from.details)) if (!to.details[id]) gone("details", id);
  if (!same(from.style, to.style)) edit.style = diffValue(from.style, to.style) as Record<string, string | null>;
  if (Object.keys(remove).length) edit.remove = remove;
  return edit;
}
/** Whether an edit changes nothing. */
export const isEmptyEdit = (edit: WorkEdit) => Object.keys(edit).length === 0;
