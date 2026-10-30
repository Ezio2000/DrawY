/** The finished part of a JSON document that is still streaming: the text is cut after its
 * last complete value (never inside a string, key or number) and its open arrays and
 * objects are closed. Returns undefined before the first container opens. */
export function partialJson(text: string): unknown {
  const closers: string[] = [];
  let cut = -1,
    tail = "",
    quoted = false,
    escaped = false;
  const mark = (at: number) => {
    cut = at;
    tail = closers.toReversed().join("");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{" || c === "[") {
      closers.push(c === "{" ? "}" : "]");
      mark(i + 1);
    } else if (c === "}" || c === "]") {
      closers.pop();
      mark(i + 1);
    } else if (c === ",") mark(i);
  }
  if (cut < 0) return undefined;
  try {
    return JSON.parse(text.slice(0, cut) + tail);
  } catch {
    return undefined;
  }
}
