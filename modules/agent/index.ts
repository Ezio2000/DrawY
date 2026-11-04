import {
  id,
  DomainError,
  EditRejected,
  boundsOf,
  boxSchema,
  labelOf,
  type Problem,
  type Run,
  type Step,
  type ToolActivity,
  type GuideTopic,
  guideTopics,
  type Sketch,
  type Work,
  type Picture,
  type Question,
  type Cause,
  type Role,
  type Effort,
  type Settings,
  type RunUsage,
  imageTokensOf,
  lowestEffort,
  effortFor,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
import { forAuthor, shortLink, shortModule, writeWork, setBrief } from "../workspace/index.ts";
import { changesBetween, composed } from "../editing/index.ts";
import { MIN_TEXT } from "../contracts/geometry.ts";
import {
  attached,
  candidate,
  find,
  kit,
  library,
  look,
  styleList,
  useOf,
  freshen,
} from "../materials/index.ts";
import { develop, type Development } from "../images/index.ts";
import {
  observe,
  requireObserved,
  Unavailable,
  type Reported,
} from "../observation/index.ts";
import { AUTHOR, catalogue } from "./prompts.ts";
import { guidesRead, readGuides } from "./guides.ts";
import {
  adapterFor,
  generate,
  requestOf,
  textOf,
  citationsOf,
  CutOff,
  type Item,
} from "../models/index.ts";
import {
  tools,
  askSchema,
  findSchema,
  generateSchema,
  guideSchema,
  settleSchema,
  searchTools,
  searchSchema,
  openSchema,
} from "./tools.ts";
import { searchWeb, readPage } from "../search/index.ts";
import { partialJson, completedRecords } from "./partial.ts";
import { tracer } from "../trace/index.ts";
import type { MessageLocale } from "../contracts/messages.ts";
/** The tools a run offers: the drawing tools, and the one way it searches, if any. A run
 * never has both the model's own search and the search service. */
const toolsFor = (settings: Pick<Settings, "search">): Item[] =>
  settings.search.mode === "builtin"
    ? [...tools, { type: "web_search", search_context_size: "low" }]
    : settings.search.mode === "service"
      ? [...tools, ...searchTools]
      : tools;
const searching = new Set(searchTools.map((t) => t.name));
/** Adds web searches or a page read to what a run has spent. */
function counted(run: Run, action: string | undefined, searches = 1) {
  const u = usageOf(run);
  if (action === "open_page" || action === "find_in_page") u.pages = (u.pages ?? 0) + 1;
  else u.searches = (u.searches ?? 0) + searches;
}
/** What a search step spends of the budget. The search service is asked once per query,
 * and each is paid for, so a call with several queries counts each; a page read, and a
 * provider's own search, which is paid for by the call, count one. */
function cost(run: Run, step: Extract<Step, { kind: "tool"; name: "web_search" }>) {
  return run.services?.search === "service" && step.action !== "open_page"
    ? Math.max(1, step.queries.length)
    : 1;
}
const usageOf = (run: Run): RunUsage =>
  (run.usage ??= { input: 0, cached: 0, output: 0, reasoning: 0 });
/** Whether an output item is a call to a tool the provider runs itself, such as its web
 * search: those arrive finished in the model's output and are never answered here. */
const hosted = (item: Item) =>
  typeof item?.type === "string" &&
  item.type.endsWith("_call") &&
  item.type !== "function_call";
/** The words a hosted call carries (its query, code, URL…), however it nests them. */
function wordsOf(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (depth > 2 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((v) => wordsOf(v, depth + 1));
  return Object.entries(value)
    .filter(([k]) => !["type", "id", "status", "call_id"].includes(k))
    .flatMap(([, v]) => wordsOf(v, depth + 1));
}
/** A hosted call as a step: web search has a view of its own, any other tool shows by its
 * name and what it was asked. */
function hostedActivity(item: Item): ToolActivity {
  const action = item.action || {};
  if (item.type === "web_search_call")
    return {
      name: "web_search",
      queries: action.queries || (action.query ? [action.query] : []),
      urls: action.url ? [action.url] : [],
      ...(["search", "open_page", "find_in_page"].includes(action.type)
        ? { action: action.type }
        : {}),
      ...(typeof action.pattern === "string" ? { pattern: action.pattern } : {}),
    };
  const detail = wordsOf(item.action ?? item.arguments ?? item.code ?? item.queries)
    .join(" · ")
    .slice(0, 160);
  return {
    name: "hosted",
    tool: item.type.replace(/_call$/, ""),
    ...(detail ? { detail } : {}),
  };
}
/** Web searches a request may make in all, and once its first draft is saved: the
 * research belongs before the drawing, and a look needs at most one targeted follow-up.
 * The search service counts each query; a provider's own search counts each call. */
export const SEARCH_LIMIT = 8,
  SEARCH_AFTER_DRAFT = 2;
/** The web searches this request may still make. */
function searchesLeft(run: Run) {
  const drafted = run.steps.findIndex(
    (s) => s.kind === "tool" && s.name === "write_work" && s.status === "done",
  );
  const searched = (from: number) =>
    run.steps.reduce(
      (n, s, i) => (i > from && s.kind === "tool" && s.name === "web_search" ? n + cost(run, s) : n),
      0,
    );
  return Math.max(
    0,
    Math.min(
      SEARCH_LIMIT - searched(-1),
      drafted < 0 ? Infinity : SEARCH_AFTER_DRAFT - searched(drafted),
    ),
  );
}
/** Keeps a turn within the request's search budget, where the model's request format has
 * a way to (its adapter's `narrow`). The tools stay listed, so the cached prefix holds;
 * where there is no such way, the search service's calls are refused past the budget. */
export function steering(
  run: Run,
  tools: Item[],
  role: Pick<Role, "protocol" | "toolLimits"> = { protocol: "responses", toolLimits: true },
): Item {
  const isSearch = (t: Item) =>
    t.type === "web_search" || (t.type === "function" && searching.has(t.name));
  const narrow = adapterFor(role.protocol).narrow;
  if (!narrow || !tools.some(isSearch)) return {};
  const left = searchesLeft(run);
  return left === Infinity ? {} : narrow(tools, left, isSearch, role);
}
/** What this request has searched so far, told to the author beside its brief and each
 * look, so it judges against what it already found rather than searching again. */
function research(run: Run) {
  const searches = run.steps.filter(
    (s): s is Extract<Step, { kind: "tool"; name: "web_search" }> =>
      s.kind === "tool" && s.name === "web_search",
  );
  if (!searches.length) return undefined;
  const pages = [...new Set(searches.flatMap((s) => s.urls))];
  const asked = [...new Set(searches.flatMap((s) => s.queries))];
  const left = searchesLeft(run);
  return {
    calls: searches.length,
    ...(asked.length ? { queriesAsked: asked } : {}),
    ...(pages.length ? { pagesOpened: pages } : {}),
    ...(left !== Infinity
      ? run.services?.search === "service"
        ? { searchQueriesLeft: left }
        : { searchCallsLeft: left }
      : {}),
    note: left
      ? "What these found is above. Judge the figure against it; asking these again in other words returns the same results. Search again only for a fact the figure states that none of it covers, and leave out what stays unconfirmed."
      : "Web search is closed for the rest of this request. Work from what is above, and leave out what stays unconfirmed.",
  };
}
/** Adds a model attempt that failed to what the run has spent. A stream that broke off
 * reports its input but not its output, which is then told from what had arrived. */
function spendFailed(
  run: Run,
  attempt: { usage?: Item; ms: number; chars?: number },
) {
  const f = failedOf(run);
  const reported = attempt.usage?.output_tokens ?? 0;
  const estimated = reported ? 0 : Math.ceil((attempt.chars ?? 0) / 3);
  f.attempts++;
  f.ms += attempt.ms;
  f.input += attempt.usage?.input_tokens ?? 0;
  f.cached += attempt.usage?.input_tokens_details?.cached_tokens ?? 0;
  f.cacheWrite += attempt.usage?.input_tokens_details?.cache_write_tokens ?? 0;
  f.output += reported + estimated;
  f.estimated += estimated;
  return { usage: attempt.usage ?? {}, output: reported + estimated, estimated };
}
const failedOf = (run: Run) =>
  (usageOf(run).failed ??= {
    attempts: 0,
    ms: 0,
    input: 0,
    cached: 0,
    cacheWrite: 0,
    output: 0,
    estimated: 0,
    invalidCalls: 0,
    images: 0,
  });
/** A write's input that could not be read, kept as far as whole records go, so a correction
 * need only carry the rest. */
class BrokenWrite extends Error {
  constructor(
    message: string,
    public kept: Record<string, unknown>,
  ) {
    super(message);
  }
}
/** A tool call's arguments. Input the model wrote broken is its to correct, as it can see
 * what it wrote: the call fails like any other, without another pass over the whole turn. */
function parsedArguments(run: Run, call: Item) {
  try {
    return JSON.parse(call.arguments);
  } catch (e) {
    failedOf(run).invalidCalls++;
    const why = e instanceof Error ? e.message : e;
    const kept = call.name === "write_work" ? completedRecords(call.arguments) : undefined;
    if (kept && Object.keys(kept).length)
      throw new BrokenWrite(`工具参数不是有效的 JSON（${why}），没有保存`, kept);
    throw Error(`工具参数不是有效的 JSON（${why}），没有保存。请改正后把完整参数重发`);
  }
}
const idsIn = (list: unknown) =>
  Array.isArray(list) ? list.flatMap((r) => (typeof r?.id === "string" ? [r.id] : [])) : [];
/** What is held of a write that was not saved, and how to finish it. */
function heldNote(held: Record<string, unknown>) {
  const parts = (["scenes", "modules", "links", "drawings", "details"] as const)
    .map((k) => [k, idsIn(held[k])] as const)
    .filter(([, ids]) => ids.length)
    .map(([k, ids]) => `${k}: ${ids.join(", ")}`);
  return `Nothing was saved, and this write is held as it stands. To finish it, call write_work with amend: true and only what corrects it: a record with a held id changes only the fields you give, and remove drops a held record. Held: ${parts.join("; ") || "(no records)"}.`;
}
/** Adds to what a run has spent. */
function spend(run: Run, usage: Item) {
  const u = (run.usage ??= { input: 0, cached: 0, output: 0, reasoning: 0 });
  u.input += usage.input_tokens ?? 0;
  u.cached += usage.input_tokens_details?.cached_tokens ?? 0;
  const written = usage.input_tokens_details?.cache_write_tokens ?? 0;
  if (written) u.cacheWrite = (u.cacheWrite ?? 0) + written;
  u.output += usage.output_tokens ?? 0;
  u.reasoning += usage.output_tokens_details?.reasoning_tokens ?? 0;
}
type ToolStep = Extract<Step, { kind: "tool" }>;
const pictures = (shots: { name: string; url: string }[]) =>
  shots.map(({ name, url }) => ({ name, url }));
/** Tools not shown as steps of their own. */
const silent = new Set(["ask_user"]);
/** A box the author wrote, if enough of it has arrived to show. */
const boxed = (box: unknown) => {
  const parsed = boxSchema.safeParse(box);
  return parsed.success ? boundsOf(parsed.data) : undefined;
};
const records = (list: unknown): any[] =>
  Array.isArray(list) ? list.filter((r) => r?.id) : [];
/** What a tool call is doing, as far as its arguments have arrived. Parts a write does not
 * place in a scene belong to the current one. */
function activity(name: string, args: any, sceneId: string): ToolActivity {
  switch (name) {
    case "read_work":
      return { name };
    case "draw_guide":
      return {
        name,
        topics: (Array.isArray(args.topics) ? args.topics : []).filter((t: unknown) =>
          guideTopics.includes(t as GuideTopic),
        ),
        drawings: (Array.isArray(args.drawings) ? args.drawings : []).filter(
          (d: unknown): d is string => typeof d === "string" && !!d,
        ),
      };
    case "web_search":
      return {
        name,
        queries: (Array.isArray(args.queries) ? args.queries : []).filter(
          (q: unknown): q is string => typeof q === "string" && !!q,
        ),
        urls: [],
        action: "search",
      };
    case "open_page":
      return {
        name: "web_search",
        queries: [],
        urls: typeof args.url === "string" && args.url ? [args.url] : [],
        action: "open_page",
      };
    case "set_brief":
      return {
        name,
        subject: args.subject ?? "",
        ...(Array.isArray(args.ideas) &&
        args.ideas.some((i: any) => typeof i?.idea === "string" && i.idea)
          ? {
              ideas: args.ideas.flatMap((i: any) =>
                typeof i?.idea === "string" && i.idea ? [i.idea] : [],
              ),
            }
          : {}),
        ...(typeof args.concept === "string" && args.concept
          ? { concept: args.concept }
          : {}),
        ...(args.register ? { register: args.register } : {}),
        ...(args.style ? { style: args.style } : {}),
      };
    case "find_materials":
      return {
        name,
        subjects: (args.subjects || []).filter(
          (s: unknown) => typeof s === "string",
        ),
      };
    case "generate_images":
      return {
        name,
        images: (args.images || [])
          .filter((i: any) => i?.name?.zh)
          .map((i: any) => ({ name: i.name.zh, url: "" })),
      };
    case "write_work": {
      const modules = records(args.modules),
        links = records(args.links),
        named = records(args.scenes);
      const scenes = new Map<string, { id: string; title: string; modules: Sketch[] }>();
      const touched = (id: string) => {
        if (!scenes.has(id)) scenes.set(id, { id, title: "", modules: [] });
        return scenes.get(id)!;
      };
      for (const s of named) touched(s.id).title = s.title ?? "";
      for (const m of modules) {
        const scene = touched(m.scene ?? sceneId),
          bounds = boxed(m.bounds);
        if (bounds)
          scene.modules.push({
            id: m.id,
            // Its words, as far as they have arrived; a bare id says nothing to the viewer.
            label: labelOf({ id: "", label: m.label, data: m.data ?? {} }),
            bounds,
            ...(m.drawingId ? { drawingId: m.drawingId } : {}),
          });
      }
      for (const l of links) touched(l.scene ?? sceneId);
      const changed =
        modules.filter((m) => !m.bounds).length +
        links.filter((l) => !l.from && !l.to).length +
        named.filter((s) => s.order?.length).length;
      return {
        name,
        drawings: (args.drawings || [])
          .filter((d: any) => d?.id && (typeof d.source === "string" || d.edits))
          .map((d: any) => d.id),
        writing: (args.drawings || []).findLast(
          (d: any) => d?.id && typeof d.source !== "string" && !d.edits,
        )?.id,
        scenes: [...scenes.values()],
        ...(changed ? { changed } : {}),
        details: (args.details || []).flatMap((d: any) => d?.title ?? []),
        materials: [],
        removed: Object.values(args.remove || {}).flat().length,
      };
    }
    case "view_canvas":
      return {
        name,
        sceneId: args.sceneId,
        regions: (Array.isArray(args.regions) ? args.regions : []).flatMap(
          (r: unknown) => boxed(r) ?? [],
        ),
        focus: args.actions?.length
          ? "actions"
          : args.regions?.length
            ? "region"
            : args.annotate
              ? "annotate"
              : "overview",
      };
    default:
      throw Error("Unknown tool " + name);
  }
}
/** Library drawings the work uses whose cards the author has not read: parameters it
 * guessed draw something other than it meant, or nothing. */
function cardsUnread(work: Work, input: Item[], batch: Item[] = []) {
  const { drawings } = guidesRead(input, batch);
  // Each drawing is pointed out once: an author that went on without its card had a reason.
  const told = new Set(
    input.flatMap((i) => {
      if (i.type !== "function_call_output" || typeof i.output !== "string" || !i.output.includes('"cardsUnread"'))
        return [];
      try {
        return (JSON.parse(i.output).cardsUnread ?? []) as string[];
      } catch {
        return [];
      }
    }),
  );
  const unread = Object.values(work.materials)
    .filter((m) => m.kind === "drawing" && !drawings.has(m.id) && !told.has(m.id))
    .map((m) => m.id);
  return unread.length
    ? {
        cardsUnread: unread,
        note: "Read these drawings' cards with draw_guide before judging them: their parameters cannot be guessed.",
      }
    : {};
}
/** What this code reads a saved conversation as. A conversation from before the current
 * work format is not continued: its tool calls and guides describe another format. */
const CONTEXT_FORMAT = 2;
interface Context {
  /** Resolved once for this run, including connections and prices, and persisted across answers. */
  settings: Settings;
  input: Item[];
  generations: number;
  /** The tokens the model last reported for the first `items` items of the input. */
  measured?: { tokens: number; items: number };
  /** The module geometry the conversation holds, so a look repeats only what changed. */
  reported?: Reported;
  /** The revision of the work this conversation already holds: the last one the author
   * saved, read or was handed whole. A later request sends only what changed since. */
  known?: number;
  /** The user's standing preferences as this conversation was last told them. */
  preferences?: string;
  /** A write that was refused, as it stands, waiting for `amend`. */
  held?: Record<string, unknown>;
  format?: number;
}
/** The user's standing preferences as the author is told them: in the conversation rather
 * than the instructions, so the instructions stay the same for everyone and are cached once. */
const preferencesOf = (settings: Settings) => settings.preferences.trim() || "none";
const preferencesMessage = (preferences: string): Item => ({
  role: "user",
  content: `User preferences: ${preferences}`,
});
async function userMessage(
  store: UserStore,
  text: string,
  materials: string[],
  locale: MessageLocale = "zh",
): Promise<Item> {
  return {
    role: "user",
    content: [
      {
        type: "input_text",
        // Pictures sent without words give no language to answer in; the page's does.
        text: text.trim()
          ? text
          : `(Pictures only, no words. The user reads ${locale === "zh" ? "Chinese" : "English"}.)`,
      },
      ...(await attached(materials, store.viewer)),
    ],
  };
}
const workMessage = (sceneId: string, work: Work, changes = ""): Item => ({
  role: "user",
  content: `${changes}Current scene: ${sceneId}\nCurrent work: ${JSON.stringify(forAuthor(work))}`,
});
/** The list of what changed between two revisions, one line per scene or kind of record. */
function changeLines(changes: ReturnType<typeof changesBetween>) {
  const { scenes, addedScenes, removedScenes, drawings, details, style } = changes;
  const list = (label: string, ids: string[]) =>
    ids.length ? [`${label} ${ids.join(", ")}`] : [];
  const records = (
    kind: string,
    r: { added: string[]; changed: string[]; removed: string[] },
  ) => {
    const parts = [
      ...list("changed", r.changed),
      ...list("added", r.added),
      ...list("removed", r.removed),
    ];
    return parts.length ? [`- ${kind}: ${parts.join("; ")}`] : [];
  };
  return [
    ...scenes.map(
      (s) =>
        `- scene ${s.id}: ${[
          ...list("changed", s.changed),
          ...list("moved or resized", s.moved),
          ...list("added", s.added),
          ...list("removed", s.removed),
          ...(s.restacked ? ["stacking order changed"] : []),
          ...(s.retitled ? ["its title or parent changed"] : []),
          ...(s.scriptChanged ? ["its script changed"] : []),
          ...(s.checksChanged ? ["interaction checks changed"] : []),
        ].join("; ")}`,
    ),
    ...list("- scenes added", addedScenes),
    ...list("- scenes removed", removedScenes),
    ...records("drawings", drawings),
    ...records("details", details),
    ...(style ? ["- the work's style tokens"] : []),
  ];
}
/** The records that changed between two revisions, as they are now, in the terms the author
 * reads the work in. A changed scene carries its own fields, the order of all its modules
 * and the parts that changed or were added; the rest of it is as it was. */
function changedRecords(
  before: Work,
  after: Work,
  changes: ReturnType<typeof changesBetween>,
) {
  const pick = (all: Record<string, unknown>, ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, all[id]]));
  const whole = forAuthor(after);
  const scenes = Object.fromEntries([
    ...changes.scenes.map((c) => {
      const scene = after.scenes[c.id];
      const parts = new Set([...c.changed, ...c.moved, ...c.added]);
      const { modules, links, interaction, ...fields } = scene;
      return [
        c.id,
        {
          ...fields,
          ...(c.scriptChanged ? { interaction: interaction ?? null } : {}),
          order: modules.map((m) => m.id),
          modules: modules.filter((m) => parts.has(m.id)).map(shortModule),
          links: links.filter((l) => parts.has(l.id)).map(shortLink),
          ...(c.removed.length ? { removed: c.removed } : {}),
        },
      ];
    }),
    ...changes.addedScenes.map((id) => [id, whole.scenes[id]]),
  ]);
  const was = forAuthor(before).materials,
    now = whole.materials;
  const materials = Object.keys(now).filter(
    (id) => JSON.stringify(was[id]) !== JSON.stringify(now[id]),
  );
  const removed = {
    scenes: changes.removedScenes,
    drawings: changes.drawings.removed,
    details: changes.details.removed,
    materials: Object.keys(was).filter((id) => !(id in now)),
  };
  const touched = (r: { added: string[]; changed: string[] }) => [
    ...r.changed,
    ...r.added,
  ];
  return {
    ...(before.title !== after.title ? { title: after.title } : {}),
    ...(JSON.stringify(before.brief) !== JSON.stringify(after.brief)
      ? { brief: after.brief }
      : {}),
    ...(changes.style ? { style: after.style } : {}),
    ...(Object.keys(scenes).length ? { scenes } : {}),
    ...Object.fromEntries(
      (["drawings", "details"] as const)
        .map((k) => [k, pick(after[k], touched(changes[k]))] as const)
        .filter(([, r]) => Object.keys(r).length),
    ),
    ...(materials.length ? { materials: pick(now, materials) } : {}),
    ...(Object.values(removed).some((r) => r.length)
      ? {
          removed: Object.fromEntries(
            Object.entries(removed).filter(([, r]) => r.length),
          ),
        }
      : {}),
  };
}
/** The work as a new request hands it to an author whose conversation already holds it:
 * nothing but the scene when it is as the author left it; otherwise what the user changed
 * themselves (by hand, by undoing or by bringing back an earlier version), listed and
 * given as records, so the author keeps those changes without being sent the whole work
 * again. The whole work is sent when the conversation does not hold a revision of it, or
 * when the changes come to more than half of it. */
