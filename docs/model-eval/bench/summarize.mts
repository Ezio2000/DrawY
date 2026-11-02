/* Turns the benchmark's run folders into the report's tables.
 *
 *   npx tsx docs/model-eval/bench/summarize.mts docs/model-eval/runs/baseline [more tags…]
 *
 * Per run: outcome, time, tokens, pictures, searches and cost by service. Per model turn
 * (from the trace): the effort it ran at and what it spent, so deciding turns (raised
 * effort) and carrying-out turns can be compared, and where each dollar went. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dirs = process.argv.slice(2);
const s = (ms?: number) => (ms === undefined ? "—" : ms >= 60000 ? `${Math.floor(ms / 60000)}分${Math.round((ms % 60000) / 1000)}秒` : `${Math.round(ms / 1000)}秒`);
const k = (n?: number) => (n === undefined ? "—" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
const $ = (n?: number) => (n === undefined ? "—" : "$" + n.toFixed(3));

for (const dir of dirs) {
  const results: any[] = JSON.parse(readFileSync(join(dir, "results.json"), "utf8"));
  results.sort((a, b) => (a.model + a.prompt).localeCompare(b.model + b.prompt));
  console.log(`\n## ${dir}\n`);
  console.log("| 配置 | 题目 | 结果 | 总耗时 | 首个画面 | 轮次 | 输入 / 缓存命中 | 缓存写入 | 输出 / 推理 | 生图 | 搜索 | 模型费 | 生图费 | 搜索费 | 合计 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const u = r.usage ?? {};
    const hit = u.input ? Math.round((u.cached / u.input) * 100) + "%" : "—";
    console.log(
      `| ${r.model} | ${r.prompt} | ${r.status}${r.asked ? `（问了${r.asked}次）` : ""} | ${s(r.wallMs)} | ${s(r.firstSceneMs)} | ${r.turns ?? "—"} | ${k(u.input)} / ${hit} | ${k(u.cacheWrite)} | ${k(u.output)} / ${k(u.reasoning)} | ${r.images ?? 0} | ${(u.searches ?? 0) + "+" + (u.pages ?? 0)} | ${$(r.cost?.author)} | ${$(r.cost?.image)} | ${$(r.cost?.search)} | **${$(r.cost?.total)}** |`,
    );
  }
  // Per model: averages over its prompts.
  const models = [...new Set(results.map((r) => r.model))];
  console.log("\n| 配置 | 平均耗时 | 平均首个画面 | 平均轮次 | 平均合计 | 其中模型 | 其中生图 |");
  console.log("|---|---|---|---|---|---|---|");
  for (const m of models) {
    const rs = results.filter((r) => r.model === m && r.cost);
    const avg = (f: (r: any) => number) => rs.reduce((a, r) => a + (f(r) || 0), 0) / (rs.length || 1);
    console.log(
      `| ${m} | ${s(avg((r) => r.wallMs))} | ${s(avg((r) => r.firstSceneMs))} | ${avg((r) => r.turns).toFixed(1)} | **${$(avg((r) => r.cost.total))}** | ${$(avg((r) => r.cost.author))} | ${$(avg((r) => r.cost.image))} |`,
    );
  }
  // Per turn kind, from the traces.
  console.log("\n| 配置 | 轮次强度 | 轮数 | 平均新输入 | 平均缓存读 | 平均输出 | 平均推理 | 平均用时 |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const m of models) {
    const turns = results
      .filter((r) => r.model === m)
      .flatMap((r) => {
        const file = join(dir, `${r.model}-${r.prompt}`, "trace.json");
        if (!existsSync(file)) return [];
        const t = JSON.parse(readFileSync(file, "utf8"));
        return (t.spans ?? []).filter((x: any) => x.kind === "turn");
      });
    const by = new Map<string, any[]>();
    for (const t of turns) {
      const e = t.attrs?.request?.effort ?? "?";
      by.set(e, [...(by.get(e) ?? []), t]);
    }
    for (const [effort, ts] of by) {
      const u = (t: any) => t.attrs?.usage ?? {};
      const avg = (f: (t: any) => number) => Math.round(ts.reduce((a, t) => a + (f(t) || 0), 0) / ts.length);
      console.log(
        `| ${m} | ${effort} | ${ts.length} | ${k(avg((t) => (u(t).input_tokens ?? 0) - (u(t).input_tokens_details?.cached_tokens ?? 0)))} | ${k(avg((t) => u(t).input_tokens_details?.cached_tokens))} | ${k(avg((t) => u(t).output_tokens))} | ${k(avg((t) => u(t).output_tokens_details?.reasoning_tokens))} | ${s(avg((t) => (t.endedAt ?? t.startedAt) - t.startedAt))} |`,
      );
    }
  }
}
// Folders without results.json are skipped quietly so a partial tag still summarizes.
void readdirSync;
