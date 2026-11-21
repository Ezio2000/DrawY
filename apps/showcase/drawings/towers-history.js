// 灯塔两千年：十座真实的灯塔按时间排成一排，每一座按真实高度、同一个比例尺画出来，
// 背后是米数的刻度线。点一座（或它的名字），上面讲它在灯塔史上留下了什么；没人点
// 时自己一座一座往后讲，讲到的那座灯亮着。
const { width: W, height: H, data: d, theme: t } = api;
const towers = d.towers || [];
const ink = t.ink,
  muted = t.muted,
  accent = t.accent;
const ground = d.ground,
  perM = d.perMetre;
const left = d.left,
  right = W - d.right;
const gap = (right - left) / towers.length;
const cx = (i) => left + gap * (i + 0.5);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const stone = "#d9d1c3",
  white = "#f7f5ef",
  red = "#c8553d",
  grey = "#b7b1a6",
  concrete = "#cfd3d6";

// 一座塔的剖影：从底到顶的半宽 w(f)（f 从 0 到 1），再加顶上的灯室
const shapes = {
  pharos: (h) => {
    const b = h * 0.17;
    return {
      body: `M${-b} 0 V${-h * 0.56} H${-b * 0.66} V${-h * 0.84} H${-b * 0.38} V${-h * 0.96} H${b * 0.38} V${-h * 0.84} H${b * 0.66} V${-h * 0.56} H${b} V0 Z`,
      fill: stone,
      lines: `M${-b} ${-h * 0.56} H${b} M${-b * 0.66} ${-h * 0.84} H${b * 0.66} ${Array.from({ length: 6 }, (_, k) => `M${-b * 0.7 + k * b * 0.28} ${-h * 0.12} v${-h * 0.06}`).join(" ")}`,
      lamp: -h * 0.98,
      fire: true,
    };
  },
  hercules: (h) => {
    const b = h * 0.16;
    return {
      body: `M${-b} 0 L${-b * 0.92} ${-h * 0.82} H${-b * 0.95} V${-h * 0.86} H${-b * 0.55} V${-h * 0.94} H${-b * 0.4} V${-h} H${b * 0.4} V${-h * 0.94} H${b * 0.55} V${-h * 0.86} H${b * 0.95} V${-h * 0.82} L${b} 0 Z`,
      fill: "#d8c9a8",
      lines: `${[0.2, 0.4, 0.6].map((f) => `M${-b * 0.4} ${-h * f} h${b * 0.25} M${b * 0.15} ${-h * (f + 0.08)} h${b * 0.25}`).join(" ")}`,
      lamp: -h * 0.97,
    };
  },
  concave: (h, o) => {
    const w = (f) => o.top + (o.base - o.top) * (1 - f) ** o.curve;
    const pts = (s) => Array.from({ length: 13 }, (_, k) => `${(s * w(k / 12) * h).toFixed(1)} ${(-h * (k / 12)).toFixed(1)}`);
    return { body: `M${pts(-1).join(" L")} L${pts(1).reverse().join(" L")} Z`, w, fill: o.fill, bands: o.bands, lamp: -h };
  },
  tiers: (h) => {
    const b = h * 0.2;
    return {
      body: `M${-b} 0 V${-h * 0.18} H${-b * 0.72} V${-h * 0.44} H${-b * 0.5} V${-h * 0.62} L${-b * 0.36} ${-h * 0.82} H${-b * 0.22} V${-h * 0.88} H${b * 0.22} V${-h * 0.82} H${b * 0.36} L${b * 0.5} ${-h * 0.62} V${-h * 0.44} H${b * 0.72} V${-h * 0.18} H${b} V0 Z`,
      fill: "#e3dccd",
      lines: `M${-b} ${-h * 0.18} H${b} M${-b * 0.72} ${-h * 0.44} H${b * 0.72} M${-b * 0.5} ${-h * 0.62} H${b * 0.5} ${[-0.45, -0.15, 0.15, 0.45].map((f) => `M${b * f} ${-h * 0.25} v${-h * 0.12}`).join(" ")} M${-b * 0.12} ${-h * 0.5} v${-h * 0.06} M${b * 0.12} ${-h * 0.5} v${-h * 0.06}`,
      lamp: -h * 0.9,
    };
  },
  needle: (h) => {
    // 细高的混凝土塔身，往上略收，顶上一圈挑出的平台托着灯室
    const b = h * 0.05;
    return {
      body: `M${-b * 1.7} 0 C${-b * 1.1} ${-h * 0.05} ${-b} ${-h * 0.2} ${-b * 0.8} ${-h * 0.8} L${-b * 1.6} ${-h * 0.84} V${-h * 0.88} H${b * 1.6} V${-h * 0.84} L${b * 0.8} ${-h * 0.8} C${b} ${-h * 0.2} ${b * 1.1} ${-h * 0.05} ${b * 1.7} 0 Z`,
      fill: concrete,
      lines: `M${-b * 0.85} ${-h * 0.35} H${b * 0.85} M${-b * 0.8} ${-h * 0.55} H${b * 0.8} M${-b * 0.8} ${-h * 0.72} H${b * 0.8}`,
      lamp: -h * 0.88,
    };
  },
};
const lantern = (x, y, s, on) =>
  `<g transform="translate(${x} ${y})"><rect x="${-5 * s}" y="${-9 * s}" width="${10 * s}" height="${9 * s}" fill="${on ? "#ffe7a3" : "#e9e4d6"}" stroke="${ink}" stroke-width="1.1"/><path d="M${-6 * s} ${-9 * s} Q0 ${-15 * s} ${6 * s} ${-9 * s} Z" fill="${ink}"/></g>`;
