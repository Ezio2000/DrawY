import type { Locale } from "./locale.tsx";
export const words: Record<Locale, { close: string; undo: string }> = {
  en: { close: "Close", undo: "Undo" },
  zh: { close: "关闭", undo: "撤销" },
};
