import type {
  Work,
  Scene,
  Instance,
  Point,
  Bounds,
  Target,
  MaterialUse,
} from "../contracts/index.ts";
import { union } from "../contracts/geometry.ts";

export interface SceneOptions {
  open: (target: Target) => void;
  error: (message: string) => void;
}
export interface DrawingAPI {
  data: Record<string, unknown>;
  width: number;
  height: number;
  theme: Record<string, string>;
  from?: Point;
  to?: Point;
  svg: (source: string) => SVGElement;
  html: (source: string) => HTMLElement;
  mermaid: (source: string) => Promise<Element>;
  plantuml: (source: string) => Promise<Element>;
  material: (id: string, options?: PictureOptions) => HTMLElement;
  materials: Record<string, PictureInfo>;
  draw: (
    id: string,
    data?: Record<string, unknown>,
    size?: { width: number; height: number },
  ) => Promise<Element>;
  effect: (id: string) => string;
  emit: (event: string, value?: unknown) => Promise<void>;
  cleanup: (fn: () => void) => void;
  animate: (fn: (seconds: number) => void) => void;
}
export interface PictureOptions {
  width?: number;
  height?: number;
  fit?: "contain" | "cover";
  /** Ink for an icon drawn in currentColor. */
  color?: string;
  /** How a whole painted picture meets the paper: feathered by default, or hard. */
  edge?: "feather" | "hard";
  /** Where a picture sits when the box is taller than it: on the bottom edge, as things
   * stand on the ground, unless centred or hung from the top. */
  align?: "bottom" | "center" | "top";
}
type Picture = Extract<MaterialUse, { kind: "picture" }>;
export interface PictureInfo {
  name: string;
  url: string;
  width: number;
  height: number;
  anchors: Picture["anchors"];
}
type Listener = (value: unknown) => unknown;
type View = { host: HTMLElement; cleanup: (() => void)[]; revision: number };
const execute = (source: string, api: object): Promise<unknown> =>
  new Function("api", `return (async()=>{${source}\n})()`)(api);
function svg(source: string) {
  const template = document.createElement("template");
  template.innerHTML = source;
  const element = template.content.querySelector("svg");
  if (!element) throw Error("画法缺少 SVG 元素");
  return element;
}
function html(source: string) {
  const root = document.createElement("div");
  root.innerHTML = source;
  return root;
}
let mermaidSequence = 0;
let mermaidQueue: Promise<unknown> = Promise.resolve();
async function mermaid(source: string) {
  const job = mermaidQueue.then(async () => {
    const m = (await import("mermaid")).default;
    m.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "neutral",
    });
    const result = await m.render("drawy-mermaid-" + ++mermaidSequence, source);
    const root = html(result.svg);
    result.bindFunctions?.(root);
    return root;
  });
  mermaidQueue = job.catch(() => {});
  return job;
}
async function plantuml(source: string) {
  const r = await fetch("/api/plantuml", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!r.ok) throw Error(await r.text());
  return svg(await r.text());
}

export class SceneRenderer {
  readonly element = document.createElement("div");
  readonly instances: Map<string, Instance>;
  private views = new Map<string, View>();
  private listeners = new Map<string, Set<Listener>>();
  private jobs = new Set<Promise<unknown>>();
  private interactionCleanup: (() => void)[] = [];
  private disposed = false;

