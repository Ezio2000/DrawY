// A hierarchy laid out as a tidy tree: an organisation, a taxonomy, a breakdown of a goal
// or a system into parts. The root is filled, its children tinted and deeper levels
// outlined; parents connect to children with rounded right-angle lines. Each node can
// carry a note and be accented. The tree spreads to fill the module.
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
const measure = (s, size, weight) => {
  ctx.font = `${weight} ${size}px ${font}`;
  return ctx.measureText(String(s ?? "")).width;
};
const ink = t.ink || "#222",
  paper = t.paper || "#fff",
  muted = t.muted || "#888",
  accent = t.accent || "#d97757",
  accent2 = t.accent2 || accent;
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 14);
const across = d.direction === "right";
const color = d.color || accent;
// Nodes with their measured boxes and depth.
const nodes = [];
const walk = (n, depth, parent) => {
  const node = {
    label: String(n?.label ?? n ?? ""),
    note: n?.note ? String(n.note) : "",
    accent: !!n?.accent,
    depth,
    parent,
    children: [],
  };
  const s = depth === 0 ? size * 1.1 : size;
  node.size = s;
  node.w =
    Math.max(
      measure(node.label, s, 600),
      node.note ? measure(node.note, s * 0.8, 400) : 0,
    ) +
    s * 1.6;
  node.h = s * (node.note ? 3.1 : 2.2);
  nodes.push(node);
  node.children = (Array.isArray(n?.children) ? n.children : []).map((c) =>
    walk(c, depth + 1, node),
  );
  return node;
};
const root = walk(d.root ?? { label: "" }, 0, null);
const depth = Math.max(...nodes.map((n) => n.depth));
// Breadth of a node and of its subtree across the direction of growth.
const breadth = (n) => (across ? n.h : n.w);
const gap = size * (across ? 0.7 : 1.2);
const span = (n) =>
  (n.span = Math.max(
    breadth(n),
    n.children.reduce((s, c) => s + span(c), 0) +
      gap * Math.max(0, n.children.length - 1),
  ));
span(root);
const place = (n, from) => {
  n.c = from + n.span / 2;
  let at =
    from +
    (n.span -
      (n.children.reduce((s, c) => s + c.span, 0) +
        gap * Math.max(0, n.children.length - 1))) /
      2;
  for (const c of n.children) {
    place(c, at);
    at += c.span + gap;
  }
};
place(root, 0);
// Spread across the module: positions scale, boxes keep their size.
const half = (n) => breadth(n) / 2;
const lo = Math.min(...nodes.map((n) => n.c - half(n))),
  hi = Math.max(...nodes.map((n) => n.c + half(n)));
const room = across ? H : W;
const sweep = hi - lo,
  k = sweep > 0 ? Math.max(0.2, (room - 2) / sweep) : 1;
