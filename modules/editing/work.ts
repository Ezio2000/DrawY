import type {
  Detail,
  Drawing,
  Scene,
  Work,
  WorkEdit,
} from "../contracts/index.ts";
import { detailSchema, drawingSchema } from "../contracts/index.ts";
import { drawingIds, edit, fresh, sceneOf, syntaxError } from "./shared.ts";

/* Hand edits to the work as a whole: its shared style, its scenes, the details a click
 * opens, the interactions that run in a scene, and the code its own drawings are made of.
 * These are the records the author writes besides the parts of a scene. */

/** Changes one of the work's shared style tokens, which every drawing reads; undefined
 * takes the token out. */
export function setStyle(
  work: Work,
  token: string,
  value: string | undefined,
): WorkEdit {
  const style = { ...work.style };
  if (value === undefined) delete style[token];
  else style[token] = value;
  return { baseRevision: work.revision, style };
}
/** Gives the work a whole set of style tokens, such as a library style's. Tokens the new
 * set lacks keep their current values, so drawings that read them still have them. */
export function setStyles(work: Work, tokens: Record<string, string>): WorkEdit {
  return { baseRevision: work.revision, style: { ...work.style, ...tokens } };
}

/** Every scene below one, deepest last. */
function below(work: Work, sceneId: string): string[] {
  const children = Object.values(work.scenes)
    .filter((s) => s.parentId === sceneId)
    .map((s) => s.id);
  return children.flatMap((c) => [c, ...below(work, c)]);
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
  const scene: Scene = {
    id,
    title: title.trim() || id,
    parentId,
    modules: [],
    links: [],
    interactionId: null,
    checks: [],
  };
  return { edit: edit(work, [scene]), id };
}
/** Renames a scene. */
export function renameScene(
  work: Work,
  sceneId: string,
  title: string,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  return edit(work, [{ ...scene, title: title.trim() || scene.title }]);
}
/** Takes a scene out with every scene below it; modules that led into them lead nowhere
 * now. The root scene stays. */
export function removeScene(work: Work, sceneId: string): WorkEdit {
  sceneOf(work, sceneId);
  if (sceneId === work.rootSceneId) throw Error("根场景不能删除");
  const gone = new Set([sceneId, ...below(work, sceneId)]);
  const kept = Object.values(work.scenes).filter((s) => !gone.has(s.id));
  const touched = kept.flatMap((s) =>
    s.modules.some((m) => m.target?.kind === "scene" && gone.has(m.target.id))
      ? [
          {
            ...s,
            modules: s.modules.map((m) =>
              m.target?.kind === "scene" && gone.has(m.target.id)
                ? { ...m, target: null }
                : m,
            ),
          },
        ]
      : [],
  );
  return edit(work, touched, { remove: { scenes: [...gone] } });
}

/** Writes a detail: the page a click on a module opens, titled, in HTML. Returns its id. */
export function setDetail(
  work: Work,
  detail: { id?: string; title: string; html: string },
): { edit: WorkEdit; id: string } {
  const id =
    detail.id ?? fresh(detail.title || "detail", new Set(Object.keys(work.details)));
  const record: Detail = detailSchema.parse({ ...detail, id });
  return {
    edit: { baseRevision: work.revision, details: [record] },
    id,
  };
}
/** Takes a detail out; modules that opened it open nothing now. */
export function removeDetail(work: Work, detailId: string): WorkEdit {
  const touched = Object.values(work.scenes).flatMap((s) =>
    s.modules.some((m) => m.target?.kind === "detail" && m.target.id === detailId)
      ? [
          {
            ...s,
            modules: s.modules.map((m) =>
              m.target?.kind === "detail" && m.target.id === detailId
                ? { ...m, target: null }
                : m,
            ),
          },
        ]
      : [],
  );
  return edit(work, touched, { remove: { details: [detailId] } });
}

/** Sets the script that runs in a scene (its events and animation), or takes it out with
 * an empty one. A script that does not parse is refused. */
export function setInteraction(
  work: Work,
  sceneId: string,
  source: string,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  if (!source.trim()) {
    const id = scene.interactionId;
    const shared =
      !!id &&
      Object.values(work.scenes).some(
        (s) => s.id !== sceneId && s.interactionId === id,
      );
    return edit(
      work,
      [{ ...scene, interactionId: null }],
      id && !shared ? { remove: { interactions: [id] } } : {},
    );
  }
  const error = syntaxError(source);
  if (error) throw Error(error);
  const id =
    scene.interactionId ??
    fresh(`${sceneId}-script`, new Set(Object.keys(work.interactions)));
  return edit(work, [{ ...scene, interactionId: id }], {
    interactions: [{ id, source }],
  });
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
  return { baseRevision: work.revision, drawings: [parsed.data] };
}
/** Gives some parts a drawing of the work's own to change: a copy of the drawing they are
 * drawn with (a library drawing, or one other parts share), which only they then use.
 * Returns the copy's id. */
export function fork(
  work: Work,
  sceneId: string,
  ids: string[],
  copy: Omit<Drawing, "id">,
  base: string,
): { edit: WorkEdit; id: string } {
  const scene = sceneOf(work, sceneId);
  const id = fresh(base, drawingIds(work));
  return {
    edit: edit(
      work,
      [
        {
          ...scene,
          modules: scene.modules.map((m) =>
            ids.includes(m.id) ? { ...m, drawingId: id } : m,
          ),
          links: scene.links.map((l) =>
            ids.includes(l.id) ? { ...l, drawingId: id } : l,
          ),
        },
      ],
      { drawings: [{ ...copy, id }] },
    ),
    id,
  };
}
/** The parts in the work drawn with a drawing, by scene. */
export function usersOf(work: Work, drawingId: string) {
  return Object.values(work.scenes).flatMap((s) =>
    [...s.modules, ...s.links]
      .filter((p) => p.drawingId === drawingId)
      .map((p) => ({ sceneId: s.id, id: p.id })),
  );
}
