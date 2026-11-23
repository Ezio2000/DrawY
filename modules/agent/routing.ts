import { createHash } from "node:crypto";
import {
  decisionCandidates, decisionSettings, labelsOf, settingsFor,
  type ModelCatalog, type Run, type RunUsage, type Settings, type UserSettings,
} from "../contracts/index.ts";
import { headers, readable } from "../models/http.ts";
import type { Item } from "../models/index.ts";
import { tracer } from "../trace/index.ts";

/** Standard USD rates per million input tokens, including the default 30-minute write.
 * https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability */
function decisionUsage(model: string, usage: Item): NonNullable<RunUsage["decision"]> {
  const input = usage.input_tokens;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage.input_tokens_details?.cache_write_tokens ?? 0;
  const fresh = Math.max(0, input - cached - cacheWrite);
  const rate = input > 272_000 ? 2 : 1;
  return { model, input, cached, cacheWrite, cost: rate * (fresh * 0.1 + cached * 0.01 + cacheWrite * 0.125) / 1e6 };
}

/** Resolve one request before opening the author's conversation. Only the selected settings
 * cross that boundary. The decision sees the current message, not the author's transcript. */
export async function selectSettings(catalog: ModelCatalog, own: UserSettings, run: Run,
  message: Item, signal: AbortSignal): Promise<Settings> {
  const defaultOrManual = settingsFor(catalog, own);
  if (own.label !== null && labelsOf(catalog).some((l) => l.id === own.label)) return defaultOrManual;

  const decision = catalog.decision;
  const candidates = decisionCandidates(catalog);
  // A choice identifies a task, independent of which writer and effort currently handle it.
  const options = candidates.flatMap((candidate) => candidate.descriptions.map((description) => ({
    value: createHash("sha256").update(description).digest("hex").slice(0, 24),
    description, candidate,
  })));
  const routes = candidates.map(({ model, effort, descriptions }) => ({ writer: model.id, effort, descriptions }));
  return tracer.span("decision", "Auto", { routes }, async (span) => {
    let selected = defaultOrManual;
    let reason: string;
    if (candidates.length === 1) {
      selected = decisionSettings(catalog, own.preferences, candidates[0]);
      reason = "single";
    } else if (!candidates.length || !decision.credential) {
      reason = candidates.length ? "unconnected" : "no_candidates";
    } else {
      const question = {
        type: "choice", name: "task",
        instructions: "哪项描述最符合用户这次要求完成的主要工作？",
        choices: options.map(({ value, description }) => ({ value, description })),
      };
      const parts = message.content;
      const input = parts.length === 1 && parts[0].type === "input_text" ? parts[0].text : [message];
      span.set({ called: true, model: decision.model, input, question });
      try {
        const response = await fetch(decision.endpoint, {
          method: "POST",
          headers: headers({ channel: "api", credential: decision.credential }),
          body: JSON.stringify({ model: decision.model, input, questions: [question] }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) throw Error("HTTP " + response.status + " " + readable(await response.text()));
        const body = await response.json();
        const answer = body.answers?.find((a: Item) => a?.type === "choice" && a.name === question.name);
        span.set({ answer, usage: body.usage });
        if (Number.isFinite(body.usage?.input_tokens)) {
          const used = decisionUsage(decision.model, body.usage);
          (run.usage ??= { input: 0, cached: 0, output: 0, reasoning: 0 }).decision = used;
          span.set({ cost: used.cost });
        }
        const choice = options.find((o) => o.value === answer?.choice);
        if (!choice) throw Error("No eligible choice returned");
        selected = decisionSettings(catalog, own.preferences, choice.candidate);
        span.set({ matchedTask: choice.description });
        reason = "choice";
      } catch (error) {
        signal.throwIfAborted();
        span.set({ fallbackError: error instanceof Error ? error.message : String(error) });
        reason = "fallback";
      }
    }
    span.set({ reason, writer: selected.authorName, effort: selected.author.efforts.length ? selected.author.effort : undefined });
    return selected;
  });
}
