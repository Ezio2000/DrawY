import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  Hand,
  ImagePlus,
  MousePointer2,
  Shapes,
  Type,
} from "lucide-react";
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
  grouped,
  clipped,
  close,
  ask,
}: {
  at: { x: number; y: number };
  ops: EditOps;
  selected: string[];
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
  // The menu stays on screen near the corner of the window.
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    el.style.left = Math.min(at.x, innerWidth - r.width - 8) + "px";
    el.style.top = Math.min(at.y, innerHeight - r.height - 8) + "px";
  }, [at]);
  const some = selected.length > 0;
  const items: Item[] = some
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
