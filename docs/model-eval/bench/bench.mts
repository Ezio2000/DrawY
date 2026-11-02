/* DrawY model benchmark.
 *
 * Builds the model catalog from the environment (TERRA_*, OPUS_*, SONNET_*, DEEPSEEK_*,
 * IMAGE_*, SEARCH_*, DEFAULT_*), then runs every prompt once per drawing model, each in a
 * fresh account so no run reuses another's generated pictures. Each run uses the effort and
 * speed the environment names for its model. Records what DrawY itself records (usage,
 * prices, timings, steps, trace) and exports a PNG of every non-empty scene.
 *
 *   npx tsx docs/model-eval/bench/bench.mts --tag baseline [--models terra,opus] [--prompts water,silk]
 *       [--out docs/model-eval/runs] [--parallel 4] [--patch catalog-patch.json]
 *
 * Needs a running DrawY (materials, capture, server; DRAWY_URL, default localhost:8080).
 * Credentials come from <PREFIX>_API_KEY when set; otherwise a placeholder is configured
 * and the key is expected to be added by the environment's network secrets on the way out.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { costOf } from "../../../modules/contracts/index.ts";
import type { ModelCatalog, WriterProvider } from "../../../modules/contracts/index.ts";
import { PROMPTS } from "./prompts.mts";

const { values: opt } = parseArgs({
  options: {
    tag: { type: "string", default: "baseline" },
    models: { type: "string", default: "terra,opus,sonnet,deepseek" },
    prompts: { type: "string", default: Object.keys(PROMPTS).join(",") },
    out: { type: "string", default: "docs/model-eval/runs" },
    parallel: { type: "string", default: "4" },
    patch: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const BASE = process.env.DRAWY_URL || "http://localhost:8080";
const env = (k: string, d?: string) => {
  const v = process.env[k];
  if (v === undefined || v === "") {
    if (d === undefined) throw Error(`missing env ${k}`);
    return d;
  }
  return v;
};
const bool = (k: string, d: boolean) => (process.env[k] ? process.env[k] === "true" : d);
const list = (k: string, d: string) => env(k, d).split(",").map((s) => s.trim()).filter(Boolean);
const PLACEHOLDER = "injected-by-network-secret";
const credentialFor = (prefix: string) =>
  process.env[`${prefix}_API_KEY`] || process.env[`${prefix}_CREDENTIAL`] || PLACEHOLDER;

/* Prices in USD per million tokens at the default speed (speed multipliers come from the
 * catalog's speedRates). Sources and dates are in docs/model-eval/README.md. */
const PRICES: Record<string, { input: number; cached: number; cacheWrite: number; output: number; search: number }> = {
  // OpenAI model page: $1 in, $0.05 cached, $1.25 cache write (30 min), $5 out; Fast 2x, Flex 0.5x.
  "gpt-6.1-terra": { input: 1, cached: 0.05, cacheWrite: 1.25, output: 5, search: 0.01 },
  // Anthropic first-party rates, passed through by OpenRouter: 5-minute cache write = 1.25x input.
  "anthropic/claude-opus-5.5": { input: 4, cached: 0.2, cacheWrite: 5, output: 20, search: 0.01 },
  "anthropic/claude-sonnet-5.5": { input: 2, cached: 0.2, cacheWrite: 2.5, output: 10, search: 0.01 },
  // DeepSeek pricing page, peak rates (off-peak is half): $0.30 miss, $0.006 hit, $1.20 out.
  "deepseek-flash": { input: 0.3, cached: 0.006, cacheWrite: 0, output: 1.2, search: 0 },
};
const SPEED_RATES = { flex: 0.5, default: 1, fast: 2 };

