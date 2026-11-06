// 烘焙 · 细节: the page the request opens. A ribbon of temperature over time, coloured as
// the bean is, nine beans dropped onto it from green to espresso, the first crack, and the
// taste of each roast. Drawn every frame from a few painted sprites.
import { rng, clamp, lerp, prog, ease } from "./core.js";
import { ellipse, ink, paper, sprite, wash } from "./paint.js";
import { bean } from "./art.js";

export const PW = 1920,
  PH = 1080;
const X = (m) => 190 + (m / 12) * 1540;
const Y = (T) => 850 - ((T - 20) / 210) * 560;
const CURVE = [[0, 25], [1, 68], [2, 98], [3, 121], [4, 139], [5, 153], [5.6, 160], [6.5, 172], [7.5, 185], [8.5, 196], [9.5, 204], [10.4, 211], [11.2, 217], [12, 224]];
const tempAt = (m) => {
  for (let i = 0; i < CURVE.length - 1; i++) {
    const [a, A] = CURVE[i],
      [b, B] = CURVE[i + 1];
    if (m <= b) return lerp(A, B, (m - a) / (b - a));
  }
  return CURVE.at(-1)[1];
};
export const BEANS = [
  { m: 0.35, tone: "#a3b46a", deep: "#5d6a2e", label: ["生豆", "25°C"] },
  { m: 2.1, tone: "#b3b676", deep: "#6e6b38" },
  { m: 3.9, tone: "#cbb36a", deep: "#7f6a32" },
  { m: 5.6, tone: "#d0a95c", deep: "#7f5a2a", label: ["转黄 · 烤面包香", "160°C"] },
  { m: 7.0, tone: "#b98446", deep: "#6d4420" },
  { m: 8.5, tone: "#9a6235", deep: "#5a3218", label: ["一爆 · 噼啪", "196°C"], crack: true },
  { m: 9.6, tone: "#7d4c2a", deep: "#45240f", taste: ["浅烘", "205°C", "花香　果酸"] },
  { m: 10.8, tone: "#5c3620", deep: "#2f170a", taste: ["中烘", "215°C", "焦糖　坚果"] },
  { m: 12.0, tone: "#3a2214", deep: "#1a0c05", taste: ["深烘", "224°C", "可可　烟熏"] },
];
export const T_BEAN0 = 0.8,
  T_STEP = 0.24;

export function paintRoast() {
  const page = paper(PW, PH, { seed: 77, color: "#f3ead6", mottle: 110, vignette: 0.1 });
  const pg = page.getContext("2d");
  // the three stages, washed faintly behind
  [[0, 5.6, "#c8d0a0"], [5.6, 8.5, "#e6c98a"], [8.5, 12.4, "#cfa27e"]].forEach(([a, b, c], k) =>
    wash(pg, [[X(a), 300], [X(b), 300], [X(b), 850], [X(a), 850]], c, { seed: 10 + k, layers: 10, alpha: 0.03, spread: 0.01, edge: 0.6, grain: 0.6 }),
  );
  ink(pg, [[170, 852], [1760, 852]], { w: 2.4, alpha: 0.7, seed: 3 });
  for (let m = 0; m <= 12; m += 2) ink(pg, [[X(m), 846], [X(m), 862]], { w: 2, alpha: 0.6, seed: 20 + m });
  const sprites = BEANS.map((b, i) =>
    sprite(120, 100, 2, (g) => {
      g.translate(60, 50);
      g.rotate(-0.35);
      bean(g, 76, { seed: 500 + i * 3, tone: b.tone, deep: b.deep, form: 0.8 });
    }),
  );
  const shadow = sprite(120, 40, 1, (g) => wash(g, ellipse(60, 20, 40, 9, 20), "#6f5a40", { seed: 9, layers: 8, alpha: 0.05, edge: 0 }));
  return { page, sprites, shadow };
}

/** Draws the page at local time u (0 = it has just unrolled) in page coordinates; the caller
 * sets the transform. */
