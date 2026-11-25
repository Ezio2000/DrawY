import type { Bounds, Instance, Point, Work } from "../contracts/index.ts";
import { drawingOf, shownName } from "../contracts/index.ts";
import { linkEnds } from "../contracts/geometry.ts";
import { bound, type Clip } from "../editing/index.ts";
import { ClipMaker, lineBox } from "./clip.ts";
import { kindOfSource, simplify, sketchLine, sketchShape } from "./drawings.ts";
import { NODE, CALLOUT, toneColor } from "./library.ts";

/* Excalidraw's scenes, in and out. A scene read in becomes parts of the work: its shapes
 * keep their hand-drawn look (the work's own sketch-shape drawing), its words are words,
 * an arrow bound at both ends becomes a link that follows the shapes, any other line or
 * stroke a line drawn by hand, a picture a picture of the library. A scene written out
 * gives each part the element that holds it best, and whatever has no such element
 * (a chart, a map, anything the author drew in code) as a picture of itself. */

export interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  groupIds?: string[];
  frameId?: string | null;
  roundness?: { type: number; value?: number } | null;
  seed?: number;
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
  boundElements?: { id: string; type: string }[] | null;
  updated?: number;
  link?: string | null;
  locked?: boolean;
  // text
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  verticalAlign?: string;
  containerId?: string | null;
  lineHeight?: number;
  autoResize?: boolean;
  // lines, arrows and strokes
  points?: [number, number][];
  startBinding?: { elementId: string; focus?: number; gap?: number } | null;
  endBinding?: { elementId: string; focus?: number; gap?: number } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  lastCommittedPoint?: [number, number] | null;
  elbowed?: boolean;
  pressures?: number[];
  simulatePressure?: boolean;
  // pictures and frames
  fileId?: string | null;
  status?: string;
  scale?: [number, number];
  name?: string | null;
}
export interface ExcalidrawFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created?: number;
}
export interface ExcalidrawScene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string; gridSize: number | null };
  files: Record<string, ExcalidrawFile>;
}

/** Excalidraw's scene in a file (.excalidraw) or on the clipboard, if the text is one. */
export function readExcalidraw(
  text: string,
): { elements: ExcalidrawElement[]; files: Record<string, ExcalidrawFile> } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const data = JSON.parse(trimmed);
    if (
      (data?.type === "excalidraw" || data?.type === "excalidraw/clipboard") &&
      Array.isArray(data.elements)
    )
      return { elements: data.elements, files: data.files ?? {} };
  } catch {}
  return null;
}

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const LINES = new Set(["arrow", "line"]);
const transparent = (c?: string) => !c || c === "transparent" || /^#[0-9a-f]{6}00$/i.test(c);
/** A point turned about a centre. */
const turned = (p: Point, c: Point, angle: number): Point =>
  angle
    ? {
        x: c.x + (p.x - c.x) * Math.cos(angle) - (p.y - c.y) * Math.sin(angle),
        y: c.y + (p.x - c.x) * Math.sin(angle) + (p.y - c.y) * Math.cos(angle),
      }
    : p;
/** Where a line's points are in the scene, its turn included. */
function linePoints(e: ExcalidrawElement): Point[] {
  const pts = (e.points?.length ? e.points : [[0, 0]]).map(([x, y]) => ({ x: e.x + x, y: e.y + y }));
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  const c = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  return pts.map((p) => turned(p, c, e.angle ?? 0));
}
const headOf = (h?: string | null) => (!h ? "none" : h === "arrow" ? "open" : "filled");
/** The group a part keeps: Excalidraw nests groups, a work has one level, so the outermost. */
const groupOf = (e: ExcalidrawElement) => e.groupIds?.at(-1);

/** What an Excalidraw scene becomes: the clip to paste, and how many of its shapes, words
 * and pictures were turned and come in upright, since a work has no rotation. */
export interface Brought {
  clip: Clip;
  upright: number;
}
/** The parts an Excalidraw scene becomes, as a clip to paste. Pictures come in as the
 * library materials `pictures` maps their files to; one without is left out. Lines and
 * strokes keep their rotation in their points; shapes, words and pictures come in upright. */
