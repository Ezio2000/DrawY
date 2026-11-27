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
    let frame = 0;
    let last = { w: 0, h: 0, sw: 0, sh: 0 };
    const place = () => {
      const box = ref.current;
      const list = find();
      if (!box || !list) return;
      // Measure at the menu's resting geometry, not mid-animation (e.g. menu-in's
      // scale(0.96) + translateY(-4px) would skew right- or bottom-anchored coordinates).
      const anims = (list.getAnimations?.() ?? []).filter((a) => a.playState === "running");
      const saved = anims.map((a) => a.currentTime);
      for (const a of anims) a.finish();
      try {
        list.style.translate = list.style.maxHeight = list.style.maxWidth = list.style.overflowY = "";
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
              left: Math.min(a.left, c.left),
              right: Math.max(a.right, c.right),
            }),
            { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity },
          );
        const anchor = Number.isFinite(control.top) ? control : box.getBoundingClientRect();
        const below = r.top >= anchor.bottom - 1;
        const above = r.bottom <= anchor.top + 1;
        const width = Math.min(r.width, view.width - 2 * EDGE);
        let left = Math.min(Math.max(r.left, view.left + EDGE), right - width);
        let height: number;
        let top: number;
        if (below || above) {
          const gap = Math.max(0, below ? r.top - anchor.bottom : anchor.top - r.bottom);
          const flipGap = Math.min(gap, 12);
          const room = {
            below: bottom - anchor.bottom - (below ? gap : flipGap),
            above: anchor.top - (above ? gap : flipGap) - (view.top + EDGE),
          };
          const preferred: "below" | "above" = below ? "below" : "above";
          let side = preferred;
          if (r.height > room[side] && room[side === "below" ? "above" : "below"] > room[side])
            side = side === "below" ? "above" : "below";
          const usedGap = side === preferred ? gap : flipGap;
          height = Math.min(r.height, Math.max(80, room[side]));
          top = side === "below" ? anchor.bottom + usedGap : anchor.top - usedGap - height;
          top = Math.min(Math.max(top, view.top + EDGE), bottom - height);
        } else {
          // Side-anchored menus (such as the export menu beside the rail) share the viewport's
          // full height and flip horizontally only if the opposite side has more room.
          const toLeft = r.right <= anchor.left + 1;
          const toRight = r.left >= anchor.right - 1;
          if (toLeft || toRight) {
            const hGap = Math.max(0, toLeft ? anchor.left - r.right : r.left - anchor.right);
            const roomLeft = anchor.left - hGap - (view.left + EDGE);
            const roomRight = right - anchor.right - hGap;
            if (toLeft && r.width > roomLeft && roomRight > roomLeft) left = anchor.right + hGap;
            else if (toRight && r.width > roomRight && roomLeft > roomRight) left = anchor.left - hGap - width;
            left = Math.min(Math.max(left, view.left + EDGE), right - width);
          }
          height = Math.min(r.height, Math.max(80, view.height - 2 * EDGE));
          top = Math.min(Math.max(r.top, view.top + EDGE), bottom - height);
        }
        if (width < r.width) list.style.maxWidth = `${width}px`;
        if (height < r.height) {
          list.style.maxHeight = `${height}px`;
          list.style.overflowY = "auto";
        }
        // A bottom- or right-anchored menu moves when constrained; translate from its
        // resulting position rather than counting that movement a second time.
        const placed = list.getBoundingClientRect();
        const dx = left - placed.left,
          dy = top - placed.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) list.style.translate = `${dx}px ${dy}px`;
        last = {
          w: list.offsetWidth,
          h: list.offsetHeight,
          sw: list.scrollWidth,
          sh: list.scrollHeight,
        };
      } finally {
        anims.forEach((a, i) => {
          if (saved[i] !== null) a.currentTime = saved[i];
          a.play();
        });
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    place();
    // What the menu shows can arrive later (styles, labels) and change its size.
    const sized = new ResizeObserver(() => {
      const el = find();
      if (!el) return;
      if (
        el.offsetWidth === last.w &&
        el.offsetHeight === last.h &&
        el.scrollWidth === last.sw &&
        el.scrollHeight === last.sh
      )
        return;
      schedule();
    });
    const list = find();
    if (list) sized.observe(list);
    const v = globalThis.visualViewport;
    v?.addEventListener("resize", schedule);
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      sized.disconnect();
      v?.removeEventListener("resize", schedule);
      removeEventListener("resize", schedule);
    };
  }, [open]);
}
