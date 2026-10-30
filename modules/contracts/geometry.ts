import type { Bounds, Point } from "./index.ts";
export interface Camera {
  x: number;
  y: number;
  scale: number;
}
export function union(boxes: Bounds[]): Bounds {
  if (!boxes.length) return { x: 0, y: 0, width: 800, height: 500 };
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}
export function fit(
  bounds: Bounds,
  width: number,
  height: number,
  maxScale = 1.5,
): Camera {
  const scale = Math.max(
    0.02,
    Math.min(
      (width - 64) / bounds.width,
      (height - 64) / bounds.height,
      maxScale,
    ),
  );
  return {
    scale,
    x: width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: height / 2 - (bounds.y + bounds.height / 2) * scale,
  };
}
export function zoom(camera: Camera, point: Point, factor: number): Camera {
  const scale = Math.min(8, Math.max(0.02, camera.scale * factor));
  const ratio = scale / camera.scale;
  return {
    scale,
    x: point.x - (point.x - camera.x) * ratio,
    y: point.y - (point.y - camera.y) * ratio,
  };
}
