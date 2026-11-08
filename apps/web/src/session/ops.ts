import type {
  DrawingMaterial,
  Material,
  PictureMaterial,
} from "@drawy/materials/schema";
import {
  paramTypes,
  type Bounds,
  type Drawing,
  type Point,
  type Work,
  type WorkEdit,
} from "../../../../modules/contracts/index.ts";
import {
  add,
  align,
  arrange,
  clipBounds,
  connect,
  copy,
  distribute,
  drawingFor,
  duplicate,
  group,
  linkLook,
  moveParts,
  paste,
  reattach,
  removeParts,
  reverse,
  shadowed,
  ungroup,
  type Addition,
  type Alignment,
  type Clip,
  type Side,
  type Stacking,
} from "../../../../modules/editing/index.ts";
import { api } from "../api.ts";
import type { Context } from "./types.ts";

/* Everything a person does to a work by hand, whatever they do it with: each operation
 * acts on the parts it is given in the scene in view (what is selected is the shell's to
 * know) and ends in one hand edit committed through the session's edits. Where something
 * goes and how big it is follow the view it is drawn on. Each reports its own failure to
 * the host, so it can be called and forgotten. */

/** A library drawing as a drawing of the work's own. */
function ownCopy(m: Material, locale: "zh" | "en"): Omit<Drawing, "id"> {
  if (m.kind !== "drawing") throw Error(m.id);
  const editable = Object.entries(m.params).filter(([, p]) =>
    (paramTypes as readonly string[]).includes(p.type),
  );
  const defaults = Object.entries(m.params).filter(([, p]) => p.default !== undefined);
  return {
    name: m.name[locale],
    ...(editable.length
      ? {
          params: Object.fromEntries(
            editable.map(([k, { type, options, min, max, step }]) => [
              k,
              {
                type: type as (typeof paramTypes)[number],
                ...(options ? { options } : {}),
                ...(min !== undefined ? { min, max, step } : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(defaults.length
      ? { defaults: Object.fromEntries(defaults.map(([k, p]) => [k, p.default])) }
      : {}),
    source: m.source,
  };
}

/** Words placed by hand read at about 22 screen pixels, within what reads in a picture. */
const textSize = (scale: number) => Math.round(Math.min(96, Math.max(14, 22 / scale)));

export function editOps(ctx: Context) {
  const fail = (e: unknown) => ctx.host.fail(e);
  const report = (p: Promise<unknown>) => void p.catch(fail);
  const scene = () => ctx.scenes.sceneId;
  /** The work as shown, with the hand edits on their way laid on it. */
  const shown = () => ctx.edits.draft?.work ?? ctx.revisions.work;
  const scale = () => ctx.view?.scale || 1;
  const run = (make: (w: Work, sceneId: string) => WorkEdit | null) => {
    const sceneId = scene();
    report(ctx.edits.commit((w) => make(w, sceneId)));
  };
  /** Runs an edit that makes modules, then selects them once they are drawn; resolves to
   * the first one made, once it is drawn. */
  const made = async (make: (w: Work) => { edit: WorkEdit; ids: string[] } | null) => {
    let ids: string[] = [];
    const view = ctx.view;
    const saved = await ctx.edits.commit((w) => {
      const r = make(w);
      if (!r) return null;
      ids = r.ids;
      return r.edit;
    });
    if (!saved || !ids.length || !view || view !== ctx.view) return;
    if ((await view.drawn(ids, saved.revision)) !== "drawn") return;
    view.select(ids);
    return ids[0];
  };
  /** Adds something at a point, or in the middle of the view. */
  const place = async (what: Addition, at?: Point) => {
    const w = shown(),
      view = ctx.view;
    if (!w || !view) return;
    const centre = at ?? view.center(),
      sceneId = scene();
    try {
      // A work whose own drawing uses the library drawing's id gets a copy of it.
      const own = shadowed(w, what)
        ? ownCopy(await api<Material>("/materials/" + drawingFor(what)), ctx.host.locale())
        : undefined;
      return await made((work) => {
        const r = add(work, sceneId, centre, what, own);
        return { edit: r.edit, ids: [r.id] };
      });
    } catch (e) {
      fail(e);
    }
  };
  const picture = (p: PictureMaterial, width: number): Addition => {
    const c = p.form.content;
    return {
      kind: "picture",
      material: p.id,
      name: p.name[ctx.host.locale()],
      aspect: (p.form.height * c.height) / (p.form.width * c.width),
      width,
    };
  };
  const pasted = { key: "", n: 0 };

  const ops = {
    /** Takes out modules, or links, with what cannot stand without them. */
    remove(parts: string[]) {
      if (parts.length) run((w, s) => removeParts(w, s, parts));
    },
    /** Turns a link round. */
    reverse(link: string) {
      run((w, s) => reverse(w, s, link));
    },
    /** Moves an end of a link onto a side of a module. */
    reconnect(link: string, end: "from" | "to", to: { moduleId: string; side: Side }) {
      run((w, s) => reattach(w, s, link, end, to.side, to.moduleId));
    },
    /** Copies modules a step off, with the links between them; the copies are selected. */
    duplicate(ids: string[]) {
      const sceneId = scene();
      if (ids.length) report(made((w) => duplicate(w, sceneId, ids, 24 / scale())));
    },
    stack(ids: string[], to: Stacking) {
      if (ids.length) run((w, s) => arrange(w, s, ids, to));
    },
    group(ids: string[]) {
      if (ids.length > 1) run((w, s) => group(w, s, ids).edit);
    },
    ungroup(ids: string[]) {
      if (ids.length) run((w, s) => ungroup(w, s, ids));
    },
    align(ids: string[], to: Alignment) {
      if (ids.length) run((w, s) => align(w, s, ids, to));
    },
    distribute(ids: string[], axis: "x" | "y") {
      if (ids.length > 2) run((w, s) => distribute(w, s, ids, axis));
    },
    /** Puts modules where they were dragged or nudged to. */
    move(moves: { id: string; bounds: Bounds }[]) {
      if (!moves.length) return;
      if (ctx.runs.working) return fail(Error(ctx.host.words().work.wait));
      run((w, s) => moveParts(w, s, moves));
    },
    /** The clip of modules, with the links between them and what they draw with. */
    copy(ids: string[]): Clip | null {
      const w = shown();
      return w && ids.length ? copy(w, scene(), ids) : null;
    },
    /** Pastes parts: in the scene they came from, a step off each time; anywhere else, in
     * the middle of the view. The pasted parts are selected. */
    paste(clip: Clip) {
      const w = shown(),
        sceneId = scene();
      if (!w) return;
      const here = w.scenes[sceneId];
      const home =
        clip.workId === w.id &&
        clip.sceneId === sceneId &&
        clip.modules.some((m) => here?.modules.some((x) => x.id === m.id));
      const key = JSON.stringify([clip.workId, clip.sceneId, clip.modules.map((m) => m.id)]);
      pasted.n = pasted.key === key ? pasted.n + 1 : 1;
      pasted.key = key;
      const box = clipBounds(clip);
      const view = ctx.view;
      const where = home
        ? { offset: (24 / scale()) * pasted.n }
        : view
          ? { centre: view.center() }
          : { centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
      report(made((work) => paste(work, sceneId, clip, where)));
    },
    /** New words, sized to read in the view; resolves to their module once drawn. */
    text(at?: Point, text = ctx.host.words().edit.newText) {
      return place({ kind: "text", text, size: textSize(scale()) }, at);
    },
    /** A library picture, a readable size in the view. */
    picture(p: PictureMaterial, at?: Point) {
      return place(picture(p, Math.round(240 / scale())), at);
    },
    /** A library drawing, with its example data and size. */
    drawing(d: DrawingMaterial, at?: Point) {
      if (d.use === "link") {
        fail(Error(ctx.host.words().edit.linkDrawing));
        return Promise.resolve(undefined);
      }
      return place(
        {
          kind: "drawing",
          material: d.id,
          name: d.name[ctx.host.locale()],
          size: d.size,
          data: d.example ?? {},
        },
        at,
      );
    },
    /** Links one module's side to another's, drawn like the scene's other links, or with
     * the library's arrow when it has none. */
    connect(from: { moduleId: string; side: Side }, to: { moduleId: string; side: Side }) {
      const w = shown(),
        sceneId = scene();
      if (!w) return;
      report(
        (async () => {
          const like = linkLook(w, sceneId);
          const look = like ?? { drawingId: "arrow", data: {} };
          // The library's arrow comes in as a copy when one of the work's own drawings
          // already uses its id.
          const own =
            !like && w.drawings.arrow
              ? ownCopy(await api<Material>("/materials/arrow"), ctx.host.locale())
              : undefined;
          await ctx.edits.commit((work) => connect(work, sceneId, from, to, look, own).edit);
        })(),
      );
    },
    /** Uploads pictures pasted or dropped onto the canvas and places them, a step apart. */
    pictures(files: File[]) {
      const view = ctx.view;
      if (!view) return;
      report(
        (async () => {
          let at = view.center();
          for (const file of files) {
            const data = new FormData();
            data.append("file", file);
            const m = await api<Material>("/materials", "POST", data);
            if (m.kind !== "picture") continue;
            await place(picture(m, Math.round(240 / view.scale)), at);
            at = { x: at.x + 24 / view.scale, y: at.y + 24 / view.scale };
          }
        })(),
      );
    },
    /** Words pasted onto the canvas, as words of the work's own. */
    words(text: string) {
      void ops.text(undefined, text);
    },
  };
  return ops;
}
export type SessionOps = ReturnType<typeof editOps>;
