import { pinnedProvider, type Connection, type Role } from "../contracts/index.ts";
import type { Item } from "./types.ts";

/** The headers every request on a connection carries: its credential, and for a ChatGPT
 * account who is calling and for which account. */
export function headers(c: Pick<Connection, "channel" | "credential" | "accountId">) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${c.credential}`,
    ...(c.channel === "oauth"
      ? {
          originator: "codex_cli_rs",
          ...(c.accountId ? { "chatgpt-account-id": c.accountId } : {}),
        }
      : {}),
  };
}
/** An address on a connection. */
export const at = (c: Pick<Connection, "baseUrl">, path: string) =>
  c.baseUrl.replace(/\/$/, "") + path;

/** Streams a JSON request to a model, failing in the words the run retries on. */
export async function post(
  role: Role,
  path: string,
  body: Item,
  signal: AbortSignal,
  extra: Record<string, string> = {},
) {
  const r = await fetch(at(role, path), {
    method: "POST",
    headers: { ...headers(role), ...extra },
    body: JSON.stringify({ model: role.model, ...pinnedProvider(role), ...body }),
    signal,
  });
  if (!r.ok) throw Error(`模型请求 ${r.status}: ${await r.text()}`);
  return r;
}

/** The JSON events of a server-sent event stream, as they arrive. */
export async function* events(r: Response): AsyncGenerator<Item> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of r.body!) {
    buffer += decoder.decode(bytes, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      yield JSON.parse(line.slice(5).trim());
    }
  }
}
