import type {
  Work,
  Scene,
  Instance,
  Point,
  Bounds,
  Target,
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
  resource: (id: string) => string;
  emit: (event: string, value?: unknown) => Promise<void>;
  cleanup: (fn: () => void) => void;
  animate: (fn: (seconds: number) => void) => void;
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
        resource: (id: string) => this.resource(id),
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
  private resource(id: string) {
    return this.work.resources[id].url;
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
    const images = [...this.views.values()].flatMap((v) =>
      Array.from(v.host.shadowRoot!.querySelectorAll("img")),
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
        const api: DrawingAPI = {
          data,
          width: bounds.width,
          height: bounds.height,
          theme: this.work.style,
          ...ends,
          svg,
          html,
          mermaid,
          plantuml,
          resource: (id) => this.resource(id),
          emit: (event, value) => this.emit(id, event, value),
          cleanup: (fn) => cleanup.push(fn),
          animate: (fn) => this.animate(fn, cleanup),
        };
        try {
          const result = await execute(
            this.work.drawings[drawingId].source,
            api,
          );
          if (this.disposed || view.revision !== revision) {
            for (const fn of cleanup.splice(0)) fn();
            return;
          }
          if (!(result instanceof Element))
            throw Error("画法必须返回一个 DOM 或 SVG 元素");
          const style = document.createElement("style");
          style.textContent =
            ":host{display:block;color:var(--ink);font-family:var(--font)}*{box-sizing:border-box}svg{display:block;max-width:100%;max-height:100%}button,input,select{font:inherit}";
          for (const [k, v] of Object.entries(this.work.style))
            host.style.setProperty("--" + k, v);
          host.shadowRoot!.replaceChildren(style, result);
          host.title = kind === "module" ? this.instances.get(id)!.label : "";
        } catch (e) {
          if (!this.disposed) {
            this.options.error(id + ": " + String(e));
            host.shadowRoot!.textContent = String(e);
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
