// 一张海图上的“两线定位”：两座灯塔各按自己的灯质闪；船上的人认出第一座，测方位，
// 在海图上画一条线；再认出第二座，再画一条——两条线相交的地方就是船。一轮演示一遍，
// 每走到一步就发出 step 事件，旁边的流程图跟着亮起对应的那一格。
const { width: W, height: H, data: d, theme: t } = api;
const ink = t.ink,
  muted = t.muted;
const flare = "#c2387e",
  land = "#efe4c4",
  water = "#e8f1f5";
const A = { x: d.a[0], y: d.a[1] },
  B = { x: d.b[0], y: d.b[1] },
  S = { x: d.ship[0], y: d.ship[1] };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
// 方位：从船看灯塔的真方位（北为 0°，顺时针）
const bearing = (L) => Math.round(((Math.atan2(L.x - S.x, -(L.y - S.y)) * 180) / Math.PI + 360) % 360);
const through = (L, f) => {
  const dx = S.x - L.x,
    dy = S.y - L.y,
    n = Math.hypot(dx, dy);
  return [L.x + (dx / n) * n * f, L.y + (dy / n) * n * f];
};
const coast = `M0 0 H${W} V${H * 0.12} C${W * 0.86} ${H * 0.16} ${W * 0.8} ${H * 0.1} ${B.x + 30} ${B.y + 18}
  C${B.x - 10} ${B.y + 34} ${W * 0.62} ${H * 0.3} ${W * 0.5} ${H * 0.27} C${W * 0.4} ${H * 0.24} ${W * 0.34} ${H * 0.36} ${A.x + 46} ${A.y + 6}
  C${A.x + 10} ${A.y + 26} ${A.x - 30} ${A.y + 14} 0 ${A.y + 40} Z`;
const contour = (k) =>
  `M0 ${A.y + 70 + k * 46} C${W * 0.25} ${A.y + 50 + k * 50} ${W * 0.42} ${H * 0.36 + k * 52} ${W * 0.6} ${H * 0.34 + k * 50} S${W * 0.9} ${H * 0.2 + k * 48} ${W} ${H * 0.18 + k * 48}`;
const soundings = [
  [60, 330, 8],
  [150, 380, 14],
  [330, 300, 11],
  [420, 360, 19],
  [90, 470, 22],
  [380, 470, 27],
  [200, 540, 31],
  [430, 560, 36],
  [300, 210, 6],
];
const rose = { x: 74, y: H - 86, r: 50 };

const svg = api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="flash"><stop offset="0" stop-color="#fff6d0"/><stop offset=".35" stop-color="#ffd36e" stop-opacity=".75"/><stop offset="1" stop-color="#ffd36e" stop-opacity="0"/></radialGradient>
    <marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${ink}"/></marker>
    <clipPath id="sheet"><rect x="10" y="10" width="${W - 20}" height="${H - 20}"/></clipPath>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="${ink}" stroke-width="1.4"/>
  <g clip-path="url(#sheet)">
    <rect width="${W}" height="${H}" fill="${water}"/>
    ${[0, 1, 2, 3].map((k) => `<path d="${contour(k)}" fill="none" stroke="#7fa7bb" stroke-width="1" stroke-dasharray="${k ? "6 5" : "none"}" opacity=".7"/>`).join("")}
    <path d="${coast}" fill="${land}" stroke="${ink}" stroke-width="1.4"/>
    <g font-size="13" fill="#5f7f90" font-style="italic">${soundings.map(([x, y, v]) => `<text x="${x}" y="${y}">${v}</text>`).join("")}</g>
    ${[0.25, 0.5, 0.75].map((f) => `<path d="M${W * f} 10 V${H - 10}" stroke="#7fa7bb" stroke-width=".6" opacity=".5"/><path d="M10 ${H * f} H${W - 10}" stroke="#7fa7bb" stroke-width=".6" opacity=".5"/>`).join("")}
    <g transform="translate(${rose.x} ${rose.y})" stroke="${flare}" fill="none" opacity=".75">
      <circle r="${rose.r}" stroke-width="1.2"/><circle r="${rose.r - 10}" stroke-width=".6"/>
      ${Array.from({ length: 36 }, (_, i) => {
        const a = (i * 10 * Math.PI) / 180;
        const r1 = rose.r - (i % 9 === 0 ? 14 : 6);
        return `<path d="M${r1 * Math.sin(a)} ${-r1 * Math.cos(a)} L${rose.r * Math.sin(a)} ${-rose.r * Math.cos(a)}" stroke-width="1"/>`;
      }).join("")}
      <path d="M0 ${-rose.r + 14} L6 0 L0 6 L-6 0 Z" fill="${flare}" stroke="none"/>
      <text y="${-rose.r - 6}" text-anchor="middle" font-size="15" fill="${flare}" stroke="none" font-weight="700">N</text>
    </g>
    <g class="lineA"><path class="la" d="" stroke="${ink}" stroke-width="2.2" marker-end="url(#tip)"/><text class="ta" font-size="17" font-weight="600" fill="${ink}" paint-order="stroke" stroke="${water}" stroke-width="5"></text></g>
    <g class="lineB"><path class="lb" d="" stroke="${ink}" stroke-width="2.2" marker-end="url(#tip)"/><text class="tb" font-size="17" font-weight="600" fill="${ink}" paint-order="stroke" stroke="${water}" stroke-width="5"></text></g>
    ${[A, B]
      .map(
        (L, i) => `<g transform="translate(${L.x} ${L.y})">
      <circle class="f${i}" r="44" fill="url(#flash)" opacity="0"/>
      <path d="M0 0 C6 -10 10 -26 4 -40 C-2 -26 -6 -12 0 0 Z" fill="${flare}" opacity=".85" transform="rotate(${i ? -35 : 35})"/>
      <circle r="5" fill="${ink}"/><circle r="2" fill="#fff"/>
      <text x="${i ? -12 : 12}" y="${i ? 26 : 26}" text-anchor="${i ? "end" : "start"}" font-size="16" font-weight="700" fill="${ink}">${esc(i ? d.bName : d.aName)}</text>
      <text x="${i ? -12 : 12}" y="${i ? 46 : 46}" text-anchor="${i ? "end" : "start"}" font-size="15" fill="${flare}" font-style="italic">${i ? "Fl 5s" : "Fl(2) 10s"}</text>
    </g>`,
      )
      .join("")}
    <g class="tag" opacity="0" transform="translate(${A.x + 4} ${A.y + 64})">
      <rect x="0" y="0" width="${d.tagW}" height="34" rx="6" fill="#fff" stroke="${ink}" stroke-width="1.2"/>
      <text x="12" y="23" font-size="16" fill="${ink}"></text>
    </g>
    <g class="unknown" transform="translate(${S.x + 70} ${S.y + 90})"><text font-size="44" font-weight="700" fill="${muted}" text-anchor="middle">?</text></g>
    <g class="fix" opacity="0" transform="translate(${S.x} ${S.y})">
      <circle class="ring" r="18" fill="none" stroke="${t.accent}" stroke-width="3"/>
      <path d="M-14 4 L14 4 L9 11 L-9 11 Z M0 4 V-14 L10 0 H0" fill="${ink}"/>
      <text x="26" y="-14" font-size="19" font-weight="700" fill="${t.accent}" paint-order="stroke" stroke="${water}" stroke-width="5">${esc(d.fixName)}</text>
    </g>
  </g>
  <text x="${W - 16}" y="${H - 16}" text-anchor="end" font-size="13" fill="${muted}">${esc(d.chartName)}</text>
