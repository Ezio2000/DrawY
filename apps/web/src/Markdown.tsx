import type { ReactNode } from "react";
import type { Citation } from "../../../modules/contracts/index.ts";
import { cx } from "./cx.ts";

/** Private-use markers some models leave for citations they render themselves, such as
 * `citeturn3search2`; they mean nothing here and read as boxes. */
const MARKER = /[^]*|[-]/g;

/** The text without those markers, with each citation moved to where its words now are. */
export function tidy(text: string, citations: Citation[] = []) {
  const cuts: [number, number][] = [];
  for (const m of text.matchAll(MARKER)) cuts.push([m.index, m[0].length]);
  if (!cuts.length) return { text, citations };
  const shift = (at: number) =>
    at - cuts.reduce((n, [i, len]) => n + (i < at ? Math.min(len, at - i) : 0), 0);
  return {
    text: text.replace(MARKER, ""),
    citations: citations.map((c) => ({ ...c, start: shift(c.start), end: shift(c.end) })),
  };
}

/** One line of plain words from markdown, for places that show a line, not a document. */
export function plain(text: string) {
  return tidy(text)
    .text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\s)[*_]([^*_\s][^*_]*?)[*_](?=\s|$|[，。,.!?！？])/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+•]\s+|>\s?|\d+[.)]\s+)/gm, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** A source the words rest on, as a small chip where it was cited. */
function Source({ citation }: { citation: Citation }) {
  return (
    <a
      className={cx("md-source")}
      href={citation.url}
      title={citation.title || citation.url}
      target="_blank"
      rel="noreferrer"
    >
      {host(citation.url)}
    </a>
  );
}

const INLINE =
  /\u0001(\d+)\u0002|\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?，。；：！？])|(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g;

function inline(text: string, citations: Citation[], key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0,
    n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const k = `${key}.${n++}`;
    if (m[1] !== undefined) {
      const c = citations[Number(m[1])];
      if (c) out.push(<Source key={k} citation={c} />);
    } else if (m[2] !== undefined || m[3] !== undefined)
      out.push(<strong key={k}>{inline(m[2] ?? m[3], citations, k)}</strong>);
    else if (m[4] !== undefined) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5] !== undefined)
      out.push(
        <a key={k} href={m[6]} target="_blank" rel="noreferrer">
          {inline(m[5], citations, k)}
        </a>,
      );
    else if (m[7] !== undefined)
      out.push(
        <a key={k} href={m[7]} target="_blank" rel="noreferrer">
          {host(m[7])}
        </a>,
      );
    else if (m[8] !== undefined) out.push(<em key={k}>{inline(m[8], citations, k)}</em>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

type Block =
  | { kind: "p" | "quote"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[]; start: number }
  | { kind: "hr" };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  const last = () => out.at(-1);
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) out.push({ kind: "p", lines: [] });
    else if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/)))
      out.push({ kind: "h", level: m[1].length, text: m[2].replace(/\s+#+$/, "") });
    else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) out.push({ kind: "hr" });
    else if ((m = line.match(/^\s*[-*+•]\s+(.*)$/))) {
      const b = last();
      if (b?.kind === "ul") b.items.push(m[1]);
      else out.push({ kind: "ul", items: [m[1]], start: 1 });
    } else if ((m = line.match(/^\s*(\d+)[.)、]\s+(.*)$/))) {
      const b = last();
      if (b?.kind === "ol") b.items.push(m[2]);
      else out.push({ kind: "ol", items: [m[2]], start: Number(m[1]) });
    } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
      const b = last();
      if (b?.kind === "quote") b.lines.push(m[1]);
      else out.push({ kind: "quote", lines: [m[1]] });
    } else {
      const b = last();
      // A line under a list item that is indented carries on that item.
      if ((b?.kind === "ul" || b?.kind === "ol") && /^\s+/.test(raw))
        b.items[b.items.length - 1] += " " + line.trim();
      else if (b?.kind === "p" && b.lines.length) b.lines.push(line);
      else out.push({ kind: "p", lines: [line] });
    }
  }
  return out.filter((b) => !(b.kind === "p" && !b.lines.length));
}

/** The author's words as they were written: paragraphs, headings, lists, emphasis, links,
 * and each cited source as a chip where it was cited. */
export function Markdown({
  text,
  citations = [],
  className,
}: {
  text: string;
  citations?: Citation[];
  className?: string;
}) {
  const clean = tidy(text, citations);
  // Each cited span becomes a placeholder the inline pass turns into its source.
  let body = "",
    cursor = 0;
  const kept: Citation[] = [];
  for (const c of [...clean.citations].sort((a, b) => a.start - b.start)) {
    if (c.start < cursor || c.end < c.start || c.end > clean.text.length) continue;
    // A cited span is usually the markdown link the model wrote for it; the chip replaces it.
    body += clean.text.slice(cursor, c.start).replace(/\s*\(?$/, "");
    body += `\u0001${kept.length}\u0002`;
    kept.push(c);
    cursor = c.end;
    if (clean.text[cursor] === ")" && clean.text.slice(c.start - 1, c.start) === "(") cursor++;
  }
  body += clean.text.slice(cursor);
  return (
    <div className={cx("md", className)}>
      {blocks(body).map((b, i) => {
        const k = String(i);
        switch (b.kind) {
          case "h":
            return b.level <= 2 ? (
              <h3 key={k}>{inline(b.text, kept, k)}</h3>
            ) : (
              <h4 key={k}>{inline(b.text, kept, k)}</h4>
            );
          case "hr":
            return <hr key={k} />;
          case "ul":
            return (
              <ul key={k}>
                {b.items.map((t, j) => (
                  <li key={j}>{inline(t, kept, `${k}.${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k} start={b.start}>
                {b.items.map((t, j) => (
                  <li key={j}>{inline(t, kept, `${k}.${j}`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return <blockquote key={k}>{inline(b.lines.join("\n"), kept, k)}</blockquote>;
          default:
            return <p key={k}>{inline(b.lines.join("\n"), kept, k)}</p>;
        }
      })}
    </div>
  );
}

/** The distinct sources a reply cites, in the order they first appear. */
export const sourcesOf = (citations: Citation[] = []) =>
  citations.filter((c, i) => citations.findIndex((d) => d.url === c.url) === i);
