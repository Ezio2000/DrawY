import { it, expect, vi, afterEach } from "vitest";
import { generate, toMessages } from "./index.ts";
import { defaultRole, type Role } from "../contracts/index.ts";
const role: Role = {
  ...defaultRole(),
  channel: "oauth",
  baseUrl: "https://example.invalid",
  credential: "test",
  model: "gpt-6-astra",
  effort: "medium",
  speed: "default",
};
afterEach(() => vi.unstubAllGlobals());
it("retains completed streamed tool arguments when final output is empty", async () => {
  const item = {
    type: "function_call",
    call_id: "c",
    name: "write_work",
    arguments: '{"baseRevision":1,"scenes":[]}',
  };
  const data = [
    { type: "response.output_item.done", item },
    { type: "response.completed", response: { output: [], usage: {} } },
  ]
    .map((e) => "data: " + JSON.stringify(e) + "\n\n")
    .join("");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(data)),
  );
  const result = await generate(role, { instructions: "test", input: [], tools: [], signal: new AbortController().signal });
  expect(result.items).toEqual([item]);
  const body = JSON.parse(
    (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
  );
  expect(body.max_output_tokens).toBeUndefined();
});
it("does not return executable calls after output truncation", async () => {
  const data =
    "data: " +
    JSON.stringify({
      type: "response.output_item.done",
      item: { type: "function_call", arguments: "{}" },
    }) +
    "\n\ndata: " +
    JSON.stringify({ type: "response.incomplete" }) +
    "\n\n";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(data)),
  );
  await expect(
    generate(role, { instructions: "", input: [], tools: [], signal: new AbortController().signal }),
  ).rejects.toThrow("截断");
});
it("does not treat a disconnected stream as completion", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          'data: {"type":"response.output_text.delta","delta":"hello"}\n\n',
        ),
    ),
  );
  await expect(
    generate(role, { instructions: "", input: [], tools: [], signal: new AbortController().signal }),
  ).rejects.toThrow("中断");
});

it.each([
  ["api", "flex", "flex"],
  ["api", "default", "default"],
  ["api", "fast", "priority"],
  ["api", "ultrafast", "default"],
  ["oauth", "flex", "default"],
  ["oauth", "default", "default"],
  ["oauth", "fast", "priority"],
  ["oauth", "ultrafast", "ultrafast"],
] as const)(
  "sends %s speed %s as service tier %s without changing reasoning effort",
  async (channel, speed, tier) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "data: " +
              JSON.stringify({
                type: "response.completed",
                response: { output: [], usage: {} },
              }) +
              "\n\n",
          ),
      ),
    );
    await generate({ ...role, channel, speed }, { instructions: "", input: [], tools: [], signal: new AbortController().signal });
    const options = vi.mocked(fetch).mock.calls.at(-1)![1] as RequestInit;
    const body = JSON.parse(options.body as string);
    expect(body.service_tier).toBe(tier);
    expect(body.reasoning.effort).toBe("medium");
  },
);
it("keeps requests that extend one another on their cached prefix", async () => {
  const data =
    "data: " +
    JSON.stringify({
      type: "response.completed",
      response: { output: [], usage: {} },
    }) +
    "\n\n";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(data)),
  );
  for (const channel of ["oauth", "api"] as const)
    await generate({ ...role, channel }, { instructions: "test", input: [], tools: [], signal: new AbortController().signal, cacheKey: "work-1" });
  const [oauth, api] = vi
    .mocked(fetch)
    .mock.calls.map(([, init]) => init as RequestInit);
  for (const init of [oauth, api])
    expect(JSON.parse(init.body as string).prompt_cache_key).toBe("work-1");
  // The ChatGPT backend routes by session_id; the API by the key alone.
  expect((oauth.headers as Record<string, string>).session_id).toBe("work-1");
  expect((api.headers as Record<string, string>).session_id).toBeUndefined();
});

it("preserves hosted search output and citation offsets for continuation", async () => {
  const search = { type: "web_search_call", id: "ws", status: "completed", action: { type: "search", query: "OpenAI" } };
  const message = { type: "message", content: [{ type: "output_text", text: "A[1]", annotations: [{ type: "url_citation", start_index: 1, end_index: 4, url: "https://openai.com/", title: "OpenAI" }] }] };
  const items = [search, message];
  const events = [...items.map(item => ({ type: "response.output_item.done", item })), { type: "response.completed", response: { usage: {} } }];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(events.map(e => "data: " + JSON.stringify(e) + "\n\n").join(""))));
  const result = await generate({ ...role, channel: "api" }, { instructions: "", input: [], tools: [{ type: "web_search" }], signal: new AbortController().signal });
  expect(result.items).toEqual(items);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).tools).toEqual([{ type: "web_search" }]);
  const { citationsOf } = await import("./index.ts");
  expect(citationsOf([{ type: "message", content: [{ text: "前言" }] }, ...result.items])).toEqual([{ start: 3, end: 6, url: "https://openai.com/", title: "OpenAI" }]);
});

const deepseek: Role = {
  ...defaultRole(),
  protocol: "chat",
  baseUrl: "https://api.deepseek.invalid",
  credential: "test",
  model: "deepseek-flash",
  effort: "high",
  efforts: ["low", "high", "max"],
  maxOutput: 8192,
};
const chunks = (list: object[]) =>
  list.map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") + "data: [DONE]\n\n";
