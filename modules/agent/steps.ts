import {
  boundsOf,
  boxSchema,
  guideTopics,
  labelOf,
  type GuideTopic,
  type Run,
  type Sketch,
  type Step,
  type ToolActivity,
} from "../contracts/index.ts";
import type { Item } from "../models/index.ts";
import { tracer } from "../trace/index.ts";
import { partialJson } from "./partial.ts";
import { spendHosted } from "./spending.ts";

/** How a run's turns show as steps: what each tool call is doing as its arguments stream
 * in, the author's thinking and words, and the tools the provider runs itself. */

export type ToolStep = Extract<Step, { kind: "tool" }>;
/** Tools not shown as steps of their own. */
export const silent = new Set(["ask_user"]);
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
/** A box the author wrote, if enough of it has arrived to show. */
const boxed = (box: unknown) => {
  const parsed = boxSchema.safeParse(box);
  return parsed.success ? boundsOf(parsed.data) : undefined;
};
const records = (list: unknown): any[] =>
  Array.isArray(list) ? list.filter((r) => r?.id) : [];
/** What a tool call is doing, as far as its arguments have arrived. Parts a write does not
 * place in a scene belong to the current one. */
export function activity(name: string, args: any, sceneId: string): ToolActivity {
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
/** The steps a turn shows while it streams: the author's thinking and progress words take
 * their place as they arrive, a tool call shows what it is doing as far as its arguments
 * have come (at most every 250ms), and a hosted call is a step from its start to its end,
 * recorded under the turn like any tool call. */
export class LiveSteps {
  /** The author's words in this turn, so far. */
  said?: Extract<Step, { kind: "message" }>;
  /** When the first output of this turn arrived, from its start. */
  firstOutput?: number;
  private thinking?: Extract<Step, { kind: "thinking" }>;
  private drafts = new Map<string, { step: ToolStep; name: string; text: string }>();
  /** When each hosted call began, to time its record once it is done. */
  private began = new Map<string, number>();
  private flush?: ReturnType<typeof setTimeout>;
  private mark: number;
  private opened = Date.now();
  constructor(
    private run: Run,
    private emit: () => void,
    /** When the execution started, for the run's first output. */
    private start: number,
  ) {
    this.mark = run.steps.length;
  }
  private soon() {
    this.flush ??= setTimeout(() => {
      this.flush = undefined;
      for (const d of this.drafts.values())
        Object.assign(d.step, activity(d.name, partialJson(d.text) ?? {}, this.run.sceneId));
      this.emit();
    }, 250);
  }
  event(event: Item) {
    const run = this.run;
    if (event.type.endsWith(".delta")) {
      this.firstOutput ??= Date.now() - this.opened;
      if (run.firstOutputMs === undefined) {
        run.firstOutputMs = Date.now() - this.start;
        this.emit();
      }
    }
    switch (event.type) {
      case "response.reasoning_summary_part.added":
        this.thinking = { kind: "thinking", text: "" };
        run.steps.push(this.thinking);
        this.soon();
        break;
      case "response.reasoning_summary_text.delta":
        if (this.thinking) this.thinking.text += event.delta;
        this.soon();
        break;
      case "response.reasoning_summary_text.done":
        if (this.thinking) this.thinking.text = event.text;
        this.soon();
        break;
      case "response.output_text.delta":
        if (this.said) this.said.text += event.delta;
        this.soon();
        break;
      case "response.output_item.added": {
        const { type, name, call_id, id: item } = event.item;
        if (type === "message" && !this.said) {
          this.said = { kind: "message", role: "assistant", text: "" };
          run.steps.push(this.said);
        }
        if (hosted(event.item)) {
          this.began.set(item, Date.now());
          run.steps.push({ kind: "tool", id: item, status: "running", ...hostedActivity(event.item) });
          this.emit();
        }
        if (type === "function_call" && !silent.has(name)) {
          const step: ToolStep = {
            kind: "tool",
            id: call_id,
            status: "running",
            ...activity(name, {}, run.sceneId),
          };
          run.steps.push(step);
          this.drafts.set(item, { step, name, text: "" });
          this.emit();
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const draft = this.drafts.get(event.item_id);
        if (draft) {
          draft.text += event.delta;
          this.soon();
        }
        break;
      }
      case "response.output_item.done": {
        this.drafts.delete(event.item.id);
        if (!hosted(event.item)) break;
        const call = event.item,
          failed = call.status === "failed",
          tool = call.type.replace(/_call$/, "");
        const step = run.steps.find((s): s is ToolStep => s.kind === "tool" && s.id === call.id);
        if (step) Object.assign(step, hostedActivity(call), { status: failed ? "failed" : "done" });
        spendHosted(run, tool, call.action?.type);
        tracer.record(
          "tool",
          tool,
          { hosted: true, args: call.action ?? call.arguments ?? null, output: call },
          {
            startedAt: this.began.get(call.id) ?? Date.now(),
            ...(failed ? { error: `${tool} failed` } : {}),
          },
        );
        this.emit();
        break;
      }
    }
  }
  /** Takes back what a broken attempt had shown, before the turn is asked again. */
  rewind() {
    this.run.steps.splice(this.mark);
    this.thinking = this.said = undefined;
    this.firstOutput = undefined;
    this.drafts.clear();
  }
  close() {
    clearTimeout(this.flush);
    this.drafts.clear();
  }
}
