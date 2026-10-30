// An arrow with a head sized to its line, between api.from and api.to (as a link) or
// between data.from and data.to (normalized points of the module).
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const w = Number(d.width ?? t.stroke ?? 1.6);
const color = d.color || t.ink || "#333";
const at = (p, fallback) => (p ? { x: p.x * W, y: p.y * H } : fallback);
let a = api.from ?? at(d.from, { x: 0, y: H / 2 });
let b = api.to ?? at(d.to, { x: W, y: H / 2 });
const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
const ux = (b.x - a.x) / len,
  uy = (b.y - a.y) / len;
const gap = Math.min(Number(d.gap ?? 6), len / 4);
a = { x: a.x + ux * gap, y: a.y + uy * gap };
b = { x: b.x - ux * gap, y: b.y - uy * gap };
const bend = Number(d.bend ?? 0) * len;
const c = { x: (a.x + b.x) / 2 - uy * bend, y: (a.y + b.y) / 2 + ux * bend };
const head = d.head ?? "filled";
const hl = Math.max(7, w * 4.2),
  hw = hl * 0.42;
const away = (p, q) => {
  const l = Math.hypot(p.x - q.x, p.y - q.y) || 1;
  return { x: (p.x - q.x) / l, y: (p.y - q.y) / l };
};
const tip = (p, dir) => {
  const back = { x: p.x - dir.x * hl, y: p.y - dir.y * hl };
  const side = { x: -dir.y * hw, y: dir.x * hw };
  if (head === "open")
    return `<path d="M${back.x + side.x} ${back.y + side.y}L${p.x} ${p.y}L${back.x - side.x} ${back.y - side.y}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const notch = { x: p.x - dir.x * hl * 0.78, y: p.y - dir.y * hl * 0.78 };
  return `<path d="M${p.x} ${p.y}L${back.x + side.x} ${back.y + side.y}L${notch.x} ${notch.y}L${back.x - side.x} ${back.y - side.y}Z" fill="${color}" stroke="${color}" stroke-width="${w * 0.5}" stroke-linejoin="round"/>`;
};
const end = away(b, c),
  start = away(a, c);
// The line stops inside a filled head instead of poking through its point.
const pull = head === "filled" ? hl * 0.7 : 0;
const b2 =
  head === "none" ? b : { x: b.x - end.x * pull, y: b.y - end.y * pull };
const a2 =
  d.both && head !== "none"
    ? { x: a.x - start.x * pull, y: a.y - start.y * pull }
    : a;
const dash = d.flow
  ? `${w * 3} ${w * 2.6}`
  : d.dashed
    ? `${w * 4} ${w * 3}`
    : "none";
const flow = d.flow
  ? `<style>@keyframes flow{to{stroke-dashoffset:${-w * 5.6 * 4}}}.flow{animation:flow ${Number(d.speed ?? 1.2)}s linear infinite}</style>`
  : "";
let label = "";
if (d.label) {
  const size = Number(d.size ?? 14);
  const m = { x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4 };
  let n = { x: -uy, y: ux };
  const above = (d.labelSide ?? "above") === "above";
  if ((n.y > 0.2 || (Math.abs(n.y) <= 0.2 && n.x > 0)) === above)
    n = { x: -n.x, y: -n.y };
  const off = size * 0.9 + w;
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
    );
  label = `<text x="${m.x + n.x * off}" y="${m.y + n.y * off}" text-anchor="middle" dominant-baseline="central" font-size="${size}" fill="${d.labelColor || color}" font-family="${esc(t.font || "system-ui")}" paint-order="stroke" stroke="${t.paper || "#fff"}" stroke-width="4" stroke-linejoin="round">${esc(d.label)}</text>`;
}
return api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible">${flow}
  <path class="${d.flow ? "flow" : ""}" d="M${a2.x} ${a2.y}Q${c.x} ${c.y} ${b2.x} ${b2.y}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${dash}"/>
  ${head === "none" ? "" : tip(b, end)}${d.both && head !== "none" ? tip(a, start) : ""}${label}
</svg>`);
