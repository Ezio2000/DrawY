import type { Point } from "../contracts/index.ts";
import type { Clip } from "../editing/index.ts";
import { ClipMaker, lineBox } from "./clip.ts";
import { simplify, sketchLine } from "./drawings.ts";

/* Lines drawn by hand, and the drawings other tools make in, brought into a work and sent
 * out of it. Everything here comes in as a clip, pasted like parts copied from another
 * work: one hand edit, the same checks, the same protocol the author writes. */

export * from "./drawings.ts";
export * from "./excalidraw.ts";
export * from "./mermaid.ts";
export * from "./sequence.ts";
export { ClipMaker } from "./clip.ts";
export { SEQUENCE } from "./library.ts";

/** A line drawn on the canvas, as a clip of one part where it was drawn: a freehand
 * stroke smoothed through the points that shape it, or a straight line with a head.
 * `scale` is how many screen pixels a scene unit took as it was drawn, so the stroke keeps
 * what the hand drew to about half a pixel. */
export function inked(
  points: Point[],
  how: { kind: "pen" | "arrow"; width: number; scale: number; color?: string; upright?: boolean },
): Clip {
  const made = new ClipMaker();
  const pen = how.kind === "pen";
  const kept = pen ? simplify(points, 0.5 / how.scale) : [points[0], points.at(-1)!];
  const { box, points: shares } = lineBox(kept, Math.max(4, how.width * 2));
  made.module(
    {
      bounds: box,
      drawingId: made.drawing(sketchLine),
      data: {
        points: shares,
        // An arrow drawn straight up or down is more often a line than an arrow.
        ...(pen ? { smooth: kept.length > 2 } : how.upright ? {} : { head: "filled" }),
        ...(how.width !== 2 ? { width: how.width } : {}),
        ...(how.color ? { color: how.color } : {}),
      },
    },
    pen ? "stroke" : "line",
  );
  return made.clip();
}