for (const n of nodes) n.c = 1 + (n.c - lo) * k;
// Levels along the direction of growth, each as deep as its largest node.
const levels = Array.from({ length: depth + 1 }, (_, i) =>
  Math.max(
    ...nodes.filter((n) => n.depth === i).map((n) => (across ? n.w : n.h)),
  ),
);
const length = across ? W : H;
const free = Math.max(
  size * 1.6 * depth,
  length - levels.reduce((s, l) => s + l, 0) - 2,
);
const step = depth ? free / depth : 0;
const at = [];
let run = 1;
levels.forEach((l, i) => {
  at[i] = run + l / 2;
  run += l + step;
});
const box = (n) => {
  const cx = across ? at[n.depth] : n.c,
    cy = across ? n.c : at[n.depth];
  return { x: cx - n.w / 2, y: cy - n.h / 2, w: n.w, h: n.h, cx, cy };
};
// Relations across the branches: dashed curves between two named nodes, bowed clear of the
// straight way so they read apart from the tree's own lines.
const relations = (boxes) => {
  let drawn = "";
  for (const rel of d.relations || []) {
    const A = boxes.get(String(rel?.from)),
      B = boxes.get(String(rel?.to));
    if (!A || !B || A === B) continue;
    const ac = { x: A.x + A.w / 2, y: A.y + A.h / 2 },
      bc = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    const edge = (R, c, to) => {
      const dx = to.x - c.x,
        dy = to.y - c.y;
      const k = Math.min(
        (R.w / 2 + 4) / Math.abs(dx || 1e-6),
        (R.h / 2 + 4) / Math.abs(dy || 1e-6),
      );
      return { x: c.x + dx * k, y: c.y + dy * k };
    };
    const p = edge(A, ac, bc),
      q = edge(B, bc, ac);
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const bow = Math.min(len * 0.2, size * 3.5);
    const c = {
      x: (p.x + q.x) / 2 - ((q.y - p.y) / len) * bow,
      y: (p.y + q.y) / 2 + ((q.x - p.x) / len) * bow,
    };
    const col = rel.color || t.accent || "#d97757";
    const ul = Math.hypot(q.x - c.x, q.y - c.y) || 1;
    const ux = (q.x - c.x) / ul,
      uy = (q.y - c.y) / ul;
    const hl = size * 0.6,
      hw = hl * 0.45;
    drawn += `<path class="plain" d="M${p.x} ${p.y}Q${c.x} ${c.y} ${q.x} ${q.y}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${rel.dashed === false ? "none" : `${sw * 3.5} ${sw * 3}`}" stroke-linecap="round"/>`;
    drawn += `<path class="plain" d="M${q.x - ux * hl - uy * hw} ${q.y - uy * hl + ux * hw}L${q.x} ${q.y}L${q.x - ux * hl + uy * hw} ${q.y - uy * hl - ux * hw}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (rel.label) {
      const m = { x: (p.x + 2 * c.x + q.x) / 4, y: (p.y + 2 * c.y + q.y) / 4 };
      drawn += `<text x="${m.x}" y="${m.y}" text-anchor="middle" dominant-baseline="central" font-size="${size * 0.85}" fill="${col}" paint-order="stroke" stroke="${paper}" stroke-width="4" stroke-linejoin="round">${esc(rel.label)}</text>`;
    }
  }
  return drawn;
};
const r = Math.min(10, size * 0.7);
let lines = "",
  shapes = "";
const boxes = new Map();
for (const n of nodes) {
  const b = box(n);
  boxes.set(n.label, b);
  for (const c of n.children) {
    const q = box(c);
    if (across) {
      const x0 = b.x + b.w,
        x1 = q.x,
        mx = x0 + step / 2,
        dy = q.cy - b.cy,
        rr = Math.min(r, Math.abs(dy) / 2, step / 4),
        s = Math.sign(dy);
      lines +=
        Math.abs(dy) < 0.5
          ? `<path d="M${x0} ${b.cy}H${x1}"/>`
          : `<path d="M${x0} ${b.cy}H${mx - rr}Q${mx} ${b.cy} ${mx} ${b.cy + s * rr}V${q.cy - s * rr}Q${mx} ${q.cy} ${mx + rr} ${q.cy}H${x1}"/>`;
    } else {
      const y0 = b.y + b.h,
        y1 = q.y,
        my = y0 + step / 2,
        dx = q.cx - b.cx,
        rr = Math.min(r, Math.abs(dx) / 2, step / 4),
        s = Math.sign(dx);
      lines +=
        Math.abs(dx) < 0.5
          ? `<path d="M${b.cx} ${y0}V${y1}"/>`
          : `<path d="M${b.cx} ${y0}V${my - rr}Q${b.cx} ${my} ${b.cx + s * rr} ${my}H${q.cx - s * rr}Q${q.cx} ${my} ${q.cx} ${my + rr}V${y1}"/>`;
    }
  }
  const solid = n.depth === 0 || n.accent;
  const tint = n.depth === 1;
  const c = n.accent && n.depth > 0 ? accent : n.depth === 0 ? color : accent2;
  const fill = solid
    ? `fill="${c}" stroke="${c}"`
    : tint
      ? `fill="${c}" fill-opacity=".14" stroke="${c}"`
      : `fill="${paper}" stroke="${muted}"`;
  shapes += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.min(r, b.h / 2)}" ${fill} stroke-width="${sw}"/>`;
  const ty = n.note ? b.cy - n.size * 0.5 : b.cy;
  shapes += `<text x="${b.cx}" y="${ty}" font-size="${n.size}" font-weight="600" fill="${solid ? paper : ink}">${esc(n.label)}</text>`;
  if (n.note)
    shapes += `<text x="${b.cx}" y="${b.cy + n.size * 0.75}" font-size="${n.size * 0.8}" fill="${solid ? paper : muted}"${solid ? ' fill-opacity=".85"' : ""}>${esc(n.note)}</text>`;
}
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}"><g fill="none" stroke="${d.lineColor || muted}" stroke-width="${sw}" stroke-linecap="round">${lines}</g><g text-anchor="middle" dominant-baseline="central">${shapes}</g>${relations(boxes)}</svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll("rect,circle,path:not(.plain)"))
    el.setAttribute("filter", fx);
}
return svg;
