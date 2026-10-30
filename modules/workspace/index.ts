import {
  DomainError,
  id,
  workEditSchema,
  type Work,
  type WorkEdit,
  type Bounds,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
export function createWork(store: UserStore, title: string) {
  return store.commit(
    {
      id: id(),
      title,
      rootSceneId: "root",
      drawings: {},
      scenes: {
        root: {
          id: "root",
          title,
          parentId: null,
          modules: [],
          links: [],
          interactionId: null,
          checks: [],
        },
      },
      interactions: {},
      details: {},
      resources: {},
      style: {
        ink: "#24312e",
        accent: "#d97757",
        muted: "#6c7972",
        font: "system-ui, sans-serif",
      },
      revision: 0,
      updatedAt: Date.now(),
    },
    0,
  );
}
const sections = [
  "drawings",
  "scenes",
  "interactions",
  "details",
  "resources",
] as const;
export function writeWork(store: UserStore, workId: string, input: WorkEdit) {
  const edit = workEditSchema.parse(input),
    work = structuredClone(store.work(workId));
  for (const section of sections) {
    for (const item of edit[section] || [])
      Object.assign(work[section], { [item.id]: item });
    for (const key of edit.remove?.[section] || []) delete work[section][key];
  }
  if (edit.title !== undefined) work.title = edit.title;
  if (edit.style) work.style = edit.style;
  validateWork(work);
  for (const r of Object.values(work.resources))
    if (r.assetId) {
      const asset = store.asset(r.assetId);
      if (r.url !== asset.url)
        throw new DomainError("资源地址必须与所属文件一致");
    }
  return store.commit(work, edit.baseRevision);
}
export function validateWork(work: Work) {
  const root = work.scenes[work.rootSceneId];
  if (!root || root.parentId !== null)
    throw new DomainError("作品需要一个根场景");
  for (const scene of Object.values(work.scenes)) {
    const seen = new Set<string>();
    let at = scene;
    while (at.id !== root.id) {
      if (seen.has(at.id)) throw new DomainError("场景层级不能循环");
      seen.add(at.id);
      if (!at.parentId || !work.scenes[at.parentId])
        throw new DomainError("场景缺少父场景");
      at = work.scenes[at.parentId];
    }
    if (scene.interactionId && !work.interactions[scene.interactionId])
      throw new DomainError("场景交互不存在");
    const modules = new Map(scene.modules.map((m) => [m.id, m]));
    if (
      modules.size !== scene.modules.length ||
      new Set(scene.links.map((l) => l.id)).size !== scene.links.length
    )
      throw new DomainError("场景内 ID 重复");
    for (const m of scene.modules) {
      if (!work.drawings[m.drawingId]) throw new DomainError("模块画法不存在");
      if (
        m.target &&
        !(m.target.kind === "scene"
          ? work.scenes[m.target.id]
          : work.details[m.target.id])
      )
        throw new DomainError("模块交互目标不存在");
    }
    for (const l of scene.links) {
      if (!work.drawings[l.drawingId]) throw new DomainError("连接画法不存在");
      for (const end of [l.from, l.to])
        if (!modules.get(end.moduleId)?.anchors[end.anchor])
          throw new DomainError("连接锚点不存在");
    }
    for (const c of scene.checks)
      if (!modules.has(c.moduleId)) throw new DomainError("检查目标不存在");
  }
}
export function moveModules(
  store: UserStore,
  workId: string,
  sceneId: string,
  baseRevision: number,
  moves: { id: string; bounds: Bounds }[],
) {
  const work = store.work(workId),
    scene = work.scenes[sceneId];
  if (!scene) throw new DomainError("场景不存在", 404);
  for (const move of moves)
    if (!scene.modules.some((m) => m.id === move.id))
      throw new DomainError("模块不存在", 404);
  return writeWork(store, workId, {
    baseRevision,
    scenes: [
      {
        ...scene,
        modules: scene.modules.map((m) => ({
          ...m,
          bounds: moves.find((v) => v.id === m.id)?.bounds || m.bounds,
        })),
      },
    ],
  });
}
export function restore(store: UserStore, workId: string, revision: number) {
  return store.commit(
    store.revision(workId, revision),
    store.work(workId).revision,
  );
}
