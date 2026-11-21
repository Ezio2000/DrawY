// 夜空：从深蓝到海平线的一抹暖光，星星各按各的节奏闪，一道淡淡的银河，
// 带光晕的月亮，远处岬角上还有一座小灯塔，按自己的灯质一闪一闪。
const { width: w, height: h, data: d } = api;
const H = h * d.horizon;
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const stars = [];
for (let i = 0; i < d.stars; i++) {
  const x = rnd() * w,
    y = Math.pow(rnd(), 1.5) * H * 0.9;
  const big = rnd() < 0.07;
  stars.push({ x, y, r: big ? 1.5 + rnd() * 0.8 : 0.45 + rnd() * 0.85, p: rnd() * 6.28, f: 0.5 + rnd() * 1.8, big });
}
// 银河：沿一条斜线撒很多极小的点
const dust = [];
for (let i = 0; i < 520; i++) {
  const u = rnd(),
    v = (rnd() + rnd() + rnd() - 1.5) * 0.55;
  const x = w * (0.18 + u * 0.78),
    y = H * (0.92 - u * 0.86) + v * 70;
  if (y > 0 && y < H * 0.95) dust.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.3 + rnd() * 0.55).toFixed(2)}"/>`);
}
const [mx, my, mr] = [d.moon[0] * w, d.moon[1] * h, d.moonSize];
// 远处岬角：一条低矮起伏的剪影
const land = [];
for (let x = 0; x <= w * 0.42; x += 12) {
  const y = H - 6 - 20 * Math.exp(-(((x - w * 0.12) / 120) ** 2)) - 9 * Math.sin(x / 37) * Math.exp(-x / 260) - 14 * Math.exp(-(((x - w * 0.3) / 60) ** 2));
  land.push(`${x.toFixed(0)} ${y.toFixed(1)}`);
}
const far = [w * 0.297, H - 22];

const svg = api.svg(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${d.top}"/>
      <stop offset=".5" stop-color="${d.middle}"/>
      <stop offset=".86" stop-color="${d.bottom}"/>
      <stop offset="1" stop-color="${d.dusk}"/>
    </linearGradient>
    <radialGradient id="halo"><stop offset="0" stop-color="#e9efff" stop-opacity=".55"/><stop offset=".25" stop-color="#c4d0f5" stop-opacity=".22"/><stop offset="1" stop-color="#9fb2ea" stop-opacity="0"/></radialGradient>
    <radialGradient id="moon" cx=".4" cy=".38"><stop offset="0" stop-color="#fffdf3"/><stop offset=".7" stop-color="#f0ecdc"/><stop offset="1" stop-color="#d9d6c8"/></radialGradient>
    <radialGradient id="mw" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#b9c6f0" stop-opacity=".16"/><stop offset="1" stop-color="#b9c6f0" stop-opacity="0"/></radialGradient>
    <radialGradient id="spark"><stop offset="0" stop-color="#fff6d8"/><stop offset=".3" stop-color="#ffd98a" stop-opacity=".6"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  <ellipse cx="${w * 0.6}" cy="${H * 0.5}" rx="${w * 0.5}" ry="70" fill="url(#mw)" transform="rotate(-24 ${w * 0.6} ${H * 0.5})"/>
  <g fill="#dfe6ff" opacity=".55">${dust.join("")}</g>
  <g class="stars"></g>
  <circle cx="${mx}" cy="${my}" r="${mr * 5}" fill="url(#halo)"/>
  <circle cx="${mx}" cy="${my}" r="${mr}" fill="url(#moon)"/>
  <g fill="#b9b39f" opacity=".28">
    <circle cx="${mx - mr * 0.3}" cy="${my - mr * 0.2}" r="${mr * 0.22}"/>
    <circle cx="${mx + mr * 0.28}" cy="${my + mr * 0.25}" r="${mr * 0.16}"/>
    <circle cx="${mx + mr * 0.1}" cy="${my - mr * 0.45}" r="${mr * 0.1}"/>
    <circle cx="${mx - mr * 0.42}" cy="${my + mr * 0.35}" r="${mr * 0.09}"/>
  </g>
  <path d="M0 ${H} L${land.join(" L")} L${w * 0.42} ${H} Z" fill="${d.land}"/>
  <rect x="${far[0] - 1.6}" y="${far[1] - 9}" width="3.2" height="10" fill="#2a3560"/>
  <circle class="far" cx="${far[0]}" cy="${far[1] - 10}" r="16" fill="url(#spark)"/>
</svg>`);

const group = svg.querySelector(".stars");
const dots = stars.map((s) => {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("transform", `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`);
  g.innerHTML = s.big
    ? `<circle r="${s.r}" fill="#fff"/><path d="M-${s.r * 5} 0H${s.r * 5}M0 -${s.r * 5}V${s.r * 5}" stroke="#e8eeff" stroke-width=".6" opacity=".7"/>`
    : `<circle r="${s.r}" fill="#f3f5ff"/>`;
  group.append(g);
  return g;
});
const farLight = svg.querySelector(".far");
// 远处那座灯塔：每 6 秒连闪两下
const flash = (t) => {
  const p = t % 6;
  return Math.max(Math.exp(-(((p - 0.4) / 0.12) ** 2)), Math.exp(-(((p - 1.3) / 0.12) ** 2)));
};
api.animate(() => {
  const t = performance.now() / 1000;
  dots.forEach((g, i) => {
    const s = stars[i];
    g.setAttribute("opacity", (0.45 + 0.55 * Math.abs(Math.sin(t * s.f * 0.6 + s.p))).toFixed(2));
  });
  const f = flash(t);
  farLight.setAttribute("opacity", (0.12 + 0.88 * f).toFixed(2));
  farLight.setAttribute("r", (6 + 12 * f).toFixed(1));
});
return svg;
