// A two-by-two matrix: two axes from low to high split the plane into four named
// quadrants (urgent and important, cost and value, risk and impact), with items placed as
// dots at their positions. One quadrant can be highlighted.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const ink = t.ink || "#222",
  paper = t.paper || "#fff",
  muted = t.muted || "#888",
  accent = t.accent || "#d97757";
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 14);
const ax = d.x || {},
  ay = d.y || {};
const left = size * (ay.label ? 2.8 : 1.4),
  bottom = size * (ax.label ? 3 : 1.6);
const x0 = left,
  x1 = W - size * 0.4,
  y0 = size * 0.4,
  y1 = H - bottom;
const mx = (x0 + x1) / 2,
  my = (y0 + y1) / 2,
  g = size * 0.25;
const names = d.quadrants || [];
const order = ["top-left", "top-right", "bottom-left", "bottom-right"];
const r = Math.min(12, (y1 - y0) / 8);
let out = "";
order.forEach((q, i) => {
  const right = i % 2 === 1,
    low = i > 1;
  const x = right ? mx + g : x0,
    y = low ? my + g : y0;
  const w = right ? x1 - mx - g : mx - g - x0,
    h = low ? y1 - my - g : my - g - y0;
  const lit = d.highlight === q;
  out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${lit ? accent : muted}" fill-opacity="${lit ? 0.14 : 0.07}"${lit ? ` stroke="${accent}" stroke-width="${sw}"` : ""}/>`;
  if (names[i])
    out += `<text x="${right ? x + w - size * 0.8 : x + size * 0.8}" y="${low ? y + h - size * 0.9 : y + size * 1.1}" text-anchor="${right ? "end" : "start"}" font-size="${size}" font-weight="600" fill="${lit ? accent : muted}">${esc(names[i])}</text>`;
});
// Axes along the outer edges, pointing towards high.
const hl = Math.max(7, sw * 4.5),
  hw = hl * 0.42;
const axisY = y1 + size * 0.7,
  axisX = x0 - size * 0.7;
out += `<g stroke="${ink}" stroke-width="${sw}" stroke-linecap="round" fill="none"><path d="M${x0} ${axisY}H${x1 - hl * 0.6}"/><path d="M${axisX} ${y1}V${y0 + hl * 0.6}"/></g>`;
out += `<path d="M${x1} ${axisY}l${-hl} ${-hw}v${hw * 2}z" fill="${ink}"/><path d="M${axisX} ${y0}l${-hw} ${hl}h${hw * 2}z" fill="${ink}"/>`;
const small = size * 0.8;
if (ax.low)
  out += `<text x="${x0}" y="${axisY + size * 1.1}" font-size="${small}" fill="${muted}">${esc(ax.low)}</text>`;
if (ax.high)
  out += `<text x="${x1 - hl * 1.4}" y="${axisY + size * 1.1}" text-anchor="end" font-size="${small}" fill="${muted}">${esc(ax.high)}</text>`;
if (ax.label)
  out += `<text x="${mx}" y="${axisY + size * 1.2}" text-anchor="middle" font-size="${size}" font-weight="600" fill="${ink}">${esc(ax.label)}</text>`;
const rot = (x, y, s, extra) =>
  `<text x="${x}" y="${y}" transform="rotate(-90 ${x} ${y})" ${extra}>${esc(s)}</text>`;
if (ay.low)
  out += rot(
    axisX - size * 1.1,
    y1,
    ay.low,
    `font-size="${small}" fill="${muted}"`,
  );
if (ay.high)
  out += rot(
    axisX - size * 1.1,
    y0 + hl * 1.4,
    ay.high,
    `text-anchor="end" font-size="${small}" fill="${muted}"`,
  );
if (ay.label)
  out += rot(
    axisX - size * 1.2,
    my,
    ay.label,
    `text-anchor="middle" font-size="${size}" font-weight="600" fill="${ink}"`,
  );
for (const it of d.items || []) {
  const x = x0 + Math.min(1, Math.max(0, Number(it.x))) * (x1 - x0),
    y = y1 - Math.min(1, Math.max(0, Number(it.y))) * (y1 - y0);
  const c = it.accent ? accent : ink;
  out += `<circle cx="${x}" cy="${y}" r="${size * 0.38}" fill="${c}" stroke="${paper}" stroke-width="2"/>`;
  if (it.label)
    out += `<text x="${x + size * 0.75}" y="${y}" font-size="${size * 0.9}" fill="${c}" paint-order="stroke" stroke="${paper}" stroke-width="4" stroke-linejoin="round">${esc(it.label)}</text>`;
}
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(t.font || "system-ui")}" dominant-baseline="central">${out}</svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll("rect,circle,path"))
    el.setAttribute("filter", fx);
}
return svg;
