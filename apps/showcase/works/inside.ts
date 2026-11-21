import { code, styles, type ShowcaseSource } from "../kit.ts";

/* Inside the lighthouse: a rock tower cut in half from the lantern down to its solid base.
 * Each floor can be picked, in the drawing or by its name; the scene's script lays what it
 * is for on the card beside it. Left alone, the drawing goes down the floors by itself. */

const parts = [
  {
    span: [44, 202],
    at: 140,
    zh: ["灯室", "透镜和灯都在这里"],
    en: ["Lantern", "The lens and the lamp"],
    textZh: "一圈玻璃围着菲涅耳透镜和灯。透镜重达几吨，却浮在一槽水银上，轻轻一推就能转。外面一圈回廊，守塔人每天出去擦掉玻璃上的盐和雾。",
    textEn: "A ring of glass round the Fresnel lens and the lamp. The lens weighs tons, yet floats on a bath of mercury and turns at a push. Outside runs a gallery, where the keeper wipes salt and mist off the glass every day.",
  },
  {
    span: [196, 266],
    at: 231,
    zh: ["值守室", "守塔人值夜的地方"],
    en: ["Watch room", "Where the keeper keeps watch"],
    textZh: "转动透镜的是一台钟表机构，靠重锤慢慢下落带动。守塔人每隔几个小时把重锤摇上去，再记下天气、能见度和过往的船。",
    textEn: "A clockwork turns the lens, driven by a weight slowly falling down the tower. Every few hours the keeper winds it back up, and logs the weather, the visibility and the ships going by.",
  },
  {
    span: [266, 336],
    at: 301,
    zh: ["卧室", "床是弯的"],
    en: ["Bedroom", "The beds are curved"],
    textZh: "塔是圆的，床也只好顺着墙弯成弧形，守塔人管它叫“香蕉床”。几个人轮流值班，总有一个在睡。",
    textEn: "The tower is round, so the bunks curve with the wall — the keepers called them banana beds. They took turns on watch, so one of them was always asleep.",
  },
  {
    span: [336, 406],
    at: 371,
    zh: ["厨房", "塔里最暖和的一层"],
    en: ["Kitchen", "The warmest floor"],
    textZh: "炉子的烟道贴着墙一路通到塔顶。煮饭、烧水、烘干湿衣服都靠它，这一层是塔里最暖和的地方。",
    textEn: "The stove's flue runs up the wall to the top of the tower. It cooks, boils the water and dries wet clothes; this is the warmest floor in the tower.",
  },
  {
    span: [406, 470],
    at: 438,
    zh: ["储藏室", "灯油、淡水和口粮"],
    en: ["Stores", "Oil, water and food"],
    textZh: "灯油、淡水、煤和好几个月的口粮都放在这里。风浪大的时候，补给船可能好几个星期都靠不了岸。",
    textEn: "Lamp oil, fresh water, coal and months of food. In a long spell of storms, the relief boat might not land for weeks.",
  },
  {
    span: [470, 526],
    at: 498,
    zh: ["入口", "门开在半空"],
    en: ["Entrance", "A door in mid-air"],
    textZh: "门开在高出礁石好几米的地方，只能爬一架铜梯上来。这样大浪拍过来时，也灌不进塔里。",
    textEn: "The door is set metres above the rock and reached by a bronze ladder, so even the biggest waves cannot pour in.",
  },
  {
    span: [526, 612],
    at: 569,
    zh: ["实心基座", "石头咬着石头"],
    en: ["Solid base", "Stone locked into stone"],
    textZh: "最下面这一截是实心的：花岗岩一块块用燕尾榫咬在一起，层层错缝。工程师斯米顿照着一棵橡树设计了这种塔——根粗、身子细，风浪越大，扎得越稳。",
    textEn: "The bottom of the tower is solid: granite blocks dovetailed into one another, course upon course. The engineer John Smeaton shaped it on an oak tree — broad at the root, slender above, holding the harder the storm pushes.",
  },
];

