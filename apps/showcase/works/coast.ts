import { code, styles, type ShowcaseSource } from "../kit.ts";

/* Scotland's coast lit up one lighthouse at a time, as the Stevensons built them. The map is
 * the library's real coastline; the lights lie over it at their true positions, coloured by
 * who built them, and come on in the year they were first lit. The years play by
 * themselves until someone drags them or picks a light. */

const builders = [
  { zh: "托马斯·史密斯", en: "Thomas Smith", color: "#8a7f74" },
  { zh: "罗伯特·史蒂文森", en: "Robert Stevenson", color: "#c8553d" },
  { zh: "艾伦·史蒂文森", en: "Alan Stevenson", color: "#2f7fb5" },
  { zh: "大卫与托马斯兄弟", en: "David and Thomas", color: "#3f8f5a" },
  { zh: "大卫·艾伦·史蒂文森", en: "David Alan Stevenson", color: "#8e5ea2" },
];
const lights = [
  { zh: "金奈尔德角", en: "Kinnaird Head", lon: -2.002, lat: 57.698, year: 1787, by: 0, side: "right", storyZh: "北方灯塔委员会点亮的第一盏灯，就装在一座古堡的塔楼上。", storyEn: "The first light of the Northern Lighthouse Board, set on top of an old castle tower." },
  { zh: "贝尔礁", en: "Bell Rock", lon: -2.387, lat: 56.434, year: 1811, by: 1, side: "right", storyZh: "建在一块涨潮时没入海中的暗礁上，是世界上现存最古老的海浪冲刷式灯塔。", storyEn: "Built on a reef that drowns at high tide: the oldest surviving sea-washed lighthouse in the world." },
  { zh: "梅岛", en: "Isle of May", lon: -2.557, lat: 56.186, year: 1816, by: 1, side: "right", storyZh: "1636 年起岛上就烧着一堆煤火作灯标；1816 年，罗伯特的新塔取代了它。", storyEn: "A coal fire burned here as a beacon from 1636; in 1816 Robert's new tower took its place." },
  { zh: "萨姆堡角", en: "Sumburgh Head", lon: -1.276, lat: 59.853, year: 1821, by: 1, side: "left", storyZh: "设得兰群岛的最南端，也是设得兰的第一座灯塔。", storyEn: "At the southern tip of Shetland, and Shetland's first lighthouse." },
  { zh: "拉斯角", en: "Cape Wrath", lon: -4.999, lat: 58.626, year: 1828, by: 1, side: "above", storyZh: "苏格兰本土的西北角。“Wrath”来自古诺斯语，意思是转弯的地方——维京人的船在这里掉头。", storyEn: "The north-west corner of mainland Scotland. 'Wrath' is Old Norse for a turning point, where the Viking ships turned." },
  { zh: "加洛韦角", en: "Mull of Galloway", lon: -4.857, lat: 54.635, year: 1830, by: 1, side: "right", storyZh: "苏格兰最南端的一点。", storyEn: "The southernmost point of Scotland." },
  { zh: "斯凯里沃尔", en: "Skerryvore", lon: -7.113, lat: 56.323, year: 1844, by: 2, side: "left", storyZh: "48 米高，苏格兰最高的灯塔，孤零零地立在大西洋里的一片礁石上。", storyEn: "At 48 metres the tallest in Scotland, standing alone on a reef out in the Atlantic." },
  { zh: "阿德纳默亨", en: "Ardnamurchan", lon: -6.226, lat: 56.727, year: 1849, by: 2, side: "right", storyZh: "英国本土的最西端，塔身带着埃及式的装饰。", storyEn: "The westernmost point of mainland Britain, its tower dressed in an Egyptian style." },
  { zh: "马克尔弗拉加", en: "Muckle Flugga", lon: -0.886, lat: 60.856, year: 1858, by: 3, side: "left", storyZh: "英国最北的灯塔。克里米亚战争时为护航舰队匆忙建起，后来才换成石塔。", storyEn: "Britain's most northerly lighthouse, first put up in haste for the fleet in the Crimean War, then rebuilt in stone." },
  { zh: "刘易斯角", en: "Butt of Lewis", lon: -6.261, lat: 58.516, year: 1862, by: 3, side: "left", storyZh: "外赫布里底群岛的最北端，一座没有刷白的红砖塔。", storyEn: "The northern tip of the Outer Hebrides: a tower of bare red brick." },
  { zh: "杜布阿塔克", en: "Dubh Artach", lon: -6.632, lat: 56.132, year: 1872, by: 3, side: "right", storyZh: "建它的时候，史蒂文森家的儿子路易斯来过岸上的工地，那座小岛后来写进了他的小说《绑架》。", storyEn: "While it was being built, the family's son Louis stayed at the shore station; the island found its way into his novel Kidnapped." },
  { zh: "弗兰南群岛", en: "Flannan Isles", lon: -7.588, lat: 58.288, year: 1899, by: 4, side: "below", storyZh: "1900 年冬天，三名守塔人在这里一起消失了，至今没人说得清是怎么回事。", storyEn: "In the winter of 1900 its three keepers vanished together; no one has ever said for certain how." },
];
const MAP = { x: 20, y: 10, w: 520, h: 730, bounds: [-8.6, 54.4, 0.0, 61.1] };

