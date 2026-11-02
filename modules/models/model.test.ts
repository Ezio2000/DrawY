import { it, expect, vi, afterEach } from "vitest";
import { generate } from "./index.ts";
import type { Role } from "../contracts/index.ts";
const role: Role = {
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
  const result = await generate(
    role,
    "test",
    [],
    [],
    new AbortController().signal,
  );
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
    generate(role, "", [], [], new AbortController().signal),
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
    generate(role, "", [], [], new AbortController().signal),
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
    await generate(
      { ...role, channel, speed },
      "",
      [],
      [],
      new AbortController().signal,
    );
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
    await generate(
      { ...role, channel },
      "test",
      [],
      [],
      new AbortController().signal,
      undefined,
      undefined,
      "work-1",
    );
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
  const result = await generate({ ...role, channel: "api" }, "", [], [{ type: "web_search" }], new AbortController().signal);
  expect(result.items).toEqual(items);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).tools).toEqual([{ type: "web_search" }]);
  const { citationsOf } = await import("./index.ts");
  expect(citationsOf([{ type: "message", content: [{ text: "前言" }] }, ...result.items])).toEqual([{ start: 3, end: 6, url: "https://openai.com/", title: "OpenAI" }]);
});
