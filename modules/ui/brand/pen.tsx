/* Drawing with an unsteady hand: centre lines nudged a little and smoothed, which the
 * sketches draw their pencil lines along. */

export type P = { x: number; y: number };

/** A centre line as an unsteady hand draws it: each point nudged a little, then smoothed
 * through a Catmull-Rom curve sampled about every `step` units. */
export function handLine(flat: number[], r: () => number, step = 16): P[] {
  const points: P[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    points.push({
      x: flat[i] + (r() - 0.5) * 18,
      y: flat[i + 1] + (r() - 0.5) * 18,
    });
  if (points.length === 1)
    points.push({ x: points[0].x + 1, y: points[0].y + 1 });
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  const line: P[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(c.x - b.x, c.y - b.y) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n,
        curve = (p: number, q: number, s: number, u: number) =>
          0.5 *
          (2 * q +
            (s - p) * t +
            (2 * p - 5 * q + 4 * s - u) * t * t +
            (3 * q - p - 3 * s + u) * t * t * t);
      line.push({ x: curve(a.x, b.x, c.x, d.x), y: curve(a.y, b.y, c.y, d.y) });
    }
  }
  line.push(points.at(-1)!);
  return line;
}

const f = (n: number) => Math.round(n * 10) / 10;
const pt = (p: P) => `${f(p.x)} ${f(p.y)}`;

/** A polyline's points as SVG path data, `L` between them. */
export const pointsOf = (line: P[]) => line.map(pt).join("L");
