import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Eraser,
  FileInput,
  Hand,
  ImagePlus,
  LibraryBig,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Plus,
  Search,
  Spline,
  Type,
} from "lucide-react";
import type { DrawingMaterial, Material } from "@drawy/materials/schema";
import { useLocale } from "./ui/locale.tsx";
import { api } from "./api.ts";
import { DrawingLook } from "./Library.tsx";
import { shapes, type EditOps, type Shape, type Tool } from "./desktop/editing.ts";
import { cx } from "./cx.ts";
import { useAccount } from "./account.tsx";
import { useT } from "./i18n.tsx";
import { useDismiss } from "./popover.ts";

/** The type a library drawing dragged out of the tray goes by, so the canvas can tell it
 * from anything else dropped on it. */
export const DRAWING_TYPE = "application/x-drawy-drawing";

/** A shape as its tool shows it: the outline it draws, in the line the tools are drawn in. */
export function ShapeGlyph({ shape, size = 18 }: { shape: Shape; size?: number }) {
  const d: Record<Shape, ReactNode> = {
    box: <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />,
    pill: <rect x="2.5" y="7" width="19" height="10" rx="5" />,
    circle: <circle cx="12" cy="12" r="7.5" />,
    diamond: <path d="M12 3.8 20.5 12 12 20.2 3.5 12Z" />,
    cylinder: (
      <>
        <ellipse cx="12" cy="6.8" rx="7" ry="2.6" />
        <path d="M5 6.8v10.4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6.8" />
      </>
    ),
    document: <path d="M4.5 5h15v12.2c-2.6-1.6-5 1.8-7.5.4s-5-1.2-7.5.4Z" />,
    callout: <path d="M5.5 4.5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3.5v-3.5h-2a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      {d[shape]}
    </svg>
  );
}
const letters: Partial<Record<Tool, string>> = {
  select: "V",
  hand: "H",
  box: "R",
  circle: "O",
  diamond: "D",
  text: "T",
  link: "L",
  pen: "P",
  arrow: "A",
  erase: "E",
};

/** The tools laid beside the canvas while editing, as instruments beside a drawing board,
 * kept to a short column: the hand's own (select, move the view), the shape last taken
 * (the others behind its corner, and under their letters), words, links, a free arrow,
 * the pen and the eraser, everything the library draws, and behind one more button a
 * picture or what other tools drew (Mermaid, Excalidraw) brought in. A shape or words go
 * where the canvas is then pressed, or fill the box dragged out there. */
export function EditTray({
  tool,
  setTool,
  ops,
  bring,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  ops: EditOps;
  /** Opens the dialog that brings Mermaid or Excalidraw in. */
  bring: () => void;
}) {
  const t = useT(),
    names = t.edit.tools;
  // The shape last taken, shown in the tray for all of them.
  const [shape, setShape] = useState<Shape>("box");
  const [open, setOpen] = useState<"" | "shapes" | "library" | "insert">("");
  const ref = useRef<HTMLElement>(null);
  useDismiss(!!open, () => setOpen(""), ref, "[data-flyout]");
  useEffect(() => {
    if ((shapes as readonly string[]).includes(tool)) setShape(tool as Shape);
  }, [tool]);
  const item = (id: Tool, icon: ReactNode) => (
    <button
      key={id}
      aria-label={names[id]}
      data-tip={letters[id] ? `${names[id]} · ${letters[id]}` : names[id]}
      data-tip-side="right"
      aria-pressed={id === tool}
      onClick={() => {
        setOpen("");
        setTool(id === tool && id !== "select" ? "select" : id);
      }}
    >
      {icon}
      {letters[id] && <kbd>{letters[id]}</kbd>}
    </button>
  );
  return (
    <nav
      ref={ref}
      className={cx("tray")}
      aria-label={names.label}
      // A press on a tool takes it up without taking the focus: the keys that follow are the
      // board's (a letter for another tool, Space to pan), not the button's, and no focus
      // ring is left on it. The library's sheet keeps its own, for its search and dragging.
      onPointerDown={(e) => {
        const t = e.target as Element;
        if (t.closest("button") && !t.closest("[data-flyout]")) e.preventDefault();
      }}
    >
      {item("select", <MousePointer2 size={17} />)}
      {item("hand", <Hand size={17} />)}
      <i />
      <span className={cx("tray-more")}>
        {item(shape, <ShapeGlyph shape={shape} />)}
        <button
          className={cx("tray-caret")}
          aria-label={names.shapes}
          aria-expanded={open === "shapes"}
          data-tip={names.shapes}
          data-tip-side="right"
          onClick={() => setOpen(open === "shapes" ? "" : "shapes")}
        >
          <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden>
            <path d="M6 0v6H0Z" fill="currentColor" />
          </svg>
        </button>
        {open === "shapes" && (
          <div className={cx("tray-flyout", "tray-menu")} data-flyout role="menu">
            {shapes.map((s) => (
              <button
                key={s}
                role="menuitemradio"
                aria-checked={tool === s}
                onClick={() => {
                  setOpen("");
                  setTool(s);
                }}
              >
                <ShapeGlyph shape={s} size={20} />
                <span>{names[s]}</span>
                {letters[s] && <kbd>{letters[s]}</kbd>}
              </button>
            ))}
          </div>
        )}
      </span>
      <i />
      {item("text", <Type size={17} />)}
      {item("link", <Spline size={17} />)}
      {item("arrow", <MoveUpRight size={17} />)}
      {item("pen", <PenLine size={17} />)}
      {item("erase", <Eraser size={17} />)}
      <i />
      <span className={cx("tray-more")}>
        <button
          aria-label={names.drawing}
          data-tip={open === "library" ? undefined : names.drawing}
          data-tip-side="right"
          aria-expanded={open === "library"}
          onClick={() => setOpen(open === "library" ? "" : "library")}
        >
          <LibraryBig size={17} />
        </button>
        {open === "library" && (
          <Shelf
            add={(m) => {
              setOpen("");
              void ops.drawing(m);
            }}
            dragged={() => setOpen("")}
            browse={() => {
              setOpen("");
              ops.add("drawing");
            }}
          />
        )}
      </span>
      <span className={cx("tray-more")}>
        <button
          aria-label={names.insert}
          data-tip={open === "insert" ? undefined : names.insert}
          data-tip-side="right"
          aria-expanded={open === "insert"}
          onClick={() => setOpen(open === "insert" ? "" : "insert")}
        >
          <Plus size={17} />
        </button>
        {open === "insert" && (
          <div className={cx("tray-flyout", "tray-menu")} data-flyout role="menu">
            <button
              role="menuitem"
              onClick={() => {
                setOpen("");
                ops.add("picture");
              }}
            >
              <ImagePlus size={18} />
              <span>{names.picture}</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setOpen("");
                bring();
              }}
            >
              <FileInput size={18} />
              <span>{names.bring}</span>
            </button>
          </div>
        )}
      </span>
    </nav>
  );
}

