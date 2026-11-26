import type { Bounds, Fields, Point } from "../contracts/index.ts";
import { getAt, isItemId, textsIn } from "../contracts/index.ts";
import { boxOutline } from "../contracts/geometry.ts";

/* The editable drawing protocol: a drawing says which of what it draws stands for which of
 * its data, so a person can change it there. Words are a data path, a group of shapes an
 * item of a list, a spot a place for a new item, a region something a reference can point
 * at, a mark something to drag. The renderer gathers what a module declared each time it is
 * drawn, checks every path against the module's data, and measures it on the scene only when
 * the editor asks; the editor reads nothing else of a drawing. */

export type HandleKind = "ref" | "scalar" | "point";
/** What a drawing declares, in its own units (its box from 0,0). */
export interface Declared {
  slots: { list: string; index: number; at: Point }[];
  handles: { path: string; kind: HandleKind; at: Point; axis?: "x" | "y"; scale?: number }[];
  creates: { list: string; between: [string, string]; fields?: Record<string, unknown>; rows?: "x" | "y" }[];
  outline?: string | Bounds;
}
/** Everything a module offers to edit, on the scene. */
export interface EditMap {
  texts: { path: string; box: Bounds }[];
  parts: { path: string; box: Bounds; reorder?: "x" | "y" }[];
  slots: { list: string; index: number; at: Point }[];
  anchors: { list: string; id: string; box: Bounds; shape?: string }[];
  handles: Declared["handles"];
  creates: Declared["creates"];
  /** Where links meet it, as a line round it; its box unless it declared one. */
  outline: Point[];
}
/** The calls a drawing makes to declare what it draws. Each that marks an element takes it
 * last, or returns the attributes to write into markup instead. */
export interface EditableAPI {
  /** These words are the value at `path`. Numbers, units and the like go in another element. */
  text(path: string, el?: Element): string | Element;
  /** These shapes are one item of a list, at `path`; `reorder` the axis dragging moves it along. */
  part(path: string, options?: { reorder?: "x" | "y" } | Element, el?: Element): string | Element;
  /** A new item of `list` can go in here, before the item at `index`. */
  slot(list: string, index: number, at: Point): string;
  /** What a reference to item `id` of `list` can be dropped on, such as a lifeline. */
  anchor(list: string, id: string, options?: { shape?: string } | Element, el?: Element): string | Element;
  /** A mark to drag: onto an anchor to point a reference elsewhere, along an axis to change a
   * number (`scale` data units per unit dragged), or on a map to move a place. */
  handle(path: string, options: { kind: HandleKind; at: Point; axis?: "x" | "y"; scale?: number }): string;
  /** Dragging from one anchor of `list`'s references to another makes an item of `list` with
   * `between` set to the two, placed among the slots along `rows`. */
  create(options: { list: string; between: [string, string]; fields?: Record<string, unknown>; rows?: "x" | "y" }): string;
  /** Where links meet the module: an SVG path in its units, or a box. */
  outline(shape: string | Bounds): string;
  /** The path of an item of a list: by its id when it has one, else by its place. */
  path(list: string, item: unknown, index: number): string;
}
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
/** A drawing's declarations, made as it draws. `live` is false for a drawing drawn inside
 * another, whose marks would name data that is not the module's. */
