import { code, styles, type ShowcaseSource } from "../kit.ts";

/* Two thousand years of lighthouses: ten real towers in the order they were lit, each
 * drawn to one scale against a ruler of metres, so the tallest and the most daring can be
 * told apart at a glance. Picking one tells what it left to the story; left alone, the
 * drawing goes along them by itself. */

const towers = [
  { shape: "pharos", m: 100, when: ["约前 280 年", "c. 280 BC"], name: ["亚历山大灯塔", "Pharos"], height: ["约 100 米", "about 100 m"], story: ["古代世界七大奇迹之一，塔顶燃着一堆火，为驶进港口的船引路；14 世纪毁于地震。", "One of the Seven Wonders of the ancient world, a fire on its top guiding ships into the harbour; brought down by earthquakes in the 1300s."] },
  { shape: "hercules", m: 55, when: ["2 世纪", "2nd c."], name: ["赫拉克勒斯塔", "Hercules"], height: ["55 米", "55 m"], story: ["罗马人建在西班牙西北的海角上，至今还亮着，是仍在使用的最古老的灯塔。", "Built by the Romans on a headland in north-west Spain and still lit today: the oldest lighthouse in use."] },
  { shape: "concave", base: 0.21, top: 0.12, curve: 2, fill: "#f7f5ef", bands: [[0.12, 0.27], [0.42, 0.57], [0.72, 0.87]], m: 22, when: ["1759", "1759"], name: ["斯米顿塔", "Smeaton's"], height: ["22 米", "22 m"], story: ["前两座木塔，一座被风暴卷走，一座被大火烧毁。斯米顿改用燕尾榫咬合的花岗岩，照着橡树的样子造——后来的石塔都学它。", "Of the two wooden towers before it, one was swept away by a storm and one burned down. Smeaton built in dovetailed granite, shaped like an oak — every stone tower after learned from it."] },
  { shape: "concave", base: 0.15, top: 0.075, curve: 2.2, fill: "#d9d1c3", m: 35, when: ["1811", "1811"], name: ["贝尔礁", "Bell Rock"], height: ["35 米", "35 m"], story: ["建在涨潮时没入海中的暗礁上，工人只能趁退潮干活。如今是现存最古老的海浪冲刷式灯塔。", "Built on a reef that drowns at high tide, the men working only at low water; today the oldest surviving sea-washed lighthouse."] },
  { shape: "tiers", m: 68, when: ["1823", "1823"], name: ["科尔杜昂", "Cordouan"], height: ["68 米", "68 m"], story: ["人称“海上的凡尔赛”。1823 年，世界上第一具菲涅耳透镜在这里点亮。", "Called the Versailles of the sea. In 1823 the world's first Fresnel lens was lit here."] },
  { shape: "concave", base: 0.13, top: 0.065, curve: 2.4, fill: "#cdc6b8", m: 48, when: ["1844", "1844"], name: ["斯凯里沃尔", "Skerryvore"], height: ["48 米", "48 m"], story: ["艾伦·史蒂文森在大西洋的一片礁石上造了六年，苏格兰最高的灯塔。", "Six years' work by Alan Stevenson on an Atlantic reef: the tallest lighthouse in Scotland."] },
  { shape: "concave", base: 0.24, top: 0.2, curve: 1, fill: "#f7f5ef", m: 21, when: ["1858", "1858"], name: ["南福兰", "S. Foreland"], height: ["21 米", "21 m"], story: ["第一座用上电灯的灯塔，试验由法拉第亲自主持。", "The first lighthouse lit by electricity, in trials overseen by Michael Faraday."] },
  { shape: "concave", base: 0.075, top: 0.055, curve: 1.3, fill: "#c9c2b5", m: 82.5, when: ["1902", "1902"], name: ["维尔热岛", "Île Vierge"], height: ["82.5 米", "82.5 m"], story: ["82.5 米，世界上最高的石砌灯塔，爬到顶要走 365 级台阶。", "At 82.5 metres the tallest stone lighthouse in the world: 365 steps to the top."] },
  { shape: "needle", m: 133, when: ["1990", "1990"], name: ["吉达灯塔", "Jeddah"], height: ["133 米", "133 m"], story: ["钢筋混凝土造的细高塔身，133 米，世界上最高的灯塔。", "A slender tower of reinforced concrete, 133 metres: the tallest lighthouse in the world."] },
  { shape: "concave", base: 0.2, top: 0.16, curve: 1, fill: "#f7f5ef", m: 26, when: ["1998", "1998"], name: ["北福兰", "N. Foreland"], height: ["26 米", "26 m"], story: ["英国最后一座有人值守的灯塔改成了自动。最后几位守塔人走下塔来，灯照旧亮着。", "The last staffed lighthouse in Britain went automatic. The last keepers came down, and the light shone on."] },
];

