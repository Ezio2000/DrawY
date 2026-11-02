import type { SearchProvider, SearchService } from "../contracts/index.ts";

/** One web result as the author reads it. */
export interface Hit {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}
/** Results kept per query, and how much of a page the author reads: enough to settle the
 * facts a figure states, without filling the conversation it carries to its end. */
export const HITS = 5,
  PAGE_CHARS = 12000;

const base = (s: SearchService) => s.baseUrl.replace(/\/$/, "");
const json = async (r: Response, what: string) => {
  if (!r.ok) throw Error(`${what} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as Record<string, any>;
};
const clip = (text: unknown, n: number) =>
  typeof text === "string" ? (text.length > n ? text.slice(0, n) + "…" : text) : "";

const bearer = (s: SearchService) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${s.credential}`,
});
const hit = (title: unknown, url: unknown, snippet: unknown, date?: unknown): Hit => ({
  title: typeof title === "string" ? title : "",
  url: typeof url === "string" ? url : "",
  snippet: clip(snippet, 600),
  ...(date ? { date: String(date).slice(0, 10) } : {}),
});

/** How DrawY talks to one search provider: how it searches, and how it reads a page if
 * it reads pages itself (otherwise DrawY reads them directly). Adding a provider is adding
 * its spec in contracts and its client here. */
interface Client {
  search(service: SearchService, query: string, signal: AbortSignal, what: string): Promise<Hit[]>;
  read?(service: SearchService, url: string, signal: AbortSignal, what: string): Promise<string>;
}
const clients: Record<SearchProvider, Client> = {
  deepseek: {
    async search(s, query, signal, what) {
      const data = await json(
        await fetch(base(s) + "/search", {
          method: "POST",
          headers: bearer(s),
          body: JSON.stringify({ query }),
          signal,
        }),
        what,
      );
      return (data.results ?? [])
        .slice(0, HITS)
        .map((r: any) => hit(r.title, r.url, r.snippet || r.summary || r.content, r.date));
    },
    async read(s, url, signal, what) {
      const data = await json(
        await fetch(base(s) + "/fetch", {
          method: "POST",
          headers: bearer(s),
          body: JSON.stringify({ url }),
          signal,
        }),
        what,
      );
      return clip(data.content ?? "", PAGE_CHARS);
    },
  },
  tavily: {
    async search(s, query, signal, what) {
      const data = await json(
        await fetch(base(s) + "/search", {
          method: "POST",
          headers: bearer(s),
          body: JSON.stringify({ query, max_results: HITS }),
          signal,
        }),
        what,
      );
      return (data.results ?? [])
        .slice(0, HITS)
        .map((r: any) => hit(r.title, r.url, r.content, r.published_date));
    },
    async read(s, url, signal, what) {
      const data = await json(
        await fetch(base(s) + "/extract", {
          method: "POST",
          headers: bearer(s),
          body: JSON.stringify({ urls: [url] }),
          signal,
        }),
        what,
      );
      const page = data.results?.[0];
      if (!page) throw Error(`${what}: ${data.failed_results?.[0]?.error ?? "没有内容"}`);
      return clip(page.raw_content ?? "", PAGE_CHARS);
    },
  },
  brave: {
    async search(s, query, signal, what) {
      const data = await json(
        await fetch(`${base(s)}/res/v1/web/search?count=${HITS}&q=${encodeURIComponent(query)}`, {
          headers: { Accept: "application/json", "X-Subscription-Token": s.credential },
          signal,
        }),
        what,
      );
      return (data.web?.results ?? [])
        .slice(0, HITS)
        .map((r: any) => hit(r.title, r.url, strip(r.description ?? ""), r.page_age));
    },
  },
  searxng: {
    async search(s, query, signal, what) {
      const data = await json(
        await fetch(`${base(s)}/search?format=json&q=${encodeURIComponent(query)}`, {
          headers: {
            Accept: "application/json",
            ...(s.credential ? { Authorization: `Bearer ${s.credential}` } : {}),
          },
          signal,
        }),
        what,
      );
      return (data.results ?? [])
        .slice(0, HITS)
        .map((r: any) => hit(r.title, r.url, r.content, r.publishedDate));
    },
  },
};
const within = (ms: number, signal?: AbortSignal) => {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

/** Searches the web with a search service; each provider by its own API. */
export function searchWeb(service: SearchService, query: string, signal?: AbortSignal) {
  return clients[service.provider].search(
    service,
    query,
    within(30_000, signal),
    `搜索服务 ${service.name}`,
  );
}

/** A page's readable text, from the service when it reads pages itself, else fetched
 * directly and stripped of its markup. */
export async function readPage(
  service: SearchService,
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw Error("只能打开 http 或 https 网址");
  const what = `网页读取 ${service.name}`;
  signal = within(45_000, signal);
  const read = clients[service.provider].read;
  if (read) return read(service, url, signal, what);
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; DrawY)", Accept: "text/html,text/plain,*/*" },
    redirect: "follow",
    signal,
  });
  if (!r.ok) throw Error(`${what} ${r.status}`);
  const type = r.headers.get("content-type") ?? "";
  if (!/text|json|xml/.test(type)) throw Error(`${what}: 不是文字网页（${type || "未知类型"}）`);
  const text = await r.text();
  return clip(/html/.test(type) ? strip(text) : text, PAGE_CHARS);
}

/** The words of an HTML page, without its scripts, styles and tags. */
export function strip(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
