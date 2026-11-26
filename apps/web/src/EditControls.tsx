import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Field } from "../../../modules/editing/index.ts";
import type {
  Instance,
  Link,
  Work,
} from "../../../modules/contracts/index.ts";
import type { PictureMaterial } from "@drawy/materials/schema";
import { cx } from "./cx.ts";
import { useT, type Words as Dictionary } from "./i18n.tsx";
import { store, stored } from "./storage.ts";

/* The plain controls a part's values are changed with (words, colours from the work's
 * palette, numbers, pictures), the names fields and options go by, and the panel's
 * folding sections. What a part holds beyond plain values is edited by its schema in
 * EditContent.tsx. */

/** The part a field belongs to: a module, or a link drawn between two. */
export type Part = Instance | Link;
export type PickPicture = (chosen: (m: PictureMaterial) => void) => void;

const COLOR = /^#[0-9a-f]{6}$/i;
/** A colour as the colour picker takes it. */
export const hex = (value: unknown) => {
  if (typeof value !== "string") return "#000000";
  if (COLOR.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value))
    return ("#" + [...value.slice(1)].map((c) => c + c).join("")).toLowerCase();
  // Any other CSS colour, as the page resolves it.
  const probe = document.createElement("i");
  probe.style.color = value;
  document.body.append(probe);
  const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
  probe.remove();
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
};
/** The colours a work is drawn in: its style's, then those its parts set. */
export function palette(work: Work) {
  const tokens = ["ink", "accent", "accent2", "muted"]
    .map((k) => work.style[k])
    .filter((v): v is string => !!v && COLOR.test(hex(v)));
  const used = Object.values(work.scenes).flatMap((s) =>
    [...s.modules, ...s.links].flatMap((p) =>
      Object.values(p.data).filter(
        (v): v is string =>
          typeof v === "string" && /^#[0-9a-f]{3,6}$/i.test(v),
      ),
    ),
  );
  return [...new Set([...tokens, ...used].map(hex))].slice(0, 10);
}
/** A field's name: the author's, the app's for a common key, or the key spelled out. */
export const nameOf = (t: Dictionary, f: Pick<Field, "key" | "label">) =>
  f.label?.[t.locale] ??
  (t.edit.params as Record<string, string>)[f.key] ??
  f.key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
/** An option's name: the schema's, else the app's for a common value, else the value. */
export const optionOf = (t: Dictionary, value: string, f?: Pick<Field, "options">) =>
  f?.options?.find((o) => o.value === value)?.label?.[t.locale] ??
  (t.edit.options as Record<string, string>)[value] ??
  value;
/** The values a choice offers. */
export const valuesOf = (f: Pick<Field, "options">) => (f.options ?? []).map((o) => o.value);

/** Words typed in place: Enter keeps them, Shift+Enter starts a new line. */
export function Words({
  value,
  onChange,
  onDone,
}: {
  value: string;
  onChange: (s: string) => void;
  onDone: (s: string) => void;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Words changed elsewhere show here, unless they are being typed.
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(value);
  }, [value]);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={() => onDone(text)}
    />
  );
}

/** The style tokens a colour can name, so the part follows the work's palette. */
export const swatchTokens = ["ink", "accent", "accent2", "muted", "paper"] as const;
/** What a colour value shows as: a token's colour in the work's style, or itself. */
export const colourOf = (work: Work, value: string) => work.style[value] ?? value;
/** A colour: one of the work's palette (written as its token, so the part follows the style
 * when it changes), the drawing's own default, another the work uses, or any other. */
