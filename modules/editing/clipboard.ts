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
import { materialsOfPart } from "../contracts/index.ts";
import { drawingIds, fresh, partIds, sceneOf } from "./shared.ts";
import { newModule } from "./parts.ts";

/* Copying parts and pasting them into the same scene, another scene or another work. A
 * clip carries everything the parts need to draw the same way: the links between them,
 * the work's own drawings and the library drawings they use, and the materials they show. */

type LibraryDrawing = Extract<MaterialUse, { kind: "drawing" }>;

export interface Clip {
  kind: "drawy/clip";
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
  (v as Clip).kind === "drawy/clip" &&
  Array.isArray((v as Clip).modules);
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
    kind: "drawy/clip" as const,
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
    materials: [...new Set(parts.flatMap((p) => materialsOfPart(work, p)))],
  });
}
/** The box around what a clip holds. */
export const clipBounds = (clip: Clip): Bounds =>
  union(clip.modules.map((m) => m.bounds));
/** Pastes a clip into a scene, on top of everything, selected as one: shifted by
 * `offset`, or centred on `centre`, or where it was. Parts get ids of their own; a drawing
 * the work has under the same id with other code comes in under a new id; a library
 * drawing whose id one of the work's own drawings uses comes in as a drawing of the work's
 * own under a new id; targets the work does not have lead nowhere. Returns the pasted
 * modules' ids. */
export function paste(
  work: Work,
  sceneId: string,
  clip: Clip,
  {
    offset = 0,
    centre,
  }: { offset?: number; centre?: Point } = {},
): { edit: WorkEdit; ids: string[] } {
  sceneOf(work, sceneId);
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
  const copied = new Set<string>();
  for (const use of clip.libraries ?? []) {
    if (!work.drawings[use.id]) continue;
    const id = fresh(use.id, names);
    names.add(id);
    drawingOf.set(use.id, id);
    copied.add(use.id);
    drawings.push({
      id,
      name: use.name,
      ...(Object.keys(use.params).length ? { params: use.params } : {}),
      ...(Object.keys(use.defaults).length ? { defaults: use.defaults } : {}),
      source: use.source,
    });
  }
  const box = clipBounds(clip);
  const dx = centre ? centre.x - (box.x + box.width / 2) : offset,
    dy = centre ? centre.y - (box.y + box.height / 2) : offset;
  const moduleOf = new Map<string, string>(),
    groupOf = new Map<string, string>();
  const has = (t: NonNullable<Instance["target"]>) =>
    t.kind === "scene" ? !!work.scenes[t.id] : !!work.details[t.id];
  const modules = clip.modules.map((m): Instance => {
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
    const { target, ...rest } = structuredClone(m);
    return {
      ...rest,
      id,
      ...(group ? { group } : {}),
      drawingId: drawingOf.get(m.drawingId) ?? m.drawingId,
      ...(target && has(target) ? { target } : {}),
      bounds: { ...m.bounds, x: m.bounds.x + dx, y: m.bounds.y + dy },
    };
  });
  const links = clip.links.map((l) => {
    const id = fresh(l.id, ids);
    ids.add(id);
    return {
      ...structuredClone(l),
      id,
      scene: sceneId,
      drawingId: drawingOf.get(l.drawingId) ?? l.drawingId,
      from: { ...l.from, moduleId: moduleOf.get(l.from.moduleId)! },
      to: { ...l.to, moduleId: moduleOf.get(l.to.moduleId)! },
    };
  });
  // A library drawing taken as the work's own is not taken from the library too.
  const materials = clip.materials.filter((id) => !copied.has(id));
  return {
    edit: {
      modules: modules.map((m) => newModule(sceneId, m)),
      ...(links.length ? { links } : {}),
      ...(drawings.length ? { drawings } : {}),
      ...(materials.length ? { materials } : {}),
    },
    ids: modules.map((m) => m.id),
  };
}
