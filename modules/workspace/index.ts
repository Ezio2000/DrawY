import {
  DomainError,
  id,
  pageSchema,
  type Work,
  type Page,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
export function createWork(store: UserStore, title: string) {
  const rootId = "root";
  return store.commit(
    {
      id: id(),
      title,
      rootId,
      pages: {
        root: {
          id: rootId,
          title,
          parentId: null,
          html: "",
          diagrams: [],
          assetIds: [],
          checkSelectors: [],
        },
      },
      revision: 0,
      updatedAt: Date.now(),
    },
    0,
  );
}
export function writePages(
  store: UserStore,
  workId: string,
  pages: Page[],
  base: number,
) {
  const work = store.work(workId);
  const next = { ...work, pages: { ...work.pages } };
  for (const input of pages) {
    const p = pageSchema.parse(input);
    for (const asset of p.assetIds) store.asset(asset);
    next.pages[p.id] = p;
  }
  validateWork(next);
  return store.commit(next, base);
}
export function validateWork(work: Work) {
  if (!work.pages[work.rootId] || work.pages[work.rootId].parentId !== null)
    throw new DomainError("作品需要一个根页面");
  for (const p of Object.values(work.pages)) {
    const seen = new Set<string>();
    let at: Page | undefined = p;
    while (at) {
      if (seen.has(at.id)) throw new DomainError("页面层级不能循环");
      seen.add(at.id);
      if (at.id === work.rootId) break;
      if (!at.parentId || !work.pages[at.parentId])
        throw new DomainError("子页面必须属于现有页面");
      at = work.pages[at.parentId];
    }
    if (new Set(p.diagrams.map((d) => d.id)).size !== p.diagrams.length)
      throw new DomainError("图表 ID 重复");
  }
}
export function restore(store: UserStore, workId: string, revision: number) {
  return store.commit(
    store.revision(workId, revision),
    store.work(workId).revision,
  );
}