export function drawRoast(g, art, u) {
  g.drawImage(art.page, 0, 0);
  // heading
  const h = ease.out3(prog(u, 0, 0.7));
  g.globalAlpha = h;
  g.fillStyle = "rgba(38,24,15,0.55)";
  g.font = '500 26px "IBM Plex Mono"';
  g.textAlign = "left";
  g.fillText("03 · 烘焙 · 细节", 196, 126);
  g.fillStyle = "#26180f";
  g.font = '400 108px "Ma Shan Zheng"';
  g.fillText("火候与风味", 188 - (1 - h) * 30, 236);
  g.globalAlpha = 1;
  // axis words
  const ax = prog(u, 0.3, 0.8);
  g.globalAlpha = ax;
  g.fillStyle = "rgba(38,24,15,0.6)";
  g.font = '500 22px "IBM Plex Mono"';
  g.fillText("0 分钟", 172, 896);
  g.textAlign = "right";
  g.fillText("约 12 分钟", 1764, 896);
  g.textAlign = "center";
  g.font = '400 26px "Noto Sans SC"';
  [[0, 5.6, "脱水"], [5.6, 8.5, "梅纳反应"], [8.5, 12, "发展"]].forEach(([a, b, n]) => g.fillText(n, (X(a) + X(b)) / 2, 940));
  g.globalAlpha = 1;
  // the ribbon of temperature, drawn left to right
  const p = ease.io2(prog(u, 0.25, 1.9));
  if (p > 0) {
    const steps = 160;
    const n = Math.floor(steps * p);
    const grad = g.createLinearGradient(X(0), 0, X(12), 0);
    [[0, "#9fb065"], [0.4, "#d4ae58"], [0.62, "#b5733c"], [0.82, "#6a3e22"], [1, "#2c180c"]].forEach(([o, c]) => grad.addColorStop(o, c));
    g.strokeStyle = grad;
    g.lineCap = g.lineJoin = "round";
    for (const [w, a] of [[22, 0.28], [13, 0.9]]) {
      g.lineWidth = w;
      g.globalAlpha = a;
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const m = (i / steps) * 12;
        const x = X(m),
          y = Y(tempAt(m));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // beans, dropped onto the ribbon
  BEANS.forEach((b, i) => {
    const t0 = T_BEAN0 + i * T_STEP;
    const d = prog(u, t0 - 0.25, t0);
    if (d <= 0) return;
    const x = X(b.m),
      y = Y(tempAt(b.m)) - 34;
    const land = u >= t0 ? Math.abs(Math.sin((u - t0) * 16)) * 14 * Math.exp(-(u - t0) * 9) : 0;
    const fy = y - (1 - ease.in2(d)) * 260 - land;
    g.globalAlpha = clamp(d * 3);
    g.drawImage(art.shadow, x - 60, y + 26, 120, 40);
    g.save();
    g.translate(x, fy);
    g.rotate((1 - d) * 1.4);
    g.drawImage(art.sprites[i], -60, -50, 120, 100);
    g.restore();
    g.globalAlpha = 1;
    const la = ease.out3(prog(u, t0 + 0.05, t0 + 0.4));
    if (b.label && la > 0) {
      g.globalAlpha = la;
      g.textAlign = "center";
      g.fillStyle = "#26180f";
      g.font = '500 30px "Noto Sans SC"';
      g.fillText(b.label[0], x, y - 96 + (1 - la) * 10);
      g.fillStyle = "rgba(38,24,15,0.6)";
      g.font = '500 24px "IBM Plex Mono"';
      g.fillText(b.label[1], x, y - 62 + (1 - la) * 10);
      g.globalAlpha = 1;
    }
    if (b.crack) {
      const c = prog(u, t0, t0 + 0.6);
      if (c > 0 && c < 1) {
        g.strokeStyle = `rgba(214,110,40,${1 - c})`;
        g.lineWidth = 4;
        g.lineCap = "round";
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 + 0.3;
          const r0 = 46 + 50 * ease.out3(c),
            r1 = r0 + 22 * (1 - c);
          g.beginPath();
          g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
          g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
          g.stroke();
        }
      }
    }
    if (b.taste) {
      const ta = ease.out3(prog(u, 2.95 + (i - 6) * 0.22, 3.4 + (i - 6) * 0.22));
      if (ta > 0) {
        g.globalAlpha = ta;
        const ty = 560 + (1 - ta) * 16;
        g.strokeStyle = "rgba(38,24,15,0.25)";
        g.lineWidth = 2;
        g.setLineDash([4, 7]);
        g.beginPath();
        g.moveTo(x, y + 44);
        g.lineTo(x, ty - 60);
        g.stroke();
        g.setLineDash([]);
        g.textAlign = "center";
        g.fillStyle = "#26180f";
        g.font = '500 34px "Noto Sans SC"';
        g.fillText(b.taste[0], x, ty);
        g.fillStyle = "rgba(38,24,15,0.6)";
        g.font = '500 24px "IBM Plex Mono"';
        g.fillText(b.taste[1], x, ty + 36);
        g.fillStyle = "#8a3f22";
        g.font = '400 52px "Ma Shan Zheng"';
        g.fillText(b.taste[2].split("　")[0], x, ty + 112);
        g.fillText(b.taste[2].split("　")[1], x, ty + 172);
        g.globalAlpha = 1;
      }
    }
  });
}
