import { SceneRenderer, type EditMap, type PatchResult } from "../runtime/scene.ts";
import { boxOutline, fit, nearestAlong, union, zoom, type Camera } from "../contracts/geometry.ts";
import { drawingOf, endLink, endModule, fieldAt, getAt, parsePath, setAt as setIn, shownName, type LinkEnd } from "../contracts/index.ts";
import { plan, play, gesture, hatching } from "./ink.ts";
import {
  carried,
  facing,
  itemOf,
  handles,
  resized,
  scaled,
  snap,
  sidePoint,
  sides,
  type Gap,
  type Guide,
  type Handle,
  type Side,
} from "../editing/index.ts";
import type {
  Bounds,
  Instance,
  Point,
  Scene,
  Selection,
  Sketch,
  Target,
  Work,
} from "../contracts/index.ts";
/** How waiting for modules to be drawn ended: they are drawn; a revision as new as theirs
 * was drawn without them; or the canvas went (the scene was left). */
export type Drawn = "drawn" | "missing" | "gone";
/** Words or a picture a person pointed at in a module, to change them. */
export type Pointed =
  | {
      kind: "text";
      /** The module the words are in, or the link with `link`. */
      moduleId: string;
      link?: boolean;
      text: string;
      /** The data path the drawing marked these words as, when it marked them. */
      path?: string;
      /** Where the words are on screen now, and their size there; the view may have
       * moved since they were pointed at. */
      place: () => { rect: DOMRect; size: number };
    }
  | { kind: "picture"; moduleId: string; material: string };
/** Where an end of a link would bind at a point: the end, where it lands on the scene, and
 * the outline it lands on (to show), if any. */
