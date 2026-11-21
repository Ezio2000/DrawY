// 灯为什么一闪一闪：从上往下看灯室，几块透镜各射出一束光，跟着转台一起转；光束
// 扫过远处那条船时，船上的人看见一闪。右边是船上看到的亮度，最近 30 秒像走纸一样
// 记下来；下面把这个节奏写成灯质——海图上就靠它认出是哪一座灯塔。
const { width: W, height: H, data: d, theme: t } = api;
const C = { x: d.center[0], y: d.center[1] },
  R = d.radius;
const panels = (d.panels || [0]).map(Number);
const period = Math.max(1, Number(d.period));
const sigma = 3.2;
const ink = t.ink,
  muted = t.muted,
  amber = d.light,
  night = d.night;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
// 船在正东方向；转台顺时针转，一圈 period 秒
const seen = (s) => {
  const turn = (360 * s) / period;
  let b = 0;
  for (const p of panels) b += Math.exp(-((wrap(p + turn - d.ship) / sigma) ** 2));
  return Math.min(1, b);
};
// 灯质：靠得近的透镜算一组，一组里几块就连闪几下
const sorted = [...panels].map((p) => ((p % 360) + 360) % 360).sort((a, b) => a - b);
const groups = [];
sorted.forEach((p, i) => {
  if (i && p - sorted[i - 1] < 40) groups[groups.length - 1].push(p);
  else groups.push([p]);
});
if (groups.length > 1 && sorted[0] + 360 - sorted[sorted.length - 1] < 40) groups[0].push(...groups.pop());
const per = groups[0]?.length ?? 1;
const every = period / groups.length;
const secs = Number.isInteger(+every.toFixed(1)) ? every.toFixed(0) : every.toFixed(1);
const character = per === 1 ? `Fl ${secs}s` : `Fl(${per}) ${secs}s`;
const words = (per === 1 ? d.say1 : d.sayN).replace("{s}", secs).replace("{k}", per);

const chart = { x: d.chart[0], y: d.chart[1], w: d.chart[2], h: d.chart[3] };
const span = 30;
const svg = api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="sea" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${night}"/><stop offset=".85" stop-color="${night}"/><stop offset="1" stop-color="${night}" stop-opacity="0"/></radialGradient>
    <radialGradient id="beam" gradientUnits="userSpaceOnUse" cx="${C.x}" cy="${C.y}" r="${R}"><stop offset=".12" stop-color="${amber}" stop-opacity=".95"/><stop offset=".6" stop-color="${amber}" stop-opacity=".35"/><stop offset="1" stop-color="${amber}" stop-opacity="0"/></radialGradient>
    <radialGradient id="flash"><stop offset="0" stop-color="#fff7dc"/><stop offset=".3" stop-color="${amber}" stop-opacity=".7"/><stop offset="1" stop-color="${amber}" stop-opacity="0"/></radialGradient>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${amber}" stop-opacity=".45"/><stop offset="1" stop-color="${amber}" stop-opacity=".04"/></linearGradient>
    <clipPath id="disk"><circle cx="${C.x}" cy="${C.y}" r="${R}"/></clipPath>
  </defs>
  <circle cx="${C.x}" cy="${C.y}" r="${R + 12}" fill="none" stroke="${night}" stroke-opacity=".18" stroke-width="2"/>
  <circle cx="${C.x}" cy="${C.y}" r="${R}" fill="${night}"/>
  <g clip-path="url(#disk)" fill="none" stroke="#8ea3d8" stroke-opacity=".18">
    ${[0.35, 0.6, 0.85].map((f) => `<circle cx="${C.x}" cy="${C.y}" r="${R * f}" stroke-dasharray="3 7"/>`).join("")}
    ${Array.from({ length: 26 }, (_, i) => {
      const a = i * 2.39,
        r = R * (0.2 + ((i * 37) % 80) / 100);
      const x = C.x + r * Math.cos(a),
        y = C.y + r * Math.sin(a);
      return `<path d="M${x - 9} ${y} q4.5 -4 9 0 t9 0" stroke-width="1.4"/>`;
    }).join("")}
  </g>
  <g class="beams" clip-path="url(#disk)"></g>
  <circle cx="${C.x}" cy="${C.y}" r="56" fill="#24305a" stroke="#c9d3f0" stroke-width="1.5"/>
  ${Array.from({ length: 8 }, (_, i) => `<path d="M${C.x + 50 * Math.cos((i * Math.PI) / 4)} ${C.y + 50 * Math.sin((i * Math.PI) / 4)} L${C.x + 56 * Math.cos((i * Math.PI) / 4)} ${C.y + 56 * Math.sin((i * Math.PI) / 4)}" stroke="#c9d3f0" stroke-width="2"/>`).join("")}
  <g class="table"></g>
  <circle cx="${C.x}" cy="${C.y}" r="7" fill="#fff4cf"/>
  <g transform="translate(${C.x + R * 0.82} ${C.y})">
    <circle class="seen" r="46" fill="url(#flash)" opacity="0"/>
    <path d="M-20 -7 H12 L22 0 L12 7 H-20 Z" fill="#e9edf7" stroke="#0b1226" stroke-width="1.4"/>
    <rect x="-10" y="-4" width="12" height="8" fill="#8f9bc0"/>
    <text y="34" text-anchor="middle" font-size="17" fill="#e7ecfb">${esc(d.shipName)}</text>
  </g>
  <text x="${C.x}" y="${C.y - R - 18}" text-anchor="middle" font-size="18" fill="${muted}">${esc(d.planName)}</text>
  <path d="M${C.x - R * 0.42} ${C.y - R * 0.86} A ${R * 0.95} ${R * 0.95} 0 0 1 ${C.x + R * 0.42} ${C.y - R * 0.86}" fill="none" stroke="${muted}" stroke-width="1.4" marker-end="url(#arr)"/>
  <defs><marker id="arr" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${muted}"/></marker></defs>

  <text x="${chart.x}" y="${chart.y - 44}" font-size="22" font-weight="600" fill="${ink}">${esc(d.chartName)}</text>
  <text x="${chart.x}" y="${chart.y - 18}" font-size="16" fill="${muted}">${esc(d.chartNote)}</text>
  <rect x="${chart.x}" y="${chart.y}" width="${chart.w}" height="${chart.h}" fill="${night}" rx="6"/>
  ${Array.from({ length: 7 }, (_, i) => {
    const x = chart.x + (chart.w * i) / 6;
    return `<path d="M${x} ${chart.y} V${chart.y + chart.h}" stroke="#8ea3d8" stroke-opacity=".18"/>
      <text x="${x}" y="${chart.y + chart.h + 24}" text-anchor="${i === 0 ? "start" : i === 6 ? "end" : "middle"}" font-size="15" fill="${muted}">${i === 6 ? esc(d.nowName) : `−${span - i * 5}s`}</text>`;
  }).join("")}
  <path class="area" fill="url(#fill)"/>
  <path class="trace" fill="none" stroke="${amber}" stroke-width="2.4" stroke-linejoin="round"/>
  <circle class="dot" r="6" fill="#fff4cf" cx="${chart.x + chart.w}"/>

  <text x="${chart.x}" y="${chart.y + chart.h + 92}" font-size="36" font-weight="700" fill="${ink}">${esc(words)}</text>
  <text x="${chart.x}" y="${chart.y + chart.h + 126}" font-size="18" fill="${muted}">${esc(d.codeName)} <tspan font-weight="700" fill="${t.accent}" font-size="22">${character}</tspan></text>
