import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../storage/index.ts";
import { generateImage } from "./index.ts";
afterEach(() => vi.unstubAllGlobals());
for (const channel of ["api", "oauth"] as const)
  it(`persists ${channel} image results and encodes reference edits correctly`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "drawy-image-test-"));
    const db = new Storage(dir);
    try {
      const store = db.scoped("owner"),
        settings = store.settings();
      settings.image = {
        channel,
        model: "gpt-image-2",
        credential: "test",
        baseUrl: "https://example.invalid",
      };
      store.saveSettings(settings);
      const source = store.putAsset(
        new Uint8Array([1, 2]),
        "reference.png",
        "image/png",
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ data: [{ b64_json: "AQID", generation_id: "g" }] }),
        ),
      );
      const [a] = await generateImage(
        store,
        { prompt: "green", references: [source.id] },
        new AbortController().signal,
      );
      expect(store.bytes(a.id)).toEqual(Buffer.from([1, 2, 3]));
      expect(a.source).toBe("generated");
      expect(a.generationId).toBe("g");
      const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      if (channel === "api") {
        expect(options.body).toBeInstanceOf(FormData);
        expect((options.body as FormData).getAll("image[]")).toHaveLength(1);
      } else
        expect(JSON.parse(options.body as string).images[0].image_url).toBe(
          "data:image/png;base64,AQI=",
        );
      expect(() => db.scoped("other").asset(a.id)).toThrow();
    } finally {
      db.close();
      rmSync(dir, { recursive: true });
    }
  });
