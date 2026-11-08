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
import { dictionaries } from "../i18n.tsx";
import type { ServerEvent } from "../events.ts";
import { WorkSession, type SessionHost, type View } from "./work.ts";

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
let host: SessionHost & { went: string[]; notices: string[]; failures: unknown[] };
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
    notices: [],
    failures: [],
    words: () => dictionaries.en,
    locale: () => "en",
    go(path, how) {
      host.went.push(how + " " + path);
    },
    listed: async () => {},
    spent: () => {},
    notice: (text) => void host.notices.push(text),
    fail: (e) => void host.failures.push(e),
    listen: (listener) => {
      events = listener;
      return () => (events = undefined);
    },
  };
});
afterEach(() => vi.useRealTimers());

/** Lets the requests on their way and what follows them settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));
async function open() {
  const s = new WorkSession(head.id, host);
  await settle();
  await settle();
  expect(s.get().synced).toBe(true);
  return s;
}
const moved = (w: Work) => moveParts(w, "root", [{ id: "heading", bounds: { x: 0, y: 0, width: 640, height: 70 } }]);
const heading = (w?: Work) => w?.scenes.root.modules.find((m) => m.id === "heading")!.bounds.x;

it("shows a hand edit at once and swaps the saved work in quietly", async () => {
  const s = await open();
  let open_!: () => void;
  gate = new Promise((r) => (open_ = r));
  const job = s.change(moved);
  // Before the server answers, the canvas already shows the edit, as a showing of its own.
  expect(heading(s.get().display!.work)).toBe(0);
  expect(s.get().display!.version).toBe("~1");
  expect(s.get().work!.revision).toBe(1);
  expect(s.quiet(2)).toBe(true);
  open_();
  expect(await job).toBe(true);
  await settle();
  const now = s.get();
  expect(now.draft).toBeUndefined();
  expect(now.display!.version).toBe("");
  expect(now.display!.work.revision).toBe(2);
  // The saved revision is the person's own, so the canvas lays it on without drawing it.
  expect(s.quiet(2)).toBe(true);
  expect(now.unsavedCount).toBe(1);
  expect(now.undoable).toBe(true);
});

it("takes back what a failed hand edit showed", async () => {
  const s = await open();
  refuse = "refused";
  await expect(s.change(moved)).rejects.toThrow("refused");
  expect(s.get().draft).toBeUndefined();
  expect(heading(s.get().display!.work)).toBe(100);
  expect(s.quiet(2)).toBe(false);
});

it("holds a request back while hand edits are unsaved, then saves them and sends it", async () => {
  const s = await open();
  await s.change(moved);
  await settle();
  const sent = vi.fn();
  await s.send({ text: "make it blue", sent });
  expect(s.get().holding).toBe(true);
  expect(posted.some((p) => p.path.endsWith("/runs"))).toBe(false);
  await s.decide("save");
  expect(s.get().holding).toBe(false);
  expect(posted.map((p) => p.path.split("/").at(-1))).toEqual(["edits", "save", "runs"]);
  expect(sent).toHaveBeenCalledOnce();
  expect(s.get().run?.id).toBe("run-0");
  expect(host.notices).toEqual([dictionaries.en.unsaved.saved(1)]);
});

it("a request held back can be dropped, and the edits stay", async () => {
  const s = await open();
  await s.change(moved);
  await settle();
  const sent = vi.fn();
  await s.send({ text: "make it blue", sent });
  await s.decide("cancel");
  expect(sent).not.toHaveBeenCalled();
  expect(s.get().holding).toBe(false);
  expect(s.get().unsavedCount).toBe(1);
});

it("going back to a version can be taken back for a while", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const s = new WorkSession(head.id, host);
  await vi.runOnlyPendingTimersAsync();
  await s.change(moved);
  await s.save();
  await vi.advanceTimersByTimeAsync(1);
  expect(s.get().versions.map((v) => v.number)).toEqual([0, 1]);
  await s.restore(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(heading(s.get().work)).toBe(100);
  expect(s.get().wentBack?.text).toBe(dictionaries.en.history.wentBack(0));
  expect(s.get().undoable).toBe(true);
  await s.undo();
  await vi.advanceTimersByTimeAsync(1);
  expect(heading(s.get().work)).toBe(0);
  expect(s.get().wentBack).toBeUndefined();
  // Left alone, the note goes after ten seconds and undoing steps back as usual.
  await s.restore(1);
  await vi.advanceTimersByTimeAsync(10_001);
  expect(s.get().wentBack).toBeUndefined();
});

it("redoes what undoing took back until the work changes otherwise", async () => {
  const s = await open();
  await s.change(moved);
  await settle();
  await s.undo();
  await settle();
  expect(heading(s.get().work)).toBe(100);
  expect(s.get().redoable).toBe(true);
  await s.redo();
  await settle();
  expect(heading(s.get().work)).toBe(0);
  expect(s.get().redoable).toBe(false);
  await s.undo();
  await settle();
  await s.change((w) => moveParts(w, "root", [{ id: "control", bounds: { x: 0, y: 0, width: 340, height: 48 } }]));
  expect(s.get().redoable).toBe(false);
});

it("a preview ends when the work changes under it, and shows without being drawn", async () => {
  const s = await open();
  await s.change(moved);
  await settle();
  await s.look(1);
  expect(s.get().preview?.revision).toBe(1);
  expect(s.get().locked).toBe(true);
  expect(heading(s.get().display!.work)).toBe(100);
  expect(s.quiet(1)).toBe(true);
  events!({ type: "work", work: commit(head, { kind: "edit" }) });
  expect(s.get().preview).toBeUndefined();
});

it("selects the modules an edit makes once the view has drawn them", async () => {
  const s = await open();
  let drawn!: (yes: boolean) => void;
  const view: View = {
    center: () => ({ x: 0, y: 0 }),
    scale: 1,
    select: vi.fn(),
    drawn: () => new Promise((r) => (drawn = r)),
  };
  s.attach(view);
  s.actions.select([{ moduleId: "heading", label: "", data: {} }]);
  s.ops.duplicate();
  await settle();
  await settle();
  expect(view.select).not.toHaveBeenCalled();
  drawn(true);
  await settle();
  const copy = s.get().scene!.modules.at(-1)!.id;
  expect(copy).not.toBe("heading");
  expect(view.select).toHaveBeenCalledWith([copy]);
});

it("follows a run that drew only in another scene there once it ends", async () => {
  const sub = { ...structuredClone(head.scenes.root), id: "sub", title: "Sub", parentId: "root" };
  head = commit({ ...head, scenes: { ...head.scenes, sub } }, { kind: "edit" });
  const s = await open();
  const step = { kind: "tool", name: "write_work", status: "done", scenes: [{ id: "sub" }] };
  events!({ type: "run", run: { id: "r", workId: head.id, status: "running", steps: [] } as unknown as Run });
  events!({ type: "run", run: { id: "r", workId: head.id, status: "completed", steps: [step] } as unknown as Run });
  await settle();
  expect(host.went).toEqual(["push /a/fixture/sub"]);
  expect(s.get().sceneId).toBe("root");
});

it("an address naming a scene the work does not have falls back to its root", async () => {
  const s = await open();
  s.locate("gone");
  expect(host.went).toEqual(["replace /a/fixture"]);
  expect(s.get().sceneId).toBe("root");
});

it("a selection belongs to its scene", async () => {
  const sub = { ...structuredClone(head.scenes.root), id: "sub", title: "Sub", parentId: "root" };
  head = commit({ ...head, scenes: { ...head.scenes, sub } }, { kind: "edit" });
  const s = await open();
  s.actions.select([{ moduleId: "heading", label: "Title", data: {} }]);
  expect(s.get().ids).toEqual(["heading"]);
  s.locate("sub");
  expect(s.get().ids).toEqual([]);
});
