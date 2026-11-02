import {
  serviceTiers,
  speedFor,
  type Role,
  type Citation,
} from "../contracts/index.ts";
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
  onEvent: (event: Item) => void = () => {},
  budget = 32768,
  /** Requests that extend one another share a key, so they reach the machine holding
   * their cached prefix; the ChatGPT backend routes by the `session_id` header, so it
   * carries the key there too. */
  cacheKey?: string,
) {
  if (!role.credential) throw Error("请先配置模型凭证");
  const r = await fetch(role.baseUrl.replace(/\/$/, "") + "/responses", {
    method: "POST",
    headers: {
      ...headers(role),
      ...(cacheKey && role.channel === "oauth" ? { session_id: cacheKey } : {}),
    },
    body: JSON.stringify({
      model: role.model,
      instructions,
      input,
      tools,
      stream: true,
      store: false,
      reasoning: { effort: role.effort, summary: "auto" },
      service_tier: serviceTiers[speedFor(role.channel, role.speed)],
      ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
      ...(role.channel === "api" ? { max_output_tokens: budget } : {}),
    }),
    signal,
  });
  if (!r.ok) throw Error(`模型请求 ${r.status}: ${await r.text()}`);
  const items: Item[] = [];
  const decoder = new TextDecoder();
  let buffer = "",
    complete = false,
    usage: Item = {},
    response: Item = {};
  for await (const bytes of r.body!) {
    buffer += decoder.decode(bytes, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      const e = JSON.parse(line.slice(5).trim());
      onEvent(e);
      if (e.type === "response.output_item.done") items.push(e.item);
      if (e.type === "response.completed") {
        complete = true;
        usage = e.response.usage;
        const { id, model, status, service_tier } = e.response;
        response = { id, model, status, service_tier };
      }
      if (e.type === "response.failed" || e.type === "error")
        throw Error(JSON.stringify(e.error || e.response?.error));
      if (e.type === "response.incomplete")
        throw Error("这一轮要写的内容太多，模型的输出被截断了");
    }
  }
  if (!complete) throw Error("模型连接在完成前中断");
  return { items, usage, response };
}
export function textOf(items: Item[]) {
  return items
    .filter((i) => i.type === "message")
    .flatMap((i) => i.content || [])
    .map((c) => c.text || "")
    .join("");
}

/** Citation offsets follow the same concatenation as textOf. */
export function citationsOf(items: Item[]): Citation[] {
  const citations: Citation[] = [];
  let offset = 0;
  for (const item of items.filter((i) => i.type === "message"))
    for (const part of item.content || []) {
      for (const a of part.annotations || [])
        if (a.type === "url_citation")
          citations.push({
            start: offset + a.start_index,
            end: offset + a.end_index,
            url: a.url,
            title: a.title,
          });
      offset += (part.text || "").length;
    }
  return citations;
}