function catchUp(
  store: UserStore,
  sceneId: string,
  work: Work,
  known: number | undefined,
): Item {
  const unchanged: Item = {
    role: "user",
    content: `Current scene: ${sceneId}\nThe work is as you last saw it (revision ${work.revision}).`,
  };
  if (known === work.revision) return unchanged;
  const before = known === undefined ? undefined : store.revision(work.id, known);
  // Only the user changes a work between requests; a revision the author saved that this
  // conversation does not know of means it does not hold the work.
  const between = store
    .revisions(work.id)
    .filter((r) => r.revision > (known ?? 0) && r.revision <= work.revision);
  if (!before || between.some((r) => r.cause.kind === "run"))
    return workMessage(sceneId, work, ownChanges(store, work));
  const changes = changesBetween(before, work);
  const records = JSON.stringify(changedRecords(before, work, changes));
  if (records === "{}") return unchanged;
  const head = `Since your last turn the user changed the work themselves (revision ${known} to ${work.revision}).`,
    list = changeLines(changes).join("\n");
  if (records.length * 2 > JSON.stringify(forAuthor(work)).length)
    return workMessage(
      sceneId,
      work,
      `${head} The current work below includes these changes; keep them unless the user asks otherwise:\n${list}\n`,
    );
  return {
    role: "user",
    content: `${head} Keep these changes unless the user asks otherwise, since they are the user's own decisions:\n${list}\nOnly what changed is below, as it is now; everything else is as you last saw or saved it. A changed scene lists the order of all its modules (bottom to top) and only its changed or added parts. Call read_work if you need the whole work.\nChanged: ${records}\nCurrent scene: ${sceneId}`,
  };
}
/** What the user changed in the work themselves (by hand, by undoing or by bringing back
 * an earlier version) since the author last saved it, so its next turn builds on that. */
