// 咖啡的来历: a long handscroll, 4800 × 1080, painted in layers that move at different
// speeds as the camera trucks along it, and line up when it is seen whole. One bean walks it:
// picked as a cherry, washed out of its skin, dried, roasted, brewed.
import { rng, clamp, lerp, prog, ease, noise, W, H, camCtx } from "./core.js";
import { ellipse, bez, wash, lift, ink, sprite, Sheet, fillPoly, trace, paper } from "./paint.js";
import { bean, cherry, leaf, ring, C, INK } from "./art.js";

export const SW = 4800,
  SH = 1080;
export const ST = [900, 1900, 2900, 3900];
export const ANCHOR = SW / 2;
export const DOOR = { x: 2900, y: 712, r: 52 };
export const groundY = (x) => 892 + 9 * Math.sin(x / 380) + 5 * Math.sin(x / 150 + 1);
const DEPTH = { sky: 0.12, far: 0.3, mid: 0.6, main: 1, fore: 1.55 };
export const NAMES = [
  ["01", "果实", "红透了才采摘"],
  ["02", "处理", "洗去果皮，晒干"],
  ["03", "烘焙", "火候，决定风味"],
  ["04", "冲煮", "热水带出香气"],
];

// ---------- painting the scroll ----------
function ridge(x0, x1, base, amp, seed, freq = 1) {
  const P = [];
  for (let x = x0; x <= x1; x += 40) P.push([x, base - amp * (0.55 + 0.45 * noise((x / 520) * freq, seed)) - amp * 0.35 * Math.max(0, noise((x / 190) * freq, seed + 4))]);
  return [...P, [x1, SH + 40], [x0, SH + 40]];
}
function shrub(g, x, y, s, r, berries = true) {
  wash(g, ellipse(x, y, 46 * s, 30 * s, 16), "#4f6a33", { seed: Math.floor(r() * 1e6), layers: 10, alpha: 0.08, spread: 0.12, edge: 1.2 });
  if (berries)
    for (let i = 0; i < 4; i++) {
      g.fillStyle = r() < 0.75 ? "rgba(170,45,35,0.75)" : "rgba(196,150,60,0.7)";
      g.beginPath();
      g.arc(x + (r() - 0.5) * 60 * s, y + (r() - 0.3) * 30 * s, 3.4 * s, 0, Math.PI * 2);
      g.fill();
    }
}

