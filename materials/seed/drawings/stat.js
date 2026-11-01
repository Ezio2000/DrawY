// A key figure: one large number with what it counts, an optional change marked up or
// down, and a note. For headline numbers beside a diagram or a row of them as a summary.
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
const ctx = document.createElement("canvas").getContext("2d");
const measure = (s, size, weight = 400) => {
  ctx.font = `${weight} ${size}px ${font}`;
  return ctx.measureText(String(s ?? "")).width;
};
const ink = t.ink || "#222",
  paper = t.paper || "#fff",
  muted = t.muted || "#888",
  accent = t.accent || "#d97757",
  accent2 = t.accent2 || "#4f7c8a";
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 14);
const color = d.color || ink;
const vs = Math.min(
  H * 0.5,
  (W * 0.92 * size * 3) / Math.max(1, measure(d.value, size * 3, 700)),
);
const valueSize = Math.min(Number(d.valueSize) || size * 3, vs);
const left = d.align === "left";
const x = left ? 0 : W / 2,
  anchor = left ? "start" : "middle";
let y = valueSize * 0.6;
let out = `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${valueSize}" font-weight="700" fill="${color}">${esc(d.value)}${d.unit ? `<tspan font-size="${valueSize * 0.42}" font-weight="600" fill="${muted}" dx="4">${esc(d.unit)}</tspan>` : ""}</text>`;
y += valueSize * 0.55 + size * 0.9;
if (d.label) {
  out += `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size * 1.05}" font-weight="600" fill="${ink}">${esc(d.label)}</text>`;
  y += size * 1.5;
}
if (d.delta) {
  const up =
    (d.trend ?? (String(d.delta).trim().startsWith("-") ? "down" : "up")) ===
    "up";
  const good = d.good === "down" ? !up : up;
  const c = good ? accent2 : accent;
  const tw = measure(d.delta, size * 0.9, 600) + size * 1.4;
  const x0 = left ? 0 : W / 2 - tw / 2;
  const ay = y,
    ax = x0 + size * 0.45;
  out += `<path d="${up ? `M${ax - size * 0.32} ${ay + size * 0.2}L${ax} ${ay - size * 0.25}L${ax + size * 0.32} ${ay + size * 0.2}Z` : `M${ax - size * 0.32} ${ay - size * 0.2}L${ax} ${ay + size * 0.25}L${ax + size * 0.32} ${ay - size * 0.2}Z`}" fill="${c}"/>`;
  out += `<text x="${x0 + size * 1.1}" y="${ay}" font-size="${size * 0.9}" font-weight="600" fill="${c}">${esc(d.delta)}</text>`;
  y += size * 1.4;
}
if (d.note)
  out += `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size * 0.82}" fill="${muted}">${esc(d.note)}</text>`;
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}" dominant-baseline="central">${out}</svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll(
    "path:not(.plain),rect:not(.plain),circle:not(.plain)",
  ))
    el.setAttribute("filter", fx);
}
return svg;
