// 一座礁石灯塔的剖面：从灯室一层层往下到实心的基座。墙按剖面画成石砌的断面，屋里
// 的东西用细线画；左边每一层一个名字，引线指进塔里。点一层（或它的名字）就选中它，
// 并发出 pick 事件；没人点的时候，自己一层一层往下看。灯室里的透镜在转，钟表机构的
// 重锤慢慢往下落，浪一阵阵拍上礁石。
const { width: W, height: H, data: d, theme: t } = api;
const X = d.axis;
const yT = 196,
  yB = 612,
  sea = 646;
const parts = d.parts || [];
const ink = t.ink,
  muted = t.muted,
  accent = t.accent,
  blue = t.accent2;
const stone = "#d8d0c2",
  stoneDark = "#b9ae9c",
  inside = "#f4efe5",
  wood = "#a9825a";
const hw = (y) => 66 + 54 * Math.max(0, (y - yT) / (yB - yT)) ** 2.4;
const wt = (y) => 12 + 24 * Math.max(0, (y - yT) / (yB - yT)) ** 1.5;
const iw = (y) => hw(y) - wt(y);
const pts = (f, y0, y1, sgn, n = 16) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const y = y0 + ((y1 - y0) * i) / n;
    return `${(X + sgn * f(y)).toFixed(1)} ${y.toFixed(1)}`;
  });
