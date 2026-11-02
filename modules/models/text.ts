/* Reading a model's answer, and showing a conversation to a model that cannot see. */
import type { Citation } from "../contracts/index.ts";
import type { Item } from "./types.ts";

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

/** The conversation for a model that cannot see: each picture is named instead, so the
 * words around it still make sense. */
export function blind(input: Item[]): Item[] {
  return input.map((item) =>
    Array.isArray(item.content) && item.content.some((c: Item) => c?.type === "input_image")
      ? {
          ...item,
          content: item.content.map((c: Item) =>
            c?.type === "input_image"
              ? {
                  type: "input_text",
                  text: "(A picture is here, but this model cannot see pictures: work from the words and the geometry reported beside it.)",
                }
              : c,
          ),
        }
      : item,
  );
}
