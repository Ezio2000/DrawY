// Builds the geographic layers the geomap drawing projects (seed/geo) from Natural Earth.
// One point of view runs through every political layer: which map units exist, how each
// border line is classed, the maritime lines, and which unit each first-level division
// belongs to. The rules below are the same for every country; only the view is chosen.
//
//   pnpm --dir materials geo
//
// Needs network access, unzip and npx (mapshaper runs from npx, so it is not a
// dependency of the library).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Natural Earth's point of view: the suffix of its per-view country file and the code
 * of its per-view border class field. */
const view = { countries: "chn", lines: "CN" };
const base = "https://naciscdn.org/naturalearth";
const out = new URL("./seed/geo/", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "drawy-geo-"));

type Position = [number, number];
type Geometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Point"; coordinates: Position };
type Feature = {
  type: "Feature";
  properties: Record<string, any>;
  geometry: Geometry | null;
};
type Collection = { features?: Feature[]; geometries?: Geometry[] };

async function download(path: string) {
  const name = path.split("/").at(-1)!;
  const r = await fetch(`${base}/${path}.zip`);
  if (!r.ok) throw Error(`${path}: ${r.status}`);
  const file = join(dir, name + ".zip");
  writeFileSync(file, new Uint8Array(await r.arrayBuffer()));
  execFileSync("unzip", ["-oq", file, "-d", join(dir, name)]);
  return join(dir, name, name + ".shp");
}
/** mapshaper with a command line as it would be typed (paths here have no spaces). */
const mapshaper = (command: string) =>
  execFileSync("npx", ["-y", "mapshaper@0.7.101", ...command.split(/\s+/)], {
    stdio: ["ignore", "ignore", "inherit"],
  });
/** Runs mapshaper and reads back its GeoJSON output, to `precision` degrees. */
function shaper(command: string, precision = 0.01): Collection {
  const file = join(dir, `out-${Math.random().toString(36).slice(2)}.json`);
  mapshaper(`${command} -o ${file} format=geojson precision=${precision}`);
  return JSON.parse(readFileSync(file, "utf8"));
}
const features = (command: string, precision?: number) =>
  shaper(command, precision).features!;
const geometries = (c: Collection) =>
  c.geometries ??
  (c.features ?? []).map((f) => f.geometry).filter((g) => g !== null);
const rings = (g: Geometry | null): Position[][] =>
  !g
    ? []
    : g.type === "Polygon"
      ? g.coordinates
      : g.type === "MultiPolygon"
        ? g.coordinates.flat()
        : g.type === "LineString"
          ? [g.coordinates]
          : g.type === "MultiLineString"
            ? g.coordinates
            : [];
/** A line in steps of 1/scale of a degree (hundredths unless said), each point a step
 * from the last. */
function encode(points: Position[], scale = 100) {
  const r: number[] = [];
  let px = 0,
    py = 0;
  for (const [x, y] of points) {
    const ix = Math.round(x * scale),
      iy = Math.round(y * scale);
    if (r.length && ix === px && iy === py) continue;
    r.push(ix - px, iy - py);
    px = ix;
    py = iy;
  }
  return r;
}
const lines = (gs: (Geometry | null)[], scale = 100) =>
  gs
    .flatMap(rings)
    .map((r) => encode(r, scale))
    .filter((l) => l.length >= 4);
