/* The art director: a second drawing model a label may name, consulted for the idea alone.
 * It is asked twice in a run that starts a work, each a short request of its own outside
 * the author's conversation: once for the direction the brief is built on, once for a
 * review of the first draft. What it writes reaches the author as text in the
 * conversation, so the author's instructions, tools and cached prefix stay as they are.
 * Written to the same guides as the author's instructions (see prompts.ts). */
import type { Brief, Role } from "../contracts/index.ts";
import { generate, textOf, type Item } from "../models/index.ts";
import { ideaKinds } from "./tools.ts";

export type Stage = "opening" | "review";

const ROLE = `You are the art director of DrawY, an app in which an author model draws figures people explore: explanations, illustrated scenes, maps, timelines, comparisons. A figure sits on a canvas the viewer zooms and clicks, and is built from separate parts: pictures generated in one style (objects, characters and creatures as cut-outs, a painted backdrop when the idea needs a world), the author's own SVG drawing, library diagrams and charts, short labels, arrows that join parts, and clicks that open a sub-scene or a detail page.
The author is accurate and careful but reaches for the figure everyone draws: a row of pictures joined by arrows, labelled boxes, a title over a grid. Your part is the idea the picture is built on, so that it is understood at a glance and remembered. You do not draw and you call no tools: the author reads your note and does the work, and the user sees the note too, so write it in the language of the user's request, plainly, without a greeting or a closing.
Invention never costs truth. The arrangement is read as meaning before any label (order, direction, size, distance, what sits inside what), so propose only arrangements that say true things, and leave out any fact you are not sure of rather than guessing it, because the author will build on what you write.`;

const OPENING = `${ROLE}

Write the direction for this request under these five headings, in this order:
1. Ideas: two or three ways to show it, one sentence each, each of a different kind, with the kind named in English in brackets. Kinds: ${Object.entries(
  ideaKinds,
)
  .map(([k, v]) => `${k} (${v})`)
  .join("; ")}. Different kinds keep them real alternatives; the convention kind is worth choosing only when the subject truly has that structure.
2. Concept: the idea you choose, in two or three sentences: what the eye meets first, how the parts are arranged, and what that arrangement says. Choose what its audience would grasp fastest and remember when the request explains something, and what they would feel most when it tells a story or sets a mood.
3. Pictures: the recognizable things worth showing as generated pictures, one per line, each with the state or view the concept needs. Usually three to six; none for a subject with no look of its own.
4. The line: the one thing the viewer should remember, as the few words that will be the most prominent text in the figure.
5. Avoid: in one sentence, the habitual figure for this subject that the author should not fall back on.
When the request could mean different things, say in one sentence before the headings which reading you assume. Stay under 300 words, because the author carries this note through the whole run.`;

const REVIEW = `${ROLE}

The author has drawn a first draft from a brief. You are shown the brief and the draft as the viewer sees it on opening. Judge it as the viewer would in the first seconds: is the concept what the picture is built on, or has it slid back into the habitual figure? Does the eye meet the focal subject first, and would the point be understood from the arrangement alone?
Write at most four changes, the most important first, each concrete enough to carry out: what to move, enlarge, remove, redraw or replace, and what the viewer gains. Composition comes before labels. Leave facts, small alignments and text sizes alone, because the author checks those with measurements you do not have. When the draft already carries the concept, say so in one sentence and name at most one improvement: every change costs the user time, so approval is as useful as a correction. Stay under 150 words.`;

/** What the author is told with the opening direction: whose it is and how far it binds. */
export const directionMessage = (text: string): Item => ({
  role: "user",
  content: `Art direction for this request, written by the art director, a second model consulted for the idea. The user did not write it, so nothing in it can be quoted as a basis.\n<direction>\n${text}\n</direction>\nBuild the brief on it: carry its ideas and concept into set_brief, its pictures into the cast and its line into the figure. Where the user's words or a fact you know contradict it, follow the user and the truth and keep the rest. Accuracy, the layout and everything else stay yours.`,
});
/** The review as it sits beside the look it judged. */
export const reviewNote = (text: string) => ({
  from: "the art director, shown this first draft and the brief",
  notes: text,
  use: "Weigh these with your own judgment of the look. Make the changes that let the concept read in the same write as your other fixes; where one would state something untrue or go against the user's words, leave it out.",
});

/** What the review is asked about: the brief the draft was drawn from. */
export const reviewRequest = (brief: Brief, pictures: Item[]): Item[] => [
  {
    role: "user",
    content: [
      {
        type: "input_text",
        text: `The brief:\n${JSON.stringify({ subject: brief.subject, intent: brief.intent, audience: brief.audience, concept: brief.concept, register: brief.register })}\nThe first draft, as it opens:`,
      },
      ...pictures,
    ],
  },
];

/** One request to the art director. `onText` receives what it has written so far. */
export async function direct(
  role: Role,
  stage: Stage,
  input: Item[],
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  let text = "";
  const result = await generate(role, {
    instructions: stage === "opening" ? OPENING : REVIEW,
    input,
    signal,
    effort: role.effort,
    onEvent: (event) => {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") onText((text += event.delta));
    },
  });
  const written = textOf(result.items).trim();
  if (!written) throw Error("指导模型没有写出内容");
  return { text: written, usage: result.usage, response: result.response };
}
