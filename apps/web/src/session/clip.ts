import { isClip, type Clip } from "../../../../modules/editing/index.ts";
import { store, stored } from "../storage.ts";
import { Store } from "./store.ts";

/** The type a clip goes by on the system clipboard. */
export const CLIP_TYPE = "application/x-drawy+json";
const CLIP_KEY = "drawy.clip";
/** A clip with when it was copied: the system clipboard can hold an older clip than one
 * copied from a menu, which cannot write to it, and the newer one is what is pasted. */
export type Stamped = Clip & { copiedAt?: number };
export const newer = (a: Stamped, b?: Stamped) =>
  (b?.copiedAt ?? 0) > (a.copiedAt ?? 0) ? b! : a;

/** The parts last copied, for pasting into any scene, work or tab: kept in this page and,
 * in local storage, for the other tabs. Its snapshot says whether there is
 * anything to paste. */
export class Clipboard extends Store<boolean> {
  private held?: Stamped;
  protected build() {
    return !!this.kept();
  }
  keep(clip: Clip) {
    const stamped: Stamped = { ...clip, copiedAt: Date.now() };
    this.held = stamped;
    store(CLIP_KEY, JSON.stringify(stamped));
    this.changed();
    return stamped;
  }
  kept(): Stamped | undefined {
    try {
      const saved = JSON.parse(stored(CLIP_KEY) ?? "null");
      if (isClip(saved)) return newer(saved, this.held);
    } catch {}
    return this.held;
  }
}
