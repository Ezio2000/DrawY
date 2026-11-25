import type { Bounds, Work } from "../contracts/index.ts";
import { drawingOf, labelOf } from "../contracts/index.ts";
import { bound, type Clip } from "../editing/index.ts";
import { ClipMaker } from "./clip.ts";
import { kindOfSource, mermaidDiagram } from "./drawings.ts";
import { CALLOUT, NODE } from "./library.ts";

/* Mermaid, in and out. A flowchart read in becomes blocks and links of the work, laid out
 * where Mermaid lays them out and drawn in the work's style, so it is edited like anything
 * drawn by hand; every other kind of diagram comes in whole, as a Mermaid diagram whose
 * source stays editable. A scene written out is a flowchart of its blocks and links. */

const KINDS =
  /^(graph|flowchart|sequenceDiagram|classDiagram(-v2)?|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|mindmap|timeline|zenuml|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|kanban|architecture(-beta)?|radar(-beta)?|treemap(-beta)?)\b/;

/** Mermaid source in text (on its own, or in a ```mermaid fence), if the text is that. */
export function readMermaid(text: string): string | null {
  const fenced = text.match(/```\s*mermaid[^\n]*\n([\s\S]*?)```/i);
  const source = (fenced ? fenced[1] : text).trim();
  // What may come before the diagram's kind: front matter, directives and comments.
  let rest = source.replace(/^---\n[\s\S]*?\n---\s*/, "");
  for (;;) {
    const next = rest.replace(/^\s*(%%[^\n]*(\n|$))/, "");
    if (next === rest) break;
    rest = next;
  }
  return KINDS.test(rest.trimStart()) ? source : null;
}
/** Whether Mermaid source is a flowchart, which comes in as blocks and links. */
export const isFlowchart = (source: string) =>
  /^(graph|flowchart)\b/.test(
    source
      .replace(/^---\n[\s\S]*?\n---\s*/, "")
      .replace(/^(\s*%%[^\n]*\n)*/, "")
      .trimStart(),
  );

/** The shapes a node block draws, as the editor's shape tools name them. */
export type BlockShape = "box" | "pill" | "circle" | "diamond" | "cylinder" | "document";
/** A flowchart as Mermaid reads and lays it out: blocks where it puts them, the edges
 * between them and the subgraphs around them. */
