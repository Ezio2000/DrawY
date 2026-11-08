import { isClip, type Clip } from "../../../../modules/editing/index.ts";
import type { KeyValue } from "../storage.ts";
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
 * through the storage it is given, for the other tabs. Its snapshot says whether there is
 * anything to paste. */
export class Clipboard extends Store<boolean> {
  private held?: Stamped;
  constructor(private storage: KeyValue) {
    super();
    this.publish(!!this.kept());
  }
  keep(clip: Clip) {
    const stamped: Stamped = { ...clip, copiedAt: Date.now() };
    this.held = stamped;
    this.storage.set(CLIP_KEY, JSON.stringify(stamped));
    this.publish(true);
    return stamped;
  }
  kept(): Stamped | undefined {
    try {
      const stored = JSON.parse(this.storage.get(CLIP_KEY) ?? "null");
      if (isClip(stored)) return newer(stored, this.held);
    } catch {}
    return this.held;
  }
}
