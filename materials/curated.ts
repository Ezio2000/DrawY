import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../content/build.ts";

let pack: string | undefined;
/** The curated content as a material pack, built once per process, for tests and
 * measurements. The app itself never builds packs: it imports the ones it is given. */
export function curatedPack() {
  if (!pack) {
    pack = join(mkdtempSync(join(tmpdir(), "drawy-pack-")), "pack");
    build(pack, "test");
    process.on("exit", () => rmSync(join(pack!, ".."), { recursive: true, force: true }));
  }
  return pack;
}
