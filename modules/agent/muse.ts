import { z } from "zod";
import type { Role } from "../contracts/index.ts";
import { generate, textOf, type Item } from "../models/index.ts";
import { MUSE } from "./prompts.ts";
import { ideaKinds, type conceiveSchema } from "./tools.ts";

/** The visual idea as the muse settled it: the ideas weighed, the one chosen and why. */
export const conceivedSchema = z
  .object({
    ideas: z
      .array(
        z.object({
          kind: z.enum(Object.keys(ideaKinds) as [keyof typeof ideaKinds]),
          idea: z.string().min(1),
        }),
      )
      .min(2)
      .max(3)
      .refine(
        (ideas) => new Set(ideas.map((i) => i.kind)).size === ideas.length,
        "ideas must be of different kinds",
      ),
    choice: z.number().int().min(0),
    concept: z.string().min(1),
    why: z.string().min(1),
  })
  .refine((c) => c.choice < c.ideas.length, "choice must be the index of one of the ideas");
export type Conceived = z.infer<typeof conceivedSchema>;
export type ConceiveRequest = z.infer<typeof conceiveSchema>;

/** The muse's request, in its own words. */
function asked(r: ConceiveRequest) {
  return [
    `Subject: ${r.subject}`,
    `Intent: ${r.intent}`,
    `Audience: ${r.audience}`,
    `Register: ${r.register}`,
    ...(r.findings ? [`What research found: ${r.findings}`] : []),
    ...(r.rejected ? [`A concept the facts could not hold: ${r.rejected}`] : []),
  ].join("\n");
}
/** The JSON in what the muse wrote, whatever it wrapped it in. */
function read(text: string) {
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw Error("没有 JSON");
  return conceivedSchema.parse(JSON.parse(text.slice(start, end + 1)));
}
/** Asks the muse for the visual idea. An answer it wrote in the wrong form is shown back to
 * it once, with what was wrong, before the call fails. Each attempt's usage is reported, so
 * the run pays for what it asked whether or not it came to anything. */
export async function conceive(
  role: Role,
  request: ConceiveRequest,
  { signal, cacheKey, spent }: { signal: AbortSignal; cacheKey: string; spent: (usage: Item) => void },
): Promise<{ conceived: Conceived; answers: Item[][] }> {
  const input: Item[] = [{ role: "user", content: asked(request) }];
  const answers: Item[][] = [];
  for (let attempt = 0; ; attempt++) {
    const result = await generate(role, {
      instructions: MUSE,
      input,
      signal,
      cacheKey,
      effort: role.effort,
      budget: 16384,
    });
    spent(result.usage);
    answers.push(result.items);
    const text = textOf(result.items);
    try {
      return { conceived: read(text), answers };
    } catch (e) {
      const why = e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e);
      if (attempt) throw Error(`构思模型没有给出可用的立意：${why}`);
      input.push(...result.items, {
        role: "user",
        content: `That answer could not be used (${why}). Answer with only the JSON described.`,
      });
    }
  }
}