  constructor(
    readonly work: Work,
    readonly scene: Scene,
    readonly options: SceneOptions,
  ) {
    this.instances = new Map(
      scene.modules.map((m) => [m.id, structuredClone(m)]),
    );
    this.element.style.cssText =
      "position:absolute;inset:0;pointer-events:none";
  }
  get bounds() {
    return union([...this.instances.values()].map((m) => m.bounds));
  }
  /** The element that holds a drawn module or link. */
  host(kind: "module" | "link", id: string) {
    return this.views.get(kind + ":" + id)?.host;
  }
  async mount() {
    await Promise.all(
      [...this.instances.values()].map((m) => this.drawModule(m)),
    );
    if (this.disposed) return;
    await this.drawLinks();
    if (this.disposed) return;
    if (this.scene.interactionId) {
      const api = {
        on: (id: string, event: string, fn: Listener) => {
          const key = JSON.stringify([id, event]);
          const set = this.listeners.get(key) || new Set();
          set.add(fn);
          this.listeners.set(key, set);
        },
        set: (id: string, data: Record<string, unknown>) => this.set(id, data),
        move: (id: string, x: number, y: number) =>
          this.move([
            { id, bounds: { ...this.instances.get(id)!.bounds, x, y } },
          ]),
        openScene: (id: string) => this.options.open({ kind: "scene", id }),
        openDetail: (id: string) => this.options.open({ kind: "detail", id }),
        cleanup: (fn: () => void) => this.interactionCleanup.push(fn),
        animate: (fn: (seconds: number) => void) =>
          this.animate(fn, this.interactionCleanup),
      };
      await this.track(
        execute(this.work.interactions[this.scene.interactionId].source, api),
      );
      if (this.disposed)
        for (const fn of this.interactionCleanup.splice(0)) fn();
    }
    await this.settled();
  }
  private use<K extends MaterialUse["kind"]>(id: string, kind: K) {
    const m = this.work.materials[id];
    if (!m)
      throw Error(
        `素材 ${id} 不在作品中：用 find_materials 或 generate_images 得到的 ID`,
      );
    if (m.kind !== kind) throw Error(`素材 ${id} 是 ${m.kind}，不是 ${kind}`);
    return m as Extract<MaterialUse, { kind: K }>;
  }
  /** Pictures whose pixels are still being made; they appear when ready. */
  private developing = new Set<Promise<void>>();
  /** Waits for every developing picture shown so far. */
  async developed() {
    while (this.developing.size) await Promise.all([...this.developing]);
  }
  private get pictures() {
    return Object.fromEntries(
      Object.values(this.work.materials)
        .filter((m): m is Picture => m.kind === "picture")
        .map((m) => [
          m.id,
          {
            name: m.name,
            url: m.url,
            width: m.width,
            height: m.height,
            anchors: m.anchors,
          },
        ]),
    );
  }
  /** A picture fitted by its visible content into a box (the module by default). */
  private picture(
    id: string,
    box: { width: number; height: number },
    o: PictureOptions = {},
  ) {
    const m = this.use(id, "picture");
    const width = o.width ?? box.width,
      height = o.height ?? box.height;
    const c = m.content;
    // The whole file's size in pixels, scaled so its visible content fits the box.
    const fw = m.width / c.width,
      fh = m.height / c.height;
    const k = (o.fit === "cover" ? Math.max : Math.min)(
      width / m.width,
      height / m.height,
    );
    const frame = document.createElement("div");
    frame.dataset.material = id;
    frame.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:${o.fit === "cover" ? "hidden" : "visible"}`;
    const img = document.createElement("img");
    img.alt = m.name;
    img.draggable = false;
    img.src =
      m.url +
      (o.color && m.recolor ? "?color=" + encodeURIComponent(o.color) : "");
    const spare = height - m.height * k;
    const top = { bottom: spare, center: spare / 2, top: 0 }[
      o.align ?? "bottom"
    ];
    img.style.cssText = `position:absolute;max-width:none;left:${(width - m.width * k) / 2 - c.x * fw * k}px;top:${top - c.y * fh * k}px;width:${fw * k}px;height:${fh * k}px`;
    // A painted picture fades into the paper instead of showing its rectangle.
    if (m.opaque && o.edge !== "hard") {
      const fade = (to: string) =>
        `linear-gradient(to ${to},transparent,#000 8%,#000 92%,transparent)`;
      img.style.maskImage =
        img.style.webkitMaskImage = `${fade("right")},${fade("bottom")}`;
      img.style.maskComposite = "intersect";
      img.style.setProperty("-webkit-mask-composite", "source-in");
    }
    if (m.status !== "ready") {
      img.dataset.developing = "";
      frame.dataset.developing = "";
      // Pencil hatching where the picture will appear, until it develops.
      const sketch = document.createElement("i");
      sketch.dataset.sketch = "";
      sketch.style.cssText = `left:${(width - m.width * k) / 2}px;top:${top}px;width:${m.width * k}px;height:${m.height * k}px`;
      frame.append(sketch);
      const loaded = new Promise<void>((resolve) => {
        img.addEventListener("load", () => {
          delete img.dataset.developing;
          delete frame.dataset.developing;
          sketch.remove();
          img
            .animate(
              [
                {
                  opacity: 0,
                  filter: "blur(12px) saturate(0) brightness(1.12)",
                },
                { opacity: 0.85, offset: 0.4 },
                { opacity: 1, filter: "none" },
              ],
              { duration: 1600, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
            )
            .finished.then(() => resolve(), () => resolve());
        });
        img.addEventListener("error", () => {
          this.options.error("图片没有生成出来: " + id);
          resolve();
        });
      });
      this.developing.add(loaded);
      void loaded.then(() => this.developing.delete(loaded));
    }
    frame.append(img);
    return frame;
  }
  private animate(fn: (seconds: number) => void, cleanup: (() => void)[]) {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      try {
        fn((now - start) / 1000);
      } catch (e) {
        this.options.error(String(e));
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    cleanup.push(() => cancelAnimationFrame(frame));
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.jobs.add(promise);
    void promise.finally(() => this.jobs.delete(promise)).catch(() => {});
    return promise;
  }
  async settled() {
    while (this.jobs.size) await Promise.all([...this.jobs]);
    await document.fonts.ready;
    // Pictures still developing appear on their own; they do not hold up the canvas.
    const images = [...this.views.values()].flatMap((v) =>
      Array.from(
        v.host.shadowRoot!.querySelectorAll<HTMLImageElement>(
          "img:not([data-developing])",
        ),
      ),
    );
    await Promise.all(
      images.map((i) =>
        i.decode().catch(() => this.options.error("图片加载失败: " + i.src)),
      ),
    );
  }
  private emit(id: string, event: string, value: unknown) {
    return this.track(
      Promise.all(
        [...(this.listeners.get(JSON.stringify([id, event])) || [])].map((fn) =>
          Promise.resolve().then(() => fn(value)),
        ),
      )
        .then(() => {})
        .catch((e) => this.options.error(String(e))),
    );
  }
  private draw(
    id: string,
    drawingId: string,
    bounds: Bounds,
    data: Record<string, unknown>,
    kind: "module" | "link",
    ends?: { from: Point; to: Point },
  ) {
    return this.track(
      (async () => {
        const key = kind + ":" + id;
        let view = this.views.get(key);
        if (!view) {
          const host = document.createElement("div");
          host.dataset[kind + "Id"] = id;
          host.style.cssText =
            "position:absolute;pointer-events:" +
            (kind === "module" ? "auto" : "none");
          host.attachShadow({ mode: "open" });
          view = { host, cleanup: [], revision: 0 };
          this.views.set(key, view);
          this.element.append(host);
        }
        const { host } = view;
        const revision = ++view.revision;
        Object.assign(host.style, {
          left: bounds.x + "px",
          top: bounds.y + "px",
          width: bounds.width + "px",
          height: bounds.height + "px",
          zIndex: kind === "module" ? "1" : "0",
        });
        for (const fn of view.cleanup.splice(0)) fn();
        const cleanup: (() => void)[] = [];
        view.cleanup = cleanup;
        const effects = new Set<string>();
        const apiFor = (
          data: Record<string, unknown>,
          size: { width: number; height: number },
        ): DrawingAPI => ({
          data,
          ...size,
          theme: this.work.style,
          ...ends,
          svg,
          html,
          mermaid,
          plantuml,
          material: (id, options) => this.picture(id, size, options),
          materials: this.pictures,
          draw: (id, data = {}, at = size) => {
            const m = this.use(id, "drawing");
            return execute(
              m.source,
              apiFor({ ...m.defaults, ...data }, at),
            ) as Promise<Element>;
          },
          effect: (id) => {
            this.use(id, "effect");
            effects.add(id);
            return `url(#fx-${id})`;
          },
          emit: (event, value) => this.emit(id, event, value),
          cleanup: (fn) => cleanup.push(fn),
          animate: (fn) => this.animate(fn, cleanup),
        });
        try {
          // The work's own definition, or a library drawing used as it is.
          const own = this.work.drawings[drawingId],
            library = own ? undefined : this.use(drawingId, "drawing");
          const result = await execute(
            own ? own.source : library!.source,
            apiFor(own ? data : { ...library!.defaults, ...data }, {
              width: bounds.width,
              height: bounds.height,
            }),
          );
          if (this.disposed || view.revision !== revision) {
            for (const fn of cleanup.splice(0)) fn();
            return;
          }
          if (!(result instanceof Element))
            throw Error("画法必须返回一个 DOM 或 SVG 元素");
          const style = document.createElement("style");
          style.textContent =
            ":host{display:block;color:var(--ink);font-family:var(--font)}*{box-sizing:border-box}svg{display:block;max-width:100%;max-height:100%}button,input,select{font:inherit}[data-sketch]{position:absolute;background:repeating-linear-gradient(-45deg,color-mix(in srgb,var(--ink,#333) 22%,transparent) 0 1px,transparent 1px 7px);-webkit-mask:radial-gradient(closest-side,#000 40%,transparent);mask:radial-gradient(closest-side,#000 40%,transparent);animation:developing 1.8s ease-in-out infinite alternate}img[data-developing]{visibility:hidden}@keyframes developing{from{opacity:.3}to{opacity:.85}}";
          const defs = [...effects].map((e) =>
            (
              this.work.materials[e] as Extract<MaterialUse, { kind: "effect" }>
            ).defs.replaceAll("$id", "fx-" + e),
          );
          const shared = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          shared.setAttribute("aria-hidden", "true");
          shared.style.cssText =
            "position:absolute;width:0;height:0;overflow:hidden";
          shared.innerHTML = "<defs>" + defs.join("") + "</defs>";
          for (const [k, v] of Object.entries(this.work.style))
            host.style.setProperty("--" + k, v);
          host.shadowRoot!.replaceChildren(
            style,
            ...(defs.length ? [shared] : []),
            result,
          );
          host.removeAttribute("data-error");
          if (kind === "module") {
            const m = this.instances.get(id)!;
            host.title = m.label;
            host.toggleAttribute("data-explorable", !!m.target);
          }
        } catch (e) {
          if (!this.disposed) {
            this.options.error(id + ": " + String(e));
            host.shadowRoot!.textContent = String(e);
            host.setAttribute("data-error", "");
          }
        }
      })(),
    );
  }
  private drawModule(m: Instance) {
    return this.draw(m.id, m.drawingId, m.bounds, m.data, "module");
  }
  private endpoint(end: { moduleId: string; anchor: string }) {
    const m = this.instances.get(end.moduleId)!,
      a = m.anchors[end.anchor];
    return {
      x: m.bounds.x + a.x * m.bounds.width,
      y: m.bounds.y + a.y * m.bounds.height,
    };
  }
  private drawLinks() {
    return Promise.all(
      this.scene.links.map((l) => {
        const from = this.endpoint(l.from),
          to = this.endpoint(l.to);
        const x = Math.min(from.x, to.x) - 48,
          y = Math.min(from.y, to.y) - 48;
        const bounds = {
          x,
          y,
          width: Math.abs(from.x - to.x) + 96,
          height: Math.abs(from.y - to.y) + 96,
        };
        return this.draw(l.id, l.drawingId, bounds, l.data, "link", {
          from: { x: from.x - x, y: from.y - y },
          to: { x: to.x - x, y: to.y - y },
        });
      }),
    );
  }
  async move(moves: { id: string; bounds: Bounds }[]) {
    const jobs: Promise<unknown>[] = [];
    for (const move of moves) {
      const m = this.instances.get(move.id)!;
      const sizeChanged =
        m.bounds.width !== move.bounds.width ||
        m.bounds.height !== move.bounds.height;
      m.bounds = { ...move.bounds };
      if (sizeChanged) jobs.push(this.drawModule(m));
      else
        Object.assign(this.views.get("module:" + move.id)!.host.style, {
          left: m.bounds.x + "px",
          top: m.bounds.y + "px",
        });
    }
    await Promise.all([...jobs, this.drawLinks()]);
  }
  set(id: string, data: Record<string, unknown>) {
    const m = this.instances.get(id)!;
    m.data = { ...m.data, ...data };
    return this.drawModule(m);
  }
  dispose() {
    this.disposed = true;
    for (const view of this.views.values())
      for (const fn of view.cleanup.splice(0)) fn();
    for (const fn of this.interactionCleanup.splice(0)) fn();
    this.listeners.clear();
    this.element.remove();
  }
}
