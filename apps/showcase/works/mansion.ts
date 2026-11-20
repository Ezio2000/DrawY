import { styles, type ShowcaseSource } from "../kit.ts";

/* Who is whose in the Jia household: portraits in fine ink, the ties written on the lines,
 * vermilion kept for the one bond the novel turns on. */

const people = [
  { id: "jiamu", zh: "贾母", en: "Grandmother Jia", picture: "matriarch", x: 545, y: 20 },
  { id: "jiazheng", zh: "贾政", en: "Jia Zheng", picture: "lord", x: 250, y: 290 },
  { id: "wangfuren", zh: "王夫人", en: "Lady Wang", picture: "madam", x: 545, y: 290 },
  { id: "xifeng", zh: "王熙凤", en: "Wang Xifeng", picture: "noblewoman", x: 860, y: 290 },
  { id: "daiyu", zh: "林黛玉", en: "Lin Daiyu", picture: "lady", x: 150, y: 570 },
  { id: "baoyu", zh: "贾宝玉", en: "Jia Baoyu", picture: "youth", x: 545, y: 570 },
  { id: "baochai", zh: "薛宝钗", en: "Xue Baochai", picture: "girl", x: 940, y: 570 },
];

export const mansion: ShowcaseSource = {
  id: "mansion",
  title: (say) => say("红楼梦里谁是谁的谁", "Who's who in the Red Chamber"),
  brief: (say) => ({
    subject: say("《红楼梦》贾府的人物关系", "The Jia household in Dream of the Red Chamber"),
    intent: say("几个核心人物之间的亲缘和情感关系", "How the central characters are related, by blood and by heart"),
    audience: say("刚开始读红楼梦的人", "Someone starting the novel"),
    concept: say(
      "按辈分从上到下排成三行，关系写在连线上；宝玉居中，宝黛之间唯一一条朱红线，是全书的情感中心",
      "Three rows by generation with the ties written on the lines; Baoyu in the middle, and the one vermilion line, to Daiyu, is the heart of the book",
    ),
    register: "expressive",
    style: "ink-figure",
    direction: say("白描人物，细墨线，楷体名字，只有一处朱红", "Fine-line ink portraits, kaishu names, a single touch of vermilion"),
    cast: people.map((p) => say(p.zh, p.en)),
    basis: { subject: say("红楼梦", "Dream of the Red Chamber"), intent: say("人物关系", "who is who") },
  }),
  versions: (say) => {
    const tie = (id: string, from: string, to: string, zh: string, en: string, extra: Record<string, unknown> = {}) => ({
      id,
      from,
      to,
      data: { label: say(zh, en), head: "none", color: "#8c8c8c", width: 1.4, size: 17, ...extra },
    });
    return [
      {
        title: say("红楼梦里谁是谁的谁", "Who's who in the Red Chamber"),
        style: { ...styles["ink-figure"] },
        scenes: [{ id: "root", title: say("贾府", "The Jia household"), checks: [] }],
        modules: people.map((p) => ({
          id: p.id,
          bounds: [p.x, p.y, 170, 220],
          drawingId: "picture",
          ...(p.id === "daiyu" || p.id === "baoyu" ? { target: { kind: "detail" as const, id: p.id } } : {}),
          data: { material: p.picture, caption: say(p.zh, p.en), captionSize: 22 },
        })),
        links: [
          tie("t1", "jiamu", "jiazheng", "母子", "mother · son"),
          tie("t2", "jiazheng", "wangfuren", "夫妻", "married"),
          tie("t3", "wangfuren", "baoyu", "母子", "mother · son"),
          tie("t4", "wangfuren", "xifeng", "姑侄", "aunt · niece"),
          tie("t5", "jiamu", "daiyu", "外祖母", "grandmother", { bend: 0.25 }),
          tie("t6", "wangfuren", "baochai", "姨母", "aunt", { bend: -0.1 }),
          tie("t7", "baoyu", "daiyu", "知己", "soulmates", { color: "#d4502a", width: 3, size: 20, labelColor: "#d4502a" }),
          tie("t8", "baoyu", "baochai", "金玉良缘", "the match", { dashed: true }),
        ],
        details: [
          {
            id: "daiyu",
            title: say("林黛玉", "Lin Daiyu"),
            html: say(
              "<p>贾母的外孙女，母亲去世后来到贾府。敏感、聪慧、诗才最高，和宝玉从小一起长大，是彼此唯一的知己。</p>",
              "<p>Grandmother Jia's granddaughter, brought to the household after her mother dies. Sensitive, quick and the finest poet among them; she grows up beside Baoyu, each the other's only true confidant.</p>",
            ),
          },
          {
            id: "baoyu",
            title: say("贾宝玉", "Jia Baoyu"),
            html: say(
              "<p>贾政和王夫人的儿子，衔玉而生，贾母最疼爱的孙子。厌恶功名，心在黛玉，却被安排了与宝钗的“金玉良缘”。</p>",
              "<p>Son of Jia Zheng and Lady Wang, born with jade in his mouth and his grandmother's favourite. He scorns an official career and loves Daiyu, yet is matched with Baochai.</p>",
            ),
          },
        ],
      },
    ];
  },
};
