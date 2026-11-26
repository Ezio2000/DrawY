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
  cascadeData,
  normalizeData,
  validateData,
  walkFields,
  endLink,
  endModule,
  type DataProblem,
  type Fields,
  type Link,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
import { take, used, resolveStyle } from "../materials/index.ts";
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
  // The author settles a brief before it draws; a person may draw on a blank canvas by hand.
  if (
    cause.kind === "run" &&
    !work.brief &&
    Object.values(work.scenes).some((s) => s.modules.length)
  )
    throw new DomainError("请先用 set_brief 确定创作简报，再绘制");
  const { added, missing } = await take(work, edit.materials || [], store.viewer);
  // Whatever else refers to a record that could not be laid will find it once that is fixed.
  const pending = new Set(laying.map((p) => p.at.split(".")[1]));
  const problems = [
    ...laying,
    ...settleData(current, work, edit),
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
/** The data of every part a write changed, as its drawing's schema reads it: items of lists
 * given ids, names written for references made the ids they name, items that referred to
 * items now gone taken out where the schema cascades, and what the write gave checked. Only
 * the keys the write gave are checked, so data a part held before is never a reason to
 * refuse a later change to it. A library drawing reads nothing it does not declare. */
function settleData(before: Work, work: Work, edit: WorkEdit): Problem[] {
  const given = new Map<string, { keys: string[]; whole: boolean }>();
  for (const p of [...(edit.modules ?? []), ...(edit.links ?? [])])
    if (p.data || p.drawingId)
      given.set(p.id, { keys: Object.keys(p.data ?? {}), whole: !!p.drawingId });
  const problems: DataProblem[] = [];
  const was = new Map(
    Object.values(before.scenes).flatMap((s) => [...s.modules, ...s.links].map((p) => [p.id, p] as const)),
  );
  for (const scene of Object.values(work.scenes))
    for (const part of [...scene.modules, ...scene.links]) {
      const write = given.get(part.id);
      const drawing = write && drawingOf(work, part.drawingId);
      const fields = drawing?.params ?? {};
      if (!write || !drawing || !Object.keys(fields).length) continue;
      const at = `${"from" in part ? "links" : "modules"}.${part.id}.data`;
      const earlier = was.get(part.id);
      const keys = withReferrers(fields, write.whole || !earlier ? Object.keys(part.data) : write.keys);
      if (!drawing.own)
        for (const key of keys)
          if (!(key in fields))
            problems.push({ at: `${at}.${key}`, problem: `画法 ${part.drawingId} 不读 ${key}：它读 ${Object.keys(fields).join("、")}` });
      // What referred to items taken out goes first, so it is not read as a name.
      const settled = cascadeData(fields, earlier?.drawingId === part.drawingId ? earlier.data : {}, part.data);
      const found: DataProblem[] = [];
      part.data = normalizeData(fields, settled, at, found);
      validateData(fields, part.data, at, found, keys);
      // A name that names nothing is said once, not again as a reference that leads nowhere.
      problems.push(...found.filter((p, i) => found.findIndex((q) => q.at === p.at) === i));
    }
  return problems;
}
/** The keys given and those whose references point into them: a list changed may leave a
 * reference to an item it no longer holds. */
function withReferrers(fields: Fields, keys: string[]) {
  const out = new Set(keys);
  walkFields(fields, (f, at) => {
    const to = f.type === "ref" || f.type === "geo" ? f.to : undefined;
    if (to && out.has(to)) out.add(at[0]);
  });
  return [...out];
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
  // A brief may name its style by id or by a few words; the work keeps the id.
  const { style, chosen, others } = await resolveStyle(brief.style, store.viewer, brief.register);
  brief.style = style.id;
  const work = structuredClone(store.work(workId));
  if (work.brief?.style !== brief.style) work.style = { ...style.tokens };
  if (!work.brief && !work.named) {
    work.title = brief.subject;
    work.scenes[work.rootSceneId].title = brief.subject;
  }
  work.brief = brief;
  return { work: store.commit(work, work.revision, cause), style, chosen, others };
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
    const links = new Map(scene.links.map((l) => [l.id, l]));
    for (const l of scene.links) {
      const where = `links.${l.id}`;
      if (!drawingOf(work, l.drawingId) && !pending.has(l.drawingId))
        drawingMissing(where, `连线 ${l.id}`, l.drawingId);
      for (const side of ["from", "to"] as const) {
        const end = l[side];
        const module = endModule(end),
          line = endLink(end);
        if (module && !modules.has(module) && !pending.has(module))
          add(`${where}.${side}`, `连线 ${l.id} 的一端 ${module} 不在场景 ${scene.id} 里；这个场景有 ${known()}`);
        if (line && !links.has(line) && !pending.has(line))
          add(`${where}.${side}`, `连线 ${l.id} 的一端沿着的连线 ${line} 不在场景 ${scene.id} 里`);
      }
      // A link riding on links that ride back on it would have nowhere to be.
      const seen = new Set<string>();
      for (let at: Link | undefined = l; at; ) {
        if (seen.has(at.id)) {
          add(where, `连线 ${l.id} 沿着的连线又沿着它，绕成了一圈`);
          break;
        }
        seen.add(at.id);
        const next: string | undefined = endLink(at.from) ?? endLink(at.to);
        at = next ? links.get(next) : undefined;
      }
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
/** Saves the hand edits made since the latest version as a version of their own. The
 * revisions of the edits since that version are forgotten, those undone past too: the version
 * is the state they led to, and nothing goes back to a step between them once saved (undoing goes back a version, going
 * back to an edit not saved yet is only offered while it is not, and a restore can only
 * name a revision before it). Each would otherwise keep a whole copy of the work. */
export function saveEdits(store: UserStore, workId: string) {
  const current = store.work(workId);
  const history = store.revisions(workId);
  const { versions, unsaved } = historyOf(history);
  if (!unsaved.length) throw new DomainError("没有要保存的修改");
  const saved = store.commit(current, current.revision, { kind: "save" });
  // Every revision since the version they were laid on, edits undone past among them.
  const since = Math.max(0, ...(versions.at(-1)?.revisions ?? []));
  store.forget(workId, history.flatMap((r) => (r.revision > since ? [r.revision] : [])));
  return saved;
}
/** Takes back the latest step: the drawing returns to how it was before it. */
export function undo(store: UserStore, workId: string) {
  const current = store.work(workId);
  const target = stepBefore(store.revisions(workId), current.revision);
  if (target === undefined) throw new DomainError("没有可以撤销的修改");
  return restore(store, workId, target);
}
