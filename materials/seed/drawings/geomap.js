// A true map: coastlines, lakes and rivers, and when asked today's country and first-level
// division borders, drawn from real data so that places, routes and areas given in
// longitude and latitude land where they really are. The view fits `bounds`
// [west, south, east, north], or without it everything placed, across the 180th meridian
// as readily as anywhere else. Data: Natural Earth (public domain), built by
// materials/geo.ts with one point of view throughout.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const font = t.font || "system-ui";
const ink = t.ink || "#222",
  paper = t.paper || "#fff",
  muted = t.muted || "#888",
  accent = t.accent || "#d97757",
  accent2 = t.accent2 || "#4f7c8a";
const hex = (c) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const mix = (a, b, k) => {
  const p = hex(a),
    q = hex(b);
  if (!p || !q) return k < 0.5 ? a : b;
  return (
    "#" +
    p
      .map((v, i) =>
        Math.round(v + (q[i] - v) * k)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
};
// Water takes whichever style colour is cool, so a warm accent never paints the sea.
const hue = (c) => {
  const p = hex(c);
  if (!p) return -1;
  const [r, g, b] = p.map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  if (max - min < 0.08) return -1;
  const h =
    max === r
      ? (g - b) / (max - min)
      : max === g
        ? 2 + (b - r) / (max - min)
        : 4 + (r - g) / (max - min);
  return (h * 60 + 360) % 360;
};
const cool = [accent2, accent].find((c) => {
  const h = hue(c);
  return h >= 150 && h <= 250;
});
const sea = d.water || mix(paper, cool || "#6f9fbf", 0.2);
const shore = mix(sea, ink, 0.28);
const land = d.land || mix(paper, ink, 0.025);
// A city's ground a shade deeper, so the paper-white streets stand out on it.
const cityLand = d.land || mix(paper, ink, 0.05);
// Rivers in the water's own colour, deeper than the sea so a thin line still shows.
const riverInk = mix(cool || "#5d8fb8", sea, 0.3);
const zh = d.language !== "en";
// Names the map takes from its data (countries, divisions, rivers, roads) shown as given:
// {name as drawn: name to show}, such as a city's local street names in the reader's
// language. Anything not listed is drawn as the data has it.
const renames = d.names && typeof d.names === "object" ? d.names : {};
const rename = (n) =>
  n && Object.hasOwn(renames, n) && String(renames[n]).trim()
    ? String(renames[n]).trim()
    : n;
const size = Number(d.size ?? 14);
const sw = Math.max(1, Number(t.stroke ?? 1.6));

const cache = (globalThis.__drawyGeo ??= {});
// Kept for the page once read; a read that fails in any way (an error answer, the
// network down, a broken body) is forgotten, so the next drawing tries again.
const layer = (name) =>
  (cache[name] ??= fetch(`/materials/geo/${name}`)
    .then((r) => {
      if (!r.ok) throw Error(`地图数据 ${name} 读取失败`);
      return r.json();
    })
    .catch((e) => {
      delete cache[name];
      throw e;
    }));
// Lines are stored in steps of 1/scale of a degree (hundredths unless a layer says
// otherwise), each point a step from the last.
const decode = (line, scale = 100) => {
  const pts = [];
  let x = 0,
    y = 0;
  for (let i = 0; i < line.length; i += 2) {
    x += line[i];
    y += line[i + 1];
    pts.push([x / scale, y / scale]);
  }
  return pts;
};

const places = (d.places || []).filter(
  (p) => p && Number.isFinite(+p.lon) && Number.isFinite(+p.lat),
);
const named = new Map(places.map((p) => [String(p.name), p]));
const lonlat = (p) => {
  if (Array.isArray(p)) return [+p[0], +p[1]];
  if (p && typeof p === "object") return [+p.lon, +p.lat];
  const q = named.get(String(p));
  return q ? [+q.lon, +q.lat] : null;
};
const routes = (d.routes || []).map((r) => ({
  ...r,
  at: (r.points || []).map(lonlat).filter(Boolean),
}));
const areas = (d.areas || []).map((a) => ({
  ...a,
  at: (a.points || []).map(lonlat).filter(Boolean),
}));

// The view: the given bounds, or everything placed with room around it.
let [west, south, east, north] = Array.isArray(d.bounds)
  ? d.bounds.map(Number)
  : [NaN];
if (![west, south, east, north].every(Number.isFinite)) {
  const all = [
    ...places.map((p) => [+p.lon, +p.lat]),
    ...routes.flatMap((r) => r.at),
    ...areas.flatMap((a) => a.at),
  ];
  if (all.length) {
    // Longitudes the short way round: a voyage across the Pacific is not the whole world.
    const raw = all.map((p) => p[0]),
      east360 = raw.map((x) => (x < 0 ? x + 360 : x));
    const spread = (v) => Math.max(...v) - Math.min(...v);
    const xs = spread(east360) < spread(raw) ? east360 : raw,
      ys = all.map((p) => p[1]);
    // At least a city's breadth around places close together (a walk in one town), and
    // a region's around a single place, which says nothing of how far to look.
    const least = all.length > 1 ? 0.02 : 2;
    const spanX = Math.max(least, Math.max(...xs) - Math.min(...xs)),
      spanY = Math.max(least, Math.max(...ys) - Math.min(...ys));
    west = Math.min(...xs) - spanX * 0.15;
    east = Math.max(...xs) + spanX * 0.15;
    south = Math.min(...ys) - spanY * 0.15;
    north = Math.max(...ys) + spanY * 0.15;
  } else [west, south, east, north] = [-180, -58, 180, 82];
} else if (east < west) east += 360;
// Two projections. A view of a region or a country is equirectangular, with longitudes
// shortened by the cosine of the middle latitude so it keeps its true proportions. A view
// most of the way round the world (150° of longitude or more) is in the Natural Earth
// projection, centred on the view's middle meridian: rounded at its sides so continents
// far from the equator keep their shapes and the poles do not stretch into wide bands.
const world = east - west >= 150;
const lon0 = world ? (west + east) / 2 : 0;
const k = world ? 1 : Math.cos((((south + north) / 2) * Math.PI) / 180);
const R = 180 / Math.PI;
const neX = (f2) =>
  0.8707 -
  0.131979 * f2 +
  f2 * f2 * (-0.013791 + f2 ** 3 * (0.003971 - 0.001529 * f2));
const neY = (f) => {
  const f2 = f * f;
  return (
    f *
    (1.007226 +
      f2 *
        (0.015085 + f2 * f2 * (-0.044475 + 0.028874 * f2 - 0.005916 * f2 * f2)))
  );
};
// To plane units (about degrees at the centre, y down), and back again (null off the earth).
const forward = world
  ? (lon, lat) => {
      const f = Math.max(-90, Math.min(90, lat)) / R;
      return [((lon - lon0) / R) * neX(f * f) * R, -neY(f) * R];
    }
  : (lon, lat) => [lon * k, -lat];
const inverse = world
  ? (u, v) => {
      const y = -v / R;
      if (Math.abs(y) > neY(Math.PI / 2) + 1e-9) return null;
      let f = y;
      for (let i = 0; i < 8; i++) {
        const f2 = f * f;
        const dy =
          1.007226 +
          f2 *
            (3 * 0.015085 +
              f2 *
                f2 *
                (-7 * 0.044475 + 9 * 0.028874 * f2 - 11 * 0.005916 * f2 * f2));
        f -= (neY(f) - y) / dy;
      }
      const lon = lon0 + (u / R / neX(f * f)) * R;
      return Math.abs(lon - lon0) > 180 ? null : [lon, f * R];
    }
  : (u, v) => [u / k, -v];
// The plane extent of the bounds, then widened to the module's shape.
let x0 = Infinity,
  x1 = -Infinity,
  y0 = Infinity,
  y1 = -Infinity;
for (let i = 0; i <= 24; i++)
  for (let j = 0; j <= 24; j++) {
    const [u, v] = forward(
      west + ((east - west) * i) / 24,
      south + ((north - south) * j) / 24,
    );
    x0 = Math.min(x0, u);
    x1 = Math.max(x1, u);
    y0 = Math.min(y0, v);
    y1 = Math.max(y1, v);
  }
const want = W / H;
if ((x1 - x0) / (y1 - y0) < want) {
  const grow = ((y1 - y0) * want - (x1 - x0)) / 2;
  x0 -= grow;
  x1 += grow;
} else {
  const grow = ((x1 - x0) / want - (y1 - y0)) / 2;
  y0 -= grow;
  y1 += grow;
}
const s = W / (x1 - x0);
const px = ([lon, lat]) => {
  const [u, v] = forward(lon, lat);
  return [(u - x0) * s, (v - y0) * s];
};
const unproject = (x, y) => inverse(x / s + x0, y / s + y0);
const project = (p) => px(near(p));
// What the view covers in degrees (a world view all the way round its middle meridian).
const view = world
  ? {
      w: lon0 - 180,
      e: lon0 + 180,
      n: inverse(0, y0)?.[1] ?? 90,
      s: inverse(0, y1)?.[1] ?? -90,
    }
  : { w: x0 / k, e: x1 / k, n: -y0, s: -y1 };
// Places come to the side of the 180th meridian nearest the view's centre.
const centre = world ? lon0 : (view.w + view.e) / 2;
const near = ([lon, lat]) => [
  lon + 360 * Math.round((centre - lon) / 360),
  lat,
];
// How detailed the view is, as a web map's zoom level (256 px for 360° at zoom 0), the
// scale Natural Earth gives for when each feature should appear.
const latMid = -(y0 + y1) / 2;
const zoom = Math.log2(
  (Math.hypot(
    ...[0, 1].map(
      (i) => px([centre + 0.5, latMid])[i] - px([centre - 0.5, latMid])[i],
    ),
  ) *
    360) /
    256,
);
const extent = (pts) => {
  let a = Infinity,
    b = -Infinity,
    c = Infinity,
    e = -Infinity;
  for (const [x, y] of pts) {
    if (x < a) a = x;
    if (x > b) b = x;
    if (y < c) c = y;
    if (y > e) e = y;
  }
  return [a, c, b, e];
};
// Data lines are drawn once for each copy of the world (shifted 360° either way) that
// reaches the view, so nothing breaks or goes missing at the 180th meridian.
const copies = (pts) => {
  const [a, c, b, e] = extent(pts);
  const mx = (view.e - view.w) * 0.05,
    my = (view.n - view.s) * 0.05;
  if (e < view.s - my || c > view.n + my) return [];
  return [-360, 0, 360]
    .filter((dx) => !(b + dx < view.w - mx || a + dx > view.e + mx))
    .map((dx) => ({ pts, dx }));
};
// On a world view each copy is cut at the meridians bounding it, and long edges are
// divided so they bend with the projection (an edge along a cut follows the earth's rim).
const band = [lon0 - 180, lon0 + 180];
const cross = (p, q, x) => {
  const t = (x - p[0]) / (q[0] - p[0]);
  return [x, p[1] + (q[1] - p[1]) * t];
};
const clipRing = (ring) => {
  let out = ring;
  for (const [edge, keep] of [
    [band[0], (p) => p[0] >= band[0]],
    [band[1], (p) => p[0] <= band[1]],
  ]) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const p = inp[i],
        q = inp[(i + 1) % inp.length];
      if (keep(p)) out.push(p);
      if (keep(p) !== keep(q)) out.push(cross(p, q, edge));
    }
    if (!out.length) break;
  }
  return out.length > 2 ? [out] : [];
};
const clipLine = (line) => {
  const out = [];
  let cur = [];
  const inside = (p) => p[0] >= band[0] && p[0] <= band[1];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (i) {
      const q = line[i - 1];
      if (inside(q) !== inside(p)) {
        const edge = (inside(q) ? p : q)[0] < band[0] ? band[0] : band[1];
        const c = cross(q, p, edge);
        cur.push(c);
        if (!inside(p)) {
          out.push(cur);
          cur = [];
        } else cur = [c];
      }
    }
    if (inside(p)) cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out.filter((l) => l.length > 1);
};
const densify = (pts, close) => {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    out.push(p);
    if (!close && i === n - 1) break;
    const q = pts[(i + 1) % n];
    const steps = Math.floor(
      Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) / 1.5,
    );
    for (let j = 1; j <= steps; j++) {
      const t = j / (steps + 1);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
};
// A copy of a line or ring as the screen points to draw, in one or more pieces.
const pieces = ({ pts, dx }, close) => {
  const moved = dx ? pts.map(([lon, lat]) => [lon + dx, lat]) : pts;
  const parts = world
    ? (close ? clipRing(moved) : clipLine(moved)).map((p) => densify(p, close))
    : [moved];
  return parts.map((p) => p.map(px));
};
// Projected points, dropping those too close to the last to show.
const trace = (copy, close) => {
  let out = "";
  for (const p of pieces(copy, close)) {
    let lx = NaN,
      ly = NaN;
    for (let i = 0; i < p.length; i++) {
      const [x, y] = p[i];
      if (i && i < p.length - 1 && Math.hypot(x - lx, y - ly) < 0.7) continue;
      out += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      lx = x;
      ly = y;
    }
    if (close) out += "Z";
  }
  return out;
};

