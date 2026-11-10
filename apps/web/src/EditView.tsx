import { useEffect, useRef, useState } from "react";
import { Check, Grid3x3, Keyboard, Magnet, Minus, Plus, Ruler, Scan } from "lucide-react";
import type { Canvas } from "../../../modules/canvas/index.ts";
import { keys } from "./EditMenu.tsx";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { useDismiss } from "./popover.ts";
import { browserStorage } from "./storage.ts";

/* How the canvas is looked at and measured while a work is edited by hand: the scale of
 * the view, the rulers along the drawing board's edges, and what a dragged box snaps to. */

/** How a person has the drawing board set up; kept for the next time they edit. */
export interface BoardSettings {
  /** Rulers along the top and the left of the canvas. */
  rulers: boolean;
  /** A dragged box lines up with its neighbours and keeps equal gaps with them. */
  guides: boolean;
  /** A dragged box ends on the lines of the squared paper. */
  grid: boolean;
}
/** The squared paper's finer lines, in scene units: what a box snaps to on the grid. The
 * author lays its figures out on the same step. */
export const GRID = 20;
const KEY = "drawy.edit.board";
const defaults: BoardSettings = { rulers: true, guides: true, grid: false };
export function useBoard() {
  const [board, setBoard] = useState<BoardSettings>(() => {
    try {
      return { ...defaults, ...JSON.parse(browserStorage.get(KEY) ?? "{}") };
    } catch {
      return defaults;
    }
  });
  const set = (change: Partial<BoardSettings>) =>
    setBoard((b) => {
      const next = { ...b, ...change };
      browserStorage.set(KEY, JSON.stringify(next));
      return next;
    });
  return [board, set] as const;
}

/** A step between a ruler's figures that reads at this scale: 1, 2 or 5 times a power of
 * ten, at least some sixty pixels apart, and how many parts it is divided into. */
function stepFor(scale: number) {
  const least = 64 / scale;
  const power = 10 ** Math.floor(Math.log10(least));
  const lead = [1, 2, 5, 10].find((n) => n * power >= least)!;
  return { major: lead * power, parts: lead === 2 ? 4 : 5 };
}
const THICK = 20;
const INK = "rgba(22,26,34,.34)",
  FIGURE = "#6f7686",
  PENCIL = "#3366d6";

/** Rulers along the top and the left edge of the canvas, in scene units: the figures the
 * author reads and writes. What is selected casts its extent on both in the blue pencil,
 * and a hairline follows the pointer, so a place can be read off before anything is put
 * there. */
export function Rulers({ canvas }: { canvas: Canvas }) {
  const top = useRef<HTMLCanvasElement>(null),
    left = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const host = canvas.element;
    let pointer: { x: number; y: number } | null = null,
      frame = 0;
    const draw = () => {
      frame = 0;
      const { x, y, scale } = canvas.view;
      const area = host.getBoundingClientRect();
      const chosen = canvas.selectionRect();
      const ratio = devicePixelRatio || 1;
      for (const across of [true, false]) {
        const el = (across ? top : left).current;
        if (!el) continue;
        const length = across ? area.width : area.height;
        const w = across ? length : THICK,
          h = across ? THICK : length;
        if (el.width !== Math.round(w * ratio) || el.height !== Math.round(h * ratio)) {
          el.width = Math.round(w * ratio);
          el.height = Math.round(h * ratio);
        }
        const c = el.getContext("2d")!;
        c.setTransform(ratio, 0, 0, ratio, 0, 0);
        c.clearRect(0, 0, w, h);
        // The left ruler is the top one turned: everything is drawn along `u`.
        if (!across) {
          c.translate(0, length);
          c.rotate(-Math.PI / 2);
        }
        const at = (v: number) => (across ? x + v * scale : length - (y + v * scale));
        const origin = across ? x : y;
        if (chosen) {
          const from = across ? chosen.left - area.left : chosen.top - area.top,
            size = across ? chosen.width : chosen.height;
          const u = across ? from : length - from - size;
          c.fillStyle = "rgba(51,102,214,.13)";
          c.fillRect(u, 0, size, THICK);
          c.fillStyle = PENCIL;
          c.fillRect(u, THICK - 2, size, 2);
        }
        const { major, parts } = stepFor(scale);
        const minor = major / parts;
        const first = Math.floor((0 - origin) / scale / minor) - 1,
          last = Math.ceil((length - origin) / scale / minor) + 1;
        c.strokeStyle = INK;
        c.lineWidth = 1;
        c.fillStyle = FIGURE;
        c.font = `500 9.5px "Sofia Sans Letters","Sofia Sans",system-ui,sans-serif`;
        c.textBaseline = "top";
        c.beginPath();
        for (let i = first; i <= last; i++) {
          const v = i * minor,
            u = Math.round(at(v)) + 0.5,
            whole = i % parts === 0;
          c.moveTo(u, THICK);
          c.lineTo(u, THICK - (whole ? 9 : i % parts === parts / 2 ? 5.5 : 3.5));
          if (whole) {
            const figure = String(Math.round(v * 100) / 100);
            // Down the left ruler the figures read upwards, each above its mark.
            c.fillText(figure, across ? u + 3 : u + 3, 3);
          }
        }
        c.stroke();
        if (pointer) {
          const u = across ? pointer.x : length - pointer.y;
          c.fillStyle = PENCIL;
          c.fillRect(Math.round(u), 0, 1, THICK);
        }
      }
    };
    const ask = () => {
      frame ||= requestAnimationFrame(draw);
    };
    const moved = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      ask();
    };
    const gone = () => {
      pointer = null;
      ask();
    };
    const stop = canvas.watch(ask);
    host.addEventListener("pointermove", moved);
    host.addEventListener("pointerleave", gone);
    const resized = new ResizeObserver(ask);
    resized.observe(host);
    ask();
    return () => {
      stop();
      cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", moved);
      host.removeEventListener("pointerleave", gone);
      resized.disconnect();
    };
  }, [canvas]);
  return (
    <>
      <canvas ref={top} className={cx("ruler")} data-axis="x" aria-hidden />
      <canvas ref={left} className={cx("ruler")} data-axis="y" aria-hidden />
      <i className={cx("ruler-corner")} aria-hidden />
    </>
  );
}

