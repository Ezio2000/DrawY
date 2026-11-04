import type { Drawing, LinkEnd, Side, Work, WorkEdit } from "../contracts/index.ts";
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
          from: { moduleId: from.moduleId, at: from.side },
          to: { moduleId: to.moduleId, at: to.side },
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
