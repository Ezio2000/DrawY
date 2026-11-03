import type {
  Bounds,
  Drawing,
  Instance,
  Link,
  MaterialUse,
  Point,
  Work,
  WorkEdit,
} from "../contracts/index.ts";
import { union } from "../contracts/geometry.ts";
import { drawingIds, edit, fresh, partIds, sceneOf } from "./shared.ts";

/* Copying parts and pasting them into the same scene, another scene or another work. A
 * clip carries everything the parts need to draw the same way: the links between them,
 * the work's own drawings and the library drawings they use, and the materials they show. */

type LibraryDrawing = Extract<MaterialUse, { kind: "drawing" }>;

export interface Clip {
  kind: "drawy/parts";
  workId: string;
  sceneId: string;
  modules: Instance[];
  links: Link[];
  drawings: Drawing[];
  /** The library drawings the parts are drawn with, as the work had them, so a work whose
   * own drawing has the same id can take them under another. */
  libraries?: LibraryDrawing[];
  materials: string[];
}
export const isClip = (v: unknown): v is Clip =>
  !!v &&
  typeof v === "object" &&
  (v as Clip).kind === "drawy/parts" &&
  Array.isArray((v as Clip).modules);
/** The materials a part shows: its library drawing, the pictures its data names and those
 * its own drawing's code quotes. */
