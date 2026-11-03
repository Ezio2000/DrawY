import { useEffect, useRef, useState, type RefObject } from "react";
import type { Canvas, Pointed } from "../../../modules/canvas/index.ts";
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
  isClip,
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
} from "../../../modules/editing/index.ts";
import {
  paramTypes,
  type Bounds,
  type Drawing,
  type Point,
  type Work,
  type WorkEdit,
} from "../../../modules/contracts/index.ts";
import type {
  DrawingMaterial,
  Material,
  PictureMaterial,
} from "@drawy/materials/schema";
import { api } from "./api.ts";
import type { Words } from "./i18n.tsx";

/* Everything a person does to a work by hand, in one place: the panel, the menu on a right
 * click, the toolbar over the canvas and the keyboard all call the same operations, and
 * each ends in one hand edit committed through `change`. */

/** What a press on the canvas does while editing: select and move, move the view, or
 * place words where it lands. */
export type Tool = "select" | "hand" | "text";
/** Commits a hand edit made from the latest work; resolves to whether there was one. */
export type Change = (
  make: (work: Work) => WorkEdit | null,
) => Promise<boolean>;

const CLIP_TYPE = "application/x-drawy+json";
const CLIP_KEY = "drawy.clip";
/** The parts last copied, kept for this tab and, where storage allows, for other tabs. */
let held: Clip | undefined;
/** A clip with when it was copied: the system clipboard can hold an older clip than one
 * copied from the menu, which cannot write to it, and the newer one is what is pasted. */
type Stamped = Clip & { copiedAt?: number };
const newer = (a: Stamped, b?: Stamped) => (b?.copiedAt ?? 0) > (a.copiedAt ?? 0) ? b! : a;
function keep(clip: Clip) {
  held = clip;
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify(clip));
  } catch {}
}
function kept(): Clip | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(CLIP_KEY) ?? "null");
    if (isClip(stored)) return stored;
  } catch {}
  return held;
}
const typing = (target: EventTarget | null) =>
  !!(target as Element | null)?.closest?.(
    "input,textarea,select,[contenteditable]",
  );

/** A library drawing as a drawing of the work's own, its values named in the app's words. */
export function ownCopy(
  m: Material,
  t: Words,
  locale: "zh" | "en",
): Omit<Drawing, "id"> {
  if (m.kind !== "drawing") throw Error(m.id);
  const named = t.edit.params as Record<string, string>;
  return {
    name: m.name[locale],
    params: Object.fromEntries(
      Object.entries(m.params).flatMap(([k, { type, options, min, max, step }]) =>
        (paramTypes as readonly string[]).includes(type)
          ? [
              [
                k,
                {
                  label: named[k] ?? k,
                  type: type as (typeof paramTypes)[number],
                  ...(options ? { options } : {}),
                  ...(min !== undefined ? { min, max, step } : {}),
                },
              ],
            ]
          : [],
      ),
    ),
    source: m.source,
  };
}