const outline = `M${pts(hw, yT, yB, -1).join(" L")} L${pts(hw, yB, yT, 1).join(" L")} Z`;
// 屋里的空间：每一层一块，墙里面那一圈
const floors = [yT, 266, 336, 406, 470, 526];
const room = (y0, y1) => `M${pts(iw, y0, y1, -1, 6).join(" L")} L${pts(iw, y1, y0, 1, 6).join(" L")} Z`;
// 实心基座的石块：一层层错缝，竖缝做成燕尾的样子
let courses = "";
for (let y = 532, k = 0; y < yB; y += 13, k++) {
  const half = hw(y) - 1;
  courses += `<path d="M${X - half} ${y} H${X + half}" />`;
  for (let x = X - half + ((k % 2) * 22 + 12); x < X + half - 6; x += 44)
    courses += `<path d="M${x - 3} ${y} l3 6.5 l-3 6.5 M${x + 3} ${y} l-3 6.5 l3 6.5" />`;
}
let wallCourses = "";
for (let y = yT + 12; y < 526; y += 12) {
  const o = hw(y),
    i = iw(y);
  wallCourses += `<path d="M${X - o} ${y} H${X - i} M${X + i} ${y} H${X + o}"/>`;
}
const rock = `M${X - 236} ${sea + 40} C${X - 214} ${sea + 4} ${X - 190} ${sea - 4} ${X - 170} ${sea - 14} C${X - 150} ${yB + 8} ${X - 140} ${yB + 2} ${X - 124} ${yB + 2} L${X + 124} ${yB + 2} C${X + 150} ${yB + 6} ${X + 170} ${sea - 18} ${X + 196} ${sea - 8} C${X + 220} ${sea} ${X + 236} ${sea + 20} ${X + 250} ${sea + 40} Z`;
let swell = "";
for (let k = 0; k < 4; k++) {
  const y = sea + 16 + k * 22;
  let path = "";
  for (let x = 0; x <= W; x += 20) path += (x ? " L" : "M") + x + " " + (y + 3 * Math.sin(x / 26 + k * 1.7)).toFixed(1);
  swell += `<path d="${path}" stroke="${blue}" stroke-width="${1 + k * 0.3}" opacity="${0.25 + k * 0.1}" fill="none" stroke-dasharray="${40 + k * 20} ${16 + k * 8}"/>`;
}
const keeper = (x, y, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})" stroke="${ink}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="0" cy="-30" r="6" fill="#f2d9c0"/><path d="M-6 -33 q6 -8 12 0" fill="${ink}"/>
    <path d="M-7 -22 h14 l2 18 h-18 Z" fill="${blue}"/><path d="M-7 -4 v14 M7 -4 v14" fill="none"/><path d="M7 -18 l10 6" fill="none"/>
  </g>`;
const lantern = `
  <path d="M${X - 92} ${yT} H${X + 92} V${yT + 6} H${X - 92} Z" fill="${stoneDark}" stroke="${ink}" stroke-width="1.2"/>
  <path d="M${X - 88} ${yT} V${yT - 18} H${X + 88} V${yT} M${X - 60} ${yT} V${yT - 18} M${X - 30} ${yT} V${yT - 18} M${X + 30} ${yT} V${yT - 18} M${X + 60} ${yT} V${yT - 18} M${X - 88} ${yT - 9} H${X + 88}" fill="none" stroke="${ink}" stroke-width="1.3"/>
  <rect x="${X - 50}" y="120" width="100" height="${yT - 120}" fill="#eef5f7" stroke="${ink}" stroke-width="1.4"/>
  <g class="lens">
    <path d="M${X - 30} 130 Q${X - 36} 157 ${X - 30} 186 H${X + 30} Q${X + 36} 157 ${X + 30} 130 Z" fill="#fbeec4" stroke="${ink}" stroke-width="1.1"/>
    ${[136, 142, 148, 166, 172, 178].map((y) => `<path d="M${X - 31} ${y} H${X + 31}" stroke="${ink}" stroke-width=".6" opacity=".55"/>`).join("")}
    <rect class="band" x="${X - 8}" y="150" width="16" height="14" fill="#fffaf0"/>
    <circle cx="${X}" cy="157" r="5" fill="#ffd36e" stroke="${ink}" stroke-width=".8"/>
  </g>
  <path d="M${X - 50} 132 L${X - 25} 196 M${X - 25} 120 L${X + 10} 196 M${X + 10} 120 L${X + 45} 196 M${X + 45} 120 L${X + 50} 132" stroke="${ink}" stroke-width=".9" opacity=".5"/>
  <path d="M${X - 58} 120 Q${X} 70 ${X + 58} 120 Z" fill="#7d8a8c" stroke="${ink}" stroke-width="1.4"/>
  <circle cx="${X}" cy="80" r="8" fill="#7d8a8c" stroke="${ink}" stroke-width="1.3"/>
  <path d="M${X} 72 V44" stroke="${ink}" stroke-width="1.6"/>
  <path class="vane" d="M${X - 14} 50 H${X + 14} M${X + 14} 50 l-6 -4 M${X + 14} 50 l-6 4" stroke="${ink}" stroke-width="1.4" fill="none"/>`;
const watch = `
  <rect x="${X - 22}" y="232" width="44" height="28" fill="#ddd3c2" stroke="${ink}" stroke-width="1.2"/>
  <g class="gear1" transform="translate(${X - 8} 246)"><circle r="8" fill="none" stroke="${ink}" stroke-width="1.2" stroke-dasharray="3 2"/><circle r="2" fill="${ink}"/></g>
  <g class="gear2" transform="translate(${X + 10} 244)"><circle r="6" fill="none" stroke="${ink}" stroke-width="1.2" stroke-dasharray="2.5 2"/><circle r="1.6" fill="${ink}"/></g>
  <path d="M${X} 232 V${yT + 6}" stroke="${ink}" stroke-width="1.6"/>
  ${keeper(X - 46, 258)}
  <path d="M${X - 64} 258 h20 M${X - 60} 238 v20" stroke="${wood}" stroke-width="2"/>
  <rect x="${X + 36}" y="240" width="22" height="3" fill="${wood}"/><path d="M${X + 39} 243 v15 M${X + 55} 243 v15" stroke="${wood}" stroke-width="1.6"/>
  <rect x="${X + 40}" y="234" width="12" height="6" fill="#fff" stroke="${ink}" stroke-width=".8"/>`;
const bedroom = `
  <path d="M${X - iw(300) + 2} 292 Q${X - 40} 300 ${X - 18} 292 V300 Q${X - 40} 308 ${X - iw(300) + 2} 300 Z" fill="${accent}" opacity=".75" stroke="${ink}" stroke-width="1"/>
  <path d="M${X - iw(326) + 2} 322 Q${X - 40} 330 ${X - 16} 322 V330 Q${X - 40} 338 ${X - iw(326) + 2} 330 Z" fill="${blue}" opacity=".7" stroke="${ink}" stroke-width="1"/>
  <path d="M${X - iw(300) + 2} 286 v50 M${X - 18} 288 v44" stroke="${wood}" stroke-width="1.8"/>
  <rect x="${X + 22}" y="316" width="30" height="18" fill="${wood}" stroke="${ink}" stroke-width="1"/>
  <path d="M${X + 37} 266 v14" stroke="${ink}" stroke-width="1"/><circle cx="${X + 37}" cy="284" r="4.5" fill="#ffd77f" stroke="${ink}" stroke-width=".8"/>`;
const kitchen = `
  <rect x="${X + 18}" y="378" width="32" height="26" fill="#55585a" stroke="${ink}" stroke-width="1.2"/>
  <path d="M${X + 42} 378 V340" stroke="#55585a" stroke-width="5"/>
  <path d="M${X + 22} 374 q4 -8 12 -8 q8 0 10 8 Z" fill="#8a6a4a" stroke="${ink}" stroke-width=".9"/>
  <path class="steam" d="M${X + 30} 364 q-5 -6 0 -12 q5 -6 0 -12" fill="none" stroke="${muted}" stroke-width="1.3" stroke-linecap="round"/>
  <rect x="${X - 62}" y="384" width="46" height="4" fill="${wood}"/><path d="M${X - 58} 388 v16 M${X - 20} 388 v16" stroke="${wood}" stroke-width="2"/>
  <path d="M${X - 72} 396 h8 v8 M${X - 14} 396 h8 v8" stroke="${wood}" stroke-width="2" fill="none"/>
  <path d="M${X - 64} 352 h44" stroke="${wood}" stroke-width="2"/>
  <circle cx="${X - 56}" cy="347" r="4" fill="#fff" stroke="${ink}" stroke-width=".8"/><circle cx="${X - 44}" cy="347" r="4" fill="#fff" stroke="${ink}" stroke-width=".8"/><rect x="${X - 34}" y="342" width="8" height="10" fill="${blue}" opacity=".7"/>`;
const stores = `
  ${[-62, -40, -18].map((dx) => `<rect x="${X + dx}" y="${426}" width="18" height="40" rx="5" fill="#c9b27a" stroke="${ink}" stroke-width="1.1"/><path d="M${X + dx} 436 h18 M${X + dx} 456 h18" stroke="${ink}" stroke-width=".7" opacity=".6"/>`).join("")}
  <ellipse cx="${X + 34}" cy="${452}" rx="13" ry="15" fill="${wood}" stroke="${ink}" stroke-width="1.1"/><path d="M${X + 21} 446 h26 M${X + 21} 458 h26" stroke="${ink}" stroke-width=".8"/>
  <path d="M${X + 52} 468 q2 -18 12 -20 q10 2 10 20 Z" fill="#4a4a4a" stroke="${ink}" stroke-width="1"/>`;
const doorX = X + iw(500);
const entrance = `
  <rect x="${doorX - 2}" y="${484}" width="${wt(500) + 6}" height="36" fill="${inside}" stroke="${ink}" stroke-width="1.2"/>
  <path d="M${X + hw(500) + 4} 520 V${yB - 2} M${X + hw(500) + 18} 520 V${yB - 2}" stroke="#a5722e" stroke-width="2"/>
  ${Array.from({ length: 7 }, (_, i) => `<path d="M${X + hw(500) + 4} ${528 + i * 12} h14" stroke="#a5722e" stroke-width="1.6"/>`).join("")}
  ${Array.from({ length: 6 }, (_, i) => `<path d="M${X - 50 + i * 12} ${520 - i * 8} h12 v-8" stroke="${ink}" stroke-width="1.2" fill="none"/>`).join("")}
  <path d="M${X - 52} 520 L${X + 22} 472" stroke="${ink}" stroke-width="1" opacity=".4"/>`;

const svg = api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible">
  <defs>
    <linearGradient id="back" x1="0" x2="1"><stop offset="0" stop-color="#e5ddcf"/><stop offset=".5" stop-color="${inside}"/><stop offset="1" stop-color="#ded5c5"/></linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${blue}" stop-opacity=".35"/><stop offset="1" stop-color="${blue}" stop-opacity=".12"/></linearGradient>
    <linearGradient id="beam" gradientUnits="userSpaceOnUse" x1="${X}" x2="${X + 190}"><stop offset="0" stop-color="#ffd36e" stop-opacity=".55"/><stop offset="1" stop-color="#ffd36e" stop-opacity="0"/></linearGradient>
    <linearGradient id="fadeX" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".22" stop-color="#fff"/><stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="fade"><rect width="${W}" height="${H}" fill="url(#fadeX)"/></mask>
    <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0 V7" stroke="${stoneDark}" stroke-width="1.2"/></pattern>
  </defs>
  <rect x="0" y="${sea}" width="${W}" height="${H - sea}" fill="url(#sea)" mask="url(#fade)"/>
  <g class="beams">
    <path class="b0" d="M${X + 30} 150 L${X + 230} 120 L${X + 230} 194 L${X + 30} 164 Z" fill="url(#beam)"/>
    <path class="b1" transform="rotate(180 ${X} 157)" d="M${X + 30} 150 L${X + 230} 120 L${X + 230} 194 L${X + 30} 164 Z" fill="url(#beam)"/>
  </g>
  <path d="${rock}" fill="#8f8577" stroke="${ink}" stroke-width="1.4"/>
  <path d="M${X - 150} ${sea - 4} l26 -8 l16 12 M${X + 120} ${sea - 6} l20 -10 l22 8 M${X - 40} ${sea + 22} l34 -10 l26 6 M${X + 40} ${sea + 30} l20 -6" stroke="${ink}" stroke-width="1" fill="none" opacity=".45"/>
  <g class="swell" mask="url(#fade)">${swell}</g>
  <path d="${outline}" fill="${stone}"/>
  <path d="${outline}" fill="url(#hatch)" opacity=".55"/>
  <g stroke="${stoneDark}" stroke-width="1" fill="none">${wallCourses}</g>
  <g class="rooms">${floors
    .slice(0, -1)
    .map((y0, i) => `<path data-room="${i + 1}" d="${room(y0 + (i ? 3 : 6), floors[i + 1] - 3)}" fill="url(#back)"/>`)
    .join("")}</g>
  <g stroke="${ink}" stroke-width="1" fill="${stoneDark}">${floors.slice(1).map((y) => `<rect x="${X - iw(y)}" y="${y - 3}" width="${iw(y) * 2}" height="6"/>`).join("")}</g>
  <g stroke="${stoneDark}" stroke-width="1.1" fill="none">${courses}</g>
  <path d="M${X - 5} 266 V470 M${X + 5} 266 V470" stroke="${ink}" stroke-width=".8" opacity=".55"/>
  <rect class="weight" x="${X - 4}" y="280" width="8" height="18" fill="#55585a"/>
  ${lantern}${watch}${bedroom}${kitchen}${stores}${entrance}
  <path d="${outline}" fill="none" stroke="${ink}" stroke-width="1.8"/>
  <g class="windows">${[231, 301, 371, 438].map((y) => `<rect x="${X + hw(y) - wt(y) - 1}" y="${y - 7}" width="${wt(y) + 2}" height="12" fill="#cfe1e6" stroke="${ink}" stroke-width="1"/>`).join("")}</g>
  <g class="hits"></g>
  <g class="labels"></g>
  <g class="foam" fill="none" stroke="#fff" stroke-linecap="round"></g>
</svg>`);

