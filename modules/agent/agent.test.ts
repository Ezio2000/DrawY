import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../storage/index.ts";
import { register } from "../identity/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { Agent, steering, SEARCH_LIMIT, withLessThought } from "./index.ts";
import { settleSchema } from "./tools.ts";
import { restore, writeWork } from "../workspace/index.ts";
import { partialJson } from "./partial.ts";
import { CutOff, generate } from "../models/index.ts";
import { observe, Unavailable } from "../observation/index.ts";
import { boxOf, costOf, labelOf, modelCatalogSchema, type Run, type Step, type Work } from "../contracts/index.ts";
import { removeParts, setData } from "../editing/index.ts";
import { tracer } from "../trace/index.ts";
import { library as client } from "../materials/index.ts";
import { serveLibrary, picture, solid } from "@drawy/materials/testing";
let library: ReturnType<typeof serveLibrary>;
beforeEach(() => {
  library = serveLibrary(client.base);
});
afterEach(() => library.close());
vi.mock("../models/index.ts", async (original) => ({
  ...(await original<object>()),
  generate: vi.fn(),
}));
vi.mock("../observation/index.ts", async (original) => ({
  ...(await original<object>()),
  observe: vi.fn(async (store, workId) => ({
    observation: {
      at: Date.now(),
      revision: store.work(workId).revision,
      sceneIds: ["root"],
      overview: true,
      screenshots: [],
      errors: [],
    },
    content: [
      { type: "input_image", image_url: "data:image/png;base64,dmlzaWJsZQ==" },
    ],
    inspected: { calls: 0, cost: 0 },
  })),
}));
/** What a scripted turn says: a tool call, or for `finish` the closing words of a turn
 * without calls, which is how a run ends. */
const answer = (name: string, args: unknown, call_id: string) =>
  name === "finish"
    ? {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: (typeof args === "string" ? JSON.parse(args) : (args as { message: string })).message,
          },
        ],
      }
    : {
        type: "function_call",
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args),
        call_id,
      };

it("feeds canvas images into the author conversation and requires another look after edits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const run: Run = {
      id: "run",
      workId: work.id,
      sceneId: "root",
      status: "running",
      steps: [],
      observations: [],
      startedAt: Date.now(),
    };
    store.saveRun(run);
    const ctx = { input: [] as any[], settings: store.settings(), generations: 0 };
    const calls = [
      ["finish", { message: "premature" }],
      ["view_canvas", {}],
      ["write_work", { title: "edited" }],
      ["finish", { message: "stale" }],
      ["view_canvas", {}],
      ["finish", { message: "done" }],
    ] as const;
    let turn = 0,
      sawImage = false;
    vi.mocked(generate).mockImplementation(
      async (_role, { input, onEvent }) => {
        if (turn === 0)
          for (const event of [
            { type: "response.reasoning_summary_part.added" },
            {
              type: "response.reasoning_summary_text.delta",
              delta: "**Checking",
            },
            {
              type: "response.reasoning_summary_text.delta",
              delta: " the canvas**",
            },
          ])
            onEvent!(event);
        if (turn === 1)
          onEvent!({
            type: "response.output_item.added",
            item: { type: "function_call", name: "view_canvas", call_id: "c2" },
          });
        if (turn === 2)
          sawImage = input.some(
            (x) =>
              x.role === "user" &&
              Array.isArray(x.content) && x.content.some((v: any) => v.type === "input_image"),
          );
        const [name, args] = calls[turn++];
        return { items: [answer(name, args, "c" + turn)], usage: {}, response: {} };
      },
    );
    await new Agent(() => {}).execute(store, run, ctx, "request");
    expect(sawImage).toBe(true);
    expect(run.status).toBe("completed");
    expect(
      run.steps.map((s) =>
        s.kind === "tool" ? [s.name, s.status] : [s.kind, s.text],
      ),
    ).toEqual([
      ["thinking", "**Checking the canvas**"],
      ["message", "premature"],
      ["view_canvas", "done"],
      ["write_work", "done"],
      ["message", "stale"],
      ["view_canvas", "done"],
      ["message", "done"],
    ]);
    expect(run.steps[3]).toMatchObject({ revision: 2, removed: 0 });
    expect(run.observations.map((o) => o.revision)).toEqual([1, 2]);
    // Closing words before the latest revision was seen are answered with what is missing.
    const held = ctx.input.filter(
      (x) => x.role === "user" && String(x.content).startsWith("The work is not done yet: "),
    );
    expect(held).toHaveLength(2);
    expect(
      store
        .context("run")
        .input.some(
          (x: any) =>
            x.role === "user" &&
            Array.isArray(x.content) && x.content.some((v: any) => v.type === "input_image"),
        ),
    ).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
