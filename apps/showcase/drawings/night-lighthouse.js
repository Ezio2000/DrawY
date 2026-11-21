// 夜里的灯塔：礁石、守塔人的小屋、红白相间的塔身被月光从左边照亮，灯室里的透镜在转。
// 两束光背对背绕着塔转：侧着看是长长的光柱，转到正对我们时变成一团刺眼的闪光。
const { width: w, height: h, data: d } = api;
const cx = w / 2,
  lampY = d.lamp * h;
// 礁石的轮廓：几块起伏叠在一起，塔立在最高的那块上
const wl = h - d.waterline;
const hump = (x) =>
  70 * Math.exp(-(((x - cx - 6) / 64) ** 2)) + 44 * Math.exp(-(((x - 74) / 48) ** 2)) + 30 * Math.exp(-(((x - w + 62) / 40) ** 2)) + 12 * Math.exp(-(((x - w + 20) / 16) ** 2)) + 10 * Math.exp(-(((x - 18) / 18) ** 2));
const jag = (x) => 2.4 * Math.sin(x * 0.21) + 1.6 * Math.sin(x * 0.53 + 1) + 0.8 * Math.sin(x * 1.7);
const ridgePts = [];
for (let x = 2; x <= w - 2; x += 5) ridgePts.push([x, wl - Math.max(0, hump(x) + jag(x) * Math.min(1, hump(x) / 10))]);
const ground = (x) => wl - hump(x) + 3;
const base = ground(cx),
  top = lampY + 40;
const bw = 34,
  tw = 21;