// 每一层：一块可点的区域，左边一个名字和一条引线
const hits = svg.querySelector(".hits"),
  labels = svg.querySelector(".labels");
const NS = "http://www.w3.org/2000/svg";
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const groups = parts.map((p, i) => {
  const [y0, y1] = p.span;
  const area = document.createElementNS(NS, "path");
  area.setAttribute(
    "d",
    i === 0 ? `M${X - 94} ${yT + 8} V${yT - 20} H${X - 54} V118 Q${X} 64 ${X + 54} 118 V${yT - 20} H${X + 94} V${yT + 8} Z` : `M${pts(hw, y0, y1, -1, 6).join(" L")} L${pts(hw, y1, y0, 1, 6).join(" L")} Z`,
  );
  area.setAttribute("fill", accent);
  area.setAttribute("fill-opacity", "0");
  area.setAttribute("stroke", accent);
  area.setAttribute("stroke-width", "2.5");
  area.setAttribute("stroke-opacity", "0");
  area.setAttribute("data-interactive", "");
  area.style.cursor = "pointer";
  hits.append(area);
  const g = document.createElementNS(NS, "g");
  const y = p.at;
  const edge = X - (i === 0 ? 50 : hw(y));
  g.innerHTML = `<path d="M${d.labelRight + 8} ${y} H${edge - 4}" stroke="${muted}" stroke-width="1" stroke-dasharray="2 3"/>
    <circle cx="${edge - 2}" cy="${y}" r="3.2" fill="${ink}"/>
    <text x="${d.labelRight}" y="${y - 2}" text-anchor="end" font-size="23" font-weight="600" fill="${ink}">${esc(p.name)}</text>
    <text x="${d.labelRight}" y="${y + 21}" text-anchor="end" font-size="16" fill="${muted}">${esc(p.short)}</text>
    <rect x="${d.labelRight - 250}" y="${y - 24}" width="${edge - d.labelRight + 250}" height="48" fill="transparent"/>`;
  g.setAttribute("data-interactive", "");
  g.style.cursor = "pointer";
  labels.append(g);
  return { area, g };
});
let chosen = -1,
  auto = true,
  timer;