export function paintJourney() {
  const r = rng(404);
  // the sky, with the paper of the scroll under everything
  const sky = paper(SW / 2, SH / 2, { seed: 41, color: "#f0e5cf", mottle: 120, scale: 0.5, vignette: 0.1 });
  {
    const g = sky.getContext("2d");
    g.scale(0.5, 0.5);
    const gr = g.createLinearGradient(0, 0, 0, 700);
    gr.addColorStop(0, "rgba(150,170,175,0.32)");
    gr.addColorStop(0.7, "rgba(150,170,175,0.0)");
    g.globalCompositeOperation = "multiply";
    g.fillStyle = gr;
    g.fillRect(0, 0, SW, 700);
    // a low sun, and a haze of warmth around it
    const sun = g.createRadialGradient(2050, 300, 10, 2050, 300, 900);
    sun.addColorStop(0, "rgba(240,190,110,0.32)");
    sun.addColorStop(1, "rgba(240,190,110,0)");
    g.fillStyle = sun;
    g.fillRect(0, 0, SW, SH);
    wash(g, ellipse(2050, 300, 52, 52, 30), "#efc477", { seed: 2, layers: 14, alpha: 0.05, spread: 0.03, edge: 1, soft: 3 });
    for (let i = 0; i < 9; i++) {
      const x = 300 + i * 520 + r() * 200,
        y = 120 + r() * 180;
      wash(g, ellipse(x, y, 160 + r() * 160, 22 + r() * 14, 22), "#aab6ba", { seed: 10 + i, layers: 10, alpha: 0.018, spread: 0.12, edge: 0.3, soft: 8 });
    }
    g.globalCompositeOperation = "source-over";
  }
  // far mountains, pale, with mist at their feet
  const far = new Sheet(SW, SH, 0.5);
  far.paint((g) => {
    wash(g, ridge(-200, SW + 200, 640, 230, 3, 0.8), "#a8b0a6", { seed: 21, layers: 16, alpha: 0.045, spread: 0.02, edge: 1, soft: 3 });
    wash(g, ridge(-200, SW + 200, 700, 150, 8, 1.2), "#93a08e", { seed: 22, layers: 16, alpha: 0.05, spread: 0.02, edge: 1, soft: 2 });
    g.save();
    g.globalCompositeOperation = "destination-out";
    const m = g.createLinearGradient(0, 640, 0, 820);
    m.addColorStop(0, "rgba(0,0,0,0)");
    m.addColorStop(1, "rgba(0,0,0,0.85)");
    g.fillStyle = m;
    g.fillRect(-200, 600, SW + 400, 500);
    g.restore();
  });
  // middle hills: terraces of coffee on the left, fields and trees beyond
  const mid = new Sheet(SW, SH, 0.5);
  mid.paint((g) => {
    wash(g, ridge(-200, SW + 200, 800, 120, 31, 1.4), "#8f9c62", { seed: 31, layers: 18, alpha: 0.05, spread: 0.02, edge: 1.2 });
    for (let k = 0; k < 6; k++) {
      const y = 700 + k * 16;
      const P = [];
      for (let x = 0; x <= 1700; x += 30) P.push([x, y + 10 * Math.sin(x / 260 + k)]);
      ink(g, P, { w: 1.6, alpha: 0.22, color: "#4d5a2c", seed: 300 + k });
      for (let x = 30 + (k % 2) * 40 + r() * 20; x < 1600; x += 70 + r() * 40) shrub(g, x, y + 10 * Math.sin(x / 260 + k) - 5, 0.26 + r() * 0.08, r);
    }
    for (const x of [2350, 2520, 3350, 3500, 4300, 4520]) {
      ink(g, [[x, 800], [x + 4, 740]], { w: 5, color: "#4a3a28", seed: x });
      wash(g, ellipse(x, 720, 50, 40, 18), "#5b7040", { seed: x + 1, layers: 14, alpha: 0.07, spread: 0.12, edge: 1.2 });
    }
    g.save();
    g.globalCompositeOperation = "destination-out";
    const m = g.createLinearGradient(0, 780, 0, 880);
    m.addColorStop(0, "rgba(0,0,0,0)");
    m.addColorStop(1, "rgba(0,0,0,0.7)");
    g.fillStyle = m;
    g.fillRect(-200, 760, SW + 400, 400);
    g.restore();
  });

  // the ground the bean walks, and the four stations on it
  const main = new Sheet(SW, SH - 440, 1, 0, 440);
  main.paint((g) => {
    const top = [];
    for (let x = -40; x <= SW + 40; x += 30) top.push([x, 856 + 12 * noise(x / 300, 5)]);
    wash(g, [...top, [SW + 40, SH + 30], [-40, SH + 30]], "#c9ae84", { seed: 51, layers: 16, alpha: 0.06, spread: 0.01, edge: 1.2, grain: 0.6 });
    wash(g, [...top.map(([x, y]) => [x, y + 120]), [SW + 40, SH + 30], [-40, SH + 30]], "#a98d66", { seed: 52, layers: 12, alpha: 0.04, spread: 0.02, edge: 0.3 });
    // the path, in dashes of a dry brush
    for (let x = 60; x < SW - 60; x += 46) ink(g, [[x, groundY(x) + 14], [x + 24, groundY(x + 24) + 14]], { w: 3, alpha: 0.32, color: "#6d5232", seed: x });
    for (let i = 0; i < 70; i++) {
      const x = r() * SW,
        y = 915 + r() * 140;
      wash(g, ellipse(x, y, 5 + r() * 7, 3 + r() * 3, 10), "#8b7556", { seed: 600 + i, layers: 6, alpha: 0.12, edge: 1.5 });
    }
    for (let i = 0; i < 90; i++) {
      const x = r() * SW,
        y = 862 + r() * 10;
      for (let k = 0; k < 3; k++) ink(g, [[x + k * 4, y], [x + k * 5 - 4 + r() * 8, y - 16 - r() * 14]], { w: 1.6, alpha: 0.5, color: "#5b6a35", seed: 700 + i * 3 + k });
    }
  });

  // 01: a coffee tree heavy with cherries
  {
    const x = ST[0];
    main.put([x - 300, 440, 600, 470], (g) => {
      ink(g, [[x - 6, 892], [x - 2, 820], [x + 6, 740], [x - 4, 650]], { w: 14, color: "#5b412a", seed: 1 });
      for (const [a, b] of [[[x, 780], [x - 170, 640]], [[x + 2, 740], [x + 190, 610]], [[x - 2, 690], [x - 120, 560]], [[x, 660], [x + 120, 540]], [[x - 4, 650], [x - 10, 520]]]) ink(g, [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10], b], { w: 7, color: "#5b412a", seed: a[0] + b[1] });
      wash(g, ellipse(x, 640, 230, 150, 30), "#5e7a3c", { seed: 3, layers: 14, alpha: 0.035, spread: 0.16, edge: 0.6, soft: 4 });
      const rl = rng(8);
      for (let i = 0; i < 70; i++) {
        const a = rl() * Math.PI * 2,
          d = Math.sqrt(rl());
        g.save();
        g.translate(x + Math.cos(a) * 210 * d, 640 + Math.sin(a) * 130 * d);
        g.rotate(rl() * Math.PI * 2);
        leaf(g, 52 + rl() * 26, 17 + rl() * 7, { seed: 20 + i, tone: rl() < 0.5 ? C.leaf : "#55703a" });
        g.restore();
      }
      for (let i = 0; i < 34; i++) {
        const a = rl() * Math.PI * 2,
          d = 0.2 + Math.sqrt(rl()) * 0.75;
        const tone = rl() < 0.72 ? C.cherry : rl() < 0.5 ? "#c79a3a" : "#8a9a4a";
        g.save();
        g.translate(x + Math.cos(a) * 190 * d, 650 + Math.sin(a) * 110 * d);
        cherry(g, 11 + rl() * 4, { seed: 200 + i, tone, deep: tone === C.cherry ? C.cherryDeep : "#5c4a1a" });
        g.restore();
      }
    });
  }
  // 02: a washing trough, and a raised bed drying in the sun
  {
    const x = ST[1];
    const trough = [[x - 230, 810], [x - 60, 810], [x - 70, 884], [x - 220, 884]];
    main.put([x - 260, 760, 240, 150], (g) => {
      wash(g, trough, "#8a6a46", { seed: 31, layers: 14, alpha: 0.07, spread: 0.01, edge: 1.4 });
      wash(g, [[x - 224, 818], [x - 66, 818], [x - 68, 836], [x - 222, 836]], "#7895a0", { seed: 32, layers: 12, alpha: 0.08, spread: 0.02, edge: 1.2 });
      ink(g, [...trough, trough[0]], { sharp: true,  w: 2.4, seed: 33 });
      for (let k = 1; k < 3; k++) ink(g, [[x - 226 + k * 4, 840 + k * 14], [x - 64 - k * 3, 840 + k * 14]], { w: 1.2, alpha: 0.35, seed: 34 + k });
    }, (g) => fillPoly(g, trough));
    const bed = [[x - 10, 770], [x + 270, 770], [x + 250, 806], [x + 10, 806]];
    main.put([x - 30, 720, 330, 190], (g) => {
      for (const [a, b] of [[[x + 18, 806], [x + 12, 890]], [[x + 240, 806], [x + 250, 890]], [[x + 60, 800], [x + 56, 870]], [[x + 200, 800], [x + 206, 870]]]) ink(g, [a, b], { w: 6, color: "#6b5035", seed: a[0] });
      wash(g, bed, "#b9a079", { seed: 41, layers: 12, alpha: 0.07, spread: 0.01, edge: 1.4 });
      for (let i = 0; i < 4; i++) ink(g, [[x - 6 + i * 2, 776 + i * 8], [x + 266 - i * 5, 776 + i * 8]], { w: 1, alpha: 0.3, seed: 42 + i });
      const rb = rng(17);
      for (let i = 0; i < 46; i++) {
        g.save();
        g.translate(x + 14 + rb() * 236, 768 + rb() * 30);
        g.rotate(rb() * Math.PI);
        bean(g, 16, { seed: 50 + i, tone: rb() < 0.25 ? "#b07a4a" : "#bdb27a", deep: "#8a7f48", creaseColor: "#5d5430", form: 0.3 });
        g.restore();
      }
      ink(g, [...bed, bed[0]], { sharp: true,  w: 2.2, seed: 43 });
    }, (g) => fillPoly(g, bed));
  }
  // 03: the roaster
  {
    const x = ST[2];
    const body = [[x - 128, 610], [x + 128, 610], [x + 128, 846], [x - 128, 846]];
    const hopper = [[x - 52, 530], [x + 52, 530], [x + 22, 612], [x - 22, 612]];
    main.put([x - 170, 440, 460, 460], (g) => {
      ink(g, [[x + 100, 612], [x + 100, 520], [x + 104, 480], [x + 150, 470]], { w: 22, color: "#4b4640", seed: 60, vary: 0.1 });
      for (const lx of [x - 104, x + 104]) ink(g, [[lx, 846], [lx - 4, 892]], { w: 9, color: "#3a2a1c", seed: lx });
      wash(g, body, "#a9472d", { seed: 61, layers: 18, alpha: 0.075, spread: 0.008, edge: 1.4, grain: 0.5 });
      wash(g, [[x + 40, 610], [x + 128, 610], [x + 128, 846], [x + 30, 846]], "#5e2416", { seed: 62, layers: 10, alpha: 0.06, spread: 0.04, clip: body, edge: 0.2, soft: 6 });
      wash(g, [[x - 128, 800], [x + 128, 800], [x + 128, 846], [x - 128, 846]], "#2c1a12", { seed: 63, layers: 10, alpha: 0.09, spread: 0.01, clip: body, edge: 0.6 });
      ink(g, [...body, body[0]], { sharp: true,  w: 2.6, seed: 64 });
      // the drum's face, with a rim of iron round the door
      wash(g, ellipse(DOOR.x, DOOR.y, DOOR.r + 18, DOOR.r + 18, 40), "#3c3430", { seed: 65, layers: 14, alpha: 0.08, spread: 0.01, edge: 1.2 });
      ink(g, ellipse(DOOR.x, DOOR.y, DOOR.r + 18, DOOR.r + 18, 48).concat([[DOOR.x + DOOR.r + 18, DOOR.y]]), { w: 2.4, seed: 66, in: 0.01, out: 0.01 });
      wash(g, hopper, "#c9c0ae", { seed: 67, layers: 12, alpha: 0.07, spread: 0.01, edge: 1.3 });
      ink(g, [...hopper, hopper[0]], { sharp: true,  w: 2.2, seed: 68 });
      for (const [bx, a] of [[x - 26, 0.4], [x, -0.3], [x + 24, 1.1]]) {
        g.save();
        g.translate(bx, 532);
        g.rotate(a);
        bean(g, 20, { seed: 70 + bx, tone: "#a5ad6c", deep: "#5d6a2e", form: 0.4 });
        g.restore();
      }
      // a sieve where roasted beans cool
      const sieve = ellipse(x + 210, 858, 82, 18, 30);
      wash(g, sieve, "#b8ad99", { seed: 71, layers: 10, alpha: 0.07, edge: 1.2 });
      ink(g, [...sieve, sieve[0]], { w: 2, seed: 72 });
      const rs = rng(4);
      for (let i = 0; i < 12; i++) {
        g.save();
        g.translate(x + 150 + rs() * 120, 850 + rs() * 12);
        g.rotate(rs() * 3);
        bean(g, 18, { seed: 80 + i });
        g.restore();
      }
    }, (g) => {
      fillPoly(g, body);
      fillPoly(g, hopper);
      fillPoly(g, ellipse(x + 210, 858, 82, 18, 30));
    });
  }
  // 04: a kettle, a dripper and a cup on a small table
  {
    const x = ST[3];
    const table = [[x - 150, 800], [x + 150, 800], [x + 150, 816], [x - 150, 816]];
    const cupB = [...bez([x - 40, 744], [x - 40, 780], [x - 24, 800], [x, 800], 8), ...bez([x, 800], [x + 24, 800], [x + 40, 780], [x + 40, 744], 8)];
    const drip = [[x - 54, 672], [x + 54, 672], [x + 18, 742], [x - 18, 742]];
    const kettle = ellipse(x - 120, 744, 58, 42, 30);
    main.put([x - 220, 600, 440, 300], (g) => {
      for (const lx of [x - 130, x + 130]) ink(g, [[lx, 814], [lx + (lx < x ? -6 : 6), 892]], { w: 7, color: "#5b4330", seed: lx });
      wash(g, table, "#9c7a55", { seed: 81, layers: 10, alpha: 0.08, edge: 1.2 });
      ink(g, [...table, table[0]], { sharp: true,  w: 2, seed: 82 });
      // kettle: body, lid, a long neck
      wash(g, kettle, "#8d8b86", { seed: 83, layers: 14, alpha: 0.07, spread: 0.02, edge: 1.3 });
      ink(g, [...kettle, kettle[0]], { w: 2.2, seed: 84 });
      ink(g, [[x - 72, 750], [x - 40, 740], [x - 30, 690], [x - 14, 668]], { w: 8, color: "#6f6d68", seed: 85, vary: 0.1 });
      ink(g, [[x - 170, 720], [x - 196, 726], [x - 194, 770], [x - 168, 772]], { w: 6, color: "#4b4844", seed: 86 });
      ink(g, [[x - 136, 702], [x - 104, 702]], { w: 7, color: "#4b4844", seed: 87 });
      // cup, dripper
      wash(g, cupB, "#e2d6c2", { seed: 88, layers: 8, alpha: 0.06, edge: 1 });
      wash(g, [[x + 6, 744], [x + 40, 744], [x + 30, 800], [x + 4, 800]], "#a8977f", { seed: 89, layers: 8, alpha: 0.05, clip: cupB, edge: 0 });
      ink(g, [...cupB, cupB[0]], { w: 2, seed: 90 });
      ink(g, [[x + 40, 756], [x + 58, 760], [x + 56, 782], [x + 38, 784]], { w: 3, seed: 91 });
      wash(g, drip, "#efe6d6", { seed: 92, layers: 8, alpha: 0.06, edge: 1 });
      wash(g, [[x + 10, 672], [x + 54, 672], [x + 18, 742], [x + 6, 742]], "#b5a68e", { seed: 93, layers: 8, alpha: 0.05, clip: drip, edge: 0 });
      ink(g, [...drip, drip[0]], { sharp: true,  w: 2, seed: 94 });
      for (const dx of [-24, 0, 24]) ink(g, [[x + dx, 680], [x + dx * 0.4, 736]], { w: 1, alpha: 0.35, seed: 95 + dx });
    }, (g) => {
      fillPoly(g, table);
      fillPoly(g, kettle);
      fillPoly(g, cupB);
      fillPoly(g, drip);
    });
  }

  // out-of-focus things that pass close to the lens
  const fore = [
    { x: 500, y: 1010, a: -0.6, L: 300, kind: "leaf" },
    { x: 1500, y: 1060, a: 0.4, L: 340, kind: "leaf" },
    { x: 2450, y: 1030, a: -0.2, L: 120, kind: "cherry" },
    { x: 3450, y: 1050, a: 2.6, L: 320, kind: "leaf" },
    { x: 4400, y: 1020, a: 0.2, L: 140, kind: "bean" },
  ].map((f) => {
    const s = sprite(f.L * 1.2, f.L * 1.2, 0.5, (g) => {
      g.translate(f.L * 0.6, f.L * 0.6);
      g.rotate(f.a);
      if (f.kind === "leaf") leaf(g, f.L, f.L * 0.32, { seed: f.x });
      else if (f.kind === "cherry") cherry(g, f.L / 2, { seed: f.x });
      else bean(g, f.L, { seed: f.x });
    });
    const b = document.createElement("canvas");
    b.width = s.width + 40;
    b.height = s.height + 40;
    const bg = b.getContext("2d");
    bg.filter = "blur(7px)";
    bg.drawImage(s, 20, 20);
    return { ...f, c: b };
  });

  // the walker, in each of the things it becomes
  const R = 3;
  const walker = {
    cherry: sprite(44, 44, R, (g) => {
      g.translate(22, 22);
      cherry(g, 17, { seed: 900 });
    }),
    green: sprite(50, 40, R, (g) => {
      g.translate(25, 20);
      bean(g, 36, { seed: 901, tone: "#a9b06a", deep: "#5d6a2e", creaseColor: "#3d4a1e" });
    }),
    dry: sprite(50, 40, R, (g) => {
      g.translate(25, 20);
      bean(g, 36, { seed: 902, tone: "#c3b27c", deep: "#7a6a3a", creaseColor: "#4d4426" });
    }),
    roast: sprite(50, 40, R, (g) => {
      g.translate(25, 20);
      bean(g, 36, { seed: 903 });
    }),
    skin: sprite(44, 44, R, (g) => {
      g.translate(22, 22);
      wash(g, [...bez([-17, 0], [-17, -22], [17, -22], [17, 0], 10), ...bez([17, 0], [8, -6], [-8, -6], [-17, 0], 6)], C.cherry, { seed: 905, layers: 14, alpha: 0.09, edge: 1.4 });
    }),
    door: sprite(DOOR.r * 2 + 8, DOOR.r * 2 + 8, 2, (g) => {
      g.translate(DOOR.r + 4, DOOR.r + 4);
      wash(g, ellipse(0, 0, DOOR.r, DOOR.r, 40), "#4a3f3a", { seed: 906, layers: 16, alpha: 0.09, spread: 0.008, edge: 1.4 });
      wash(g, ellipse(0, 0, DOOR.r * 0.62, DOOR.r * 0.62, 30), "#6d5a4a", { seed: 907, layers: 10, alpha: 0.07, edge: 1 });
      ink(g, ellipse(0, 0, DOOR.r, DOOR.r, 48).concat([[DOOR.r, 0]]), { w: 2.4, seed: 908, in: 0.01, out: 0.01 });
      ink(g, [[DOOR.r * 0.5, -6], [DOOR.r * 0.82, -6]], { w: 5, color: "#b9a98c", seed: 909 });
    }),
  };
  return { sky, far: far.c, mid: mid.c, main: main.c, fore, walker };
}

