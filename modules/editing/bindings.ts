import type { Bindings } from "@drawy/materials/schema";
import { DomainError } from "../contracts/index.ts";

/** Which library drawing editing uses for words, for a picture and for a link no one chose a
 * drawing for. The material library's packs name them; the app knows only these three
 * capabilities, never what the drawings are called. Set once the library has answered. */
let current: Bindings | undefined;
export function setBindings(b: Bindings) {
  current = b;
}
export function bound(): Bindings {
  if (!current) throw new DomainError("素材库还没有告诉应用用哪些画法编辑，请稍后再试", 503);
  return current;
}
/** The bindings if the library has answered, for what is shown rather than done: a view
 * drawn before they arrive leaves out what depends on them. */
export const boundIfKnown = (): Bindings | undefined => current;
