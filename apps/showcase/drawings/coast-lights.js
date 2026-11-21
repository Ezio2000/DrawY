// 苏格兰海岸上的灯塔，按建成的年份一盏一盏亮起来。地图本身由下面的地图模块画；
// 这一层用和它一样的投影，把每座灯塔放到它真正的经纬度上：已经建成的发光、光束在
// 转，还没建的只留一个淡淡的圈。颜色是造它的人。右边是年份、各人造了几座、
// 以及当下选中的那一座的故事；底下的时间轴可以拖，没人碰时自己从头播放。
const { width: W, height: H, data: d, theme: t } = api;
const M = d.map,
  [west, south, east, north] = M.bounds;
const lights = d.lights || [],
  builders = d.builders || [];
const ink = t.ink,
  muted = t.muted;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
// 和地图模块相同的等距圆柱投影：经度按中纬度的余弦缩短，再撑满模块的宽高比
const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
let x0 = west * k,
  x1 = east * k,
  y0 = -north,
  y1 = -south;
const want = M.w / M.h;
if ((x1 - x0) / (y1 - y0) < want) {
  const g = ((y1 - y0) * want - (x1 - x0)) / 2;
  x0 -= g;
  x1 += g;
} else {
  const g = ((x1 - x0) / want - (y1 - y0)) / 2;
  y0 -= g;
  y1 += g;
}
const s = M.w / (x1 - x0);
const place = (lon, lat) => [M.x + (lon * k - x0) * s, M.y + (-lat - y0) * s];

const [from, to] = d.years;
const T = { x: d.timeline[0], y: d.timeline[1], w: d.timeline[2] };
const tx = (year) => T.x + ((year - from) / (to - from)) * T.w;
const P = { x: d.panel[0], y: d.panel[1] };

const svg = api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible">
  <defs>
    <radialGradient id="glow"><stop offset="0" stop-color="#fff3c4" stop-opacity=".95"/><stop offset=".35" stop-color="#ffcf5a" stop-opacity=".45"/><stop offset="1" stop-color="#ffcf5a" stop-opacity="0"/></radialGradient>
    <linearGradient id="beam" x1="0" x2="1"><stop offset="0" stop-color="#ffcf5a" stop-opacity=".8"/><stop offset="1" stop-color="#ffcf5a" stop-opacity="0"/></linearGradient>
  </defs>
  <g class="lights"></g>
  <g class="panel" transform="translate(${P.x} ${P.y})">
    <text class="year" y="0" font-size="96" font-weight="700" fill="${ink}" font-variant-numeric="tabular-nums"></text>
    <text class="count" x="268" y="-14" font-size="22" fill="${muted}"></text>
    <g class="legend" transform="translate(0 46)"></g>
    <g class="card" transform="translate(0 ${d.cardY})">
      <rect x="-2" y="-6" width="4" height="150" class="bar"/>
      <text class="name" x="22" y="26" font-size="30" font-weight="600" fill="${ink}"></text>
      <text class="meta" x="22" y="58" font-size="17"></text>
      <foreignObject x="20" y="74" width="${d.cardW}" height="110"><div xmlns="http://www.w3.org/1999/xhtml" class="story"></div></foreignObject>
    </g>
  </g>
  <g class="timeline" data-interactive style="cursor:ew-resize">
    <rect x="${T.x - 16}" y="${T.y - 34}" width="${T.w + 32}" height="64" fill="transparent"/>
    <path d="M${T.x} ${T.y} H${T.x + T.w}" stroke="${muted}" stroke-width="2"/>
    ${lights.map((l) => `<path d="M${tx(l.year)} ${T.y - 9} V${T.y + 9}" stroke="${builders[l.by].color}" stroke-width="3"/>`).join("")}
    ${[1790, 1820, 1850, 1880].map((y) => `<text x="${tx(y)}" y="${T.y + 30}" text-anchor="middle" font-size="15" fill="${muted}">${y}</text>`).join("")}
    <path class="done" d="" stroke="${ink}" stroke-width="3"/>
    <g class="head"><circle r="9" fill="${ink}"/><circle r="3.5" fill="#fff"/></g>
  </g>