// ---------- the walk ----------
const arc = (t, a, b, p0, p1, h) => {
  const u = prog(t, a, b);
  return [lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u) - Math.sin(u * Math.PI) * h, u];
};
/** Where the bean is at time t (scroll-local, 0 = when the scroll opens), what it is, and how it turns. */
export function walkerAt(t) {
  const gy = (x) => groundY(x) - 13;
  const x1 = ST[0],
    x2 = ST[1],
    x3 = ST[2],
    x4 = ST[3];
  // picked: hangs, falls, bounces, then rolls to the trough
  if (t < 1.0) return { kind: "cherry", x: x1 + 80, y: 690 + Math.sin(t * 6) * 2, rot: Math.sin(t * 3) * 0.1, s: 1 };
  if (t < 1.35) {
    const u = ease.in2(prog(t, 1.0, 1.35));
    return { kind: "cherry", x: x1 + 80 + u * 20, y: lerp(690, gy(x1 + 100), u), rot: u * 2, s: 1 };
  }
  if (t < 1.6) {
    const [x, y] = arc(t, 1.35, 1.6, [x1 + 100, gy(x1 + 100)], [x1 + 160, gy(x1 + 160)], 40);
    return { kind: "cherry", x, y, rot: 2 + (t - 1.35) * 8, s: 1 };
  }
  if (t < 2.45) {
    const u = ease.io2(prog(t, 1.6, 2.45));
    const x = lerp(x1 + 160, x2 - 300, u);
    return { kind: "cherry", x, y: gy(x), rot: 4 + (x - x1) / 17, s: 1 };
  }
  // into the water, out of its skin, onto the bed
  if (t < 2.75) {
    const [x, y] = arc(t, 2.45, 2.75, [x2 - 300, gy(x2 - 300)], [x2 - 150, 824], 80);
    return { kind: "cherry", x, y, rot: t * 6, s: 1 };
  }
  if (t < 3.05) return { kind: "cherry", x: x2 - 150 + Math.sin(t * 20) * 2, y: 828 + Math.sin(t * 14) * 3, rot: 0, s: 1, wet: prog(t, 2.75, 3.05) };
  if (t < 3.45) {
    const [x, y] = arc(t, 3.05, 3.45, [x2 - 150, 824], [x2 + 120, 774], 110);
    return { kind: "green", x, y, rot: (t - 3.05) * 12, s: 1, skinOff: prog(t, 3.05, 3.5) };
  }
  if (t < 4.3) return { kind: t < 3.65 ? "green" : "dry", mix: prog(t, 3.55, 4.15), x: x2 + 120, y: 774, rot: 0.2, s: 1 + 0.06 * Math.sin(prog(t, 3.45, 3.7) * Math.PI) };
  if (t < 4.55) {
    const [x, y] = arc(t, 4.3, 4.55, [x2 + 120, 774], [x2 + 320, gy(x2 + 320)], 50);
    return { kind: "dry", x, y, rot: t * 8, s: 1 };
  }
  if (t < 5.15) {
    const u = ease.io2(prog(t, 4.55, 5.15));
    const x = lerp(x2 + 320, x3 - 210, u);
    return { kind: "dry", x, y: gy(x), rot: x / 17, s: 1 };
  }
  // up into the hopper; out of the door, roasted
  if (t < 5.5) {
    const [x, y] = arc(t, 5.15, 5.5, [x3 - 210, gy(x3 - 210)], [x3, 536], 160);
    return { kind: "dry", x, y, rot: t * 9, s: 1 };
  }
  if (t < 6.2) return { kind: "none", x: x3, y: 600 };
  if (t < 6.55) {
    const [x, y] = arc(t, 6.2, 6.55, [DOOR.x, DOOR.y], [x3 + 200, 846], 90);
    return { kind: "roast", x, y, rot: t * 10, s: 1, smoke: prog(t, 6.2, 7.2) };
  }
  if (t < 6.9) return { kind: "roast", x: x3 + 200, y: 846, rot: 0.3, s: 1, smoke: prog(t, 6.2, 7.2) };
  if (t < 7.15) {
    const [x, y] = arc(t, 6.9, 7.15, [x3 + 200, 846], [x3 + 360, gy(x3 + 360)], 50);
    return { kind: "roast", x, y, rot: t * 8, s: 1 };
  }
  if (t < 7.6) {
    const u = ease.io2(prog(t, 7.15, 7.6));
    const x = lerp(x3 + 360, x4 - 230, u);
    return { kind: "roast", x, y: gy(x), rot: x / 17, s: 1 };
  }
  // into the dripper, and the water poured over it
  if (t < 7.95) {
    const [x, y, u] = arc(t, 7.6, 7.95, [x4 - 230, gy(x4 - 230)], [x4, 678], 170);
    return { kind: "roast", x, y, rot: t * 10, s: lerp(1, 0.75, u) };
  }
  return { kind: "none", x: x4, y: 690 };
}
/** The camera along the scroll during the walk. */
export function walkCam(t) {
  const K = [
    [0, 990],
    [1.3, 1030],
    [2.6, 1720],
    [3.6, 1980],
    [4.9, 2700],
    [6.0, 2920],
    [7.1, 3480],
    [8.1, 3830],
  ];
  if (t <= K[0][0]) return K[0][1];
  for (let i = 0; i < K.length - 1; i++) {
    const [ta, xa] = K[i],
      [tb, xb] = K[i + 1];
    if (t <= tb) {
      const u = (t - ta) / (tb - ta);
      // mostly steady, easing a little into each stop
      const k = lerp(u, ease.sine(u), 0.55);
      return lerp(xa, xb, k);
    }
  }
  return K.at(-1)[1];
}