it("speaks Chat Completions and reports its stream as the Responses API would", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        chunks([
          { id: "r", model: "deepseek-flash", choices: [{ delta: { role: "assistant", content: null, reasoning_content: "" } }] },
          { choices: [{ delta: { reasoning_content: "Think" } }] },
          { choices: [{ delta: { content: "Drawing." } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "write_work", arguments: "" } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"baseRevision"' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] } }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 60, completion_tokens_details: { reasoning_tokens: 5 } } },
        ]),
      ),
    ),
  );
  const events: any[] = [];
  const result = await generate(deepseek, { instructions: "be an author", input: [{ role: "user", content: [{ type: "input_text", text: "draw" }] }], tools: [
      { type: "function", name: "write_work", description: "w", parameters: { type: "object" }, strict: false },
      { type: "web_search", search_context_size: "low" },
    ], signal: new AbortController().signal, onEvent: (e) => events.push(e), budget: 32768, cacheKey: "key", steer: { tool_choice: { type: "allowed_tools" } }, effort: "max" });
  const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://api.deepseek.invalid/chat/completions");
  const body = JSON.parse(init.body as string);
  // Only function tools go over, the turn's effort is asked for per request, the answer
  // fits the model's limit, and the Responses API's own steering stays behind.
  expect(body).toMatchObject({
    model: "deepseek-flash",
    stream: true,
    max_tokens: 8192,
    reasoning_effort: "max",
    tools: [{ type: "function", function: { name: "write_work", description: "w", parameters: { type: "object" } } }],
  });
  expect(body.tool_choice).toBeUndefined();
  expect(body.prompt_cache_key).toBeUndefined();
  expect(body.messages[0]).toEqual({ role: "system", content: "be an author" });
  expect(result.items).toEqual([
    { type: "reasoning", summary: [], reasoning_content: "Think" },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Drawing.", annotations: [] }] },
    { type: "function_call", call_id: "call_1", name: "write_work", arguments: '{"baseRevision":1}' },
  ]);
  expect(result.usage).toEqual({
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 60 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 5 },
  });
  const types = events.map((e) => e.type);
  expect(types).toContain("response.reasoning_summary_text.delta");
  expect(types).toContain("response.output_text.delta");
  const added = events.find((e) => e.type === "response.output_item.added" && e.item.type === "function_call");
  expect(added.item).toMatchObject({ name: "write_work", call_id: "call_1" });
  expect(
    events
      .filter((e) => e.type === "response.function_call_arguments.delta")
      .map((e) => e.delta)
      .join(""),
  ).toBe('{"baseRevision":1}');
});
it("turns the conversation into messages, with pictures after the results they follow", () => {
  const picture = { type: "input_image", image_url: "data:image/png;base64,AA" };
  const messages = toMessages("sys", [
    { role: "user", content: [{ type: "input_text", text: "draw" }, picture] },
    { type: "configuration_update", reasoning: { effort: "max" } },
    { type: "reasoning", summary: [], encrypted_content: "x" },
    { type: "reasoning", summary: [], reasoning_content: "plan" },
    { type: "function_call", call_id: "a", name: "set_brief", arguments: "{}" },
    { type: "function_call", call_id: "b", name: "find_materials", arguments: "{}" },
    { type: "function_call_output", call_id: "a", output: '{"ok":1}' },
    { role: "user", content: [picture] },
    { type: "function_call_output", call_id: "b", output: "{}" },
    { type: "web_search_call", action: { type: "search", query: "q" } },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
  ]);
  expect(messages).toEqual([
    { role: "system", content: "sys" },
    { role: "user", content: [{ type: "text", text: "draw" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] },
    {
      role: "assistant",
      content: null,
      reasoning_content: "plan",
      tool_calls: [
        { id: "a", type: "function", function: { name: "set_brief", arguments: "{}" } },
        { id: "b", type: "function", function: { name: "find_materials", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "a", content: '{"ok":1}' },
    { role: "tool", tool_call_id: "b", content: "{}" },
    { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] },
    { role: "assistant", content: "Done." },
  ]);
});
it("names pictures in words for a model that cannot see, and keeps its reasoning from the Responses API", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(chunks([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]))));
  await generate({ ...deepseek, vision: false }, { instructions: "", input: [{ role: "user", content: [{ type: "input_image", image_url: "data:," }] }], tools: [], signal: new AbortController().signal });
  const sent = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
  expect(JSON.stringify(sent.messages)).not.toContain("image_url");
  expect(sent.messages[1].content[0].text).toContain("cannot see pictures");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(chunks([{ type: "response.completed", response: { usage: {} } }]))),
  );
  await generate(role, { instructions: "", input: [{ type: "reasoning", summary: [], reasoning_content: "mine" }, { role: "user", content: "hi" }], tools: [], signal: new AbortController().signal });
  const responses = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
  expect(responses.input).toEqual([{ role: "user", content: "hi" }]);
});
it("fails a Chat Completions turn cut off by its output limit", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(chunks([{ choices: [{ delta: { content: "x" }, finish_reason: "length" }] }]))));
  await expect(generate(deepseek, { instructions: "", input: [], tools: [], signal: new AbortController().signal })).rejects.toThrow("截断");
});
