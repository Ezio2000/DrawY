// Real-model benchmark: runs each prompt as a fresh work on one DrawY stack and records
// what the run spent, which tools it called and what the final scene looks like.
// Usage: node bench.mjs <stack name> <server url> <rounds> [only indexes, comma separated]
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [name, base, roundsArg = "1", onlyArg] = process.argv.slice(2);
const here = new URL(".", import.meta.url).pathname;
const prompts = JSON.parse(readFileSync(join(here, "prompts.json"), "utf8"));
const only = onlyArg ? new Set(onlyArg.split(",").map(Number)) : null;
const out = join(process.env.DRAWY_BENCH_OUT ?? join(here, "results"), name);
mkdirSync(out, { recursive: true });
let cookie = "";
async function api(path, method = "GET", body) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  if (!r.ok) throw Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.headers.get("content-type")?.includes("json") ? r.json() : Buffer.from(await r.arrayBuffer());
}
const user = { name: "bench", password: "bench-password-1" };
try {
  await api("/auth/register", "POST", user);
} catch {
  await api("/auth/login", "POST", user);
}
// The model catalog to run with, as GET /api/admin/models returns it; it holds keys, so it
// stays outside the repository.
const catalog = JSON.parse(readFileSync(process.env.DRAWY_BENCH_MODELS ?? join(here, "models.json"), "utf8"));
await api("/admin/models", "PUT", catalog);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function one(i, round) {
  const p = prompts[i];
  const tag = `${String(i).padStart(2, "0")}-r${round}`;
  const work = await api("/works", "POST", { title: p.title });
  const started = Date.now();
  let run = await api(`/works/${work.id}/runs`, "POST", { prompt: p.prompt, sceneId: work.rootSceneId });
  let answers = 0;
  for (;;) {
    await pause(4000);
    const runs = await api(`/works/${work.id}/runs`);
    run = runs.find((r) => r.id === run.id) ?? run;
    if (run.status === "waiting" && answers < 2) {
      answers++;
      await api(`/runs/${run.id}/answer`, "POST", { answer: "你来决定，按你推荐的第一个方案画。" });
      continue;
    }
    if (!["running", "viewing"].includes(run.status)) break;
    if (Date.now() - started > 30 * 60_000) {
      await api(`/runs/${run.id}/cancel`, "POST").catch(() => {});
      break;
    }
  }
  const tools = {};
  for (const s of run.steps) if (s.kind === "tool") tools[s.name ?? s.tool] = (tools[s.name ?? s.tool] ?? 0) + 1;
  const final = await api(`/works/${work.id}`);
  let picture = null;
  try {
    picture = await api(`/works/${work.id}/scenes/${final.rootSceneId}/picture`);
    writeFileSync(join(out, tag + ".png"), picture);
  } catch (e) {
    console.error(tag, "no picture", String(e).slice(0, 200));
  }
  const pr = run.prices;
  const u = run.usage ?? {};
  const author = pr
    ? (Math.max(0, u.input - u.cached - (u.cacheWrite ?? 0)) * pr.author.input +
        u.cached * pr.author.cached +
        (u.cacheWrite ?? 0) * pr.author.cacheWrite +
        u.output * pr.author.output) /
      1e6
    : null;
  const materials = Object.values(final.materials ?? {});
  const summary = {
    tag,
    prompt: p.title,
    status: run.status,
    error: run.error,
    elapsedMs: run.elapsedMs,
    firstSceneMs: run.firstSceneMs,
    turns: run.steps.filter((s) => s.kind === "tool").length,
    tools,
    usage: u,
    authorCost: author,
    libraryPictures: materials.filter((m) => m.kind === "picture" && !/^g-/.test(m.id)).map((m) => m.id),
    generatedPictures: materials.filter((m) => m.kind === "picture" && /^g-/.test(m.id)).length,
    libraryDrawings: materials.filter((m) => m.kind === "drawing").map((m) => m.id),
    effects: materials.filter((m) => m.kind === "effect").map((m) => m.id),
    style: final.brief?.style,
    answers,
  };
  writeFileSync(join(out, tag + ".json"), JSON.stringify({ summary, run, work: final }, null, 1));
  console.log(JSON.stringify(summary));
  return summary;
}
const rounds = Number(roundsArg);
const jobs = [];
for (let round = 1; round <= rounds; round++)
  for (let i = 0; i < prompts.length; i++) if (!only || only.has(i)) jobs.push([i, round]);
// A few at a time, so runs do not crowd the capture service.
const results = [];
const width = 4;
await Promise.all(
  Array.from({ length: width }, async () => {
    while (jobs.length) {
      const [i, round] = jobs.shift();
      try {
        results.push(await one(i, round));
      } catch (e) {
        console.error("job", i, round, e);
        results.push({ tag: `${i}-r${round}`, status: "harness-error", error: String(e) });
      }
    }
  }),
);
writeFileSync(join(out, `summary-${Date.now()}.json`), JSON.stringify(results, null, 1));
console.log("done", results.length);