const drawTower = (tw, i) => {
  const h = tw.m * perM;
  const s = shapes[tw.shape === "concave" ? "concave" : tw.shape](h, tw);
  let bands = "";
  if (s.bands && s.w)
    bands = s.bands
      .map(([f0, f1]) => {
        const p = (f, sg) => `${(sg * s.w(f) * h).toFixed(1)} ${(-h * f).toFixed(1)}`;
        return `<path d="M${p(f0, -1)} L${p(f1, -1)} L${p(f1, 1)} L${p(f0, 1)} Z" fill="${red}"/>`;
      })
      .join("");
  const ls = Math.max(0.8, Math.min(1.5, h / 120));
  return `<g class="tw" data-i="${i}" transform="translate(${cx(i)} ${ground})">
    <path d="${s.body}" fill="${s.fill}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>
    ${bands}
    ${s.lines ? `<path d="${s.lines}" fill="none" stroke="${ink}" stroke-width=".8" opacity=".55"/>` : ""}
    <path d="${s.body}" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>
    ${s.fire ? `<path class="fire" d="M-6 ${s.lamp} Q0 ${s.lamp - 22} 6 ${s.lamp} Z" fill="#f08a24" style="transform-box:fill-box;transform-origin:50% 100%"/>` : lantern(0, s.lamp, ls, false)}
    <circle class="glow" cy="${s.lamp - 5 * ls}" r="40" fill="url(#glow)" opacity="0"/>
  </g>`;
};
const svg = api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><radialGradient id="glow"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".95"/><stop offset=".4" stop-color="#ffcf5a" stop-opacity=".4"/><stop offset="1" stop-color="#ffcf5a" stop-opacity="0"/></radialGradient></defs>
  ${[0, 25, 50, 75, 100, 125]
    .map((m) => `<path d="M${left - 20} ${ground - m * perM} H${right}" stroke="${muted}" stroke-opacity="${m ? 0.22 : 0}" stroke-dasharray="3 5"/><text x="${left - 28}" y="${ground - m * perM + 5}" text-anchor="end" font-size="15" fill="${muted}">${m}${m === 125 ? " m" : ""}</text>`)
    .join("")}
  <g class="towers">${towers.map(drawTower).join("")}</g>
  <path d="M${left - 20} ${ground} H${right}" stroke="${ink}" stroke-width="2"/>
  <g class="axis"></g>
  <g class="card" transform="translate(${d.card[0]} ${d.card[1]})">
    <text class="cy" font-size="22" font-weight="700" fill="${accent}"></text>
    <text class="cn" y="40" font-size="30" font-weight="600" fill="${ink}"></text>
    <foreignObject y="56" width="${d.card[2]}" height="90"><div xmlns="http://www.w3.org/1999/xhtml" class="cs"></div></foreignObject>
  </g>