export const inside: ShowcaseSource = {
  id: "inside",
  title: (say) => say("走进一座灯塔", "Inside a lighthouse"),
  brief: (say) => ({
    subject: say("一座礁石灯塔的内部", "Inside a rock lighthouse"),
    intent: say("塔里一层层是做什么的，守塔人怎样住在里面", "What each floor is for, and how the keepers lived in it"),
    audience: say("好奇灯塔里面什么样的人", "Anyone who has wondered what is inside"),
    concept: say(
      "把塔从中间剖开：墙画成石砌的断面，屋里的家什用细线画；左边逐层标名，点任何一层，右边的卡片讲它的用处。透镜在转，重锤在落，浪拍着礁石。",
      "The tower cut down the middle: the walls drawn as masonry in section, the rooms' furnishings in fine line; each floor named on the left, and picking one tells its use on the card to the right. The lens turns, the weight falls, the waves break on the rock.",
    ),
    register: "formal",
    style: "colored-pencil",
    direction: say("像工程图册里的剖面插图：暖灰石色、细墨线、斜线表示剖切面，强调色只给选中的那一层", "Like a plate in an engineering book: warm grey stone, fine ink, hatching for the cut, the accent only for the floor chosen"),
    cast: [say("守塔人", "the keeper")],
    basis: { subject: say("灯塔", "lighthouse"), intent: say("里面什么样", "what is inside") },
  }),
  versions: (say) => {
    const words = parts.map((p, i) => ({
      span: p.span,
      at: p.at,
      name: say(p.zh[0], p.en[0]),
      short: say(p.zh[1], p.en[1]),
      text: say(p.textZh, p.textEn),
      kicker: say(`从上往下 · 第 ${i + 1} 层`, `Floor ${i + 1} of ${parts.length}, from the top`),
    }));
    return [
      {
        title: say("走进一座灯塔", "Inside a lighthouse"),
        style: { ...styles["colored-pencil"] },
        drawings: [
          {
            id: "cutaway",
            name: say("灯塔剖面", "Lighthouse in section"),
            params: {
              every: { label: say("自动看下一层（秒）", "Seconds before the next floor"), type: "number", min: 1, max: 20, step: 0.5 },
              period: { label: say("透镜转一圈（秒）", "Seconds per turn of the lens"), type: "number", min: 2, max: 60, step: 1 },
            },
            defaults: { axis: 540, labelRight: 330, every: 4.5, period: 10, value: 0 },
            source: code("cutaway"),
          },
          { id: "card", name: say("说明卡片", "Card"), defaults: {}, source: code("card") },
        ],
        scenes: [
          {
            id: "root",
            title: say("灯塔剖面", "In section"),
            interaction: `// 选中一层：右边的卡片换成这一层的说明
const parts = ${JSON.stringify(words.map(({ name, text, kicker }) => ({ name, text, kicker })))};
api.on("tower", "pick", async ({ index }) => {
  const p = parts[index];
  await api.set("card", { kicker: p.kicker, title: p.name, text: p.text, index, total: parts.length });
});`,
            checks: [],
          },
        ],
        modules: [
          {
            id: "tower",
            bounds: [0, 0, 760, 750],
            drawingId: "cutaway",
            data: { parts: words.map(({ span, at, name, short }) => ({ span, at, name, short })) },
          },
          {
            id: "heading",
            bounds: [800, 60, 440, 90],
            drawingId: "label",
            data: {
              text: say("一座礁石灯塔的剖面", "A rock lighthouse in section"),
              note: say("点塔里任何一层，看它是做什么的", "Pick any floor to see what it is for"),
              size: 32,
              weight: 600,
              align: "start",
            },
          },
          {
            id: "card",
            bounds: [800, 190, 440, 400],
            drawingId: "card",
            data: { kicker: words[0].kicker, title: words[0].name, text: words[0].text, index: 0, total: parts.length },
          },
        ],
      },
    ];
  },
};
