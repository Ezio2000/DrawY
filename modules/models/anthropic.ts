/* Claude models through the Anthropic Messages API. The run keeps its conversation as
 * Responses items; this file turns them into Messages requests and turns each streamed
 * answer back into the same events and items, so the loop does not need to know which
 * API it talked to. Every item it makes carries the content blocks Claude wrote under
 * `anthropic`, so the next request sends them back exactly as they came: thinking blocks
 * are checked against the conversation they were written in, and a changed byte drops them. */
import Anthropic from "@anthropic-ai/sdk";
import { effortFor, pinnedProvider, type Role } from "../contracts/index.ts";
import { CutOff, type Adapter, type Answer, type Item, type Request } from "./types.ts";
type Block = Record<string, any>;
type Message = { role: "user" | "assistant" | "system"; content: Block[]; output_config?: Item };

/** The family and version a Claude model ID names (`claude-sonnet-5-5` → sonnet 5.5),
 * also with dotted versions (`anthropic/claude-sonnet-5.5`), a provider prefix or a date suffix. */
export function claudeVersion(model: string): { family: string; version: number } | undefined {
  const m = /claude-([a-z]+)-(\d+)(?:[.-](\d{1,2})(?!\d))?/.exec(model);
  if (!m) return undefined;
  return { family: m[1], version: Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0) };
}
const at = (model: string, least: Record<string, number>) => {
  const v = claudeVersion(model);
  return !!v && v.family in least && v.version >= least[v.family];
};
/** Models that take an effort change as a message in the conversation, which leaves the
 * cached prefix alone; changing the request's own effort would restart the cache. */
export const perTurnEffort = (model: string) =>
  at(model, { opus: 5, sonnet: 5.5, haiku: 5.5, fable: 5.1, mythos: 5.1 });
/** Models whose thinking blocks are bound to the conversation that produced them. When the
 * run has to shorten its history, the blocks it invalidated are dropped instead of failing
 * the request. */
const boundThinking = (model: string) =>
  at(model, { opus: 5.5, sonnet: 5.5, haiku: 5.5, fable: 5.1, mythos: 5.1 });
/** The web search with dynamic filtering needs a 4.6 model or later. */
const searchTool = (model: string) =>
  at(model, { opus: 4.6, sonnet: 4.6, fable: 5, mythos: 5 })
    ? "web_search_20260209"
    : "web_search_20250305";
/** Searches one request may make; the run's own search budget is counted on top. */
const SEARCHES_PER_REQUEST = 8;

const imageBlock = (url: string): Block => {
  const data = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(url);
  return data
    ? { type: "image", source: { type: "base64", media_type: data[1], data: data[2] } }
    : { type: "image", source: { type: "url", url } };
};
const userBlocks = (content: unknown): Block[] =>
  typeof content === "string"
    ? content
      ? [{ type: "text", text: content }]
      : []
    : Array.isArray(content)
      ? content.flatMap((c: Item): Block[] =>
          (c.type === "input_text" || c.type === "output_text" || c.type === "text") && c.text
            ? [{ type: "text", text: c.text }]
            : c.type === "input_image" && c.image_url
              ? [imageBlock(c.image_url)]
              : [],
        )
      : [];
const textOfContent = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c: Item) => c?.text ?? "").join("")
      : "";
/** A tool call ID from another provider, in the characters Messages accepts. */
const callId = (id: string) => String(id).replace(/[^a-zA-Z0-9_-]/g, "_");

/** The conversation as Messages. Each model turn becomes one assistant message with its
 * blocks in order, and the results of its tool calls open the next user message. Anything
 * said while results are still owed (a screenshot after one of several calls) moves after
 * them, since the results must come first. Without tools, as when a summary is asked for,
 * the calls and results are told in words. Items only the Responses or Chat Completions
 * APIs read (their reasoning, their hosted calls) are left out. */
