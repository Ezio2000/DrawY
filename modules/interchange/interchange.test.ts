import { describe, expect, it } from "vitest";
import { applied, paste, syntaxError } from "../editing/index.ts";
import { validateWork } from "../workspace/index.ts";
import { workEditSchema, type MaterialUse, type Work } from "../contracts/index.ts";
import {
  fromExcalidraw,
  fromFlowchart,
  inked,
  isFlowchart,
  kindOfSource,
  mermaidBlock,
  mermaidDiagram,
  picturesFor,
  readExcalidraw,
  readMermaid,
  simplify,
  sketchLine,
  sketchShape,
  importedPicture,
  toExcalidraw,
  toMermaid,
  SeveralDiagrams,
  type ExcalidrawElement,
} from "./index.ts";
import type { Clip } from "../editing/index.ts";

const library = (id: string): MaterialUse => ({
  id,
  kind: "drawing",
  name: id,
  source: "return api.svg('<svg></svg>')",
  defaults: {},
  params: {},
});
const photo = (id: string): MaterialUse => ({
  id,
  kind: "picture",
  name: id,
  type: "object",
  style: null,
  url: `/files/${id}.png`,
  width: 64,
  height: 64,
  content: { x: 0, y: 0, width: 1, height: 1 },
  anchors: {},
  recolor: false,
  opaque: false,
  status: "ready",
});
/** A blank work holding the library drawings imports use, as the workspace would take them. */
function blank(): Work {
  return {
    id: "w",
    title: "空白",
    rootSceneId: "root",
    drawings: {},
    scenes: { root: { id: "root", title: "空白", parentId: null, modules: [], links: [], checks: [] } },
    details: {},
    brief: null,
    materials: Object.fromEntries(["label", "arrow", "node", "callout", "picture"].map((id) => [id, library(id)])),
    style: { ink: "#24312e", accent: "#d97757", muted: "#6c7972", font: "system-ui" },
    revision: 1,
    updatedAt: 1,
  };
}
/** The work a clip pasted into it leaves, checked as the workspace checks every commit. */
function pasted(work: Work, clip: Clip, extra: Record<string, MaterialUse> = {}) {
  Object.assign(work.materials, extra);
  const { edit, ids } = paste(work, "root", clip, { centre: { x: 500, y: 400 } });
  const next = applied(work, workEditSchema.parse(edit));
  validateWork(next);
  return { work: next, ids };
}
const el = (e: Partial<ExcalidrawElement> & Pick<ExcalidrawElement, "id" | "type">): ExcalidrawElement => ({
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  groupIds: [],
  boundElements: null,
  isDeleted: false,
  ...e,
});

describe("drawings made by hand and brought in", () => {
  it("parse, and are known by the mark they open with", () => {
    for (const d of [sketchLine, sketchShape, mermaidDiagram]) {
      expect(syntaxError(d.source)).toBeNull();
      expect(kindOfSource(d.source)).toBe(d.id);
    }
    expect(kindOfSource("return 1")).toBeUndefined();
    // A picture brought in parses too, and is known by its drawing, not a mark.
    expect(syntaxError(importedPicture.source)).toBeNull();
    expect(kindOfSource(importedPicture.source)).toBeUndefined();
  });

  it("keeps the points that shape a stroke", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i < 25 ? 0 : i - 25 }));
    const kept = simplify(line, 0.5);
    expect(kept).toEqual([{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 49, y: 24 }]);
    // A stroke that doubles back along itself keeps its turning point.
    expect(simplify([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 10, y: 0 }], 0.5)).toHaveLength(3);
  });

  it("puts a stroke where it was drawn, its points as shares of its box", () => {
    const clip = inked(
      [{ x: 100, y: 100 }, { x: 150, y: 120 }, { x: 200, y: 100 }],
      { kind: "pen", width: 2, scale: 1 },
    );
    const [m] = clip.modules;
    expect(m.bounds).toEqual({ x: 96, y: 96, width: 108, height: 28 });
    expect(m.data.smooth).toBe(true);
    expect(m.data.points).toEqual([[0.037, 0.1429], [0.5, 0.8571], [0.963, 0.1429]]);
    // Pasted where it is, the work takes the drawing once and the stroke draws with it.
    const work = blank();
    const first = applied(work, paste(work, "root", clip).edit);
    const again = paste(first, "root", inked([{ x: 0, y: 0 }, { x: 40, y: 0 }], { kind: "arrow", width: 3, scale: 1 }));
    expect(again.edit.drawings).toBeUndefined();
    const next = applied(first, again.edit);
    validateWork(next);
    expect(next.scenes.root.modules.map((x) => [x.drawingId, x.bounds.x])).toEqual([
      ["sketch-line", 96],
      ["sketch-line", -6],
    ]);
    expect(next.scenes.root.modules[1].data).toMatchObject({ head: "filled", width: 3, points: [[0.1154, 0.5], [0.8846, 0.5]] });
  });
});

