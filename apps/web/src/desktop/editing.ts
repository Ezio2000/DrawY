import { useEffect, useRef, useState } from "react";
import type { Canvas, CanvasTool, Pointed } from "../../../../modules/canvas/index.ts";
import type { Bounds, Point } from "../../../../modules/contracts/index.ts";
import {
  isClip,
  labelOf,
  type Alignment,
  type Clip,
  type Look,
  type Side,
  type Stacking,
} from "../../../../modules/editing/index.ts";
import type { DrawingMaterial, Material, PictureMaterial } from "@drawy/materials/schema";
import { CLIP_TYPE, Clipboard, newer } from "../session/clip.ts";
import { useSelect, useStore } from "../session/store.ts";
import type { WorkSession } from "../session/work.ts";
import { browserStorage } from "../storage.ts";
import { useT } from "../i18n.tsx";

/* Editing by hand with a mouse and a keyboard: the tools in the tray beside the canvas, the
 * menu on a right click, the system clipboard and the shortcuts. The session's operations
 * act on the parts they are given; here they act on what is selected. */

/** The shapes a figure is built from, each a tool of its own: drawn as a box dragged out on
 * the canvas, or placed at a press. */
export const shapes = ["box", "pill", "circle", "diamond", "cylinder", "document", "callout"] as const;
export type Shape = (typeof shapes)[number];
/** What a press on the canvas does while editing: select and move, move the view, link two
 * modules, place words, or draw a shape. */
export type Tool = "select" | "hand" | "link" | "text" | Shape;
const isShape = (tool: Tool): tool is Shape => (shapes as readonly string[]).includes(tool);

/** The library drawing a shape is drawn with, the data that makes it that shape around its
 * words, and the size it takes where it is placed without a box. */
const stamps: Record<
  Shape,
  { material: string; data: (words: string) => Record<string, unknown>; size: [number, number] }
> = {
  box: { material: "node", data: (title) => ({ title }), size: [180, 80] },
  pill: { material: "node", data: (title) => ({ title, shape: "pill" }), size: [180, 72] },
  circle: { material: "node", data: (title) => ({ title, shape: "circle" }), size: [120, 120] },
  diamond: { material: "node", data: (title) => ({ title, shape: "diamond" }), size: [180, 120] },
  cylinder: { material: "node", data: (title) => ({ title, shape: "cylinder" }), size: [160, 110] },
  document: { material: "node", data: (title) => ({ title, shape: "document" }), size: [170, 110] },
  callout: { material: "callout", data: (text) => ({ text }), size: [240, 100] },
};
/** The canvas's tool for each of the editor's. */
const canvasTool = (tool: Tool): CanvasTool =>
  tool === "select" || tool === "hand" || tool === "link" ? tool : "draw";

/** The parts last copied, shared by every work and, through local storage, every tab. */
const clipboard = new Clipboard(browserStorage);
/** The look last copied from a part, to give to others in any scene of this page. */
let brush: Look | null = null;

const typing = (target: EventTarget | null) =>
  !!(target as Element | null)?.closest?.("input,textarea,select,[contenteditable]");

