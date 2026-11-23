import { imageTokensOf, type Role, type Run, type RunUsage, type Step } from "../contracts/index.ts";
import { adapterFor, type Item } from "../models/index.ts";
import { searchTools } from "./tools.ts";

/** What a run spends, and the web searches a request may make. Everything here is counted
 * on `run.usage`, which `costOf` prices with the run's own `prices`. */

type Search = Extract<Step, { kind: "tool"; name: "web_search" }>;
const usageOf = (run: Run): RunUsage =>
  (run.usage ??= { input: 0, cached: 0, output: 0, reasoning: 0 });
export const failedOf = (run: Run) =>
  (usageOf(run).failed ??= {
    attempts: 0,
    ms: 0,
    input: 0,
    cached: 0,
    cacheWrite: 0,
    output: 0,
    estimated: 0,
    invalidCalls: 0,
    images: 0,
  });
/** Adds a model turn, or a summary, to what a run has spent. */
export function spend(run: Run, usage: Item) {
  const u = usageOf(run);
  u.input += usage.input_tokens ?? 0;
  u.cached += usage.input_tokens_details?.cached_tokens ?? 0;
  const written = usage.input_tokens_details?.cache_write_tokens ?? 0;
  if (written) u.cacheWrite = (u.cacheWrite ?? 0) + written;
  u.output += usage.output_tokens ?? 0;
  u.reasoning += usage.output_tokens_details?.reasoning_tokens ?? 0;
}
/** Adds a model attempt that failed to what the run has spent. A stream that broke off
 * reports its input but not its output, which is then told from what had arrived. */
export function spendFailed(run: Run, attempt: { usage?: Item; ms: number; chars?: number }) {
  const f = failedOf(run);
  if (typeof attempt.usage?.input_tokens === "number")
    run.usage!.firstCached ??= attempt.usage.input_tokens_details?.cached_tokens ?? 0;
  const reported = attempt.usage?.output_tokens ?? 0;
  const estimated = reported ? 0 : Math.ceil((attempt.chars ?? 0) / 3);
  f.attempts++;
  f.ms += attempt.ms;
  f.input += attempt.usage?.input_tokens ?? 0;
  f.cached += attempt.usage?.input_tokens_details?.cached_tokens ?? 0;
  f.cacheWrite += attempt.usage?.input_tokens_details?.cache_write_tokens ?? 0;
  f.output += reported + estimated;
  f.estimated += estimated;
  return { usage: attempt.usage ?? {}, output: reported + estimated, estimated };
}
/** Adds what a picture's generation returned: every picture the model sent is paid for,
 * including one painted again for a background, and a failed one is counted apart. */
export function spendImages(run: Run, made: { count?: number; usage?: unknown; status: string }) {
  if (made.count) {
    const images = (usageOf(run).images ??= { count: 0, input: 0, output: 0 });
    const t = imageTokensOf(made.usage);
    images.count += made.count;
    images.input += t.input;
    images.output += t.output;
    images.textInput = (images.textInput ?? 0) + t.textInput;
    images.imageInput = (images.imageInput ?? 0) + t.imageInput;
    images.textOutput = (images.textOutput ?? 0) + t.textOutput;
  }
  if (made.status === "failed") failedOf(run).images++;
}
/** Adds a call to a tool the provider runs itself, and for its search what it looked up. */
export function spendHosted(run: Run, tool: string, action?: string) {
  const used = (usageOf(run).hosted ??= {});
  used[tool] = (used[tool] ?? 0) + 1;
  if (tool === "web_search") counted(run, action);
}
/** Adds web searches or a page read to what a run has spent. */
export function counted(run: Run, action: string | undefined, searches = 1) {
  const u = usageOf(run);
  if (action === "open_page" || action === "find_in_page") u.pages = (u.pages ?? 0) + 1;
  else u.searches = (u.searches ?? 0) + searches;
}

/** Web searches a request may make in all, and once its first draft is saved: the
 * research belongs before the drawing, and a look needs at most one targeted follow-up.
 * The search service counts each query; a provider's own search counts each call. */
export const SEARCH_LIMIT = 8,
  SEARCH_AFTER_DRAFT = 2;
/** What a search step spends of the budget. The search service is asked once per query,
 * and each is paid for, so a call with several queries counts each; a page read, and a
 * provider's own search, which is paid for by the call, count one. */
const cost = (run: Run, step: Search) =>
  run.services?.search === "service" && step.action !== "open_page"
    ? Math.max(1, step.queries.length)
    : 1;
/** The web searches this request may still make, leaving out the step given. */
export function searchesLeft(run: Run, besides?: Step) {
  const steps = run.steps.filter((s) => s !== besides);
  const drafted = steps.findIndex(
    (s) => s.kind === "tool" && s.name === "write_work" && s.status === "done",
  );
  const searched = (from: number) =>
    steps.reduce(
      (n, s, i) => (i > from && s.kind === "tool" && s.name === "web_search" ? n + cost(run, s) : n),
      0,
    );
  return Math.max(
    0,
    Math.min(
      SEARCH_LIMIT - searched(-1),
      drafted < 0 ? Infinity : SEARCH_AFTER_DRAFT - searched(drafted),
    ),
  );
}
const searching = new Set(searchTools.map((t) => t.name));
/** Keeps a turn within the request's search budget, where the model's request format has
 * a way to (its adapter's `narrow`). The tools stay listed, so the cached prefix holds;
 * where there is no such way, the search service's calls are refused past the budget. */
export function steering(
  run: Run,
  tools: Item[],
  role: Pick<Role, "protocol" | "toolLimits"> = { protocol: "responses", toolLimits: true },
): Item {
  const isSearch = (t: Item) =>
    t.type === "web_search" || (t.type === "function" && searching.has(t.name));
  const narrow = adapterFor(role.protocol).narrow;
  if (!narrow || !tools.some(isSearch)) return {};
  const left = searchesLeft(run);
  return left === Infinity ? {} : narrow(tools, left, isSearch, role);
}
/** What this request has searched so far, told to the author beside its brief and each
 * look, so it judges against what it already found rather than searching again. */
export function research(run: Run) {
  const searches = run.steps.filter(
    (s): s is Search => s.kind === "tool" && s.name === "web_search",
  );
  if (!searches.length) return {};
  const pages = [...new Set(searches.flatMap((s) => s.urls))];
  const asked = [...new Set(searches.flatMap((s) => s.queries))];
  const left = searchesLeft(run);
  return {
    research: {
      calls: searches.length,
      ...(asked.length ? { queriesAsked: asked } : {}),
      ...(pages.length ? { pagesOpened: pages } : {}),
      ...(left !== Infinity
        ? run.services?.search === "service"
          ? { searchQueriesLeft: left }
          : { searchCallsLeft: left }
        : {}),
      note: left
        ? "What these found is above. Judge the figure against it; asking these again in other words returns the same results. Search again only for a fact the figure states that none of it covers, and leave out what stays unconfirmed."
        : "Web search is closed for the rest of this request. Work from what is above, and leave out what stays unconfirmed.",
    },
  };
}
