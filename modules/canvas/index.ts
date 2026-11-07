import { SceneRenderer } from "../runtime/scene.ts";
import { fit, union, zoom, type Camera } from "../contracts/geometry.ts";
import { shownName } from "../contracts/index.ts";
import { plan, play, gesture, hatching } from "./ink.ts";
import {
  facing,
  handles,
  resized,
  scaled,
  snap,
  sidePoint,
  sides,
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
/** Words or a picture a person pointed at in a module, to change them. */
export type Pointed =
  | {
      kind: "text";
      /** The module the words are in, or the link with `link`. */
      moduleId: string;
      link?: boolean;
      text: string;
      /** Where the words are on screen now, and their size there; the view may have
       * moved since they were pointed at. */
      place: () => { rect: DOMRect; size: number };
    }
  | { kind: "picture"; moduleId: string; material: string };
export interface CanvasOptions {
  camera?: Camera;
  /** Whether modules can be moved and resized: a selected module follows a drag. */
  movable?: boolean;
  /** Unfold drawings as they appear and glide the camera between compositions. */
  motion?: boolean;
  /** Screen space kept clear above and below the automatic view, for controls laid over
   * the canvas; asked each time the view is fitted, as the controls change size. */
  insets?: () => { top: number; bottom: number };
  /** Mark each module that opens a scene or a page, at its corner. The app's canvas does;
   * the page the capture service and the exports draw has none, as the marks are styled by
   * the app and are not part of the work. */
  marks?: boolean;
  open: (target: Target) => void;
  select: (selection: Selection[]) => void;
  /** A double click on words or a picture in a module. */
  point?: (pointed: Pointed) => void;
  cameraChanged?: (camera: Camera) => void;
  commit?: (moves: { id: string; bounds: Bounds }[]) => void;
  /** A link drawn while editing, from the side of one module to another. */
  connect?: (
    from: { moduleId: string; side: Side },
    to: { moduleId: string; side: Side },
  ) => void;
  /** A link selected while editing, or none. Selecting a link leaves no module selected,
   * and selecting modules leaves no link selected. */
  selectLink?: (id: string | null) => void;
  /** An end of a link dragged onto a side of a module while editing. */
  reconnect?: (
    linkId: string,
    end: "from" | "to",
    to: { moduleId: string; side: Side },
  ) => void;
  /** A right click while editing, at a point on screen, after the selection has followed
   * it; for the menu of what can be done there. */
  menu?: (at: { x: number; y: number }) => void;
  /** A press with the placing tool, at a point in the scene. */
  place?: (at: Point) => void;
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
const ACCENT = "#3d72e0";
/** How far from a link's line, in screen pixels, a press still takes the link. */
const SLOP = 10;
/** Distance from a point to a segment. */
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
  /** The frame the view's next step of a glide, an ease or a follow is waiting for. */
  private gliding = 0;
  /** A view the camera is easing toward, around a point that stays put on screen: where
   * the wheel or the zoom buttons asked it to go, reached over a few frames, not at once. */
  private easing?: { to: Camera; at: Point; pace: number };
  /** A paint waiting for the next frame, so input that arrives faster than the screen
   * draws moves the view once a frame. */
  private painting = 0;
  private movable: boolean;
  /** Editing: a press selects instead of opening or operating what is drawn, any module
   * can be dragged at once, and Shift adds to the selection. */
  private editing = false;
  private selection: string[] = [];
  private outlines: HTMLDivElement[] = [];
  private hovered: string | null = null;
  private hover = document.createElement("div");
  /** The box around the selection, with its handles, and the dots links are drawn from. */
  private frame = document.createElement("div");
  private dots = new Map<Side, HTMLElement>();
  /** The box around the group of a selected module. */
  private groupBox = document.createElement("div");
  /** The link selected while editing, and the one under the pointer. */
  private link: string | null = null;
  private hoveredLink: string | null = null;
  /** The lines of the hovered and the selected link, traced over them. */
  private linkMarks = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  /** The ends of the selected link, to drag onto another module or side. */
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
  /** What a press does while editing: select and move, move the view, or place. */
  private tool: "select" | "hand" | "place" = "select";
  /** The space bar held: the view moves under a drag, whatever the tool. */
  private spacing = false;
  private observer: ResizeObserver;
  /** The canvas's size when last seen, to keep the view steady as it changes. */
  private size = { width: 0, height: 0 };
  /** When the canvas last changed size, for an automatic view following the change. */
  private resizedAt = 0;
  /** Small marks on modules that open a scene or a page, so they can be found without
   * hovering over everything. Laid over the canvas, they are never part of the drawing. */
  private targets = document.createElement("div");
  private badges = new Map<string, HTMLButtonElement>();
  private abort = new AbortController();
  private automatic: boolean;
  private gesture?: {
    x: number;
    y: number;
    moved: boolean;
  } & (
    | { kind: "pan"; camera: Camera }
    | {
        kind: "move";
        moves: { id: string; bounds: Bounds }[];
        /** The boxes of the modules that stay, which a dragged box snaps to. */
        others: Bounds[];
        /** Where they are now. */
        last?: { id: string; bounds: Bounds }[];
      }
    | {
        kind: "resize";
        handle: Handle;
        frame: Bounds;
        moves: { id: string; bounds: Bounds }[];
        others: Bounds[];
        last?: { id: string; bounds: Bounds }[];
      }
    | { kind: "marquee"; start: Point; base: string[]; picked: string }
    | { kind: "connect"; from: { moduleId: string; side: Side } }
    | { kind: "relink"; linkId: string; end: "from" | "to" }
    | { kind: "press" }
  );
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
      "position:relative;width:100%;height:100%;overflow:hidden;outline:none;background-image:radial-gradient(#dcd6c9 .7px,transparent .7px)";
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
      "position:absolute;border:1px dashed rgba(44,99,212,.55);border-radius:6px;pointer-events:none;display:none;z-index:3;box-sizing:border-box";
    this.element.append(this.hover);
    const english = /^en/i.test(document.documentElement.lang);
    this.frame.style.cssText =
      "position:absolute;pointer-events:none;display:none;z-index:4;box-sizing:border-box";
    this.frame.dataset.canvasControl = "";
    for (const h of handles) {
      const x = h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%",
        y = h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%";
      const cursor = { nw: "nwse", se: "nwse", ne: "nesw", sw: "nesw", n: "ns", s: "ns", e: "ew", w: "ew" }[h];
      const handle = control(
        { handle: h },
        18,
        `width:10px;height:10px;border-radius:3px;background:#fff;border:1.5px solid ${ACCENT};box-shadow:0 1px 3px rgba(0,0,0,.18)`,
        english ? "Resize" : "调整大小",
      );
      Object.assign(handle.style, { left: x, top: y, cursor: cursor + "-resize" });
      this.frame.append(handle);
    }
    for (const side of sides) {
      const at = sidePoint[side];
      const out = 20;
      const dot = control(
        { connect: side },
        22,
        `width:12px;height:12px;border-radius:50%;background:${ACCENT};box-shadow:0 0 0 2.5px #fff,0 1px 4px rgba(0,0,0,.22);transition:transform .15s`,
        english ? "Draw a link" : "拖出连线",
      );
      dot.title = english ? "Drag to another element to link them" : "拖到另一个元素上连线";
      Object.assign(dot.style, {
        left: `calc(${at.x * 100}% + ${(at.x - 0.5) * 2 * out * (at.y === 0.5 ? 1 : 0)}px)`,
        top: `calc(${at.y * 100}% + ${(at.y - 0.5) * 2 * out * (at.x === 0.5 ? 1 : 0)}px)`,
        cursor: "crosshair",
      });
      dot.addEventListener("pointerenter", () => ((dot.firstChild as HTMLElement).style.transform = "scale(1.3)"));
      dot.addEventListener("pointerleave", () => ((dot.firstChild as HTMLElement).style.transform = ""));
      this.dots.set(side, dot as HTMLButtonElement);
      this.frame.append(dot);
    }
    this.element.append(this.frame);
    this.groupBox.style.cssText =
      "position:absolute;border:1px dashed rgba(61,114,224,.45);border-radius:8px;pointer-events:none;display:none;z-index:3;box-sizing:border-box";
    this.element.append(this.groupBox);
    this.marquee.style.cssText =
      "position:absolute;border:1px solid rgba(61,114,224,.8);background:rgba(61,114,224,.07);pointer-events:none;display:none;z-index:5;box-sizing:border-box";
    this.element.append(this.marquee);
    this.line.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;z-index:5;overflow:visible";
    this.line.innerHTML = `<line stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="5 4" stroke-linecap="round"/><circle r="4" fill="${ACCENT}"/><circle data-target r="7" fill="#fff" stroke="${ACCENT}" stroke-width="2.5" style="display:none"/>`;
    this.element.append(this.line);
    this.linkMarks.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;overflow:visible";
    this.linkMarks.innerHTML = `<path data-hover fill="none" stroke="${ACCENT}" stroke-opacity=".35" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path data-chosen fill="none" stroke="${ACCENT}" stroke-opacity=".45" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
    this.element.append(this.linkMarks);
    for (const end of ["from", "to"] as const) {
      const handle = control(
        { linkEnd: end },
        22,
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
      "position:absolute;z-index:6;display:none;padding:2px 7px;border-radius:6px;background:#2b2a27;color:#fff;font:500 11px/1.5 system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;transform:translate(-50%,0)";
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
          if (type === "dblclick") this.dblclick(e as MouseEvent);
        },
        { capture: true, signal },
      );
    // A press on the canvas itself reaches both listeners; editing has taken it already.
    this.element.addEventListener(
      "dblclick",
      (e) => !this.editing && !this.interactive(e) && this.dblclick(e),
      { signal },
    );
    this.element.addEventListener(
      "pointerleave",
      () => {
        this.hoverOver(null);
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
    this.element.addEventListener("pointercancel", () => this.cancel(), {
      signal,
    });
    // While editing, a right click selects what it lands on and asks for the menu.
    this.element.addEventListener(
      "contextmenu",
      (e) => {
        if (!this.editing || !this.options.menu) return;
        e.preventDefault();
        const { module: m, link } = this.pick(e.clientX, e.clientY);
        if (link) this.selectLink(link);
        else if (m && !this.selection.includes(m.id)) this.select([m.id]);
        else if (!m) this.select([]);
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
        if (e.key === "0") {
          this.fit();
          e.preventDefault();
        }
        if (e.key === "Escape" && (this.selection.length || this.link)) {
          this.select([]);
          e.stopPropagation();
        }
      },
      { signal },
    );
    // As the page around it changes (a panel sliding open, the window resized) an automatic
    // view follows it, easing each frame toward the view that fits the space there is now:
    // the drawing moves once, with the panel, rather than being cut off by it and gliding
    // back afterwards. A view the person set stays where it is on the page.
    this.observer = new ResizeObserver(() => {
      const width = this.element.clientWidth,
        height = this.element.clientHeight,
        was = this.size;
      this.size = { width, height };
      if (!this.automatic) return this.paint();
      if (!was.width || !was.height) return this.fit(false);
      this.follow();
    });
    this.observer.observe(this.element);
    const first = this.renderer;
    this.ready = first.mount().finally(() => {
      if (this.renderer !== first) return;
      first.element.style.visibility = "";
      // What is already drawn comes in at once, with only a short fade over the paper.
      if (this.options.motion)
        first.element.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 240,
          easing: "ease-out",
        });
      if (this.automatic) this.fit(false);
      else this.paint();
      // Opening a work or entering a scene shows what is already drawn as it is: only
      // what arrives while it is open unfolds.
      this.options.shown?.(scene);
    });
  }
  /** Keeps the selection on what is still drawn, as it is now. */
  private refresh(paint = true) {
    if (this.selection.length) this.select(this.selection);
    if (this.link && !this.renderer.links.has(this.link)) this.selectLink(null);
    if (paint) this.paint();
  }
  private renderFor(work: Work, scene: Scene) {
    return new SceneRenderer(work, scene, {
      open: (t) => this.options.open(t),
      error: (e) => this.options.error(e),
    });
  }
  /** Draws another revision of the scene off screen, then swaps it in: new modules unfold,
   * redrawn ones settle, moved ones glide and removed ones fade. A quiet update, for a
   * change the person made by hand, swaps it in as it is. */
  update(work: Work, scene: Scene, quiet = false) {
    // A change the person made is laid over what is drawn, redrawing only what changed.
    if (quiet && !this.pending && this.renderer.patchable(work, scene)) {
      const renderer = this.renderer;
      void renderer.patch(work, scene).then(
        () => {
          if (this.renderer !== renderer) return;
          this.refresh();
          this.options.shown?.(scene);
        },
        (e) => this.options.error(String(e)),
      );
      this.refresh();
      return;
    }
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
        text.style.cssText = `fill:${GRAPHITE};font:italic calc(12.5px / var(--zoom)) "Iowan Old Style","Songti SC",Georgia,serif;text-anchor:middle;dominant-baseline:central`;
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
    const now = performance.now();
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
          !done.has(l.from.moduleId) &&
          !done.has(l.to.moduleId))
      )
        continue;
      const ready = Math.max(
        done.get(l.from.moduleId) ?? 0,
        done.get(l.to.moduleId) ?? 0,
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
    // The paper's dots move with the drawing and keep a comfortable spacing at any zoom.
    let dots = 24 * scale;
    while (dots < 14) dots *= 2;
    while (dots > 42) dots /= 2;
    Object.assign(this.element.style, {
      backgroundSize: `${dots}px ${dots}px`,
      backgroundPosition: `${x}px ${y}px`,
    });
    this.element.style.setProperty("--zoom", String(scale));
    const box = (el: HTMLElement, b: Bounds) =>
      Object.assign(el.style, {
        display: "block",
        left: x + b.x * scale + "px",
        top: y + b.y * scale + "px",
        width: b.width * scale + "px",
        height: b.height * scale + "px",
      });
    const chosen = this.selection.flatMap((id) => {
      const m = this.renderer.instances.get(id);
      return m ? [{ ...m, bounds: this.ghost.get(id) ?? m.bounds }] : [];
    });
    while (this.outlines.length < chosen.length) {
      const outline = document.createElement("div");
      outline.style.cssText =
        "position:absolute;border:1px solid #3366d6;border-radius:6px;box-shadow:0 0 0 4px rgba(61,114,224,.12);pointer-events:none;display:none;z-index:3;box-sizing:border-box";
      this.element.append(outline);
      this.outlines.push(outline);
    }
    this.outlines.forEach((outline, i) =>
      chosen[i] ? box(outline, chosen[i].bounds) : (outline.style.display = "none"),
    );
    // The selection is resized as one by the handles on the box around it; while editing
    // a single module also offers the dots links are drawn from.
    if (chosen.length && this.movable) {
      const frame = union(chosen.map((m) => m.bounds));
      box(this.frame, frame);
      this.frame.style.border =
        chosen.length > 1 ? "1px dashed rgba(61,114,224,.7)" : "none";
      const small =
        frame.width * scale < 36 || frame.height * scale < 36;
      for (const h of this.frame.querySelectorAll<HTMLElement>("[data-handle]"))
        h.style.display =
          small && h.dataset.handle!.length === 1 ? "none" : "block";
      const linking =
        this.editing &&
        chosen.length === 1 &&
        !!this.options.connect &&
        (!this.gesture || this.gesture.kind === "press") &&
        this.tool === "select";
      for (const dot of this.dots.values())
        dot.style.display = linking ? "block" : "none";
    } else this.frame.style.display = "none";
    // A grouped module shows the box of the group it moves with.
    const group =
      this.editing && chosen.length === 1 && chosen[0].group
        ? [...this.renderer.instances.values()].filter(
            (m) => m.group === chosen[0].group,
          )
        : [];
    if (group.length > 1) {
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
    this.paintLinks();
    this.paintTargets();
    for (const fn of this.watchers) fn();
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
  /** The hovered and the selected link traced over, and the selected link's ends. */
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
      this.hoveredLink !== this.link && !this.gesture ? d(this.hoveredLink) : "",
    );
    chosen.setAttribute("d", relinking ? "" : d(this.link));
    const link = this.link && this.editing ? this.renderer.links.get(this.link) : undefined;
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
  /** The link drawn nearest a point on screen, if one passes within a few pixels of it. */
  private linkAt(clientX: number, clientY: number) {
    const p = this.toScene(clientX, clientY),
      slop = SLOP / this.camera.scale;
    let best: string | null = null,
      nearest = slop;
    for (const id of this.renderer.links.keys()) {
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
    // A link is drawn over the backdrop, so there the link is what the press is on.
    if (drawn && !(link && this.beneath(drawn))) return { module: drawn };
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
  /** Where the selection is on screen: the box around the selected modules, or around
   * the selected link's lines. */
  selectionRect(): DOMRect | undefined {
    const r = this.element.getBoundingClientRect(),
      { x, y, scale } = this.camera;
    let b: Bounds | undefined;
    if (this.selection.length) {
      const boxes = this.selection.flatMap((id) => {
        const m = this.renderer.instances.get(id);
        return m ? [this.ghost.get(id) ?? m.bounds] : [];
      });
      if (boxes.length) b = union(boxes);
    } else if (this.link) {
      const t = this.traceOf(this.link);
      const points = t ? [...t.lines.flat(), ...t.boxes.flatMap((b) => [b, { x: b.x + b.width, y: b.y + b.height }])] : [];
      if (points.length) {
        const xs = points.map((p) => p.x),
          ys = points.map((p) => p.y);
        b = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      }
    }
    return b && new DOMRect(r.left + x + b.x * scale, r.top + y + b.y * scale, b.width * scale, b.height * scale);
  }
  /** The person moved the view: whatever glide or ease was under way gives way to it. */
  private changed() {
    this.stop();
    this.moved();
  }
  private moved(soon = false) {
    this.automatic = false;
    this.options.cameraChanged?.({ ...this.camera });
    if (soon) {
      if (!this.painting)
        this.painting = requestAnimationFrame(() => {
          this.painting = 0;
          this.paint();
        });
    } else this.paint();
  }
  private stop() {
    cancelAnimationFrame(this.gliding);
    this.easing = undefined;
    this.following = false;
  }
  /** The camera a step `t` of the way from `from` to `to`: the world point at `at` on
   * screen moves evenly while the scale changes at an even rate, so a zoom never seems to
   * speed up or slow down as it grows. */
  private between(from: Camera, to: Camera, t: number, at: Point): Camera {
    const a = { x: (at.x - from.x) / from.scale, y: (at.y - from.y) / from.scale },
      b = { x: (at.x - to.x) / to.scale, y: (at.y - to.y) / to.scale },
      scale = from.scale * (to.scale / from.scale) ** t;
    return {
      scale,
      x: at.x - (a.x + (b.x - a.x) * t) * scale,
      y: at.y - (a.y + (b.y - a.y) * t) * scale,
    };
  }
  /** Whether two views are the same to the eye. */
  private same(a: Camera, b: Camera) {
    return (
      Math.abs(a.scale / b.scale - 1) < 0.001 &&
      Math.abs(a.x - b.x) < 0.25 &&
      Math.abs(a.y - b.y) < 0.25
    );
  }
  /** Moves the view toward `to` over the next frames, `at` staying put, each frame
   * closing the gap by a share set by `pace` (ms); another call on the way retargets it. */
  private ease(to: Camera, at: Point, pace: number) {
    if (!this.options.motion) {
      this.camera = to;
      return this.changed();
    }
    const running = !!this.easing;
    this.easing = { to, at, pace };
    this.automatic = false;
    if (running) return;
    cancelAnimationFrame(this.gliding);
    this.following = false;
    let last = performance.now();
    const tick = (now: number) => {
      const e = this.easing;
      if (!e) return;
      const t = 1 - Math.exp(-Math.max(0, now - last) / e.pace);
      last = now;
      this.camera = this.between(this.camera, e.to, t, e.at);
      if (this.same(this.camera, e.to)) {
        this.camera = e.to;
        this.easing = undefined;
      } else this.gliding = requestAnimationFrame(tick);
      this.moved();
    };
    this.gliding = requestAnimationFrame(tick);
  }
  /** An ease still under way stops where it is: a press works on what is under the
   * pointer as the person sees it, not on a view that keeps sliding under them. */
  private hold() {
    if (!this.easing) return;
    this.stop();
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
  /** The view that fits the whole composition in the space left between the controls. */
  private fitted() {
    const { top, bottom } = this.options.insets?.() || { top: 0, bottom: 80 },
      height = this.element.clientHeight - top - bottom;
    const target = fit(
      union([
        ...[...this.renderer.instances.values()].map((m) => m.bounds),
        ...[...this.sketches.values()].map((s) => s.bounds),
      ]),
      this.element.clientWidth,
      height,
    );
    target.y += top;
    return { target, centre: { x: this.element.clientWidth / 2, y: top + height / 2 } };
  }
  fit(glide = true, duration = 1100) {
    this.automatic = true;
    const { target, centre } = this.fitted();
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
    this.stop();
    if (!glide || !this.options.motion) {
      this.camera = target;
      this.paint();
      return;
    }
    // Glide around the view's centre in world space, zooming at an even pace.
    const from = { ...this.camera },
      start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration),
        e = 1 - (1 - t) ** 4;
      this.camera = this.between(from, target, e, centre);
      this.paint();
      if (t < 1) this.gliding = requestAnimationFrame(tick);
    };
    this.gliding = requestAnimationFrame(tick);
  }
  /** An automatic view keeping up with the canvas as it changes size, each frame easing
   * toward what fits now, until the size has held still and the view has arrived. */
  private follow() {
    this.resizedAt = performance.now();
    if (!this.options.motion) return this.fit(false);
    // Already following: the next frame takes the new size.
    if (this.following) return;
    this.stop();
    this.following = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (!this.automatic) return void (this.following = false);
      const t = 1 - Math.exp(-Math.max(0, now - last) / 70);
      last = now;
      const { target, centre } = this.fitted();
      this.camera = this.between(this.camera, target, t, centre);
      const done = this.same(this.camera, target) && now - this.resizedAt > 120;
      if (done) this.camera = target;
      this.paint();
      if (done) this.following = false;
      else this.gliding = requestAnimationFrame(tick);
    };
    this.gliding = requestAnimationFrame(tick);
  }
  private following = false;
  /** Zooms by `factor` about the middle of the canvas, easing there. */
  zoom(factor: number) {
    const at = { x: this.element.clientWidth / 2, y: this.element.clientHeight / 2 };
    this.ease(zoom(this.easing?.to ?? this.camera, at, factor), at, 60);
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
  /** What a press does while editing: select and move, move the view, or place something
   * where it lands. */
  setTool(tool: "select" | "hand" | "place") {
    this.tool = tool;
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
        : this.tool === "place"
          ? "crosshair"
          : "";
    this.element.toggleAttribute(
      "data-panning",
      this.editing && (this.spacing || this.tool !== "select"),
    );
  }
  /** Selects every module in the scene. */
  selectAll() {
    this.select([...this.renderer.instances.keys()]);
  }
  get selected() {
    return [...this.selection];
  }
  select(ids: string[]) {
    this.selection = ids.filter((id) => this.renderer.instances.has(id));
    if (this.link && (this.selection.length || !ids.length)) {
      this.link = null;
      this.options.selectLink?.(null);
    }
    this.options.select(
      this.selection.map((id) => {
        const m = this.renderer.instances.get(id)!;
        return { moduleId: m.id, label: shownName(this.renderer.work, m), data: m.data };
      }),
    );
    this.paint();
  }
  /** Selects a link, leaving no module selected, or no link. */
  selectLink(id: string | null) {
    const next = id && this.renderer.links.has(id) ? id : null;
    if (next && this.selection.length) {
      this.selection = [];
      this.options.select([]);
    }
    if (next !== this.link) {
      this.link = next;
      this.options.selectLink?.(next);
    }
    this.paint();
  }
  get selectedLink() {
    return this.link;
  }
  /** The middle of the view, in scene units, clear of the controls laid over it. */
  center() {
    const { top, bottom } = this.options.insets?.() || { top: 0, bottom: 80 };
    const { x, y, scale } = this.camera;
    return {
      x: (this.element.clientWidth / 2 - x) / scale,
      y: (top + (this.element.clientHeight - top - bottom) / 2 - y) / scale,
    };
  }
  /** How many screen pixels a scene unit takes now. */
  get scale() {
    return this.camera.scale;
  }
  /** Where a module is on screen. */
  rectOf(id: string) {
    const m = this.renderer.instances.get(id);
    if (!m) return undefined;
    const r = this.element.getBoundingClientRect(),
      { x, y, scale } = this.camera;
    return new DOMRect(
      r.left + x + m.bounds.x * scale,
      r.top + y + m.bounds.y * scale,
      m.bounds.width * scale,
      m.bounds.height * scale,
    );
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
  /** Moves modules by a distance in scene units, until the move is committed. */
  nudge(ids: string[], dx: number, dy: number) {
    const moves = ids.flatMap((id) => {
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
        pictures.find((p) => new URL(href, location.href).pathname === p.url)
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
    let el: Element | null = inner.closest("tspan,text");
    if (!el) {
      el = inner;
      while (el && !own(el)) el = el.parentElement;
    }
    const text = el && (el.closest("text,tspan") ? el.textContent!.trim() : own(el));
    if (!el || !text) return;
    e.preventDefault();
    getSelection()?.removeAllRanges();
    const words = el;
    this.options.point({
      kind: "text",
      moduleId,
      text,
      place: () => {
        const rect = words.getBoundingClientRect();
        return {
          rect,
          // An HTML element's type is scaled by how much larger it shows than it lays out.
          size:
            words instanceof HTMLElement
              ? parseFloat(getComputedStyle(words).fontSize) *
                (rect.width / (words.offsetWidth || rect.width))
              : rect.height * 0.8,
        };
      },
    });
  }
  /** The first words a module draws, to change where they are as a double click on them
   * would. */
  wordsIn(moduleId: string): Extract<Pointed, { kind: "text" }> | undefined {
    const root = this.renderer.host("module", moduleId)?.shadowRoot;
    if (!root) return undefined;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode,
        parent = node.parentElement;
      const text = node.textContent?.trim();
      if (!text || !parent || parent.closest("style,script,defs")) continue;
      const words = parent.closest("text") ?? parent;
      const rect = words.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      return {
        kind: "text",
        moduleId,
        text: words instanceof SVGElement ? words.textContent!.trim() : text,
        place: () => {
          const rect = words.getBoundingClientRect();
          return {
            rect,
            size:
              words instanceof HTMLElement
                ? parseFloat(getComputedStyle(words).fontSize) *
                  (rect.width / (words.offsetWidth || rect.width))
                : rect.height * 0.8,
          };
        },
      };
    }
    return undefined;
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
    if (!words || !text || !this.options.point) return;
    e.preventDefault();
    getSelection()?.removeAllRanges();
    this.options.point({
      kind: "text",
      moduleId: linkId,
      link: true,
      text,
      place: () => {
        const rect = words.getBoundingClientRect();
        return { rect, size: rect.height * 0.8 };
      },
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
    // Lines and pages, as some mice and browsers count, in pixels.
    const unit =
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.element.clientHeight : 1;
    const dx = e.deltaX * unit,
      dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      const rect = this.element.getBoundingClientRect(),
        at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // A pinch arrives as many small steps; a mouse wheel's notch as one large one, kept
      // to a comfortable step and eased, so it zooms rather than jumps.
      const step = Math.max(-60, Math.min(60, dy));
      this.ease(zoom(this.easing?.to ?? this.camera, at, Math.exp(-step * 0.008)), at, 40);
      return;
    }
    // Scrolling moves the view, and where an ease is heading with it.
    for (const c of this.easing ? [this.camera, this.easing.to] : [this.camera]) {
      c.x -= dx;
      c.y -= dy;
    }
    if (this.easing) this.moved();
    else {
      this.stop();
      this.moved(true);
    }
  }
  /** A point on screen in scene units. */
  private toScene(clientX: number, clientY: number): Point {
    const r = this.element.getBoundingClientRect(),
      { x, y, scale } = this.camera;
    return { x: (clientX - r.left - x) / scale, y: (clientY - r.top - y) / scale };
  }
  private down(e: PointerEvent) {
    if (
      (e.button !== 0 && e.button !== 1) ||
      (!this.editing && this.interactive(e))
    )
      return;
    this.hold();
    // While editing, a press on the canvas leaves any field in the panel, which keeps it.
    if (this.editing) this.element.focus({ preventScroll: true });
    const start = { x: e.clientX, y: e.clientY, moved: false };
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
    if (this.editing && this.tool === "place") {
      e.preventDefault();
      this.options.place?.(this.toScene(e.clientX, e.clientY));
      return;
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
    // An end of the selected link is dragged onto another module, or another side.
    const end = control?.dataset.linkEnd as "from" | "to" | undefined;
    if (end && this.link) {
      this.gesture = { ...start, kind: "relink", linkId: this.link, end };
      this.paint();
      return capture();
    }
    const { module: m, link } = this.pick(e.clientX, e.clientY);
    // A press on a link while editing selects it.
    if (link && this.editing && !m) {
      this.selectLink(link);
      this.gesture = { ...start, kind: "press" };
      return capture();
    }
    // Pressing a module selects it; dragging one already selected moves it, and dragging
    // anything else moves the view. While editing, any module pressed can be dragged at
    // once, Shift adds a module to the selection or takes it out, and dragging over the
    // paper draws a box that selects what it touches.
    const was = this.selection.includes(m?.id ?? "");
    if (this.editing && e.shiftKey && m)
      this.select(
        was
          ? this.selection.filter((id) => id !== m.id)
          : [...this.selection, m.id],
      );
    else if (m && !was) this.select([m.id]);
    else if (!m && !(this.editing && e.shiftKey)) this.select([]);
    if (!m && this.editing) {
      this.gesture = {
        ...start,
        kind: "marquee",
        start: this.toScene(e.clientX, e.clientY),
        base: e.shiftKey ? [...this.selection] : [],
        picked: "",
      };
      return capture();
    }
    const held = !!m && this.selection.includes(m.id) && (was || this.editing);
    if (this.movable && held) {
      // A grouped module takes its group along, unless Alt is held.
      const moving = [
        ...new Set(
          chosen().flatMap((d) =>
            d.group && !e.altKey
              ? [...this.renderer.instances.values()].filter(
                  (v) => v.group === d.group,
                )
              : [d],
          ),
        ),
      ];
      this.gesture = {
        ...start,
        kind: "move",
        moves: moving.map((v) => ({ id: v.id, bounds: { ...v.bounds } })),
        others: others(new Set(moving.map((v) => v.id))),
      };
    } else this.gesture = { ...start, kind: "pan", camera: { ...this.camera } };
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
  /** The size or place of what is dragged, in a tag under it. */
  private showReadout(text: string | null, b?: Bounds) {
    if (!text || !b) return void (this.readout.style.display = "none");
    const { x, y, scale } = this.camera;
    this.readout.textContent = text;
    Object.assign(this.readout.style, {
      display: "block",
      left: x + (b.x + b.width / 2) * scale + "px",
      top: y + (b.y + b.height) * scale + 10 + "px",
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
  private sideToward(m: Instance, clientX: number, clientY: number) {
    const side = facing(m.bounds, this.toScene(clientX, clientY)),
      a = sidePoint[side],
      { x, y, scale } = this.camera,
      b = this.ghost.get(m.id) ?? m.bounds;
    return {
      side,
      x: x + (b.x + a.x * b.width) * scale,
      y: y + (b.y + a.y * b.height) * scale,
    };
  }
  /** A dashed line from a point on screen to the pointer, or to the side of the module it
   * is over, which is marked. */
  private drawLine(from: Point, e: PointerEvent, skip: string) {
    const r = this.element.getBoundingClientRect();
    const over = this.moduleAt(e.clientX, e.clientY);
    const target = over && over.id !== skip ? over : undefined;
    const toward = target && this.sideToward(target, e.clientX, e.clientY);
    const ex = toward ? toward.x : e.clientX - r.left,
      ey = toward ? toward.y : e.clientY - r.top;
    this.line.style.display = "block";
    const [line, dot, ring] = [...this.line.children] as SVGElement[];
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(ex));
    line.setAttribute("y2", String(ey));
    dot.setAttribute("cx", String(ex));
    dot.setAttribute("cy", String(ey));
    ring.style.display = toward ? "" : "none";
    if (toward) {
      ring.setAttribute("cx", String(toward.x));
      ring.setAttribute("cy", String(toward.y));
    }
    this.hoverOver(target?.id ?? null);
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
    if (!g) {
      if (this.editing && this.tool === "select" && !this.spacing) {
        const { module: m, link } = this.pick(e.clientX, e.clientY);
        this.hoverOver(m?.id ?? null, m ? null : (link ?? null));
        this.element.style.cursor = !m && link ? "pointer" : "";
      }
      return;
    }
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) > 3) g.moved = true;
    if (!g.moved) return;
    const scale = this.camera.scale;
    // Snapping lines a dragged box up with its neighbours; Cmd or Ctrl turns it off.
    const snapping = this.editing && !e.metaKey && !e.ctrlKey;
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
      if (snapping) {
        const s = snap(
          { ...frame, x: frame.x + mx, y: frame.y + my },
          g.others,
          threshold,
        );
        mx += s.dx;
        my += s.dy;
        guides = s.guides;
      }
      this.showGuides(guides);
      g.last = g.moves.map((m) => ({
        id: m.id,
        bounds: { ...m.bounds, x: m.bounds.x + mx, y: m.bounds.y + my },
      }));
      this.drag(g.last);
      const now = { ...frame, x: frame.x + mx, y: frame.y + my };
      if (this.editing) this.showReadout(`${round(now.x)}, ${round(now.y)}`, now);
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
      this.showGuides(guides);
      g.last = g.moves.map((m) => ({
        id: m.id,
        bounds: g.moves.length === 1 ? next : scaled(m.bounds, g.frame, next),
      }));
      this.drag(g.last);
      if (this.editing)
        this.showReadout(`${round(next.width)} × ${round(next.height)}`, next);
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
      // What the box touches is selected as it is drawn.
      const hits = [...this.renderer.instances.values()]
        .filter(
          (m) =>
            m.bounds.x < box.x + box.width &&
            box.x < m.bounds.x + m.bounds.width &&
            m.bounds.y < box.y + box.height &&
            box.y < m.bounds.y + m.bounds.height,
        )
        .map((m) => m.id);
      const picked = [...new Set([...g.base, ...hits])];
      if (picked.join() !== g.picked) {
        g.picked = picked.join();
        this.select(picked);
      }
    } else if (g.kind === "connect") {
      const from = this.renderer.instances.get(g.from.moduleId);
      if (!from) return;
      const a = sidePoint[g.from.side],
        { x, y } = this.camera;
      this.drawLine(
        {
          x: x + (from.bounds.x + a.x * from.bounds.width) * scale,
          y: y + (from.bounds.y + a.y * from.bounds.height) * scale,
        },
        e,
        from.id,
      );
    } else if (g.kind === "relink") {
      const link = this.renderer.links.get(g.linkId);
      if (!link) return;
      const far = g.end === "from" ? "to" : "from",
        p = this.renderer.ends(link)[far],
        { x, y } = this.camera;
      this.drawLine({ x: x + p.x * scale, y: y + p.y * scale }, e, link[far].moduleId);
    }
    this.paint();
  }
  private finish() {
    this.gesture = undefined;
    this.ghost.clear();
    this.marquee.style.display = "none";
    this.line.style.display = "none";
    this.showGuides([]);
    this.showReadout(null);
    this.cursor();
    this.paint();
  }
  /** A gesture the system took away: what it moved goes back. */
  private cancel() {
    const g = this.gesture;
    if (g && (g.kind === "move" || g.kind === "resize")) this.drag(g.moves);
    this.finish();
  }
  private up(e: PointerEvent) {
    const g = this.gesture;
    if (!g) return;
    if (this.element.hasPointerCapture(e.pointerId))
      this.element.releasePointerCapture(e.pointerId);
    this.finish();
    if (g.moved && (g.kind === "move" || g.kind === "resize") && g.last) {
      this.changed();
      this.options.commit?.(g.last.map((m) => ({ id: m.id, bounds: { ...m.bounds } })));
    }
    if ((g.kind === "connect" || g.kind === "relink") && g.moved) {
      const to = this.moduleAt(e.clientX, e.clientY);
      const at = to && { moduleId: to.id, side: facing(to.bounds, this.toScene(e.clientX, e.clientY)) };
      if (g.kind === "connect" && at && at.moduleId !== g.from.moduleId)
        this.options.connect?.(g.from, at);
      if (g.kind === "relink" && at) {
        const link = this.renderer.links.get(g.linkId);
        const fixed = link?.[g.end === "from" ? "to" : "from"];
        if (fixed && at.moduleId !== fixed.moduleId)
          this.options.reconnect?.(g.linkId, g.end, at);
      }
      this.hoverOver(null);
    }
    if (!g.moved && !this.editing && this.selection.length === 1) {
      const target = this.renderer.instances.get(this.selection[0])!.target;
      if (target) this.options.open(target);
    }
  }
  dispose() {
    cancelAnimationFrame(this.gliding);
    cancelAnimationFrame(this.painting);
    this.abort.abort();
    this.observer.disconnect();
    this.pending?.dispose();
    this.renderer.dispose();
    this.element.remove();
  }
}
