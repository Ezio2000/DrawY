// Levels stacked as a pyramid (a hierarchy of needs, a food chain, the share of a whole
// that narrows upwards) or as a funnel (stages that narrow downwards, such as conversion).
// Bands shade from accent to accent2; notes stand to the right on leader lines.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
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
const ink = t.ink || "#222",
  paper = t.paper || "#fff",
  muted = t.muted || "#888";
const from = d.color || t.accent || "#d97757",
  to = d.color2 || t.accent2 || muted;
const solid = (d.fillStyle ?? "solid") === "solid";
const size = Number(d.size ?? 15);
const funnel = d.shape === "funnel";
const levels = (d.levels || []).map((l) =>
  typeof l === "string" ? { label: l } : l,
);
const n = Math.max(1, levels.length);
const noted = levels.some((l) => l.note);
const SW = noted ? W * 0.6 : W,
  cx = SW / 2;
const gap = size * 0.3;
const bandH = (H - gap * (n - 1)) / n;
// Half width of the shape at height y: a pyramid from a small flat apex, a funnel to its
// spout.
const half = (y) =>
  funnel ? (SW / 2) * (1 - (y / H) * 0.78) : (SW / 2) * (0.06 + 0.94 * (y / H));
const ctx = document.createElement("canvas").getContext("2d");
const fit = (s, room) => {
  ctx.font = `600 ${size}px ${t.font || "system-ui"}`;
  const w = ctx.measureText(String(s ?? "")).width || 1;
  return Math.max(size * 0.6, Math.min(size, (size * room) / w));
};
let out = "";
levels.forEach((l, i) => {
  const ya = i * (bandH + gap),
    yb = ya + bandH;
  const c = mix(from, to, n > 1 ? i / (n - 1) : 0);
  const a = half(ya),
    b = half(yb);
  out += `<path d="M${cx - a} ${ya}L${cx + a} ${ya}L${cx + b} ${yb}L${cx - b} ${yb}Z" fill="${c}" fill-opacity="${solid ? 1 : 0.18}" stroke="${c}" stroke-width="${solid ? 0 : 1.4}" stroke-linejoin="round"/>`;
  const ym = (ya + yb) / 2;
  // Text in the narrow top of a pyramid sits low, where the band is widest.
  const ty = funnel || i ? ym : ya + bandH * 0.68;
  out += `<text x="${cx}" y="${ty}" text-anchor="middle" font-size="${fit(l.label, half(ty) * 2 - size * 0.8)}" font-weight="600" fill="${solid ? paper : ink}">${esc(l.label)}</text>`;
  if (l.note) {
    const edge = cx + half(ym);
    out += `<path class="leader" d="M${edge + size * 0.5} ${ym}H${SW + size * 1.2}" stroke="${muted}" stroke-width="1" stroke-dasharray="2 3"/><circle class="leader" cx="${edge + size * 0.5}" cy="${ym}" r="2" fill="${muted}"/>`;
    out += `<text x="${SW + size * 1.6}" y="${ym}" font-size="${size * 0.88}" fill="${ink}">${esc(l.note)}</text>`;
  }
});
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(t.font || "system-ui")}" dominant-baseline="central">${out}</svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll("path:not(.leader)"))
    el.setAttribute("filter", fx);
}
return svg;
