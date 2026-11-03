/* Chat Completions, which most providers other than OpenAI and Anthropic offer
 * (DeepSeek, Qwen, Kimi…). The conversation goes out as messages, and each streamed answer
 * comes back as the Responses API would report it. */
import { effortFor, topEffort, type Role } from "../contracts/index.ts";
import { events, post } from "./http.ts";
import { textOf } from "./text.ts";
import { CutOff, type Adapter, type Answer, type Item, type Request } from "./types.ts";

/** The conversation as Chat Completions messages. The loop keeps it as Responses items;
 * each model turn becomes one assistant message with its tool calls, and their results
 * follow it. Pictures shown between results move after them, since nothing may come
 * between a call and its result. Calls and items only the Responses API knows (its own
 * hosted tools, effort changes, encrypted reasoning) are left out. */
export function toMessages(instructions: string, input: Item[]): Item[] {
  const messages: Item[] = [{ role: "system", content: instructions }];
  let turn: Item | undefined;
  let open = 0;
  const later: Item[] = [];
  const settle = () => {
    if (open > 0) return;
    messages.push(...later.splice(0));
  };
  const part = (c: Item): Item | undefined =>
    c.type === "input_text" || c.type === "output_text" || c.type === "text"
      ? { type: "text", text: c.text ?? "" }
      : c.type === "input_image"
        ? { type: "image_url", image_url: { url: c.image_url } }
        : undefined;
  const content = (value: unknown) =>
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.map(part).filter(Boolean)
        : "";
  const assistant = () => {
    if (!turn) {
      turn = { role: "assistant", content: null };
      messages.push(turn);
    }
    return turn;
  };
  for (const item of input) {
    if (item.type === "reasoning") {
      if (typeof item.reasoning_content === "string") {
        if (turn && (turn.content || turn.tool_calls)) turn = undefined;
        assistant().reasoning_content = item.reasoning_content;
      }
      continue;
    }
    if (item.type === "function_call") {
      const t = assistant();
      (t.tool_calls ??= []).push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments || "{}" },
      });
      open++;
      continue;
    }
    if (item.type === "function_call_output") {
      turn = undefined;
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output),
      });
      open--;
      settle();
      continue;
    }
    if (item.role === "assistant" || (item.type === "message" && item.role === "assistant")) {
      const text = textOf([{ type: "message", content: item.content }]) ||
        (typeof item.content === "string" ? item.content : "");
      const t = assistant();
      if (t.tool_calls) {
        turn = undefined;
        assistant().content = text;
      } else t.content = (t.content ?? "") + text;
      continue;
    }
    if (item.role === "user" || item.role === "system" || item.role === "developer") {
      turn = undefined;
      const message = { role: item.role === "user" ? "user" : "system", content: content(item.content) };
      if (open > 0) later.push(message);
      else messages.push(message);
      continue;
    }
    // Hosted calls, effort changes and anything else the Responses API alone reads.
  }
  open = 0;
  settle();
  // A model turn that made no call and said nothing still needs words.
  for (const m of messages)
    if (m.role === "assistant" && m.content === null && !m.tool_calls) m.content = "";
  return messages;
}

/** Function tools in Chat Completions form; the Responses API's own tools have none. */
export const chatTools = (tools: Item[]) =>
  tools
    .filter((t) => t.type === "function")
    .map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

/** One turn with a Chat Completions model, streamed and reported as the Responses API
 * would: the same events as they arrive, and the same items and usage at the end, so the
 * rest of the run does not need to know which one it talked to. */
