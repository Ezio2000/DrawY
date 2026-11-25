import type { Material } from "@drawy/materials/schema";
import type { Bounds, Work } from "../../../modules/contracts/index.ts";
import {
  blockShape,
  excalidrawClipboard,
  fromExcalidraw,
  fromFlowchart,
  isFlowchart,
  mermaidBlock,
  picturesFor,
  readExcalidraw,
  readMermaid,
  SeveralDiagrams,
  toExcalidraw,
  toMermaid,
  type Brought,
  type ExcalidrawElement,
  type ExcalidrawFile,
  type Flowchart,
  type Picture,
} from "../../../modules/interchange/index.ts";
import { api } from "./api.ts";
import { loadBindings } from "./bindings.ts";

/* Bringing Excalidraw scenes and Mermaid diagrams into a work, and sending a scene out as
 * either: the browser's side of modules/interchange. Reading in uploads a scene's pictures
 * to the library and lets Mermaid lay a flowchart out; writing out takes the pictures of
 * the parts Excalidraw has no element for from the canvas they are drawn on. */

/** What a person brought in: an Excalidraw scene, or Mermaid source. */
export type Incoming = { kind: "excalidraw"; text: string } | { kind: "mermaid"; source: string };

/** What text holds, if it is something to bring in. */
export function incoming(text: string): Incoming | null {
  if (readExcalidraw(text)) return { kind: "excalidraw", text };
  const source = readMermaid(text);
  return source ? { kind: "mermaid", source } : null;
}
/** Files that can be brought in, by name: Excalidraw scenes and Mermaid source. */
export const IMPORTABLE = ".excalidraw,.json,.mmd,.mermaid,.md,.txt";
export const importable = (file: File) => /\.(excalidraw|json|mmd|mermaid|md|txt)$/i.test(file.name);

/** The clip something brought in becomes, its pictures in the library, with how many of
 * what of it was adjusted on the way. Throws when the text is not a scene or a diagram it
 * can read. */
export async function clipOf(what: Incoming): Promise<Brought> {
  await loadBindings();
  if (what.kind === "excalidraw") {
    const scene = readExcalidraw(what.text)!;
    return fromExcalidraw(scene, await upload(scene.elements, scene.files));
  }
  const clip = isFlowchart(what.source) ? fromFlowchart(await layout(what.source)) : mermaidBlock(what.source, await measure(what.source));
  return { clip, adjusted: { upright: 0, opaque: 0, flipped: 0 } };
}

/** The scene's pictures uploaded to the library, by the file each came from. */
async function upload(elements: ExcalidrawElement[], files: Record<string, ExcalidrawFile>) {
  const wanted = new Set(elements.filter((e) => e.type === "image" && !e.isDeleted && e.fileId).map((e) => e.fileId!));
  const done: Record<string, string> = {};
  await Promise.all(
    [...wanted].map(async (id) => {
      const file = files[id];
      if (!file?.dataURL) return;
      const blob = await (await fetch(file.dataURL)).blob();
      const data = new FormData();
      const ext = file.mimeType.split("/")[1]?.replace("svg+xml", "svg") || "png";
      data.append("file", new File([blob], `excalidraw-${id}.${ext}`, { type: file.mimeType }));
      const m = await api<Material>("/materials", "POST", data);
      if (m.kind === "picture") done[id] = m.id;
    }),
  );
  return done;
}

let sequence = 0;
/** Mermaid, set up as the runtime draws it. */
async function mermaid() {
  const m = (await import("mermaid")).default;
  m.initialize({ startOnLoad: false, securityLevel: "loose", theme: "neutral" });
  return m;
}
/** Mermaid's drawing of the source, laid in the page at its own size so its parts can be
 * measured; `use` reads it before it is taken away. */
async function drawn<T>(source: string, use: (svg: SVGSVGElement, id: string) => T): Promise<T> {
  const m = await mermaid();
  const id = "drawy-import-" + ++sequence;
  const { svg } = await m.render(id, source);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  host.innerHTML = svg;
  document.body.append(host);
  try {
    const el = host.querySelector("svg")!;
    const box = el.viewBox.baseVal;
    el.removeAttribute("style");
    el.setAttribute("width", String(box.width));
    el.setAttribute("height", String(box.height));
    return use(el, id);
  } finally {
    host.remove();
  }
}
/** The size Mermaid draws a diagram at. */
const measure = (source: string) =>
  drawn(source, (svg) => {
    const box = svg.viewBox.baseVal;
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });

/** How much larger than Mermaid draws it a flowchart comes in: the work's blocks carry
 * their words with more room. */