const borders = ["countries", "subdivisions"].includes(d.borders)
  ? d.borders
  : "none";
const [physical, countries, subdivisions] = await Promise.all([
  layer("physical"),
  borders === "none" ? null : layer("countries"),
  borders === "subdivisions" ? layer("subdivisions") : null,
]);
const visible = (lines) => lines.map((l) => decode(l)).flatMap(copies);
// A region or a city seen close: Natural Earth has nothing finer than 1:10m, so from
// about zoom 7 (a view a couple of hundred kilometres across) the ground comes from
// OpenStreetMap tiles instead (water, parks and woods, roads by class, railways, waterway
// and road names), each a web-map tile of the view; borders stay Natural Earth's, drawn
// from the map's one point of view. The roads and railways can be left off (a historical
// map), keeping the fine coast, water and woods. Should any tile not load, the map falls
// back to Natural Earth and says the streets are missing.
const tiles = [];
let streetsFailed = false;
if (zoom >= 7) {
  let tz = Math.min(14, Math.floor(zoom));
  const merc = (lat) =>
    (1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
      ) /
        Math.PI) /
    2;
  const clampLat = (lat) => Math.max(-85, Math.min(85, lat));
  let range;
  for (;;) {
    const n = 2 ** tz;
    range = {
      n,
      x0: Math.floor(((view.w + 180) / 360) * n),
      x1: Math.floor(((view.e + 180) / 360) * n),
      y0: Math.max(0, Math.floor(merc(clampLat(view.n)) * n)),
      y1: Math.min(n - 1, Math.floor(merc(clampLat(view.s)) * n)),
    };
    if ((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) <= 36 || tz <= 7)
      break;
    tz--;
  }
  const want = [];
  for (let x = range.x0; x <= range.x1; x++)
    for (let y = range.y0; y <= range.y1; y++) {
      const col = ((x % range.n) + range.n) % range.n;
      want.push({ x, col, y, dx: 360 * Math.floor(x / range.n) });
    }
  const got = await Promise.allSettled(
    want.map((t) => layer(`streets/${tz}/${t.col}/${t.y}`)),
  );
  if (got.every((g) => g.status === "fulfilled"))
    got.forEach((g, i) =>
      tiles.push({ ...want[i], tz, n: range.n, data: g.value }),
    );
  else streetsFailed = true;
}
const city = tiles.length > 0;
// A tile's lines in degrees: tile units across, the Mercator rows down (shifted by the
// tile's dx onto the copy of the world in view by whoever draws them).
const tileLine = (t, line) => {
  const e = t.data.extent,
    pts = [];
  let u = 0,
    v = 0;
  for (let i = 0; i < line.length; i += 2) {
    u += line[i];
    v += line[i + 1];
    const lon = ((t.col + u / e) / t.n) * 360 - 180;
    const lat =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + v / e)) / t.n))) * 180) /
      Math.PI;
    pts.push([lon, lat]);
  }
  return pts;
};
// Close views read finer land, lakes and shores, only the tiles they cover; wider views
// the overview layer. A tile's fills are cut at its edges, so they get no outline of
// their own and the shores are drawn as the lines they are.
const paths = (list, close) => list.map((p) => trace(p, close)).join("");
let landPath, lakePath, shorePath;
if (city) {
  // The tiles bring their own water; Natural Earth's coarser shore would only blur it.
  landPath = lakePath = "";
} else if (zoom >= 4.5 && physical.detail) {
  const { tile, tiles } = physical.detail;
  const have = new Set(tiles),
    across = 360 / tile;
  const need = [];
  for (let x = Math.floor(view.w / tile) * tile; x < view.e; x += tile)
    for (let y = Math.floor(view.s / tile) * tile; y < view.n; y += tile) {
      if (y < -90 || y >= 90) continue;
      const col = ((((x + 180) / tile) % across) + across) % across;
      const key = `${col}-${(y + 90) / tile}`;
      if (have.has(key)) need.push({ key, dx: x - (col * tile - 180) });
    }
  const parts = await Promise.all(need.map((n) => layer("detail-" + n.key)));
  const lay = (name) =>
    parts.flatMap((t, i) =>
      t[name].map((l) => ({ pts: decode(l, t.scale), dx: need[i].dx })),
    );
  landPath = paths(lay("land"), true);
  lakePath = paths(lay("lakes"), true);
  shorePath = paths(lay("shores"), false);
} else {
  landPath = paths(visible(physical.land), true);
  lakePath = paths(visible(physical.lakes), true);
}
// Shaded relief over the land, from Natural Earth's rasters: slopes turned from the light
// in a shade of ink, those turned to it in a lighter paper, flat ground and sea untouched.
// The raster is in degrees, so each pixel of the map looks up the degree it shows, which
// holds for either projection. It fades as the view closes in, where the raster runs out
// of detail, and is gone by the time the streets of a town are drawn (zoom 10). Under the
// OpenStreetMap ground it lies on the land, under its parks, water and roads.
let reliefOut = "";
const reliefStrength =
  d.relief === false ? 0 : Math.max(0, Math.min(1, (10 - zoom) / 3));
