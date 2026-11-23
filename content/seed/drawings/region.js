// An area that marks a zone or a group. As a blob it is a soft organic area (a habitat, a
// layer, a field of influence) drawn without a box; as a box it is a tidy rounded frame
// around modules (a host, a network, a subsystem, a boundary), named in its top-left
// corner. Place it under the modules it holds.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const box = d.shape === "box";
const color = d.color || t.accent2 || t.accent || "#8eaebd";
const size = Number(d.size ?? 15);
const font = t.font || "system-ui";
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const opacity = Number(d.opacity ?? (box ? 0.06 : 0.18));
const outline = d.outline ?? box;
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const texture = d.effect ? ` filter="${api.effect(d.effect)}"` : "";
let shape;
if (box) {
  const r = Math.min(Number(d.radius ?? 12), W / 4, H / 4);
  shape = `<rect x="${sw / 2}" y="${sw / 2}" width="${W - sw}" height="${H - sw}" rx="${r}" fill="${color}" fill-opacity="${opacity}"${texture}${outline ? ` stroke="${color}" stroke-width="${sw}" stroke-dasharray="${d.dashed === false ? "none" : `${sw * 4} ${sw * 3}`}"` : ""}/>`;
} else {
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
  shape = `<path d="${path}Z" fill="${color}" fill-opacity="${opacity}"${texture}${outline ? ` stroke="${color}" stroke-width="1.3" stroke-dasharray="5 4"` : ""}/>`;
}
const at = d.labelAt ?? (box ? "corner" : "center");
const labelColor = d.labelColor || (box ? color : t.ink || "#222");
const label = d.label
  ? at === "corner"
    ? `<text x="${size * 0.8}" y="${size * 1.2}" dominant-baseline="central" font-size="${size}" font-weight="600" fill="${labelColor}">${esc(d.label)}</text>`
    : `<text x="${W / 2}" y="${at === "top" ? size * 1.6 : H / 2}" text-anchor="middle" dominant-baseline="central" font-size="${size}" fill="${labelColor}" fill-opacity=".85">${esc(d.label)}</text>`
  : "";
return api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(font)}">
  ${shape}${label}
</svg>`);
