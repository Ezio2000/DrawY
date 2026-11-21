import type { ModuleEdit } from "../../../modules/contracts/index.ts";
import { code, styles, type ShowcaseSource } from "../kit.ts";

/* How a ship finds itself at night by the lights: a flowchart of what the navigator does,
 * beside a sea chart where it happens. The chart runs through it — a light flashing its
 * character, the list of lights, a bearing, a line, a second light, the fix — and at each
 * step tells the scene, whose script lights the box in the flowchart that says it. */

type Box = { id: string; at: [number, number, number, number]; zh: [string, string?]; en: [string, string?]; shape?: string; tone?: string };
const boxes: Box[] = [
  { id: "see", at: [40, 120, 210, 86], zh: ["看见一道光", "海平线上有灯在闪"], en: ["A light is seen", "Flashing on the horizon"] },
  { id: "count", at: [290, 120, 210, 86], zh: ["数闪光，掐秒表", "两闪一组，十秒一轮"], en: ["Count and time it", "Two flashes every ten seconds"] },
  { id: "lookup", at: [540, 120, 210, 86], zh: ["翻开灯标表", "找闪法对得上的那座"], en: ["Open the list of lights", "Find the one that flashes so"] },
  { id: "match", at: [555, 262, 180, 116], zh: ["对得上吗？"], en: ["Does it match?"], shape: "diamond", tone: "accent2" },
  { id: "bearing", at: [540, 440, 210, 86], zh: ["用罗经测方位", "灯在船的哪个方向"], en: ["Take its bearing", "Which way it lies"] },
  { id: "plot", at: [290, 440, 210, 86], zh: ["在海图上画线", "船就在这条线上"], en: ["Draw it on the chart", "The ship is on that line"] },
  { id: "second", at: [55, 425, 190, 116], zh: ["还有第二座吗？"], en: ["Another light?"], shape: "diamond", tone: "accent2" },
  { id: "fix", at: [40, 610, 290, 86], zh: ["两条线的交点，就是船", "再认一座，照样画一条线"], en: ["Where the lines cross is the ship", "The second light drawn the same way"], shape: "pill", tone: "ink" },
  { id: "wait", at: [400, 620, 290, 66], zh: ["只知道船在线上某处", "等下一座灯出现"], en: ["Somewhere on the line", "Wait for another light"], tone: "muted" },
];
type Anchor = "left" | "right" | "top" | "bottom" | number[];
// The chart's steps, in order, and when each begins in its sixteen-second round.
const order = ["see", "count", "lookup", "match", "bearing", "plot", "second", "fix"];
const STEPS = [0, 2, 4, 5.5, 6.5, 8, 9.5, 13];