if (reliefStrength > 0) {
  try {
    const index = await layer("relief");
    // Pixels a degree the view shows, and the coarsest level that has as many.
    const need = s * (world ? 0.9 : 1);
    const span = (view.e - view.w) * (view.n - view.s);
    // A source canvas of at most about 24 million pixels.
    const fits = (l) => span * l.ppd * l.ppd < 2.4e7;
    let level = index.levels.findIndex((l) => l.ppd >= need * 0.75 && fits(l));
    if (level < 0)
      level = index.levels.reduce((best, l, i) => (fits(l) ? i : best), 0);
    const { ppd, tile, tiles: have } = index.levels[level];
    const known = new Set(have);
    // The source: the tiles over the view, painted onto one grey canvas in degrees.
    const west0 = Math.floor(view.w / tile) * tile,
      east0 = Math.ceil(view.e / tile) * tile;
    const north0 = Math.min(90, Math.ceil(view.n / tile) * tile),
      south0 = Math.max(-90, Math.floor(view.s / tile) * tile);
    const sw0 = Math.round((east0 - west0) * ppd),
      sh0 = Math.round((north0 - south0) * ppd);
    const source = document.createElement("canvas");
    source.width = sw0;
    source.height = sh0;
    const sctx = source.getContext("2d", { willReadFrequently: true });
    sctx.fillStyle = `rgb(${index.flat},${index.flat},${index.flat})`;
    sctx.fillRect(0, 0, sw0, sh0);
    const jobs = [];
    for (let x = west0; x < east0; x += tile)
      for (let y = south0; y < north0; y += tile) {
        const across = 360 / tile;
        const col = ((((x + 180) / tile) % across) + across) % across;
        const key = `${col}-${(90 - y - tile) / tile}`;
        if (!known.has(key)) continue;
        jobs.push(
          (cache["relief/" + level + "-" + key] ??= fetch(
            `/materials/geo/relief/${level}-${key}`,
          )
            .then((r) => {
              if (!r.ok)
                throw Error(`地图数据 relief/${level}-${key} 读取失败`);
              return r.blob();
            })
            .then((b) => createImageBitmap(b))
            .catch((e) => {
              delete cache["relief/" + level + "-" + key];
              throw e;
            })).then((img) =>
            sctx.drawImage(
              img,
              (x - west0) * ppd,
              (north0 - y - tile) * ppd,
              tile * ppd,
              tile * ppd,
            ),
          ),
        );
      }
    await Promise.all(jobs);
    const grey = sctx.getImageData(0, 0, sw0, sh0).data;
    // The map's pixels, fewer of them on a large module; the image is scaled back up.
    const q = Math.min(1, Math.sqrt(9e5 / (W * H)));
    const ow = Math.max(1, Math.round(W * q)),
      oh = Math.max(1, Math.round(H * q));
    const outCanvas = document.createElement("canvas");
    outCanvas.width = ow;
    outCanvas.height = oh;
    const octx = outCanvas.getContext("2d");
    const img = octx.createImageData(ow, oh);
    const dark = hex(mix(ink, sea, 0.35)) || [60, 70, 80],
      light = hex(mix(paper, "#ffffff", 0.7)) || [255, 255, 255];
    const flat = index.flat;
    for (let j = 0; j < oh; j++)
      for (let i = 0; i < ow; i++) {
        const at = unproject((i + 0.5) / q, (j + 0.5) / q);
        if (!at) continue;
        let lon = at[0];
        // The source's own copy of this longitude.
        lon = west0 + ((((lon - west0) % 360) + 360) % 360);
        const fx = (lon - west0) * ppd - 0.5,
          fy = (north0 - at[1]) * ppd - 0.5;
        if (fx < 0 || fy < 0 || fx >= sw0 - 1 || fy >= sh0 - 1) continue;
        const ix = fx | 0,
          iy = fy | 0,
          tx = fx - ix,
          ty = fy - iy;
        const o = (iy * sw0 + ix) * 4;
        const v =
          (grey[o] * (1 - tx) + grey[o + 4] * tx) * (1 - ty) +
          (grey[o + sw0 * 4] * (1 - tx) + grey[o + sw0 * 4 + 4] * tx) * ty;
        const delta = v - flat;
        if (Math.abs(delta) < 1.5) continue;
        const c = delta < 0 ? dark : light;
        const a =
          delta < 0 ? (-delta / flat) * 0.85 : (delta / (255 - flat)) * 0.55;
        const p = (j * ow + i) * 4;
        img.data[p] = c[0];
        img.data[p + 1] = c[1];
        img.data[p + 2] = c[2];
        img.data[p + 3] = Math.round(Math.min(1, a) * reliefStrength * 255);
      }
    octx.putImageData(img, 0, 0);
    reliefOut = `<image href="${outCanvas.toDataURL("image/png")}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
  } catch (e) {
    // Relief is a finish, not the map: without it the map is still whole.
    console.warn(e);
  }
}
const riverMode =
  d.rivers === "none" || d.rivers === false
    ? "none"
    : d.rivers === "plain"
      ? "plain"
      : "named";
// A river appears from the zoom Natural Earth gives it, a step early since a figure is
// looked at closer than a web map.
const rivers =
  riverMode === "none" || city
    ? []
    : physical.rivers
        .filter((r) => r.zoom <= zoom + 1)
        .map((r) => ({ ...r, pts: visible(r.lines) }))
        .filter((r) => r.pts.length);
// Thinner on a view of the world or a continent, where there are many of them.
const riverWidth = (rank) =>
  Math.max(
    0.5,
    (2.2 - rank * 0.17) * Math.max(0.55, Math.min(1, (zoom - 0.8) / 3)),
  );

// Labels go where they collide with the fewest other labels, markers and routes.
const ctx = document.createElement("canvas").getContext("2d");
const measure = (str, sz, weight = 400) => {
  ctx.font = `${weight} ${sz}px ${font}`;
  return ctx.measureText(String(str)).width;
};
const taken = [];
const lines = [];
const hits = (b) =>
  taken.reduce(
    (n, o) =>
      n +
      (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y
        ? 4
        : 0),
    0,
  ) +
  lines.reduce((n, [a, c]) => n + (crosses(b, a, c) ? 1 : 0), 0) +
  (b.x < 2 || b.y < 2 || b.x + b.w > W - 2 || b.y + b.h > H - 2 ? 6 : 0);
const crosses = (b, a, c) => {
  if (
    Math.max(a[0], c[0]) < b.x ||
    Math.min(a[0], c[0]) > b.x + b.w ||
    Math.max(a[1], c[1]) < b.y ||
    Math.min(a[1], c[1]) > b.y + b.h
  )
    return false;
  const inside = (p) =>
    p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
  if (inside(a) || inside(c)) return true;
  const side = (p, q, r) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const corners = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  const s0 = corners.map((p) => side(a, c, p));
  return !s0.every((v) => v === s0[0]);
};
const halo = `stroke="${paper}" stroke-width="${Math.max(3, size * 0.28)}" stroke-linejoin="round" paint-order="stroke"`;

let routeOut = "",
  areaOut = "",
  markOut = "",
  labelOut = "",
  pictures = [];

// Areas: a territory or zone, lightly filled under everything placed.
const smooth = (p, closed) => {
  const n = p.length;
  if (n < 3) return p.map((q, i) => (i ? "L" : "M") + q.join(" ")).join("");
  const at = (i) =>
    closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))];
  let path = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    path += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return path + (closed ? "Z" : "");
};
// Points along the same curve, for arrows and for keeping labels off it.
const sample = (p) => {
  const n = p.length,
    out = [];
  if (n < 2) return p;
  const at = (i) => p[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let j = 0; j < 10; j++) {
      const u = j / 10,
        v = 1 - u;
      out.push([
        v * v * v * p1[0] +
          3 * v * v * u * c1[0] +
          3 * v * u * u * c2[0] +
          u * u * u * p2[0],
        v * v * v * p1[1] +
          3 * v * v * u * c1[1] +
          3 * v * u * u * c2[1] +
          u * u * u * p2[1],
      ]);
    }
  }
  out.push(p[n - 1]);
  return out;
};
// A route or area runs on from point to point the short way round, and like the data is
// drawn on each copy of the world that reaches the view, so one that crosses the 180th
// meridian, or goes all the way round, leaves one edge and comes back in at the other.
const unwrap = (pts) => {
  const out = [];
  for (const [lon, lat] of pts) {
    const from = out.length ? out[out.length - 1][0] : centre;
    out.push([lon + 360 * Math.round((from - lon) / 360), lat]);
  }
  return out;
};
const shown = (pts, close = false) =>
  copies(pts).flatMap((c) => pieces(c, close));
for (const a of areas) {
  if (a.at.length < 3) continue;
  const color = a.color || accent2;
  for (const p of shown(unwrap(a.at), true))
    areaOut += `<path d="${smooth(p, true)}" fill="${color}" fill-opacity="${Number(a.opacity ?? 0.16)}" stroke="${color}" stroke-opacity=".6" stroke-width="${sw * 0.7}" stroke-dasharray="${sw * 3} ${sw * 2.5}"/>`;
}

const arrowAt = (x, y, ang, w, color) => {
  const L = Math.max(7, w * 3.2),
    B = Math.max(4.5, w * 2.2);
  const c = Math.cos(ang),
    sn = Math.sin(ang);
  const tip = [x + c * L * 0.5, y + sn * L * 0.5],
    back = [x - c * L * 0.5, y - sn * L * 0.5];
  return `<path d="M${tip[0].toFixed(1)} ${tip[1].toFixed(1)}L${(back[0] - sn * B).toFixed(1)} ${(back[1] + c * B).toFixed(1)}L${(back[0] + sn * B).toFixed(1)} ${(back[1] - c * B).toFixed(1)}Z" fill="${color}"/>`;
};
const routeLabels = [];
const inView = ([x, y]) => x >= 0 && y >= 0 && x <= W && y <= H;
for (const r of routes) {
  if (r.at.length < 2) continue;
  const color = r.color || accent;
  const w = Number(r.width ?? sw * 2);
  const drawn = shown(unwrap(r.at)).map((p) => ({ p, curve: sample(p) }));
  if (r.label) {
    // Its name goes on the copy most of which is in view.
    const best = drawn
      .map((c) => ({ ...c, seen: c.curve.filter(inView).length }))
      .sort((a, b) => b.seen - a.seen)[0];
    if (best?.seen) routeLabels.push({ r, curve: best.curve, color });
  }
  for (const { p, curve } of drawn) {
    for (let i = 1; i < curve.length; i++) lines.push([curve[i - 1], curve[i]]);
    const dash =
      r.style === "dashed"
        ? ` stroke-dasharray="${w * 2.6} ${w * 1.8}"`
        : r.style === "dotted"
          ? ` stroke-dasharray="0.1 ${w * 2.2}"`
          : "";
    routeOut += `<path d="${smooth(p, false)}" fill="none" stroke="${paper}" stroke-opacity=".75" stroke-width="${w + 3}" stroke-linecap="round" stroke-linejoin="round"/>`;
    routeOut += `<path d="${smooth(p, false)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
    // Arrows show which way it went: at the end, or also midway along each leg.
    const arrow = r.arrow ?? "end";
    const dir = (i) => {
      const a = curve[Math.max(0, i - 1)],
        b = curve[Math.min(curve.length - 1, i + 1)];
      return Math.atan2(b[1] - a[1], b[0] - a[0]);
    };
    // Midway arrows are spaced by distance, so short legs and doubling back stay legible.
    if (arrow === "along") {
      const gap = Math.max(70, w * 24);
      let run = 0,
        next = gap / 2,
        total = 0;
      for (let i = 1; i < curve.length; i++)
        total += Math.hypot(
          curve[i][0] - curve[i - 1][0],
          curve[i][1] - curve[i - 1][1],
        );
      for (let i = 1; i < curve.length - 1; i++) {
        run += Math.hypot(
          curve[i][0] - curve[i - 1][0],
          curve[i][1] - curve[i - 1][1],
        );
        if (run < next) continue;
        if (total - run < gap * 0.45) break;
        routeOut += arrowAt(curve[i][0], curve[i][1], dir(i), w, color);
        next = run + gap;
      }
    }
    if (arrow !== "none") {
      const e = curve.length - 1;
      routeOut += arrowAt(curve[e][0], curve[e][1], dir(e), w, color);
    }
  }
}

