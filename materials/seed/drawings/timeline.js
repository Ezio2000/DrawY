// A time axis with events: ticks on the line, dates beside it, names alternating above and
// below so neighbours never collide. Events can carry `note` and `accent`.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const size = Number(d.size ?? 14);
const events = (d.events || []).map((e) => ({ ...e, at: Number(e.at) }));
const lo = Number(d.from ?? Math.min(...events.map((e) => e.at)));
const hi = Number(d.to ?? Math.max(...events.map((e) => e.at)));
const span = hi - lo || 1;
const x0 = size * 2,
  x1 = W - size * 2.5,
  y = H / 2;
const X = (v) => x0 + ((v - lo) / span) * (x1 - x0);
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
events.forEach((e, i) => {
  const x = X(e.at),
    up = i % 2 === 0,
    c = e.accent ? accent : ink;
  const stem = size * (2.2 + (e.note ? 0.6 : 0));
  const ty = up ? y - stem : y + stem;
  out += `<line x1="${x}" x2="${x}" y1="${y}" y2="${up ? ty + size * 0.6 : ty - size * 0.9}" stroke="${muted}" stroke-width="1"/>`;
  out += `<circle cx="${x}" cy="${y}" r="${e.accent ? 5 : 3.6}" fill="${e.accent ? accent : t.paper || "#fff"}" stroke="${c}" stroke-width="1.6"/>`;
  out += `<text x="${x}" y="${up ? y + size * 1.5 : y - size * 0.8}" text-anchor="middle" font-size="${size * 0.85}" fill="${muted}">${esc(e.date ?? e.at)}</text>`;
  out += `<text x="${x}" y="${up ? ty : ty + size * 0.2}" text-anchor="middle" font-size="${size}" font-weight="600" fill="${c}">${esc(e.label ?? "")}</text>`;
  if (e.note)
    out += `<text x="${x}" y="${up ? ty - size * 1.25 : ty + size * 1.4}" text-anchor="middle" font-size="${size * 0.82}" fill="${muted}">${esc(e.note)}</text>`;
});
return api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(t.font || "system-ui")}">${out}</svg>`,
);
