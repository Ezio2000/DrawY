/* Google Gemini models through the Interactions API. The run keeps its conversation as
 * Responses items; this adapter translates them to stateless Interactions steps and maps
 * Interactions SSE events (`step.start`, `step.delta`, `step.stop`, `interaction.completed`)
 * back to the Responses items and events the loop reads. Every item produced here carries
 * its original step under `interactions`, so thought signatures and hosted tool signatures
 * round-trip unchanged on subsequent turns. */
import { effortFor, pinnedProvider, speedFor, type Effort, type Role, type Speed } from "../contracts/index.ts";
import { events, readable, streamError } from "./http.ts";
import { textOf } from "./text.ts";
import { CutOff, type Adapter, type Answer, type Item, type Request } from "./types.ts";

type Step = Record<string, any>;
type Content = Record<string, any>;

/** The `service_tier` each speed asks for in the Interactions API. */
export const serviceTiers: Record<Speed, string> = {
  flex: "flex",
  default: "standard",
  fast: "priority",
  ultrafast: "priority",
};
const tierOf = (role: Role) => serviceTiers[speedFor(role.channel, role.speed)];

/** Maps DrawY efforts to Gemini `thinking_level` (`low` | `medium` | `high`). */
const thinkingLevel = (effort?: Effort): string | undefined =>
  effort === "xhigh" || effort === "max" ? "high" : effort;

/** Resolves the Interactions endpoint from a configured Google/proxy baseUrl. */
export const endpointOf = (baseUrl: string) => {
  const base = baseUrl.replace(/\/$/, "");
  return /\/v1(?:beta|alpha)?$/.test(base) ? `${base}/interactions` : `${base}/v1beta/interactions`;
};

const imageContent = (url: string): Content => {
  const data = /^data:(image\/[a-z0-9+.-]+);base64,(.*)$/is.exec(url);
  return data
    ? { type: "image", mime_type: data[1], data: data[2] }
    : { type: "image", uri: url };
};

const userContent = (value: unknown): Content[] =>
  typeof value === "string"
    ? value
      ? [{ type: "text", text: value }]
      : []
    : Array.isArray(value)
      ? value.flatMap((c: Item): Content[] =>
          (c.type === "input_text" || c.type === "output_text" || c.type === "text") && c.text
            ? [{ type: "text", text: c.text }]
            : c.type === "input_image" && c.image_url
              ? [imageContent(c.image_url)]
              : [],
        )
      : [];

/** Parses JSON arguments for FunctionCallStep, keeping an empty object when malformed so the
 * run's own validation still receives the raw malformed arguments string from `item.arguments`. */