// A scale bar, bottom left, in a round number of kilometres (true along the meridians),
// kept clear of every label.
let scaleOut = "";
// A world view's scale changes across it, so it has none.
if (d.scale !== false && !world) {
  const kmPerPx = 111.32 / s;
  const target = kmPerPx * W * 0.14;
  const mag = 10 ** Math.floor(Math.log10(target));
  const km = [1, 2, 5, 10]
    .map((m) => m * mag)
    .reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const len = km / kmPerPx,
    x = size * 1.2,
    y = H - size * 1.4;
  taken.push({
    x: x - size * 0.4,
    y: y - size * 1.3,
    w: len + size * 2.6,
    h: size * 1.3 + sw * 3,
  });
  scaleOut = `<g fill="${ink}" font-size="${(size * 0.78).toFixed(1)}"><rect x="${x}" y="${y}" width="${(len / 2).toFixed(1)}" height="${(sw * 2.2).toFixed(1)}" fill="${ink}"/><rect x="${(x + len / 2).toFixed(1)}" y="${y}" width="${(len / 2).toFixed(1)}" height="${(sw * 2.2).toFixed(1)}" fill="${paper}" stroke="${ink}" stroke-width="${sw * 0.5}"/><text x="${x}" y="${y - size * 0.35}" ${halo}>0</text><text x="${(x + len).toFixed(1)}" y="${y - size * 0.35}" text-anchor="middle" ${halo}>${km.toLocaleString()} km</text></g>`;
}

// OpenStreetMap's data asks to be credited where it is shown; a city whose streets did
// not load says so, so the blank is not taken for the place.
let creditOut = "";
const credit = city
  ? "© OpenStreetMap"
  : streetsFailed
    ? zh
      ? "街道底图暂时读取失败"
      : "Street map unavailable"
    : "";
