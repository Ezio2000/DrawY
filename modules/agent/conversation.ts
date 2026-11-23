import {
  effortFor,
  lowestEffort,
  type Effort,
  type Role,
  type Run,
  type Settings,
  type Work,
} from "../contracts/index.ts";
import { changesBetween } from "../editing/index.ts";
import { attached } from "../materials/index.ts";
import { adapterFor, generate, textOf, type Item } from "../models/index.ts";
import type { Reported } from "../observation/index.ts";
import type { UserStore } from "../storage/index.ts";
import { tracer } from "../trace/index.ts";
import { forAuthor, shortLink, shortModule } from "../workspace/index.ts";
import { spend, spendFailed } from "./spending.ts";

/** The author's conversation on a work: how a request or an answer opens it, how it
 * catches up with what the user changed themselves, how big it is, how it is summarized,
 * and the effort it is asked at. It is saved with each run and continued by the next. */

/** What this code reads a saved conversation as. A conversation from before the current
 * work format is not continued: its tool calls and guides describe another format. */
export const CONTEXT_FORMAT = 3;
export interface Context {
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
  /** The request-level effort this conversation opened at, for models that change effort
   * inside the conversation: keeping it pinned across runs lets effort switches ride on
   * configuration_update without restarting the cached prefix. */
  baseEffort?: Effort;
  /** A write that was refused, as it stands, waiting for `amend`. */
  held?: Record<string, unknown>;
  format?: number;
}
/** The user's standing preferences as the author is told them: in the conversation rather
 * than the instructions, so the instructions stay the same for everyone and are cached once. */
