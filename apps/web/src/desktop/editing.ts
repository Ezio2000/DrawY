import { useEffect, useRef, useState } from "react";
import type { Canvas, Pointed } from "../../../../modules/canvas/index.ts";
import type { Point } from "../../../../modules/contracts/index.ts";
import { isClip, labelOf, type Alignment } from "../../../../modules/editing/index.ts";
import type { DrawingMaterial, Material, PictureMaterial } from "@drawy/materials/schema";
import { CLIP_TYPE, kept, newer } from "../session/clip.ts";
import type { Session } from "../session/work.ts";

/* Editing by hand with a mouse and a keyboard: the tools over the canvas, the menu on a
 * right click, the system clipboard and the shortcuts. Every one of them ends in one of
 * the session's operations. */

/** What a press on the canvas does while editing: select and move, move the view, or
 * place words where it lands. */
export type Tool = "select" | "hand" | "text";

const typing = (target: EventTarget | null) =>
  !!(target as Element | null)?.closest?.("input,textarea,select,[contenteditable]");

export function useEditing({
  session,
  canvas,
  editing,
  pick,
  retype,
}: {
  session: Session;
  canvas: Canvas | undefined;
  /** Whether the editor is open. */
  editing: boolean;
  /** Asks for a material from the library, of one kind. */
  pick: (kind: "picture" | "drawing", chosen: (m: Material) => void) => void;
  /** Starts changing words where they are drawn. */
  retype: (p: Extract<Pointed, { kind: "text" }>) => void;
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const { ops: base, locked, ids: selected, link, sceneId } = session;
  useEffect(
    () => canvas?.setTool(tool === "text" ? "place" : tool),
    [tool, canvas],
  );
  useEffect(() => {
    if (!editing) {
      setTool("select");
      setMenu(undefined);
    }
  }, [editing]);

  const ops = {
    ...base,
    /** Adds words, a picture or a library drawing at a point, or in the middle of the
     * view; words are ready to type once drawn. */
    add(kind: "text" | "picture" | "drawing", at?: Point) {
      if (kind === "text")
        void base.text(at).then((id) => {
          const words = id && canvas?.wordsIn(id);
          if (words) retype(words);
        });
      else if (kind === "picture")
        pick("picture", (m) => void base.picture(m as PictureMaterial, at));
      else pick("drawing", (m) => void base.drawing(m as DrawingMaterial, at));
    },
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
      try {
        const clip = JSON.parse(data?.getData(CLIP_TYPE) || "null");
        if (isClip(clip)) return latest.current.ops.paste(newer(clip, kept()));
      } catch {}
      const files = [...(data?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) return latest.current.ops.pictures(files);
      const text = data?.getData("text/plain")?.trim() ?? "";
      const mine = kept();
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
  // usual shortcuts, and the arrow keys nudging (ten times as far with Shift). Nudges are
  // kept together once the keys rest, where the modules then are.
  const nudged = useRef<{ timer?: ReturnType<typeof setTimeout>; ids: Set<string> }>({
    ids: new Set(),
  });
  useEffect(() => {
    if (!editing || !session.work) return;
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const ids = selected;
      const step = (e.shiftKey ? 10 : 1) / (canvas?.scale || 1);
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
        else if (ids.length || link) canvas?.select([]);
        else return;
      } else if (locked) return;
      else if (!mod && !e.altKey && code === "KeyV") setTool("select");
      else if (!mod && !e.altKey && code === "KeyH") setTool("hand");
      else if (!mod && !e.altKey && code === "KeyT") setTool("text");
      else if (mod && code === "KeyA") ops.selectAll();
      // Tab steps through the parts only from the canvas; elsewhere it moves the focus.
      else if (
        e.key === "Tab" &&
        (e.target === document.body || (e.target as Element).closest?.("[data-canvas]"))
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
  }, [editing, locked, session.work, selected, link, sceneId, tool, menu, canvas]);

  return { ops, tool, setTool, menu, setMenu };
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
export type EditOps = ReturnType<typeof useEditing>["ops"];
