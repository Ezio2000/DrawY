import type { Bounds, Drawing, Instance, Link, Point } from "../contracts/index.ts";
import type { Clip } from "../editing/index.ts";

/* What an import makes: a clip, pasted like parts copied from another work, so whatever
 * comes in lands as one hand edit through the same checks as any other, takes new ids and
 * the drawings it needs, and is selected in the middle of the view. */

/** A clip put together part by part, each id unique within it. */
export class ClipMaker {
  private modules: Instance[] = [];
  private links: Link[] = [];
  private drawings = new Map<string, Drawing>();
  private materials = new Set<string>();
  private counts = new Map<string, number>();

  /** An id within the clip from a base: shape-1, shape-2. */
  id(base: string) {
    const n = (this.counts.get(base) ?? 0) + 1;
    this.counts.set(base, n);
    return `${base}-${n}`;
  }
  /** Adds a module drawn with a library drawing or a material the work is to take. */
  module(m: Omit<Instance, "id"> & { id?: string }, base = "part") {
    const id = m.id ?? this.id(base);
    this.modules.push({ ...m, id, bounds: tidy(m.bounds) });
    return id;
  }
  link(l: Omit<Link, "id">, base = "link") {
    const id = this.id(base);
    this.links.push({ ...l, id });
    return id;
  }
  /** A drawing of the work's own the parts use. */
  drawing(d: Drawing) {
    this.drawings.set(d.id, d);
    return d.id;
  }
  /** A library material the parts use, taken into the work as they are pasted. */
  material(id: string) {
    this.materials.add(id);
    return id;
  }
  get size() {
    return this.modules.length;
  }
  clip(): Clip {
    return {
      kind: "drawy/clip",
      workId: "",
      sceneId: "",
      modules: this.modules,
      links: this.links,
      drawings: [...this.drawings.values()],
      materials: [...this.materials],
    };
  }
}
/** A box on whole tenths, never empty. */
export function tidy(b: Bounds): Bounds {
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    x: r(b.x),
    y: r(b.y),
    width: Math.max(1, r(b.width)),
    height: Math.max(1, r(b.height)),
  };
}
/** A line through points in the scene as a module's box, `pad` clear of it on every side,
 * and the points as shares of that box. */
export function lineBox(points: Point[], pad: number) {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const box = tidy({
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    width: Math.max(...xs) - Math.min(...xs) + pad * 2,
    height: Math.max(...ys) - Math.min(...ys) + pad * 2,
  });
  const share = (v: number) => Math.round(v * 10000) / 10000;
  return {
    box,
    points: points.map((p) => [share((p.x - box.x) / box.width), share((p.y - box.y) / box.height)]),
  };
}
