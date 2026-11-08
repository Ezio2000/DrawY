import { isClip, type Clip } from "../../../../modules/editing/index.ts";

/* The parts last copied, for pasting into any scene, work or tab: kept for this tab and,
 * where storage allows, for the others. */

/** The type a clip goes by on the system clipboard. */
export const CLIP_TYPE = "application/x-drawy+json";
const CLIP_KEY = "drawy.clip";
let held: Clip | undefined;
/** A clip with when it was copied: the system clipboard can hold an older clip than one
 * copied from the menu, which cannot write to it, and the newer one is what is pasted. */
export type Stamped = Clip & { copiedAt?: number };
export const newer = (a: Stamped, b?: Stamped) =>
  (b?.copiedAt ?? 0) > (a.copiedAt ?? 0) ? b! : a;
export function keep(clip: Clip) {
  held = clip;
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify(clip));
  } catch {}
}
export function kept(): Clip | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(CLIP_KEY) ?? "null");
    if (isClip(stored)) return stored;
  } catch {}
  return held;
}