const round = (p: Position): Position => [
  Math.round(p[0] * 100) / 100,
  Math.round(p[1] * 100) / 100,
];
function inside([x, y]: Position, ring: Position[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}
/** The extent of the part of an area its label sits in (or of its largest part), so the
 * drawing names an area only when the name fits inside it. */
function box(g: Geometry | null, at: Position) {
  const parts =
    g?.type === "Polygon"
      ? [g.coordinates]
      : g?.type === "MultiPolygon"
        ? g.coordinates
        : [];
  const extent = (ring: Position[]) => {
    const xs = ring.map((p) => p[0]),
      ys = ring.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const size = (e: number[]) => (e[2] - e[0]) * (e[3] - e[1]);
  const part =
    parts.find((p) => inside(at, p[0])) ??
    parts.reduce(
      (a, b) => (size(extent(b[0])) > size(extent(a[0])) ? b : a),
      parts[0],
    );
  return part ? extent(part[0]).map((v) => Math.round(v * 100) / 100) : null;
}
// Country names in the common short form of the Unicode CLDR (Hong Kong, not Hong Kong
// SAR China), unless that form is an abbreviation (US), then its full form.
const cldr = (lang: string) => {
  const short = new Intl.DisplayNames([lang], {
      type: "region",
      style: "short",
    }),
    long = new Intl.DisplayNames([lang], { type: "region" });
  return (code: string) => {
    if (!/^[A-Z]{2}$/.test(code)) return undefined;
    const s = short.of(code);
    return s && !/^[A-Z.]{2,4}$/.test(s) ? s : long.of(code);
  };
};
const zhName = cldr("zh"),
  enName = cldr("en");

try {
  // Land, lakes and rivers for the overview.
  const [land, lakes, rivers] = await Promise.all([
    download("50m/physical/ne_50m_land"),
    download("50m/physical/ne_50m_lakes"),
    download("10m/physical/ne_10m_rivers_lake_centerlines"),
  ]);
  const river = new Map<
    string,
    { zh?: string; en?: string; rank: number; zoom: number; lines: number[][] }
  >();
  for (const f of features(`-i ${rivers} -simplify 8% keep-shapes`)) {
    const p = f.properties;
    const key = `${p.name}|${p.name_zh}|${p.scalerank}`;
    if (!river.has(key))
      river.set(key, {
        zh: p.name_zh || undefined,
        en: p.name || undefined,
        rank: p.scalerank,
        zoom: p.min_zoom,
        lines: [],
      });
    river.get(key)!.lines.push(...lines([f.geometry]));
  }

  // Finer land, lakes and shores for close views, in tiles of `tile` degrees so a view
  // reads only the few it covers: half the source's points, kept to a thousandth of a
  // degree (about 110 m), since close views are where every bend of a coast shows. Fills
  // are cut at the tile edges and drawn without an outline; shores are lines of their
  // own from the same simplified outlines, so the tile edges never show.
  const tile = 15,
    scale = 1000;
  const [land10, lakes10] = await Promise.all([
    download("10m/physical/ne_10m_land"),
    download("10m/physical/ne_10m_lakes"),
  ]);
  const cells: Feature[] = [];
  for (let x = -180; x < 180; x += tile)
    for (let y = -90; y < 90; y += tile)
      cells.push({
        type: "Feature",
        properties: { cell: `${(x + 180) / tile}-${(y + 90) / tile}` },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [x, y],
              [x + tile, y],
              [x + tile, y + tile],
              [x, y + tile],
              [x, y],
            ],
          ],
        },
      });
  const grid = join(dir, "grid.json");
  writeFileSync(
    grid,
    JSON.stringify({ type: "FeatureCollection", features: cells }),
  );
  const simplify = "-simplify 50% keep-shapes";
  const cut = (file: string) =>
    features(
      `-i ${file} ${grid} combine-files -rename-layers shapes,grid ` +
        `-filter-fields featurecla target=shapes ${simplify} target=shapes ` +
        `-union target=shapes,grid name=pieces`,
      1 / scale,
    ).filter((f) => f.properties.featurecla && f.properties.cell);
  const shores = (file: string) =>
    geometries(shaper(`-i ${file} ${simplify} -lines`, 1 / scale));
  const tiles = new Map<
    string,
    { scale: number; land: number[][]; lakes: number[][]; shores: number[][] }
  >();
  const at = (cell: string) => {
    if (!tiles.has(cell))
      tiles.set(cell, { scale, land: [], lakes: [], shores: [] });
    return tiles.get(cell)!;
  };
  for (const [kind, file] of [
    ["land", land10],
    ["lakes", lakes10],
  ] as const)
    for (const f of cut(file))
      at(f.properties.cell)[kind].push(...lines([f.geometry], scale));
  // A shore runs on through the tiles it crosses, each run kept by the tile it lies in.
  const cellOf = ([x, y]: Position) =>
    `${Math.min(360 / tile - 1, Math.floor((x + 180) / tile))}-` +
    `${Math.min(180 / tile - 1, Math.floor((y + 90) / tile))}`;
  for (const line of [...shores(land10), ...shores(lakes10)].flatMap(rings)) {
    let run: Position[] = [],
      cell = "";
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]];
      const key = cellOf([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      if (key !== cell) {
        if (run.length > 1) at(cell).shores.push(encode(run, scale));
        run = [a];
        cell = key;
      }
      run.push(b);
    }
    if (run.length > 1) at(cell).shores.push(encode(run, scale));
  }
  for (const [cell, t] of tiles)
    writeFileSync(out + `detail-${cell}.json`, JSON.stringify(t));
  writeFileSync(
    out + "physical.json",
    JSON.stringify({
      detail: { tile, tiles: [...tiles.keys()].sort() },
      land: lines(geometries(shaper(`-i ${land} -simplify 60% keep-shapes`))),
      lakes: lines(geometries(shaper(`-i ${lakes} -simplify 60% keep-shapes`))),
      rivers: [...river.values()].filter((r) => r.lines.length),
    }),
  );

  // Map units as the view has them, and border lines as the view classes them.
  const [countries, borders, divisions] = await Promise.all([
    download(`10m/cultural/ne_10m_admin_0_countries_${view.countries}`),
    download("10m/cultural/ne_10m_admin_0_boundary_lines_land"),
    download("10m/cultural/ne_10m_admin_1_states_provinces"),
  ]);
  const maritime = await download(
    `10m/cultural/ne_10m_admin_0_boundary_lines_maritime_indicator_${view.countries}`,
  ).catch(() =>
    download("10m/cultural/ne_10m_admin_0_boundary_lines_maritime_indicator"),
  );
  const units = features(
    `-i ${countries} -filter-fields ADM0_A3,ADMIN,SOVEREIGNT,ISO_A2_EH,NAME,NAME_ZH,LABEL_X,LABEL_Y`,
  );
  const unit = new Map(
    units.map((f) => [f.properties.ADM0_A3 as string, f.properties]),
  );
  // Coarse outlines, so a view that leaves a country's label point out can still find
  // a place inside the country for its name.
  const outlines = features(`-i ${countries} -simplify 3% keep-shapes`);
  const named = (p: Record<string, any>, iso: string) => ({
    zh: zhName(iso) ?? p.NAME_ZH ?? p.name_zh,
    en: enName(iso) ?? p.NAME ?? p.name,
  });
  const kinds: [RegExp, string | null][] = [
    [/^International boundary/, "international"],
    [
      /^(Disputed|Line of control|Indefinite|Indeterminant frontier)/,
      "disputed",
    ],
    [/^(Lease limit|Overlay limit)/, "limit"],
    // Between units of one country: drawn with its divisions, not as a border.
    [/^(Map unit boundary|Admin-1 boundary)/, null],
    [/^Unrecognized/, null],
  ];
  const classed: Record<string, Geometry[]> = {
    international: [],
    disputed: [],
    limit: [],
  };
  for (const f of features(`-i ${borders} -simplify 6% keep-shapes`)) {
    const cls = f.properties[`FCLASS_${view.lines}`] || f.properties.FEATURECLA;
    const kind = kinds.find(([re]) => re.test(cls));
    if (!kind) throw Error("边界类别未归类: " + cls);
    if (kind[1] && f.geometry) classed[kind[1]].push(f.geometry);
  }
  writeFileSync(
    out + "countries.json",
    JSON.stringify({
      lines: {
        ...Object.fromEntries(
          Object.entries(classed).map(([k, g]) => [k, lines(g)]),
        ),
        maritime: lines(geometries(shaper(`-i ${maritime} -simplify 20%`))),
      },
      names: units.map((f, i) => {
        const p = f.properties,
          at = round([p.LABEL_X, p.LABEL_Y]);
        return {
          of: p.ADM0_A3,
          ...named(p, p.ISO_A2_EH),
          at,
          box: box(f.geometry, at),
          area: lines([outlines[i].geometry]),
        };
      }),
    }),
  );

  // First-level divisions, each cut to the territory the view gives its own unit:
  // - a division inside its own unit keeps its name and outline;
  // - a part of a division lying in another unit is dropped (that unit's view wins);
  // - a unit that belongs to another country (its sovereign is not itself) is one
  //   division of that country as a whole, not its own districts;
  // - a territory the view does not have as a unit becomes one division of the unit
  //   it lies in when it is a country or territory with a code, and nothing otherwise.
  // Thin slivers where the two layers' outlines differ are filtered by shape, not size,
  // so small real territories stay.
  const pieces = features(
    `-i ${divisions} ${countries} combine-files -rename-layers divisions,units ` +
      `-filter-fields adm0_a3,adm1_code,iso_a2,name,name_zh,longitude,latitude target=divisions ` +
      `-filter-fields ADM0_A3,ADMIN,SOVEREIGNT,ISO_A2_EH target=units ` +
      `-union target=divisions,units name=pieces -filter-slivers`,
  );
  const kept: Feature[] = [];
  for (const f of pieces) {
    const p = f.properties,
      own = p.adm0_a3 as string,
      where = p.ADM0_A3 as string;
    if (!own || !where) continue;
    const home = unit.get(where)!;
    if (unit.has(own)) {
      if (own !== where) continue;
      const whole = home.SOVEREIGNT !== home.ADMIN;
      kept.push({
        ...f,
        properties: whole
          ? { key: "unit:" + own, of: where, ...named(home, home.ISO_A2_EH) }
          : {
              key: p.adm1_code,
              of: where,
              zh: p.name_zh || p.name,
              en: p.name,
              x: p.longitude,
              y: p.latitude,
            },
      });
    } else if (zhName(p.iso_a2))
      kept.push({
        ...f,
        properties: {
          key: `within:${own}:${where}`,
          of: where,
          ...named({}, p.iso_a2),
        },
      });
  }
  const pieceFile = join(dir, "pieces.json"),
    dissolved = join(dir, "dissolved.json");
  writeFileSync(
    pieceFile,
    JSON.stringify({ type: "FeatureCollection", features: kept }),
  );
  mapshaper(
    `-i ${pieceFile} -dissolve2 key copy-fields=of,zh,en,x,y -simplify 5% keep-shapes ` +
      `-o ${dissolved} format=geojson precision=0.01`,
  );
  const areas = (JSON.parse(readFileSync(dissolved, "utf8")) as Collection)
    .features!;
  const centres = features(`-i ${dissolved} -points inner`);
  // Coarse outlines, as for countries, to name a division whose label point is out of view.
  const divisionOutlines = features(
    `-i ${dissolved} -simplify 15% keep-shapes`,
  );
  writeFileSync(
    out + "subdivisions.json",
    JSON.stringify({
      lines: lines(geometries(shaper(`-i ${dissolved} -innerlines`))),
      // Divisions too small to keep a shape at this detail are left unnamed.
      names: areas.flatMap((f, i) => {
        const p = f.properties,
          centre = (centres[i].geometry as { coordinates: Position } | null)
            ?.coordinates;
        if (!f.geometry || !centre) return [];
        // A division's own label point, unless cutting it to its unit left that point out.
        const own: Position | null = p.x != null ? [p.x, p.y] : null;
        const at = round(
          own && rings(f.geometry).some((r) => inside(own, r)) ? own : centre,
        );
        return [
          {
            of: p.of,
            zh: p.zh,
            en: p.en,
            at,
            box: box(f.geometry, at),
            area: lines([divisionOutlines[i].geometry]),
          },
        ];
      }),
    }),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
