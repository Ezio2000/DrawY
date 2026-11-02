import { it, expect, vi, afterEach } from "vitest";
import { generate, forResponses, toMessages, citationsOf } from "./index.ts";
import { toAnthropic, anthropicTools, claudeVersion, perTurnEffort } from "./anthropic.ts";
import { defaultRole, roleSchema, type Role } from "../contracts/index.ts";

const role: Role = {
  ...defaultRole(),
  protocol: "anthropic",
  baseUrl: "https://api.anthropic.com",
  credential: "test",
  model: "claude-sonnet-5-5",
  effort: "high",
  efforts: ["low", "medium", "high", "xhigh", "max"],
};
afterEach(() => vi.unstubAllGlobals());

/** A Messages stream as the API sends it. */
const sse = (events: object[]) =>
  new Response(
    events.map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
const start = {
  type: "message_start",
  message: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [],
    stop_reason: null,
    usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 1 },
  },
};
const end = (stop: string) => [
  { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
];
const body = (n = 0) => JSON.parse((vi.mocked(fetch).mock.calls[n][1] as RequestInit).body as string);

it("reads Claude model versions", () => {
  expect(claudeVersion("claude-sonnet-5-5")).toEqual({ family: "sonnet", version: 5.5 });
  expect(claudeVersion("anthropic.claude-opus-5")).toEqual({ family: "opus", version: 5 });
  expect(claudeVersion("claude-haiku-4-5-20251001")).toEqual({ family: "haiku", version: 4.5 });
  expect(perTurnEffort("claude-sonnet-5-5")).toBe(true);
  expect(perTurnEffort("claude-sonnet-5")).toBe(false);
  expect(perTurnEffort("claude-fable-5")).toBe(false);
  expect(perTurnEffort("gpt-6-astra")).toBe(false);
});

it("offers built-in search to Claude with an API key", () => {
  const r = roleSchema.parse({ ...role, builtinSearch: true, search: "builtin" });
  expect(r.builtinSearch).toBe(true);
  expect(r.search).toBe("builtin");
  expect(anthropicTools([{ type: "web_search", search_context_size: "low" }], role.model)).toEqual([
    { type: "web_search_20260209", name: "web_search", max_uses: 8, cache_control: { type: "ephemeral" } },
  ]);
});

it("streams a Claude turn as Responses events and items", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      sse([
        start,
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Plan it." } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Drawing." } },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "write_work", input: {} } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"baseRevision":' } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "1}" } },
        { type: "content_block_stop", index: 2 },
        ...end("tool_use"),
      ]),
    ),
  );
  const events: any[] = [];
  const result = await generate(role, { instructions: "instructions", input: [{ role: "user", content: [{ type: "input_text", text: "Draw a map" }] }], tools: [{ type: "function", name: "write_work", description: "Write", parameters: { type: "object" }, strict: false }], signal: new AbortController().signal, onEvent: (e) => events.push(e) });
  expect(events.map((e) => e.type)).toEqual([
    "response.reasoning_summary_part.added",
    "response.reasoning_summary_text.delta",
    "response.reasoning_summary_text.done",
    "response.output_item.added",
    "response.output_text.delta",
    "response.output_item.added",
    "response.function_call_arguments.delta",
    "response.function_call_arguments.delta",
    "response.output_item.done",
    "response.output_item.done",
  ]);
  expect(result.items.map((i) => i.type)).toEqual(["reasoning", "message", "function_call"]);
  expect(result.items[0].anthropic).toEqual({ type: "thinking", thinking: "Plan it.", signature: "sig" });
  expect(result.items[2]).toMatchObject({ call_id: "toolu_1", name: "write_work", arguments: '{"baseRevision":1}' });
  expect(result.usage).toMatchObject({ input_tokens: 100, input_tokens_details: { cached_tokens: 90 }, output_tokens: 20 });
  const b = body();
  expect(b.model).toBe("claude-sonnet-5-5");
  expect(b.output_config).toEqual({ effort: "high" });
  expect(b.thinking).toMatchObject({ type: "adaptive", display: "summarized" });
  expect(b.system[0]).toMatchObject({ text: "instructions", cache_control: { type: "ephemeral" } });
  expect(b.tools[0]).toMatchObject({ name: "write_work", input_schema: { type: "object" }, eager_input_streaming: true });
  expect(b.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Draw a map" }] }]);

  // The next request sends Claude's blocks back as they came.
  const next = toAnthropic(
    [
      { role: "user", content: "Draw a map" },
      ...result.items,
      { type: "function_call_output", call_id: "toolu_1", output: "{}" },
    ],
    true,
  );
  expect(next[1]).toEqual({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Plan it.", signature: "sig" },
      { type: "text", text: "Drawing." },
      { type: "tool_use", id: "toolu_1", name: "write_work", input: { baseRevision: 1 } },
    ],
  });
  // Other APIs read the same items without Claude's blocks.
  expect(forResponses(result.items)).toEqual([
    { type: "message", role: "assistant", content: result.items[1].content },
    { type: "function_call", call_id: "toolu_1", name: "write_work", arguments: '{"baseRevision":1}' },
  ]);
  expect(toMessages("", result.items).filter((m) => m.role === "assistant")).toHaveLength(1);
});

