import { isItemId, type Instance, type Link, type Scene, type Work } from "../contracts/index.ts";

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
type Item = { id: string };
const items = (v: unknown): Item[] | null =>
  Array.isArray(v) && v.every((x) => x && typeof x === "object" && isItemId((x as Item).id)) ? (v as Item[]) : null;
/** What changed in the lists of a part's data, item by item and by id, so the author is told
 * "messages: m6 added; m3 changed" rather than only that the part changed. Lists without
 * ids are left to the record the author is shown. */
export function itemChanges(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => {
    const a = items(before[key]) ?? (before[key] === undefined ? [] : null),
      b = items(after[key]) ?? (after[key] === undefined ? [] : null);
    if (!a || !b || (!a.length && !b.length) || same(a, b)) return [];
    const was = new Map(a.map((x) => [x.id, x])),
      now = new Set(b.map((x) => x.id));
    const kept = b.filter((x) => was.has(x.id));
    const parts = [
      ...[["added", b.filter((x) => !was.has(x.id)).map((x) => x.id)], ["removed", a.filter((x) => !now.has(x.id)).map((x) => x.id)], ["changed", kept.filter((x) => !same(x, was.get(x.id))).map((x) => x.id)]].flatMap(([word, ids]) =>
        ids.length ? [`${(ids as string[]).join(", ")} ${word}`] : [],
      ),
      ...(kept.map((x) => x.id).join() !== a.filter((x) => now.has(x.id)).map((x) => x.id).join() ? ["reordered"] : []),
    ];
    return parts.length ? [`${key}: ${parts.join("; ")}`] : [];
  });
}
/** What changed in a work between two of its revisions: per scene, the parts added,
 * removed, changed in what they show (with the items of their lists changed), and only
 * moved or resized, and whether the scene
 * itself (its title, parent, script or checks) changed; the scenes added and removed whole;
 * the drawings and details added, changed or removed; and whether its shared style changed. */
export function changesBetween(before: Work, after: Work) {
  const scenes = Object.values(after.scenes).flatMap((scene) => {
    const was = before.scenes[scene.id];
    const old = new Map(
      [...(was?.modules ?? []), ...(was?.links ?? [])].map((p) => [p.id, p]),
    );
    const now = [...scene.modules, ...scene.links];
    const ids = new Set(now.map((p) => p.id));
    const source = (w: Work, p: Instance | Link) => {
      const d = w.drawings[p.drawingId];
      return d && JSON.stringify([d.source, d.defaults]);
    };
    const added: string[] = [],
      changed: string[] = [],
      moved: string[] = [];
    const listed: Record<string, string[]> = {};
    for (const p of now) {
      const o = old.get(p.id);
      if (!o) added.push(p.id);
      else if (
        !same({ ...o, bounds: null }, { ...p, bounds: null }) ||
        source(before, o) !== source(after, p)
      ) {
        changed.push(p.id);
        const lines = itemChanges(o.data ?? {}, p.data ?? {});
        if (lines.length) listed[p.id] = lines;
      }
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
    const retitled = was.title !== scene.title || was.parentId !== scene.parentId;
    const scriptChanged = (was.interaction ?? "") !== (scene.interaction ?? "");
    const checksChanged = !same(was.checks, scene.checks);
    return added.length ||
      removed.length ||
      changed.length ||
      moved.length ||
      restacked ||
      retitled ||
      scriptChanged ||
      checksChanged
      ? [{ id: scene.id, added, removed, changed, items: listed, moved, restacked, retitled, scriptChanged, checksChanged }]
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
    details: records(before.details, after.details),
    style: !same(before.style, after.style),
  };
}
