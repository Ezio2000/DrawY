// A schedule as a Gantt chart: tasks in rows with names on the left and rounded bars from
// start to end on a shared time axis; a task can be accented, done ones fade, a milestone
// (end equal to start) is a diamond, and a "now" line can mark today.
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
const tasks = d.tasks || [];
const lo = Number(d.from ?? Math.min(...tasks.map((x) => Number(x.start))));
const hi = Number(
  d.to ?? Math.max(...tasks.map((x) => Number(x.end ?? x.start))),
);
const lw = Math.min(
  W * 0.3,
  Math.max(...tasks.map((x) => measure(x.label, size)), size * 3) + size * 1.4,
);
const axisH = size * 2;
const x0 = lw,
  x1 = W - size * 0.5;
const X = (v) => x0 + ((Number(v) - lo) / (hi - lo || 1)) * (x1 - x0);
const row = (H - axisH) / Math.max(1, tasks.length),
  bh = Math.min(row * 0.56, size * 1.8);
const color = d.color || accent2;
// Ticks given are the data's, each its words; otherwise whole numbers after the unit.
const given = Array.isArray(d.ticks);
const ticks = given
  ? d.ticks
  : Array.from({ length: Math.floor(hi - lo) + 1 }, (_, i) => ({ at: lo + i })).filter(
      (_, i, all) => all.length <= 13 || i % Math.ceil(all.length / 12) === 0,
    );
let out = "";
ticks.forEach((tk, i) => {
  const x = X(tk.at);
  out += `<path class="plain" d="M${x} ${axisH}V${H}" stroke="${muted}" stroke-opacity=".25" stroke-width="1"/>`;
  const words = given
    ? `<tspan${api.text(api.path("ticks", tk, i) + ".label")}>${esc(tk.label)}</tspan>`
    : `${d.unit ? `<tspan${api.text("unit")}>${esc(d.unit)}</tspan>` : ""}${esc(tk.at)}`;
  out += `<text x="${x}" y="${axisH / 2}" text-anchor="middle" font-size="${size * 0.8}" fill="${muted}">${words}</text>`;
});
out += `<path d="M${x0} ${axisH}H${x1}" stroke="${ink}" stroke-width="${sw}"/>`;
// Data units per unit across, for dragging a start, an end or the now line.
const per = (hi - lo || 1) / (x1 - x0);
tasks.forEach((tk, i) => {
  const path = api.path("tasks", tk, i);
  const y = axisH + row * (i + 0.5);
  const c = tk.accent ? accent : color;
  let task = `<text x="${size * 0.3}" y="${y}" font-size="${size}" fill="${tk.done ? muted : ink}"${tk.accent ? ' font-weight="600"' : ""}${api.text(path + ".label")}>${esc(tk.label)}</text>`;
  const a = X(tk.start),
    b = X(tk.end ?? tk.start);
  if (b - a < 1) {
    const s = bh * 0.55;
    task += `<path d="M${a} ${y - s}L${a + s} ${y}L${a} ${y + s}L${a - s} ${y}Z" fill="${c}"/>`;
  } else
    task += `<rect x="${a}" y="${y - bh / 2}" width="${b - a}" height="${bh}" rx="${Math.min(bh / 2, 6)}" fill="${c}" fill-opacity="${tk.done ? 0.35 : 1}"/>`;
  out += `<g${api.part(path, { reorder: "y" })}>${task}</g>`;
  // Each end of a bar drags when it starts or ends; a milestone moves by its start.
  api.handle(path + ".start", { kind: "scalar", at: { x: a, y }, axis: "x", scale: per });
  if (tk.end != null) api.handle(path + ".end", { kind: "scalar", at: { x: b, y }, axis: "x", scale: per });
  api.slot("tasks", i, { x: lw / 2, y: axisH + row * i });
});
if (tasks.length) api.slot("tasks", tasks.length, { x: lw / 2, y: H });
if (d.now !== undefined && d.now !== null) {
  const x = X(d.now);
  out += `<path class="plain" d="M${x} ${axisH - 4}V${H}" stroke="${accent}" stroke-width="${sw}" stroke-dasharray="4 3"/><text x="${x + 4}" y="${axisH + size * 0.6}" font-size="${size * 0.75}" fill="${accent}"${d.nowLabel != null ? api.text("nowLabel") : ""}>${esc(d.nowLabel ?? "")}</text>`;
  api.handle("now", { kind: "scalar", at: { x, y: axisH - 4 }, axis: "x", scale: per });
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