it("parses the finished part of streamed tool arguments", () => {
  expect(partialJson('{"a":[1,2')).toEqual({ a: [1] });
  expect(partialJson('{"s":"x,{y')).toEqual({});
  expect(partialJson('[{"b":{"x":1,"w":2}},{"b":{"x":')).toEqual([
    { b: { x: 1, w: 2 } },
    { b: {} },
  ]);
  expect(partialJson('{"q":"a\\"],"')).toEqual({});
  expect(partialJson("tru")).toBeUndefined();
});
it("lays out streamed modules on the write step before the write is saved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const run: Run = {
      id: "run",
      workId: work.id,
      sceneId: "root",
      status: "running",
      steps: [],
      observations: [],
      startedAt: Date.now(),
    };
    store.saveRun(run);
    const scene = work.scenes.root,
      flat = scene.modules.map(({ bounds, ...m }) => ({ ...m, bounds: boxOf(bounds) })),
      args = JSON.stringify({ modules: flat,
        links: scene.links,
        drawings: Object.values(work.drawings),
      }),
      cut = args.indexOf(JSON.stringify(flat[3])),
      writing = Object.values(work.drawings)[0],
      // Part way through the first drawing's source.
      within = args.indexOf(JSON.stringify(writing.source)) + 8;
    const laid: number[] = [],
      written: (string | undefined)[] = [];
    const calls = [
      ["write_work", args],
      ["view_canvas", "{}"],
      ["finish", '{"message":"done"}'],
    ];
    let turn = 0;
    vi.mocked(generate).mockImplementation(
      async (_role, { onEvent }) => {
        if (turn === 0) {
          onEvent!({
            type: "response.output_item.added",
            item: { id: "m", type: "message" },
          });
          onEvent!({ type: "response.output_text.delta", delta: "先起稿" });
          onEvent!({
            type: "response.output_item.added",
            item: {
              id: "w",
              type: "function_call",
              name: "write_work",
              call_id: "c0",
            },
          });
          for (const delta of [
            args.slice(0, cut),
            args.slice(cut, within),
            args.slice(within),
          ]) {
            onEvent!({
              type: "response.function_call_arguments.delta",
              item_id: "w",
              delta,
            });
            await new Promise((r) => setTimeout(r, 300));
          }
          onEvent!({ type: "response.output_item.done", item: { id: "w" } });
        }
        const [name, value] = calls[turn];
        return {
          items: [
            ...(turn === 0
              ? [
                  {
                    type: "message",
                    content: [{ type: "output_text", text: "先起稿" }],
                  },
                ]
              : []),
            answer(name, value, "c" + turn++),
          ],
          usage: {},
          response: {},
        };
      },
    );
    await new Agent((_user, event: any) => {
      const step = event.run?.steps.find((s: any) => s.name === "write_work");
      if (step?.status === "running") {
        laid.push(step.scenes[0]?.modules.length);
        written.push(step.writing);
      }
    }).execute(store, run, { input: [], settings: store.settings(), generations: 0 }, "request");
    expect(run.status).toBe("completed");
    expect(laid).toContain(3);
    expect(written).toContain(writing.id);
    expect(run.steps[0]).toEqual({
      kind: "message",
      role: "assistant",
      text: "先起稿",
    });
    expect(run.steps[1]).toMatchObject({
      status: "done",
      drawings: Object.keys(work.drawings),
      scenes: [
        {
          id: "root",
          modules: scene.modules.map(({ id, label, bounds, data }) => ({
            id,
            label: labelOf({ id: "", label, data }),
            bounds,
          })),
        },
      ],
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("pins settings and billing across answers, other works and a storage restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-run-settings-"));
  let db = new Storage(dir);
  try {
    const user = register(db, "author", "abcdef").id;
    let store = db.scoped(user);
    const catalog = db.models();
    const first = catalog.writers[0].models[0];
    first.model = "writer-a";
    first.prices = { input: 2, cached: 0.2, cacheWrite: 2.5, output: 10, search: 0.01 };
    catalog.writers[0].models.push({ ...structuredClone(first), id: "writer-b", model: "writer-b" });
    const image = catalog.painters[0].models[0].id;
    catalog.labels = [
      { id: "a", name: "A", description: "", writer: first.id, web: "builtin", image },
      { id: "b", name: "B", description: "", writer: "writer-b", web: "off", image },
    ];
    catalog.defaults.label = "a";
    db.saveModels(modelCatalogSchema.parse(catalog));
    const work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const original = store.settings();
    vi.mocked(generate).mockReset();
    vi.mocked(generate).mockImplementation(async () => ({
      items: [{ type: "function_call", name: "ask_user", call_id: crypto.randomUUID(),
        arguments: JSON.stringify({ questions: [{ id: "focus", text: "Which focus?", options: [{ label: "Orbits" }, { label: "Scale" }] }] }) }],
      usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 }, output_tokens: 100 },
      response: {},
    }));
    let agent = new Agent(() => {});
    const run = await agent.start(store, work.id, "root", "Solar system");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    const before = store.run(run.id);
    const cost = costOf(before.usage, before.prices)!.total;

    // A selection elsewhere and an administrator's price/connection edits must not
    // change the model, tools or prices of the task already waiting for an answer.
    store.saveOwnSettings({ ...store.ownSettings(), label: "b", preferences: "New preference" });
    catalog.writers[0].credential = "new-credential";
    for (const model of catalog.writers[0].models) model.prices.output = 99;
    catalog.painters[0].models[0].model = "new-painter";
    db.saveModels(modelCatalogSchema.parse(catalog));
    const current = store.settings();
    expect(current.author.model).toBe("writer-b");
    expect(current).not.toEqual(original);
    const other = { ...fixture(), id: "other-work", revision: 0 };
    store.commit(other, 0, { kind: "edit" });
    const otherRun = await agent.start(store, other.id, "root", "Another picture");
    await vi.waitFor(() => expect(store.run(otherRun.id).status).toBe("waiting"));
    expect(vi.mocked(generate).mock.calls.at(-1)![0]).toEqual(current.author);

    db.close();
    db = new Storage(dir);
    store = db.scoped(user);
    agent = new Agent(() => {});
    await agent.resume(store, run.id, "Orbits");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    expect(vi.mocked(generate).mock.calls.at(-1)![0]).toEqual(original.author);
    expect(store.context(run.id).settings).toEqual(original);
    const resumed = store.run(run.id);
    expect(resumed.services).toEqual(before.services);
    expect(resumed.prices).toEqual(before.prices);
    expect(resumed.usage!.input).toBe(2000);
    expect(costOf(resumed.usage, resumed.prices)!.total).toBeCloseTo(cost * 2);
    expect(resumed).not.toHaveProperty("settings");

    // New requests on the same work use today's selection, not the previous snapshot.
    agent.cancel(store, run.id);
    const next = await agent.start(store, work.id, "root", "Continue");
    await vi.waitFor(() => expect(store.run(next.id).status).toBe("waiting"));
    expect(vi.mocked(generate).mock.calls.at(-1)![0]).toEqual(current.author);
    expect(store.context(next.id).settings).toEqual(current);
    expect(store.run(next.id).prices).toEqual(current.prices);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("continues the exact context across turns and accepts images in answers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const reference = await client.ingest(
      await picture(),
      "image/png",
      {
        role: "object",
        name: { zh: "参考", en: "reference" },
        style: null,
        origin: { kind: "upload" },
      },
      store.userId,
    );
    const agent = new Agent(() => {});
    vi.mocked(generate).mockImplementation(async () => ({
      items: [
        {
          type: "function_call",
          name: "ask_user",
          call_id: crypto.randomUUID(),
          arguments: JSON.stringify({
            questions: [
              {
                id: "style",
                text: "Which style?",
                options: [
                  { label: "Textbook", materials: ["textbook"] },
                  { label: "Crayon", materials: ["crayon", "missing"] },
                ],
              },
            ],
          }),
        },
      ],
      usage: {},
      response: {},
    }));
    const run = await agent.start(store, work.id, "root", "Match this", [
      reference.id,
    ]);
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    expect(store.run(run.id).questions![0].options[1]).toMatchObject({
      label: "Crayon",
      // A style option shows the style's own samples.
      pictures: [
        {
          id: "lighthouse-crayon",
          url: "/materials/thumbs/lighthouse-crayon?size=256",
        },
        { id: "apple-crayon" },
        { id: "earth" },
      ],
    });
    const initial = store.context(run.id).input;
    await agent.resume(store, run.id, "Five panels", [reference.id]);
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    const answered = store.context(run.id).input;
    expect(answered.slice(0, initial.length)).toEqual(initial);
    expect(answered[initial.length].content[1].text).toMatch(
      /^Attached picture /,
    );
    expect(answered[initial.length].content[2].image_url).toMatch(
      /^data:image\/webp;base64,/,
    );
    expect(
      store
        .run(run.id)
        .steps.findLast((s) => s.kind === "message" && s.role === "user"),
    ).toMatchObject({ materials: [reference.id] });
    // The question asked is kept in the conversation, before its answer.
    expect(store.run(run.id).steps.at(-1)).toMatchObject({
      role: "assistant",
      asked: true,
    });
    agent.cancel(store, run.id);
    const current = store.work(work.id);
    store.commit({ ...current, title: "Manually edited" }, current.revision, {
      kind: "edit",
    });
    const next = await agent.start(store, work.id, "root", "Continue");
    await vi.waitFor(() => expect(store.run(next.id).status).toBe("waiting"));
    const continued = store.context(next.id).input;
    expect(continued.slice(0, answered.length)).toEqual(answered);
    expect(continued[answered.length + 1].content).toContain("Manually edited");
    expect(store.run(next.id).steps[0]).toMatchObject({ text: "Continue" });
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("compacts at the budget with original references and closes interrupted tool batches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const reference = await client.ingest(
      await picture(),
      "image/png",
      {
        role: "object",
        name: { zh: "参考", en: "reference" },
        style: null,
        origin: { kind: "upload" },
      },
      store.userId,
    );
    const run: Run = {
      id: "budget",
      workId: work.id,
      sceneId: "root",
      status: "running",
      steps: [
        {
          kind: "message",
          role: "user",
          text: "Match",
          materials: [reference.id],
        },
      ],
      observations: [],
      startedAt: Date.now(),
    };
    store.saveRun(run);
    const ctx = {
      input: [
        { role: "user", content: "x".repeat(600001) },
        { type: "configuration_update", reasoning: { effort: "max" } },
      ] as any[],
      settings: store.settings(), generations: 0,
    };
    let turn = 0;
    const agent = new Agent(() => {});
    const requests: { instructions: string; tools: unknown; cacheKey?: string }[] = [];
    const before = structuredClone(ctx.input);
    vi.mocked(generate).mockImplementation(
      async (role, { input, tools, budget, instructions, cacheKey }) => {
        requests.push({ instructions, tools, cacheKey });
        if (turn++ === 0) {
          // A summary is asked of the conversation as it stands, after it, so the cached
          // prefix is read rather than paid for again; with room to finish.
          expect(input.slice(0, before.length)).toEqual(before);
          expect(input.at(-1)).toMatchObject({ role: "user" });
          expect(String(input.at(-1)!.content)).toContain("Summarize this drawing conversation");
          expect(budget).toBe(16384);
          // With little reasoning: in the conversation where its format takes that, else on the request.
          const lowered = input.at(-2)!;
          if (lowered.type === "configuration_update") {
            expect(lowered.reasoning.effort).not.toBe("max");
            expect(role.effort).toBe(store.settings().author.effort);
          } else expect(role.effort).toBe("low");
          return {
            items: [
              {
                type: "message",
                content: [{ type: "output_text", text: "Keep five panels" }],
              },
            ],
            usage: {},
            response: {},
          };
        }
        // The standing preferences, then the summary, then the work.
        expect(input[0].content).toBe("User preferences: none");
        expect(input[1].content[0].text).toContain("Keep five panels");
        expect(input[1].content[1].text).toContain(reference.id);
        expect(input[1].content[2].image_url).toMatch(/^data:image\/webp/);
        expect(input[2].content).toContain(work.id);
        agent.cancel(store, run.id);
        return {
          items: ["one", "two"].map((call_id) => ({
            type: "function_call",
            name: "read_work",
            arguments: "{}",
            call_id,
          })),
          usage: {},
          response: {},
        };
      },
    );
    await agent.execute(store, run, ctx, "request");
    // The same instructions, tools and cache key as the turns around it.
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect((requests[0].tools as unknown[]).length).toBeGreaterThan(0);
    expect(store.run(run.id).status).toBe("cancelled");
    expect(
      store
        .context(run.id)
        .input.filter((i: any) => i.type === "function_call_output")
        .map((i: any) => i.call_id),
    ).toEqual(["one", "two"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("goes on without old pictures when a summary fails, and sizes the context by reported usage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const run: Run = {
      id: "fallback",
      workId: work.id,
      sceneId: "root",
      status: "running",
      steps: [{ kind: "message", role: "user", text: "Go" }],
      observations: [],
      startedAt: Date.now(),
    };
    store.saveRun(run);
    const shot = (n: number) => ({
      role: "user",
      content: [
        { type: "input_text", text: "look " + n },
        { type: "input_image", image_url: "data:image/webp;base64,AAAA" },
      ],
    });
    const ctx = {
      input: [
        { role: "user", content: "x".repeat(600001) },
        shot(1),
        shot(2),
        shot(3),
      ] as any[],
      settings: store.settings(), generations: 0,
    };
    const agent = new Agent(() => {});
    const seen: any[][] = [];
    let summaries = 0;
    vi.mocked(generate).mockImplementation(async (_role, { input }) => {
      if (String(input.at(-1)?.content).includes("Summarize this drawing conversation")) {
        summaries++;
        throw Error("模型输出被截断");
      }
      seen.push(input);
      if (seen.length === 1)
        return {
          items: [
            {
              type: "reasoning",
              // Encrypted reasoning reads as far more text than it costs.
              encrypted_content: "e".repeat(600000),
            },
            { type: "function_call", name: "read_work", arguments: "{}", call_id: "r" },
          ],
          usage: { input_tokens: 190000, output_tokens: 100 },
          response: {},
        };
      agent.cancel(store, run.id);
      return { items: [], usage: {}, response: {} };
    });
    await agent.execute(store, run, ctx, "request");
    // The failed summary left the run going, with only the latest two pictures.
    expect(seen.length).toBe(2);
    const pictures = seen[0].filter(
      (i: any) =>
        Array.isArray(i.content) &&
        i.content.some((c: any) => c.type === "input_image"),
    );
    expect(pictures.map((i: any) => i.content[0].text)).toEqual(["look 2", "look 3"]);
    // The second turn did not summarize again: the reported 190k tokens plus the work stay below the 200k threshold.
    expect(summaries).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

type Call = [string, unknown];
/** Answers each model turn with the next scripted tool call, or with several calls when a
 * turn is a list of them. A scripted `finish` is the closing words of a turn without calls. */
function script(turns: (Call | Call[])[], seen: any[][] = []) {
  let turn = 0;
  vi.mocked(generate).mockImplementation(
    async (_role, { input }) => {
      seen.push(structuredClone(input));
      const step = turns[turn++];
      const calls = (Array.isArray(step[0]) ? step : [step]) as Call[];
      return {
        items: calls.map(([name, args], i) =>
          name === "finish"
            ? {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: (args as { message: string }).message }],
              }
            : {
                type: "function_call",
                name,
                arguments: JSON.stringify(args),
                call_id: "c" + turn + (i ? "-" + i : ""),
              },
        ),
        usage: {},
        response: {},
      };
    },
  );
}
/** A call's output read back: JSON where it is, text otherwise (guides are text). */
const parsed = (output: string) => {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
};
const outputs = (input: any[]) =>
  input
    .filter((x) => x.type === "function_call_output")
    .map((x) => x.output as string);
