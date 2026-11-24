import type { Idea, IdeaKind, Settings } from "../contracts/index.ts";
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

/** What the judge is shown: every request the user has made of the work, in their own words,
 * one line each. The brief is left out on purpose, as it is written around the author's
 * favourite idea and would pull the judge towards it. */
export const judgeInput = (requests: string[]) => requests.map((r) => "用户请求：" + r).join("\n");

/** Asks the judge which idea to develop. Each idea is scored on its own, so the order they
 * are listed in does not sway it. Throws when the judge does not answer within ten seconds
 * or answers with something other than a choice among the ideas. */
export function judgeIdeas(
  judge: NonNullable<Settings["judge"]>,
  requests: string[],
  ideas: Idea[],
  signal: AbortSignal,
): Promise<Verdict> {
  const keys = ideas.map((_, i) => "i" + i);
  const body = {
    model: judge.model,
    input: judgeInput(requests),
    questions: {
      idea: {
        type: "choice",
        instructions: judge.question,
        criteria: Object.fromEntries(ideas.map((x, i) => [keys[i], `【${kindNames[x.kind]}】${x.idea}`])),
      },
    },
  };
  // Metered on its own in the run's record, which shows what it was asked.
  const attrs = { meter: "judge", model: judge.model, args: { input: body.input, questions: body.questions } };
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
