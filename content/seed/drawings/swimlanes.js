// Swimlanes: parallel bands, one per actor, team or system, each named in a header, so a
// cross-functional process can be laid over them with node modules and arrow links. With
// stages (quarters, months, phases) the lanes are crossed by columns named along the top,
// so a roadmap or plan is lanes × stages. The lanes are the background; place the steps
// and milestones as their own modules on top.
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
  muted = t.muted || "#888",
  accent = t.accent || "#d97757",
  accent2 = t.accent2 || "#4f7c8a";
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 14);
const named = (l) => (typeof l === "string" ? { label: l } : l || {});
const lanes = (d.lanes || []).map(named);
const stages = (d.stages || []).map(named);
const n = Math.max(1, lanes.length),
  m = stages.length;
const across = d.direction !== "vertical";
// The lanes' header runs along their start; the stages' header runs across the other way.
const head =
  Number(d.header) ||
  (across
    ? Math.min(
        W * 0.25,
        Math.max(size * 4, ...lanes.map((l) => measure(l.label, size, 600))) +
          size * 2,
      )
    : size * 3);
const top = m
  ? Number(d.stageHeader) ||
    (across
      ? size * (stages.some((s) => s.note) ? 3.4 : 2.6)
      : Math.min(
          W * 0.25,
          Math.max(size * 4, ...stages.map((s) => measure(s.label, size, 600))) +
            size * 2,
        ))
  : 0;
const r = Math.min(10, size * 0.7);
const laneColor = (l) => l.color || (l.accent ? accent : accent2);
// Lanes as [start, length] along the cross axis, stages along the run.
const laneAt = (i) => {
  const span = (across ? H : W) - top;
  return [top + (span * i) / n, span / n];
};
const stageAt = (j) => {
  const span = (across ? W : H) - head;
  return [head + (span * j) / m, span / m];
};
const box = (along, cross) =>
  across
    ? { x: along[0], y: cross[0], w: along[1], h: cross[1] }
    : { x: cross[0], y: along[0], w: cross[1], h: along[1] };
const line = (x1, y1, x2, y2, dash = "") =>
  `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${muted}" stroke-opacity=".6" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const words = (x, y, label, note, color, bold = true) =>
  `<text x="${x}" y="${y - (note ? size * 0.5 : 0)}" text-anchor="middle" font-size="${size}" font-weight="${bold ? 700 : 600}" fill="${color}">${esc(label)}</text>` +
  (note
    ? `<text x="${x}" y="${y + size * 0.8}" text-anchor="middle" font-size="${size * 0.8}" fill="${muted}">${esc(note)}</text>`
    : "");
let out = `<rect x="${sw / 2}" y="${sw / 2}" width="${W - sw}" height="${H - sw}" rx="${r}" fill="none" stroke="${muted}" stroke-opacity=".6" stroke-width="${sw}"/>`;
// Bands first, so the stage tints and rules lie over them.
lanes.forEach((l, i) => {
  const [c0, cl] = laneAt(i),
    c = laneColor(l),
    b = box([0, across ? W : H], [c0, cl]);
  if (i % 2 === 0 || l.accent || l.color)
    out += `<rect class="plain" x="${b.x + sw}" y="${b.y + sw}" width="${b.w - 2 * sw}" height="${b.h - 2 * sw}" fill="${c}" fill-opacity="${l.accent || l.color ? 0.1 : 0.05}"/>`;
});
stages.forEach((s, j) => {
  const [a0, al] = stageAt(j);
  if (s.accent) {
    const b = box([a0, al], [0, across ? H : W]);
    out += `<rect class="plain" x="${b.x}" y="${b.y + sw}" width="${b.w}" height="${b.h - 2 * sw}" fill="${s.color || accent}" fill-opacity=".08"/>`;
  }
});
lanes.forEach((l, i) => {
  const [c0, cl] = laneAt(i),
    c = laneColor(l);
  if (i || m)
    out += across ? line(0, c0, W, c0) : line(c0, 0, c0, H);
  const b = box([0, head], [c0, cl]);
  out += `<rect x="${b.x + sw}" y="${b.y + sw}" width="${b.w - sw}" height="${b.h - 2 * sw}" fill="${c}" fill-opacity=".14"/>`;
  out += words(b.x + b.w / 2, b.y + b.h / 2, l.label, l.note, l.accent || l.color ? c : ink);
});
stages.forEach((s, j) => {
  const [a0, al] = stageAt(j);
  if (j) out += across ? line(a0, top, a0, H, `${sw * 3} ${sw * 3}`) : line(top, a0, W, a0, `${sw * 3} ${sw * 3}`);
  const b = box([a0, al], [0, top]);
  out += words(b.x + b.w / 2, b.y + b.h / 2, s.label, s.note, s.accent ? s.color || accent : ink, false);
});
out += across ? line(head, 0, head, H) : line(0, head, W, head);
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
