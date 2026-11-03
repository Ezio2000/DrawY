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
/** The catalog's picture provider reached and named as a test wants it. */
const painting = (c: ModelCatalog, r: Partial<ImageRole>) => {
  const { model, ...connection } = r;
  return [
    {
      ...c.painters[0],
      ...connection,
      models: [{ ...c.painters[0].models[0], ...(model ? { model } : {}) }],
    },
  ];
};
import { serveLibrary, picture } from "@drawy/materials/testing";

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
for (const channel of ["api", "oauth"] as const)
  it(`develops ${channel} pictures in the work's style into the library`, async () => {
    const store = db.scoped(register(db, "author", "abcdef").id);
    const settings = store.settings();
    settings.image = {
      channel,
      model: "gpt-image-2",
      credential: "test",
      baseUrl: "https://example.invalid",
    };
    store.storage.saveModels({
      ...store.storage.models(),
      painters: painting(store.storage.models(), settings.image),
    });
    const png = await picture();
    const calls: RequestInit[] = [];
    library.route(async (_url, init) => {
      calls.push(init!);
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    });
    const work = fixture();
    const role = store.settings().image;
    // A later account/catalog change must not replace the supplied run connection.
    const changed = store.storage.models();
    changed.painters[0].credential = "";
    changed.painters[0].models[0].model = "other-painter";
    store.storage.saveModels(changed);
    const [made] = await develop(store, role, work, [
      {
        name: { zh: "显微镜", en: "microscope" },
        role: "object",
        depicts: "a school microscope, three-quarter view",
        references: ["microscope"],
      },
    ]);
    expect(made.id).toMatch(/^g-microscope-/);

    expect(await made.done).toEqual({ status: "ready" });
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
          image_url: expect.stringMatching(/^data:image\/png;base64,/),
        })),
      });
  });
it("cuts a long name before trimming its hyphens, so no id carries \"--\"", async () => {
  const store = db.scoped(register(db, "author", "abcdef").id);
  store.storage.saveModels({
    ...store.storage.models(),
    painters: painting(store.storage.models(), { credential: "test", baseUrl: "https://example.invalid" }),
  });
  const png = await picture();
  library.route(async () =>
    Response.json({ data: [{ b64_json: png.toString("base64") }] }),
  );
  // Cut at 28 characters this name ends on a hyphen, which the work's references would not read.
  const [cut] = await develop(store, store.settings().image, fixture(), [
    {
      name: { zh: "塑料瓶和铝罐", en: "plastic bottle and aluminum can" },
      role: "object",
      depicts: "a plastic bottle and an aluminum can",
    },
  ]);
  expect(cut.id).toMatch(/^g-plastic-bottle-and-aluminum-[0-9a-f]{4}$/);
  await cut.done;
});
it("retries a dropped connection or a busy server before giving up", async () => {
  const store = db.scoped(register(db, "author", "abcdef").id);
  const settings = store.settings();
  settings.image = {
    ...settings.image,
    credential: "test",
    baseUrl: "https://example.invalid",
  };
  store.storage.saveModels({
    ...store.storage.models(),
    painters: painting(store.storage.models(), settings.image),
  });
  const png = await picture();
  let calls = 0;
  library.route(async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    if (calls === 2) return new Response("busy", { status: 503 });
    return Response.json({ data: [{ b64_json: png.toString("base64") }] });
  });
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    const [made] = await develop(store, store.settings().image, fixture(), [
      { name: { zh: "鲸", en: "whale" }, role: "object", depicts: "a whale" },
    ]);
    while (!made.settled) await vi.advanceTimersByTimeAsync(1000);
    expect(await made.done).toEqual({ status: "ready" });
    expect(calls).toBe(3);
  } finally {
    vi.useRealTimers();
  }
});
it("records a failed picture so the work and the author both learn of it", async () => {
  const store = db.scoped(register(db, "author", "abcdef").id);
  const settings = store.settings();
  settings.image = {
    ...settings.image,
    credential: "test",
    baseUrl: "https://example.invalid",
  };
  store.storage.saveModels({
    ...store.storage.models(),
    painters: painting(store.storage.models(), settings.image),
  });
  library.route(async () => new Response("unsafe prompt", { status: 400 }));
  const [made] = await develop(store, store.settings().image, fixture(), [
    { name: { zh: "鲸", en: "whale" }, role: "object", depicts: "a whale" },
  ]);
  expect(await made.done).toMatchObject({
    status: "failed",
    error: expect.stringContaining("400"),
  });
  await expect(library.library.ready(made.id, store.userId, 0)).rejects.toThrow(
    "400",
  );
  await expect(
    develop(store, store.settings().image, { ...fixture(), brief: null }, [
      { name: { zh: "鲸", en: "whale" }, role: "object", depicts: "a whale" },
    ]),
  ).rejects.toThrow("set_brief");
});

