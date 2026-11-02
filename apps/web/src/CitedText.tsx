import type { ReactNode } from "react";
import type { Citation } from "../../../modules/contracts/index.ts";

/** Keep source links at the positions supplied by the model. */
export function CitedText({
  text,
  citations = [],
}: {
  text: string;
  citations?: Citation[];
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const c of [...citations].sort((a, b) => a.start - b.start)) {
    if (c.start < cursor || c.end < c.start || c.end > text.length) continue;
    parts.push(text.slice(cursor, c.start));
    parts.push(
      <a
        key={c.start + c.url}
        href={c.url}
        title={c.title}
        target="_blank"
        rel="noreferrer"
      >
        {c.title || text.slice(c.start, c.end) || c.url}
      </a>,
    );
    cursor = c.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