function ownChanges(store: UserStore, work: Work) {
  const history = store.revisions(work.id);
  const last = history.find((r) => r.cause.kind === "run");
  if (!last || last.revision === work.revision) return "";
  const lines = changeLines(
    changesBetween(store.revision(work.id, last.revision), work),
  );
  return lines.length
    ? `Since your last turn the user changed the work themselves (revision ${last.revision} to ${work.revision}). The current work below includes these changes; keep them unless the user asks otherwise:\n${lines.join("\n")}\n`
    : "";
}

/** Characters of JSON, a third of a token each. Pictures count as a fixed size and
 * encrypted reasoning not at all: both are base64 that reads as far more text than the
 * tokens they cost, so counting them as characters started compaction at under half the
 * real limit. The blocks kept for Claude repeat what their item says, with signed
 * thinking, and are not counted either. */
function estimate(items: Item[]): number {
  return Math.ceil(
    JSON.stringify(items, (key, value) =>
      key === "image_url"
        ? " ".repeat(6400)
        : key === "encrypted_content" || key === "anthropic"
          ? ""
          : value,
    ).length / 3,
  );
}
/** The context's size in tokens: what the model last reported for it, plus an estimate
 * of what has been added since. */
function contextSize(ctx: Context): number {
  const m = ctx.measured;
  return m && m.items <= ctx.input.length
    ? m.tokens + estimate(ctx.input.slice(m.items))
    : estimate(ctx.input);
}
/** The context without its older screenshots, when a summary could not be made: each
 * look is described by its tool output, and the latest work is in the messages. */