const parsedObject = (json: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/** Converts Responses conversation items into Interactions API stateless `Step[]`.
 * Gemini requires the original `thought` step (with `signature`) before `function_call` steps
 * from Gemini turns; calls from other providers without `interactions` metadata are rendered
 * as readable text so switching models mid-work never hits an invalid-argument rejection. */
export function toSteps(input: Item[], withTools: boolean): Step[] {
  const steps: Step[] = [];
  let open = 0;
  const later: Step[] = [];
  const push = (step: Step) => {
    const last = steps.at(-1);
    if (step.type === "user_input" && last?.type === "user_input") {
      last.content = [...(last.content ?? []), ...(step.content ?? [])];
    } else if (step.type === "model_output" && last?.type === "model_output" && !last.preserved && !step.preserved) {
      last.content = [...(last.content ?? []), ...(step.content ?? [])];
    } else {
      steps.push(step);
    }
  };
  const defer = (step: Step) => (open > 0 ? later.push(step) : push(step));
  const settle = () => {
    if (open <= 0) for (const s of later.splice(0)) push(s);
  };
  const names = new Map<string, string>();
  const structured = new Set<string>();
  const rawSteps = (item: Item): Step[] | undefined =>
    item.interactions
      ? Array.isArray(item.interactions)
        ? item.interactions
        : [item.interactions]
      : undefined;

  for (const item of input) {
    const raw = rawSteps(item);
    if (item.type === "configuration_update") continue;
    if (item.type === "reasoning") {
      if (raw && withTools) for (const s of raw) push(s);
      continue;
    }
    if (typeof item.type === "string" && item.type.endsWith("_call") && item.type !== "function_call") {
      if (raw && withTools) for (const s of raw) push(s);
      continue;
    }
    if (item.type === "function_call") {
      names.set(item.call_id, item.name);
      if (withTools && raw) {
        structured.add(item.call_id);
        for (const s of raw) push(s);
        open++;
      } else {
        push({ type: "model_output", content: [{ type: "text", text: `[Called ${item.name}: ${item.arguments || "{}"}]` }] });
      }
      continue;
    }
    if (item.type === "function_call_output") {
      const output = typeof item.output === "string" ? item.output : JSON.stringify(item.output);
      if (withTools && structured.has(item.call_id)) {
        push({
          type: "function_result",
          call_id: item.call_id,
          ...(names.has(item.call_id) ? { name: names.get(item.call_id) } : {}),
          result: [{ type: "text", text: output }],
        });
        open = Math.max(0, open - 1);
        settle();
      } else {
        defer({
          type: "user_input",
          content: [{ type: "text", text: `[Result of ${names.get(item.call_id) ?? "the call"}: ${output}]` }],
        });
      }
      continue;
    }
    if (item.role === "assistant") {
      if (raw && withTools) {
        for (const s of raw) steps.push(s);
      } else {
        const text =
          textOf([{ type: "message", content: item.content }]) ||
          (typeof item.content === "string" ? item.content : "");
        if (text) push({ type: "model_output", content: [{ type: "text", text }] });
      }
      continue;
    }
    if (item.role === "user" || item.role === "system" || item.role === "developer") {
      const content = userContent(item.content);
      if (content.length) defer({ type: "user_input", content });
    }
  }
  open = 0;
  settle();
  return steps;
}

/** How many times a schema that refers to itself is written out in place. */
const INLINED = 2;
/** `schema` without `$defs` and `$ref`, which the Interactions API refuses as a syntax error
 * in the request body: each reference is written out in place, `INLINED` levels deep, and
 * below that is any object of the same shape. A drawing's data fields nest fields, so the
 * schema of `write_work` refers to itself. */
export function inlinedSchema(schema: Item): Item {
  const defs: Item = schema.$defs ?? {};
  const inline = (value: unknown, depth: number): unknown => {
    if (Array.isArray(value)) return value.map((v) => inline(v, depth));
    if (!value || typeof value !== "object") return value;
    const node = value as Item;
    if (typeof node.$ref === "string") {
      const def = defs[node.$ref.replace(/^#\/\$defs\//, "")];
      return def && depth > 0
        ? inline(def, depth - 1)
        : { type: "object", description: "The same shape as the schema it is inside" };
    }
    return Object.fromEntries(Object.entries(node).flatMap(([k, v]) => (k === "$defs" ? [] : [[k, inline(v, depth)]])));
  };
  return inline(schema, INLINED) as Item;
}

/** Converts DrawY function/search tools into Interactions API tool declarations. */
export function interactionsTools(tools: Item[]): Item[] {
  return tools.flatMap((t): Item[] =>
    t.type === "function"
      ? [{ type: "function", name: t.name, description: t.description, parameters: inlinedSchema(t.parameters ?? {}) }]
      : t.type === "web_search"
        ? [{ type: "google_search" }]
        : [],
  );
}

/** Converts Interactions API usage metadata to DrawY's Responses-compatible usage shape.
 * In Interactions API, `total_thought_tokens` is reported separately from `total_output_tokens`,
 * whereas DrawY bills thinking tokens inside `output_tokens`. */
export function toUsage(u?: Item): Item {
  if (!u) return {};
  const reasoning = u.total_thought_tokens ?? 0;
  return {
    input_tokens: u.total_input_tokens ?? 0,
    input_tokens_details: {
      cached_tokens: u.total_cached_tokens ?? 0,
    },
    output_tokens: (u.total_output_tokens ?? 0) + reasoning,
    output_tokens_details: {
      reasoning_tokens: reasoning,
    },
  };
}

/** Converts a hosted call/result step pair (e.g. google_search_call + google_search_result)
 * into a Responses-style hosted call item for LiveSteps and traces. */
function hostedItem(call: Step, result?: Step): Item {
  const isSearch = call.type === "google_search_call";
  const queries = Array.isArray(call.arguments?.queries) ? call.arguments.queries : [];
  const type = isSearch ? "web_search_call" : call.type;
  return {
    type,
    id: call.id,
    status: !result ? "in_progress" : result.is_error ? "failed" : "completed",
    ...(isSearch
      ? {
          action: {
            type: "search",
            queries,
            query: queries[0] ?? "",
            sources: [],
          },
        }
      : { action: call.arguments ?? {} }),
  };
}

interface ActiveStep {
  index: number;
  type: string;
  step: Step;
  // thought
  summaryText: string;
  summaryAdded: boolean;
  // model_output
  text: string;
  annotations: Item[];
  // function_call
  itemId: string;
  callId: string;
  name: string;
  argumentsText: string;
  initialArgs?: Record<string, unknown>;
}

/** Maps UTF-8 byte offsets (used by Interactions `url_citation`) to JS UTF-16 code unit indices. */
export function utf16Offsets(text: string): number[] {
  const map: number[] = [0];
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const step = cp > 0xffff ? 2 : 1;
    const byteLen = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    for (let b = 1; b < byteLen; b++) map[bytes + b] = i;
    bytes += byteLen;
    i += step;
    map[bytes] = i;
  }
  return map;
}

const MAX_CONTINUATIONS = 6;

async function generate(
  role: Role,
  { instructions, input, tools, signal, onEvent, budget, steer, effort }: Request,
): Promise<Answer> {
  const level = thinkingLevel(effortFor(effort ?? role.effort, role.efforts));
  const declared = interactionsTools(tools);
  const steps = toSteps(input, declared.length > 0);
  const tier = tierOf(role);
  const turn = crypto.randomUUID().slice(0, 8);
  const items: Item[] = [];
  const accumulated = { input: 0, cached: 0, output: 0, reasoning: 0 };
  let currentUsage: Item = {};
  const sofar = (): Item => {
    const inputTokens = accumulated.input + (currentUsage.input_tokens ?? 0);
    const cachedTokens = accumulated.cached + (currentUsage.input_tokens_details?.cached_tokens ?? 0);
    const outputTokens = accumulated.output + (currentUsage.output_tokens ?? 0);
    const reasoningTokens =
      accumulated.reasoning + (currentUsage.output_tokens_details?.reasoning_tokens ?? 0);
    return {
      input_tokens: inputTokens,
      input_tokens_details: { cached_tokens: cachedTokens },
      output_tokens: outputTokens,
      output_tokens_details: { reasoning_tokens: reasoningTokens },
    };
  };

  let sawThought = false;
  let wrote = false;
  let said = false;
  let id = "";
  let model = role.model;
  let continuationToken: string | undefined;

  const textFromContents = (parts: unknown) =>
    Array.isArray(parts)
      ? parts
          .filter((p: Item) => p?.type === "text" && typeof p.text === "string")
          .map((p: Item) => p.text)
          .join("")
      : "";

  for (let hop = 0; hop < MAX_CONTINUATIONS; hop++) {
    const r = await fetch(endpointOf(role.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "x-goog-api-key": role.credential,
      },
      body: JSON.stringify({
        model: role.model,
        ...pinnedProvider(role),
        ...(instructions ? { system_instruction: instructions } : {}),
        input: steps,
        ...(continuationToken ? { continuation_token: continuationToken } : {}),
        ...(declared.length ? { tools: declared } : {}),
        generation_config: {
          max_output_tokens: budget,
          thinking_summaries: "auto",
          ...(level ? { thinking_level: level } : {}),
          ...steer,
        },
        ...(tier !== "standard" ? { service_tier: tier } : {}),
        store: false,
        stream: true,
      }),
      signal,
    });
    if (!r.ok) throw Error(`模型请求 ${r.status}: ${readable(await r.text())}`);

    const msgId = `msg_${turn}_${hop}`;
    const active = new Map<number, ActiveStep>();
    const pendingHosted = new Map<string, Step>();
    let complete = false;
    let status: string | undefined;
    let nextToken: string | undefined;
    currentUsage = {};

    const ensureMessageStarted = () => {
      if (said) return;
      said = true;
      onEvent({ type: "response.output_item.added", item: { type: "message", id: msgId, role: "assistant" } });
    };
    const ensureThoughtStarted = (s: ActiveStep) => {
      if (s.summaryAdded) return;
      s.summaryAdded = true;
      onEvent({ type: "response.reasoning_summary_part.added" });
    };

    for await (const e of events(r)) {
      const kind = e.event_type ?? e.type;
      if (kind === "error") throw streamError(e.error ?? e);
      if (kind === "interaction.created") {
        id = e.interaction?.id ?? id;
        model = e.interaction?.model ?? model;
      } else if (kind === "interaction.status_update") {
        if (e.usage) {
          currentUsage = toUsage(e.usage);
          onEvent({ type: "response.usage", usage: sofar() });
        }
      } else if (kind === "step.start") {
        const step = { ...(e.step ?? {}) };
        const index = e.index ?? 0;
        const type = String(step.type ?? "");
        const s: ActiveStep = {
          index,
          type,
          step,
          summaryText: "",
          summaryAdded: false,
          text: "",
          annotations: [],
          itemId: `fc_${turn}_${hop}_${index}`,
          callId: step.id ?? `call_${turn}_${hop}_${index}`,
          name: step.name ?? "",
          argumentsText: typeof step.arguments === "string" ? step.arguments : "",
          initialArgs:
            step.arguments && typeof step.arguments === "object" && Object.keys(step.arguments).length
              ? step.arguments
              : undefined,
        };
        active.set(index, s);
        if (type === "thought") {
          sawThought = true;
          const init = textFromContents(step.summary);
          if (init) {
            ensureThoughtStarted(s);
            s.summaryText += init;
            onEvent({ type: "response.reasoning_summary_text.delta", delta: init });
          }
        } else if (type === "model_output") {
          wrote = true;
          const init = textFromContents(step.content);
          if (Array.isArray(step.content)) {
            for (const p of step.content) if (Array.isArray(p?.annotations)) s.annotations.push(...p.annotations);
          }
          if (init) {
            ensureMessageStarted();
            s.text += init;
            onEvent({ type: "response.output_text.delta", item_id: msgId, delta: init });
          }
        } else if (type === "function_call") {
          wrote = true;
          onEvent({
            type: "response.output_item.added",
            item: { type: "function_call", id: s.itemId, call_id: s.callId, name: s.name, arguments: "" },
          });
          if (s.argumentsText)
            onEvent({ type: "response.function_call_arguments.delta", item_id: s.itemId, delta: s.argumentsText });
        } else if (type.endsWith("_call")) {
          wrote = true;
          onEvent({ type: "response.output_item.added", item: hostedItem(step) });
        }
      } else if (kind === "step.delta") {
        if (e.metadata?.total_usage) {
          currentUsage = toUsage(e.metadata.total_usage);
          onEvent({ type: "response.usage", usage: sofar() });
        }
        const s = active.get(e.index ?? 0);
        const d = e.delta ?? {};
        if (!s) continue;
        if (d.type === "thought_signature" && typeof d.signature === "string") {
          s.step.signature = (s.step.signature ?? "") + d.signature;
        } else if (d.type === "thought_summary") {
          const text = d.content?.type === "text" ? d.content.text : typeof d.text === "string" ? d.text : "";
          if (text) {
            ensureThoughtStarted(s);
            s.summaryText += text;
            onEvent({ type: "response.reasoning_summary_text.delta", delta: text });
          }
        } else if (d.type === "text" && typeof d.text === "string" && d.text) {
          ensureMessageStarted();
          s.text += d.text;
          onEvent({ type: "response.output_text.delta", item_id: msgId, delta: d.text });
        } else if (d.type === "text_annotation_delta" && Array.isArray(d.annotations)) {
          s.annotations.push(...d.annotations);
        } else if (d.type === "arguments_delta" && typeof d.arguments === "string" && d.arguments) {
          s.argumentsText += d.arguments;
          onEvent({ type: "response.function_call_arguments.delta", item_id: s.itemId, delta: d.arguments });
        } else if (s.type.endsWith("_call") || s.type.endsWith("_result")) {
          if (typeof d.signature === "string") s.step.signature = (s.step.signature ?? "") + d.signature;
          if (d.arguments !== undefined) s.step.arguments = d.arguments;
          if (d.result !== undefined) s.step.result = d.result;
          if (typeof d.is_error === "boolean") s.step.is_error = d.is_error;
        }
      } else if (kind === "step.stop") {
        if (e.step_usage) {
          currentUsage = toUsage(e.step_usage);
          onEvent({ type: "response.usage", usage: sofar() });
        }
        const s = active.get(e.index ?? 0);
        if (!s) continue;
        active.delete(e.index ?? 0);
        if (s.type === "thought") {
          if (s.summaryAdded) onEvent({ type: "response.reasoning_summary_text.done", text: s.summaryText });
          const rawStep: Step = {
            type: "thought",
            ...(s.step.signature ? { signature: s.step.signature } : {}),
            ...(s.summaryText ? { summary: [{ type: "text", text: s.summaryText }] } : {}),
          };
          items.push({
            type: "reasoning",
            summary: s.summaryText ? [{ type: "summary_text", text: s.summaryText }] : [],
            interactions: rawStep,
          });
        } else if (s.type === "model_output") {
          if (s.text || s.annotations.length) {
            const offsets = utf16Offsets(s.text);
            const clampByte = (b: number) =>
              offsets[Math.max(0, Math.min(b, offsets.length - 1))] ?? s.text.length;
            const urlCitations = s.annotations.filter((a) => a?.type === "url_citation" && a.url);
            const rawAnnotations = urlCitations.map((a) => ({
              type: "url_citation",
              start_index: a.start_index ?? 0,
              end_index: a.end_index ?? offsets.length - 1,
              url: a.url,
              title: a.title ?? a.url,
            }));
            const annotations = urlCitations.map((a) => ({
              type: "url_citation",
              start_index: clampByte(a.start_index ?? 0),
              end_index: clampByte(a.end_index ?? offsets.length - 1),
              url: a.url,
              title: a.title ?? a.url,
            }));
            const rawStep: Step = {
              type: "model_output",
              content: [{ type: "text", text: s.text, ...(rawAnnotations.length ? { annotations: rawAnnotations } : {}) }],
            };
            const msgItem: Item = {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: s.text, annotations }],
              interactions: rawStep,
            };
            items.push(msgItem);
            onEvent({ type: "response.output_item.done", item: { ...msgItem, id: msgId } });
          }
        } else if (s.type === "function_call") {
          const rawArgsText = s.argumentsText || (s.initialArgs ? JSON.stringify(s.initialArgs) : "{}");
          const argsObj = s.argumentsText ? parsedObject(s.argumentsText) : (s.initialArgs ?? {});
          const rawStep: Step = {
            type: "function_call",
            id: s.callId,
            name: s.name,
            arguments: argsObj,
          };
          const fcItem: Item = {
            type: "function_call",
            call_id: s.callId,
            name: s.name,
            arguments: rawArgsText,
            interactions: rawStep,
          };
          items.push(fcItem);
          onEvent({ type: "response.output_item.done", item: { ...fcItem, id: s.itemId } });
        } else if (s.type.endsWith("_call")) {
          pendingHosted.set(s.step.id, s.step);
        } else if (s.type.endsWith("_result")) {
          const call = pendingHosted.get(s.step.call_id);
          if (call) {
            pendingHosted.delete(s.step.call_id);
            const hosted = hostedItem(call, s.step);
            items.push({ ...hosted, interactions: [call, s.step] });
            onEvent({ type: "response.output_item.done", item: hosted });
          }
        }
      } else if (kind === "interaction.completed") {
        complete = true;
        const inter = e.interaction ?? {};
        id = inter.id ?? id;
        model = inter.model ?? model;
        status = inter.status;
        nextToken = inter.continuation_token;
        if (inter.usage) {
          currentUsage = toUsage(inter.usage);
          onEvent({ type: "response.usage", usage: sofar() });
        }
        if (status === "failed" || status === "cancelled") {
          throw streamError(inter.error ?? { message: `模型服务中止了这一轮的输出：${status}` });
        }
      }
    }

    for (const call of pendingHosted.values()) {
      const hosted = hostedItem(call);
      items.push({ ...hosted, interactions: [call] });
      onEvent({ type: "response.output_item.done", item: hosted });
    }
    if (!complete) throw Error("模型连接在完成前中断");

    accumulated.input += currentUsage.input_tokens ?? 0;
    accumulated.cached += currentUsage.input_tokens_details?.cached_tokens ?? 0;
    accumulated.output += currentUsage.output_tokens ?? 0;
    accumulated.reasoning += currentUsage.output_tokens_details?.reasoning_tokens ?? 0;
    currentUsage = {};

    if (status === "incomplete") {
      const total = sofar();
      throw new CutOff(
        "max_output_tokens",
        !wrote && (sawThought || (total.output_tokens_details?.reasoning_tokens ?? 0) > 0),
        total,
      );
    }
    if (status === "requires_continuation") {
      if (nextToken && hop + 1 < MAX_CONTINUATIONS) {
        continuationToken = nextToken;
        continue;
      }
      const total = sofar();
      throw new CutOff(
        "max_output_tokens",
        !wrote && (sawThought || (total.output_tokens_details?.reasoning_tokens ?? 0) > 0),
        total,
      );
    }
    return {
      items,
      usage: sofar(),
      response: { id, model, status: "completed", protocol: "interactions", service_tier: tier },
    };
  }

  throw Error("模型连接在完成前中断");
}

export const interactions: Adapter = {
  generate,
  effortControl: () => "request",
  narrow(tools, left, isSearch, role) {
    if (!role.toolLimits || left > 0) return {};
    return {
      tool_choice: {
        allowed_tools: {
          mode: "validated",
          tools: tools.filter((t) => t.type === "function" && !isSearch(t)).map((t) => t.name),
        },
      },
    };
  },
  describe: (role) => ({ serviceTier: tierOf(role) }),
};
