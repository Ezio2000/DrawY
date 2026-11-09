import { useEffect, useRef } from "react";

/** Makes the browser's way back (the back button, a swipe from the edge) close what is open
 * over the page, a detail page or a sheet, as a phone's own apps do, instead of leaving
 * the work. While `open`, the layer holds a step of the history at the same address; going
 * back takes the step and closes the layer, and a layer closed by its own button gives the
 * step back. */
export function useBackCloses(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const step = { drawyLayer: Math.random() };
    history.pushState(step, "");
    let taken = false;
    const back = () => {
      taken = true;
      latest.current();
    };
    addEventListener("popstate", back);
    return () => {
      removeEventListener("popstate", back);
      // Closed here rather than by going back: the step it held goes, if it is still
      // where the person is.
      if (!taken && (history.state as typeof step | null)?.drawyLayer === step.drawyLayer)
        history.back();
    };
  }, [open]);
}
