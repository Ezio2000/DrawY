import { SceneRenderer } from "../runtime/scene.ts";
import { fit, zoom, type Camera } from "../contracts/geometry.ts";
import type {
  Bounds,
  Scene,
  Selection,
  Target,
  Work,
} from "../contracts/index.ts";
export interface CanvasOptions {
  camera?: Camera;
  editing?: boolean;
  open: (target: Target) => void;
  select: (selection: Selection | null) => void;
  cameraChanged?: (camera: Camera) => void;
  commit?: (moves: { id: string; bounds: Bounds }[]) => void;
  error: (message: string) => void;
}
export class Canvas {
  readonly renderer: SceneRenderer;
  readonly element = document.createElement("div");
  readonly ready: Promise<void>;
  private camera: Camera = { x: 0, y: 0, scale: 1 };
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
      "position:relative;width:100%;height:100%;overflow:hidden;outline:none;background:radial-gradient(#dcd6c9 .7px,transparent .7px) 0 0/24px 24px";
    host.append(this.element);
    this.renderer = new SceneRenderer(work, scene, {
      open: options.open,
      error: options.error,
    });
    this.element.append(this.renderer.element);
    this.outline.style.cssText =
      "position:absolute;border:1.5px solid #d97757;pointer-events:none;display:none;z-index:3;box-sizing:border-box";
    this.resize.style.cssText =
      "position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;background:#fff;border:2px solid #d97757;pointer-events:auto;cursor:nwse-resize;padding:0";
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
      if (this.automatic) this.fit();
      else this.paint();
    });
    this.observer.observe(this.element);
    this.ready = this.renderer.mount().then(() => {
      if (this.automatic) this.fit();
      else this.paint();
    });
  }
  private paint() {
    const { x, y, scale } = this.camera;
    this.renderer.element.style.transformOrigin = "0 0";
    this.renderer.element.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
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
  fit() {
    this.automatic = true;
    this.camera = fit(
      this.renderer.bounds,
      this.element.clientWidth,
      this.element.clientHeight - 80,
    );
    this.paint();
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
    this.abort.abort();
    this.observer.disconnect();
    this.renderer.dispose();
    this.element.remove();
  }
}