export function Colors({
  work,
  value,
  auto,
  onChange,
  onDone,
}: {
  work: Work;
  value?: string;
  /** Whether the drawing falls back to the work's style without a colour of its own. */
  auto: boolean;
  onChange: (c: string) => void;
  onDone: (c: string | undefined) => void;
}) {
  const t = useT();
  const tokens = swatchTokens.filter((k) => work.style[k] && COLOR.test(hex(work.style[k])));
  const taken = new Set(tokens.map((k) => hex(work.style[k])));
  const others = palette(work).filter((c) => !taken.has(c));
  const current = value && hex(colourOf(work, value));
  const [custom, setCustom] = useState(current ?? hex(work.style.ink ?? "#000000"));
  return (
    <span className={cx("swatches")}>
      {auto && (
        <button
          className={cx("swatch")}
          data-auto
          aria-label={t.edit.auto}
          data-tip={t.edit.auto}
          aria-pressed={!value}
          onClick={() => onDone(undefined)}
        />
      )}
      {tokens.map((k) => (
        <button
          key={k}
          className={cx("swatch")}
          data-token={k}
          style={{ "--swatch": work.style[k] } as CSSProperties}
          aria-label={t.edit.swatches[k]}
          data-tip={t.edit.swatches[k]}
          aria-pressed={value === k}
          onClick={() => onDone(k)}
        />
      ))}
      {others.map((c) => (
        <button
          key={c}
          className={cx("swatch")}
          style={{ "--swatch": c } as CSSProperties}
          aria-label={c}
          aria-pressed={value !== undefined && !(value in work.style) && current === c}
          onClick={() => onDone(c)}
        />
      ))}
      <Picker
        label={t.edit.custom}
        value={custom}
        pressed={!!current && !!value && !(value in work.style) && !others.includes(current)}
        onChange={(c) => {
          setCustom(c);
          onChange(c);
        }}
        onDone={(c) => current !== c && onDone(c)}
      />
    </span>
  );
}
/** The system's colour picker behind a swatch: each colour tried shows at once, and the
 * one it closes on is kept. */
export function Picker({
  label,
  value,
  pressed,
  plain,
  onChange,
  onDone,
}: {
  label: string;
  value: string;
  pressed?: boolean;
  /** Shows the colour alone, for a colour of the work's own rather than "another". */
  plain?: boolean;
  onChange?: (c: string) => void;
  onDone: (c: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const el = ref.current!;
    const kept = () => done.current(el.value);
    el.addEventListener("change", kept);
    return () => el.removeEventListener("change", kept);
  }, []);
  return (
    <label
      className={cx("swatch")}
      data-custom={!plain || undefined}
      data-tip={label}
      aria-pressed={pressed}
      style={{ "--swatch": value } as CSSProperties}
    >
      <input
        ref={ref}
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  );
}

/** A number on a slider when its range is known, otherwise typed. */
export function Amount({
  field,
  value,
  onChange,
  onDone,
}: {
  field: Field;
  value?: number;
  onChange: (n: number) => void;
  onDone: (n: number) => void;
}) {
  const t = useT();
  const [n, setN] = useState(value);
  const held = useRef(false);
  // A value changed elsewhere shows here, unless this control is being used.
  useEffect(() => {
    if (!held.current) setN(value);
  }, [value]);
  const set = (x: number) => {
    held.current = true;
    setN(x);
    onChange(x);
  };
  const done = () => {
    held.current = false;
    if (n !== undefined && n !== value) onDone(n);
  };
  const ranged = field.min !== undefined && field.max !== undefined;
  const step =
    field.step ?? (ranged && field.max! - field.min! <= 2 ? 0.01 : 1);
  const digits = (String(step).split(".")[1] ?? "").length;
  const shown = n === undefined ? t.edit.auto : n.toFixed(digits);
  return ranged ? (
    <span className={cx("amount")}>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={step}
        value={n ?? field.min}
        style={
          {
            "--progress":
              (((n ?? field.min!) - field.min!) / (field.max! - field.min! || 1)) * 100 + "%",
          } as CSSProperties
        }
        data-auto={n === undefined || undefined}
        onChange={(e) => set(Number(e.target.value))}
        onPointerUp={done}
        onKeyUp={done}
        onBlur={done}
      />
      <output>{shown}</output>
    </span>
  ) : (
    <input
      className={cx("amount-typed")}
      type="number"
      step={step}
      value={n ?? ""}
      placeholder={t.edit.auto}
      onChange={(e) => e.target.value !== "" && set(Number(e.target.value))}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      onBlur={done}
    />
  );
}


const opened = (id: string, fallback: boolean) => {
  const v = stored("drawy.edit." + id);
  return v === null ? fallback : v === "1";
};
/** A part of the editing panel under a heading, folded away until it is wanted; whether
 * it is open is remembered in this browser. */
export function Section({
  id,
  title,
  open: initial = true,
  aside,
  count,
  children,
}: {
  id: string;
  title: string;
  open?: boolean;
  /** How many things the section holds, shown beside its title. */
  count?: number;
  /** Controls beside the heading. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => opened(id, initial));
  return (
    <section className={cx("edit-section")} data-open={open || undefined}>
      <header>
        <button
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            store("drawy.edit." + id, open ? "0" : "1");
          }}
        >
          <ChevronRight size={13} />
          <h3>{title}</h3>
          {!!count && <small>{count}</small>}
        </button>
        {aside}
      </header>
      {open && <div className={cx("edit-section-body")}>{children}</div>}
    </section>
  );
}
