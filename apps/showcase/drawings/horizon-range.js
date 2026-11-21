// 能看多远：地球是圆的，灯再亮，过了海平线也看不见。上半张把地球的弯曲夸大了画：
// 灯和船上的人各自看到自己的海平线，两段加起来就是最远的距离，视线正好擦过海面。
// 下半张是这个距离随灯高变化的曲线，几座真实的灯塔落在线上。距离按几何算：
// d ≈ 3.57 × (√H + √h) 公里（H、h 以米计），不算大气折射。
const { width: W, height: H, data: d, theme: t } = api;
const lamp = Math.max(1, Number(d.H)),
  eye = Math.max(0.5, Number(d.h));
const km = (m) => 3.57 * Math.sqrt(m);
const d1 = km(lamp),
  d2 = km(eye),
  D = d1 + d2;
const ink = t.ink,
  muted = t.muted,
  sea = d.sea || t.accent,
  amber = d.light;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const fmt = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

// —— 上半张：弯曲的海面 ——
const k = d.pxPerKm,
  Rv = d.earth;
const yT = d.horizonY,
  xT = d.left + d1 * k;
const cx = xT,
  cy = yT + Rv;
const at = (s, up = 0) => {
  const a = s / Rv;
  return [cx + (Rv + up) * Math.sin(a), cy - (Rv + up) * Math.cos(a), a];
};
const phiL = (-d1 * k) / Rv,
  phiS = (d2 * k) / Rv;
const Hv = Rv / Math.cos(phiL) - Rv,
  hv = Rv / Math.cos(phiS) - Rv;
const [bx, by] = at(-d1 * k);
const [sx, sy] = at(d2 * k);
const lampAt = [cx + (Rv + Hv) * Math.sin(phiL), cy - (Rv + Hv) * Math.cos(phiL)];
const eyeAt = [cx + (Rv + hv) * Math.sin(phiS), cy - (Rv + hv) * Math.cos(phiS)];
const tiltL = (phiL * 180) / Math.PI,
  tiltS = (phiS * 180) / Math.PI;
const towerH = Math.max(14, Hv),
  tw = Math.max(5, Math.min(12, towerH * 0.12));
const arcFrom = at(-xT - 60),
  arcTo = at(W - xT + 40);
const surface = `M${arcFrom[0]} ${arcFrom[1]} A ${Rv} ${Rv} 0 0 1 ${arcTo[0]} ${arcTo[1]}`;
// 海平线之外、视线之下：从灯那里看不见的地方
const shadow = `M${xT} ${yT} L${W + 40} ${yT} L${arcTo[0]} ${arcTo[1]} A ${Rv} ${Rv} 0 0 0 ${xT} ${yT} Z`;
const brace = (s0, s1, label, below) => {
  const a = at(s0, -14),
    b = at(s1, -14),
    m = at((s0 + s1) / 2, -38);
  return `<path d="M${a[0]} ${a[1]} A ${Rv - 14} ${Rv - 14} 0 0 1 ${b[0]} ${b[1]}" fill="none" stroke="${ink}" stroke-width="1.3"/>
    <path d="M${a[0]} ${a[1] - 6} v12 M${b[0]} ${b[1] - 6} v12" stroke="${ink}" stroke-width="1.3"/>
    <text x="${m[0]}" y="${m[1] + 8}" text-anchor="middle" font-size="19" font-weight="600" fill="${ink}">${label}</text>`;
};

// —— 下半张：距离随灯高的曲线 ——
const P = { x: d.plot[0], y: d.plot[1], w: d.plot[2], h: d.plot[3] };
const maxH = 150,
  maxD = 70;
const px = (m) => P.x + (m / maxH) * P.w,
  py = (v) => P.y + P.h - (v / maxD) * P.h;
