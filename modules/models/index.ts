import type { Role } from "../contracts/index.ts";
export type Item = Record<string, any>;
export function headers(role: {
  credential: string;
  accountId?: string;
  channel: string;
}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${role.credential}`,
    ...(role.channel === "oauth"
      ? {
          originator: "codex_cli_rs",
          ...(role.accountId ? { "chatgpt-account-id": role.accountId } : {}),
        }
      : {}),
  };
}
export async function generate(
  role: Role,
  instructions: string,
  input: Item[],
  tools: Item[],
  signal: AbortSignal,
  onProgress: () => void = () => {},
  budget = 32768,
) {
  if (!role.credential) throw Error("请先配置模型凭证");
  const r = await fetch(role.baseUrl.replace(/\/$/, "") + "/responses", {
    method: "POST",
    headers: headers(role),
    body: JSON.stringify({
      model: role.model,
      instructions,
      input,
      tools,
      stream: true,
      store: false,
      reasoning: { effort: role.effort },
      service_tier: role.fast ? "priority" : "default",
      ...(role.channel === "api" ? { max_output_tokens: budget } : {}),
    }),
    signal,
  });
  if (!r.ok) throw Error(`模型请求 ${r.status}: ${await r.text()}`);
  const items: Item[] = [];
  const decoder = new TextDecoder();
  let buffer = "",
    complete = false,
    usage: Item = {};
  for await (const bytes of r.body!) {
    buffer += decoder.decode(bytes, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      const e = JSON.parse(line.slice(5).trim());
      if (e.type.endsWith(".delta")) onProgress();
      if (e.type === "response.output_item.done") items.push(e.item);
      if (e.type === "response.completed") {
        complete = true;
        usage = e.response.usage;
      }
      if (e.type === "response.failed" || e.type === "error")
        throw Error(JSON.stringify(e.error || e.response?.error));
      if (e.type === "response.incomplete")
        throw Error("模型输出被截断，请缩小本轮页面内容");
    }
  }
  if (!complete) throw Error("模型连接在完成前中断");
  return { items, usage };
}
export function textOf(items: Item[]) {
  return items
    .filter((i) => i.type === "message")
    .flatMap((i) => i.content || [])
    .map((c) => c.text || "")
    .join("");
}
