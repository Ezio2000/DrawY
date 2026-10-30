import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../storage/index.ts";
import { register } from "../identity/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { Agent } from "./index.ts";
import { writeWork } from "../workspace/index.ts";
import { partialJson } from "./partial.ts";
import { generate } from "../models/index.ts";
import type { Run } from "../contracts/index.ts";
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
    store.commit(work, 0);
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
    store.commit(work, 0);
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
    store.commit(work, 0);
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
    }));
    const run = await agent.start(store, work.id, "root", "Match this", [
      reference.id,
    ]);
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    expect(store.run(run.id).questions![0].options[1]).toMatchObject({
      label: "Crayon",
      // A style option shows the style's own samples.
      pictures: [
        { id: "apple-crayon", url: "/materials/files/apple-crayon" },
        { id: "earth" },
        { id: "sun" },
      ],
    });
    const initial = store.context(run.id).input;
    await agent.resume(store, run.id, "Five panels", [reference.id]);
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    const answered = store.context(run.id).input;
    expect(answered.slice(0, initial.length)).toEqual(initial);
    expect(answered[initial.length].content[1].image_url).toMatch(
      /^data:image\/webp;base64,/,
    );
    expect(store.run(run.id).steps.at(-1)).toMatchObject({
      materials: [reference.id],
    });
    agent.cancel(store, run.id);
    const current = store.work(work.id);
    store.commit({ ...current, title: "Manually edited" }, current.revision);
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
    store.commit(work, 0);
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
      input: [{ role: "user", content: "x".repeat(384001) }] as any[],
      generations: 0,
    };
    let turn = 0;
    const agent = new Agent(() => {});
    vi.mocked(generate).mockImplementation(
      async (_role, _instructions, input, tools) => {
        if (turn++ === 0) {
          expect(tools).toEqual([]);
          return {
            items: [
              {
                type: "message",
                content: [{ type: "output_text", text: "Keep five panels" }],
              },
            ],
            usage: {},
          };
        }
        expect(input[0].content[0].text).toContain("Keep five panels");
        expect(input[0].content[1].image_url).toMatch(/^data:image\/webp/);
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
      };
    },
  );
}
const outputs = (input: any[]) =>
  input
    .filter((x) => x.type === "function_call_output")
    .map((x) => x.output as string);
it("settles a brief only on the user's own words, then applies its style and shows the cast", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-agent-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.brief = null;
    for (const s of Object.values(work.scenes)) s.modules = [];
    store.commit(work, 0);
    const brief = {
      subject: "苹果（水果）的结构",
      intent: "果皮、果肉、果核与种子",
      audience: "初中生",
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
            basis: { subject: "苹果", intent: "结构", register: "教科书" },
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
      seen[3].at(-1).content.some((c: any) => c.type === "input_image"),
    ).toBe(true);
    const step = store
      .run(run.id)
      .steps.find(
        (s) =>
          s.kind === "tool" && s.name === "set_brief" && s.status === "done",
      );
    expect(step).toMatchObject({
      revision: 2,
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
    store.commit(work, 0);
    const settings = store.settings();
    settings.image = {
      ...settings.image,
      credential: "test",
      baseUrl: "https://example.invalid",
    };
    store.saveSettings(settings);
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
    const { work: written } = await writeWork(store, work.id, {
      baseRevision: 1,
      drawings: [
        { id: "whale", name: "鲸", source: `return api.material("${id}")` },
      ],
    });
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