export function fromExcalidraw(
  scene: { elements: ExcalidrawElement[] },
  pictures: Record<string, string> = {},
): Brought {
  const b = bound();
  const made = new ClipMaker();
  const live = scene.elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  // Words held by a shape or an arrow, by the element holding them.
  const held = new Map<string, ExcalidrawElement>();
  for (const e of live)
    if (e.type === "text" && e.containerId && byId.has(e.containerId)) held.set(e.containerId, e);
  // Arrows bound at both ends to parts that come in become links; their words go with them.
  const moduleOf = new Map<string, string>();
  const isPart = (e?: ExcalidrawElement) =>
    !!e &&
    (SHAPES.has(e.type) ||
      (e.type === "text" && !held.has(e.containerId ?? "")) ||
      (e.type === "image" && !!pictures[e.fileId ?? ""]));
  const linked = (e: ExcalidrawElement) => {
    const from = e.startBinding?.elementId,
      to = e.endBinding?.elementId;
    return (
      LINES.has(e.type) &&
      from &&
      to &&
      from !== to &&
      isPart(byId.get(from)) &&
      isPart(byId.get(to))
    );
  };
  const taken = new Set<ExcalidrawElement>();
  for (const [container, words] of held)
    if (SHAPES.has(byId.get(container)!.type) || linked(byId.get(container)!)) taken.add(words);

  // Frames lie at the bottom, as Excalidraw draws them behind what they hold.
  const order = [...live.filter((e) => e.type === "frame" || e.type === "magicframe"), ...live.filter((e) => e.type !== "frame" && e.type !== "magicframe")];
  for (const e of order) {
    const group = groupOf(e);
    const box = { x: e.x, y: e.y, width: Math.abs(e.width) || 1, height: Math.abs(e.height) || 1 };
    const common = { ...(group ? { group } : {}) };
    if (SHAPES.has(e.type)) {
      const words = held.get(e.id);
      const data: Record<string, unknown> = {
        shape: e.type,
        stroke: e.strokeColor || "#1e1e1e",
        seed: e.seed ?? 1,
      };
      if (!transparent(e.backgroundColor)) {
        data.fill = e.backgroundColor;
        data.fillStyle =
          e.fillStyle === "solid" ? "solid" : e.fillStyle === "cross-hatch" ? "cross-hatch" : "hachure";
      } else data.fillStyle = "none";
      if (e.strokeWidth !== undefined && e.strokeWidth !== 2) data.strokeWidth = e.strokeWidth;
      if (e.strokeStyle && e.strokeStyle !== "solid") data.dashed = true;
      if (e.roughness !== undefined && e.roughness !== 1) data.roughness = e.roughness;
      if (e.roundness) data.rounded = true;
      if (words?.text) {
        data.text = words.originalText || words.text;
        if (words.fontSize && words.fontSize !== 20) data.size = words.fontSize;
        if (words.strokeColor && words.strokeColor !== data.stroke) data.textColor = words.strokeColor;
        if (words.textAlign && words.textAlign !== "center") data.align = words.textAlign;
      }
      moduleOf.set(
        e.id,
        made.module(
          { ...common, bounds: box, drawingId: made.drawing(sketchShape), data },
          "shape",
        ),
      );
    } else if (e.type === "text" && !taken.has(e)) {
      const data: Record<string, unknown> = {
        text: e.originalText || e.text || "",
        size: e.fontSize ?? 20,
        weight: 400,
        align: e.textAlign === "left" ? "start" : e.textAlign === "right" ? "end" : "center",
      };
      if (e.strokeColor && e.strokeColor !== "#1e1e1e") data.color = e.strokeColor;
      moduleOf.set(
        e.id,
        made.module(
          { ...common, bounds: box, drawingId: made.material(b.text), data },
          "text",
        ),
      );
    } else if (e.type === "image") {
      const material = pictures[e.fileId ?? ""];
      if (!material) continue;
      made.material(material);
      moduleOf.set(
        e.id,
        made.module(
          {
            ...common,
            bounds: box,
            drawingId: made.material(b.picture),
            data: { material, fit: "cover" },
          },
          "picture",
        ),
      );
    } else if (e.type === "frame" || e.type === "magicframe") {
      made.module(
        {
          bounds: box,
          drawingId: made.drawing(sketchShape),
          data: { shape: "rectangle", stroke: "#bbbbbb", strokeWidth: 1, roughness: 0, rounded: true, fillStyle: "none" },
        },
        "frame",
      );
      if (e.name)
        made.module(
          {
            bounds: { x: e.x, y: e.y - 26, width: Math.max(80, e.name.length * 9), height: 22 },
            drawingId: made.material(b.text),
            data: { text: e.name, size: 14, weight: 400, align: "start", color: "#888888" },
          },
          "text",
        );
    }
  }
  const upright = [...moduleOf.keys()].filter((id) => Math.abs(byId.get(id)!.angle ?? 0) > 1e-3).length;
  // Lines and arrows go after the shapes, so links can name both ends.
  for (const e of live) {
    if (!LINES.has(e.type) && e.type !== "freedraw") continue;
    const group = groupOf(e);
    const words = held.get(e.id);
    if (linked(e)) {
      let from = moduleOf.get(e.startBinding!.elementId)!,
        to = moduleOf.get(e.endBinding!.elementId)!;
      let start = e.startArrowhead,
        end = e.endArrowhead;
      // A head only at the start reads as a link the other way round.
      if (!end && start) [from, to, start, end] = [to, from, end, start];
      const data: Record<string, unknown> = { head: e.type === "line" ? "none" : headOf(end) };
      if (start) data.both = true;
      if (e.strokeStyle && e.strokeStyle !== "solid") data.dashed = true;
      if (e.strokeColor && e.strokeColor !== "#1e1e1e") data.color = e.strokeColor;
      if (e.strokeWidth && e.strokeWidth !== 2) data.width = e.strokeWidth;
      if (e.elbowed) data.route = "elbow";
      else if ((e.points?.length ?? 0) > 2) {
        // A curve through a middle point: the bend that passes through it.
        const pts = linePoints(e);
        const a = pts[0],
          z = pts.at(-1)!,
          m = pts[Math.floor(pts.length / 2)];
        const len = Math.hypot(z.x - a.x, z.y - a.y) || 1;
        const ux = (z.x - a.x) / len,
          uy = (z.y - a.y) / len;
        const off = (m.x - (a.x + z.x) / 2) * -uy + (m.y - (a.y + z.y) / 2) * ux;
        const bend = Math.max(-1, Math.min(1, Math.round(((2 * off) / len) * 100) / 100));
        if (bend) data.bend = bend;
      }
      if (words?.text) data.label = words.originalText || words.text;
      made.link(
        { drawingId: made.material(b.link), from: { moduleId: from }, to: { moduleId: to }, data },
        "link",
      );
      continue;
    }
    const freehand = e.type === "freedraw";
    let pts = linePoints(e);
    if (freehand) pts = simplify(pts, 0.6);
    const width = (e.strokeWidth ?? 2) * (freehand ? 2 : 1);
    const { box, points } = lineBox(pts, Math.max(4, width * 2));
    const data: Record<string, unknown> = { points };
    if (freehand || (e.roundness && pts.length > 2)) data.smooth = true;
    if (width !== 2) data.width = width;
    if (e.strokeColor && e.strokeColor !== "#1e1e1e") data.color = e.strokeColor;
    if (e.strokeStyle && e.strokeStyle !== "solid") data.dashed = true;
    if (e.type === "arrow") {
      let list = points;
      let start = e.startArrowhead,
        end = e.endArrowhead;
      if (!end && start) {
        list = [...points].reverse();
        [start, end] = [end, start];
      }
      data.points = list;
      data.head = headOf(end);
      if (start) data.both = true;
    }
    made.module(
      { ...(group ? { group } : {}), bounds: box, drawingId: made.drawing(sketchLine), data },
      freehand ? "stroke" : "line",
    );
  }
  return { clip: made.clip(), upright };
}

