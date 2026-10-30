// A soft organic area that marks a zone (a habitat, a layer, a field of influence) without
// drawing a box: a seeded irregular blob filling the module, with an optional label.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
let seed =
  Number(
    d.seed ??
      [...String(d.label ?? "region")].reduce(
        (n, c) => n * 31 + c.charCodeAt(0),
        7,
      ),
  ) >>> 0;
const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const wobble = Number(d.wobble ?? 0.08),
  n = 9;
const pts = Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2,
    k = 1 - wobble + rand() * wobble * 2;
  return {
    x: W / 2 + Math.cos(a) * (W / 2 - 4) * k,
    y: H / 2 + Math.sin(a) * (H / 2 - 4) * k,
  };
});
// Catmull-Rom through the points, closed.
let path = `M${pts[0].x} ${pts[0].y}`;
for (let i = 0; i < n; i++) {
  const p0 = pts[(i - 1 + n) % n],
    p1 = pts[i],
    p2 = pts[(i + 1) % n],
    p3 = pts[(i + 2) % n];
  path += `C${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6} ${p2.x} ${p2.y}`;
}
const color = d.color || t.accent2 || t.accent || "#8eaebd";
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const size = Number(d.size ?? 15);
const label = d.label
  ? `<text x="${W / 2}" y="${d.labelAt === "top" ? size * 1.6 : H / 2}" text-anchor="middle" dominant-baseline="central" font-size="${size}" fill="${d.labelColor || t.ink || "#222"}" fill-opacity=".85">${esc(d.label)}</text>`
  : "";
const texture = d.effect ? ` filter="${api.effect(d.effect)}"` : "";
return api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(t.font || "system-ui")}">
  <path d="${path}Z" fill="${color}" fill-opacity="${Number(d.opacity ?? 0.18)}"${texture} ${d.outline ? `stroke="${color}" stroke-width="1.3" stroke-dasharray="5 4"` : ""}/>${label}
</svg>`);
