import { styles, type ShowcaseSource } from "../kit.ts";

/* A picture and nothing else to read but its headline: a lighthouse on a night sea, its
 * beam sweeping, stars coming and going, a boat on the swell. A portrait poster. */

const nightSource = `// 夜空和海：渐变的天，一闪一闪的星星，海平线以下是深色的水
const { width: w, height: h, data: d } = api;
const stars = [];
for (let i = 0; i < d.stars; i++) {
  const x = (i * 97.3) % w, y = ((i * 53.7) % (h * d.horizon * 0.9));
  stars.push(\`<circle cx="\${x}" cy="\${y}" r="\${1 + (i % 3) * 0.6}" fill="#fff"/>\`);
}
const svg = api.svg(\`<svg viewBox="0 0 \${w} \${h}" preserveAspectRatio="none">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="\${d.top}"/><stop offset="1" stop-color="\${d.bottom}"/></linearGradient></defs>
  <rect width="\${w}" height="\${h * d.horizon}" fill="url(#sky)"/>
  <rect y="\${h * d.horizon}" width="\${w}" height="\${h * (1 - d.horizon)}" fill="\${d.sea}"/>
  <g class="stars">\${stars.join("")}</g></svg>\`);
const dots = svg.querySelectorAll(".stars circle");
api.animate((s) => dots.forEach((c, i) => c.setAttribute("opacity", 0.35 + 0.65 * Math.abs(Math.sin(s * 0.8 + i * 1.7)))));
return svg;`;

const beamSource = `// 灯塔的光：从灯室扫出去的一束光，左右慢慢摆
const { width: w, height: h, data: d } = api;
const svg = api.svg(\`<svg viewBox="0 0 \${w} \${h}" style="overflow:visible">
  <defs><radialGradient id="glow" cx="1" cy="0.5" r="1">
    <stop offset="0" stop-color="#fff3c4" stop-opacity=".85"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient></defs>
  <g class="beam"><path d="M\${w} \${h / 2} L0 \${h / 2 - d.spread} L0 \${h / 2 + d.spread} Z" fill="url(#glow)"/></g>
  <circle cx="\${w}" cy="\${h / 2}" r="12" fill="#fff6d5" opacity=".9"/></svg>\`);
const beam = svg.querySelector(".beam");
api.animate((s) => beam.setAttribute("transform", \`rotate(\${Math.sin(s * 0.6) * d.swing} \${w} \${h / 2})\`));
return svg;`;

export const poster: ShowcaseSource = {
  id: "poster",
  title: (say) => say("守夜的灯塔", "The lighthouse keeps watch"),
  brief: (say) => ({
    subject: say("夜里的灯塔", "A lighthouse at night"),
    intent: say("一张安静、温暖的海报：黑夜里总有一盏灯", "A quiet, warm poster: there is always a light in the dark"),
    audience: say("任何人", "Anyone"),
    concept: say(
      "竖版海报，灯塔站在右下的礁石上，一束光扫过夜海，小船朝着光的方向；标题只有一句，压在天上",
      "A portrait poster: the lighthouse on a rock at lower right, its beam sweeping the night sea, a small boat heading for it; one line of headline across the sky",
    ),
    register: "expressive",
    style: "colored-pencil",
    direction: say("深蓝夜色配暖黄灯光，彩铅质感，留大片天空", "Deep blue night against warm lamplight, coloured pencil, a lot of sky"),
    cast: [say("灯塔", "a lighthouse"), say("帆船", "a sailing boat"), say("月亮", "the Moon")],
    basis: { subject: say("灯塔", "lighthouse"), intent: say("一张海报", "a poster"), register: say("海报", "poster") },
  }),
  versions: (say) => [
    {
      title: say("守夜的灯塔", "The lighthouse keeps watch"),
      style: { ...styles["colored-pencil"] },
      drawings: [
        { id: "night", name: say("夜空与海", "Night sky and sea"), defaults: { stars: 46, horizon: 0.66, top: "#0f1b3d", bottom: "#3a4f86", sea: "#16264d" }, source: nightSource },
        { id: "beam", name: say("灯塔的光", "Lighthouse beam"), defaults: { spread: 70, swing: 9 }, source: beamSource },
      ],
      scenes: [{ id: "root", title: say("海报", "Poster"), checks: [] }],
      modules: [
        { id: "night", bounds: [0, 0, 720, 1000], drawingId: "night", data: {} },
        { id: "moon", bounds: [80, 250, 110, 110], drawingId: "picture", data: { material: "moon" } },
        { id: "headline", bounds: [60, 70, 600, 120], drawingId: "label", data: { text: say("黑夜里，总有一盏灯。", "There is always a light."), note: say("THE LIGHTHOUSE KEEPS WATCH", "THE LIGHTHOUSE KEEPS WATCH"), size: 46, weight: 700, color: "#fff6d5", noteColor: "#a9b6dc", halo: false } },
        { id: "beam", bounds: [90, 300, 490, 220], drawingId: "beam", data: {} },
        { id: "sea", bounds: [0, 640, 720, 200], drawingId: "waves", data: { rows: 5, amplitude: 8, wavelength: 90, color: "#6d86c7" } },
        { id: "boat", bounds: [120, 600, 160, 160], drawingId: "picture", data: { material: "sailboat" } },
        { id: "lighthouse", bounds: [470, 330, 220, 460], drawingId: "picture", data: { material: "lighthouse" } },
        { id: "sea2", bounds: [0, 800, 720, 180], drawingId: "waves", data: { rows: 4, amplitude: 10, wavelength: 120, color: "#4b62a3", period: 9 } },
      ],
    },
  ],
};