/* —— out —— */

/** A part written out as Excalidraw can hold it, or as a picture of itself. */
export type Outgoing =
  | { moduleId: string; kind: "picture"; material: string }
  | { moduleId: string; kind: "snapshot" };
/** The parts of a scene that go out as pictures: a library picture by its file, anything
 * else by how it is drawn. Whoever writes the scene out makes these pictures first. */
export function picturesFor(work: Work, sceneId: string): Outgoing[] {
  const b = bound();
  return work.scenes[sceneId].modules.flatMap((m): Outgoing[] => {
    if (writable(work, m)) return [];
    const material = m.data.material;
    if (m.drawingId === b.picture && typeof material === "string" && work.materials[material]?.kind === "picture")
      return [{ moduleId: m.id, kind: "picture", material }];
    return [{ moduleId: m.id, kind: "snapshot" }];
  });
}
/** Whether a module goes out as elements of its own rather than as a picture. */
function writable(work: Work, m: Instance) {
  const b = bound();
  const kind = kindOfSource(work.drawings[m.drawingId]?.source);
  if (kind === "sketch-line" || kind === "sketch-shape") return true;
  if (work.drawings[m.drawingId]) return false;
  return m.drawingId === NODE || m.drawingId === CALLOUT || m.drawingId === b.text;
}
/** A picture a part goes out as, as a data URL. */
export interface Picture {
  dataURL: string;
  mimeType: string;
}

