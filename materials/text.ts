/** Words that describe a request for pictures rather than the thing pictured. */
const NOISE = new Set(
  "a an the of and or with for in on to its this that some one single picture pictures image images illustration illustrations icon icons diagram art artwork clipart material materials asset assets graphic graphics png svg style styled realistic cartoon vector".split(
    " ",
  ),
);
const CJK_NOISE =
  /插图|插画|图片|图像|图标|素材|示意图|配图|线描|手绘|风格的|风格|一张|一个|一只|一幅|的/g;
const CJK = /[㐀-鿿豈-﫿]+/g;
const LATIN = /[a-z0-9]+/g;

/** Folds plural and verb endings so "planets" finds "planet". */
function stem(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word))
    return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word))
    return word.slice(0, -1);
  return word;
}
export function normalize(text: string) {
  return text
    .normalize("NFKC")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}
/** Search terms: stemmed latin words, and Chinese as overlapping character pairs so a word
 * is found inside longer names ("苹果" in "青苹果"). */
export function terms(text: string, query = false): string[] {
  const t = normalize(text);
  const out: string[] = [];
  for (const [w] of t.matchAll(LATIN))
    if (!(query && NOISE.has(w))) out.push(stem(w));
  const cjk = query ? t.replace(CJK_NOISE, " ") : t;
  for (const [run] of cjk.matchAll(CJK)) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}
/** A name reduced to its letters, for recognising an exact request. */
export function key(text: string) {
  return terms(text, true).join(" ");
}

/** The parts of a request that must be found for a picture to be of exactly that thing:
 * each latin word, and each Chinese character with the search terms that contain it. */
export function units(text: string): string[][] {
  const t = normalize(text);
  const out: string[][] = [];
  for (const [w] of t.matchAll(LATIN)) if (!NOISE.has(w)) out.push([stem(w)]);
  for (const [run] of t.replace(CJK_NOISE, " ").matchAll(CJK)) {
    if (run.length === 1) out.push([run]);
    else
      for (let i = 0; i < run.length; i++)
        out.push(
          [run.slice(i - 1, i + 1), run.slice(i, i + 2)].filter(
            (b, k) => b.length === 2 && (k === 1 || i > 0),
          ),
        );
  }
  return out;
}
