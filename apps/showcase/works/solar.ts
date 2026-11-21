import type { ModuleEdit, WorkEdit } from "../../../modules/contracts/index.ts";
import { styles, type ShowcaseSource } from "../kit.ts";

/* "How does the solar system work?" — the home page's running story. The author's first
 * draft, the version it settled on after looking at it (Earth was too small to find, and
 * the way in was hard to see), and the second version the reader asked for: a slider for
 * how long a year takes. Earth opens onto the water cycle, the tree there onto a leaf, and
 * the leaf's sugar ends in an apple. */

// Each planet's year in Earth years, so they keep their true pace relative to each other.
const planets = [
  { id: "mercury", zh: "水星", en: "Mercury", year: 0.24, w: 250, h: 118, color: "#a8a196", size: 16, phase: 0.12 },
  { id: "venus", zh: "金星", en: "Venus", year: 0.62, w: 372, h: 164, color: "#e7ad55", size: 24, phase: 0.47 },
  { id: "earth", zh: "地球", en: "Earth", year: 1, w: 516, h: 226, picture: "earth", size: 24, phase: 0.7 },
  { id: "mars", zh: "火星", en: "Mars", year: 1.88, w: 668, h: 290, color: "#d4553a", size: 20, phase: 0.93 },
  { id: "jupiter", zh: "木星", en: "Jupiter", year: 11.86, w: 924, h: 398, picture: "jupiter", size: 70, phase: 0.36 },
  { id: "saturn", zh: "土星", en: "Saturn", year: 29.46, w: 1200, h: 516, picture: "saturn", size: 96, phase: 0.06 },
];
const C = { x: 660, y: 420 };
const YEAR = 8;

/** A body going round its orbit: the ellipse filling the module, the body travelling on it
 * at its own pace, its name riding above it. Written once, drawn six times from data. */
const planetSource = `// 一颗沿椭圆轨道公转的行星：轨道、星体、名字和快慢都从 data 读
const { width: w, height: h, data: d, theme: t } = api;
const pic = d.picture && api.materials[d.picture];
const bw = d.size, bh = pic ? d.size * pic.height / pic.width : d.size;
const body = pic
  ? \`<image href="\${pic.url}" x="\${-bw / 2}" y="\${-bh / 2}" width="\${bw}" height="\${bh}"/>\`
  : \`<circle r="\${bw / 2}" fill="\${d.color}" filter="\${api.effect("pencil-grain")}"/>
     <circle r="\${bw / 2}" fill="none" stroke="\${t.ink}" stroke-width="2.4" filter="\${api.effect("rough-edge")}"/>\`;
const svg = api.svg(\`<svg viewBox="0 0 \${w} \${h}" style="overflow:visible">
  <ellipse cx="\${w / 2}" cy="\${h / 2}" rx="\${w / 2}" ry="\${h / 2}" fill="none"
    stroke="\${d.highlight ? t.accent : t.muted}" stroke-width="\${d.highlight ? 2.6 : 1.4}"
    stroke-dasharray="\${d.highlight ? "none" : "5 7"}" opacity="\${d.highlight ? 0.9 : 0.6}"/>
  <g class="body">\${body}
    <text y="\${-bh / 2 - 10}" text-anchor="middle" font-family="\${t.font}" font-size="\${d.labelSize}"
      font-weight="600" fill="\${t.ink}" paint-order="stroke" stroke="\${t.paper}" stroke-width="5">\${d.name}</text>
  </g></svg>\`);
const g = svg.querySelector(".body");
// 公转：一圈用 period 秒；逆时针，像从北极上方俯看
api.animate((s) => {
  const a = -2 * Math.PI * (d.phase + (d.period > 0 ? s / d.period : 0));
  g.setAttribute("transform", \`translate(\${w / 2 + (w / 2) * Math.cos(a)} \${h / 2 + (h / 2) * Math.sin(a)})\`);
});
return svg;`;

/** Rain falling from a cloud: slanted strokes sliding down, forever. */
const rainSource = `const { width: w, height: h, data: d, theme: t } = api;
const n = d.drops, lines = [];
for (let i = 0; i < n; i++) {
  const x = (i + 0.5) * w / n, y = ((i * 37) % 100) / 100 * h;
  lines.push(\`<line x1="\${x}" y1="\${y}" x2="\${x - 6}" y2="\${y + 18}"/>\`);
}
const svg = api.svg(\`<svg viewBox="0 0 \${w} \${h}" style="overflow:visible"><g stroke="\${d.color || t.accent2}" stroke-width="3" stroke-linecap="round" filter="\${api.effect("rough-edge")}">\${lines.join("")}</g></svg>\`);
const g = svg.querySelector("g");
api.animate((s) => g.setAttribute("transform", \`translate(\${-((s * 40) % 30) / 5} \${(s * 90) % (h / 3)})\`));
return svg;`;

