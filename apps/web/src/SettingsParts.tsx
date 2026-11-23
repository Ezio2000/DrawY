/* The pieces every settings page is made of: a row per setting, settings grouped on a
 * card, a section's head, and lists of things that open to their own settings. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx.ts";
import { Spinner } from "./ui/primitives.tsx";

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
  tone?: "accent" | "muted" | "warn";
}) => (
  <span className={cx("badge")} data-tone={tone}>
    {children}
  </span>
);

/** What the settings pages last read from the server, by name: a page opened again shows
 * it at once while it is read afresh, and what was read ahead (`read`) is there when the
 * page opens. */
const kept = new Map<string, unknown>();
const reading = new Map<string, Promise<unknown>>();

export const keptValue = <T,>(key: string) => kept.get(key) as T | undefined;
export const keep = (key: string, value: unknown) => void kept.set(key, value);
/** Lets go of everything kept, as the account signs out. */
export const forgetSettings = () => kept.clear();

/** Reads a value afresh and keeps it; a read already on its way is shared. */
export function read<T>(key: string, load: () => Promise<T>): Promise<T> {
  let on = reading.get(key) as Promise<T> | undefined;
  if (!on) {
    on = load()
      .then((v) => (kept.set(key, v), v))
      .finally(() => reading.delete(key));
    reading.set(key, on);
  }
  return on;
}

/** What a section reads from the server once it opens, kept under `key`: what was kept at
 * once and then the value read afresh, a way to change it in place, the last error, and
 * `attempt`, which runs a change and reports its error the same way. */
export function useLoaded<T>(key: string, load: () => Promise<T>) {
  const [value, setValue] = useState(() => keptValue<T>(key)),
    [error, setError] = useState("");
  // A change made here before the fresh value arrives is newer than it.
  const changed = useRef(false);
  useEffect(() => {
    void read(key, load).then(
      (v) => changed.current || setValue(v),
      (e: Error) => setError(e.message),
    );
  }, []);
  const update = (change: (value: T) => T) =>
    setValue((old) => {
      if (old === undefined) return old;
      changed.current = true;
      const next = change(old);
      kept.set(key, next);
      return next;
    });
  const attempt = async (change: () => Promise<void>) => {
    setError("");
    try {
      await change();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return { value, update, error, attempt };
}

/** A section's error, then what it shows once that has arrived; a spinner until then. */
export function Loaded<T>({
  value,
  error,
  children,
}: {
  value: T | undefined;
  error: string;
  children: (value: T) => ReactNode;
}) {
  return (
    <>
      {error && (
        <p className={cx("error")} role="alert">
          {error}
        </p>
      )}
      {value === undefined ? !error && <Spinner /> : children(value)}
    </>
  );
}
