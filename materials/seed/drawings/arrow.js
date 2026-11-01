// An arrow with a head sized to its line, between api.from and api.to (as a link) or
// between data.from and data.to (normalized points of the module). It runs as a curve
// (straight unless bent), or at right angles as flowcharts do: elbow leaves and arrives
// along the sides its anchors face, corner turns once.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const w = Number(d.width ?? t.stroke ?? 1.6);
const color = d.color || t.ink || "#333";
const at = (p, fallback) => (p ? { x: p.x * W, y: p.y * H } : fallback);
let a = api.from ?? at(d.from, { x: 0, y: H / 2 });
let b = api.to ?? at(d.to, { x: W, y: H / 2 });
const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
const ux = (b.x - a.x) / len,
  uy = (b.y - a.y) / len;
const head = d.head ?? "filled";
const hl = Math.max(7, w * 4.2),
  hw = hl * 0.42;
const away = (p, q) => {
  const l = Math.hypot(p.x - q.x, p.y - q.y) || 1;
  return { x: (p.x - q.x) / l, y: (p.y - q.y) / l };
};
const tip = (p, dir) => {
  const back = { x: p.x - dir.x * hl, y: p.y - dir.y * hl };
  const side = { x: -dir.y * hw, y: dir.x * hw };
  if (head === "open")
    return `<path d="M${back.x + side.x} ${back.y + side.y}L${p.x} ${p.y}L${back.x - side.x} ${back.y - side.y}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const notch = { x: p.x - dir.x * hl * 0.78, y: p.y - dir.y * hl * 0.78 };
  return `<path d="M${p.x} ${p.y}L${back.x + side.x} ${back.y + side.y}L${notch.x} ${notch.y}L${back.x - side.x} ${back.y - side.y}Z" fill="${color}" stroke="${color}" stroke-width="${w * 0.5}" stroke-linejoin="round"/>`;
};
// The line stops inside a filled head instead of poking through its point.
const pull = head === "filled" ? hl * 0.7 : 0;
const back = (p, dir, by) => ({ x: p.x - dir.x * by, y: p.y - dir.y * by });
const route = d.route ?? "curve";
// end and start point out of the line at each end; mid and normal place the label.
let line, end, start, mid, normal;
if (route === "elbow" || route === "corner") {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  // Each end runs along the side its anchor faces, else along the given or longer axis.
  const axis = (side) =>
    side === "left" || side === "right"
      ? "h"
      : side === "top" || side === "bottom"
        ? "v"
        : null;
  const other = (x) => (x === "h" ? "v" : "h");
  const given =
    d.first === "horizontal" ? "h" : d.first === "vertical" ? "v" : null;
  const leave =
    given ??
    axis(api.fromSide) ??
    axis(api.toSide) ??
    (Math.abs(dx) >= Math.abs(dy) ? "h" : "v");
  const arrive =
    route === "corner"
      ? other(leave)
      : given
        ? leave
        : (axis(api.toSide) ?? leave);
  const k = 0.5 + Number(d.bend ?? 0);
  // Leaving and arriving along one axis takes a cross segment; along both, one turn.
  let pts =
    leave !== arrive
      ? [a, leave === "h" ? { x: b.x, y: a.y } : { x: a.x, y: b.y }, b]
      : leave === "h"
        ? [a, { x: a.x + dx * k, y: a.y }, { x: a.x + dx * k, y: b.y }, b]
        : [a, { x: a.x, y: a.y + dy * k }, { x: b.x, y: a.y + dy * k }, b];
  // Ends already in line need no turn: repeated points and straight-through ones go.
  const kept = [];
  for (const p of pts) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) kept.push(p);
    else if (p === b) kept[kept.length - 1] = p;
  }
  pts = kept.filter((p, i) => {
    if (i === 0 || i === kept.length - 1) return true;
    const q = kept[i - 1],
      r = kept[i + 1];
    return (
      Math.abs((p.x - q.x) * (r.y - p.y) - (p.y - q.y) * (r.x - p.x)) > 0.5
    );
  });
  if (pts.length < 2) pts = [a, b];
  const n = pts.length;
  end = away(pts[n - 1], pts[n - 2]);
  start = away(pts[0], pts[1]);
  const first = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
    last = Math.hypot(pts[n - 1].x - pts[n - 2].x, pts[n - 1].y - pts[n - 2].y);
  const gap = Math.min(Number(d.gap ?? 6), first / 3, last / 3);
  pts[0] = back(pts[0], start, gap);
  pts[n - 1] = back(pts[n - 1], end, gap);
  a = pts[0];
  b = pts[n - 1];
  const drawn = [...pts];
  if (head !== "none") drawn[n - 1] = back(b, end, pull);
  if (d.both && head !== "none") drawn[0] = back(a, start, pull);
  // Corners rounded by up to radius, never more than half of either segment.
  const r = Number(d.radius ?? 10);
  line = `M${drawn[0].x} ${drawn[0].y}`;
  for (let i = 1; i < n - 1; i++) {
    const p = drawn[i],
      inn = away(drawn[i - 1], p),
      out = away(drawn[i + 1], p);
    const lin = Math.hypot(p.x - drawn[i - 1].x, p.y - drawn[i - 1].y),
      lout = Math.hypot(drawn[i + 1].x - p.x, drawn[i + 1].y - p.y);
    const rr = Math.min(r, lin / 2, lout / 2);
    line += `L${p.x + inn.x * rr} ${p.y + inn.y * rr}Q${p.x} ${p.y} ${p.x + out.x * rr} ${p.y + out.y * rr}`;
  }
  line += `L${drawn[n - 1].x} ${drawn[n - 1].y}`;
  // The label sits beside the longest segment.
  let best = 1;
  for (let i = 1; i < n; i++)
    if (
      Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) >
      Math.hypot(pts[best].x - pts[best - 1].x, pts[best].y - pts[best - 1].y)
    )
      best = i;
  const p = pts[best - 1],
    q = pts[best],
    l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  normal = { x: -(q.y - p.y) / l, y: (q.x - p.x) / l };
} else {
  const gap = Math.min(Number(d.gap ?? 6), len / 4);
  a = { x: a.x + ux * gap, y: a.y + uy * gap };
  b = { x: b.x - ux * gap, y: b.y - uy * gap };
  const bend = Number(d.bend ?? 0) * len;
  const c = {
    x: (a.x + b.x) / 2 - uy * bend,
    y: (a.y + b.y) / 2 + ux * bend,
  };
  end = away(b, c);
  start = away(a, c);
  const b2 = head === "none" ? b : back(b, end, pull);
  const a2 = d.both && head !== "none" ? back(a, start, pull) : a;
  line = `M${a2.x} ${a2.y}Q${c.x} ${c.y} ${b2.x} ${b2.y}`;
  mid = { x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4 };
  normal = { x: -uy, y: ux };
}
const dash = d.flow
  ? `${w * 3} ${w * 2.6}`
  : d.dashed
    ? `${w * 4} ${w * 3}`
    : "none";
const flow = d.flow
  ? `<style>@keyframes flow{to{stroke-dashoffset:${-w * 5.6 * 4}}}.flow{animation:flow ${Number(d.speed ?? 1.2)}s linear infinite}</style>`
  : "";
let label = "";
if (d.label) {
  const size = Number(d.size ?? 14);
  const m = mid;
  let n = normal;
  const above = (d.labelSide ?? "above") === "above";
  if ((n.y > 0.2 || (Math.abs(n.y) <= 0.2 && n.x > 0)) === above)
    n = { x: -n.x, y: -n.y };
  const off = size * 0.9 + w;
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
    );
  label = `<text x="${m.x + n.x * off}" y="${m.y + n.y * off}" text-anchor="middle" dominant-baseline="central" font-size="${size}" fill="${d.labelColor || color}" font-family="${esc(t.font || "system-ui")}" paint-order="stroke" stroke="${t.paper || "#fff"}" stroke-width="4" stroke-linejoin="round">${esc(d.label)}</text>`;
}
return api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible">${flow}
  <path class="${d.flow ? "flow" : ""}" d="${line}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dash}"/>
  ${head === "none" ? "" : tip(b, end)}${d.both && head !== "none" ? tip(a, start) : ""}${label}
</svg>`);
