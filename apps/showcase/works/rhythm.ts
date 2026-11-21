import { code, styles, type ShowcaseSource } from "../kit.ts";

/* Why a lighthouse flashes: the lenses ride a turning table, each throwing a beam, and a
 * ship sees a flash whenever one sweeps over it. How the lenses are set out and how fast the
 * table turns make the rhythm, written on the chart as the light's character, by which a
 * navigator tells one lighthouse from another. Both can be changed. */

const presets = [
  { zh: "一块透镜", en: "One lens", panels: [0] },
  { zh: "四块均匀", en: "Four, even", panels: [0, 90, 180, 270] },
  { zh: "两块一组", en: "In pairs", panels: [0, 15, 180, 195] },
  { zh: "三块一组", en: "In threes", panels: [0, 12, 24, 120, 132, 144, 240, 252, 264] },
];
const START = 2;

export const rhythm: ShowcaseSource = {
  id: "rhythm",
  title: (say) => say("灯塔为什么一闪一闪", "Why a lighthouse flashes"),
  brief: (say) => ({
    subject: say("灯塔的闪光节奏", "A lighthouse's rhythm of flashes"),
    intent: say(
      "灯并没有开关，是透镜带着光束在转；透镜怎么排、转多快，决定了它独一无二的闪法",
      "Nothing switches on and off: the lenses carry the beams round, and how they are set out and how fast they turn give each light a rhythm of its own",
    ),
    audience: say("对机械和航海好奇的人", "Anyone curious about machines or the sea"),
    concept: say(
      "左边从正上方看灯室：几块透镜各射出一束光，跟着转台一起转，远处一条船；光束扫过船，船边一亮。右边把船上看到的亮度像走纸一样记 30 秒，再写成海图上的灯质。下面可以换透镜的排法、调转台的快慢。",
      "On the left the lantern from above: a few lenses each throwing a beam, turning together, and a ship off to the east that lights up as a beam passes. On the right, what the ship sees over the last thirty seconds, like a chart recorder, written out as the light's character on a sea chart. Below, the arrangement of the lenses and the speed of the turn can be changed.",
    ),
    register: "formal",
    style: "textbook",
    direction: say("海面是深夜的蓝，光束和记录线用暖黄，其余是白底细线", "The sea in night blue, the beams and the trace in warm amber, the rest fine lines on white"),
    cast: [say("一条船", "a ship")],
    basis: { subject: say("灯塔", "lighthouse"), intent: say("为什么一闪一闪", "why it flashes") },
  }),
  versions: (say) => [
    {
      title: say("灯塔为什么一闪一闪", "Why a lighthouse flashes"),
      style: { ...styles.textbook },
      drawings: [
        {
          id: "rhythm",
          name: say("转台与闪光", "Turning lenses and the flashes"),
          params: {
            period: { label: say("转一圈（秒）", "Seconds per turn"), type: "number", min: 1, max: 120, step: 1 },
            light: { label: say("光的颜色", "Colour of the light"), type: "color" },
            night: { label: say("夜色", "Night"), type: "color" },
          },
          defaults: { center: [330, 420], radius: 290, ship: 0, period: 20, panels: presets[START].panels, light: "#f0b545", night: "#121c3d", chart: [700, 190, 540, 190] },
          source: code("flash-rhythm"),
        },
      ],
      scenes: [
        {
          id: "root",
          title: say("闪光的节奏", "The rhythm"),
          interaction: `// 换透镜的排法、调转台的快慢：灯塔的闪法跟着变
const presets = ${JSON.stringify(presets.map((p) => p.panels))};
api.on("arrangement", "change", async ({ index }) => {
  await api.set("rhythm", { panels: presets[index] });
});
api.on("period", "change", async (seconds) => {
  await api.set("rhythm", { period: seconds });
});`,
          checks: [
            { moduleId: "arrangement", selector: "button" },
            { moduleId: "period", selector: "input" },
          ],
        },
      ],
      modules: [
        {
          id: "heading",
          bounds: [40, 18, 620, 60],
          drawingId: "label",
          data: { text: say("每一座灯塔，都有自己的闪法", "Every lighthouse has a rhythm of its own"), size: 32, weight: 600, align: "start" },
        },
        {
          id: "rhythm",
          bounds: [0, 0, 1280, 750],
          drawingId: "rhythm",
          data: {
            planName: say("从正上方看灯室", "The lantern seen from above"),
            shipName: say("船", "Ship"),
            chartName: say("船上看到的光", "What the ship sees"),
            chartNote: say("最近 30 秒，越高越亮", "The last thirty seconds; higher is brighter"),
            nowName: say("现在", "now"),
            say1: say("每 {s} 秒闪一下", "One flash every {s} seconds"),
            sayN: say("每 {s} 秒连闪 {k} 下", "{k} flashes every {s} seconds"),
            codeName: say("海图上写作", "On the chart:"),
          },
        },
        {
          id: "arrangement",
          bounds: [690, 570, 560, 50],
          drawingId: "choice",
          data: { options: presets.map((p) => say(p.zh, p.en)), value: say(presets[START].zh, presets[START].en), size: 17 },
        },
        {
          id: "period",
          bounds: [720, 640, 500, 64],
          drawingId: "slider",
          data: { label: say("转台转一圈", "One turn of the table"), min: 6, max: 40, step: 1, value: 20, unit: say("秒", "s"), size: 18 },
        },
      ],
    },
  ],
};
