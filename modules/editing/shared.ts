import type { Scene, Work, WorkEdit } from "../contracts/index.ts";

/* What every hand edit is made of. A hand edit is a `WorkEdit`, the same record the author's
 * write_work sends and the workspace commits with the same checks, so a person can change
 * anything the author can and nothing it cannot. */

export const sceneOf = (work: Work, sceneId: string) => {
  const scene = work.scenes[sceneId];
  if (!scene) throw Error("场景不存在");
  return scene;
};
export const edit = (
  work: Work,
  scenes: Scene[],
  extra: Partial<WorkEdit> = {},
): WorkEdit => ({
  baseRevision: work.revision,
  scenes,
  ...extra,
});
/** An id not yet used in the work, made from a base: sun, sun-2, sun-3. */
export function fresh(base: string, taken: Set<string>) {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "part";
  if (!taken.has(clean)) return clean;
  const stem = clean.replace(/-\d+$/, "") || "part";
  let n = 2;
  while (taken.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}
/** Every module and link id in the work: ids are kept unique across scenes, so a part
 * moved or pasted into another scene never collides. */
export const partIds = (work: Work) =>
  new Set(
    Object.values(work.scenes).flatMap((s) => [
      ...s.modules.map((m) => m.id),
      ...s.links.map((l) => l.id),
    ]),
  );
/** Ids drawings and materials share: a drawing of the work's own never takes a library
 * material's id. */
export const drawingIds = (work: Work) =>
  new Set([...Object.keys(work.drawings), ...Object.keys(work.materials)]);
/** Whether code still parses, so a hand change never leaves a drawing or an interaction
 * that cannot run. */
export function compiles(source: string) {
  try {
    new Function("api", `return (async()=>{${source}\n})()`);
    return true;
  } catch {
    return false;
  }
}
/** Why code does not parse, if it does not. */
export function syntaxError(source: string): string | null {
  try {
    new Function("api", `return (async()=>{${source}\n})()`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