export const coast: ShowcaseSource = {
  id: "coast",
  title: (say) => say("苏格兰的灯，一盏盏亮起来", "Scotland's lights, coming on one by one"),
  brief: (say) => ({
    subject: say("苏格兰海岸上的灯塔", "The lighthouses of Scotland's coast"),
    intent: say(
      "一百多年里，一家人把苏格兰最险的海岸一段段照亮",
      "Over a hundred years one family lit the most dangerous of Scotland's coast, stretch by stretch",
    ),
    audience: say("喜欢地图和历史的人", "Anyone who likes maps and history"),
    concept: say(
      "真实的苏格兰海岸线，十二座灯塔落在真实的经纬度上，按建成的年份一盏盏亮起，颜色表示是谁造的；右边是年份、每人造了几座和当下这一座的故事。时间轴可以拖，灯塔可以点。",
      "Scotland's real coastline, twelve lighthouses at their true positions coming on in the years they were first lit, coloured by who built them; on the right the year, how many each had built, and the story of the light at hand. The years can be dragged and the lights picked.",
    ),
    register: "formal",
    style: "textbook",
    direction: say("安静的地形底图，灯塔是发光的暖色点，每个建造者一种颜色", "A quiet relief map, the lights warm glowing points, one colour for each builder"),
    cast: builders.map((b) => say(b.zh, b.en)),
    basis: { subject: say("苏格兰的灯塔", "Scotland's lighthouses"), intent: say("在哪里，什么时候建的", "where and when") },
  }),
  versions: (say) => [
    {
      title: say("苏格兰的灯，一盏盏亮起来", "Scotland's lights, coming on one by one"),
      style: { ...styles.textbook },
      drawings: [
        {
          id: "lights",
          name: say("灯塔一盏盏亮起", "Lights coming on"),
          params: {
            play: { label: say("从头播一遍（秒）", "Seconds to play through"), type: "number", min: 4, max: 60, step: 1 },
            hold: { label: say("播完停多久（秒）", "Seconds to rest at the end"), type: "number", min: 0, max: 20, step: 1 },
          },
          defaults: { play: 16, hold: 4, years: [1780, 1905], timeline: [600, 700, 620], panel: [600, 210], cardY: 170, cardW: 600 },
          source: code("coast-lights"),
        },
      ],
      scenes: [{ id: "root", title: say("苏格兰", "Scotland"), checks: [] }],
      modules: [
        {
          id: "map",
          bounds: [MAP.x, MAP.y, MAP.w, MAP.h],
          drawingId: "geomap",
          data: {
            bounds: MAP.bounds,
            borders: "none",
            rivers: "none",
            relief: true,
            edge: "fade",
            scale: true,
            language: say("zh", "en"),
            size: 15,
            places: [
              { name: say("北海", "North Sea"), lon: -0.9, lat: 57.0, kind: "water" },
              { name: say("大西洋", "Atlantic Ocean"), lon: -8.0, lat: 57.3, kind: "water" },
            ],
          },
        },
        {
          id: "heading",
          bounds: [600, 30, 640, 90],
          drawingId: "label",
          data: {
            text: say("苏格兰的海岸，一盏一盏亮起来", "Scotland's coast, lit one light at a time"),
            note: say("一家人，一百多年，把最险的海岸一段段照亮", "One family, a hundred years, the worst of the coast lit"),
            size: 30,
            weight: 600,
            align: "start",
          },
        },
        {
          id: "lights",
          bounds: [0, 0, 1280, 750],
          drawingId: "lights",
          data: {
            map: MAP,
            builders: builders.map((b) => ({ name: say(b.zh, b.en), color: b.color })),
            lights: lights.map((l) => ({ name: say(l.zh, l.en), lon: l.lon, lat: l.lat, year: l.year, by: l.by, side: l.side, story: say(l.storyZh, l.storyEn) })),
            countText: say("已经亮起 {n} 座", "{n} lit so far"),
            emptyName: say("海岸还是黑的", "The coast is still dark"),
            emptyStory: say("1786 年，北方灯塔委员会成立，要在苏格兰最险的海角上点灯。", "In 1786 the Northern Lighthouse Board was set up to light Scotland's most dangerous headlands."),
          },
        },
      ],
    },
  ],
};
