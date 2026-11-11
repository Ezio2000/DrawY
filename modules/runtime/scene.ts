import type {
  Work,
  Scene,
  Instance,
  Link,
  Point,
  Bounds,
  Side,
  Target,
  MaterialUse,
} from "../contracts/index.ts";
import { drawingOf, labelOf } from "../contracts/index.ts";
import { union } from "../contracts/geometry.ts";
import { groundOf, routeLinks, routing, type Routed } from "../contracts/routing.ts";
export { backdropOf } from "../contracts/routing.ts";

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
  /** The side of its module each end meets; null for a point inside it. */
  fromSide?: Side | null;
  toSide?: Side | null;
  /** Where a link runs, worked out for the whole scene: `points` from its start to its end
   * in local units (an elbow's turns between them, clear of the other modules), and where
   * its words have room. */
  route?: { kind: Routed["kind"]; points: Point[]; label?: Point };
  svg: (source: string) => SVGElement;
  html: (source: string) => HTMLElement;
  mermaid: (source: string) => Promise<Element>;
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
/** What the geometry of a drawn scene shows is wrong with its structure, measured rather
 * than judged from a picture: each entry names its parts and how far they are out. */
export interface StructureReport {
  /** Links that pass through a module neither of their ends is on. */
  crossings?: { link: string; through: string[] }[];
  /** Blocks, tables and labels lying over one another, and by how much. */
  overlaps?: { a: string; b: string; by: [number, number] }[];
  /** Words on a link that lie over a module or another link's words, or that another link
   * strikes through. */
  labels?: { link: string; text: string; over?: string[]; crossedBy?: string[] }[];
  /** Words that run out of the block or table that holds them, and the size that would
   * hold them. */
  overflow?: { moduleId: string; text: string; needs: [number, number] }[];
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

export class SceneRenderer {
  readonly element = document.createElement("div");
  readonly instances: Map<string, Instance>;
  /** The scene's links as drawn now, which an edit may preview with other data. */
  readonly links: Map<string, Link>;
  private views = new Map<string, View>();
  /** Where each link runs, as last worked out, and as last drawn. */
  private routes = new Map<string, Routed>();
  private routed = new Map<string, string>();
  private ground = new Set<string>();
  private listeners = new Map<string, Set<Listener>>();
  private jobs = new Set<Promise<unknown>>();
  private interactionCleanup: (() => void)[] = [];
  private disposed = false;

