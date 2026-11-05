import {
  DomainError,
  EditRejected,
  drawingOf,
  id,
  briefSchema,
  blankStyle,
  type Brief,
  type Problem,
  type Work,
  type WorkEdit,
  type Cause,
  historyOf,
  stepBefore,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
import { take, used, styleOf } from "../materials/index.ts";
import { layOn, readEdit } from "../editing/apply.ts";
import { syntaxError } from "../editing/shared.ts";
export { forAuthor, shortModule, shortLink } from "./author.ts";
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
          checks: [],
        },
      },
      details: {},
      brief: null,
      materials: {},
      style: { ...blankStyle },
      revision: 0,
      updatedAt: Date.now(),
    },
    0,
    { kind: "create" },
  );
}
/** Commits an edit as one revision or not at all: laid on the work as it stands at `base`,
 * with the materials the work now names taken from the library, and the result a valid work.
 * Whatever is wrong with it is refused together as `EditRejected`. `scene` is where its new
 * parts go when they name none. */
export async function writeWork(
  store: UserStore,
  workId: string,
  input: unknown,
  { base, cause, scene }: { base?: number; cause: Cause; scene?: string },
) {
  const edit = readEdit(input),
    current = store.work(workId);
  if (base !== undefined && current.revision !== base)
    throw new DomainError("作品版本已更新，请重新读取", 409);
  const fetched = await takeSources(current, edit.drawings ?? [], store);
  const { work, absent, problems: laying } = layOn(fetched, edit, scene ?? current.rootSceneId);
  // A title the user gave stays: the author retitled works the user had renamed.
  const keptTitle = edit.title !== undefined && !!current.named && cause.kind === "run";
  if (keptTitle) work.title = current.title;
  if (!work.brief && Object.values(work.scenes).some((s) => s.modules.length))
    throw new DomainError("请先用 set_brief 确定创作简报，再绘制");
  const { added, missing } = await take(work, edit.materials || [], store.viewer);
  // Whatever else refers to a record that could not be laid will find it once that is fixed.
  const pending = new Set(laying.map((p) => p.at.split(".")[1]));
  const problems = [
    ...laying,
    ...missing.map((m): Problem => ({
      at: "materials",
      problem: `素材 ${m} 不存在${usedIn(work, m)}：素材 ID 要来自 find_materials、set_brief 或 generate_images 的结果`,
    })),
    ...problemsIn(work, pending),
    ...pictureProblems(work, edit),
    ...codeProblems(current, work),
  ];
  if (problems.length) throw new EditRejected(problems);
  const saved = store.commit(work, current.revision, cause);
  used(added, workId, store.userId);
  return { work: saved, added, keptTitle, absent };
}
/** The work with library drawings an edit copies from in hand, so it can copy them. */
async function takeSources(work: Work, drawings: { from?: string }[], store: UserStore) {
  const wanted = drawings.flatMap((d) => (d.from && !drawingOf(work, d.from) ? [d.from] : []));
  if (!wanted.length) return work;
  const held = { ...work, materials: { ...work.materials } };
  await take(held, wanted, store.viewer, true);
  return held;
}
/** Where a material that does not exist is called from. */
function usedIn(work: Work, id: string) {
  const quoted = new RegExp(`["'\`]${id}["'\`]`);
  const drawing = Object.values(work.drawings).find((d) => quoted.test(d.source));
  return drawing ? `（画法 ${drawing.id} 的代码里用到）` : "";
}
const quoteable = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
/** Settles what the work is meant to be. Every basis must quote what the user said, so a
 * brief cannot rest on guesses; choosing a style gives the work that style's tokens. The
 * first brief also names the work, which until then carries the words of the request. */
