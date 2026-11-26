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
import { drawingOf, endLink, endModule, labelOf, withTokens } from "../contracts/index.ts";
import { carried, linkEnds, union } from "../contracts/geometry.ts";
import { editable, measure, strayPaths, unmarkedTexts, type Declared, type EditableAPI, type EditMap } from "./edp.ts";
export type { EditMap } from "./edp.ts";

export interface SceneOptions {
  open: (target: Target) => void;
  error: (message: string) => void;
}
export interface DrawingAPI extends EditableAPI {
  data: Record<string, unknown>;
  width: number;
  height: number;
  theme: Record<string, string>;
  from?: Point;
  to?: Point;
  /** The side of its module each end meets; null for a point inside it. */
  fromSide?: Side | null;
  toSide?: Side | null;
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
type Listener = (value: unknown) => unknown;
type View = {
  host: HTMLElement;
  cleanup: (() => void)[];
  revision: number;
  materials: Set<string>;
  usesPictures: boolean;
  /** Where it was last drawn, and what its drawing declared there. */
  bounds?: Bounds;
  data?: Record<string, unknown>;
  declared?: Declared;
  /** Its declarations measured, for the revision and box they were measured at. */
  measured?: { key: string; map: EditMap | undefined };
};
export interface PatchResult {
  /** Modules newly added or whose drawing, data, or size changed. */
  inked: Instance[];
  /** Modules that only moved without redrawing, with their previous offset from the new spot. */
  moved: { id: string; dx: number; dy: number }[];
  /** Pictures that just finished developing in modules that were not otherwise inked. */
  developed: { moduleId: string; materialId: string }[];
  /** Links that are new or whose endpoint modules were inked. */
  drawnLinks: string[];
  /** Hosts detached for leaving modules when `detachLeaving` was requested. */
  leaving: HTMLElement[];
  /** Whether the scene already had drawn modules before this patch. */
  hadModulesBefore: boolean;
  /** Whether any module was added, removed, moved, or resized. */
  layoutChanged: boolean;
}
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
  /** The whole scene: its modules and the lines between their links' ends, which a free
   * end or one riding on a line can take past every module. */
  get bounds() {
    return union([...[...this.instances.values()].map((m) => m.bounds), ...this.linkBoxes()]);
  }
  /** The box each link's two ends span. */
  linkBoxes(): Bounds[] {
    return [...this.links.values()].map((l) => {
      const { from, to } = this.ends(l);
      return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y) };
    });
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
        : m.url + (m.url.includes("?") ? "&" : "?") + "color=" + encodeURIComponent(o.color);
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
          view = {
            host,
            cleanup: [],
            revision: 0,
            materials: new Set(),
            usesPictures: false,
          };
          this.views.set(key, view);
          this.element.append(host);
        }
        const { host } = view;
        const revision = ++view.revision;
        view.materials = new Set();
        view.usesPictures = false;
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
        const pictures = () =>
          new Proxy(this.pictures, {
            get(target, prop, receiver) {
              if (typeof prop === "string" && prop in target)
                view.materials.add(prop);
              return Reflect.get(target, prop, receiver);
            },
            ownKeys(target) {
              view.usesPictures = true;
              return Reflect.ownKeys(target);
            },
          });
        // What the module's own drawing declares; a drawing it draws inside itself declares
        // nothing, as its paths would name that drawing's data.
        const own = editable(true);
        const apiFor = (
          data: Record<string, unknown>,
          size: { width: number; height: number },
          edp: EditableAPI = editable(false).api,
        ): DrawingAPI => ({
          ...edp,
          data,
          ...size,
          theme: this.work.style,
          ...ends,
          svg,
          html,
          mermaid,
          material: (mid, options) => {
            view.materials.add(mid);
            return this.picture(mid, size, options);
          },
          get materials() {
            return pictures();
          },
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
          // A colour written as a style token draws in the work's colour for it.
          const full = withTokens(drawing.params, { ...drawing.defaults, ...data }, this.work.style);
          const result = await execute(
            drawing.source,
            apiFor(full, { width: bounds.width, height: bounds.height }, own.api),
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
          view.bounds = { ...bounds };
          view.data = full;
          view.declared = own.declared;
          view.measured = undefined;
          // A path that leads nowhere in the data is the drawing's mistake, told like any other.
          const stray = strayPaths(host.shadowRoot!, own.declared, full);
          if (stray.length) this.options.error(`${id}: 画法标注的数据路径不在数据里：${stray.join("、")}`);
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
  /** What a drawn module or link offers to edit, measured on the scene where it is drawn
   * now; kept until it is drawn again or moves. */
  editMap(id: string, kind: "module" | "link" = "module"): EditMap | undefined {
    const view = this.views.get(kind + ":" + id);
    if (!view?.declared || !view.bounds || !view.host.isConnected) return undefined;
    const bounds = kind === "module" ? (this.instances.get(id)?.bounds ?? view.bounds) : view.bounds;
    const key = JSON.stringify([view.revision, bounds]);
    if (view.measured?.key !== key) view.measured = { key, map: measure(view.host, bounds, view.declared) };
    return view.measured.map;
  }
  /** Words from a module's data its drawing shows without marking them as that data, by path. */
  unmarked(id: string) {
    const view = this.views.get("module:" + id);
    const m = this.instances.get(id);
    const fields = m && drawingOf(this.work, m.drawingId)?.params;
    if (!view?.data || !fields || !view.host.shadowRoot) return [];
    return unmarkedTexts(view.host.shadowRoot, fields, view.data);
  }
  private drawModule(m: Instance) {
    return this.draw(m.id, m.drawingId, m.bounds, m.data, "module");
  }
  /** Where a link's ends are as the scene stands now, in scene units, and the side of its
   * module each is on: on a module's box or the outline its drawing declares, along another
   * link, or at a free point. */
  ends(l: Pick<Link, "from" | "to">, depth = 0): ReturnType<typeof linkEnds> {
    return linkEnds(l, {
      box: (id) => this.instances.get(id)?.bounds,
      outline: (id) => this.editMap(id)?.outline,
      // A link riding on another, which may ride on a third; a ring of them goes nowhere.
      line: (id) => {
        const other = this.links.get(id);
        return other && depth < 6 ? this.ends(other, depth + 1) : undefined;
      },
    });
  }
  /** The links that meet some modules, and those riding on them, however far. */
  private meeting(modules: Set<string>) {
    const out = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of this.links.values()) {
        if (out.has(l.id)) continue;
        const ends = [l.from, l.to];
        if (ends.some((e) => modules.has(endModule(e) ?? "") || out.has(endLink(e) ?? ""))) {
          out.add(l.id);
          grew = true;
        }
      }
    }
    return out;
  }
  private drawLink(l: Link) {
    const { from, to } = this.ends(l);
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
      fromSide: from.side,
      toSide: to.side,
    });
  }
  /** Draws the links, or only those meeting some modules (and those riding on them). */
  private drawLinks(meeting?: Set<string>) {
    const drawn = meeting && this.meeting(meeting);
    return Promise.all([...this.links.values()].filter((l) => !drawn || drawn.has(l.id)).map((l) => this.drawLink(l)));
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
    const by = new Map<string, Point>();
    for (const move of moves) {
      const m = this.instances.get(move.id);
      if (!m) continue;
      moved.add(m.id);
      by.set(m.id, { x: move.bounds.x - m.bounds.x, y: move.bounds.y - m.bounds.y });
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
    // A line hanging from a moved module by one end moves whole with it.
    for (const l of this.links.values()) {
      const next = carried(l, by);
      if (next) Object.assign(l, next);
    }
    this.relayer();
    // Only the links that meet a moved module follow it.
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
    return this.drawLink(l);
  }
  /** Whether another revision of the scene can be laid over this one in place: the same
   * scene, look and script, with non-picture materials both hold unchanged. Picture
   * materials (such as developing -> ready) are patched on only the modules using them.
   * Anything else is drawn afresh. */
  patchable(work: Work, scene: Scene) {
    if (this.disposed || scene.id !== this.scene.id) return false;
    if (JSON.stringify(work.style) !== JSON.stringify(this.work.style))
      return false;
    if ((scene.interaction ?? "") !== (this.scene.interaction ?? "")) return false;
    for (const [id, m] of Object.entries(work.materials)) {
      const was = this.work.materials[id];
      if (!was || JSON.stringify(was) === JSON.stringify(m)) continue;
      if (was.kind !== "picture" || m.kind !== "picture") return false;
    }
    return true;
  }
  /** Where a drawn thing sits in depth: links above a backdrop and below every other
   * module, so a picture laid under the whole figure does not hide its arrows. */
  private layer(kind: "module" | "link", id: string) {
    if (kind === "link") return "1";
    return id === backdropOf(this.currentModules()) ? "0" : "2";
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
   * data, size and referenced pictures are unchanged stay as they are drawn (moved if they
   * moved), the rest are drawn again, those gone are taken out and new ones drawn; the
   * stacking follows the new order. Call only when `patchable` says so. */
  async patch(
    work: Work,
    scene: Scene,
    options?: { detachLeaving?: boolean; hideNew?: boolean },
  ): Promise<PatchResult> {
    const before = this.work;
    const hadModulesBefore = this.instances.size > 0;
    const look = (w: Work, m: Instance) =>
      JSON.stringify([
        m.drawingId,
        m.data,
        m.bounds.width,
        m.bounds.height,
        w.drawings[m.drawingId] ?? null,
      ]);
    const changedPictures = new Set<string>();
    const developedPictures = new Set<string>();
    for (const [id, m] of Object.entries(work.materials)) {
      const was = before.materials[id];
      if (was?.kind === "picture" && m.kind === "picture" && JSON.stringify(was) !== JSON.stringify(m)) {
        changedPictures.add(id);
        if (was.status === "developing" && m.status === "ready")
          developedPictures.add(id);
      }
    }
    const kept = new Map(scene.modules.map((m) => [m.id, m]));
    const leaving: HTMLElement[] = [];
    let layoutChanged = false;
    for (const id of [...this.instances.keys()]) {
      if (!kept.has(id)) {
        layoutChanged = true;
        const host = this.forget("module", id, options?.detachLeaving);
        if (host) leaving.push(host);
      }
    }
    const linked = new Set(scene.links.map((l) => l.id));
    for (const id of [...this.links.keys()])
      if (!linked.has(id)) this.forget("link", id);
    this.work = work;
    this.scene = scene;
    const jobs: Promise<unknown>[] = [];
    const inked: Instance[] = [];
    const inkedIds = new Set<string>();
    const moved: { id: string; dx: number; dy: number }[] = [];
    const geometryChanged = new Set<string>();
    const developed: { moduleId: string; materialId: string }[] = [];
    for (const next of scene.modules) {
      const was = this.instances.get(next.id),
        view = this.views.get("module:" + next.id),
        host = view?.host;
      const m = structuredClone(next);
      this.instances.set(m.id, m);
      if (
        !was ||
        was.bounds.x !== m.bounds.x ||
        was.bounds.y !== m.bounds.y ||
        was.bounds.width !== m.bounds.width ||
        was.bounds.height !== m.bounds.height
      ) {
        layoutChanged = true;
        geometryChanged.add(m.id);
      }
      if (!was || !host || look(before, was) !== look(work, m)) {
        inked.push(m);
        inkedIds.add(m.id);
        jobs.push(this.drawModule(m));
        if (options?.hideNew && !host) {
          const created = this.views.get("module:" + m.id)?.host;
          if (created) created.style.visibility = "hidden";
        }
        continue;
      }
      const usedChanged =
        changedPictures.size > 0 &&
        (view.usesPictures ||
          [...view.materials].some((id) => changedPictures.has(id)));
      if (usedChanged) {
        const usedDeveloped = [...view.materials].filter((id) =>
          developedPictures.has(id),
        );
        for (const materialId of usedDeveloped)
          developed.push({ moduleId: m.id, materialId });
        jobs.push(this.drawModule(m));
        continue;
      }
      if (was.bounds.x !== m.bounds.x || was.bounds.y !== m.bounds.y) {
        moved.push({
          id: m.id,
          dx: was.bounds.x - m.bounds.x,
          dy: was.bounds.y - m.bounds.y,
        });
        Object.assign(host.style, {
          left: m.bounds.x + "px",
          top: m.bounds.y + "px",
        });
      }
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
    this.relayer();
    const linkLook = (w: Work, l: Link) =>
      JSON.stringify([
        l.drawingId,
        l.data,
        l.from,
        l.to,
        w.drawings[l.drawingId] ?? null,
      ]);
    const drawnLinks: string[] = [];
    // Every link is in place before any is drawn, as a link riding on another reads its
    // ends from that one, wherever it stands in the list.
    const prevLinks = new Map(scene.links.map((l) => [l.id, this.links.get(l.id)]));
    for (const l of scene.links) this.links.set(l.id, structuredClone(l));
    for (const nextLink of scene.links) {
      const prevLink = prevLinks.get(nextLink.id);
      const linkView = this.views.get("link:" + nextLink.id);
      const l = this.links.get(nextLink.id)!;
      const touches = (ids: Set<string>) => [l.from, l.to].some((e) => ids.has(endModule(e) ?? ""));
      const endpointsInked = touches(inkedIds);
      // A link riding on another is drawn again with it, whatever moved that one.
      const endpointsChanged = endpointsInked || touches(geometryChanged) || [l.from, l.to].some((e) => !!endLink(e));
      const linkChanged =
        !prevLink || !linkView || linkLook(before, prevLink) !== linkLook(work, l);
      const linkPicturesChanged =
        changedPictures.size > 0 &&
        !!linkView &&
        (linkView.usesPictures ||
          [...linkView.materials].some((id) => changedPictures.has(id)));
      if (linkChanged || endpointsChanged || linkPicturesChanged) {
        jobs.push(this.drawLink(l));
        if (!prevLink || endpointsInked) {
          drawnLinks.push(l.id);
          if (options?.hideNew && !prevLink) {
            const created = this.views.get("link:" + l.id)?.host;
            if (created) created.style.visibility = "hidden";
          }
        }
      }
    }
    await Promise.all(jobs);
    await this.settled();
    return {
      inked,
      moved,
      developed,
      drawnLinks,
      leaving,
      hadModulesBefore,
      layoutChanged,
    };
  }
  /** Takes a drawn module or link out; when `keepHost` is set the DOM element is left on
   * screen for a fade-out animation and returned to the caller to remove. */
  private forget(kind: "module" | "link", id: string, keepHost = false) {
    const view = this.views.get(kind + ":" + id);
    let kept: HTMLElement | undefined;
    if (view) {
      // A drawing still running for it sees it is gone and stops what it started.
      view.revision++;
      for (const fn of view.cleanup.splice(0)) fn();
      if (keepHost) kept = view.host;
      else view.host.remove();
      this.views.delete(kind + ":" + id);
    }
    if (kind === "module") this.instances.delete(id);
    else this.links.delete(id);
    return kept;
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

/** The scene's backdrop, if it has one: its bottom module, when that module lies under at
 * least nine tenths of the whole figure, as a painted world behind the parts does. Links
 * are drawn over a backdrop and under every other module. */
export function backdropOf(modules: Pick<Instance, "id" | "bounds">[]): string | undefined {
  const [bottom] = modules;
  if (!bottom || modules.length < 2) return undefined;
  const all = union(modules.map((m) => m.bounds)),
    b = bottom.bounds;
  const across =
    Math.min(b.x + b.width, all.x + all.width) - Math.max(b.x, all.x);
  const down =
    Math.min(b.y + b.height, all.y + all.height) - Math.max(b.y, all.y);
  return across > 0 && down > 0 && across * down >= 0.9 * all.width * all.height
    ? bottom.id
    : undefined;
}
