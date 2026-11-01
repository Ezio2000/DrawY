// A bar chart for comparing a few quantities: rounded bars on a baseline, each value
// written at its end and each name at its foot, without a grid. An accented bar stands
// out; the rest share one colour. Upright or lying.
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
const n = Math.max(1, items.length);
const max = Number(
  d.max ?? Math.max(...items.map((i) => Number(i.value) || 0), 1),
);
const unit = d.unit ?? "";
const base = d.color || accent2;
const fmt = (v) => `${v}${unit}`;
const lying = d.orientation === "horizontal";
let out = "";
if (lying) {
  const lw = Math.min(
    W * 0.3,
    Math.max(...items.map((i) => measure(i.label, size)), size * 2) + size,
  );
  const vw =
    Math.max(...items.map((i) => measure(fmt(i.value), size * 0.9, 600))) +
    size;
  const slot = H / n,
    bh = Math.min(slot * 0.62, size * 2.4);
  out += `<path d="M${lw} 0V${H}" stroke="${ink}" stroke-width="${sw}"/>`;
  items.forEach((it, i) => {
    const y = slot * (i + 0.5),
      w = Math.max(0, ((W - lw - vw) * Number(it.value)) / max);
    const c = it.color || (it.accent ? accent : base);
    out += `<text x="${lw - size * 0.6}" y="${y}" text-anchor="end" font-size="${size}" fill="${ink}">${esc(it.label)}</text>`;
    out += `<path d="M${lw} ${y - bh / 2}H${lw + w - Math.min(6, w)}q${Math.min(6, w)} 0 ${Math.min(6, w)} ${Math.min(6, w)}V${y + bh / 2 - Math.min(6, w)}q0 ${Math.min(6, w)} ${-Math.min(6, w)} ${Math.min(6, w)}H${lw}Z" fill="${c}"/>`;
    out += `<text x="${lw + w + size * 0.5}" y="${y}" font-size="${size * 0.9}" font-weight="600" fill="${it.accent ? accent : ink}">${esc(fmt(it.value))}</text>`;
  });
} else {
  const top = size * 1.8,
    bottom = H - size * 2.2;
  const slot = W / n,
    bw = Math.min(slot * 0.58, size * 5);
  items.forEach((it, i) => {
    const x = slot * (i + 0.5),
      h = Math.max(0, ((bottom - top) * Number(it.value)) / max);
    const c = it.color || (it.accent ? accent : base);
    const rr = Math.min(6, h, bw / 2);
    out += `<path d="M${x - bw / 2} ${bottom}V${bottom - h + rr}q0 ${-rr} ${rr} ${-rr}H${x + bw / 2 - rr}q${rr} 0 ${rr} ${rr}V${bottom}Z" fill="${c}"/>`;
    out += `<text x="${x}" y="${bottom - h - size * 0.8}" text-anchor="middle" font-size="${size * 0.9}" font-weight="600" fill="${it.accent ? accent : ink}">${esc(fmt(it.value))}</text>`;
    out += `<text x="${x}" y="${bottom + size * 1.1}" text-anchor="middle" font-size="${size}" fill="${ink}">${esc(it.label)}</text>`;
  });
  out += `<path d="M0 ${bottom}H${W}" stroke="${ink}" stroke-width="${sw}"/>`;
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
