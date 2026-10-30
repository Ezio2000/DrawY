import { SceneRenderer } from "../runtime/scene.ts";
import { fit, union, zoom, type Camera } from "../contracts/geometry.ts";
import { plan, play, gesture, hatching, along, type Mark } from "./ink.ts";
import type {
  Bounds,
  Instance,
  Scene,
  Selection,
  Sketch,
  Target,
  Work,
} from "../contracts/index.ts";
export interface CanvasOptions {
  camera?: Camera;
  editing?: boolean;
  /** Unfold drawings as they appear and glide the camera between compositions. */
  motion?: boolean;
  /** Screen space kept clear above and below the automatic view, for controls laid over
   * the canvas. */
  insets?: { top: number; bottom: number };
  open: (target: Target) => void;
  select: (selection: Selection | null) => void;
  cameraChanged?: (camera: Camera) => void;
  commit?: (moves: { id: string; bounds: Bounds }[]) => void;
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
  /** Holds the author's pen, which the canvas moves along whatever is being drawn. */
  readonly pen = document.createElement("div");
  private pending?: SceneRenderer;
  private sketches = new Map<
    string,
    {
      element: Element;
      bounds: Bounds;
      shaded: boolean;
      ground: boolean;
      /** Passes the pen has made over it while its drawing was being written. */
      passes: number;
    }
  >();
  private sketched = 0;
  private marks: (Mark & { at: number })[] = [];
  private present = false;
  private tip = { x: 0, y: 0 };
  private steering = 0;
  private steered = 0;
  private gliding = 0;
  private editing: boolean;
  private selected: string | null = null;
  private outline = document.createElement("div");
  private resize = document.createElement("button");
  private observer: ResizeObserver;
  private abort = new AbortController();
  private automatic: boolean;
  private gesture?: {
    x: number;
    y: number;
    camera: Camera;
    moves: { id: string; bounds: Bounds }[];
    resize: boolean;
    moved: boolean;
  };
  constructor(
    host: HTMLElement,
    work: Work,
    scene: Scene,
    readonly options: CanvasOptions,
  ) {
    this.editing = !!options.editing;
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
    this.pen.style.cssText =
      "position:absolute;left:0;top:0;z-index:4;pointer-events:none";
    this.pen.dataset.state = "away";
    this.element.append(this.pen);
    this.outline.style.cssText =
      "position:absolute;border:1px solid #d97757;border-radius:6px;box-shadow:0 0 0 4px rgba(217,119,87,.12);pointer-events:none;display:none;z-index:3;box-sizing:border-box";
    this.resize.style.cssText =
      "position:absolute;right:-6px;bottom:-6px;width:11px;height:11px;border-radius:50%;background:#fff;border:1.5px solid #d97757;pointer-events:auto;cursor:nwse-resize;padding:0";
    this.resize.setAttribute("aria-label", "调整模块大小");
    this.outline.append(this.resize);
    this.element.append(this.outline);
    const signal = this.abort.signal;
    this.element.addEventListener("wheel", (e) => this.wheel(e), {
      passive: false,
      signal,
    });
    this.element.addEventListener("pointerdown", (e) => this.down(e), {
      signal,
    });
    this.element.addEventListener("pointermove", (e) => this.move(e), {
      signal,
    });
    this.element.addEventListener("pointerup", (e) => this.up(e), { signal });
    this.element.addEventListener(
      "pointercancel",
      () => {
        if (this.gesture?.moves.length)
          void this.renderer.move(this.gesture.moves);
        this.gesture = undefined;
        this.paint();
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
        if (e.key === "Escape") this.select(null);
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
      if (this.automatic) this.fit(false);
      else this.paint();
      this.unfold(undefined, first);
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
   * redrawn ones settle, moved ones glide and removed ones fade. */
  update(work: Work, scene: Scene) {
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
      if (this.selected && !next.instances.has(this.selected))
        this.select(null);
      if (this.automatic) this.fit(true);
      else this.paint();
      this.unfold(before, next);
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
      if (this.present)
        this.marks.push({ start: 0, at, duration: 700, tip: along(path) });
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
    // While the pen is free and a drawing is still being written, it goes over the modules
    // that use it: a second line around the outline, then cross-hatching, then a slow trace.
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
      else if (this.present)
        this.marks.push({
          start: 0,
          at,
          duration: 2400,
          tip: along(sketch.element.querySelector("path")!),
        });
      at += pass === 1 ? 1500 : pass === 2 ? 1100 : 2400;
      this.steer();
    }
    this.sketched = at;
    if (added || wanted.size !== this.sketches.size) {
      if (this.automatic) this.fit(true);
      this.steer();
    }
  }
  /** Draws a pencil line into a sketch at a time on the pen's schedule, the pen following. */
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
    if (this.present)
      this.marks.push({ start: 0, at, duration, tip: along(path) });
  }
  /** Brings the author's pen onto the canvas while it works, and takes it away after. */
  attend(present: boolean) {
    if (this.present === present) return;
    this.present = present;
    if (present && this.pen.dataset.state === "away") {
      // It waits in the middle of a blank page, or just off the corner of a drawing.
      const { top, bottom } = this.options.insets || { top: 0, bottom: 80 },
        w = this.element.clientWidth,
        h = this.element.clientHeight - bottom,
        { x, y, scale } = this.camera,
        b = this.renderer.bounds;
      this.tip = this.renderer.instances.size
        ? {
            x: Math.min(w - 40, x + (b.x + b.width) * scale + 24),
            y: Math.min(h - 24, y + (b.y + b.height) * scale + 12),
          }
        : { x: w / 2, y: top + (h - top) / 2 };
    }
    if (!present) this.marks = [];
    this.steer();
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
  private follow(marks: Mark[], now: number) {
    if (!this.present) return;
    for (const m of marks) this.marks.push({ ...m, at: now + m.start });
    this.steer();
  }
  /** Moves the pen to the tip of the latest stroke, easing between strokes; at rest it waits
   * where it last drew. */
  private steer = () => {
    cancelAnimationFrame(this.steering);
    const now = performance.now(),
      dt = Math.min(64, now - this.steered || 16);
    this.steered = now;
    this.marks = this.marks.filter((m) => m.at + m.duration > now);
    const active = this.marks.filter((m) => m.at <= now).at(-1);
    const point = active?.tip(Math.min(1, (now - active.at) / active.duration));
    let state = this.present ? "resting" : "away";
    if (point) {
      const rect = this.element.getBoundingClientRect();
      const k = 1 - Math.exp(-dt / 40);
      this.tip.x += (point.x - rect.left - this.tip.x) * k;
      this.tip.y += (point.y - rect.top - this.tip.y) * k;
      state = "drawing";
    }
    this.pen.style.transform = `translate(${this.tip.x}px,${this.tip.y}px)`;
    this.pen.dataset.state = state;
    if (state !== "away" || this.marks.length)
      this.steering = requestAnimationFrame(this.steer);
  };
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
      this.follow(play(plans[i], starts[i] * pace, pace), now);
      done.set(m.id, (starts[i] + plans[i].time) * pace);
      this.erase(m.id, starts[i] * pace);
    });
    for (const m of after.instances.values())
      if (!done.has(m.id)) this.erase(m.id, 0);
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
      this.follow(play(plan(host), Math.max(0, ready - 150), pace), now);
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
    const m = this.selected && this.renderer.instances.get(this.selected);
    this.outline.style.display = m ? "block" : "none";
    this.resize.style.display = this.editing ? "block" : "none";
    if (m)
      Object.assign(this.outline.style, {
        left: x + m.bounds.x * scale + "px",
        top: y + m.bounds.y * scale + "px",
        width: m.bounds.width * scale + "px",
        height: m.bounds.height * scale + "px",
      });
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
    const { top, bottom } = this.options.insets || { top: 0, bottom: 80 },
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
  setEditing(value: boolean) {
    this.editing = value;
    this.paint();
  }
  select(id: string | null) {
    this.selected = id;
    const m = id && this.renderer.instances.get(id);
    this.options.select(
      m ? { moduleId: m.id, label: m.label, data: m.data } : null,
    );
    this.paint();
  }
  private interactive(e: Event) {
    return e
      .composedPath()
      .some(
        (n) =>
          n instanceof Element &&
          n !== this.resize &&
          n.matches("button,input,select,textarea,a,[data-interactive]"),
      );
  }
  private wheel(e: WheelEvent) {
    if (this.interactive(e)) return;
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
  private down(e: PointerEvent) {
    if ((e.button !== 0 && e.button !== 1) || this.interactive(e)) return;
    const node = e
      .composedPath()
      .find((n) => n instanceof HTMLElement && n.dataset.moduleId) as
      HTMLElement | undefined;
    const resizing = e.target === this.resize;
    const m = this.renderer.instances.get(
      resizing ? this.selected! : node?.dataset.moduleId || "",
    );
    if (m) this.select(m.id);
    else this.select(null);
    const moves =
      this.editing && m
        ? (m.group && !e.altKey && !resizing
            ? [...this.renderer.instances.values()].filter(
                (v) => v.group === m.group,
              )
            : [m]
          ).map((v) => ({ id: v.id, bounds: { ...v.bounds } }))
        : [];
    this.gesture = {
      x: e.clientX,
      y: e.clientY,
      camera: { ...this.camera },
      moves,
      resize: resizing,
      moved: false,
    };
    this.element.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  private move(e: PointerEvent) {
    const g = this.gesture;
    if (!g) return;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) > 3) g.moved = true;
    if (!g.moved) return;
    if (g.moves.length)
      this.renderer.move(
        g.moves.map((m) => ({
          id: m.id,
          bounds: g.resize
            ? {
                ...m.bounds,
                width: Math.max(16, m.bounds.width + dx / this.camera.scale),
                height: Math.max(16, m.bounds.height + dy / this.camera.scale),
              }
            : {
                ...m.bounds,
                x: m.bounds.x + dx / this.camera.scale,
                y: m.bounds.y + dy / this.camera.scale,
              },
        })),
      );
    else {
      this.camera = { ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy };
      this.changed();
    }
    this.paint();
  }
  private up(e: PointerEvent) {
    const g = this.gesture;
    if (!g) return;
    this.gesture = undefined;
    this.element.releasePointerCapture(e.pointerId);
    if (g.moved && g.moves.length) {
      this.changed();
      this.options.commit?.(
        g.moves.map((m) => ({
          id: m.id,
          bounds: { ...this.renderer.instances.get(m.id)!.bounds },
        })),
      );
    }
    if (!g.moved && !this.editing && this.selected) {
      const target = this.renderer.instances.get(this.selected)!.target;
      if (target) this.options.open(target);
    }
  }
  dispose() {
    cancelAnimationFrame(this.gliding);
    cancelAnimationFrame(this.steering);
    this.abort.abort();
    this.observer.disconnect();
    this.pending?.dispose();
    this.renderer.dispose();
    this.element.remove();
  }
}