const choose = (i, by) => {
  chosen = i;
  groups.forEach(({ area, g }, j) => {
    const on = j === i;
    area.setAttribute("fill-opacity", on ? "0.12" : "0");
    area.setAttribute("stroke-opacity", on ? "0.9" : "0");
    g.querySelector("text").setAttribute("fill", on ? accent : ink);
    g.querySelector("circle").setAttribute("fill", on ? accent : ink);
    g.querySelector("path").setAttribute("stroke", on ? accent : muted);
  });
  void api.emit("pick", { index: i, by });
};
const next = () => {
  clearTimeout(timer);
  if (auto) timer = setTimeout(() => (choose((chosen + 1) % parts.length, "auto"), next()), d.every * 1000);
};
groups.forEach(({ area, g }, i) => {
  const pick = () => {
    auto = false;
    clearTimeout(timer);
    choose(i, "person");
  };
  area.addEventListener("click", pick);
  g.addEventListener("click", pick);
});
api.cleanup(() => clearTimeout(timer));
choose(Math.max(0, Number(d.value ?? 0)), "auto");
next();

const band = svg.querySelector(".band"),
  b0 = svg.querySelector(".b0"),
  b1 = svg.querySelector(".b1");
const g1 = svg.querySelector(".gear1"),
  g2 = svg.querySelector(".gear2"),
  weight = svg.querySelector(".weight"),
  steam = svg.querySelector(".steam"),
  foam = svg.querySelector(".foam");