export interface Binding {
  end: LinkEnd;
  point: Point;
  outline?: Point[];
}
/** An item of a module's data selected inside it, by the path its drawing marked it with. */
export interface PartPick {
  moduleId: string;
  path: string;
}
export interface CanvasOptions {
  camera?: Camera;
  /** Whether modules can be moved and resized: a selected module follows a drag. */
  movable?: boolean;
  /** Whether the selection has handles to resize it by; a page that leaves resizing to a
   * larger screen turns them off, and selected modules still move. */
  resizable?: boolean;
  /** Unfold drawings as they appear and glide the camera between compositions. */
  motion?: boolean;
  /** Screen space kept clear above and below the automatic view (and, where given, at its
   * sides), for controls laid over the canvas; asked each time the view is fitted, as the
   * controls change size. */
  insets?: () => { top: number; bottom: number; left?: number; right?: number };
  /** How many times larger than the whole drawing the automatic view may show it, to fill
   * the screen: on a phone held upright a wide drawing fitted whole is a strip too small
   * to read, while filled to the screen's height it reads and is panned across, from its
   * left. 1 (the default) always shows it whole; `fit(…, "whole")` does so whatever this
   * is. */
  fill?: number;
  /** Mark each module that opens a scene or a page, at its corner. The app's canvas does;
   * the page the capture service and the exports draw has none, as the marks are styled by
   * the app and are not part of the work. */
  marks?: boolean;
  open: (target: Target) => void;
  /** The selection changed: the modules selected, and while editing the links selected
   * with them (or alone), by id. */
  select: (selection: Selection[], links: string[]) => void;
  /** A double click on words or a picture in a module. */
  point?: (pointed: Pointed) => void;
  /** A part of the one module selected was selected inside it, or none is any more. Given,
   * a second press on a module selected alone selects the part of its drawing under it;
   * while editing, or always with `parts: "always"` (a page that does not edit). */
  part?: (part: PartPick | null) => void;
  parts?: "editing" | "always";
  /** A place for a new item of a list pressed (its "+"), inside a module. */
  insert?: (at: { moduleId: string; list: string; index: number }) => void;
  /** An item of a list dragged to another place in it. */
  reorder?: (at: { moduleId: string; list: string; item: string | number; to: number }) => void;
  /** A reference's handle dropped on an item it can refer to, as a message's end on a lifeline. */
  retarget?: (at: { moduleId: string; path: string; to: string }) => void;
  /** A value dragged by its handle to another: a number, or a place on a map. */
  setValue?: (at: { moduleId: string; path: string; value: unknown }) => void;
  /** A drag from one item's region to another's that makes a new item between them. */
  create?: (at: { moduleId: string; list: string; index: number; values: Record<string, unknown> }) => void;
  cameraChanged?: (camera: Camera) => void;
  commit?: (moves: { id: string; bounds: Bounds }[]) => void;
  /** Modules dragged off with Alt held while editing: copies of them go that far from
   * where they stand, and they stay. */
  duplicate?: (ids: string[], by: Point) => void;
  /** A link drawn while editing: from a side's dot, or with the arrow tool from where it
   * was pressed to where it was let go, each end as it binds there (`bindingAt`); `upright`
   * when it was drawn straight up or down, as a line rather than an arrow. */
  connect?: (from: LinkEnd, to: LinkEnd, how?: { upright?: boolean }) => void;
  /** The dot on a side of a module pressed, or a link from it let go over the paper: a new
   * module like it is wanted there (beyond that side, when no point is given), linked to
   * it. */
  extend?: (from: { moduleId: string; side: Side }, at?: Point) => void;
  /** An end of a link dragged elsewhere while editing, binding as it lands. */
  reconnect?: (linkId: string, end: "from" | "to", to: LinkEnd) => void;
  /** A right click while editing, at a point on screen, after the selection has followed
   * it; for the menu of what can be done there. */
  menu?: (at: { x: number; y: number }) => void;
  /** A finger held still on the canvas, at a point on screen, after the selection has
   * followed it (whether editing or not). Without it, a long press while editing asks for
   * the menu, as a right click does. */
  hold?: (at: { x: number; y: number }) => void;
  /** A press with the drawing tool at a point in the scene, or a box dragged out with it;
   * and a double click on the paper while editing, at its point. */
  place?: (at: Point, box?: Bounds) => void;
  /** A line drawn while editing, in scene units: with the pen, through the points the hand
   * went; with the arrow tool, straight from the press to where it was let go, when neither
   * end binds to anything (`upright` when drawn straight up or down). An arrow with an end
   * on a module or a link is a link, asked for with `connect`. */
  ink?: (points: Point[], how: { kind: "pen" | "arrow"; upright?: boolean }) => void;
  /** Modules and links rubbed out with the eraser while editing, by id. */
  erase?: (ids: string[]) => void;
  /** A scene has been drawn and is now on screen. */
  shown?: (scene: Scene) => void;
  error: (message: string) => void;
}
const easeOut = "cubic-bezier(0.22, 1, 0.36, 1)";
const same = (a: Bounds, b: Bounds) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const seed = (id: string) =>
  [...id].reduce(
    (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
    2166136261,
  );
const GRAPHITE = "rgba(70,70,70,.45)";
const ACCENT = "#3366d6";
/** The red pencil: what a dragged box lines up with, and the gaps it keeps. */
const CHECK = "#e5484d";
/** Figures on the canvas are set in the interface's face, as the lettering of a drawing. */
const FIGURES = "'Sofia Sans Letters','Sofia Sans',system-ui,sans-serif";
/** What a press does while editing: select and move, move the view, draw a box for
 * something new, draw a link from one module to another, draw a line freehand (pen) or
 * straight (arrow), or rub parts out (erase). */
export type CanvasTool = "select" | "hand" | "draw" | "pen" | "arrow" | "erase";
/** The eraser's mark on screen: a small ring where it rubs. */
const ERASER = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="7" fill="rgba(255,255,255,.7)" stroke="#555" stroke-width="1.5"/></svg>')}") 10 10, cell`;
/** The angle a straight line drawn with Shift held keeps to a multiple of. */
const ANGLE_STEP = Math.PI / 12;
/** How far from a link's line, in screen pixels, a press still takes the link: a finger
 * covers far more than a mouse's point does. */
const SLOP = 10,
  FINGER_SLOP = 24;
/** How far a press may wander and still be a press, not a drag. */
const STILL = 3,
  FINGER_STILL = 8;
/** How long a finger is held still for a long press, and how soon a second tap must come
 * (and how near the first) to be a double tap. */
const HOLD_MS = 500,
  DOUBLE_TAP_MS = 320,
  DOUBLE_TAP_PX = 30;
/** Whether the device has a coarse pointer (a finger): the controls laid over the canvas
 * then get places to press as big as a fingertip. */
const fingers = () =>
  typeof matchMedia === "function" && matchMedia("(any-pointer: coarse)").matches;
/** Distance from a point to a segment. */
/** Where words are on screen, and the size their type shows at: an HTML element's type is
 * scaled by how much larger it shows than it lays out; an SVG's is about its line's height. */
function placeOf(words: Element) {
  const rect = words.getBoundingClientRect();
  return {
    rect,
    size:
      words instanceof HTMLElement
        ? parseFloat(getComputedStyle(words).fontSize) * (rect.width / (words.offsetWidth || rect.width))
        : rect.height * 0.8,
  };
}
/** Data with a value dragged by a handle: a record's fields given whole merge into it (a
 * place moved on a map), anything else is set at the path. */
function pointValue(data: Record<string, unknown>, path: string, value: unknown) {
  const at = getAt(data, path);
  const merged =
    value && typeof value === "object" && !Array.isArray(value) && at && typeof at === "object" && !Array.isArray(at) ? { ...at, ...value } : value;
  return setIn(data, path, merged) as Record<string, unknown> | null;
}
const isFreeEnd = (end: LinkEnd) => !("moduleId" in end) && !("linkId" in end);
/** Where a bound end stands: a side's middle, or the point found on the outline. */
const middle = (end: LinkEnd, b: Bounds, found: Point): Point =>
  "moduleId" in end && typeof end.at === "string"
    ? { x: b.x + sidePoint[end.at].x * b.width, y: b.y + sidePoint[end.at].y * b.height }
    : found;
/** Whether a line from a to b runs upright, as a line drawn down from a box does. */
const upright = (a: Point, b: Point) => Math.abs(b.x - a.x) * 5 < Math.abs(b.y - a.y);
function distance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** A control on the canvas: a large, invisible place to press around a small mark. */
function control(data: Record<string, string>, hit: number, mark: string, label: string) {
  const el = document.createElement("button");
  Object.assign(el.dataset, data, { canvasControl: "" });
  el.tabIndex = -1;
  el.setAttribute("aria-label", label);
  el.style.cssText = `position:absolute;width:${hit}px;height:${hit}px;margin:${-hit / 2}px 0 0 ${-hit / 2}px;padding:0;border:0;background:none;pointer-events:auto;display:grid;place-items:center`;
  const i = document.createElement("i");
  i.style.cssText = mark + ";pointer-events:none;box-sizing:border-box;display:block";
  el.append(i);
  return el;
}
export class Canvas {
  renderer: SceneRenderer;
  readonly element = document.createElement("div");
  /** World-space overlay that moves with the drawing, for marks that are not part of it. */
  readonly layer = document.createElement("div");
  readonly ready: Promise<void>;
  private camera: Camera = { x: 0, y: 0, scale: 1 };
  private pending?: SceneRenderer;
  private sketches = new Map<
    string,
    {
      element: Element;
      bounds: Bounds;
      shaded: boolean;
      ground: boolean;
      /** Passes made over it while its drawing was being written. */
      passes: number;
    }
  >();
  private sketched = 0;
  private gliding = 0;
  private movable: boolean;
  /** Editing: a press selects instead of opening or operating what is drawn, any module
   * can be dragged at once, and Shift adds to the selection. */
  private editing = false;
  private selection: string[] = [];
  /** The part selected inside the one module selected, and the one the pointer is over. */
  private chosenPart: PartPick | null = null;
  private hoveredPart: PartPick | null = null;
  private partBox = document.createElement("div");
  private partHover = document.createElement("div");
  /** More parts selected with the first, by Shift, in the same module. */
  private moreParts: string[] = [];
  private partBoxes: HTMLDivElement[] = [];
  /** The "+" of the place for a new item nearest the pointer, the handles of the parts
   * selected, where a dragged item would go, and the region a drag would drop on. */
  private slotMark?: HTMLButtonElement;
  private nearSlot: { list: string; index: number; at: Point } | null = null;
  private handleMarks: HTMLButtonElement[] = [];
  private dropLine = document.createElement("div");
  private target = document.createElement("div");
  private outlines: HTMLDivElement[] = [];
  private hovered: string | null = null;
  private hover = document.createElement("div");
  /** The box around the selection, with its handles, and the dots links are drawn from. */
  private frame = document.createElement("div");
  private dots = new Map<Side, HTMLElement>();
  /** The side of the selected module the pointer is nearest, whose dot shows. */
  private near: Side | null = null;
  /** The selection's measure, as a drawing is dimensioned, and the equal gaps a dragged box
   * keeps: drawn over the canvas in screen units. */
  private dims = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private dimsDrawn = "";
  private gaps: Gap[] = [];
  /** Where modules dragged off as copies came from, outlined while they are dragged. */
  private origin = document.createElement("div");
  /** What a dragged box snaps to: its neighbours' lines and gaps, and a grid's lines (0 for
   * none), in scene units. */
  private snapping = { guides: true, grid: 0 };
  /** The box around the group of a selected module. */
  private groupBox = document.createElement("div");
  /** The links selected while editing, with the modules selected or alone, and the link
   * under the pointer. */
  private linkSelection: string[] = [];
  private hoveredLink: string | null = null;
  /** The lines of the hovered and the selected link, traced over them. */
  private linkMarks = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  /** The ends of the one link selected, to drag onto another module or side. */
  private ends = new Map<"from" | "to", HTMLButtonElement>();
  /** Each drawn link's lines and words, sampled in scene units, for pressing near it. */
  private traces = new Map<
    string,
    { drawn: Element | null; renderer: SceneRenderer; lines: Point[][]; boxes: Bounds[] }
  >();
  /** The size or place of what is being dragged, shown beside it. */
  private readout = document.createElement("div");
  /** Where dragged modules are now, ahead of their drawing catching up. */
  private ghost = new Map<string, Bounds>();
  /** Drawing dragged modules again, once a frame, with only the latest place waiting. */
  private redrawing?: Promise<unknown>;
  private wanted?: { id: string; bounds: Bounds }[];
  private watchers = new Set<() => void>();
  private marquee = document.createElement("div");
  private guides: HTMLDivElement[] = [];
  private line = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  /** The line being drawn with the pen or the arrow tool, on screen until it is made. */
  private ink = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  /** What a press does while editing: select and move, move the view, or place. */
  private tool: CanvasTool = "select";
  /** The space bar held: the view moves under a drag, whatever the tool. */
  private spacing = false;
  private observer: ResizeObserver;
  /** The canvas's size when last seen, to keep the view steady as it changes. */
  private size = { width: 0, height: 0 };
  private settling?: ReturnType<typeof setTimeout>;
  /** Small marks on modules that open a scene or a page, so they can be found without
   * hovering over everything. Laid over the canvas, they are never part of the drawing. */
  private targets = document.createElement("div");
  private badges = new Map<string, HTMLButtonElement>();
  private abort = new AbortController();
  private automatic: boolean;
  /** How the automatic view frames the drawing: filling the screen as `fill` allows, or
   * whole. */
  private framing: "fill" | "whole" = "fill";
  private gesture?: {
    x: number;
    y: number;
    moved: boolean;
    /** The pointer driving it: other fingers do not move it. */
    pointer: number;
    /** Whether a finger made it. */
    touch: boolean;
    /** A press on the one module selected: let go without a drag, it selects the part of
     * the drawing it landed on (none where it landed on no part). */
    pickPart?: PartPick | null;
  } & (
    | { kind: "pan"; camera: Camera }
    | {
        kind: "pinch";
        camera: Camera;
        /** Where the two fingers' middle was and how far apart they were, at the start. */
        mid: Point;
        span: number;
      }
    | {
        kind: "move";
        moves: { id: string; bounds: Bounds }[];
        /** The boxes of the modules that stay, which a dragged box snaps to. */
        others: Bounds[];
        /** Where they are now. */
        last?: { id: string; bounds: Bounds }[];
        /** Whether copies are being dragged off: the modules themselves stay. */
        copy: boolean;
        /** A module of the selection pressed: let go where it was pressed, the selection
         * narrows to it (or to its group), as a second press goes into a group. */
        narrow?: string;
      }
    | {
        kind: "resize";
        handle: Handle;
        frame: Bounds;
        moves: { id: string; bounds: Bounds }[];
        others: Bounds[];
        last?: { id: string; bounds: Bounds }[];
      }
    | {
        kind: "marquee";
        start: Point;
        /** What was selected before, kept as the box adds to it (with Shift held). */
        base: { modules: string[]; links: string[] };
        picked: string;
        /** The module that holds others the box was begun on: let go where it was
         * pressed, the press selects it. */
        on?: string;
      }
    | { kind: "draw"; start: Point; box?: Bounds }
    | { kind: "connect"; from: { moduleId: string; side?: Side } }
    | { kind: "relink"; linkId: string; end: "from" | "to" }
    /** A line being drawn: the pen's every point, or the arrow's two ends; and what the
     * arrow's start binds to, to make it a link when either end binds. */
    | { kind: "ink"; points: Point[]; straight: boolean; from?: Binding }
    /** The eraser going over parts: those it has touched go when it is lifted. */
    | { kind: "erase"; hit: Set<string>; last: { x: number; y: number } }
    | { kind: "press" }
    /** An item of a module's list dragged along its rows to another place. */
    | { kind: "reorder"; moduleId: string; list: string; item: string | number; axis: "x" | "y"; to?: number }
    /** A handle of a part dragged: onto an item it can refer to, or along to change a value. */
    | {
        kind: "handle";
        moduleId: string;
        handle: EditMap["handles"][number];
        /** The data drawn, defaults filled in, that the handle changes. */
        data: Record<string, unknown>;
        /** The module's own data before the drag, drawn again when it is let go of. */
        was: Record<string, unknown>;
        to?: string;
        value?: unknown;
      }
    /** A drag from one item's region to another's, making a new item between them. */
    | { kind: "create"; moduleId: string; list: string; between: [string, string]; fields?: Record<string, unknown>; rows: "x" | "y"; from: string; start: Point; to?: string }
  );
  /** The fingers on the canvas now, where they are on screen. */
  private touches = new Map<number, Point>();
  /** A finger held still, until it is long enough to be a long press. */
  private holding?: ReturnType<typeof setTimeout>;
  /** The last tap with a finger, to tell a double tap; and when one was handled, so the
   * browser's own double click after it is not taken twice. */
  private tapped?: { at: number; x: number; y: number };
  private doubled = -Infinity;
  /** Whether the last press was a finger's. */
  private touching = false;
  /** Where the canvas was last pressed, on screen: which of a module's words a person
   * means when they change "its words" after selecting it there. */
  private pressedAt?: { x: number; y: number };
  constructor(
    host: HTMLElement,
    work: Work,
    scene: Scene,
    readonly options: CanvasOptions,
  ) {
    this.movable = !!options.movable;
    this.automatic = !options.camera;
    this.camera = options.camera || this.camera;
    this.element.dataset.canvas = "";
    this.element.tabIndex = 0;
    this.element.style.cssText =
      "position:relative;width:100%;height:100%;overflow:hidden;outline:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;background-image:radial-gradient(#dcd6c9 .7px,transparent .7px)";
    host.append(this.element);
    this.renderer = this.renderFor(work, scene);
    this.renderer.element.style.visibility = "hidden";
    this.element.append(this.renderer.element);
    this.layer.style.cssText =
      "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2;transform-origin:0 0";
    this.element.append(this.layer);
    this.targets.style.cssText =
      "position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden";
    this.element.append(this.targets);
    this.hover.style.cssText =
      "position:absolute;border:1px solid rgba(51,102,214,.5);border-radius:2px;pointer-events:none;display:none;z-index:3;box-sizing:border-box";
    this.element.append(this.hover);
    // A part inside a module is drawn round in a finer line than the module itself.
    this.partBox.style.cssText =
      `position:absolute;border:1px solid ${ACCENT};border-radius:2px;pointer-events:none;display:none;z-index:4;box-sizing:border-box;outline:2px solid rgba(255,255,255,.7);outline-offset:0`;
    this.partHover.style.cssText =
      "position:absolute;border:1px dashed rgba(51,102,214,.7);border-radius:2px;pointer-events:none;display:none;z-index:4;box-sizing:border-box";
    this.element.append(this.partBox, this.partHover);
    this.dropLine.style.cssText = `position:absolute;background:${ACCENT};pointer-events:none;display:none;z-index:5;border-radius:1px`;
    this.target.style.cssText = `position:absolute;border:1.5px solid ${ACCENT};background:rgba(51,102,214,.08);border-radius:3px;pointer-events:none;display:none;z-index:4;box-sizing:border-box`;
    this.element.append(this.dropLine, this.target);
    const english = /^en/i.test(document.documentElement.lang);
    // Controls are pressed by their invisible place, which grows to a fingertip on touch.
    const finger = fingers(),
      hit = (n: number) => (finger ? 44 : n);
    this.frame.style.cssText =
      "position:absolute;pointer-events:none;display:none;z-index:4;box-sizing:border-box";
    this.frame.dataset.canvasControl = "";
    for (const h of handles) {
      const x = h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%",
        y = h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%";
      const cursor = { nw: "nwse", se: "nwse", ne: "nesw", sw: "nesw", n: "ns", s: "ns", e: "ew", w: "ew" }[h];
      const handle = control(
        { handle: h },
        hit(18),
        `width:${finger ? 13 : 8}px;height:${finger ? 13 : 8}px;border-radius:1.5px;background:#fff;border:1.5px solid ${ACCENT}`,
        english ? "Resize" : "调整大小",
      );
      Object.assign(handle.style, { left: x, top: y, cursor: cursor + "-resize" });
      this.frame.append(handle);
    }
    for (const side of sides) {
      const at = sidePoint[side];
      const out = finger ? 34 : 22;
      // A plus in a ring: pressed, it adds a module beyond that side; dragged, it draws a link.
      const plus = `linear-gradient(${ACCENT},${ACCENT}) center/8px 1.5px no-repeat,linear-gradient(${ACCENT},${ACCENT}) center/1.5px 8px no-repeat,#fff`;
      const dot = control(
        { connect: side },
        hit(26),
        `width:18px;height:18px;border-radius:50%;background:${plus};border:1.5px solid ${ACCENT};box-shadow:0 0 0 2px rgba(255,255,255,.9);transition:transform .15s,opacity .15s`,
        english ? "Add a linked element, or drag a link" : "延伸一个元素，或拖出连线",
      );
      dot.title = english
        ? "Click to add a linked element here; drag to another element to link them"
        : "点一下在这一侧延伸出一个元素；拖到另一个元素上连线";
      Object.assign(dot.style, {
        left: `calc(${at.x * 100}% + ${(at.x - 0.5) * 2 * out * (at.y === 0.5 ? 1 : 0)}px)`,
        top: `calc(${at.y * 100}% + ${(at.y - 0.5) * 2 * out * (at.x === 0.5 ? 1 : 0)}px)`,
        cursor: "crosshair",
      });
      dot.addEventListener("pointerenter", () => ((dot.firstChild as HTMLElement).style.transform = "scale(1.18)"));
      dot.addEventListener("pointerleave", () => ((dot.firstChild as HTMLElement).style.transform = ""));
      this.dots.set(side, dot as HTMLButtonElement);
      this.frame.append(dot);
    }
    this.element.append(this.frame);
    // A new item goes in at a place a drawing offers: a plus in a dashed ring of the blue pencil.
    this.slotMark = control(
      { slot: "" },
      hit(24),
      `width:18px;height:18px;border-radius:50%;background:linear-gradient(${ACCENT},${ACCENT}) center/8px 1.5px no-repeat,linear-gradient(${ACCENT},${ACCENT}) center/1.5px 8px no-repeat,#fff;border:1.5px dashed ${ACCENT}`,
      english ? "Add one here" : "在这里添加一项",
    ) as HTMLButtonElement;
    this.slotMark.style.display = "none";
    this.slotMark.style.zIndex = "5";
    this.slotMark.style.cursor = "copy";
    this.element.append(this.slotMark);
    this.groupBox.style.cssText =
      "position:absolute;border:1px dashed rgba(51,102,214,.5);border-radius:3px;pointer-events:none;display:none;z-index:3;box-sizing:border-box";
    this.element.append(this.groupBox);
    this.origin.style.cssText =
      "position:absolute;border:1px dashed rgba(51,102,214,.6);border-radius:2px;pointer-events:none;display:none;z-index:3;box-sizing:border-box";
    this.element.append(this.origin);
    this.dims.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;overflow:visible";
    this.dims.setAttribute("aria-hidden", "true");
    this.element.append(this.dims);
    this.marquee.style.cssText =
      "position:absolute;border:1px solid rgba(61,114,224,.8);background:rgba(61,114,224,.07);pointer-events:none;display:none;z-index:5;box-sizing:border-box";
    this.element.append(this.marquee);
    this.line.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;z-index:5;overflow:visible";
    this.line.innerHTML = `<line stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="5 4" stroke-linecap="round"/><circle r="4" fill="${ACCENT}"/><circle data-target r="7" fill="#fff" stroke="${ACCENT}" stroke-width="2.5" style="display:none"/><path fill="none" stroke="${ACCENT}" stroke-opacity=".55" stroke-width="2" stroke-linejoin="round"/>`;
    this.element.append(this.line);
    this.ink.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;z-index:5;overflow:visible";
    this.ink.innerHTML = `<path fill="none" stroke="#2b2b2b" stroke-opacity=".85" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    this.element.append(this.ink);
    this.linkMarks.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;overflow:visible";
    this.linkMarks.innerHTML = `<path data-hover fill="none" stroke="${ACCENT}" stroke-opacity=".35" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path data-chosen fill="none" stroke="${ACCENT}" stroke-opacity=".45" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
    this.element.append(this.linkMarks);
    for (const end of ["from", "to"] as const) {
      const handle = control(
        { linkEnd: end },
        hit(22),
        `width:13px;height:13px;border-radius:50%;background:#fff;border:2.5px solid ${ACCENT};box-shadow:0 1px 4px rgba(0,0,0,.2)`,
        english
          ? end === "from"
            ? "Drag where the link starts"
            : "Drag where the link ends"
          : end === "from"
            ? "拖动连线起点"
            : "拖动连线终点",
      );
      handle.title = handle.getAttribute("aria-label")!;
      Object.assign(handle.style, { zIndex: "4", display: "none", cursor: "grab" });
      this.ends.set(end, handle);
      this.element.append(handle);
    }
    this.readout.style.cssText =
      `position:absolute;z-index:6;display:none;padding:1px 6px;border-radius:4px;background:${ACCENT};color:#fff;font:600 11px/1.55 ${FIGURES};font-variant-numeric:tabular-nums;letter-spacing:.01em;white-space:nowrap;pointer-events:none;transform:translate(-50%,0)`;
    this.element.append(this.readout);
    const signal = this.abort.signal;
    // While editing, the canvas takes every press and click before the drawings do, so
    // their own buttons and links stay still and a press selects what it lands on.
    for (const type of ["pointerdown", "click", "dblclick", "input", "change"])
      this.element.addEventListener(
        type,
        (e) => {
          if (!this.editing) return;
          e.stopPropagation();
          if (type === "pointerdown") this.down(e as PointerEvent);
          if (type === "dblclick" && !this.doubledJustNow()) this.dblclick(e as MouseEvent);
        },
        { capture: true, signal },
      );
    // A press on the canvas itself reaches both listeners; editing has taken it already.
    this.element.addEventListener(
      "dblclick",
      (e) => !this.editing && !this.interactive(e) && !this.doubledJustNow() && this.dblclick(e),
      { signal },
    );
    this.element.addEventListener(
      "pointerleave",
      () => {
        if (this.near && !this.gesture) this.near = null;
        this.hoverOver(null);
        this.paint();
        if (this.hot) {
          this.hot = null;
          for (const badge of this.badges.values()) badge.removeAttribute("data-hot");
        }
      },
      { signal },
    );
    this.element.addEventListener("wheel", (e) => this.wheel(e), {
      passive: false,
      signal,
    });
    this.element.addEventListener(
      "pointerdown",
      (e) => !this.editing && this.down(e),
      { signal },
    );
    this.element.addEventListener("pointermove", (e) => this.move(e), {
      signal,
    });
    this.element.addEventListener("pointerup", (e) => this.up(e), { signal });
    this.element.addEventListener("pointercancel", (e) => this.cancel(e), {
      signal,
    });
    // While editing, a right click selects what it lands on and asks for the menu.
    this.element.addEventListener(
      "contextmenu",
      (e) => {
        // A finger's long press is handled as it happens; the browser's menu after it is not.
        if (this.touching) return e.preventDefault();
        if (!this.editing || !this.options.menu) return;
        e.preventDefault();
        this.follow(this.pick(e.clientX, e.clientY));
        this.options.menu({ x: e.clientX, y: e.clientY });
      },
      { signal },
    );
    // Holding the space bar moves the view under a drag while editing, as in drawing apps.
    // Space presses a focused button or types in a field; only elsewhere does it pan.
    const typing = (e: KeyboardEvent) =>
      (e.target as Element | null)?.closest?.(
        "input,textarea,select,button,a,[contenteditable]",
      );
    addEventListener(
      "keydown",
      (e) => {
        if (e.code !== "Space" || !this.editing || typing(e)) return;
        e.preventDefault();
        if (!this.spacing) {
          this.spacing = true;
          this.cursor();
        }
      },
      { signal },
    );
    addEventListener(
      "keyup",
      (e) => {
        if (e.code !== "Space" || !this.spacing) return;
        this.spacing = false;
        this.cursor();
      },
      { signal },
    );
    this.element.addEventListener(
      "keydown",
      (e) => {
        if (this.interactive(e)) return;
        if (e.key === "0" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
          this.fit();
          e.preventDefault();
        }
        if (e.key === "Escape" && (this.selection.length || this.linkSelection.length)) {
          this.select([]);
          e.stopPropagation();
        }
      },
      { signal },
    );
    // As the page around it changes (a panel sliding open, the window resized) the drawing
    // keeps its middle where it was, then an automatic view settles once, gently, instead of
    // refitting on every frame of the change.
    this.observer = new ResizeObserver(() => {
      const width = this.element.clientWidth,
        height = this.element.clientHeight,
        was = this.size;
      this.size = { width, height };
      if (!was.width || !was.height || !this.automatic) {
        if (this.automatic) this.fit(false);
        else this.paint();
        return;
      }
      cancelAnimationFrame(this.gliding);
      this.camera = {
        ...this.camera,
        x: this.camera.x + (width - was.width) / 2,
        y: this.camera.y + (height - was.height) / 2,
      };
      this.paint();
      clearTimeout(this.settling);
      this.settling = setTimeout(() => this.automatic && this.fit(true, 520), 200);
    });
    this.observer.observe(this.element);
    const first = this.renderer;
    this.ready = first.mount().finally(() => {
      this.mounting = false;
      // A canvas let go before its first drawing was done has nothing to show it in.
      if (this.abort.signal.aborted) return;
      if (this.renderer !== first) return this.arrived();
      first.element.style.visibility = "";
      // The view is taken before the fade starts: a layer that is fading is composited,
      // and Chromium then moves it without laying its SVG text out again.
      if (this.automatic) this.fit(false);
      else this.paint();
      // What is already drawn comes in at once, with only a short fade over the paper.
      if (this.options.motion)
        first.element.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 240,
          easing: "ease-out",
        });
      // Opening a work or entering a scene shows what is already drawn as it is: only
      // what arrives while it is open unfolds.
      this.options.shown?.(scene);
      this.arrived();
    });
  }
  /** Keeps the selection on what is still drawn, as it is now. */
  private refresh(paint = true) {
    if (this.selection.length || this.linkSelection.length)
      this.select(this.selection, this.linkSelection);
    if (paint) this.paint();
  }
  /** Modules waited for, each with the revision that made them. */
  private awaited = new Set<{ ids: string[]; revision: number; done: (how: Drawn) => void }>();
  /** Settles once these modules, made in `revision`, are drawn (not only laid out):
   * `drawn`; `missing` once a revision as new as theirs has been drawn without them (a
   * later change took them out); `gone` if the canvas goes first. No clock is involved, so
   * a slow device only makes it wait longer. */
  drawn(ids: string[], revision: number) {
    return new Promise<Drawn>((done) => {
      const wait = {
        ids,
        revision,
        done: (how: Drawn) => {
          this.awaited.delete(wait);
          done(how);
        },
      };
      this.awaited.add(wait);
      this.arrived();
    });
  }
  /** Patches being drawn: a module laid out by one is not drawn until it is done. */
  private patching = 0;
  /** Latest patchable update received while a patch is already in flight. */
  private queued?: { work: Work; scene: Scene; quiet: boolean };
  /** Whether the first drawing of the scene is still being made. */
  private mounting = true;
  private arrived() {
    if (this.mounting || this.patching || this.pending || this.queued) return;
    const shown = this.renderer.work.revision;
    for (const wait of [...this.awaited]) {
      if (wait.ids.every((id) => this.renderer.instances.has(id))) wait.done("drawn");
      else if (shown >= wait.revision) wait.done("missing");
    }
  }

  private renderFor(work: Work, scene: Scene) {
    return new SceneRenderer(work, scene, {
      open: (t) => this.options.open(t),
      error: (e) => this.options.error(e),
    });
  }
  /** Draws another revision of the scene: when the scene, look, script and non-picture
   * materials are unchanged, patches only the changed modules/links/pictures in place so
   * untouched parts never flash or reload. Otherwise draws off screen and swaps it in. */
  update(work: Work, scene: Scene, quiet = false) {
    if (!this.mounting && !this.pending && this.renderer.patchable(work, scene)) {
      if (this.patching > 0) {
        this.queued = {
          work,
          scene,
          quiet: this.queued ? this.queued.quiet && quiet : quiet,
        };
        return;
      }
      const renderer = this.renderer;
      const animate = !quiet && !!this.options.motion;
      this.patching++;
      void renderer
        .patch(work, scene, { detachLeaving: animate, hideNew: animate })
        .then(
          (result) => {
            if (this.renderer !== renderer) {
              for (const host of result.leaving) host.remove();
              return;
            }
            this.refresh();
            if (this.automatic && !quiet && result.layoutChanged) this.fit(true);
            if (!quiet) this.unfoldPatch(renderer, result);
            else for (const host of result.leaving) host.remove();
            this.options.shown?.(scene);
          },
          (e) => this.options.error(String(e)),
        )
        .finally(() => {
          this.patching--;
          if (this.queued && !this.abort.signal.aborted) {
            const next = this.queued;
            this.queued = undefined;
            this.update(next.work, next.scene, next.quiet);
          } else {
            this.arrived();
          }
        });
      this.refresh();
      return;
    }
    this.queued = undefined;
    this.pending?.dispose();
    const next = this.renderFor(work, scene);
    this.pending = next;
    next.element.style.visibility = "hidden";
    this.layer.before(next.element);
    const swap = () => {
      if (this.pending !== next) return;
      this.pending = undefined;
      const before = this.renderer;
      this.renderer = next;
      next.element.style.visibility = "";
      // The selection stays on what is still there, as it is now, and the drawing takes
      // the current view at once; an automatic view then glides on to fit it.
      this.refresh();
      this.arrived();
      if (this.automatic && !quiet) this.fit(true);
      if (quiet) before.dispose();
      else this.unfold(before, next);
      this.options.shown?.(scene);
    };
    void next.mount().then(swap, (e) => {
      this.options.error(String(e));
      swap();
    });
  }
  /** Pencils in where modules are about to be drawn, as their layout arrives, and keeps room
   * for them in the automatic view. While a module's drawing is being written the pen keeps
   * working its outline over, and shades it once the drawing has arrived. Modules already
   * drawn where they belong are left alone. */
  sketch(items: Sketch[], drawings: { done: string[]; writing?: string }) {
    const now = performance.now(),
      wanted = new Map(
        items
          .filter((s) => {
            const m = this.renderer.instances.get(s.id);
            return !m || !same(m.bounds, s.bounds);
          })
          .map((s) => [s.id, s]),
      );
    for (const [id, s] of this.sketches)
      if (
        !same(
          wanted.get(id)?.bounds || { x: 0, y: 0, width: 0, height: 0 },
          s.bounds,
        )
      )
        this.erase(id, 0);
    const extent = union(items.map((i) => i.bounds)),
      // How much of b lies under a.
      covers = (a: Bounds, b: Bounds) =>
        (Math.max(
          0,
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        ) *
          Math.max(
            0,
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
          )) /
        (b.width * b.height),
      // A large module lying under several others is the figure's ground: room is kept,
      // nothing pencilled. Later arrivals can reveal one, and its outline is taken back.
      ground = (s: Sketch) =>
        share(s.bounds) > 0.3 &&
        items.filter((i) => i !== s && covers(s.bounds, i.bounds) > 0.25)
          .length > 1,
      share = (b: Bounds) =>
        (b.width * b.height) / (extent.width * extent.height);
    let at = Math.max(now, this.sketched),
      added = false;
    for (const s of wanted.values())
      if (this.sketches.get(s.id)?.ground === false && ground(s))
        this.erase(s.id, 0);
    for (const s of wanted.values()) {
      if (this.sketches.has(s.id)) continue;
      added = true;
      const { x, y, width, height } = s.bounds;
      if (ground(s)) {
        this.sketches.set(s.id, {
          element: document.createElement("i"),
          bounds: s.bounds,
          shaded: true,
          ground: true,
          passes: 0,
        });
        continue;
      }
      const element = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      element.setAttribute("viewBox", `0 0 ${width} ${height}`);
      element.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;overflow:visible`;
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", gesture(width, height, seed(s.id)));
      path.setAttribute("pathLength", "1");
      path.style.cssText = `fill:none;stroke:${GRAPHITE};stroke-width:calc(1.25px / var(--zoom));stroke-linecap:round;stroke-dasharray:1 1`;
      element.append(path);
      if (s.label) {
        const text = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        text.textContent = s.label;
        text.setAttribute("x", String(width / 2));
        text.setAttribute("y", String(height / 2));
        text.style.cssText = `fill:${GRAPHITE};font:italic calc(12.5px / var(--zoom)) "Iowan Old Style","Songti SC",Georgia,serif;text-anchor:middle;dominant-baseline:central;text-rendering:geometricPrecision`;
        element.append(text);
        text.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 500,
          delay: at - now + 380,
          fill: "backwards",
        });
      }
      this.layer.append(element);
      path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: 700,
        delay: at - now,
        easing: "cubic-bezier(0.45, 0.05, 0.35, 1)",
        fill: "both",
      });
      this.sketches.set(s.id, {
        element,
        bounds: s.bounds,
        shaded: false,
        ground: false,
        passes: 0,
      });
      at += 240;
    }
    for (const s of wanted.values()) {
      const sketch = this.sketches.get(s.id)!;
      if (sketch.shaded || !s.drawingId || !drawings.done.includes(s.drawingId))
        continue;
      sketch.shaded = true;
      // Only shapes of a modest size take shading; long strokes across the page do not.
      if (share(s.bounds) > 0.15) continue;
      const { width, height } = s.bounds;
      this.pencil(
        sketch.element,
        hatching(width, height, seed(s.id)),
        0.55,
        at,
        900,
      );
      at += 320;
      added = true;
    }
    // While a drawing is still being written, the modules that use it are gone over again:
    // a second line around the outline, then cross-hatching, then a pause.
    const working = [...wanted.values()].filter(
      (s) =>
        s.drawingId === drawings.writing &&
        this.sketches.get(s.id)?.element instanceof SVGSVGElement,
    );
    if (working.length && at <= now) {
      const s = working.reduce((a, b) =>
          this.sketches.get(b.id)!.passes < this.sketches.get(a.id)!.passes
            ? b
            : a,
        ),
        sketch = this.sketches.get(s.id)!,
        { width, height } = s.bounds,
        pass = ++sketch.passes;
      if (pass === 1)
        this.pencil(
          sketch.element,
          gesture(width, height, seed(s.id) + 7),
          0.7,
          at,
          1500,
        );
      else if (pass === 2 && share(s.bounds) <= 0.15)
        this.pencil(
          sketch.element,
          hatching(width, height, seed(s.id), true),
          0.35,
          at,
          1100,
        );
      at += pass === 1 ? 1500 : pass === 2 ? 1100 : 2400;
    }
    this.sketched = at;
    if (added || wanted.size !== this.sketches.size) {
      if (this.automatic) this.fit(true);
    }
  }
  /** Draws a pencil line into a sketch at a time on the sketch's schedule. */
  private pencil(
    sketch: Element,
    d: string,
    opacity: number,
    at: number,
    duration: number,
  ) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("pathLength", "1");
    path.style.cssText = `fill:none;stroke:${GRAPHITE};stroke-opacity:${opacity};stroke-width:calc(1px / var(--zoom));stroke-linecap:round;stroke-dasharray:1 1`;
    sketch.append(path);
    path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration,
      delay: at - performance.now(),
      easing: "cubic-bezier(0.45, 0.05, 0.35, 1)",
      fill: "both",
    });
  }
  private erase(id: string, delay: number) {
    const sketch = this.sketches.get(id);
    if (!sketch) return;
    this.sketches.delete(id);
    sketch.element
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 600,
        delay,
        fill: "forwards",
      })
      .finished.then(
        () => sketch.element.remove(),
        () => sketch.element.remove(),
      );
  }
  private unfold(before: SceneRenderer | undefined, after: SceneRenderer) {
    const leaving = before
      ? [...before.instances.values()].filter((m) => !after.instances.has(m.id))
      : [];
    if (before && leaving.length && this.options.motion) {
      before.element.style.visibility = "hidden";
      for (const m of leaving) {
        const host = before.host("module", m.id)!;
        Object.assign(host.style, {
          visibility: "visible",
          pointerEvents: "none",
        });
        host.animate(
          [{}, { opacity: 0, filter: "blur(6px)", transform: "scale(.98)" }],
          { duration: 420, easing: "ease-in", fill: "forwards" },
        );
      }
      setTimeout(() => before.dispose(), 440);
    } else before?.dispose();
    if (!this.options.motion) return;
    const content = (r: SceneRenderer, m: Instance) =>
      JSON.stringify([
        m.drawingId,
        m.data,
        m.bounds.width,
        m.bounds.height,
        r.work.drawings[m.drawingId]?.source,
        r.work.style,
      ]);
    const inked: Instance[] = [];
    for (const m of after.instances.values()) {
      const old = before?.instances.get(m.id),
        host = after.host("module", m.id);
      if (!host) continue;
      if (!old || content(before!, old) !== content(after, m)) inked.push(m);
      else if (old.bounds.x !== m.bounds.x || old.bounds.y !== m.bounds.y)
        host.animate(
          [
            {
              transform: `translate(${old.bounds.x - m.bounds.x}px,${old.bounds.y - m.bounds.y}px)`,
            },
            { transform: "none" },
          ],
          { duration: 900, easing: easeOut },
        );
    }
    // Modules are drawn in the order the author wrote them, each begun before the last is
    // finished; a whole first figure takes a few seconds, a revision less, a reopened one a
    // moment.
    const plans = inked.map((m) => plan(after.host("module", m.id)!)),
      starts: number[] = [];
    let t = 0;
    for (const p of plans) {
      starts.push(t);
      t += p.time * 0.6;
    }
    const end = Math.max(1, ...plans.map((p, i) => starts[i] + p.time)),
      budget = !before ? 1800 : before.instances.size ? 4500 : 7000,
      pace = Math.min(1, budget / end),
      done = new Map<string, number>();
    inked.forEach((m, i) => {
      play(plans[i], starts[i] * pace, pace);
      done.set(m.id, (starts[i] + plans[i].time) * pace);
      this.erase(m.id, starts[i] * pace);
    });
    for (const m of after.instances.values())
      if (!done.has(m.id)) this.erase(m.id, 0);
    // A picture that was still developing in the last revision comes up like a print.
    const was = before?.work.materials ?? {};
    for (const m of after.instances.values()) {
      if (done.has(m.id)) continue;
      for (const frame of after
        .host("module", m.id)
        ?.shadowRoot?.querySelectorAll<HTMLElement>("[data-material]") ?? []) {
        const id = frame.dataset.material!,
          old = was[id],
          now = after.work.materials[id];
        if (
          old?.kind === "picture" &&
          old.status === "developing" &&
          now?.kind === "picture" &&
          now.status === "ready"
        )
          frame.querySelector("img")?.animate(
            [
              { opacity: 0, filter: "blur(12px) saturate(0) brightness(1.12)" },
              { opacity: 0.85, offset: 0.4 },
              { opacity: 1, filter: "none" },
            ],
            { duration: 1600, easing: easeOut },
          );
      }
    }
    // Links are drawn once both of their ends are.
    for (const l of after.scene.links) {
      const host = after.host("link", l.id);
      if (
        !host ||
        (before?.scene.links.some((x) => x.id === l.id) &&
          !done.has(endModule(l.from) ?? "") &&
          !done.has(endModule(l.to) ?? ""))
      )
        continue;
      const ready = Math.max(
        done.get(endModule(l.from) ?? "") ?? 0,
        done.get(endModule(l.to) ?? "") ?? 0,
      );
      play(plan(host), Math.max(0, ready - 150), pace);
    }
  }
  /** Plays unfold/move/develop/fade transitions for an in-place `SceneRenderer.patch`. */
  private unfoldPatch(renderer: SceneRenderer, result: PatchResult) {
    for (const m of result.inked) {
      const host = renderer.host("module", m.id);
      if (host) host.style.visibility = "";
    }
    for (const id of result.drawnLinks) {
      const host = renderer.host("link", id);
      if (host) host.style.visibility = "";
    }
    if (result.leaving.length) {
      if (this.options.motion) {
        for (const host of result.leaving) {
          Object.assign(host.style, {
            visibility: "visible",
            pointerEvents: "none",
          });
          host.animate(
            [{}, { opacity: 0, filter: "blur(6px)", transform: "scale(.98)" }],
            { duration: 420, easing: "ease-in", fill: "forwards" },
          );
        }
        setTimeout(() => {
          for (const host of result.leaving) host.remove();
        }, 440);
      } else {
        for (const host of result.leaving) host.remove();
      }
    }
    if (!this.options.motion) {
      for (const m of renderer.instances.values()) this.erase(m.id, 0);
      return;
    }
    for (const moved of result.moved) {
      const host = renderer.host("module", moved.id);
      if (!host) continue;
      host.animate(
        [
          { transform: `translate(${moved.dx}px,${moved.dy}px)` },
          { transform: "none" },
        ],
        { duration: 900, easing: easeOut },
      );
    }
    const inked = result.inked.filter((m) => !!renderer.host("module", m.id));
    const plans = inked.map((m) => plan(renderer.host("module", m.id)!)),
      starts: number[] = [];
    let t = 0;
    for (const p of plans) {
      starts.push(t);
      t += p.time * 0.6;
    }
    const end = Math.max(1, ...plans.map((p, i) => starts[i] + p.time)),
      budget = result.hadModulesBefore ? 4500 : 7000,
      pace = Math.min(1, budget / end),
      done = new Map<string, number>();
    inked.forEach((m, i) => {
      play(plans[i], starts[i] * pace, pace);
      done.set(m.id, (starts[i] + plans[i].time) * pace);
      this.erase(m.id, starts[i] * pace);
    });
    for (const m of renderer.instances.values())
      if (!done.has(m.id)) this.erase(m.id, 0);
    for (const { moduleId, materialId } of result.developed) {
      if (done.has(moduleId)) continue;
      for (const frame of renderer
        .host("module", moduleId)
        ?.shadowRoot?.querySelectorAll<HTMLElement>(
          `[data-material="${CSS.escape(materialId)}"]`,
        ) ?? []) {
        frame.querySelector("img")?.animate(
          [
            { opacity: 0, filter: "blur(12px) saturate(0) brightness(1.12)" },
            { opacity: 0.85, offset: 0.4 },
            { opacity: 1, filter: "none" },
          ],
          { duration: 1600, easing: easeOut },
        );
      }
    }
    for (const id of result.drawnLinks) {
      const l = renderer.links.get(id);
      const host = renderer.host("link", id);
      if (!l || !host) continue;
      const ready = Math.max(
        done.get(endModule(l.from) ?? "") ?? 0,
        done.get(endModule(l.to) ?? "") ?? 0,
      );
      play(plan(host), Math.max(0, ready - 150), pace);
    }
  }
  private paint() {
    const { x, y, scale } = this.camera;
    for (const layer of [this.renderer.element, this.layer]) {
      layer.style.transformOrigin = "0 0";
      layer.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    }
    if (this.editing) {
      // On the drawing board the paper is squared: a line every 20 units and a heavier one
      // every 100, both taking five times the step while they would crowd the screen.
      let unit = 20;
      while (unit * scale < 9) unit *= 5;
      const fine = unit * scale,
        coarse = fine * 5;
      const rule = (to: string, alpha: number) =>
        `linear-gradient(${to},rgba(51,102,214,${alpha}) 1px,transparent 1px)`;
      Object.assign(this.element.style, {
        backgroundImage: [rule("to right", 0.1), rule("to bottom", 0.1), rule("to right", 0.045), rule("to bottom", 0.045)].join(),
        backgroundSize: `${coarse}px ${coarse}px,${coarse}px ${coarse}px,${fine}px ${fine}px,${fine}px ${fine}px`,
        backgroundPosition: `${x}px ${y}px`,
      });
    } else {
      // The paper's dots move with the drawing and keep a comfortable spacing at any zoom.
      let dots = 24 * scale;
      while (dots < 14) dots *= 2;
      while (dots > 42) dots /= 2;
      Object.assign(this.element.style, {
        backgroundImage: "radial-gradient(#dcd6c9 .7px,transparent .7px)",
        backgroundSize: `${dots}px ${dots}px`,
        backgroundPosition: `${x}px ${y}px`,
      });
    }
    this.element.style.setProperty("--zoom", String(scale));
    const box = (el: HTMLElement, b: Bounds) => {
      const on = this.shown(b);
      Object.assign(el.style, {
        display: "block",
        left: on.x + "px",
        top: on.y + "px",
        width: on.width + "px",
        height: on.height + "px",
      });
    };
    const chosen = this.selection.flatMap((id) => {
      const m = this.renderer.instances.get(id);
      return m ? [{ ...m, bounds: this.ghost.get(id) ?? m.bounds }] : [];
    });
    while (this.outlines.length < chosen.length) {
      const outline = document.createElement("div");
      // A line of the blue pencil, as fine as a drawn one; a ring softens it where the
      // drawing is only read.
      outline.style.cssText =
        "position:absolute;border:1px solid #3366d6;border-radius:2px;pointer-events:none;display:none;z-index:3;box-sizing:border-box";
      this.element.append(outline);
      this.outlines.push(outline);
    }
    this.outlines.forEach((outline, i) => {
      if (!chosen[i]) return void (outline.style.display = "none");
      box(outline, chosen[i].bounds);
      outline.style.borderWidth = this.editing && chosen.length === 1 ? "1.5px" : "1px";
      outline.style.boxShadow = this.editing ? "none" : "0 0 0 4px rgba(61,114,224,.12)";
      outline.style.borderRadius = this.editing ? "1px" : "6px";
    });
    // The selection is resized as one by the handles on the box around it; while editing
    // a single module also offers the dots links are drawn from.
    if (chosen.length && this.movable) {
      const frame = union(chosen.map((m) => m.bounds));
      box(this.frame, frame);
      this.frame.style.border =
        chosen.length > 1 ? "1px dashed rgba(51,102,214,.75)" : "none";
      const small =
        frame.width * scale < 36 || frame.height * scale < 36;
      const handles = this.editing && this.options.resizable !== false;
      for (const h of this.frame.querySelectorAll<HTMLElement>("[data-handle]"))
        h.style.display =
          !handles || (small && h.dataset.handle!.length === 1) ? "none" : "block";
      const linking =
        this.editing &&
        chosen.length === 1 &&
        !!this.options.connect &&
        (!this.gesture || this.gesture.kind === "press") &&
        this.tool === "select";
      // A side's dot shows as the pointer nears that side; fingers, which do not hover,
      // have all four.
      const all = fingers();
      for (const [side, dot] of this.dots)
        dot.style.display = linking && (all || this.near === side) ? "grid" : "none";
    } else this.frame.style.display = "none";
    this.paintDims(chosen.length ? union(chosen.map((m) => m.bounds)) : undefined);
    // Modules selected inside a group show the box of the group they belong to.
    const within = chosen[0]?.group;
    const group =
      this.editing && within && chosen.every((m) => m.group === within)
        ? [...this.renderer.instances.values()].filter((m) => m.group === within)
        : [];
    if (group.length > chosen.length) {
      const g = union(group.map((m) => this.ghost.get(m.id) ?? m.bounds));
      box(this.groupBox, {
        x: g.x - 6 / scale,
        y: g.y - 6 / scale,
        width: g.width + 12 / scale,
        height: g.height + 12 / scale,
      });
    } else this.groupBox.style.display = "none";
    const over =
      this.editing && this.hovered && !this.selection.includes(this.hovered)
        ? this.renderer.instances.get(this.hovered)
        : undefined;
    if (over) box(this.hover, over.bounds);
    else this.hover.style.display = "none";
    const partBox = (p: PartPick | null) => {
      const m = p && this.renderer.instances.get(p.moduleId);
      const found = m && !this.ghost.has(m.id) && this.renderer.editMap(m.id)?.parts.find((x) => x.path === p.path);
      return found ? found.box : undefined;
    };
    const chosenBox = partBox(this.chosenPart);
    if (chosenBox) box(this.partBox, chosenBox);
    else this.partBox.style.display = "none";
    const more = this.chosenPart ? this.moreParts.map((path) => partBox({ moduleId: this.chosenPart!.moduleId, path })) : [];
    while (this.partBoxes.length < more.length) {
      const el = this.partBox.cloneNode() as HTMLDivElement;
      this.element.append(el);
      this.partBoxes.push(el);
    }
    this.partBoxes.forEach((el, i) => (more[i] ? box(el, more[i]!) : (el.style.display = "none")));
    this.paintEditMarks();
    const hoverBox =
      this.hoveredPart && this.hoveredPart.path !== this.chosenPart?.path && !this.gesture ? partBox(this.hoveredPart) : undefined;
    if (hoverBox) box(this.partHover, hoverBox);
    else this.partHover.style.display = "none";
    this.paintLinks();
    this.paintTargets();
    for (const fn of this.watchers) fn();
  }
  /** The measure of the selection while editing, set down as a drawing is dimensioned:
   * its width under it and its height beside it, each between two ticks; and, in the red
   * pencil, the equal gaps a dragged box keeps with its neighbours. A side whose dot is out
   * gives its figure up to it; fingers get the measure only while they resize. */
  private paintDims(frame?: Bounds) {
    const g = this.gesture;
    const drawing = g?.kind === "draw" ? g.box : undefined;
    const box = drawing ?? frame;
    const shown =
      this.editing &&
      !!box &&
      (drawing ||
        (this.movable &&
          this.tool === "select" &&
          (!g || g.kind === "press" || g.kind === "move" || g.kind === "resize") &&
          (!fingers() || g?.kind === "resize")));
    const { x, y, scale } = this.camera;
    const parts: string[] = [];
    const n = (v: number) => v.toFixed(1);
    const figure = (cx: number, cy: number, text: string, color: string, turn = false) =>
      `<text x="${n(cx)}" y="${n(cy)}"${turn ? ` transform="rotate(-90 ${n(cx)} ${n(cy)})"` : ""} fill="${color}" stroke="#fff" stroke-width="4" stroke-linejoin="round" paint-order="stroke" text-anchor="middle" dominant-baseline="central" style="font:600 11px ${FIGURES};font-variant-numeric:tabular-nums">${text}</text>`;
    // A measure between two points along one axis: the line, a tick at each end as an
    // architect draws them, and the figure on the line.
    const measure = (a: number, b: number, at: number, across: boolean, text: string | null, color: string) => {
      const line = across ? `M${n(a)} ${n(at)}H${n(b)}` : `M${n(at)} ${n(a)}V${n(b)}`;
      const tick = (v: number) =>
        across
          ? `M${n(v - 3)} ${n(at + 3)}L${n(v + 3)} ${n(at - 3)}`
          : `M${n(at - 3)} ${n(v + 3)}L${n(at + 3)} ${n(v - 3)}`;
      parts.push(
        `<path d="${line}${tick(a)}${tick(b)}" fill="none" stroke="${color}" stroke-width="1" stroke-linecap="round"/>`,
      );
      if (text !== null)
        parts.push(
          across ? figure((a + b) / 2, at, text, color) : figure(at, (a + b) / 2, text, color, true),
        );
    };
    if (shown && box) {
      const { x: l, y: t, width: w, height: h } = this.shown(box);
      if (w >= 24 || h >= 24) {
        const out = 15,
          dot = !g || g.kind === "press" ? this.near : null;
        // The lines carried out from the corners to the measure.
        parts.push(
          `<path d="M${n(l)} ${n(t + h + 6)}v${out}M${n(l + w)} ${n(t + h + 6)}v${out}M${n(l + w + 6)} ${n(t)}h${out}M${n(l + w + 6)} ${n(t + h)}h${out}" fill="none" stroke="${ACCENT}" stroke-opacity=".5" stroke-width="1"/>`,
        );
        const figures = (v: number) => String(Math.round(v));
        measure(l, l + w, t + h + out, true, w >= 34 && dot !== "bottom" ? figures(box.width) : null, ACCENT);
        measure(t, t + h, l + w + out, false, h >= 34 && dot !== "right" ? figures(box.height) : null, ACCENT);
      }
    }
    for (const gap of this.editing ? this.gaps : []) {
      const at = (gap.axis === "x" ? y : x) + gap.at * scale,
        from = (gap.axis === "x" ? x : y) + gap.from * scale,
        to = (gap.axis === "x" ? x : y) + gap.to * scale;
      measure(from, to, at, gap.axis === "x", to - from >= 26 ? String(Math.round(gap.to - gap.from)) : null, CHECK);
    }
    const html = parts.join("");
    if (this.dimsDrawn !== html) {
      this.dimsDrawn = html;
      this.dims.innerHTML = html;
    }
  }
  /** A small mark at the corner of each module that opens a scene or a page, while not
   * editing; it says where it leads when the module or the mark is under the pointer. */
  private paintTargets() {
    const shown = !this.editing && this.options.marks !== false;
    this.targets.style.display = shown ? "" : "none";
    if (!shown) return;
    const { x, y, scale } = this.camera;
    const english = /^en/i.test(document.documentElement.lang);
    const work = this.renderer.work;
    const seen = new Set<string>();
    for (const m of this.renderer.instances.values()) {
      const target = m.target;
      if (!target) continue;
      const b = this.ghost.get(m.id) ?? m.bounds;
      // Too small on screen to carry a mark without covering it.
      if (b.width * scale < 44 || b.height * scale < 28) continue;
      seen.add(m.id);
      let badge = this.badges.get(m.id);
      if (!badge) {
        badge = document.createElement("button");
        badge.dataset.target = "";
        badge.tabIndex = -1;
        badge.innerHTML =
          '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M5.5 3.5h7v7M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>';
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          const now = this.renderer.instances.get(badge!.dataset.module!)?.target;
          if (now) this.options.open(now);
        });
        this.badges.set(m.id, badge);
        this.targets.append(badge);
      }
      badge.dataset.module = m.id;
      const title =
        target.kind === "scene" ? work.scenes[target.id]?.title : work.details[target.id]?.title;
      const words =
        target.kind === "scene"
          ? english
            ? `Open ${title ? "“" + title + "”" : "the scene"}`
            : `进入${title ? "「" + title + "」" : "子场景"}`
          : english
            ? `Read ${title ? "“" + title + "”" : "more"}`
            : `查看${title ? "「" + title + "」" : "详情"}`;
      if (badge.lastElementChild!.textContent !== words) {
        badge.lastElementChild!.textContent = words;
        badge.setAttribute("aria-label", words);
      }
      badge.toggleAttribute("data-hot", this.hot === m.id);
      badge.style.left = x + (b.x + b.width) * scale + "px";
      badge.style.top = y + b.y * scale + "px";
    }
    for (const [id, badge] of this.badges)
      if (!seen.has(id)) {
        badge.remove();
        this.badges.delete(id);
      }
  }
  /** The module under the pointer that opens something, while not editing. */
  private hot: string | null = null;
  /** The selection following a right click or a long press onto what it lands on, unless
   * that is selected already. */
  private follow({ module: m, link }: { module?: Instance; link?: string }) {
    if (link && !m) {
      if (!this.linkSelection.includes(link)) this.select([], [link]);
    } else if (m && !this.selection.includes(m.id)) this.select(this.unitOf(m));
    else if (!m) this.select([]);
  }
  /** The hovered and the selected links traced over, and the ends of the one link
   * selected alone. */
  private paintLinks() {
    const { x, y, scale } = this.camera;
    const d = (id: string | null) => {
      const t = id && this.editing ? this.traceOf(id) : undefined;
      if (!t) return "";
      const at = (p: Point) => `${(x + p.x * scale).toFixed(1)} ${(y + p.y * scale).toFixed(1)}`;
      return [
        ...t.lines.map((l) => "M" + l.map(at).join("L")),
        ...t.boxes.map(
          (b) =>
            `M${at({ x: b.x, y: b.y })}H${(x + (b.x + b.width) * scale).toFixed(1)}V${(y + (b.y + b.height) * scale).toFixed(1)}H${(x + b.x * scale).toFixed(1)}Z`,
        ),
      ].join("");
    };
    const [hover, chosen] = this.linkMarks.querySelectorAll("path");
    const relinking = this.gesture?.kind === "relink";
    hover.setAttribute(
      "d",
      this.hoveredLink && !this.linkSelection.includes(this.hoveredLink) && !this.gesture
        ? d(this.hoveredLink)
        : "",
    );
    chosen.setAttribute("d", relinking ? "" : this.linkSelection.map(d).join(""));
    const only = this.onlyLink;
    const link = only && this.editing ? this.renderer.links.get(only) : undefined;
    for (const [end, handle] of this.ends) {
      if (!link || relinking || !this.movable) {
        handle.style.display = "none";
        continue;
      }
      const p = this.renderer.ends(link)[end];
      Object.assign(handle.style, {
        display: "grid",
        left: x + p.x * scale + "px",
        top: y + p.y * scale + "px",
      });
    }
  }
  /** The lines and words a link is drawn with, sampled in scene units, kept until it is
   * drawn again; failing those, the straight line between its ends. */
  private traceOf(id: string) {
    const link = this.renderer.links.get(id);
    if (!link) return undefined;
    const host = this.renderer.host("link", id);
    const drawn = host?.shadowRoot?.lastElementChild ?? null;
    const known = this.traces.get(id);
    if (known && known.drawn === drawn && known.renderer === this.renderer && drawn)
      return known;
    const lines: Point[][] = [],
      boxes: Bounds[] = [];
    const scene = (sx: number, sy: number) => this.toScene(sx, sy);
    if (drawn && host!.isConnected) {
      const shapes = drawn.matches("path,line,polyline,polygon,rect,circle,ellipse")
        ? [drawn]
        : [...drawn.querySelectorAll("path,line,polyline,polygon,rect,circle,ellipse")];
      for (const el of shapes) {
        if (
          !(el instanceof SVGGeometryElement) ||
          el.closest("defs,clipPath,mask,pattern,marker,symbol")
        )
          continue;
        try {
          const length = el.getTotalLength(),
            ctm = el.getScreenCTM();
          if (!ctm || !(length > 0)) continue;
          const n = Math.min(240, Math.max(2, Math.ceil(length / 4)));
          const line: Point[] = [];
          for (let i = 0; i <= n; i++) {
            const p = el.getPointAtLength((length * i) / n);
            const q = new DOMPoint(p.x, p.y).matrixTransform(ctm);
            line.push(scene(q.x, q.y));
          }
          lines.push(line);
        } catch {}
      }
      for (const words of drawn.querySelectorAll("text")) {
        const r = words.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const a = scene(r.left, r.top),
          b = scene(r.right, r.bottom);
        boxes.push({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
      }
    }
    if (!lines.length && !boxes.length) {
      const { from: a, to: b } = this.renderer.ends(link);
      lines.push([a, b]);
    }
    const trace = { drawn, renderer: this.renderer, lines, boxes };
    // A link still being drawn is traced again once it is.
    if (drawn) this.traces.set(id, trace);
    return trace;
  }
  /** The link drawn nearest a point on screen, if one passes within a few pixels of it,
   * other than `skip`. */
  private linkAt(clientX: number, clientY: number, skip?: string) {
    const p = this.toScene(clientX, clientY),
      slop = (this.touching ? FINGER_SLOP : SLOP) / this.camera.scale;
    let best: string | null = null,
      nearest = slop;
    for (const id of this.renderer.links.keys()) {
      if (id === skip) continue;
      const t = this.traceOf(id);
      if (!t) continue;
      for (const b of t.boxes)
        if (
          p.x >= b.x - slop / 2 &&
          p.x <= b.x + b.width + slop / 2 &&
          p.y >= b.y - slop / 2 &&
          p.y <= b.y + b.height + slop / 2
        )
          return id;
      for (const line of t.lines)
        for (let i = 1; i < line.length; i++) {
          const dist = distance(p, line[i - 1], line[i]);
          if (dist < nearest) {
            nearest = dist;
            best = id;
          }
        }
    }
    return best;
  }
  /** What a press at a point lands on while editing: a module that draws there, else a
   * link passing near, else the smallest module whose box holds it. */
  private pick(x: number, y: number): { module?: Instance; link?: string } {
    const link = this.editing ? this.linkAt(x, y) : null;
    const drawn = this.moduleAt(x, y, false);
    // A link is drawn over the backdrop, and runs between what a zone holds, so there the
    // link is what the press is on.
    if (drawn && !(link && (this.beneath(drawn) || this.holds(drawn.id))))
      return { module: drawn };
    if (link) return { link };
    const module = this.moduleAt(x, y);
    return module ? { module } : {};
  }
  /** Whether a module is drawn under the links: the scene's backdrop. */
  private beneath(m: Instance) {
    return Number(this.renderer.host("module", m.id)?.style.zIndex || 2) < 1;
  }
  /** Calls `fn` whenever the view, the selection or what is dragged changes, for controls
   * laid over the canvas. Returns what stops it. */
  watch(fn: () => void) {
    this.watchers.add(fn);
    return () => void this.watchers.delete(fn);
  }
  /** Whether something is being dragged on the canvas now. */
  get dragging() {
    return !!this.gesture && this.gesture.kind !== "press" && this.gesture.moved;
  }
  /** The points a link is drawn through, with the corners of its words, in scene units. */
  private pointsOf(id: string): Point[] {
    const t = this.traceOf(id);
    return t
      ? [...t.lines.flat(), ...t.boxes.flatMap((b) => [b, { x: b.x + b.width, y: b.y + b.height }])]
      : [];
  }
  /** Where the selection is on screen: the box around the selected modules and the lines
   * of the selected links. */
  selectionRect(): DOMRect | undefined {
    const r = this.element.getBoundingClientRect();
    const boxes = this.selection.flatMap((id) => {
      const m = this.renderer.instances.get(id);
      return m ? [this.ghost.get(id) ?? m.bounds] : [];
    });
    const points = this.linkSelection.flatMap((id) => this.pointsOf(id));
    if (points.length) {
      const xs = points.map((p) => p.x),
        ys = points.map((p) => p.y);
      boxes.push({
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      });
    }
    const on = boxes.length ? this.shown(union(boxes)) : undefined;
    return on && new DOMRect(r.left + on.x, r.top + on.y, on.width, on.height);
  }
  private changed() {
    cancelAnimationFrame(this.gliding);
    this.automatic = false;
    this.options.cameraChanged?.({ ...this.camera });
    this.paint();
  }
  get view() {
    return { ...this.camera };
  }
  focus(bounds: Bounds, maxScale = 1.5) {
    this.camera = fit(
      bounds,
      this.element.clientWidth,
      this.element.clientHeight,
      maxScale,
    );
    this.changed();
  }
  /** The view filled edge to edge with these bounds, no paper around them: a picture to
   * keep is the drawing itself. Where the view's shape differs by a rounding pixel, the
   * drawing covers it rather than leaving a hairline of paper. */
  crop(bounds: Bounds) {
    const scale = Math.max(
      this.element.clientWidth / bounds.width,
      this.element.clientHeight / bounds.height,
    );
    this.camera = { scale, x: -bounds.x * scale, y: -bounds.y * scale };
    this.changed();
  }
  /** The room kept clear above and below the view for the controls laid over it, never
   * more than half the canvas's height: on a phone on its side the controls can be taller
   * than the room left, and the drawing then shows under them rather than shrinking to a
   * dot. */
  private clear() {
    const { top, bottom, left = 0, right = 0 } = this.options.insets?.() || { top: 0, bottom: 80 };
    const most = this.element.clientHeight * 0.5,
      both = Math.max(0, top) + Math.max(0, bottom);
    const keep = both > most ? most / both : 1;
    // The sides give way sooner: on a narrow canvas the drawing matters more than the tools.
    const wide = left + right < this.element.clientWidth * 0.25;
    return {
      top: Math.max(0, top) * keep,
      bottom: Math.max(0, bottom) * keep,
      left: wide ? Math.max(0, left) : 0,
      right: wide ? Math.max(0, right) : 0,
    };
  }
  /** The controls over the canvas changed size (a reply put away, the composer grown): an
   * automatic view takes the room they leave or need. */
  refit() {
    if (this.automatic) this.fit(true, 520);
  }
  /** The drawing as a whole: its modules, its links, and the sketches of those on the way. */
  private extent() {
    return union([
      ...[...this.renderer.instances.values()].map((m) => m.bounds),
      ...this.renderer.linkBoxes(),
      ...[...this.sketches.values()].map((s) => s.bounds),
    ]);
  }
  /** Takes the automatic view, which follows the drawing as it changes: filling the screen
   * as far as `fill` allows, or, framed `"whole"`, all of it. */
  fit(glide = true, duration = 1100, framing?: "fill" | "whole") {
    this.automatic = true;
    if (framing) this.framing = framing;
    const { top, bottom, left, right } = this.clear(),
      width = this.element.clientWidth - left - right,
      height = this.element.clientHeight - top - bottom;
    const bounds = this.extent();
    const target = fit(bounds, width, height);
    const most = this.framing === "fill" ? (this.options.fill ?? 1) : 1;
    if (most > 1 && bounds.width && bounds.height) {
      // Filled: the drawing's shorter way across fits the screen and the longer runs off
      // it, from where reading starts (its left, its top), never more than `fill` times
      // the whole. The way it runs off is kept centred where it still fits.
      const scale = Math.min(
        Math.max((width - 32) / bounds.width, (height - 32) / bounds.height),
        target.scale * most,
        1.5,
      );
      if (scale > target.scale) {
        const across = (start: number, size: number, room: number) =>
          size * scale > room - 32 ? 16 - start * scale : room / 2 - (start + size / 2) * scale;
        target.scale = scale;
        target.x = across(bounds.x, bounds.width, width);
        target.y = across(bounds.y, bounds.height, height);
      }
    }
    target.y += top;
    target.x += left;
    // A view already all but there stays put: a glide of a few pixels reads as drifting.
    // It is still painted, so a drawing just swapped in takes the view it stays at.
    const near =
      Math.abs(target.scale / this.camera.scale - 1) < 0.03 &&
      Math.abs(target.x - this.camera.x) < 14 &&
      Math.abs(target.y - this.camera.y) < 14;
    if (glide && near) {
      this.paint();
      return;
    }
    cancelAnimationFrame(this.gliding);
    if (!glide || !this.options.motion) {
      this.camera = target;
      this.paint();
      return;
    }
    // Glide around the view's centre in world space, zooming at an even pace.
    const from = { ...this.camera },
      w = left + width / 2,
      h = top + height / 2,
      a = { x: (w - from.x) / from.scale, y: (h - from.y) / from.scale },
      b = {
        x: (w - target.x) / target.scale,
        y: (h - target.y) / target.scale,
      },
      start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration),
        e = 1 - (1 - t) ** 4,
        scale = from.scale * (target.scale / from.scale) ** e;
      this.camera = {
        scale,
        x: w - (a.x + (b.x - a.x) * e) * scale,
        y: h - (a.y + (b.y - a.y) * e) * scale,
      };
      this.paint();
      if (t < 1) this.gliding = requestAnimationFrame(tick);
    };
    this.gliding = requestAnimationFrame(tick);
  }
  zoom(factor: number) {
    this.camera = zoom(
      this.camera,
      { x: this.element.clientWidth / 2, y: this.element.clientHeight / 2 },
      factor,
    );
    this.changed();
  }
  /** Shows the drawing at a scale (1 is a screen pixel to a scene unit), about the middle
   * of the view. */
  zoomTo(scale: number) {
    this.zoom(scale / this.camera.scale);
  }
  /** Brings what is selected into view, as large as fits; without a selection, the whole
   * drawing. */
  frameSelection() {
    const boxes = this.selection.flatMap((id) => {
      const m = this.renderer.instances.get(id);
      return m ? [m.bounds] : [];
    });
    if (!boxes.length) return this.fit(true, 520, "whole");
    const b = union(boxes),
      pad = Math.max(b.width, b.height) * 0.25 + 40;
    this.focus({ x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 }, 2);
  }
  /** Brings modules into view where they are not, clear of what is laid over the canvas:
   * the view moves the least that shows them whole (or, larger than the view, from their
   * top left), at the scale it has. */
  reveal(ids: string[]) {
    const boxes = ids.flatMap((id) => {
      const m = this.renderer.instances.get(id);
      return m ? [m.bounds] : [];
    });
    if (!boxes.length) return;
    const b = union(boxes),
      { top, bottom, left, right } = this.clear(),
      { x, y, scale } = this.camera,
      pad = 28;
    const shift = (start: number, size: number, from: number, to: number) => {
      const lo = from + pad,
        hi = to - pad;
      if (start >= lo && start + size <= hi) return 0;
      return start < lo || size > hi - lo ? lo - start : hi - start - size;
    };
    const on = this.shown(b);
    const dx = shift(on.x, on.width, left, this.element.clientWidth - right),
      dy = shift(on.y, on.height, top, this.element.clientHeight - bottom);
    if (!dx && !dy) return;
    const target = { scale, x: x + dx, y: y + dy };
    cancelAnimationFrame(this.gliding);
    this.automatic = false;
    if (!this.options.motion) {
      this.camera = target;
      return this.changed();
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 320),
        e = 1 - (1 - t) ** 3;
      this.camera = { scale, x: x + dx * e, y: y + dy * e };
      this.paint();
      if (t < 1) this.gliding = requestAnimationFrame(tick);
      else this.options.cameraChanged?.({ ...this.camera });
    };
    this.gliding = requestAnimationFrame(tick);
  }
  /** What a dragged box snaps to while editing: its neighbours (their edges, centres and
   * equal gaps), and the lines of a grid this many scene units apart (0 for none). */
  setSnap(snapping: { guides: boolean; grid: number }) {
    this.snapping = { ...snapping };
  }
  setMovable(value: boolean) {
    this.movable = value;
    this.paint();
  }
  setEditing(value: boolean) {
    this.editing = value;
    this.element.toggleAttribute("data-editing", value);
    if (!value) {
      this.hovered = null;
      this.tool = "select";
    }
    this.cursor();
    this.paint();
  }
  /** What a press does while editing: select and move, move the view, draw the box of
   * something new, or draw a link between two modules. */
  setTool(tool: CanvasTool) {
    this.tool = tool;
    if (tool !== "select") this.hoverOver(null);
    this.cursor();
    this.paint();
  }
  private cursor() {
    this.element.style.cursor = !this.editing
      ? ""
      : this.spacing || this.tool === "hand"
        ? this.gesture?.kind === "pan"
          ? "grabbing"
          : "grab"
        : this.tool === "draw" || this.tool === "pen" || this.tool === "arrow"
          ? "crosshair"
          : this.tool === "erase"
            ? ERASER
            : "";
    this.element.toggleAttribute(
      "data-panning",
      this.editing && (this.spacing || this.tool !== "select"),
    );
  }
  /** Selects everything in the scene: its modules, and while editing its links. */
  selectAll() {
    this.select(
      [...this.renderer.instances.keys()],
      this.editing ? [...this.renderer.links.keys()] : [],
    );
  }
  get selected() {
    return [...this.selection];
  }
  get selectedLinks() {
    return [...this.linkSelection];
  }
  /** What is selected now: the modules and the links. */
  picked() {
    return { modules: [...this.selection], links: [...this.linkSelection] };
  }
  /** Selects modules, and links with them or alone; nothing, given none. */
  select(ids: string[], links: string[] = []) {
    this.selection = [...new Set(ids)].filter((id) => this.renderer.instances.has(id));
    this.linkSelection = [...new Set(links)].filter((id) => this.renderer.links.has(id));
    if (this.chosenPart && (this.selection.length !== 1 || this.selection[0] !== this.chosenPart.moduleId || this.linkSelection.length))
      this.setPart(null);
    this.options.select(
      this.selection.map((id) => {
        const m = this.renderer.instances.get(id)!;
        return { moduleId: m.id, label: shownName(this.renderer.work, m), data: m.data };
      }),
      [...this.linkSelection],
    );
    this.paint();
  }
  /** The part selected inside the one module selected. */
  get selectedPart() {
    return this.chosenPart ? { ...this.chosenPart } : null;
  }
  /** Selects a part of a module (and the module alone with it), or no part. */
  selectPart(part: PartPick | null) {
    if (part && (this.selection.length !== 1 || this.selection[0] !== part.moduleId)) this.select([part.moduleId]);
    this.setPart(part);
    this.paint();
  }
  private setPart(part: PartPick | null, more: string[] = []) {
    this.moreParts = part ? more.filter((p) => p !== part.path) : [];
    if (this.chosenPart?.moduleId === part?.moduleId && this.chosenPart?.path === part?.path) return;
    this.chosenPart = part;
    this.options.part?.(part ? { ...part } : null);
  }
  /** The marks of what can be edited inside the module selected: the handles of the parts
   * selected, or of the module itself, and the "+" of the place for a new item nearest the
   * pointer. */
  private paintEditMarks() {
    const { x, y, scale } = this.camera;
    const on = (p: Point) => ({ left: x + p.x * scale + "px", top: y + p.y * scale + "px" });
    const handles = this.gesture ? [] : (this.shownHandles()?.handles ?? []);
    while (this.handleMarks.length < handles.length) {
      const mark = control(
        { editHandle: String(this.handleMarks.length) },
        fingers() ? 44 : 18,
        `width:11px;height:11px;border-radius:50%;background:#fff;border:2px solid ${ACCENT};box-shadow:0 1px 3px rgba(0,0,0,.2)`,
        /^en/i.test(document.documentElement.lang) ? "Drag to change" : "拖动来改",
      ) as HTMLButtonElement;
      mark.style.zIndex = "5";
      mark.style.cursor = "grab";
      this.element.append(mark);
      this.handleMarks.push(mark);
    }
    this.handleMarks.forEach((mark, i) => {
      const h = handles[i];
      mark.style.display = h ? "grid" : "none";
      if (h) Object.assign(mark.style, on(h.at));
    });
    const slot = this.slotMark!;
    const near = this.nearSlot;
    slot.style.display = near && this.editing && !this.gesture && this.tool === "select" ? "grid" : "none";
    if (near) Object.assign(slot.style, on(near.at));
  }
  /** The handles marked, in order: those of the parts selected, or with only the module
   * selected while editing, those of its own values (a gauge's reading, a now line) that
   * belong to no part. */
  private shownHandles() {
    const moduleId = this.chosenPart?.moduleId ?? (this.editing && this.selection.length === 1 ? this.selection[0] : undefined);
    const m = moduleId && this.editing ? this.renderer.editMap(moduleId) : undefined;
    if (!moduleId || !m) return undefined;
    const paths = this.chosenPart ? this.selectedParts.map((p) => p.path) : undefined;
    // A part's handles are its own (a place on a chart moving the whole item) and its values'.
    const under = (h: { path: string }, p: string) => h.path === p || h.path.startsWith(p + ".");
    const handles = m.handles.filter((h) => (paths ? paths.some((p) => under(h, p)) : !m.parts.some((q) => under(h, q.path))));
    return { moduleId, handles };
  }
  /** A module's data as its drawing draws it: its own over the drawing's defaults. */
  private drawnData(m: Instance) {
    return { ...(drawingOf(this.renderer.work, m.drawingId)?.defaults ?? {}), ...m.data };
  }
  /** The smallest region an item declared as what can be referred to, under a point. */
  private anchorAt(map: EditMap, clientX: number, clientY: number, list?: string) {
    const p = this.toScene(clientX, clientY);
    return map.anchors
      .filter((a) => (!list || a.list === list) && p.x >= a.box.x && p.x <= a.box.x + a.box.width && p.y >= a.box.y && p.y <= a.box.y + a.box.height)
      .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
  }
  /** The list a reference field of a list's items refers into, by the module's schema. */
  private refersTo(m: Instance, list: string, field: string) {
    const f = fieldAt(drawingOf(this.renderer.work, m.drawingId)?.params ?? {}, `${list}.0.${field}`);
    return f?.type === "ref" ? f.to : undefined;
  }
  /** The places for new items of a list a module offers, along an axis. */
  private nearestSlot(map: EditMap, list: string, p: Point, axis: "x" | "y") {
    return map.slots
      .filter((s) => s.list === list)
      .sort((a, b) => Math.abs(a.at[axis] - p[axis]) - Math.abs(b.at[axis] - p[axis]))[0];
  }
  /** The parts selected inside the one module selected, the first first. */
  get selectedParts(): PartPick[] {
    return this.chosenPart ? [this.chosenPart, ...this.moreParts.map((path) => ({ moduleId: this.chosenPart!.moduleId, path }))] : [];
  }
  /** Marked words of a module under a path, as a double click on them points at them: what
   * a new item is typed into once it is drawn. */
  wordsAt(moduleId: string, path: string): Extract<Pointed, { kind: "text" }> | undefined {
    const root = this.renderer.host("module", moduleId)?.shadowRoot;
    const marked = [...(root?.querySelectorAll("[data-edp-text]") ?? [])].find((el) => {
      const at = el.getAttribute("data-edp-text")!;
      return at === path || at.startsWith(path + ".");
    });
    if (!marked) return undefined;
    return { kind: "text", moduleId, text: marked.textContent?.trim() ?? "", path: marked.getAttribute("data-edp-text")!, place: () => placeOf(marked) };
  }
  /** What a module offers to edit, measured where it is drawn now. */
  editMap(moduleId: string) {
    return this.renderer.editMap(moduleId);
  }
  /** Words of a module's data its drawing shows without marking them as that data. */
  unmarked(moduleId: string) {
    return this.renderer.unmarked(moduleId);
  }
  /** Whether parts of modules can be selected now. */
  private get partsOn() {
    return !!this.options.part && (this.editing || this.options.parts === "always");
  }
  /** The smallest part of a module's drawing under a point on screen. */
  private partAt(m: Instance, clientX: number, clientY: number): PartPick | null {
    const map = this.renderer.editMap(m.id);
    if (!map) return null;
    const p = this.toScene(clientX, clientY),
      slop = (this.touching ? FINGER_SLOP / 2 : 2) / this.camera.scale;
    const under = map.parts
      .filter(({ box: b }) => p.x >= b.x - slop && p.x <= b.x + b.width + slop && p.y >= b.y - slop && p.y <= b.y + b.height + slop)
      .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
    return under ? { moduleId: m.id, path: under.path } : null;
  }
  /** The one link selected, alone: its ends can be dragged elsewhere. */
  private get onlyLink() {
    return this.linkSelection.length === 1 && !this.selection.length
      ? this.linkSelection[0]
      : null;
  }
  /** The scene's modules in stacking order, where they are now. */
  private stack() {
    return this.renderer.scene.modules.flatMap((m) => {
      const v = this.renderer.instances.get(m.id);
      return v ? [{ id: v.id, bounds: this.ghost.get(v.id) ?? v.bounds }] : [];
    });
  }
  /** Whether a module holds others drawn over it, as a zone holds the steps in it. */
  private holds(id: string) {
    return carried(this.stack(), [id]).length > 0;
  }
  /** The members of a group. */
  private mates(group: string) {
    return [...this.renderer.instances.values()]
      .filter((v) => v.group === group)
      .map((v) => v.id);
  }
  /** What a press on a module selects while editing: its whole group, unless the
   * selection is already inside that group, or Cmd or Ctrl reaches in (`deep`): then the
   * module alone. */
  private unitOf(m: Instance, deep = false) {
    if (!this.editing || !m.group || deep) return [m.id];
    const mates = this.mates(m.group);
    const inside =
      this.selection.length > 0 &&
      this.selection.length < mates.length &&
      this.selection.every((id) => mates.includes(id));
    return inside ? [m.id] : mates;
  }
  /** Whether the whole drawing is in view, clear of the controls laid over it. */
  showsWhole() {
    if (!this.renderer.instances.size && !this.sketches.size) return true;
    const b = this.extent();
    if (!(b.width > 0 && b.height > 0)) return true;
    const { top, bottom } = this.clear();
    const on = this.shown(b),
      slack = 4;
    return (
      on.x >= -slack &&
      on.y >= top - slack &&
      on.x + on.width <= this.element.clientWidth + slack &&
      on.y + on.height <= this.element.clientHeight - bottom + slack
    );
  }
  /** The middle of the view, in scene units, clear of the controls laid over it. */
  center() {
    const { top, bottom, left, right } = this.clear();
    const { x, y, scale } = this.camera;
    return {
      x: (left + (this.element.clientWidth - left - right) / 2 - x) / scale,
      y: (top + (this.element.clientHeight - top - bottom) / 2 - y) / scale,
    };
  }
  /** How many screen pixels a scene unit takes now. */
  get scale() {
    return this.camera.scale;
  }
  /** Shows a module or a link with other data while a change to it is being made. */
  preview(id: string, data: Record<string, unknown>) {
    void this.renderer.redraw(id, data).then(() => this.paint());
  }
  /** Shows modules at other places and sizes, as they are typed or scrubbed in, until
   * the change is committed. */
  reshape(moves: { id: string; bounds: Bounds }[]) {
    this.drag(moves, false);
    this.paint();
  }
  /** Moves modules, with what they hold, by a distance in scene units, until the move is
   * committed. */
  nudge(ids: string[], dx: number, dy: number) {
    const moves = [...ids, ...carried(this.stack(), ids)].flatMap((id) => {
      const m = this.renderer.instances.get(id);
      return m
        ? [{ id, bounds: { ...m.bounds, x: m.bounds.x + dx, y: m.bounds.y + dy } }]
        : [];
    });
    void this.renderer.move(moves);
    this.paint();
    return moves;
  }
  /** The module drawn at a point: the topmost whose drawing paints there, or failing
   * that the smallest whose box holds the point, so a large module laid over others does
   * not hide them where it draws nothing. */
  private moduleAt(x: number, y: number, loose = true) {
    const hosts = document
      .elementsFromPoint(x, y)
      .filter(
        (n): n is HTMLElement =>
          n instanceof HTMLElement &&
          !!n.dataset.moduleId &&
          this.renderer.element.contains(n),
      );
    const of = (host: HTMLElement) =>
      this.renderer.instances.get(host.dataset.moduleId!);
    for (const host of hosts) {
      const root = host.shadowRoot!,
        drawn = root.lastElementChild;
      const el = root.elementsFromPoint(x, y).find((n) => root.contains(n));
      if (!el) continue;
      if (el !== drawn) return of(host);
      // The drawing's own frame paints only where it has a background.
      const look = getComputedStyle(el);
      if (
        el instanceof HTMLElement &&
        (look.backgroundColor !== "rgba(0, 0, 0, 0)" ||
          look.backgroundImage !== "none")
      )
        return of(host);
    }
    if (!loose) return undefined;
    const area = (b: Bounds) => b.width * b.height;
    return hosts
      .flatMap((h) => of(h) ?? [])
      .sort((a, b) => area(a.bounds) - area(b.bounds))[0];
  }
  /** Which side of the one selected module the pointer is nearest, when it is on the
   * module or close by: that side's dot shows. */
  private nearSide(e: PointerEvent) {
    const one =
      this.selection.length === 1 ? this.renderer.instances.get(this.selection[0]) : undefined;
    let near: Side | null = null;
    const on = (e.target as Element | null)?.closest?.<HTMLElement>("[data-connect]");
    if (on) near = on.dataset.connect as Side;
    else if (one && this.options.connect) {
      const p = this.toScene(e.clientX, e.clientY),
        b = one.bounds,
        reach = 44 / this.camera.scale,
        out = 22 / this.camera.scale;
      if (
        p.x > b.x - reach &&
        p.x < b.x + b.width + reach &&
        p.y > b.y - reach &&
        p.y < b.y + b.height + reach
      ) {
        let best = Infinity;
        for (const side of sides) {
          const a = sidePoint[side];
          const d = Math.hypot(
            b.x + a.x * b.width + (a.x - 0.5) * 2 * out - p.x,
            b.y + a.y * b.height + (a.y - 0.5) * 2 * out - p.y,
          );
          if (d < best) (best = d), (near = side);
        }
      }
    }
    if (near === this.near) return;
    this.near = near;
    this.paint();
  }
  /** The place for a new item nearest the pointer, in the module selected alone. */
  private hoverSlot(clientX: number, clientY: number) {
    const map = this.editing && this.partsOn && this.selection.length === 1 ? this.renderer.editMap(this.selection[0]) : undefined;
    const p = this.toScene(clientX, clientY),
      reach = 16 / this.camera.scale;
    const near = map?.slots
      .map((s) => ({ s, d: Math.hypot(s.at.x - p.x, s.at.y - p.y) }))
      .filter((x) => x.d <= reach)
      .sort((a, b) => a.d - b.d)[0]?.s ?? null;
    if (near?.list === this.nearSlot?.list && near?.index === this.nearSlot?.index) return;
    this.nearSlot = near;
    this.paintEditMarks();
  }
  private hoverPart(part: PartPick | null) {
    if (this.hoveredPart?.path === part?.path && this.hoveredPart?.moduleId === part?.moduleId) return;
    this.hoveredPart = part;
    this.paint();
  }
  private hoverOver(id: string | null, link: string | null = null) {
    if (this.hovered === id && this.hoveredLink === link) return;
    this.hovered = id;
    this.hoveredLink = link;
    this.paint();
  }
  /** The words or picture under a double click, and the module they belong to. The press
   * before it held the pointer, so the click lands on the canvas; what is under it is
   * found by where it is. */
  private dblclick(e: MouseEvent) {
    const picked = this.pick(e.clientX, e.clientY);
    if (picked.link) return this.retypeLink(e, picked.link);
    // A double click on the paper while editing puts words there.
    if (!picked.module && this.editing && this.tool === "select" && this.options.place) {
      e.preventDefault();
      return this.options.place(this.toScene(e.clientX, e.clientY));
    }
    const moduleId = picked.module?.id;
    const root = moduleId && this.renderer.host("module", moduleId)?.shadowRoot;
    const inner =
      root &&
      root.elementsFromPoint(e.clientX, e.clientY).find((n) => root.contains(n));
    if (!moduleId || !inner || !this.options.point) return;
    const pictures = Object.values(this.renderer.work.materials).filter(
      (m) => m.kind === "picture",
    );
    const frame = inner.closest<HTMLElement>("[data-material]");
    const href =
      inner instanceof SVGImageElement
        ? inner.href.baseVal
        : inner instanceof HTMLImageElement
          ? inner.src
          : "";
    const named =
      frame?.dataset.material ??
      (href &&
        pictures.find((p) => new URL(href, location.href).pathname === new URL(p.url, location.href).pathname)
          ?.id);
    if (named) {
      e.preventDefault();
      return this.options.point({ kind: "picture", moduleId, material: named });
    }
    // An SVG line of text, or the nearest element holding words of its own.
    const own = (el: Element) =>
      [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim();
    // Words the drawing marked as a value of its data change that value, wherever they are.
    const marked = inner.closest("[data-edp-text]");
    if (marked) {
      e.preventDefault();
      getSelection()?.removeAllRanges();
      const path = marked.getAttribute("data-edp-text")!;
      const part = this.partsOn && this.partAt(picked.module!, e.clientX, e.clientY);
      if (part) this.selectPart(part);
      return this.options.point({ kind: "text", moduleId, path, text: marked.textContent?.trim() ?? "", place: () => placeOf(marked) });
    }
    let el: Element | null = inner.closest("tspan,text");
    if (!el) {
      el = inner;
      while (el && !own(el)) el = el.parentElement;
    }
    const text = el && (el.closest("text,tspan") ? el.textContent!.trim() : own(el));
    if (!el || !text) {
      // A fingertip covers more than the words it means: a finger's double tap anywhere on
      // a module changes its first words.
      const words = this.touching ? this.wordsIn(moduleId, { x: e.clientX, y: e.clientY }) : undefined;
      if (words) this.options.point(words);
      return;
    }
    e.preventDefault();
    getSelection()?.removeAllRanges();
    const words = el;
    this.options.point({
      kind: "text",
      moduleId,
      text,
      place: () => placeOf(words),
    });
  }
  /** The words of a module a person means, to change where they are as a double click on
   * them would: those under `at` (by default where the canvas was last pressed, which is
   * where the module was selected), or nearest to it within a fingertip; else its most
   * prominent words, the largest and longest, rather than the first it draws, which is
   * often a number or a badge. */
  wordsIn(
    moduleId: string,
    at: { x: number; y: number } | undefined = this.pressedAt,
  ): Extract<Pointed, { kind: "text" }> | undefined {
    const root = this.renderer.host("module", moduleId)?.shadowRoot;
    if (!root) return undefined;
    const found: { words: Element; text: string; rect: DOMRect; size: number; path?: string }[] = [];
    const seen = new Set<Element>();
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode,
        parent = node.parentElement;
      const own = node.textContent?.trim();
      if (!own || !parent || parent.closest("style,script,defs")) continue;
      const marked = parent.closest("[data-edp-text]");
      const words = marked ?? parent.closest("text") ?? parent;
      if (seen.has(words)) continue;
      seen.add(words);
      const { rect, size } = placeOf(words);
      if (!rect.width || !rect.height) continue;
      found.push({
        words,
        text: marked || words instanceof SVGElement ? words.textContent!.trim() : own,
        rect,
        size,
        ...(marked ? { path: marked.getAttribute("data-edp-text")! } : {}),
      });
    }
    // With a part of the module selected, its words are the ones meant.
    const part = this.chosenPart?.moduleId === moduleId ? this.chosenPart.path : undefined;
    const inPart = part ? found.filter((f) => f.path === part || f.path?.startsWith(part + ".")) : [];
    if (inPart.length) {
      const { words, text, path } = inPart[0];
      return { kind: "text", moduleId, text, path, place: () => placeOf(words) };
    }
    if (!found.length) return undefined;
    const away = (r: DOMRect) =>
      at
        ? Math.hypot(Math.max(r.left - at.x, 0, at.x - r.right), Math.max(r.top - at.y, 0, at.y - r.bottom))
        : Infinity;
    const reach = this.touching ? FINGER_SLOP : 4;
    const near = at && found.filter((f) => away(f.rect) <= reach).sort((a, b) => away(a.rect) - away(b.rect))[0];
    const chosen =
      near ??
      found.reduce((best, f) =>
        f.size * Math.min(f.text.length, 12) > best.size * Math.min(best.text.length, 12) ? f : best,
      );
    const { words, text, path } = chosen;
    return {
      kind: "text",
      moduleId,
      text,
      ...(path ? { path } : {}),
      place: () => placeOf(words),
    };
  }
  /** Words of a link double-clicked while editing, to change where they are. */
  private retypeLink(e: MouseEvent, linkId: string) {
    const root = this.renderer.host("link", linkId)?.shadowRoot;
    const words = [...(root?.querySelectorAll("text") ?? [])].find((el) => {
      const r = el.getBoundingClientRect();
      return (
        e.clientX >= r.left - 3 &&
        e.clientX <= r.right + 3 &&
        e.clientY >= r.top - 3 &&
        e.clientY <= r.bottom + 3
      );
    });
    const text = words?.textContent?.trim();
    if (!this.options.point) return;
    // A link that says nothing yet is given words where it was pressed.
    if (!words || !text) {
      if (!this.editing) return;
      e.preventDefault();
      const rect = new DOMRect(e.clientX - 30, e.clientY - 9, 60, 18);
      return this.options.point({
        kind: "text",
        moduleId: linkId,
        link: true,
        text: "",
        place: () => ({ rect, size: 14 }),
      });
    }
    e.preventDefault();
    getSelection()?.removeAllRanges();
    this.options.point({
      kind: "text",
      moduleId: linkId,
      link: true,
      text,
      place: () => placeOf(words),
    });
  }
  private interactive(e: Event) {
    return e
      .composedPath()
      .some(
        (n) =>
          n instanceof Element &&
          !(n instanceof HTMLElement && "canvasControl" in n.dataset) &&
          n.matches("button,input,select,textarea,a,[data-interactive]"),
      );
  }
  private wheel(e: WheelEvent) {
    if (!this.editing && this.interactive(e)) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.camera = zoom(this.camera, this.local(e.clientX, e.clientY), Math.exp(-e.deltaY * 0.008));
    } else {
      this.camera.x -= e.deltaX;
      this.camera.y -= e.deltaY;
    }
    this.changed();
  }
  /** A box of the scene as it shows now, measured from the canvas's corner. */
  private shown(b: Bounds): Bounds {
    const { x, y, scale } = this.camera;
    return { x: x + b.x * scale, y: y + b.y * scale, width: b.width * scale, height: b.height * scale };
  }
  /** A point on screen measured from the canvas's corner. */
  private local(clientX: number, clientY: number): Point {
    const r = this.element.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  /** A point on screen in scene units. */
  private toScene(clientX: number, clientY: number): Point {
    const p = this.local(clientX, clientY),
      { x, y, scale } = this.camera;
    return { x: (p.x - x) / scale, y: (p.y - y) / scale };
  }
  private down(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    const touch = e.pointerType === "touch";
    this.touching = touch;
    this.pressedAt = { x: e.clientX, y: e.clientY };
    if (touch) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A second finger turns whatever the first began into pinching the view, wherever
      // it lands.
      if (this.touches.size === 2) return this.pinch(e);
      if (this.touches.size > 2) return;
    }
    if (!this.editing && this.interactive(e)) return;
    // While editing, a press on the canvas leaves any field in the panel, which keeps it.
    if (this.editing) this.element.focus({ preventScroll: true });
    const start = { x: e.clientX, y: e.clientY, moved: false, pointer: e.pointerId, touch };
    if (touch) this.holdFrom(e);
    const target = e.target as HTMLElement;
    const capture = () => {
      this.element.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    // The middle button, the hand tool and the space bar move the view.
    if (
      e.button === 1 ||
      (this.editing && (this.spacing || this.tool === "hand"))
    ) {
      this.gesture = { ...start, kind: "pan", camera: { ...this.camera } };
      this.cursor();
      return capture();
    }
    // The drawing tool draws the box of something new, or places it at a press.
    if (this.editing && this.tool === "draw") {
      this.gesture = { ...start, kind: "draw", start: this.toScene(e.clientX, e.clientY) };
      return capture();
    }
    // The pen draws where it goes; the arrow tool a straight line from the press, which is
    // a link when either end binds to a module or another link.
    if (this.editing && (this.tool === "pen" || this.tool === "arrow")) {
      const straight = this.tool === "arrow";
      this.gesture = {
        ...start,
        kind: "ink",
        points: [this.toScene(e.clientX, e.clientY)],
        straight,
        from: straight ? this.bindingAt(e.clientX, e.clientY) : undefined,
      };
      this.paintInk();
      return capture();
    }
    // The eraser takes out whatever it goes over, once it is lifted.
    if (this.editing && this.tool === "erase") {
      this.gesture = { ...start, kind: "erase", hit: new Set(), last: { x: e.clientX, y: e.clientY } };
      this.rub(e.clientX, e.clientY);
      return capture();
    }
    const chosen = () =>
      this.selection.flatMap((id) => {
        const m = this.renderer.instances.get(id);
        return m ? [m] : [];
      });
    const others = (moving: Set<string>) =>
      [...this.renderer.instances.values()]
        .filter((m) => !moving.has(m.id))
        .map((m) => ({ ...m.bounds }));
    const control = target.closest?.<HTMLElement>("[data-canvas-control]");
    // A handle on the selection's box resizes the selection as one.
    const handle = control?.dataset.handle as Handle | undefined;
    if (handle && this.movable) {
      const parts = chosen();
      this.gesture = {
        ...start,
        kind: "resize",
        handle,
        frame: union(parts.map((m) => m.bounds)),
        moves: parts.map((m) => ({ id: m.id, bounds: { ...m.bounds } })),
        others: others(new Set(parts.map((m) => m.id))),
      };
      return capture();
    }
    // A dot on a side of the selected module draws a link from there.
    const side = control?.dataset.connect as Side | undefined;
    if (side && this.selection.length === 1) {
      this.gesture = {
        ...start,
        kind: "connect",
        from: { moduleId: this.selection[0], side },
      };
      return capture();
    }
    // The "+" of a place for a new item puts one in there.
    if (control?.dataset.slot !== undefined && this.nearSlot && this.selection.length === 1) {
      this.options.insert?.({ moduleId: this.selection[0], list: this.nearSlot.list, index: this.nearSlot.index });
      this.gesture = { ...start, kind: "press" };
      return capture();
    }
    // A handle of a part selected, or of the module, is dragged: onto what it can refer to, or along.
    const editHandle = control?.dataset.editHandle;
    const shown = editHandle !== undefined ? this.shownHandles() : undefined;
    if (shown) {
      const h = shown.handles[Number(editHandle)];
      const m = this.renderer.instances.get(shown.moduleId);
      if (h && m) {
        this.gesture = { ...start, kind: "handle", moduleId: m.id, handle: h, data: this.drawnData(m), was: m.data };
        return capture();
      }
    }
    // An end of the one link selected is dragged onto another module, or another side.
    const end = control?.dataset.linkEnd as "from" | "to" | undefined;
    const only = this.onlyLink;
    if (end && only) {
      this.gesture = { ...start, kind: "relink", linkId: only, end };
      this.paint();
      return capture();
    }
    const { module: m, link } = this.pick(e.clientX, e.clientY);
    const selection = this.selection,
      links = this.linkSelection;
    // A press on a link while editing selects it; with Shift it joins the selection or
    // leaves it.
    if (link && this.editing && !m) {
      if (!e.shiftKey) this.select([], [link]);
      else if (links.includes(link)) this.select(selection, links.filter((id) => id !== link));
      else this.select(selection, [...links, link]);
      this.gesture = { ...start, kind: "press" };
      return capture();
    }
    // While editing, dragging over the paper with a mouse draws a box that selects what it
    // holds; so does dragging over a zone that holds others and is not selected, which a
    // press without a drag selects. A finger on the paper moves the view instead.
    const zone = !!m && !selection.includes(m.id) && this.editing && this.holds(m.id);
    if (this.editing && !touch && (!m || zone)) {
      if (!m && !e.shiftKey) this.select([]);
      this.gesture = {
        ...start,
        kind: "marquee",
        start: this.toScene(e.clientX, e.clientY),
        base: e.shiftKey ? { modules: [...this.selection], links: [...this.linkSelection] } : { modules: [], links: [] },
        picked: "",
        on: zone ? m.id : undefined,
      };
      return capture();
    }
    // Pressing a module selects it, and while editing its group with it (a second press,
    // or Cmd or Ctrl, reaches a module inside a group); dragging one already selected
    // moves the selection, and dragging anything else moves the view. While editing any
    // module pressed can be dragged at once, and Shift adds a module (or its group) to
    // the selection or takes it out.
    const deep = this.editing && (e.metaKey || e.ctrlKey);
    const was = !!m && selection.includes(m.id);
    // Inside the module selected alone, while editing: Shift adds a part to the parts
    // selected; a part selected is dragged to another place in its list; a drag from an
    // item's region to another's makes a new item between them.
    if (m && was && this.editing && this.partsOn && selection.length === 1 && !links.length && !e.altKey && !deep) {
      const under = this.partAt(m, e.clientX, e.clientY);
      const map = this.renderer.editMap(m.id);
      if (under && e.shiftKey && this.chosenPart?.moduleId === m.id) {
        const paths = this.selectedParts.map((p) => p.path);
        const next = paths.includes(under.path) ? paths.filter((p) => p !== under.path) : [...paths, under.path];
        this.setPart(next.length ? { moduleId: m.id, path: next[0] } : null, next.slice(1));
        this.paint();
        this.gesture = { ...start, kind: "press" };
        return capture();
      }
      const chosen = !!under && this.selectedParts.some((p) => p.path === under.path);
      const reorder = under && map?.parts.find((p) => p.path === under.path)?.reorder;
      const item = under && itemOf(under.path);
      if (chosen && reorder && item) {
        this.gesture = { ...start, pickPart: under, kind: "reorder", moduleId: m.id, list: item.list, item: item.item, axis: reorder };
        return capture();
      }
      const anchor = !under && map ? this.anchorAt(map, e.clientX, e.clientY) : undefined;
      const make = anchor && map?.creates.find((c) => this.refersTo(m, c.list, c.between[0]) === anchor.list);
      if (anchor && make) {
        this.gesture = {
          ...start,
          pickPart: null,
          kind: "create",
          moduleId: m.id,
          list: make.list,
          between: make.between,
          fields: make.fields,
          rows: make.rows ?? "y",
          from: anchor.id,
          start: this.toScene(e.clientX, e.clientY),
        };
        return capture();
      }
    }
    // A second press on a module selected alone goes into it, as a second press goes into
    // a group: to the part of its drawing under the press.
    const pickPart =
      m && was && this.partsOn && selection.length === 1 && !links.length && !e.shiftKey && !deep
        ? this.partAt(m, e.clientX, e.clientY)
        : undefined;
    let narrow: string | undefined;
    if (m && this.editing && e.shiftKey) {
      const unit = this.unitOf(m, deep);
      this.select(
        unit.every((id) => selection.includes(id))
          ? selection.filter((id) => !unit.includes(id))
          : [...selection, ...unit],
        links,
      );
    } else if (m && (!was || deep)) this.select(this.unitOf(m, deep));
    else if (m && this.editing && (selection.length > 1 || links.length)) narrow = m.id;
    else if (!m) this.select([]);
    const held = !!m && this.selection.includes(m.id) && (was || this.editing);
    if (this.movable && held) {
      // What is selected moves with what it holds. Outside editing a grouped module takes
      // its group along, as editing selects the group itself. With Alt held while
      // editing, copies are dragged off and the modules stay, so they are among what the
      // copies line up with.
      const ids = this.editing
        ? this.selection
        : chosen().flatMap((d) => (d.group ? this.mates(d.group) : [d.id]));
      const moving = [...new Set([...ids, ...carried(this.stack(), ids)])].flatMap((id) => {
        const v = this.renderer.instances.get(id);
        return v ? [v] : [];
      });
      const copy = this.editing && e.altKey && !!this.options.duplicate;
      this.gesture = {
        ...start,
        pickPart,
        kind: "move",
        moves: moving.map((v) => ({ id: v.id, bounds: { ...v.bounds } })),
        others: others(copy ? new Set() : new Set(moving.map((v) => v.id))),
        copy,
        narrow,
      };
      if (copy) this.element.style.cursor = "copy";
    } else this.gesture = { ...start, pickPart, kind: "pan", camera: { ...this.camera } };
    capture();
  }
  /** Shows the guides a dragged box snapped to, in scene units. */
  private showGuides(guides: Guide[]) {
    while (this.guides.length < guides.length) {
      const g = document.createElement("div");
      g.style.cssText =
        "position:absolute;background:#e5484d;pointer-events:none;z-index:6";
      this.element.append(g);
      this.guides.push(g);
    }
    const { x, y, scale } = this.camera;
    this.guides.forEach((el, i) => {
      const g = guides[i];
      if (!g) return void (el.style.display = "none");
      Object.assign(
        el.style,
        g.axis === "x"
          ? {
              display: "block",
              left: x + g.at * scale - 0.5 + "px",
              top: y + g.from * scale + "px",
              width: "1px",
              height: (g.to - g.from) * scale + "px",
            }
          : {
              display: "block",
              top: y + g.at * scale - 0.5 + "px",
              left: x + g.from * scale + "px",
              height: "1px",
              width: (g.to - g.from) * scale + "px",
            },
      );
    });
  }
  /** The place of what is dragged, in a tag at its top left corner, where it is measured
   * from. */
  private showReadout(text: string | null, b?: Bounds) {
    if (!text || !b) return void (this.readout.style.display = "none");
    const { x, y, scale } = this.camera;
    this.readout.textContent = text;
    Object.assign(this.readout.style, {
      display: "block",
      transform: "none",
      left: x + b.x * scale + "px",
      top: y + b.y * scale - 26 + "px",
    });
  }
  /** Puts dragged modules where they are going at once, and draws what has to be drawn
   * again for it (resized modules, the links meeting them) once a frame, always with the
   * latest place, however fast the pointer moves. */
  private drag(moves: { id: string; bounds: Bounds }[], ghost = true) {
    if (ghost) for (const m of moves) this.ghost.set(m.id, m.bounds);
    this.renderer.position(moves);
    this.wanted = moves;
    if (this.redrawing) return;
    const renderer = this.renderer;
    const next = (): Promise<unknown> | undefined => {
      const latest = this.wanted;
      this.wanted = undefined;
      if (!latest || renderer !== this.renderer) {
        this.redrawing = undefined;
        this.paint();
        return;
      }
      return (this.redrawing = renderer
        .move(latest)
        .catch(() => {})
        .then(() => new Promise((r) => requestAnimationFrame(r)))
        .then(next));
    };
    next();
  }
  /** The side of a module facing a point on screen, and where its middle is on screen. */
  /** What an end of a link binds to at a point on screen: the outline of a module it is
   * near (the exact point on it, or a share along a line a module declares, as a drawn line
   * does), a module it is inside (following it), a link it is on (a share of the way along
   * it), or else that point of the scene. `skip` is what the other end is on. */
  bindingAt(clientX: number, clientY: number, skip: { module?: string; link?: string } = {}): Binding {
    const p = this.toScene(clientX, clientY),
      reach = (this.touching ? FINGER_SLOP / 2 : SLOP) / this.camera.scale;
    let best: Binding & { distance: number } | undefined;
    for (const m of this.renderer.instances.values()) {
      // The backdrop under the whole figure is not what a line is drawn to.
      if (m.id === skip.module || this.beneath(m)) continue;
      const b = this.ghost.get(m.id) ?? m.bounds;
      if (p.x < b.x - reach || p.x > b.x + b.width + reach || p.y < b.y - reach || p.y > b.y + b.height + reach) continue;
      const map = this.renderer.editMap(m.id);
      const declared = !!map && JSON.stringify(map.outline) !== JSON.stringify(boxOutline(m.bounds));
      const outline = map?.outline ?? boxOutline(b);
      const near = nearestAlong(outline, p);
      if (near.distance > reach || (best && best.distance <= near.distance)) continue;
      const round = (n: number) => Math.round(n * 1000) / 1000;
      let end: LinkEnd;
      if (declared) end = { moduleId: m.id, at: { along: round(near.t) } };
      else {
        // Near a side's middle it takes the side, as people mean it; elsewhere the point.
        const middle = sides.find((side) => {
          const a = sidePoint[side];
          return Math.hypot(b.x + a.x * b.width - p.x, b.y + a.y * b.height - p.y) <= reach;
        });
        end = middle
          ? { moduleId: m.id, at: middle }
          : { moduleId: m.id, at: [round((near.point.x - b.x) / b.width), round((near.point.y - b.y) / b.height)] };
      }
      const point = middle(end, b, near.point);
      best = { end, point, outline, distance: near.distance };
    }
    if (best) return { end: best.end, point: best.point, outline: best.outline };
    // Inside a module, the end follows it: where it draws, else the smallest box holding the
    // point, but not the backdrop under the whole figure.
    const held = this.moduleAt(clientX, clientY);
    const inside = this.moduleAt(clientX, clientY, false) ?? (held && !this.beneath(held) ? held : undefined);
    if (inside && inside.id !== skip.module) {
      const b = inside.bounds;
      return { end: { moduleId: inside.id }, point: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, outline: boxOutline(b) };
    }
    const along = this.linkAt(clientX, clientY, skip.link);
    const line = along ? this.renderer.links.get(along) : undefined;
    if (line) {
      const { from, to } = this.renderer.ends(line);
      const on = nearestAlong([from, to], p);
      return { end: { linkId: line.id, along: Math.round(on.t * 1000) / 1000 }, point: on.point, outline: [from, to] };
    }
    const free = { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 };
    return { end: free, point: free };
  }
  /** The line from where a link starts to the pointer, the outline the pointer would bind to
   * drawn round, and a ring where it binds. Given no start, only what it would bind to. */
  private showBinding(from: Binding | undefined, to: Binding | undefined) {
    const { x, y, scale } = this.camera;
    const on = (p: Point) => ({ x: x + p.x * scale, y: y + p.y * scale });
    const [line, dot, ring, outline] = [...this.line.children] as SVGElement[];
    if (!from && !to?.outline) {
      this.line.style.display = "none";
      return;
    }
    this.line.style.display = "block";
    const end = to ? on(to.point) : undefined;
    line.style.display = from && end ? "" : "none";
    dot.style.display = from && end ? "" : "none";
    if (from && end) {
      const start = on(from.point);
      line.setAttribute("x1", String(start.x));
      line.setAttribute("y1", String(start.y));
      line.setAttribute("x2", String(end.x));
      line.setAttribute("y2", String(end.y));
      dot.setAttribute("cx", String(start.x));
      dot.setAttribute("cy", String(start.y));
    }
    const bound = to && !isFreeEnd(to.end);
    ring.style.display = bound && end ? "" : "none";
    if (bound && end) {
      ring.setAttribute("cx", String(end.x));
      ring.setAttribute("cy", String(end.y));
    }
    outline.setAttribute("d", to?.outline ? "M" + to.outline.map((p) => `${on(p).x.toFixed(1)} ${on(p).y.toFixed(1)}`).join("L") : "");
    this.hoverOver(to && "moduleId" in to.end ? to.end.moduleId : null);
  }
  private move(e: PointerEvent) {
    const g = this.gesture;
    if (!g && !this.editing) {
      const host = (e.target as Element | null)?.closest?.<HTMLElement>("[data-module-id]");
      const id = host && this.renderer.instances.get(host.dataset.moduleId!)?.target ? host.dataset.moduleId! : null;
      if (id !== this.hot) {
        this.hot = id;
        for (const [m, badge] of this.badges) badge.toggleAttribute("data-hot", m === id);
      }
    }
    if (e.pointerType === "touch" && this.touches.has(e.pointerId))
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g?.kind === "pinch") return this.pinched(g);
    if (g && e.pointerId !== g.pointer) return;
    if (!g) {
      if (e.pointerType === "touch") return;
      if (this.editing && this.tool === "select" && !this.spacing) {
        const { module: m, link } = this.pick(e.clientX, e.clientY);
        this.nearSide(e);
        this.hoverPart(
          m && this.partsOn && this.selection.length === 1 && this.selection[0] === m.id ? this.partAt(m, e.clientX, e.clientY) : null,
        );
        this.hoverSlot(e.clientX, e.clientY);
        this.hoverOver(m?.id ?? null, m ? null : (link ?? null));
        this.element.style.cursor = !m && link ? "pointer" : "";
      } else if (this.editing && this.tool === "arrow" && !this.spacing) {
        // Where an arrow pressed here would start is shown before it is pressed.
        this.showBinding(undefined, this.bindingAt(e.clientX, e.clientY));
      } else if (this.editing && this.tool === "erase" && !this.spacing)
        this.hoverOver(this.moduleAt(e.clientX, e.clientY, false)?.id ?? null);
      return;
    }
    // The eraser rubs along the way the pointer went, so a quick stroke misses nothing.
    if (g.kind === "erase") {
      const steps = Math.ceil(Math.hypot(e.clientX - g.last.x, e.clientY - g.last.y) / 4);
      for (let i = 1; i <= steps; i++)
        this.rub(g.last.x + ((e.clientX - g.last.x) * i) / steps, g.last.y + ((e.clientY - g.last.y) * i) / steps);
      g.last = { x: e.clientX, y: e.clientY };
      g.moved = true;
      return;
    }
    if (g.kind === "ink") {
      if (g.straight) {
        // Shift keeps the line to every fifteen degrees.
        let end = this.toScene(e.clientX, e.clientY);
        const a = g.points[0];
        if (e.shiftKey) {
          const len = Math.hypot(end.x - a.x, end.y - a.y),
            turn = Math.round(Math.atan2(end.y - a.y, end.x - a.x) / ANGLE_STEP) * ANGLE_STEP;
          end = { x: a.x + Math.cos(turn) * len, y: a.y + Math.sin(turn) * len };
        }
        g.points = [a, end];
        const to = this.bindingAt(e.clientX, e.clientY, { module: g.from && endModule(g.from.end) });
        this.showBinding(g.from, to.end && !isFreeEnd(to.end) ? to : undefined);
      } else
        for (const p of e.getCoalescedEvents?.() ?? [e]) {
          const at = this.toScene(p.clientX, p.clientY),
            last = g.points.at(-1)!;
          if (Math.hypot(at.x - last.x, at.y - last.y) * this.camera.scale >= 1) g.points.push(at);
        }
      g.moved ||= Math.hypot(e.clientX - g.x, e.clientY - g.y) > (g.touch ? FINGER_STILL : STILL);
      if (g.moved) clearTimeout(this.holding);
      this.paintInk();
      return;
    }
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) > (g.touch ? FINGER_STILL : STILL)) {
      g.moved = true;
      clearTimeout(this.holding);
    }
    if (!g.moved) return;
    if (g.kind === "reorder" || g.kind === "create" || g.kind === "handle") return this.dragInside(g, e);
    const scale = this.camera.scale;
    // Snapping lines a dragged box up with its neighbours; Cmd or Ctrl turns it off.
    const snapping = this.editing && this.snapping.guides && !e.metaKey && !e.ctrlKey;
    const grid = this.editing && !e.metaKey && !e.ctrlKey ? this.snapping.grid : 0;
    const threshold = 6 / scale;
    const round = (n: number) => Math.round(n);
    if (g.kind === "pan") {
      this.camera = { ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy };
      this.changed();
    } else if (g.kind === "move") {
      let mx = dx / scale,
        my = dy / scale;
      // Shift keeps the move straight across or straight down.
      if (this.editing && e.shiftKey)
        Math.abs(mx) > Math.abs(my) ? (my = 0) : (mx = 0);
      let guides: Guide[] = [];
      const frame = union(g.moves.map((m) => m.bounds));
      // What lines up with a neighbour stays there; the rest settles on the grid's lines.
      let lined = { x: false, y: false };
      this.gaps = [];
      if (snapping) {
        const s = snap(
          { ...frame, x: frame.x + mx, y: frame.y + my },
          g.others,
          threshold,
          undefined,
          undefined,
          true,
        );
        mx += s.dx;
        my += s.dy;
        guides = s.guides;
        this.gaps = s.gaps;
        lined = {
          x: !!s.dx || s.guides.some((l) => l.axis === "x") || s.gaps.some((l) => l.axis === "x"),
          y: !!s.dy || s.guides.some((l) => l.axis === "y") || s.gaps.some((l) => l.axis === "y"),
        };
      }
      if (grid) {
        if (!lined.x && mx) mx = Math.round((frame.x + mx) / grid) * grid - frame.x;
        if (!lined.y && my) my = Math.round((frame.y + my) / grid) * grid - frame.y;
      }
      this.showGuides(guides);
      g.last = g.moves.map((m) => ({
        id: m.id,
        bounds: { ...m.bounds, x: m.bounds.x + mx, y: m.bounds.y + my },
      }));
      this.drag(g.last);
      const now = { ...frame, x: frame.x + mx, y: frame.y + my };
      if (this.editing) this.showReadout(`${round(now.x)}, ${round(now.y)}`, now);
      // Where copies are dragged from stays outlined: the modules there are not leaving.
      if (g.copy) {
        const { x, y } = this.camera;
        Object.assign(this.origin.style, {
          display: "block",
          left: x + frame.x * scale + "px",
          top: y + frame.y * scale + "px",
          width: frame.width * scale + "px",
          height: frame.height * scale + "px",
        });
      }
    } else if (g.kind === "resize") {
      const options = {
        keep: e.shiftKey,
        centred: e.altKey,
        min: 16,
      };
      let rx = dx / scale,
        ry = dy / scale;
      let next = resized(g.frame, g.handle, rx, ry, options);
      let guides: Guide[] = [];
      // Only a free resize snaps: the dragged edges line up with the others.
      if (snapping && !options.keep && !options.centred) {
        const xs = g.handle.includes("w") ? [0] : g.handle.includes("e") ? [1] : [],
          ys = g.handle.includes("n") ? [0] : g.handle.includes("s") ? [1] : [];
        const s = snap(next, g.others, threshold, xs, ys);
        rx += s.dx;
        ry += s.dy;
        next = resized(g.frame, g.handle, rx, ry, options);
        guides = s.guides;
      }
      // A free resize ends on the grid's lines where it lined up with nothing.
      if (grid && !options.keep && !options.centred) {
        const to = (v: number) => Math.round(v / grid) * grid;
        if (!guides.some((l) => l.axis === "x") && g.handle.includes("e")) rx = to(g.frame.x + g.frame.width + rx) - g.frame.x - g.frame.width;
        if (!guides.some((l) => l.axis === "x") && g.handle.includes("w")) rx = to(g.frame.x + rx) - g.frame.x;
        if (!guides.some((l) => l.axis === "y") && g.handle.includes("s")) ry = to(g.frame.y + g.frame.height + ry) - g.frame.y - g.frame.height;
        if (!guides.some((l) => l.axis === "y") && g.handle.includes("n")) ry = to(g.frame.y + ry) - g.frame.y;
        next = resized(g.frame, g.handle, rx, ry, options);
      }
      this.showGuides(guides);
      g.last = g.moves.map((m) => ({
        id: m.id,
        bounds: g.moves.length === 1 ? next : scaled(m.bounds, g.frame, next),
      }));
      this.drag(g.last);
    } else if (g.kind === "draw") {
      // The box of something new: Shift keeps it square, and it ends on the grid's lines.
      const at = this.toScene(e.clientX, e.clientY);
      const w = at.x - g.start.x,
        h = at.y - g.start.y;
      const to = (v: number) => (grid ? Math.round(v / grid) * grid : Math.round(v));
      const x0 = to(g.start.x),
        y0 = to(g.start.y),
        side = to(Math.max(Math.abs(w), Math.abs(h))),
        x1 = e.shiftKey ? x0 + Math.sign(w || 1) * side : to(g.start.x + w),
        y1 = e.shiftKey ? y0 + Math.sign(h || 1) * side : to(g.start.y + h);
      g.box = {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
      };
      const { x, y } = this.camera;
      Object.assign(this.marquee.style, {
        display: "block",
        left: x + g.box.x * scale + "px",
        top: y + g.box.y * scale + "px",
        width: g.box.width * scale + "px",
        height: g.box.height * scale + "px",
      });
    } else if (g.kind === "marquee") {
      const at = this.toScene(e.clientX, e.clientY);
      const box = {
        x: Math.min(g.start.x, at.x),
        y: Math.min(g.start.y, at.y),
        width: Math.abs(at.x - g.start.x),
        height: Math.abs(at.y - g.start.y),
      };
      const { x, y } = this.camera;
      Object.assign(this.marquee.style, {
        display: "block",
        left: x + box.x * scale + "px",
        top: y + box.y * scale + "px",
        width: box.width * scale + "px",
        height: box.height * scale + "px",
      });
      // What lies wholly in the box is selected as it is drawn; with Alt, whatever it
      // touches. A group goes as a whole: once all of it is in the box, or with Alt once
      // any of it is. A module the box lies wholly in (the zone it was begun in) is not
      // what it means.
      const touching = e.altKey;
      const inBox = (p: Point) =>
        p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
      const meets = (b: Bounds) =>
        b.x < box.x + box.width && box.x < b.x + b.width && b.y < box.y + box.height && box.y < b.y + b.height;
      const holds = (b: Bounds) =>
        b.x <= box.x && b.y <= box.y && b.x + b.width >= box.x + box.width && b.y + b.height >= box.y + box.height;
      const all = [...this.renderer.instances.values()];
      const hit = new Set(
        all
          .filter((m) =>
            touching
              ? meets(m.bounds) && !holds(m.bounds)
              : inBox(m.bounds) && inBox({ x: m.bounds.x + m.bounds.width, y: m.bounds.y + m.bounds.height }),
          )
          .map((m) => m.id),
      );
      const modules = all
        .filter((m) =>
          m.group
            ? touching
              ? this.mates(m.group).some((id) => hit.has(id))
              : this.mates(m.group).every((id) => hit.has(id))
            : hit.has(m.id),
        )
        .map((m) => m.id);
      const links = [...this.renderer.links.keys()].filter((id) => {
        const points = this.pointsOf(id);
        return points.length > 0 && (touching ? points.some(inBox) : points.every(inBox));
      });
      const picked = {
        modules: [...new Set([...g.base.modules, ...modules])],
        links: [...new Set([...g.base.links, ...links])],
      };
      const key = picked.modules.join() + "|" + picked.links.join();
      if (key !== g.picked) {
        g.picked = key;
        this.select(picked.modules, picked.links);
      }
    } else if (g.kind === "connect") {
      const from = this.renderer.instances.get(g.from.moduleId);
      if (!from) return;
      // Without a side named, the link leaves by the side facing the pointer.
      const a = sidePoint[g.from.side ?? facing(from.bounds, this.toScene(e.clientX, e.clientY))];
      const start = { x: from.bounds.x + a.x * from.bounds.width, y: from.bounds.y + a.y * from.bounds.height };
      this.showBinding({ end: { moduleId: from.id }, point: start }, this.bindingAt(e.clientX, e.clientY, { module: from.id }));
    } else if (g.kind === "relink") {
      const link = this.renderer.links.get(g.linkId);
      if (!link) return;
      const far = g.end === "from" ? "to" : "from",
        p = this.renderer.ends(link)[far];
      this.showBinding({ end: link[far], point: p }, this.bindingAt(e.clientX, e.clientY, { module: endModule(link[far]), link: link.id }));
    }
    this.paint();
  }
  /** A drag inside the module selected: an item to another place in its list, a new item
   * from one region to another, or a part's handle. */
  private dragInside(g: Extract<NonNullable<Canvas["gesture"]>, { kind: "reorder" | "create" | "handle" }>, e: PointerEvent) {
    const map = this.renderer.editMap(g.moduleId);
    const m = this.renderer.instances.get(g.moduleId);
    if (!map || !m) return;
    const p = this.toScene(e.clientX, e.clientY);
    const { x, y, scale } = this.camera;
    const showTarget = (b?: Bounds) => {
      if (!b) return void (this.target.style.display = "none");
      const on = this.shown(b);
      Object.assign(this.target.style, { display: "block", left: on.x + "px", top: on.y + "px", width: on.width + "px", height: on.height + "px" });
    };
    if (g.kind === "reorder") {
      const slot = this.nearestSlot(map, g.list, p, g.axis);
      g.to = slot?.index;
      const part = map.parts.find((q) => q.path === `${g.list}.${typeof g.item === "number" ? g.item : "#" + g.item}`);
      if (!slot || !part) return void (this.dropLine.style.display = "none");
      // The line across where it would go.
      const across = g.axis === "y" ? { left: x + part.box.x * scale, top: y + slot.at.y * scale - 1, width: part.box.width * scale, height: 2 } : { left: x + slot.at.x * scale - 1, top: y + part.box.y * scale, width: 2, height: part.box.height * scale };
      Object.assign(this.dropLine.style, { display: "block", left: across.left + "px", top: across.top + "px", width: across.width + "px", height: across.height + "px" });
      return;
    }
    if (g.kind === "create") {
      const to = this.anchorAt(map, e.clientX, e.clientY, this.refersTo(m, g.list, g.between[1]));
      g.to = to?.id;
      showTarget(to?.box);
      const point = to ? { x: to.box.x + to.box.width / 2, y: p.y } : p;
      this.showBinding({ end: { x: g.start.x, y: g.start.y }, point: g.start }, { end: { x: point.x, y: point.y }, point });
      return;
    }
    const h = g.handle;
    if (h.kind === "ref") {
      const list = (() => {
        const f = fieldAt(drawingOf(this.renderer.work, m.drawingId)?.params ?? {}, h.path);
        return f?.type === "ref" ? f.to : undefined;
      })();
      const to = list ? this.anchorAt(map, e.clientX, e.clientY, list) : undefined;
      g.to = to?.id;
      showTarget(to?.box);
      this.showBinding({ end: { x: h.at.x, y: h.at.y }, point: h.at }, { end: { x: p.x, y: p.y }, point: p });
      return;
    }
    // A number dragged along its axis, or a place moved on a map, shown as it goes.
    let value: unknown;
    if (h.kind === "scalar") {
      const was = Number(getAt(g.data, h.path) ?? 0);
      const along = (h.axis ?? "y") === "x" ? p.x - h.at.x : p.y - h.at.y;
      value = Math.round((was + along * (h.scale ?? 1)) * 100) / 100;
    } else if (h.unproject) value = h.unproject(p.x - m.bounds.x, p.y - m.bounds.y);
    if (value === undefined) return;
    g.value = value;
    const next = pointValue(g.data, h.path, value);
    if (next) this.renderer.redraw(m.id, next);
  }
  /** The line being drawn, where it is on screen. */
  private paintInk() {
    const g = this.gesture;
    if (g?.kind !== "ink") {
      this.ink.style.display = "none";
      return;
    }
    const { x, y, scale } = this.camera;
    const d = g.points
      .map((p, i) => `${i ? "L" : "M"}${(x + p.x * scale).toFixed(1)} ${(y + p.y * scale).toFixed(1)}`)
      .join("");
    this.ink.style.display = "block";
    this.ink.firstElementChild!.setAttribute("d", g.points.length === 1 ? d + "h0.1" : d);
  }
  /** The eraser at a point on screen: the module drawn there (with its group), or else the
   * link passing near, fades until the eraser is lifted. */
  private rub(clientX: number, clientY: number) {
    const g = this.gesture;
    if (g?.kind !== "erase") return;
    // What is painted there, unless it is the backdrop with a link drawn over it, as `pick`
    // takes a press; never a module only by its box.
    const near = this.linkAt(clientX, clientY);
    const drawn = this.moduleAt(clientX, clientY, false);
    const m = drawn && !(near && this.beneath(drawn)) ? drawn : null;
    const link = m ? null : near;
    const ids = m
      ? m.group
        ? [...this.renderer.instances.values()].filter((x) => x.group === m.group).map((x) => x.id)
        : [m.id]
      : link
        ? [link]
        : [];
    for (const id of ids) {
      if (g.hit.has(id)) continue;
      g.hit.add(id);
      const host = this.renderer.host(this.renderer.instances.has(id) ? "module" : "link", id);
      if (host) host.style.opacity = ".2";
    }
  }
  private finish() {
    const was = this.gesture;
    if (was?.kind === "erase")
      for (const id of was.hit)
        this.renderer.host(this.renderer.instances.has(id) ? "module" : "link", id)?.style.removeProperty("opacity");
    this.gesture = undefined;
    this.ink.style.display = "none";
    this.ghost.clear();
    this.marquee.style.display = "none";
    this.origin.style.display = "none";
    this.line.style.display = "none";
    this.dropLine.style.display = "none";
    this.target.style.display = "none";
    this.gaps = [];
    this.showGuides([]);
    this.showReadout(null);
    this.cursor();
    this.paint();
  }
  /** A gesture the system took away: what it moved goes back. */
  private cancel(e?: PointerEvent) {
    if (e) this.touches.delete(e.pointerId);
    clearTimeout(this.holding);
    const g = this.gesture;
    if (e && g && e.pointerId !== g.pointer && g.kind !== "pinch") return;
    this.abandon();
  }
  /** Lets go of the gesture without keeping what it did: what it moved goes back, and a
   * value a handle showed as it was dragged is drawn as it was. */
  private abandon() {
    const g = this.gesture;
    if (!g) return;
    if (g.kind === "move" || g.kind === "resize") this.drag(g.moves);
    if (g.kind === "handle" && g.value !== undefined) this.renderer.redraw(g.moduleId, g.was);
    this.finish();
  }
  /** Two fingers: what the first began is let go, and the view follows both, zooming as
   * they spread or close and moving as they move together. */
  private pinch(e: PointerEvent) {
    clearTimeout(this.holding);
    this.abandon();
    const [a, b] = [...this.touches.values()];
    this.element.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.gesture = {
      kind: "pinch",
      x: e.clientX,
      y: e.clientY,
      moved: true,
      pointer: e.pointerId,
      touch: true,
      camera: { ...this.camera },
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      span: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }
  private pinched(g: Extract<NonNullable<Canvas["gesture"]>, { kind: "pinch" }>) {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      span = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const moved = {
      ...g.camera,
      x: g.camera.x + mid.x - g.mid.x,
      y: g.camera.y + mid.y - g.mid.y,
    };
    this.camera = zoom(moved, this.local(mid.x, mid.y), span / g.span);
    this.changed();
  }
  /** A finger held still long enough selects what it is on and asks what to do there. What
   * it is on is found when it goes down: selecting it can grow what is laid over the canvas
   * (a phone's actions) and refit the view under the still finger. */
  private holdFrom(e: PointerEvent) {
    clearTimeout(this.holding);
    const at = { x: e.clientX, y: e.clientY },
      pointer = e.pointerId,
      under = this.pick(at.x, at.y);
    this.holding = setTimeout(() => {
      const g = this.gesture;
      if (!g || g.pointer !== pointer || g.moved || this.touches.size !== 1) return;
      this.cancel();
      if (this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
      this.follow(under);
      if (this.options.hold) this.options.hold(at);
      else if (this.editing) this.options.menu?.(at);
    }, HOLD_MS);
  }
  /** Whether a finger's double tap was just handled, so the double click the browser may
   * send after it is not handled again. */
  private doubledJustNow() {
    return performance.now() - this.doubled < 600;
  }
  /** A tap with a finger: a second one soon after and near the first is a double tap,
   * which does what a double click does. */
  private tap(e: PointerEvent) {
    const now = performance.now(),
      last = this.tapped;
    if (
      last &&
      now - last.at < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_PX
    ) {
      this.tapped = undefined;
      this.doubled = now;
      this.dblclick(new MouseEvent("dblclick", { clientX: e.clientX, clientY: e.clientY }));
      return;
    }
    this.tapped = { at: now, x: e.clientX, y: e.clientY };
  }
  private up(e: PointerEvent) {
    const touch = e.pointerType === "touch";
    if (touch) this.touches.delete(e.pointerId);
    const g = this.gesture;
    if (g && g.pointer !== e.pointerId && g.kind !== "pinch") return;
    clearTimeout(this.holding);
    if (this.element.hasPointerCapture(e.pointerId))
      this.element.releasePointerCapture(e.pointerId);
    if (!g) return;
    this.finish();
    // Lifting a finger ends a pinch; the one left on the glass does nothing more.
    if (g.kind === "pinch") return;
    if (touch && !g.moved) this.tap(e);
    if (g.moved && g.kind === "move" && g.copy && g.last) {
      // Copies were dragged off: the modules go back, and copies are asked for that far away.
      this.drag(g.moves, false);
      const by = {
        x: g.last[0].bounds.x - g.moves[0].bounds.x,
        y: g.last[0].bounds.y - g.moves[0].bounds.y,
      };
      if (by.x || by.y) this.options.duplicate?.(g.moves.map((m) => m.id), by);
    } else if (g.moved && (g.kind === "move" || g.kind === "resize") && g.last) {
      this.changed();
      this.options.commit?.(g.last.map((m) => ({ id: m.id, bounds: { ...m.bounds } })));
    }
    if (g.kind === "ink") {
      this.hoverOver(null);
      this.showBinding(undefined, undefined);
      const to = g.straight && g.from ? this.bindingAt(e.clientX, e.clientY, { module: endModule(g.from.end) }) : undefined;
      const tall = g.points.length > 1 && upright(g.points[0], g.points.at(-1)!);
      if (g.from && to && g.moved && (!isFreeEnd(g.from.end) || !isFreeEnd(to.end)))
        this.options.connect?.(g.from.end, to.end, tall ? { upright: true } : undefined);
      else if (!g.straight || g.moved) this.options.ink?.(g.points, g.straight ? { kind: "arrow", ...(tall ? { upright: true } : {}) } : { kind: "pen" });
    }
    if (g.kind === "erase" && g.hit.size) this.options.erase?.([...g.hit]);
    if (g.moved && g.kind === "reorder" && g.to !== undefined) {
      const list = getAt(this.drawnData(this.renderer.instances.get(g.moduleId)!), g.list);
      const from = Array.isArray(list) ? (typeof g.item === "number" ? g.item : list.findIndex((x) => (x as { id?: unknown })?.id === g.item)) : -1;
      const to = from >= 0 && g.to > from ? g.to - 1 : g.to;
      if (from >= 0 && to !== from) this.options.reorder?.({ moduleId: g.moduleId, list: g.list, item: g.item, to });
    }
    if (g.moved && g.kind === "create" && g.to !== undefined) {
      const map = this.renderer.editMap(g.moduleId);
      const slot = map && this.nearestSlot(map, g.list, this.toScene(e.clientX, e.clientY), g.rows);
      const list = getAt(this.drawnData(this.renderer.instances.get(g.moduleId)!), g.list);
      this.options.create?.({
        moduleId: g.moduleId,
        list: g.list,
        index: slot?.index ?? (Array.isArray(list) ? list.length : 0),
        values: { ...(g.fields ?? {}), [g.between[0]]: g.from, [g.between[1]]: g.to },
      });
    }
    if (g.moved && g.kind === "handle") {
      if (g.handle.kind === "ref" && g.to !== undefined) this.options.retarget?.({ moduleId: g.moduleId, path: g.handle.path, to: g.to });
      else if (g.handle.kind !== "ref" && g.value !== undefined) this.options.setValue?.({ moduleId: g.moduleId, path: g.handle.path, value: g.value });
      else this.renderer.redraw(g.moduleId, this.renderer.instances.get(g.moduleId)!.data);
    }
    if (!g.moved && g.pickPart !== undefined) {
      this.setPart(g.pickPart);
      this.paint();
    }
    // A zone pressed without a drag is selected, or with Shift joins the selection or
    // leaves it.
    if (g.kind === "marquee" && !g.moved && g.on) {
      const m = this.renderer.instances.get(g.on);
      if (m) {
        const unit = this.unitOf(m);
        const { modules, links } = g.base;
        if (!e.shiftKey) this.select(unit);
        else if (unit.every((id) => modules.includes(id)))
          this.select(modules.filter((id) => !unit.includes(id)), links);
        else this.select([...modules, ...unit], links);
      }
    }
    // A press on one of several selected, let go where it was, selects it alone, or its
    // group; pressed again within a selected group, the one module inside it.
    if (g.kind === "move" && !g.moved && g.narrow) {
      const m = this.renderer.instances.get(g.narrow);
      const mates = m?.group ? this.mates(m.group) : [];
      if (m)
        this.select(
          mates.length && mates.length === this.selection.length && mates.every((id) => this.selection.includes(id)) && !this.linkSelection.length
            ? [m.id]
            : this.unitOf(m),
        );
    }
    if (g.kind === "draw") {
      const big = g.box && g.box.width * this.camera.scale >= 12 && g.box.height * this.camera.scale >= 12;
      this.options.place?.(
        big ? { x: g.box!.x + g.box!.width / 2, y: g.box!.y + g.box!.height / 2 } : g.start,
        big ? g.box : undefined,
      );
    }
    // The dot on a side pressed without a drag grows the figure beyond that side.
    if (g.kind === "connect" && !g.moved && g.from.side)
      this.options.extend?.({ moduleId: g.from.moduleId, side: g.from.side });
    if ((g.kind === "connect" || g.kind === "relink") && g.moved) {
      const here = this.toScene(e.clientX, e.clientY);
      this.showBinding(undefined, undefined);
      if (g.kind === "connect") {
        const to = this.bindingAt(e.clientX, e.clientY, { module: g.from.moduleId });
        // From a side's dot onto something, a link between them; let go over the paper well
        // clear of where it began, it ends in a new module there.
        if (!isFreeEnd(to.end)) this.options.connect?.({ moduleId: g.from.moduleId, ...(g.from.side ? { at: g.from.side } : {}) }, to.end);
        else if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 36) {
          const source = this.renderer.instances.get(g.from.moduleId);
          if (source) this.options.extend?.({ moduleId: source.id, side: g.from.side ?? facing(source.bounds, here) }, here);
        }
      } else {
        const link = this.renderer.links.get(g.linkId);
        const fixed = link?.[g.end === "from" ? "to" : "from"];
        if (link && fixed) {
          const to = this.bindingAt(e.clientX, e.clientY, { module: endModule(fixed), link: link.id });
          this.options.reconnect?.(g.linkId, g.end, to.end);
        }
      }
      this.hoverOver(null);
    }
    if (!g.moved && !this.editing && this.selection.length === 1) {
      const target = this.renderer.instances.get(this.selection[0])!.target;
      if (target) this.options.open(target);
    }
  }
  dispose() {
    this.queued = undefined;
    for (const wait of [...this.awaited]) wait.done("gone");
    cancelAnimationFrame(this.gliding);
    clearTimeout(this.settling);
    this.abort.abort();
    this.observer.disconnect();
    this.pending?.dispose();
    this.renderer.dispose();
    this.element.remove();
  }
}