describe("Excalidraw", () => {
  const scene = {
    elements: [
      el({ id: "a", type: "rectangle", x: 0, y: 0, backgroundColor: "#ffc9c9", fillStyle: "hachure", boundElements: [{ id: "at", type: "text" }, { id: "ar", type: "arrow" }], groupIds: ["inner", "outer"], roundness: { type: 3 } }),
      el({ id: "at", type: "text", x: 20, y: 20, text: "开始", originalText: "开始", fontSize: 20, containerId: "a" }),
      el({ id: "b", type: "ellipse", x: 300, y: 0, strokeColor: "#1971c2", strokeStyle: "dashed", roughness: 0 }),
      el({ id: "ar", type: "arrow", x: 100, y: 30, width: 200, height: 0, points: [[0, 0], [200, 0]], startBinding: { elementId: "a" }, endBinding: { elementId: "b" }, startArrowhead: null, endArrowhead: "arrow" }),
      el({ id: "lt", type: "text", x: 180, y: 10, text: "下一步", containerId: "ar" }),
      el({ id: "free", type: "arrow", x: 0, y: 200, width: 100, height: 50, points: [[0, 0], [50, 50], [100, 0]], startArrowhead: "triangle", endArrowhead: null, roundness: { type: 2 } }),
      el({ id: "pen", type: "freedraw", x: 0, y: 300, width: 30, height: 10, points: [[0, 0], [10, 10], [20, 0], [30, 10]], strokeColor: "#e03131" }),
      el({ id: "t", type: "text", x: 400, y: 300, width: 80, height: 25, text: "说明", fontSize: 28, textAlign: "left" }),
      el({ id: "img", type: "image", x: 500, y: 0, width: 64, height: 64, fileId: "file1" }),
      el({ id: "gone", type: "rectangle", isDeleted: true }),
      el({ id: "nofile", type: "image", fileId: "missing" }),
    ],
  };

  it("brings an arrow bound at one end in as a link, its other end free where it was", () => {
    const half = {
      elements: [
        el({ id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 60, boundElements: [{ id: "down", type: "arrow" }] }),
        el({ id: "down", type: "arrow", x: 50, y: 60, width: 0, height: 300, points: [[0, 0], [0, 300]], startBinding: { elementId: "box" }, endBinding: null, startArrowhead: null, endArrowhead: null }),
      ],
    };
    const { clip } = fromExcalidraw(half, {});
    expect(clip.modules.map((m) => m.drawingId)).toEqual(["sketch-shape"]);
    expect(clip.links).toMatchObject([{ from: { moduleId: clip.modules[0].id }, to: { x: 50, y: 360 }, data: { head: "none" } }]);
  });

  it("reads a file or the clipboard, and nothing else", () => {
    expect(readExcalidraw(JSON.stringify({ type: "excalidraw", version: 2, elements: [] }))).toEqual({ elements: [], files: {} });
    expect(readExcalidraw(JSON.stringify({ type: "excalidraw/clipboard", elements: [], files: { f: 1 } }))?.files).toEqual({ f: 1 });
    expect(readExcalidraw('{"type":"other","elements":[]}')).toBeNull();
    expect(readExcalidraw("flowchart LR")).toBeNull();
  });

  it("brings shapes, words, links, lines, strokes and pictures in as parts", () => {
    const { clip, adjusted } = fromExcalidraw(scene, { file1: "pic-1" });
    expect(adjusted).toEqual({ upright: 0, opaque: 0, flipped: 0 });
    // Turned shapes, words and pictures come in upright and are counted; lines keep their turn.
    const turned = { elements: scene.elements.map((e) => (["a", "free"].includes(e.id) ? { ...e, angle: 0.5 } : e)) };
    expect(fromExcalidraw(turned, { file1: "pic-1" }).adjusted.upright).toBe(1);
    // A mirrored picture comes in the right way round, and is counted too.
    const mirrored = { elements: scene.elements.map((e) => (e.id === "img" ? { ...e, scale: [-1, 1] as [number, number] } : e)) };
    expect(fromExcalidraw(mirrored, { file1: "pic-1" }).adjusted.flipped).toBe(1);
    const { work } = pasted(blank(), clip, { "pic-1": photo("pic-1") });
    const root = work.scenes.root;
    const by = (id: string) => root.modules.find((m) => m.id === id)!;
    // In the order Excalidraw stacks them, a line on its own included.
    expect(root.modules.map((m) => [m.id, m.drawingId])).toEqual([
      ["shape-1", "sketch-shape"],
      ["shape-2", "sketch-shape"],
      ["line-1", "sketch-line"],
      ["stroke-1", "sketch-line"],
      ["text-1", "label"],
      ["picture-1", "imported-picture"],
    ]);
    expect(by("shape-1").data).toMatchObject({ shape: "rectangle", text: "开始", fill: "#ffc9c9", fillStyle: "hachure", rounded: true });
    // Excalidraw's nested groups keep the outermost.
    expect(by("shape-1").group).toBe("outer");
    expect(by("shape-2").data).toMatchObject({ shape: "ellipse", stroke: "#1971c2", dashed: true, roughness: 0, fillStyle: "none" });
    expect(by("text-1").data).toMatchObject({ text: "说明", size: 28, align: "start" });
    // Its whole file fills the box, as Excalidraw showed it.
    expect(by("picture-1").data).toEqual({ material: "pic-1" });
    // The bound arrow is a link with its words; the free one keeps its head at its end.
    expect(root.links).toHaveLength(1);
    expect(root.links[0]).toMatchObject({ drawingId: "arrow", from: { moduleId: "shape-1" }, to: { moduleId: "shape-2" }, data: { head: "open", label: "下一步" } });
    expect(by("line-1").data).toMatchObject({ head: "filled", smooth: true });
    expect((by("line-1").data.points as number[][])[0][0]).toBeGreaterThan(0.5);
    expect(by("stroke-1").data).toMatchObject({ smooth: true, color: "#e03131", width: 4 });
    // The clip is placed in the middle of the view.
    const xs = root.modules.flatMap((m) => [m.bounds.x, m.bounds.x + m.bounds.width]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(500, 0);
  });

  it("writes parts out as the elements that hold them, and the rest as pictures", () => {
    const { work } = pasted(blank(), fromExcalidraw(scene, { file1: "pic-1" }).clip, { "pic-1": photo("pic-1") });
    work.scenes.root.modules.push({ id: "box", drawingId: "node", bounds: { x: 0, y: 500, width: 160, height: 80 }, data: { title: "服务", note: "处理请求", tone: "accent" } });
    work.scenes.root.links.push({ id: "l2", drawingId: "arrow", from: { moduleId: "shape-1" }, to: { moduleId: "box" }, data: { label: "调用" } });
    work.drawings.chart = { id: "chart", name: "图表", source: "return api.svg('<svg/>')" };
    work.scenes.root.modules.push({ id: "chart", drawingId: "chart", bounds: { x: 600, y: 500, width: 100, height: 100 }, data: {} });
    work.scenes.root.modules.push({ id: "chart-file", drawingId: "chart", bounds: { x: 800, y: 500, width: 100, height: 100 }, data: {} });
    // A library picture goes out as it is drawn too, cropped, fitted and captioned.
    expect(picturesFor(work, "root")).toEqual(["picture-1", "chart", "chart-file"]);
    // Words of their own, named as the box's words would be.
    work.scenes.root.modules.push({ id: "box-text", drawingId: "label", bounds: { x: 0, y: 620, width: 160, height: 30 }, data: { text: "另一段" } });
    const svg = { dataURL: "data:image/svg+xml;base64,PHN2Zy8+", mimeType: "image/svg+xml" };
    const out = toExcalidraw(work, "root", { chart: svg, "chart-file": { ...svg, dataURL: svg.dataURL + "PC9zdmc+" } }, 1);
    const of = (id: string) => out.elements.find((e) => e.id === id)!;
    expect(new Set(out.elements.map((e) => e.id)).size).toBe(out.elements.length);
    expect(of("box-text").text).toBe("另一段");
    expect(of("box-text-2")).toMatchObject({ text: "服务\n处理请求", containerId: "box" });
    expect(of("box").boundElements).toContainEqual({ id: "box-text-2", type: "text" });
    expect(of("shape-1")).toMatchObject({ type: "rectangle", backgroundColor: "#ffc9c9", fillStyle: "hachure", roundness: { type: 3 }, groupIds: ["outer"] });
    expect(of("shape-1-text")).toMatchObject({ type: "text", text: "开始", containerId: "shape-1" });
    expect(of("box")).toMatchObject({ type: "rectangle", strokeColor: "#d97757", backgroundColor: "#d9775724" });
    // A block without a fill is filled with the paper, as it is drawn, hiding what is under it.
    work.scenes.root.modules.push({ id: "plain", drawingId: "node", bounds: { x: 200, y: 700, width: 100, height: 50 }, data: { title: "空白", fillStyle: "none" } });
    expect(toExcalidraw(work, "root", {}, 1).elements.find((e) => e.id === "plain")!.backgroundColor).toBe(work.style.paper || "#ffffff");
    expect(of("l2")).toMatchObject({ type: "arrow", startBinding: { elementId: "shape-1" }, endBinding: { elementId: "box" }, endArrowhead: "triangle" });
    expect(of("shape-1").boundElements).toEqual(expect.arrayContaining([{ id: "l2", type: "arrow" }]));
    expect(of("stroke-1")).toMatchObject({ type: "freedraw", strokeColor: "#e03131", strokeWidth: 2 });
    expect(of("line-1")).toMatchObject({ type: "arrow", endArrowhead: "triangle", startArrowhead: null });
    const chart = of("chart");
    expect(chart.type).toBe("image");
    expect(out.files[chart.fileId!].mimeType).toBe("image/svg+xml");
    // Each picture keeps a file of its own, whatever the parts are called.
    expect(of("chart-file").fileId).not.toBe(chart.fileId);
    expect(out.files[of("chart-file").fileId!].dataURL).toBe(svg.dataURL + "PC9zdmc+");
    // A straight link's words sit halfway along it.
    const arrow = of("l2"),
      said = out.elements.find((e) => e.containerId === "l2")!;
    expect(said.x + said.width / 2).toBeCloseTo(arrow.x + arrow.points![1][0] / 2, 0);
    expect(said.y + said.height / 2).toBeCloseTo(arrow.y + arrow.points![1][1] / 2, 0);
    // Without a picture, a part is outlined and named.
    expect(of("picture-1")).toMatchObject({ type: "rectangle", strokeStyle: "dashed" });
    expect(of("picture-1-text").text).toBe("导入的图片");
    // Read back, what was drawn by hand comes back the same.
    const back = pasted(blank(), fromExcalidraw(out, { [chart.fileId!]: "pic-2" }).clip, { "pic-2": photo("pic-2") }).work;
    const shapes = back.scenes.root.modules.filter((m) => m.drawingId === "sketch-shape");
    expect(shapes[0].data).toMatchObject({ shape: "rectangle", text: "开始", fill: "#ffc9c9" });
    expect(back.scenes.root.links).toHaveLength(2);
  });

  it("keeps shapes and lines seen through, leaves out what cannot be seen, and counts what comes in solid", () => {
    const {
      clip,
      adjusted: { opaque },
    } = fromExcalidraw({
      elements: [
        el({ id: "glass", type: "rectangle", opacity: 40, boundElements: [{ id: "gt", type: "text" }] }),
        el({ id: "gt", type: "text", text: "半透明", containerId: "glass", opacity: 40 }),
        el({ id: "ghost", type: "rectangle", x: 200, opacity: 0, boundElements: [{ id: "ht", type: "text" }] }),
        el({ id: "ht", type: "text", x: 200, text: "看不见", containerId: "ghost" }),
        el({ id: "note", type: "text", y: 200, text: "注", opacity: 60 }),
        el({ id: "pen", type: "freedraw", y: 100, points: [[0, 0], [50, 20], [100, 0]], opacity: 50 }),
      ],
    });
    const { work } = pasted(blank(), clip);
    const parts = work.scenes.root.modules;
    expect(parts.map((m) => m.data.text ?? m.drawingId)).toEqual(["半透明", "注", "sketch-line"]);
    expect(parts[0].data.opacity).toBe(0.4);
    expect(parts[2].data.opacity).toBe(0.5);
    // Free words are drawn by the library, which has no opacity.
    expect(opaque).toBe(1);
    const out = toExcalidraw(work, "root", {}, 1);
    expect(out.elements.filter((e) => e.opacity !== 100).map((e) => [e.type, e.opacity])).toEqual([
      ["rectangle", 40],
      ["text", 40],
      ["freedraw", 50],
    ]);
  });

  it("takes a file's colours only as colours", () => {
    const { clip } = fromExcalidraw({
      elements: [el({ id: "x", type: "rectangle", strokeColor: 'red" onload="x', backgroundColor: "<svg>" })],
    });
    expect(clip.modules[0].data).toMatchObject({ stroke: "#1e1e1e", fillStyle: "none" });
    for (const d of [sketchLine, sketchShape]) expect(d.source).toContain("const paint = ");
  });

  it("writes a right-angled link out with its turns, and reads one back as turning", () => {
    const work = blank();
    const box = (id: string, x: number, y: number) => ({ id, drawingId: "node", bounds: { x, y, width: 100, height: 60 }, data: { title: id } });
    work.scenes.root.modules.push(box("p", 0, 0), box("q", 400, 300));
    work.scenes.root.links.push({ id: "pq", drawingId: "arrow", from: { moduleId: "p" }, to: { moduleId: "q" }, data: { route: "elbow", bend: 0.2, label: "过去" } });
    const out = toExcalidraw(work, "root", {}, 1);
    const arrow = out.elements.find((e) => e.id === "pq")!;
    const [, a, b, z] = arrow.points!;
    expect(arrow.points).toHaveLength(4);
    expect(a[1]).toBe(0);
    expect(a[0]).toBeCloseTo(z[0] * 0.7, 0);
    expect(b[0]).toBe(a[0]);
    expect(arrow.roundness).toBeNull();
    // Its words sit halfway along the turns.
    const words = out.elements.find((e) => e.containerId === "pq")!;
    expect(words.x + words.width / 2).toBeCloseTo(arrow.x + a[0], 0);
    const back = pasted(blank(), fromExcalidraw(out).clip).work.scenes.root.links[0];
    expect(back.data).toMatchObject({ route: "elbow", bend: 0.2, label: "过去" });
  });

  it("bows a bound arrow with only a start head to the same side once it is turned round", () => {
    const shapes = [
      el({ id: "x", type: "rectangle", x: 0, y: 0, boundElements: [{ id: "arc", type: "arrow" }] }),
      el({ id: "y", type: "rectangle", x: 400, y: 0, boundElements: [{ id: "arc", type: "arrow" }] }),
    ];
    const forward = el({ id: "arc", type: "arrow", x: 110, y: 30, width: 280, height: 60, points: [[0, 0], [140, -60], [280, 0]], startBinding: { elementId: "x" }, endBinding: { elementId: "y" }, startArrowhead: null, endArrowhead: "triangle" });
    const backward = el({ id: "arc", type: "arrow", x: 390, y: 30, width: 280, height: 60, points: [[0, 0], [-140, -60], [-280, 0]], startBinding: { elementId: "y" }, endBinding: { elementId: "x" }, startArrowhead: "triangle", endArrowhead: null });
    const link = (arrow: ExcalidrawElement) => pasted(blank(), fromExcalidraw({ elements: [...shapes, arrow] }).clip).work.scenes.root.links[0];
    const there = link(forward),
      back = link(backward);
    expect(there.data.bend).toBeLessThan(0);
    expect(back).toMatchObject({ from: there.from, to: there.to, data: { bend: there.data.bend } });
  });

  it("writes a block or callout Excalidraw cannot draw as a picture of itself", () => {
    const work = blank();
    const block = (id: string, data: Record<string, unknown>) => ({ id, drawingId: "node", bounds: { x: 0, y: 0, width: 100, height: 60 }, data: { title: id, ...data } });
    work.scenes.root.modules.push(
      block("plain", {}),
      block("iconic", { icon: "pic-1" }),
      block("stacked", { stack: 2 }),
      block("database", { shape: "cylinder" }),
      block("page", { shape: "document" }),
      { ...block("said", {}), drawingId: "callout" },
      { ...block("aside", { tail: "none" }), drawingId: "callout" },
    );
    // Shapes Excalidraw has no element for, and a callout with its tail, go out as pictures.
    expect(picturesFor(work, "root")).toEqual(["iconic", "stacked", "database", "page", "said"]);
    const out = toExcalidraw(work, "root", {}, 1);
    expect(out.elements.find((e) => e.id === "plain")!.type).toBe("rectangle");
    // Without its picture, a composed block is outlined and named, not drawn as a bare box.
    expect(out.elements.find((e) => e.id === "iconic")).toMatchObject({ strokeStyle: "dashed" });
  });

  it("writes a work's own drawing named like a library one as a picture of itself", () => {
    const work = blank();
    work.drawings.node = { id: "node", name: "自己的节点", source: "return api.svg('<svg/>')" };
    work.scenes.root.modules.push({ id: "n", drawingId: "node", bounds: { x: 0, y: 0, width: 100, height: 60 }, data: { title: "甲" } });
    expect(picturesFor(work, "root")).toEqual(["n"]);
    const out = toExcalidraw(work, "root", { n: { dataURL: "data:image/svg+xml;base64,PHN2Zy8+", mimeType: "image/svg+xml" } }, 1);
    expect(out.elements).toEqual([expect.objectContaining({ id: "n", type: "image" })]);
  });
});

describe("Mermaid", () => {
  it("knows its source, fenced or not, and which is a flowchart", () => {
    expect(readMermaid("```mermaid\nsequenceDiagram\n  A->>B: hi\n```")).toBe("sequenceDiagram\n  A->>B: hi");
    expect(readMermaid("%% note\nflowchart LR\nA-->B")).toBe("%% note\nflowchart LR\nA-->B");
    expect(readMermaid("---\ntitle: x\n---\ngraph TD\nA-->B")).toBeTruthy();
    expect(readMermaid("hello world")).toBeNull();
    expect(isFlowchart("graph TD\nA-->B")).toBe(true);
    expect(isFlowchart("sequenceDiagram\nA->>B: x")).toBe(false);
  });

  it("brings a flowchart in as blocks and links, and any other diagram whole", () => {
    const clip = fromFlowchart({
      nodes: [
        { id: "A", text: "开始", shape: "pill", box: { x: 0, y: 0, width: 120, height: 50 } },
        { id: "B", text: "是否通过", shape: "diamond", box: { x: 0, y: 120, width: 140, height: 90 }, stroke: "#c00", fill: "#fee" },
        { id: "C", text: "归档", shape: "box", box: { x: 320, y: 100, width: 100, height: 50 } },
      ],
      edges: [
        { from: "A", to: "B", text: "提交", head: "filled", dashed: true },
        { from: "B", to: "A", head: "filled" },
        { from: "B", to: "missing", head: "filled" },
        { from: "B", to: "B", text: "重试", head: "filled", dashed: true },
        { from: "S", to: "C", text: "汇总", head: "filled" },
      ],
      groups: [{ id: "S", title: "流程", box: { x: -20, y: -20, width: 200, height: 260 } }],
    });
    const { work } = pasted(blank(), clip);
    const root = work.scenes.root;
    expect(root.modules.map((m) => [m.drawingId, m.data.title ?? m.data.text ?? ""])).toEqual([
      ["node", ""],
      ["label", "流程"],
      ["node", "开始"],
      ["node", "是否通过"],
      ["node", "归档"],
      ["sketch-line", ""],
      ["label", "重试"],
    ]);
    expect(root.modules[3].data).toMatchObject({ shape: "diamond", color: "#c00", fillStyle: "soft" });
    // Two edges between the same blocks bow apart.
    expect(root.links.map((l) => l.data)).toEqual([{ bend: 0.25, dashed: true, label: "提交" }, { bend: 0.25 }, { label: "汇总" }]);
    // An edge from a subgraph starts at the box it came in as.
    expect(root.links[2]).toMatchObject({ from: { moduleId: root.modules[0].id }, to: { moduleId: root.modules[4].id } });
    // An edge back to its block, which a link cannot draw, is a loop over the block with its
    // words, grouped with it so they move together.
    const [block, , loop, words] = root.modules.slice(3);
    expect(loop.data).toMatchObject({ head: "filled", smooth: true, dashed: true });
    expect(loop.bounds.y + loop.bounds.height).toBeLessThanOrEqual(block.bounds.y + 8);
    expect(words.bounds.y).toBeLessThan(loop.bounds.y);
    expect(new Set([block.group, loop.group, words.group]).size).toBe(1);
    expect(block.group).toBeTruthy();
    const whole = pasted(blank(), mermaidBlock("pie\n  \"a\": 1", { width: 300, height: 200 })).work;
    expect(whole.scenes.root.modules[0]).toMatchObject({ drawingId: "mermaid", data: { source: 'pie\n  "a": 1' } });
    expect(toMermaid(whole, "root")).toBe('pie\n  "a": 1');
    // One Mermaid source holds one diagram, so two cannot go out as one.
    const two = pasted(whole, mermaidBlock("sequenceDiagram\n  A->>B: hi", { width: 300, height: 200 })).work;
    expect(() => toMermaid(two, "root")).toThrow(SeveralDiagrams);
  });

  it("writes a scene's blocks and links out as a flowchart", () => {
    const { work } = pasted(
      blank(),
      fromFlowchart({
        nodes: [
          { id: "A", text: '说 "你好"', shape: "box", box: { x: 0, y: 0, width: 100, height: 50 } },
          { id: "B", text: "end", shape: "circle", box: { x: 0, y: 200, width: 60, height: 60 } },
        ],
        edges: [{ from: "A", to: "B", text: "然后", head: "none", thick: true }],
        groups: [],
      }),
    );
    expect(toMermaid(work, "root")).toBe(
      'flowchart TD\n  node_1["说 #quot;你好#quot;"]\n  node_2(("end"))\n  node_1 ===|"然后"| node_2\n',
    );
    expect(toMermaid(blank(), "root")).toBeNull();
  });
});
