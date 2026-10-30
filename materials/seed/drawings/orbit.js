// An orbit: the ellipse filling the module, drawn as a fine path, with an optional body (a
// picture material) travelling along it. Bodies move counter-clockwise, like planets seen
// from above the north pole, unless `clockwise` is set.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const rx = W / 2 - 1,
  ry = H / 2 - 1,
  cx = W / 2,
  cy = H / 2;
const color = d.color || t.muted || "#999";
const size = Number(d.bodySize ?? 28);
const body = d.body ? api.materials[d.body] : null;
const period = Number(d.period ?? 12),
  dir = d.clockwise ? 1 : -1;
const phase = Number(d.phase ?? 0) * Math.PI * 2;
const root =
  api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible">
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-width="${Number(d.width ?? 1.1)}" ${d.dashed === false ? "" : 'stroke-dasharray="4 5"'}/>
  ${body ? `<image href="${body.url}" width="${size}" height="${size * (body.height / body.width)}" preserveAspectRatio="xMidYMid meet"/>` : ""}
</svg>`);
if (body) {
  const img = root.querySelector("image");
  const h = size * (body.height / body.width);
  const place = (a) => {
    img.setAttribute("x", String(cx + rx * Math.cos(a) - size / 2));
    img.setAttribute("y", String(cy + ry * Math.sin(a) - h / 2));
  };
  place(phase);
  if (period > 0)
    api.animate((s) => place(phase + (dir * s * Math.PI * 2) / period));
}
return root;
