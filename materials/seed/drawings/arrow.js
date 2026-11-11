// A line between two things with a mark at either end, sized to the line. As a link it
// follows api.route, which the scene works out for all its links together: a curve between
// the ends, or right-angled turns that go round whatever stands between. In a module it runs
// between data.from and data.to. The marks are an arrowhead (filled or open), the hollow
// triangle and diamonds of UML, and the bars, rings and feet of entity-relationship notation.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const w = Number(d.width ?? t.stroke ?? 1.6);
const color = d.color || t.ink || "#333";
const paper = t.paper || "#fff";
const at = (p, fallback) => (p ? { x: p.x * W, y: p.y * H } : fallback);
const route = api.route;
const kind = route?.kind ?? (d.route === "elbow" || d.route === "corner" ? "elbow" : "curve");
const head = d.head ?? "filled";
const tail = d.tail ?? (d.both ? head : "none");
const hl = Math.max(7, w * 4.2),
  hw = hl * 0.42;
const away = (p, q) => {
  const l = Math.hypot(p.x - q.x, p.y - q.y) || 1;
  return { x: (p.x - q.x) / l, y: (p.y - q.y) / l };
};
const back = (p, dir, by) => ({ x: p.x - dir.x * by, y: p.y - dir.y * by });
// Each mark is drawn in its own frame: x back along the line from the tip, y across it.
// `pull` is how far the line stops short of the tip, so it does not show through the mark.
const marks = {
  none: { pull: 0, draw: () => "" },
  filled: {
    pull: hl * 0.7,
    draw: (P) =>
      `<path d="M${P(0, 0)}L${P(hl, hw)}L${P(hl * 0.78, 0)}L${P(hl, -hw)}Z" fill="${color}" stroke="${color}" stroke-width="${w * 0.5}" stroke-linejoin="round"/>`,
  },
  open: {
    pull: 0,
    draw: (P) =>
      `<path d="M${P(hl, hw)}L${P(0, 0)}L${P(hl, -hw)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  triangle: {
    pull: hl * 1.15,
    draw: (P) =>
      `<path d="M${P(0, 0)}L${P(hl * 1.15, hw * 1.35)}L${P(hl * 1.15, -hw * 1.35)}Z" fill="${paper}" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"/>`,
  },
  diamond: {
    pull: hl * 1.6,
    draw: (P) =>
      `<path d="M${P(0, 0)}L${P(hl * 0.8, hw)}L${P(hl * 1.6, 0)}L${P(hl * 0.8, -hw)}Z" fill="${paper}" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"/>`,
  },
  "diamond-filled": {
    pull: hl * 1.6,
    draw: (P) =>
      `<path d="M${P(0, 0)}L${P(hl * 0.8, hw)}L${P(hl * 1.6, 0)}L${P(hl * 0.8, -hw)}Z" fill="${color}" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"/>`,
  },
  circle: {
    pull: hw * 2,
    draw: (P) =>
      `<circle cx="${P(hw, 0).split(" ")[0]}" cy="${P(hw, 0).split(" ")[1]}" r="${hw}" fill="${paper}" stroke="${color}" stroke-width="${w}"/>`,
  },
  dot: {
    pull: 0,
    draw: (P) =>
      `<circle cx="${P(hw * 0.8, 0).split(" ")[0]}" cy="${P(hw * 0.8, 0).split(" ")[1]}" r="${hw * 0.8}" fill="${color}"/>`,
  },
};
// Entity-relationship ends: a bar is one, a foot is many, a ring is zero.
const bar = (P, x) =>
  `<path d="M${P(x, hw * 1.2)}L${P(x, -hw * 1.2)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
const foot = (P) =>
  `<path d="M${P(0, hw * 1.25)}L${P(hl, 0)}L${P(0, -hw * 1.25)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const ring = (P, x) => {
  const [cx, cy] = P(x, 0).split(" ");
  return `<circle cx="${cx}" cy="${cy}" r="${hw * 0.85}" fill="${paper}" stroke="${color}" stroke-width="${w}"/>`;
};
Object.assign(marks, {
  one: { pull: 0, draw: (P) => bar(P, hl * 0.7) },
  "only-one": { pull: 0, draw: (P) => bar(P, hl * 0.55) + bar(P, hl * 1.0) },
  many: { pull: 0, draw: (P) => foot(P) },
  "one-many": { pull: 0, draw: (P) => foot(P) + bar(P, hl * 1.3) },
  "zero-one": { pull: 0, draw: (P) => bar(P, hl * 0.6) + ring(P, hl * 1.35) },
  "zero-many": { pull: 0, draw: (P) => foot(P) + ring(P, hl * 1.5) },
});
const markAt = (name, p, dir) => {
  const m = marks[name] ?? marks.filled;
  // dir points along the line into the tip.
  const P = (x, y) => `${p.x - dir.x * x - dir.y * y} ${p.y - dir.y * x + dir.x * y}`;
  return m.draw(P);
};
const pullOf = (name) => (marks[name] ?? marks.filled).pull;
// An arrowhead stops a little short of what it points at; a mark of notation (a diamond, a
// foot, a bar) sits on the edge of the thing it belongs to.
const gapOf = (name) =>
  name === "filled" || name === "open" || name === "none" ? Number(d.gap ?? 6) : 0;

