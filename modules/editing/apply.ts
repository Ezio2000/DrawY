import {
  DomainError,
  instanceSchema,
  linkSchema,
  type SceneEdit,
  type Work,
  type WorkEdit,
} from "../contracts/index.ts";

/* An edit laid on a work the way the workspace commits it, for showing a hand edit before
 * the workspace has answered, and for the workspace itself, so both lay it the same way. */

const sections = ["drawings", "scenes", "interactions", "details"] as const;
type DataChange = NonNullable<NonNullable<SceneEdit["modules"]>[number]["dataChanges"]>[number];
/** A part's data with single values changed: the value at each path set, or deleted when
 * the change has none. A list closes up over a deleted item. */
function withChanges(
  data: Record<string, unknown>,
  changes: DataChange[],
  part: string,
) {
  const next = structuredClone(data);
  for (const { path, value } of changes) {
    const missing = () =>
      new DomainError(`${part} 的数据里没有 ${path.join(".")}`);
    let at: any = next;
    for (const step of path.slice(0, -1)) {
      at = at?.[step];
      if (at === null || typeof at !== "object") throw missing();
    }
    const last = path.at(-1)!;
    if (Array.isArray(at)) {
      if (typeof last !== "number" || last > at.length) throw missing();
      if (value === undefined) {
        if (last === at.length) throw missing();
        at.splice(last, 1);
      } else at[last] = value;
    } else if (typeof last === "number") throw missing();
    else if (value === undefined) delete at[last];
    else at[last] = value;
  }
  return next;
}
/** Parts with some changed in place and new ones added, each ending up a whole record. */
function upsert<T extends { id: string; data: Record<string, unknown> }>(
  parts: T[],
  patches: ({ id: string; data?: Record<string, unknown>; dataChanges?: DataChange[] } & Partial<T>)[] | undefined,
  whole: { safeParse(value: unknown): { success: boolean; data?: unknown } },
  name: string,
  fields: string,
) {
  for (const { dataChanges, ...patch } of patches ?? []) {
    const index = parts.findIndex((p) => p.id === patch.id);
    const merged: any = index < 0 ? patch : { ...parts[index], ...patch };
    if (dataChanges?.length)
      merged.data = withChanges(merged.data ?? {}, dataChanges, `${name} ${patch.id}`);
    const parsed = whole.safeParse(merged);
    if (!parsed.success)
      throw new DomainError(
        `${name} ${patch.id} ${index < 0 ? "是新增的，" : "的修改不完整，"}要给全 ${fields}`,
      );
    if (index < 0) parts.push(parsed.data as T);
    else parts[index] = parsed.data as T;
  }
}
/** A scene with part of it changed. */
function editedScene(work: Work, edit: SceneEdit) {
  const scene = work.scenes[edit.id];
  if (!scene) throw new DomainError(`场景 ${edit.id} 不存在：新场景写在 scenes 里`);
  if (edit.title !== undefined) scene.title = edit.title;
  if (edit.parentId !== undefined) scene.parentId = edit.parentId;
  if (edit.interactionId !== undefined) scene.interactionId = edit.interactionId;
  if (edit.checks) scene.checks = structuredClone(edit.checks);
  const gone = new Set(edit.removeModules ?? []);
  const cut = new Set(edit.removeLinks ?? []);
  scene.modules = scene.modules.filter((m) => !gone.has(m.id));
  scene.checks = scene.checks.filter((c) => !gone.has(c.moduleId));
  scene.links = scene.links.filter(
    (l) => !cut.has(l.id) && !gone.has(l.from.moduleId) && !gone.has(l.to.moduleId),
  );
  upsert(
    scene.modules,
    structuredClone(edit.modules) as never,
    instanceSchema,
    "模块",
    "label、bounds、drawingId、group、target、anchors、data",
  );
  upsert(
    scene.links,
    structuredClone(edit.links) as never,
    linkSchema,
    "连线",
    "drawingId、from、to、data",
  );
  if (edit.order?.length) {
    const places = new Map(scene.modules.map((m, i) => [m.id, i]));
    for (const id of edit.order)
      if (!places.has(id)) throw new DomainError(`order 里的模块 ${id} 不在场景 ${edit.id} 里`);
    const slots = edit.order.map((id) => places.get(id)!).sort((a, b) => a - b);
    const moved = edit.order.map((id) => scene.modules[places.get(id)!]);
    slots.forEach((slot, i) => (scene.modules[slot] = moved[i]));
  }
}
/** The work an edit leaves: its records upserted or removed, scenes changed in part, its
 * style replaced, and the materials it takes out gone. The revision and title stay; taking
 * materials in is the workspace's, which fetches them from the library. */
export function applied(work: Work, edit: WorkEdit): Work {
  const next = structuredClone(work);
  for (const section of sections)
    for (const item of edit[section] || [])
      Object.assign(next[section], { [item.id]: structuredClone(item) });
  for (const change of edit.sceneEdits || []) editedScene(next, change);
  for (const section of sections)
    for (const key of edit.remove?.[section] || []) delete next[section][key];
  for (const key of edit.remove?.materials || []) delete next.materials[key];
  if (edit.style) next.style = { ...edit.style };
  return next;
}
/** Whether a work already holds every material an edit takes in, so the edit can be shown
 * before the workspace fetches anything. */
export const showable = (work: Work, edit: WorkEdit) =>
  (edit.materials ?? []).every((id) => !!work.materials[id]);