export const navigate: ShowcaseSource = {
  id: "navigate",
  title: (say) => say("夜里，船怎么靠灯塔认路", "Finding the way at night by the lights"),
  brief: (say) => ({
    subject: say("夜航时用灯塔定位", "Fixing a ship's position by lighthouses at night"),
    intent: say(
      "认出是哪座灯塔、测出它的方向，两座灯塔的两条方位线一交，船在哪就清楚了",
      "Tell which light it is and which way it lies; the bearings of two lights cross where the ship is",
    ),
    audience: say("对航海好奇的人", "Anyone curious about navigation"),
    concept: say(
      "左边是航海者要做的事，画成流程图，两个判断各有出路；右边一张海图把同样的事演一遍：灯按灯质闪、对灯标表、测方位、画线、第二座灯塔、两线一交。海图走到哪一步，流程图上那一格就亮。",
      "On the left what the navigator does, as a flowchart with two decisions; on the right a sea chart acting it out: the light flashing its character, the list of lights, the bearing, the line, the second light, the lines crossing. Whichever step the chart is on lights up in the flowchart.",
    ),
    register: "formal",
    style: "textbook",
    direction: say("流程图干净规整，海图用真正海图的配色：浅黄的陆地、浅蓝的海、洋红的灯光符号", "A clean, even flowchart, and a chart in a real chart's colours: pale yellow land, pale blue sea, magenta light flares"),
    cast: [],
    basis: { subject: say("灯塔", "lighthouses"), intent: say("船怎么用它认路", "how ships find their way by them") },
  }),
  versions: (say) => {
    const base = (b: Box) => ({ tone: b.tone ?? "plain", fillStyle: b.tone ? "soft" : "none", lift: false });
    const modules: ModuleEdit[] = boxes.map((b) => ({
      id: b.id,
      bounds: b.at,
      drawingId: "node",
      data: {
        title: say(b.zh[0], b.en[0]),
        ...(b.zh[1] ? { note: say(b.zh[1], b.en[1]!) } : {}),
        shape: b.shape ?? "box",
        size: 19,
        ...base(b),
      },
    }));
    const link = (id: string, from: string, fromAt: Anchor, to: string, toAt: Anchor, data: Record<string, unknown> = {}) => ({
      id,
      from: { moduleId: from, at: fromAt },
      to: { moduleId: to, at: toAt },
      data: { flow: true, size: 16, ...data },
    });
    return [
      {
        title: say("夜里，船怎么靠灯塔认路", "Finding the way at night by the lights"),
        style: { ...styles.textbook },
        drawings: [
          {
            id: "chart",
            name: say("海图上的两线定位", "A two-bearing fix on a chart"),
            params: { loop: { label: say("演示一轮（秒）", "Seconds per round"), type: "number", min: 8, max: 60, step: 1 } },
            defaults: { a: [92, 214], b: [384, 128], ship: [252, 430], loop: 16, steps: STEPS, tagW: 300 },
            source: code("chart-fix"),
          },
        ],
        scenes: [
          {
            id: "root",
            title: say("两线定位", "The fix"),
            interaction: `// 海图演到哪一步，流程图上那一格就亮起来
const order = ${JSON.stringify(order)};
const base = ${JSON.stringify(Object.fromEntries(boxes.map((b) => [b.id, base(b)])))};
let lit = null;
api.on("chart", "step", async ({ index }) => {
  const id = order[index];
  if (id === lit) return;
  const last = lit;
  lit = id;
  if (last) await api.set(last, base[last]);
  await api.set(id, { tone: "accent", fillStyle: "soft", lift: true });
});`,
            checks: [],
          },
        ],
        modules: [
          {
            id: "heading",
            bounds: [40, 18, 720, 70],
            drawingId: "label",
            data: { text: say("夜里，船怎么靠灯塔认出自己在哪", "How a ship finds itself at night by the lights"), size: 30, weight: 600, align: "start" },
          },
          ...modules,
          {
            id: "chart",
            bounds: [790, 100, 470, 620],
            drawingId: "chart",
            data: {
              aName: say("A 灯塔", "Light A"),
              bName: say("B 灯塔", "Light B"),
              tagLook: say("灯标表：Fl(2) 10s 是……", "List of lights: Fl(2) 10s is…"),
              tagYes: say("灯标表：Fl(2) 10s 是 A 灯塔 ✓", "List of lights: Fl(2) 10s is Light A ✓"),
              fixName: say("船在这里", "The ship is here"),
              chartName: say("海图（示意）", "Sea chart (sketch)"),
            },
          },
        ],
        links: [
          link("l1", "see", "right", "count", "left"),
          link("l2", "count", "right", "lookup", "left"),
          link("l3", "lookup", "bottom", "match", "top"),
          link("yes", "match", "bottom", "bearing", "top", { label: say("对", "Yes") }),
          link("no", "match", "left", "count", "bottom", { label: say("不对，再看一轮", "No: watch again"), dashed: true, bend: 0.25 }),
          link("l4", "bearing", "left", "plot", "right"),
          link("l5", "plot", "left", "second", "right"),
          link("has", "second", "bottom", "fix", "top", { label: say("有", "Yes") }),
          link("none", "second", [0.85, 0.75], "wait", "left", { label: say("没有", "No"), labelSide: "below", dashed: true }),
        ],
      },
    ];
  },
};