// end and start point out of the line at each end; a and b are the tips.
let line, end, start, a, b, labelAt, normal;
if (kind === "elbow") {
  let pts;
  if (route) pts = route.points.map((p) => ({ ...p }));
  else {
    // In a module there is nothing to go round: one or two turns between the two points.
    const p = at(d.from, { x: 0, y: H / 2 }),
      q = at(d.to, { x: W, y: H / 2 });
    const level = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y);
    const k = 0.5 + Number(d.bend ?? 0);
    pts =
      d.route === "corner"
        ? [p, level ? { x: q.x, y: p.y } : { x: p.x, y: q.y }, q]
        : level
          ? [p, { x: p.x + (q.x - p.x) * k, y: p.y }, { x: p.x + (q.x - p.x) * k, y: q.y }, q]
          : [p, { x: p.x, y: p.y + (q.y - p.y) * k }, { x: q.x, y: p.y + (q.y - p.y) * k }, q];
    pts = pts.filter((v, i) => !i || Math.hypot(v.x - pts[i - 1].x, v.y - pts[i - 1].y) > 0.5);
    if (pts.length < 2) pts = [p, q];
  }
  const n = pts.length;
  end = away(pts[n - 1], pts[n - 2]);
  start = away(pts[0], pts[1]);
  const first = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
    last = Math.hypot(pts[n - 1].x - pts[n - 2].x, pts[n - 1].y - pts[n - 2].y);
  a = pts[0] = back(pts[0], start, Math.min(gapOf(tail), first / 3));
  b = pts[n - 1] = back(pts[n - 1], end, Math.min(gapOf(head), last / 3));
  const drawn = [...pts];
  drawn[n - 1] = back(b, end, Math.min(pullOf(head), last * 0.6));
  drawn[0] = back(a, start, Math.min(pullOf(tail), first * 0.6));
  // Corners rounded by up to radius, never more than half of either segment.
  const r = Number(d.radius ?? 8);
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
  if (route?.label) labelAt = route.label;
  else {
    // Without a place found for them, the words sit beside the longest stretch.
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
    labelAt = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    normal = { x: -(q.y - p.y) / l, y: (q.x - p.x) / l };
  }
} else if (kind === "smooth" && route) {
  // One sweep that leaves and arrives square to the sides it meets.
  const out = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  let p = route.points[0],
    q = route.points[route.points.length - 1];
  const far = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y);
  const da = out[api.fromSide] ?? (far ? [Math.sign(q.x - p.x) || 1, 0] : [0, Math.sign(q.y - p.y) || 1]),
    db = out[api.toSide] ?? [-da[0], -da[1]];
  start = { x: -da[0], y: -da[1] };
  end = { x: -db[0], y: -db[1] };
  a = back(p, start, -Math.min(gapOf(tail), 3));
  b = back(q, end, Math.min(gapOf(head), 3));
  const a2 = back(a, start, -pullOf(tail)),
    b2 = back(b, end, pullOf(head));
  const reach = Math.max(18, (Math.abs(da[0] ? q.x - p.x : q.y - p.y) || Math.hypot(q.x - p.x, q.y - p.y)) * 0.5);
  const c1 = { x: a2.x + da[0] * reach, y: a2.y + da[1] * reach },
    c2 = { x: b2.x + db[0] * reach, y: b2.y + db[1] * reach };
  line = `M${a2.x} ${a2.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b2.x} ${b2.y}`;
  labelAt = { x: (a2.x + 3 * c1.x + 3 * c2.x + b2.x) / 8, y: (a2.y + 3 * c1.y + 3 * c2.y + b2.y) / 8 };
} else {
  a = api.from ?? at(d.from, { x: 0, y: H / 2 });
  b = api.to ?? at(d.to, { x: W, y: H / 2 });
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len,
    uy = (b.y - a.y) / len;
  const ga = Math.min(gapOf(tail), len / 4),
    gb = Math.min(gapOf(head), len / 4);
  a = { x: a.x + ux * ga, y: a.y + uy * ga };
  b = { x: b.x - ux * gb, y: b.y - uy * gb };
  const bend = kind === "straight" ? 0 : Number(d.bend ?? 0) * len;
  const c = {
    x: (a.x + b.x) / 2 - uy * bend,
    y: (a.y + b.y) / 2 + ux * bend,
  };
  end = away(b, c);
  start = away(a, c);
  const b2 = back(b, end, pullOf(head));
  const a2 = back(a, start, pullOf(tail));
  line = `M${a2.x} ${a2.y}Q${c.x} ${c.y} ${b2.x} ${b2.y}`;
  labelAt = { x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4 };
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
  const size = Number(d.size ?? 16);
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
    );
  const lines = String(d.label).split("\n");
  let x = labelAt.x,
    y = labelAt.y,
    anchor = "middle";
  if (normal) {
    let n = normal;
    const above = (d.labelSide ?? "above") === "above";
    if ((n.y > 0.2 || (Math.abs(n.y) <= 0.2 && n.x > 0)) === above)
      n = { x: -n.x, y: -n.y };
    // Beside an upright line the words start at the line, as they are wider than they are tall.
    const upright = Math.abs(n.x) > 0.8;
    const off = upright ? size * 0.5 + w : size * 0.9 + w;
    x += n.x * off;
    y += n.y * off;
    anchor = upright ? (n.x > 0 ? "start" : "end") : "middle";
  }
  y -= ((lines.length - 1) * size * 1.3) / 2;
  label = lines
    .map(
      (words, i) =>
        `<text x="${x}" y="${y + i * size * 1.3}" text-anchor="${anchor}" dominant-baseline="central" font-size="${size}" fill="${d.labelColor || color}" font-family="${esc(t.font || "system-ui")}" paint-order="stroke" stroke="${paper}" stroke-width="${Math.max(4, size * 0.4)}" stroke-linejoin="round">${esc(words)}</text>`,
    )
    .join("");
}
return api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible">${flow}
  <path class="${d.flow ? "flow" : ""}" d="${line}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dash}"/>
  ${markAt(head, b, end)}${markAt(tail, a, start)}${label}
</svg>`);
