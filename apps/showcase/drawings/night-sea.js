// 夜里的海：越近浪越大，一排排浪尖带着月光；月亮和灯塔各在海面上拖出一条碎光，
// 灯塔那条跟着光束转——光正对着我们时，它最亮。
const { width: w, height: h, data: d } = api;
const rows = d.rows;
let seed = 5;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const glints = (x0, color, n, spread) =>
  Array.from({ length: n }, () => {
    const v = rnd() ** 1.25;
    const y = 4 + v * (h - 10);
    const half = spread * (0.25 + v * 1.2) * (0.5 + rnd());
    const x = x0 + (rnd() - 0.5) * spread * (0.6 + v * 2.4);
    return { x, y, half, p: rnd() * 6.28, f: 0.8 + rnd() * 1.6, color };
  });
const moon = glints(d.moonX, "#dfe6ff", 70, 26);
const lamp = glints(d.lampX, "#ffd88f", 90, 22);

const svg = api.svg(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${d.near}"/><stop offset=".05" stop-color="${d.top}"/><stop offset="1" stop-color="${d.bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sea)"/>
  <g class="waves" fill="none" stroke-linecap="round"></g>
  <g class="moon"></g>
  <g class="lamp"></g>
</svg>`);
const waves = svg.querySelector(".waves");
const paths = Array.from({ length: rows }, (_, j) => {
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const v = (j + 1) / rows;
  p.setAttribute("stroke", j % 3 === 0 ? "#8ea3dc" : "#5d70ad");
  p.setAttribute("stroke-width", (0.6 + v * 2.2).toFixed(2));
  p.setAttribute("opacity", (0.18 + v * 0.45).toFixed(2));
  p.setAttribute("stroke-dasharray", `${(30 + v * 140).toFixed(0)} ${(20 + v * 90).toFixed(0)}`);
  waves.append(p);
  return p;
});
const strokes = (group, list) =>
  list.map((g) => {
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l.setAttribute("stroke", g.color);
    l.setAttribute("stroke-linecap", "round");
    l.setAttribute("stroke-width", (1 + (g.y / h) * 2.2).toFixed(2));
    group.append(l);
    return l;
  });
const moonLines = strokes(svg.querySelector(".moon"), moon);
const lampLines = strokes(svg.querySelector(".lamp"), lamp);
api.animate(() => {
  const t = performance.now() / 1000;
  paths.forEach((p, j) => {
    const v = (j + 1) / rows;
    const y0 = 3 + (h - 6) * v ** 1.8;
    const len = 60 + v * 260,
      amp = 1 + v * 7,
      sp = (j % 2 ? 1 : -1) * (6 + v * 18);
    let s = "";
    for (let x = -20; x <= w + 20; x += 16) {
      const y = y0 + amp * Math.sin((x + t * sp) / len * 6.28 + j * 1.7);
      s += (s ? "L" : "M") + x.toFixed(0) + " " + y.toFixed(1);
    }
    p.setAttribute("d", s);
    p.setAttribute("stroke-dashoffset", (t * sp * 2).toFixed(1));
  });
  // 灯塔的两束光背对背转，一圈 period 秒；朝向我们时海面上的倒影最亮
  const c = Math.cos((2 * Math.PI * t) / d.period);
  const facing = Math.max(c, -c) ** 10;
  const shimmer = (lines, list, gain) =>
    lines.forEach((l, i) => {
      const g = list[i];
      const wob = Math.sin(t * g.f + g.p);
      const half = g.half * (0.6 + 0.4 * wob);
      l.setAttribute("x1", (g.x - half).toFixed(1));
      l.setAttribute("x2", (g.x + half).toFixed(1));
      l.setAttribute("y1", g.y.toFixed(1));
      l.setAttribute("y2", g.y.toFixed(1));
      l.setAttribute("opacity", Math.max(0, (0.15 + 0.85 * Math.max(0, wob)) * gain * (1 - (g.y / h) * 0.35)).toFixed(2));
    });
  shimmer(moonLines, moon, 0.75);
  shimmer(lampLines, lamp, 0.35 + 0.65 * facing);
});
return svg;