export function toAnthropic(input: Item[], withTools: boolean, model = ""): Message[] {
  const messages: Message[] = [];
  let open = 0;
  const later: (() => void)[] = [];
  const add = (role: Message["role"], blocks: Block[], extra: Partial<Message> = {}) => {
    if (role !== "system" && !blocks.length) return;
    const last = messages.at(-1);
    if (role !== "system" && last?.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks, ...extra });
  };
  const user = (blocks: Block[]) => (open > 0 ? later.push(() => add("user", blocks)) : add("user", blocks));
  const settle = () => {
    if (open <= 0) for (const f of later.splice(0)) f();
  };
  const names = new Map<string, string>();
  for (const item of input) {
    const raw: Block[] | undefined = item.anthropic
      ? Array.isArray(item.anthropic)
        ? item.anthropic
        : [item.anthropic]
      : undefined;
    if (item.type === "reasoning") {
      if (raw && withTools) add("assistant", raw);
      continue;
    }
    if (item.type === "configuration_update") {
      const effort = item.reasoning?.effort;
      if (effort && perTurnEffort(model)) {
        const change = () => add("system", [], { output_config: { effort } });
        if (open > 0) later.push(change);
        else change();
      }
      continue;
    }
    if (item.type === "function_call") {
      names.set(item.call_id, item.name);
      if (!withTools) {
        add("assistant", [{ type: "text", text: `[Called ${item.name}: ${item.arguments || "{}"}]` }]);
        continue;
      }
      let args: unknown = {};
      try {
        args = JSON.parse(item.arguments || "{}");
      } catch {}
      add("assistant", raw ?? [{ type: "tool_use", id: callId(item.call_id), name: item.name, input: args }]);
      open++;
      continue;
    }
    if (item.type === "function_call_output") {
      const output = typeof item.output === "string" ? item.output : JSON.stringify(item.output);
      if (!withTools) {
        add("user", [{ type: "text", text: `[Result of ${names.get(item.call_id) ?? "the call"}: ${output}]` }]);
        continue;
      }
      add("user", [{ type: "tool_result", tool_use_id: callId(item.call_id), content: output }]);
      open--;
      settle();
      continue;
    }
    if (typeof item.type === "string" && item.type.endsWith("_call")) {
      // A search Claude ran itself, with its results; another provider's hosted calls stay out.
      if (raw && withTools) add("assistant", raw);
      continue;
    }
    if (item.role === "assistant") {
      if (raw && withTools) add("assistant", raw);
      else {
        const text = textOfContent(item.content);
        if (text) add("assistant", [{ type: "text", text }]);
      }
      continue;
    }
    if (item.role === "user" || item.role === "system" || item.role === "developer") {
      user(userBlocks(item.content));
      continue;
    }
  }
  open = 0;
  settle();
  return messages;
}

/** Tools in Messages form: function tools stream their input as it is written, so the
 * canvas can sketch a work before its call is finished; the Responses web search becomes
 * Claude's own. */
export function anthropicTools(tools: Item[], model: string): Block[] {
  const out: Block[] = tools.flatMap((t): Block[] =>
    t.type === "function"
      ? [
          {
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
            eager_input_streaming: true,
          },
        ]
      : t.type === "web_search"
        ? [{ type: searchTool(model), name: "web_search", max_uses: SEARCHES_PER_REQUEST }]
        : [],
  );
  // The tools and the instructions are the same for all of a user's requests: cached once.
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], cache_control: { type: "ephemeral" } };
  return out;
}

/** The answer's blocks as Responses items, each keeping the blocks it came from. */
function itemsOf(content: Block[]): Item[] {
  const items: Item[] = [];
  const results = new Map(
    content.filter((b) => typeof b.tool_use_id === "string" && b.type !== "tool_result").map((b) => [b.tool_use_id, b]),
  );
  for (const b of content) {
    if (b.type === "thinking" || b.type === "redacted_thinking")
      items.push({
        type: "reasoning",
        summary: b.thinking ? [{ type: "summary_text", text: b.thinking }] : [],
        anthropic: b,
      });
    else if (b.type === "text")
      items.push({
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: b.text,
            annotations: (b.citations ?? [])
              .filter((c: Block) => c.url)
              .slice(0, 1)
              .map((c: Block) => ({
                type: "url_citation",
                start_index: 0,
                end_index: b.text.length,
                url: c.url,
                title: c.title ?? c.url,
              })),
          },
        ],
        anthropic: b,
      });
    else if (b.type === "tool_use")
      items.push({
        type: "function_call",
        call_id: b.id,
        name: b.name,
        arguments: JSON.stringify(b.input ?? {}),
        anthropic: b,
      });
    else if (b.type === "server_tool_use") {
      const result = results.get(b.id);
      items.push({ ...hostedCall(b, result), anthropic: result ? [b, result] : [b] });
    }
    // Results were placed with their calls.
  }
  return items;
}
/** A search Claude ran, as the Responses API reports one. */
function hostedCall(use: Block, result?: Block): Item {
  const input = use.input ?? {};
  const found = Array.isArray(result?.content) ? result.content : [];
  const failed = !!result && !Array.isArray(result.content);
  const type = use.name === "web_search" ? "web_search_call" : `${use.name}_call`;
  return {
    type,
    id: use.id,
    status: !result ? "in_progress" : failed ? "failed" : "completed",
    ...(use.name === "web_search"
      ? {
          action: {
            type: "search",
            query: input.query ?? "",
            sources: found.filter((r: Block) => r.url).map((r: Block) => ({ type: "url", url: r.url })),
          },
        }
      : { action: input }),
  };
}

