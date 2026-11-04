import type { Instance, Link, Scene, Work } from "../contracts/index.ts";

/* What changed between two revisions of a work, so the author is told what the person
 * changed by hand and keeps it. */

/** Whether two values hold the same, whatever order their keys were written in. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as any)[k] !== undefined),
    kb = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => same((a as any)[k], (b as any)[k]))
  );
}
/** What changed in a work between two of its revisions: per scene, the parts added,
 * removed, changed in what they show, and only moved or resized, and whether the scene
 * itself (its title, parent, interaction or checks) changed; the scenes added and removed whole;
 * the drawings, interactions and details added, changed or removed; and whether its
 * shared style changed. */
export function changesBetween(before: Work, after: Work) {
  const scenes = Object.values(after.scenes).flatMap((scene) => {
    const was = before.scenes[scene.id];
    const old = new Map(
      [...(was?.modules ?? []), ...(was?.links ?? [])].map((p) => [p.id, p]),
    );
    const now = [...scene.modules, ...scene.links];
    const ids = new Set(now.map((p) => p.id));
    const source = (w: Work, p: Instance | Link) =>
      w.drawings[p.drawingId]?.source;
    const added: string[] = [],
      changed: string[] = [],
      moved: string[] = [];
    for (const p of now) {
      const o = old.get(p.id);
      if (!o) added.push(p.id);
      else if (
        !same({ ...o, bounds: null }, { ...p, bounds: null }) ||
        source(before, o) !== source(after, p)
      )
        changed.push(p.id);
      else if ("bounds" in p && !same(p.bounds, (o as Instance).bounds))
        moved.push(p.id);
    }
    const removed = [...old.keys()].filter((id) => !ids.has(id));
    // Stacking order is part of the composition too.
    const order = (s?: Scene) =>
      s?.modules
        .map((m) => m.id)
        .filter((id) => ids.has(id) && old.has(id))
        .join();
    const restacked = order(was) !== order(scene);
    // A new scene is reported whole, below; this is about what changed inside one.
    if (!was) return [];
    const retitled =
      was.title !== scene.title ||
      was.parentId !== scene.parentId ||
      was.interactionId !== scene.interactionId;
    const checksChanged = !same(was.checks, scene.checks);
    return added.length ||
      removed.length ||
      changed.length ||
      moved.length ||
      restacked ||
      retitled ||
      checksChanged
      ? [{ id: scene.id, added, removed, changed, moved, restacked, retitled, checksChanged }]
      : [];
  });
  const records = <T>(a: Record<string, T>, b: Record<string, T>) => ({
    added: Object.keys(b).filter((k) => !(k in a)),
    changed: Object.keys(b).filter((k) => k in a && !same(a[k], b[k])),
    removed: Object.keys(a).filter((k) => !(k in b)),
  });
  const sceneRecords = records(before.scenes, after.scenes);
  return {
    scenes,
    addedScenes: sceneRecords.added,
    removedScenes: sceneRecords.removed,
    drawings: records(before.drawings, after.drawings),
    interactions: records(before.interactions, after.interactions),
    details: records(before.details, after.details),
    style: !same(before.style, after.style),
  };
}