  constructor(
    public work: Work,
    public scene: Scene,
    readonly options: SceneOptions,
  ) {
    this.instances = new Map(
      scene.modules.map((m) => [m.id, structuredClone(m)]),
    );
    this.links = new Map(scene.links.map((l) => [l.id, structuredClone(l)]));
    this.element.style.cssText =
      "position:absolute;inset:0;pointer-events:none";
  }
  /** The extent of everything drawn: the modules, and the links where they run round the
   * outside of them, so a view fitted to the figure or a picture cropped to it holds both. */
  get bounds() {
    const boxes = [...this.instances.values()].map((m) => m.bounds);
    if (!boxes.length) return union(boxes);
    const outside: Bounds[] = [];
    for (const r of this.routes.values()) {
      if (r.kind !== "elbow") continue;
      const xs = r.points.map((p) => p.x),
        ys = r.points.map((p) => p.y);
      outside.push({
        x: Math.min(...xs) - 6,
        y: Math.min(...ys) - 6,
        width: Math.max(...xs) - Math.min(...xs) + 12,
        height: Math.max(...ys) - Math.min(...ys) + 12,
      });
    }
    return union([...boxes, ...outside]);
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
    if (this.scene.interaction) {
      const api = {
        on: (id: string, event: string, fn: Listener) => {
          const key = JSON.stringify([id, event]);
          const set = this.listeners.get(key) || new Set();
          set.add(fn);
          this.listeners.set(key, set);
        },
        // A module the person has since taken out of the scene is passed over.
        set: (id: string, data: Record<string, unknown>) =>
          this.instances.has(id) ? this.set(id, data) : Promise.resolve(),
        move: (id: string, x: number, y: number) =>
          this.instances.has(id)
            ? this.move([
                { id, bounds: { ...this.instances.get(id)!.bounds, x, y } },
              ])
            : Promise.resolve(),
        openScene: (id: string) => this.options.open({ kind: "scene", id }),
        openDetail: (id: string) => this.options.open({ kind: "detail", id }),
        cleanup: (fn: () => void) => this.interactionCleanup.push(fn),
        animate: (fn: (seconds: number) => void) =>
          this.animate(fn, this.interactionCleanup),
      };
      await this.track(execute(this.scene.interaction, api));
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
    img.src = !(o.color && m.recolor)
      ? m.url
      : m.url.startsWith("data:")
        ? // A picture carried inside an exported file is recoloured here, as the library
          // would: its SVG text inks with currentColor.
          m.url.replaceAll("currentColor", encodeURIComponent(o.color))
        : m.url + "?color=" + encodeURIComponent(o.color);
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
      // A cut-out is pencilled as an oval of hatching; a whole scene as a pale wash.
      sketch.dataset.sketch = m.opaque ? "scene" : "cutout";
      sketch.dataset.name = m.name;
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
            .finished.then(
              () => resolve(),
              () => resolve(),
            );
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
  private animate(
    fn: (seconds: number) => void,
    cleanup: { push: (fn: () => void) => unknown },
  ) {
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
    ends?: {
      from: Point;
      to: Point;
      fromSide: Side | null;
      toSide: Side | null;
      route: NonNullable<DrawingAPI["route"]>;
    },
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
          zIndex: this.layer(kind, id),
        });
        for (const fn of view.cleanup.splice(0)) fn();
        const cleanup: (() => void)[] = [];
        view.cleanup = cleanup;
        // A drawing superseded or taken out while it runs is not shown, and what it sets
        // going from then on is stopped at once.
        const stale = () => this.disposed || view.revision !== revision;
        const keep = {
          push: (fn: () => void) => (stale() ? fn() : cleanup.push(fn)),
        };
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
          material: (id, options) => this.picture(id, size, options),
          materials: this.pictures,
          draw: (id, data = {}, at = size) => {
            const m = drawingOf(this.work, id);
            if (!m) throw Error(`画法 ${id} 不在作品中：在 drawings 里定义它，或用库里画法素材的 id`);
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
          cleanup: (fn) => void keep.push(fn),
          animate: (fn) => this.animate(fn, keep),
        });
        try {
          // The work's own definition, or a library drawing used as it is.
          const drawing = drawingOf(this.work, drawingId);
          if (!drawing) throw Error(`画法 ${drawingId} 不在作品中：在 drawings 里定义它，或用库里画法素材的 id`);
          const result = await execute(
            drawing.source,
            apiFor({ ...drawing.defaults, ...data }, {
              width: bounds.width,
              height: bounds.height,
            }),
          );
          if (stale()) {
            for (const fn of cleanup.splice(0)) fn();
            return;
          }
          if (!(result instanceof Element))
            throw Error("画法必须返回一个 DOM 或 SVG 元素");
          const style = document.createElement("style");
          // SVG text is drawn at the size it is laid out at, whatever the view's scale:
          // otherwise Chromium bakes the scale on screen into the font when it lays the
          // text out, and a view moved on the compositor (while the layer fades or
          // unfolds) leaves the text drawn at a stale size, clipped to the box laid out.
          style.textContent =
            ":host{display:block;color:var(--ink);font-family:var(--font)}*{box-sizing:border-box}svg{display:block;max-width:100%;max-height:100%;text-rendering:geometricPrecision}button,input,select{font:inherit}[data-sketch]{position:absolute;display:grid;place-items:center;animation:developing 1.8s ease-in-out infinite alternate}[data-sketch]::after{content:attr(data-name);max-width:80%;font:italic 15px/1.4 'Iowan Old Style','Songti SC',Georgia,serif;color:color-mix(in srgb,var(--ink,#333) 60%,transparent);text-align:center;background:color-mix(in srgb,var(--paper,#fff) 70%,transparent);padding:2px 8px;border-radius:4px}[data-sketch=cutout]{border-radius:50%;box-shadow:inset 0 0 0 1.2px color-mix(in srgb,var(--ink,#333) 30%,transparent);background:repeating-linear-gradient(-45deg,color-mix(in srgb,var(--ink,#333) 20%,transparent) 0 1px,transparent 1px 7px)}[data-sketch=scene]{background:radial-gradient(60% 55% at 35% 40%,color-mix(in srgb,var(--accent2,#7a9bb0) 18%,transparent),transparent),radial-gradient(55% 50% at 70% 65%,color-mix(in srgb,var(--accent,#d97757) 14%,transparent),transparent);-webkit-mask:radial-gradient(closest-side,#000 70%,transparent);mask:radial-gradient(closest-side,#000 70%,transparent)}img[data-developing]{visibility:hidden}@keyframes developing{from{opacity:.3}to{opacity:.85}}";
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
            host.title = labelOf(m);
            host.toggleAttribute("data-explorable", !!m.target);
          }
        } catch (e) {
          if (stale()) for (const fn of cleanup.splice(0)) fn();
          else {
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
  /** Works out where every link runs with the modules where they are now. */
  private route() {
    const modules = this.currentModules();
    const links = [...this.links.values()];
    this.routes = routeLinks(
      links.map((l) => ({
        id: l.id,
        from: l.from,
        to: l.to,
        options: routing(
          { ...drawingOf(this.work, l.drawingId)?.defaults, ...l.data },
          this.work.style,
        ),
      })),
      modules.map((m) => ({
        id: m.id,
        bounds: m.bounds,
        // A link meets a pointed shape at the middle of a side, where its outline is.
        pointed: ["diamond", "circle", "initial", "final"].includes(
          String({ ...drawingOf(this.work, m.drawingId)?.defaults, ...m.data }.shape),
        ),
      })),
      this.clear(),
    );
    this.ground = groundOf(modules, links);
  }
  /** What the drawn modules mark to be kept clear of lines (a frame's name, the headers of
   * lanes), in scene units. Nothing while the scene is not laid out on a page. */
  private clear() {
    const zones: { id: string; bounds: Bounds }[] = [];
    for (const [id, m] of this.instances) {
      const host = this.views.get("module:" + id)?.host;
      const marked = host?.shadowRoot?.querySelectorAll("[data-clear]");
      if (!marked?.length) continue;
      const hr = host!.getBoundingClientRect();
      if (!hr.width) continue;
      const k = hr.width / m.bounds.width;
      for (const el of marked) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height)
          zones.push({
            id,
            bounds: {
              x: m.bounds.x + (r.left - hr.left) / k,
              y: m.bounds.y + (r.top - hr.top) / k,
              width: r.width / k,
              height: r.height / k,
            },
          });
      }
    }
    return zones;
  }
  /** The modules a frame or lanes carry when dragged: those standing on it, above it. */
  carried(id: string): string[] {
    const m = this.instances.get(id);
    const fit = m && drawingOf(this.work, m.drawingId)?.fit;
    if (!m || (fit !== "frame" && fit !== "lanes")) return [];
    const order = this.currentModules();
    const at = order.findIndex((x) => x.id === id);
    return order
      .filter(
        (x, i) =>
          i > at &&
          x.bounds.x >= m.bounds.x &&
          x.bounds.y >= m.bounds.y &&
          x.bounds.x + x.bounds.width <= m.bounds.x + m.bounds.width &&
          x.bounds.y + x.bounds.height <= m.bounds.y + m.bounds.height,
      )
      .map((x) => x.id);
  }
  /** Where a link runs now. */
  routeOf(id: string) {
    return this.routes.get(id);
  }
  /** What is wrong with the scene's structure as it is drawn now. */
  structure(): StructureReport {
    const report: StructureReport = {};
    const add = <K extends keyof StructureReport>(key: K, entry: NonNullable<StructureReport[K]>[number]) => {
      const list = ((report[key] as unknown[] | undefined) ??= []);
      if (list.length < 8) list.push(entry);
    };
    const modules = this.currentModules();
    for (const [id, r] of this.routes) if (r.crosses.length) add("crossings", { link: id, through: r.crosses });
    // Blocks, tables and labels are the parts that should stand clear of one another;
    // a picture with a label on it or a shadow under it is composed that way.
    const solid = modules.filter((m) => {
      const fit = drawingOf(this.work, m.drawingId)?.fit;
      return (fit === "words" || fit === "rows") && !this.ground.has(m.id);
    });
    const within = (a: Bounds, b: Bounds) =>
      a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
    for (let i = 0; i < solid.length; i++)
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i].bounds,
          b = solid[j].bounds;
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
          h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (w > 2 && h > 2 && !within(a, b) && !within(b, a))
          add("overlaps", { a: solid[i].id, b: solid[j].id, by: [Math.round(w), Math.round(h)] });
      }
    /** A box on screen in scene units, by the host that holds it. */
    const sceneBox = (host: HTMLElement, r: DOMRect): Bounds | undefined => {
      const hr = host.getBoundingClientRect();
      const width = parseFloat(host.style.width);
      if (!hr.width || !width) return undefined;
      const k = hr.width / width;
      return {
        x: parseFloat(host.style.left) + (r.left - hr.left) / k,
        y: parseFloat(host.style.top) + (r.top - hr.top) / k,
        width: r.width / k,
        height: r.height / k,
      };
    };
    const meet = (a: Bounds, b: Bounds, by = 0) =>
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > by &&
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > by;
    const words: { link: string; text: string; box: Bounds }[] = [];
    for (const id of this.links.keys()) {
      const host = this.views.get("link:" + id)?.host;
      for (const text of host?.shadowRoot?.querySelectorAll("text") ?? []) {
        const box = text.textContent?.trim() && sceneBox(host!, text.getBoundingClientRect());
        if (box) words.push({ link: id, text: text.textContent!.trim().slice(0, 24), box });
      }
    }
    for (const w of words) {
      const over = modules
        .filter((m) => !this.ground.has(m.id) && meet(w.box, m.bounds, 3) && !within(w.box, m.bounds))
        .map((m) => m.id);
      const others = words.filter((o) => o !== w && o.link !== w.link && meet(w.box, o.box, 2)).map((o) => o.link);
      const inner = { x: w.box.x + 3, y: w.box.y + 3, width: w.box.width - 6, height: w.box.height - 6 };
      const crossedBy = [...this.routes]
        .filter(([id, r]) => {
          if (id === w.link || r.kind === "curve" || r.kind === "smooth") return false;
          return r.points.some((p, i) => {
            if (!i) return false;
            const q = r.points[i - 1];
            return meet(inner, {
              x: Math.min(p.x, q.x),
              y: Math.min(p.y, q.y),
              width: Math.abs(p.x - q.x) || 0.01,
              height: Math.abs(p.y - q.y) || 0.01,
            });
          });
        })
        .map(([id]) => id);
      if (over.length || others.length || crossedBy.length)
        add("labels", {
          link: w.link,
          text: w.text,
          ...(over.length || others.length ? { over: [...over, ...others] } : {}),
          ...(crossedBy.length ? { crossedBy } : {}),
        });
    }
    // A structure or chart lays its words out within its module, so words outside it mean
    // the module is too small for them.
    const holding = modules.filter((m) => {
      const use = this.work.materials[m.drawingId];
      return (
        solid.includes(m) ||
        (!this.work.drawings[m.drawingId] && use?.kind === "drawing" && use.contained && !this.ground.has(m.id))
      );
    });
    for (const m of holding) {
      const host = this.views.get("module:" + m.id)?.host;
      if (!host?.shadowRoot) continue;
      const walker = document.createTreeWalker(host.shadowRoot, NodeFilter.SHOW_TEXT);
      let out = { x: 0, y: 0 },
        said = "";
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        if (!text || node.parentElement?.closest("style,script,defs,title")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = sceneBox(host, range.getBoundingClientRect());
        if (!box || !box.width) continue;
        const x = Math.max(m.bounds.x - box.x, box.x + box.width - (m.bounds.x + m.bounds.width)),
          y = Math.max(m.bounds.y - box.y, box.y + box.height - (m.bounds.y + m.bounds.height));
        if (x > out.x || y > out.y) said = text.slice(0, 24);
        out = { x: Math.max(out.x, x), y: Math.max(out.y, y) };
      }
      if (out.x > 1.5 || out.y > 1.5)
        add("overflow", {
          moduleId: m.id,
          text: said,
          needs: [
            Math.ceil(m.bounds.width + 2 * Math.max(0, out.x) + (out.x > 1.5 ? 8 : 0)),
            Math.ceil(m.bounds.height + 2 * Math.max(0, out.y) + (out.y > 1.5 ? 8 : 0)),
          ],
        });
    }
    return report;
  }
  /** Where a link's ends meet their modules as they are now, in scene units, and the side
   * each is on. */
  ends(l: Pick<Link, "id">) {
    if (!this.routes.has(l.id)) this.route();
    const r = this.routes.get(l.id)!;
    return {
      from: { ...r.points[0], side: r.fromSide },
      to: { ...r.points.at(-1)!, side: r.toSide },
    };
  }
  private drawLink(l: Link) {
    const r = this.routes.get(l.id);
    if (!r) return Promise.resolve();
    this.routed.set(l.id, JSON.stringify(r));
    const xs = r.points.map((p) => p.x),
      ys = r.points.map((p) => p.y);
    const x = Math.min(...xs) - 48,
      y = Math.min(...ys) - 48;
    const bounds = {
      x,
      y,
      width: Math.max(...xs) - Math.min(...xs) + 96,
      height: Math.max(...ys) - Math.min(...ys) + 96,
    };
    const local = (p: Point) => ({ x: p.x - x, y: p.y - y });
    return this.draw(l.id, l.drawingId, bounds, l.data, "link", {
      from: local(r.points[0]),
      to: local(r.points.at(-1)!),
      fromSide: r.fromSide,
      toSide: r.toSide,
      route: {
        kind: r.kind,
        points: r.points.map(local),
        ...(r.label ? { label: local(r.label) } : {}),
      },
    });
  }
  /** Draws the links, or only those meeting some modules and those whose way changed
   * because of where those modules now are. */
  private drawLinks(meeting?: Set<string>) {
    this.route();
    this.relayer();
    return Promise.all(
      [...this.links.values()]
        .filter(
          (l) =>
            !meeting ||
            meeting.has(l.from.moduleId) ||
            meeting.has(l.to.moduleId) ||
            this.routed.get(l.id) !== JSON.stringify(this.routes.get(l.id)),
        )
        .map((l) => this.drawLink(l)),
    );
  }
  /** Puts modules at other places and sizes at once, without drawing anything again: a
   * resized module is stretched to its new box until `move` draws it at that size. */
  position(moves: { id: string; bounds: Bounds }[]) {
    for (const move of moves) {
      const m = this.instances.get(move.id),
        host = this.views.get("module:" + move.id)?.host;
      if (!m || !host) continue;
      Object.assign(host.style, {
        left: move.bounds.x + "px",
        top: move.bounds.y + "px",
        width: move.bounds.width + "px",
        height: move.bounds.height + "px",
      });
      if (
        m.bounds.width === move.bounds.width &&
        m.bounds.height === move.bounds.height
      )
        m.bounds = { ...move.bounds };
    }
  }
  async move(moves: { id: string; bounds: Bounds }[]) {
    const jobs: Promise<unknown>[] = [];
    const moved = new Set<string>();
    for (const move of moves) {
      const m = this.instances.get(move.id);
      if (!m) continue;
      moved.add(m.id);
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
    // The links that meet a moved module follow it, and so do those it now stands in the
    // way of.
    await Promise.all([...jobs, this.drawLinks(moved)]);
  }
  set(id: string, data: Record<string, unknown>) {
    const m = this.instances.get(id)!;
    m.data = { ...m.data, ...data };
    return this.drawModule(m);
  }
  /** Draws a module or a link again with other data in place of its own, as an edit is
   * being made. */
  redraw(id: string, data: Record<string, unknown>) {
    const m = this.instances.get(id);
    if (m) {
      m.data = data;
      return this.drawModule(m);
    }
    const l = this.links.get(id);
    if (!l) return Promise.resolve();
    l.data = data;
    this.route();
    return this.drawLink(l);
  }
  /** Whether another revision of the scene can be laid over this one in place: the same
   * scene, look and script, with the materials both hold unchanged. Anything else is
   * drawn afresh. */
  patchable(work: Work, scene: Scene) {
    if (this.disposed || scene.id !== this.scene.id) return false;
    if (JSON.stringify(work.style) !== JSON.stringify(this.work.style))
      return false;
    if ((scene.interaction ?? "") !== (this.scene.interaction ?? "")) return false;
    for (const [id, m] of Object.entries(work.materials)) {
      const was = this.work.materials[id];
      if (was && JSON.stringify(was) !== JSON.stringify(m)) return false;
    }
    return true;
  }
  /** Where a drawn thing sits in depth: links above the ground (a backdrop under the whole
   * figure, a frame or lanes holding linked modules) and below every other module, so what
   * lies under the figure's parts does not hide the arrows between them. */
  private layer(kind: "module" | "link", id: string) {
    if (kind === "link") return "1";
    return this.ground.has(id) ? "0" : "2";
  }
  /** The scene's modules in stacking order, where they are now. */
  private currentModules() {
    return this.scene.modules.map((m) => this.instances.get(m.id) ?? m);
  }
  /** Sets every module's depth again, after the modules moved or changed order. */
  private relayer() {
    for (const m of this.scene.modules) {
      const host = this.views.get("module:" + m.id)?.host;
      if (host) host.style.zIndex = this.layer("module", m.id);
    }
  }
  /** Lays another revision of the scene over this one in place: modules whose drawing,
   * data and size are unchanged stay as they are drawn (moved if they moved), the rest are
   * drawn again, those gone are taken out and new ones drawn; the stacking follows the new
   * order. For a change the person made, which should show at once. Call only when
   * `patchable` says so. */
  async patch(work: Work, scene: Scene) {
    const before = this.work;
    const look = (w: Work, m: Instance) =>
      JSON.stringify([
        m.drawingId,
        m.data,
        m.bounds.width,
        m.bounds.height,
        w.drawings[m.drawingId] ?? null,
      ]);
    const kept = new Map(scene.modules.map((m) => [m.id, m]));
    for (const id of [...this.instances.keys()])
      if (!kept.has(id)) this.forget("module", id);
    const linked = new Set(scene.links.map((l) => l.id));
    for (const id of [...this.links.keys()])
      if (!linked.has(id)) this.forget("link", id);
    this.work = work;
    this.scene = scene;
    const jobs: Promise<unknown>[] = [];
    for (const next of scene.modules) {
      const was = this.instances.get(next.id),
        host = this.views.get("module:" + next.id)?.host;
      const m = structuredClone(next);
      this.instances.set(m.id, m);
      if (!was || !host || look(before, was) !== look(work, m)) {
        jobs.push(this.drawModule(m));
        continue;
      }
      Object.assign(host.style, {
        left: m.bounds.x + "px",
        top: m.bounds.y + "px",
      });
      host.title = labelOf(m);
      host.toggleAttribute("data-explorable", !!m.target);
    }
    // The modules' order on the page is their stacking order.
    const hosts = scene.modules.flatMap((m) => {
      const host = this.views.get("module:" + m.id)?.host;
      return host ? [host] : [];
    });
    const shown = [...this.element.children].filter((el) =>
      hosts.includes(el as HTMLElement),
    );
    if (shown.some((el, i) => el !== hosts[i]))
      for (const host of hosts) this.element.append(host);
    for (const l of scene.links) this.links.set(l.id, structuredClone(l));
    // Links are cheap and follow their modules wherever they went.
    jobs.push(this.drawLinks());
    await Promise.all(jobs);
    await this.settled();
  }
  /** Takes a drawn module or link out. */
  private forget(kind: "module" | "link", id: string) {
    const view = this.views.get(kind + ":" + id);
    if (view) {
      // A drawing still running for it sees it is gone and stops what it started.
      view.revision++;
      for (const fn of view.cleanup.splice(0)) fn();
      view.host.remove();
      this.views.delete(kind + ":" + id);
    }
    if (kind === "module") this.instances.delete(id);
    else {
      this.links.delete(id);
      this.routes.delete(id);
      this.routed.delete(id);
    }
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
