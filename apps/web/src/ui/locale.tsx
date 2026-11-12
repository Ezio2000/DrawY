import { createContext, useContext } from "react";

/* The language the interface speaks: inside a work, the language the work is written in, so
 * a Chinese work reads with Chinese controls; elsewhere, the browser's. */

export type Locale = "en" | "zh";

/** The browser's language, English where it is not Chinese or there is no browser. */
export function browserLocale(): Locale {
  const language = typeof navigator === "undefined" ? "" : navigator.language;
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
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