function writer(prefix: string, id: string): WriterProvider {
  const model = env(`${prefix}_MODEL`);
  const prices = PRICES[model] ?? { input: 0, cached: 0, cacheWrite: 0, output: 0, search: 0 };
  const protocol = env(`${prefix}_PROTOCOL`, "responses") as any;
  return {
    id,
    name: id,
    channel: env(`${prefix}_CHANNEL`, env("AUTHOR_CHANNEL", "api")) as any,
    baseUrl: env(`${prefix}_BASE_URL`),
    credential: credentialFor(prefix),
    models: [
      {
        id,
        model,
        name: `${id[0].toUpperCase() + id.slice(1)} · ${model.split("/").at(-1)}`,
        description: "",
        protocol,
        ...(process.env[`${prefix}_PROVIDER`] ? { provider: env(`${prefix}_PROVIDER`) } : {}),
        vision: bool(`${prefix}_VISION`, bool("AUTHOR_VISION", true)),
        tools: bool(`${prefix}_TOOLS`, bool("AUTHOR_TOOLS", true)),
        maxOutput: Number(env(`${prefix}_MAX_OUTPUT`, env("AUTHOR_MAX_OUTPUT", "32768"))),
        efforts: list(`${prefix}_ACCEPTED_EFFORTS`, "low,medium,high,xhigh") as any,
        effort: env(`${prefix}_REASONING_EFFORT`, "medium") as any,
        decisionUsesSetting: bool(`${prefix}_DECISION_USES_SETTING`, false),
        speeds: list(`${prefix}_ACCEPTED_SPEEDS`, "default") as any,
        speed: env(`${prefix}_SPEED`, "default") as any,
        builtinSearch: bool(`${prefix}_BUILTIN_SEARCH`, false),
        toolLimits: bool(`${prefix}_TOOL_LIMITS`, true),
        prices,
        speedRates: SPEED_RATES,
      },
    ],
  } as WriterProvider;
}

export function catalogFromEnv(): ModelCatalog {
  const imageId = env("DEFAULT_IMAGE_ID", "flare");
  const searchId = env("DEFAULT_SEARCH_ID", "deepseek");
  const mode = env("SEARCH_MODE", "service");
  return {
    writers: [
      writer("TERRA", "terra"),
      writer("OPUS", "opus"),
      writer("SONNET", "sonnet"),
      writer("DEEPSEEK", "deepseek"),
    ],
    painters: [
      {
        id: "openai-images",
        name: env("IMAGE_CHANNEL", "api"),
        channel: env("IMAGE_CHANNEL", "api") as any,
        baseUrl: env("IMAGE_BASE_URL"),
        credential: credentialFor("IMAGE"),
        models: [
          {
            id: imageId,
            model: env("IMAGE_MODEL"),
            name: "",
            description: "",
            // OpenAI model page: $5 text in, $8 image in, $30 image out per million.
            prices: { image: 0, textInput: 5, imageInput: 8, output: 30, textOutput: 0 },
          },
        ],
      },
    ],
    searches: [
      {
        id: searchId,
        name: "DeepSeek Search",
        provider: env("SEARCH_PROVIDER", "deepseek") as any,
        baseUrl: env("SEARCH_BASE_URL"),
        credential: credentialFor("SEARCH"),
        // $0.75 per 1,000 successful search or fetch requests.
        prices: { query: 0.00075, page: 0.00075 },
      },
    ],
    defaults: {
      writer: env("DEFAULT_MODEL_ID", "terra"),
      image: imageId,
      web: mode === "service" ? searchId : mode,
    },
  };
}

