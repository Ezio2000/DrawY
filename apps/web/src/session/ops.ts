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
import { keep, kept, type Stamped } from "./clip.ts";
import type { WorkSession } from "./work.ts";

/* Everything a person does to a work by hand, whatever they do it with: each operation
 * acts on the selection in the scene in view and ends in one hand edit committed through
 * the session's `change`. Where something goes and how big it is follow the view it is
 * drawn on. Each reports its own failure to the host, so it can be called and forgotten. */

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

export function editOps(s: WorkSession) {
  const fail = (e: unknown) => s.host.fail(e);
  const report = (p: Promise<unknown>) => void p.catch(fail);
  const now = () => s.get();
  const scale = () => s.view?.scale || 1;
  const run = (make: (w: Work) => WorkEdit | null) => report(s.change(make));
  /** Runs an edit that makes modules, then selects them once they are drawn; resolves to
   * the first one made. */
  const made = async (make: (w: Work) => { edit: WorkEdit; ids: string[] } | null) => {
    const sceneId = now().sceneId;
    let ids: string[] = [];
    await s.change((w) => {
      const r = make(w);
      if (!r) return null;
      ids = r.ids;
      return r.edit;
    });
    const view = s.view;
    if (ids.length && view && now().sceneId === sceneId && (await view.drawn(ids)))
      view.select(ids);
    return ids[0] as string | undefined;
  };
  /** Adds something at a point, or in the middle of the view; resolves to its id once it
   * is drawn and selected, or to nothing when it could not be. */
  const place = async (what: Addition, at?: Point) => {
    const w = now().shown,
      view = s.view;
    if (!w || !view) return;
    const centre = at ?? view.center(),
      sceneId = now().sceneId;
    try {
      // A work whose own drawing uses the library drawing's id gets a copy of it.
      const own = shadowed(w, what)
        ? ownCopy(await api<Material>("/materials/" + drawingFor(what)), s.host.locale())
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
      name: p.name[s.host.locale()],
      aspect: (p.form.height * c.height) / (p.form.width * c.width),
      width,
    };
  };
  const pasted = { key: "", n: 0 };

  const ops = {
    /** Takes out the selected modules, or the selected link. */
    remove() {
      const { ids, link, sceneId } = now();
      const gone = ids.length ? ids : link ? [link] : [];
      if (gone.length) run((w) => removeParts(w, sceneId, gone));
    },
    /** Turns a link round: the selected one unless another is named. */
    reverse(id = now().link) {
      const { sceneId } = now();
      if (id) run((w) => reverse(w, sceneId, id));
    },
    /** Moves an end of a link onto a side of a module. */
    reconnect(id: string, end: "from" | "to", to: { moduleId: string; side: Side }) {
      const { sceneId } = now();
      run((w) => reattach(w, sceneId, id, end, to.side, to.moduleId));
    },
    duplicate() {
      const { ids, sceneId } = now();
      if (ids.length) report(made((w) => duplicate(w, sceneId, ids, 24 / scale())));
    },
    stack(to: Stacking) {
      const { ids, sceneId } = now();
      if (ids.length) run((w) => arrange(w, sceneId, ids, to));
    },
    group() {
      const { ids, sceneId } = now();
      if (ids.length > 1) run((w) => group(w, sceneId, ids).edit);
    },
    ungroup() {
      const { ids, sceneId } = now();
      if (ids.length) run((w) => ungroup(w, sceneId, ids));
    },
    align(to: Alignment) {
      const { ids, sceneId } = now();
      if (ids.length) run((w) => align(w, sceneId, ids, to));
    },
    distribute(axis: "x" | "y") {
      const { ids, sceneId } = now();
      if (ids.length > 2) run((w) => distribute(w, sceneId, ids, axis));
    },
    /** Puts modules where they were dragged or nudged to. */
    move(moves: { id: string; bounds: Bounds }[]) {
      const { sceneId, working } = now();
      if (!moves.length) return;
      if (working) return fail(Error(s.host.words().work.wait));
      run((w) => moveParts(w, sceneId, moves));
    },
    selectAll() {
      s.view?.select(now().scene?.modules.map((m) => m.id) ?? []);
    },
    /** Selects the next module in the stacking order, or the one before. */
    cycle(back: boolean) {
      const { scene, ids } = now();
      const modules = scene?.modules ?? [];
      if (!modules.length) return;
      const at = modules.findIndex((m) => m.id === ids.at(-1));
      const next =
        at < 0
          ? back
            ? modules.length - 1
            : 0
          : (at + (back ? -1 : 1) + modules.length) % modules.length;
      s.view?.select([modules[next].id]);
    },
    /** Copies the selected modules, with the links between them and what they draw with. */
    copy(): Clip | null {
      const { shown, ids, sceneId } = now();
      if (!shown || !ids.length) return null;
      const clip = copy(shown, sceneId, ids);
      if (!clip) return null;
      const stamped: Stamped = { ...clip, copiedAt: Date.now() };
      keep(stamped);
      s.clipped();
      return stamped;
    },
    cut() {
      if (ops.copy()) ops.remove();
    },
    /** Pastes parts: in the scene they came from, a step off each time; anywhere else, in
     * the middle of the view. */
    paste(clip = kept()) {
      const { shown, sceneId } = now();
      if (!clip || !shown) return;
      const scene = shown.scenes[sceneId];
      const home =
        clip.workId === shown.id &&
        clip.sceneId === sceneId &&
        clip.modules.some((m) => scene?.modules.some((x) => x.id === m.id));
      const key = JSON.stringify([clip.workId, clip.sceneId, clip.modules.map((m) => m.id)]);
      pasted.n = pasted.key === key ? pasted.n + 1 : 1;
      pasted.key = key;
      const box = clipBounds(clip);
      const view = s.view;
      const where = home
        ? { offset: (24 / scale()) * pasted.n }
        : view
          ? { centre: view.center() }
          : { centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
      report(made((w) => paste(w, sceneId, clip, where)));
    },
    /** New words, sized to read in the view; resolves to their module once drawn. */
    text(at?: Point, text = s.host.words().edit.newText) {
      return place({ kind: "text", text, size: textSize(scale()) }, at);
    },
    /** A library picture, a readable size in the view. */
    picture(p: PictureMaterial, at?: Point) {
      return place(picture(p, Math.round(240 / scale())), at);
    },
    /** A library drawing, with its example data and size. */
    drawing(d: DrawingMaterial, at?: Point) {
      if (d.use === "link") {
        fail(Error(s.host.words().edit.linkDrawing));
        return Promise.resolve(undefined);
      }
      return place(
        { kind: "drawing", material: d.id, name: d.name[s.host.locale()], size: d.size, data: d.example ?? {} },
        at,
      );
    },
    /** Links one module's side to another's, drawn like the scene's other links, or with
     * the library's arrow when it has none. */
    connect(from: { moduleId: string; side: Side }, to: { moduleId: string; side: Side }) {
      const { shown, sceneId } = now();
      if (!shown) return;
      report(
        (async () => {
          const like = linkLook(shown, sceneId);
          const look = like ?? { drawingId: "arrow", data: {} };
          // The library's arrow comes in as a copy when one of the work's own drawings
          // already uses its id.
          const own =
            !like && shown.drawings.arrow
              ? ownCopy(await api<Material>("/materials/arrow"), s.host.locale())
              : undefined;
          await s.change((w) => connect(w, sceneId, from, to, look, own).edit);
        })(),
      );
    },
    /** Uploads pictures pasted or dropped onto the canvas and places them, a step apart. */
    pictures(files: File[]) {
      const view = s.view;
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
