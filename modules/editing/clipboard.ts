import type {
  Bounds,
  Drawing,
  Instance,
  Link,
  Point,
  Work,
  WorkEdit,
} from "../contracts/index.ts";
import { union } from "../contracts/geometry.ts";
import { drawingIds, edit, fresh, partIds, sceneOf } from "./shared.ts";

/* Copying parts and pasting them into the same scene, another scene or another work. A
 * clip carries everything the parts need to draw the same way: the links between them,
 * the work's own drawings they use and the materials they show. */

export interface Clip {
  kind: "drawy/parts";
  workId: string;
  sceneId: string;
  modules: Instance[];
  links: Link[];
  drawings: Drawing[];
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
    materials: [...new Set(parts.flatMap((p) => materialsOf(work, p)))],
  });
}
/** The box around what a clip holds. */
export const clipBounds = (clip: Clip): Bounds =>
  union(clip.modules.map((m) => m.bounds));
/** Pastes a clip into a scene, on top of everything, selected as one: shifted by
 * `offset`, or centred on `centre`, or where it was. Parts get ids of their own; a drawing
 * the work has under the same id with other code comes in under a new id; targets the
 * work does not have lead nowhere. Returns the pasted modules' ids. */
export function paste(
  work: Work,
  sceneId: string,
  clip: Clip,
  { offset = 0, centre }: { offset?: number; centre?: Point } = {},
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
      from: { ...l.from, moduleId: moduleOf.get(l.from.moduleId)! },
      to: { ...l.to, moduleId: moduleOf.get(l.to.moduleId)! },
    };
  });
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
        ...(clip.materials.length ? { materials: clip.materials } : {}),
      },
    ),
    ids: modules.map((m) => m.id),
  };
}
