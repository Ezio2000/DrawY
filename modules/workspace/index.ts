import {
  DomainError,
  id,
  workEditSchema,
  briefSchema,
  type Brief,
  type Work,
  type WorkEdit,
  type Bounds,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
import { take, used, styleOf } from "../materials/index.ts";
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
      brief: null,
      materials: {},
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
const sections = ["drawings", "scenes", "interactions", "details"] as const;
/** Applies an edit atomically: records are upserted or removed, the materials the work
 * now names are taken from the library, and the result must be a valid work. */
export async function writeWork(
  store: UserStore,
  workId: string,
  input: WorkEdit,
) {
  const edit = workEditSchema.parse(input),
    work = structuredClone(store.work(workId));
  if (work.revision !== edit.baseRevision)
    throw new DomainError("作品版本已更新，请重新读取", 409);
  for (const section of sections) {
    for (const item of edit[section] || [])
      Object.assign(work[section], { [item.id]: item });
    for (const key of edit.remove?.[section] || []) delete work[section][key];
  }
  for (const key of edit.remove?.materials || []) delete work.materials[key];
  if (edit.title !== undefined) work.title = edit.title;
  if (edit.style) work.style = edit.style;
  if (!work.brief && Object.values(work.scenes).some((s) => s.modules.length))
    throw new DomainError("请先用 set_brief 确定创作简报，再绘制");
  const added = await take(work, edit.materials || [], store.userId);
  validateWork(work);
  const saved = store.commit(work, edit.baseRevision);
  used(added, workId, store.userId);
  return { work: saved, added };
}
const quoteable = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
/** Settles what the work is meant to be. Every basis must quote what the user said, so a
 * brief cannot rest on guesses; choosing a style gives the work that style's tokens. */
export async function setBrief(
  store: UserStore,
  workId: string,
  input: Brief,
  said: string[],
) {
  const brief = briefSchema.parse(input);
  const corpus = quoteable(said.join("\n"));
  for (const [part, quote] of Object.entries(brief.basis)) {
    const pieces = quote
      .split(/…|\.\.\.|\/|；|;/)
      .map(quoteable)
      .filter(Boolean);
    if (!pieces.length || pieces.some((p) => !corpus.includes(p)))
      throw new DomainError(
        `brief.basis.${part}「${quote}」不是用户说过的话。依据必须逐字引用用户的请求、回答或长期偏好；用户没有说清时，先用 ask_user 询问`,
      );
  }
  const style = await styleOf(brief.style);
  const work = structuredClone(store.work(workId));
  if (work.brief?.style !== brief.style) work.style = { ...style.tokens };
  work.brief = brief;
  return { work: store.commit(work, work.revision), style };
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
export async function moveModules(
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
  return (
    await writeWork(store, workId, {
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
    })
  ).work;
}
export function restore(store: UserStore, workId: string, revision: number) {
  return store.commit(
    store.revision(workId, revision),
    store.work(workId).revision,
  );
}
