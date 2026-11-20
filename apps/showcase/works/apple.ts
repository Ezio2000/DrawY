import { styles, type ShowcaseSource } from "../kit.ts";

/* One apple in each of the library's painted styles, switched by a row of choices: the
 * scene's script swaps the picture and the words under it. */

const looks = [
  { material: "apple", zh: "彩铅", en: "Coloured pencil", noteZh: "一层层叠出来的颜色，看得见笔触", noteEn: "Colour laid on stroke by stroke" },
  { material: "apple-crayon", zh: "蜡笔", en: "Crayon", noteZh: "粗线条、饱和色，像孩子画的", noteEn: "Thick lines and bold colour, like a child's" },
  { material: "apple-watercolor", zh: "水彩", en: "Watercolour", noteZh: "半透明的颜色晕开，边缘柔软", noteEn: "Washes that bleed into soft edges" },
  { material: "apple-ink-wash", zh: "水墨", en: "Ink wash", noteZh: "浓淡墨色，大片留白", noteEn: "Graded ink and a lot of empty paper" },
  { material: "apple-textbook", zh: "教科书", en: "Textbook", noteZh: "线条均匀、颜色克制，讲清楚为先", noteEn: "Even lines, quiet colour, clarity first" },
  { material: "apple-realistic", zh: "写实", en: "Realistic", noteZh: "像照片一样的光影和质感", noteEn: "Light and texture like a photograph" },
  { material: "apple-flat", zh: "扁平", en: "Flat", noteZh: "几何色块，没有描边", noteEn: "Geometric shapes, no outlines" },
];

export const apple: ShowcaseSource = {
  id: "apple",
  title: (say) => say("同一颗苹果，七种画风", "One apple, seven styles"),
  brief: (say) => ({
    subject: say("苹果", "An apple"),
    intent: say("同一个东西换一种画风，读起来的感觉有多不同", "How much the same thing changes when only its style does"),
    audience: say("想挑一种画风的人", "Someone choosing a style"),
    concept: say(
      "一颗苹果站在正中，上面一排画风可以切换；苹果原地换装，名字和一句话的特点跟着变，别的都不动，差别只来自画风",
      "One apple in the middle with a row of styles above it; the apple changes in place and the words under it follow, nothing else moves, so the difference is the style alone",
    ),
    register: "formal",
    style: "textbook",
    direction: say("白纸、细线、克制的配色，把注意力留给苹果", "White paper, fine lines and quiet colour, leaving the eye on the apple"),
    cast: [say("苹果", "an apple")],
    basis: { subject: say("苹果", "apple"), intent: say("换几种画风", "in different styles") },
  }),
  versions: (say) => [
    {
      title: say("同一颗苹果，七种画风", "One apple, seven styles"),
      style: { ...styles.textbook },
      scenes: [
        {
          id: "root",
          title: say("七种画风", "Seven styles"),
          interaction: `// 选一种画风：苹果原地换装，名字和特点跟着变
const looks = ${JSON.stringify(looks.map((l) => ({ material: l.material, name: say(l.zh, l.en), note: say(l.noteZh, l.noteEn) })))};
api.on("styles", "change", async ({ index }) => {
  const look = looks[index];
  await api.set("apple", { material: look.material });
  await api.set("caption", { text: look.name, note: look.note });
});`,
          checks: [{ moduleId: "styles", selector: "button" }],
        },
      ],
      modules: [
        {
          id: "styles",
          bounds: [90, 30, 920, 54],
          drawingId: "choice",
          data: { options: looks.map((l) => say(l.zh, l.en)), value: say(looks[0].zh, looks[0].en), size: 17 },
        },
        { id: "shadow", bounds: [400, 540, 300, 28], drawingId: "ground-shadow", data: { opacity: 0.18 } },
        { id: "apple", bounds: [350, 140, 400, 410], drawingId: "picture", data: { material: "apple" } },
        {
          id: "caption",
          bounds: [250, 590, 600, 84],
          drawingId: "label",
          data: { text: say(looks[0].zh, looks[0].en), note: say(looks[0].noteZh, looks[0].noteEn), size: 30, weight: 600 },
        },
      ],
      // The other six are swapped in by the script, which names them by a value it builds.
      materials: looks.slice(1).map((l) => l.material),
    },
  ],
};