export async function setBrief(
  store: UserStore,
  workId: string,
  input: Brief,
  said: string[],
  cause: Cause,
) {
  const brief = briefSchema.parse(input);
  const corpus = quoteable(said.join("\n"));
  for (const [part, quote] of Object.entries(brief.basis)) {
    if (quote === undefined) continue;
    const pieces = quote
      // Quotes are joined by ellipses, slashes, semicolons, or set end to end in their own
      // quotation marks («“我种草莓”“我们这是山东”»); each piece must be the user's words.
      .split(/…|\.\.\.|\/|；|;|[“”「」『』"、]/)
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
  if (!work.brief && !work.named) {
    work.title = brief.subject;
    work.scenes[work.rootSceneId].title = brief.subject;
  }
  work.brief = brief;
  return { work: store.commit(work, work.revision, cause), style };
}
/** What keeps a work from being whole: every reference that leads nowhere, by the record
 * that holds it, so a part is refused now instead of drawing an error later. `pending` are
 * ids a reference may lead to though the work does not hold them yet. */
export function problemsIn(work: Work, pending = new Set<string>()): Problem[] {
  const problems: Problem[] = [];
  const add = (at: string, problem: string) => problems.push({ at, problem });
  const root = work.scenes[work.rootSceneId];
  if (!root || root.parentId !== null) add("scenes", "作品需要一个根场景");
  const drawingMissing = (at: string, name: string, id: string) =>
    add(
      `${at}.drawingId`,
      `${name} 的画法 ${id} 不存在：在 drawings 里定义它，或用库里画法素材的 id`,
    );
  for (const scene of Object.values(work.scenes)) {
    const at = `scenes.${scene.id}`;
    if (root) {
      const seen = new Set<string>();
      for (let s = scene; s.id !== root.id; s = work.scenes[s.parentId!]) {
        if (seen.has(s.id)) {
          add(`${at}.parentId`, "场景层级不能循环");
          break;
        }
        seen.add(s.id);
        if (!s.parentId || !work.scenes[s.parentId]) {
          add(`${at}.parentId`, `场景 ${s.id} 缺少父场景 ${s.parentId ?? ""}`);
          break;
        }
      }
    }
    const modules = new Set(scene.modules.map((m) => m.id));
    if (modules.size !== scene.modules.length) add(`${at}.modules`, "场景内模块 ID 重复");
    if (new Set(scene.links.map((l) => l.id)).size !== scene.links.length)
      add(`${at}.links`, "场景内连线 ID 重复");
    for (const m of scene.modules) {
      const where = `modules.${m.id}`;
      if (!drawingOf(work, m.drawingId) && !pending.has(m.drawingId))
        drawingMissing(where, `模块 ${m.id}`, m.drawingId);
      if (m.target && !pending.has(m.target.id) && !(m.target.kind === "scene" ? work.scenes[m.target.id] : work.details[m.target.id]))
        add(`${where}.target`, `模块 ${m.id} 点开的${m.target.kind === "scene" ? "场景" : "详情"} ${m.target.id} 不存在`);
    }
    const known = () => scene.modules.map((m) => m.id).join("、") || "（空）";
    for (const l of scene.links) {
      const where = `links.${l.id}`;
      if (!drawingOf(work, l.drawingId) && !pending.has(l.drawingId))
        drawingMissing(where, `连线 ${l.id}`, l.drawingId);
      for (const side of ["from", "to"] as const)
        if (!modules.has(l[side].moduleId) && !pending.has(l[side].moduleId))
          add(`${where}.${side}`, `连线 ${l.id} 的一端 ${l[side].moduleId} 不在场景 ${scene.id} 里；这个场景有 ${known()}`);
    }
    for (const [i, c] of scene.checks.entries())
      if (!modules.has(c.moduleId) && !pending.has(c.moduleId))
        add(`${at}.checks.${i}`, `检查的模块 ${c.moduleId} 不在场景 ${scene.id} 里`);
  }
  return problems;
}
/** Pictures the parts this write changed name that the work does not hold, by the parameters
 * their drawings declare as pictures, found now rather than when they are drawn. A picture
 * gone from a part it did not touch is no reason to refuse the write. */
function pictureProblems(work: Work, edit: WorkEdit): Problem[] {
  const changed = new Set([...(edit.modules ?? []), ...(edit.links ?? [])].map((p) => p.id));
  return Object.values(work.scenes).flatMap((scene) =>
    [...scene.modules, ...scene.links]
      .filter((part) => changed.has(part.id))
      .flatMap((part) =>
        Object.entries(drawingOf(work, part.drawingId)?.params ?? {}).flatMap(([key, param]) => {
          const value = part.data[key];
          return param.type === "picture" && typeof value === "string" && value && !work.materials[value]
            ? [
                {
                  at: `${"from" in part ? "links" : "modules"}.${part.id}.data.${key}`,
                  problem: `图片素材 ${value} 不存在：要用 find_materials、set_brief 或 generate_images 返回的 ID`,
                },
              ]
            : [];
        }),
      ),
  );
}
/** Code this write changed that does not parse, found now rather than when it is drawn. */
function codeProblems(before: Work, after: Work): Problem[] {
  const broken = (at: string, source: string | undefined, was: string | undefined): Problem[] => {
    if (!source || source === was) return [];
    const error = syntaxError(source);
    return error ? [{ at, problem: `代码有语法错误：${error}` }] : [];
  };
  return [
    ...Object.values(after.drawings).flatMap((d) =>
      broken(`drawings.${d.id}.source`, d.source, before.drawings[d.id]?.source),
    ),
    ...Object.values(after.scenes).flatMap((s) =>
      broken(`scenes.${s.id}.interaction`, s.interaction, before.scenes[s.id]?.interaction),
    ),
  ];
}
/** Whether a work holds together, as a commit requires. */
export function validateWork(work: Work) {
  const problems = problemsIn(work);
  if (problems.length) throw new EditRejected(problems);
}
/** Brings back an earlier revision of the drawing; the work keeps its current name. */
export function restore(store: UserStore, workId: string, revision: number) {
  const current = store.work(workId);
  return store.commit(
    {
      ...store.revision(workId, revision),
      title: current.title,
      ...(current.named ? { named: true } : {}),
    },
    current.revision,
    { kind: "restore", revision },
  );
}
/** Saves the hand edits made since the latest version as a version of their own. */
export function saveEdits(store: UserStore, workId: string) {
  const current = store.work(workId);
  if (!historyOf(store.revisions(workId)).unsaved.length)
    throw new DomainError("没有要保存的修改");
  return store.commit(current, current.revision, { kind: "save" });
}
/** Takes back the latest step: the drawing returns to how it was before it. */
export function undo(store: UserStore, workId: string) {
  const current = store.work(workId);
  const target = stepBefore(store.revisions(workId), current.revision);
  if (target === undefined) throw new DomainError("没有可以撤销的修改");
  return restore(store, workId, target);
}
