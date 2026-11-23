// A gauge: a half-ring scale from min to max with the value filled in and a needle,
// the number in the middle and coloured zones if given. For a reading on a scale: speed,
// temperature, a score, a progress percentage.
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
const min = Number(d.min ?? 0),
  max = Number(d.max ?? 100);
const value = Math.min(max, Math.max(min, Number(d.value ?? 0)));
const k = (v) => (Math.min(max, Math.max(min, v)) - min) / (max - min || 1);
const cx = W / 2;
const R = Math.min(W / 2 - size * 1.5, H - size * 3.6);
const cy = size * 1.2 + R;
const th = Math.max(size * 0.9, R * 0.16);
const angle = (f) => Math.PI + f * Math.PI;
const pt = (f, r) => ({
  x: cx + r * Math.cos(angle(f)),
  y: cy + r * Math.sin(angle(f)),
});
const arc = (f0, f1, c, op = 1) => {
  const a = pt(f0, R - th / 2),
    b = pt(f1, R - th / 2);
  return `<path d="M${a.x} ${a.y}A${R - th / 2} ${R - th / 2} 0 0 1 ${b.x} ${b.y}" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="${th}" stroke-linecap="butt"/>`;
};
const color = d.color || accent;
let out = arc(0, 1, muted, 0.18);
for (const z of d.zones || [])
  out += arc(k(Number(z.from)), k(Number(z.to)), z.color || accent2, 0.35);
if (k(value) > 0) out += arc(0, k(value), color);
// Ticks at the ends and middle.
for (const f of [0, 0.5, 1]) {
  const p = pt(f, R + size * 0.9);
  out += `<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="${size * 0.78}" fill="${muted}">${esc(min + (max - min) * f)}</text>`;
}
const tip = pt(k(value), R - th - 4);
out += `<path d="M${cx} ${cy}L${tip.x} ${tip.y}" stroke="${ink}" stroke-width="${sw * 1.6}" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="${size * 0.45}" fill="${ink}"/>`;
out += `<text x="${cx}" y="${cy + size * 1.9}" text-anchor="middle" font-size="${size * 1.9}" font-weight="700" fill="${ink}">${esc(d.display ?? value)}<tspan font-size="${size}" font-weight="400" fill="${muted}">${esc(d.unit ?? "")}</tspan></text>`;
if (d.label)
  out += `<text x="${cx}" y="${cy + size * 3.4}" text-anchor="middle" font-size="${size}" fill="${muted}">${esc(d.label)}</text>`;
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
