import type { DrawingEdit } from "../../../modules/contracts/index.ts";
import { code, type Say, type ShowcaseSource } from "../kit.ts";

/* The first of the lighthouse series: a painting and nothing to read but its headline. A
 * night sea under a moon, the lighthouse's two beams turning back to back, so the beam
 * sweeps long across the sky side on and flares when it faces us, its light shivering on
 * the water in step; a boat heading in, and far off on the headland another light giving
 * its own double flash. */

const PERIOD = 12;

/** The painting's own drawings: the sky, the sea, the lighthouse and the boat. */
const drawings = (say: Say): DrawingEdit[] => [
  {
    id: "sky",
    name: say("夜空", "Night sky"),
    params: {
      stars: { label: { zh: "星星", en: "Stars" }, type: "number", min: 0, max: 400, step: 10 },
      moonSize: { label: { zh: "月亮大小", en: "Moon size" }, type: "number", min: 10, max: 80, step: 1 },
      top: { label: { zh: "天顶", en: "Zenith" }, type: "color" },
      dusk: { label: { zh: "海平线的光", en: "Horizon glow" }, type: "color" },
    },
    defaults: {
      stars: 190,
      horizon: 0.985,
      moon: [0.2, 0.24],
      moonSize: 30,
      top: "#060b1f",
      middle: "#16234d",
      bottom: "#33467c",
      dusk: "#b98a6a",
      land: "#121a38",
    },
    source: code("night-sky"),
  },
  {
    id: "sea",
    name: say("夜海", "Night sea"),
    params: {
      rows: { label: { zh: "浪的排数", en: "Rows of waves" }, type: "number", min: 4, max: 40, step: 1 },
      period: { label: { zh: "光转一圈（秒）", en: "Seconds per turn of the light" }, type: "number", min: 2, max: 60, step: 1 },
    },
    defaults: { rows: 22, period: PERIOD, moonX: 256, lampX: 970, near: "#3a4b80", top: "#1b2856", bottom: "#050a1c" },
    source: code("night-sea"),
  },
  {
    id: "lighthouse",
    name: say("夜里的灯塔", "Lighthouse at night"),
    params: {
      period: { label: { zh: "光转一圈（秒）", en: "Seconds per turn of the light" }, type: "number", min: 2, max: 60, step: 1 },
      reach: { label: { zh: "光束长度", en: "Beam length" }, type: "number", min: 100, max: 1400, step: 10 },
    },
    defaults: { period: PERIOD, reach: 860, lamp: 0.16, waterline: 46, frame: [-820, -150, 1280, 750] },
    source: code("night-lighthouse"),
  },
  { id: "boat", name: say("小帆船", "Small sailing boat"), defaults: {}, source: code("night-boat") },
];

export const night: ShowcaseSource = {
  id: "night",
  title: (say) => say("夜海上的灯塔", "A lighthouse on the night sea"),
  brief: (say) => ({
    subject: say("夜里的灯塔", "A lighthouse at night"),
    intent: say("一幅安静、温暖的画：再黑的海上，也有一盏灯在转", "A quiet, warm picture: however dark the sea, a light is turning"),
    audience: say("任何人", "Anyone"),
    concept: say(
      "横幅夜景：月亮在左上，灯塔立在右边的礁石上，两束光背对背绕塔转动，侧着时扫过整片天，正对着我们时一闪；海面上月光和灯光各拖一条碎光，灯光那条跟着光束明暗；一条小帆船朝灯塔驶来，远处岬角上还有一座小灯塔在闪。标题只有一句。",
      "A wide night scene: the Moon at upper left, the lighthouse on a rock to the right, two beams turning back to back, sweeping the whole sky side on and flaring when they face us; the moonlight and the lamplight each lay a broken path on the sea, the lamp's brightening with the beam; a small boat heading in, and a far light winking on the headland. One line of headline.",
    ),
    register: "expressive",
    style: "colored-pencil",
    direction: say(
      "深蓝夜色配暖黄灯光：天空渐变到海平线的一抹暖色，星星各自闪烁，光束是透明的暖光，宋体标题",
      "Deep blue night against warm lamplight: a sky fading to a warm line on the horizon, stars twinkling each at its own pace, beams of clear warm light, a serif headline",
    ),
    cast: [say("灯塔", "a lighthouse"), say("帆船", "a sailing boat"), say("月亮", "the Moon")],
    basis: { subject: say("灯塔", "lighthouse"), intent: say("一幅画", "a picture"), register: say("海报", "poster") },
  }),
  versions: (say) => [
    {
      title: say("夜海上的灯塔", "A lighthouse on the night sea"),
      style: {
        ink: "#1b2340",
        muted: "#8a93b3",
        accent: "#f2c46d",
        accent2: "#6d86c7",
        paper: "#0d1631",
        stroke: "1.6",
        font: '"Songti SC","Noto Serif CJK SC","Source Han Serif SC","Iowan Old Style",Georgia,serif',
      },
      drawings: drawings(say),
      scenes: [{ id: "root", title: say("夜海", "Night sea"), checks: [] }],
      modules: [
        { id: "sky", bounds: [0, 0, 1280, 474], drawingId: "sky", data: {} },
        { id: "sea", bounds: [0, 470, 1280, 280], drawingId: "sea", data: {} },
        { id: "lighthouse", bounds: [820, 150, 300, 400], drawingId: "lighthouse", data: {} },
        { id: "boat", bounds: [330, 520, 130, 120], drawingId: "boat", data: {} },
        {
          id: "headline",
          bounds: [86, 300, 560, 110],
          drawingId: "label",
          data: {
            text: say("黑夜里，总有一盏灯。", "There is always a light."),
            note: say("灯塔在海上守了两千年的夜", "Keeping watch over the sea for two thousand years"),
            size: 42,
            weight: 600,
            align: "start",
            color: "#fff1d2",
            noteColor: "#9fb0dc",
            halo: false,
          },
        },
      ],
    },
  ],
};
