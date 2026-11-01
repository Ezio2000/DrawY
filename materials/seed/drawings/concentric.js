// Concentric rings, innermost first: a core and the layers around it (a cell, the
// circles of a model, from self to society, golden circle). The core is accent, the rings
// accent2 growing paler outwards; each name sits at the top of its own band, the core's in its
// middle. Bottom-aligned circles stack like nested bubbles instead.
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
const rings = (d.rings || []).map((r) =>
  typeof r === "string" ? { label: r } : r,
);
const n = Math.max(1, rings.length);
const R = Math.min(W, H) / 2 - sw;
const bottom = d.align === "bottom";
const cx = W / 2;
let out = "";
// Solid tints over paper, so overlapping rings never muddy each other: the core in
// accent, the rings in accent2 growing paler outwards.
for (let i = n - 1; i >= 0; i--) {
  const r = (R * (i + 1)) / n;
  const cy = bottom ? H - sw - r : H / 2;
  const base =
    rings[i].color || (i === 0 ? d.color || accent : d.color2 || accent2);
  const k = i === 0 ? 0.55 : 0.12 + (0.3 * (n - 1 - i)) / Math.max(1, n - 1);
  out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${mix(paper, base, k)}" stroke="${base}" stroke-width="${sw}"/>`;
}
rings.forEach((g, i) => {
  const r = (R * (i + 1)) / n,
    inner = (R * i) / n;
  const cy = H / 2;
  // The core's name in its middle; each ring's in the band it adds above the one inside.
  const band = bottom
    ? (H - sw - 2 * r + (H - sw - 2 * inner)) / 2
    : cy - (r + inner) / 2;
  const ty =
    (i === 0 ? (bottom ? H - sw - r : cy) : band) - (g.note ? size * 0.5 : 0);
  out += `<text x="${cx}" y="${ty}" text-anchor="middle" font-size="${i === 0 ? size * 1.1 : size}" font-weight="700" fill="${ink}">${esc(g.label)}</text>`;
  if (g.note)
    out += `<text x="${cx}" y="${ty + size * 1.2}" text-anchor="middle" font-size="${size * 0.8}" fill="${ink}" fill-opacity=".7">${esc(g.note)}</text>`;
});
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
