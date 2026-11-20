import { styles, type ShowcaseSource } from "../kit.ts";

/* The heart beating at the rate the slider sets, its parts named the textbook way, with
 * what it pumps worked out as the rate changes. */

const beatingSource = `// 一颗按 bpm 跳动的心脏：收缩时先猛地一缩，再轻轻一弹
const { width: w, height: h, data: d } = api;
const box = api.html(\`<div style="width:\${w}px;height:\${h}px;transform-origin:50% 58%"></div>\`).firstElementChild;
box.append(api.material(d.picture, { width: w, height: h, align: "center" }));
api.animate((s) => {
  const beat = (s * d.bpm / 60) % 1;
  const k = beat < 0.12 ? 1 - 0.07 * Math.sin((beat / 0.12) * Math.PI)
    : beat < 0.3 ? 1 - 0.025 * Math.sin(((beat - 0.12) / 0.18) * Math.PI) : 1;
  box.style.transform = \`scale(\${k})\`;
});
return box;`;

const H = { x: 440, y: 130, w: 320, h: 494 };
/** A point on the heart picture, as a share of its width and height. */
const on = (x: number, y: number) => ({ x: H.x + H.w * x, y: H.y + H.h * y });

export const heart: ShowcaseSource = {
  id: "heart",
  title: (say) => say("心脏怎样把血送到全身", "How the heart pumps blood"),
  brief: (say) => ({
    subject: say("心脏", "The heart"),
    intent: say("心脏的结构，以及心跳快慢和泵血量的关系", "Its parts, and how the beat rate sets how much blood it moves"),
    audience: say("中学生", "Secondary-school students"),
    concept: say(
      "一颗正在跳的心脏站在正中，部位用引线标出；红色的含氧血从主动脉出去，蓝色的缺氧血从腔静脉回来。拖动心率，心跳和每分钟泵出的血量一起变",
      "A beating heart in the middle with its parts named by leader lines; red blood leaves by the aorta, blue blood returns by the vena cava. Drag the rate and the beat and the litres per minute change together",
    ),
    register: "formal",
    style: "colored-pencil",
    direction: say("彩铅解剖图，暖灰细线标注，宋体小字", "Coloured-pencil anatomy, fine warm-grey leaders, small serif labels"),
    cast: [say("心脏", "the heart")],
    basis: { subject: say("心脏", "the heart"), intent: say("怎样把血送到全身", "how it pumps blood") },
  }),
  versions: (say) => {
    const leader = (id: string, x: number, y: number, side: "left" | "right", length: number, zh: string, en: string) => {
      const p = on(x, y);
      return {
        id,
        bounds: [side === "right" ? p.x : p.x - length, p.y - 20, length, 40],
        drawingId: "leader-label",
        data: { text: say(zh, en), side, size: 19, target: { x: side === "right" ? 0 : 1, y: 0.5 } },
      };
    };
    return [
      {
        title: say("心脏怎样把血送到全身", "How the heart pumps blood"),
        style: { ...styles["colored-pencil"] },
        drawings: [
          {
            id: "beating",
            name: say("跳动的心脏", "Beating heart"),
            params: { bpm: { label: say("心率", "Beats per minute"), type: "number", min: 30, max: 200, step: 1 } },
            defaults: { picture: "heart", bpm: 72 },
            source: beatingSource,
          },
        ],
        scenes: [
          {
            id: "root",
            title: say("心脏", "The heart"),
            interaction: `// 心率一变：心跳跟着变，每分钟泵出的血量按每搏约 70 毫升算
api.on("rate", "change", async (bpm) => {
  await api.set("heart", { bpm });
  await api.set("output", { text: ${JSON.stringify(say("每分钟约 ", "About "))} + (bpm * 0.07).toFixed(1) + ${JSON.stringify(say(" 升", " L a minute"))} });
});`,
            checks: [{ moduleId: "rate", selector: "input" }],
          },
        ],
        modules: [
          { id: "heart", bounds: [H.x, H.y, H.w, H.h], drawingId: "beating", data: {} },
          leader("aorta", 0.56, 0.07, "right", 300, "主动脉", "Aorta"),
          leader("pulmonary", 0.66, 0.24, "right", 250, "肺动脉", "Pulmonary artery"),
          leader("left-ventricle", 0.74, 0.66, "right", 200, "左心室", "Left ventricle"),
          leader("vena-cava", 0.13, 0.16, "left", 260, "上腔静脉", "Superior vena cava"),
          leader("right-atrium", 0.2, 0.43, "left", 270, "右心房", "Right atrium"),
          leader("right-ventricle", 0.4, 0.7, "left", 330, "右心室", "Right ventricle"),
          {
            id: "out",
            bounds: [624, 18, 330, 120],
            drawingId: "arrow",
            data: { from: { x: 0, y: 1 }, to: { x: 0.92, y: 0.25 }, bend: 0.3, flow: true, color: "#c8553d", width: 3, label: say("含氧血送往全身", "Oxygen-rich blood to the body"), size: 18 },
          },
          {
            id: "back",
            bounds: [210, 18, 280, 150],
            drawingId: "arrow",
            data: { from: { x: 0.05, y: 0.15 }, to: { x: 0.98, y: 0.98 }, bend: -0.2, flow: true, color: "#4f7c8a", width: 3, label: say("缺氧血回到心脏", "Spent blood returns"), size: 18 },
          },
          {
            id: "rate",
            bounds: [300, 690, 340, 60],
            drawingId: "slider",
            data: { label: say("心率", "Heart rate"), min: 40, max: 180, step: 1, value: 72, unit: say(" 次/分", " bpm") },
          },
          {
            id: "output",
            bounds: [690, 690, 300, 66],
            drawingId: "label",
            data: { text: say("每分钟约 5.0 升", "About 5.0 L a minute"), note: say("每跳一次约泵出 70 毫升", "about 70 mL each beat"), size: 24, weight: 600, color: "#c8553d" },
          },
        ],
      },
    ];
  },
};