/** The ground in section: the sea on the left, the land rising to the right. */
const groundSource = `const { width: w, height: h, data: d, theme: t } = api;
const shore = w * d.shore;
return api.svg(\`<svg viewBox="0 0 \${w} \${h}" style="overflow:visible">
  <rect x="0" y="\${h * 0.28}" width="\${shore + 60}" height="\${h * 0.72}" fill="\${d.sea}" opacity=".55" filter="\${api.effect("pencil-grain")}"/>
  <path d="M\${shore - 40} \${h} C\${shore + 30} \${h * 0.3} \${shore + 120} \${h * 0.18} \${shore + 260} \${h * 0.16}
    S\${w * 0.86} \${h * 0.02} \${w} \${h * 0.05} L\${w} \${h} Z" fill="\${d.land}" opacity=".8" filter="\${api.effect("pencil-grain")}"/>
  <path d="M\${shore - 40} \${h} C\${shore + 30} \${h * 0.3} \${shore + 120} \${h * 0.18} \${shore + 260} \${h * 0.16}
    S\${w * 0.86} \${h * 0.02} \${w} \${h * 0.05}" fill="none" stroke="\${t.ink}" stroke-width="2.6" filter="\${api.effect("rough-edge")}"/>
</svg>\`);`;

export const solar: ShowcaseSource = {
  id: "solar",
  title: (say) => say("太阳系是如何运转的", "How the solar system works"),
  brief: (say) => ({
    subject: say("太阳系的运转", "How the solar system moves"),
    intent: say(
      "行星为什么绕着太阳转，以及为什么离太阳越远，一年就越长",
      "Why the planets go round the Sun, and why the farther out a planet is, the longer its year",
    ),
    audience: say("小学高年级的孩子", "Children of about ten"),
    concept: say(
      "从北极正上方俯看：太阳在正中，六条椭圆轨道一圈套一圈，行星按真实的公转周期比例在轨道上走，越往外越慢——孩子不用读字就能看出“越远越慢”。地球可以点开，钻进地球上的水循环，再钻进一片叶子。",
      "Seen from above the North Pole: the Sun in the middle, six orbits nested one inside the next, each planet moving at its true pace, slower the farther out — a child sees 'farther is slower' without reading a word. Earth opens onto its water cycle, and a tree there onto one leaf.",
    ),
    register: "expressive",
    style: "crayon",
    direction: say(
      "蜡笔手绘：粗黑描边、饱和的平涂色块、带颗粒的纸面，楷体大字，轻松友好",
      "Crayon: thick black strokes, saturated flat fills with grain, big friendly handwriting",
    ),
    cast: planets.map((p) => say(p.zh, p.en)).concat(say("太阳", "the Sun")),
    basis: {
      subject: say("太阳系", "the solar system"),
      intent: say("是如何运转的", "how does it work"),
    },
  }),
  versions: (say) => {
    const planet = (p: (typeof planets)[number], size = p.size): ModuleEdit => ({
      id: p.id,
      bounds: [C.x - p.w / 2, C.y - p.h / 2, p.w, p.h],
      drawingId: "planet",
      data: {
        name: say(p.zh, p.en),
        period: +(YEAR * p.year).toFixed(2),
        phase: p.phase,
        size,
        ...(p.picture ? { picture: p.picture } : { color: p.color }),
      },
    });
    // The author's first draft: every orbit and body in place, Earth as small as it is.
    const draft: WorkEdit = {
      title: say("太阳系是如何运转的", "How the solar system works"),
      style: { ...styles.crayon },
      drawings: [
        {
          id: "planet",
          name: say("行星与轨道", "Planet on its orbit"),
          params: {
            name: { label: say("名字", "Name"), type: "text" },
            period: { label: say("公转一圈（秒）", "Seconds per orbit"), type: "number", min: 0, max: 300, step: 0.1 },
            size: { label: say("大小", "Size"), type: "number", min: 6, max: 140, step: 1 },
            color: { label: say("颜色", "Colour"), type: "color" },
            picture: { label: say("图片", "Picture"), type: "picture" },
            highlight: { label: say("突出轨道", "Highlight orbit"), type: "boolean" },
          },
          defaults: { labelSize: 20, phase: 0, period: 8, size: 20, highlight: false },
          source: planetSource,
        },
        {
          id: "rain",
          name: say("雨", "Rain"),
          defaults: { drops: 9, color: "#2e86de" },
          source: rainSource,
        },
        {
          id: "ground",
          name: say("海与陆地剖面", "Sea and land in section"),
          params: {
            sea: { label: say("海", "Sea"), type: "color" },
            land: { label: say("陆地", "Land"), type: "color" },
          },
          defaults: { shore: 0.42, sea: "#7fb6e8", land: "#9cc77c" },
          source: groundSource,
        },
      ],
      scenes: [
        { id: "root", title: say("太阳系", "Solar system"), checks: [] },
        { id: "earth", title: say("地球上的水循环", "Water on Earth"), parentId: "root", checks: [] },
        { id: "leaf", title: say("一片叶子里的光合作用", "Inside a leaf"), parentId: "earth", checks: [] },
      ],
      modules: [
        // Outermost first, so the inner orbits lie over them and each body stays clickable.
        ...[...planets].reverse().map((p) => ({ ...planet(p), scene: "root" })),
        {
          id: "sun",
          scene: "root",
          bounds: [C.x - 66, C.y - 66, 132, 132],
          drawingId: "picture",
          target: { kind: "detail", id: "sun" },
          data: { material: "sun" },
        },
        // Earth: the water cycle.
        { id: "ground", scene: "earth", bounds: [0, 520, 1300, 280], drawingId: "ground", data: {} },
        { id: "sea", scene: "earth", bounds: [30, 640, 470, 70], drawingId: "waves", data: { rows: 3, color: "#2e86de" } },
        { id: "sea-name", scene: "earth", bounds: [170, 720, 160, 44], drawingId: "label", data: { text: say("海洋", "Ocean"), size: 24 } },
        { id: "sun-e", scene: "earth", bounds: [50, 40, 160, 160], drawingId: "picture", data: { material: "sun" } },
        { id: "cloud", scene: "earth", bounds: [430, 70, 300, 170], drawingId: "picture", data: { material: "cloud" } },
        { id: "cloud2", scene: "earth", bounds: [860, 110, 240, 136], drawingId: "picture", data: { material: "cloud" } },
        { id: "rain", scene: "earth", bounds: [880, 250, 200, 150], drawingId: "rain", data: {} },
        { id: "mountain", scene: "earth", bounds: [900, 330, 380, 232], drawingId: "picture", data: { material: "mountain" } },
        {
          id: "tree",
          scene: "earth",
          bounds: [640, 380, 190, 212],
          drawingId: "picture",
          target: { kind: "scene", id: "leaf" },
          data: { material: "tree" },
        },
        // The leaf.
        { id: "sun-l", scene: "leaf", bounds: [40, 30, 160, 160], drawingId: "picture", data: { material: "sun" } },
        { id: "leaf", scene: "leaf", bounds: [390, 220, 500, 320], drawingId: "picture", data: { material: "leaf" } },
        {
          id: "co2",
          scene: "leaf",
          bounds: [30, 330, 210, 66],
          drawingId: "label",
          data: { text: say("二氧化碳", "Carbon dioxide"), note: say("从气孔进来", "in through the pores"), size: 22 },
        },
        {
          id: "water",
          scene: "leaf",
          bounds: [250, 610, 220, 66],
          drawingId: "label",
          data: { text: say("水", "Water"), note: say("从根沿叶脉送来", "up from the roots"), size: 22 },
        },
        {
          id: "o2",
          scene: "leaf",
          bounds: [1000, 150, 200, 66],
          drawingId: "label",
          data: { text: say("氧气", "Oxygen"), note: say("从气孔出去", "out through the pores"), size: 22 },
        },
        {
          id: "apple",
          scene: "leaf",
          bounds: [1010, 440, 190, 220],
          drawingId: "picture",
          data: { material: "apple", caption: say("糖存进果实里", "The sugar ends up in fruit"), captionSize: 18 },
        },
        {
          id: "vein",
          scene: "leaf",
          bounds: [560, 400, 210, 150],
          drawingId: "leader-label",
          data: { text: say("叶脉", "Vein"), side: "below", size: 19, target: { x: 0.12, y: 0 } },
        },
        {
          id: "chloroplast",
          scene: "leaf",
          bounds: [700, 180, 200, 120],
          drawingId: "leader-label",
          data: { text: say("叶绿体在这里造糖", "Chloroplasts make sugar here"), side: "above", size: 19, target: { x: 0.18, y: 1 } },
        },
        {
          id: "equation",
          scene: "leaf",
          bounds: [330, 700, 640, 60],
          drawingId: "label",
          data: {
            text: say("二氧化碳 + 水 —光→ 葡萄糖 + 氧气", "carbon dioxide + water —light→ sugar + oxygen"),
            size: 24,
            color: "#f08a24",
          },
        },
      ],
      links: [
        { id: "evaporate", scene: "earth", from: { moduleId: "sea", at: "top" }, to: { moduleId: "cloud", at: "left" }, data: { label: say("蒸发", "Evaporation"), flow: true, bend: -0.25, color: "#2e86de", size: 22 } },
        { id: "drift", scene: "earth", from: { moduleId: "cloud", at: "right" }, to: { moduleId: "cloud2", at: "left" }, data: { label: say("风吹云走", "Wind"), flow: true, dashed: true, size: 18 } },
        { id: "runoff", scene: "earth", from: { moduleId: "mountain", at: "bottom" }, to: { moduleId: "sea", at: "right" }, data: { label: say("径流回到大海", "Runoff to the sea"), labelSide: "below", flow: true, bend: -0.12, color: "#2e86de", size: 20 } },
        { id: "transpire", scene: "earth", from: { moduleId: "tree", at: "top" }, to: { moduleId: "cloud", at: "bottom" }, data: { label: say("蒸腾", "Transpiration"), flow: true, dashed: true, bend: 0.2, color: "#4b9a4a", size: 20 } },
        { id: "heat", scene: "earth", from: { moduleId: "sun-e", at: "bottom" }, to: { moduleId: "sea", at: [0.3, 0] }, data: { label: say("阳光加热", "Sunlight warms"), color: "#f08a24", flow: true, bend: 0.15, size: 18 } },
        { id: "light", scene: "leaf", from: { moduleId: "sun-l", at: "right" }, to: { moduleId: "leaf", at: [0.45, 0.25] }, data: { label: say("光能", "Light"), color: "#f08a24", flow: true, bend: -0.15, size: 22 } },
        { id: "co2-in", scene: "leaf", from: { moduleId: "co2", at: "right" }, to: { moduleId: "leaf", at: [0.22, 0.6] }, data: { flow: true, color: "#7a7a7a" } },
        { id: "water-in", scene: "leaf", from: { moduleId: "water", at: "top" }, to: { moduleId: "leaf", at: [0.08, 0.92] }, data: { flow: true, color: "#2e86de" } },
        { id: "o2-out", scene: "leaf", from: { moduleId: "leaf", at: [0.78, 0.2] }, to: { moduleId: "o2", at: "left" }, data: { flow: true, color: "#4b9a4a" } },
        { id: "sugar", scene: "leaf", from: { moduleId: "leaf", at: [0.7, 0.62] }, to: { moduleId: "apple", at: "left" }, data: { label: say("葡萄糖", "Sugar"), flow: true, color: "#c8553d", bend: 0.2, size: 20 } },
      ],
      details: [
        {
          id: "sun",
          title: say("太阳", "The Sun"),
          html: say(
            "<p>太阳占了整个太阳系 99.86% 的质量。它的引力一直拉着每颗行星；行星自己又在飞快地向前跑，所以既不会掉进太阳，也不会飞走——只能一圈一圈地绕着它转。</p><p>离太阳越远，引力越弱，行星跑得越慢，要走的路也越长：水星的一年只有 88 天，土星的一年差不多是 29 个地球年。</p>",
            "<p>The Sun holds 99.86% of the solar system's mass. Its pull never lets go of a planet, while the planet keeps rushing forward — so it neither falls in nor flies off, but goes round and round.</p><p>The farther out, the weaker the pull, the slower the planet and the longer its path: Mercury's year is 88 days, Saturn's nearly 29 Earth years.</p>",
          ),
        },
      ],
    };
    // Looked at: Earth was a speck and nothing said it opens. Bigger, its orbit marked.
    const settled: WorkEdit = {
      modules: [
        {
          id: "earth",
          target: { kind: "scene", id: "earth" },
          data: { size: 46, highlight: true, name: say("地球 · 点我", "Earth · open me") },
        },
      ],
    };
    // Asked for next: "let me change how fast a year goes".
    const slider: WorkEdit = {
      modules: [
        {
          id: "year",
          scene: "root",
          bounds: [C.x - 170, 730, 340, 60],
          drawingId: "slider",
          data: { label: say("地球上的一年", "One Earth year"), min: 2, max: 30, step: 1, value: YEAR, unit: say(" 秒", " s") },
        },
      ],
      scenes: [
        {
          id: "root",
          interaction: `// 拖动滑块：每颗行星的一年按真实比例跟着变
const years = ${JSON.stringify(Object.fromEntries(planets.map((p) => [p.id, p.year])))};
api.on("year", "change", async (seconds) => {
  for (const [id, year] of Object.entries(years)) await api.set(id, { period: +(seconds * year).toFixed(2) });
});`,
          checks: [{ moduleId: "year", selector: "input" }],
        },
      ],
    };
    return [draft, settled, slider];
  },
};
