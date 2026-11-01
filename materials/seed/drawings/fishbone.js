// A fishbone (cause and effect) diagram: the effect in a head at the right, a spine
// running to it, and slanted bones for the categories of cause above and below, each with
// its causes written on short ribs. For root-cause analysis.
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
const head = String(d.problem ?? "");
const causes = (d.causes || []).map((c) =>
  typeof c === "string" ? { label: c } : c,
);
const hw = Math.min(W * 0.24, measure(head, size * 1.05, 700) + size * 2.4),
  hh = Math.min(H * 0.3, size * 3.4);
const cy = H / 2,
  x0 = size,
  x1 = W - hw;
const color = d.color || accent;
let out = `<path d="M${x0} ${cy}H${x1}" stroke="${ink}" stroke-width="${sw * 2}" stroke-linecap="round"/>`;
out += `<path d="M${x1} ${cy - hh / 2}H${W - hh * 0.3}Q${W} ${cy - hh / 2} ${W} ${cy}Q${W} ${cy + hh / 2} ${W - hh * 0.3} ${cy + hh / 2}H${x1}Z" fill="${color}" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>`;
out += `<text x="${x1 + (hw - hh * 0.15) / 2}" y="${cy}" text-anchor="middle" font-size="${size * 1.05}" font-weight="700" fill="${paper}">${esc(head)}</text>`;
const top = causes.filter((_, i) => i % 2 === 0),
  bottom = causes.filter((_, i) => i % 2 === 1);
const cols = Math.max(top.length, bottom.length, 1);
const span = (x1 - x0 - size) / cols;
const reach = H / 2 - size * 1.6;
const slant = reach * 0.5;
[top, bottom].forEach((row, side) => {
  const s = side ? 1 : -1;
  row.forEach((c, i) => {
    const bx = x0 + span * (i + 1) + size * 0.5,
      tx = bx - slant,
      ty = cy + s * reach;
    out += `<path d="M${tx} ${ty}L${bx} ${cy}" stroke="${muted}" stroke-width="${sw * 1.4}" stroke-linecap="round"/>`;
    out += `<text x="${tx}" y="${ty + s * size * 0.9}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${ink}">${esc(c.label)}</text>`;
    const items = (c.items || []).map(String);
    items.forEach((it, j) => {
      const f = (j + 1) / (items.length + 1);
      const px = tx + (bx - tx) * f,
        py = ty + (cy - ty) * f;
      const len = Math.min(span * 0.55, measure(it, size * 0.82) + size * 0.6);
      out += `<path class="plain" d="M${px} ${py}H${px - len}" stroke="${muted}" stroke-width="1"/>`;
      out += `<text x="${px - size * 0.3}" y="${py - s * size * 0.55}" text-anchor="end" font-size="${size * 0.82}" fill="${ink}">${esc(it)}</text>`;
    });
  });
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