async function generate(
  role: Role,
  { instructions, input, tools, signal, onEvent, budget, effort }: Request,
): Promise<Answer> {
  const level = effortFor(effort ?? role.effort, role.efforts);
  const functions = chatTools(tools);
  const r = await post(
    role,
    "/chat/completions",
    {
      messages: toMessages(instructions, input),
      ...(functions.length ? { tools: functions } : {}),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: budget,
      ...(level ? { reasoning_effort: level } : {}),
    },
    signal,
  );
  const turn = crypto.randomUUID().slice(0, 8);
  let reasoning: { text: string } | undefined;
  let message: { id: string; text: string } | undefined;
  const calls: { id: string; call_id: string; name: string; arguments: string; added: boolean }[] = [];
  let usage: Item = {},
    finish: string | undefined,
    model = role.model,
    id = "";
  const add = (call: (typeof calls)[number]) => {
    if (call.added || !call.name) return;
    call.added = true;
    onEvent({
      type: "response.output_item.added",
      item: { type: "function_call", id: call.id, call_id: call.call_id, name: call.name, arguments: "" },
    });
    if (call.arguments)
      onEvent({ type: "response.function_call_arguments.delta", item_id: call.id, delta: call.arguments });
  };
  for await (const e of events(r)) {
    if (e.error) throw Error(JSON.stringify(e.error));
    id ||= e.id ?? "";
    model = e.model ?? model;
    if (e.usage) usage = e.usage;
    const choice = e.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      if (!reasoning) {
        reasoning = { text: "" };
        onEvent({ type: "response.reasoning_summary_part.added" });
      }
      reasoning.text += delta.reasoning_content;
      onEvent({ type: "response.reasoning_summary_text.delta", delta: delta.reasoning_content });
    }
    if (typeof delta.content === "string" && delta.content) {
      if (!message) {
        message = { id: `msg_${turn}`, text: "" };
        onEvent({ type: "response.output_item.added", item: { type: "message", id: message.id, role: "assistant" } });
      }
      message.text += delta.content;
      onEvent({ type: "response.output_text.delta", item_id: message.id, delta: delta.content });
    }
    for (const t of delta.tool_calls ?? []) {
      const index = t.index ?? calls.length;
      const call = (calls[index] ??= {
        id: `fc_${turn}_${index}`,
        call_id: t.id ?? `call_${turn}_${index}`,
        name: "",
        arguments: "",
        added: false,
      });
      if (t.id) call.call_id = t.id;
      if (t.function?.name) call.name += t.function.name;
      const more = t.function?.arguments ?? "";
      call.arguments += more;
      if (call.added && more)
        onEvent({ type: "response.function_call_arguments.delta", item_id: call.id, delta: more });
      else add(call);
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  const spent = () => ({
    input_tokens: usage.prompt_tokens ?? 0,
    input_tokens_details: {
      cached_tokens:
        usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0,
    },
    output_tokens: usage.completion_tokens ?? 0,
    output_tokens_details: {
      reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  });
  if (!finish) throw Error("模型连接在完成前中断");
  if (finish === "length")
    throw new CutOff(finish, !!reasoning && !message && !calls.some(Boolean), spent());
  if (finish === "content_filter") throw Error("模型拒绝了这一轮的内容");
  const items: Item[] = [];
  if (reasoning) {
    onEvent({ type: "response.reasoning_summary_text.done", text: reasoning.text });
    items.push({ type: "reasoning", summary: [], reasoning_content: reasoning.text });
  }
  if (message) {
    const item = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: message.text, annotations: [] }],
    };
    onEvent({ type: "response.output_item.done", item: { ...item, id: message.id } });
    items.push(item);
  }
  for (const call of calls.filter(Boolean)) {
    add(call);
    const item = { type: "function_call", call_id: call.call_id, name: call.name, arguments: call.arguments };
    onEvent({ type: "response.output_item.done", item: { ...item, id: call.id } });
    items.push(item);
  }
  return {
    items,
    usage: spent(),
    response: { id, model, status: "completed", protocol: "chat" },
  };
}

export const chat: Adapter = {
  generate,
  // Chat Completions asks for its effort on each request, which leaves the cached prefix
  // alone: the deciding turns ask for the most the model accepts.
  effortControl: () => "request",
  decidingEffort: (role) => topEffort(role.efforts) ?? role.effort,
};