</svg>`);
const NS = "http://www.w3.org/2000/svg";
const axis = svg.querySelector(".axis");
const labels = towers.map((tw, i) => {
  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", `translate(${cx(i)} ${ground})`);
  g.setAttribute("data-interactive", "");
  g.style.cursor = "pointer";
  g.innerHTML = `<rect x="${-gap / 2 + 4}" y="${-tw.m * perM - 40}" width="${gap - 8}" height="${tw.m * perM + 130}" fill="transparent"/>
    <circle class="tick" r="5" fill="${ink}"/>
    <text class="y" y="34" text-anchor="middle" font-size="19" font-weight="700" fill="${ink}">${esc(tw.when)}</text>
    <text class="n" y="58" text-anchor="middle" font-size="15" fill="${ink}">${esc(tw.name)}</text>
    <text y="80" text-anchor="middle" font-size="15" fill="${muted}">${esc(tw.height)}</text>`;
  axis.append(g);
  return g;
});
if (d.breakAfter > 0) {
  const x = (cx(d.breakAfter - 1) + cx(d.breakAfter)) / 2;
  const b = document.createElementNS(NS, "g");
  b.innerHTML = `<rect x="${x - 7}" y="${ground - 6}" width="14" height="12" fill="#fff"/><path d="M${x - 9} ${ground + 7} l6 -14 M${x + 3} ${ground + 7} l6 -14" stroke="${ink}" stroke-width="1.6"/><text x="${x - 6}" y="${ground - 118}" font-size="15" fill="${muted}">${esc(d.breakText)}</text><path d="M${x} ${ground - 110} V${ground - 12}" stroke="${muted}" stroke-dasharray="2 4"/>`;
  axis.append(b);
}
const groups = [...svg.querySelectorAll(".tw")];
const cy = svg.querySelector(".cy"),
  cn = svg.querySelector(".cn"),
  cs = svg.querySelector(".cs");
Object.assign(cs.style, { font: `19px/1.6 ${t.font}`, color: ink });
let at = -1,
  auto = true,
  timer;
const choose = (i) => {
  at = i;
  const tw = towers[i];
  cy.textContent = tw.when;
  cn.textContent = tw.name;
  cs.textContent = tw.story;
  labels.forEach((g, j) => {
    g.querySelector(".y").setAttribute("fill", j === i ? accent : ink);
    g.querySelector(".tick").setAttribute("fill", j === i ? accent : ink);
    g.querySelector(".tick").setAttribute("r", j === i ? "7" : "5");
  });
  groups.forEach((g, j) => g.setAttribute("opacity", j === i ? "1" : "0.55"));
};
const next = () => {
  clearTimeout(timer);
  if (auto) timer = setTimeout(() => (choose((at + 1) % towers.length), next()), d.every * 1000);
};
labels.forEach((g, i) =>
  g.addEventListener("click", () => {
    auto = false;
    clearTimeout(timer);
    choose(i);
  }),
);
api.cleanup(() => clearTimeout(timer));
choose(0);
next();
const glows = groups.map((g) => g.querySelector(".glow"));
const fires = groups.map((g) => g.querySelector(".fire"));
api.animate(() => {
  const s = performance.now() / 1000;
  glows.forEach((g, j) => g.setAttribute("opacity", j === at ? (0.6 + 0.4 * Math.sin(s * 3)).toFixed(2) : "0"));
  fires.forEach((f) => f && (f.style.transform = `scaleY(${(1 + 0.18 * Math.sin(s * 9)).toFixed(2)})`));
});
return svg;
