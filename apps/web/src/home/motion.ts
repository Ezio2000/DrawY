import { useEffect, useState } from "react";
import { reducedMotion } from "../ui/primitives.tsx";

/* The home page's moving parts that are not drawings: text typed out as if someone were
 * asking, and finding what scrolls the page. Anyone who asked for less motion gets the words
 * whole, at once. */

/** Milliseconds per character: Chinese characters carry more each, so they come slower. */
const pace = (text: string) => (/[\u3400-\u9fff]/.test(text) ? 95 : 42);

/** One question after another, typed out, held, then cleared for the next, so an empty box
 * shows what one might ask in it. While `held`, the current question stays whole and nothing
 * moves. */
export function useCycledTyping(lines: readonly string[], held: boolean): string {
  const [at, setAt] = useState(0);
  const [shown, setShown] = useState(0);
  const line = lines[at % lines.length] ?? "";
  useEffect(() => {
    if (held || reducedMotion()) return;
    const timer =
      shown < line.length
        ? setTimeout(() => setShown(shown + 1), pace(line) * (shown === 0 ? 4 : 1))
        : setTimeout(() => {
            setShown(0);
            setAt((i) => i + 1);
          }, 2400);
    return () => clearTimeout(timer);
  }, [held, shown, line]);
  return held || reducedMotion() ? line : line.slice(0, shown);
}

/** A request typed out once, from nothing, each time `on` turns true; empty while off. */
export function useTypedOnce(text: string, on: boolean): { text: string; typing: boolean } {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!on) {
      setShown(0);
      return;
    }
    if (reducedMotion()) {
      setShown(text.length);
      return;
    }
    if (shown >= text.length) return;
    const timer = setTimeout(() => setShown(shown + 1), (pace(text) * 2) / 3);
    return () => clearTimeout(timer);
  }, [on, shown, text]);
  return { text: on ? text.slice(0, shown) : "", typing: on && shown < text.length };
}

/** The nearest element above `el` that scrolls up and down: the home page's sheet. */
export function scroller(el: HTMLElement): HTMLElement {
  for (let at = el.parentElement; at; at = at.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at;
  return document.scrollingElement as HTMLElement;
}
