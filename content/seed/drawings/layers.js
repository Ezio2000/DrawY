// Stacked layers, top to bottom: a software architecture, a protocol stack, the tiers of
// an organisation or a system. Each band names its layer on the left, with an optional
// note, and lays its parts out as chips across the rest; a band without parts centres its
// name. A layer can be accented.
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
const tone = d.color || t.accent2 || accent;
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.8);
const size = Number(d.size ?? 14);
const layers = d.layers || [];
const n = Math.max(1, layers.length);
const gap = size * 0.5;
const bandH = (H - gap * (n - 1)) / n;
const labelW =
  Number(d.labelWidth) ||
  Math.min(
    W * 0.32,
    Math.max(
      ...layers.map((l) =>
        Math.max(measure(l.label, size, 600), measure(l.note, size * 0.8)),
      ),
      size * 4,
    ) +
      size * 2,
  );
const r = Math.min(12, bandH / 3);
let out = "";
layers.forEach((l, i) => {
  const path = api.path("layers", l, i);
  const y = i * (bandH + gap);
  api.slot("layers", i, { x: W / 2, y: Math.max(2, y - gap / 2) });
  if (i === layers.length - 1) api.slot("layers", layers.length, { x: W / 2, y: H - 2 });
  const c = l.accent ? accent : tone;
  const items = (l.items || []).map(String);
  let band = "";
  out += `<g${api.part(path, { reorder: "y" })}>`;
  band += `<rect x="${sw / 2}" y="${y}" width="${W - sw}" height="${bandH}" rx="${r}" fill="${c}" fill-opacity="${l.accent ? 0.16 : i % 2 ? 0.07 : 0.11}"${l.accent ? ` stroke="${c}" stroke-width="${sw}"` : ""}/>`;
  const cx = items.length ? size * 1.1 : W / 2;
  const anchor = items.length ? "start" : "middle";
  const ty = y + bandH / 2 - (l.note ? size * 0.5 : 0);
  band += `<text x="${cx}" y="${ty}" text-anchor="${anchor}" font-size="${size}" font-weight="600" fill="${l.accent ? accent : ink}"${api.text(path + ".label")}>${esc(l.label)}</text>`;
  if (l.note)
    band += `<text x="${cx}" y="${ty + size * 1.25}" text-anchor="${anchor}" font-size="${size * 0.8}" fill="${muted}"${api.text(path + ".note")}>${esc(l.note)}</text>`;
  out += band;
  // A layer without items takes its first after its words.
  if (!items.length) {
    api.slot(path + ".items", 0, { x: W - size * 1.2, y: y + bandH / 2 });
    out += "</g>";
    return;
  }
  // Chips share the rest of the band evenly; long words shrink rather than spill.
  const x0 = labelW,
    x1 = W - size * 0.7,
    cg = size * 0.6;
  const cw = (x1 - x0 - cg * (items.length - 1)) / items.length;
  const ch = Math.min(bandH - size * 1.1, size * 2.6);
  items.forEach((item, j) => {
    const x = x0 + j * (cw + cg);
    const fs = Math.max(
      size * 0.7,
      Math.min(
        size * 0.92,
        (size * 0.92 * (cw - size)) / (measure(item, size * 0.92) || 1),
      ),
    );
    const chip = `${path}.items.${j}`;
    out += `<g${api.part(chip, { reorder: "x" })}><rect x="${x}" y="${y + (bandH - ch) / 2}" width="${cw}" height="${ch}" rx="${Math.min(8, ch / 3)}" fill="${paper}" stroke="${c}" stroke-opacity=".7" stroke-width="${sw}"/>`;
    out += `<text x="${x + cw / 2}" y="${y + bandH / 2}" text-anchor="middle" font-size="${fs}" fill="${ink}"${api.text(chip)}>${esc(item)}</text></g>`;
    api.slot(path + ".items", j, { x: x - cg / 2, y: y + bandH / 2 });
  });
  api.slot(path + ".items", items.length, { x: x1 + size * 0.35, y: y + bandH / 2 });
  out += "</g>";
});
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}" dominant-baseline="central">${out}</svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll("rect,circle,path"))
    el.setAttribute("filter", fx);
}
return svg;
