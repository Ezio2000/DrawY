import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../storage/index.ts";
import { register } from "../identity/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { Agent } from "./index.ts";
import { partialJson } from "./partial.ts";
import { generate } from "../models/index.ts";
import type { Run } from "../contracts/index.ts";
vi.mock("../models/index.ts", async (original) => ({
  ...(await original<object>()),
  generate: vi.fn(),
}));
vi.mock("../observation/index.ts", async (original) => ({
  ...(await original<object>()),
  observe: vi.fn(async (store, workId) => ({
    observation: {
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
    await new Agent(() => {}).execute(store, run, ctx);
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
    }).execute(store, run, { input: [], generations: 0 });
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
    const asset = store.putAsset(
      Buffer.from("reference"),
      "reference.png",
      "image/png",
    );
    const agent = new Agent(() => {});
    vi.mocked(generate).mockImplementation(async () => ({
      items: [
        {
          type: "function_call",
          name: "ask_question",
          call_id: crypto.randomUUID(),
          arguments: JSON.stringify({ text: "Which style?", options: [] }),
        },
      ],
      usage: {},
    }));
    const run = agent.start(store, work.id, "root", "Match this", [asset.id]);
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    const initial = store.context(run.id).input;
    agent.resume(store, run.id, "Five panels", [asset.id]);
    await vi.waitFor(() => expect(store.run(run.id).status).toBe("waiting"));
    const answered = store.context(run.id).input;
    expect(answered.slice(0, initial.length)).toEqual(initial);
    expect(answered[initial.length].content[1].image_url).toContain(
      "cmVmZXJlbmNl",
    );
    expect(store.run(run.id).steps.at(-1)).toMatchObject({
      assets: [asset.id],
    });
    agent.cancel(store, run.id);
    const current = store.work(work.id);
    store.commit({ ...current, title: "Manually edited" }, current.revision);
    const next = agent.start(store, work.id, "root", "Continue");
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
    const asset = store.putAsset(
      Buffer.from("reference"),
      "reference.png",
      "image/png",
    );
    const run: Run = {
      id: "budget",
      workId: work.id,
      sceneId: "root",
      status: "running",
      steps: [
        { kind: "message", role: "user", text: "Match", assets: [asset.id] },
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
        expect(input[0].content[1].image_url).toContain("cmVmZXJlbmNl");
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
    await agent.execute(store, run, ctx);
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
