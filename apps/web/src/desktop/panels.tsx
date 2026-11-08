import { useState } from "react";
import { cx } from "../cx.ts";

/** How wide the studio, the drafts panel and the editor are, each as the person last
 * dragged it: the conversation reads best wide, a list of drafts needs far less, and the
 * editor wants room for its fields without crowding the canvas. */
export type Sized = "journal" | "drafts" | "edit";
export const panelWidths: Record<Sized, { min: number; initial: number }> = {
  journal: { min: 360, initial: 520 },
  drafts: { min: 260, initial: 340 },
  edit: { min: 300, initial: 380 },
};
export const panelWidth = {
  max: () => Math.max(420, Math.round(innerWidth * 0.62)),
  clamp: (kind: Sized, n: number) =>
    Math.min(panelWidth.max(), Math.max(panelWidths[kind].min, n)),
  read(kind: Sized) {
    try {
      const n = Number(localStorage.getItem("drawy.panel." + kind));
      return n ? panelWidth.clamp(kind, n) : panelWidths[kind].initial;
    } catch {
      return panelWidths[kind].initial;
    }
  },
  save(kind: Sized, n: number) {
    try {
      localStorage.setItem("drawy.panel." + kind, String(Math.round(n)));
    } catch {}
  },
};
/** The panel's left edge, dragged to share the page between the canvas and the panel; the
 * width is remembered for next time. Arrow keys move it too. */
export function Resizer({
  kind,
  width,
  set,
  label,
}: {
  kind: Sized;
  width: number;
  set: (kind: Sized, n: number) => void;
  label: string;
}) {
  const clamp = (n: number) => panelWidth.clamp(kind, n);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={cx("resizer")}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        e.preventDefault();
        const start = e.clientX,
          from = width;
        let last = from;
        setDragging(true);
        const move = (m: PointerEvent) => {
          last = clamp(from + start - m.clientX);
          set(kind, last);
        };
        const up = () => {
          setDragging(false);
          panelWidth.save(kind, last);
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
      }}
      onDoubleClick={() => {
        set(kind, panelWidths[kind].initial);
        panelWidth.save(kind, panelWidths[kind].initial);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 80 : 20;
        const next =
          e.key === "ArrowLeft" ? width + step : e.key === "ArrowRight" ? width - step : undefined;
        if (next === undefined) return;
        e.preventDefault();
        set(kind, clamp(next));
        panelWidth.save(kind, clamp(next));
      }}
    />
  );
}