if (credit) {
  // The credit small in the corner; a failure where it is read, clear of a faded edge.
  const sz = size * (city ? 0.62 : 0.85),
    w = measure(credit, sz);
  // A faded edge hides the outer 6% of the map.
  const inset = d.edge === "fade" ? 0.07 : 0;
  const x = city ? W * (1 - inset) - size * 0.6 : W / 2,
    y = city ? H * (1 - inset) - size * 0.5 : H * inset + size * 2.4;
  const left = city ? x - w : x - w / 2;
  taken.push({ x: left - 2, y: y - sz - 2, w: w + 4, h: sz + 4 });
  creditOut = `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${city ? "end" : "middle"}" font-size="${sz.toFixed(1)}" fill="${city ? muted : mix(muted, ink, 0.5)}" ${halo}>${esc(credit)}</text>`;
}

// Places: a marker by kind, then the name (and a note under it) beside it.
const marker = (kind, x, y, color) => {
  const r = size * 0.28;
  if (kind === "capital")
    return `<circle cx="${x}" cy="${y}" r="${r * 1.5}" fill="${paper}" stroke="${color}" stroke-width="${sw}"/><circle cx="${x}" cy="${y}" r="${r * 0.7}" fill="${color}"/>`;
  if (kind === "battle") {
    const a = r * 1.4;
    return `<path d="M${x - a} ${y - a}L${x + a} ${y + a}M${x + a} ${y - a}L${x - a} ${y + a}" stroke="${paper}" stroke-width="${sw * 3}" stroke-linecap="round"/><path d="M${x - a} ${y - a}L${x + a} ${y + a}M${x + a} ${y - a}L${x - a} ${y + a}" stroke="${color}" stroke-width="${sw * 1.4}" stroke-linecap="round"/>`;
  }
  if (kind === "mountain") {
    const a = r * 2;
    return `<path d="M${x - a} ${y + a * 0.6}L${x} ${y - a * 0.9}L${x + a} ${y + a * 0.6}Z" fill="${mix(land, ink, 0.45)}" stroke="${paper}" stroke-width="${sw * 0.6}" stroke-linejoin="round"/>`;
  }
  if (kind === "pass")
    return `<path d="M${x - r * 1.6} ${y - r}Q${x} ${y + r * 0.6} ${x + r * 1.6} ${y - r}M${x - r * 1.6} ${y + r * 1.4}Q${x} ${y - r * 0.2} ${x + r * 1.6} ${y + r * 1.4}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${paper}" stroke="${color}" stroke-width="${sw}"/>`;
};
const sides = {
  right: (m, w, h) => [m, -h / 2],
  left: (m, w, h) => [-m - w, -h / 2],
  above: (m, w, h) => [-w / 2, -m - h],
  below: (m, w, h) => [-w / 2, m],
  "top-right": (m, w, h) => [m * 0.7, -m * 0.7 - h],
  "bottom-right": (m, w, h) => [m * 0.7, m * 0.7],
  "top-left": (m, w, h) => [-m * 0.7 - w, -m * 0.7 - h],
  "bottom-left": (m, w, h) => [-m * 0.7 - w, m * 0.7],
};
const block = (name, note, sz, weight) => {
  const nw = measure(name, sz, weight),
    ns = sz * 0.78,
    tw = note ? measure(note, ns) : 0;
  return { w: Math.max(nw, tw), h: sz * 1.2 + (note ? ns * 1.25 : 0), ns };
};
const place = (x, y, gap, b, prefer, must) => {
  const order = [
    ...(prefer && sides[prefer] ? [prefer] : []),
    ...Object.keys(sides).filter((k) => k !== prefer),
  ];
  let best = null;
  for (const side of order) {
    const [dx, dy] = sides[side](gap, b.w, b.h);
    const box = { x: x + dx, y: y + dy, w: b.w, h: b.h };
    const score = hits(box) + (side === prefer ? -0.5 : 0);
    if (!best || score < best.score) best = { box, side, score };
    if (score <= 0) break;
  }
  if (!must && best.score > 0) return null;
  taken.push(best.box);
  return best;
};
const write = (box, side, name, note, sz, weight, color, extra = "") => {
  const anchor = side.includes("left")
    ? "end"
    : side === "above" || side === "below"
      ? "middle"
      : "start";
  const x =
    anchor === "end"
      ? box.x + box.w
      : anchor === "middle"
        ? box.x + box.w / 2
        : box.x;
  let out = `<text x="${x.toFixed(1)}" y="${(box.y + sz * 0.95).toFixed(1)}" text-anchor="${anchor}" font-size="${sz}" font-weight="${weight}" fill="${color}" ${halo}${extra}>${esc(name)}</text>`;
  if (note)
    out += `<text x="${x.toFixed(1)}" y="${(box.y + sz * 1.2 + sz * 0.78 * 0.95).toFixed(1)}" text-anchor="${anchor}" font-size="${(sz * 0.78).toFixed(1)}" fill="${muted}" ${halo}>${esc(note)}</text>`;
  return out;
};
// Markers first so no label covers any of them.
const spots = places.map((p) => {
  const [x, y] = project([+p.lon, +p.lat]);
  const kind = p.kind || "town";
  const color = p.color || (kind === "battle" ? accent : ink);
  if (!["water", "region"].includes(kind)) {
    markOut += marker(kind, x, y, color);
    const r = size * 0.5;
    taken.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
  }
  if (p.picture) {
    const ps = Number(p.pictureSize ?? size * 3.2);
    pictures.push({
      id: p.picture,
      x: x - ps / 2,
      y: y - ps - size * 0.5,
      size: ps,
    });
    taken.push({ x: x - ps / 2, y: y - ps - size * 0.5, w: ps, h: ps });
  }
  return { p, x, y, kind, color };
});
for (const { p, x, y, kind, color } of spots) {
  if (!p.name) continue;
  if (kind === "water" || kind === "region") {
    const sz = size * (kind === "region" ? 1.25 : 0.95);
    const b = block(p.name, p.note, sz, kind === "region" ? 600 : 400);
    const box = { x: x - b.w / 2, y: y - b.h / 2, w: b.w, h: b.h };
    taken.push(box);
    labelOut += write(
      box,
      "above",
      p.name,
      p.note,
      sz,
      kind === "region" ? 600 : 400,
      p.color ||
        (kind === "water" ? mix(sea, ink, 0.45) : mix(muted, ink, 0.3)),
      kind === "water"
        ? ` font-style="italic"`
        : ` letter-spacing="${sz * 0.25}"`,
    );
    continue;
  }
  const major = p.major || kind === "capital";
  const sz = major ? size * 1.1 : size;
  const weight = major ? 700 : 500;
  const b = block(p.name, p.note, sz, weight);
  const at = place(x, y, size * 0.55, b, p.label, true);
  labelOut += write(at.box, at.side, p.name, p.note, sz, weight, ink);
}
for (const { r, curve, color } of routeLabels) {
  const sz = size * 0.95;
  const b = block(r.label, r.note, sz, 600);
  // Along the part in view: its middle first, then further out.
  const visibleCurve = curve.filter(inView);
  const spots = [0.5, 0.35, 0.65, 0.2, 0.8].map(
    (f) => visibleCurve[Math.round((visibleCurve.length - 1) * f)],
  );
  let at = null;
  for (const [x, y] of spots) {
    at = place(x, y, size * 0.6, b, r.labelSide, false);
    if (at) break;
  }
  at ??= place(...spots[0], size * 0.6, b, r.labelSide, true);
  labelOut += write(at.box, at.side, r.label, r.note, sz, 600, color);
}

// Reference names last, only where they fit, first-level divisions before countries.
let refOut = "";
// A name the work already places itself (a province written as a region) is not repeated.
const placed = places
  .map((p) => String(p.name ?? ""))
  .filter((p) => p.length > 1);
