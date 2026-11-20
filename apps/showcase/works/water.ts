import { styles, type ShowcaseSource } from "../kit.ts";

/* Where Earth's water is: a donut for all of it, bars for the fresh part, and the one
 * figure that matters. Shares from the USGS's estimates of the global water distribution. */

export const water: ShowcaseSource = {
  id: "water",
  title: (say) => say("地球上的水都在哪里", "Where Earth's water is"),
  brief: (say) => ({
    subject: say("地球上水的分布", "How Earth's water is distributed"),
    intent: say("淡水只占很少一部分，能直接用的更少", "How little of it is fresh, and how much less is within reach"),
    audience: say("初中地理课的学生", "Geography students of about thirteen"),
    concept: say(
      "左边一个环图是全部的水，几乎全是海洋；右边把那一小块淡水拆成柱子，冰川占了大头；中间一个大数字把结论说出来",
      "A donut on the left for all the water, nearly all of it sea; bars on the right take apart the sliver that is fresh, mostly ice; one big number between them says it",
    ),
    register: "formal",
    style: "textbook",
    direction: say("教科书式的平涂色块，蓝色为主，数字醒目", "Textbook flat colour, mostly blue, figures that stand out"),
    cast: [],
    basis: { subject: say("地球上的水", "Earth's water"), intent: say("都在哪里", "where is it") },
  }),
  versions: (say) => [
    {
      title: say("地球上的水都在哪里", "Where Earth's water is"),
      style: { ...styles.textbook },
      scenes: [{ id: "root", title: say("水的分布", "Water"), checks: [] }],
      modules: [
        {
          id: "all",
          bounds: [20, 60, 520, 360],
          drawingId: "donut",
          data: {
            items: [
              { label: say("海洋和其他咸水", "Oceans and other salt water"), value: 97.5 },
              { label: say("淡水", "Fresh water"), value: 2.5 },
            ],
            center: say("全部的水", "All water"),
            centerNote: say("约 13.9 亿立方千米", "about 1.39 billion km³"),
            size: 17,
          },
        },
        {
          id: "share",
          bounds: [570, 230, 190, 150],
          drawingId: "stat",
          data: { value: "2.5", unit: "%", label: say("是淡水", "is fresh"), note: say("其中大半冻在冰里", "most of it frozen"), align: "center" },
        },
        {
          id: "fresh",
          bounds: [790, 60, 460, 360],
          drawingId: "bars",
          data: {
            items: [
              { label: say("冰川与冰盖", "Ice and glaciers"), value: 68.7, accent: true },
              { label: say("地下水", "Groundwater"), value: 30.1 },
              { label: say("湖泊、河流等", "Lakes, rivers, other"), value: 1.2 },
            ],
            unit: "%",
            size: 16,
          },
        },
        {
          id: "fresh-title",
          bounds: [870, 10, 300, 40],
          drawingId: "label",
          data: { text: say("淡水里", "Of the fresh water"), size: 18, weight: 600 },
        },
      ],
      links: [
        { id: "zoom", from: { moduleId: "all", at: "right" }, to: { moduleId: "fresh", at: "left" }, data: { dashed: true, bend: -0.3, color: "#2f7fb5" } },
      ],
    },
  ],
};