export interface Flowchart {
  nodes: {
    id: string;
    text: string;
    shape: BlockShape;
    box: Bounds;
    /** Its outline and fill, from its style or class. */
    stroke?: string;
    fill?: string;
  }[];
  edges: {
    from: string;
    to: string;
    text?: string;
    head: "filled" | "open" | "none";
    both?: boolean;
    dashed?: boolean;
    thick?: boolean;
  }[];
  groups: { title: string; box: Bounds }[];
}
/** Mermaid's names for its node shapes, as the shapes a block draws. */
export function blockShape(type: string | undefined): BlockShape {
  switch (type) {
    case "stadium":
    case "pill":
    case "terminal":
      return "pill";
    case "circle":
    case "doublecircle":
    case "circ":
    case "dbl-circ":
    case "ellipse":
      return "circle";
    case "diamond":
    case "question":
    case "decision":
    case "diam":
      return "diamond";
    case "cylinder":
    case "cyl":
    case "db":
    case "database":
      return "cylinder";
    case "doc":
    case "document":
    case "docs":
      return "document";
    default:
      return "box";
  }
}
/** A flowchart's blocks, edges and subgraphs as parts of a work, at Mermaid's layout. */
export function fromFlowchart(chart: Flowchart): Clip {
  const b = bound();
  const made = new ClipMaker();
  for (const g of chart.groups) {
    made.module(
      { bounds: g.box, drawingId: made.material(NODE), data: { tone: "muted", fillStyle: "soft", radius: 12 } },
      "group",
    );
    if (g.title)
      made.module(
        {
          bounds: { x: g.box.x + 12, y: g.box.y + 6, width: Math.min(g.box.width - 24, Math.max(80, g.title.length * 15)), height: 26 },
          drawingId: made.material(b.text),
          data: { text: g.title, size: 14, align: "start", halo: false },
        },
        "text",
      );
  }
  const ids = new Map<string, string>();
  for (const n of chart.nodes) {
    const data: Record<string, unknown> = { title: n.text };
    if (n.shape !== "box") data.shape = n.shape;
    if (n.stroke || n.fill) {
      data.color = n.stroke || n.fill;
      if (n.fill) data.fillStyle = n.stroke && n.stroke !== n.fill ? "soft" : "solid";
    }
    ids.set(n.id, made.module({ bounds: n.box, drawingId: made.material(NODE), data }, "node"));
  }
  // Edges between the same two blocks bow apart instead of running over each other: each
  // bends to its left, so two running opposite ways part, and more the same way spread out.
  const pair = (e: Flowchart["edges"][number]) => [e.from, e.to].sort().join("\u0000");
  const shared = new Map<string, number>();
  for (const e of chart.edges) shared.set(pair(e), (shared.get(pair(e)) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const e of chart.edges) {
    const from = ids.get(e.from),
      to = ids.get(e.to);
    if (!from || !to || from === to) continue;
    const data: Record<string, unknown> = {};
    const k = `${e.from}\u0000${e.to}`,
      nth = seen.get(k) ?? 0;
    seen.set(k, nth + 1);
    if ((shared.get(pair(e)) ?? 0) > 1) data.bend = Math.round((0.25 + nth * 0.2) * 100) / 100;
    if (e.head !== "filled") data.head = e.head;
    if (e.both) data.both = true;
    if (e.dashed) data.dashed = true;
    if (e.thick) data.width = 3;
    if (e.text) data.label = e.text;
    made.link({ drawingId: made.material(b.link), from: { moduleId: from }, to: { moduleId: to }, data });
  }
  return made.clip();
}
/** A diagram of any other kind, whole: drawn from its source at the size Mermaid drew it. */
export function mermaidBlock(source: string, size: { width: number; height: number }): Clip {
  const made = new ClipMaker();
  made.module(
    {
      bounds: { x: 0, y: 0, width: Math.max(80, size.width), height: Math.max(40, size.height) },
      drawingId: made.drawing(mermaidDiagram),
      data: { source },
    },
    "diagram",
  );
  return made.clip();
}

/** Words as a Mermaid label: in quotes, with what would end them written as entities. */
const quoted = (s: string) => '"' + s.replace(/"/g, "#quot;").replace(/\n/g, "<br>") + '"';
const SHAPED: Record<BlockShape, [string, string]> = {
  box: ["[", "]"],
  pill: ["([", "])"],
  circle: ["((", "))"],
  diamond: ["{", "}"],
  cylinder: ["[(", ")]"],
  document: ["[", "]"],
};
/** A scene's blocks and links as a Mermaid flowchart, running the way the scene is longer;
 * a scene holding only Mermaid diagrams gives their source. Words and lines on their own, and
 * pictures, are left out unless a link joins them. Null when there is nothing to write. */
export function toMermaid(work: Work, sceneId: string): string | null {
  const scene = work.scenes[sceneId];
  const own = (drawingId: string) => kindOfSource(work.drawings[drawingId]?.source);
  const diagrams = scene.modules.filter((m) => own(m.drawingId) === "mermaid");
  const linked = new Set(scene.links.flatMap((l) => [l.from.moduleId, l.to.moduleId]));
  const blocks = scene.modules.filter(
    (m) =>
      linked.has(m.id) ||
      (!work.drawings[m.drawingId] && (m.drawingId === NODE || m.drawingId === CALLOUT)) ||
      own(m.drawingId) === "sketch-shape",
  );
  if (!blocks.length)
    return diagrams.length ? diagrams.map((m) => String(m.data.source ?? "").trim()).join("\n\n") : null;
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const m of blocks) {
    let name = m.id.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=\d)/, "n");
    // Words Mermaid reads as its own cannot name a node.
    if (/^(end|graph|flowchart|subgraph|style|class|classDef|click|linkStyle|direction)$/i.test(name)) name += "_";
    while (taken.has(name)) name += "_";
    taken.add(name);
    names.set(m.id, name);
  }
  const box = (ms: typeof blocks) => {
    const xs = ms.flatMap((m) => [m.bounds.x, m.bounds.x + m.bounds.width]),
      ys = ms.flatMap((m) => [m.bounds.y, m.bounds.y + m.bounds.height]);
    return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  };
  const { width, height } = box(blocks);
  const lines = [`flowchart ${width > height * 1.2 ? "LR" : "TD"}`];
  // Blocks in reading order, top to bottom and left to right.
  const ordered = [...blocks].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  for (const m of ordered) {
    const drawing = drawingOf(work, m.drawingId);
    const d = { ...(drawing?.defaults ?? {}), ...m.data } as Record<string, unknown>;
    const kind = own(m.drawingId);
    const shape: BlockShape =
      kind === "sketch-shape"
        ? d.shape === "ellipse"
          ? "circle"
          : d.shape === "diamond"
            ? "diamond"
            : "box"
        : m.drawingId === NODE
          ? blockShape(String(d.shape ?? "box"))
          : "box";
    // A block says its words; one without is named by what it is called, else left blank.
    const words =
      [d.title ?? d.text, d.note].filter((w) => typeof w === "string" && w).join("\n") ||
      (labelOf(m) !== m.id ? labelOf(m) : " ");
    const [open, close] = SHAPED[shape];
    lines.push(`  ${names.get(m.id)}${open}${quoted(words)}${close}`);
  }
  for (const l of scene.links) {
    const from = names.get(l.from.moduleId),
      to = names.get(l.to.moduleId);
    if (!from || !to) continue;
    const drawing = drawingOf(work, l.drawingId);
    const d = { ...(drawing?.defaults ?? {}), ...l.data } as Record<string, unknown>;
    const head = d.head !== "none";
    const both = head && !!d.both;
    const arrow = d.dashed
      ? `${both ? "<" : ""}-.-${head ? ">" : ""}`
      : Number(d.width) >= 3
        ? `${both ? "<" : ""}==${head ? ">" : "="}`
        : `${both ? "<" : ""}--${head ? ">" : "-"}`;
    const label = [d.label, d.text].find((w) => typeof w === "string" && w) as string | undefined;
    lines.push(`  ${from} ${arrow}${label ? `|${quoted(label)}|` : ""} ${to}`);
  }
  return lines.join("\n") + "\n";
}
