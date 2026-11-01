import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../storage/index.ts";
import { register } from "../identity/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { observe, requireObserved } from "./index.ts";
import type { Observation } from "../contracts/index.ts";
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
it("returns actual image inputs with revision and geometry, scopes captures and closes capture session", async () => {
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
    expect(result.content[1]).toMatchObject({
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
