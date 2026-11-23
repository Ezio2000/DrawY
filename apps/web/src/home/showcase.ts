import { useEffect, useState } from "react";
import type { Work } from "../../../../modules/contracts/index.ts";
import type { ShowcaseFile } from "../../../showcase/kit.ts";
import type { Locale } from "../ui/locale.tsx";

/* The works the home page shows, made by apps/showcase/build.ts on a running DrawY and kept
 * here as each version came back. Each is loaded only when the page first needs it. */

export type ShowcaseId =
  | "reference"
  | "night"
  | "styles"
  | "inside"
  | "lens"
  | "rhythm"
  | "range"
  | "coast"
  | "navigate"
  | "history"
  | "family";

const files = import.meta.glob<ShowcaseFile>("./showcase/*.json", { import: "default" });
const loaded = new Map<string, Promise<Work[]>>();

/** Every version of a work, oldest first, in the reader's language. */
export function loadShowcase(id: ShowcaseId, locale: Locale): Promise<Work[]> {
  const key = `./showcase/${id}.${locale === "en" ? "en" : "zh"}.json`;
  let versions = loaded.get(key);
  if (!versions) {
    versions = id === "reference" ? import("./record-player.json").then(({ default: exported }) => {
      const work = exported as Work;
      if (locale !== "en") return [work];
      const labels: Record<string, string> = {
        feet: "Isolation feet",
        case: "Walnut case",
        drive: "Motor and spindle",
        belt: "Drive belt",
        record: "Record and platter",
        arm: "Tonearm",
        leaders: "Leader lines",
      };
      const scene = work.scenes[work.rootSceneId];
      const title = "Vintage record player";
      return [{
        ...work,
        title,
        scenes: { ...work.scenes, [scene.id]: {
          ...scene, title, modules: scene.modules.map((module) => ({ ...module, label: labels[module.id] ?? module.label })),
        } },
        details: { ...work.details, "belt-note": {
          ...work.details["belt-note"],
          title: "Belt drive",
          html: "<p>A small motor pulley drives the belt, which turns a larger wheel on the platter’s spindle. Rubber mounts help keep motor vibration out of the cabinet.</p>",
        } },
      }];
    }) : files[key]().then((file) =>
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