</svg>`);
const NS = "http://www.w3.org/2000/svg";
const beams = panels.map(() => {
  const p = document.createElementNS(NS, "path");
  p.setAttribute("fill", "url(#beam)");
  svg.querySelector(".beams").append(p);
  return p;
});
const table = svg.querySelector(".table");
const faces = panels.map(() => {
  const p = document.createElementNS(NS, "path");
  p.setAttribute("stroke", "#fff4cf");
  p.setAttribute("stroke-width", "4");
  p.setAttribute("stroke-linecap", "round");
  table.append(p);
  return p;
});
const seenGlow = svg.querySelector(".seen"),
  trace = svg.querySelector(".trace"),
  area = svg.querySelector(".area"),
  dot = svg.querySelector(".dot");
const yOf = (b) => chart.y + chart.h - 14 - b * (chart.h - 34);
api.animate(() => {
  const s = performance.now() / 1000;
  const turn = (360 * s) / period;
  panels.forEach((p, i) => {
    const a = ((p + turn) * Math.PI) / 180,
      w = (5 * Math.PI) / 180;
    const r0 = 40;
    beams[i].setAttribute(
      "d",
      `M${C.x + r0 * Math.cos(a - w * 0.6)} ${C.y + r0 * Math.sin(a - w * 0.6)} L${C.x + R * Math.cos(a - w)} ${C.y + R * Math.sin(a - w)} L${C.x + R * Math.cos(a + w)} ${C.y + R * Math.sin(a + w)} L${C.x + r0 * Math.cos(a + w * 0.6)} ${C.y + r0 * Math.sin(a + w * 0.6)} Z`,
    );
    const nx = Math.cos(a),
      ny = Math.sin(a);
    faces[i].setAttribute("d", `M${C.x + 34 * nx - 12 * ny} ${C.y + 34 * ny + 12 * nx} L${C.x + 34 * nx + 12 * ny} ${C.y + 34 * ny - 12 * nx}`);
  });
  const now = seen(s);
  seenGlow.setAttribute("opacity", now.toFixed(3));
  let path = "";
  const N = 600;
  for (let i = 0; i <= N; i++) {
    const tt = s - span + (span * i) / N;
    path += (i ? "L" : "M") + (chart.x + (chart.w * i) / N).toFixed(1) + " " + yOf(seen(tt)).toFixed(1);
  }
  trace.setAttribute("d", path);
  area.setAttribute("d", `${path} L${chart.x + chart.w} ${chart.y + chart.h} L${chart.x} ${chart.y + chart.h} Z`);
  dot.setAttribute("cy", yOf(now).toFixed(1));
  dot.setAttribute("r", (5 + 7 * now).toFixed(1));
});
return svg;
