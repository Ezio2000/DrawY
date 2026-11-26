import type { ChoiceOption, Drawing, Field } from "../contracts/index.ts";

/* The drawings hand-made and imported parts are drawn with when the library has none that
 * fits: a line drawn by hand, a shape as Excalidraw draws it, a picture as another tool
 * showed it, and a diagram written in Mermaid. Each goes into a work as a drawing of its
 * own, through a clip, so it is a part of the work like any other: the author reads and
 * changes it as it would its own code, and nothing in the library, the author's prompts or
 * its tools knows about them. The line, the shape and the diagram open with a mark, so a
 * part drawn with one is known again on export whatever id the work gave the drawing; an
 * imported picture goes out as a picture of itself like anything else. */

const L = (zh: string, en: string) => ({ zh, en });
/** A choice among named options, each as the editor shows it. */
const among = (zh: string, en: string, ...options: [string, string, string][]): Field => ({
  type: "choice",
  label: L(zh, en),
  options: options.map(([value, z, e]): ChoiceOption => ({ value, label: L(z, e) })),
});
const value = (type: "color" | "boolean" | "text" | "picture", zh: string, en: string): Field => ({ type, label: L(zh, en) });
const amount = (zh: string, en: string, min: number, max: number, step: number): Field => ({ type: "number", label: L(zh, en), min, max, step });

const SKETCH_LINE = "// drawy:sketch-line";
const SKETCH_SHAPE = "// drawy:sketch-shape";
const MERMAID = "// drawy:mermaid";

/** A line drawn by hand: a freehand stroke through its points, or straight segments
 * between them, with a head at its end or both ends. Points are shares of the box, so the
 * line stretches with it while its width stays. */
export const sketchLine: Drawing = {
  id: "sketch-line",
  name: "手绘线",
  params: {
    points: {
      type: "list",
      label: L("经过的点", "Points"),
      item: { type: "list", item: { type: "number" }, min: 2, max: 2 },
      description: "[x, y] shares of the box, in drawing order",
    },
    color: value("color", "颜色", "Colour"),
    width: amount("线宽", "Line width", 0.5, 24, 0.5),
    head: among("箭头", "Arrowhead", ["none", "无", "None"], ["filled", "实心", "Filled"], ["open", "开口", "Open"]),
    both: value("boolean", "两端都有箭头", "Both ends"),
    dashed: value("boolean", "虚线", "Dashed"),
    smooth: value("boolean", "平滑", "Smooth"),
    opacity: amount("浓淡", "Opacity", 0.05, 1, 0.05),
  },
  defaults: { width: 2, head: "none", both: false, dashed: false, smooth: false, opacity: 1 },
  source: `${SKETCH_LINE}
// A line drawn by hand through data.points (shares of the box): a smooth curve when
// data.smooth, else straight segments; data.head puts an arrowhead at its end (both ends
// with data.both), seen through as much as data.opacity leaves. The line keeps its width
// whatever the box's size, and links meet it along its path.
const d = api.data, t = api.theme;
const W = api.width, H = api.height;
const pts = (Array.isArray(d.points) ? d.points : [])
  .filter((p) => Array.isArray(p) && p.length >= 2)
  .map((p) => ({ x: Number(p[0]) * W, y: Number(p[1]) * H }));
const w = Math.max(0.5, Number(d.width ?? 2));
// A colour as CSS writes one, else nothing: what goes into the markup is only ever a colour.
const paint = (c) => (typeof c === "string" && /^[#\\w(),.%\\s/+-]+$/.test(c) ? c : "");
const color = paint(d.color) || t.ink || "#333";
const f = (v) => Math.round(v * 100) / 100;
let path = "";
if (pts.length === 1) path = "M" + f(pts[0].x) + " " + f(pts[0].y) + "h0.01";
else if (d.smooth && pts.length > 2) {
  path = "M" + f(pts[0].x) + " " + f(pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    path += "C" + [p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y].map(f).join(" ");
  }
} else path = pts.map((p, i) => (i ? "L" : "M") + f(p.x) + " " + f(p.y)).join("");
const head = d.head || "none";
const hl = Math.max(8, w * 4), hw = hl * 0.45;
// The way a head points: from a point at least a head's length back along the line.
const behind = (list) => {
  const end = list[list.length - 1];
  for (let i = list.length - 2; i >= 0; i--)
    if (Math.hypot(end.x - list[i].x, end.y - list[i].y) >= hl) return list[i];
  return list[0];
};
const tip = (p, q) => {
  const l = Math.hypot(p.x - q.x, p.y - q.y) || 1;
  const ux = (p.x - q.x) / l, uy = (p.y - q.y) / l;
  const bx = p.x - ux * hl, by = p.y - uy * hl, sx = -uy * hw, sy = ux * hw;
  return head === "open"
    ? '<path d="M' + [bx + sx, by + sy].map(f).join(" ") + "L" + [p.x, p.y].map(f).join(" ") + "L" + [bx - sx, by - sy].map(f).join(" ") + '" fill="none"/>'
    : '<path d="M' + [p.x, p.y].map(f).join(" ") + "L" + [bx + sx, by + sy].map(f).join(" ") + "L" + [bx - sx, by - sy].map(f).join(" ") + 'Z" fill="' + color + '"/>';
};
const heads = head !== "none" && pts.length > 1
  ? tip(pts[pts.length - 1], behind(pts)) + (d.both ? tip(pts[0], behind([...pts].reverse())) : "")
  : "";
const dash = d.dashed ? ' stroke-dasharray="' + f(w * 3) + " " + f(w * 2.5) + '"' : "";
// Links meet the line itself, anywhere along it, rather than its box.
if (pts.length > 1) api.outline(path);
return api.svg(
  '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" style="overflow:visible">' +
    '<path d="' + path + '" fill="none" stroke="transparent" stroke-width="' + (w + 12) + '" stroke-linecap="round"/>' +
    '<g stroke="' + color + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" opacity="' + f(Math.min(1, Math.max(0, Number(d.opacity ?? 1)))) + '">' +
    '<path d="' + path + '" fill="none"' + dash + "/>" + heads + "</g></svg>",
);`,
};

