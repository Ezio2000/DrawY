import type { SearchService } from "../contracts/index.ts";

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

/** Searches the web with a search service; each provider by its own API. */
export async function searchWeb(
  service: SearchService,
  query: string,
  signal?: AbortSignal,
): Promise<Hit[]> {
  const bearer = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${service.credential}`,
  };
  const what = `搜索服务 ${service.name}`;
  const timeout = AbortSignal.timeout(30_000);
  signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  switch (service.provider) {
    case "deepseek": {
      const data = await json(
        await fetch(base(service) + "/search", {
          method: "POST",
          headers: bearer,
          body: JSON.stringify({ query }),
          signal,
        }),
        what,
      );
      return (data.results ?? []).slice(0, HITS).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: clip(r.snippet || r.summary || r.content, 600),
        ...(r.date ? { date: String(r.date).slice(0, 10) } : {}),
      }));
    }
    case "tavily": {
      const data = await json(
        await fetch(base(service) + "/search", {
          method: "POST",
          headers: bearer,
          body: JSON.stringify({ query, max_results: HITS }),
          signal,
        }),
        what,
      );
      return (data.results ?? []).slice(0, HITS).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: clip(r.content, 600),
        ...(r.published_date ? { date: String(r.published_date).slice(0, 10) } : {}),
      }));
    }
    case "brave": {
      const data = await json(
        await fetch(
          `${base(service)}/res/v1/web/search?count=${HITS}&q=${encodeURIComponent(query)}`,
          {
            headers: { Accept: "application/json", "X-Subscription-Token": service.credential },
            signal,
          },
        ),
        what,
      );
      return (data.web?.results ?? []).slice(0, HITS).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: clip(strip(r.description ?? ""), 600),
        ...(r.page_age ? { date: String(r.page_age).slice(0, 10) } : {}),
      }));
    }
    case "searxng": {
      const data = await json(
        await fetch(`${base(service)}/search?format=json&q=${encodeURIComponent(query)}`, {
          headers: {
            Accept: "application/json",
            ...(service.credential ? { Authorization: `Bearer ${service.credential}` } : {}),
          },
          signal,
        }),
        what,
      );
      return (data.results ?? []).slice(0, HITS).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: clip(r.content, 600),
        ...(r.publishedDate ? { date: String(r.publishedDate).slice(0, 10) } : {}),
      }));
    }
  }
}

/** A page's readable text, from the service when it reads pages itself, else fetched
 * directly and stripped of its markup. */
export async function readPage(
  service: SearchService,
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw Error("只能打开 http 或 https 网址");
  const timeout = AbortSignal.timeout(45_000);
  signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const bearer = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${service.credential}`,
  };
  const what = `网页读取 ${service.name}`;
  if (service.provider === "deepseek") {
    const data = await json(
      await fetch(base(service) + "/fetch", {
        method: "POST",
        headers: bearer,
        body: JSON.stringify({ url }),
        signal,
      }),
      what,
    );
    return clip(data.content ?? "", PAGE_CHARS);
  }
  if (service.provider === "tavily") {
    const data = await json(
      await fetch(base(service) + "/extract", {
        method: "POST",
        headers: bearer,
        body: JSON.stringify({ urls: [url] }),
        signal,
      }),
      what,
    );
    const page = data.results?.[0];
    if (!page) throw Error(`${what}: ${data.failed_results?.[0]?.error ?? "没有内容"}`);
    return clip(page.raw_content ?? "", PAGE_CHARS);
  }
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