/** The library's drawings, fetched once for the page. */
let shelved: Promise<DrawingMaterial[]> | undefined;
const shelf = () =>
  (shelved ??= api<{ items: Material[] }>("/materials?kind=drawing&size=120")
    .then((page) =>
      page.items.filter((m): m is DrawingMaterial => m.kind === "drawing" && m.use !== "link"),
    )
    .catch((e) => {
      shelved = undefined;
      throw e;
    }));
/** What the library's drawings are for, in the order a figure is built in. */
const kinds = ["structure", "text", "mark", "chart", "area", "control", "connector", "map"];

/** The library's drawings in a sheet beside the tray: found by name, added with a press in
 * the middle of the view, or dragged onto the canvas to where they belong. */
function Shelf({
  add,
  browse,
  dragged,
}: {
  add: (m: DrawingMaterial) => void;
  browse: () => void;
  /** A drawing was dragged out and let go: the shelf has done its part. */
  dragged: () => void;
}) {
  const t = useT(),
    locale = useLocale();
  const user = useAccount();
  const [all, setAll] = useState<DrawingMaterial[]>();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!user) return setAll([]);
    void shelf().then(setAll, () => setAll([]));
  }, [user?.id]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = (all ?? []).filter(
      (m) =>
        !q ||
        [m.name.zh, m.name.en, m.id, ...m.aliases].some((w) => w.toLowerCase().includes(q)),
    );
    const of = (m: DrawingMaterial) => m.category.split("/")[1] ?? "";
    const order = (k: string) => (kinds.includes(k) ? kinds.indexOf(k) : kinds.length);
    return [...new Set(found.map(of))]
      .sort((a, b) => order(a) - order(b))
      .map((kind) => ({ kind, items: found.filter((m) => of(m) === kind) }));
  }, [all, query]);
  return (
    <div className={cx("tray-flyout", "drawings")} data-flyout role="dialog" aria-label={t.edit.tools.drawing}>
      <label className={cx("drawings-search")}>
        <Search size={14} />
        <input
          autoFocus
          value={query}
          placeholder={t.edit.shelf.search}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            const only = groups.length === 1 && groups[0].items.length === 1 ? groups[0].items[0] : undefined;
            if (e.key === "Enter" && only) add(only);
          }}
        />
      </label>
      <div className={cx("drawings-body")}>
        {groups.map((g) => (
          <section key={g.kind}>
            <h4>{(t.edit.shelf.kinds as Record<string, string>)[g.kind] ?? g.kind}</h4>
            <div className={cx("drawings-grid")}>
              {g.items.map((m) => (
                <button
                  key={m.id}
                  draggable
                  data-tip={m.name[locale]}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAWING_TYPE, m.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onDragEnd={dragged}
                  onClick={() => add(m)}
                >
                  <Seen>
                    <DrawingLook m={m} />
                  </Seen>
                  <span>{m.name[locale]}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {all && !groups.length && <p className={cx("drawings-none")}>{t.edit.shelf.none}</p>}
      </div>
      <button className={cx("drawings-all")} onClick={browse}>
        {t.edit.shelf.all}
      </button>
    </div>
  );
}
/** Draws what it holds only once it has scrolled into view, and keeps it from then on: a
 * drawing's look is a canvas of its own, and the shelf holds dozens. */
function Seen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setSeen(true);
        watch.disconnect();
      },
      { rootMargin: "120px" },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <span ref={ref} className={cx("drawings-look")}>
      {seen && children}
    </span>
  );
}
/** The library drawing a drag from the shelf carries, once it is dropped. */
export const drawingById = (id: string) => shelf().then((all) => all.find((m) => m.id === id));
