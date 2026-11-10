// A mind map: a central idea with branches to either side, each branch in its own
// colour, and its points as words written on the ends of curved lines. For brainstorms,
// the facets of a topic and outlines.
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
  muted = t.muted || "#888";
const palette = [t.accent || "#d97757", t.accent2 || "#4f7c8a", muted, ink];
const sw = Math.max(1.2, Number(t.stroke ?? 1.6));
const size = Number(d.size ?? 14);
const branches = (d.branches || []).map((b) =>
  typeof b === "string" ? { label: b } : b,
);
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
const cx = W / 2,
  cy = H / 2;
const cs = size * 1.25;
const cw = measure(d.center, cs, 700) + cs * 2,
  ch = cs * 2.6;
let lines = "",
  shapes = "",
  words = "";
// Where each named node is drawn, for the relations between them.
const boxes = new Map();
// Right side first, clockwise from the top; the left continues from the bottom.
const rightCount = Math.ceil(branches.length / 2);
const sides = [
  branches.slice(0, rightCount).map((b, i) => ({ b, i, dir: 1 })),
  branches
    .slice(rightCount)
    .map((b, i) => ({ b, i: rightCount + i, dir: -1 }))
    .reverse(),
];
for (const side of sides) {
  const weight = side.map(({ b }) => Math.max(1, (b.children || []).length));
  const total = weight.reduce((s, w) => s + w, 0) || 1;
  let acc = 0;
  side.forEach(({ b, i, dir }, k) => {
    const col = b.color || palette[i % palette.length];
    const top = (acc / total) * H,
      bottom = ((acc + weight[k]) / total) * H;
    acc += weight[k];
    const by = (top + bottom) / 2;
    const bw = measure(b.label, size, 700) + size * 1.6,
      bh = size * 2.2;
    const bx = cx + dir * (W * 0.2 + bw / 2);
    const sx = cx + (dir * cw) / 2 - dir * 4;
    const ex = bx - (dir * bw) / 2;
    lines += `<path d="M${sx} ${cy}C${(sx + ex) / 2} ${cy} ${(sx + ex) / 2} ${by} ${ex} ${by}" stroke="${col}" stroke-width="${sw * 1.8}"/>`;
    shapes += `<rect x="${bx - bw / 2}" y="${by - bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="${sw}"/>`;
    words += `<text x="${bx}" y="${by}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${ink}">${esc(b.label)}</text>`;
    boxes.set(String(b.label), { x: bx - bw / 2, y: by - bh / 2, w: bw, h: bh });
    const kids = (b.children || []).map(String);
    const rowH = Math.min(
      size * 2.4,
      (bottom - top) / Math.max(1, kids.length),
    );
    kids.forEach((kid, j) => {
      const ky = by + (j - (kids.length - 1) / 2) * rowH;
      const kx0 = bx + (dir * bw) / 2,
        kx1 = kx0 + dir * W * 0.06;
      const tw = measure(kid, size * 0.92);
      const under = ky + size * 0.55;
      boxes.set(kid, {
        x: dir > 0 ? kx1 : kx1 - tw - size * 0.4,
        y: ky - size * 0.7,
        w: tw + size * 0.4,
        h: size * 1.3,
      });
      lines += `<path d="M${kx0} ${by}C${(kx0 + kx1) / 2} ${by} ${(kx0 + kx1) / 2} ${under} ${kx1} ${under}H${kx1 + dir * (tw + size * 0.4)}" stroke="${col}" stroke-width="${sw}" stroke-opacity=".8"/>`;
      words += `<text x="${kx1 + dir * size * 0.2}" y="${ky - size * 0.1}" text-anchor="${dir > 0 ? "start" : "end"}" font-size="${size * 0.92}" fill="${ink}">${esc(kid)}</text>`;
    });
  });
}
boxes.set(String(d.center), { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch });
shapes += `<rect x="${cx - cw / 2}" y="${cy - ch / 2}" width="${cw}" height="${ch}" rx="${ch / 2}" fill="${d.color || ink}"/>`;
words += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${cs}" font-weight="700" fill="${paper}">${esc(d.center)}</text>`;
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}"><g fill="none" stroke-linecap="round">${lines}</g>${shapes}<g dominant-baseline="central">${words}</g>${relations(boxes)}</svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll("rect,circle,path:not(.plain)"))
    el.setAttribute("filter", fx);
}
return svg;
