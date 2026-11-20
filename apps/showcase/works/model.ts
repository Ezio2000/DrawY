import { styles, type ShowcaseSource } from "../kit.ts";

/* How a language model answers, as a flowchart: one node per step, elbow arrows with data
 * moving along them, and the loop that writes the answer a word at a time. */

export const model: ShowcaseSource = {
  id: "model",
  title: (say) => say("大模型怎样回答一个问题", "How a language model answers"),
  brief: (say) => ({
    subject: say("大语言模型的推理过程", "How a large language model generates an answer"),
    intent: say("从问题到回答中间发生了什么，尤其是“一个词一个词地写”", "What happens between question and answer, above all that it writes one token at a time"),
    audience: say("不懂技术但好奇的人", "Curious people who don't code"),
    concept: say(
      "一条从左到右再折回来的流程：问题被切碎、变成数字、经过 Transformer，预测出下一个词；虚线把这个词接回去再算一遍，回答就这样一个词一个词地长出来",
      "A flow that runs right and turns back: the question is cut up, turned into numbers, passed through the Transformer to predict the next word; a dashed loop feeds that word back in, and the answer grows a word at a time",
    ),
    register: "formal",
    style: "duotone-icon",
    direction: say("双色图标、圆角方框、流动的箭头，赤陶色只给 Transformer", "Duotone icons, rounded boxes, flowing arrows, terracotta only for the Transformer"),
    cast: [say("问题", "the question"), say("词元", "tokens"), say("Transformer", "the Transformer"), say("回答", "the answer")],
    basis: { subject: say("大模型", "a language model"), intent: say("怎样回答一个问题", "how does it answer a question") },
  }),
  versions: (say) => {
    const node = (id: string, x: number, y: number, zh: string, en: string, noteZh: string, noteEn: string, icon: string, extra: Record<string, unknown> = {}) => ({
      id,
      bounds: [x, y, 250, 110],
      drawingId: "node",
      data: { title: say(zh, en), note: say(noteZh, noteEn), icon, size: 18, lift: true, ...extra },
    });
    const flow = (id: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({
      id,
      from,
      to,
      data: { route: "elbow", flow: true, size: 16, ...extra },
    });
    return [
      {
        title: say("大模型怎样回答一个问题", "How a language model answers"),
        style: { ...styles["duotone-icon"] },
        scenes: [{ id: "root", title: say("从问题到回答", "From question to answer"), checks: [] }],
        modules: [
          node("ask", 20, 60, "你的问题", "Your question", "“天空为什么是蓝的？”", "“Why is the sky blue?”", "icon-chat"),
          node("tokens", 340, 60, "切成词元", "Cut into tokens", "天空 / 为什么 / 是 / 蓝的", "Why / is / the / sky / blue", "icon-code"),
          node("vectors", 660, 60, "变成向量", "Turned into vectors", "每个词元是一串数字", "each token a list of numbers", "icon-network"),
          node("transformer", 980, 60, "Transformer", "Transformer", "几十层注意力，读懂上下文", "dozens of attention layers", "icon-model", { tone: "accent" }),
          node("predict", 980, 330, "预测下一个词", "Predict the next word", "“因为”的概率最高", "“Because” is likeliest", "icon-chart"),
          node("answer", 20, 330, "回答", "The answer", "一个词一个词地写出来", "written a word at a time", "icon-robot", { shape: "pill", tone: "accent2" }),
        ],
        links: [
          flow("f1", "ask", "tokens"),
          flow("f2", "tokens", "vectors"),
          flow("f3", "vectors", "transformer"),
          flow("f4", "transformer", "predict"),
          flow("f5", "predict", "answer", { label: say("写下这个词", "write it down") }),
          flow("loop", "predict", "vectors", { dashed: true, color: "#d97757", label: say("接到句子后面，再算一遍", "append it and go again"), labelSide: "below" }),
        ],
      },
    ];
  },
};