let curve = "";
for (let m = 0; m <= maxH; m += 1) curve += (m ? "L" : "M") + px(m).toFixed(1) + " " + py(km(m) + d2).toFixed(1);
const refs = (d.refs || []).map((r) => {
  const x = px(r.m),
    y = py(km(r.m) + d2);
  return `<circle cx="${x}" cy="${y}" r="4.5" fill="#fff" stroke="${ink}" stroke-width="1.4"/>
    <text x="${x + (r.side === "left" ? -10 : 10)}" y="${y + (r.dy ?? 22)}" text-anchor="${r.side === "left" ? "end" : "start"}" font-size="15" fill="${muted}">${esc(r.name)} ${r.m} m</text>`;
});

const svg = api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:hidden">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sea}" stop-opacity=".55"/><stop offset="1" stop-color="${sea}" stop-opacity=".08"/></linearGradient>
    <linearGradient id="ray" gradientUnits="userSpaceOnUse" x1="${lampAt[0]}" x2="${eyeAt[0]}"><stop offset="0" stop-color="${amber}"/><stop offset="1" stop-color="${amber}" stop-opacity=".55"/></linearGradient>
    <pattern id="hide" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0 V8" stroke="${muted}" stroke-width="1" opacity=".35"/></pattern>
    <radialGradient id="glow"><stop offset="0" stop-color="${amber}" stop-opacity=".9"/><stop offset="1" stop-color="${amber}" stop-opacity="0"/></radialGradient>
  </defs>
  <path d="${surface} L${W + 60} ${H} L-60 ${H} Z" fill="url(#sea)"/>
  <path d="${surface}" fill="none" stroke="${sea}" stroke-width="2"/>
  <g transform="translate(${bx} ${by}) rotate(${tiltL})">
    <path d="M${-tw} 0 L${-tw * 0.62} ${-towerH} L${tw * 0.62} ${-towerH} L${tw} 0 Z" fill="#fff" stroke="${ink}" stroke-width="1.4"/>
    ${[0.25, 0.55].map((f) => `<path d="M${-tw * (1 - 0.38 * f)} ${-towerH * f} L${tw * (1 - 0.38 * f)} ${-towerH * f} L${tw * (1 - 0.38 * (f + 0.14))} ${-towerH * (f + 0.14)} L${-tw * (1 - 0.38 * (f + 0.14))} ${-towerH * (f + 0.14)} Z" fill="${t.accent2}"/>`).join("")}
    <rect x="${-tw * 0.75}" y="${-towerH - tw * 1.1}" width="${tw * 1.5}" height="${tw * 1.1}" fill="#ffe7a3" stroke="${ink}" stroke-width="1.2"/>
    <path d="M${-tw * 0.85} ${-towerH - tw * 1.1} Q0 ${-towerH - tw * 2} ${tw * 0.85} ${-towerH - tw * 1.1} Z" fill="${ink}"/>
  </g>
  <circle class="glow" cx="${lampAt[0]}" cy="${lampAt[1]}" r="26" fill="url(#glow)"/>
  <path d="${shadow}" fill="url(#hide)"/>
  <text x="${Math.min(W - 30, xT + (d2 * k) / 2 + 120)}" y="${yT + 50}" text-anchor="middle" font-size="15" fill="${muted}">${esc(d.hiddenName)}</text>
  <path d="M${lampAt[0]} ${lampAt[1]} L${eyeAt[0]} ${eyeAt[1]}" stroke="url(#ray)" stroke-width="3"/>
  <path class="pulse" d="M${lampAt[0]} ${lampAt[1]} L${eyeAt[0]} ${eyeAt[1]}" stroke="#fff6d8" stroke-width="3" stroke-dasharray="18 400" stroke-linecap="round"/>
  <circle cx="${xT}" cy="${yT}" r="5" fill="${ink}"/>
  <text x="${xT}" y="${yT - 14}" text-anchor="middle" font-size="16" fill="${ink}">${esc(d.horizonName)}</text>
  <g transform="translate(${sx} ${sy}) rotate(${tiltS})">
    <path d="M-16 0 L16 0 L11 7 L-11 7 Z" fill="${ink}"/>
    <path d="M0 0 V${-Math.max(10, hv)}" stroke="${ink}" stroke-width="1.6"/>
    <path d="M0 ${-Math.max(10, hv) + 4} L0 -3 L-12 -3 Z" fill="#fff" stroke="${ink}" stroke-width="1"/>
    <circle cy="${-Math.max(10, hv)}" r="3.6" fill="${t.accent}"/>
  </g>
  <text x="${Math.max(12, lampAt[0] - 30)}" y="${yT - 26}" font-size="18" fill="${ink}">${esc(d.lampName)} <tspan font-weight="700">${fmt(lamp)} m</tspan></text>
  <text x="${sx + 22}" y="${sy - Math.max(10, hv) - 12}" font-size="18" fill="${ink}">${esc(d.eyeName)} <tspan font-weight="700">${fmt(eye)} m</tspan></text>
  ${brace(-d1 * k, 0, `${fmt(d1)} km`)}
  ${brace(0, d2 * k, `${fmt(d2)} km`)}

  <rect x="0" y="${P.y - 56}" width="${W}" height="${H - P.y + 56}" fill="#fff"/>
  <path d="M0 ${P.y - 56} H${W}" stroke="${muted}" stroke-opacity=".25"/>
  <text x="${P.x}" y="${P.y - 22}" font-size="20" font-weight="600" fill="${ink}">${esc(d.plotName)}</text>
  ${[0, 20, 40, 60].map((v) => `<path d="M${P.x} ${py(v)} H${P.x + P.w}" stroke="${muted}" stroke-opacity=".2"/><text x="${P.x - 10}" y="${py(v) + 5}" text-anchor="end" font-size="14" fill="${muted}">${v}</text>`).join("")}
  ${[0, 50, 100, 150].map((m) => `<text x="${px(m)}" y="${P.y + P.h + 22}" text-anchor="middle" font-size="14" fill="${muted}">${m} m</text>`).join("")}
  <text x="${P.x - 10}" y="${P.y - 2}" text-anchor="end" font-size="14" fill="${muted}">km</text>
  <path d="M${P.x} ${P.y} V${P.y + P.h} H${P.x + P.w}" fill="none" stroke="${ink}" stroke-width="1.3"/>
  <path d="${curve}" fill="none" stroke="${sea}" stroke-width="3"/>
  ${refs.join("")}
  <path d="M${px(Math.min(lamp, maxH))} ${P.y + P.h} V${py(Math.min(maxD, D))} H${P.x}" stroke="${t.accent}" stroke-width="1.4" stroke-dasharray="4 4" fill="none"/>
  <circle cx="${px(Math.min(lamp, maxH))}" cy="${py(Math.min(maxD, D))}" r="8" fill="${t.accent}" stroke="#fff" stroke-width="2.5"/>

  <text x="${d.readout[0]}" y="${d.readout[1]}" font-size="20" fill="${muted}">${esc(d.farName)}</text>
  <text x="${d.readout[0]}" y="${d.readout[1] + 62}" font-size="64" font-weight="700" fill="${ink}">${fmt(D)}<tspan font-size="28" font-weight="600"> ${esc(d.kmName)}</tspan></text>
  <text x="${d.readout[0] + 300}" y="${d.readout[1] + 60}" font-size="20" fill="${muted}">≈ ${fmt(D / 1.852)} ${esc(d.nmName)}</text>
  <text x="${d.readout[0]}" y="${d.readout[1] + 104}" font-size="19" fill="${ink}">d ≈ 3.57 × (√H + √h)</text>
  <text x="${d.readout[0]}" y="${d.readout[1] + 132}" font-size="15" fill="${muted}">${esc(d.note)}</text>
</svg>`);
const pulse = svg.querySelector(".pulse"),
  glow = svg.querySelector(".glow");
const len = Math.hypot(eyeAt[0] - lampAt[0], eyeAt[1] - lampAt[1]);
api.animate(() => {
  const s = performance.now() / 1000;
  pulse.setAttribute("stroke-dashoffset", (-((s * 260) % (len + 400)) + 18).toFixed(1));
  glow.setAttribute("r", (24 + 6 * Math.sin(s * 3)).toFixed(1));
});
return svg;
