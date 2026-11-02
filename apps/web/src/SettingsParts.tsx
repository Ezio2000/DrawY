/* The pieces every settings page is made of: a row per setting, settings grouped on a
 * card, a section's head, and lists of things that open to their own settings. */
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx.ts";

export const newId = (prefix: string) => prefix + "-" + crypto.randomUUID().slice(0, 8);

/** One setting: what it is and why it matters on the left, its control on the right. */
export function Row({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cx("setting")} data-wide={wide || undefined}>
      <div>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** A section's title and what it is for, with its one action on the right. */
export function Head({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <header className={cx("section-head")}>
      <div>
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      {children}
    </header>
  );
}

/** Settings that belong together, under a small label, on one card. */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className={cx("group")}>
      {title && <h3>{title}</h3>}
      <div className={cx("group-card")}>{children}</div>
    </div>
  );
}

/** One thing in a list (a model, a role): its summary as a row, its settings opened
 * beneath it. */
export function Entry({
  icon,
  title,
  detail,
  badges,
  aside,
  open,
  toggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  badges?: ReactNode;
  aside?: ReactNode;
  open: boolean;
  toggle: () => void;
  children: ReactNode;
}) {
  return (
    <li className={cx("entry")} data-open={open || undefined}>
      <button className={cx("entry-row")} aria-expanded={open} onClick={toggle}>
        <span className={cx("entry-icon")}>{icon}</span>
        <span className={cx("entry-text")}>
          <span>
            <b>{title}</b>
            {badges}
          </span>
          <small>{detail}</small>
        </span>
        {aside && <span className={cx("entry-aside")}>{aside}</span>}
        <ChevronDown size={16} className={cx("entry-chevron")} />
      </button>
      {open && <div className={cx("entry-body")}>{children}</div>}
    </li>
  );
}

export const Badge = ({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "accent" | "muted";
}) => (
  <span className={cx("badge")} data-tone={tone}>
    {children}
  </span>
);
