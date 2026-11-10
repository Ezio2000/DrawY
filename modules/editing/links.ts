import type { Bounds, Drawing, Instance, LinkEnd, Point, Side, Work, WorkEdit } from "../contracts/index.ts";
import { facing } from "../contracts/geometry.ts";
import { fieldsOf } from "./fields.ts";
import { newModule } from "./parts.ts";
import { drawingIds, fresh, partIds, sceneOf } from "./shared.ts";
export { facing, sideOf, sidePoint } from "../contracts/geometry.ts";
export { sideNames as sides, type Side } from "../contracts/index.ts";

/* Links a person draws between modules. Where a link meets a module belongs to the link's
 * end, so changing one link never touches a module or another link. */

/** What a new link is drawn with: the scene's latest link, so a drawn connection looks
 * like the author's, or failing that any link in the work; its words are left behind. */
export function linkLook(
  work: Work,
  sceneId: string,
): { drawingId: string; data: Record<string, unknown> } | null {
  const like =
    work.scenes[sceneId]?.links.at(-1) ??
    Object.values(work.scenes)
      .flatMap((s) => s.links)
      .at(-1);
  if (!like) return null;
  const { label: _l, text: _t, ...data } = like.data;
  return { drawingId: like.drawingId, data: structuredClone(data) };
}
/** Connects one module to another with a link drawn as `look`: from and to the sides named,
 * or, for an end that names none, the side facing the other end, wherever the modules then
 * move. A library drawing the work does not have is taken in; `copy` gives the work its own
 * copy instead, when one of its drawings uses the library drawing's id. Returns the link's
 * id. */
export function connect(
  work: Work,
  sceneId: string,
  from: { moduleId: string; side?: Side },
  to: { moduleId: string; side?: Side },
  look: { drawingId: string; data: Record<string, unknown> },
  copy?: Omit<Drawing, "id">,
): { edit: WorkEdit; id: string } {
  const scene = sceneOf(work, sceneId);
  if (from.moduleId === to.moduleId) throw Error("连线要连到另一个元素");
  if (![from, to].every((e) => scene.modules.some((m) => m.id === e.moduleId)))
    throw Error("元素不存在");
  const drawing = copy && {
    ...copy,
    id: fresh(look.drawingId, drawingIds(work)),
  };
  const id = fresh(`${from.moduleId}-to-${to.moduleId}`, partIds(work));
  const taken = !drawing && !work.drawings[look.drawingId];
  return {
    edit: {
      links: [
        {
          id,
          scene: sceneId,
          drawingId: drawing?.id ?? look.drawingId,
          from: { moduleId: from.moduleId, ...(from.side ? { at: from.side } : {}) },
          to: { moduleId: to.moduleId, ...(to.side ? { at: to.side } : {}) },
          data: structuredClone(look.data),
        },
      ],
      ...(taken ? { materials: [look.drawingId] } : {}),
      ...(drawing ? { drawings: [drawing] } : {}),
    },
    id,
  };
}
/** Moves one end of a link to a side of its module, or back to following the side facing the
 * other end, or, given another module, onto that one; a link never ends where it starts. */
export function reattach(
  work: Work,
  sceneId: string,
  linkId: string,
  end: "from" | "to",
  side: Side | undefined,
  moduleId?: string,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const link = scene.links.find((l) => l.id === linkId);
  if (!link) throw Error("连线不存在");
  const m = scene.modules.find((x) => x.id === (moduleId ?? link[end].moduleId));
  if (!m) throw Error("元素不存在");
  if (m.id === link[end === "from" ? "to" : "from"].moduleId)
    throw Error("连线要连到另一个元素");
  const place: LinkEnd = side ? { moduleId: m.id, at: side } : { moduleId: m.id };
  return { links: [{ id: linkId, scene: sceneId, [end]: place }] };
}
/** Turns a link round: what it came from it now goes to. */
export function reverse(work: Work, sceneId: string, linkId: string): WorkEdit {
  const link = sceneOf(work, sceneId).links.find((l) => l.id === linkId);
  if (!link) throw Error("连线不存在");
  return { links: [{ id: linkId, scene: sceneId, from: link.to, to: link.from }] };
}

const opposite: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
const overlaps = (a: Bounds, b: Bounds, margin: number) =>
  a.x < b.x + b.width + margin &&
  b.x < a.x + a.width + margin &&
  a.y < b.y + b.height + margin &&
  b.y < a.y + a.height + margin;
/** Grows a figure from one of its modules: a new module like it (the same drawing, size and
 * look, its main words replaced by `words` and its other words left behind), joined to it by
 * a link from the side named. Given a point, the new module is centred there; otherwise it
 * goes a `gap` beyond that side, and where something already stands there, as far along the
 * side as it takes to find room, so a second branch lands beside the first. The link is
 * drawn as `look`, as `connect` draws one. Returns the new module's id and the link's. */
export function extend(
  work: Work,
  sceneId: string,
  from: { moduleId: string; side: Side },
  to: { at?: Point; gap: number; words: string },
  look: { drawingId: string; data: Record<string, unknown> },
  copy?: Omit<Drawing, "id">,
): { edit: WorkEdit; id: string; link: string } {
  const scene = sceneOf(work, sceneId);
  const source = scene.modules.find((m) => m.id === from.moduleId);
  if (!source) throw Error("元素不存在");
  const texts = fieldsOf(work, source).filter((f) => f.type === "text" && f.set);
  const data = structuredClone(source.data);
  texts.forEach((f, i) => (i ? delete data[f.key] : (data[f.key] = to.words)));
  const { width, height } = source.bounds;
  let bounds: Bounds;
  if (to.at) bounds = { x: to.at.x - width / 2, y: to.at.y - height / 2, width, height };
  else {
    const across = from.side === "left" || from.side === "right";
    bounds = {
      width,
      height,
      x:
        from.side === "right"
          ? source.bounds.x + width + to.gap
          : from.side === "left"
            ? source.bounds.x - width - to.gap
            : source.bounds.x,
      y:
        from.side === "bottom"
          ? source.bounds.y + height + to.gap
          : from.side === "top"
            ? source.bounds.y - height - to.gap
            : source.bounds.y,
    };
    // Step along the side until the new module stands clear of what is there.
    const step = across ? height + to.gap / 2 : width + to.gap / 2;
    for (
      let n = 0;
      n < 24 && scene.modules.some((m) => m.id !== source.id && overlaps(m.bounds, bounds, to.gap / 4));
      n++
    )
      bounds = across ? { ...bounds, y: bounds.y + step } : { ...bounds, x: bounds.x + step };
  }
  const taken = partIds(work);
  const id = fresh(source.id, taken);
  taken.add(id);
  const module: Instance = { id, bounds, drawingId: source.drawingId, data };
  const drawing = copy && { ...copy, id: fresh(look.drawingId, drawingIds(work)) };
  const link = fresh(`${source.id}-to-${id}`, taken);
  const middle = { x: source.bounds.x + width / 2, y: source.bounds.y + height / 2 };
  const taking = !drawing && !work.drawings[look.drawingId];
  return {
    edit: {
      modules: [newModule(sceneId, module)],
      links: [
        {
          id: link,
          scene: sceneId,
          drawingId: drawing?.id ?? look.drawingId,
          from: { moduleId: source.id, at: from.side },
          to: { moduleId: id, at: to.at ? facing(bounds, middle) : opposite[from.side] },
          data: structuredClone(look.data),
        },
      ],
      ...(taking ? { materials: [look.drawingId] } : {}),
      ...(drawing ? { drawings: [drawing] } : {}),
    },
    id,
    link,
  };
}
