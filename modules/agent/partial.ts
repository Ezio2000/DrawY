/** Walks JSON text outside its strings, calling `seen` at each bracket and comma with the
 * closers of the arrays and objects still open after it, innermost last. */
function scan(text: string, seen: (at: number, c: string, closers: string[]) => void) {
  const closers: string[] = [];
  let quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{" || c === "[") closers.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") closers.pop();
    if (c === "{" || c === "[" || c === "}" || c === "]" || c === ",") seen(i, c, closers);
  }
}
const closing = (closers: string[]) => closers.toReversed().join("");

/** The finished part of a JSON document that is still streaming: the text is cut after its
 * last complete value (never inside a string, key or number) and its open arrays and
 * objects are closed. Returns undefined before the first container opens. */
export function partialJson(text: string): unknown {
  let cut = -1,
    tail = "";
  scan(text, (i, c, closers) => {
    cut = c === "," ? i : i + 1;
    tail = closing(closers);
  });
  if (cut < 0) return undefined;
  try {
    return JSON.parse(text.slice(0, cut) + tail);
  } catch {
    return undefined;
  }
}
/** The records of a broken write that arrived whole: the top-level fields and list entries
 * before the point it stops reading as JSON. Empty when there are none. */
export function completedRecords(text: string): Record<string, unknown> {
  const marks: { at: number; tail: string }[] = [];
  scan(text, (i, c, closers) => {
    // A record ends inside a list inside the write, or a field ends the write's own level.
    if ((c === "}" || c === "]") && (closers.length === 2 || closers.length === 1))
      marks.push({ at: i + 1, tail: closing(closers) });
  });
  for (const { at, tail } of marks.reverse()) {
    try {
      const read = JSON.parse(text.slice(0, at) + tail);
      if (read && typeof read === "object" && !Array.isArray(read)) return read;
    } catch {
      // Further back the text still reads.
    }
  }
  return {};
}
