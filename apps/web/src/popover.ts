import { useEffect, useRef } from "react";
import { useInView } from "@drawy/ui";

/** What every menu that opens from a control does: it stays inside what can be seen (see
 * `useInView`), and closes on a press outside `ref`, which holds the control and the menu,
 * or on Escape. */
export function useDismiss(
  open: boolean,
  close: () => void,
  ref: React.RefObject<HTMLElement | null>,
  /** The menu inside `ref`, where it is not its `[role=menu]` element. */
  menu?: string,
) {
  const latest = useRef(close);
  latest.current = close;
  useInView(ref, open, menu);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) latest.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      latest.current();
    };
    addEventListener("pointerdown", away, true);
    addEventListener("keydown", key, true);
    return () => {
      removeEventListener("pointerdown", away, true);
      removeEventListener("keydown", key, true);
    };
  }, [open]);
}
