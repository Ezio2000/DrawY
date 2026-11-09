import { useLayoutEffect, type RefObject } from "react";

/** The margin a menu keeps from the edges of what can be seen. */
const EDGE = 8;

/** The part of the page that can be seen now: the visual viewport where there is one (on a
 * phone it leaves out the keyboard and follows a zoom), else the window. */
export function seen() {
  const v = globalThis.visualViewport;
  return v
    ? { left: v.offsetLeft, top: v.offsetTop, width: v.width, height: v.height }
    : { left: 0, top: 0, width: innerWidth, height: innerHeight };
}

/** Keeps a menu that opens from a control inside what can be seen. The menu is laid out by
 * its own CSS (above or below the control, from its left or right edge), which says where
 * it would rather be; where that runs off the screen, it opens on the side with more room,
 * slides along to stay within the edges, and scrolls inside when it is still too tall.
 * The correction is a `translate` and a `max-height`, so it works whatever the menu's
 * containing block is, and is measured again when what can be seen changes (a phone
 * turned, the keyboard shown).
 *
 * `ref` holds the control and its menu, which is its `[role=menu]` (or `menu`) element. */
export function useInView(ref: RefObject<HTMLElement | null>, open: boolean, menu = "[role=menu]") {
  useLayoutEffect(() => {
    if (!open) return;
    const find = () => ref.current?.querySelector<HTMLElement>(menu);
    const place = () => {
      const box = ref.current;
      const list = find();
      if (!box || !list) return;
      list.style.translate = list.style.maxHeight = list.style.maxWidth = "";
      const view = seen();
      const right = view.left + view.width - EDGE,
        bottom = view.top + view.height - EDGE;
      const r = list.getBoundingClientRect();
      // The control is what the menu opens from: the box less the menu, when it is laid
      // out apart from it.
      const control = [...box.children]
        .filter((c) => c !== list && !c.contains(list))
        .map((c) => c.getBoundingClientRect())
        .reduce(
          (a, c) => ({
            top: Math.min(a.top, c.top),
            bottom: Math.max(a.bottom, c.bottom),
          }),
          { top: Infinity, bottom: -Infinity },
        );
      const anchor = Number.isFinite(control.top) ? control : box.getBoundingClientRect();
      const below = r.top >= anchor.bottom - 1;
      const gap = below ? r.top - anchor.bottom : anchor.top - r.bottom;
      const room = {
        below: bottom - anchor.bottom - gap,
        above: anchor.top - gap - (view.top + EDGE),
      };
      let side: "below" | "above" = below ? "below" : "above";
      if (r.height > room[side] && room[side === "below" ? "above" : "below"] > room[side])
        side = side === "below" ? "above" : "below";
      const height = Math.min(r.height, Math.max(80, room[side]));
      const top = side === "below" ? anchor.bottom + gap : anchor.top - gap - height;
      const width = Math.min(r.width, view.width - 2 * EDGE);
      const left = Math.min(Math.max(r.left, view.left + EDGE), right - width);
      const dx = left - r.left,
        dy = top - r.top;
      if (width < r.width) list.style.maxWidth = `${width}px`;
      if (height < r.height) {
        list.style.maxHeight = `${height}px`;
        list.style.overflowY = "auto";
      }
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) list.style.translate = `${dx}px ${dy}px`;
    };
    place();
    // What the menu shows can arrive later (styles, labels) and change its size.
    const sized = new ResizeObserver(() => {
      if (!find()?.style.maxHeight) place();
    });
    const list = find();
    if (list) sized.observe(list);
    const v = globalThis.visualViewport;
    v?.addEventListener("resize", place);
    addEventListener("resize", place);
    return () => {
      sized.disconnect();
      v?.removeEventListener("resize", place);
      removeEventListener("resize", place);
    };
  }, [open]);
}
