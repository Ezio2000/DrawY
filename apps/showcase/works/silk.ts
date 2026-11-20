import { styles, type ShowcaseSource } from "../kit.ts";

/* The Silk Road on a true map: its towns where they really are, the road along the oases
 * north of the Taklamakan, without today's borders or roads. */

export const silk: ShowcaseSource = {
  id: "silk",
  title: (say) => say("丝绸之路经过哪些地方", "Where the Silk Road ran"),
  brief: (say) => ({
    subject: say("丝绸之路", "The Silk Road"),
    intent: say("从长安到君士坦丁堡，沿途经过哪些城市、绕开了什么", "Which cities it ran through from Chang'an to Constantinople, and what it went round"),
    audience: say("历史爱好者", "Readers of history"),
    concept: say(
      "一张真实地理的地图，路线顺着塔克拉玛干沙漠北缘的绿洲一站站往西，读者沿着线走一遍就记住了顺序",
      "A map from real geography: the road hops west from oasis to oasis along the Taklamakan's northern edge, so following the line once teaches the order",
    ),
    register: "formal",
    style: "colored-pencil",
    direction: say("彩铅地图，暖色路线，不画今天的国界和公路", "A coloured-pencil map, a warm route, no modern borders or roads"),
    cast: [say("长安", "Chang'an"), say("敦煌", "Dunhuang"), say("撒马尔罕", "Samarkand"), say("君士坦丁堡", "Constantinople")],
    basis: { subject: say("丝绸之路", "the Silk Road"), intent: say("经过哪些地方", "where did it run") },
  }),
  versions: (say) => [
    {
      title: say("丝绸之路经过哪些地方", "Where the Silk Road ran"),
      style: { ...styles["colored-pencil"] },
      scenes: [{ id: "root", title: say("丝绸之路", "The Silk Road"), checks: [] }],
      modules: [
        {
          id: "map",
          bounds: [0, 0, 1280, 620],
          drawingId: "geomap",
          data: {
            bounds: [24, 27, 114, 47],
            roads: false,
            language: say("zh", "en"),
            places: [
              { name: say("长安", "Chang'an"), lon: 108.94, lat: 34.26, kind: "capital", major: true, note: say("起点 · 今西安", "start · now Xi'an") },
              { name: say("兰州", "Lanzhou"), lon: 103.83, lat: 36.06, kind: "town" },
              { name: say("敦煌", "Dunhuang"), lon: 94.66, lat: 40.14, kind: "town", major: true, note: say("莫高窟", "Mogao Caves") },
              { name: say("吐鲁番", "Turpan"), lon: 89.19, lat: 42.95, kind: "town", label: "above" },
              { name: say("库车", "Kucha"), lon: 82.96, lat: 41.72, kind: "town", label: "above" },
              { name: say("喀什", "Kashgar"), lon: 75.99, lat: 39.47, kind: "town" },
              { name: say("撒马尔罕", "Samarkand"), lon: 66.96, lat: 39.65, kind: "town", major: true, note: say("粟特商人的故乡", "home of Sogdian merchants") },
              { name: say("梅尔夫", "Merv"), lon: 61.84, lat: 37.66, kind: "town", label: "below" },
              { name: say("巴格达", "Baghdad"), lon: 44.36, lat: 33.31, kind: "capital", major: true },
              { name: say("君士坦丁堡", "Constantinople"), lon: 28.98, lat: 41.01, kind: "capital", major: true, note: say("终点 · 今伊斯坦布尔", "end · now Istanbul") },
              { name: say("塔克拉玛干沙漠", "Taklamakan Desert"), lon: 82.5, lat: 38.6, kind: "region" },
              { name: say("帕米尔高原", "Pamirs"), lon: 73.2, lat: 38.2, kind: "mountain" },
              { name: say("里海", "Caspian Sea"), lon: 50.8, lat: 41.6, kind: "water" },
            ],
            routes: [
              {
                points: [
                  say("长安", "Chang'an"), say("兰州", "Lanzhou"), [100.4, 38.9], say("敦煌", "Dunhuang"),
                  say("吐鲁番", "Turpan"), say("库车", "Kucha"), [79.3, 41.1], say("喀什", "Kashgar"),
                  [72.4, 39.9], say("撒马尔罕", "Samarkand"), say("梅尔夫", "Merv"), [51.4, 35.7], [47.5, 34.3],
                  say("巴格达", "Baghdad"), [38.3, 36.5], [36.2, 36.2], [32.9, 39.9], say("君士坦丁堡", "Constantinople"),
                ],
                label: say("丝绸之路", "Silk Road"),
                arrow: "along",
                width: 4,
                color: "#c8553d",
              },
            ],
          },
        },
      ],
    },
  ],
};
