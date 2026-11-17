import { afterEach, expect, it, vi } from "vitest";
import { defaultRole, protocolFor, type Role } from "../contracts/index.ts";
import { CutOff, adapterFor, citationsOf, forResponses, generate, interactionsTools, textOf, toSteps } from "./index.ts";
import { endpointOf, toUsage, utf16Offsets } from "./interactions.ts";

const role: Role = {
  ...defaultRole(),
  channel: "api",
  protocol: "interactions",
  baseUrl: "https://generativelanguage.googleapis.com",
  credential: "AIza-test",
  model: "gemini-4-hydrogen",
  efforts: ["low", "medium", "high"],
  effort: "medium",
  speed: "default",
};

const sse = (events: Array<[string, object]>) =>
  events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");

afterEach(() => vi.unstubAllGlobals());

it("detects interactions protocol for generativelanguage.googleapis.com and normalizes endpoints", () => {
  expect(protocolFor({ channel: "api", baseUrl: "https://generativelanguage.googleapis.com" })).toBe("interactions");
  expect(endpointOf("https://generativelanguage.googleapis.com")).toBe(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
  expect(endpointOf("https://generativelanguage.googleapis.com/")).toBe(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
  expect(endpointOf("https://generativelanguage.googleapis.com/v1beta")).toBe(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
});

it("streams thought signatures, function calls, google search and usage from Interactions SSE", async () => {
  const payload = sse([
    ["interaction.created", { event_type: "interaction.created", interaction: { id: "int_1", model: "gemini-4-hydrogen" } }],
    ["step.start", { event_type: "step.start", index: 0, step: { type: "thought" } }],
    ["step.delta", { event_type: "step.delta", index: 0, delta: { type: "thought_summary", content: { type: "text", text: "Planning..." } } }],
    ["step.delta", { event_type: "step.delta", index: 0, delta: { type: "thought_signature", signature: "sig_thought" } }],
    ["step.stop", { event_type: "step.stop", index: 0 }],
    ["step.start", { event_type: "step.start", index: 1, step: { type: "google_search_call", id: "gs_1" } }],
    ["step.delta", { event_type: "step.delta", index: 1, delta: { type: "google_search_call", arguments: { queries: ["tokyo weather"] }, signature: "sig_gs1" } }],
    ["step.stop", { event_type: "step.stop", index: 1 }],
    ["step.start", { event_type: "step.start", index: 2, step: { type: "google_search_result", call_id: "gs_1" } }],
    ["step.delta", { event_type: "step.delta", index: 2, delta: { type: "google_search_result", result: [{ search_suggestions: "<div/>" }], is_error: false, signature: "sig_gs2" } }],
    ["step.stop", { event_type: "step.stop", index: 2 }],
    ["step.start", { event_type: "step.start", index: 3, step: { type: "function_call", id: "call_1", name: "write_work", arguments: {} } }],
    ["step.delta", { event_type: "step.delta", index: 3, delta: { type: "arguments_delta", arguments: '{"scenes":[]}' } }],
    ["step.stop", { event_type: "step.stop", index: 3 }],
    ["step.start", { event_type: "step.start", index: 4, step: { type: "model_output" } }],
    ["step.delta", { event_type: "step.delta", index: 4, delta: { type: "text", text: "Done." } }],
    [
      "step.delta",
      {
        event_type: "step.delta",
        index: 4,
        delta: {
          type: "text_annotation_delta",
          annotations: [{ type: "url_citation", url: "https://example.com", title: "Example", start_index: 0, end_index: 5 }],
        },
      },
    ],
    ["step.stop", { event_type: "step.stop", index: 4 }],
    [
      "interaction.completed",
      {
        event_type: "interaction.completed",
        interaction: {
          id: "int_1",
          model: "gemini-4-hydrogen",
          status: "completed",
          usage: {
            total_input_tokens: 100,
            total_cached_tokens: 40,
            total_output_tokens: 25,
            total_thought_tokens: 15,
          },
        },
      },
    ],
  ]);

  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(payload)),
  );
  const answer = await generate(
    { ...role, speed: "fast" },
    {
      instructions: "Draw cleanly",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Hello" },
            { type: "input_image", image_url: "data:image/png;base64,AAA=" },
          ],
        },
      ],
      tools: [
        { type: "function", name: "write_work", description: "Write", parameters: { type: "object" } },
        { type: "web_search" },
      ],
      effort: "high",
      onEvent: (e) => seen.push(e.type),
      signal: new AbortController().signal,
    },
  );

  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
  const reqHeaders = init?.headers as Record<string, string>;
  expect(reqHeaders["x-goog-api-key"]).toBe("AIza-test");
  expect(reqHeaders.Authorization).toBeUndefined();
  const body = JSON.parse(init?.body as string);
  expect(body).toMatchObject({
    model: "gemini-4-hydrogen",
    system_instruction: "Draw cleanly",
    service_tier: "priority",
    store: false,
    stream: true,
    generation_config: { thinking_level: "high", thinking_summaries: "auto" },
    tools: [
      { type: "function", name: "write_work" },
      { type: "google_search" },
    ],
  });
  expect(body.input).toEqual([
    {
      type: "user_input",
      content: [
        { type: "text", text: "Hello" },
        { type: "image", mime_type: "image/png", data: "AAA=" },
      ],
    },
  ]);

  expect(seen).toContain("response.reasoning_summary_text.delta");
  expect(seen).toContain("response.function_call_arguments.delta");
  expect(seen).toContain("response.output_text.delta");
  expect(answer.usage).toEqual({
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 40 },
    output_tokens: 40,
    output_tokens_details: { reasoning_tokens: 15 },
  });
  expect(answer.items.map((i) => i.type)).toEqual(["reasoning", "web_search_call", "function_call", "message"]);
  expect(answer.items[0].interactions).toEqual({
    type: "thought",
    signature: "sig_thought",
    summary: [{ type: "text", text: "Planning..." }],
  });
  expect(answer.items[2].interactions).toEqual({
    type: "function_call",
    id: "call_1",
    name: "write_work",
    arguments: { scenes: [] },
  });

  // Round-trip back into stateless steps and clean stripping for OpenAI Responses.
  const nextSteps = toSteps(
    [
      ...answer.items,
      { type: "function_call_output", call_id: "call_1", output: '{"ok":true}' },
    ],
    true,
  );
  expect(nextSteps.map((s) => s.type)).toEqual([
    "thought",
    "google_search_call",
    "google_search_result",
    "function_call",
    "model_output",
    "function_result",
  ]);
  const stripped = forResponses(answer.items);
  expect(stripped.map((i) => i.type)).toEqual(["function_call", "message"]);
  expect("interactions" in stripped[0]).toBe(false);
});

