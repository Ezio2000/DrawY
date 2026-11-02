import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../storage/index.ts";
import { register } from "../identity/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { Agent } from "./index.ts";
import { settleSchema } from "./tools.ts";
import { writeWork } from "../workspace/index.ts";
import { partialJson } from "./partial.ts";
import { generate } from "../models/index.ts";
import { observe, Unavailable } from "../observation/index.ts";
import type { Run, Work } from "../contracts/index.ts";
import { removeParts, setData } from "../editing/index.ts";
import { library as client } from "../materials/index.ts";
import { serveLibrary, picture } from "@drawy/materials/testing";
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
  })),
}));
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
    const ctx = { input: [] as any[], generations: 0 };
    const calls = [
      ["finish", { message: "premature" }],
      ["view_canvas", {}],
      ["write_work", { baseRevision: 1, title: "edited" }],
      ["finish", { message: "stale" }],
      ["view_canvas", {}],
      ["finish", { message: "done" }],
    ] as const;
    let turn = 0,
      sawImage = false;
    vi.mocked(generate).mockImplementation(
      async (_role, _instructions, input, _tools, _signal, onEvent) => {
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
              x.content?.some((v: any) => v.type === "input_image"),
          );
        const [name, args] = calls[turn++];
        return {
          items: [
            {
              type: "function_call",
              name,
              arguments: JSON.stringify(args),
              call_id: "c" + turn,
            },
          ],
          usage: {},
          response: {},
        };
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
      ["view_canvas", "done"],
      ["write_work", "done"],
      ["view_canvas", "done"],
      ["message", "done"],
    ]);
    expect(run.steps[2]).toMatchObject({ revision: 2, removed: 0 });
    expect(run.observations.map((o) => o.revision)).toEqual([1, 2]);
    const errors = ctx.input.filter(
      (x) =>
        x.type === "function_call_output" && x.output.startsWith('{"error":'),
    );
    expect(errors).toHaveLength(2);
    expect(
      store
        .context("run")
        .input.some(
          (x: any) =>
            x.role === "user" &&
            x.content?.some((v: any) => v.type === "input_image"),
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
      args = JSON.stringify({
        baseRevision: 1,
        scenes: [scene],
        drawings: Object.values(work.drawings),
      }),
      cut = args.indexOf(JSON.stringify(scene.modules[3])),
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
      async (_role, _instructions, _input, _tools, _signal, onEvent) => {
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
            {
              type: "function_call",
              name,
              arguments: value,
              call_id: "c" + turn++,
            },
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
    }).execute(store, run, { input: [], generations: 0 }, "request");
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
          modules: scene.modules.map(({ id, label, bounds }) => ({
            id,
            label,
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
        { role: "user", content: "x".repeat(384001) },
        { type: "configuration_update", reasoning: { effort: "max" } },
      ] as any[],
      generations: 0,
    };
    let turn = 0;
    const agent = new Agent(() => {});
    vi.mocked(generate).mockImplementation(
      async (role, _instructions, input, tools, _signal, _event, budget) => {
        if (turn++ === 0) {
          expect(tools).toEqual([]);
          // A summary is made with little reasoning and room to finish.
          expect(role.effort).toBe("low");
          expect(budget).toBe(16384);
          expect(input.some((i: any) => i.type === "configuration_update")).toBe(false);
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
        expect(input[0].content[0].text).toContain("Keep five panels");
        expect(input[0].content[1].text).toContain(reference.id);
        expect(input[0].content[2].image_url).toMatch(/^data:image\/webp/);
        expect(input[1].content).toContain(work.id);
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
        { role: "user", content: "x".repeat(384001) },
        shot(1),
        shot(2),
        shot(3),
      ] as any[],
      generations: 0,
    };
    const agent = new Agent(() => {});
    const seen: any[][] = [];
    let summaries = 0;
    vi.mocked(generate).mockImplementation(async (_role, _i, input, tools) => {
      if (!tools.length) {
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
          usage: { input_tokens: 50000, output_tokens: 100 },
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
    // The second turn did not summarize again: the reported 50k tokens are under budget.
    expect(summaries).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

/** Answers each model turn with the next scripted tool call. */
function script(calls: [string, unknown][], seen: any[][] = []) {
  let turn = 0;
  vi.mocked(generate).mockImplementation(
    async (_role, _instructions, input) => {
      seen.push(structuredClone(input));
      const [name, args] = calls[turn++];
      return {
        items: [
          {
            type: "function_call",
            name,
            arguments: JSON.stringify(args),
            call_id: "c" + turn,
          },
        ],
        usage: {},
        response: {},
      };
    },
  );
}
const outputs = (input: any[]) =>
  input
    .filter((x) => x.type === "function_call_output")
    .map((x) => x.output as string);
it("gives the turns that decide the work the most thought and the others the configured effort", async () => {
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
        ["write_work", { baseRevision: 1, title: "edited" }],
        ["view_canvas", {}],
        ["write_work", { baseRevision: 2, title: "again" }],
        ["view_canvas", {}],
        ["finish", { message: "done" }],
      ],
      seen,
    );
    const run = await new Agent(() => {}).start(store, work.id, "root", "画");
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("completed"));
    const effort = (input: any[]) =>
      input.findLast((i) => i.type === "configuration_update")?.reasoning
        .effort;
    // The request and each look are decided on; writing carries the decision out.
    expect(seen.map(effort)).toEqual(["max", "medium", "max", "medium", "max"]);
    // The request keeps the configured effort, so its cached prefix holds.
    expect(vi.mocked(generate).mock.lastCall![0].effort).toBe("medium");
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
          {
            baseRevision: 2,
            drawings: [
              {
                id: "fruit",
                name: "苹果",
                source: 'return api.material("apple")',
              },
            ],
            scenes: [
              {
                ...work.scenes.root,
                modules: [
                  {
                    id: "apple",
                    label: "苹果",
                    drawingId: "fruit",
                    data: {},
                    bounds: { x: 0, y: 0, width: 200, height: 194 },
                    anchors: {},
                    group: null,
                    target: null,
                  },
                ],
                checks: [],
              },
            ],
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
it("develops pictures while the author composes and holds finish until they were seen", async () => {
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
    store.storage.saveModels({ ...store.storage.models(), image: settings.image });
    let paint!: () => void;
    const painted = new Promise<void>((r) => (paint = r));
    const png = await picture();
    library.route(async () => {
      await painted;
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
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
      { input: [], generations: 0 },
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
        baseRevision: 1,
        drawings: [
          { id: "whale", name: "鲸", source: `return api.material("${id}")` },
        ],
      },
      { kind: "edit" },
    );
    expect(written.materials[id]).toMatchObject({ status: "developing" });
    await vi.waitFor(() => expect(seen.length).toBe(3));
    expect(outputs(seen[2]).at(-1)).toContain("图片仍在生成");
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
      { input: [], generations: 0 },
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
      async (_role, _instructions, _input, _tools, _signal, onEvent) => {
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
      { input: [], generations: 0 },
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
      { baseRevision: 1, title: "drawn" },
      { kind: "run", runId: "earlier", prompt: "draw" },
    );
    for (const edit of [
      (w: Work) => setData(w, "root", "level-0", { color: "#000000" }),
      (w: Work) => removeParts(w, "root", ["control"]),
    ])
      await writeWork(store, work.id, edit(store.work(work.id)), {
        kind: "edit",
      });
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
    const told = store.context(run.id).input[1].content as string;
    expect(told).toMatch(
      /^Since your last turn the user changed the work themselves \(revision 2 to 4\)\.[^\n]*\n- scene root: changed level-0; removed control\nCurrent scene: root\n/,
    );
    // With nothing changed since, the work is given as it is.
    const work2 = store.work(work.id);
    agent.cancel(store, run.id);
    await writeWork(
      store,
      work.id,
      { baseRevision: work2.revision, title: "again" },
      { kind: "run", runId: run.id, prompt: "Continue" },
    );
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
