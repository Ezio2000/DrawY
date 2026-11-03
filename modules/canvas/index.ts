import { SceneRenderer } from "../runtime/scene.ts";
import { fit, union, zoom, type Camera } from "../contracts/geometry.ts";
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
      moduleId: string;
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
const GRAPHITE = "rgba(94,88,76,.5)";
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
  private outlines: HTMLDivElement[] = [];
  private hovered: string | null = null;
  private hover = document.createElement("div");
  /** The box around the selection, with its handles, and the dots links are drawn from. */
  private frame = document.createElement("div");
  private dots = new Map<Side, HTMLButtonElement>();
  /** The box around the group of a selected module. */
  private groupBox = document.createElement("div");
  private marquee = document.createElement("div");
  private guides: HTMLDivElement[] = [];
  private line = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  /** What a press does while editing: select and move, move the view, or place. */
  private tool: "select" | "hand" | "place" = "select";
  /** The space bar held: the view moves under a drag, whatever the tool. */
  private spacing = false;
  private observer: ResizeObserver;
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
      }
    | {
        kind: "resize";
        handle: Handle;
        frame: Bounds;
        moves: { id: string; bounds: Bounds }[];
        others: Bounds[];
      }
    | { kind: "marquee"; start: Point; base: string[]; picked: string }
    | { kind: "connect"; from: { moduleId: string; side: Side } }
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
    this.hover.style.cssText =
      "position:absolute;border:1px dashed rgba(193,95,60,.55);border-radius:6px;pointer-events:none;display:none;z-index:3;box-sizing:border-box";
    this.element.append(this.hover);
    const english = /^en/i.test(document.documentElement.lang);
    this.frame.style.cssText =
      "position:absolute;pointer-events:none;display:none;z-index:4;box-sizing:border-box";
    this.frame.dataset.canvasControl = "";
    for (const h of handles) {
      const handle = document.createElement("button");
      handle.dataset.handle = h;
      handle.dataset.canvasControl = "";
      handle.tabIndex = -1;
      handle.setAttribute("aria-label", english ? "Resize" : "调整大小");
      const x = h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%",
        y = h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%";
      const cursor = { nw: "nwse", se: "nwse", ne: "nesw", sw: "nesw", n: "ns", s: "ns", e: "ew", w: "ew" }[h];
      handle.style.cssText = `position:absolute;left:${x};top:${y};width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:2px;background:#fff;border:1.5px solid #d97757;pointer-events:auto;cursor:${cursor}-resize;padding:0;box-sizing:border-box`;
      this.frame.append(handle);
    }
    for (const side of sides) {
      const dot = document.createElement("button");
      dot.dataset.connect = side;
      dot.dataset.canvasControl = "";
      dot.tabIndex = -1;
      dot.setAttribute("aria-label", english ? "Draw a link" : "拖出连线");
      dot.title = english ? "Drag to another element to link them" : "拖到另一个元素上连线";
      const at = sidePoint[side];
      const out = 16;
      dot.style.cssText = `position:absolute;left:calc(${at.x * 100}% + ${(at.x - 0.5) * 2 * out * (at.y === 0.5 ? 1 : 0)}px);top:calc(${at.y * 100}% + ${(at.y - 0.5) * 2 * out * (at.x === 0.5 ? 1 : 0)}px);width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:#d97757;box-shadow:0 0 0 2.5px #fff,0 1px 3px rgba(0,0,0,.2);pointer-events:auto;cursor:crosshair;padding:0;opacity:.75`;
      this.dots.set(side, dot);
      this.frame.append(dot);
    }
    this.element.append(this.frame);
    this.groupBox.style.cssText =
      "position:absolute;border:1px dashed rgba(217,119,87,.45);border-radius:8px;pointer-events:none;display:none;z-index:3;box-sizing:border-box";
    this.element.append(this.groupBox);
    this.marquee.style.cssText =
      "position:absolute;border:1px solid rgba(217,119,87,.8);background:rgba(217,119,87,.07);pointer-events:none;display:none;z-index:5;box-sizing:border-box";
    this.element.append(this.marquee);
    this.line.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;z-index:5;overflow:visible";
    this.line.innerHTML =
      '<line stroke="#d97757" stroke-width="1.5" stroke-dasharray="5 4" stroke-linecap="round"/><circle r="4" fill="#d97757"/>';
    this.element.append(this.line);
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
      () => this.hoverOver(null),
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
        const m = this.moduleAt(e.clientX, e.clientY);
        if (m && !this.selection.includes(m.id)) this.select([m.id]);
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
        if (e.key === "Escape" && this.selection.length) {
          this.select([]);
          e.stopPropagation();
        }
      },
      { signal },
    );
    this.observer = new ResizeObserver(() => {
      if (this.automatic) this.fit(false);
      else this.paint();
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
      // The selection stays on what is still there, as it is now.
      if (this.selection.length) this.select(this.selection);
      if (this.automatic && !quiet) this.fit(true);
      else this.paint();
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
      return m ? [m] : [];
    });
    while (this.outlines.length < chosen.length) {
      const outline = document.createElement("div");
      outline.style.cssText =
        "position:absolute;border:1px solid #d97757;border-radius:6px;box-shadow:0 0 0 4px rgba(217,119,87,.12);pointer-events:none;display:none;z-index:3;box-sizing:border-box";
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
        chosen.length > 1 ? "1px dashed rgba(217,119,87,.7)" : "none";
      const small =
        frame.width * scale < 36 || frame.height * scale < 36;
      for (const h of this.frame.querySelectorAll<HTMLElement>("[data-handle]"))
        h.style.display =
          small && h.dataset.handle!.length === 1 ? "none" : "block";
      const linking =
        this.editing &&
        chosen.length === 1 &&
        !!this.options.connect &&
        !this.gesture &&
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
      const g = union(group.map((m) => m.bounds));
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
  fit(glide = true) {
    this.automatic = true;
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
    cancelAnimationFrame(this.gliding);
    if (!glide || !this.options.motion) {
      this.camera = target;
      this.paint();
      return;
    }
    // Glide around the view's centre in world space, zooming at an even pace.
    const from = { ...this.camera },
      w = this.element.clientWidth / 2,
      h = top + height / 2,
      a = { x: (w - from.x) / from.scale, y: (h - from.y) / from.scale },
      b = {
        x: (w - target.x) / target.scale,
        y: (h - target.y) / target.scale,
      },
      start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1100),
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
    this.options.select(
      this.selection.map((id) => {
        const m = this.renderer.instances.get(id)!;
        return { moduleId: m.id, label: m.label, data: m.data };
      }),
    );
    this.paint();
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
  /** Shows a module with other data while a change to it is being made. */
  preview(id: string, data: Record<string, unknown>) {
    void this.renderer.redraw(id, data);
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
  private moduleAt(x: number, y: number) {
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
    const area = (b: Bounds) => b.width * b.height;
    return hosts
      .flatMap((h) => of(h) ?? [])
      .sort((a, b) => area(a.bounds) - area(b.bounds))[0];
  }
  private hoverOver(id: string | null) {
    if (this.hovered === id) return;
    this.hovered = id;
    this.paint();
  }
  /** The words or picture under a double click, and the module they belong to. The press
   * before it held the pointer, so the click lands on the canvas; what is under it is
   * found by where it is. */
  private dblclick(e: MouseEvent) {
    const moduleId = this.moduleAt(e.clientX, e.clientY)?.id;
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
      const rect = this.element.getBoundingClientRect();
      this.camera = zoom(
        this.camera,
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        Math.exp(-e.deltaY * 0.008),
      );
    } else {
      this.camera.x -= e.deltaX;
      this.camera.y -= e.deltaY;
    }
    this.changed();
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
    // A handle on the selection's box resizes the selection as one.
    const handle = target.dataset?.handle as Handle | undefined;
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
    const side = target.dataset?.connect as Side | undefined;
    if (side && this.selection.length === 1) {
      this.gesture = {
        ...start,
        kind: "connect",
        from: { moduleId: this.selection[0], side },
      };
      return capture();
    }
    const m = this.moduleAt(e.clientX, e.clientY);
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
  private move(e: PointerEvent) {
    const g = this.gesture;
    if (!g) {
      if (this.editing && this.tool === "select" && !this.spacing)
        this.hoverOver(this.moduleAt(e.clientX, e.clientY)?.id ?? null);
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
      if (snapping) {
        const frame = union(g.moves.map((m) => m.bounds));
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
      void this.renderer.move(
        g.moves.map((m) => ({
          id: m.id,
          bounds: { ...m.bounds, x: m.bounds.x + mx, y: m.bounds.y + my },
        })),
      );
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
      void this.renderer.move(
        g.moves.map((m) => ({
          id: m.id,
          bounds:
            g.moves.length === 1 ? next : scaled(m.bounds, g.frame, next),
        })),
      );
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
      const r = this.element.getBoundingClientRect();
      const from = this.renderer.instances.get(g.from.moduleId);
      if (!from) return;
      const a = sidePoint[g.from.side],
        { x, y } = this.camera;
      const sx = x + (from.bounds.x + a.x * from.bounds.width) * scale,
        sy = y + (from.bounds.y + a.y * from.bounds.height) * scale,
        ex = e.clientX - r.left,
        ey = e.clientY - r.top;
      this.line.style.display = "block";
      const line = this.line.querySelector("line")!,
        dot = this.line.querySelector("circle")!;
      line.setAttribute("x1", String(sx));
      line.setAttribute("y1", String(sy));
      line.setAttribute("x2", String(ex));
      line.setAttribute("y2", String(ey));
      dot.setAttribute("cx", String(ex));
      dot.setAttribute("cy", String(ey));
      const over = this.moduleAt(e.clientX, e.clientY);
      this.hoverOver(over && over.id !== from.id ? over.id : null);
    }
    this.paint();
  }
  private finish() {
    this.gesture = undefined;
    this.marquee.style.display = "none";
    this.line.style.display = "none";
    this.showGuides([]);
    this.cursor();
    this.paint();
  }
  /** A gesture the system took away: what it moved goes back. */
  private cancel() {
    const g = this.gesture;
    if (g && (g.kind === "move" || g.kind === "resize"))
      void this.renderer.move(g.moves);
    this.finish();
  }
  private up(e: PointerEvent) {
    const g = this.gesture;
    if (!g) return;
    if (this.element.hasPointerCapture(e.pointerId))
      this.element.releasePointerCapture(e.pointerId);
    this.finish();
    if (g.moved && (g.kind === "move" || g.kind === "resize")) {
      this.changed();
      this.options.commit?.(
        g.moves.map((m) => ({
          id: m.id,
          bounds: { ...this.renderer.instances.get(m.id)!.bounds },
        })),
      );
    }
    if (g.kind === "connect" && g.moved) {
      const to = this.moduleAt(e.clientX, e.clientY);
      if (to && to.id !== g.from.moduleId)
        this.options.connect?.(g.from, {
          moduleId: to.id,
          side: facing(to, this.toScene(e.clientX, e.clientY)),
        });
      this.hoverOver(null);
    }
    if (!g.moved && !this.editing && this.selection.length === 1) {
      const target = this.renderer.instances.get(this.selection[0])!.target;
      if (target) this.options.open(target);
    }
  }
  dispose() {
    cancelAnimationFrame(this.gliding);
    this.abort.abort();
    this.observer.disconnect();
    this.pending?.dispose();
    this.renderer.dispose();
    this.element.remove();
  }
}