const echoes = (n) => placed.some((p) => p.includes(n) || n.includes(p));
// An area is named only when its name fits inside the area as drawn.
const shownNames = new Set();
const refName = (n, where, area, sz, color, spacing, weight = 400) => {
  if (!n || echoes(n) || shownNames.has(n)) return false;
  const [x, y] = project(where);
  if (x < 0 || y < 0 || x > W || y > H) return false;
  const w = measure(n, sz) + spacing * [...n].length,
    h = sz * 1.2;
  if (area) {
    const [a, c] = project([area[0], area[3]]),
      [b, e] = project([area[2], area[1]]);
    if (w > (b - a) * 0.9 || h > (e - c) * 0.9) return false;
  }
  const box = { x: x - w / 2, y: y - h / 2, w, h };
  if (hits(box) > 0) return false;
  taken.push(box);
  shownNames.add(n);
  refOut += `<text x="${x.toFixed(1)}" y="${(y + sz * 0.36).toFixed(1)}" text-anchor="middle" font-size="${sz.toFixed(1)}" font-weight="${weight}" fill="${color}" letter-spacing="${spacing}" ${halo}>${esc(n)}</text>`;
  return true;
};
const spaced = (n) => (/[\u3000-\u9fff]/.test(n) ? size * 0.15 : size * 0.04);
const label = (o) => rename(zh ? o.zh || o.en : o.en || o.zh);
// Larger areas claim their place first.
const larger = (a, b) =>
  (b.box ? (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) : 0) -
  (a.box ? (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) : 0);
// When an area's own label point is out of view (a close view of its edge), its name
// goes inside the part the view shows: on a grid over the view, the point inside the area
// nearest the middle of that part with room for the name on its row.
const cols = 40,
  rows = 25;
const grid = Array.from({ length: cols * rows }, (_, i) => {
  const x = ((i % cols) + 0.5) * (W / cols),
    y = (Math.floor(i / cols) + 0.5) * (H / rows);
  const at = unproject(x, y);
  return {
    x,
    y,
    i,
    lon: at ? ((((at[0] + 180) % 360) + 360) % 360) - 180 : NaN,
    lat: at ? at[1] : NaN,
  };
}).filter((g) => Number.isFinite(g.lat));
const within = (lon, lat, rings) => {
  let hit = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if (
        r[i][1] > lat !== r[j][1] > lat &&
        lon <
          ((r[j][0] - r[i][0]) * (lat - r[i][1])) / (r[j][1] - r[i][1]) +
            r[i][0]
      )
        hit = !hit;
  return hit;
};
// Places inside the area, nearest the middle of what the view shows of it first, each
// with room on its row for a name w wide.
const spotsIn = (c, w) => {
  // Any part of it may be the one in view, not only the part its label point is in.
  const rings = (c.area ?? []).map((l) => decode(l));
  if (!rings.some((r) => copies(r).length)) return [];
  const hits = grid.filter((g) => within(g.lon, g.lat, rings));
  if (!hits.length) return [];
  const set = new Set(hits.map((g) => g.i));
  const mx = hits.reduce((t, g) => t + g.x, 0) / hits.length,
    my = hits.reduce((t, g) => t + g.y, 0) / hits.length;
  const room = (g) => {
    const col = g.i % cols;
    let left = 0,
      right = 0;
    while (col - left - 1 >= 0 && set.has(g.i - left - 1)) left++;
    while (col + right + 1 < cols && set.has(g.i + right + 1)) right++;
    return (left + right + 1) * (W / cols) >= w * 1.15;
  };
  return hits
    .sort(
      (a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my),
    )
    .filter(room)
    .slice(0, 12)
    .map((g) => [g.lon, g.lat]);
};
// An area is named at its own label point when that is in view and free, otherwise at
// the first free place inside the part of it the view shows.
// A unit too small to have an outline in the data (a reef, an islet) is not named, nor
// one whose name is already on the map.
const nameArea = (o, sz, color, spacing, weight) => {
  const n = label(o);
  if (!n || !o.box) return false;
  const gap = spacing(n);
  if (inView(project(o.at)) && refName(n, o.at, o.box, sz, color, gap, weight))
    return true;
  const w = measure(n, sz) + gap * [...n].length;
  return spotsIn(o, w).some((at) =>
    refName(n, at, null, sz, color, gap, weight),
  );
};
// The countries the map is about: those its places, routes and areas are in, or else the
// one at the middle of the view. Their divisions are named and outlined; elsewhere only
// countries are, so neighbours' provinces do not crowd the subject.
const focus = new Set();
if (countries) {
  const points = [
    ...places.map((p) => [+p.lon, +p.lat]),
    ...routes.flatMap((r) => r.at),
    ...areas.flatMap((a) => a.at),
  ];
  const middle = unproject(W / 2, H / 2);
  const inside = (c, [lon, lat]) => {
    const b = c.box;
    if (!b || lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3])
      return false;
    return within(
      lon,
      lat,
      (c.area ?? []).map((l) => decode(l)),
    );
  };
  for (const p of points.length ? points : middle ? [middle] : [])
    for (const c of countries.names) if (inside(c, p)) focus.add(c.of);
}
const ofFocus = (of) => !focus.size || focus.has(of);
// A country's name grows with the country as drawn, from the label size to nearly twice it.
const countrySize = (c) => {
  const [a, e] = project([c.box[0], c.box[3]]),
    [b, f] = project([c.box[2], c.box[1]]);
  const span = Math.sqrt(Math.abs((b - a) * (f - e)));
  return size * Math.max(0.82, Math.min(1.7, 0.72 + span / 420));
};
// A country whose divisions are named is not named again over them.
const divided = new Set();
if (subdivisions)
  for (const p of [...subdivisions.names].sort(larger))
    if (
      ofFocus(p.of) &&
      nameArea(p, size * 0.8, mix(muted, ink, 0.1), spaced, 400)
    )
      divided.add(p.of);
if (countries)
  for (const c of [...countries.names].filter((c) => c.box).sort(larger))
    if (!divided.has(c.of))
      nameArea(
        c,
        countrySize(c),
        focus.has(c.of) ? mix(muted, ink, 0.55) : mix(muted, ink, 0.12),
        (n) => spaced(n) * 1.4,
        focus.has(c.of) ? 600 : 500,
      );
