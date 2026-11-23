import type { MaterialHead } from "./schema.ts";
import { normalize } from "./text.ts";

/** Conditions a request states about how a picture is made rather than what it shows:
 * "透明背景的医生" asks for a doctor, cut out. They are taken out of the words searched and
 * checked against each picture's form, so a doctor in a hospital scene is not passed off as
 * the cut-out asked for. */
const FACETS: { words: RegExp; check: (form: NonNullable<Extract<MaterialHead, { kind: "picture" }>["form"]>) => boolean }[] = [
  {
    words: /透明背景|透明底|无背景|抠图|cut[- ]?out|transparent(?: background)?|no background/g,
    check: (f) => f.background === "transparent",
  },
  { words: /完整背景|带背景|背景图|with background|full background|backdrop/g, check: (f) => f.background === "opaque" },
  { words: /俯视图?|俯瞰|顶视图?|top[- ]view|from above|bird'?s[- ]eye/g, check: (f) => f.view === "top" },
  { words: /侧面的?|侧视图?|side[- ]view|in profile/g, check: (f) => f.view === "side" || f.view === "portrait" },
  { words: /正面的?|正视图?|front[- ]view/g, check: (f) => f.view === "front" || f.facing === "viewer" },
  { words: /朝左|面向左|facing left/g, check: (f) => f.facing === "left" },
  { words: /朝右|面向右|facing right/g, check: (f) => f.facing === "right" },
];
export interface Facet {
  word: string;
  check: (m: MaterialHead) => boolean;
}
/** The request without its stated conditions, and the conditions. */
export function facets(subject: string): { rest: string; facets: Facet[] } {
  let rest = normalize(subject);
  const found: Facet[] = [];
  for (const f of FACETS)
    rest = rest.replace(f.words, (word) => {
      // A condition on pictures: other materials have no form to fail it.
      found.push({ word, check: (m) => m.kind !== "picture" || f.check(m.form) });
      return " ";
    });
  return { rest: rest.replace(/\s+/g, " ").trim(), facets: found };
}
/** The phrases of a request a thesaurus could name: every run of up to four latin words and
 * every stretch of two to six Chinese characters. A long request has a bounded number. */
export function phrases(text: string): string[] {
  const t = normalize(text);
  const out = new Set<string>();
  for (const [run] of t.matchAll(/[a-z0-9]+(?:[ -][a-z0-9]+)*/g)) {
    const words = run.split(/[ -]/);
    for (let i = 0; i < words.length; i++)
      for (let n = 1; n <= 4 && i + n <= words.length; n++) out.add(words.slice(i, i + n).join(" "));
  }
  for (const [run] of t.matchAll(/[㐀-鿿豈-﫿]+/g))
    for (let i = 0; i < run.length; i++)
      for (let n = 2; n <= 6 && i + n <= run.length; n++) out.add(run.slice(i, i + n));
  return [...out].slice(0, 400);
}