/** The view's controls at the foot of the canvas: closer, further and the whole drawing,
 * with the scale between them, which opens the scales to go to and, while editing, how
 * the drawing board is set up. */
export function ViewControls({
  canvas,
  fit,
  board,
  setBoard,
  help,
}: {
  canvas?: Canvas;
  /** Shows the whole drawing. */
  fit: () => void;
  /** The drawing board's settings, while editing. */
  board?: BoardSettings;
  setBoard?: (change: Partial<BoardSettings>) => void;
  help?: () => void;
}) {
  const t = useT(),
    v = t.work.view;
  const [percent, setPercent] = useState(100);
  const [open, setOpen] = useState(false);
  // Beside a wide composer there is room for the scale alone: closer and further are then
  // in its menu.
  const [compact, setCompact] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  useEffect(() => {
    const stage = ref.current?.parentElement;
    if (!stage) return;
    const fits = new ResizeObserver(() => setCompact(stage.clientWidth < 1040));
    fits.observe(stage);
    return () => fits.disconnect();
  }, []);
  useEffect(() => {
    if (!canvas) return;
    const read = () => setPercent(Math.round(canvas.scale * 100));
    read();
    return canvas.watch(read);
  }, [canvas]);
  const choice = (label: string, run: () => void, key?: string) => (
    <button
      role="menuitem"
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      <span>{label}</span>
      {key && <kbd>{keys(key)}</kbd>}
    </button>
  );
  const toggle = (label: string, icon: React.ReactNode, on: boolean, change: Partial<BoardSettings>) => (
    <button role="menuitemcheckbox" aria-checked={on} onClick={() => setBoard?.(change)}>
      {icon}
      <span>{label}</span>
      {on && <Check size={14} />}
    </button>
  );
  return (
    <div ref={ref} className={cx("camera")} data-compact={compact || undefined}>
      <button aria-label={t.work.zoomOut} data-tip={`${t.work.zoomOut} · ${keys("Mod+−")}`} onClick={() => canvas?.zoom(1 / 1.25)}>
        <Minus size={15} />
      </button>
      <button
        className={cx("camera-scale")}
        aria-label={v.scale(percent)}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        {percent}%
      </button>
      <button aria-label={t.work.zoomIn} data-tip={`${t.work.zoomIn} · ${keys("Mod++")}`} onClick={() => canvas?.zoom(1.25)}>
        <Plus size={15} />
      </button>
      <button aria-label={t.work.fit} data-tip={`${t.work.fit} · ${keys("Shift+1")}`} onClick={fit}>
        <Scan size={15} />
      </button>
      {open && (
        <div className={cx("camera-menu")} role="menu">
          {choice(t.work.zoomIn, () => canvas?.zoom(1.25), "Mod++")}
          {choice(t.work.zoomOut, () => canvas?.zoom(1 / 1.25), "Mod+−")}
          <hr />
          {choice(v.actual, () => canvas?.zoomTo(1), "Mod+0")}
          {choice(v.half, () => canvas?.zoomTo(0.5))}
          {choice(v.double, () => canvas?.zoomTo(2))}
          {choice(v.whole, fit, "Shift+1")}
          {choice(v.selection, () => canvas?.frameSelection(), "Shift+2")}
          {board && (
            <>
              <hr />
              {toggle(v.rulers, <Ruler size={15} />, board.rulers, { rulers: !board.rulers })}
              {toggle(v.guides, <Magnet size={15} />, board.guides, { guides: !board.guides })}
              {toggle(v.grid, <Grid3x3 size={15} />, board.grid, { grid: !board.grid })}
              {help && (
                <>
                  <hr />
                  <button
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      help();
                    }}
                  >
                    <Keyboard size={15} />
                    <span>{v.shortcuts}</span>
                    <kbd>?</kbd>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