let riverOut = "";
const riverLabels = [];
for (const r of rivers) {
  const wpx = riverWidth(r.rank);
  riverOut += `<path d="${r.pts.map((p) => trace(p, false)).join("")}" fill="none" stroke="${riverInk}" stroke-width="${wpx.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const name = rename(zh ? r.zh : r.en);
  if (riverMode === "named" && name) riverLabels.push({ r, name });
}
// Rivers picked out by name (a main stream through its differently named reaches), whole
// or only between the points nearest two places, such as one gorge; in the style's cool
// colour unless given one, as water is.
let highlightOut = "";
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
for (const h of d.highlights || []) {
  // By the name the data gives or the one the map shows instead.
  const names = [].concat(h.river ?? []).map(String);
  const known = (n) => !!n && (names.includes(n) || names.includes(rename(n)));
  const pool = physical.rivers
    .filter((r) => known(r.zh) || known(r.en))
    .flatMap((r) => r.lines.map((l) => decode(l)));
  // In a city, the streets' own waterways by the same names, which follow it closely.
  if (city)
    pool.push(
      ...tiles.flatMap((t) =>
        t.data.waterways
          .filter((w) => known(w.name))
          .flatMap((w) =>
            w.lines.map((l) =>
              tileLine(t, l).map(([lon, lat]) => [lon + t.dx, lat]),
            ),
          ),
      ),
    );
  // Reaches joined where they meet, so a stretch can run on across them.
  const chains = [];
  while (pool.length) {
    let chain = pool.shift(),
      grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i],
          a = chain[0],
          b = chain[chain.length - 1];
        if (apart(b, p[0]) < 0.05) chain = chain.concat(p.slice(1));
        else if (apart(b, p[p.length - 1]) < 0.05)
          chain = chain.concat(p.slice(0, -1).reverse());
        else if (apart(a, p[p.length - 1]) < 0.05)
          chain = p.slice(0, -1).concat(chain);
        else if (apart(a, p[0]) < 0.05)
          chain = p.slice(1).reverse().concat(chain);
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    chains.push(chain);
  }
  if (!chains.length) continue;
  let shownChains = chains;
  const from = h.from != null ? lonlat(h.from) : null,
    to = h.to != null ? lonlat(h.to) : null;
  if (from && to) {
    const nearest = (c, p) =>
      c.reduce((best, q, i) => (apart(q, p) < apart(c[best], p) ? i : best), 0);
    const best = chains
      .map((c) => {
        const i = nearest(c, from),
          j = nearest(c, to);
        return { c, i, j, cost: apart(c[i], from) + apart(c[j], to) };
      })
      .sort((a, b) => a.cost - b.cost)[0];
    shownChains = [
      best.c.slice(Math.min(best.i, best.j), Math.max(best.i, best.j) + 1),
    ];
  }
  const path = shownChains
    .flatMap(copies)
    .map((p) => trace(p, false))
    .join("");
  highlightOut += `<path d="${path}" fill="none" stroke="${h.color || mix(cool || "#3d7fb0", ink, 0.15)}" stroke-width="${Number(h.width ?? sw * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// A name along its line: on the longest stretch in view, turned to the line's direction
// there, and only where it has room and is clear of everything else.
// Water is named beside its line, a road on it.
const along = (name, stretches, sz, color, italic, on = false) => {
  const longest = stretches
    .map((p) => p.filter(([x, y]) => x > 0 && y > 0 && x < W && y < H))
    .sort((a, b) => b.length - a.length)[0];
  if (!longest || longest.length < 3) return false;
  let len = 0;
  for (let i = 1; i < longest.length; i++)
    len += Math.hypot(
      longest[i][0] - longest[i - 1][0],
      longest[i][1] - longest[i - 1][1],
    );
  const w = measure(name, sz);
  if (len < w * 2.2) return false;
  // The middle point by length, not by count: city data bunches points at the bends.
  let run = 0,
    m = 0;
  while (m < longest.length - 1 && run < len / 2) {
    run += Math.hypot(
      longest[m + 1][0] - longest[m][0],
      longest[m + 1][1] - longest[m][1],
    );
    m++;
  }
  const mid = longest[m];
  // The direction over about the name's length, so a kink right at the middle does not
  // turn it.
  const reach = (step) => {
    let i = m,
      d = 0;
    while (i + step >= 0 && i + step < longest.length && d < w / 2) {
      d += Math.hypot(
        longest[i + step][0] - longest[i][0],
        longest[i + step][1] - longest[i][1],
      );
      i += step;
    }
    return longest[i];
  };
  const a = reach(-1),
    b = reach(1);
  let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang < -90) ang += 180;
  const box = {
    x: mid[0] - w / 2,
    y: mid[1] - (on ? sz * 0.55 : sz),
    w,
    h: sz * 1.1,
  };
  if (hits(box) > 0) return false;
  taken.push(box);
  refOut += `<text transform="translate(${mid[0].toFixed(1)} ${mid[1].toFixed(1)}) rotate(${ang.toFixed(1)})" y="${(on ? sz * 0.35 : -sz * 0.35).toFixed(1)}" text-anchor="middle" font-size="${sz.toFixed(1)}"${italic ? ` font-style="italic"` : ""} fill="${color}" ${halo}>${esc(name)}</text>`;
  return true;
};
for (const { r, name } of riverLabels
  .sort((a, b) => a.r.rank - b.r.rank)
  .slice(0, 24))
  along(
    name,
    r.pts.flatMap((c) => pieces(c, false)),
    size * 0.82,
    mix(riverInk, ink, 0.35),
    true,
  );
// The city's own ground, each tile kept to its square so the parts of its shapes cut at
// the edge never show: parks and woods, waterways under the water they run in, roads
// cased and filled by class (fewer and narrower further out), railways; then the names
// of waterways and main roads where they fit.
let cityOut = "";
if (city) {
  const tint = [accent2, accent].find((c) => {
    const h = hue(c);
    return h >= 70 && h <= 170;
  });
  const green = mix(cityLand, tint || "#7da26a", 0.2);
  const f = 2 ** ((zoom - 14) * 0.7);
  const roadWidth = {
    motorway: 7,
    trunk: 6.5,
    primary: 6,
    secondary: 5,
    tertiary: 4,
    minor: 2.6,
  };
  // Main roads from a regional view, the rest as the view closes in on a town.
  const roadFrom = {
    motorway: 7,
    trunk: 7.5,
    primary: 9,
    secondary: 11,
    tertiary: 12,
    minor: 13.5,
  };
  const waterWidth = { river: 2.6, canal: 1.8, stream: 1.1 };
  const casing = mix(cityLand, ink, 0.22);
  const roadsOn = d.roads !== false;
  const path = (t, lines, close) =>
    lines.map((l) => trace({ pts: tileLine(t, l), dx: t.dx }, close)).join("");
  const stroked = (dd, color, width, extra = "") =>
    dd
      ? `<path d="${dd}" fill="none" stroke="${color}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`
      : "";
  tiles.forEach((t, i) => {
    const corner = (u) => {
      const [lon, lat] = tileLine(t, [u, u])[0];
      return px([lon + t.dx, lat]);
    };
    const [ax, ay] = corner(0),
      [bx, by] = corner(t.data.extent);
    if (bx < 0 || by < 0 || ax > W || ay > H) return;
    const data = t.data;
    let g = "";
    const greenD = path(t, data.green, true);
    if (greenD) g += `<path d="${greenD}" fill="${green}"/>`;
    for (const w of data.waterways) {
      if (w.class === "stream" && zoom < 13) continue;
      g += stroked(
        path(t, w.lines, false),
        mix(sea, ink, 0.12),
        Math.max(0.7, waterWidth[w.class] * f),
      );
    }
    const waterD = path(t, data.water, true);
    if (waterD)
      g += `<path d="${waterD}" fill="${sea}" stroke="${shore}" stroke-width="${(sw * 0.5).toFixed(2)}" stroke-linejoin="round"/>`;
    const roads = data.roads
      .filter((r) => roadsOn && zoom >= roadFrom[r.class])
      .sort((a, b) => roadWidth[a.class] - roadWidth[b.class])
      .map((r) => ({
        d: path(t, r.lines, false),
        w: Math.max(0.8, roadWidth[r.class] * f),
        major: r.class === "motorway" || r.class === "trunk",
      }));
    for (const r of roads)
      g += stroked(r.d, r.major ? mix(casing, ink, 0.15) : casing, r.w + 1.6);
    // Railways once the view is down to a few towns.
    const railD = roadsOn && zoom >= 9 ? path(t, data.rail, false) : "";
    g += stroked(railD, mix(muted, ink, 0.25), Math.max(0.8, 1.6 * f));
    g += stroked(
      railD,
      paper,
      Math.max(0.4, 0.8 * f),
      ` stroke-dasharray="${(5 * Math.max(0.6, f)).toFixed(1)} ${(5 * Math.max(0.6, f)).toFixed(1)}" stroke-linecap="butt"`,
    );
    for (const r of roads) g += stroked(r.d, paper, r.w);
    cityOut += `<clipPath id="geomap-tile-${i}"><rect x="${(ax - 0.3).toFixed(1)}" y="${(ay - 0.3).toFixed(1)}" width="${(bx - ax + 0.6).toFixed(1)}" height="${(by - ay + 0.6).toFixed(1)}"/></clipPath><g clip-path="url(#geomap-tile-${i})">${g}</g>`;
  });
  const roadNames = roadsOn && d.roadNames !== false;
  if (riverMode === "named" || roadNames) {
    // Each name once, gathered across the tiles it runs through, larger ways first.
    const gather = (list, rank) => {
      const by = new Map();
      for (const t of tiles)
        for (const item of t.data[list]) {
          // As the place writes it, whatever the map's language.
          const name = rename(item.name);
          if (!name) continue;
          const e = by.get(name) ?? { name, rank: rank(item), lines: [] };
          e.lines.push(
            ...item.lines.map((l) =>
              tileLine(t, l).map(([lon, lat]) => px([lon + t.dx, lat])),
            ),
          );
          by.set(name, e);
        }
      return [...by.values()].sort((a, b) => a.rank - b.rank);
    };
    // Stretches cut at tile edges are joined where they meet again.
    const join = (lines) => {
      const pool = lines.filter((l) => l.length > 1).map((l) => l.slice());
      const out = [];
      const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5;
      while (pool.length) {
        let c = pool.shift(),
          grown = true;
        while (grown) {
          grown = false;
          for (let i = 0; i < pool.length; i++) {
            const p = pool[i];
            if (near(c[c.length - 1], p[0])) c = c.concat(p.slice(1));
            else if (near(c[c.length - 1], p[p.length - 1]))
              c = c.concat(p.slice(0, -1).reverse());
            else if (near(c[0], p[p.length - 1])) c = p.slice(0, -1).concat(c);
            else if (near(c[0], p[0])) c = p.slice(1).reverse().concat(c);
            else continue;
            pool.splice(i, 1);
            grown = true;
            break;
          }
        }
        out.push(c);
      }
      return out;
    };
    if (riverMode === "named")
      for (const e of gather("waterways", (w) =>
        w.class === "river" ? 0 : w.class === "canal" ? 1 : 2,
      ).slice(0, 16))
        along(
          e.name,
          join(e.lines),
          size * 0.8,
          mix(riverInk, ink, 0.35),
          true,
        );
    if (roadNames) {
      const order = ["motorway", "trunk", "primary", "secondary", "tertiary"];
      for (const e of gather("names", (r) => order.indexOf(r.class))
        .filter((e) => zoom >= roadFrom[order[e.rank]] + 1)
        .slice(0, 30))
        along(
          e.name,
          join(e.lines),
          size * 0.72,
          mix(muted, ink, 0.45),
          false,
          true,
        );
    }
  }
}

