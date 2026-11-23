import type { Bindings } from "@drawy/materials/schema";
import { boundIfKnown, setBindings } from "../../../modules/editing/bindings.ts";
import { api } from "./api.ts";

let loading: Promise<Bindings> | undefined;
/** Which drawings editing draws added words, pictures and links with, as the material
 * library names them: asked once, and asked again after a failure, so a library that was
 * restarting when the page opened does not leave editing without them. */
export function loadBindings(): Promise<Bindings> {
  const known = boundIfKnown();
  if (known) return Promise.resolve(known);
  loading ??= api<Bindings>("/materials/bindings").then(
    (b) => {
      setBindings(b);
      return b;
    },
    (e) => {
      loading = undefined;
      throw e;
    },
  );
  return loading;
}
