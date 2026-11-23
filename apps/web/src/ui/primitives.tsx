import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./classes.ts";
import { useLocale } from "./locale.tsx";

/** Whether the reader asked for less motion. */
export const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const Closing = createContext(false);
/** True while the surrounding Presence plays its exit animation. */
export const useClosing = () => useContext(Closing);

/** Whether a key belongs to IME input, such as the Enter that confirms it, which some
 * browsers only report through keyCode 229. */
const composing = (e: KeyboardEvent) =>
  e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;

/** Enter sends a prompt and Shift+Enter starts a new line; the Enter that confirms IME
 * input belongs to the IME. */
export const sendsOnEnter = (e: KeyboardEvent<HTMLTextAreaElement>) =>
  e.key === "Enter" && !e.shiftKey && !composing(e);

/** Keeps the last children mounted for an exit animation; reopening mounts a fresh copy. */

export function Presence({
  show,
  ms = 220,
  children,
}: {
  show: boolean;
  ms?: number;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(show);
  const opened = useRef(0),
    was = useRef(show),
    last = useRef<ReactNode>(null);
  if (show && !was.current) opened.current++;
  was.current = show;
  if (show) last.current = children;
  useEffect(() => {
    if (show) {
      setPresent(true);
      return;
    }
    const t = setTimeout(() => setPresent(false), reducedMotion() ? 0 : ms);
    return () => clearTimeout(t);
  }, [show, ms]);
  if (!show && !present) return null;
  return (
    <Closing.Provider value={!show}>
      <Fragment key={opened.current}>{show ? children : last.current}</Fragment>
    </Closing.Provider>
  );
}

/** Segmented control whose selection thumb slides between the active buttons. */
/** An on/off switch. Inside a label, the whole row toggles it. */
export function Switch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className={cx("switch")}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

export function Segmented({
  className = "",
  label,
  children,
}: {
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const place = () => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(
      ':scope > [aria-pressed="true"]',
    );
    el.style.setProperty("--thumb-x", `${active?.offsetLeft ?? 0}px`);
    el.style.setProperty("--thumb-w", `${active?.offsetWidth ?? 0}px`);
    el.dataset.thumb = active ? "on" : "off";
  };
  useLayoutEffect(place);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(place);
    observer.observe(el);
    Array.from(el.children).forEach((c) => observer.observe(c));
    const frame = requestAnimationFrame(() => (el.dataset.ready = ""));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={cx(`segmented ${className}`)}
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** The system activity indicator: eight fading spokes. */
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      className={cx("activity")}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} style={{ "--i": i } as CSSProperties} />
      ))}
    </span>
  );
}

/** Names for controls that show only an icon, given as `data-tip`: one rises under the
 * control a moment after the pointer settles on it, or at once while the pointer moves on
 * from another, and goes with a press, a scroll or the pointer leaving. */
export function Tooltips() {
  const [tip, setTip] = useState<{
    text: string;
    x: number;
    y: number;
    above: boolean;
    /** Beside its control rather than under it: for a column of controls. */
    beside: boolean;
  }>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined,
      current: HTMLElement | null = null,
      shown = false,
      left = -Infinity;
    const hide = () => {
      clearTimeout(timer);
      if (shown) left = performance.now();
      shown = false;
      current = null;
      setTip(undefined);
    };
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text || !el.isConnected) return;
      const r = el.getBoundingClientRect(),
        above = r.bottom + 44 > innerHeight,
        beside = el.dataset.tipSide === "right" && r.right + 200 < innerWidth;
      shown = true;
      setTip(
        beside
          ? { text, x: r.right + 9, y: r.top + r.height / 2, above: false, beside }
          : {
              text,
              x: Math.min(innerWidth - 72, Math.max(72, r.left + r.width / 2)),
              y: above ? r.top - 8 : r.bottom + 8,
              above,
              beside,
            },
      );
    };
    const over = (e: PointerEvent) => {
      // A tip is for a pointer that can rest on a control. A finger only presses, and on
      // iOS a page that shows something new as a press begins takes that press as a
      // hover and drops the tap that should follow.
      if (e.pointerType !== "mouse") return hide();
      const el =
        (e.target as Element).closest?.<HTMLElement>("[data-tip]") ?? null;
      if (el === current) return;
      if (!el) return hide();
      clearTimeout(timer);
      if (shown) left = performance.now();
      shown = false;
      current = el;
      setTip(undefined);
      timer = setTimeout(
        () => current === el && show(el),
        performance.now() - left < 600 ? 0 : 420,
      );
    };
    addEventListener("pointerover", over, true);
    addEventListener("pointerdown", hide, true);
    addEventListener("scroll", hide, true);
    addEventListener("blur", hide);
    return () => {
      clearTimeout(timer);
      removeEventListener("pointerover", over, true);
      removeEventListener("pointerdown", hide, true);
      removeEventListener("scroll", hide, true);
      removeEventListener("blur", hide);
    };
  }, []);
  return tip
    ? createPortal(
        <div
          className={cx("tooltip")}
          role="tooltip"
          data-above={tip.above || undefined}
          data-beside={tip.beside || undefined}
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>,
        document.body,
      )
    : null;
}

/** A deletion notice with an undo action. */
export function UndoToast({
  text,
  onUndo,
}: {
  text: string;
  onUndo: () => void;
}) {
  const closing = useClosing(),
    locale = useLocale();
  return (
    <div className={cx(`toast undo${closing ? " closing" : ""}`)} role="status">
      <span>{text}</span>
      <button onClick={onUndo}>{locale === "zh" ? "撤销" : "Undo"}</button>
    </div>
  );
}
