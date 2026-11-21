import { code, styles, type ShowcaseSource } from "../kit.ts";

/* How far a light can be seen: the Earth curves away, so a light is hidden past the
 * horizon however bright it is. The keeper's height and the sailor's each buy a stretch of
 * sea; together they are the farthest the light reaches. Two sliders, one for each height;
 * the curve below places a few real towers on it. Geometry only, d ≈ 3.57(√H + √h) km. */

const refs = [
  { zh: "贝尔礁", en: "Bell Rock", m: 35, side: "left", dy: -12 },
  { zh: "斯凯里沃尔", en: "Skerryvore", m: 48, side: "right", dy: 24 },
  { zh: "维尔热岛", en: "Île Vierge", m: 82.5, side: "right", dy: 24 },
  { zh: "吉达灯塔", en: "Jeddah Light", m: 133, side: "left", dy: -14 },
];

export const range: ShowcaseSource = {
  id: "range",
  title: (say) => say("灯塔越高，照得越远吗", "Does a taller lighthouse reach farther?"),
  brief: (say) => ({
    subject: say("灯光能被看到的最远距离", "How far off a light can be seen"),
    intent: say(
      "地球是弯的：灯再亮，过了海平线也看不见；能看多远，看的是灯有多高、看的人有多高",
      "The Earth curves: past the horizon a light is hidden however bright; how far it reaches depends on how high the light is, and how high the one looking",
    ),
    audience: say("学过勾股定理的中学生", "Students who know Pythagoras"),
    concept: say(
      "上半张把地球的弯曲夸大：灯和船上的人各自看到自己的海平线，两段距离一加，视线正好擦过海面，再往外是看不见灯的地方。下半张是距离随灯高变化的曲线，几座真实的灯塔落在线上。两个滑块调两个高度。",
      "Above, the Earth's curve exaggerated: the light and the sailor each see their own horizon, the two stretches together make the line of sight that just grazes the sea, and beyond it the light is hidden. Below, the distance against the light's height, with a few real towers on the curve. Two sliders for the two heights.",
    ),
    register: "formal",
    style: "textbook",
    direction: say("教科书式的示意图加函数曲线，海用蓝，光用暖黄，结论用大号数字", "A textbook figure over a plotted curve, the sea blue, the light amber, the answer in large figures"),
    cast: [say("灯塔", "a lighthouse"), say("一条船", "a ship")],
    basis: { subject: say("灯塔", "lighthouse"), intent: say("能照多远", "how far it reaches") },
  }),
  versions: (say) => [
    {
      title: say("灯塔越高，照得越远吗", "Does a taller lighthouse reach farther?"),
      style: { ...styles.textbook },
      drawings: [
        {
          id: "range",
          name: say("海平线与视距", "The horizon and how far one sees"),
          params: {
            H: { label: say("灯离海面的高度（米）", "Height of the light (m)"), type: "number", min: 1, max: 150, step: 1 },
            h: { label: say("看的人眼睛的高度（米）", "Height of the eye (m)"), type: "number", min: 0.5, max: 30, step: 0.5 },
            light: { label: say("光的颜色", "Colour of the light"), type: "color" },
          },
          defaults: {
            H: 48,
            h: 10,
            light: "#e39b2d",
            pxPerKm: 15,
            earth: 1100,
            horizonY: 214,
            sea: "#2f7fb5",
            left: 96,
            plot: [110, 520, 520, 190],
            readout: [720, 520],
          },
          source: code("horizon-range"),
        },
      ],
      scenes: [
        {
          id: "root",
          title: say("能看多远", "How far"),
          interaction: `// 拖动两个高度：海平线、视线和曲线上的点一起变
api.on("lamp", "change", async (H) => {
  await api.set("range", { H });
});
api.on("eye", "change", async (h) => {
  await api.set("range", { h });
});`,
          checks: [
            { moduleId: "lamp", selector: "input" },
            { moduleId: "eye", selector: "input" },
          ],
        },
      ],
      modules: [
        {
          id: "range",
          bounds: [0, 0, 1280, 750],
          drawingId: "range",
          data: {
            refs: refs.map((r) => ({ name: say(r.zh, r.en), m: r.m, side: r.side, dy: r.dy })),
            lampName: say("灯高", "Light"),
            eyeName: say("眼高", "Eye"),
            horizonName: say("海平线", "Horizon"),
            hiddenName: say("这里看不见灯", "The light is hidden here"),
            plotName: say("灯越高，看得越远——但越往上越不划算", "Higher reaches farther — but each metre buys less"),
            farName: say("最远能在这么远处看见灯", "The light can be seen as far as"),
            kmName: say("公里", "km"),
            nmName: say("海里", "nautical miles"),
            note: say("灯高按塔高粗算，不计大气折射；折射会让光再远一点", "Tower heights used for the light; refraction, left out, adds a little more"),
          },
        },
        {
          id: "heading",
          bounds: [40, 18, 760, 90],
          drawingId: "label",
          data: {
            text: say("灯塔越高，照得越远吗？", "Does a taller lighthouse reach farther?"),
            note: say("地球是弯的：过了海平线，灯再亮也看不见", "The Earth curves: past the horizon, no light is bright enough"),
            size: 32,
            weight: 600,
            align: "start",
          },
        },
        {
          id: "lamp",
          bounds: [720, 676, 240, 60],
          drawingId: "slider",
          data: { label: say("灯高 H", "Light H"), min: 5, max: 150, step: 1, value: 48, unit: "m", size: 17 },
        },
        {
          id: "eye",
          bounds: [990, 676, 240, 60],
          drawingId: "slider",
          data: { label: say("眼高 h", "Eye h"), min: 1, max: 30, step: 1, value: 10, unit: "m", size: 17, color: "#1f2a30" },
        },
      ],
    },
  ],
};
