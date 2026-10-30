// Axes with ticks and one or more curves: functions of x (JavaScript expressions such as
// "Math.sin(x)") or measured points. For quantities, laws and comparisons over a range.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const size = Number(d.size ?? 13);
const xs = { min: 0, max: 10, label: "", ...(d.x || {}) };
const ys = { min: 0, max: 10, label: "", ...(d.y || {}) };
const pad = { l: size * 3.4, r: size * 1.2, t: size * 1.4, b: size * 3 };
const pw = W - pad.l - pad.r,
  ph = H - pad.t - pad.b;
const X = (v) => pad.l + ((v - xs.min) / (xs.max - xs.min)) * pw;
const Y = (v) => pad.t + ph - ((v - ys.min) / (ys.max - ys.min)) * ph;
const nice = (min, max, count) => {
  const raw = (max - min) / count,
    mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step)
    out.push(Math.round(v * 1e9) / 1e9);
  return out;
};
const ink = t.ink || "#222",
  muted = t.muted || "#888";
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const xt = Array.isArray(xs.ticks)
  ? xs.ticks
  : nice(xs.min, xs.max, Number(xs.ticks ?? 5));
const yt = Array.isArray(ys.ticks)
  ? ys.ticks
  : nice(ys.min, ys.max, Number(ys.ticks ?? 4));
let out = "";
if (d.grid) {
  for (const v of yt)
    out += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${muted}" stroke-opacity=".22"/>`;
  for (const v of xt)
    out += `<line y1="${pad.t}" y2="${pad.t + ph}" x1="${X(v)}" x2="${X(v)}" stroke="${muted}" stroke-opacity=".22"/>`;
}
out += `<path d="M${pad.l} ${pad.t - 4}V${pad.t + ph}H${pad.l + pw + 4}" fill="none" stroke="${ink}" stroke-width="1.2"/>`;
for (const v of xt)
  out += `<line x1="${X(v)}" x2="${X(v)}" y1="${pad.t + ph}" y2="${pad.t + ph + 4}" stroke="${ink}"/><text x="${X(v)}" y="${pad.t + ph + size * 1.4}" text-anchor="middle" font-size="${size}" fill="${muted}">${esc(xs.format ? xs.format.replace("{}", v) : v)}</text>`;
for (const v of yt)
  out += `<line x1="${pad.l - 4}" x2="${pad.l}" y1="${Y(v)}" y2="${Y(v)}" stroke="${ink}"/><text x="${pad.l - 7}" y="${Y(v)}" text-anchor="end" dominant-baseline="central" font-size="${size}" fill="${muted}">${esc(ys.format ? ys.format.replace("{}", v) : v)}</text>`;
if (xs.label)
  out += `<text x="${pad.l + pw}" y="${H - size * 0.3}" text-anchor="end" font-size="${size}" fill="${ink}">${esc(xs.label)}</text>`;
if (ys.label)
  out += `<text x="${pad.l}" y="${size * 0.5}" text-anchor="start" font-size="${size}" fill="${ink}">${esc(ys.label)}</text>`;
const palette = [t.accent || "#d97757", t.accent2 || "#4a7fa8", ink, muted];
(d.series || []).forEach((s, i) => {
  const f = s.fn ? new Function("x", "return " + s.fn) : null;
  const pts = f
    ? Array.from({ length: 241 }, (_, k) => {
        const x = xs.min + ((xs.max - xs.min) * k) / 240;
        return [x, f(x)];
      })
    : s.points || [];
  const color = s.color || palette[i % palette.length];
  const path = pts
    .filter(([, y]) => Number.isFinite(y))
    .map(
      ([x, y], k) =>
        `${k ? "L" : "M"}${X(x).toFixed(1)} ${Y(Math.max(ys.min, Math.min(ys.max, y))).toFixed(1)}`,
    )
    .join("");
  out += `<path d="${path}" fill="none" stroke="${color}" stroke-width="${Number(s.width ?? 2.2)}" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="6 5"' : ""}/>`;
  if (s.dots)
    for (const [x, y] of pts)
      out += `<circle cx="${X(x)}" cy="${Y(y)}" r="3.2" fill="${color}"/>`;
  if (s.label && pts.length) {
    const [x, y] = pts[pts.length - 1];
    out += `<text x="${X(x) - 4}" y="${Y(y) - size * 0.8}" text-anchor="end" font-size="${size}" fill="${color}" paint-order="stroke" stroke="${t.paper || "#fff"}" stroke-width="4">${esc(s.label)}</text>`;
  }
});
return api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(t.font || "system-ui")}">${out}</svg>`,
);