/* ---- A tiny cookie-holding client */
class Client {
  cookie = "";
  constructor(public name: string) {}
  async call(method: string, path: string, body?: unknown, raw = false): Promise<any> {
    const r = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        "Accept-Language": "zh-CN",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    if (!r.ok) throw Error(`${method} ${path} → ${r.status} ${await r.text()}`);
    return raw ? new Uint8Array(await r.arrayBuffer()) : r.json();
  }
}
const PASSWORD = "bench-password-1";
async function account(name: string, invite?: string) {
  const c = new Client(name);
  try {
    await c.call("POST", "/api/auth/login", { name, password: PASSWORD });
  } catch {
    await c.call("POST", "/api/auth/register", { name, password: PASSWORD, invite });
  }
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ANSWER = "你来决定，按你觉得最合适的方式画就行。";

interface Job {
  model: string;
  prompt: string;
}
async function runJob(admin: Client, job: Job, out: string) {
  const dir = join(out, `${job.model}-${job.prompt}`);
  mkdirSync(dir, { recursive: true });
  const [invite] = await admin.call("POST", "/api/admin/invites", { count: 1 });
  const name = `${opt.tag}-${job.model}-${job.prompt}-${Date.now().toString(36)}`.slice(0, 40);
  const user = await account(name, invite.code ?? invite);
  const w = catalogFromEnv().writers.find((p) => p.id === job.model)!.models[0];
  await user.call("PUT", "/api/settings", {
    writer: w.id,
    image: env("DEFAULT_IMAGE_ID", "flare"),
    web: env("SEARCH_MODE", "service") === "service" ? env("DEFAULT_SEARCH_ID", "deepseek") : env("SEARCH_MODE"),
    effort: w.effort,
    ...(w.speeds.length > 1 ? { speed: w.speed } : {}),
  });
  const menu = await user.call("GET", "/api/models");
  const prompt = PROMPTS[job.prompt];
  const work = await user.call("POST", "/api/works", { title: prompt.title });
  const began = Date.now();
  let run = await user.call("POST", `/api/works/${work.id}/runs`, { prompt: prompt.text, sceneId: "root" });
  const answers: { questions: unknown; answer: string; at: number }[] = [];
  const deadline = began + 25 * 60_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    run = (await user.call("GET", `/api/works/${work.id}/runs`)).at(-1);
    if (run.status === "waiting") {
      if (answers.length >= 2) {
        await user.call("POST", `/api/runs/${run.id}/cancel`);
        break;
      }
      answers.push({ questions: run.questions, answer: ANSWER, at: Date.now() - began });
      await user.call("POST", `/api/runs/${run.id}/answer`, { answer: ANSWER });
      continue;
    }
    if (!["running", "viewing"].includes(run.status)) break;
  }
  const wall = Date.now() - began;
  const final = await user.call("GET", `/api/works/${work.id}`);
  const scenes = Object.values(final.scenes as Record<string, { id: string; modules: unknown[] }>).filter(
    (s) => s.modules.length,
  );
  const pictures: string[] = [];
  for (const s of scenes) {
    try {
      const png = await user.call("GET", `/api/works/${work.id}/scenes/${s.id}/picture`, undefined, true);
      writeFileSync(join(dir, `scene-${s.id}.png`), png);
      pictures.push(`scene-${s.id}.png`);
    } catch (e) {
      console.error(job, "picture failed", s.id, String(e));
    }
  }
  let trace: any = null;
  try {
    trace = await user.call("GET", `/api/traces/${run.id}`);
  } catch {}
  const cost = costOf(run.usage, run.prices);
  const turns = (trace?.spans ?? []).filter((s: any) => s.kind === "turn");
  const result = {
    tag: opt.tag,
    model: job.model,
    prompt: job.prompt,
    user: name,
    workId: work.id,
    runId: run.id,
    status: run.status,
    error: run.error,
    services: run.services,
    menu: menu.chosen ?? undefined,
    wallMs: wall,
    elapsedMs: run.elapsedMs,
    firstOutputMs: run.firstOutputMs,
    firstSceneMs: run.firstSceneMs,
    usage: run.usage,
    prices: run.prices,
    cost,
    turns: turns.length,
    revisions: final.revision,
    scenes: scenes.length,
    modules: scenes.reduce((n, s) => n + s.modules.length, 0),
    images: run.usage?.images?.count ?? 0,
    asked: answers.length,
    answers,
    brief: final.brief,
    title: final.title,
    lastMessage: run.steps.filter((s: any) => s.kind === "message" && s.role === "assistant").at(-1)?.text,
    pictures,
  };
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 1));
  writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 1));
  writeFileSync(join(dir, "work.json"), JSON.stringify(final, null, 1));
  if (trace) writeFileSync(join(dir, "trace.json"), JSON.stringify(trace));
  console.log(
    `${job.model}/${job.prompt}: ${run.status} ${(wall / 1000).toFixed(0)}s $${cost?.total.toFixed(3)} turns=${turns.length} images=${result.images}`,
  );
  return result;
}

async function main() {
  let catalog = catalogFromEnv();
  if (opt.patch) catalog = { ...catalog, ...JSON.parse(readFileSync(opt.patch, "utf8")) };
  if (opt["dry-run"]) {
    console.log(JSON.stringify(catalog, (k, v) => (k === "credential" ? (v === PLACEHOLDER ? v : "***") : v), 1));
    return;
  }
  const admin = await account("bench-admin");
  await admin.call("PUT", "/api/admin/models", catalog);
  const out = join(opt.out!, opt.tag!);
  mkdirSync(out, { recursive: true });
  const jobs: Job[] = opt.models!.split(",").flatMap((model) => opt.prompts!.split(",").map((prompt) => ({ model, prompt })));
  const results: any[] = [];
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Number(opt.parallel) }, async () => {
      for (let job; (job = queue.shift()); )
        results.push(
          await runJob(admin, job, out).catch((e) => {
            console.error(job, e);
            return { ...job, status: "harness-error", error: String(e) };
          }),
        );
    }),
  );
  const file = join(out, "results.json");
  const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const keep = before.filter((r: any) => !results.some((x) => x.model === r.model && x.prompt === r.prompt));
  writeFileSync(file, JSON.stringify([...keep, ...results], null, 1));
}
await main();
