// A sequence diagram: participants across the top with dashed lifelines, and messages as
// arrows between them in time order, replies dashed with open heads, a message to oneself
// as a loop. Drawn in the style instead of a generic renderer.
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
const actors = (d.actors || []).map((a) =>
  typeof a === "string" ? { label: a } : a,
);
const n = Math.max(1, actors.length);
const msgs = d.messages || [];
const bw = Math.min(
    W / n - size,
    Math.max(...actors.map((a) => measure(a.label, size, 600)), size * 3) +
      size * 2,
  ),
  bh = size * 2.4;
const X = (i) => (W * (i + 0.5)) / n;
const index = (name) => {
  const i = actors.findIndex((a) => a.label === name);
  return i < 0 ? Number(name) || 0 : i;
};
const top = bh,
  row = (H - bh - size * 1.2) / (msgs.length + 0.6);
let out = "";
actors.forEach((a, i) => {
  out += `<path class="plain" d="M${X(i)} ${top}V${H}" stroke="${muted}" stroke-width="1" stroke-dasharray="4 4"/>`;
  out += `<rect x="${X(i) - bw / 2}" y="${sw / 2}" width="${bw}" height="${bh}" rx="${Math.min(8, bh / 3)}" fill="${a.accent ? accent : accent2}" fill-opacity=".14" stroke="${a.accent ? accent : accent2}" stroke-width="${sw}"/>`;
  out += `<text x="${X(i)}" y="${bh / 2}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${ink}">${esc(a.label)}</text>`;
});
const hl = Math.max(7, sw * 4.5),
  hw = hl * 0.42;
msgs.forEach((m, k) => {
  const y = top + row * (k + 0.9);
  const a = index(m.from),
    b = index(m.to);
  const c = m.accent ? accent : ink;
  const dash = m.reply ? ` stroke-dasharray="${sw * 3} ${sw * 2.5}"` : "";
  if (a === b) {
    const x = X(a),
      w = Math.min(W / n / 2.5, size * 3);
    out += `<path d="M${x} ${y - row * 0.2}H${x + w}V${y + row * 0.2}H${x + hl}" fill="none" stroke="${c}" stroke-width="${sw}"${dash}/>`;
    out += `<path d="M${x} ${y + row * 0.2}l${hl} ${-hw}v${hw * 2}z" fill="${c}"/>`;
    out += `<text x="${x + w + size * 0.4}" y="${y}" font-size="${size * 0.88}" fill="${c}">${esc(m.label)}</text>`;
    return;
  }
  const s = Math.sign(X(b) - X(a));
  const xa = X(a),
    xb = X(b) - s * 2;
  out += `<path d="M${xa} ${y}H${xb - (m.reply ? 0 : s * hl * 0.7)}" stroke="${c}" stroke-width="${sw}"${dash}/>`;
  out += m.reply
    ? `<path d="M${xb - s * hl} ${y - hw}L${xb} ${y}L${xb - s * hl} ${y + hw}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
    : `<path d="M${xb} ${y}l${-s * hl} ${-hw}v${hw * 2}z" fill="${c}"/>`;
  out += `<text x="${(xa + xb) / 2}" y="${y - size * 0.75}" text-anchor="middle" font-size="${size * 0.88}" fill="${c}" paint-order="stroke" stroke="${paper}" stroke-width="4" stroke-linejoin="round">${esc((d.numbered ? k + 1 + ". " : "") + (m.label ?? ""))}</text>`;
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
