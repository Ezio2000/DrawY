import { code, styles, type ShowcaseSource } from "../kit.ts";

/* The same lighthouse in seven of the library's painted styles. The picture changes in
 * place, and under it what else a style brings: its name and character, its colours and
 * its type. It goes through them by itself until someone picks one. */

const fonts = {
  serif: { zh: "宋体", en: "Serif" },
  kai: { zh: "楷体", en: "Brush script" },
  sans: { zh: "黑体", en: "Sans serif" },
};
const looks: {
  style: string;
  zh: string;
  en: string;
  noteZh: string;
  noteEn: string;
  palette: string[];
  font: keyof typeof fonts;
  family: string;
}[] = [
  {
    style: "colored-pencil",
    zh: "彩铅",
    en: "Coloured pencil",
    noteZh: "颜色一层层叠上去，看得见每一道笔触，傍晚的光是暖的",
    noteEn: "Colour laid on stroke by stroke, every line still showing, the evening light warm",
    palette: ["#3b3632", "#c8553d", "#4f7c8a", "#8a817a", "#fbf8f2"],
    font: "serif",
    family: '"Songti SC","Noto Serif CJK SC",serif',
  },
  {
    style: "watercolor",
    zh: "水彩",
    en: "Watercolour",
    noteZh: "半透明的颜色晕开，边缘柔软，像一本绘本",
    noteEn: "Clear washes bleeding into soft edges, like a picture book",
    palette: ["#3d3a4b", "#e07a5f", "#81b29a", "#8f8aa0", "#fdf9f2"],
    font: "kai",
    family: '"Kaiti SC","STKaiti","AR PL UKai CN",serif',
  },
  {
    style: "ink-wash",
    zh: "水墨",
    en: "Ink wash",
    noteZh: "浓墨写礁石，淡墨染海雾，大片留白就是天",
    noteEn: "Dark ink for the rocks, pale washes for the sea mist, the bare paper for sky",
    palette: ["#2a2a28", "#b23a2a", "#6f8f72", "#8b8a80", "#f6f1e6"],
    font: "kai",
    family: '"Kaiti SC","STKaiti","AR PL UKai CN",serif',
  },
  {
    style: "realistic",
    zh: "写实",
    en: "Realistic",
    noteZh: "像照片一样的光影和质感，看得清每一块石头",
    noteEn: "Light and texture as in a photograph, every stone in its place",
    palette: ["#262626", "#b5562b", "#3e6e8e", "#7d7d7d", "#f7f5f0"],
    font: "serif",
    family: '"Songti SC","Noto Serif CJK SC",serif',
  },
  {
    style: "crayon",
    zh: "蜡笔",
    en: "Crayon",
    noteZh: "粗线条、饱和色，太阳和海鸥都像孩子画的",
    noteEn: "Thick lines and bold colour, the sun and the gulls as a child draws them",
    palette: ["#1d1d1d", "#f08a24", "#2e86de", "#7a7a7a", "#fffdf7"],
    font: "kai",
    family: '"Kaiti SC","STKaiti","AR PL UKai CN",serif',
  },
  {
    style: "textbook",
    zh: "教科书",
    en: "Textbook",
    noteZh: "线条均匀、颜色克制，讲清楚为先",
    noteEn: "Even lines and quiet colour, clarity first",
    palette: ["#1f2a30", "#2f7fb5", "#d0632f", "#6b7780", "#ffffff"],
    font: "sans",
    family: '"PingFang SC","Noto Sans CJK SC",sans-serif',
  },
  {
    style: "flat",
    zh: "扁平",
    en: "Flat",
    noteZh: "几何色块，没有描边，放进信息图里最合适",
    noteEn: "Geometric shapes with no outlines, made for infographics",
    palette: ["#22303c", "#ef6f3c", "#2a9d8f", "#7b8a97", "#ffffff"],
    font: "sans",
    family: '"PingFang SC","Noto Sans CJK SC",sans-serif',
  },
];

export const styled: ShowcaseSource = {
  id: "styles",
  title: (say) => say("同一座灯塔，七种画风", "One lighthouse, seven styles"),
  brief: (say) => ({
    subject: say("同一座灯塔", "The same lighthouse"),
    intent: say("只换画风，一张画读起来的感觉能差多远", "How far a picture's feeling moves when only its style changes"),
    audience: say("想给自己的图挑一种画风的人", "Someone choosing a style for their own picture"),
    concept: say(
      "同一处海岬、同一座灯塔，七种画风原地切换；画下面写出这种画风的特点，以及它带来的整套配色和字体——画风不是滤镜，是一整套看法",
      "The same headland and lighthouse in seven styles, switched in place; under the picture what each style is like, and the colours and type it brings with it — a style is not a filter but a whole way of seeing",
    ),
    register: "formal",
    style: "textbook",
    direction: say("白纸、细线，像一张挂起来的画，注意力全留给画面", "White paper and fine lines, the picture hung like a print, the eye left on it"),
    cast: [say("灯塔", "a lighthouse")],
    basis: { subject: say("灯塔", "lighthouse"), intent: say("换几种画风", "in different styles") },
  }),
  versions: (say) => [
    {
      title: say("同一座灯塔，七种画风", "One lighthouse, seven styles"),
      style: { ...styles.textbook },
      drawings: [
        {
          id: "gallery",
          name: say("画风画廊", "Gallery of styles"),
          params: {
            every: { label: { zh: "自动换下一种（秒）", en: "Seconds before the next" }, type: "number", min: 0, max: 20, step: 0.5 },
            value: { label: { zh: "先看第几种", en: "Which first" }, type: "number", min: 0, max: 6, step: 1 },
          },
          defaults: { every: 3.6, value: 0, top: 72, picture: [810, 540] },
          source: code("styles-gallery"),
        },
      ],
      scenes: [{ id: "root", title: say("七种画风", "Seven styles"), checks: [{ moduleId: "gallery", selector: "button" }] }],
      modules: [
        {
          id: "gallery",
          bounds: [0, 0, 1280, 750],
          drawingId: "gallery",
          data: {
            looks: looks.map((l) => ({
              material: "lighthouse-" + l.style,
              name: say(l.zh, l.en),
              note: say(l.noteZh, l.noteEn),
              palette: l.palette,
              font: l.family,
              fontName: say(fonts[l.font].zh, fonts[l.font].en),
            })),
            paletteLabel: say("这种画风的配色与字体", "Its colours and type"),
            sample: say("灯塔", "Lighthouse"),
          },
        },
      ],
      materials: looks.map((l) => "lighthouse-" + l.style),
    },
  ],
};
