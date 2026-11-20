import { useEffect, useState } from "react";
import type { Work } from "../../../../modules/contracts/index.ts";
import type { ShowcaseFile } from "../../../showcase/kit.ts";
import type { Locale } from "../ui/locale.tsx";

/* The works the home page shows, made by apps/showcase/build.ts on a running DrawY and kept
 * here as each version came back. Each is loaded only when the page first needs it. */

export type ShowcaseId =
  | "solar"
  | "apple"
  | "heart"
  | "silk"
  | "mansion"
  | "model"
  | "water"
  | "space"
  | "poster";

const files = import.meta.glob<ShowcaseFile>("./showcase/*.json", { import: "default" });
const loaded = new Map<string, Promise<Work[]>>();

/** Every version of a work, oldest first, in the reader's language. */
export function loadShowcase(id: ShowcaseId, locale: Locale): Promise<Work[]> {
  const key = `./showcase/${id}.${locale === "en" ? "en" : "zh"}.json`;
  let versions = loaded.get(key);
  if (!versions) {
    versions = files[key]().then((file) =>
      file.versions.map((v) => ({
        ...v,
        materials: Object.fromEntries(v.materials.map((m) => [m, file.materials[m]])),
      })),
    );
    loaded.set(key, versions);
  }
  return versions;
}

/** A work's versions once they have arrived; empty until then. */
export function useShowcase(id: ShowcaseId, locale: Locale, wanted = true) {
  const [versions, setVersions] = useState<Work[]>([]);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void loadShowcase(id, locale).then((v) => live && setVersions(v));
    return () => {
      live = false;
    };
  }, [id, locale, wanted]);
  return versions;
}
