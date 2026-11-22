import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../storage/index.ts";
import { register } from "../identity/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { develop } from "./index.ts";
import { library as client, useOf } from "../materials/index.ts";
import type { ImageRole, ModelCatalog } from "../contracts/index.ts";
import { serveLibrary, picture, solid } from "@drawy/materials/testing";

let dir: string, db: Storage, library: ReturnType<typeof serveLibrary>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drawy-image-test-"));
  db = new Storage(dir);
  library = serveLibrary(client.base);
});
afterEach(() => {
  library.close();
  db.close();
  rmSync(dir, { recursive: true });
  vi.unstubAllGlobals();
});
/** An author whose catalog paints at a test address, and the picture role their runs hold. */
const author = (connection: Partial<ImageRole> = {}) => {
  const store = db.scoped(register(db, "author", "abcdef").id);
  const catalog = store.storage.models();
  const { model, ...rest } = { credential: "test", baseUrl: "https://example.invalid", ...connection };
  store.storage.saveModels({
    ...catalog,
    painters: [
      {
        ...catalog.painters[0],
        ...rest,
        models: [{ ...catalog.painters[0].models[0], ...(model ? { model } : {}) }],
      },
    ],
  });
  return { store, role: store.settings().image };
};
/** What the picture service answers with one picture. */
const painted = (png: Buffer, usage?: object) =>
  Response.json({ data: [{ b64_json: png.toString("base64") }], ...(usage && { usage }) });
for (const channel of ["api", "oauth"] as const)
  it(`develops ${channel} pictures in the work's style into the library`, async () => {
    const { store, role } = author({ channel, model: "gpt-image-2" });
    const png = await picture();
    const calls: RequestInit[] = [];
    library.route(async (_url, init) => {
      calls.push(init!);
      return painted(png);
    });
    const work = fixture();
    // A later account/catalog change must not replace the supplied run connection.
    const changed = store.storage.models();
    changed.painters[0].credential = "";
    changed.painters[0].models[0].model = "other-painter";
    store.storage.saveModels(changed);
    const [made] = await develop(store, role, work, [
      {
        name: { zh: "显微镜", en: "microscope" },
        type: "object",
        depicts: "a school microscope, three-quarter view",
        references: ["microscope"],
      },
    ]);
    expect(made.id).toMatch(/^g-microscope-/);

    expect(await made.done).toEqual({ status: "ready", count: 1 });
    expect(made.settled?.status).toBe("ready");
    const m = await library.library.ready(made.id, store.userId, 0);
    expect(m).toMatchObject({
      style: "textbook",
      origin: {
        kind: "generated",
        references: ["microscope"],
        // The style's own samples, the object first, show what the style looks like.
        styleReferences: ["apple-textbook", "lighthouse-textbook"],
      },
      // Whatever a user generates is theirs until it is published.
      owner: store.userId,
      file: { mediaType: "image/webp" },
    });
    const sent = calls[0];
    const prompt =
      channel === "api"
        ? String((sent.body as FormData).get("prompt"))
        : JSON.parse(sent.body as string).prompt;
    expect(prompt.startsWith("Flat textbook line illustration")).toBe(true);
    expect(prompt).toContain(work.brief!.direction);
    expect(prompt).toContain("Image 1: what to work from");
    expect(prompt).toContain("Images 2–3: style references only");
    if (channel === "api")
      expect((sent.body as FormData).getAll("image[]")).toHaveLength(3);
    else
      expect(JSON.parse(sent.body as string)).toMatchObject({
        background: "transparent",
        images: Array.from({ length: 3 }, () => ({
          image_url: expect.stringMatching(/^data:image\/webp;base64,/),
        })),
      });
  });
