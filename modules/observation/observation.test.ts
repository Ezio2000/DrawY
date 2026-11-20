import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../storage/index.ts";
import { register } from "../identity/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { observe, requireObserved } from "./index.ts";
import type { Observation, Work } from "../contracts/index.ts";
afterEach(() => vi.unstubAllGlobals());
it("requires latest revision and all populated scenes; runtime errors invalidate observation", () => {
  const work = fixture();
  const seen: Observation = {
    at: 1,
    revision: 1,
    sceneIds: ["root"],
    overview: true,
    screenshots: [],
    errors: [],
  };
  expect(() => requireObserved(work, [])).toThrow();
  expect(() => requireObserved(work, [seen])).toThrow("child");
  const all = { ...seen, sceneIds: ["root", "child"] };
  expect(() => requireObserved(work, [all])).not.toThrow();
  expect(() => requireObserved({ ...work, revision: 2 }, [all])).toThrow();
  expect(() =>
    requireObserved(work, [all, { ...seen, errors: ["broken interaction"] }]),
  ).toThrow("root");
});
it("returns actual image inputs with revision, geometry and the brief to judge against, scopes captures and closes capture session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-observe-")),
    db = new Storage(dir);
  try {
    const user = register(db, "author", "abcdef"),
      store = db.scoped(user.id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          shots: [
            {
              sceneId: "root",
              label: "1440px",
              overview: true,
              viewport: { width: 1440, height: 900 },
              base64: Buffer.from("image").toString("base64"),
              errors: [],
              camera: { x: 0, y: 0, scale: 1 },
              modules: [],
            },
          ],
        }),
      ),
    );
    const result = await observe(
      store,
      work.id,
      { sceneId: "root" },
      new AbortController().signal,
    );
    // The concept sits beside the pictures it is judged against.
    expect(result.content[0].text).toContain(work.brief!.concept);
    // The pyramid spans 640×668 at scale 1 in a 1440×900 view: a third of it.
    expect(JSON.parse(result.content[1].text).figure).toEqual({
      width: 640,
      height: 668,
      viewFilled: 0.33,
    });
    expect(result.content[2]).toMatchObject({
      type: "input_image",
      image_url: "data:image/png;base64,aW1hZ2U=",
      detail: "high",
    });
    expect(result.observation.revision).toBe(1);
    expect(
      store.captureBytes(result.observation.screenshots[0].id).toString(),
    ).toBe("image");
    expect(() =>
      db
        .scoped(register(db, "other", "abcdef").id)
        .capture(result.observation.screenshots[0].id),
    ).toThrow();
    expect(db.db.prepare("SELECT count(*) n FROM sessions").get()?.n).toBe(0);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.scenes[0].url).toContain("revision=1");
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("sends each scene's modules once, only what changed since, and a close-up alone once the revision has been seen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-observe-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    work.scenes.child.modules = [];
    work.scenes.root.modules[0].data.size = 22;
    store.commit(work, 0, { kind: "edit" });
    const modules = work.scenes.root.modules.map(({ id, label, bounds }) => ({ id, label, bounds }));
    const image = Buffer.from("image").toString("base64");
    const shot = (extra: object) => ({
      sceneId: "root",
      label: "1440px",
      overview: false,
      viewport: { width: 1440, height: 900 },
      base64: image,
      errors: [],
      camera: { x: 0, y: 0, scale: 1 },
      ...extra,
    });
    let shots: object[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ shots })));
    const signal = new AbortController().signal;
    const earlier = { observations: [] as Observation[], reported: {} };
    const look = async (input: object) => {
      const r = await observe(store, work.id, input, signal, earlier);
      earlier.observations.push(r.observation);
      return r;
    };
    const texts = (content: { text?: string }[]) =>
      content.filter((c) => c.text?.startsWith("{")).map((c) => JSON.parse(c.text!));
    const asked = (n: number) =>
      JSON.parse(vi.mocked(fetch).mock.calls[n][1]!.body as string).scenes[0];

    shots = [
      shot({
        overview: true,
        modules,
        text: { smallest: { moduleId: modules[0].id, text: "字", px: 11 }, small: [{ moduleId: modules[0].id, text: "字", px: 11 }], clipped: [{ moduleId: modules[0].id, text: "被裁的字" }] },
      }),
      shot({ label: "1440px / 局部" }),
    ];
    const regions = [[0, 0, 100, 100]];
    const first = await look({ regions, claims: ["库存只在写入后变化"] });
    // With one scene drawn, a close-up needs no scene named; the first look is still whole.
    expect(asked(0)).toMatchObject({
      id: "root",
      overview: true,
      regions: [{ x: 0, y: 0, width: 100, height: 100 }],
    });
    expect(first.observation.overview).toBe(true);
    expect(first.content[0].text).toContain("库存只在写入后变化");
    const [whole, close] = texts(first.content);
    expect(whole.modules.map((m: { id: string }) => m.id)).toEqual(modules.map((m) => m.id));
    expect(whole.modules[0]).not.toHaveProperty("label");
    // Boxes in the short form the author writes them in.
    const b = modules[0].bounds;
    expect(whole.modules[0].bounds).toEqual([b.x, b.y, b.width, b.height]);
    expect(whole.figure.smallestText.px).toBe(11);
    // Every part too small to read, and the size that would read in this figure.
    expect(whole.figure.tooSmall).toEqual([{ moduleId: modules[0].id, text: "字", px: 11, size: 22, sizeThatReads: 28 }]);
    expect(whole.figure.readableFrom).toMatch(/size \d+ in scene units/);
    expect(whole.clippedText[0].text).toBe("被裁的字");
    // The other view of the same scene repeats none of it.
    expect(close).toEqual({ revision: 1, sceneId: "root", view: "1440px / 局部", camera: { x: 0, y: 0, scale: 1 } });

    // A close-up of what has been seen whole is only that close-up.
    shots = [shot({ label: "1440px / 局部" })];
    const again = await look({ regions });
    expect(asked(1).overview).toBe(false);
    expect(again.observation.overview).toBe(false);
    expect(() => requireObserved(store.work(work.id), earlier.observations)).not.toThrow();

    // A new revision is looked at whole, and only its changed modules are listed.
    work.revision = 1;
    store.commit(work, 1, { kind: "edit" });
    const moved = modules.map((m, i) => (i ? m : { ...m, bounds: { ...m.bounds, x: m.bounds.x + 10 } }));
    shots = [shot({ overview: true, modules: moved })];
    const later = await look({ regions });
    expect(asked(2).overview).toBe(true);
    const [next] = texts(later.content);
    expect(next.modules.map((m: { id: string }) => m.id)).toEqual([modules[0].id]);
    expect(next.unchangedModules).toBe(modules.length - 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
it("needs a scene named for a close-up when several are drawn, and an action's error blocks finishing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-observe-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    await expect(
      observe(store, work.id, { regions: [[0, 0, 1, 1]] }, new AbortController().signal),
    ).rejects.toThrow("sceneId");
    const seen = { at: 1, revision: 1, sceneIds: ["root", "child"], overview: true, screenshots: [], errors: [] };
    expect(() =>
      requireObserved(work, [seen, { ...seen, sceneIds: ["root"], overview: false, errors: ["点不到按钮"] }]),
    ).toThrow("root");
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("skips unchanged scenes in multi-scene observe() and allows finishing once only changed scenes are re-observed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drawy-observe-")),
    db = new Storage(dir);
  try {
    const store = db.scoped(register(db, "author", "abcdef").id),
      work = fixture();
    work.revision = 0;
    store.commit(work, 0, { kind: "edit" });
    const image = Buffer.from("image").toString("base64");
    const makeShot = (sceneId: string) => ({
      sceneId,
      label: "1440px / 全图",
      overview: true,
      viewport: { width: 1440, height: 900 },
      base64: image,
      errors: [],
      camera: { x: 0, y: 0, scale: 1 },
      modules: [],
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const req = JSON.parse(init!.body as string);
      return Response.json({ shots: req.scenes.map((s: { id: string }) => makeShot(s.id)) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const earlier = { observations: [] as Observation[], reported: {} };
    const look = async (input: object) => {
      const r = await observe(store, work.id, input, signal, earlier);
      earlier.observations.push(r.observation);
      return r;
    };

    // Initial look captures both populated scenes (root and child).
    await look({});
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).scenes.map((s: { id: string }) => s.id)).toEqual([
      "root",
      "child",
    ]);
    expect(() => requireObserved(store.work(work.id), earlier.observations)).not.toThrow();

    // Edit only child scene -> rev 2.
    const rev2 = structuredClone(store.work(work.id));
    rev2.scenes.child.modules[0].bounds.x += 20;
    store.commit(rev2, rev2.revision, { kind: "edit" });
    // Before observing child, only child is missing (root is unchanged).
    expect(() => requireObserved(store.work(work.id), earlier.observations)).toThrow("child");
    try {
      requireObserved(store.work(work.id), earlier.observations);
    } catch (e) {
      expect(String(e)).not.toContain("root");
    }

    // Default observe({}) captures ONLY child and reports root as unchanged.
    const second = await look({});
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).scenes.map((s: { id: string }) => s.id)).toEqual([
      "child",
    ]);
    expect(second.content.some((c) => c.text?.includes('"unchangedScenes":["root"]'))).toBe(true);
    expect(() => requireObserved(store.work(work.id), earlier.observations)).not.toThrow();

    // Editing a detail page leaves all scenes unchanged, so requireObserved still passes.
    const rev3 = structuredClone(store.work(work.id));
    rev3.details["note-1"] = { id: "note-1", title: "说明", html: "<p>详情</p>" };
    store.commit(rev3, rev3.revision, { kind: "edit" });
    expect(() => requireObserved(store.work(work.id), earlier.observations)).not.toThrow();

    // Editing shared work.style invalidates both root and child.
    const rev4 = structuredClone(store.work(work.id));
    rev4.style.accent = "#0055aa";
    store.commit(rev4, rev4.revision, { kind: "edit" });
    expect(() => requireObserved(store.work(work.id), earlier.observations)).toThrow("root, child");

    // A library drawing calling a work-owned drawing via api.draw invalidates the scene when the inner drawing changes.
    const rev5 = structuredClone(store.work(work.id));
    rev5.drawings["inner-part"] = {
      id: "inner-part",
      name: "inner",
      defaults: {},
      source: 'return api.svg("<svg/>");',
    };
    rev5.materials["lib-wrapper"] = {
      id: "lib-wrapper",
      kind: "drawing",
      name: "wrapper",
      defaults: {},
      params: {},
      source: 'return api.draw("inner-part", {});',
    };
    rev5.scenes.child.modules[0].drawingId = "lib-wrapper";
    store.commit(rev5, rev5.revision, { kind: "edit" });
    await look({});
    expect(() => requireObserved(store.work(work.id), earlier.observations)).not.toThrow();

    const rev6 = structuredClone(store.work(work.id));
    rev6.drawings["inner-part"].source = 'throw Error("boom");';
    store.commit(rev6, rev6.revision, { kind: "edit" });
    expect(() => requireObserved(store.work(work.id), earlier.observations)).toThrow("child");
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

