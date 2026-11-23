import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import sharp from "sharp";
import { Library } from "./library.ts";
import { createServer } from "./server.ts";
import { importPack } from "./pack.ts";
import { curatedPack } from "./curated.ts";

export { curatedPack };
/** A library in a temporary directory with the curated pack imported. */
export function testLibrary() {
  const dir = mkdtempSync(join(tmpdir(), "drawy-library-"));
  const library = new Library(dir);
  importPack(library, curatedPack());
  return { dir, library };
}
/** Runs a library with the curated pack in a temporary directory and routes requests for
 * `base` to it, so clients talk to a real library in tests. */
export function serveLibrary(base: string) {
  const { dir, library } = testLibrary();
  const app = createServer(library);
  const real = globalThis.fetch;
  /** Sends requests for the library to it, and the rest to `rest`. */
  const route = (rest: typeof fetch) =>
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      return url.startsWith(base) ? app.request(url.slice(base.length), init) : rest(input, init);
    }) as typeof fetch);
  route(real);
  return {
    library,
    /** Requests that did not go to the library are passed to `fn`. */
    route,
    close() {
      vi.stubGlobal("fetch", real);
      library.close();
      rmSync(dir, { recursive: true });
    },
  };
}
/** A small PNG with a coloured square on transparency. */
export function picture(color = "#a33") {
  return sharp({
    create: {
      width: 40,
      height: 20,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: { width: 10, height: 10, channels: 4, background: color },
        },
        left: 20,
        top: 5,
      },
    ])
    .png()
    .toBuffer();
}
/** A small PNG with nothing clear in it, as a cut-out that kept its background. */
export function solid(color = "#eee") {
  return sharp({
    create: { width: 40, height: 20, channels: 4, background: color },
  })
    .png()
    .toBuffer();
}
