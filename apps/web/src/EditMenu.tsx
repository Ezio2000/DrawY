import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpToLine,
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Group,
  ImagePlus,
  LibraryBig,
  MessageSquareQuote,
  PaintRoller,
  Paintbrush,
  Scan,
  Scissors,
  SendToBack,
  SquareDashedMousePointer,
  SquareStack,
  Trash2,
  Type,
  Ungroup,
} from "lucide-react";
import type { EditOps } from "./desktop/editing.ts";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";

const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");
/** A shortcut as the keyboard it is pressed on writes it. */
export const keys = (s: string) =>
  mac
    ? s.replace(/Mod\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥")
    : s.replace(/Mod\+/g, "Ctrl+");

type Item =
  | {
      label: string;
      icon?: ReactNode;
      key?: string;
      run: () => void;
      danger?: boolean;
      off?: boolean;
    }
  | "-";
/** What can be done where a right click landed (or from the bar over the selection): with
 * the selection, or on the paper. */
export function EditMenu({
  at,
  ops,
  selected,
  link,
  grouped,
  clipped,
  brushed,
  close,
  ask,
  fit,
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
  /** Whether a look has been copied, to give to the selection. */
  brushed: boolean;
  close: () => void;
  ask: () => void;
  /** Shows the whole drawing. */
  fit: () => void;
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
  // The menu stays on screen near the corner of the window.
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(at.x, innerWidth - r.width - 8)) + "px";
    el.style.top = Math.max(8, Math.min(at.y, innerHeight - r.height - 8)) + "px";
  }, [at]);
  const some = selected.length > 0;
  const size = 15;
  const look: Item[] = [
    { label: m.copyLook, icon: <Paintbrush size={size} />, key: "Alt+Mod+C", run: ops.copyLook },
    { label: m.pasteLook, icon: <PaintRoller size={size} />, key: "Alt+Mod+V", run: ops.pasteLook, off: !brushed },
  ];
  const items: Item[] = link && !some
    ? [
        { label: m.reverse, icon: <ArrowRightLeft size={size} />, key: "R", run: () => ops.reverse() },
        "-",
        ...look,
        "-",
        { label: m.ask, icon: <MessageSquareQuote size={size} />, run: ask },
        { label: m.remove, icon: <Trash2 size={size} />, key: "Delete", run: ops.remove, danger: true },
      ]
    : some
    ? [
        { label: m.cut, icon: <Scissors size={size} />, key: "Mod+X", run: ops.cut },
        { label: m.copy, icon: <Copy size={size} />, key: "Mod+C", run: () => void ops.copy() },
        { label: m.paste, icon: <ClipboardPaste size={size} />, key: "Mod+V", run: () => ops.paste(), off: !clipped },
        { label: m.duplicate, icon: <CopyPlus size={size} />, key: "Mod+D", run: ops.duplicate },
        "-",
        ...look,
        { label: m.selectSame, icon: <SquareStack size={size} />, run: ops.selectSame },
        "-",
        { label: m.front, icon: <BringToFront size={size} />, key: "Mod+]", run: () => ops.stack("front") },
        { label: m.forward, icon: <ArrowUpToLine size={size} />, key: "Alt+Mod+]", run: () => ops.stack("forward") },
        { label: m.backward, icon: <ArrowDownToLine size={size} />, key: "Alt+Mod+[", run: () => ops.stack("backward") },
        { label: m.back, icon: <SendToBack size={size} />, key: "Mod+[", run: () => ops.stack("back") },
        "-",
        { label: m.group, icon: <Group size={size} />, key: "Mod+G", run: ops.group, off: selected.length < 2 },
        { label: m.ungroup, icon: <Ungroup size={size} />, key: "Shift+Mod+G", run: ops.ungroup, off: !grouped },
        "-",
        { label: m.ask, icon: <MessageSquareQuote size={size} />, run: ask },
        { label: m.remove, icon: <Trash2 size={size} />, key: "Delete", run: ops.remove, danger: true },
      ]
    : [
        { label: m.paste, icon: <ClipboardPaste size={size} />, key: "Mod+V", run: () => ops.paste(), off: !clipped },
        { label: m.selectAll, icon: <SquareDashedMousePointer size={size} />, key: "Mod+A", run: ops.selectAll },
        "-",
        { label: m.addText, icon: <Type size={size} />, key: "T", run: () => ops.add("text") },
        { label: m.addPicture, icon: <ImagePlus size={size} />, run: () => ops.add("picture") },
        { label: m.addDrawing, icon: <LibraryBig size={size} />, run: () => ops.add("drawing") },
        "-",
        { label: m.fit, icon: <Scan size={size} />, key: "Shift+1", run: fit },
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
            {item.icon}
            <span>{item.label}</span>
            {item.key && <kbd>{keys(item.key)}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