function withoutOldPictures(input: Item[]): Item[] {
  const pictured = input.flatMap((item, i) =>
    Array.isArray(item.content) &&
    item.content.some((c: Item) => c.type === "input_image")
      ? [i]
      : [],
  );
  const keep = new Set(pictured.slice(-2));
  return input.map((item, i) =>
    pictured.includes(i) && !keep.has(i)
      ? {
          ...item,
          content: [
            ...item.content.filter((c: Item) => c.type !== "input_image"),
            { type: "input_text", text: "(An earlier picture, left out to save space.)" },
          ],
        }
      : item,
  );
}
/** What a summary is asked to keep, at the end of the conversation it summarizes. */
const SUMMARY_REQUEST =
  "Summarize this drawing conversation so the author can continue from your notes alone, since everything else in it is about to be dropped. Keep: what the user asked and every requirement or correction, in their words; the brief and its basis; what each reference image is for; the material ids chosen or generated and what each depicts; decisions and why they were made; facts and sources found by research; what is unfinished; tool failures still unresolved. Leave out drawing code, module lists and guide text, because the latest saved work and the original reference images are supplied separately and guides can be read again. Call no tool and write only the notes; do not continue the work.";
async function compact(
  store: UserStore,
  run: Run,
  ctx: Context,
  signal: AbortSignal,
  instructions: string,
  tools: Item[],
) {
  const size = contextSize(ctx);
  if (size < 200000) return;
  await tracer.span("compact", "context", { size }, async (span) => {
    const author = ctx.settings.author;
    const began = Date.now();
    // A summary needs little thought: at the author's effort, xhigh reasoning used up the
    // output budget and the cut-off summary failed the whole run. Where the effort changes
    // in the conversation, the summary is asked of the same request as every turn, so it
    // reads the whole conversation from the cache instead of paying for all of it again.
    const inConversation = adapterFor(author.protocol).effortControl(author) === "conversation";
    let summary = "",
      answered = false;
    try {
      const result = await generate(inConversation ? author : { ...author, effort: "low" }, {
        instructions,
        input: [
          ...ctx.input,
          ...(inConversation
            ? [{ type: "configuration_update", reasoning: { effort: lowestEffort(author.efforts) ?? "low" } }]
            : []),
          { role: "user", content: SUMMARY_REQUEST },
        ],
        tools,
        signal,
        budget: 16384,
        cacheKey: store.userId,
      });
      spend(run, result.usage);
      answered = true;
      summary = textOf(result.items);
      span.set({ usage: result.usage, response: result.response });
      if (!summary) throw Error("摘要是空的");
    } catch (e) {
      if (!answered) spendFailed(run, { ms: Date.now() - began });
      if (signal.aborted) throw e;
      // Without a summary the run goes on with less to read rather than stopping.
      ctx.input = withoutOldPictures(ctx.input);
      ctx.measured = undefined;
      store.context(run.id, ctx);
      span.set({ error: String(e), replaced: false });
      return;
    }
    const references = [
      ...new Set(
        store
          .runs(run.workId)
          .flatMap((r) =>
            r.steps.flatMap((s) =>
              s.kind === "message" && s.role === "user"
                ? s.materials || []
                : [],
            ),
          ),
      ),
    ];
    ctx.input = [
      preferencesMessage((ctx.preferences = preferencesOf(ctx.settings))),
      await userMessage(
        store,
        "Conversation summary. Guides and drawing cards read earlier are no longer above, so read again with draw_guide what you still need.\n" + summary,
        references,
      ),
      workMessage(run.sceneId, store.work(run.workId)),
    ];
    ctx.known = store.work(run.workId).revision;
    ctx.measured = undefined;
    ctx.reported = undefined;
    store.context(run.id, ctx);
    // The next turn starts from this summary alone.
    span.set({ summary, replaced: true });
  });
}
/** Every turn thinks at the configured effort. A configuration_update lasts until the next
 * one, so where the format changes effort in the conversation, one left by an earlier turn
 * (see `withLessThought`) or run is replaced before it carries over. */
function holdEffort(input: Item[], role: Role) {
  if (adapterFor(role.protocol).effortControl(role) !== "conversation") return;
  const current = input.findLast((i) => i.type === "configuration_update")?.reasoning?.effort;
  if (current && current !== role.effort)
    input.push({ type: "configuration_update", reasoning: { effort: role.effort } });
}
/** How to ask again a turn whose whole output budget went on thinking: at the least thought
 * the model accepts, the same way its effort changes otherwise. Undefined when it is
 * already thinking as little as it can. */
export function withLessThought(input: Item[], role: Role, effort: Effort) {
  const least = lowestEffort(role.efforts);
  if (!least || least === effortFor(effort, role.efforts)) return undefined;
  if (adapterFor(role.protocol).effortControl(role) === "conversation")
    input.push({ type: "configuration_update", reasoning: { effort: least } });
  return { role: { ...role, ...(adapterFor(role.protocol).effortControl(role) === "fixed" ? { effort: least } : {}) }, effort: least };
}
/** A model request that failed on the way rather than on its content. */
const transient = (e: unknown) =>
  e instanceof TypeError ||
  (e instanceof Error &&
    /^模型请求 (429|5\d\d)|模型连接在完成前中断|terminated|ECONNRESET|socket/.test(
      e.message,
    ));
/** Everything the user has said about this work, for checking a brief's quotes. */
function said(store: UserStore, workId: string, preferences: string) {
  return [
    preferences,
    ...store
      .runs(workId)
      .flatMap((r) =>
        r.steps.flatMap((s) =>
          s.kind === "message" && s.role === "user" ? [s.text] : [],
        ),
      ),
  ];
}
/** Where a conversation starts when the one before it cannot be continued: what the user has
 * asked of this work so far. The whole work follows it. */