/** A shape as Excalidraw draws it: a rectangle, an ellipse or a diamond with its own
 * outline and fill (hachure, cross-hatch or solid), drawn rough as by hand or clean, and
 * words inside. */
export const sketchShape: Drawing = {
  id: "sketch-shape",
  name: "手绘形状",
  params: {
    text: value("text", "文字", "Words"),
    shape: among("形状", "Shape", ["rectangle", "矩形", "Rectangle"], ["ellipse", "椭圆", "Ellipse"], ["diamond", "菱形", "Diamond"]),
    stroke: value("color", "描边色", "Outline"),
    fill: value("color", "填充色", "Fill"),
    fillStyle: among("填充方式", "Fill style", ["hachure", "斜线", "Hachure"], ["cross-hatch", "交叉线", "Cross-hatch"], ["solid", "实色", "Solid"], ["none", "无", "None"]),
    strokeWidth: amount("线宽", "Line width", 0.5, 12, 0.5),
    dashed: value("boolean", "虚线", "Dashed"),
    roughness: amount("手绘感", "Roughness", 0, 3, 0.5),
    rounded: value("boolean", "圆角", "Rounded"),
    size: amount("字号", "Font size", 8, 120, 1),
    textColor: value("color", "文字颜色", "Text colour"),
    align: among("对齐", "Align", ["left", "左", "Left"], ["center", "中", "Centre"], ["right", "右", "Right"]),
    opacity: amount("浓淡", "Opacity", 0.05, 1, 0.05),
    seed: { type: "number", label: L("形状变化", "Variation"), description: "fixes how the lines waver" },
  },
  defaults: {
    shape: "rectangle",
    fillStyle: "hachure",
    strokeWidth: 2,
    dashed: false,
    roughness: 1,
    rounded: false,
    size: 20,
    align: "center",
    opacity: 1,
  },
  source: `${SKETCH_SHAPE}
// A shape as Excalidraw draws it: data.shape (rectangle, ellipse, diamond) outlined in
// data.stroke and filled with data.fill (hachure, cross-hatch or solid), its lines wavering
// as much as data.roughness (0 draws it clean) the same way every time (data.seed), with
// data.text in the middle, the whole seen through as much as data.opacity leaves.
const d = api.data, t = api.theme;
const W = api.width, H = api.height;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const f = (v) => Math.round(v * 100) / 100;
const sw = Math.max(0.5, Number(d.strokeWidth ?? 2));
// A colour as CSS writes one, else nothing: what goes into the markup is only ever a colour.
const paint = (c) => (typeof c === "string" && /^[#\\w(),.%\\s/+-]+$/.test(c) ? c : "");
const stroke = paint(d.stroke) || t.ink || "#1e1e1e";
const fill = paint(d.fill) && d.fill !== "transparent" ? d.fill : "";
const rough = Math.max(0, Number(d.roughness ?? 1));
let seed = Math.abs(Math.round(Number(d.seed ?? 1))) % 2147483646 || 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const jit = (k) => (rand() - 0.5) * 2 * k * rough;
const shape = d.shape || "rectangle";
const pad = sw / 2 + 1;
const x0 = pad, y0 = pad, x1 = W - pad, y1 = H - pad, cx = W / 2, cy = H / 2;
const radius = d.rounded ? Math.min(Math.min(W, H) * 0.25, 32) : 0;
// The shape's outline, as one clean path for the fill and the hatching's clip.
let outline;
if (shape === "ellipse")
  outline = "M" + f(x0) + " " + f(cy) + "A" + f(cx - x0) + " " + f(cy - y0) + " 0 1 1 " + f(x1) + " " + f(cy) + "A" + f(cx - x0) + " " + f(cy - y0) + " 0 1 1 " + f(x0) + " " + f(cy) + "Z";
else if (shape === "diamond")
  outline = "M" + f(cx) + " " + f(y0) + "L" + f(x1) + " " + f(cy) + "L" + f(cx) + " " + f(y1) + "L" + f(x0) + " " + f(cy) + "Z";
else if (radius)
  outline = "M" + f(x0 + radius) + " " + f(y0) + "H" + f(x1 - radius) + "Q" + f(x1) + " " + f(y0) + " " + f(x1) + " " + f(y0 + radius) + "V" + f(y1 - radius) + "Q" + f(x1) + " " + f(y1) + " " + f(x1 - radius) + " " + f(y1) + "H" + f(x0 + radius) + "Q" + f(x0) + " " + f(y1) + " " + f(x0) + " " + f(y1 - radius) + "V" + f(y0 + radius) + "Q" + f(x0) + " " + f(y0) + " " + f(x0 + radius) + " " + f(y0) + "Z";
else outline = "M" + f(x0) + " " + f(y0) + "H" + f(x1) + "V" + f(y1) + "H" + f(x0) + "Z";
// A line as a hand draws it: bowed a little in the middle, the ends overshooting, twice.
const wobble = Math.min(W, H) * 0.012 + 1.2;
const line = (a, b) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const k = Math.min(wobble, len * 0.06 + 0.4);
  const m = { x: a.x + (b.x - a.x) * (0.45 + rand() * 0.1) + jit(k), y: a.y + (b.y - a.y) * (0.45 + rand() * 0.1) + jit(k) };
  return "M" + f(a.x + jit(k)) + " " + f(a.y + jit(k)) + "Q" + f(m.x) + " " + f(m.y) + " " + f(b.x + jit(k)) + " " + f(b.y + jit(k));
};
const polygon = (ps) => ps.map((p, i) => line(p, ps[(i + 1) % ps.length])).join("");
// A rounded rectangle as a hand draws it: each side a wavering line, each corner a curve.
const roundRect = () => {
  const r = radius, k = wobble * 0.5;
  const pt = (x, y) => f(x + jit(k)) + " " + f(y + jit(k));
  const corner = (ax, ay, cx_, cy_, bx, by) => "M" + pt(ax, ay) + "Q" + pt(cx_, cy_) + " " + pt(bx, by);
  return (
    line({ x: x0 + r, y: y0 }, { x: x1 - r, y: y0 }) + corner(x1 - r, y0, x1, y0, x1, y0 + r) +
    line({ x: x1, y: y0 + r }, { x: x1, y: y1 - r }) + corner(x1, y1 - r, x1, y1, x1 - r, y1) +
    line({ x: x1 - r, y: y1 }, { x: x0 + r, y: y1 }) + corner(x0 + r, y1, x0, y1, x0, y1 - r) +
    line({ x: x0, y: y1 - r }, { x: x0, y: y0 + r }) + corner(x0, y0 + r, x0, y0, x0 + r, y0)
  );
};
const ellipse = () => {
  const n = 18, rx = cx - x0, ry = cy - y0, start = rand() * Math.PI * 2;
  const ps = [];
  for (let i = 0; i <= n + 1; i++) {
    const a = start + (i / n) * Math.PI * 2;
    ps.push({ x: cx + Math.cos(a) * (rx + jit(wobble * 0.8)), y: cy + Math.sin(a) * (ry + jit(wobble * 0.8)) });
  }
  let p = "M" + f(ps[0].x) + " " + f(ps[0].y);
  for (let i = 1; i < ps.length - 1; i++) {
    const a = ps[i], b = ps[i + 1];
    p += "Q" + f(a.x) + " " + f(a.y) + " " + f((a.x + b.x) / 2) + " " + f((a.y + b.y) / 2);
  }
  return p;
};
const corners =
  shape === "diamond"
    ? [{ x: cx, y: y0 }, { x: x1, y: cy }, { x: cx, y: y1 }, { x: x0, y: cy }]
    : [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const strokes = !rough
  ? outline
  : shape === "ellipse"
    ? ellipse() + ellipse()
    : radius
      ? roundRect() + roundRect()
      : polygon(corners) + polygon(corners);
// The fill: solid, or lines across it at the angle Excalidraw hatches at.
const style = fill ? d.fillStyle || "hachure" : "none";
let body = "";
const clip = "c" + Math.round(rand() * 1e9).toString(36);
if (style === "solid") body = '<path d="' + outline + '" fill="' + fill + '"/>';
else if (style === "hachure" || style === "cross-hatch") {
  const gap = Math.max(5, sw * 4), span = W + H;
  let lines = "";
  const hatch = (dir) => {
    for (let s = -span; s < span; s += gap) {
      const a = { x: s, y: 0 }, b = { x: s + dir * H, y: H };
      lines += rough ? line(dir > 0 ? a : { x: s + H, y: 0 }, dir > 0 ? b : { x: s, y: H }) : "M" + f(dir > 0 ? a.x : s + H) + " 0L" + f(dir > 0 ? b.x : s) + " " + f(H);
    }
  };
  hatch(1);
  if (style === "cross-hatch") hatch(-1);
  body = '<clipPath id="' + clip + '"><path d="' + outline + '"/></clipPath><path d="' + lines + '" clip-path="url(#' + clip + ')" fill="none" stroke="' + fill + '" stroke-width="' + f(Math.max(1, sw / 2)) + '" stroke-linecap="round"/>';
}
const dash = d.dashed ? ' stroke-dasharray="' + f(sw * 4) + " " + f(sw * 3) + '"' : "";
const size = Number(d.size ?? 20);
const align = d.align === "left" ? "left" : d.align === "right" ? "right" : "center";
const inset = shape === "rectangle" ? { x: size * 0.5, y: size * 0.4 } : { x: W * 0.18, y: H * 0.16 };
return api.html(
  "<style>:host,.shape{position:relative;width:" + W + "px;height:" + H + "px}.shape{opacity:" + f(Math.min(1, Math.max(0, Number(d.opacity ?? 1)))) + "}svg{position:absolute;inset:0;overflow:visible}" +
    ".words{position:absolute;left:" + inset.x + "px;right:" + inset.x + "px;top:" + inset.y + "px;bottom:" + inset.y + "px;display:flex;align-items:center;justify-content:" + (align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center") + ";text-align:" + align + ";font-family:" + esc(t.font || "system-ui") + ";font-size:" + size + "px;line-height:1.25;color:" + (paint(d.textColor) || stroke) + ";white-space:pre-wrap;overflow-wrap:anywhere}</style>" +
    '<div class="shape"><svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' + body +
    '<path d="' + strokes + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"' + dash + "/></svg>" +
    (d.text ? '<div class="words">' + esc(d.text) + "</div>" : "") + "</div>",
);`,
};