api.animate(() => {
  const s = performance.now() / 1000;
  const a = (2 * Math.PI * s) / d.period;
  band.setAttribute("x", (X - 8 + 26 * Math.sin(a)).toFixed(1));
  band.setAttribute("opacity", (0.3 + 0.7 * Math.max(0, Math.cos(a))).toFixed(2));
  b0.setAttribute("opacity", (Math.max(0, Math.sin(a)) ** 3).toFixed(2));
  b1.setAttribute("opacity", (Math.max(0, -Math.sin(a)) ** 3).toFixed(2));
  g1.setAttribute("transform", `translate(${X - 8} 246) rotate(${(s * 40) % 360})`);
  g2.setAttribute("transform", `translate(${X + 10} 244) rotate(${(-s * 53) % 360})`);
  weight.setAttribute("y", (280 + ((s / 40) % 1) * 168).toFixed(1));
  steam.setAttribute("opacity", (0.3 + 0.5 * Math.abs(Math.sin(s * 1.3))).toFixed(2));
  steam.setAttribute("transform", `translate(0 ${(-((s * 6) % 6)).toFixed(1)})`);
  const p = (s % 4) / 4;
  foam.innerHTML = [
    [X - 196, -1],
    [X + 206, 1],
  ]
    .map(([x, dir], k) => {
      const q = Math.max(0, Math.sin(Math.PI * ((p + k * 0.45) % 1)));
      return `<path d="M${x} ${sea + 4} q${-dir * 10} ${-24 * q} ${dir * 6} ${-40 * q}" stroke-width="${1 + 3 * q}" opacity="${(0.2 + 0.7 * q).toFixed(2)}" stroke="${blue}"/>
        <circle cx="${x + dir * 8}" cy="${sea - 44 * q}" r="${2 + 2 * q}" fill="#fff" stroke="${blue}" opacity="${(0.6 * q).toFixed(2)}"/>`;
    })
    .join("");
});
return svg;
