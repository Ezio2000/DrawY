import type { Drawing, Work, WorkEdit } from "../contracts/index.ts";
import { detailSchema, diffValue, drawingSchema } from "../contracts/index.ts";
import { drawingIds, fresh, sceneOf, syntaxError } from "./shared.ts";

/* Hand edits to the work as a whole: its shared style, its scenes, the details a click
 * opens, the scripts that run in a scene, and the code its own drawings are made of. These
 * are the records the author writes besides the parts of a scene. */

/** Changes one of the work's shared style tokens, which every drawing reads; undefined
 * takes the token out. */
export function setStyle(
  _work: Work,
  token: string,
  value: string | undefined,
): WorkEdit {
  return { style: { [token]: value ?? null } };
}
/** Gives the work a whole set of style tokens, such as a library style's. Tokens the new
 * set lacks keep their current values, so drawings that read them still have them. */
export function setStyles(_work: Work, tokens: Record<string, string>): WorkEdit {
  return { style: tokens };
}

/** Adds an empty scene under another, to be entered from a module that leads to it.
 * Returns its id. */
export function addScene(
  work: Work,
  parentId: string,
  title: string,
): { edit: WorkEdit; id: string } {
  sceneOf(work, parentId);
  const id = fresh(title || "scene", new Set(Object.keys(work.scenes)));
  return {
    edit: { scenes: [{ id, title: title.trim() || id, parentId }] },
    id,
  };
}
/** Renames a scene. */
export function renameScene(work: Work, sceneId: string, title: string): WorkEdit {
  const scene = sceneOf(work, sceneId);
  return { scenes: [{ id: sceneId, title: title.trim() || scene.title }] };
}
/** Takes a scene out with every scene below it; modules that led into them lead nowhere
 * now. The root scene stays. */
export function removeScene(work: Work, sceneId: string): WorkEdit {
  sceneOf(work, sceneId);
  if (sceneId === work.rootSceneId) throw Error("根场景不能删除");
  return { remove: { scenes: [sceneId] } };
}

/** Writes a detail: the page a click on a module opens, titled, in HTML. Returns its id. */
export function setDetail(
  work: Work,
  detail: { id?: string; title: string; html: string },
): { edit: WorkEdit; id: string } {
  const id =
    detail.id ?? fresh(detail.title || "detail", new Set(Object.keys(work.details)));
  return { edit: { details: [detailSchema.parse({ ...detail, id })] }, id };
}
/** Takes a detail out; modules that opened it open nothing now. */
export const removeDetail = (_work: Work, detailId: string): WorkEdit => ({
  remove: { details: [detailId] },
});

/** Sets the script that runs in a scene (its events and animation), or takes it out with
 * an empty one. A script that does not parse is refused. */
export function setInteraction(work: Work, sceneId: string, source: string): WorkEdit {
  sceneOf(work, sceneId);
  if (source.trim()) {
    const error = syntaxError(source);
    if (error) throw Error(error);
  }
  return { scenes: [{ id: sceneId, interaction: source.trim() ? source : null }] };
}

/** Rewrites one of the work's own drawings: its name, the values it lets people change
 * and its code. Code that does not parse, or a record that is not a drawing, is refused;
 * every module drawn with it changes. */
export function setDrawing(work: Work, drawing: Drawing): WorkEdit {
  const parsed = drawingSchema.safeParse(drawing);
  if (!parsed.success)
    throw Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "drawing"}: ${i.message}`)
        .join("; "),
    );
  const error = syntaxError(parsed.data.source);
  if (error) throw Error(error);
  const { id, name, params, defaults, source } = parsed.data;
  const was = work.drawings[id];
  return {
    drawings: [
      {
        id,
        name,
        source,
        ...(params || was?.params
          ? { params: diffValue(was?.params ?? {}, params ?? {}) as never }
          : {}),
        ...(defaults || was?.defaults
          ? { defaults: diffValue(was?.defaults ?? {}, defaults ?? {}) }
          : {}),
      },
    ],
  };
}
/** Gives some parts a drawing of the work's own to change: a copy of the drawing they are
 * drawn with (a library drawing, or one other parts share), which only they then use.
 * Returns the copy's id. */
export function fork(
  work: Work,
  sceneId: string,
  ids: string[],
  drawingId: string,
): { edit: WorkEdit; id: string } {
  const scene = sceneOf(work, sceneId);
  const id = fresh(drawingId, drawingIds(work));
  const modules = scene.modules.filter((m) => ids.includes(m.id)),
    links = scene.links.filter((l) => ids.includes(l.id));
  return {
    edit: {
      drawings: [{ id, from: drawingId }],
      ...(modules.length
        ? { modules: modules.map((m) => ({ id: m.id, scene: sceneId, drawingId: id })) }
        : {}),
      ...(links.length
        ? { links: links.map((l) => ({ id: l.id, scene: sceneId, drawingId: id })) }
        : {}),
    },
    id,
  };
}
