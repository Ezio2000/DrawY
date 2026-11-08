import type { Work } from "../../../modules/contracts/index.ts";

/* The app's addresses: the home page, a work (with a subscene under it, so the browser goes
 * back up a level), the library, the settings and the run records. */

export type Page = "home" | "work" | "library" | "settings" | "traces";
export const pageOf = (path: string): Page =>
  path.startsWith("/a/")
    ? "work"
    : path === "/library"
      ? "library"
      : path === "/settings"
        ? "settings"
        : path.startsWith("/traces")
          ? "traces"
          : "home";
export const workIdOf = (path: string) => path.match(/^\/a\/([^/]+)/)?.[1];
export const sceneOf = (path: string) => {
  const id = path.match(/^\/a\/[^/]+\/([^/]+)/)?.[1];
  return id && decodeURIComponent(id);
};
/** A scene's address: its work's, and the scene's id under it unless it is the root. */
export const addressOf = (work: Pick<Work, "id" | "rootSceneId">, sceneId = work.rootSceneId) =>
  "/a/" + work.id + (sceneId === work.rootSceneId ? "" : "/" + encodeURIComponent(sceneId));