</svg>`);
const f0 = svg.querySelector(".f0"),
  f1 = svg.querySelector(".f1");
const la = svg.querySelector(".la"),
  lb = svg.querySelector(".lb"),
  ta = svg.querySelector(".ta"),
  tb = svg.querySelector(".tb");
const tag = svg.querySelector(".tag"),
  tagText = tag.querySelector("text");
const unknown = svg.querySelector(".unknown"),
  fix = svg.querySelector(".fix"),
  ring = svg.querySelector(".ring");
const bA = bearing(A),
  bB = bearing(B);
// 每一步的开始时间（秒），一轮 d.loop 秒
const steps = d.steps;
const flashA = (s) => {
  const p = s % 10;
  return Math.max(Math.exp(-(((p - 0.3) / 0.12) ** 2)), Math.exp(-(((p - 1.2) / 0.12) ** 2)));
};
const flashB = (s) => Math.exp(-((((s % 5) - 0.3) / 0.12) ** 2));
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const line = (L, f) => {
  const [x, y] = through(L, f);
  return `M${L.x} ${L.y} L${x.toFixed(1)} ${y.toFixed(1)}`;
};
let step = -1;
const begin = performance.now();
api.animate(() => {
  const now = (performance.now() - begin) / 1000;
  const s = now % d.loop;
  let i = steps.length - 1;
  while (i > 0 && s < steps[i]) i--;
  if (i !== step) {
    step = i;
    void api.emit("step", { index: i });
  }
  f0.setAttribute("opacity", flashA(now).toFixed(2));
  f1.setAttribute("opacity", (s >= steps[6] ? flashB(now) : 0.15 * flashB(now)).toFixed(2));
  // 认出 A：灯标表上的那一行
  const showTag = s >= steps[2] && s < steps[5];
  tag.setAttribute("opacity", showTag ? "1" : "0");
  tagText.textContent = s >= steps[3] ? d.tagYes : d.tagLook;
  // 方位线 A、B 依次画出来
  const ga = ease((s - steps[4]) / (steps[5] + 1.2 - steps[4]));
  la.setAttribute("d", ga > 0 ? line(A, 0.15 + 1.25 * ga) : "");
  ta.textContent = ga > 0.6 ? `${bA}°` : "";
  const mid = through(A, 0.55);
  ta.setAttribute("x", mid[0] + 10);
  ta.setAttribute("y", mid[1]);
  const gb = ease((s - steps[6] - 0.8) / 2.2);
  lb.setAttribute("d", gb > 0 ? line(B, 0.15 + 1.25 * gb) : "");
  tb.textContent = gb > 0.6 ? `${bB}°` : "";
  const midB = through(B, 0.55);
  tb.setAttribute("x", midB[0] + 10);
  tb.setAttribute("y", midB[1]);
  const fx = ease((s - steps[7]) / 0.6);
  fix.setAttribute("opacity", fx.toFixed(2));
  unknown.setAttribute("opacity", (1 - fx).toFixed(2));
  ring.setAttribute("r", (18 + 6 * Math.sin(now * 4) * fx).toFixed(1));
});
return svg;
