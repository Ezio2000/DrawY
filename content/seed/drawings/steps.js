// A process as numbered steps on a track: circles joined by a line, each name beside its
// number and an optional note. Steps before `current` are done (filled), the current one
// is ringed, later ones wait in outline. Runs across or down.
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
const hex = (c) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const mix = (a, b, k) => {
  const p = hex(a),
    q = hex(b);
  if (!p || !q) return k < 0.5 ? a : b;
  return (
    "#" +
    p
      .map((v, i) =>
        Math.round(v + (q[i] - v) * k)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
};
// Distinct colours from the style: accent, accent2, then blends of them with ink.
const palette = (n) =>
  Array.from(
    { length: n },
    (_, i) =>
      [
        accent,
        accent2,
        mix(accent, ink, 0.45),
        mix(accent2, ink, 0.45),
        mix(accent, accent2, 0.5),
        muted,
      ][i % 6],
  );
const steps = (d.steps || []).map((s) =>
  typeof s === "string" ? { label: s } : s,
);
const n = Math.max(1, steps.length);
const cur = Number(d.current ?? -1);
const down = d.direction === "column";
const r = Number(d.radius ?? size * 1.25);
const color = d.color || accent;
const at = (i) =>
  down
    ? {
        x: r + sw,
        y: n > 1 ? r + sw + ((H - 2 * r - 2 * sw) * i) / (n - 1) : H / 2,
      }
    : { x: (W * (i + 0.5)) / n, y: r + sw };
const arrow = !!d.arrow;
const ah = Math.max(5, sw * 3.2);
let out = "";
for (let i = 0; i + 1 < n; i++) {
  const a = at(i),
    b = at(i + 1);
  const done = cur >= 0 && i < cur;
  const lc = done ? steps[i].color || color : cur < 0 ? steps[i].color || color : muted;
  const dash = done || cur < 0 ? "" : ` stroke-dasharray="${sw * 2} ${sw * 3}"`;
  if (down) {
    const y0 = a.y + r + 4,
      y1 = b.y - r - 4;
    out += `<path d="M${a.x} ${y0}V${arrow ? y1 - ah : y1}" stroke="${lc}" stroke-width="${sw * 1.4}" stroke-linecap="round"${dash}/>`;
    if (arrow)
      out += `<path class="plain" d="M${a.x} ${y1}l${-ah * 0.55} ${-ah}h${ah * 1.1}z" fill="${lc}"/>`;
  } else {
    const x0 = a.x + r + 4,
      x1 = b.x - r - 4;
    out += `<path d="M${x0} ${a.y}H${arrow ? x1 - ah : x1}" stroke="${lc}" stroke-width="${sw * 1.4}" stroke-linecap="round"${dash}/>`;
    if (arrow)
      out += `<path class="plain" d="M${x1} ${a.y}l${-ah} ${-ah * 0.55}v${ah * 1.1}z" fill="${lc}"/>`;
  }
}
steps.forEach((s, i) => {
  const p = at(i);
  const path = api.path("steps", s, i);
  const sc = s.color || color;
  const state =
    cur < 0 ? "plain" : i < cur ? "done" : i === cur ? "current" : "todo";
  const fill = state === "todo" ? paper : sc;
  let item = "";
  if (state === "current")
    item += `<circle cx="${p.x}" cy="${p.y}" r="${r + 5}" fill="none" stroke="${sc}" stroke-opacity=".35" stroke-width="${sw * 2}"/>`;
  item += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="${state === "todo" ? muted : sc}" stroke-width="${sw}"/>`;
  // A number the step gives is its data; otherwise it is its place, drawn by the drawing.
  item += `<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="${r * 0.95}" font-weight="700" fill="${state === "todo" ? muted : paper}"${s.number != null ? api.text(path + ".number") : ""}>${esc(s.number ?? i + 1)}</text>`;
  const lx = down ? p.x + r + size * 0.9 : p.x,
    ly = down ? p.y - (s.note ? size * 0.55 : 0) : p.y + r + size * 1.3;
  const anchor = down ? "start" : "middle";
  // A step written as words alone is those words; a record names them by label.
  const words = typeof (d.steps || [])[i] === "string" ? path : path + ".label";
  item += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="${size * 1.05}" font-weight="600" fill="${state === "todo" ? muted : ink}"${api.text(words)}>${esc(s.label)}</text>`;
  if (s.note)
    item += `<text x="${lx}" y="${ly + size * 1.35}" text-anchor="${anchor}" font-size="${size * 0.82}" fill="${muted}"${api.text(path + ".note")}>${esc(s.note)}</text>`;
  out += `<g${api.part(path, { reorder: down ? "y" : "x" })}>${item}</g>`;
});
// Before each step, and after the last, a new one can go.
for (let i = 0; i <= steps.length; i++) {
  const a = at(Math.max(0, i - 1)),
    b = at(Math.min(steps.length - 1, i));
  const gap = down ? (n > 1 ? (H - 2 * r) / (n - 1) / 2 : r * 2) : W / n / 2;
  const mid = i === 0 ? (down ? { x: b.x, y: b.y - gap } : { x: b.x - gap, y: b.y }) : i === steps.length ? (down ? { x: a.x, y: a.y + gap } : { x: a.x + gap, y: a.y }) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (steps.length) api.slot("steps", i, { x: Math.max(4, Math.min(W - 4, mid.x)), y: Math.max(4, Math.min(H - 4, mid.y)) });
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
