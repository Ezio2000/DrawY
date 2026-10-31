// Curved arrows running round a circle: the shape of any cycle (water, life, seasons,
// feedback). Step i sits at angle start + i·360/n degrees on the circle, so pictures of the
// stages can be placed there as their own modules; labels are optional.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const steps = Array.isArray(d.steps)
  ? d.steps
  : Array.from({ length: Number(d.steps ?? 4) }, () => "");
const n = Math.max(2, steps.length);
const color = d.color || t.accent || t.ink || "#333";
const w = Number(d.width ?? Number(t.stroke ?? 1.6) * 1.4);
const cx = W / 2,
  cy = H / 2;
const size = Number(d.size ?? 15);
const r =
  Math.min(W, H) / 2 -
  (steps.some(Boolean) && d.labels !== "inside" ? size * 2.6 : w * 4);
const start = (Number(d.start ?? -90) * Math.PI) / 180;
const dir = d.clockwise === false ? -1 : 1;
const gap = (Number(d.gap ?? 16) * Math.PI) / 180;
const hl = Math.max(8, w * 4),
  hw = hl * 0.45;
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const at = (a, rr = r) => ({
  x: cx + rr * Math.cos(a),
  y: cy + rr * Math.sin(a),
});
let out = "";
for (let i = 0; i < n; i++) {
  const a0 = start + dir * ((i * 2 * Math.PI) / n + gap / 2);
  const a1 = start + dir * (((i + 1) * 2 * Math.PI) / n - gap / 2);
  // Stop the arc where the head begins.
  const a1line = a1 - (dir * (hl * 0.7)) / r;
  const p0 = at(a0),
    p1 = at(a1line),
    tip = at(a1);
  out += `<path d="M${p0.x} ${p0.y}A${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${p1.x} ${p1.y}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  const tx = -Math.sin(a1) * dir,
    ty = Math.cos(a1) * dir;
  const back = { x: tip.x - tx * hl, y: tip.y - ty * hl };
  out += `<path d="M${tip.x} ${tip.y}L${back.x - ty * hw} ${back.y + tx * hw}L${tip.x - tx * hl * 0.75} ${tip.y - ty * hl * 0.75}L${back.x + ty * hw} ${back.y - tx * hw}Z" fill="${color}"/>`;
  const label = steps[i];
  if (label) {
    const a = start + (dir * i * 2 * Math.PI) / n;
    const p = at(a, d.labels === "inside" ? r - size * 1.8 : r + size * 1.5);
    const anchor =
      Math.abs(Math.cos(a)) < 0.3
        ? "middle"
        : Math.cos(a) > 0 === (d.labels !== "inside")
          ? "start"
          : "end";
    out += `<text x="${p.x}" y="${p.y}" text-anchor="${anchor}" dominant-baseline="central" font-size="${size}" fill="${t.ink || "#222"}" paint-order="stroke" stroke="${t.paper || "#fff"}" stroke-width="4" stroke-linejoin="round">${esc(label)}</text>`;
  }
}
return api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(t.font || "system-ui")}">${out}</svg>`,
);
