import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  stepBefore,
  type Cause,
  type RevisionSummary,
  type Run,
  type Work,
} from "../../../../modules/contracts/index.ts";
import { applied, moveParts } from "../../../../modules/editing/index.ts";
import { fixture } from "../../../../modules/runtime/fixture.ts";
import type { ServerEvent } from "../events.ts";
import { WorkSession, type Happening, type SessionHost, type View } from "./work.ts";

/** The server's part, kept in memory: revisions are added, never changed, as the real one
 * keeps them. A gate holds hand edits back to look at the page before they are saved. */
const server = vi.hoisted(() => ({
  handle: (_path: string, _method: string, _data: any): Promise<unknown> => Promise.reject(),
}));
vi.mock("../api.ts", () => ({
  api: (path: string, method = "GET", data?: unknown) => server.handle(path, method, data),
}));

let head: Work, saved: Map<number, Work>, revisions: RevisionSummary[], runs: Run[];
let gate: Promise<void> | undefined, refuse: string | undefined;
let posted: { path: string; data: any }[];
function commit(work: Work, cause: Cause) {
  head = { ...structuredClone(work), revision: head.revision + 1, updatedAt: head.updatedAt + 1 };
  saved.set(head.revision, head);
  revisions.push({ revision: head.revision, updatedAt: head.updatedAt, cause });
  return head;
}
const answer = async (path: string, method: string, data: any): Promise<unknown> => {
  if (method !== "GET") posted.push({ path, data });
  const w = "/works/" + head.id;
  if (method === "GET" && path === w) return head;
  if (path === w + "/runs" && method === "GET") return runs;
  if (path === w + "/revisions") return revisions;
  if (path.startsWith(w + "/revisions/")) return saved.get(Number(path.split("/").at(-1)));
  if (path === w + "/edits") {
    await gate;
    if (refuse) throw Error(refuse);
    if (data.baseRevision !== head.revision) throw Error("stale");
    return commit(applied(head, data.edit), { kind: "edit" });
  }
  if (path === w + "/save") return commit(head, { kind: "save" });
  if (path === w + "/restore")
    return commit(saved.get(data.revision)!, { kind: "restore", revision: data.revision });
  if (path === w + "/undo") {
    const to = stepBefore(revisions, head.revision)!;
    return commit(saved.get(to)!, { kind: "restore", revision: to });
  }
  if (path === w + "/runs") {
    const run = { id: "run-" + runs.length, workId: head.id, status: "running", steps: [], sceneId: data.sceneId } as unknown as Run;
    runs.push(run);
    return run;
  }
  throw Error("no route " + method + " " + path);
};

let events: ((e: ServerEvent) => void) | undefined;
let host: SessionHost & { went: string[] };
beforeEach(() => {
  const start = fixture();
  head = start;
  saved = new Map([[start.revision, start]]);
  revisions = [{ revision: start.revision, updatedAt: start.updatedAt, cause: { kind: "create" } }];
  runs = [];
  posted = [];
  gate = refuse = undefined;
  // What crosses the network arrives as new objects each time.
  server.handle = async (path, method, data) =>
    structuredClone(await answer(path, method, structuredClone(data)));
  host = {
    went: [],
    locale: () => "en",
    go(path, how) {
      host.went.push(how + " " + path);
    },
    listed: async () => {},
    spent: () => {},
    listen: (listener) => {
      events = listener.event;
      return () => (events = undefined);
    },
  };
});
afterEach(() => vi.useRealTimers());

/** Lets the requests on their way and what follows them settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));
/** Opens the fixture's work and waits for it and its revisions: `store` is the session,
 * whose methods are its actions, `s()` its snapshot now, and `told` what it told of. */
async function open() {
  const store = new WorkSession(head.id, host);
  const told: Happening[] = [];
  store.on((h) => told.push(h));
  await settle();
  await settle();
  const s = () => store.get();
  expect(s().synced).toBe(true);
  return { store, s, told };
}
const moved = (w: Work) => moveParts(w, "root", [{ id: "heading", bounds: { x: 0, y: 0, width: 640, height: 70 } }]);
const heading = (w?: Work) => w?.scenes.root.modules.find((m) => m.id === "heading")!.bounds.x;

it("shows a hand edit at once and swaps the saved work in quietly", async () => {
  const { store, s } = await open();
  let open_!: () => void;
  gate = new Promise((r) => (open_ = r));
  const job = store.change(moved);
  // Before the server answers, the canvas already shows the edit, as a showing of its own.
  expect(heading(s().display!.work)).toBe(0);
  expect(s().display!.version).toBe("~1");
  expect(s().work!.revision).toBe(1);
  expect(store.quiet(2)).toBe(true);
  open_();
  expect(await job).toBe(true);
  await settle();
  expect(s().display!.version).toBe("");
  expect(s().display!.work.revision).toBe(2);
  // The saved revision is the person's own, so the canvas lays it on without drawing it.
  expect(store.quiet(2)).toBe(true);
  expect(s().unsaved).toBe(1);
  expect(s().undoable).toBe(true);
});

