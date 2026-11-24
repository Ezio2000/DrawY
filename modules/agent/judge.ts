import type { Idea, IdeaKind, Settings } from "../contracts/index.ts";
import type { Attachment } from "../materials/index.ts";
import { tracer } from "../trace/index.ts";

/** How each kind of idea is named to the judge, which is asked in Chinese. */
const kindNames: Record<IdeaKind, string> = {
  convention: "惯例",
  anatomy: "剖面",
  journey: "旅程",
  change: "变化",
  scale: "比例",
  mechanism: "机理",
  analogy: "类比",
  scene: "情景",
};

/** The judge's verdict: the idea to develop, by its place in the list, and how strongly it
 * favoured each, in list order. */
export interface Verdict {
  chosen: number;
  scores: number[];
  /** Input tokens it was paid for. */
  input: number;
}

/** One message the user sent on the work: their words and what they attached. */
export interface Said {
  text: string;
  attachments: Attachment[];
}
/** A part of what the judge is shown: words, or an image as a data URL. */
type Part = { type: "text"; text: string } | { type: "image"; image: string };

/** What the judge is shown: everything the user has sent on the work, oldest first. Each
 * request is a line of their words; a picture they attached follows it as a small image, enough
 * to tell what it shows; a drawing or effect they asked for is named. A style is left
 * out, as it decides how the work looks, not which idea it draws. So is the brief, as it is
 * written around the author's favourite idea and would pull the judge towards it. */
export function judgeInput(said: Said[]): Part[] {
  const parts: Part[] = [];
  const write = (text: string) => {
    const last = parts.at(-1);
    if (last?.type === "text") last.text += text;
    else parts.push({ type: "text", text });
  };
  for (const s of said) {
    if (s.text) write(`用户请求：${s.text}\n`);
    for (const { material: m, image } of s.attachments) {
      if (m.kind === "picture" && image) {
        write(`用户附图「${m.name.zh}」：`);
        parts.push({ type: "image", image });
        write("\n");
      } else if (m.kind === "drawing" || m.kind === "effect")
        write(`用户要用的${m.kind === "drawing" ? "画法" : "特效"}：${m.name.zh}\n`);
    }
  }
  const last = parts.at(-1);
  if (last?.type === "text") last.text = last.text.trimEnd();
  return parts.filter((p) => p.type === "image" || p.text);
}

/** The judge's `input` as the API takes it: plain words when there is no picture, otherwise
 * text and image blocks in turn, each image small. */
const apiInput = (parts: Part[]) =>
  parts.every((p) => p.type === "text")
    ? parts.map((p) => p.text).join("")
    : parts.map((p) =>
        p.type === "text"
          ? p
          : {
              type: "image",
              data: p.image.slice(p.image.indexOf(",") + 1),
              mime_type: p.image.slice(5, p.image.indexOf(";")),
              resolution: "low",
            },
      );

/** Asks the judge which idea to develop. Each idea is scored on its own, so the order they
 * are listed in does not sway it. Throws when the user has sent nothing to judge by (a style
 * alone), when the judge does not answer within ten seconds, or when it answers with
 * something other than a choice among the ideas. */
export async function judgeIdeas(
  judge: NonNullable<Settings["judge"]>,
  said: Said[],
  ideas: Idea[],
  signal: AbortSignal,
): Promise<Verdict> {
  const parts = judgeInput(said);
  if (!parts.length) throw Error("The user has sent nothing the judge can read");
  const keys = ideas.map((_, i) => "i" + i);
  const body = {
    model: judge.model,
    input: apiInput(parts),
    questions: {
      idea: {
        type: "choice",
        instructions: judge.question,
        criteria: Object.fromEntries(ideas.map((x, i) => [keys[i], `【${kindNames[x.kind]}】${x.idea}`])),
      },
    },
  };
  // Metered on its own in the run's record, which shows what it was asked, its pictures
  // kept as files like any other image the record holds.
  const input = typeof body.input === "string" ? body.input : parts;
  const attrs = { meter: "judge", model: judge.model, args: { input, questions: body.questions } };
  return tracer.span("tool", "judge", attrs, async (span) => {
    const response = await fetch(judge.endpoint, {
      method: "POST",
      headers: { "x-goog-api-key": judge.credential, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw Error(`HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    const { answers, usage } = await response.json();
    const answer = answers?.idea;
    const chosen = keys.indexOf(answer?.choice);
    if (answer?.type !== "choice" || chosen < 0) throw Error("The judge did not pick one of the ideas");
    const scores = keys.map((k) => Number(answer.probabilities?.[k] ?? 0));
    const input = Number(usage?.total_input_tokens ?? usage?.input_tokens ?? 0);
    span.set({ chosen, scores, usage: { input_tokens: input } });
    return { chosen, scores, input };
  });
}