it("thinks at the configured effort on every turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    vi.mocked(generate).mockClear();
    const seen: any[][] = [];
    script(
      [
        ["write_work", { title: "edited" }],
        ["view_canvas", {}],
        ["write_work", { title: "again" }],
        ["view_canvas", {}],
        ["finish", { message: "done" }],
      ],
      seen,
    );
    const run = await new Agent(() => {}).start(store, work.id, "root", "画");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("completed"));
    // No turn changes the effort in the conversation or asks for another one.
    expect(seen.flat().some((i) => i.type === "configuration_update")).toBe(false);
    for (const [role, turn] of vi.mocked(generate).mock.calls) {
      expect(role.effort).toBe("medium");
      expect(turn.effort).toBe("medium");
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
it("settles a brief only on the user's own words, then applies its style and shows the cast", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.brief = null;
    for (const s of Object.values(work.scenes)) s.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const brief = {
      subject: "苹果（水果）的结构",
      intent: "果皮、果肉、果核与种子",
      audience: "初中生",
      ideas: [
        { kind: "anatomy", idea: "一只纵切开的苹果，由外向内指出各层" },
        { kind: "change", idea: "从花到果的四个时刻，看各部分从哪里长出来" },
      ],
      concept: "一只纵切开的苹果占满画面，由外向内依次指出果皮、果肉、果核与种子",
      register: "formal",
      style: "textbook",
      direction: "剖面线描",
      cast: ["苹果", "种子"],
      basis: { subject: "苹果", intent: "苹果", register: "严谨" },
    };
    const seen: any[][] = [];
    script(
      [
        ["set_brief", brief],
        [
          "ask_user",
          {
            questions: [
              {
                id: "focus",
                text: "画苹果的什么？",
                options: [{ label: "结构" }, { label: "生长" }],
              },
            ],
          },
        ],
        [
          "set_brief",
          {
            ...brief,
            // Quotes set end to end are checked one by one.
            basis: { subject: "苹果", intent: "“苹果”“结构”", register: "教科书" },
          },
        ],
        [
          "write_work",
          { drawings: [
              {
                id: "fruit",
                name: "苹果",
                source: 'return api.material("apple")',
              },
            ],
            scenes: [{ id: "root", clear: true }],
            modules: [{ id: "apple", label: "苹果", drawingId: "fruit", bounds: [0, 0, 200, 194] }],
          },
        ],
        ["view_canvas", {}],
        ["finish", { message: "done" }],
      ],
      seen,
    );
    const agent = new Agent(() => {});
    const run = await agent.start(store, work.id, "root", "苹果");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    expect(outputs(seen[1]).at(-1)).toContain("不是用户说过的话");
    expect(store.work(work.id).brief).toBeNull();
    await agent.resume(store, run.id, "画苹果的什么？\n→ 结构，教科书那样");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("completed"));
    const saved = store.work(work.id);
    expect(saved.brief?.style).toBe("textbook");
    // The concept is the author's own idea and needs no quote; the ideas it was chosen
    // from stay with the run.
    expect(saved.brief?.concept).toBe(brief.concept);
    expect(saved.brief).not.toHaveProperty("ideas");
    // Two ideas of one kind are variations of each other, not alternatives.
    expect(
      settleSchema.safeParse({
        ...brief,
        ideas: [brief.ideas[0], { ...brief.ideas[1], kind: "anatomy" }],
      }).success,
    ).toBe(false);
    expect(saved.style.font).toContain("PingFang");
    expect(Object.keys(saved.materials)).toEqual(["apple"]);
    const [castOutput] = outputs(seen[3]).slice(-1);
    // The cast is searched in the brief's style first.
    expect(JSON.parse(castOutput).cast[0].hits[0]).toMatchObject({
      id: "apple-textbook",
      style: "textbook",
    });
    // The author sees the cast as pictures, not only names.
    expect(
      seen[3]
        .findLast((i) => i.role === "user")
        .content.some((c: any) => c.type === "input_image"),
    ).toBe(true);
    const step = store
      .run(run.id)
      .steps.find(
        (s) =>
          s.kind === "tool" && s.name === "set_brief" && s.status === "done",
      );
    expect(step).toMatchObject({
      revision: 2,
      ideas: brief.ideas.map((i) => i.idea),
      concept: brief.concept,
      found: [{ subject: "苹果" }, { subject: "种子" }],
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
it("develops pictures while the author composes and holds the end until they were seen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const settings = store.settings();
    settings.image = {
      ...settings.image,
      credential: "test",
      baseUrl: "https://example.invalid",
    };
    const catalog = store.storage.models();
    Object.assign(catalog.painters[0], { credential: "test", baseUrl: "https://example.invalid" });
    store.storage.saveModels(catalog);
    let paint!: () => void;
    const painted = new Promise<void>((r) => (paint = r));
    const png = await picture();
    library.route(async () => {
      await painted;
      return Response.json({
        data: [{ b64_json: png.toString("base64") }],
        usage: {
          input_tokens: 1300,
          input_tokens_details: { text_tokens: 100, image_tokens: 1200 },
          output_tokens: 4000,
        },
      });
    });
    const seen: any[][] = [];
    let id = "";
    script(
      [
        [
          "generate_images",
          {
            images: [
              {
                name: { zh: "鲸", en: "whale" },
                role: "object",
                depicts: "a blue whale, side view",
                aspect: "landscape",
              },
            ],
          },
        ],
        ["finish", { message: "too soon" }],
        ["view_canvas", {}],
        ["finish", { message: "done" }],
      ],
      seen,
    );
    const run: Run = {
      id: "develop",
      workId: work.id,
      sceneId: "root",
      status: "running",
      steps: [],
      observations: [],
      startedAt: Date.now(),
    };
    store.saveRun(run);
    const agent = new Agent(() => {});
    const done = agent.execute(
      store,
      run,
      { input: [], settings: store.settings(), generations: 0 },
      "request",
    );
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
    id = JSON.parse(outputs(seen[1])[0]).developing[0].id;
    expect(id).toMatch(/^g-whale-/);
    // The picture is usable at once, before it exists.
    const { work: written } = await writeWork(
      store,
      work.id,
      {
        drawings: [
          { id: "whale", name: "鲸", source: `return api.material("${id}")` },
        ],
      }, { cause: { kind: "edit" } });
    expect(written.materials[id]).toMatchObject({ status: "developing" });
    await vi.waitFor(() => expect(seen.length).toBe(3));
    // Closing words while a picture develops are answered with what is missing.
    expect(String(seen[2].at(-1).content)).toContain("图片仍在生成");
    await new Promise((r) => setTimeout(r, 50));
    paint();
    await done;
    expect(run.status).toBe("completed");
    // The finished picture was shown to the author before the final look.
    const shown = seen[3].find(
      (x: any) =>
        x.role === "user" && x.content?.[0]?.text?.startsWith?.("Pictures:"),
    );
    expect(shown.content[0].text).toContain(id);
    expect(shown.content.some((c: any) => c.type === "input_image")).toBe(true);
    expect(
      run.steps.find((s) => s.kind === "tool" && s.name === "generate_images"),
    ).toMatchObject({
      images: [{ id, status: "ready" }],
    });
    // The picture model's tokens are kept split as they are priced: text and image input.
    expect(run.usage?.images).toEqual({
      count: 1,
      input: 1300,
      output: 4000,
      textInput: 100,
      imageInput: 1200,
      textOutput: 0,
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("names only the pictures still being painted while a look waits for them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-wait-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    // One look at the root then sees every scene with something in it.
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const catalog = store.storage.models();
    Object.assign(catalog.painters[0], { credential: "test", baseUrl: "https://example.invalid" });
    store.storage.saveModels(catalog);
    // Each picture is painted when the test lets it through, in the order its request came.
    const gates: (() => void)[] = [],
      opened = [0, 1].map(() => new Promise<void>((r) => gates.push(r)));
    let asked = 0;
    const png = await picture();
    library.route(async () => {
      await opened[asked++];
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    });
    const picture_ = (zh: string, en: string) => ({
      name: { zh, en },
      role: "object",
      depicts: `a ${en}, side view`,
      aspect: "landscape",
    });
    script([
      ["generate_images", { images: [picture_("鲸", "whale"), picture_("船", "boat")] }],
      ["view_canvas", {}],
      ["finish", { message: "done" }],
    ]);
    const run: Run = {
      id: "wait",
      workId: work.id,
      sceneId: "root",
      status: "running",
      steps: [],
      observations: [],
      startedAt: Date.now(),
    };
    store.saveRun(run);
    const done = new Agent(() => {}).execute(
      store,
      run,
      { input: [], settings: store.settings(), generations: 0 },
      "request",
    );
    const look = () =>
      run.steps.find(
        (s): s is Extract<Step, { kind: "tool"; name: "view_canvas" }> =>
          s.kind === "tool" && s.name === "view_canvas",
      );
    await vi.waitFor(() => expect(look()?.waiting).toEqual(["鲸", "船"]));
    // The two are painted side by side, so either may come first.
    gates[0]();
    await vi.waitFor(() => expect(look()?.waiting).toHaveLength(1));
    expect(["鲸", "船"]).toContain(look()?.waiting?.[0]);
    gates[1]();
    await done;
    expect(run.status).toBe("completed");
    expect(look()?.waiting).toBeUndefined();
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it.each([false, true])("bills the first picture and its opaque retry even when the retry fails: %s", async (fails) => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-image-bill-")), db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id), work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const catalog = db.models();
    Object.assign(catalog.painters[0], { credential: "test", baseUrl: "https://example.invalid" });
    catalog.painters[0].models[0].prices = {
      image: 1, textInput: 5, imageInput: 8, output: 30, textOutput: 0,
    };
    db.saveModels(catalog);
    const png = await solid();
    let paints = 0;
    library.route(async () => {
      if (++paints === 2 && fails) return new Response("failed", { status: 400 });
      return Response.json({
        data: [{ b64_json: png.toString("base64") }],
        usage: {
          input_tokens: 10,
          input_tokens_details: { text_tokens: 4, image_tokens: 6 },
          output_tokens: 100,
        },
      });
    });
    const agent = new Agent(() => {});
    let turn = 0;
    vi.mocked(generate).mockImplementation(async () => {
      if (turn++ === 0)
        return {
          items: [answer("generate_images", {
            images: [{ name: { zh: "船", en: "boat" }, role: "object", depicts: "a boat" }],
          }, "paint")],
          usage: {}, response: {},
        };
      await Promise.all((agent.developments.get("retry-bill") ?? []).map((d) => d.done));
      return {
        items: [answer(turn === 2 ? "view_canvas" : "finish", turn === 2 ? {} : { message: "done" }, "c" + turn)],
        usage: {}, response: {},
      };
    });
    const run: Run = {
      id: "retry-bill", workId: work.id, sceneId: "root", status: "running",
      steps: [], observations: [], startedAt: Date.now(),
    };
    store.saveRun(run);
    await agent.execute(store, run, { input: [], settings: store.settings(), generations: 0 }, "request");
    const count = fails ? 1 : 2;
    expect(paints).toBe(2);
    expect(run.status).toBe("completed");
    expect(run.usage?.images).toEqual({
      count, input: 10 * count, output: 100 * count,
      textInput: 4 * count, imageInput: 6 * count, textOutput: 0,
    });
    expect(run.usage?.failed?.images ?? 0).toBe(fails ? 1 : 0);
    expect(costOf(run.usage, run.prices)?.image).toBeCloseTo(count * (1 + 3068 / 1e6), 8);
    expect(store.run(run.id).usage).toEqual(run.usage);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("stops the run when the canvas cannot be looked at, instead of spending turns on it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const run: Run = {
      id: "down",
      workId: work.id,
      sceneId: "root",
      status: "running",
      steps: [],
      observations: [],
      startedAt: Date.now(),
    };
    store.saveRun(run);
    vi.mocked(observe).mockClear();
    vi.mocked(observe).mockRejectedValue(
      new Unavailable("画布查看服务不可用 (500)"),
    );
    const seen: any[][] = [];
    script(
      [
        ["view_canvas", {}],
        ["finish", { message: "never" }],
      ],
      seen,
    );
    await new Agent(() => {}).execute(
      store,
      run,
      { input: [], settings: store.settings(), generations: 0 },
      "request",
    );
    expect(seen).toHaveLength(1);
    expect(vi.mocked(observe)).toHaveBeenCalledTimes(3);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("画布查看服务不可用");
  } finally {
    vi.mocked(observe).mockReset();
    db.close();
    rmSync(dir, { recursive: true });
  }
}, 20000);

it("tries a turn again when the model's stream breaks, without the broken attempt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const run: Run = {
      id: "dropped",
      workId: work.id,
      sceneId: "root",
      status: "running",
      steps: [],
      observations: [],
      startedAt: Date.now(),
    };
    store.saveRun(run);
    let calls = 0;
    const call = (name: string, args: object) => ({
      items: [
        {
          type: "function_call",
          name,
          arguments: JSON.stringify(args),
          call_id: name,
        },
      ],
      usage: {},
      response: {},
    });
    vi.mocked(generate).mockImplementation(
      async (_role, { onEvent }) => {
        switch (calls++) {
          case 0:
            onEvent?.({ type: "response.reasoning_summary_part.added" });
            onEvent?.({
              type: "response.reasoning_summary_text.delta",
              delta: "half a thought",
            });
            throw new TypeError("terminated");
          case 1:
            return call("read_work", {});
          default:
            return call("ask_user", {
              questions: [
                {
                  id: "q",
                  text: "哪一种？",
                  options: [{ label: "甲" }, { label: "乙" }],
                },
              ],
            });
        }
      },
    );
    await new Agent(() => {}).execute(
      store,
      run,
      { input: [], settings: store.settings(), generations: 0 },
      "request",
    );
    expect(calls).toBe(3);
    expect(run.status).toBe("waiting");
    expect(run.steps.some((s) => s.kind === "thinking")).toBe(false);
    expect(
      run.steps.some((s) => s.kind === "tool" && s.name === "read_work"),
    ).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
}, 20000);

it("keeps the library catalogue the same as the library grows, so the cached prefix holds", async () => {
  const { catalogue } = await import("./prompts.ts");
  const style = {
    id: "watercolor",
    name: { zh: "水彩绘本", en: "Watercolour" },
    register: "expressive",
    about: "washes",
    count: 30,
    samples: ["a", "b"],
  } as never;
  const kit = [
    {
      id: "plot",
      kind: "drawing",
      name: { zh: "曲线" },
      about: "p",
      params: {},
      size: { width: 1, height: 1 },
      example: {},
      uses: 1,
    },
    {
      id: "arrow",
      kind: "drawing",
      name: { zh: "箭头" },
      about: "a",
      params: {},
      size: { width: 1, height: 1 },
      example: {},
      uses: 9,
    },
  ] as never[];
  const grown = {
    ...(style as object),
    count: 36,
    samples: ["b", "c"],
  } as never;
  expect(catalogue([grown], [...kit].reverse())).toBe(catalogue([style], kit));
});
it("tells the author what the user changed themselves since its last turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    await writeWork(
      store,
      work.id,
      { title: "drawn" }, { cause: { kind: "run", runId: "earlier", prompt: "draw" } });
    for (const edit of [
      (w: Work) => setData(w, "root", "level-0", { color: "#000000" }),
      (w: Work) => removeParts(w, "root", ["control"]),
    ])
      await writeWork(store, work.id, edit(store.work(work.id)), { cause: {
        kind: "edit",
      } });
    vi.mocked(generate).mockImplementation(async () => ({
      items: [
        {
          type: "function_call",
          name: "ask_user",
          call_id: crypto.randomUUID(),
          arguments: JSON.stringify({
            questions: [
              {
                id: "q",
                text: "Which?",
                options: [{ label: "A" }, { label: "B" }],
              },
            ],
          }),
        },
      ],
      usage: {},
      response: {},
    }));
    const agent = new Agent(() => {});
    const run = await agent.start(store, work.id, "root", "Continue");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    const told = store.context(run.id).input.find((i: any) => String(i.content).includes("Current scene:")).content as string;
    expect(told).toMatch(
      /^Since your last turn the user changed the work themselves \(revision 2 to 4\)\.[^\n]*\n- scene root: changed level-0; removed control; interaction checks changed\nCurrent scene: root\n/,
    );
    // With nothing changed since, the work is given as it is.
    const work2 = store.work(work.id);
    agent.cancel(store, run.id);
    await writeWork(
      store,
      work.id,
      { title: "again" }, { cause: { kind: "run", runId: run.id, prompt: "Continue" } });
    const next = await agent.start(store, work.id, "root", "More");
    await vi.waitFor(() => expect(store.run(next.id).status).toBe("waiting"));
    const latest = store
      .context(next.id)
      .input.findLast(
        (i: any) =>
          typeof i.content === "string" && i.content.includes("Current work:"),
      );
    expect(latest.content).toMatch(/^Current scene: root\n/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("tells a conversation the user's preferences, out of the instructions, and again only when they change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const instructions: string[] = [];
    vi.mocked(generate).mockImplementation(async (_role, turn) => {
      instructions.push(turn.instructions);
      return {
        items: [
          {
            type: "function_call",
            name: "ask_user",
            call_id: crypto.randomUUID(),
            arguments: JSON.stringify({ questions: [{ id: "q", text: "Which?", options: [{ label: "A" }, { label: "B" }] }] }),
          },
        ],
        usage: {},
        response: {},
      };
    });
    const agent = new Agent(() => {});
    const told = async (prompt: string) => {
      const run = await agent.start(store, work.id, "root", prompt);
      await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
      agent.cancel(store, run.id);
      return store.context(run.id).input.filter((i: any) => String(i.content).startsWith("User preferences: ")).map((i: any) => i.content);
    };
    store.saveOwnSettings({ ...store.ownSettings(), preferences: "用中文标注" });
    expect(await told("Draw")).toEqual(["User preferences: 用中文标注"]);
    expect(await told("Again")).toEqual(["User preferences: 用中文标注"]);
    store.saveOwnSettings({ ...store.ownSettings(), preferences: "少用红色" });
    expect(await told("Once more")).toEqual(["User preferences: 用中文标注", "User preferences: 少用红色"]);
    // The instructions are the same whatever the user prefers.
    expect(new Set(instructions).size).toBe(1);
    expect(instructions[0]).not.toContain("用中文标注");
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("hands a continuing conversation only what the user changed since", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    vi.mocked(generate).mockImplementation(async () => ({
      items: [
        {
          type: "function_call",
          name: "ask_user",
          call_id: crypto.randomUUID(),
          arguments: JSON.stringify({
            questions: [
              { id: "q", text: "Which?", options: [{ label: "A" }, { label: "B" }] },
            ],
          }),
        },
      ],
      usage: {},
      response: {},
    }));
    const agent = new Agent(() => {});
    const ask = async (prompt: string) => {
      const run = await agent.start(store, work.id, "root", prompt);
      await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
      agent.cancel(store, run.id);
      return store
        .context(run.id)
        .input.findLast(
          (i: any) => typeof i.content === "string" && i.content.includes("Current scene:"),
        ).content as string;
    };
    expect(await ask("Draw")).toContain("Current work:");
    // Nothing changed: the conversation already holds the work.
    expect(await ask("Again")).toBe(
      "Current scene: root\nThe work is as you last saw it (revision 1).",
    );
    for (const edit of [
      (w: Work) => setData(w, "root", "level-0", { color: "#000000" }),
      (w: Work) => removeParts(w, "root", ["control"]),
    ])
      await writeWork(store, work.id, edit(store.work(work.id)), { cause: { kind: "edit" } });
    const told = await ask("Continue");
    expect(told).toMatch(
      /^Since your last turn the user changed the work themselves \(revision 1 to 3\)\.[^\n]*\n- scene root: changed level-0; removed control; interaction checks changed\n/,
    );
    expect(told).not.toContain("Current work:");
    const changed = JSON.parse(told.match(/\nChanged: (.*)\nCurrent scene: root$/)![1]);
    const now = store.work(work.id).scenes.root;
    // Changed parts come in the short form the author writes.
    const level = now.modules.find((m) => m.id === "level-0")!;
    expect(changed.scenes.root.modules).toEqual([
      expect.objectContaining({
        id: "level-0",
        data: level.data,
        bounds: [level.bounds.x, level.bounds.y, level.bounds.width, level.bounds.height],
      }),
    ]);
    expect(changed.scenes.root.order).toEqual(now.modules.map((m) => m.id));
    expect(changed.scenes.root.removed).toEqual(["control"]);
    expect(changed.drawings).toBeUndefined();

    // Restoring a draft can change only the checks; the author still needs their new value.
    const beforeChecks = store.work(work.id);
    const checks = [{ moduleId: "level-0", selector: ".inspect" }];
    await writeWork(store, work.id, { scenes: [{ id: "root", checks }] }, { cause: { kind: "edit" } });
    const checksTold = await ask("Check this");
    expect(checksTold).toContain("interaction checks changed");
    const delta = (text: string) => JSON.parse(text.match(/\nChanged: (.*)\nCurrent scene: root$/)![1]);
    expect(delta(checksTold).scenes.root.checks).toEqual(checks);
    restore(store, work.id, beforeChecks.revision);
    const restored = delta(await ask("Continue from the earlier draft"));
    expect(restored.scenes.root.checks).toEqual(beforeChecks.scenes.root.checks);
    expect(restored.scenes.root.modules).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it.each(["api", "oauth"] as const)("keeps hosted searches in the %s conversation and continues with drawing tools", async (channel) => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-search-")), db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "searcher", "abcdef").id), work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const catalog = db.models();
    catalog.writers[0].channel = channel;
    db.saveModels(modelCatalogSchema.parse(catalog));
    const run: Run = { id: "search-run", workId: work.id, sceneId: "root", status: "running", steps: [], observations: [], startedAt: Date.now() };
    store.saveRun(run);
    const search = { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", queries: ["OpenAI latest release"] } };
    const annotation = { type: "url_citation", start_index: 2, end_index: 5, url: "https://openai.com/", title: "OpenAI" };
    const message = { type: "message", role: "assistant", content: [{ type: "output_text", text: "说明[1]", annotations: [annotation] }] };
    let turn = 0;
    const states: string[] = [];
    vi.mocked(generate).mockImplementation(async (_role, { input, tools = [], onEvent }) => {
      expect(tools.filter(t => t.type === "web_search")).toEqual(channel === "api" ? [{ type: "web_search", search_context_size: "low" }] : []);
      if (turn++ === 0) {
        onEvent!({ type: "response.output_item.added", item: { type: "web_search_call", id: "ws_1" } });
        onEvent!({ type: "response.output_item.done", item: search });
        return { items: [search, message], usage: {}, response: {} };
      }
      expect(input).toContainEqual(search);
      expect(input).toContainEqual(message);
      expect(input.some(i => i.type === "function_call_output" && i.call_id === "ws_1")).toBe(false);
      const name = turn === 2 ? "view_canvas" : "finish";
      return { items: [answer(name, name === "finish" ? { message: "done" } : {}, "c" + turn)], usage: {}, response: {} };
    });
    await new Agent((_user, event: any) => {
      const step = event.run?.steps.find((s: any) => s.name === "web_search");
      if (step) states.push(step.status);
    }).execute(store, run, { input: [], settings: store.settings(), generations: 0 }, "request");
    expect(run.status).toBe("completed");
    expect(states).toContain("running");
    expect(states).toContain("done");
    expect(run.steps).toContainEqual({ kind: "tool", id: "ws_1", status: "done", name: "web_search", queries: ["OpenAI latest release"], urls: [], action: "search" });
    expect(run.steps).toContainEqual({ kind: "message", role: "assistant", text: "说明[1]", citations: [{ start: 2, end: 5, url: "https://openai.com/", title: "OpenAI" }] });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
it("shows any hosted tool as a step, records it under its turn and adds up what the run spent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-hosted-")), db = new Storage(dir);
  tracer.open(dir);
  try {
    const store = db.scoped(register(db, "hosting", "abcdef").id), work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const run: Run = { id: "hosted-run", workId: work.id, sceneId: "root", status: "running", steps: [], observations: [], startedAt: Date.now() };
    store.saveRun(run);
    tracer.begin({ id: run.id, userId: store.userId, workId: work.id, title: "t", prompt: "p", status: "running" });
    const code = { type: "code_interpreter_call", id: "ci_1", status: "completed", code: "print(6 * 7)" };
    const search = { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "open_page", url: "https://example.com/a" } };
    const usage = (n: number) => ({ input_tokens: n, output_tokens: 10, input_tokens_details: { cached_tokens: n / 2 }, output_tokens_details: { reasoning_tokens: 4 } });
    let turn = 0, looked: any;
    vi.mocked(generate).mockImplementation(async (_role, { input, onEvent }) => {
      if (turn === 2) looked = JSON.parse(input.findLast((i) => i.type === "function_call_output")!.output);
      if (turn++ === 0) {
        for (const item of [code, search]) {
          onEvent!({ type: "response.output_item.added", item: { type: item.type, id: item.id } });
          onEvent!({ type: "response.output_item.done", item });
        }
        return { items: [code, search], usage: usage(100), response: {} };
      }
      const name = turn === 2 ? "view_canvas" : "finish";
      return { items: [answer(name, name === "finish" ? { message: "done" } : {}, "c" + turn)], usage: usage(200), response: {} };
    });
    await tracer.within(run.id, () => new Agent(() => {}).execute(store, run, { input: [], settings: store.settings(), generations: 0 }, "request"));
    expect(run.status).toBe("completed");
    expect(run.steps).toContainEqual({ kind: "tool", id: "ci_1", status: "done", name: "hosted", tool: "code_interpreter", detail: "print(6 * 7)" });
    expect(run.steps).toContainEqual({ kind: "tool", id: "ws_1", status: "done", name: "web_search", queries: [], urls: ["https://example.com/a"], action: "open_page" });
    expect(run.usage).toEqual({ input: 500, cached: 250, output: 30, reasoning: 12, pages: 1, hosted: { code_interpreter: 1, web_search: 1 } });
    // A look tells the author what it has already searched, to judge against it.
    expect(looked.research).toMatchObject({ calls: 1, pagesOpened: ["https://example.com/a"] });
    // Each hosted call is a tool span under the turn that made it, and metered by its name.
    const { spans, trace } = tracer.get(store.userId, run.id)!;
    const first = spans.find((s) => s.kind === "turn")!;
    const hosted = spans.filter((s) => s.attrs.hosted);
    expect(hosted.map((s) => [s.kind, s.name, s.parentId])).toEqual([
      ["tool", "code_interpreter", first.id],
      ["tool", "web_search", first.id],
    ]);
    const meter = (key: string) => trace.meters.find((m) => m.key === key);
    expect(meter("web_search")).toMatchObject({ kind: "tool", calls: 1 });
    expect(meter("code_interpreter")).toMatchObject({ kind: "tool", calls: 1 });
    expect(meter("model")).toMatchObject({ kind: "turn", calls: 3, input: 500, cached: 250, output: 30 });
    // The timeline has each span's brief; the whole record comes one span at a time, a
    // turn's with everything it was sent, earlier turns' outputs included.
    expect(first.attrs.output).toBeUndefined();
    const second = spans.filter((s) => s.kind === "turn")[1];
    const opened = tracer.whole(store.userId, run.id, second.id)!;
    expect(opened.span.attrs.output).toBeDefined();
    expect(opened.context!.items).toEqual(expect.arrayContaining([code, search]));
    expect(tracer.whole("someone-else", run.id, second.id)).toBeUndefined();
  } finally { tracer.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
it("keeps web search within the request's budget without changing the tools it lists", () => {
  const listed = [{ type: "function", name: "write_work" }, { type: "function", name: "view_canvas" }, { type: "web_search" }];
  const search = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "tool" as const, id: "ws" + i, status: "done" as const, name: "web_search" as const, queries: ["q"], urls: [] }));
  const draft = { kind: "tool" as const, id: "w", status: "done" as const, name: "write_work" as const, drawings: [], scenes: [], details: [], materials: [], removed: 0, revision: 2 };
  const run = (steps: Run["steps"]): Run => ({ id: "r", workId: "w", sceneId: "root", status: "running", steps, observations: [], startedAt: 0 });
  const onlyDrawing = { tool_choice: { type: "allowed_tools", mode: "auto", tools: [{ type: "function", name: "write_work" }, { type: "function", name: "view_canvas" }] } };
  // Research before the first draft is free up to the request's limit.
  expect(steering(run(search(3)), listed)).toEqual({ max_tool_calls: SEARCH_LIMIT - 3 });
  expect(steering(run(search(SEARCH_LIMIT)), listed)).toEqual(onlyDrawing);
  // Once a draft is saved, a look gets a couple of follow-up calls, then search closes.
  expect(steering(run([...search(1), draft]), listed)).toEqual({ max_tool_calls: 2 });
  expect(steering(run([...search(1), draft, ...search(2)]), listed)).toEqual(onlyDrawing);
  // A channel without web search is never steered.
  expect(steering(run([draft, ...search(5)]), listed.slice(0, 2))).toEqual({});
});

it("searches through the search service for a model without its own, counting each query against the budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-service-")), db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "servicer", "abcdef").id), work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const catalog = db.models();
    Object.assign(catalog.writers[0].models[0], { name: "DeepSeek", protocol: "chat", model: "deepseek-flash", builtinSearch: false, speeds: [] });
    catalog.searches = [{ id: "web", name: "DeepSeek Search", provider: "deepseek", baseUrl: "https://search.invalid/v1/tools", credential: "k", prices: { query: 0.01, page: 0.02 } }];
    catalog.defaults.web = "web";
    db.saveModels(modelCatalogSchema.parse(catalog));
    const earlier = Array.from({ length: SEARCH_LIMIT - 4 }, (_, i) => ({ kind: "tool" as const, id: "old" + i, status: "done" as const, name: "web_search" as const, queries: ["q"], urls: [] }));
    const run: Run = { id: "service-run", workId: work.id, sceneId: "root", status: "running", steps: [...earlier], observations: [], startedAt: Date.now() };
    store.saveRun(run);
    const asked: { url: string; body: any }[] = [];
    library.route(async (url, init) => {
      asked.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return String(url).endsWith("/search")
        ? Response.json({ results: [{ title: "Release", url: "https://news.invalid/a", snippet: "It shipped.", date: "2026-04-24T00:00:00Z" }] })
        : Response.json({ content: "The whole page." });
    });
    const script = [
      ["web_search", { queries: ["release date", "launch city"] }],
      ["open_page", { url: "https://news.invalid/a" }],
      ["web_search", { queries: ["once more", "and again"] }],
      ["web_search", { queries: ["last"] }],
      ["view_canvas", {}],
      ["finish", { message: "done" }],
    ] as const;
    const outputs: any[] = [];
    let turn = 0;
    vi.mocked(generate).mockImplementation(async (role, { input, tools = [] }) => {
      expect(role.protocol).toBe("chat");
      // Only the service's search is offered, never the provider's own as well.
      expect(tools.some((t) => t.type === "web_search")).toBe(false);
      expect(tools.filter((t) => ["web_search", "open_page"].includes(t.name)).length).toBe(2);
      const last = input.findLast((i) => i.type === "function_call_output");
      if (last) outputs.push(JSON.parse(last.output));
      const [name, args] = script[turn++];
      return { items: [answer(name, args, "c" + turn)], usage: {}, response: {} };
    });
    const ctx = { input: [], settings: store.settings(), generations: 0 };
    db.saveModels(modelCatalogSchema.parse({ ...catalog, defaults: { ...catalog.defaults, web: "off" } }));
    await new Agent(() => {}).execute(store, run, ctx, "request");
    expect(run.status).toBe("completed");
    expect(asked).toEqual([
      { url: "https://search.invalid/v1/tools/search", body: { query: "release date" } },
      { url: "https://search.invalid/v1/tools/search", body: { query: "launch city" } },
      { url: "https://search.invalid/v1/tools/fetch", body: { url: "https://news.invalid/a" } },
      { url: "https://search.invalid/v1/tools/search", body: { query: "once more" } },
    ]);
    expect(outputs[0].results[0]).toEqual({ query: "release date", results: [{ title: "Release", url: "https://news.invalid/a", snippet: "It shipped.", date: "2026-04-24" }] });
    expect(outputs[1]).toEqual({ url: "https://news.invalid/a", text: "The whole page." });
    // The queries past the budget are not asked, and the author is told which.
    expect(outputs[2].results.map((r: any) => r.query)).toEqual(["once more"]);
    expect(outputs[2].notAsked).toEqual(["and again"]);
    expect(run.steps).toContainEqual({ kind: "tool", id: "c3", status: "done", name: "web_search", queries: ["once more"], urls: [], action: "search" });
    // Past the budget the call is refused, and leaves no step behind.
    expect(outputs[3].error).toContain("closed");
    expect(run.steps.filter((s) => s.kind === "tool" && s.name === "web_search")).toHaveLength(SEARCH_LIMIT - 1);
    expect(run.steps).toContainEqual({ kind: "tool", id: "c1", status: "done", name: "web_search", queries: ["release date", "launch city"], urls: [], action: "search" });
    expect(run.steps).toContainEqual({ kind: "tool", id: "c2", status: "done", name: "web_search", queries: [], urls: ["https://news.invalid/a"], action: "open_page" });
    expect(run.usage).toMatchObject({ searches: 3, pages: 1 });
    expect(run.services).toEqual({ label: "默认", author: "DeepSeek", model: "deepseek-flash", effort: "medium", speed: "default", search: "service", searchBy: "DeepSeek Search", image: "gpt-image-2.5-sunburst[api]" });
    // Each query asked and the page read are priced at the service's prices.
    expect(run.prices).toMatchObject({ search: 0.01, page: 0.02 });
    expect(costOf(run.usage, run.prices)!.search).toBeCloseTo(3 * 0.01 + 0.02);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
it("keeps a Responses model without tool limits to the search budget by refusing calls, at any address", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-limitless-")), db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "limitless", "abcdef").id), work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const catalog = db.models();
    // DeepSeek's Responses behind a proxy of the administrator's own.
    catalog.writers[0].baseUrl = "https://llm-proxy.invalid/v1";
    Object.assign(catalog.writers[0].models[0], { protocol: "responses", model: "deepseek-flash", builtinSearch: false, toolLimits: false });
    catalog.searches = [{ id: "web", name: "DeepSeek Search", provider: "deepseek", baseUrl: "https://search.invalid/v1/tools", credential: "k", prices: { query: 0.01, page: 0.02 } }];
    catalog.defaults.web = "web";
    db.saveModels(modelCatalogSchema.parse(catalog));
    const earlier = Array.from({ length: SEARCH_LIMIT }, (_, i) => ({ kind: "tool" as const, id: "old" + i, status: "done" as const, name: "web_search" as const, queries: ["q"], urls: [] }));
    const run: Run = { id: "limitless-run", workId: work.id, sceneId: "root", status: "running", steps: [...earlier], observations: [], startedAt: Date.now() };
    store.saveRun(run);
    const asked: string[] = [];
    library.route(async (url) => {
      asked.push(String(url));
      return Response.json({ results: [] });
    });
    const script = [
      ["web_search", { queries: ["over budget"] }],
      ["view_canvas", {}],
      ["finish", { message: "done" }],
    ] as const;
    const steers: unknown[] = [], outputs: any[] = [];
    let turn = 0;
    vi.mocked(generate).mockImplementation(async (role, { input, steer }) => {
      expect(role).toMatchObject({ protocol: "responses", toolLimits: false });
      steers.push(steer);
      const last = input.findLast((i) => i.type === "function_call_output");
      if (last) outputs.push(JSON.parse(last.output));
      const [name, args] = script[turn++];
      return { items: [answer(name, args, "c" + turn)], usage: {}, response: {} };
    });
    await new Agent(() => {}).execute(store, run, { input: [], settings: store.settings(), generations: 0 }, "request");
    // The request never carries fields the service rejects, and drawing carries on.
    expect(run.status).toBe("completed");
    for (const steer of steers) expect(steer ?? {}).toEqual({});
    // The call past the budget is refused without asking the search service.
    expect(asked.filter((u) => u.startsWith("https://search.invalid"))).toEqual([]);
    expect(outputs[0].error).toContain("closed");
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
it("steers the service's search like the provider's own, except over Chat Completions", () => {
  const listed = [{ type: "function", name: "write_work" }, { type: "function", name: "web_search" }, { type: "function", name: "open_page" }];
  const search = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "tool" as const, id: "ws" + i, status: "done" as const, name: "web_search" as const, queries: ["q"], urls: [] }));
  const run = (steps: Run["steps"]): Run => ({ id: "r", workId: "w", sceneId: "root", status: "running", steps, observations: [], startedAt: 0 });
  expect(steering(run(search(2)), listed)).toEqual({});
  expect(steering(run(search(SEARCH_LIMIT)), listed)).toEqual({ tool_choice: { type: "allowed_tools", mode: "auto", tools: [{ type: "function", name: "write_work" }] } });
  expect(steering(run(search(SEARCH_LIMIT)), listed, { protocol: "chat", toolLimits: true })).toEqual({});
  expect(steering(run(search(SEARCH_LIMIT)), listed, { protocol: "anthropic", toolLimits: true })).toEqual({});
  // A Responses service without allowed_tools (DeepSeek's, at any address) is said so by
  // its model; the search service's calls are then refused past the budget instead.
  const limitless = { protocol: "responses" as const, toolLimits: false };
  expect(steering(run(search(SEARCH_LIMIT)), listed, limitless)).toEqual({});
  expect(steering(run(search(2)), listed, limitless)).toEqual({});
  // OpenAI keeps its request-level limits.
  const hosted = [{ type: "function", name: "write_work" }, { type: "web_search" }];
  expect(steering(run(search(2)), hosted, { protocol: "responses", toolLimits: true })).toEqual({ max_tool_calls: SEARCH_LIMIT - 2 });
  expect(steering(run(search(2)), hosted, limitless)).toEqual({});
});