it("falls back foreign tool calls to text and defers screenshots until open calls settle", () => {
  const steps = toSteps(
    [
      { role: "developer", content: "User preferences: clean" },
      { role: "user", content: "Go" },
      // Foreign function call without interactions metadata -> serialized as text
      { type: "function_call", call_id: "foreign_1", name: "read_work", arguments: "{}" },
      { type: "function_call_output", call_id: "foreign_1", output: "{}" },
      // Gemini function call with interactions metadata + interleaved user message
      {
        type: "function_call",
        call_id: "gem_1",
        name: "view_canvas",
        arguments: "{}",
        interactions: { type: "function_call", id: "gem_1", name: "view_canvas", arguments: {} },
      },
      { role: "user", content: [{ type: "input_image", image_url: "https://example.com/a.png" }] },
      { type: "function_call_output", call_id: "gem_1", output: '{"viewed":true}' },
    ],
    true,
  );
  expect(steps).toEqual([
    { type: "user_input", content: [{ type: "text", text: "User preferences: clean" }, { type: "text", text: "Go" }] },
    { type: "model_output", content: [{ type: "text", text: "[Called read_work: {}]" }] },
    { type: "user_input", content: [{ type: "text", text: "[Result of read_work: {}]" }] },
    { type: "function_call", id: "gem_1", name: "view_canvas", arguments: {} },
    { type: "function_result", call_id: "gem_1", name: "view_canvas", result: [{ type: "text", text: '{"viewed":true}' }] },
    { type: "user_input", content: [{ type: "image", uri: "https://example.com/a.png" }] },
  ]);
});

it("reports CutOff when incomplete and narrows allowed_tools in validated mode", async () => {
  const adapter = adapterFor("interactions");
  expect(adapter.effortControl(role)).toBe("request");
  expect(
    adapter.narrow!(
      [
        { type: "function", name: "write_work" },
        { type: "function", name: "web_search" },
        { type: "web_search" },
      ],
      0,
      (t) => t.name === "web_search" || t.type === "web_search",
      { toolLimits: true },
    ),
  ).toEqual({
    tool_choice: {
      allowed_tools: { mode: "validated", tools: ["write_work"] },
    },
  });
  expect(interactionsTools([{ type: "web_search" }])).toEqual([{ type: "google_search" }]);
  expect(toUsage({ total_input_tokens: 10, total_output_tokens: 0, total_thought_tokens: 50 })).toMatchObject({
    input_tokens: 10,
    output_tokens: 50,
    output_tokens_details: { reasoning_tokens: 50 },
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        sse([
          ["step.start", { event_type: "step.start", index: 0, step: { type: "thought" } }],
          ["step.stop", { event_type: "step.stop", index: 0 }],
          [
            "interaction.completed",
            {
              event_type: "interaction.completed",
              interaction: { status: "incomplete", usage: { total_output_tokens: 0, total_thought_tokens: 100 } },
            },
          ],
        ]),
      ),
    ),
  );
  const err = await generate(role, { instructions: "", input: [{ role: "user", content: "hi" }], signal: new AbortController().signal }).catch((e) => e);
  expect(err).toBeInstanceOf(CutOff);
  expect(err.thoughtOnly).toBe(true);
});

