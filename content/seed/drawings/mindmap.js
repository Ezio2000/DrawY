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
const cx = W / 2,
  cy = H / 2;
const cs = size * 1.25;
const cw = measure(d.center, cs, 700) + cs * 2,
  ch = cs * 2.6;
let lines = "",
  shapes = "",
  words = "";
// Right side first, clockwise from the top; the left continues from the bottom.
const rightCount = Math.ceil(branches.length / 2);
const sides = [
  branches.slice(0, rightCount).map((b, i) => ({ b, i, dir: 1 })),
  branches
    .slice(rightCount)
    .map((b, i) => ({ b, i: rightCount + i, dir: -1 }))
    .reverse(),
];
const pad = size * 0.5;
const avail = cx - pad;
for (const side of sides) {
  const maxBranchW = Math.max(
    0,
    ...side.map(({ b }) => measure(b.label, size, 700) + size * 1.6),
  );
  const maxKidW = Math.max(
    0,
    ...side.flatMap(({ b }) =>
      (b.children || []).map((kid) => measure(String(kid), size * 0.92) + size * 0.4),
    ),
  );
  const slack = avail - (cw / 2 + maxBranchW + maxKidW);
  const gap1 =
    slack > 0
      ? Math.min(W * 0.14, maxKidW ? slack * 0.65 : slack)
      : size * 0.9;
  const gap2 = maxKidW
    ? slack > 0
      ? Math.min(W * 0.055, slack * 0.35)
      : size * 0.6
    : 0;
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
    const bx = cx + dir * (cw / 2 + gap1 + bw / 2);
    const sx = cx + (dir * cw) / 2 - dir * 4;
    const ex = bx - (dir * bw) / 2;
    lines += `<path d="M${sx} ${cy}C${(sx + ex) / 2} ${cy} ${(sx + ex) / 2} ${by} ${ex} ${by}" stroke="${col}" stroke-width="${sw * 1.8}"/>`;
    shapes += `<rect x="${bx - bw / 2}" y="${by - bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="${sw}"/>`;
    words += `<text x="${bx}" y="${by}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${ink}">${esc(b.label)}</text>`;
    const kids = (b.children || []).map(String);
    const rowH = Math.min(
      size * 2.4,
      (bottom - top) / Math.max(1, kids.length),
    );
    kids.forEach((kid, j) => {
      const ky = by + (j - (kids.length - 1) / 2) * rowH;
      const kx0 = bx + (dir * bw) / 2,
        kx1 = kx0 + dir * gap2;
      const tw = measure(kid, size * 0.92);
      const under = ky + size * 0.55;
      lines += `<path d="M${kx0} ${by}C${(kx0 + kx1) / 2} ${by} ${(kx0 + kx1) / 2} ${under} ${kx1} ${under}H${kx1 + dir * (tw + size * 0.4)}" stroke="${col}" stroke-width="${sw}" stroke-opacity=".8"/>`;
      words += `<text x="${kx1 + dir * size * 0.2}" y="${ky - size * 0.1}" text-anchor="${dir > 0 ? "start" : "end"}" font-size="${size * 0.92}" fill="${ink}">${esc(kid)}</text>`;
    });
  });
}
shapes += `<rect x="${cx - cw / 2}" y="${cy - ch / 2}" width="${cw}" height="${ch}" rx="${ch / 2}" fill="${d.color || ink}"/>`;
words += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${cs}" font-weight="700" fill="${paper}">${esc(d.center)}</text>`;
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}"><g fill="none" stroke-linecap="round">${lines}</g>${shapes}<g dominant-baseline="central">${words}</g></svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll("rect,circle,path"))
    el.setAttribute("filter", fx);
}
return svg;
