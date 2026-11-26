import type { Idea, Settings } from "../contracts/index.ts";
import type { Attachment } from "../materials/index.ts";
import { tracer } from "../trace/index.ts";

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
 * text and image blocks in turn, each image at the resolution given. */
const apiInput = (parts: Part[], resolution: "low" | "medium") =>
  parts.every((p) => p.type === "text")
    ? parts.map((p) => p.text).join("")
    : parts.map((p) =>
        p.type === "text"
          ? p
          : {
              type: "image",
              data: p.image.slice(p.image.indexOf(",") + 1),
              mime_type: p.image.slice(5, p.image.indexOf(";")),
              resolution,
            },
      );

/** Puts questions to the judge about what `parts` show, and gives its answers with the input
 * tokens it was paid for. Each call is metered as the judge's in the run's record, which
 * shows what it was asked, its pictures kept as files like any other image the record holds.
 * Throws when the judge does not answer within ten seconds. */
function ask(
  judge: NonNullable<Settings["judge"]>,
  name: string,
  parts: Part[],
  resolution: "low" | "medium",
  questions: Record<string, object>,
  signal: AbortSignal,
) {
  const body = { model: judge.model, input: apiInput(parts, resolution), questions };
  const input = typeof body.input === "string" ? body.input : parts;
  const attrs = { meter: "judge", model: judge.model, args: { input, questions } };
  return tracer.span("tool", name, attrs, async (span) => {
    const response = await fetch(judge.endpoint, {
      method: "POST",
      headers: { "x-goog-api-key": judge.credential, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw Error(`HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    const { answers, usage } = await response.json();
    const tokens = Number(usage?.total_input_tokens ?? usage?.input_tokens ?? 0);
    span.set({ answers, usage: { input_tokens: tokens } });
    return { answers: (answers ?? {}) as Record<string, any>, input: tokens };
  });
}

/** Asks the judge which idea to develop. Each idea is scored on its own, so the order they
 * are listed in does not sway it. The judge reads only what each idea draws: its kind is the
 * author's own label, and an idea labelled convention would lose for the label alone. Throws when the user has sent nothing to judge by (a style
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
  const criteria = Object.fromEntries(ideas.map((x, i) => [keys[i], x.idea]));
  const question = { type: "choice", instructions: judge.question, criteria };
  const { answers, input } = await ask(judge, "judge", parts, "low", { idea: question }, signal);
  const answer = answers.idea;
  const chosen = keys.indexOf(answer?.choice);
  if (answer?.type !== "choice" || chosen < 0) throw Error("The judge did not pick one of the ideas");
  const scores = keys.map((k) => Number(answer.probabilities?.[k] ?? 0));
  return { chosen, scores, input };
}

/** A visual baseline check on a look, as the judge found it in the picture. */
export interface Checked {
  claim: string;
  /** How likely the picture shows it, by the judge. */
  score: number;
  /** Whether that is likely enough to count as shown. */
  holds: boolean;
}

/** Fixed visual baseline checks applied to overview screenshots by the judge.
 * Kept objective and layout-focused so verdicts do not drift across turns. */
export const BASELINE_CHECKS: readonly string[] = [
  "所有文字和标注清晰可读，没有互相重叠、被图形遮挡或被边缘截断",
  "所有主体图形、图标和模块都完整落在画布内，没有被边缘意外裁切或出现突兀的矩形底框裁切痕",
  "连线、箭头或辅助分隔线不会意外穿过无关的文字或主体图标",
];

/** Asks the judge whether the pictures of an overview look pass each fixed visual baseline
 * check, one yes-or-no question a check: eyes other than the author's own. The pictures go
 * at medium resolution, enough to read labels and spot overlaps or clipping. Throws when
 * the judge does not answer within ten seconds or leaves a check unanswered. */
export async function checkClaims(
  judge: NonNullable<Settings["judge"]>,
  pictures: string[],
  signal: AbortSignal,
  claims: readonly string[] = BASELINE_CHECKS,
): Promise<{ checked: Checked[]; input: number }> {
  const parts: Part[] = [
    { type: "text", text: pictures.length > 1 ? "作品的画面（同一次查看的几张截图）：\n" : "作品的画面：\n" },
    ...pictures.map((image) => ({ type: "image" as const, image })),
  ];
  const questions = Object.fromEntries(claims.map((c, i) => ["c" + i, { type: "noul", instructions: `画面是否做到了：${c}` }]));
  const { answers, input } = await ask(judge, "check_claims", parts, "medium", questions, signal);
  const checked = claims.map((claim, i) => {
    const score = Number(answers["c" + i]?.noul);
    if (!Number.isFinite(score)) throw Error("The judge left a claim unanswered");
    return { claim, score, holds: score >= 0.5 };
  });
  return { checked, input };
}
