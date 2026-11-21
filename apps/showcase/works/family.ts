import { code, styles, type ShowcaseSource } from "../kit.ts";

/* The Lighthouse Stevensons: four generations as a tree growing to the right, each person a
 * silhouette in an oval ringed in the colour their lights have on the map, with what they
 * left under their name. Picking someone tells their story and lights the line back to
 * Thomas Smith. The family's most famous son built no lighthouse at all. */

const people = [
  { id: "smith", x: 120, y: 310, color: "#8a7f74", zh: ["托马斯·史密斯", "金奈尔德角"], en: ["Thomas Smith", "Kinnaird Head"], years: "1752–1815", storyZh: "北方灯塔委员会的第一位工程师，本行是做油灯的铁匠。他娶了罗伯特的母亲，后来罗伯特又娶了他的女儿。", storyEn: "The Northern Lighthouse Board's first engineer, a lamp-maker by trade. He married Robert's mother; later Robert married his daughter." },
  { id: "robert", parent: "smith", x: 360, y: 310, color: "#c8553d", zh: ["罗伯特·史蒂文森", "贝尔礁、梅岛、萨姆堡角、拉斯角、加洛韦角"], en: ["Robert Stevenson", "Bell Rock, Isle of May, Sumburgh Head, Cape Wrath, Mull of Galloway"], years: "1772–1850", note: ["继父，也是岳父", "stepfather, father-in-law"], storyZh: "贝尔礁灯塔的总工程师，一辈子在苏格兰的海角上造灯塔，还发明了让灯一闪一闪的闪光灯。", storyEn: "Engineer of the Bell Rock, he spent his life building lights on Scotland's headlands, and devised the flashing light." },
  { id: "alan", parent: "robert", x: 600, y: 120, color: "#2f7fb5", zh: ["艾伦·史蒂文森", "斯凯里沃尔、阿德纳默亨"], en: ["Alan Stevenson", "Skerryvore, Ardnamurchan"], years: "1807–1865", storyZh: "长子，造了斯凯里沃尔。他精通透镜，把菲涅耳的透镜带进了英国的灯塔。", storyEn: "The eldest son, builder of Skerryvore. A master of lenses, he brought Fresnel's lens to Britain's lighthouses." },
  { id: "david", parent: "robert", x: 600, y: 310, color: "#3f8f5a", beard: true, zh: ["大卫·史蒂文森", "马克尔弗拉加、刘易斯角、杜布阿塔克"], en: ["David Stevenson", "Muckle Flugga, Butt of Lewis, Dubh Artach"], years: "1815–1886", storyZh: "和弟弟托马斯一起接下家业，在英国最北端的马克尔弗拉加点亮了灯。", storyEn: "With his brother Thomas he took on the family firm, and lit Muckle Flugga at Britain's northern tip." },
  { id: "thomas", parent: "robert", x: 600, y: 520, color: "#3f8f5a", beard: true, zh: ["托马斯·史蒂文森", "马克尔弗拉加、杜布阿塔克、百叶箱"], en: ["Thomas Stevenson", "Muckle Flugga, Dubh Artach, the Stevenson screen"], years: "1818–1887", storyZh: "改进了灯塔的透镜和反光镜，还发明了气象站里放温度计的百叶箱。", storyEn: "He improved lighthouse lenses and reflectors, and invented the slatted box that holds every weather station's thermometers." },
  { id: "davidalan", parent: "david", x: 840, y: 120, color: "#8e5ea2", beard: true, zh: ["大卫·艾伦·史蒂文森", "弗兰南群岛"], en: ["David Alan Stevenson", "Flannan Isles"], years: "1854–1938", storyZh: "大卫的儿子，接着造灯塔；弗兰南群岛的灯就是他点亮的。", storyEn: "David's son, who carried on building; the Flannan Isles light was his." },
  { id: "charles", parent: "david", x: 840, y: 310, color: "#a07db3", zh: ["查尔斯·史蒂文森", "和哥哥一起造灯塔"], en: ["Charles Stevenson", "Lights built with his brother"], years: "1855–1950", storyZh: "大卫的另一个儿子，和哥哥一起接着做灯塔工程。", storyEn: "David's other son, who worked beside his brother on the lights." },
  { id: "dalan", parent: "charles", x: 1080, y: 310, color: "#7b6f86", zh: ["D. 艾伦·史蒂文森", "《1820 年以前的世界灯塔》"], en: ["D. Alan Stevenson", "The World's Lighthouses Before 1820"], years: "1891–1971", storyZh: "查尔斯的儿子，家里最后一位灯塔工程师，还写了一部世界灯塔史。", storyEn: "Charles's son, the last lighthouse engineer of the family, who also wrote a history of the world's lighthouses." },
  { id: "louis", parent: "thomas", x: 840, y: 520, color: "#d08a1e", hair: true, zh: ["罗伯特·路易斯·史蒂文森", "《金银岛》《化身博士》"], en: ["Robert Louis Stevenson", "Treasure Island, Jekyll and Hyde"], years: "1850–1894", storyZh: "托马斯的儿子。学过造灯塔，跟着父亲上过工地——后来却当了作家，写出了《金银岛》和《化身博士》。家里最出名的人，一座灯塔也没造。", storyEn: "Thomas's son. He trained as a lighthouse engineer and went out to the works with his father — then became a writer, of Treasure Island and Jekyll and Hyde. The family's most famous son built no lighthouse at all." },
];