const GROW = 1.25;
/** A style list's colours: its stroke and fill. */
function colours(styles: string[] = []) {
  const out: { stroke?: string; fill?: string } = {};
  for (const s of styles) {
    const [k, v] = s.split(":").map((x) => x.trim());
    if (v && (k === "stroke" || k === "fill") && !/none|transparent/.test(v)) out[k] = v;
  }
  return out;
}
const plain = (text: string | undefined) =>
  (text ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;|#quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/^`|`$/g, "")
    .trim();

/** A flowchart as Mermaid reads it and lays it out: each block where Mermaid draws it. */
async function layout(source: string): Promise<Flowchart> {
  const m = await mermaid();
  const diagram = await m.mermaidAPI.getDiagramFromText(source);
  const db = diagram.db as unknown as {
    getVertices(): Map<string, { id: string; domId: string; text?: string; type?: string; styles: string[]; classes: string[] }>;
    getEdges(): { start: string; end: string; type?: string; stroke?: string; text: string }[];
    getSubGraphs(): { id: string; title: string; nodes: string[] }[];
    getClasses(): Map<string, { styles: string[] }>;
  };
  const vertices = [...db.getVertices().values()];
  const classes = db.getClasses();
  const groups = db.getSubGraphs();
  // Mermaid names what it draws by the drawing's id, then the node's or the subgraph's.
  return drawn(source, (svg, drawing) => {
    const origin = svg.getBoundingClientRect();
    const place = (el: Element | null): Bounds | undefined => {
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return undefined;
      return {
        x: Math.round((r.left - origin.left) * GROW),
        y: Math.round((r.top - origin.top) * GROW),
        width: Math.round(r.width * GROW),
        height: Math.round(r.height * GROW),
      };
    };
    const named = (id: string) => svg.querySelector(`[id="${CSS.escape(`${drawing}-${id}`)}"]`) ?? svg.querySelector(`[id="${CSS.escape(id)}"]`);
    const find = (id: string, domId?: string) => (domId && named(domId)) || svg.querySelector(`g.node[data-id="${CSS.escape(id)}"]`);
    const nodes: Flowchart["nodes"] = vertices.flatMap((v) => {
      // A subgraph is a vertex too; it comes in as a group.
      if (groups.some((g) => g.id === v.id)) return [];
      const box = place(find(v.id, v.domId));
      if (!box) return [];
      const styles = [...v.classes.flatMap((c) => classes.get(c)?.styles ?? []), ...v.styles];
      return [{ id: v.id, text: plain(v.text) || v.id, shape: blockShape(v.type), box, ...colours(styles) }];
    });
    return {
      nodes,
      edges: db.getEdges().flatMap((e): Flowchart["edges"] => {
        if (e.stroke === "invisible") return [];
        const type = e.type ?? "arrow_point";
        return [
          {
            from: e.start,
            to: e.end,
            text: plain(e.text) || undefined,
            head: type.includes("open") ? "none" : "filled",
            both: type.startsWith("double"),
            dashed: e.stroke === "dotted",
            thick: e.stroke === "thick",
          },
        ];
      }),
      groups: groups.flatMap((g) => {
        const box = place(named(g.id)?.querySelector("rect") ?? null);
        return box ? [{ id: g.id, title: plain(g.title), box }] : [];
      }),
    };
  });
}

/* —— out —— */

const read = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
/** A file at a URL, as a data URL. */
const fetched = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw Error(url);
  const blob = await r.blob();
  return { dataURL: await read(blob), mimeType: blob.type || "image/png" };
};
/** A part as it is drawn on the canvas, as a picture of itself: its drawing copied into
 * an SVG, its pictures inlined, its look kept with the work's style. */
async function snapshot(host: HTMLElement, box: Bounds): Promise<Picture> {
  const root = host.shadowRoot;
  if (!root) throw Error("not drawn");
  const page = document.createElement("div");
  page.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  // The work's style rides on the host as custom properties; the page takes them along.
  page.style.cssText = host.style.cssText + `;position:relative;left:0;top:0;width:${box.width}px;height:${box.height}px;opacity:1`;
  for (const node of root.childNodes) {
    const copy = node.cloneNode(true) as Element;
    if (copy instanceof HTMLStyleElement) copy.textContent = copy.textContent!.replace(/:host/g, ".drawy-host");
    page.append(copy);
  }
  page.className = "drawy-host";
  // Canvases are copied as what they show; pictures are inlined, as an SVG picture loads
  // nothing of its own.
  const canvases = root.querySelectorAll("canvas"),
    copies = page.querySelectorAll("canvas");
  canvases.forEach((c, i) => {
    const img = document.createElement("img");
    try {
      img.src = c.toDataURL();
    } catch {}
    img.style.cssText = c.style.cssText;
    img.width = c.width;
    img.height = c.height;
    copies[i].replaceWith(img);
  });
  await Promise.all([
    ...[...page.querySelectorAll("img")].map(async (img) => {
      if (img.src.startsWith("data:")) return;
      img.src = (await fetched(img.src).catch(() => ({ dataURL: img.src }))).dataURL;
    }),
    ...[...page.querySelectorAll("image")].map(async (img) => {
      const href = img.getAttribute("href") ?? img.getAttribute("xlink:href");
      if (!href || href.startsWith("data:")) return;
      img.setAttribute("href", (await fetched(new URL(href, location.href).href).catch(() => ({ dataURL: href }))).dataURL);
    }),
  ]);
  const xhtml = new XMLSerializer().serializeToString(page);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}"><foreignObject x="0" y="0" width="${box.width}" height="${box.height}">${xhtml}</foreignObject></svg>`;
  return { dataURL: await read(new Blob([svg], { type: "image/svg+xml" })), mimeType: "image/svg+xml" };
}
/** The scene as an Excalidraw scene: parts Excalidraw holds as elements, the rest as
 * pictures of themselves taken from `canvas`, the element the scene is drawn in. */
export async function excalidrawOf(work: Work, sceneId: string, canvas?: Element | null) {
  await loadBindings();
  const pictures: Record<string, Picture> = {};
  await Promise.all(
    picturesFor(work, sceneId).map(async (id) => {
      try {
        const host = canvas?.querySelector<HTMLElement>(`[data-module-id="${CSS.escape(id)}"]`);
        const m = work.scenes[sceneId].modules.find((x) => x.id === id)!;
        if (host) pictures[id] = await snapshot(host, m.bounds);
      } catch {
        // Left without a picture, it goes out outlined and named.
      }
    }),
  );
  return toExcalidraw(work, sceneId, pictures);
}
export { excalidrawClipboard, SeveralDiagrams, toMermaid };
