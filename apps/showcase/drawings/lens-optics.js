// 光是怎样被拧成一束的：一盏灯，加一块凸透镜，再把凸透镜挖成菲涅耳透镜。
// 光线按真实的折射算：进玻璃时按折射率偏一下，出来时变成平行；透镜从凸透镜变成
// 菲涅耳透镜时，每一圈多余的玻璃往后缩，斜面不变。右下的两个数从图里算出来：
// 有几条光线射向海平线，用了多少玻璃。上面三个选项可以点，没人点时自己轮换。
const { width: W, height: H, data: d, theme: t } = api;
const modes = d.modes || [];
const F = { x: d.lamp[0], y: d.lamp[1] };
const Lb = d.lens,
  A = d.aperture,
  T0 = d.thick,
  edge = 8,
  n = 1.5;
const R = (A * A + (T0 - edge) ** 2) / (2 * (T0 - edge));
const sag = (y) => R - Math.sqrt(Math.max(0, R * R - y * y));
const T = (y) => T0 - sag(Math.min(A, Math.abs(y)));
// 菲涅耳：把 ±A 分成一圈圈的环，每一圈只留下自己那段斜面
const rings = d.rings,
  step = A / rings;
const ringOf = (y) => Math.min(rings - 1, Math.floor(Math.abs(y) / step));
const cut = (y) => T((ringOf(y) + 1) * step) - edge;
const thick = (y, f) => T(y) - f * cut(y);
const area = (f) => {
  let s = 0;
  for (let y = -A; y < A; y += 1) s += thick(y + 0.5, f);
  return s;
};
const glass = area(1) / area(0);
const rays = Array.from({ length: d.rays }, (_, i) => (-d.spread + (2 * d.spread * i) / (d.rays - 1)) * (Math.PI / 180));
const back = Array.from({ length: 9 }, (_, i) => (110 + (140 * i) / 8) * (Math.PI / 180));
const far = W - 40;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const amber = d.light,
  ink = t.ink,
  muted = t.muted;

const root = api.html(`<style>
  .w{position:relative;width:${W}px;height:${H}px;font-family:${t.font};color:${ink}}
  svg{position:absolute;inset:0}
  .chips{position:absolute;right:40px;top:26px;display:flex;gap:8px}
  .chips button{border:1.5px solid ${t.accent};background:#fff;color:${t.accent};border-radius:999px;padding:0 18px;height:40px;font:inherit;font-size:17px;cursor:pointer}
  .chips button[aria-pressed=true]{background:${t.accent};color:#fff}
  .cap{position:absolute;left:60px;right:300px;bottom:22px;font-size:22px;line-height:1.5;text-shadow:0 0 6px #fff,0 0 3px #fff}
  svg text{paint-order:stroke;stroke:#fff;stroke-width:6px;stroke-linejoin:round}
  .cap b{color:${t.accent}}
</style><div class="w">
<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow"><stop offset="0" stop-color="${amber}" stop-opacity=".9"/><stop offset=".35" stop-color="${amber}" stop-opacity=".25"/><stop offset="1" stop-color="${amber}" stop-opacity="0"/></radialGradient>
    <linearGradient id="glass" x1="0" x2="1"><stop offset="0" stop-color="#cfe6f0"/><stop offset="1" stop-color="#9fcbe0"/></linearGradient>
    <radialGradient id="eye" cx=".45" cy=".4"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#d9edf5"/><stop offset="1" stop-color="#a8d0e2"/></radialGradient>
    <marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${ink}"/></marker>
  </defs>
  <path d="M60 ${F.y} H${far}" stroke="${muted}" stroke-width="1" stroke-dasharray="4 6" opacity=".6"/>
  <text x="${far}" y="${F.y - 12}" text-anchor="end" font-size="17" fill="${muted}">${esc(d.horizon)}</text>
  <path d="M${far - 140} ${F.y + 26} H${far}" stroke="${ink}" stroke-width="1.4" marker-end="url(#tip)"/>
  <g class="back" stroke="${amber}" stroke-width="2" opacity=".35"></g>
  <g class="rays" stroke="${amber}" stroke-width="2.2" stroke-linecap="round" fill="none"></g>
  <path class="lens" fill="url(#glass)" stroke="#4a7f96" stroke-width="1.6" stroke-linejoin="round"/>
  <circle cx="${F.x}" cy="${F.y}" r="70" fill="url(#glow)"/>
  <path d="M${F.x - 9} ${F.y + 14} Q${F.x - 12} ${F.y - 4} ${F.x} ${F.y - 22} Q${F.x + 12} ${F.y - 4} ${F.x + 9} ${F.y + 14} Z" fill="#ffcf5a" stroke="${ink}" stroke-width="1.4"/>
  <rect x="${F.x - 14}" y="${F.y + 14}" width="28" height="22" rx="3" fill="#8a6b4a" stroke="${ink}" stroke-width="1.4"/>
  <text x="${F.x}" y="${F.y + 62}" text-anchor="middle" font-size="20" font-weight="600" fill="${ink}">${esc(d.lampName)}</text>
  <g class="note" font-size="18" fill="${ink}"><text class="lensName" x="${Lb + 40}" y="${F.y - A - 22}" text-anchor="middle" font-weight="600"></text></g>
  <g class="meters" transform="translate(${d.meters[0]} ${d.meters[1]})">
    <text font-size="17" fill="${muted}">${esc(d.raysLabel)}</text>
    <text class="rv" y="44" font-size="40" font-weight="700" fill="${amber}"></text>
    <text x="250" font-size="17" fill="${muted}">${esc(d.glassLabel)}</text>
    <text class="gv" x="250" y="44" font-size="40" font-weight="700" fill="#4a7f96"></text>
    <rect class="gb" x="250" y="58" width="180" height="8" rx="4" fill="#4a7f96"/>
    <rect x="250" y="58" width="180" height="8" rx="4" fill="none" stroke="#4a7f96" stroke-opacity=".4"/>
  </g>
  <g class="front" transform="translate(${d.front[0]} ${d.front[1]})" opacity="0">
    <circle r="${d.frontR}" fill="url(#eye)" stroke="#4a7f96" stroke-width="1.5"/>
    ${Array.from({ length: rings }, (_, k) => `<circle r="${(d.frontR * (k + 1)) / rings}" fill="none" stroke="#4a7f96" stroke-width="${k === rings - 1 ? 1.6 : 0.9}" opacity=".8"/>`).join("")}
    <path class="sheen" d="M${-d.frontR * 0.75} ${-d.frontR * 0.6} L${-d.frontR * 0.4} ${-d.frontR * 0.85} L${d.frontR * 0.75} ${d.frontR * 0.6} L${d.frontR * 0.4} ${d.frontR * 0.85} Z" fill="#fff" opacity=".35"/>
    <text y="${-d.frontR - 14}" text-anchor="middle" font-size="16" fill="${muted}">${esc(d.frontLabel)}</text>
  </g>
</svg>
<div class="chips">${modes.map((m, i) => `<button aria-pressed="false">${esc(m.name)}</button>`).join("")}</div>
<div class="cap"></div>
</div>`);
const svg = root.querySelector("svg");
const NS = "http://www.w3.org/2000/svg";
const rayPaths = rays.map(() => {
  const p = document.createElementNS(NS, "path");
  svg.querySelector(".rays").append(p);
  return p;
});
const backPaths = back.map((a) => {
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", `M${F.x} ${F.y} L${F.x + 150 * Math.cos(a)} ${F.y + 150 * Math.sin(a)}`);
  svg.querySelector(".back").append(p);
  return p;
});
const lens = svg.querySelector(".lens"),
  inset = svg.querySelector(".front"),
  sheen = svg.querySelector(".sheen");
