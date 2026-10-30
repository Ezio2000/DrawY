import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../storage/index.ts";
import { register } from "../identity/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { develop } from "./index.ts";
import { library as client } from "../materials/index.ts";
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
    store.saveSettings(settings);
    const png = await picture();
    const calls: RequestInit[] = [];
    library.route(async (_url, init) => {
      calls.push(init!);
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    });
    const work = fixture();
    const [made] = await develop(store, work, [
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
      origin: { kind: "generated", references: ["microscope"] },
      // Made from a reference, so it stays the user's own.
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
    if (channel === "api")
      expect((sent.body as FormData).getAll("image[]")).toHaveLength(1);
    else
      expect(JSON.parse(sent.body as string)).toMatchObject({
        background: "transparent",
        images: [
          { image_url: expect.stringMatching(/^data:image\/png;base64,/) },
        ],
      });
  });
it("records a failed picture so the work and the author both learn of it", async () => {
  const store = db.scoped(register(db, "author", "abcdef").id);
  const settings = store.settings();
  settings.image = {
    ...settings.image,
    credential: "test",
    baseUrl: "https://example.invalid",
  };
  store.saveSettings(settings);
  library.route(async () => new Response("quota", { status: 429 }));
  const [made] = await develop(store, fixture(), [
    { name: { zh: "鲸", en: "whale" }, role: "object", depicts: "a whale" },
  ]);
  expect(await made.done).toMatchObject({
    status: "failed",
    error: expect.stringContaining("429"),
  });
  await expect(library.library.ready(made.id, store.userId, 0)).rejects.toThrow(
    "429",
  );
  await expect(
    develop(store, { ...fixture(), brief: null }, [
      { name: { zh: "鲸", en: "whale" }, role: "object", depicts: "a whale" },
    ]),
  ).rejects.toThrow("set_brief");
});