it("cuts a long name before trimming its hyphens, so no id carries \"--\"", async () => {
  const { store, role } = author();
  const png = await picture();
  library.route(async () =>
    painted(png),
  );
  // Cut at 28 characters this name ends on a hyphen, which the work's references would not read.
  const [cut] = await develop(store, role, fixture(), [
    {
      name: { zh: "塑料瓶和铝罐", en: "plastic bottle and aluminum can" },
      type: "object",
      depicts: "a plastic bottle and an aluminum can",
    },
  ]);
  expect(cut.id).toMatch(/^g-plastic-bottle-and-aluminum-[0-9a-f]{4}$/);
  await cut.done;
});
it("retries a dropped connection or a busy server before giving up", async () => {
  const { store, role } = author();
  const png = await picture();
  let calls = 0;
  library.route(async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    if (calls === 2) return new Response("busy", { status: 503 });
    return painted(png);
  });
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    const [made] = await develop(store, role, fixture(), [
      { name: { zh: "鲸", en: "whale" }, type: "object", depicts: "a whale" },
    ]);
    while (!made.settled) await vi.advanceTimersByTimeAsync(1000);
    expect(await made.done).toEqual({ status: "ready", count: 1 });
    expect(calls).toBe(3);
  } finally {
    vi.useRealTimers();
  }
});
it("paints a cut-out again when it comes out with a background, and says so when it does twice", async () => {
  const { store, role } = author();
  const [clear, boxed] = [await picture(), await solid()];
  const usage = { input_tokens: 10, output_tokens: 100 };
  let answers = [boxed, clear];
  let calls = 0;
  library.route(async () => {
    return painted(answers[calls++] ?? boxed, usage);
  });
  const ask = (en: string, type: "object" | "scene" = "object") => ({
    name: { zh: en, en },
    type,
    depicts: "a " + en,
  });
  const [ship] = await develop(store, role, fixture(), [ask("ship")]);
  // Both paintings are paid for.
  expect(await ship.done).toEqual({ status: "ready", count: 2, usage: { input_tokens: 20, output_tokens: 200 } });
  expect(calls).toBe(2);
  const kept = await library.library.ready(ship.id, store.userId, 0);
  expect(kept).toMatchObject({ form: { background: "transparent" } });

  answers = [];
  calls = 0;
  const [boat] = await develop(store, role, fixture(), [ask("boat")]);
  expect(await boat.done).toMatchObject({ status: "ready", opaque: true });
  expect(boat.settled).toMatchObject({ status: "ready", opaque: true });
  expect(calls).toBe(2);

  // A scene is whole by its role, and is not painted again for it.
  calls = 0;
  const [sea] = await develop(store, role, fixture(), [ask("sea", "scene")]);
  expect(await sea.done).toMatchObject({ status: "ready" });
  expect(calls).toBe(1);
});
it("records a failed picture so the work and the author both learn of it", async () => {
  const { store, role } = author();
  library.route(async () => new Response("unsafe prompt", { status: 400 }));
  const [made] = await develop(store, role, fixture(), [
    { name: { zh: "鲸", en: "whale" }, type: "object", depicts: "a whale" },
  ]);
  expect(await made.done).toMatchObject({
    status: "failed",
    count: 0,
    error: expect.stringContaining("400"),
  });
  await expect(library.library.ready(made.id, store.userId, 0)).rejects.toThrow(
    "400",
  );
  await expect(
    develop(store, role, { ...fixture(), brief: null }, [
      { name: { zh: "鲸", en: "whale" }, type: "object", depicts: "a whale" },
    ]),
  ).rejects.toThrow("set_brief");
});

it("makes pictures that reference another in the same request after it, all private to their maker", async () => {
  const { store, role } = author({ channel: "oauth" });
  const png = await picture();
  const prompts: { subject: string; references: number }[] = [];
  library.route(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    prompts.push({
      subject: body.prompt.split("\n")[1],
      references: body.images?.length ?? 0,
    });
    return painted(png);
  });
  const mine = await client.ingest(
    png,
    "image/png",
    {
      type: "figure",
      name: { zh: "我的兔子", en: "my rabbit" },
      style: null,
      origin: { kind: "upload" },
    },
    store.userId,
  );
  const [rabbit, scene, kept] = await develop(store, role, fixture(), [
    {
      key: "rabbit",
      name: { zh: "兔子", en: "rabbit" },
      type: "figure",
      depicts: "a white rabbit",
    },
    {
      name: { zh: "迷路", en: "lost" },
      type: "scene",
      depicts: "the rabbit lost in a wood",
      references: ["rabbit"],
    },
    {
      name: { zh: "我的兔子回家", en: "home" },
      type: "scene",
      depicts: "my rabbit at home",
      references: [mine.id],
    },
  ]);
  await Promise.all([rabbit.done, scene.done, kept.done]);
  const made = await client.get([rabbit.id, scene.id, kept.id], store.userId);
  expect(made.map((m) => [m.status, m.owner, m.origin.references])).toEqual([
    ["ready", store.userId, undefined],
    ["ready", store.userId, [rabbit.id]],
    ["ready", store.userId, [mine.id]],
  ]);
  // The scene was painted from the rabbit, after the rabbit existed.
  expect(
    prompts.findIndex((p) => p.subject.includes("lost in a wood")),
  ).toBeGreaterThan(
    prompts.findIndex((p) => p.subject.includes("a white rabbit")),
  );
  // The rabbit it is made from, then two of the style's samples for the look.
  expect(prompts.find((p) => p.subject.includes("lost"))!.references).toBe(3);
});

it("paints new pictures to look like the ones the work already has in its style", async () => {
  const { store, role } = author({ channel: "oauth" });
  const png = await picture();
  const sent: { prompt: string; images: number }[] = [];
  library.route(async (url, init) => {
    const body = JSON.parse(init!.body as string);
    sent.push({ prompt: body.prompt, images: body.images?.length ?? 0 });
    expect(String(url)).toMatch(/\/images\/edits$/);
    return painted(png);
  });
  const [earlier] = await develop(store, role, fixture(), [
    { name: { zh: "鲸", en: "whale" }, type: "object", depicts: "a whale" },
  ]);
  await earlier.done;
  const [m] = await client.get([earlier.id], store.userId);
  expect(m.origin.styleReferences).toEqual([
    "apple-textbook",
    "lighthouse-textbook",
  ]);
  const work = fixture();
  work.materials[earlier.id] = useOf(m)!;
  const [later] = await develop(store, role, work, [
    {
      name: { zh: "海豚", en: "dolphin" },
      type: "object",
      depicts: "a dolphin",
    },
  ]);
  await later.done;
  const [made] = await client.get([later.id], store.userId);
  // The work's own whale comes first, then the style's object sample.
  expect(made.origin.styleReferences).toEqual([earlier.id, "apple-textbook"]);
  expect(made.origin.references).toBeUndefined();
  expect(made.owner).toBe(store.userId);
  expect(sent[1].images).toBe(2);
  expect(sent[1].prompt).toContain("Images 1–2: style references only");
  expect(sent[1].prompt).not.toContain("what to work from");
});

