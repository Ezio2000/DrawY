import { code, styles, type ShowcaseSource } from "../kit.ts";

/* Why the light carries so far: a lamp on its own, then with a convex lens, then the lens
 * cut back into a Fresnel lens. The rays are refracted as glass refracts them, and the two
 * figures under the options are counted off the drawing itself: how many rays head for the
 * horizon, and how much glass the lens takes. */

const modes = [
  {
    zh: "只有一盏灯",
    en: "Just a lamp",
    lensZh: "",
    lensEn: "",
    capZh: "<b>只有一盏灯</b>：光向四面八方散开，真正射向远方海平线的，只有正中那一条。",
    capEn: "<b>Just a lamp</b>: the light spreads every way, and only the one ray down the middle heads for the horizon.",
  },
  {
    zh: "加一块凸透镜",
    en: "Add a convex lens",
    lensZh: "凸透镜",
    lensEn: "Convex lens",
    capZh: "<b>加一块凸透镜</b>：光被拧成平行的一束，全都射向海平线——可透镜得又大又厚，重得吓人。",
    capEn: "<b>Add a convex lens</b>: the light is bent into one parallel beam, all of it for the horizon — but the glass must be huge, thick and heavy.",
  },
  {
    zh: "换成菲涅耳透镜",
    en: "Make it a Fresnel lens",
    lensZh: "菲涅耳透镜",
    lensEn: "Fresnel lens",
    capZh: "<b>菲涅耳透镜</b>（1822 年）：把凸透镜切成一圈圈薄环，每圈只留下弯光的那段斜面——光一样平行，玻璃省下大半。",
    capEn: "<b>A Fresnel lens</b> (1822): the convex lens cut into thin rings, each keeping only the slope that bends the light — the beam as parallel, most of the glass gone.",
  },
];

export const lens: ShowcaseSource = {
  id: "lens",
  title: (say) => say("那盏灯为什么能照那么远", "Why the light carries so far"),
  brief: (say) => ({
    subject: say("灯塔的透镜", "The lighthouse lens"),
    intent: say(
      "灯本身并不特别亮，是透镜把四散的光拧成一束；菲涅耳透镜用很少的玻璃做到了这一点",
      "The lamp is not so bright; the lens gathers its scattered light into one beam, and a Fresnel lens does it with little glass",
    ),
    audience: say("学过一点光的折射的中学生", "Students who have met refraction"),
    concept: say(
      "侧面看的光路图：左边一盏灯，光线按真实折射穿过透镜。三步依次看：只有灯、加凸透镜、把凸透镜挖成菲涅耳透镜——挖的时候每圈多余的玻璃往后缩，光路不变。两个数直接从图里数出来。",
      "A ray diagram seen from the side: a lamp on the left, its rays refracted through the lens as glass bends them. Three steps in turn: the lamp alone, a convex lens, the lens cut back into a Fresnel lens — each ring's spare glass sliding away while the rays stay as they were. Two figures counted off the drawing.",
    ),
    register: "formal",
    style: "textbook",
    direction: say("白底、细线，光线用暖黄，玻璃用浅蓝，数字醒目", "White ground and fine lines, the rays warm amber, the glass pale blue, the figures large"),
    cast: [],
    basis: { subject: say("灯塔的灯", "the lighthouse light"), intent: say("为什么照得远", "why it carries so far") },
  }),
  versions: (say) => [
    {
      title: say("那盏灯为什么能照那么远", "Why the light carries so far"),
      style: { ...styles.textbook },
      drawings: [
        {
          id: "optics",
          name: say("透镜光路", "Rays through a lens"),
          params: {
            rays: { label: say("光线条数", "Rays"), type: "number", min: 5, max: 41, step: 2 },
            rings: { label: say("菲涅耳透镜的圈数", "Rings of the Fresnel lens"), type: "number", min: 2, max: 16, step: 1 },
            thick: { label: say("凸透镜中间的厚度", "Thickness of the convex lens"), type: "number", min: 40, max: 200, step: 5 },
            every: { label: say("自动换下一步（秒）", "Seconds before the next step"), type: "number", min: 0, max: 20, step: 0.5 },
            light: { label: say("光的颜色", "Colour of the light"), type: "color" },
          },
          defaults: {
            lamp: [250, 392],
            lens: 420,
            aperture: 205,
            thick: 140,
            rings: 7,
            rays: 15,
            spread: 50,
            every: 4.5,
            value: 0,
            light: "#e39b2d",
            meters: [800, 104],
            front: [1160, 660],
            frontR: 58,
          },
          source: code("lens-optics"),
        },
      ],
      scenes: [{ id: "root", title: say("光路", "Rays"), checks: [{ moduleId: "optics", selector: "button" }] }],
      modules: [
        {
          id: "heading",
          bounds: [60, 22, 600, 70],
          drawingId: "label",
          data: {
            text: say("一盏灯，怎样把光送到远方", "How one lamp sends its light far"),
            size: 32,
            weight: 600,
            align: "start",
          },
        },
        {
          id: "optics",
          bounds: [0, 0, 1280, 750],
          drawingId: "optics",
          data: {
            modes: modes.map((m) => ({ name: say(m.zh, m.en), lens: say(m.lensZh, m.lensEn), caption: say(m.capZh, m.capEn) })),
            lampName: say("灯", "Lamp"),
            horizon: say("远方的海平线", "To the horizon"),
            raysLabel: say("射向海平线的光线", "Rays for the horizon"),
            glassLabel: say("用掉的玻璃", "Glass it takes"),
            frontLabel: say("从正面看", "Seen from the front"),
          },
        },
      ],
    },
  ],
};