function materialsOf(work: Work, part: Instance | Link) {
  const ids = new Set<string>();
  const known = (id: string) => !!work.materials[id] && ids.add(id);
  known(part.drawingId);
  const scan = (v: unknown) => {
    if (typeof v === "string") known(v);
    else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  };
  scan(part.data);
  const source = work.drawings[part.drawingId]?.source ?? "";
  for (const [, id] of source.matchAll(/["'`]([a-z0-9]+(?:-+[a-z0-9]+)*)["'`]/g))
    known(id);
  return [...ids];
}
/** What copying these modules takes along. Null when none of them is in the scene. */
export function copy(work: Work, sceneId: string, ids: string[]): Clip | null {
  const scene = sceneOf(work, sceneId);
  const modules = scene.modules.filter((m) => ids.includes(m.id));
  if (!modules.length) return null;
  const inside = new Set(modules.map((m) => m.id));
  const links = scene.links.filter(
    (l) => inside.has(l.from.moduleId) && inside.has(l.to.moduleId),
  );
  const parts = [...modules, ...links];
  return structuredClone({
    kind: "drawy/parts" as const,
    workId: work.id,
    sceneId,
    modules,
    links,
    drawings: [
      ...new Set(parts.flatMap((p) => (work.drawings[p.drawingId] ? [p.drawingId] : []))),
    ].map((id) => work.drawings[id]),
    libraries: [
      ...new Set(
        parts.flatMap((p) =>
          !work.drawings[p.drawingId] && work.materials[p.drawingId]?.kind === "drawing"
            ? [p.drawingId]
            : [],
        ),
      ),
    ].map((id) => work.materials[id] as LibraryDrawing),
    materials: [...new Set(parts.flatMap((p) => materialsOf(work, p)))],
  });
}
/** The box around what a clip holds. */
export const clipBounds = (clip: Clip): Bounds =>
  union(clip.modules.map((m) => m.bounds));
/** Pastes a clip into a scene, on top of everything, selected as one: shifted by
 * `offset`, or centred on `centre`, or where it was. Parts get ids of their own; a drawing
 * the work has under the same id with other code comes in under a new id; a library
 * drawing whose id one of the work's own drawings uses comes in as a drawing of the work's
 * own under a new id, its defaults written into the parts' data since only library
 * drawings fill them in (`labels` names its values for the editor); targets the work does
 * not have lead nowhere. Returns the pasted modules' ids. */
export function paste(
  work: Work,
  sceneId: string,
  clip: Clip,
  {
    offset = 0,
    centre,
    labels = {},
  }: { offset?: number; centre?: Point; labels?: Record<string, string> } = {},
): { edit: WorkEdit; ids: string[] } {
  const scene = sceneOf(work, sceneId);
  const ids = partIds(work),
    groups = new Set(
      Object.values(work.scenes).flatMap((s) =>
        s.modules.flatMap((m) => (m.group ? [m.group] : [])),
      ),
    ),
    names = drawingIds(work);
  // Drawings: the same one is used as it is; a clash gets a new id.
  const drawingOf = new Map<string, string>(),
    drawings: Drawing[] = [];
  for (const d of clip.drawings) {
    const have = work.drawings[d.id];
    if (have && have.source === d.source && JSON.stringify(have.params) === JSON.stringify(d.params)) {
      drawingOf.set(d.id, d.id);
      continue;
    }
    const id = have || work.materials[d.id] ? fresh(d.id, names) : d.id;
    names.add(id);
    drawingOf.set(d.id, id);
    drawings.push({ ...d, id });
  }
  // Library drawings shadowed by one of the work's own: taken as the work's own.
  const defaultsOf = new Map<string, Record<string, unknown>>();
  for (const use of clip.libraries ?? []) {
    if (!work.drawings[use.id]) continue;
    const id = fresh(use.id, names);
    names.add(id);
    drawingOf.set(use.id, id);
    defaultsOf.set(use.id, use.defaults);
    const params = Object.entries(use.params);
    drawings.push({
      id,
      name: use.name,
      ...(params.length
        ? {
            params: Object.fromEntries(
              params.map(([k, p]) => [k, { ...p, label: labels[k] ?? k }]),
            ),
          }
        : {}),
      source: use.source,
    });
  }
  const dataOf = (p: Instance | Link) => ({
    ...structuredClone(defaultsOf.get(p.drawingId) ?? {}),
    ...structuredClone(p.data),
  });
  const box = clipBounds(clip);
  const dx = centre ? centre.x - (box.x + box.width / 2) : offset,
    dy = centre ? centre.y - (box.y + box.height / 2) : offset;
  const moduleOf = new Map<string, string>(),
    groupOf = new Map<string, string>();
  const has = (t: Instance["target"]) =>
    !!t && (t.kind === "scene" ? !!work.scenes[t.id] : !!work.details[t.id]);
  const modules = clip.modules.map((m) => {
    const id = fresh(m.id, ids);
    ids.add(id);
    moduleOf.set(m.id, id);
    let group = m.group;
    if (group) {
      if (!groupOf.has(group)) {
        const g = fresh(group, groups);
        groups.add(g);
        groupOf.set(group, g);
      }
      group = groupOf.get(group)!;
    }
    return {
      ...structuredClone(m),
      id,
      group,
      drawingId: drawingOf.get(m.drawingId) ?? m.drawingId,
      data: dataOf(m),
      target: has(m.target) ? m.target : null,
      bounds: { ...m.bounds, x: m.bounds.x + dx, y: m.bounds.y + dy },
    };
  });
  const links = clip.links.map((l) => {
    const id = fresh(l.id, ids);
    ids.add(id);
    return {
      ...structuredClone(l),
      id,
      drawingId: drawingOf.get(l.drawingId) ?? l.drawingId,
      data: dataOf(l),
      from: { ...l.from, moduleId: moduleOf.get(l.from.moduleId)! },
      to: { ...l.to, moduleId: moduleOf.get(l.to.moduleId)! },
    };
  });
  // A library drawing taken as the work's own is not taken from the library too.
  const materials = clip.materials.filter((id) => !defaultsOf.has(id));
  return {
    edit: edit(
      work,
      [
        {
          ...scene,
          modules: [...scene.modules, ...modules],
          links: [...scene.links, ...links],
        },
      ],
      {
        ...(drawings.length ? { drawings } : {}),
        ...(materials.length ? { materials } : {}),
      },
    ),
    ids: modules.map((m) => m.id),
  };
}