it("takes back what a failed hand edit showed", async () => {
  const { store, s } = await open();
  refuse = "refused";
  await expect(store.change(moved)).rejects.toThrow("refused");
  expect(s().display!.version).toBe("");
  expect(heading(s().display!.work)).toBe(100);
  expect(store.quiet(2)).toBe(false);
});

it("recovers the edit queue and draft when constructing an edit throws", async () => {
  const { store, s } = await open();
  const make = vi.fn(moved).mockImplementationOnce(moved).mockImplementationOnce(() => {
    throw Error("invalid drawing parameter");
  });
  const job = store.change(make);
  expect(heading(s().display!.work)).toBe(0);
  await expect(job).rejects.toThrow("invalid drawing parameter");
  expect(s().display!.version).toBe("");
  expect(heading(s().display!.work)).toBe(100);
  expect(posted).toEqual([]);

  expect(await store.change(moved)).toBe(true);
  expect(s().display!.version).toBe("");
  expect(s().display!.work.revision).toBe(2);
  await store.save();
  await store.send({ text: "make it blue" });
  expect(s().holding).toBe(false);
  expect(posted.map((p) => p.path.split("/").at(-1))).toEqual(["edits", "save", "runs"]);
  expect(s().run?.id).toBe("run-0");
});

it("holds a request back while hand edits are unsaved, then saves them and sends it", async () => {
  const { store, s, told } = await open();
  await store.change(moved);
  await settle();
  const sent = vi.fn();
  await store.send({ text: "make it blue", sent });
  expect(s().holding).toBe(true);
  expect(posted.some((p) => p.path.endsWith("/runs"))).toBe(false);
  await store.decide("save");
  expect(s().holding).toBe(false);
  expect(posted.map((p) => p.path.split("/").at(-1))).toEqual(["edits", "save", "runs"]);
  expect(sent).toHaveBeenCalledOnce();
  expect(s().run?.id).toBe("run-0");
  // It says what happened, in no words of its own.
  expect(told).toEqual([{ kind: "saved", version: 1 }]);
});

it("holds a request back while a hand edit is still on its way", async () => {
  const { store, s } = await open();
  let open_!: () => void;
  gate = new Promise((r) => (open_ = r));
  const job = store.change(moved);
  await store.send({ text: "make it blue" });
  expect(s().holding).toBe(true);
  open_();
  await job;
});

it("a request held back can be dropped, and the edits stay", async () => {
  const { store, s } = await open();
  await store.change(moved);
  await settle();
  const sent = vi.fn();
  await store.send({ text: "make it blue", sent });
  await store.decide("cancel");
  expect(sent).not.toHaveBeenCalled();
  expect(s().holding).toBe(false);
  expect(s().unsaved).toBe(1);
});

it("tells the author what a request is about", async () => {
  const { store, s } = await open();
  const link = { id: "l1", from: { moduleId: "heading" }, to: { moduleId: "control" } } as never;
  await store.send({ text: "bigger", focus: { modules: [{ moduleId: "heading", label: "Title" }] } });
  expect(posted.at(-1)!.data.prompt).toBe("bigger\nSelected module: heading\nTitle");
  runs[0].status = "completed" as never;
  events!({ type: "run", run: runs[0] });
  await store.send({ text: "thicker", focus: { modules: [], link } });
  expect(posted.at(-1)!.data.prompt).toBe("thicker\nSelected link: l1 (heading → control)");
});

it("going back to a version can be taken back for a while", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const store = new WorkSession(head.id, host);
  const s = () => store.get();
  await vi.runOnlyPendingTimersAsync();
  await vi.runOnlyPendingTimersAsync();
  await store.change(moved);
  await store.save();
  await vi.advanceTimersByTimeAsync(1);
  expect(s().versions.map((v) => v.number)).toEqual([0, 1]);
  await store.restore(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(heading(s().work)).toBe(100);
  expect(s().back?.to).toEqual({ kind: "version", version: 0 });
  expect(s().undoable).toBe(true);
  await store.undo();
  await vi.advanceTimersByTimeAsync(1);
  expect(heading(s().work)).toBe(0);
  expect(s().back).toBeUndefined();
  // Left alone, the note goes after ten seconds and undoing steps back as usual.
  await store.restore(1);
  expect(s().back).toBeDefined();
  await vi.advanceTimersByTimeAsync(10_001);
  expect(s().back).toBeUndefined();
});

it("redoes what undoing took back until the work changes otherwise", async () => {
  const { store, s } = await open();
  await store.change(moved);
  await settle();
  await store.undo();
  await settle();
  expect(heading(s().work)).toBe(100);
  expect(s().redoable).toBe(true);
  await store.redo();
  await settle();
  expect(heading(s().work)).toBe(0);
  expect(s().redoable).toBe(false);
  await store.undo();
  await settle();
  await store.change((w) => moveParts(w, "root", [{ id: "control", bounds: { x: 0, y: 0, width: 340, height: 48 } }]));
  expect(s().redoable).toBe(false);
});

