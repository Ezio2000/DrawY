// A time axis with events: ticks on the line, dates beside it, names alternating above and
// below so neighbours never collide. Events can carry `note` and `accent`.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const size = Number(d.size ?? 14);
const font = t.font || "system-ui";
const ctx = document.createElement("canvas").getContext("2d");
const measure = (s, px, weight = 400) => {
  ctx.font = `${weight} ${px}px ${font}`;
  return ctx.measureText(String(s ?? "")).width;
};
const events = (d.events || []).map((e) => ({ ...e, at: Number(e.at) }));
const even = d.scale === "even";
const lo = Number(d.from ?? Math.min(...events.map((e) => e.at)));
const hi = Number(d.to ?? Math.max(...events.map((e) => e.at)));
const span = hi - lo || 1;
const x0 = size * 2.5,
  x1 = W - size * 3,
  y = H / 2;
const X = (e, i) =>
  even
    ? events.length > 1
      ? x0 + (i / (events.length - 1)) * (x1 - x0)
      : (x0 + x1) / 2
    : x0 + ((e.at - lo) / span) * (x1 - x0);
const ink = t.ink || "#222",
  muted = t.muted || "#888",
  accent = t.accent || "#d97757";
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
let out = `<path d="M${x0 - size} ${y}H${x1 + size * 1.2}" stroke="${ink}" stroke-width="${Number(t.stroke ?? 1.6)}" stroke-linecap="round"/>`;
out += `<path d="M${x1 + size * 1.9} ${y}l${-size * 0.9} ${-size * 0.4}v${size * 0.8}z" fill="${ink}"/>`;
// Track occupied horizontal ranges per side and tier so clustered events stagger cleanly.
const used = { up: [-Infinity, -Infinity], down: [-Infinity, -Infinity] };
const dateUsed = { up: -Infinity, down: -Infinity };
events.forEach((e, i) => {
  const x = X(e, i),
    up = i % 2 === 0,
    side = up ? "up" : "down",
    c = e.accent ? accent : ink;
  const tw = Math.max(
    measure(e.label ?? "", size, 600),
    e.note ? measure(e.note, size * 0.82) : 0,
  );
  const left = x - tw / 2 - size * 0.4,
    right = x + tw / 2 + size * 0.4;
  const tier = left < used[side][0] ? 1 : 0;
  used[side][tier] = Math.max(used[side][tier], right);
  const baseStem = size * (2.2 + (e.note ? 0.6 : 0));
  const stem = baseStem + tier * size * (e.note ? 2.8 : 1.9);
  const ty = up ? y - stem : y + stem;
  out += `<line x1="${x}" x2="${x}" y1="${y}" y2="${up ? ty + size * 0.6 : ty - size * 0.9}" stroke="${muted}" stroke-width="1"/>`;
  out += `<circle cx="${x}" cy="${y}" r="${e.accent ? 5 : 3.6}" fill="${e.accent ? accent : t.paper || "#fff"}" stroke="${c}" stroke-width="1.6"/>`;
  const dateStr = String(e.date ?? e.at);
  const dw = measure(dateStr, size * 0.85);
  const dSide = up ? "down" : "up";
  const dShift = x - dw / 2 - size * 0.25 < dateUsed[dSide] ? size * 1.05 : 0;
  dateUsed[dSide] = Math.max(dateUsed[dSide], x + dw / 2 + size * 0.25);
  out += `<text x="${x}" y="${up ? y + size * 1.5 + dShift : y - size * 0.8 - dShift}" text-anchor="middle" font-size="${size * 0.85}" fill="${muted}">${esc(dateStr)}</text>`;
  out += `<text x="${x}" y="${up ? ty : ty + size * 0.2}" text-anchor="middle" font-size="${size}" font-weight="600" fill="${c}">${esc(e.label ?? "")}</text>`;
  if (e.note)
    out += `<text x="${x}" y="${up ? ty - size * 1.25 : ty + size * 1.4}" text-anchor="middle" font-size="${size * 0.82}" fill="${muted}">${esc(e.note)}</text>`;
});
return api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}">${out}</svg>`,
);