function earlierRequests(store: UserStore, workId: string): Item[] {
  const asked = store
    .runs(workId)
    .flatMap((r) => r.steps.flatMap((s) => (s.kind === "message" && s.role === "user" ? [s.text] : [])));
  return asked.length
    ? [{ role: "user", content: `Earlier requests on this work, oldest first:\n${asked.map((a) => `- ${a}`).join("\n")}` }]
    : [];
}
/** Every revision a run saves belongs to the request that started it. */
const causeOf = (run: Run): Cause => ({
  kind: "run",
  runId: run.id,
  prompt: (run.steps[0] as Extract<Step, { kind: "message" }>).text,
});
/** Option pictures for a question: pictures as themselves, styles by their samples. */
async function questions(
  store: UserStore,
  input: unknown,
): Promise<Question[]> {
  const { questions } = askSchema.parse(input);
  const ids = [
    ...new Set(
      questions.flatMap((q) => q.options.flatMap((o) => o.materials || [])),
    ),
  ];
  // A picture shows itself; a style shows a few of its samples.
  const found = new Map(
    (ids.length ? await library.get(ids, store.viewer, true) : []).map((m) => [
      m.id,
      m.kind === "style"
        ? m.samples.slice(0, 3).map((s) => ({
            id: s,
            name: m.name.zh,
            url: `/materials/thumbs/${s}?size=256`,
          }))
        : m.kind === "picture"
          ? [{ id: m.id, name: m.name.zh, url: m.file.url }]
          : [],
    ]),
  );
  return questions.map((q) => ({
    id: q.id,
    text: q.text,
    ...(q.multiple ? { multiple: true } : {}),
    options: q.options.map((o) => {
      const shown: Picture[] = (o.materials || []).flatMap(
        (id) => found.get(id) ?? [],
      );
      return {
        label: o.label,
        ...(o.detail ? { detail: o.detail } : {}),
        ...(shown.length ? { pictures: shown } : {}),
      };
    }),
  }));
}
export class Agent {
  active = new Map<string, AbortController>();
  /** Runs already held once for text too small to read. */
  private heldForText = new Set<string>();
  /** Pictures each run has asked for, developing in the background. */
  developments = new Map<string, (Development & { reported?: boolean })[]>();
  constructor(public publish: (user: string, event: object) => void) {}
  emit(store: UserStore, run: Run) {
    store.saveRun(run);
    this.publish(store.userId, { type: "run", run });
  }
  async start(
    store: UserStore,
    workId: string,
    sceneId: string,
    prompt: string,
    materials: string[] = [],
    locale: MessageLocale = "zh",
  ) {
    const work = store.work(workId);
    if (
      store
        .runs(workId)
        .some((r) => ["running", "viewing", "waiting"].includes(r.status))
    )
      throw new DomainError("请先完成或取消当前任务", 409);
    if (!work.scenes[sceneId]) throw new DomainError("场景不存在", 404);
    const settings = store.settings();
    const message = await userMessage(store, prompt, materials, locale);
    const run: Run = {
      id: id(),
      workId,
      sceneId,
      status: "running",
      steps: [{ kind: "message", role: "user", text: prompt, materials }],
      observations: [],
      startedAt: Date.now(),
    };
    const previous = store.runs(workId).at(-1);
    const saved = previous && (store.context(previous.id) as Context | null);
    const before = saved?.format === CONTEXT_FORMAT ? saved : undefined;
    const ctx: Context = {
      settings,
      input: before ? before.input : earlierRequests(store, workId),
      generations: 0,
      ...(before?.measured ? { measured: before.measured } : {}),
      ...(before?.reported ? { reported: before.reported } : {}),
      known: work.revision,
      preferences: preferencesOf(settings),
      format: CONTEXT_FORMAT,
    };
    ctx.input.push(
      // Told again only when they changed since this conversation last heard them.
      ...(before?.preferences === ctx.preferences ? [] : [preferencesMessage(ctx.preferences!)]),
      message,
      before
        ? catchUp(store, sceneId, work, before.known)
        : workMessage(sceneId, work, ownChanges(store, work)),
    );
    this.emit(store, run);
    store.context(run.id, ctx);
    tracer.begin({
      id: run.id,
      userId: store.userId,
      workId,
      title: work.title,
      prompt,
      status: run.status,
      startedAt: run.startedAt,
    });
    void this.execute(store, run, ctx, "request");
    return run;
  }
  async resume(
    store: UserStore,
    runId: string,
    answer: string,
    materials: string[] = [],
    locale: MessageLocale = "zh",
  ) {
    const run = store.run(runId);
    if (run.status !== "waiting") throw new DomainError("当前任务没有等待回答");
    const ctx = store.context(runId) as Context;
    if (ctx.format !== CONTEXT_FORMAT) {
      const work = store.work(run.workId);
      const asked = run.steps.findLast((s) => s.kind === "message" && s.asked);
      ctx.input = [
        ...earlierRequests(store, run.workId),
        ...(asked?.kind === "message"
          ? [{ role: "user", content: `You then asked the user:\n${asked.text}` }]
          : []),
        workMessage(run.sceneId, work),
      ];
      ctx.known = work.revision;
      ctx.measured = undefined;
      ctx.reported = undefined;
      ctx.format = CONTEXT_FORMAT;
    }
    ctx.input.push(await userMessage(store, answer, materials, locale));
    run.steps.push({ kind: "message", role: "user", text: answer, materials });
    run.questions = undefined;
    run.status = "running";
    ctx.generations = 0;
    this.emit(store, run);
    store.context(run.id, ctx);
    tracer.status(run.id, run.status);
    void this.execute(store, run, ctx, "answer");
    return run;
  }
  cancel(store: UserStore, runId: string) {
    const run = store.run(runId);
    const active = this.active.get(runId);
    if (active) {
      active.abort();
      return run;
    }
    run.status = "cancelled";
    this.emit(store, run);
    tracer.status(run.id, run.status);
    return run;
  }
  /** Tells the author about pictures that finished developing since it last heard, and
   * shows it the ones that came out. */
  private async developed(store: UserStore, run: Run): Promise<Item[]> {
    const fresh = (this.developments.get(run.id) || []).filter(
      (d) => d.settled && !d.reported,
    );
    if (!fresh.length) return [];
    for (const d of fresh) d.reported = true;
    const ready = fresh.filter((d) => d.settled!.status === "ready");
    // The measured visible content, so modules can take the picture's real proportions.
    const sizes = new Map(
      (ready.length
        ? await library.get(
            ready.map((d) => d.id),
            store.userId,
            true,
          )
        : []
      ).flatMap((m) => {
        const use = useOf(m);
        return use?.kind === "picture"
          ? [[m.id, `${use.width}×${use.height}`] as const]
          : [];
      }),
    );
    const lines = fresh.map((d) =>
      d.settled!.status === "ready"
        ? `${d.id} (${d.name}) developed; visible content ${sizes.get(d.id) ?? "unknown"}.${
            d.settled!.opaque
              ? " It came out with a background around it, painted twice, so it shows as a box: use it as a scene, or generate it again."
              : ""
          }`
        : `${d.id} (${d.name}) failed: ${d.settled!.error}. Generate it again or draw another way.`,
    );
    return [
      {
        role: "user",
        content: [
          { type: "input_text", text: "Pictures:\n" + lines.join("\n") },
          ...(await look(
            ready.map((d) => d.id),
            store.userId,
            384,
          )),
        ],
      },
    ];
  }
  async execute(
    store: UserStore,
    run: Run,
    ctx: Context,
    trigger: "request" | "answer",
  ) {
    const abort = new AbortController();
    this.active.set(run.id, abort);
    const timeout = setTimeout(
      () => abort.abort(new Error("运行超过 15 分钟")),
      15 * 60 * 1000,
    );
    const start = Date.now();
    let flush: ReturnType<typeof setTimeout> | undefined;
    const settings = ctx.settings;
    run.services = {
      label: settings.label,
      author: settings.authorName,
      model: settings.author.model,
      effort: settings.author.effort,
      speed: settings.author.speed,
      search: settings.search.mode,
      ...(settings.search.service ? { searchBy: settings.search.service.name } : {}),
      image: settings.imageName,
    };
    run.prices = settings.prices;
    await tracer.within(run.id, () =>
      tracer
        .span(
          "execution",
          trigger,
          {
            message: run.steps.findLast(
              (s): s is Extract<Step, { kind: "message" }> =>
                s.kind === "message" && s.role === "user",
            )?.text,
            model: settings.author.model,
            protocol: settings.author.protocol,
            effort: settings.author.effort,
            search: settings.search.mode,
            ...(settings.search.service
              ? { searchService: settings.search.service.provider }
              : {}),
            speed: settings.author.speed,
            imageModel: settings.image.model,
          },
          async (execution) => {
            try {
              const instructions = [
                AUTHOR,
                catalogue(await styleList(), await kit()),
              ].join("\n\n");
              // Where this execution starts from; each turn records what it adds.
              execution.set({
                instructions,
                context: ctx.input,
                tools: toolsFor(settings).map((t) =>
                  "name" in t ? t.name : t.type,
                ),
              });
              await this.loop(
                store,
                run,
                ctx,
                abort,
                instructions,
                start,
                (f) => {
                  flush = f;
                },
              );
            } catch (e) {
              console.error("DrawY run failed", run.id, e);
              run.status = abort.signal.aborted ? "cancelled" : "failed";
              run.error = String(abort.signal.reason || e);
              if (run.status === "failed") throw e;
            } finally {
              // A cancelled batch still needs a result for every emitted tool call.
              const answered = new Set(
                ctx.input
                  .filter((item) => item.type === "function_call_output")
                  .map((item) => item.call_id),
              );
              for (const item of ctx.input.filter(
                (item) => item.type === "function_call",
              ))
                if (!answered.has(item.call_id))
                  ctx.input.push({
                    type: "function_call_output",
                    call_id: item.call_id,
                    output:
                      "Execution interrupted. Read the current work before continuing.",
                  });
              store.context(run.id, ctx);
              clearTimeout(timeout);
              clearTimeout(flush);
              this.active.delete(run.id);
              run.elapsedMs = (run.elapsedMs || 0) + Date.now() - start;
              this.emit(store, run);
              execution.set({ status: run.status });
              tracer.status(run.id, run.status);
            }
          },
        )
        .catch(() => {}),
    );
  }
  private async loop(
    store: UserStore,
    run: Run,
    ctx: Context,
    abort: AbortController,
    instructions: string,
    start: number,
    flushing: (f: ReturnType<typeof setTimeout> | undefined) => void,
  ) {
    const settings = ctx.settings;
    const availableTools = toolsFor(settings);
    // Tool arguments stream in; each flush shows what has been laid out so far.
    const drafts = new Map<
      string,
      { step: ToolStep; name: string; text: string }
    >();
    let flush: ReturnType<typeof setTimeout> | undefined;
    const emitSoon = () => {
      flush ??= setTimeout(() => {
        flush = undefined;
        flushing(undefined);
        for (const d of drafts.values())
          Object.assign(d.step, activity(d.name, partialJson(d.text) ?? {}, run.sceneId));
        this.emit(store, run);
      }, 250);
      flushing(flush);
    };
    let seen = ctx.input.length;
    while (ctx.generations++ < 24) {
      let thinking: Extract<Step, { kind: "thinking" }> | undefined;
      // Progress the author writes takes its place among the steps as it streams.
      let said: Extract<Step, { kind: "message" }> | undefined;
      abort.signal.throwIfAborted();
      ctx.input.push(...(await this.developed(store, run)));
      await compact(store, run, ctx, abort.signal, instructions, availableTools);
      if (seen > ctx.input.length) seen = 0;
      holdEffort(ctx.input, settings.author);
      const turnStart = Date.now();
      const steer = steering(run, availableTools, settings.author);
      let firstOutput: number | undefined;
      const result = await tracer.span(
        "turn",
        `turn ${ctx.generations}`,
        {
          input: ctx.input.slice(seen),
          inputItems: ctx.input.length,
          estimatedTokens: contextSize(ctx),
          request: {
            ...requestOf(settings.author),
            effort: settings.author.effort,
            instructionsChars: instructions.length,
            tools: availableTools.length,
            ...(Object.keys(steer).length ? { steer } : {}),
          },
        },
        async (span) => {
          // A dropped stream, a rate limit or a server error is tried again from the
          // same input; what the broken attempt had shown is taken back first.
          const mark = run.steps.length;
          // When each hosted call began, to time its span once it is done.
          const began = new Map<string, number>();
          let result!: Awaited<ReturnType<typeof generate>>;
          let asked = { role: settings.author, effort: settings.author.effort };
          let lessened = false;
          for (let attempt = 0, waits = [2000, 8000, 0]; attempt < waits.length; attempt++) {
            const wait = waits[attempt];
            const tried = Date.now();
            let reported: Item | undefined,
              chars = 0;
            try {
              result = await generate(asked.role, {
                instructions,
                input: ctx.input,
                tools: availableTools,
                signal: abort.signal,
                // One key for all of a user's works: every request begins with the same
                // instructions and tools, and a work's turns extend its earlier ones.
                cacheKey: store.userId,
                steer,
                effort: asked.effort,
                onEvent: (event) => {
                  if (event.type === "response.usage") {
                    reported = event.usage;
                    return;
                  }
                  if (event.type.endsWith(".delta") && typeof event.delta === "string")
                    chars += event.delta.length;
                  if (
                    firstOutput === undefined &&
                    event.type.endsWith(".delta")
                  )
                    firstOutput = Date.now() - turnStart;
                  if (
                    run.firstOutputMs === undefined &&
                    event.type.endsWith(".delta")
                  ) {
                    run.firstOutputMs = Date.now() - start;
                    this.emit(store, run);
                  }
                  switch (event.type) {
                    case "response.reasoning_summary_part.added":
                      thinking = { kind: "thinking", text: "" };
                      run.steps.push(thinking);
                      emitSoon();
                      break;
                    case "response.reasoning_summary_text.delta":
                      if (thinking) thinking.text += event.delta;
                      emitSoon();
                      break;
                    case "response.reasoning_summary_text.done":
                      if (thinking) thinking.text = event.text;
                      emitSoon();
                      break;
                    case "response.output_text.delta":
                      if (said) said.text += event.delta;
                      emitSoon();
                      break;
                    case "response.output_item.added": {
                      const { type, name, call_id, id: item } = event.item;
                      if (type === "message" && !said) {
                        said = { kind: "message", role: "assistant", text: "" };
                        run.steps.push(said);
                      }
                      if (hosted(event.item)) {
                        began.set(item, Date.now());
                        run.steps.push({
                          kind: "tool",
                          id: item,
                          status: "running",
                          ...hostedActivity(event.item),
                        });
                        this.emit(store, run);
                      }
                      if (type === "function_call" && !silent.has(name)) {
                        const step: ToolStep = {
                          kind: "tool",
                          id: call_id,
                          status: "running",
                          ...activity(name, {}, run.sceneId),
                        };
                        run.steps.push(step);
                        drafts.set(item, { step, name, text: "" });
                        this.emit(store, run);
                      }
                      break;
                    }
                    case "response.function_call_arguments.delta": {
                      const draft = drafts.get(event.item_id);
                      if (draft) {
                        draft.text += event.delta;
                        emitSoon();
                      }
                      break;
                    }
                    case "response.output_item.done": {
                      drafts.delete(event.item.id);
                      if (hosted(event.item)) {
                        const call = event.item,
                          failed = call.status === "failed",
                          tool = call.type.replace(/_call$/, "");
                        const step = run.steps.find(
                          (s): s is ToolStep =>
                            s.kind === "tool" && s.id === call.id,
                        );
                        if (step)
                          Object.assign(step, hostedActivity(call), {
                            status: failed ? "failed" : "done",
                          });
                        const used = (usageOf(run).hosted ??= {});
                        used[tool] = (used[tool] ?? 0) + 1;
                        if (call.type === "web_search_call") counted(run, call.action?.type);
                        // Recorded like any tool call, under the turn that made it.
                        tracer.record(
                          "tool",
                          tool,
                          {
                            hosted: true,
                            args: call.action ?? call.arguments ?? null,
                            output: call,
                          },
                          {
                            startedAt: began.get(call.id) ?? Date.now(),
                            ...(failed ? { error: `${tool} failed` } : {}),
                          },
                        );
                        this.emit(store, run);
                      }
                      break;
                    }
                  }
                },
              });
              break;
            } catch (e) {
              // Spent whatever becomes of the run, and told apart from what it paid for.
              const spent = spendFailed(run, {
                usage: e instanceof CutOff ? e.usage : reported,
                ms: Date.now() - tried,
                chars,
              });
              tracer.record(
                "turn",
                `turn ${ctx.generations} failed attempt`,
                {
                  failed: true,
                  inputItems: ctx.input.length,
                  estimatedTokens: contextSize(ctx),
                  usage: { ...spent.usage, output_tokens: spent.output },
                  ...(spent.estimated ? { estimatedOutput: spent.estimated } : {}),
                },
                { startedAt: tried, error: e instanceof Error ? e.message : String(e) },
              );
              if (e instanceof CutOff) {
                span.set({ incomplete: e.reason ?? "unknown" });
                const less =
                  e.thoughtOnly && !lessened && !abort.signal.aborted
                    ? withLessThought(ctx.input, settings.author, asked.effort)
                    : undefined;
                if (less) {
                  // A turn that thinks away its budget would do so again as it is, and
                  // this attempt is not one the connection's retries should count.
                  asked = less;
                  lessened = true;
                  attempt--;
                  tracer.note("less thought", { effort: less.effort }, e.message);
                  run.steps.splice(mark);
                  thinking = said = undefined;
                  firstOutput = undefined;
                  drafts.clear();
                  this.emit(store, run);
                  continue;
                }
              }
              if (abort.signal.aborted || !transient(e)) throw e;
              if (!wait)
                throw Error(
                  `与模型的连接中断了（${e instanceof Error ? e.message : e}），已保存的内容仍可继续修改`,
                );
              tracer.note("retry", { wait }, String(e));
              run.steps.splice(mark);
              thinking = said = undefined;
              firstOutput = undefined;
              drafts.clear();
              failedOf(run).ms += wait;
              this.emit(store, run);
              await new Promise((resolve) => setTimeout(resolve, wait));
            }
          }
          span.set({
            output: result.items,
            usage: result.usage,
            response: result.response,
            firstOutputMs: firstOutput,
          });
          return result;
        },
      );
      drafts.clear();
      spend(run, result.usage);
      ctx.input.push(...result.items);
      seen = ctx.input.length;
      if (result.usage.input_tokens)
        ctx.measured = {
          tokens: result.usage.input_tokens + (result.usage.output_tokens ?? 0),
          items: ctx.input.length,
        };
      const text = textOf(result.items);
      const citations = citationsOf(result.items);
      if (said) {
        said.text = text;
        if (citations.length) said.citations = citations;
        if (!text) run.steps.splice(run.steps.indexOf(said), 1);
      } else if (text)
        run.steps.push({ kind: "message", role: "assistant", text, ...(citations.length ? { citations } : {}) });
      this.emit(store, run);
      const calls = result.items.filter((i) => i.type === "function_call");
      if (!calls.length) {
        // Words with no call end the run once the work is done: they are its closing words.
        const blocked = this.done(store, run);
        if (text && blocked === undefined) {
          run.status = "completed";
          store.context(run.id, ctx);
          this.developments.delete(run.id);
          this.heldForText.delete(run.id);
          return;
        }
        ctx.input.push({
          role: "user",
          content: blocked
            ? `The work is not done yet: ${blocked}. Take the next step with a tool, keeping any note to the user in the same message.`
            : "Your last message had neither closing words nor a tool call. Write your closing words if the work is done, or take the next step with a tool.",
        });
        continue;
      }
      let writeError: string | undefined;
      // Every call's result comes before any picture: a service that checks a batch's
      // results in order takes a message between them for a call left unanswered.
      const shown: Item[] = [];
      for (const call of calls) {
        abort.signal.throwIfAborted();
        const outcome = await tracer.span(
          "tool",
          call.name,
          { args: call.arguments },
          async (span) => {
            const r = await this.call(
              store,
              run,
              ctx,
              call,
              calls,
              abort,
              start,
              writeError,
            );
            span.set({
              output: r.output,
              images: r.images.map((i) => i.image_url).filter(Boolean),
              ...(r.error ? { error: r.error } : {}),
            });
            if (r.error)
              tracer.note("tool error", { tool: call.name }, r.error);
            return r;
          },
        );
        if (outcome.done) return;
        if (call.name === "write_work" && outcome.error) writeError = outcome.error;
        ctx.input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output:
            typeof outcome.output === "string"
              ? outcome.output
              : JSON.stringify(outcome.output),
        });
        if (outcome.images.length) shown.push({ role: "user", content: outcome.images });
        store.context(run.id, ctx);
        this.emit(store, run);
      }
      ctx.input.push(...shown);
      store.context(run.id, ctx);
    }
    throw Error("已达到本轮 24 次生成上限");
  }
  /** What still stands in the way of finishing: every picture developed and the latest
   * revision seen since, whole and without errors. */
  private done(store: UserStore, run: Run): string | undefined {
    const work = store.work(run.workId);
    const developments = this.developments.get(run.id) || [];
    const pending = developments.filter((d) => !d.settled);
    if (pending.length)
      return `图片仍在生成：${pending.map((d) => d.id).join(", ")}。用 view_canvas 等它们显影后再看一次`;
    try {
      requireObserved(work, run.observations);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    const looked = Math.max(
      ...run.observations
        .filter((o) => o.revision === work.revision)
        .map((o) => o.at),
    );
    const unseen = developments.filter(
      (d) => work.materials[d.id] && d.settled!.at > looked,
    );
    if (unseen.length)
      return `图片 ${unseen.map((d) => d.id).join(", ")} 在最后一次查看之后才显影，请再看一次画布`;
    // Text too small to read holds the end once: some of it, such as the names a map
    // draws, is not the author's to change, and it can say so and end.
    if (this.heldForText.has(run.id)) return undefined;
    const small = Object.values(work.scenes).flatMap((scene) => {
      const px = run.observations
        .filter((o) => o.revision === work.revision && o.overview && o.smallestText?.[scene.id] !== undefined)
        .at(-1)?.smallestText?.[scene.id];
      return px !== undefined && px < MIN_TEXT ? [`${scene.id} ${px}px`] : [];
    });
    if (!small.length) return undefined;
    this.heldForText.add(run.id);
    return `最小的字小于 ${MIN_TEXT} 像素（${small.join("，")}），读者看不清：放大或删减这些字再看一次；如果这些字不由你决定（比如地图自带的地名），说明原因后结束`;
  }
  /** Runs one tool call. `done` ends this execution: the run finished or waits for the user. */
  private async call(
    store: UserStore,
    run: Run,
    ctx: Context,
    call: Item,
    batch: Item[],
    abort: AbortController,
    start: number,
    writeError?: string,
  ): Promise<{
    done: boolean;
    output: unknown;
    images: Item[];
    error?: string;
  }> {
    let output: unknown;
    let images: Item[] = [];
    // A call that streamed already has its step, which has to end however the call does.
    let step = run.steps.find(
      (s): s is ToolStep => s.kind === "tool" && s.id === call.call_id,
    );
    try {
      const args = parsedArguments(run, call);
      if (!silent.has(call.name)) {
        if (step) Object.assign(step, activity(call.name, args, run.sceneId));
        else {
          step = {
            kind: "tool",
            id: call.call_id,
            status: "running",
            ...activity(call.name, args, run.sceneId),
          };
          run.steps.push(step);
        }
        this.emit(store, run);
      }
      if (call.name === "ask_user" && batch.length !== 1)
        throw Error(`${call.name} must be the only tool call`);
      if (call.name === "view_canvas") {
        if (
          batch.length !== 1 &&
          !(
            batch.at(-1) === call &&
            batch.slice(0, -1).every((c) => c.name === "write_work")
          )
        )
          throw Error("view_canvas must be called alone or after write_work calls");
        if (writeError)
          throw Error(`view_canvas was skipped because write_work failed: ${writeError}`);
      }
      switch (call.name) {
        case "web_search":
        case "open_page": {
          const service = ctx.settings.search.service;
          if (!service) throw Error("This request has no search service.");
          // The call is already among the steps; the budget is what was left before it.
          const left = searchesLeft({
            ...run,
            steps: run.steps.filter((s) => s !== step),
          });
          if (!left) {
            run.steps.splice(run.steps.indexOf(step!), 1);
            step = undefined;
            this.emit(store, run);
            return {
              done: false,
              output: {
                error:
                  "Web search is closed for the rest of this request. Work from what you already found, and leave out what stays unconfirmed.",
              },
              images: [],
            };
          }
          if (call.name === "web_search") {
            const asked = searchSchema.parse(args).queries;
            // Past what is left, the later queries are not asked.
            const queries = asked.slice(0, left);
            const skipped = asked.slice(left);
            if (skipped.length && step?.kind === "tool" && step.name === "web_search") {
              step.queries = queries;
              this.emit(store, run);
            }
            counted(run, "search", queries.length);
            const results = await Promise.all(
              queries.map(async (query) => {
                try {
                  return { query, results: await searchWeb(service, query, abort.signal) };
                } catch (e) {
                  abort.signal.throwIfAborted();
                  return { query, error: e instanceof Error ? e.message : String(e) };
                }
              }),
            );
            if (results.every((r) => "error" in r))
              throw Error((results[0] as { error: string }).error);
            output = {
              results,
              ...(skipped.length
                ? {
                    notAsked: skipped,
                    note: "These queries were not asked: the request's search budget ran out. Work from what you found, and leave out what stays unconfirmed.",
                  }
                : {}),
            };
          } else {
            counted(run, "open_page");
            const { url } = openSchema.parse(args);
            output = { url, text: await readPage(service, url, abort.signal) };
          }
          break;
        }
        case "draw_guide": {
          output = readGuides(guideSchema.parse(args), await kit(), guidesRead(ctx.input));
          break;
        }
        case "read_work": {
          const work = store.work(run.workId);
          output = forAuthor(work);
          ctx.known = work.revision;
          Object.assign(step!, { revision: work.revision });
          break;
        }
        case "ask_user": {
          run.questions = await questions(store, args);
          run.status = "waiting";
          run.steps.push({
            kind: "message",
            role: "assistant",
            asked: true,
            text: run.questions
              .map(
                (q) =>
                  q.text +
                  "\n" +
                  q.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n"),
              )
              .join("\n\n"),
          });
          ctx.input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: "Questions shown. Waiting for the user.",
          });
          store.context(run.id, ctx);
          this.emit(store, run);
          return { done: true, output: null, images: [] };
        }
        case "set_brief": {
          // The ideas weighed stay on the step; the work keeps the brief.
          const { ideas: _, ...brief } = settleSchema.parse(args);
          const { work, style } = await setBrief(
            store,
            run.workId,
            brief,
            said(store, run.workId, ctx.settings.preferences),
            causeOf(run),
          );
          ctx.known = work.revision;
          this.publish(store.userId, { type: "work", work });
          const effects = await library.get(style.effects, store.userId, true);
          const cast = work.brief!.cast.length
            ? await find(
                {
                  subjects: work.brief!.cast,
                  style: style.id,
                  kinds: ["picture"],
                },
                store.userId,
              )
            : undefined;
          output = {
            revision: work.revision,
            style: {
              id: style.id,
              name: style.name.zh,
              register: style.register,
              tokens: style.tokens,
              guide: style.guide,
              effects: effects.map((e) => ({ id: e.id, about: e.about })),
            },
            ...(cast ? { cast: cast.output } : {}),
            ...(research(run) ? { research: research(run) } : {}),
            ...(guidesRead(ctx.input, batch).topics.size
              ? {}
              : { guides: "Read what this work needs with draw_guide before drawing: see # Guides." }),
          };
          images = cast?.images ?? [];
          Object.assign(step!, {
            revision: work.revision,
            ...(cast ? { found: cast.found } : {}),
          });
          break;
        }
        case "find_materials": {
          const request = findSchema.parse(args);
          const style = store.work(run.workId).brief?.style;
          const found = await find(
            { ...request, style: request.style ?? style, limit: 5 },
            store.userId,
          );
          output = found.output;
          images = found.images;
          Object.assign(step!, { found: found.found });
          break;
        }
        case "generate_images": {
          const { images: requests } = generateSchema.parse(args);
          const made = await develop(store, ctx.settings.image, store.work(run.workId), requests);
          const list = this.developments.get(run.id) || [];
          list.push(...made);
          this.developments.set(run.id, list);
          const shown: Picture[] = made.map((d) => ({
            id: d.id,
            name: d.name,
            url: `/materials/files/${d.id}`,
            status: "developing",
          }));
          Object.assign(step!, { images: shown });
          for (const [i, d] of made.entries())
            void d.done.then(async (r) => {
              shown[i].status = r.status;
              if (r.count) {
                const u = usageOf(run);
                const images = (u.images ??= { count: 0, input: 0, output: 0 });
                const t = imageTokensOf(r.usage);
                images.count += r.count;
                images.input += t.input;
                images.output += t.output;
                images.textInput = (images.textInput ?? 0) + t.textInput;
                images.imageInput = (images.imageInput ?? 0) + t.imageInput;
                images.textOutput = (images.textOutput ?? 0) + t.textOutput;
              }
              if (r.status === "failed") failedOf(run).images++;
              this.emit(store, run);
              // An open canvas redraws the picture with its measured content.
              const work = store.works().find((w) => w.id === run.workId);
              if (r.status === "ready" && work?.materials[d.id])
                this.publish(store.userId, {
                  type: "work",
                  work: await freshen(work, store.viewer),
                });
            });
          output = {
            developing: made.map((d, i) => ({
              id: d.id,
              name: d.name,
              aspect: requests[i].aspect ?? "square",
            })),
            note: "Use these ids now. view_canvas waits for them; each is shown to you when it arrives.",
          };
          break;
        }
        case "write_work": {
          const { amend, ...written } = args;
          if (amend && !ctx.held)
            throw new DomainError("没有等待修正的写入：amend 只用在一次写入被拒绝之后；这次把要改的内容直接写出来");
          // A correction lays over the write it corrects, and the two save as one revision.
          const edit = amend ? composed(ctx.held, written) : written;
          ctx.held = edit;
          const { work, added, keptTitle, absent } = await writeWork(store, run.workId, edit, {
            cause: causeOf(run),
            scene: run.sceneId,
          });
          ctx.held = undefined;
          ctx.known = work.revision;
          run.firstSceneMs ??= Date.now() - start;
          this.publish(store.userId, { type: "work", work });
          output = {
            revision: work.revision,
            ...(added.length ? { materialsAdded: added } : {}),
            ...(keptTitle
              ? { title: `Kept the user's title "${work.title}".` }
              : {}),
            ...(absent.length
              ? { notThere: `Asked to remove what the work does not have: ${absent.join(", ")}.` }
              : {}),
            ...cardsUnread(work, ctx.input, batch),
          };
          Object.assign(step!, { revision: work.revision, materials: added, writing: undefined });
          break;
        }
        case "view_canvas": {
          const pending = (this.developments.get(run.id) || []).filter(
            (d) => !d.settled,
          );
          run.status = "viewing";
          if (pending.length)
            Object.assign(step!, { waiting: pending.map((d) => d.name) });
          this.emit(store, run);
          try {
            await Promise.race([
              Promise.all(pending.map((d) => d.done)),
              new Promise((_, reject) =>
                abort.signal.addEventListener("abort", () =>
                  reject(abort.signal.reason),
                ),
              ),
            ]);
            images.push(
              ...(await this.developed(store, run)).flatMap((m) => m.content),
            );
            // The service may be restarting; after a few tries the run stops instead of
            // spending the author's turns on a look it cannot get.
            let result: Awaited<ReturnType<typeof observe>> | undefined;
            for (const wait of [2000, 6000, 0]) {
              try {
                result = await observe(store, run.workId, args, abort.signal, {
                  observations: run.observations,
                  reported: (ctx.reported ??= {}),
                });
                break;
              } catch (e) {
                if (!(e instanceof Unavailable) || !wait) throw e;
                await new Promise((r) => setTimeout(r, wait));
              }
            }
            if (!result) throw new Unavailable("画布查看服务不可用");
            run.observations.push(result.observation);
            const searched = research(run);
            output = searched
              ? { ...result.observation, research: searched }
              : result.observation;
            images.push(...result.content);
            Object.assign(step!, {
              waiting: undefined,
              screenshots: pictures(result.observation.screenshots),
              errors: result.observation.errors,
            });
          } finally {
            run.status = "running";
          }
          break;
        }
        default:
          throw Error("Unknown tool " + call.name);
      }
      if (step) step.status = "done";
      return { done: false, output, images };
    } catch (e) {
      abort.signal.throwIfAborted();
      const error = e instanceof Error ? e.message : String(e);
      if (step) Object.assign(step, { status: "failed", error });
      if (e instanceof Unavailable) throw e;
      if (e instanceof BrokenWrite) {
        // Only the records that arrived whole carry over; whatever came after is the author's to send.
        const { amend, ...kept } = e.kept;
        ctx.held = amend && ctx.held ? composed(ctx.held, kept) : kept;
        return {
          done: false,
          output: { error, note: heldNote(ctx.held) },
          images: [],
          error,
        };
      }
      if (call.name === "write_work" && ctx.held && e instanceof DomainError) {
        const problems: Problem[] = e instanceof EditRejected ? e.problems : [{ at: "", problem: e.message }];
        return {
          done: false,
          output: { error: `${problems.length} problem${problems.length > 1 ? "s" : ""} in this write`, problems, note: heldNote(ctx.held) },
          images: [],
          error,
        };
      }
      return { done: false, output: { error }, images: [], error };
    }
  }
}
