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
  if (!r.ok) throw Error(`模型请求 ${r.status}: ${readable(await r.text())}`);
  return r;
}

/** What a model service said went wrong, in words a person can read: the message of its
 * error object (`{error: {message, code}}`, or the error itself), with its code, rather
 * than the JSON it came in. A body that is not one is kept as it is, cut short. */
export function readable(error: unknown): string {
  let e = error;
  if (typeof error === "string") {
    try {
      e = JSON.parse(error);
    } catch {
      return error.trim().slice(0, 500);
    }
  }
  if (e && typeof e === "object" && "error" in e && e.error) e = (e as { error: unknown }).error;
  if (!e || typeof e !== "object") return String(e).slice(0, 500);
  const { message, code, type } = e as { message?: unknown; code?: unknown; type?: unknown };
  const named = [code, type].find((x) => typeof x === "string" && x);
  if (typeof message !== "string" || !message) return JSON.stringify(e).slice(0, 500);
  return named ? `${message} (${named})` : message;
}

/** A model service's error reported inside a stream that had started well. One that says
 * the service is busy or failed on its side is told as the status it stands for, so the
 * run retries it as it would that response; any other (no credit left, a request it
 * refuses) is not worth retrying. */
export function streamError(error: unknown) {
  const e = (error && typeof error === "object" && "error" in error ? error.error : error) as
    | { code?: string; type?: string }
    | undefined;
  const kind = `${e?.code ?? ""} ${e?.type ?? ""}`;
  const status = /rate_limit/.test(kind) ? 429 : /server_error|overloaded|unavailable/.test(kind) ? 503 : 0;
  return Error(status ? `模型请求 ${status}: ${readable(error)}` : `模型服务报错：${readable(error)}`);
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