it("resumes requires_continuation hops, converts UTF-8 citation byte offsets, and emits part.added per thought step", async () => {
  // "你好🚀世界": UTF-8 bytes = 3 + 3 + 4 + 3 + 3 = 16; JS UTF-16 length = 1 + 1 + 2 + 1 + 1 = 6.
  const text = "你好🚀世界";
  expect(utf16Offsets(text)[10]).toBe(4);
  expect(utf16Offsets(text)[16]).toBe(6);

  const hop1 = sse([
    ["step.start", { event_type: "step.start", index: 0, step: { type: "thought" } }],
    ["step.delta", { event_type: "step.delta", index: 0, delta: { type: "thought_summary", content: { type: "text", text: "First thought" } } }],
    ["step.stop", { event_type: "step.stop", index: 0 }],
    ["step.start", { event_type: "step.start", index: 1, step: { type: "model_output" } }],
    ["step.delta", { event_type: "step.delta", index: 1, delta: { type: "text", text: "你好" } }],
    ["step.stop", { event_type: "step.stop", index: 1 }],
    [
      "interaction.completed",
      {
        event_type: "interaction.completed",
        interaction: {
          status: "requires_continuation",
          continuation_token: "tok_1",
          usage: { total_input_tokens: 10, total_cached_tokens: 2, total_output_tokens: 5, total_thought_tokens: 3 },
        },
      },
    ],
  ]);
  const hop2 = sse([
    ["step.start", { event_type: "step.start", index: 0, step: { type: "thought" } }],
    ["step.delta", { event_type: "step.delta", index: 0, delta: { type: "thought_summary", content: { type: "text", text: "Second thought" } } }],
    ["step.stop", { event_type: "step.stop", index: 0 }],
    ["step.start", { event_type: "step.start", index: 1, step: { type: "model_output" } }],
    ["step.delta", { event_type: "step.delta", index: 1, delta: { type: "text", text: "🚀世界" } }],
    [
      "step.delta",
      {
        event_type: "step.delta",
        index: 1,
        // UTF-8 byte offsets within "🚀世界" (🚀 is 4 bytes -> JS index 2, 界 ends at byte 10 -> JS index 4)
        delta: {
          type: "text_annotation_delta",
          annotations: [{ type: "url_citation", url: "https://example.com", title: "Ex", start_index: 4, end_index: 10 }],
        },
      },
    ],
    ["step.stop", { event_type: "step.stop", index: 1 }],
    [
      "interaction.completed",
      {
        event_type: "interaction.completed",
        interaction: {
          status: "completed",
          usage: { total_input_tokens: 12, total_cached_tokens: 8, total_output_tokens: 7, total_thought_tokens: 4 },
        },
      },
    ],
  ]);

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(hop1))
    .mockResolvedValueOnce(new Response(hop2));
  vi.stubGlobal("fetch", fetchMock);

  const events: string[] = [];
  const answer = await generate(role, {
    instructions: "Be brief",
    input: [{ role: "user", content: "Hi" }],
    onEvent: (e) => events.push(e.type),
    signal: new AbortController().signal,
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  const hop2Body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
  expect(hop2Body.continuation_token).toBe("tok_1");
  expect(hop2Body.input).toEqual([{ type: "user_input", content: [{ type: "text", text: "Hi" }] }]);

  // Each thought step emitted its own reasoning_summary_part.added
  expect(events.filter((t) => t === "response.reasoning_summary_part.added")).toHaveLength(2);
  expect(textOf(answer.items)).toBe("你好🚀世界");
  // "你好" (len 2) + citation covering "世界" (JS indices 2..4 inside hop2 -> 4..6 in combined text)
  expect(citationsOf(answer.items)).toEqual([{ start: 4, end: 6, url: "https://example.com", title: "Ex" }]);
  // Preserved raw byte offsets in the Interactions step
  const secondMsg = answer.items.filter((i) => i.type === "message")[1];
  expect(secondMsg.interactions.content[0].annotations[0]).toMatchObject({ start_index: 4, end_index: 10 });
  // Summed usage across hops
  expect(answer.usage).toEqual({
    input_tokens: 22,
    input_tokens_details: { cached_tokens: 10 },
    output_tokens: 19,
    output_tokens_details: { reasoning_tokens: 7 },
  });

  // Missing continuation_token throws CutOff instead of returning partial as completed
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        sse([
          ["step.start", { event_type: "step.start", index: 0, step: { type: "model_output" } }],
          ["step.delta", { event_type: "step.delta", index: 0, delta: { type: "text", text: "partial" } }],
          ["step.stop", { event_type: "step.stop", index: 0 }],
          ["interaction.completed", { event_type: "interaction.completed", interaction: { status: "requires_continuation" } }],
        ]),
      ),
    ),
  );
  await expect(
    generate(role, { instructions: "", input: [{ role: "user", content: "hi" }], signal: new AbortController().signal }),
  ).rejects.toBeInstanceOf(CutOff);
});