/** Text's size as Excalidraw lays it out: a line per break, wide letters for CJK. */
function measure(text: string, size: number, lineHeight = 1.25) {
  const lines = text.split("\n");
  const wide = (l: string) =>
    [...l].reduce((w, ch) => w + (/[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch) ? 1 : 0.55), 0);
  return {
    width: Math.max(...lines.map(wide), 1) * size,
    height: lines.length * size * lineHeight,
  };
}

/** A scene of a work as an Excalidraw scene. Parts drawn as pictures take the pictures
 * given for them, and a part with none is outlined with its name. */
export function toExcalidraw(
  work: Work,
  sceneId: string,
  pictures: Record<string, Picture> = {},
  now = Date.now(),
): ExcalidrawScene {
  const b = bound();
  const scene = work.scenes[sceneId];
  const style = work.style;
  const ink = style.ink || "#1e1e1e";
  let n = 0;
  // Seeds and nonces follow from the ids, so the same scene writes out the same file.
  const hash = (s: string) =>
    Math.abs([...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)) % 2147483647 || 1;
  const base = (id: string, type: string, box: Bounds, extra: Partial<ExcalidrawElement> = {}): ExcalidrawElement => ({
    id,
    type,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    angle: 0,
    strokeColor: ink,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: hash(id),
    version: 1,
    versionNonce: hash(id + ":" + ++n),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    ...extra,
  });
  const text = (
    id: string,
    words: string,
    box: Bounds,
    o: { size: number; color: string; align?: string; container?: string; family?: number },
  ) => {
    const m = measure(words, o.size);
    const x =
      o.align === "left" ? box.x : o.align === "right" ? box.x + box.width - m.width : box.x + (box.width - m.width) / 2;
    return base(id, "text", { x, y: box.y + (box.height - m.height) / 2, ...m }, {
      strokeColor: o.color,
      text: words,
      originalText: words,
      fontSize: o.size,
      fontFamily: o.family ?? 2,
      textAlign: o.align ?? "center",
      verticalAlign: "middle",
      containerId: o.container ?? null,
      lineHeight: 1.25,
      autoResize: true,
    });
  };
  const elements: ExcalidrawElement[] = [];
  const files: Record<string, ExcalidrawFile> = {};
  const ids = new Set(scene.modules.map((m) => m.id));
  // Words written out for a part or a link get ids of their own, clear of every id in the scene.
  const used = new Set([...ids, ...scene.links.map((l) => l.id)]);
  const fresh = (id: string) => {
    let next = id;
    for (let n = 2; used.has(next); n++) next = `${id}-${n}`;
    used.add(next);
    return next;
  };
  const holder = new Map<string, ExcalidrawElement>();
  const inside = (container: ExcalidrawElement, words: ExcalidrawElement) => {
    container.boundElements = [...(container.boundElements ?? []), { id: words.id, type: "text" }];
    elements.push(container, words);
  };
  for (const m of scene.modules) {
    const box = m.bounds;
    const group = m.group ? { groupIds: [m.group] } : {};
    const drawing = drawingOf(work, m.drawingId);
    const d = { ...(drawing?.defaults ?? {}), ...m.data } as Record<string, any>;
    const kind = kindOfSource(work.drawings[m.drawingId]?.source);
    if (kind === "sketch-shape") {
      const fill = d.fill && d.fill !== "transparent" && d.fillStyle !== "none" ? String(d.fill) : "transparent";
      const shape = base(m.id, ["ellipse", "diamond"].includes(d.shape) ? d.shape : "rectangle", box, {
        ...group,
        strokeColor: d.stroke || ink,
        backgroundColor: fill,
        fillStyle: fill === "transparent" ? "solid" : d.fillStyle || "hachure",
        strokeWidth: Number(d.strokeWidth ?? 2),
        strokeStyle: d.dashed ? "dashed" : "solid",
        roughness: Number(d.roughness ?? 1),
        roundness: d.rounded ? { type: 3 } : null,
        seed: Number(d.seed) || hash(m.id),
      });
      holder.set(m.id, shape);
      if (d.text)
        inside(
          shape,
          text(fresh(m.id + "-text"), String(d.text), box, {
            size: Number(d.size ?? 20),
            color: d.textColor || d.stroke || ink,
            align: d.align || "center",
            container: m.id,
            family: Number(d.roughness ?? 1) ? 5 : 2,
          }),
        );
      else elements.push(shape);
    } else if (kind === "sketch-line") {
      const pts: Point[] = (Array.isArray(d.points) ? d.points : []).map((p: number[]) => ({
        x: box.x + p[0] * box.width,
        y: box.y + p[1] * box.height,
      }));
      if (!pts.length) continue;
      const head = d.head && d.head !== "none" ? (d.head === "open" ? "arrow" : "triangle") : null;
      const type = d.smooth && !head ? "freedraw" : head ? "arrow" : "line";
      const o = pts[0];
      const rel = pts.map((p) => [p.x - o.x, p.y - o.y] as [number, number]);
      const xs = rel.map((p) => p[0]),
        ys = rel.map((p) => p[1]);
      elements.push(
        base(m.id, type, { x: o.x, y: o.y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }, {
          ...group,
          strokeColor: d.color || ink,
          strokeWidth: type === "freedraw" ? Number(d.width ?? 2) / 2 : Number(d.width ?? 2),
          strokeStyle: d.dashed ? "dashed" : "solid",
          roughness: type === "freedraw" ? 0 : 1,
          roundness: d.smooth && type !== "freedraw" ? { type: 2 } : null,
          points: rel,
          ...(type === "freedraw"
            ? { pressures: [], simulatePressure: true, lastCommittedPoint: rel.at(-1) }
            : {
                lastCommittedPoint: null,
                startBinding: null,
                endBinding: null,
                startArrowhead: head && d.both ? head : null,
                endArrowhead: head,
                elbowed: false,
              }),
        }),
      );
    } else if (!work.drawings[m.drawingId] && (m.drawingId === NODE || m.drawingId === CALLOUT)) {
      const color = toneColor(style, d.tone, d.color);
      const fill =
        d.fillStyle === "solid"
          ? color
          : d.fillStyle === "soft" || (!d.fillStyle && d.tone && d.tone !== "plain")
            ? color.length === 7
              ? color + "24"
              : color
            : "transparent";
      const shape = m.drawingId === CALLOUT ? "box" : d.shape || "box";
      const type = shape === "circle" ? "ellipse" : shape === "diamond" ? "diamond" : "rectangle";
      const el = base(m.id, type, box, {
        ...group,
        strokeColor: color,
        backgroundColor: fill,
        fillStyle: "solid",
        strokeWidth: 1.5,
        strokeStyle: d.dashed ? "dashed" : "solid",
        roughness: d.effect === "rough-edge" ? 1 : 0,
        roundness: type === "rectangle" && (shape !== "box" || Number(d.radius ?? 10) > 0) ? { type: 3 } : null,
      });
      holder.set(m.id, el);
      const words = [d.title ?? d.text, d.note].filter((w) => typeof w === "string" && w).join("\n");
      if (words)
        inside(
          el,
          text(fresh(m.id + "-text"), words, box, {
            size: Number(d.size ?? 15),
            color: d.fillStyle === "solid" ? style.paper || "#ffffff" : ink,
            align: d.align === "left" ? "left" : "center",
            container: m.id,
          }),
        );
      else elements.push(el);
    } else if (m.drawingId === b.text && !work.drawings[m.drawingId]) {
      const words = [d.text, d.note].filter((w) => typeof w === "string" && w).join("\n");
      if (!words) continue;
      const el = text(m.id, words, box, {
        size: Number(d.size ?? 16),
        color: d.color || ink,
        align: d.align === "start" ? "left" : d.align === "end" ? "right" : "center",
      });
      Object.assign(el, group);
      holder.set(m.id, el);
      elements.push(el);
    } else {
      const picture = pictures[m.id];
      if (picture) {
        const fileId = "f" + hash(m.id + picture.dataURL.length).toString(36);
        files[fileId] = { id: fileId, mimeType: picture.mimeType, dataURL: picture.dataURL, created: now };
        const el = base(m.id, "image", box, { ...group, fileId, status: "saved", scale: [1, 1] });
        holder.set(m.id, el);
        elements.push(el);
      } else {
        // Nothing to show it with: its place, outlined and named.
        const el = base(m.id, "rectangle", box, { ...group, strokeColor: "#999999", strokeStyle: "dashed" });
        holder.set(m.id, el);
        inside(el, text(fresh(m.id + "-text"), shownName(work, m), box, { size: 16, color: "#999999", container: m.id }));
      }
    }
  }
  // Links as arrows bound to what they join, drawn over the parts as Excalidraw draws them.
  const at = (id: string) => scene.modules.find((m) => m.id === id)!.bounds;
  for (const l of scene.links) {
    if (!ids.has(l.from.moduleId) || !ids.has(l.to.moduleId)) continue;
    const drawing = drawingOf(work, l.drawingId);
    const d = { ...(drawing?.defaults ?? {}), ...l.data } as Record<string, any>;
    const ends = linkEnds(l, at);
    const head = d.head === "none" ? null : d.head === "open" ? "arrow" : "triangle";
    const dx = ends.to.x - ends.from.x,
      dy = ends.to.y - ends.from.y;
    const bend = Number(d.bend ?? 0);
    const len = Math.hypot(dx, dy) || 1;
    const points: [number, number][] =
      bend && (d.route ?? "curve") === "curve"
        ? [[0, 0], [dx / 2 + (-dy / len) * bend * len * 0.5, dy / 2 + (dx / len) * bend * len * 0.5], [dx, dy]]
        : [[0, 0], [dx, dy]];
    const from = holder.get(l.from.moduleId),
      to = holder.get(l.to.moduleId);
    const arrow = base(l.id, "arrow", { x: ends.from.x, y: ends.from.y, width: Math.abs(dx), height: Math.abs(dy) }, {
      strokeColor: d.color || ink,
      strokeWidth: Number(d.width ?? 2),
      strokeStyle: d.dashed ? "dashed" : "solid",
      roughness: 0,
      roundness: points.length > 2 ? { type: 2 } : null,
      points,
      lastCommittedPoint: null,
      startBinding: from ? { elementId: from.id, focus: 0, gap: 4 } : null,
      endBinding: to ? { elementId: to.id, focus: 0, gap: 4 } : null,
      startArrowhead: head && d.both ? head : null,
      endArrowhead: head,
      elbowed: false,
    });
    for (const end of [from, to])
      if (end) end.boundElements = [...(end.boundElements ?? []), { id: l.id, type: "arrow" }];
    const label = [d.label, d.text].find((w) => typeof w === "string" && w);
    if (label) {
      const mid = { x: ends.from.x + points[Math.floor(points.length / 2)][0], y: ends.from.y + points[Math.floor(points.length / 2)][1] };
      const m = measure(label, 16);
      const words = text(fresh(l.id + "-label"), label, { x: mid.x - m.width / 2, y: mid.y - m.height / 2, ...m }, {
        size: 16,
        color: d.labelColor || d.color || ink,
        container: l.id,
      });
      inside(arrow, words);
    } else elements.push(arrow);
  }
  return {
    type: "excalidraw",
    version: 2,
    source: "DrawY",
    elements,
    appState: { viewBackgroundColor: style.paper || "#ffffff", gridSize: null },
    files,
  };
}
/** An Excalidraw scene as Excalidraw takes it from the clipboard. */
export const excalidrawClipboard = (scene: ExcalidrawScene) =>
  JSON.stringify({ type: "excalidraw/clipboard", elements: scene.elements, files: scene.files });