export const preferencesOf = (settings: Settings) => settings.preferences.trim() || "none";
export const preferencesMessage = (preferences: string): Item => ({
  role: "user",
  content: `User preferences: ${preferences}`,
});
export async function userMessage(
  store: UserStore,
  text: string,
  materials: string[],
): Promise<Item> {
  const parts = [
    ...(text.trim() ? [{ type: "input_text" as const, text }] : []),
    ...(await attached(materials, store.viewer)),
  ];
  return {
    role: "user",
    content: parts.length ? parts : [{ type: "input_text", text }],
  };
}
export const workMessage = (sceneId: string, work: Work, changes = ""): Item => ({
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
export function catchUp(
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
export function contextSize(ctx: Context): number {
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
export async function compact(
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
      const result = await generate(inConversation ? requestRole(ctx) : { ...author, effort: "low" }, {
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
      store.saveContext(run.id, ctx);
      span.set({ error: String(e), replaced: false });
      return;
    }
    const references = [...new Set(userMessages(store, run.workId).flatMap((s) => s.materials || []))];
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
    ctx.baseEffort = initialEffort(author);
    store.saveContext(run.id, ctx);
    // The next turn starts from this summary alone.
    span.set({ summary, replaced: true });
  });
}
const initialEffort = (role: Role): Effort | undefined =>
  adapterFor(role.protocol).effortControl(role) === "conversation"
    ? (effortFor(role.effort, role.efforts) ?? role.effort)
    : undefined;
/** The role passed to the model adapter: for models whose effort changes inside the
 * conversation, keep the top-level request pinned to `ctx.baseEffort` so switching effort
 * across runs never invalidates the cached prefix. */
export function requestRole(ctx: Context): Role {
  const author = ctx.settings.author;
  if (adapterFor(author.protocol).effortControl(author) !== "conversation") return author;
  const base = ctx.baseEffort && (effortFor(ctx.baseEffort, author.efforts) ?? ctx.baseEffort);
  return base && base !== (effortFor(author.effort, author.efforts) ?? author.effort)
    ? { ...author, effort: base }
    : author;
}
/** Every turn thinks at the configured effort. A configuration_update lasts until the next
 * one, so where the format changes effort in the conversation, one left by an earlier turn
 * (see `withLessThought`) or run — or a cross-run switch from `baseEffort` — is updated
 * inside the conversation before it carries over. */
export function holdEffort(input: Item[], role: Role, baseEffort?: Effort) {
  if (adapterFor(role.protocol).effortControl(role) !== "conversation") return;
  const target = effortFor(role.effort, role.efforts) ?? role.effort;
  const last = input.findLast((i) => i.type === "configuration_update")?.reasoning?.effort;
  const current = last ?? (baseEffort ? (effortFor(baseEffort, role.efforts) ?? baseEffort) : undefined);
  if (current && current !== target)
    input.push({ type: "configuration_update", reasoning: { effort: target } });
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
/** The user's messages on this work, oldest first. */
export const userMessages = (store: UserStore, workId: string) =>
  store
    .runs(workId)
    .flatMap((r) => r.steps.flatMap((s) => (s.kind === "message" && s.role === "user" ? [s] : [])));
/** Everything the user has said (or attached) about this work, for checking a brief's quotes. */
export const said = (store: UserStore, workId: string, preferences: string) => [
  preferences,
  ...userMessages(store, workId).flatMap((s) => [s.text, ...(s.materials ?? [])]),
];
/** Where a conversation starts when the one before it cannot be continued: what the user has
 * asked of this work so far. The whole work follows it. */
export function earlierRequests(store: UserStore, workId: string): Item[] {
  const asked = userMessages(store, workId).map((s) => s.text);
  return asked.length
    ? [{ role: "user", content: `Earlier requests on this work, oldest first:\n${asked.map((a) => `- ${a}`).join("\n")}` }]
    : [];
}
/** The conversation a new request goes on with: the one the work's last run left, unless it
 * is in an older format, then what the user asked before. Either way it is told the user's
 * preferences when they changed, the request, and the work as far as it does not hold it. */
export function opened(store: UserStore, sceneId: string, work: Work, settings: Settings, message: Item): Context {
  const previous = store.runs(work.id).at(-1);
  const saved = previous && (store.context(previous.id) as Context | null);
  const before = saved?.format === CONTEXT_FORMAT ? saved : undefined;
  const sameModel =
    before &&
    before.settings.author.protocol === settings.author.protocol &&
    before.settings.author.model === settings.author.model;
  const baseEffort =
    adapterFor(settings.author.protocol).effortControl(settings.author) === "conversation"
      ? sameModel
        ? (before.baseEffort ??
          effortFor(before.settings.author.effort, settings.author.efforts) ??
          before.settings.author.effort)
        : initialEffort(settings.author)
      : undefined;
  const ctx: Context = {
    settings,
    input: before ? before.input : earlierRequests(store, work.id),
    generations: 0,
    ...(before?.measured ? { measured: before.measured } : {}),
    ...(before?.reported ? { reported: before.reported } : {}),
    ...(baseEffort ? { baseEffort } : {}),
    known: work.revision,
    preferences: preferencesOf(settings),
    format: CONTEXT_FORMAT,
  };
  ctx.input.push(
    // Told again only when they changed since this conversation last heard them.
    ...(before?.preferences === ctx.preferences ? [] : [preferencesMessage(ctx.preferences!)]),
    message,
    catchUp(store, sceneId, work, before?.known),
  );
  return ctx;
}
/** A waiting run's conversation, to be answered: one saved in an older format starts over
 * from what the user asked, the question and the whole work. */
export function reopened(store: UserStore, run: Run, ctx: Context): Context {
  if (ctx.format === CONTEXT_FORMAT) return ctx;
  const work = store.work(run.workId);
  const asked = run.steps.findLast((s) => s.kind === "message" && s.asked);
  const baseEffort = initialEffort(ctx.settings.author);
  return {
    ...ctx,
    input: [
      ...earlierRequests(store, run.workId),
      ...(asked?.kind === "message"
        ? [{ role: "user", content: `You then asked the user:\n${asked.text}` }]
        : []),
      workMessage(run.sceneId, work),
    ],
    ...(baseEffort ? { baseEffort } : { baseEffort: undefined }),
    known: work.revision,
    measured: undefined,
    reported: undefined,
    format: CONTEXT_FORMAT,
  };
}
