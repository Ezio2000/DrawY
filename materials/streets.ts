// City-scale ground for the geomap drawing: water, parks and woods, roads, railways and
// the names of waterways and main roads, from OpenStreetMap vector tiles (OpenMapTiles
// schema). Natural Earth, which the other geographic layers come from, is drawn for
// 1:10m at its finest, so it has nothing to show inside a city; these tiles do.
//
// Tiles are fetched from a TileJSON source (OpenFreeMap's by default, no key), boiled
// down to what the drawing uses, and kept on disk, so each tile is fetched once.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

/** The finest zoom the OpenMapTiles schema has; closer views read these tiles. */
export const STREETS_MAX_ZOOM = 14;
export const STREETS_SOURCE =
  process.env.DRAWY_TILES_URL || "https://tiles.openfreemap.org/planet";

/** A line or ring in tile units (0 to extent across the tile, a little beyond at the
 * edges), each point a step from the last. */
type Line = number[];
export type StreetTile = {
  z: number;
  x: number;
  y: number;
  extent: number;
  water: Line[];
  green: Line[];
  waterways: { class: string; zh?: string; en?: string; lines: Line[] }[];
  roads: { class: string; lines: Line[] }[];
  names: { class: string; zh?: string; en?: string; lines: Line[] }[];
  rail: Line[];
};

const ROADS = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
];
const NAMED_ROADS = ["motorway", "trunk", "primary", "secondary", "tertiary"];
const WATERWAYS = ["river", "canal", "stream"];
const GREEN = new Set(["wood", "forest", "grass", "park", "garden"]);

const encode = (points: { x: number; y: number }[]): Line => {
  const out: number[] = [];
  let px = 0,
    py = 0;
  for (const { x, y } of points) {
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
};
const text = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const nameOf = (p: VectorTileFeature["properties"]) => ({
  zh: text(p["name:zh-Hans"]) ?? text(p["name:zh"]) ?? text(p.name),
  en: text(p["name:en"]) ?? text(p.name_en) ?? text(p.name),
});

/** What the drawing uses from one vector tile. */
export function boil(
  bytes: Uint8Array,
  z: number,
  x: number,
  y: number,
): StreetTile {
  const raw =
    bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const tile = new VectorTile(new PbfReader(raw));
  const out: StreetTile = {
    z,
    x,
    y,
    extent: 4096,
    water: [],
    green: [],
    waterways: [],
    roads: [],
    names: [],
    rail: [],
  };
  const each = (
    name: string,
    fn: (f: VectorTileFeature, lines: Line[]) => void,
  ) => {
    const layer = tile.layers[name];
    if (!layer) return;
    out.extent = layer.extent;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      fn(
        f,
        f.loadGeometry().map((ring) => encode(ring)),
      );
    }
  };
  // Lines grouped by what they are, so a tile's hundred stretches of one road are one entry.
  const group = <T extends { lines: Line[] }>(
    list: T[],
    key: (t: T) => string,
    item: T,
  ) => {
    const k = key(item);
    const same = list.find((t) => key(t) === k);
    if (same) same.lines.push(...item.lines);
    else list.push(item);
  };
  each("water", (f, lines) => {
    if (f.type === 3 && f.properties.class !== "swimming_pool")
      out.water.push(...lines);
  });
  for (const layer of ["park", "landcover"])
    each(layer, (f, lines) => {
      if (
        f.type === 3 &&
        (layer === "park" || GREEN.has(String(f.properties.class)))
      )
        out.green.push(...lines);
    });
  each("waterway", (f, lines) => {
    const cls = String(f.properties.class);
    if (
      f.type !== 2 ||
      !WATERWAYS.includes(cls) ||
      f.properties.brunnel === "tunnel"
    )
      return;
    group(out.waterways, (w) => `${w.class}|${w.zh}|${w.en}`, {
      class: cls,
      ...nameOf(f.properties),
      lines,
    });
  });
  each("transportation", (f, lines) => {
    if (f.type !== 2 || f.properties.brunnel === "tunnel") return;
    const cls = String(f.properties.class);
    if (ROADS.includes(cls))
      group(out.roads, (r) => r.class, { class: cls, lines });
    else if (cls === "rail" || cls === "transit") out.rail.push(...lines);
  });
  each("transportation_name", (f, lines) => {
    const cls = String(f.properties.class);
    if (f.type !== 2 || !NAMED_ROADS.includes(cls)) return;
    const names = nameOf(f.properties);
    if (!names.zh && !names.en) return;
    group(out.names, (r) => `${r.class}|${r.zh}|${r.en}`, {
      class: cls,
      ...names,
      lines,
    });
  });
  // Absent names are left out rather than written as null.
  for (const list of [out.waterways, out.names])
    for (const item of list)
      for (const k of ["zh", "en"] as const)
        if (item[k] === undefined) delete item[k];
  return out;
}

export class StreetsError extends Error {
  constructor(
    message: string,
    public status: 400 | 502,
  ) {
    super(message);
  }
}

/** Street tiles by z/x/y, fetched from `source` once and then read from `dir`. */
export class Streets {
  private template?: { url: string; at: number };
  private pending = new Map<string, Promise<Buffer>>();
  constructor(
    private dir: string,
    private source = STREETS_SOURCE,
  ) {
    mkdirSync(dir, { recursive: true });
  }
  async tile(z: number, x: number, y: number): Promise<Buffer> {
    if (
      ![z, x, y].every(Number.isInteger) ||
      z < 0 ||
      z > STREETS_MAX_ZOOM ||
      x < 0 ||
      y < 0 ||
      x >= 2 ** z ||
      y >= 2 ** z
    )
      throw new StreetsError(`没有这块街道数据: ${z}/${x}/${y}`, 400);
    const key = `${z}-${x}-${y}`;
    const path = join(this.dir, key + ".json");
    if (existsSync(path)) return readFileSync(path);
    let job = this.pending.get(key);
    if (!job) {
      job = this.fetch(z, x, y)
        .then((tile) => {
          const bytes = Buffer.from(JSON.stringify(tile));
          writeFileSync(path, bytes);
          return bytes;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    return job;
  }
  private async fetch(z: number, x: number, y: number): Promise<StreetTile> {
    const template = await this.url();
    const url = template
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    let r: Response;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    } catch (e) {
      throw new StreetsError(`街道数据读取失败: ${(e as Error).message}`, 502);
    }
    // Open sea and empty land may have no tile at all.
    if (r.status === 204 || r.status === 404)
      return boil(new Uint8Array(), z, x, y);
    if (!r.ok) throw new StreetsError(`街道数据读取失败: ${r.status}`, 502);
    return boil(new Uint8Array(await r.arrayBuffer()), z, x, y);
  }
  /** The source's tile URL template, from its TileJSON (a source whose tiles are named
   * by version moves on, so it is looked up again after a day). */
  private async url() {
    if (/\{z\}/.test(this.source)) return this.source;
    if (this.template && Date.now() - this.template.at < 86400000)
      return this.template.url;
    try {
      const r = await fetch(this.source, {
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw Error(String(r.status));
      const json = (await r.json()) as { tiles?: string[] };
      const url = json.tiles?.[0];
      if (!url) throw Error("TileJSON 里没有 tiles");
      this.template = { url, at: Date.now() };
      return url;
    } catch (e) {
      throw new StreetsError(`街道数据读取失败: ${(e as Error).message}`, 502);
    }
  }
}
