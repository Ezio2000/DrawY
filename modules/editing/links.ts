import type { Bounds, Drawing, Instance, LinkEnd, Point, Scene, Side, Work, WorkEdit } from "../contracts/index.ts";
import { endLink, endModule, isFree, ridesOn } from "../contracts/index.ts";
import { facing } from "../contracts/geometry.ts";
import { fieldsOf } from "./fields.ts";
import { newModule } from "./parts.ts";
import { drawingIds, fresh, partIds, sceneOf } from "./shared.ts";
export { facing, sideOf, sidePoint } from "../contracts/geometry.ts";
export { sideNames as sides, type Side } from "../contracts/index.ts";

/* Links a person draws between modules, along other links and to free points. Where a link
 * meets anything belongs to the link's end, so changing one link never touches a module or
 * another link. */

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
/** A link end on a module: on the side named, or following the side facing the other end. */
const end = (moduleId: string, side?: Side): LinkEnd => (side ? { moduleId, at: side } : { moduleId });
/** The edit that draws a new link as `look`: a library drawing the work does not have is
 * taken in, or, given `copy`, the work gets its own copy of it under a fresh id. */
function newLink(
  work: Work,
  link: { id: string; scene: string; from: LinkEnd; to: LinkEnd },
  look: { drawingId: string; data: Record<string, unknown> },
  copy?: Omit<Drawing, "id">,
): WorkEdit {
  const drawing = copy && { ...copy, id: fresh(look.drawingId, drawingIds(work)) };
  const taken = !drawing && !work.drawings[look.drawingId];
  return {
    links: [
      {
        id: link.id,
        scene: link.scene,
        drawingId: drawing?.id ?? look.drawingId,
        from: link.from,
        to: link.to,
        data: structuredClone(look.data),
      },
    ],
    ...(taken ? { materials: [look.drawingId] } : {}),
    ...(drawing ? { drawings: [drawing] } : {}),
  };
}
/** Why an end cannot be where it is asked to be in a scene, if it cannot: what it meets must
 * be there, the two ends of a link cannot meet the same module, and a link cannot ride on
 * itself or on a link that rides on it. */
function misplaced(scene: Scene, linkId: string | undefined, end: LinkEnd, other: LinkEnd) {
  const module = endModule(end),
    line = endLink(end);
  if (module && !scene.modules.some((m) => m.id === module)) return "元素不存在";
  if (module && module === endModule(other)) return "连线要连到另一个元素";
  if (line) {
    if (!scene.links.some((l) => l.id === line)) return "连线不存在";
    // Riding on a link that rides, however far, on this one would go round in a ring.
    const linkOf = (id: string) => scene.links.find((l) => l.id === id);
    if (linkId && (line === linkId || ridesOn(linkOf(line)!, linkId, linkOf))) return "连线不能沿着自己";
  }
  return null;
}
/** A short name for what an end meets, for the id of a link drawn to it. */
const nameOfEnd = (e: LinkEnd) => endModule(e) ?? endLink(e) ?? "point";
/** Connects two ends with a link drawn as `look`: each end on a module (a side, a point on
 * it, a share along its outline, or following the side facing the other end), along
 * another link, or free at a point. A library drawing the work does not have is taken in;
 * `copy` gives the work its own copy instead, when one of its drawings uses the library
 * drawing's id. Returns the link's id. */
export function connect(
  work: Work,
  sceneId: string,
  from: LinkEnd,
  to: LinkEnd,
  look: { drawingId: string; data: Record<string, unknown> },
  copy?: Omit<Drawing, "id">,
): { edit: WorkEdit; id: string } {
  const scene = sceneOf(work, sceneId);
  const wrong = misplaced(scene, undefined, from, to) ?? misplaced(scene, undefined, to, from);
  if (wrong) throw Error(wrong);
  if (isFree(from) && isFree(to)) throw Error("连线至少要有一端连着东西");
  const id = fresh(`${nameOfEnd(from)}-to-${nameOfEnd(to)}`, partIds(work));
  const edit = newLink(work, { id, scene: sceneId, from, to }, look, copy);
  return { edit, id };
}
/** Moves one end of a link elsewhere: to a side of its module, back to following the side
 * facing the other end, onto another module, along another link or to a free point. A link
 * never ends where it starts. */
export function reattach(work: Work, sceneId: string, linkId: string, which: "from" | "to", to: LinkEnd): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const link = scene.links.find((l) => l.id === linkId);
  if (!link) throw Error("连线不存在");
  const other = link[which === "from" ? "to" : "from"];
  const wrong = misplaced(scene, linkId, to, other);
  if (wrong) throw Error(wrong);
  if (isFree(to) && isFree(other)) throw Error("连线至少要有一端连着东西");
  return { links: [{ id: linkId, scene: sceneId, [which]: to }] };
}
/** Takes out the links of a scene that meet nothing at either end. */
export function removeDangling(work: Work, sceneId: string): WorkEdit | null {
  const links = sceneOf(work, sceneId).links.filter((l) => isFree(l.from) && isFree(l.to)).map((l) => l.id);
  return links.length ? { remove: { links } } : null;
}
/** The links of a scene that meet nothing at either end, left when what they met went. */
export const danglingIn = (work: Work, sceneId: string) =>
  (work.scenes[sceneId]?.links ?? []).filter((l) => isFree(l.from) && isFree(l.to)).map((l) => l.id);
/** Turns links round: what each came from it now goes to. */
export function reverse(work: Work, sceneId: string, linkIds: string[]): WorkEdit {
  const links = sceneOf(work, sceneId).links.filter((l) => linkIds.includes(l.id));
  if (!links.length) throw Error("连线不存在");
  return { links: links.map((l) => ({ id: l.id, scene: sceneId, from: l.to, to: l.from })) };
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
  const link = fresh(`${source.id}-to-${id}`, taken);
  const middle = { x: source.bounds.x + width / 2, y: source.bounds.y + height / 2 };
  const joined = newLink(
    work,
    {
      id: link,
      scene: sceneId,
      from: end(source.id, from.side),
      to: end(id, to.at ? facing(bounds, middle) : opposite[from.side]),
    },
    look,
    copy,
  );
  return { edit: { modules: [newModule(sceneId, module)], ...joined }, id, link };
}