const at = (y) => bw + (tw - bw) * ((base - y) / (base - top)) ** 0.9;
const side = (sgn) => {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const y = base - ((base - top) * i) / 12;
    pts.push(`${(cx + sgn * at(y)).toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts;
};
const line = (pts) => pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
const rocks = `M2 ${wl} L${line(ridgePts)} L${w - 2} ${wl} Z`;
const ridge = `M${line(ridgePts)}`;
const mirror = `M2 ${wl} L${line(ridgePts.map(([x, y]) => [x, wl + (wl - y) * 0.7]))} L${w - 2} ${wl} Z`;
// 礁石上的裂纹和背光的一面
const cracks = [
  [cx - 30, 0.55, -14, 22],
  [cx + 26, 0.45, 10, 18],
  [70, 0.5, -8, 16],
  [w - 64, 0.5, 9, 12],
  [cx - 70, 0.3, 6, 10],
]
  .map(([x, f, dx, len]) => {
    const y = wl - hump(x) * f;
    return `M${x} ${y.toFixed(1)} l${dx * 0.5} ${len * 0.5} l${dx * 0.3} ${len * 0.6}`;
  })
  .join(" ");
const house = { x: 76, y: ground(76) };
const tower = `M${side(-1).join(" L")} L${side(1).reverse().join(" L")} Z`;
const bands = [0.2, 0.5, 0.8]
  .map((f) => {
    const y = base - (base - top) * f;
    return `<rect x="${cx - 40}" y="${(y - 15).toFixed(1)}" width="80" height="28"/>`;
  })
  .join("");
const svg = api.svg(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="overflow:visible">
  <defs>
    <linearGradient id="wall" x1="0" x2="1"><stop offset="0" stop-color="#e6e9f5"/><stop offset=".45" stop-color="#b5bcd6"/><stop offset="1" stop-color="#4c5475"/></linearGradient>
    <linearGradient id="red" x1="0" x2="1"><stop offset="0" stop-color="#b0474f"/><stop offset=".5" stop-color="#83303b"/><stop offset="1" stop-color="#3b1d2b"/></linearGradient>
    <linearGradient id="rock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a4672"/><stop offset=".45" stop-color="#1f2747"/><stop offset="1" stop-color="#080c1d"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#fffbe8" stop-opacity="1"/><stop offset=".12" stop-color="#ffe7a6" stop-opacity=".75"/><stop offset=".4" stop-color="#ffcf73" stop-opacity=".22"/><stop offset="1" stop-color="#ffcf73" stop-opacity="0"/></radialGradient>
    <linearGradient id="b0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff3cf" stop-opacity=".8"/><stop offset=".35" stop-color="#ffe7a8" stop-opacity=".32"/><stop offset="1" stop-color="#ffe7a8" stop-opacity="0"/></linearGradient>
    <linearGradient id="b1" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff3cf" stop-opacity=".8"/><stop offset=".35" stop-color="#ffe7a8" stop-opacity=".32"/><stop offset="1" stop-color="#ffe7a8" stop-opacity="0"/></linearGradient>
    <clipPath id="clip"><path d="${tower}"/></clipPath>
    <clipPath id="frame"><rect x="${d.frame[0]}" y="${d.frame[1]}" width="${d.frame[2]}" height="${d.frame[3]}"/></clipPath>
    <linearGradient id="mirror" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1026" stop-opacity=".85"/><stop offset="1" stop-color="#0b1026" stop-opacity="0"/></linearGradient>
    <linearGradient id="rim" gradientUnits="userSpaceOnUse" x1="0" x2="${w}"><stop offset="0" stop-color="#ffd79a" stop-opacity=".15"/><stop offset=".5" stop-color="#ffd79a" stop-opacity=".7"/><stop offset="1" stop-color="#ffd79a" stop-opacity=".2"/></linearGradient>
    <radialGradient id="lens" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#fffdf0"/><stop offset=".45" stop-color="#ffe7a2"/><stop offset="1" stop-color="#e9a94a"/></radialGradient>
  </defs>
  <g class="beams" clip-path="url(#frame)">
    <path class="beam" fill="url(#b0)"/><path class="beam core" fill="url(#b0)"/>
    <path class="beam" fill="url(#b1)"/><path class="beam core" fill="url(#b1)"/>
  </g>
  <path d="${mirror}" fill="url(#mirror)"/>
  <path d="${rocks}" fill="url(#rock)"/>
  <path d="${cracks}" fill="none" stroke="#070b1a" stroke-width="2" stroke-linecap="round" opacity=".8"/>
  <path d="${ridge}" fill="none" stroke="url(#rim)" stroke-width="2.2" stroke-linejoin="round"/>
  <g>
    <path d="M${house.x - 32} ${house.y + 6} V${house.y - 28} L${house.x} ${house.y - 50} L${house.x + 32} ${house.y - 28} V${house.y + 6} Z" fill="#c7cce0"/>
    <path d="M${house.x} ${house.y - 50} L${house.x + 32} ${house.y - 28} V${house.y + 6} H${house.x} Z" fill="#59617f" opacity=".75"/>
    <path d="M${house.x - 38} ${house.y - 26} L${house.x} ${house.y - 54} L${house.x + 38} ${house.y - 26}" fill="none" stroke="#3a2230" stroke-width="7" stroke-linejoin="round"/>
    <rect x="${house.x - 22}" y="${house.y - 20}" width="12" height="14" fill="#ffcf7a"/>
    <rect x="${house.x - 22}" y="${house.y - 20}" width="12" height="14" fill="none" stroke="#3a2a2a" stroke-width="1.5"/>
    <rect x="${house.x + 10}" y="${house.y - 20}" width="12" height="14" fill="#ffd98f" opacity=".85"/>
    <circle cx="${house.x - 16}" cy="${house.y - 13}" r="22" fill="url(#glow)" opacity=".5"/>
  </g>
  <path d="${tower}" fill="url(#wall)"/>
  <g clip-path="url(#clip)" fill="url(#red)">${bands}</g>
  <g fill="#1d2338">
    <rect x="${cx - 4}" y="${base - 28}" width="8" height="20" rx="4"/>
    <rect x="${cx - 3}" y="${base - (base - top) * 0.36 - 8}" width="6" height="11" rx="3" fill="#ffd27a" opacity=".85"/>
    <rect x="${cx - 3}" y="${base - (base - top) * 0.66 - 8}" width="6" height="11" rx="3"/>
  </g>
  <rect x="${cx - tw - 8}" y="${top - 6}" width="${(tw + 8) * 2}" height="6" fill="#2a2f45"/>
  <path d="M${cx - tw - 6} ${top - 6} V${top - 17} H${cx + tw + 6} V${top - 6} M${cx - tw} ${top - 6} V${top - 16} M${cx - 8} ${top - 6} V${top - 16} M${cx + 8} ${top - 6} V${top - 16} M${cx + tw} ${top - 6} V${top - 16}" stroke="#2a2f45" stroke-width="1.6" fill="none"/>
  <rect x="${cx - 15}" y="${lampY - 18}" width="30" height="${top - lampY + 12}" fill="url(#lens)"/>
  <path d="M${cx - 15} ${lampY - 18} V${top - 6} M${cx - 5} ${lampY - 18} V${top - 6} M${cx + 5} ${lampY - 18} V${top - 6} M${cx + 15} ${lampY - 18} V${top - 6} M${cx - 15} ${lampY + 4} H${cx + 15}" stroke="#3a3346" stroke-width="1.4" opacity=".55"/>
  <path d="M${cx - 19} ${lampY - 18} Q${cx} ${lampY - 44} ${cx + 19} ${lampY - 18} Z" fill="#262c45"/>
  <path d="M${cx} ${lampY - 38} V${lampY - 56}" stroke="#262c45" stroke-width="2"/><circle cx="${cx}" cy="${lampY - 37}" r="3.4" fill="#262c45"/>
  <circle class="glow" cx="${cx}" cy="${lampY}" r="120" fill="url(#glow)"/>
  <g class="flare" opacity="0">
    <circle cx="${cx}" cy="${lampY}" r="260" fill="url(#glow)"/>
    <path d="M${cx - 150} ${lampY} H${cx + 150} M${cx} ${lampY - 70} V${lampY + 70}" stroke="#fff6dc" stroke-width="1.6" opacity=".7"/>
  </g>
  <circle cx="${cx}" cy="${lampY}" r="5" fill="#fffdf2"/>
  <g class="foam" fill="none" stroke="#dfe7ff" stroke-linecap="round"></g>
</svg>`);

const beams = [...svg.querySelectorAll(".beam")];
const grads = [svg.querySelector("#b0"), svg.querySelector("#b1")];
const glow = svg.querySelector(".glow"),
  flare = svg.querySelector(".flare"),
  foam = svg.querySelector(".foam");
const L = d.reach;
api.animate(() => {
  const t = performance.now() / 1000;
  const th = (2 * Math.PI * t) / d.period;
  let facing = 0;
  for (let k = 0; k < 2; k++) {
    const a = th + k * Math.PI;
    const s = Math.sin(a),
      c = Math.cos(a);
    facing = Math.max(facing, c > 0 ? c ** 14 : 0);
    const dir = s >= 0 ? 1 : -1,
      len = 30 + L * Math.abs(s) ** 0.7;
    const spread = 6 + 46 * Math.abs(s) + 60 * Math.max(0, c);
    const ex = cx + dir * len;
    // 光柱：近处窄、远处宽，向后的那一束淡一些
    const fade = (0.35 + 0.65 * Math.abs(s)) * (c < 0 ? 0.75 : 1);
    beams[k * 2].setAttribute("d", `M${cx} ${lampY - 7} L${ex} ${lampY - spread} L${ex} ${lampY + spread * 0.55} L${cx} ${lampY + 7} Z`);
    beams[k * 2 + 1].setAttribute("d", `M${cx} ${lampY - 4} L${ex} ${lampY - spread * 0.42} L${ex} ${lampY + spread * 0.18} L${cx} ${lampY + 4} Z`);
    beams[k * 2].setAttribute("opacity", (0.55 * fade).toFixed(3));
    beams[k * 2 + 1].setAttribute("opacity", (0.8 * fade).toFixed(3));
    grads[k].setAttribute("x1", cx);
    grads[k].setAttribute("x2", ex);
    grads[k].setAttribute("y1", lampY);
    grads[k].setAttribute("y2", lampY);
  }
  flare.setAttribute("opacity", facing.toFixed(3));
  glow.setAttribute("r", (110 + 40 * facing).toFixed(1));
  // 浪一阵一阵拍上礁石，水线上的白沫跟着涨落
  const p = (t % 3.6) / 3.6;
  foam.innerHTML = [
    [10, 46, 0],
    [w - 60, 52, 0.35],
    [cx - 40, 70, 0.62],
    [cx + 60, 40, 0.15],
  ]
    .map(([x, r, off]) => {
      const q = Math.max(0, Math.sin(Math.PI * ((p + off) % 1)));
      const y = wl - 2 - 6 * q;
      return `<path d="M${x} ${wl} q${r * 0.25} ${-12 * q - 2} ${r * 0.5} ${-4 * q} t${r * 0.5} ${-3 * q}" stroke-width="${1.4 + 2.2 * q}" opacity="${(0.2 + 0.65 * q).toFixed(2)}"/><path d="M${x - 6} ${wl + 3} h${r + 12}" stroke-width="1.2" opacity="${(0.15 + 0.3 * q).toFixed(2)}"/>`;
    })
    .join("");
});
return svg;
