/* The OpenAI Responses API, which the run's conversation is kept in: requests go out as
 * they are, with only the items other formats wrote for themselves left out. */
import { effortFor, speedFor, type Role, type Speed } from "../contracts/index.ts";
import { events, post } from "./http.ts";
import { CutOff, type Adapter, type Item } from "./types.ts";

/** The `service_tier` each speed asks for. */
export const serviceTiers: Record<Speed, string> = {
  flex: "flex",
  default: "default",
  fast: "priority",
  ultrafast: "ultrafast",
};
const tierOf = (role: Role) => serviceTiers[speedFor(role.channel, role.speed)];

/** The conversation as the Responses API reads it. Reasoning a Chat Completions or Claude
 * model wrote earlier is its own, and so are the searches Claude ran; the words and calls
 * of a Claude turn stay, without the blocks kept for Claude. */
export function forResponses(input: Item[]): Item[] {
  return input
    .filter(
      (i) =>
        !(i.type === "reasoning" && ("reasoning_content" in i || "anthropic" in i)) &&
        !(i.anthropic && typeof i.type === "string" && i.type.endsWith("_call") && i.type !== "function_call"),
    )
    .map((i) => {
      if (!("anthropic" in i)) return i;
      const { anthropic: _, ...rest } = i;
      return rest;
    });
}

export const responses: Adapter = {
  async generate(role, { instructions, input, tools, signal, onEvent, budget, cacheKey, steer }) {
    const r = await post(
      role,
      "/responses",
      {
        instructions,
        input: forResponses(input),
        tools,
        stream: true,
        store: false,
        reasoning: { effort: effortFor(role.effort, role.efforts) ?? role.effort, summary: "auto" },
        service_tier: tierOf(role),
        ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
        ...(role.channel === "api" ? { max_output_tokens: budget } : {}),
        ...steer,
      },
      signal,
      // The ChatGPT backend routes by its session header, so the key goes there too.
      cacheKey && role.channel === "oauth" ? { session_id: cacheKey } : {},
    );
    const items: Item[] = [];
    let complete = false,
      wrote = false,
      usage: Item = {},
      response: Item = {};
    for await (const e of events(r)) {
      onEvent(e);
      if (e.type === "response.output_item.done") items.push(e.item);
      if (e.type === "response.output_item.added" && e.item?.type !== "reasoning") wrote = true;
      if (e.type === "response.completed") {
        complete = true;
        usage = e.response.usage;
        const { id, model, status, service_tier } = e.response;
        response = { id, model, status, service_tier };
      }
      if (e.type === "response.failed" || e.type === "error")
        throw Error(JSON.stringify(e.error || e.response?.error));
      if (e.type === "response.incomplete") {
        const spent = e.response?.usage ?? {};
        throw new CutOff(
          e.response?.incomplete_details?.reason,
          !wrote &&
            !items.some((i) => i.type !== "reasoning") &&
            (spent.output_tokens_details?.reasoning_tokens ?? 0) > 0,
          spent,
        );
      }
    }
    if (!complete) throw Error("模型连接在完成前中断");
    return { items, usage, response };
  },
  // GPT-6 models take a configuration_update item, which changes the effort until the
  // next one; the request's own effort stays, so the cached prefix holds. Older models
  // take it only on the request, which restarts the cache.
  effortControl: (role) => (/^gpt-(?:[6-9]|\d{2,})/.test(role.model) ? "conversation" : "fixed"),
  narrow(tools, left, isSearch, role) {
    // Some services speak Responses without allowed_tools or max_tool_calls (DeepSeek's);
    // their model says so, and the search service's calls are refused past the budget
    // instead, without changing this tool list.
    if (!role.toolLimits) return {};
    // max_tool_calls counts only the provider's own tools; a search service's calls are
    // counted by the run.
    if (left > 0) return tools.some((t) => t.type === "web_search") ? { max_tool_calls: left } : {};
    return {
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: tools
          .filter((t) => t.type === "function" && !isSearch(t))
          .map((t) => ({ type: "function", name: t.name })),
      },
    };
  },
  describe: (role) => ({ serviceTier: tierOf(role) }),
};
