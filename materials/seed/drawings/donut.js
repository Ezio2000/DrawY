// Parts of a whole as a donut (or a pie with hole 0): each slice in its own style colour,
// named outside on a short leader with its share, and the total or a headline in the
// middle. For budgets, compositions and survey answers.
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
const items = (d.items || []).map((it) =>
  Array.isArray(it) ? { label: it[0], value: it[1] } : it,
);
const total =
  items.reduce((s, i) => s + Math.max(0, Number(i.value) || 0), 0) || 1;
const colors = palette(items.length);
const labelled = d.labels !== false;
const R = Math.min(
  W / 2 - (labelled ? size * 7 : sw),
  H / 2 - (labelled ? size * 1.8 : sw),
);
const hole = Math.min(0.9, Math.max(0, Number(d.hole ?? 0.58)));
const cx = W / 2,
  cy = H / 2;
const pt = (a, r) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
let out = "",
  a0 = -Math.PI / 2;
items.forEach((it, i) => {
  const share = Math.max(0, Number(it.value) || 0) / total;
  if (!share) return;
  const a1 = a0 + share * Math.PI * 2;
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const c = it.color || colors[i];
  if (share >= 0.9999)
    out += `<circle cx="${cx}" cy="${cy}" r="${(R * (1 + hole)) / 2}" fill="none" stroke="${c}" stroke-width="${R * (1 - hole) || R}"/>`;
  else {
    const p0 = pt(a0, R),
      p1 = pt(a1, R),
      q1 = pt(a1, R * hole),
      q0 = pt(a0, R * hole);
    out += `<path d="M${p0.x} ${p0.y}A${R} ${R} 0 ${big} 1 ${p1.x} ${p1.y}${hole ? `L${q1.x} ${q1.y}A${R * hole} ${R * hole} 0 ${big} 0 ${q0.x} ${q0.y}` : `L${cx} ${cy}`}Z" fill="${c}" stroke="${paper}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  if (labelled) {
    const am = (a0 + a1) / 2,
      right = Math.cos(am) >= 0;
    const e = pt(am, R + 4),
      k = pt(am, R + size * 1.2);
    const tx = k.x + (right ? size * 0.9 : -size * 0.9);
    out += `<path class="plain" d="M${e.x} ${e.y}L${k.x} ${k.y}H${tx + (right ? -size * 0.3 : size * 0.3)}" fill="none" stroke="${muted}" stroke-width="1"/>`;
    out += `<text x="${tx}" y="${k.y - size * 0.45}" text-anchor="${right ? "start" : "end"}" font-size="${size}" font-weight="600" fill="${ink}">${esc(it.label)}</text>`;
    out += `<text x="${tx}" y="${k.y + size * 0.65}" text-anchor="${right ? "start" : "end"}" font-size="${size * 0.82}" fill="${muted}">${esc(it.note ?? Math.round(share * 100) + "%")}</text>`;
  }
  a0 = a1;
});
if (hole && d.center)
  out += `<text x="${cx}" y="${cy - (d.centerNote ? size * 0.55 : 0)}" text-anchor="middle" font-size="${Math.min(size * 1.9, ((R * hole * 1.4) / Math.max(1, String(d.center).length)) * 1.6)}" font-weight="700" fill="${ink}">${esc(d.center)}</text>`;
if (hole && d.centerNote)
  out += `<text x="${cx}" y="${cy + size * 1.15}" text-anchor="middle" font-size="${size * 0.82}" fill="${muted}">${esc(d.centerNote)}</text>`;
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