export const history: ShowcaseSource = {
  id: "history",
  title: (say) => say("灯塔两千年", "Two thousand years of lighthouses"),
  brief: (say) => ({
    subject: say("灯塔的历史", "The history of the lighthouse"),
    intent: say(
      "从一堆火到无人值守的自动灯塔，每一步改变了什么；它们有多高，一眼比得出来",
      "From a fire on a tower to the automatic light, what each step changed; and how tall they were, side by side",
    ),
    audience: say("喜欢历史和建筑的人", "Anyone who likes history and buildings"),
    concept: say(
      "一条时间线上站着十座真实的灯塔，全部按同一个比例尺画出剖影，背后是米数的刻度——时间线也是一张高度对比图。点一座，上面讲它在灯塔史上留下了什么。",
      "Ten real lighthouses standing along a line of years, all drawn to one scale against a ruler of metres — a timeline that is also a comparison of heights. Pick one to hear what it left to the story.",
    ),
    register: "formal",
    style: "colored-pencil",
    direction: say("像博物馆的展板：暖白底、细墨线、石头本色，强调色只给讲到的那一座", "Like a museum panel: warm white, fine ink, the stones in their own colours, the accent only for the one being told"),
    cast: [],
    basis: { subject: say("灯塔", "lighthouses"), intent: say("是怎样一步步变成今天这样的", "how they came to be what they are") },
  }),
  versions: (say) => [
    {
      title: say("灯塔两千年", "Two thousand years of lighthouses"),
      style: { ...styles["colored-pencil"] },
      drawings: [
        {
          id: "towers",
          name: say("按比例画的灯塔时间线", "A timeline of towers to scale"),
          params: {
            perMetre: { label: say("每米多少像素", "Pixels per metre"), type: "number", min: 1, max: 6, step: 0.1 },
            every: { label: say("自动讲下一座（秒）", "Seconds before the next"), type: "number", min: 1, max: 20, step: 0.5 },
          },
          defaults: { ground: 590, perMetre: 3.2, left: 110, right: 40, every: 5, breakAfter: 2, card: [240, 104, 620] },
          source: code("towers-history"),
        },
      ],
      scenes: [{ id: "root", title: say("两千年", "Two thousand years"), checks: [] }],
      modules: [
        {
          id: "heading",
          bounds: [40, 18, 700, 60],
          drawingId: "label",
          data: { text: say("灯塔两千年，按同一把尺子量", "Two thousand years of lighthouses, to one scale"), size: 30, weight: 600, align: "start" },
        },
        {
          id: "towers",
          bounds: [0, 0, 1280, 750],
          drawingId: "towers",
          data: {
            towers: towers.map((tw) => ({
              ...tw,
              when: say(tw.when[0], tw.when[1]),
              name: say(tw.name[0], tw.name[1]),
              height: say(tw.height[0], tw.height[1]),
              story: say(tw.story[0], tw.story[1]),
            })),
            breakText: say("一千五百多年", "1,500 years on"),
          },
        },
      ],
    },
  ],
};