// ---------- drawing it ----------
/** Draws the scroll through `cam` onto ctx (a W×H screen scaled by s). t: scroll-local time. */
export function drawJourney(ctx, art, cam, t, o = {}) {
  const s = o.scale ?? 1,
    dx = o.dx ?? 0,
    dy = o.dy ?? 0;
  const at = (depth) => ({ ...cam, cx: ANCHOR + (cam.cx - ANCHOR) * depth });
  const setCam = (c) => ctx.setTransform(c.z * s, 0, 0, c.z * s, (W / 2 + (c.ox || 0) - c.cx * c.z) * s + dx, (H / 2 + (c.oy || 0) - c.cy * c.z) * s + dy);
  ctx.save();
  // the scroll's shadow and its edge, for when it is seen whole
  setCam(cam);
  if (o.edges) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 60 * cam.z * s;
    ctx.shadowOffsetY = 24 * cam.z * s;
    ctx.fillStyle = "#efe5cf";
    ctx.fillRect(0, 0, SW, SH);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.rect(0, 0, SW, SH);
  ctx.clip();
  const layer = (img, depth, x, y, w, h) => {
    setCam(at(depth));
    ctx.drawImage(img, x, y, w, h);
  };
  // the sky is clipped to the scroll in its own frame so it never shows a seam
  layer(art.sky, DEPTH.sky, -SW * 0.2, 0, SW * 1.4, SH);
  layer(art.far, DEPTH.far, 0, 0, SW, SH);
  layer(art.mid, DEPTH.mid, 0, 0, SW, SH);
  setCam(cam);
  ctx.drawImage(art.main, 0, 440, SW, SH - 440);
  drawLive(ctx, art, t);
  // labels
  NAMES.forEach(([n, name, sub], i) => {
    const x = ST[i];
    const a = o.labels ?? 1;
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(38,24,15,0.55)";
    ctx.font = '500 26px "IBM Plex Mono"';
    ctx.textAlign = "center";
    ctx.fillText(n, x, 250);
    ctx.fillStyle = "#26180f";
    ctx.font = '400 104px "Ma Shan Zheng"';
    ctx.fillText(name, x, 372);
    ctx.fillStyle = "rgba(38,24,15,0.62)";
    ctx.font = '400 30px "Noto Sans SC"';
    ctx.fillText(sub, x, 432);
    ctx.globalAlpha = 1;
  });
  // close to the lens
  for (const f of art.fore) {
    setCam(at(DEPTH.fore));
    ctx.globalAlpha = o.fore ?? 1;
    ctx.drawImage(f.c, f.x - f.c.width, f.y - f.c.height, f.c.width * 2, f.c.height * 2);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** What moves on the scroll: the walker, the water, fire, the pour, the steam. */
function drawLive(ctx, art, t) {
  const w = walkerAt(t);
  const x3 = ST[2],
    x4 = ST[3];
  // fire under the drum, roaring while the bean is inside
  const heat = 0.5 + 0.5 * prog(t, 5.4, 5.7) * (1 - prog(t, 6.4, 7.2));
  for (let k = 0; k < 5; k++) {
    const fx = x3 - 80 + k * 40,
      fl = (24 + 18 * heat) * (1 + 0.18 * Math.sin(t * 13 + k * 2.1) + 0.1 * Math.sin(t * 7 + k));
    const gr = ctx.createLinearGradient(fx, 846, fx, 846 - fl);
    gr.addColorStop(0, "rgba(230,120,40,0.95)");
    gr.addColorStop(1, "rgba(245,200,90,0.2)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(fx - 11, 846);
    ctx.quadraticCurveTo(fx - 9, 846 - fl * 0.6, fx + Math.sin(t * 9 + k) * 4, 846 - fl);
    ctx.quadraticCurveTo(fx + 9, 846 - fl * 0.6, fx + 11, 846);
    ctx.fill();
  }
  // the door: a glow behind it, and it swings open when the bean comes out
  const open = Math.max(bell(t, 6.05, 6.75, 0.15, 0.3), o_door);
  const glow = ctx.createRadialGradient(DOOR.x, DOOR.y, 4, DOOR.x, DOOR.y, DOOR.r);
  glow.addColorStop(0, `rgba(255,190,90,${0.9 * heat})`);
  glow.addColorStop(1, "rgba(160,50,20,0.9)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(DOOR.x, DOOR.y, DOOR.r, 0, Math.PI * 2);
  ctx.fill();
  {
    const d = art.walker.door;
    const sx = Math.cos(open * 1.35);
    ctx.save();
    ctx.translate(DOOR.x - DOOR.r - 4, DOOR.y);
    ctx.scale(Math.max(0.02, sx), 1);
    ctx.drawImage(d, 0, -d.__h / 2, d.__w, d.__h);
    ctx.restore();
  }
  // smoke from the chimney, and from the fresh bean
  for (let i = 0; i < 9; i++) {
    const u = (t * 0.32 + i / 9) % 1;
    const x = x3 + 150 + u * 70 + Math.sin(u * 6 + i) * 14,
      y = 470 - u * 160;
    ctx.fillStyle = `rgba(120,110,100,${0.22 * Math.sin(u * Math.PI)})`;
    ctx.beginPath();
    ctx.arc(x, y, 10 + u * 26, 0, Math.PI * 2);
    ctx.fill();
  }
  // the pour, and coffee filling the cup
  const pour = bell(t, 7.9, 8.9, 0.15, 0.25);
  if (pour > 0) {
    ctx.strokeStyle = `rgba(150,180,195,${0.85 * pour})`;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x4 - 14, 668);
    ctx.quadraticCurveTo(x4 - 6, 664, x4 - 2, 690);
    ctx.stroke();
  }
  const fill = prog(t, 8.2, 9.2);
  if (fill > 0) {
    ctx.fillStyle = "rgba(70,38,18,0.85)";
    const top = lerp(798, 752, ease.out2(fill));
    ctx.beginPath();
    ctx.moveTo(x4 - 38, top);
    ctx.lineTo(x4 + 38, top);
    ctx.lineTo(x4 + 30, 794);
    ctx.quadraticCurveTo(x4, 800, x4 - 30, 794);
    ctx.closePath();
    ctx.fill();
    for (let k = 0; k < 3; k++) {
      const d = (t * 1.6 + k / 3) % 1;
      ctx.fillStyle = `rgba(70,38,18,${0.8 * (1 - d)})`;
      ctx.beginPath();
      ctx.arc(x4, 742 + d * (top - 742), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = `rgba(150,140,128,${0.4 * fill})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let j = 0; j <= 10; j++) {
        const yy = 740 - j * 9,
          xx = x4 - 16 + k * 16 + Math.sin(j * 0.7 - t * 3 + k) * 6;
        if (j === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
  }
  // splash in the trough
  const sp = prog(t, 2.72, 3.2);
  if (sp > 0 && sp < 1) {
    ctx.fillStyle = `rgba(130,165,180,${0.8 * (1 - sp)})`;
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI * (0.15 + 0.7 * (k / 6));
      const d = 10 + 50 * sp;
      ctx.beginPath();
      ctx.arc(ST[1] - 150 + Math.cos(a) * d, 820 + Math.sin(a) * d * 1.2 + 60 * sp * sp, 4 * (1 - sp) + 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // the skin, flung off in two halves
  if (w.skinOff !== undefined && w.skinOff < 1) {
    const u = w.skinOff;
    for (const sgn of [-1, 1]) {
      ctx.save();
      ctx.translate(ST[1] - 150 + sgn * 60 * u, 824 - 70 * Math.sin(u * Math.PI) + 40 * u * u);
      ctx.rotate(sgn * u * 4);
      ctx.globalAlpha = 1 - u;
      ctx.drawImage(art.walker.skin, -22, -22, 44, 44);
      ctx.restore();
    }
  }
  if (w.kind !== "none") {
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.rot || 0);
    ctx.scale(w.s || 1, w.s || 1);
    const img = art.walker[w.kind];
    if (w.kind === "dry" && w.mix !== undefined && w.mix < 1) {
      ctx.drawImage(art.walker.green, -img.__w / 2, -img.__h / 2, img.__w, img.__h);
      ctx.globalAlpha = w.mix;
    }
    ctx.drawImage(img, -img.__w / 2, -img.__h / 2, img.__w, img.__h);
    ctx.restore();
  }
  if (w.smoke) {
    for (let k = 0; k < 4; k++) {
      const u = clamp(w.smoke * 1.4 - k * 0.12);
      ctx.fillStyle = `rgba(140,130,120,${0.3 * Math.sin(u * Math.PI)})`;
      ctx.beginPath();
      ctx.arc(w.x + (k - 1.5) * 8, w.y - 20 - u * 60, 6 + u * 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
let o_door = 0;
/** Opens the drum's door for the request (0..1), outside the walk's own opening. */
export const setDoor = (v) => (o_door = v);
const bell = (t, a, b, i, o) => Math.min(ease.out2(prog(t, a, a + i)), 1 - ease.in2(prog(t, b - o, b)));