describe("pictures that depend on each other", () => {
  const ask = (en: string, references: string[] = [], key?: string) => ({
    name: { zh: en, en },
    type: "figure" as const,
    depicts: en,
    references,
    ...(key ? { key } : {}),
  });
  it("works from a picture listed later, and paints the independent ones side by side", async () => {
    const { store, role } = author({ channel: "oauth" });
    const png = await picture();
    const started: string[] = [];
    let open = 0,
      most = 0;
    library.route(async (_url, init) => {
      started.push(JSON.parse(init!.body as string).prompt.split("\n")[1]);
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 30));
      open--;
      return painted(png);
    });
    // The otter's picture came out failed: it named one reserved after its own.
    const made = await develop(store, role, fixture(), [
      ask("pup on the bank", ["pups"]),
      ask("sleeping pups", [], "pups"),
      ask("fish"),
    ]);
    const results = await Promise.all(made.map((d) => d.done));
    expect(results.map((r) => r.status)).toEqual(["ready", "ready", "ready"]);
    expect(started.indexOf("Subject: pup on the bank")).toBeGreaterThan(
      started.indexOf("Subject: sleeping pups"),
    );
    // The pups and the fish do not wait for each other.
    expect(most).toBeGreaterThanOrEqual(2);
  });
  it("does not paint what depends on a failed picture, and says why", async () => {
    const { store, role } = author({ channel: "oauth" });
    const png = await picture();
    let calls = 0;
    library.route(async (_url, init) => {
      calls++;
      return JSON.parse(init!.body as string).prompt.includes("broken")
        ? new Response("no", { status: 400 })
        : painted(png);
    });
    const [dependent, broken] = await develop(store, role, fixture(), [
      ask("after", ["first"]),
      ask("broken", [], "first"),
    ]);
    expect((await broken.done).status).toBe("failed");
    expect(await dependent.done).toMatchObject({ status: "failed", error: expect.stringContaining(broken.id) });
    expect(calls).toBe(1);
  });
  it("refuses circles and unknown references before anything is painted", async () => {
    const { store, role } = author({ channel: "oauth" });
    let calls = 0;
    library.route(async () => {
      calls++;
      return new Response("no", { status: 400 });
    });
    await expect(
      develop(store, role, fixture(), [ask("a", ["kb"], "ka"), ask("b", ["ka"], "kb")]),
    ).rejects.toThrow("循环");
    await expect(
      develop(store, role, fixture(), [ask("a", ["no-such-picture"])]),
    ).rejects.toThrow("参考图不存在: no-such-picture");
    expect(calls).toBe(0);
  });
});

it("defaults quality to medium, passes explicit quality, falls back to auto on HTTP 400, and thumbs style refs at 256px", async () => {
  const { store, role } = author({ channel: "oauth" });
  const png = await picture();
  const seen: { quality: string; background: string }[] = [];
  const thumbSpy = vi.spyOn(client, "thumb");
  library.route(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    seen.push({ quality: body.quality, background: body.background });
    if (body.quality === "low")
      return new Response("unsupported quality value", { status: 400 });
    return painted(png);
  });
  const made = await develop(store, role, fixture(), [
    { name: { zh: "鲸", en: "whale" }, type: "object", depicts: "a whale", references: ["microscope"] },
    { name: { zh: "星云", en: "nebula" }, type: "scene", depicts: "a nebula", quality: "high" },
    { name: { zh: "图标", en: "badge" }, type: "icon", depicts: "a star icon", quality: "low" },
  ]);
  const results = await Promise.all(made.map((d) => d.done));
  expect(results.map((r) => r.status)).toEqual(["ready", "ready", "ready"]);
  expect(seen).toContainEqual({ quality: "medium", background: "transparent" });
  expect(seen).toContainEqual({ quality: "high", background: "opaque" });
  expect(seen).toContainEqual({ quality: "low", background: "transparent" });
  expect(seen).toContainEqual({ quality: "auto", background: "transparent" });
  // Content reference uses 512px, style references use 256px.
  expect(thumbSpy).toHaveBeenCalledWith("microscope", store.viewer, 512);
  expect(thumbSpy).toHaveBeenCalledWith("apple-textbook", store.viewer, 256);
  thumbSpy.mockRestore();
});

