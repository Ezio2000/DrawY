// A numbered badge that marks reading order or a step on a path.
const d = api.data,
  t = api.theme;
const s = Math.min(api.width, api.height);
const color = d.color || t.accent || "#d97757";
const filled = d.filled !== false;
const n = String(d.number ?? 1);
return api.svg(`<svg viewBox="0 0 ${s} ${s}" width="${api.width}" height="${api.height}">
  <circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 1.5}" fill="${filled ? color : t.paper || "#fff"}" stroke="${color}" stroke-width="1.5"/>
  <text x="${s / 2}" y="${s / 2}" text-anchor="middle" dominant-baseline="central" font-size="${s * (n.length > 1 ? 0.46 : 0.56)}" font-weight="600" fill="${filled ? "#fff" : color}" font-family="${t.font || "system-ui"}">${n.replace(/[<&]/g, "")}</text>
</svg>`);