it("gives the author guides and drawing cards on demand, and only once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const seen: any[][] = [];
    script(
      [
        ["draw_guide", { topics: ["maps", "copy"], drawings: ["arrow", "no-such"] }],
        // Asked again: geomap came with maps, and arrow was read on its own.
        ["draw_guide", { topics: ["maps"], drawings: ["geomap", "arrow", "plot"] }],
        ["draw_guide", {}],
        ["view_canvas", {}],
        ["finish", { message: "done" }],
      ],
      seen,
    );
    const run = await new Agent(() => {}).start(store, work.id, "root", "画");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("completed"));
    const [first, second, empty] = outputs(seen.at(-1)!);
    // Guides read as text under their topics, and cards one line of JSON each.
    const cards = (text: string) =>
      text.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
    expect([...first.matchAll(/^## (\w+)$/gm)].map((m) => m[1])).toEqual(["maps", "copy"]);
    expect(first.slice(0, first.indexOf("## copy"))).toContain("geomap");
    expect(first).toContain("Real geography comes from data.");
    const read = cards(first);
    expect(read.map((d: any) => d.id)).toEqual(["geomap", "arrow"]);
    expect(read[1]).toMatchObject({ use: "link", size: "200×60" });
    expect(read[1].params.route).toBeTruthy();
    expect(read[1].example.flow).toBe(true);
    expect(first).toContain("Not library drawings: no-such.");
    expect(second).not.toContain("## maps");
    expect(cards(second).map((d: any) => d.id)).toEqual(["plot"]);
    expect(second).toContain("Already above in this conversation: maps, geomap, arrow.");
    expect(JSON.parse(empty).error).toBeTruthy();
    // A step in the studio says what was read.
    const steps = store.run(run.id).steps.filter((s) => s.kind === "tool" && s.name === "draw_guide");
    expect(steps[0]).toMatchObject({
      status: "done",
      topics: ["maps", "copy"],
      drawings: ["arrow", "no-such"],
    });
    expect(steps[2]).toMatchObject({ status: "failed" });
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("sends a guide again once a summary has dropped it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const { guidesRead } = await import("./guides.ts");
    const read = [
      { type: "function_call", name: "draw_guide", call_id: "a", arguments: '{"topics":["maps"]}' },
      { type: "function_call_output", call_id: "a", output: "{}" },
    ];
    expect([...guidesRead(read).topics]).toEqual(["maps"]);
    expect([...guidesRead(read).drawings]).toEqual(["geomap"]);
    expect(guidesRead([{ role: "user", content: "Conversation summary. …" }]).topics.size).toBe(0);
    // A call not answered yet has been read by nobody.
    expect(guidesRead(read.slice(0, 1)).topics.size).toBe(0);
    // Nor has a call the tool refused, whatever else it named.
    for (const args of ['{"topics":["maps","bogus"]}', '{"topics":"maps"}', "{not json"])
      expect(
        guidesRead([
          { type: "function_call", name: "draw_guide", call_id: "b", arguments: args },
          { type: "function_call_output", call_id: "b", output: '{"error":"x"}' },
        ]).topics.size,
      ).toBe(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("reminds the author of the guides after the brief and of unread cards after a write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    work.materials = {};
    store.commit(work, 0, { kind: "edit" });
    const seen: any[][] = [];
    const brief = {
      subject: "苹果",
      intent: "苹果",
      audience: "学生",
      ideas: [
        { kind: "anatomy", idea: "切开的苹果" },
        { kind: "change", idea: "一年里的苹果树" },
      ],
      concept: "切开的苹果居中",
      register: "formal",
      style: "textbook",
      direction: "安静的线条",
      cast: [],
      basis: { subject: "苹果", intent: "苹果" },
    };
    const uses = (revision: number) => ({ scenes: [{ id: "root", clear: true }],
      modules: [{ id: "a", label: "a", bounds: [0, 0, 10, 10], drawingId: "plot" }],
    });
    script(
      [
        ["set_brief", brief],
        ["write_work", uses(2)],
        ["draw_guide", { drawings: ["plot"] }],
        ["write_work", { ...uses(3), title: "again" }],
        ["view_canvas", {}],
        ["finish", { message: "done" }],
      ],
      seen,
    );
    const run = await new Agent(() => {}).start(store, work.id, "root", "画苹果");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("completed"));
    const [settled, unread, , read] = outputs(seen.at(-1)!).map(parsed);
    expect(settled.guides).toContain("draw_guide");
    expect(unread.cardsUnread).toEqual(["plot"]);
    expect(read.cardsUnread).toBeUndefined();
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("points out an unread card once, not after every write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    work.materials = {};
    store.commit(work, 0, { kind: "edit" });
    const seen: any[][] = [];
    const brief = {
      subject: "苹果",
      intent: "苹果",
      audience: "学生",
      ideas: [
        { kind: "anatomy", idea: "切开的苹果" },
        { kind: "change", idea: "一年里的苹果树" },
      ],
      concept: "切开的苹果居中",
      register: "formal",
      style: "textbook",
      direction: "安静的线条",
      cast: [],
      basis: { subject: "苹果", intent: "苹果" },
    };
    const uses = (revision: number) => ({ scenes: [{ id: "root", clear: true }],
      modules: [{ id: "a", label: "a", bounds: [0, 0, 10, 10], drawingId: "plot" }],
    });
    script(
      [
        ["set_brief", brief],
        ["write_work", uses(2)],
        ["write_work", { ...uses(3), title: "again" }],
        ["view_canvas", {}],
        ["finish", { message: "done" }],
      ],
      seen,
    );
    const run = await new Agent(() => {}).start(store, work.id, "root", "画苹果");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("completed"));
    const [, first, second] = outputs(seen.at(-1)!).map(parsed);
    expect(first.cardsUnread).toEqual(["plot"]);
    expect(second.revision).toBe(4);
    expect(second.cardsUnread).toBeUndefined();
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("does not remind the author of guides and cards it asks for in the same message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    work.materials = {};
    store.commit(work, 0, { kind: "edit" });
    const seen: any[][] = [];
    const brief = {
      subject: "苹果",
      intent: "苹果",
      audience: "学生",
      ideas: [
        { kind: "anatomy", idea: "切开的苹果" },
        { kind: "change", idea: "一年里的苹果树" },
      ],
      concept: "切开的苹果居中",
      register: "formal",
      style: "textbook",
      direction: "安静的线条",
      cast: [],
      basis: { subject: "苹果", intent: "苹果" },
    };
    const uses = (revision: number) => ({ scenes: [{ id: "root", clear: true }],
      modules: [{ id: "a", label: "a", bounds: [0, 0, 10, 10], drawingId: "plot" }],
    });
    script(
      [
        [
          ["set_brief", brief],
          ["draw_guide", { topics: ["diagrams"] }],
        ],
        [
          ["write_work", uses(2)],
          ["draw_guide", { drawings: ["plot"] }],
        ],
        ["view_canvas", {}],
        ["finish", { message: "done" }],
      ],
      seen,
    );
    const run = await new Agent(() => {}).start(store, work.id, "root", "画苹果");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("completed"));
    const [settled, , written] = outputs(seen.at(-1)!).map(parsed);
    expect(settled.revision).toBe(2);
    expect(settled.guides).toBeUndefined();
    expect(written.revision).toBe(3);
    expect(written.cardsUnread).toBeUndefined();
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("keeps the instructions to what every work needs, with the rest listed and readable", async () => {
  const { AUTHOR, catalogue, gist } = await import("./prompts.ts");
  const { guides } = await import("./guides.ts");
  const { guideTopics } = await import("../contracts/index.ts");
  const { readFileSync } = await import("node:fs");
  const seed = (name: string) =>
    JSON.parse(readFileSync(new URL(`../../materials/seed/${name}.json`, import.meta.url), "utf8"));
  // Every topic the tool accepts has a guide and is listed with when to read it.
  expect(Object.keys(guides).sort()).toEqual([...guideTopics].sort());
  for (const topic of guideTopics)
    expect(AUTHOR).toContain(`- ${topic}: ${guides[topic].when}.`);
  // The instructions are not to be read as shouting.
  expect(AUTHOR + Object.values(guides).map((g) => g.text).join("")).not.toMatch(/\b(MUST|NEVER|ALWAYS|IMPORTANT|CRITICAL)\b/);
  // Examples stay on the cards; the index is one short line per drawing.
  const index = catalogue(seed("styles"), [...seed("drawings"), ...seed("effects")]);
  expect(index).not.toContain("e.g. ");
  for (const d of seed("drawings")) {
    expect(index).toContain(`- ${d.id}`);
    expect(gist(d.about).length).toBeLessThan(170);
  }
  // The index names each drawing's parameters, so the common ones need no card, and the
  // rules on composing pictures, which nearly every work reads, live here and not in a guide.
  expect(AUTHOR.length + index.length).toBeLessThan(32000);
});

it("answers every call of a batch before showing its pictures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const seen: any[][] = [];
    const call = (name: string, args: unknown, call_id: string) => ({
      type: "function_call",
      name,
      call_id,
      arguments: JSON.stringify(args),
    });
    const turns = [
      [
        call("find_materials", { subjects: ["苹果"], kinds: ["picture"] }, "a"),
        call("draw_guide", { topics: ["copy"] }, "b"),
      ],
      [call("view_canvas", {}, "d")],
      [answer("finish", { message: "done" }, "e")],
    ];
    vi.mocked(generate).mockImplementation(async (_role, { input }) => {
      seen.push(structuredClone(input));
      return { items: turns[seen.length - 1], usage: {}, response: {} };
    });
    const run = await new Agent(() => {}).start(store, work.id, "root", "画");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("completed"));
    const items = seen[1].filter((i) => i.type !== "configuration_update");
    const order = items.slice(-3).map((i) => i.call_id ?? i.role);
    expect(order).toEqual(["a", "b", "user"]);
    expect(items.at(-1).content.some((c: any) => c.type === "input_image")).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("counts what a cut-off turn spent and does not ask again what less thought cannot cure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    vi.mocked(generate).mockClear();
    vi.mocked(generate).mockImplementation(async () => {
      throw new CutOff("max_output_tokens", false, { input_tokens: 100, output_tokens: 32768 });
    });
    const run = await new Agent(() => {}).start(store, work.id, "root", "画");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("failed"));
    const failed = store.run(run.id);
    expect(failed.error).toContain("截断");
    // Spent all the same, and told apart from what the run got for its money.
    expect(failed.usage).toMatchObject({
      input: 0,
      output: 0,
      failed: { attempts: 1, input: 100, output: 32768, estimated: 0 },
    });
    expect(vi.mocked(generate)).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("asks once more with the least thought when a turn thinks away its whole budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const efforts: unknown[] = [];
    vi.mocked(generate).mockClear();
    vi.mocked(generate).mockImplementation(async (_role, { input }) => {
      efforts.push(input.findLast((i: any) => i.type === "configuration_update")?.reasoning.effort);
      if (efforts.length <= 2)
        throw new CutOff("max_output_tokens", true, {
          input_tokens: 100,
          output_tokens: 1000,
          output_tokens_details: { reasoning_tokens: 1000 },
        });
      return { items: [], usage: {}, response: {} };
    });
    const run = await new Agent(() => {}).start(store, work.id, "root", "画");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("failed"));
    // Thought away again at the least: it stops rather than paying a third time.
    expect(efforts).toEqual([undefined, "low"]);
    expect(store.run(run.id).usage).toMatchObject({ output: 0, failed: { attempts: 2, output: 2000 } });
    expect(store.run(run.id).error).toContain("思考");
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("returns to the configured effort after a turn asked again with less thought", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const efforts: unknown[] = [];
    let turn = 0;
    vi.mocked(generate).mockClear();
    vi.mocked(generate).mockImplementation(async (_role, { input }) => {
      efforts.push(input.findLast((i: any) => i.type === "configuration_update")?.reasoning.effort);
      turn++;
      if (turn === 1)
        throw new CutOff("max_output_tokens", true, {
          input_tokens: 100,
          output_tokens: 1000,
          output_tokens_details: { reasoning_tokens: 1000 },
        });
      const [name, args] = (
        turn === 2
          ? ["write_work", { title: "edited" }]
          : turn === 3
            ? ["view_canvas", {}]
            : ["finish", { message: "done" }]
      ) as [string, unknown];
      return {
        items: [answer(name, args, `c${turn}`)],
        usage: {},
        response: {},
      };
    });
    const run = await new Agent(() => {}).start(store, work.id, "root", "画");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("completed"));
    expect(efforts.slice(0, 3)).toEqual([undefined, "low", "medium"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("lowers a turn's effort the way its request format changes effort", () => {
  const input: any[] = [];
  const role = (protocol: string, model: string, efforts: string[]) =>
    ({ protocol, model, efforts, effort: "high" }) as never;
  // In the conversation: the request stays as it is, so the cached prefix holds.
  const astra = withLessThought(input, role("responses", "gpt-6-astra", ["low", "high", "max"]), "max")!;
  expect(input).toEqual([{ type: "configuration_update", reasoning: { effort: "low" } }]);
  expect((astra.role as any).effort).toBe("high");
  // A model whose effort only the request sets, such as DeepSeek's over Responses.
  input.length = 0;
  const deepseek = withLessThought(input, role("responses", "deepseek-flash", ["low", "high", "max"]), "high")!;
  expect(input).toEqual([]);
  expect((deepseek.role as any).effort).toBe("low");
  // Per request, in the turn itself.
  const chat = withLessThought(input, role("chat", "deepseek-chat", ["low", "high"]), "high")!;
  expect(input).toEqual([]);
  expect(chat.effort).toBe("low");
  expect((chat.role as any).effort).toBe("high");
  // Already the least it accepts.
  expect(withLessThought(input, role("chat", "x", ["high"]), "high")).toBeUndefined();
  expect(withLessThought(input, role("chat", "x", []), "high")).toBeUndefined();
});

const run_ = (work: Work): Run => ({
  id: "run",
  workId: work.id,
  sceneId: "root",
  status: "running",
  steps: [{ kind: "message", role: "user", text: "改一下", materials: [] }],
  observations: [],
  startedAt: Date.now(),
});
const said = (text: string) => ({
  items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage: {},
  response: {},
});
const called = (name: string, args: object, id = name) => ({
  items: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: id }],
  usage: {},
  response: {},
});
it("takes closing words as the end when the latest revision has been seen, without asking for finish", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const run = run_(work);
    store.saveRun(run);
    const ctx = { input: [] as any[], settings: store.settings(), generations: 0 };
    const turns = [said("还没看过就说完了"), called("view_canvas", {}), said("画好了，看图吧。")];
    let turn = 0;
    vi.mocked(generate).mockImplementation(async () => turns[turn++] as never);
    await new Agent(() => {}).execute(store, run, ctx, "request");
    expect(turn).toBe(3);
    expect(run.status).toBe("completed");
    // The words before the look were not taken for the end; the ones after it were, once.
    expect(ctx.input.some((i) => String(i.content).startsWith("The work is not done yet: "))).toBe(true);
    expect(
      run.steps.filter((s) => s.kind === "message" && s.role === "assistant").map((s) => (s as { text: string }).text),
    ).toEqual(["还没看过就说完了", "画好了，看图吧。"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
it("holds the end once for text too small to read and what the visual check found, then takes the closing words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const run = run_(work);
    store.saveRun(run);
    const ctx = { input: [] as any[], settings: store.settings(), generations: 0 };
    vi.mocked(observe).mockImplementationOnce(async (s: any, workId: string) => ({
      observation: {
        at: Date.now(),
        revision: s.work(workId).revision,
        sceneIds: ["root"],
        overview: true,
        screenshots: [],
        errors: [],
        smallestText: { root: 11 },
        defects: { root: { faults: ["text_pierce"], modules: ["apex"], links: ["l-1"] } },
      },
      content: [],
      inspected: { calls: 5, cost: 0.0009 },
    }));
    const turns = [called("view_canvas", {}), said("画好了。"), said("地图上的小字是底图自带的地名，画好了。")];
    let turn = 0;
    vi.mocked(generate).mockImplementation(async () => turns[turn++] as never);
    await new Agent(() => {}).execute(store, run, ctx, "request");
    expect(turn).toBe(3);
    expect(run.status).toBe("completed");
    const held = ctx.input.filter((i) => String(i.content).startsWith("The work is not done yet: "));
    expect(held).toHaveLength(1);
    expect(held[0].content).toContain("root 11px");
    expect(held[0].content).toContain("root: apex, l-1");
    // The check is billed with the run, apart from the drawing model.
    expect(run.usage?.inspections).toEqual({ count: 5, cost: 0.0009 });
    expect(costOf(run.usage, store.settings().prices)!.inspect).toBeCloseTo(0.0009);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
it("saves a partial write, showing only what it changed and laying out what moved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const [first, second] = work.scenes.root.modules;
    const run = run_(work);
    store.saveRun(run);
    const ctx = { input: [] as any[], settings: store.settings(), generations: 0 };
    const bounds = { x: 5, y: 6, width: 70, height: 80 };
    const turns = [
      called("write_work", { scenes: [{ id: "root", order: [second.id, first.id] }],
        modules: [
          { id: first.id, bounds: boxOf(bounds) },
          { id: second.id, data: { extra: 1 } },
        ],
      }),
      called("view_canvas", {}),
      said("好了"),
    ];
    let turn = 0;
    vi.mocked(generate).mockImplementation(async () => turns[turn++] as never);
    await new Agent(() => {}).execute(store, run, ctx, "request");
    expect(run.status).toBe("completed");
    expect(run.steps.find((s) => s.kind === "tool" && s.name === "write_work")).toMatchObject({
      status: "done",
      revision: 2,
      changed: 2,
      scenes: [{ id: "root", modules: [{ id: first.id, bounds }] }],
    });
    const saved = store.work(work.id).scenes.root;
    expect(saved.modules.find((m) => m.id === first.id)!.bounds).toEqual(bounds);
    expect(saved.modules.find((m) => m.id === second.id)!.data.extra).toBe(1);
    expect(saved.modules.length).toBe(work.scenes.root.modules.length);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
it("takes a hand edit in the same partial form, with the same checks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const id = work.scenes.root.modules[0].id;
    const { work: saved } = await writeWork(
      store,
      work.id,
      { modules: [{ id, label: "手改" }] }, { cause: { kind: "edit" } });
    expect(saved.scenes.root.modules[0].label).toBe("手改");
    await expect(
      writeWork(
        store,
        work.id,
        { modules: [{ id, drawingId: "no-such-drawing" }] }, { cause: { kind: "edit" } }),
    ).rejects.toThrow("no-such-drawing");
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("asks again when the stream breaks off, and bills the attempt that failed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true, advanceTimeDelta: 500 });
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const run = run_(work);
    store.saveRun(run);
    const ctx = { input: [] as any[], settings: store.settings(), generations: 0 };
    ctx.settings.prices = {
      ...ctx.settings.prices,
      author: { input: 4, cached: 0.2, cacheWrite: 5, output: 20 },
    };
    run.prices = ctx.settings.prices;
    let turn = 0;
    vi.mocked(generate).mockImplementation(async (_role, { onEvent }) => {
      turn++;
      if (turn === 1) {
        // The input is reported as the stream opens; the output never is.
        onEvent!({
          type: "response.usage",
          usage: {
            input_tokens: 1000,
            input_tokens_details: { cached_tokens: 900, cache_write_tokens: 100 },
            output_tokens: 0,
          },
        });
        onEvent!({ type: "response.function_call_arguments.delta", item_id: "x", delta: "a".repeat(300) });
        throw Error("模型连接在完成前中断");
      }
      return (turn === 2
        ? { ...called("view_canvas", {}), usage: { input_tokens: 50, output_tokens: 5 } }
        : said("好了")) as never;
    });
    const going = new Agent(() => {}).execute(store, run, ctx, "request");
    await vi.advanceTimersByTimeAsync(3000);
    await going;
    expect(turn).toBe(3);
    expect(run.status).toBe("completed");
    expect(run.usage).toMatchObject({
      input: 50,
      output: 5,
      failed: { attempts: 1, input: 1000, cached: 900, cacheWrite: 100, output: 100, estimated: 100, invalidCalls: 0, images: 0 },
    });
    expect(run.usage!.failed!.ms).toBeGreaterThanOrEqual(2000);
    const cost = costOf(run.usage, run.prices)!;
    // 900 read, 100 written and 100 written out, apart from what the run got.
    expect(cost.failed).toBeCloseTo((900 * 0.2 + 100 * 5 + 100 * 20) / 1e6, 8);
    expect(cost.total).toBeCloseTo(cost.author + cost.search + cost.image + cost.failed, 8);
  } finally {
    vi.useRealTimers();
    db.close();
    rmSync(dir, { recursive: true });
  }
});
it("bills a cancelled turn and counts a request that was refused, which costs nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const run = run_(work);
    store.saveRun(run);
    const ctx = { input: [] as any[], settings: store.settings(), generations: 0 };
    vi.mocked(generate).mockImplementation(async () => {
      throw Error("模型请求 400: 不行");
    });
    await new Agent(() => {}).execute(store, run, ctx, "request");
    expect(run.status).toBe("failed");
    expect(run.usage!.failed).toMatchObject({ attempts: 1, input: 0, output: 0, estimated: 0 });
    expect(costOf(run.usage, run.prices)!.failed).toBe(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("answers tool input written broken as a failed call, which the model corrects in its next turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    const run = run_(work);
    store.saveRun(run);
    const ctx = { input: [] as any[], settings: store.settings(), generations: 0 };
    const broken = '{"modules":[{"id":"x"}]}],"links":[]}';
    let turn = 0;
    const seen: any[][] = [];
    vi.mocked(generate).mockImplementation(async (_role, { input, onEvent }) => {
      seen.push(structuredClone(input));
      turn++;
      if (turn === 1) {
        onEvent!({
          type: "response.output_item.added",
          item: { id: "w", type: "function_call", name: "write_work", call_id: "w" },
        });
        return {
          items: [
            { type: "function_call", name: "write_work", arguments: broken, call_id: "w" },
            { type: "function_call", name: "view_canvas", arguments: "{}", call_id: "v" },
          ],
          usage: { input_tokens: 100, output_tokens: 40 },
          response: {},
        } as never;
      }
      if (turn === 2)
        return {
          items: [
            { type: "function_call", name: "write_work", arguments: '{"title":"改好了"}', call_id: "w2" },
            { type: "function_call", name: "view_canvas", arguments: "{}", call_id: "v2" },
          ],
          usage: { input_tokens: 200, output_tokens: 20 },
          response: {},
        } as never;
      return said("好了") as never;
    });
    await new Agent(() => {}).execute(store, run, ctx, "request");
    expect(turn).toBe(3);
    expect(run.status).toBe("completed");
    // What it wrote, why it failed, and that the look was not taken at an older version.
    const outputs = seen[1].filter((i) => i.type === "function_call_output").map((i) => i.output);
    expect(outputs[0]).toContain("不是有效的 JSON");
    expect(outputs[0]).toContain("没有保存");
    expect(outputs[1]).toContain("write_work failed");
    expect(seen[1].find((i) => i.call_id === "w" && i.type === "function_call").arguments).toBe(broken);
    // The step that streamed ended, and both turns' tokens are the run's own.
    expect(run.steps.find((s) => s.kind === "tool" && s.id === "w")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("不是有效的 JSON"),
    });
    expect(run.usage).toMatchObject({ input: 300, output: 60 });
    expect(run.usage!.failed).toMatchObject({ attempts: 0, invalidCalls: 1 });
    expect(store.work(work.id).title).toBe("改好了");
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

describe("a write that is refused", () => {
  const module = (id: string, x = 0) => ({ id, bounds: [x, 0, 100, 60], drawingId: "tier", data: { color: "#000", label: id, tip: "" } });
  /** Runs a scripted conversation of tool calls, returning what each turn saw. */
  async function script(store: any, work: Work, turns: unknown[]) {
    const run = run_(work);
    store.saveRun(run);
    const ctx: any = { input: [] as any[], settings: store.settings(), generations: 0, format: 2 };
    const seen: any[][] = [];
    let turn = 0;
    vi.mocked(generate).mockImplementation(async (_role, { input }) => {
      seen.push(structuredClone(input));
      return turns[turn++] as never;
    });
    await new Agent(() => {}).execute(store, run, ctx, "request");
    return { run, ctx, seen, outputs: (n: number) => seen[n].filter((i) => i.type === "function_call_output").map((i) => i.output) };
  }
  const setting = () => {
    const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
      db = new Storage(dir);
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    store.commit(work, 0, { kind: "edit" });
    return { store, work, done: () => (db.close(), rmSync(dir, { recursive: true })) };
  };
  it("lists every problem and is finished by sending only the correction, as one revision", async () => {
    const { store, work, done } = setting();
    try {
      const big = {
        modules: Array.from({ length: 12 }, (_, i) => module(`m${i}`, i * 120)),
        links: [
          { id: "ok", from: "m0", to: "m1" },
          { id: "a", from: "m1", to: "ghost" },
          { id: "b", from: "gone", to: "m2" },
        ],
      };
      const correction = {
        amend: true,
        links: [
          { id: "a", to: "m3" },
          { id: "b", from: "m4" },
        ],
      };
      const { run, outputs } = await script(store, work, [
        called("write_work", big),
        called("write_work", correction),
        called("view_canvas", {}),
        said("好了"),
      ]);
      expect(run.status).toBe("completed");
      const refusal = JSON.parse(outputs(1)[0]);
      expect(refusal.problems.map((p: any) => p.at)).toEqual(["links.a.to", "links.b.from"]);
      expect(refusal.problems[0].problem).toContain("ghost");
      expect(refusal.note).toContain("amend: true");
      expect(refusal.note).toContain("m11");
      // The correction costs what the mistake was worth.
      expect(JSON.stringify(correction).length).toBeLessThan(JSON.stringify(big).length / 10);
      // Both saved as one revision, on top of the one before.
      expect(store.revisions(work.id).map((r: any) => r.revision)).toEqual([2, 1]);
      const scene = store.work(work.id).scenes.root;
      expect(scene.modules.filter((m: any) => /^m\d+$/.test(m.id))).toHaveLength(12);
      expect(scene.links.map((l: any) => [l.id, l.from.moduleId, l.to.moduleId])).toEqual([
        ["ok", "m0", "m1"],
        ["a", "m1", "m3"],
        ["b", "m4", "m2"],
      ]);
      expect(store.work(work.id).scenes.root.modules[0]).toEqual(work.scenes.root.modules[0]);
    } finally {
      done();
    }
  });
  it("can be corrected in several steps, and a later whole write replaces what was held", async () => {
    const { store, work, done } = setting();
    try {
      const { outputs } = await script(store, work, [
        called("write_work", { links: [{ id: "a", from: "x", to: "y" }] }),
        called("write_work", { amend: true, modules: [module("x")] }),
        called("write_work", { title: "另写" }),
        called("view_canvas", {}),
        said("好了"),
      ]);
      expect(JSON.parse(outputs(2)[1]).problems.map((p: any) => p.at)).toEqual(["links.a.to"]);
      // The third write did not amend, so what was held is gone.
      const saved = store.work(work.id);
      expect(saved.title).toBe("另写");
      expect(saved.scenes.root.modules.some((m: any) => m.id === "x")).toBe(false);
    } finally {
      done();
    }
  });
  it("says there is nothing to amend when nothing was refused", async () => {
    const { store, work, done } = setting();
    try {
      const { outputs } = await script(store, work, [
        called("write_work", { amend: true, title: "x" }),
        called("view_canvas", {}),
        said("好了"),
      ]);
      expect(outputs(1)[0]).toContain("没有等待修正的写入");
    } finally {
      done();
    }
  });
  it("holds the records of broken JSON that arrived whole", async () => {
    const { store, work, done } = setting();
    try {
      const first = JSON.stringify(module("first"));
      const second = JSON.stringify(module("second", 200));
      const broken = `{"modules":[${first},${second},{"id":"third","bounds":[0,0,1,1],"drawingId":"tier","data":{"label":"bad "quote""}}],"links":[]}`;
      expect(() => JSON.parse(broken)).toThrow();
      const { outputs, run } = await script(store, work, [
        { items: [{ type: "function_call", name: "write_work", arguments: broken, call_id: "w" }], usage: { input_tokens: 10, output_tokens: 10 }, response: {} },
        called("write_work", { amend: true, modules: [module("third", 400)] }),
        called("view_canvas", {}),
        said("好了"),
      ]);
      const refusal = JSON.parse(outputs(1)[0]);
      expect(refusal.note).toContain("modules: first, second");
      expect(refusal.note).not.toContain("third");
      expect(run.usage!.failed).toMatchObject({ invalidCalls: 1 });
      const ids = store.work(work.id).scenes.root.modules.map((m: any) => m.id);
      expect(ids.slice(-3)).toEqual(["first", "second", "third"]);
      expect(store.revisions(work.id)).toHaveLength(2);
    } finally {
      done();
    }
  });
  it("reports a removal of what is not there without refusing the rest", async () => {
    const { store, work, done } = setting();
    try {
      const { outputs } = await script(store, work, [
        called("write_work", { title: "新", remove: { modules: ["ghost"] } }),
        called("view_canvas", {}),
        said("好了"),
      ]);
      expect(JSON.parse(outputs(1)[0]).notThere).toContain("ghost");
      expect(store.work(work.id).title).toBe("新");
    } finally {
      done();
    }
  });
});
it("starts over from what was asked when the saved conversation is in an older format", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const earlier = { ...run_(work), id: "earlier", status: "completed" as const };
    earlier.steps = [{ kind: "message", role: "user", text: "画需求层次", materials: [] }];
    store.saveRun(earlier);
    store.context("earlier", {
      input: [{ type: "function_call", name: "write_work", arguments: '{"baseRevision":1}', call_id: "old" }],
      known: 1,
      settings: store.settings(),
      generations: 3,
    });
    const seen: any[][] = [];
    vi.mocked(generate).mockImplementation(async (_role, { input }) => {
      seen.push(structuredClone(input));
      throw Error("看过就够了");
    });
    const run = await new Agent(() => {}).start(store, work.id, "root", "再加一层");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("failed"));
    const input = seen[0];
    expect(input.some((i) => i.type === "function_call")).toBe(false);
    const words = JSON.stringify(input);
    expect(words).toContain("Earlier requests on this work");
    expect(words).toContain("画需求层次");
    expect(words).toContain("Current work:");
    expect((store.context(run.id) as any).format).toBe(2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