export function editable(live = true) {
  const declared: Declared = { slots: [], handles: [], creates: [] };
  const mark = (name: string, value: string, el?: Element): string | Element => {
    if (el) {
      if (live) el.setAttribute(name, value);
      return el;
    }
    return live ? ` ${name}="${attr(value)}"` : "";
  };
  const api: EditableAPI = {
    text: (path, el) => mark("data-edp-text", path, el),
    part: (path, options, el) => {
      const element = options instanceof Element ? options : el;
      const reorder = options instanceof Element ? undefined : options?.reorder;
      return mark("data-edp-part", reorder ? `${path}|${reorder}` : path, element);
    },
    anchor: (list, id, options, el) => {
      const element = options instanceof Element ? options : el;
      const shape = options instanceof Element ? undefined : options?.shape;
      return mark("data-edp-anchor", [list, id, shape ?? ""].join("|"), element);
    },
    slot: (list, index, at) => {
      if (live) declared.slots.push({ list, index, at: { x: at.x, y: at.y } });
      return "";
    },
    handle: (path, o) => {
      if (live) declared.handles.push({ path, kind: o.kind, at: { x: o.at.x, y: o.at.y }, ...(o.axis ? { axis: o.axis } : {}), ...(o.scale ? { scale: o.scale } : {}) });
      return "";
    },
    create: (o) => {
      if (live) declared.creates.push({ ...o });
      return "";
    },
    outline: (shape) => {
      if (live) declared.outline = shape;
      return "";
    },
    path: (list, item, index) =>
      `${list}.${item && typeof item === "object" && isItemId((item as { id?: unknown }).id) ? "#" + (item as { id: string }).id : index}`,
  };
  return { api, declared };
}
/** What a drawing marked in what it drew, as written. */
function marks(root: ParentNode) {
  const all = (name: string) => [...root.querySelectorAll(`[${name}]`)].map((el) => ({ el, value: el.getAttribute(name)! }));
  return {
    texts: all("data-edp-text").map(({ el, value }) => ({ el, path: value })),
    parts: all("data-edp-part").map(({ el, value }) => {
      const [path, reorder] = value.split("|");
      return { el, path, reorder: (reorder || undefined) as "x" | "y" | undefined };
    }),
    anchors: all("data-edp-anchor").map(({ el, value }) => {
      const [list, id, shape] = value.split("|");
      return { el, list, id, shape: shape || undefined };
    }),
  };
}
/** The paths a drawing declared that its data does not hold, each said once. */
export function strayPaths(root: ParentNode, declared: Declared, data: Record<string, unknown>) {
  const m = marks(root);
  const wrong = new Set<string>();
  const there = (path: string) => getAt(data, path) !== undefined;
  for (const { path } of [...m.texts, ...m.parts]) if (!there(path)) wrong.add(path);
  for (const h of declared.handles) if (!there(h.path)) wrong.add(h.path);
  for (const a of m.anchors) {
    const list = getAt(data, a.list);
    if (!Array.isArray(list) || !list.some((x) => x && typeof x === "object" && (x as { id?: unknown }).id === a.id))
      wrong.add(`${a.list}.#${a.id}`);
  }
  for (const s of declared.slots) {
    const list = getAt(data, s.list);
    if (list !== undefined && (!Array.isArray(list) || s.index < 0 || s.index > list.length)) wrong.add(`${s.list}.${s.index}`);
  }
  for (const c of declared.creates) if (getAt(data, c.list) !== undefined && !Array.isArray(getAt(data, c.list))) wrong.add(c.list);
  return [...wrong];
}
/** The words of a part's data its drawing shows without marking them as that data. */
export function unmarkedTexts(root: ParentNode, fields: Fields, data: Record<string, unknown>) {
  const marked = new Set(marks(root).texts.map((t) => t.path));
  const shown: string[] = [];
  const walk = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const parent = walk.currentNode.parentElement;
    if (parent && !parent.closest("style,script,defs,title")) shown.push(walk.currentNode.textContent ?? "");
  }
  const drawn = shown.join("\n");
  return textsIn(fields, data).filter((t) => !marked.has(t.path) && drawn.includes(t.text));
}
const sampled = (d: string, root: Node): Point[] => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  root.appendChild(svg);
  try {
    const length = path.getTotalLength();
    const n = Math.min(160, Math.max(8, Math.ceil(length / 6)));
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = path.getPointAtLength((length * i) / n);
      return { x: p.x, y: p.y };
    });
  } catch {
    return [];
  } finally {
    svg.remove();
  }
};
/** What a drawn module declared, measured on the scene: `host` holds it at `bounds`. */
export function measure(host: HTMLElement, bounds: Bounds, declared: Declared): EditMap | undefined {
  const root = host.shadowRoot;
  const frame = host.getBoundingClientRect();
  if (!root || !frame.width || !frame.height) return undefined;
  const k = frame.width / bounds.width;
  const box = (el: Element): Bounds | undefined => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return undefined;
    return {
      x: bounds.x + (r.left - frame.left) / k,
      y: bounds.y + (r.top - frame.top) / k,
      width: Math.max(1, r.width / k),
      height: Math.max(1, r.height / k),
    };
  };
  const at = (p: Point) => ({ x: bounds.x + p.x, y: bounds.y + p.y });
  const m = marks(root);
  const placed = <T extends { el: Element }>(list: T[]) =>
    list.flatMap(({ el, ...rest }) => {
      const b = box(el);
      return b ? [{ ...rest, box: b }] : [];
    });
  const shape = declared.outline;
  const outline =
    typeof shape === "string"
      ? sampled(shape, root).map(at)
      : shape
        ? boxOutline({ ...shape, x: bounds.x + shape.x, y: bounds.y + shape.y })
        : boxOutline(bounds);
  return {
    texts: placed(m.texts),
    parts: placed(m.parts),
    anchors: placed(m.anchors),
    slots: declared.slots.map((s) => ({ ...s, at: at(s.at) })),
    handles: declared.handles.map((h) => ({ ...h, at: at(h.at) })),
    creates: declared.creates,
    outline: outline.length > 1 ? outline : boxOutline(bounds),
  };
}