export function useHandEdits({
  work,
  sceneId,
  selected,
  link,
  editing,
  editless,
  canvas,
  change,
  attempt,
  pick,
  retype,
  upload,
  t,
  locale,
}: {
  work: Work | undefined;
  sceneId: string;
  selected: string[];
  /** The link selected, when no module is. */
  link: string | null;
  editing: boolean;
  /** Whether the work cannot be edited now: the author is at work, or an earlier
   * revision is shown. */
  editless: boolean;
  canvas: RefObject<Canvas | undefined>;
  change: (make: (w: Work) => WorkEdit | null) => Promise<boolean>;
  attempt: (fn: () => Promise<unknown>) => Promise<void>;
  /** Asks for a material from the library, of one kind. */
  pick: (kind: "picture" | "drawing", chosen: (m: Material) => void) => void;
  /** Starts changing words where they are drawn. */
  retype: (p: Extract<Pointed, { kind: "text" }>) => void;
  upload: (file: File) => Promise<Material>;
  t: Words;
  locale: "zh" | "en";
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [clipped, setClipped] = useState(() => !!kept());
  // How many times the same clip has been pasted where it came from, to step each copy.
  const pasted = useRef({ key: "", n: 0 });
  const scale = () => canvas.current?.scale || 1;
  useEffect(
    () => canvas.current?.setTool(tool === "text" ? "place" : tool),
    [tool, sceneId, work?.id],
  );
  useEffect(() => {
    if (!editing) {
      setTool("select");
      setMenu(undefined);
    }
  }, [editing]);

  const run = (make: (w: Work) => WorkEdit | null) =>
    void attempt(() => change(make));
  /** Runs an edit that makes modules, then selects them once they are drawn. */
  const makeAndSelect = (make: (w: Work) => { edit: WorkEdit; ids: string[] } | null) =>
    attempt(async () => {
      let ids: string[] = [];
      await change((w) => {
        const r = make(w);
        if (!r) return null;
        ids = r.ids;
        return r.edit;
      });
      await canvas.current?.ready;
      await new Promise((r) => setTimeout(r, 60));
      if (ids.length) canvas.current?.select(ids);
    });

  const ops = {
    /** Takes out the selected modules, or the selected link. */
    remove() {
      const gone = selected.length ? selected : link ? [link] : [];
      if (gone.length) run((w) => removeParts(w, sceneId, gone));
    },
    /** Turns the selected link round. */
    reverse(id = link) {
      if (id) run((w) => reverse(w, sceneId, id));
    },
    /** Moves an end of a link onto a side of a module. */
    reconnect(
      id: string,
      end: "from" | "to",
      to: { moduleId: string; side: Side },
    ) {
      run((w) => reattach(w, sceneId, id, end, to.side, to.moduleId));
    },
    duplicate() {
      const from = selected;
      if (from.length)
        void makeAndSelect((w) => duplicate(w, sceneId, from, 24 / scale()));
    },
    stack(to: Stacking) {
      const ids = selected;
      if (ids.length) run((w) => arrange(w, sceneId, ids, to));
    },
    group() {
      const ids = selected;
      if (ids.length > 1) run((w) => group(w, sceneId, ids).edit);
    },
    ungroup() {
      const ids = selected;
      if (ids.length) run((w) => ungroup(w, sceneId, ids));
    },
    align(to: Alignment) {
      const ids = selected;
      if (ids.length) run((w) => align(w, sceneId, ids, to));
    },
    distribute(axis: "x" | "y") {
      const ids = selected;
      if (ids.length > 2) run((w) => distribute(w, sceneId, ids, axis));
    },
    move(moves: { id: string; bounds: Bounds }[]) {
      if (moves.length) run((w) => moveParts(w, sceneId, moves));
    },
    selectAll() {
      canvas.current?.selectAll();
    },
    /** Selects the next module in the stacking order, or the one before. */
    cycle(back: boolean) {
      const modules = work?.scenes[sceneId]?.modules ?? [];
      if (!modules.length) return;
      const at = modules.findIndex((m) => m.id === selected.at(-1));
      const next =
        at < 0
          ? back
            ? modules.length - 1
            : 0
          : (at + (back ? -1 : 1) + modules.length) % modules.length;
      canvas.current?.select([modules[next].id]);
    },
    copy(): Clip | null {
      if (!work || !selected.length) return null;
      const made = copy(work, sceneId, selected);
      const clip: Stamped | null = made && { ...made, copiedAt: Date.now() };
      if (clip) {
        keep(clip);
        setClipped(true);
      }
      return clip;
    },
    cut() {
      if (ops.copy()) ops.remove();
    },
    /** Pastes parts: in the scene they came from, a step off each time; anywhere else, in
     * the middle of the view. */
    paste(clip = kept()) {
      if (!clip || !work) return;
      const scene = work.scenes[sceneId];
      const home =
        clip.workId === work.id &&
        clip.sceneId === sceneId &&
        clip.modules.some((m) => scene?.modules.some((x) => x.id === m.id));
      const key = JSON.stringify([clip.workId, clip.sceneId, clip.modules.map((m) => m.id)]);
      pasted.current = {
        key,
        n: pasted.current.key === key ? pasted.current.n + 1 : 1,
      };
      const box = clipBounds(clip);
      const view = canvas.current;
      void makeAndSelect((w) =>
        paste(
          w,
          sceneId,
          clip,
          {
            labels: t.edit.params as Record<string, string>,
            ...(home
              ? { offset: (24 / scale()) * pasted.current.n }
              : view
                ? { centre: view.center() }
                : { centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } }),
          },
        ),
      );
    },
    /** Adds words, a picture or a library drawing at a point, or in the middle of the
     * view; words are ready to type. */
    add(kind: "text" | "picture" | "drawing", at?: Point) {
      const view = canvas.current;
      if (!view || !work) return;
      const centre = at ?? view.center(),
        s = view.scale;
      const place = (what: Addition) =>
        attempt(async () => {
          let id = "";
          // A work whose own drawing uses the library drawing's id gets a copy of it.
          const copy = shadowed(work, what)
            ? ownCopy(await api<Material>("/materials/" + drawingFor(what)), t, locale)
            : undefined;
          await change((w) => {
            const r = add(w, sceneId, centre, what, copy);
            id = r.id;
            return r.edit;
          });
          await new Promise((r) => setTimeout(r, 60));
          canvas.current?.select([id]);
          const v = canvas.current;
          if (what.kind === "text" && v?.rectOf(id))
            retype({
              kind: "text",
              moduleId: id,
              text: what.text,
              place: () => ({
                rect: v.rectOf(id) ?? new DOMRect(),
                size: what.size * v.scale,
              }),
            });
        });
      if (kind === "text")
        void place({
          kind: "text",
          text: t.edit.newText,
          size: Math.round(Math.min(96, Math.max(14, 22 / s))),
        });
      else if (kind === "picture")
        pick("picture", (m) => {
          const p = m as PictureMaterial,
            c = p.form.content;
          void place({
            kind: "picture",
            material: p.id,
            name: p.name[locale],
            aspect: (p.form.height * c.height) / (p.form.width * c.width),
            width: Math.round(240 / s),
          });
        });
      else
        pick("drawing", (m) => {
          const d = m as DrawingMaterial;
          if (d.use === "link") throw Error(t.edit.linkDrawing);
          void place({
            kind: "drawing",
            material: d.id,
            name: d.name[locale],
            size: d.size,
            data: d.example ?? {},
          });
        });
    },
    /** Links one module's side to another's, drawn like the scene's other links, or with
     * the library's arrow when it has none. */
    connect(from: { moduleId: string; side: Side }, to: { moduleId: string; side: Side }) {
      if (!work) return;
      void attempt(async () => {
        const like = linkLook(work, sceneId);
        const look = like ?? { drawingId: "arrow", data: {} };
        // The library's arrow comes in as a copy when one of the work's own drawings
        // already uses its id.
        const own =
          !like && work.drawings.arrow
            ? ownCopy(await api<Material>("/materials/arrow"), t, locale)
            : undefined;
        await change((w) => connect(w, sceneId, from, to, look, own).edit);
      });
    },
    /** Uploads pictures pasted or dropped onto the canvas and places them. */
    pictures(files: File[]) {
      const view = canvas.current;
      if (!view) return;
      void attempt(async () => {
        let at = view.center();
        for (const file of files) {
          const m = await upload(file);
          if (m.kind !== "picture") continue;
          const c = m.form.content;
          const centre = at;
          await makeAndSelect((w) => {
            const r = add(w, sceneId, centre, {
              kind: "picture",
              material: m.id,
              name: m.name[locale],
              aspect: (m.form.height * c.height) / (m.form.width * c.width),
              width: Math.round(240 / view.scale),
            });
            return { edit: r.edit, ids: [r.id] };
          });
          at = { x: at.x + 24 / view.scale, y: at.y + 24 / view.scale };
        }
      });
    },
    /** Words pasted onto the canvas, as words of the work's own. */
    words(text: string) {
      const view = canvas.current;
      if (!view) return;
      const size = Math.round(Math.min(96, Math.max(14, 22 / view.scale)));
      void makeAndSelect((w) => {
        const r = add(w, sceneId, view.center(), { kind: "text", text, size });
        return { edit: r.edit, ids: [r.id] };
      });
    },
  };

  // Copy, cut and paste go through the system clipboard: parts copied in one tab or work
  // paste into another, pictures paste as pictures and words as words.
  const latest = useRef({ ops, editing, editless, selected, link });
  latest.current = { ops, editing, editless, selected, link };
  useEffect(() => {
    const active = (e: Event) =>
      latest.current.editing && !latest.current.editless && !typing(e.target);
    const onCopy = (e: ClipboardEvent) => {
      if (!active(e)) return;
      // A link is taken out by cutting it; it is copied with the modules it joins.
      if (!latest.current.selected.length) {
        if (e.type === "cut" && latest.current.link && !getSelection()?.toString()) {
          e.preventDefault();
          latest.current.ops.remove();
        }
        return;
      }
      if (getSelection()?.toString()) return;
      const clip = latest.current.ops.copy();
      if (!clip) return;
      e.preventDefault();
      e.clipboardData?.setData(CLIP_TYPE, JSON.stringify(clip));
      e.clipboardData?.setData(
        "text/plain",
        clip.modules.map((m) => m.label).filter(Boolean).join("\n"),
      );
      if (e.type === "cut") latest.current.ops.remove();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!active(e)) return;
      const data = e.clipboardData;
      e.preventDefault();
      try {
        const clip = JSON.parse(data?.getData(CLIP_TYPE) || "null");
        if (isClip(clip)) return latest.current.ops.paste(newer(clip, kept()));
      } catch {}
      const files = [...(data?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) return latest.current.ops.pictures(files);
      const text = data?.getData("text/plain")?.trim() ?? "";
      const mine = kept();
      // The words written beside a clip mean the clip itself.
      if (mine && text === mine.modules.map((m) => m.label).filter(Boolean).join("\n"))
        return latest.current.ops.paste(mine);
      if (text) return latest.current.ops.words(text.slice(0, 2000));
      if (mine) latest.current.ops.paste(mine);
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  // The keyboard while editing: tools by letter, the selection's operations by their
  // usual shortcuts, and the arrow keys nudging (ten times as far with Shift). Nudges are
  // kept together once the keys rest, where the modules then are.
  const nudged = useRef<{ timer?: ReturnType<typeof setTimeout>; ids: Set<string> }>({
    ids: new Set(),
  });
  useEffect(() => {
    if (!editing || !work) return;
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const ids = selected;
      const step = (e.shiftKey ? 10 : 1) / scale();
      const arrow = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }[e.key];
      const code = e.code;
      if (e.key === "Escape") {
        if (menu) setMenu(undefined);
        else if (tool !== "select") setTool("select");
        else if (ids.length || link) canvas.current?.select([]);
        else return;
      } else if (editless) return;
      else if (!mod && !e.altKey && code === "KeyV") setTool("select");
      else if (!mod && !e.altKey && code === "KeyH") setTool("hand");
      else if (!mod && !e.altKey && code === "KeyT") setTool("text");
      else if (mod && code === "KeyA") ops.selectAll();
      // Tab steps through the parts only from the canvas; elsewhere it moves the focus.
      else if (
        e.key === "Tab" &&
        (e.target === document.body ||
          (e.target as Element).closest?.("[data-canvas]"))
      )
        ops.cycle(e.shiftKey);
      else if (link && !ids.length) {
        if (e.key === "Delete" || e.key === "Backspace") ops.remove();
        else if (!mod && !e.altKey && code === "KeyR") ops.reverse();
        else return;
      } else if (!ids.length) return;
      else if (e.key === "Delete" || e.key === "Backspace") ops.remove();
      // Enter changes the words of the one selected module where they are drawn.
      else if (
        e.key === "Enter" &&
        !mod &&
        ids.length === 1 &&
        !(e.target as Element).closest?.("button,a")
      ) {
        const words = canvas.current?.wordsIn(ids[0]);
        if (!words) return;
        retype(words);
      }
      else if (mod && code === "KeyD") ops.duplicate();
      else if (mod && code === "KeyG") e.shiftKey ? ops.ungroup() : ops.group();
      else if (mod && (code === "BracketRight" || code === "BracketLeft"))
        ops.stack(
          code === "BracketRight"
            ? e.altKey
              ? "forward"
              : "front"
            : e.altKey
              ? "backward"
              : "back",
        );
      else if (e.altKey && !mod && e.shiftKey && (code === "KeyH" || code === "KeyV"))
        ops.distribute(code === "KeyH" ? "x" : "y");
      else if (e.altKey && !mod && !e.shiftKey && code in alignKeys)
        ops.align(alignKeys[code]);
      else if (arrow && canvas.current) {
        for (const m of canvas.current.nudge(ids, arrow[0], arrow[1]))
          nudged.current.ids.add(m.id);
        clearTimeout(nudged.current.timer);
        nudged.current.timer = setTimeout(() => {
          const view = canvas.current;
          const moves = [...nudged.current.ids].flatMap((id) => {
            const m = view?.renderer.instances.get(id);
            return m ? [{ id, bounds: { ...m.bounds } }] : [];
          });
          nudged.current.ids.clear();
          ops.move(moves);
        }, 450);
      } else return;
      e.preventDefault();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [editing, editless, work, selected, link, sceneId, tool, menu]);

  return { ops, tool, setTool, menu, setMenu, clipped };
}
/** Alt with a letter lines the selection up, as in drawing apps. */
const alignKeys: Record<string, Alignment> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "top",
  KeyS: "bottom",
  KeyH: "center",
  KeyV: "middle",
};
export type HandEdits = ReturnType<typeof useHandEdits>;
export type EditOps = HandEdits["ops"];
