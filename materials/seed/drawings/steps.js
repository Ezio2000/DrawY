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
let out = "";
for (let i = 0; i + 1 < n; i++) {
  const a = at(i),
    b = at(i + 1);
  const done = cur >= 0 && i < cur;
  out += down
    ? `<path d="M${a.x} ${a.y + r + 4}V${b.y - r - 4}" stroke="${done ? color : muted}" stroke-width="${sw * 1.4}" stroke-linecap="round"${done || cur < 0 ? "" : ` stroke-dasharray="${sw * 2} ${sw * 3}"`}/>`
    : `<path d="M${a.x + r + 4} ${a.y}H${b.x - r - 4}" stroke="${done ? color : muted}" stroke-width="${sw * 1.4}" stroke-linecap="round"${done || cur < 0 ? "" : ` stroke-dasharray="${sw * 2} ${sw * 3}"`}/>`;
}
steps.forEach((s, i) => {
  const p = at(i);
  const state =
    cur < 0 ? "plain" : i < cur ? "done" : i === cur ? "current" : "todo";
  const fill = state === "todo" ? paper : state === "plain" ? color : color;
  if (state === "current")
    out += `<circle cx="${p.x}" cy="${p.y}" r="${r + 5}" fill="none" stroke="${color}" stroke-opacity=".35" stroke-width="${sw * 2}"/>`;
  out += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="${state === "todo" ? muted : color}" stroke-width="${sw}"/>`;
  out += `<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="${r * 0.95}" font-weight="700" fill="${state === "todo" ? muted : paper}">${esc(s.number ?? i + 1)}</text>`;
  const lx = down ? p.x + r + size * 0.9 : p.x,
    ly = down ? p.y - (s.note ? size * 0.55 : 0) : p.y + r + size * 1.3;
  const anchor = down ? "start" : "middle";
  out += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="${size * 1.05}" font-weight="600" fill="${state === "todo" ? muted : ink}">${esc(s.label)}</text>`;
  if (s.note)
    out += `<text x="${lx}" y="${ly + size * 1.35}" text-anchor="${anchor}" font-size="${size * 0.82}" fill="${muted}">${esc(s.note)}</text>`;
});
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