/** One turn with a Claude model, streamed and reported as the Responses API would. The
 * turn's own effort is read from the conversation (see `toAnthropic`); the request keeps
 * the configured one, so the cached prefix holds. */
async function generate(
  role: Role,
  { instructions, input, tools, signal, onEvent, budget }: Request,
): Promise<Answer> {
  const client = new Anthropic({
    apiKey: role.credential,
    baseURL: role.baseUrl.replace(/\/$/, "").replace(/\/v1$/, ""),
    // The run retries a failed turn itself, with its own waits.
    maxRetries: 0,
  });
  const level = effortFor(role.effort, role.efforts);
  const list = anthropicTools(tools, role.model);
  const betas = [
    ...(perTurnEffort(role.model) ? ["mid-conversation-output-config-2026-07-01"] : []),
    ...(boundThinking(role.model) ? ["thinking-binding-controls-2026-08-01"] : []),
  ];
  const conversation: Item[] = toAnthropic(input, list.length > 0, role.model);
  const turn = crypto.randomUUID().slice(0, 8);
  const content: Block[] = [];
  const usage = { input: 0, cached: 0, written: 0, output: 0 };
  let model = role.model,
    id = "",
    stop: string | null | undefined;
  // Blocks by their index in the answer being streamed, and what they have said so far.
  let open = new Map<number, { block: Block; text: string }>();
  let said = false;
  const pending = new Map<string, Block>();
  // A turn Claude paused in the middle of its own searches goes on from where it stopped.
  for (let round = 0; round < 6; round++) {
    const params: Item = {
      model: role.model,
      ...pinnedProvider(role),
      max_tokens: budget,
      system: [{ type: "text", text: instructions, cache_control: { type: "ephemeral" } }],
      messages: round ? [...conversation, { role: "assistant", content: [...content] }] : conversation,
      ...(list.length ? { tools: list } : {}),
      thinking: {
        type: "adaptive",
        display: "summarized",
        ...(boundThinking(role.model)
          ? { block_binding: { prefix_mismatch_behavior: "drop_block" } }
          : {}),
      },
      ...(level ? { output_config: { effort: level } } : {}),
      // The newest turn is cached too, so the next one reads all of this from the cache.
      cache_control: { type: "ephemeral" },
      ...(betas.length ? { betas } : {}),
    };
    let stream;
    try {
      stream = client.beta.messages.stream(params as any, { signal });
      for await (const e of stream as AsyncIterable<Item>) {
        if (e.type === "message_start") {
          id ||= e.message.id;
          model = e.message.model ?? model;
        } else if (e.type === "content_block_start") {
          const block = e.content_block;
          open.set(e.index, { block, text: "" });
          if (block.type === "thinking") onEvent({ type: "response.reasoning_summary_part.added" });
          else if (block.type === "text" && !said) {
            said = true;
            onEvent({ type: "response.output_item.added", item: { type: "message", id: `msg_${turn}`, role: "assistant" } });
          } else if (block.type === "tool_use")
            onEvent({
              type: "response.output_item.added",
              item: { type: "function_call", id: block.id, call_id: block.id, name: block.name, arguments: "" },
            });
          else if (block.type === "server_tool_use") {
            pending.set(block.id, block);
            onEvent({ type: "response.output_item.added", item: hostedCall(block) });
          }
        } else if (e.type === "content_block_delta") {
          const o = open.get(e.index);
          const d = e.delta;
          if (d.type === "thinking_delta" && d.thinking) {
            if (o) o.text += d.thinking;
            onEvent({ type: "response.reasoning_summary_text.delta", delta: d.thinking });
          } else if (d.type === "text_delta" && d.text)
            onEvent({ type: "response.output_text.delta", item_id: `msg_${turn}`, delta: d.text });
          else if (d.type === "input_json_delta" && d.partial_json && o?.block.type === "tool_use")
            onEvent({ type: "response.function_call_arguments.delta", item_id: o.block.id, delta: d.partial_json });
        } else if (e.type === "content_block_stop") {
          const o = open.get(e.index);
          if (o?.block.type === "thinking")
            onEvent({ type: "response.reasoning_summary_text.done", text: o.text });
        } else if (e.type === "message_delta") {
          stop = e.delta?.stop_reason ?? stop;
        }
      }
      const final: Item = await stream.finalMessage();
      const blocks: Block[] = final.content;
      content.push(...blocks);
      // Searches are reported with their results, once the query in them is whole.
      for (const b of blocks)
        if (b.type === "server_tool_use") pending.set(b.id, b);
      for (const b of blocks)
        if (typeof b.tool_use_id === "string" && pending.has(b.tool_use_id)) {
          onEvent({ type: "response.output_item.done", item: hostedCall(pending.get(b.tool_use_id)!, b) });
          pending.delete(b.tool_use_id);
        } else if (b.type === "tool_use")
          onEvent({
            type: "response.output_item.done",
            item: { type: "function_call", id: b.id, call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          });
      const u = final.usage ?? {};
      const cachedNow = u.cache_read_input_tokens ?? 0;
      usage.input += (u.input_tokens ?? 0) + cachedNow + (u.cache_creation_input_tokens ?? 0);
      usage.cached += cachedNow;
      usage.written += u.cache_creation_input_tokens ?? 0;
      usage.output += u.output_tokens ?? 0;
      stop = final.stop_reason ?? stop;
      model = final.model ?? model;
    } catch (e) {
      throw failure(e, signal);
    }
    open = new Map();
    if (stop !== "pause_turn") break;
  }
  const spent = () => ({
    input_tokens: usage.input,
    input_tokens_details: { cached_tokens: usage.cached, cache_write_tokens: usage.written },
    output_tokens: usage.output,
    // Messages reports thinking within the output tokens, not apart from it.
    output_tokens_details: { reasoning_tokens: 0 },
  });
  if (stop === "max_tokens")
    throw new CutOff(
      stop,
      content.some((b) => b.type === "thinking") && content.every((b) => b.type === "thinking"),
      spent(),
    );
  // A declined turn is not handed to another model: the run stops and says so.
  if (stop === "refusal") throw Error("模型拒绝了这一轮的内容");
  if (stop === "model_context_window_exceeded") throw new CutOff(stop, false, spent());
  if (!stop || stop === "pause_turn") throw Error("模型连接在完成前中断");
  const items = itemsOf(content);
  for (const item of items)
    if (item.type === "message")
      onEvent({ type: "response.output_item.done", item: { ...item, id: `msg_${turn}` } });
  return {
    items,
    usage: spent(),
    response: { id, model, status: "completed", protocol: "anthropic" },
  };
}

/** A failed request in the words the run reads: a status it may retry, a connection that
 * ended, or what the API said. */
function failure(e: unknown, signal: AbortSignal): unknown {
  if (signal.aborted || e instanceof Anthropic.APIUserAbortError) return e;
  if (e instanceof Anthropic.APIConnectionError) return Error("模型连接在完成前中断");
  if (e instanceof Anthropic.APIError)
    // An overload reported inside the stream has no status of its own.
    return Error(`模型请求 ${e.status ?? (/overloaded/i.test(e.message) ? 529 : "失败")}: ${e.message}`);
  return e;
}

export const anthropic: Adapter = {
  generate,
  // The newer Claude models take an effort change as a system message in the conversation;
  // the others take it only on the request, which restarts the cache.
  effortControl: (role) => (perTurnEffort(role.model) ? "conversation" : "fixed"),
  // Messages has no way to narrow the tools without changing them; Claude's own search is
  // held to a number per request in its tool, and a search service's calls are refused
  // past the budget by the run.
};
