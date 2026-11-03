import {
  boundsOf,
  DomainError,
  type AuthorWrite,
  type Instance,
  type Scene,
  type SceneEdit,
  type Work,
  type WorkEdit,
} from "../contracts/index.ts";
import { applied } from "../editing/apply.ts";
import { anchorAt, facing, sides, type Side } from "../editing/links.ts";

/* The author's flat write as the edit the workspace commits. A write leaves out what a
 * record can do without: new parts take their defaults here, and a link given only module
 * ids takes the sides facing each other, whose anchors the modules are given. */

/** What a person editing the work calls a module whose label was left out: its words. */
function labelOf(id: string, data: Record<string, unknown> | undefined) {
  for (const key of ["text", "title", "name", "label"])
    if (typeof data?.[key] === "string" && data[key]) return data[key] as string;
  return id;
}
const centre = (m: Instance) => ({
  x: m.bounds.x + m.bounds.width / 2,
  y: m.bounds.y + m.bounds.height / 2,
});
export function fromAuthor(work: Work, write: AuthorWrite, current: string): WorkEdit {
  const fresh: Scene[] = [];
  const edits = new Map<string, SceneEdit>();
  const editOf = (id: string) => {
    if (!edits.has(id)) edits.set(id, { id });
    return edits.get(id)!;
  };
  const cleared = new Set<string>();
  for (const { id, title, parentId, interactionId, checks, clear, order } of write.scenes ?? []) {
    if (work.scenes[id]) {
      const edit = editOf(id);
      if (title !== undefined) edit.title = title;
      if (parentId !== undefined) edit.parentId = parentId;
      if (interactionId !== undefined) edit.interactionId = interactionId;
      if (checks) edit.checks = checks;
      if (clear) {
        // Everything in it goes, with the checks on what is gone, unless this write sets them.
        cleared.add(id);
        edit.removeModules = work.scenes[id].modules.map((m) => m.id);
        edit.removeLinks = work.scenes[id].links.map((l) => l.id);
        edit.checks ??= [];
      }
    } else {
      if (title === undefined) throw new DomainError(`场景 ${id} 是新的，要给 title`);
      fresh.push({
        id,
        title,
        parentId: parentId ?? current,
        modules: [],
        links: [],
        interactionId: interactionId ?? null,
        checks: checks ?? [],
      });
    }
    if (order) editOf(id).order = order;
  }
  const has = (sceneId: string, part: "modules" | "links", id: string) =>
    !cleared.has(sceneId) && !!work.scenes[sceneId]?.[part].some((p) => p.id === id);

  for (const { scene, ...m } of write.modules ?? []) {
    const sceneId = scene ?? current;
    const edit = editOf(sceneId);
    const { bounds, ...rest } = m;
    const box = bounds ? { bounds: boundsOf(bounds) } : {};
    const known = has(sceneId, "modules", m.id) || edit.modules?.some((x) => x.id === m.id);
    if (!known && (!bounds || !m.drawingId))
      throw new DomainError(`模块 ${m.id} 是新增的，要给全 bounds、drawingId`);
    (edit.modules ??= []).push(
      known
        ? { ...rest, ...box }
        : {
            group: null,
            target: null,
            anchors: {},
            data: {},
            ...rest,
            ...box,
            label: m.label ?? labelOf(m.id, m.data),
          },
    );
  }

  // Modules as this write leaves them, which is what a link's sides are worked out from.
  const laid = () =>
    applied(work, {
      baseRevision: write.baseRevision,
      ...(fresh.length ? { scenes: fresh } : {}),
      sceneEdits: [...edits.values()].map(({ order: _, ...e }) => e),
    });
  const next = (write.links ?? []).length ? laid() : work;
  const end = (
    sceneId: string,
    linkId: string,
    given: NonNullable<NonNullable<AuthorWrite["links"]>[number]["from"]>,
    other: string | undefined,
  ) => {
    const moduleId = typeof given === "string" ? given : given.moduleId;
    const m = next.scenes[sceneId]?.modules.find((x) => x.id === moduleId);
    if (!m) throw new DomainError(`连线 ${linkId} 的一端 ${moduleId} 不在场景 ${sceneId} 里`);
    let side: Side;
    if (typeof given === "string") {
      const far = next.scenes[sceneId].modules.find((x) => x.id === other);
      if (!far) throw new DomainError(`连线 ${linkId} 的一端 ${other ?? "?"} 不在场景 ${sceneId} 里`);
      side = facing(m, centre(far));
    } else if (m.anchors[given.anchor] || !sides.includes(given.anchor as Side))
      // A named anchor is the module's own; one it does not have is the validation's to report.
      return given;
    else side = given.anchor as Side;
    const { module, anchor } = anchorAt(m, side);
    if (module !== m) {
      m.anchors = module.anchors;
      (editOf(sceneId).modules ??= []).push({ id: m.id, anchors: module.anchors });
    }
    return { moduleId, anchor };
  };
  const idOf = (e: string | { moduleId: string } | undefined) =>
    typeof e === "string" ? e : e?.moduleId;
  for (const { scene, from, to, ...l } of write.links ?? []) {
    const sceneId = scene ?? current;
    const edit = editOf(sceneId);
    const known = has(sceneId, "links", l.id) || edit.links?.some((x) => x.id === l.id);
    if (!known && (!from || !to)) throw new DomainError(`连线 ${l.id} 是新增的，要给全 from、to`);
    const existing = next.scenes[sceneId]?.links.find((x) => x.id === l.id);
    const farFrom = idOf(to) ?? existing?.to.moduleId;
    const farTo = idOf(from) ?? existing?.from.moduleId;
    (edit.links ??= []).push({
      ...(known ? {} : { drawingId: "arrow", data: {} }),
      ...l,
      ...(from ? { from: end(sceneId, l.id, from, farFrom) } : {}),
      ...(to ? { to: end(sceneId, l.id, to, farTo) } : {}),
    });
  }

  const holder = (part: "modules" | "links", id: string) =>
    has(current, part, id)
      ? current
      : (Object.keys(work.scenes).find((sceneId) => has(sceneId, part, id)) ?? current);
  const { modules: gone, links: cut, ...others } = write.remove ?? {};
  for (const id of gone ?? []) (editOf(holder("modules", id)).removeModules ??= []).push(id);
  for (const id of cut ?? []) (editOf(holder("links", id)).removeLinks ??= []).push(id);

  const { baseRevision, title, drawings, interactions, details, materials, style } = write;
  return {
    baseRevision,
    ...(title !== undefined ? { title } : {}),
    ...(fresh.length ? { scenes: fresh } : {}),
    ...(edits.size ? { sceneEdits: [...edits.values()] } : {}),
    ...(drawings ? { drawings } : {}),
    ...(interactions ? { interactions } : {}),
    ...(details ? { details } : {}),
    ...(materials ? { materials } : {}),
    ...(style ? { style } : {}),
    ...(Object.keys(others).length ? { remove: others } : {}),
  };
}
