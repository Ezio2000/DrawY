import { boxOf, type Instance, type Link, type LinkEnd, type Scene, type Work } from "../contracts/index.ts";

/* A work as the author reads it, in the terms it writes: every record can be sent back as it
 * reads, and what a part has by default is left out. */

/** A module as the author writes it: its box in short form. */
export const shortModule = ({ bounds, ...m }: Instance) => ({ ...m, bounds: boxOf(bounds) });
const shortEnd = (end: LinkEnd) => (end.at === undefined ? end.moduleId : end);
/** A link as the author writes it: an end that follows its module is that module's id. */
export const shortLink = ({ from, to, ...l }: Link) => ({
  ...l,
  from: shortEnd(from),
  to: shortEnd(to),
});
const shortScene = (scene: Scene) => ({
  ...scene,
  modules: scene.modules.map(shortModule),
  links: scene.links.map(shortLink),
});
/** The work as the author reads it, with library code and effect definitions named, not
 * repeated. */
export function forAuthor(work: Work) {
  return {
    ...work,
    scenes: Object.fromEntries(
      Object.values(work.scenes).map((scene) => [scene.id, shortScene(scene)]),
    ),
    materials: Object.fromEntries(
      Object.values(work.materials).map((m) => [
        m.id,
        m.kind === "picture"
          ? {
              kind: m.kind,
              name: m.name,
              role: m.role,
              style: m.style,
              size: `${m.width}×${m.height}`,
              anchors: Object.keys(m.anchors),
              ...(m.recolor ? { recolor: true } : {}),
            }
          : { kind: m.kind, name: m.name },
      ]),
    ),
  };
}