export const family: ShowcaseSource = {
  id: "family",
  title: (say) => say("造灯塔的一家人", "The Lighthouse Stevensons"),
  brief: (say) => ({
    subject: say("史蒂文森家族", "The Stevenson family"),
    intent: say(
      "苏格兰的大半灯塔出自一家四代人之手；而这家最出名的儿子，去写了小说",
      "Most of Scotland's lighthouses came from four generations of one family; and its most famous son went off to write novels",
    ),
    audience: say("喜欢历史和人物故事的人", "Anyone who likes history and lives"),
    concept: say(
      "一棵向右长的家谱树：每人一枚剪影小像，圈的颜色和地图上他造的灯塔一致，名字下面写着他留下的灯塔；点一个人，左下讲他的故事，他往上的那条线亮起来。最后一个是路易斯——写《金银岛》的那位。",
      "A family tree growing to the right: each person a silhouette ringed in the colour of their lights on the map, with what they left under their name; picking someone tells their story and lights their line back. Last of all, Louis — who wrote Treasure Island.",
    ),
    register: "formal",
    style: "colored-pencil",
    direction: say("维多利亚时代的剪影小像，暖白纸、细线，每个建造者一种颜色", "Victorian silhouette portraits, warm white paper and fine lines, a colour for each builder"),
    cast: people.map((p) => say(p.zh[0], p.en[0])),
    basis: { subject: say("灯塔", "lighthouses"), intent: say("是谁造的", "who built them") },
  }),
  versions: (say) => [
    {
      title: say("造灯塔的一家人", "The Lighthouse Stevensons"),
      style: { ...styles["colored-pencil"] },
      drawings: [
        {
          id: "tree",
          name: say("剪影家谱", "Family tree in silhouettes"),
          params: { every: { label: say("自动讲下一位（秒）", "Seconds before the next"), type: "number", min: 1, max: 20, step: 0.5 } },
          defaults: { every: 5, value: 0, card: [40, 490, 420, 240] },
          source: code("family-tree"),
        },
      ],
      scenes: [{ id: "root", title: say("一家人", "The family"), checks: [] }],
      modules: [
        {
          id: "heading",
          bounds: [40, 18, 520, 90],
          drawingId: "label",
          data: {
            text: say("造灯塔的一家人", "The Lighthouse Stevensons"),
            note: say("四代人，造了苏格兰的大半灯塔", "Four generations, most of Scotland's lights"),
            size: 32,
            weight: 600,
            align: "start",
          },
        },
        {
          id: "tree",
          bounds: [0, 0, 1280, 750],
          drawingId: "tree",
          data: {
            people: people.map((p) => ({
              id: p.id,
              parent: p.parent,
              x: p.x,
              y: p.y,
              color: p.color,
              beard: !!p.beard,
              hair: !!p.hair,
              name: say(p.zh[0], p.en[0]),
              works: say(p.zh[1], p.en[1]),
              years: p.years,
              story: say(p.storyZh, p.storyEn),
              ...(p.note ? { linkNote: say(p.note[0], p.note[1]) } : {}),
            })),
          },
        },
      ],
    },
  ],
};