</svg>`);
const NS = "http://www.w3.org/2000/svg";
const group = svg.querySelector(".lights");
const marks = lights.map((l, i) => {
  const [x, y] = place(l.lon, l.lat);
  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  g.setAttribute("data-interactive", "");
  g.style.cursor = "pointer";
  const c = builders[l.by].color;
  const [lx, ly, anchor] = { left: [-12, 5, "end"], right: [12, 5, "start"], above: [0, -14, "middle"], below: [0, 24, "middle"] }[l.side || "right"];
  g.innerHTML = `<circle class="glow" r="26" fill="url(#glow)"/>
    <g class="beam"><path d="M0 -2 L34 -7 L34 7 L0 2 Z" fill="url(#beam)"/><path d="M0 -2 L34 -7 L34 7 L0 2 Z" fill="url(#beam)" transform="rotate(180)"/></g>
    <circle class="ring" r="13" fill="none" stroke="${ink}" stroke-width="2"/>
    <circle class="dot" r="6.5" fill="${c}" stroke="#fff" stroke-width="2"/>
    <text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="16" font-weight="600" fill="${ink}" paint-order="stroke" stroke="#fff" stroke-width="4" stroke-linejoin="round">${esc(l.name)}</text>
    <circle r="16" fill="transparent"/>`;
  group.append(g);
  return { g, glow: g.querySelector(".glow"), beam: g.querySelector(".beam"), ring: g.querySelector(".ring"), dot: g.querySelector(".dot"), text: g.querySelector("text"), phase: i * 0.77 };
});
const legend = svg.querySelector(".legend");
const rows = builders.map((b, i) => {
  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", `translate(${(i % 2) * 300} ${Math.floor(i / 2) * 34})`);
  g.innerHTML = `<circle cx="8" cy="-6" r="7" fill="${b.color}"/><text x="24" y="0" font-size="18" fill="${ink}">${esc(b.name)}</text><text class="n" x="282" y="0" text-anchor="end" font-size="18" font-weight="700" fill="${b.color}"></text>`;
  legend.append(g);
  return g.querySelector(".n");
});
const yearText = svg.querySelector(".year"),
  count = svg.querySelector(".count");
const name = svg.querySelector(".name"),
  meta = svg.querySelector(".meta"),
  story = svg.querySelector(".story"),
  bar = svg.querySelector(".bar");
Object.assign(story.style, { font: `19px/1.65 ${t.font}`, color: ink });
const head = svg.querySelector(".head"),
  done = svg.querySelector(".done");

let year = from,
  picked = -1,
  playing = true,
  start = performance.now(),
  shown = -2;
const lit = (l) => l.year <= year;
const show = (i) => {
  if (i === shown) return;
  shown = i;
  const l = lights[i];
  if (!l) {
    name.textContent = d.emptyName;
    meta.textContent = "";
    story.textContent = d.emptyStory;
    bar.setAttribute("fill", muted);
    return;
  }
  const b = builders[l.by];
  name.textContent = l.name;
  meta.innerHTML = `<tspan fill="${b.color}" font-weight="600">${l.year}</tspan><tspan fill="${muted}"> · ${esc(b.name)}</tspan>`;
  story.textContent = l.story;
  bar.setAttribute("fill", b.color);
};
const setYear = (y) => {
  year = Math.round(Math.max(from, Math.min(to, y)));
  yearText.textContent = String(year);
  const on = lights.filter(lit);
  count.textContent = d.countText.replace("{n}", on.length);
  rows.forEach((n, i) => (n.textContent = String(on.filter((l) => l.by === i).length)));
  head.setAttribute("transform", `translate(${tx(year)} ${T.y})`);
  done.setAttribute("d", `M${T.x} ${T.y} H${tx(year)}`);
  // 选中的那一座；没选的话，是最近亮起的那一座
  const latest = lights.reduce((best, l, i) => (lit(l) && (best < 0 || l.year >= lights[best].year) ? i : best), -1);
  show(picked >= 0 ? picked : latest);
};
marks.forEach((m, i) =>
  m.g.addEventListener("click", () => {
    playing = false;
    picked = i;
    if (!lit(lights[i])) setYear(lights[i].year);
    shown = -2;
    setYear(year);
  }),
);
const line = svg.querySelector(".timeline");
const scrub = (e) => {
  const box = svg.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * W;
  playing = false;
  picked = -1;
  setYear(from + ((x - T.x) / T.w) * (to - from));
};
line.addEventListener("pointerdown", (e) => {
  line.setPointerCapture(e.pointerId);
  scrub(e);
  const move = (ev) => scrub(ev);
  const up = () => {
    line.removeEventListener("pointermove", move);
    line.removeEventListener("pointerup", up);
  };
  line.addEventListener("pointermove", move);
  line.addEventListener("pointerup", up);
});
setYear(from);
api.animate(() => {
  const now = performance.now();
  if (playing) {
    // 从头播一遍要 d.play 秒，播完停一会儿再来
    const p = ((now - start) / 1000) % (d.play + d.hold);
    const y = from + Math.min(1, p / d.play) * (to - from);
    if (Math.round(y) !== year) setYear(y);
  }
  const sec = now / 1000;
  marks.forEach((m, i) => {
    const on = lit(lights[i]);
    const age = on ? Math.min(1, (year - lights[i].year + 1) / 3) : 0;
    m.glow.setAttribute("opacity", on ? (0.55 + 0.45 * Math.sin(sec * 2 + m.phase)) * (0.6 + 0.4 * age) : 0);
    m.beam.setAttribute("opacity", on ? "1" : "0");
    m.beam.setAttribute("transform", `rotate(${((sec * 40 + m.phase * 60) % 360).toFixed(1)})`);
    m.dot.setAttribute("opacity", on ? "1" : "0.35");
    m.text.setAttribute("opacity", on ? "1" : "0.45");
    m.ring.setAttribute("opacity", i === shown ? "1" : "0");
  });
});
return svg;
