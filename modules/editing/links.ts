import type { Drawing, Instance, Link, Point, Work, WorkEdit } from "../contracts/index.ts";
import { drawingIds, edit, fresh, partIds, sceneOf } from "./shared.ts";

/* Links a person draws between modules: from the middle of one module's side to another's,
 * through named anchors on each module, the way the author connects them. */

export type Side = "left" | "right" | "top" | "bottom";
export const sides: Side[] = ["left", "right", "top", "bottom"];
/** Where on a module each side's anchor sits, as a share of its size. */
export const sidePoint: Record<Side, Point> = {
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
};
/** The side of a module an anchor sits on, if it sits on one. */
export function sideOf(a: Point): Side | null {
  const d: [Side, number][] = [
    ["left", a.x],
    ["right", 1 - a.x],
    ["top", a.y],
    ["bottom", 1 - a.y],
  ];
  const [side, distance] = d.reduce((b, e) => (e[1] < b[1] ? e : b));
  return distance <= 0.05 ? side : null;
}
/** The side of a module facing a point, in scene units. */
export function facing(m: Instance, p: Point): Side {
  const cx = m.bounds.x + m.bounds.width / 2,
    cy = m.bounds.y + m.bounds.height / 2;
  const dx = (p.x - cx) / m.bounds.width,
    dy = (p.y - cy) / m.bounds.height;
  return Math.abs(dx) > Math.abs(dy)
    ? dx < 0
      ? "left"
      : "right"
    : dy < 0
      ? "top"
      : "bottom";
}
/** The name of the anchor at a point on a module: one it has there already, or a new one
 * named for the side, which the module is given. */
function anchorAt(m: Instance, side: Side): { module: Instance; anchor: string } {
  const at = sidePoint[side];
  const have = Object.entries(m.anchors).find(
    ([, a]) => Math.abs(a.x - at.x) < 0.02 && Math.abs(a.y - at.y) < 0.02,
  );
  if (have) return { module: m, anchor: have[0] };
  const name = fresh(side, new Set(Object.keys(m.anchors)));
  return {
    module: { ...m, anchors: { ...m.anchors, [name]: { ...at } } },
    anchor: name,
  };
}
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
/** Connects one module's side to another's with a link drawn as `look`. A library drawing
 * the work does not have is taken in; `copy` gives the work its own copy instead, when one
 * of its drawings uses the library drawing's id. Returns the link's id. */
export function connect(
  work: Work,
  sceneId: string,
  from: { moduleId: string; side: Side },
  to: { moduleId: string; side: Side },
  look: { drawingId: string; data: Record<string, unknown> },
  copy?: Omit<Drawing, "id">,
): { edit: WorkEdit; id: string } {
  const scene = sceneOf(work, sceneId);
  if (from.moduleId === to.moduleId) throw Error("连线要连到另一个元素");
  const a = scene.modules.find((m) => m.id === from.moduleId),
    b = scene.modules.find((m) => m.id === to.moduleId);
  if (!a || !b) throw Error("元素不存在");
  const start = anchorAt(a, from.side),
    end = anchorAt(b, to.side);
  const drawing = copy && {
    ...copy,
    id: fresh(look.drawingId, drawingIds(work)),
  };
  const link: Link = {
    id: fresh(`${a.id}-to-${b.id}`, partIds(work)),
    drawingId: drawing?.id ?? look.drawingId,
    from: { moduleId: a.id, anchor: start.anchor },
    to: { moduleId: b.id, anchor: end.anchor },
    data: structuredClone(look.data),
  };
  const changed = new Map([
    [a.id, start.module],
    [b.id, end.module],
  ]);
  const taken = !drawing && !work.drawings[look.drawingId];
  return {
    edit: edit(
      work,
      [
        {
          ...scene,
          modules: scene.modules.map((m) => changed.get(m.id) ?? m),
          links: [...scene.links, link],
        },
      ],
      {
        ...(taken ? { materials: [look.drawingId] } : {}),
        ...(drawing ? { drawings: [drawing] } : {}),
      },
    ),
    id: link.id,
  };
}
/** Moves one end of a link to a side of its module, or, given another module, to a side
 * of that one; a link never ends where it starts. */
export function reattach(
  work: Work,
  sceneId: string,
  linkId: string,
  end: "from" | "to",
  side: Side,
  moduleId?: string,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const link = scene.links.find((l) => l.id === linkId);
  if (!link) throw Error("连线不存在");
  const m = scene.modules.find((x) => x.id === (moduleId ?? link[end].moduleId));
  if (!m) throw Error("元素不存在");
  if (m.id === link[end === "from" ? "to" : "from"].moduleId)
    throw Error("连线要连到另一个元素");
  const at = anchorAt(m, side);
  return edit(work, [
    {
      ...scene,
      modules: scene.modules.map((x) => (x.id === m.id ? at.module : x)),
      links: scene.links.map((l) =>
        l.id === linkId
          ? { ...l, [end]: { moduleId: m.id, anchor: at.anchor } }
          : l,
      ),
    },
  ]);
}
/** Turns a link round: what it came from it now goes to. */
export function reverse(work: Work, sceneId: string, linkId: string): WorkEdit {
  const scene = sceneOf(work, sceneId);
  return edit(work, [
    {
      ...scene,
      links: scene.links.map((l) =>
        l.id === linkId ? { ...l, from: l.to, to: l.from } : l,
      ),
    },
  ]);
}