it("makes pictures that reference another in the same request after it, all private to their maker", async () => {
  const store = db.scoped(register(db, "author", "abcdef").id);
  const settings = store.settings();
  settings.image = {
    ...settings.image,
    channel: "oauth",
    credential: "test",
    baseUrl: "https://example.invalid",
  };
  store.storage.saveModels({
    ...store.storage.models(),
    painters: painting(store.storage.models(), settings.image),
  });
  const png = await picture();
  const prompts: { subject: string; references: number }[] = [];
  library.route(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    prompts.push({
      subject: body.prompt.split("\n")[1],
      references: body.images?.length ?? 0,
    });
    return Response.json({ data: [{ b64_json: png.toString("base64") }] });
  });
  const mine = await client.ingest(
    png,
    "image/png",
    {
      role: "figure",
      name: { zh: "我的兔子", en: "my rabbit" },
      style: null,
      origin: { kind: "upload" },
    },
    store.userId,
  );
  const [rabbit, scene, kept] = await develop(store, store.settings().image, fixture(), [
    {
      key: "rabbit",
      name: { zh: "兔子", en: "rabbit" },
      role: "figure",
      depicts: "a white rabbit",
    },
    {
      name: { zh: "迷路", en: "lost" },
      role: "scene",
      depicts: "the rabbit lost in a wood",
      references: ["rabbit"],
    },
    {
      name: { zh: "我的兔子回家", en: "home" },
      role: "scene",
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
  const store = db.scoped(register(db, "author", "abcdef").id);
  const settings = store.settings();
  settings.image = {
    ...settings.image,
    channel: "oauth",
    credential: "test",
    baseUrl: "https://example.invalid",
  };
  store.storage.saveModels({
    ...store.storage.models(),
    painters: painting(store.storage.models(), settings.image),
  });
  const png = await picture();
  const sent: { prompt: string; images: number }[] = [];
  library.route(async (url, init) => {
    const body = JSON.parse(init!.body as string);
    sent.push({ prompt: body.prompt, images: body.images?.length ?? 0 });
    expect(String(url)).toMatch(/\/images\/edits$/);
    return Response.json({ data: [{ b64_json: png.toString("base64") }] });
  });
  const [earlier] = await develop(store, store.settings().image, fixture(), [
    { name: { zh: "鲸", en: "whale" }, role: "object", depicts: "a whale" },
  ]);
  await earlier.done;
  const [m] = await client.get([earlier.id], store.userId);
  expect(m.origin.styleReferences).toEqual([
    "apple-textbook",
    "lighthouse-textbook",
  ]);
  const work = fixture();
  work.materials[earlier.id] = useOf(m)!;
  const [later] = await develop(store, store.settings().image, work, [
    {
      name: { zh: "海豚", en: "dolphin" },
      role: "object",
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
  const ready = async () => {
    const store = db.scoped(register(db, "author", "abcdef").id);
    const settings = store.settings();
    settings.image = { ...settings.image, channel: "oauth", credential: "test", baseUrl: "https://example.invalid" };
    store.storage.saveModels({
      ...store.storage.models(),
      painters: painting(store.storage.models(), settings.image),
    });
    return store;
  };
  const ask = (en: string, references: string[] = [], key?: string) => ({
    name: { zh: en, en },
    role: "figure" as const,
    depicts: en,
    references,
    ...(key ? { key } : {}),
  });
  it("works from a picture listed later, and paints the independent ones side by side", async () => {
    const store = await ready();
    const png = await picture();
    const started: string[] = [];
    let open = 0,
      most = 0;
    library.route(async (_url, init) => {
      started.push(JSON.parse(init!.body as string).prompt.split("\n")[1]);
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 30));
      open--;
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    });
    // The otter's picture came out failed: it named one reserved after its own.
    const made = await develop(store, store.settings().image, fixture(), [
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
    const store = await ready();
    const png = await picture();
    let calls = 0;
    library.route(async (_url, init) => {
      calls++;
      return JSON.parse(init!.body as string).prompt.includes("broken")
        ? new Response("no", { status: 400 })
        : Response.json({ data: [{ b64_json: png.toString("base64") }] });
    });
    const [dependent, broken] = await develop(store, store.settings().image, fixture(), [
      ask("after", ["first"]),
      ask("broken", [], "first"),
    ]);
    expect((await broken.done).status).toBe("failed");
    expect(await dependent.done).toMatchObject({ status: "failed", error: expect.stringContaining(broken.id) });
    expect(calls).toBe(1);
  });
  it("refuses circles and unknown references before anything is painted", async () => {
    const store = await ready();
    let calls = 0;
    library.route(async () => {
      calls++;
      return new Response("no", { status: 400 });
    });
    await expect(
      develop(store, store.settings().image, fixture(), [ask("a", ["kb"], "ka"), ask("b", ["ka"], "kb")]),
    ).rejects.toThrow("循环");
    await expect(
      develop(store, store.settings().image, fixture(), [ask("a", ["no-such-picture"])]),
    ).rejects.toThrow("参考图不存在: no-such-picture");
    expect(calls).toBe(0);
  });
});