export function useEditing({
  session,
  canvas,
  editing,
  selected,
  link,
  pick,
  retype,
  help,
}: {
  session: WorkSession;
  canvas: Canvas | undefined;
  /** Whether the editor is open. */
  editing: boolean;
  /** The modules selected. */
  selected: string[];
  /** The link selected, when no module is. */
  link: string | null;
  /** Asks for a material from the library, of one kind. */
  pick: (kind: "picture" | "drawing", chosen: (m: Material) => void) => void;
  /** Starts changing words where they are drawn. */
  retype: (p: Extract<Pointed, { kind: "text" }>) => void;
  /** Shows the shortcuts and gestures. */
  help: () => void;
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [brushed, setBrushed] = useState(!!brush);
  const t = useT();
  const clipped = useStore(clipboard);
  const base = session.ops;
  const { locked, sceneId } = useSelect(session, (s) => ({ locked: s.locked, sceneId: s.sceneId }));
  useEffect(() => canvas?.setTool(canvasTool(tool)), [tool, canvas]);
  useEffect(() => {
    if (!editing) {
      setTool("select");
      setMenu(undefined);
    }
  }, [editing]);
  /** Changes a new module's words where they are drawn, once it is. */
  const retypeNew = (made: Promise<string | undefined>) =>
    void made.then((id) => {
      const words = id && canvas?.wordsIn(id);
      if (words) retype(words);
    });
  const parts = () => (selected.length ? selected : link ? [link] : []);

  const ops = {
    ...base,
    /** Takes out the selected modules, or the selected link. */
    remove: () => base.remove(parts()),
    /** Turns a link round: the selected one unless another is named. */
    reverse: (id = link) => void (id && base.reverse(id)),
    duplicate: () => base.duplicate(selected),
    /** Copies of modules, dragged off them this far. */
    duplicateBy: (ids: string[], by: Point) => base.duplicate(ids, by),
    stack: (to: Stacking) => base.stack(selected, to),
    group: () => base.group(selected),
    ungroup: () => base.ungroup(selected),
    align: (to: Alignment) => base.align(selected, to),
    distribute: (axis: "x" | "y") => base.distribute(selected, axis),
    matchSize: (what: "width" | "height" | "both") => base.matchSize(selected, what),
    tidy: () => base.tidy(selected),
    /** Changes the same values on everything selected. */
    restyle: (patch: Record<string, unknown>) => base.restyle(parts(), patch),
    /** Keeps how the selected part looks, to give to others. */
    copyLook() {
      const id = selected[0] ?? link;
      const look = id ? base.look(id) : null;
      if (!look) return;
      brush = look;
      setBrushed(true);
    },
    pasteLook() {
      if (brush) base.pasteLook(parts(), brush);
    },
    selectAll: () => canvas?.selectAll(),
    /** Selects every module drawn with the same drawing as one of those selected. */
    selectSame() {
      const modules = session.get().scene?.modules ?? [];
      const drawings = new Set(
        modules.filter((m) => selected.includes(m.id)).map((m) => m.drawingId),
      );
      canvas?.select(modules.filter((m) => drawings.has(m.drawingId)).map((m) => m.id));
    },
    /** Selects the next module in the stacking order, or the one before. */
    cycle(back: boolean) {
      const modules = session.get().scene?.modules ?? [];
      if (!modules.length) return;
      const at = modules.findIndex((m) => m.id === selected.at(-1));
      const next =
        at < 0
          ? back
            ? modules.length - 1
            : 0
          : (at + (back ? -1 : 1) + modules.length) % modules.length;
      canvas?.select([modules[next].id]);
    },
    /** Copies the selected modules, keeping the clip for pasting anywhere. */
    copy: (): Clip | null => {
      const clip = base.copy(selected);
      return clip && clipboard.keep(clip);
    },
    cut() {
      if (ops.copy()) ops.remove();
    },
    paste(clip = clipboard.kept()) {
      if (clip) base.paste(clip);
    },
    /** Adds words, a picture or a library drawing at a point, or in the middle of the
     * view; words are ready to type once drawn. */
    add(kind: "text" | "picture" | "drawing", at?: Point, box?: Bounds) {
      if (kind === "text") retypeNew(base.text(t.edit.newText, at, box));
      else if (kind === "picture")
        pick("picture", (m) => void base.picture(m as PictureMaterial, at));
      else pick("drawing", (m) => void base.drawing(m as DrawingMaterial, at));
    },
    /** Draws a shape at a point, or filling the box dragged out for it, ready to type in. */
    shape(shape: Shape, at?: Point, box?: Bounds) {
      const stamp = stamps[shape];
      const centre = at ?? canvas?.center();
      const [width, height] = stamp.size;
      retypeNew(
        base.shape(
          stamp.material,
          stamp.data(t.edit.newText),
          centre,
          box ??
            (centre && { x: centre.x - width / 2, y: centre.y - height / 2, width, height }),
        ),
      );
    },
    /** Grows the figure from a module: a new one like it beyond a side, or at a point,
     * linked to it and ready to type in. */
    extend(from: { moduleId: string; side: Side }, at?: Point) {
      retypeNew(base.extend(from, t.edit.newText, at));
    },
  };
  /** A press with the tool in hand at a point of the scene, or the box dragged out with it:
   * the shape or the words it makes go there, and the hand takes the selecting tool again.
   * A double click on the paper with the selecting tool puts words there. */
  const place = (at: Point, box?: Bounds) => {
    const now = tool;
    setTool("select");
    if (isShape(now)) ops.shape(now, at, box);
    else ops.add("text", at, box);
  };

  // Copy, cut and paste go through the system clipboard: parts copied in one tab or work
  // paste into another, pictures paste as pictures and words as words.
  const latest = useRef({ ops, editing, locked, selected, link });
  latest.current = { ops, editing, locked, selected, link };
  useEffect(() => {
    const active = (e: Event) =>
      latest.current.editing && !latest.current.locked && !typing(e.target);
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
      e.clipboardData?.setData("text/plain", clip.modules.map(labelOf).join("\n"));
      if (e.type === "cut") latest.current.ops.remove();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!active(e)) return;
      const data = e.clipboardData;
      e.preventDefault();
      const mine = clipboard.kept();
      try {
        const clip = JSON.parse(data?.getData(CLIP_TYPE) || "null");
        if (isClip(clip)) return latest.current.ops.paste(mine ? newer(clip, mine) : clip);
      } catch {}
      const files = [...(data?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) return latest.current.ops.pictures(files);
      const text = data?.getData("text/plain")?.trim() ?? "";
      // The words written beside a clip mean the clip itself.
      if (mine && text === mine.modules.map(labelOf).join("\n"))
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
  // usual shortcuts, the view by the keys drawing apps zoom with, and the arrow keys
  // nudging (ten times as far with Shift). Nudges are kept together once the keys rest,
  // where the modules then are.
  const nudged = useRef<{ timer?: ReturnType<typeof setTimeout>; ids: Set<string> }>({
    ids: new Set(),
  });
  useEffect(() => {
    if (!editing) return;
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const plain = !mod && !e.altKey && !e.shiftKey;
      const ids = selected;
      const step = (e.shiftKey ? 10 : 1) / (canvas?.scale || 1);
      const arrow = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }[e.key];
      const code = e.code;
      const letter = plain ? toolKeys[code] : undefined;
      if (e.key === "Escape") {
        if (menu) setMenu(undefined);
        else if (tool !== "select") setTool("select");
        else if (ids.length || link) canvas?.select([]);
        else return;
      }
      // The view: closer, further, as drawn, the whole drawing, and what is selected.
      else if (mod && (code === "Equal" || code === "NumpadAdd")) canvas?.zoom(1.25);
      else if (mod && (code === "Minus" || code === "NumpadSubtract")) canvas?.zoom(0.8);
      else if (mod && code === "Digit0") canvas?.zoomTo(1);
      else if (e.shiftKey && !mod && !e.altKey && code === "Digit1") canvas?.fit(true, 520, "whole");
      else if (e.shiftKey && !mod && !e.altKey && code === "Digit2") canvas?.frameSelection();
      else if (e.key === "?" && !mod) help();
      else if (locked) return;
      // R turns a selected link round; with anything else it takes up the rectangle.
      else if (link && !ids.length && plain && code === "KeyR") ops.reverse();
      else if (letter) setTool(letter);
      else if (mod && code === "KeyA") ops.selectAll();
      // Tab steps through the parts only from the canvas; elsewhere it moves the focus.
      else if (
        e.key === "Tab" &&
        (e.target === document.body || (e.target as Element).closest?.("[data-canvas]"))
      )
        ops.cycle(e.shiftKey);
      else if (mod && e.altKey && code === "KeyC" && (ids.length || link)) ops.copyLook();
      else if (mod && e.altKey && code === "KeyV" && (ids.length || link)) ops.pasteLook();
      else if (link && !ids.length) {
        if (e.key === "Delete" || e.key === "Backspace") ops.remove();
        else return;
      } else if (!ids.length) return;
      else if (e.key === "Delete" || e.key === "Backspace") ops.remove();
      // Enter or F2 changes the words of the one selected module where they are drawn.
      else if (
        (e.key === "Enter" || e.key === "F2") &&
        !mod &&
        ids.length === 1 &&
        !(e.target as Element).closest?.("button,a")
      ) {
        const words = canvas?.wordsIn(ids[0]);
        if (!words) return;
        retype(words);
      } else if (mod && code === "KeyD") ops.duplicate();
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
      else if (arrow && canvas) {
        for (const m of canvas.nudge(ids, arrow[0], arrow[1])) nudged.current.ids.add(m.id);
        clearTimeout(nudged.current.timer);
        nudged.current.timer = setTimeout(() => {
          const moves = [...nudged.current.ids].flatMap((id) => {
            const m = canvas.renderer.instances.get(id);
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
  }, [editing, locked, selected, link, sceneId, tool, menu, canvas]);

  return { ops, tool, setTool, place, menu, setMenu, clipped, brushed };
}
/** A tool by the letter drawing apps give it. */
const toolKeys: Record<string, Tool> = {
  KeyV: "select",
  KeyH: "hand",
  KeyT: "text",
  KeyL: "link",
  KeyR: "box",
  KeyO: "circle",
  KeyD: "diamond",
};
/** Alt with a letter lines the selection up, as in drawing apps. */
const alignKeys: Record<string, Alignment> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "top",
  KeyS: "bottom",
  KeyH: "center",
  KeyV: "middle",
};
export type Editing = ReturnType<typeof useEditing>;
export type EditOps = Editing["ops"];