// Borders as the data's point of view classes them: settled, disputed or provisional
// (lines of control, undefined frontiers), lease and overlay limits, and maritime lines.
// A country border is a pale band under a fine line, as atlases draw it, so it reads
// apart from rivers and division lines without being heavier than them; division lines
// are fine and light, and only inside the countries the map is about.
let borderOut = "";
// Lines thin out on a view of the whole world or a continent, where they are many and short.
const fine = Math.max(0.5, Math.min(1, (zoom - 0.8) / 3));
// Lines given encoded, or already as points.
const stroke = (lines, color, width, dash, extra = "") => {
  const d = lines
    .map((l) => (typeof l[0] === "number" ? decode(l) : l))
    .flatMap(copies)
    .map((p) => trace(p, false))
    .join("");
  return d
    ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linecap="round" stroke-linejoin="round"${extra}/>`
    : "";
};
if (subdivisions) {
  let lines = subdivisions.lines.map((l) => decode(l));
  if (focus.size) {
    const own = countries.names
      .filter((c) => focus.has(c.of) && c.box)
      .map((c) => ({
        box: c.box,
        rings: (c.area ?? []).map((l) => decode(l)),
      }));
    lines = lines.filter((pts) => {
      const [lon, lat] = pts[Math.floor(pts.length / 2)];
      return own.some(
        ({ box, rings }) =>
          lon >= box[0] &&
          lon <= box[2] &&
          lat >= box[1] &&
          lat <= box[3] &&
          within(lon, lat, rings),
      );
    });
  }
  borderOut += stroke(
    lines,
    d.borderColor ? mix(d.borderColor, paper, 0.35) : mix(muted, paper, 0.2),
    sw * 0.5,
    `${sw * 1.8} ${sw * 1.3}`,
  );
}
if (countries) {
  const line = d.borderColor || mix(muted, ink, 0.45),
    l = countries.lines;
  borderOut += stroke(
    [...l.international, ...l.disputed],
    mix(land, d.borderColor || muted, 0.32),
    sw * 3.4 * fine,
    "",
    ` stroke-opacity=".7"`,
  );
  borderOut += stroke(l.international, line, sw * 0.6 * fine, "");
  borderOut += stroke(
    l.disputed,
    line,
    sw * 0.6 * fine,
    `${sw * 2 * fine} ${sw * 1.5 * fine}`,
  );
  borderOut += stroke(l.limit, line, sw * 0.55, `0.1 ${sw * 2}`);
  borderOut += stroke(
    l.maritime,
    d.borderColor || mix(sea, ink, 0.3),
    sw * 0.55,
    `${sw * 3} ${sw * 2}`,
  );
}

// A world view is the earth's outline on the paper, with a graticule every 30° on the sea.
const globeOut = { sea: "", rim: "" };
if (world) {
  const line = (pts) =>
    pts
      .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1))
      .join("");
  const rim = [];
  for (let lat = -90; lat <= 90; lat += 2) rim.push(px([lon0 - 180, lat]));
  for (let lat = 90; lat >= -90; lat -= 2) rim.push(px([lon0 + 180, lat]));
  const outline = line(rim) + "Z";
  let grid = "";
  for (
    let lon = Math.ceil((lon0 - 179) / 30) * 30;
    lon < lon0 + 180;
    lon += 30
  ) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(px([lon, lat]));
    grid += line(pts);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lon = lon0 - 180; lon <= lon0 + 180; lon += 3)
      pts.push(px([lon, lat]));
    grid += line(pts);
  }
  globeOut.sea = `<path d="${outline}" fill="${sea}"/><path d="${grid}" fill="none" stroke="${mix(sea, ink, 0.1)}" stroke-width=".6"/>`;
  globeOut.rim = `<path d="${outline}" fill="none" stroke="${mix(sea, ink, 0.35)}" stroke-width="1"/>`;
}
// Coasts lined on the water side: a soft band of deeper water under the land's edge.
const lining = mix(sea, cool || "#6f9fbf", 0.45);
const coastLining = (dd) =>
  dd
    ? `<path d="${dd}" fill="none" stroke="${lining}" stroke-width="${(sw * 7 * fine * fine).toFixed(1)}" stroke-opacity=".18" stroke-linejoin="round"/><path d="${dd}" fill="none" stroke="${lining}" stroke-width="${(sw * 3 * fine).toFixed(1)}" stroke-opacity=".28" stroke-linejoin="round"/>`
    : "";

const texture = d.effect ? ` filter="${api.effect(d.effect)}"` : "";
const fade = d.edge === "fade";
const svg =
  api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(font)}" style="display:block">
  <defs><clipPath id="geomap-view"><rect width="${W}" height="${H}"/></clipPath></defs>
  <g clip-path="url(#geomap-view)">
    ${world ? globeOut.sea : `<rect width="${W}" height="${H}" fill="${city ? cityLand : sea}"/>`}
    ${city ? reliefOut : ""}${cityOut ? `<g${texture}>${cityOut}</g>` : ""}${
      city
        ? ""
        : shorePath === undefined
          ? `${coastLining(landPath)}<path d="${landPath}" fill="${land}" fill-rule="evenodd" stroke="${shore}" stroke-width="${sw * 0.6}" stroke-linejoin="round"${texture}/>
    <path d="${lakePath}" fill="${sea}" stroke="${shore}" stroke-width="${sw * 0.4}"/>`
          : // Tile seams closed in the fills' own colours, under the real shore line.
            `${coastLining(shorePath)}<path d="${landPath}" fill="${land}" fill-rule="evenodd" stroke="${land}" stroke-width=".8"${texture}/>
    <path d="${lakePath}" fill="${sea}" stroke="${sea}" stroke-width=".8"/>
    <path d="${shorePath}" fill="none" stroke="${shore}" stroke-width="${sw * 0.6}" stroke-linejoin="round"/>`
    }
    ${city ? "" : reliefOut}${borderOut}${riverOut}${highlightOut}${areaOut}${routeOut}${markOut}${refOut}${labelOut}${scaleOut}${creditOut}
    ${world ? globeOut.rim : ""}
  </g>
  ${fade || world ? "" : `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${mix(ink, paper, 0.35)}" stroke-width="1"/>`}
</svg>`);
if (fade) {
  const edge = (to) =>
    `linear-gradient(to ${to},transparent,#000 6%,#000 94%,transparent)`;
  svg.style.maskImage =
    svg.style.webkitMaskImage = `${edge("right")},${edge("bottom")}`;
  svg.style.maskComposite = "intersect";
  svg.style.setProperty("-webkit-mask-composite", "source-in");
}
if (!pictures.length) return svg;
const root = api.html(
  `<div style="position:relative;width:${W}px;height:${H}px"></div>`,
);
const frame = root.firstElementChild;
frame.append(svg);
for (const p of pictures) {
  const el = api.material(p.id, { width: p.size, height: p.size });
  el.style.position = "absolute";
  el.style.left = p.x + "px";
  el.style.top = p.y + "px";
  frame.append(el);
}
return root;
