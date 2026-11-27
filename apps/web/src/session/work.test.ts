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
    // As the server does: an edit back or forth to a revision kept is going back to it.
    return commit(applied(head, data.edit), saved.has(data.back) ? { kind: "restore", revision: data.back } : { kind: "edit" });
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


it("counts each hand edit as unsaved at once, without waiting for the revisions", async () => {
  const { store, s } = await open();
  let list!: () => void;
  const held = new Promise<void>((r) => (list = r));
  const through = server.handle;
  // The server tells every page of the edit before it answers the one that made it.
  server.handle = async (path, method, data) => {
    if (path.endsWith("/revisions")) await held;
    const answered = await through(path, method, data);
    if (path.endsWith("/edits")) events!({ type: "work", work: structuredClone(answered) as Work });
    return answered;
  };
  // The unsaved bar reads this count; it must not drop to nothing between edits.
  expect(await store.change(moved)).toBe(true);
  expect(s().synced).toBe(true);
  expect(s().unsaved).toBe(1);
  expect(await store.change(moved)).toBe(true);
  expect(s().unsaved).toBe(2);
  list();
  await settle();
  expect(s().unsaved).toBe(2);
  expect(s().undoable).toBe(true);
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


it("tells the author what a request is about", async () => {
  const { store } = await open();
  const link = { id: "l1", from: { moduleId: "heading" }, to: { moduleId: "control" } } as never;
  await store.send({ text: "bigger", focus: { modules: [{ moduleId: "heading", label: "Title" }], links: [] } });
  expect(posted.at(-1)!.data.prompt).toBe("bigger\nSelected module: heading\nTitle");
  runs[0].status = "completed" as never;
  events!({ type: "run", run: runs[0] });
  await store.send({ text: "thicker", focus: { modules: [], links: [link] } });
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
  const { store } = await open();
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
  const { s } = await open();
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
  const { s } = await open();
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

 it.each(["scene", "view"])("cancels a shape whose %s changes during library lookup", async (change) => {
  head.scenes.sub = { ...structuredClone(head.scenes.root), id: "sub", modules: [], links: [] };
  const { store } = await open();
  store.attach(slowView());
  let release!: (m: unknown) => void;
  const normal = server.handle;
  server.handle = (path, method, data) => path === "/materials/node"
    ? new Promise((r) => { release = r; }) : normal(path, method, data);
  const job = store.ops.shape("node", { title: "Hi" }, { x: 5, y: 6 });
  if (change === "scene") store.locate("sub");
  else store.attach(slowView());
  release({ kind: "drawing", size: { width: 100, height: 50 } });
  await job;
  expect(posted).toHaveLength(0);
 });

 it("keeps the drawn text box in the saved module", async () => {
  const { store, s } = await open();
  const view = slowView();
  store.attach(view);
  const box = { x: 10, y: 20, width: 180, height: 90 };
  const job = store.ops.text("Hi", { x: 0, y: 0 }, box);
  await settle(); await settle();
  view.waits[0]("drawn");
  await job;
  expect(s().scene!.modules.at(-1)!.bounds).toEqual(box);
 });

it("asks the server nothing about the blank sheet before it is saved", async () => {
  const asked: string[] = [];
  server.handle = async (path) => {
    asked.push(path);
    throw Error("no route " + path);
  };
  const store = new WorkSession("_blank", host, { ...structuredClone(head), id: "_blank" });
  await settle();
  await settle();
  expect(asked).toEqual([]);
  store.dispose();
});

it("undoes and redoes hand edits here, a step at a time, with what was selected before each", async () => {
  const { store, s } = await open();
  const picked = { modules: ["heading"], links: [] as string[] };
  const selected: string[][] = [];
  store.attach({ center: () => ({ x: 0, y: 0 }), scale: 1, select: (ids) => void selected.push(ids), picked: () => picked, drawn: async () => "drawn" } as View);
  const to = (x: number) => (w: Work) => moveParts(w, "root", [{ id: "heading", bounds: { x, y: 0, width: 640, height: 70 } }]);
  const retitle = (text: string) => (w: Work) => ({ modules: [{ id: "level-0", data: { label: text } }] });
  await store.change(to(10));
  await store.change(retitle("一"));
  expect(s().undoable).toBe(true);
  expect(s().redoable).toBe(false);
  await store.undo();
  expect(s().work!.scenes.root.modules.find((m) => m.id === "level-0")!.data.label).toBe("自我实现");
  expect(heading(s().work)).toBe(10);
  expect(s().redoable).toBe(true);
  expect(selected.at(-1)).toEqual(["heading"]);
  await store.undo();
  expect(heading(s().work)).toBe(100);
  // Each step back and forth is a hand edit of its own, not a request to the server's undo,
  // and it goes back to the revision it lays the work as: the edits not saved are counted
  // to there, not on and on.
  expect(posted.filter((p) => p.path.endsWith("/undo"))).toEqual([]);
  expect(s().unsaved).toBe(0);
  await store.redo();
  expect(s().unsaved).toBe(1);
  await store.redo();
  expect(heading(s().work)).toBe(10);
  expect(s().work!.scenes.root.modules.find((m) => m.id === "level-0")!.data.label).toBe("一");
  expect(s().redoable).toBe(false);
  expect(s().unsaved).toBe(2);
  // A new edit after undoing leaves nothing to redo.
  await store.undo();
  await store.change(to(30));
  expect(s().redoable).toBe(false);
});

it("takes steps on the same values close together as one, as typing or a slider makes them", async () => {
  const { store, s } = await open();
  const retitle = (text: string) => () => ({ modules: [{ id: "level-0", data: { label: text } }] });
  for (const text of ["自", "自我", "自我实"]) await store.change(retitle(text));
  await store.change((w) => moveParts(w, "root", [{ id: "heading", bounds: { x: 7, y: 0, width: 640, height: 70 } }]));
  await store.undo();
  expect(heading(s().work)).toBe(100);
  await store.undo();
  // The three keystrokes went back as one.
  expect(s().work!.scenes.root.modules.find((m) => m.id === "level-0")!.data.label).toBe("自我实现");
  expect(posted.filter((p) => p.path.endsWith("/undo"))).toEqual([]);
});

it("undoes on the server where nothing was edited here, and after a change from elsewhere", async () => {
  const { store, s } = await open();
  await store.change(moved);
  // The author drew meanwhile: the edits here no longer lead back over what is shown.
  events!({ type: "work", work: commit({ ...head, title: "改过" }, { kind: "run", runId: "r", prompt: "p" }) });
  await settle();
  expect(s().redoable).toBe(false);
  await store.undo();
  expect(posted.at(-1)!.path.endsWith("/undo")).toBe(true);
});

it("leaves going back to a version and taking that back as they were, beside undoing here", async () => {
  const { store, s } = await open();
  await store.change(moved);
  await store.save();
  await store.restore(1);
  expect(s().back?.to).toEqual({ kind: "version", version: 0 });
  // Undoing takes back going back; the edit made here before it was forgotten when the
  // version came back, so there is nothing of it to redo.
  await store.undo();
  expect(heading(s().work)).toBe(0);
  expect(s().back).toBeUndefined();
  expect(s().redoable).toBe(false);
});

it("offers recovery and redo after server-side undo reverts a version", async () => {
  const { store, s } = await open();
  events!({
    type: "work",
    work: commit({ ...head, title: "AI 版本" }, { kind: "run", runId: "r1", prompt: "draw it" }),
  });
  await settle();
  expect(s().undoTarget).toEqual({ kind: "version", version: 0 });
  await store.undo();
  await settle();
  expect(s().work!.title).not.toBe("AI 版本");
  expect(s().back?.undone).toBe(true);
  expect(s().back?.to).toEqual({ kind: "version", version: 0 });
  expect(s().redoable).toBe(true);
  // Redo reverses the server undo and brings the AI version back.
  await store.redo();
  await settle();
  expect(s().work!.title).toBe("AI 版本");
  expect(s().back).toBeUndefined();
  expect(s().redoable).toBe(false);
});

it("waits for the new session view to attach when materializing a blank canvas", async () => {
  const real = new WorkSession(head.id, host, structuredClone(head));
  const blankHost: SessionHost = {
    ...host,
    materialize: async () => real,
  };
  const blank = new WorkSession("_blank", blankHost, { ...structuredClone(head), id: "_blank" });
  blank.attach(slowView());
  const box = { x: 20, y: 30, width: 160, height: 80 };
  const job = blank.ops.text("First note", { x: 100, y: 70 }, box);
  await settle();
  // Attach the real session's view asynchronously (as React does on route switch).
  const realView = slowView();
  real.attach(realView);
  await settle();
  await settle();
  expect(realView.waits).toHaveLength(1);
  realView.waits[0]("drawn");
  const id = await job;
  expect(id).toBeDefined();
  expect(real.get().scene!.modules.at(-1)!.bounds).toEqual(box);
  blank.dispose();
  real.dispose();
});
