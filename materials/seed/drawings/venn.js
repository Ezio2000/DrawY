// Two or three overlapping sets: what each has alone and what they share. Each circle is
// tinted with its own colour so the overlaps deepen; names sit in the part that belongs
// to that set alone, and the shared part can be named too.
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
  muted = t.muted || "#888";
const colors = [t.accent || "#d97757", t.accent2 || "#4f7c8a", muted];
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 15);
const sets = (d.sets || [])
  .slice(0, 3)
  .map((s) => (typeof s === "string" ? { label: s } : s));
const three = sets.length >= 3;
let r, centres;
if (three) {
  r = Math.min(W / 3.3, H / 3.1);
  const cy = H / 2 + r * 0.12,
    o = r * 0.62;
  centres = [
    { x: W / 2 - o, y: cy - o * 0.55 },
    { x: W / 2 + o, y: cy - o * 0.55 },
    { x: W / 2, y: cy + o * 0.6 },
  ];
} else {
  r = Math.min(H / 2 - sw, W / 3.3);
  centres = [
    { x: W / 2 - r * 0.6, y: H / 2 },
    { x: W / 2 + r * 0.6, y: H / 2 },
  ];
}
const mid = {
  x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
  y: centres.reduce((s, c) => s + c.y, 0) / centres.length,
};
let shapes = "",
  words = "";
sets.forEach((s, i) => {
  const c = centres[i],
    col = s.color || colors[i];
  shapes += `<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="${col}" fill-opacity=".2" stroke="${col}" stroke-width="${sw}"/>`;
  // Away from the shared middle, into the part that is this set's alone.
  const dx = c.x - mid.x,
    dy = c.y - mid.y,
    l = Math.hypot(dx, dy) || 1;
  const p = { x: c.x + (dx / l) * r * 0.42, y: c.y + (dy / l) * r * 0.42 };
  const ty = s.note ? p.y - size * 0.55 : p.y;
  words += `<text x="${p.x}" y="${ty}" font-size="${size * 1.05}" font-weight="700" fill="${ink}">${esc(s.label)}</text>`;
  if (s.note)
    words += `<text x="${p.x}" y="${ty + size * 1.3}" font-size="${size * 0.82}" fill="${muted}">${esc(s.note)}</text>`;
});
if (d.overlap)
  words += `<text x="${mid.x}" y="${mid.y}" font-size="${size * 0.9}" font-weight="600" fill="${ink}">${esc(d.overlap)}</text>`;
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(t.font || "system-ui")}"><g style="mix-blend-mode:multiply">${shapes}</g><g text-anchor="middle" dominant-baseline="central">${words}</g></svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll("rect,circle,path"))
    el.setAttribute("filter", fx);
}
return svg;