const lensName = svg.querySelector(".lensName"),
  rv = svg.querySelector(".rv"),
  gv = svg.querySelector(".gv"),
  gb = svg.querySelector(".gb");
const cap = root.querySelector(".cap"),
  buttons = [...root.querySelectorAll(".chips button")];
// 当前的样子朝目标慢慢变过去：m 是有没有透镜，f 是挖薄了多少
const now = { m: 0, f: 0 },
  want = { m: 0, f: 0 };
let at = 0,
  auto = !!d.every,
  timer;
const choose = (i) => {
  at = i;
  want.m = i === 0 ? 0 : 1;
  want.f = i === 2 ? 1 : 0;
  buttons.forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
  cap.innerHTML = modes[i].caption;
  lensName.textContent = modes[i].lens || "";
};
const next = () => {
  clearTimeout(timer);
  if (auto) timer = setTimeout(() => (choose((at + 1) % modes.length), next()), d.every * 1000);
};
buttons.forEach((b, i) =>
  b.addEventListener("click", () => {
    auto = false;
    clearTimeout(timer);
    choose(i);
  }),
);
api.cleanup(() => clearTimeout(timer));
choose(Math.max(0, Number(d.value ?? 0)));
next();

let last = performance.now();
api.animate(() => {
  const time = performance.now();
  const k = 1 - Math.exp(-(time - last) / 260);
  last = time;
  now.m += (want.m - now.m) * k;
  now.f += (want.f - now.f) * k;
  const { m, f } = now;
  // 透镜：后面是平的，前面一段段斜面
  const face = [];
  for (let y = -A; y <= A; y += 1) face.push([Lb + thick(y, f) * m, F.y + y]);
  lens.setAttribute("d", `M${Lb} ${F.y - A} ${face.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} L${Lb} ${F.y + A} Z`);
  lens.setAttribute("opacity", Math.min(1, m * 1.4).toFixed(2));
  let toward = 0;
  rays.forEach((a, i) => {
    const y1 = F.y + (Lb - F.x) * Math.tan(a);
    let path = `M${F.x} ${F.y} L${Lb} ${y1.toFixed(1)}`;
    const b = Math.asin(Math.sin(a) / n);
    const tx = Lb + thick(y1 - F.y, f) * m;
    const y2 = y1 + (tx - Lb) * Math.tan(a + (b - a) * m);
    path += ` L${tx.toFixed(1)} ${y2.toFixed(1)}`;
    const out = a * (1 - m);
    path += ` L${far} ${(y2 + (far - tx) * Math.tan(out)).toFixed(1)}`;
    rayPaths[i].setAttribute("d", path);
    const level = Math.abs(out) < (2 * Math.PI) / 180;
    if (level) toward++;
    rayPaths[i].setAttribute("opacity", level ? "0.95" : "0.45");
  });
  rv.textContent = `${toward} / ${rays.length}`;
  const used = m < 0.02 ? 0 : 1 - (1 - glass) * f;
  gv.textContent = m < 0.02 ? "—" : `${Math.round(used * 100)}%`;
  gb.setAttribute("width", (180 * used * Math.min(1, m)).toFixed(1));
  inset.setAttribute("opacity", f.toFixed(2));
  sheen.setAttribute("transform", `rotate(${((time / 1000) * 30) % 360})`);
});
return root;