/** A picture brought in from another tool, its whole file filling the box with its margins
 * and hard edges, as that tool showed it. The library's picture drawing fits a picture by
 * its visible content and feathers a painted one into the paper, which would change an
 * imported picture's size, place and edges. */
export const importedPicture: Drawing = {
  id: "imported-picture",
  name: "导入的图片",
  params: { material: value("picture", "图片", "Picture") },
  source: `// A picture (data.material) as its whole file fills the box, margins and edges as they are.
const info = api.materials[api.data.material];
if (!info) throw Error("素材 " + api.data.material + " 不在作品中");
const root = api.html('<div style="width:' + api.width + "px;height:" + api.height + 'px"></div>').firstElementChild;
const img = document.createElement("img");
img.src = info.url;
img.alt = info.name;
img.draggable = false;
img.style.cssText = "display:block;width:100%;height:100%";
root.append(img);
return root;`,
};

/** A diagram written in Mermaid, drawn by the browser from its source and fitted to the
 * box: the diagram types the library has no drawing for (sequence, class, state, ER,
 * Gantt, pie and the rest). */
export const mermaidDiagram: Drawing = {
  id: "mermaid",
  name: "Mermaid 图",
  params: { source: { type: "text", long: true, label: L("Mermaid 代码", "Mermaid code") } },
  source: `${MERMAID}
// A diagram written in Mermaid (data.source), drawn by the browser and fitted to the box.
const root = await api.mermaid(String(api.data.source || ""));
const svg = root.querySelector("svg");
if (svg) {
  svg.removeAttribute("style");
  svg.setAttribute("width", String(api.width));
  svg.setAttribute("height", String(api.height));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
}
root.style.cssText = "width:" + api.width + "px;height:" + api.height + "px";
return root;`,
};

/** What a drawing's code says it is, by the mark it opens with. */
export function kindOfSource(source: string | undefined) {
  if (!source) return undefined;
  if (source.startsWith(SKETCH_LINE)) return "sketch-line" as const;
  if (source.startsWith(SKETCH_SHAPE)) return "sketch-shape" as const;
  if (source.startsWith(MERMAID)) return "mermaid" as const;
  return undefined;
}

/** Points with the ones that add nothing to the line's shape taken out: those within
 * `tolerance` of the segment between their neighbours (Ramer–Douglas–Peucker). Distances
 * are to the segment, not the line through it, so a stroke that doubles back keeps its
 * turning point. */
export function simplify(points: { x: number; y: number }[], tolerance: number) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1,
      most = tolerance;
    const p = points[a],
      q = points[b];
    const dx = q.x - p.x,
      dy = q.y - p.y,
      l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const r = points[i];
      const t = l2 ? Math.max(0, Math.min(1, ((r.x - p.x) * dx + (r.y - p.y) * dy) / l2)) : 0;
      const d = Math.hypot(r.x - p.x - t * dx, r.y - p.y - t * dy);
      if (d > most) {
        most = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
