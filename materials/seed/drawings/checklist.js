// A checklist: items in rows with ticked or open boxes (or numbers or bullets), done
// items softened and struck through, each with an optional note. For requirements,
// to-dos, criteria and key points.
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
const items = (d.items || []).map((it) =>
  typeof it === "string" ? { label: it } : it,
);
const marker = d.marker || "check";
const row = H / Math.max(1, items.length);
const bs = Math.min(size * 1.25, row * 0.7);
const color = d.color || accent;
let out = "";
items.forEach((it, i) => {
  const y = row * (i + 0.5);
  const cx = bs / 2 + sw;
  if (marker === "check") {
    out += `<rect x="${sw}" y="${y - bs / 2}" width="${bs}" height="${bs}" rx="${bs * 0.22}" fill="${it.done ? color : paper}" stroke="${it.done ? color : muted}" stroke-width="${sw}"/>`;
    if (it.done)
      out += `<path d="M${cx - bs * 0.26} ${y + bs * 0.02}l${bs * 0.18} ${bs * 0.2}l${bs * 0.34} ${-bs * 0.4}" fill="none" stroke="${paper}" stroke-width="${Math.max(1.6, bs * 0.13)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (marker === "number") {
    out += `<circle cx="${cx}" cy="${y}" r="${bs / 2}" fill="${color}"/><text x="${cx}" y="${y}" text-anchor="middle" font-size="${bs * 0.6}" font-weight="700" fill="${paper}">${i + 1}</text>`;
  } else
    out += `<circle cx="${cx}" cy="${y}" r="${bs * 0.2}" fill="${color}"/>`;
  const tx = bs + sw + size * 0.7;
  const ty = it.note ? y - size * 0.5 : y;
  const done = marker === "check" && it.done;
  out += `<text x="${tx}" y="${ty}" font-size="${size}" fill="${done ? muted : ink}"${it.accent ? ' font-weight="700"' : ""}${done && d.strike !== false ? ' text-decoration="line-through"' : ""}>${esc(it.label)}</text>`;
  if (it.note)
    out += `<text x="${tx}" y="${ty + size * 1.25}" font-size="${size * 0.82}" fill="${muted}">${esc(it.note)}</text>`;
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
