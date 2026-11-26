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
import { endLink, endModule, isFree, materialsOfPart, type LinkEnd } from "../contracts/index.ts";
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
  // Links between the modules copied, those hanging from them by one end with the other
  // free, and links riding on the links taken: every end it has on something is taken too.
  const taken = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const l of scene.links) {
      if (taken.has(l.id)) continue;
      const ends = [l.from, l.to];
      const held = ends.every((e) => (isFree(e) ? true : endModule(e) ? inside.has(endModule(e)!) : taken.has(endLink(e)!)));
      if (held && ends.some((e) => !isFree(e))) {
        taken.add(l.id);
        grew = true;
      }
    }
  }
  const links = scene.links.filter((l) => taken.has(l.id));
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
 * `offset` (the same step across and down, or a distance each way), or centred on
 * `centre`, or where it was. Parts get ids of their own; a drawing
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
  }: { offset?: number | Point; centre?: Point } = {},
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
  const by = typeof offset === "number" ? { x: offset, y: offset } : offset;
  const dx = centre ? centre.x - (box.x + box.width / 2) : by.x,
    dy = centre ? centre.y - (box.y + box.height / 2) : by.y;
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
  const linkOf = new Map<string, string>();
  for (const l of clip.links) {
    const id = fresh(l.id, ids);
    ids.add(id);
    linkOf.set(l.id, id);
  }
  // Each end meets the copy of what it met; a free end goes as far as everything else.
  const endOf = (e: LinkEnd): LinkEnd =>
    "moduleId" in e
      ? { ...e, moduleId: moduleOf.get(e.moduleId)! }
      : "linkId" in e
        ? { ...e, linkId: linkOf.get(e.linkId)! }
        : { x: e.x + dx, y: e.y + dy };
  const links = clip.links.map((l) => ({
    ...structuredClone(l),
    id: linkOf.get(l.id)!,
    scene: sceneId,
    drawingId: drawingOf.get(l.drawingId) ?? l.drawingId,
    from: endOf(l.from),
    to: endOf(l.to),
  }));
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
/** Copies modules a little way off (the same step across and down, or a distance each
 * way, as a copy dragged off its original), on top of everything, with the links between
 * them; copies of grouped modules form a group of their own. Returns the copies' ids. */
export function duplicate(
  work: Work,
  sceneId: string,
  ids: string[],
  offset: number | Point,
): { edit: WorkEdit; ids: string[] } {
  const clip = copy(work, sceneId, ids);
  return clip ? paste(work, sceneId, clip, { offset }) : { edit: {}, ids: [] };
}
