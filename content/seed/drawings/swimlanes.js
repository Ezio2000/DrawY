// Swimlanes: parallel bands, one per actor, team or system, each named in a header, so a
// cross-functional process can be laid over them with node modules and arrow links. The
// lanes are the background; place the steps as their own modules on top.
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
const lanes = (d.lanes || []).map((l) =>
  typeof l === "string" ? { label: l } : l,
);
const n = Math.max(1, lanes.length);
const across = d.direction !== "vertical";
const head =
  Number(d.header) ||
  (across
    ? Math.min(
        W * 0.25,
        Math.max(size * 4, ...lanes.map((l) => measure(l.label, size, 600))) +
          size * 2,
      )
    : size * 3);
const r = Math.min(10, size * 0.7);
let out = `<rect x="${sw / 2}" y="${sw / 2}" width="${W - sw}" height="${H - sw}" rx="${r}" fill="none" stroke="${muted}" stroke-opacity=".6" stroke-width="${sw}"/>`;
lanes.forEach((l, i) => {
  const c = l.accent ? accent : accent2;
  const x = across ? 0 : (W * i) / n,
    y = across ? (H * i) / n : 0,
    w = across ? W : W / n,
    h = across ? H / n : H;
  if (i % 2 === 0 || l.accent)
    out += `<rect class="plain" x="${x + sw}" y="${y + sw}" width="${w - 2 * sw}" height="${h - 2 * sw}" fill="${c}" fill-opacity="${l.accent ? 0.1 : 0.05}"/>`;
  if (i)
    out += across
      ? `<path d="M0 ${y}H${W}" stroke="${muted}" stroke-opacity=".6" stroke-width="${sw}"/>`
      : `<path d="M${x} 0V${H}" stroke="${muted}" stroke-opacity=".6" stroke-width="${sw}"/>`;
  out += across
    ? `<rect x="${sw}" y="${y + sw}" width="${head - sw}" height="${h - 2 * sw}" fill="${c}" fill-opacity=".14"/><text x="${head / 2}" y="${y + h / 2 - (l.note ? size * 0.5 : 0)}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${l.accent ? accent : ink}">${esc(l.label)}</text>`
    : `<rect x="${x + sw}" y="${sw}" width="${w - 2 * sw}" height="${head - sw}" fill="${c}" fill-opacity=".14"/><text x="${x + w / 2}" y="${head / 2 - (l.note ? size * 0.5 : 0)}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${l.accent ? accent : ink}">${esc(l.label)}</text>`;
  if (l.note)
    out += across
      ? `<text x="${head / 2}" y="${y + h / 2 + size * 0.8}" text-anchor="middle" font-size="${size * 0.8}" fill="${muted}">${esc(l.note)}</text>`
      : `<text x="${x + w / 2}" y="${head / 2 + size * 0.8}" text-anchor="middle" font-size="${size * 0.8}" fill="${muted}">${esc(l.note)}</text>`;
});
out += across
  ? `<path d="M${head} 0V${H}" stroke="${muted}" stroke-opacity=".6" stroke-width="${sw}"/>`
  : `<path d="M0 ${head}H${W}" stroke="${muted}" stroke-opacity=".6" stroke-width="${sw}"/>`;
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
