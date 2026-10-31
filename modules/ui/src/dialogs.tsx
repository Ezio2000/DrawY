import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useClosing } from "./primitives.tsx";
import { cx } from "./cx.ts";
import { useWords } from "./locale.tsx";
import { words } from "./words.ts";

/** Desktop dialog, closed by its button, backdrop or Escape. */
export function Dialog({
  title,
  heading,
  description,
  children,
  footer,
  onClose,
  wide = false,
}: {
  title: string;
  /** Shown in place of the title text, such as a lettered title; the title still names
   * the dialog. */
  heading?: ReactNode;
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
        <header className={cx("dialog-header")}>
          <div>
            <h2>{heading ?? title}</h2>
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
