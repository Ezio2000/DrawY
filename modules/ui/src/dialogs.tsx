import { useEffect, useRef, type ReactNode } from "react";
import {
  Check,
  Hand,
  MoveVertical,
  ShieldCheck,
  Touchpad,
  X,
} from "lucide-react";
import {
  presetOf,
  PRESETS,
  REACHES,
  setGestures,
  useGestures,
  useSwipeDismiss,
  type Gestures,
  type PresetId,
  type Reach,
  type ScrollMode,
} from "./gesture.ts";
import { Segmented, Switch, useClosing } from "./primitives.tsx";
import { cx } from "./cx.ts";
import { useWords } from "./locale.tsx";
import { words } from "./words.ts";

/** A sheet over the page. Pulling it down from its top, by its grabber or header or
 * with the trackpad, dismisses it. */
export function Dialog({
  title,
  description,
  children,
  footer,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const closing = useClosing(),
    w = useWords(words);
  const panel = useRef<HTMLElement>(null),
    overlay = useRef<HTMLDivElement>(null);
  useSwipeDismiss(panel, "bottom", closing ? undefined : onClose, {
    vars: overlay,
  });
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (closing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [closing]);
  return (
    <div
      ref={overlay}
      className={cx(`dialog-overlay${closing ? " closing" : ""}`)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !closing) onClose();
      }}
    >
      <section
        ref={panel}
        tabIndex={-1}
        className={cx(`dialog${wide ? " wide" : ""}`)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className={cx("dialog-header")} data-swipe-handle>
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className={cx("close-button")}
            aria-label={w.close}
            onClick={onClose}
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        </header>
        {children && <div className={cx("dialog-body")}>{children}</div>}
        {footer && <footer className={cx("dialog-footer")}>{footer}</footer>}
      </section>
    </div>
  );
}

const PRESET_ICONS: Record<PresetId, ReactNode> = {
  trackpad: <Touchpad size={19} />,
  drag: <Hand size={19} />,
  scroll: <MoveVertical size={19} />,
  steady: <ShieldCheck size={19} />,
};
const SCROLLS: ScrollMode[] = ["auto", "pan", "zoom"];
const REACH_NAMES: Reach[] = ["short", "standard", "long"];
const percent = (n: number) => `${Math.round(n * 100)}%`;

function Choice({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("gesture-option")}>
      <span>
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
      {children}
    </div>
  );
}
function Toggle({
  title,
  note,
  checked,
  onChange,
}: {
  title: string;
  note: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cx("gesture-option")}>
      <span>
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
      <Switch checked={checked} onChange={onChange} />
    </label>
  );
}

/** Gesture preferences for this device: a preset close to how someone steers, then the
 * individual choices. Every change applies at once. */
export function GestureDialog({ onClose }: { onClose: () => void }) {
  const w = useWords(words),
    g = useGestures(),
    preset = presetOf(g),
    r = REACHES[g.reach];
  const set = (patch: Partial<Gestures>) => setGestures({ ...g, ...patch });
  return (
    <Dialog
      title={w.gestures}
      onClose={onClose}
      footer={
        <>
          <span className={cx("footer-note")}>
            {w.current(preset ? w.presets[preset.id][0] : w.custom)}
          </span>
          <button className={cx("primary")} onClick={onClose}>
            {w.done}
          </button>
        </>
      }
    >
      <div
        className={cx("gesture-presets")}
        role="radiogroup"
        aria-label={w.preset}
      >
        {PRESETS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={preset?.id === p.id}
            onClick={() => setGestures(p.gestures)}
          >
            <span className={cx("tile")}>{PRESET_ICONS[p.id]}</span>
            <span>
              <strong>{w.presets[p.id][0]}</strong>
              <small>{w.presets[p.id][1]}</small>
            </span>
            <Check
              className={cx("gesture-check")}
              size={15}
              strokeWidth={2.6}
            />
          </button>
        ))}
      </div>
      <h4 className={cx("section-label")}>{w.canvas}</h4>
      <div className={cx("gesture-group")}>
        <Choice title={w.swipeAndWheel} note={w.scrolls[g.scroll][1]}>
          <Segmented label={w.swipeAndWheel}>
            {SCROLLS.map((value) => (
              <button
                key={value}
                aria-pressed={g.scroll === value}
                onClick={() => set({ scroll: value })}
              >
                {w.scrolls[value][0]}
              </button>
            ))}
          </Segmented>
        </Choice>
        <Choice
          title={w.zoomDirection}
          note={g.scroll === "pan" ? w.zoomDirectionIdle : w.zoomDirectionNote}
        >
          <Segmented label={w.zoomDirection}>
            <button
              aria-pressed={!g.invertZoom}
              disabled={g.scroll === "pan"}
              onClick={() => set({ invertZoom: false })}
            >
              {w.standard}
            </button>
            <button
              aria-pressed={g.invertZoom}
              disabled={g.scroll === "pan"}
              onClick={() => set({ invertZoom: true })}
            >
              {w.reversed}
            </button>
          </Segmented>
        </Choice>
        <Toggle
          title={w.levels}
          note={w.levelsNote}
          checked={g.levels}
          onChange={(levels) => set({ levels })}
        />
        <Toggle
          title={w.inertia}
          note={w.inertiaNote}
          checked={g.inertia}
          onChange={(inertia) => set({ inertia })}
        />
      </div>
      <h4 className={cx("section-label")}>{w.reach}</h4>
      <div className={cx("gesture-group")}>
        <Choice
          title={w.reachTitle}
          note={w.reachNote(r.enter, percent(r.back), r.swipeMax, r.pull)}
        >
          <Segmented label={w.reach}>
            {REACH_NAMES.map((value) => (
              <button
                key={value}
                aria-pressed={g.reach === value}
                onClick={() => set({ reach: value })}
              >
                {w.reaches[value]}
              </button>
            ))}
          </Segmented>
        </Choice>
        <Toggle
          title={w.flick}
          note={w.flickNote}
          checked={g.flick}
          onChange={(flick) => set({ flick })}
        />
      </div>
      <h4 className={cx("section-label")}>{w.cards}</h4>
      <div className={cx("gesture-group")}>
        <Toggle
          title={w.cardSwipes}
          note={w.cardSwipesNote}
          checked={g.cardSwipes}
          onChange={(cardSwipes) => set({ cardSwipes })}
        />
        <Toggle
          title={w.pointerDrag}
          note={w.pointerDragNote}
          checked={g.pointerDrag}
          onChange={(pointerDrag) => set({ pointerDrag })}
        />
        <Toggle
          title={w.sheetSwipes}
          note={w.sheetSwipesNote}
          checked={g.sheetSwipes}
          onChange={(sheetSwipes) => set({ sheetSwipes })}
        />
      </div>
    </Dialog>
  );
}
