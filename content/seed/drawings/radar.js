// A radar chart: several qualities on spokes from a centre, a web of rings for the
// scale, and each subject as a translucent shape joining its scores, so profiles can be
// compared at a glance. Scores run from 0 to max.
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
// Distinct colours from the style: accent, accent2, then blends of them with ink.
const palette = (n) =>
  Array.from(
    { length: n },
    (_, i) =>
      [
        accent,
        accent2,
        mix(accent, ink, 0.45),
        mix(accent2, ink, 0.45),
        mix(accent, accent2, 0.5),
        muted,
      ][i % 6],
  );
const axes = (d.axes || []).map(String);
const n = Math.max(3, axes.length);
const max = Number(d.max ?? 1);
const levels = Math.max(1, Number(d.levels ?? 4));
const series = d.series || [];
const colors = palette(series.length);
const cx = W / 2,
  cy = H / 2 + (series.length > 1 ? -size * 0.8 : 0);
const R = Math.min(
  W / 2 - size * 4.5,
  H / 2 - size * (series.length > 1 ? 3.2 : 1.8),
);
const pt = (i, r) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};
const ring = (r) =>
  Array.from({ length: n }, (_, i) => pt(i, r))
    .map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`)
    .join("") + "Z";
let out = "";
for (let l = 1; l <= levels; l++)
  out += `<path class="plain" d="${ring((R * l) / levels)}" fill="${l === levels ? muted : "none"}" fill-opacity=".05" stroke="${muted}" stroke-opacity=".45" stroke-width="1"/>`;
axes.forEach((a, i) => {
  const e = pt(i, R),
    p = pt(i, R + size * 1.1);
  out += `<path class="plain" d="M${cx} ${cy}L${e.x} ${e.y}" stroke="${muted}" stroke-opacity=".45" stroke-width="1"/>`;
  const c = Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n);
  out += `<text x="${p.x}" y="${p.y}" text-anchor="${Math.abs(c) < 0.2 ? "middle" : c > 0 ? "start" : "end"}" font-size="${size * 0.9}" font-weight="600" fill="${ink}">${esc(a)}</text>`;
});
series.forEach((s, k) => {
  const c = s.color || colors[k];
  const ps = axes.map((_, i) =>
    pt(i, (R * Math.min(max, Math.max(0, Number(s.values?.[i]) || 0))) / max),
  );
  out += `<path d="${ps.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("")}Z" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="${sw * 1.3}" stroke-linejoin="round"/>`;
  for (const p of ps)
    out += `<circle cx="${p.x}" cy="${p.y}" r="${sw * 1.6}" fill="${c}"/>`;
});
if (series.length > 1) {
  const items = series.map((s) => measure(s.label, size * 0.85) + size * 2);
  let x = cx - items.reduce((a, b) => a + b, 0) / 2;
  series.forEach((s, k) => {
    out += `<rect class="plain" x="${x}" y="${H - size * 1.1}" width="${size * 0.9}" height="${size * 0.9}" rx="2" fill="${s.color || colors[k]}"/><text x="${x + size * 1.3}" y="${H - size * 0.65}" font-size="${size * 0.85}" fill="${ink}">${esc(s.label)}</text>`;
    x += items[k];
  });
}
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
