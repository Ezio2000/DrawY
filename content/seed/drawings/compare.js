// A comparison table: options as columns, criteria as rows. A yes or no shows as a tick
// or a dash, other values as words; one column can be highlighted as the recommended or
// subject option. Rules between rows only, no grid, so it reads as a figure.
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
  accent = t.accent || "#d97757";
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 14);
const columns = (d.columns || []).map(String);
const rows = (d.rows || []).map((r) =>
  Array.isArray(r) ? { label: r[0], values: r.slice(1) } : r,
);
const lit = Number(d.highlight ?? -1);
const labelW = Math.min(
  W * 0.36,
  Math.max(size * 4, ...rows.map((r) => measure(r.label, size, 600))) +
    size * 1.6,
);
const cols = Math.max(1, columns.length);
const colW = (W - labelW) / cols;
const headH = size * 2.8;
const rowH = (H - headH) / Math.max(1, rows.length);
const cx = (j) => labelW + colW * (j + 0.5);
let out = "";
if (lit >= 0 && lit < cols)
  out += `<rect x="${labelW + colW * lit + size * 0.2}" y="${sw / 2}" width="${colW - size * 0.4}" height="${H - sw}" rx="${Math.min(12, colW / 6)}" fill="${accent}" fill-opacity=".1" stroke="${accent}" stroke-width="${sw}"/>`;
if (d.corner)
  out += `<text x="${size * 0.6}" y="${headH / 2}" font-size="${size * 0.85}" fill="${muted}">${esc(d.corner)}</text>`;
columns.forEach((c, j) => {
  out += `<text x="${cx(j)}" y="${headH / 2}" text-anchor="middle" font-size="${size * 1.05}" font-weight="700" fill="${j === lit ? accent : ink}">${esc(c)}</text>`;
});
out += `<path d="M0 ${headH}H${W}" stroke="${ink}" stroke-width="${sw}"/>`;
const tick = (x, y, c) =>
  `<path d="M${x - size * 0.45} ${y}l${size * 0.32} ${size * 0.34}l${size * 0.6} ${-size * 0.72}" fill="none" stroke="${c}" stroke-width="${sw * 1.4}" stroke-linecap="round" stroke-linejoin="round"/>`;
rows.forEach((r, i) => {
  const y = headH + rowH * (i + 0.5);
  if (i)
    out += `<path d="M0 ${headH + rowH * i}H${W}" stroke="${muted}" stroke-opacity=".35" stroke-width="1"/>`;
  out += `<text x="${size * 0.6}" y="${y}" font-size="${size}" font-weight="600" fill="${ink}">${esc(r.label)}</text>`;
  (r.values || []).slice(0, cols).forEach((v, j) => {
    const c = j === lit ? accent : ink;
    if (v === true || v === "✓") out += tick(cx(j), y, c);
    else if (v === false || v === "✗" || v === null || v === "")
      out += `<path d="M${cx(j) - size * 0.35} ${y}h${size * 0.7}" stroke="${muted}" stroke-width="${sw * 1.2}" stroke-linecap="round"/>`;
    else {
      const s = String(v),
        fs = Math.min(size, (size * (colW - size)) / (measure(s, size) || 1));
      out += `<text x="${cx(j)}" y="${y}" text-anchor="middle" font-size="${Math.max(size * 0.7, fs)}" fill="${c}">${esc(s)}</text>`;
    }
  });
});
return api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}" dominant-baseline="central">${out}</svg>`,
);
