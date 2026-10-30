import { createContext, useContext } from "react";

/* The language the interface speaks: inside a work, the language the work is written in, so
 * a Chinese work reads with Chinese controls; elsewhere, the browser's. Each package keeps
 * its own words in both languages and picks them by the locale in context. */

export type Locale = "en" | "zh";

/** The browser's language, English where it is not Chinese or there is no browser. */
export function browserLocale(): Locale {
  const language = typeof navigator === "undefined" ? "" : navigator.language;
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const IDEOGRAPH = /\p{Script=Han}/gu,
  LATIN = /\p{Script=Latin}/gu;
/** The language `texts` are written in: Chinese where its ideographs outnumber Latin letters,
 * English where they do not, the browser's where there is no text at all. */
export function localeOf(...texts: string[]): Locale {
  const text = texts.join(" ");
  const han = text.match(IDEOGRAPH)?.length ?? 0,
    latin = text.match(LATIN)?.length ?? 0;
  if (!han && !latin) return browserLocale();
  return han > latin ? "zh" : "en";
}

/** The `lang` an element in `locale` declares. */
export const langOf = (locale: Locale) => (locale === "zh" ? "zh-CN" : "en-US");
/** The language the page declares, as what is shown around a work sets it: for what speaks
 * outside any component, such as a request's failure. */
export function pageLocale(): Locale {
  const lang = (
    typeof document === "undefined" ? undefined : document.documentElement
  )?.lang;
  return lang
    ? lang.toLowerCase().startsWith("zh")
      ? "zh"
      : "en"
    : browserLocale();
}

export const LocaleContext = createContext<Locale>(browserLocale());
export const useLocale = () => useContext(LocaleContext);
/** A package's words in the locale in context. */
export function useWords<W>(words: Record<Locale, W>): W {
  return words[useLocale()];
}
