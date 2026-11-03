import type { Work, WorkEdit } from "../contracts/index.ts";

/* An edit laid on a work the way the workspace commits it, for showing a hand edit before
 * the workspace has answered, and for the workspace itself, so both lay it the same way. */

const sections = ["drawings", "scenes", "interactions", "details"] as const;
/** The work an edit leaves: its records upserted or removed, its style replaced, and the
 * materials it takes out gone. The revision and title stay; taking materials in is the
 * workspace's, which fetches them from the library. */
export function applied(work: Work, edit: WorkEdit): Work {
  const next = structuredClone(work);
  for (const section of sections) {
    for (const item of edit[section] || [])
      Object.assign(next[section], { [item.id]: structuredClone(item) });
    for (const key of edit.remove?.[section] || []) delete next[section][key];
  }
  for (const key of edit.remove?.materials || []) delete next.materials[key];
  if (edit.style) next.style = { ...edit.style };
  return next;
}
/** Whether a work already holds every material an edit takes in, so the edit can be shown
 * before the workspace fetches anything. */
export const showable = (work: Work, edit: WorkEdit) =>
  (edit.materials ?? []).every((id) => !!work.materials[id]);
