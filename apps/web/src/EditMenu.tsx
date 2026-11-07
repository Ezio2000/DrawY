import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  ArrowRightLeft,
  BringToFront,
  Copy,
  Group,
  Hand,
  ImagePlus,
  MousePointer2,
  SendToBack,
  Shapes,
  MessageSquareQuote,
  Trash2,
  Type,
  Ungroup,
} from "lucide-react";
import type { Canvas } from "../../../modules/canvas/index.ts";
import type { EditOps, Tool } from "./handEdits.ts";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";

const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");
/** A shortcut as the keyboard it is pressed on writes it. */
export const keys = (s: string) =>
  mac
    ? s.replace(/Mod\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥")
    : s.replace(/Mod\+/g, "Ctrl+");

/** The tools over the canvas while editing: select, move the view, and put words, a
 * picture or a drawing from the library into the scene. */
export function EditTools({
  tool,
  setTool,
  ops,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  ops: EditOps;
}) {
  const t = useT();
  const item = (
    id: Tool | "picture" | "drawing",
    icon: ReactNode,
    label: string,
    key?: string,
  ) => (
    <button
      key={id}
      aria-label={label}
      data-tip={key ? `${label} · ${key}` : label}
      aria-pressed={id === tool || undefined}
      onClick={() =>
        id === "picture" || id === "drawing" ? ops.add(id) : setTool(id)
      }
    >
      {icon}
    </button>
  );
  return (
    <nav className={cx("edit-tools")} aria-label={t.edit.tools.label}>
      {item("select", <MousePointer2 size={16} />, t.edit.tools.select, "V")}
      {item("hand", <Hand size={16} />, t.edit.tools.hand, "H")}
      <i />
      {item("text", <Type size={16} />, t.edit.tools.text, "T")}
      {item("picture", <ImagePlus size={16} />, t.edit.tools.picture)}
      {item("drawing", <Shapes size={16} />, t.edit.tools.drawing)}
    </nav>
  );
}

type Item =
  | { label: string; key?: string; run: () => void; danger?: boolean; off?: boolean }
  | "-";
/** What can be done where a right click landed: with the selection, or on the paper. */
export function EditMenu({
  at,
  ops,
  selected,
  link,
  grouped,
  clipped,
  close,
  ask,
}: {
  at: { x: number; y: number };
  ops: EditOps;
  selected: string[];
  /** The link selected, when no module is. */
  link?: string | null;
  /** Whether any selected module is in a group. */
  grouped: boolean;
  /** Whether there is something to paste. */
  clipped: boolean;
  close: () => void;
  ask: () => void;
}) {
  const t = useT(),
    m = t.edit.menu;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) =>
      !ref.current?.contains(e.target as Node) && close();
    addEventListener("pointerdown", away, true);
    addEventListener("blur", close);
    return () => {
      removeEventListener("pointerdown", away, true);
      removeEventListener("blur", close);
    };
  }, []);
  // The menu stays on screen near the corner of the window, and unfolds from the pointer
  // wherever that leaves it.
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect(),
      left = Math.min(at.x, innerWidth - r.width - 8),
      top = Math.min(at.y, innerHeight - r.height - 8);
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.transformOrigin = `${at.x - left}px ${at.y - top}px`;
  }, [at]);
  const some = selected.length > 0;
  const items: Item[] = link && !some
    ? [
        { label: m.reverse, key: "R", run: () => ops.reverse() },
        "-",
        { label: m.ask, run: ask },
        { label: m.remove, key: "Delete", run: ops.remove, danger: true },
      ]
    : some
    ? [
        { label: m.cut, key: "Mod+X", run: ops.cut },
        { label: m.copy, key: "Mod+C", run: () => void ops.copy() },
        { label: m.paste, key: "Mod+V", run: () => ops.paste(), off: !clipped },
        { label: m.duplicate, key: "Mod+D", run: ops.duplicate },
        "-",
        { label: m.front, key: "Mod+]", run: () => ops.stack("front") },
        { label: m.forward, key: "Alt+Mod+]", run: () => ops.stack("forward") },
        { label: m.backward, key: "Alt+Mod+[", run: () => ops.stack("backward") },
        { label: m.back, key: "Mod+[", run: () => ops.stack("back") },
        "-",
        { label: m.group, key: "Mod+G", run: ops.group, off: selected.length < 2 },
        { label: m.ungroup, key: "Shift+Mod+G", run: ops.ungroup, off: !grouped },
        "-",
        { label: m.ask, run: ask },
        { label: m.remove, key: "Delete", run: ops.remove, danger: true },
      ]
    : [
        { label: m.paste, key: "Mod+V", run: () => ops.paste(), off: !clipped },
        { label: m.selectAll, key: "Mod+A", run: ops.selectAll },
        "-",
        { label: m.addText, key: "T", run: () => ops.add("text") },
        { label: m.addPicture, run: () => ops.add("picture") },
        { label: m.addDrawing, run: () => ops.add("drawing") },
      ];
  return (
    <div ref={ref} className={cx("edit-menu")} role="menu" style={{ left: at.x, top: at.y }}>
      {items.map((item, i) =>
        item === "-" ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.off}
            data-tone={item.danger ? "danger" : undefined}
            onClick={() => {
              close();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.key && <kbd>{keys(item.key)}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}

/** The selection's most used actions in a bar over it on the canvas, following it as the
 * view moves; it steps aside while something is dragged, and sits under the selection
 * when there is no room above. */
export function SelectionBar({
  canvas,
  stage,
  ops,
  selected,
  link,
  grouped,
  hidden,
  ask,
}: {
  canvas?: Canvas;
  stage: HTMLElement | null;
  ops: EditOps;
  selected: string[];
  link: string | null;
  /** Whether the selected modules share a group. */
  grouped: boolean;
  hidden: boolean;
  ask: () => void;
}) {
  const t = useT(),
    e = t.edit;
  const ref = useRef<HTMLDivElement>(null);
  const some = selected.length > 0;
  useLayoutEffect(() => {
    if (!canvas || !stage) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = canvas.selectionRect(),
        area = stage.getBoundingClientRect();
      if (
        !r ||
        canvas.dragging ||
        r.bottom < area.top ||
        r.top > area.bottom ||
        r.right < area.left ||
        r.left > area.right
      ) {
        el.dataset.away = "";
        return;
      }
      const w = el.offsetWidth,
        h = el.offsetHeight;
      // Clear of the dot above a selected module, the title and the tools over the canvas.
      let top = r.top - area.top - h - 30;
      if (top < 108) top = r.bottom - area.top + 30;
      const left = Math.min(
        area.width - w - 12,
        Math.max(12, r.left - area.left + r.width / 2 - w / 2),
      );
      el.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
      delete el.dataset.away;
    };
    place();
    return canvas.watch(place);
  }, [canvas, stage, selected.join(), link, hidden]);
  if (hidden || (!some && !link)) return null;
  const item = (
    label: string,
    icon: ReactNode,
    run: () => void,
    o: { key?: string; danger?: boolean; off?: boolean } = {},
  ) => (
    <button
      key={label}
      aria-label={label}
      data-tip={o.key ? `${label} · ${keys(o.key)}` : label}
      data-tone={o.danger ? "danger" : undefined}
      disabled={o.off}
      onPointerDown={(ev) => ev.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );
  return (
    <div ref={ref} className={cx("selection-bar")} role="toolbar" aria-label={e.bar} data-away="">
      {some ? (
        <>
          {item(e.menu.duplicate, <Copy size={15} />, ops.duplicate, { key: "Mod+D" })}
          {item(e.menu.front, <BringToFront size={15} />, () => ops.stack("front"), { key: "Mod+]" })}
          {item(e.menu.back, <SendToBack size={15} />, () => ops.stack("back"), { key: "Mod+[" })}
          {grouped
            ? item(e.menu.ungroup, <Ungroup size={15} />, ops.ungroup, { key: "Shift+Mod+G" })
            : selected.length > 1 &&
              item(e.menu.group, <Group size={15} />, ops.group, { key: "Mod+G" })}
        </>
      ) : (
        item(e.menu.reverse, <ArrowRightLeft size={15} />, () => ops.reverse(), { key: "R" })
      )}
      <i />
      {item(e.menu.ask, <MessageSquareQuote size={15} />, ask)}
      {item(e.menu.remove, <Trash2 size={15} />, ops.remove, { key: "Delete", danger: true })}
    </div>
  );
}