it("puts every result first and what was shown between them after", () => {
  const messages = toAnthropic(
    [
      { role: "user", content: "Go" },
      { type: "function_call", call_id: "a", name: "view_canvas", arguments: "{}" },
      { type: "function_call", call_id: "b", name: "read_work", arguments: "{}" },
      { type: "function_call_output", call_id: "a", output: "seen" },
      { role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }] },
      { type: "configuration_update", reasoning: { effort: "max" } },
      { type: "function_call_output", call_id: "b", output: "read" },
    ],
    true,
    "claude-sonnet-5-5",
  );
  expect(messages).toEqual([
    { role: "user", content: [{ type: "text", text: "Go" }] },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "a", name: "view_canvas", input: {} },
        { type: "tool_use", id: "b", name: "read_work", input: {} },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "seen" },
        { type: "tool_result", tool_use_id: "b", content: "read" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ],
    },
    { role: "system", content: [], output_config: { effort: "max" } },
  ]);
  // A model that cannot take the change as a message keeps its effort.
  expect(
    toAnthropic([{ role: "user", content: "Go" }, { type: "configuration_update", reasoning: { effort: "max" } }], true, "claude-sonnet-4-6"),
  ).toHaveLength(1);
});

it("tells calls in words when a request has no tools", () => {
  expect(
    toAnthropic(
      [
        { role: "user", content: "Go" },
        { type: "reasoning", summary: [], anthropic: { type: "thinking", thinking: "", signature: "s" } },
        { type: "function_call", call_id: "a", name: "read_work", arguments: "{}" },
        { type: "function_call_output", call_id: "a", output: "work" },
      ],
      false,
    ),
  ).toEqual([
    { role: "user", content: [{ type: "text", text: "Go" }] },
    { role: "assistant", content: [{ type: "text", text: "[Called read_work: {}]" }] },
    { role: "user", content: [{ type: "text", text: "[Result of read_work: work]" }] },
  ]);
});

it("reports Claude's own searches as hosted calls with their sources", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      sse([
        start,
        { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"canton tower"}' } },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "web_search_tool_result",
            tool_use_id: "srvtoolu_1",
            content: [{ type: "web_search_result", url: "https://example.com/tower", title: "Tower", encrypted_content: "x", page_age: null }],
          },
        },
        { type: "content_block_stop", index: 1 },
        {
          type: "content_block_start",
          index: 2,
          content_block: { type: "text", text: "", citations: null },
        },
        {
          type: "content_block_delta",
          index: 2,
          delta: {
            type: "citations_delta",
            citation: { type: "web_search_result_location", url: "https://example.com/tower", title: "Tower", cited_text: "600 m", encrypted_index: "i" },
          },
        },
        { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "It is 600 m tall." } },
        { type: "content_block_stop", index: 2 },
        ...end("end_turn"),
      ]),
    ),
  );
  const events: any[] = [];
  const result = await generate({ ...role, builtinSearch: true, search: "builtin" }, { instructions: "", input: [{ role: "user", content: "How tall?" }], tools: [{ type: "web_search", search_context_size: "low" }], signal: new AbortController().signal, onEvent: (e) => events.push(e) });
  const done = events.find((e) => e.type === "response.output_item.done" && e.item.type === "web_search_call");
  expect(done.item).toMatchObject({
    id: "srvtoolu_1",
    status: "completed",
    action: { type: "search", query: "canton tower", sources: [{ type: "url", url: "https://example.com/tower" }] },
  });
  expect(result.items[0].anthropic.map((b: any) => b.type)).toEqual(["server_tool_use", "web_search_tool_result"]);
  expect(citationsOf(result.items)).toEqual([{ start: 0, end: 17, url: "https://example.com/tower", title: "Tower" }]);
  // Claude's searches are its own: the Responses API never sees them.
  expect(forResponses(result.items).map((i) => i.type)).toEqual(["message"]);
});

it("fails a cut-off or refused Claude turn, and leaves overloads to be retried", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => sse([start, ...end("max_tokens")])));
  await expect(generate(role, { instructions: "", input: [], tools: [], signal: new AbortController().signal })).rejects.toThrow("截断");
  vi.stubGlobal("fetch", vi.fn(async () => sse([start, ...end("refusal")])));
  await expect(generate(role, { instructions: "", input: [], tools: [], signal: new AbortController().signal })).rejects.toThrow("拒绝");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529 })),
  );
  await expect(generate(role, { instructions: "", input: [], tools: [], signal: new AbortController().signal })).rejects.toThrow(/^模型请求 529/);
});

it("asks a newer Claude model for its effort per turn, and never for a fallback model", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => sse([start, ...end("end_turn")])));
  // A turn that thinks harder says so in the conversation; the request keeps its own effort.
  await generate(role, {
    instructions: "",
    input: [{ role: "user", content: "Hi" }, { type: "configuration_update", reasoning: { effort: "max" } }],
    signal: new AbortController().signal,
    effort: "max",
  });
  expect(body().output_config).toEqual({ effort: "high" });
  expect(body().messages.at(-1)).toEqual({ role: "system", content: [], output_config: { effort: "max" } });
  const headers = new Headers((vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers);
  expect(headers.get("anthropic-beta")).toContain("mid-conversation-output-config-2026-07-01");
  expect(headers.get("anthropic-beta")).not.toContain("server-side-fallback");
  expect(body().fallbacks).toBeUndefined();
  expect(body().thinking.block_binding).toEqual({ prefix_mismatch_behavior: "drop_block" });
  // Another address is reached at its own /v1.
  vi.stubGlobal("fetch", vi.fn(async () => sse([start, ...end("end_turn")])));
  await generate({ ...role, baseUrl: "https://proxy.example/v1" }, { instructions: "", input: [{ role: "user", content: "Hi" }], tools: [], signal: new AbortController().signal });
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("https://proxy.example/v1/messages");
  expect(body().fallbacks).toBeUndefined();
});