it("a preview ends when the work changes under it, and shows without being drawn", async () => {
  const { store, s } = await open();
  await store.change(moved);
  await settle();
  await store.look(1);
  expect(s().preview?.revision).toBe(1);
  expect(s().locked).toBe(true);
  expect(heading(s().display!.work)).toBe(100);
  expect(store.quiet(1)).toBe(true);
  events!({ type: "work", work: commit(head, { kind: "edit" }) });
  expect(s().preview).toBeUndefined();
});

it("does not go back to an older work the server sends late", async () => {
  const { store, s } = await open();
  const old = structuredClone(head);
  await store.change(moved);
  events!({ type: "work", work: old });
  expect(s().work!.revision).toBe(2);
});

/** A view that draws when told to, saying how it went. */
function slowView() {
  const waits: ((how: "drawn" | "missing" | "gone") => void)[] = [];
  const view: View & { waits: typeof waits } = {
    waits,
    center: () => ({ x: 0, y: 0 }),
    scale: 1,
    select: vi.fn(),
    drawn: () => new Promise((r) => waits.push(r)),
  };
  return view;
}

it("selects the modules an edit makes once the view has drawn them, however long it takes", async () => {
  const { store, s } = await open();
  const view = slowView();
  store.attach(view);
  store.ops.duplicate(["heading"]);
  await settle();
  await settle();
  expect(view.waits).toHaveLength(1);
  expect(view.select).not.toHaveBeenCalled();
  view.waits[0]("drawn");
  await settle();
  const copy = s().scene!.modules.at(-1)!.id;
  expect(copy).not.toBe("heading");
  expect(view.select).toHaveBeenCalledWith([copy]);
});

it("selects nothing when what an edit made was not drawn", async () => {
  const { store, s } = await open();
  const view = slowView();
  store.attach(view);
  const made = store.ops.text("Hi", { x: 0, y: 0 });
  await settle();
  await settle();
  view.waits[0]("missing");
  expect(await made).toBeUndefined();
  expect(view.select).not.toHaveBeenCalled();
});

it("follows a run that drew only in another scene there once it ends", async () => {
  const sub = { ...structuredClone(head.scenes.root), id: "sub", title: "Sub", parentId: "root" };
  head = commit({ ...head, scenes: { ...head.scenes, sub } }, { kind: "edit" });
  const { store, s } = await open();
  const step = { kind: "tool", name: "write_work", status: "done", scenes: [{ id: "sub" }] };
  events!({ type: "run", run: { id: "r", workId: head.id, status: "running", steps: [] } as unknown as Run });
  events!({ type: "run", run: { id: "r", workId: head.id, status: "completed", steps: [step] } as unknown as Run });
  await settle();
  expect(host.went).toEqual(["push /a/fixture/sub"]);
  expect(s().sceneId).toBe("root");
});

it("an address naming a scene the work does not have falls back to its root", async () => {
  const { store, s } = await open();
  store.locate("gone");
  expect(host.went).toEqual(["replace /a/fixture"]);
  expect(s().sceneId).toBe("root");
});

it("knows which reply was already there when the work was opened", async () => {
  runs = [{ id: "old", workId: head.id, status: "completed", steps: [] } as unknown as Run];
  const { store, s } = await open();
  expect(s().earlier).toBe("old");
});

it("names why it refuses, and tells of a forgotten edit that failed, in no words of its own", async () => {
  const { store, told } = await open();
  await expect(store.enter("nowhere")).rejects.toMatchObject({ reason: "noScene" });
  events!({ type: "run", run: { id: "r", workId: head.id, status: "running", steps: [] } as unknown as Run });
  store.ops.move([{ id: "heading", bounds: { x: 0, y: 0, width: 1, height: 1 } }]);
  expect(told).toEqual([{ kind: "failed", error: expect.objectContaining({ reason: "busy" }) }]);
});

it("asks for an empty scene in the words it is given, as the person would ask", async () => {
  const sub = { ...structuredClone(head.scenes.root), id: "sub", title: "Sub", parentId: "root", modules: [], links: [] };
  // Saved as a version: unsaved hand edits would hold the request back.
  head = commit({ ...head, scenes: { ...head.scenes, sub } }, { kind: "save" });
  const { store } = await open();
  await store.enter("sub", (title) => "Draw " + title);
  expect(host.went).toEqual(["push /a/fixture/sub"]);
  expect(posted.at(-1)).toMatchObject({ data: { prompt: "Draw Sub", sceneId: "sub" } });
});

it("tells those who listen once for the changes of one turn, and keeps what did not change", async () => {
  const { store, s } = await open();
  const before = s();
  let heard = 0;
  store.subscribe(() => heard++);
  events!({ type: "run", run: { id: "r", workId: head.id, status: "running", steps: [] } as unknown as Run });
  events!({ type: "run", run: { id: "r", workId: head.id, status: "running", steps: [{ kind: "thinking", text: "…" }] } as unknown as Run });
  await settle();
  expect(heard).toBe(1);
  const after = s();
  expect(after.runs).not.toBe(before.runs);
  // What a run does not touch is the very same, so what shows only it is not drawn again.
  expect(after.work).toBe(before.work);
  expect(after.versions).toBe(before.versions);
  expect(after.display).toBe(before.display);
});
