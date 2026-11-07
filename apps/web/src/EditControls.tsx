import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ArrowDown, ArrowUp, ChevronRight, Plus, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { Switch } from "@drawy/ui";
import type { Canvas } from "../../../modules/canvas/index.ts";
import {
  fieldsOf,
  restOf,
  setData,
  type Field,
} from "../../../modules/editing/index.ts";
import type {
  Instance,
  Link,
  Work,
} from "../../../modules/contracts/index.ts";
import type { PictureMaterial } from "@drawy/materials/schema";
import type { Change } from "./handEdits.ts";
import { cx } from "./cx.ts";
import { useT, type Words as Dictionary } from "./i18n.tsx";

/* The controls a part's values are changed with: plain controls for words, pictures,
 * choices, colours, numbers and switches, and a data editor for everything else a part
 * holds (lists, tables, records), so whatever the author can write in a part's data a
 * person can change too. */

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
export const nameOf = (t: Dictionary, f: Field) =>
  f.label ??
  (t.edit.params as Record<string, string>)[f.key] ??
  f.key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
export const optionOf = (t: Dictionary, value: string) =>
  (t.edit.options as Record<string, string>)[value] ?? value;

/** The values of one module or link, each in the control its kind takes. Changes show on
 * the canvas as they are made and are kept when they are done: words when the field is
 * left, a slider when it is let go, everything else at once. The controls stay as they
 * are while the work is saved under them, so typing goes on from field to field; a value
 * changed elsewhere (an undo) shows in any control not being used. */
export function Fields({
  work,
  sceneId,
  part,
  canvas,
  change,
  pickPicture,
}: {
  work: Work;
  sceneId: string;
  part: Part;
  canvas?: Canvas;
  change: Change;
  pickPicture: PickPicture;
}) {
  const t = useT();
  const fields = fieldsOf(work, part);
  // Values changed but not yet kept, shown on the canvas meanwhile.
  const draft = useRef<Record<string, unknown>>({});
  const [, redraw] = useState(0);
  const show = (key: string, value: unknown) => {
    draft.current = { ...draft.current, [key]: value };
    redraw((n) => n + 1);
    canvas?.preview(part.id, { ...part.data, ...draft.current });
  };
  const keep = (patch: Record<string, unknown>, pictures: string[] = []) => {
    const changed = Object.entries(patch).some(([k, v]) => part.data[k] !== v);
    draft.current = {};
    if (changed)
      void change((w) => setData(w, sceneId, part.id, patch, pictures));
  };
  // Words still being typed are kept when the panel moves on to something else.
  const pending = useRef(keep);
  pending.current = keep;
  useEffect(
    () => () => {
      const left = Object.entries(draft.current).filter(
        ([k]) => fields.find((f) => f.key === k)?.type === "text",
      );
      if (left.length) pending.current(Object.fromEntries(left));
    },
    [],
  );
  if (!fields.length)
    return <p className={cx("edit-note")}>{t.edit.nothing}</p>;
  const value = (f: Field) =>
    f.key in draft.current ? draft.current[f.key] : f.value;
  return (
    <div className={cx("fields")}>
      {fields.map((f) => {
        const v = value(f);
        const reset = f.optional && f.set && (
          <button
            className={cx("field-reset")}
            aria-label={t.edit.reset}
            data-tip={t.edit.reset}
            onClick={() => keep({ [f.key]: undefined })}
          >
            <RotateCcw size={13} />
          </button>
        );
        const head = (
          <span className={cx("field-name")}>
            {nameOf(t, f)}
            {reset}
          </span>
        );
        switch (f.type) {
          case "text":
            return (
              <label key={f.key} className={cx("field")}>
                {head}
                <Words
                  value={String(v ?? "")}
                  onChange={(s) => show(f.key, s)}
                  onDone={(s) => keep({ [f.key]: s })}
                />
              </label>
            );
          case "picture": {
            const picture =
              typeof v === "string" ? work.materials[v] : undefined;
            return (
              <div key={f.key} className={cx("field")}>
                {head}
                <button
                  className={cx("field-picture")}
                  onClick={() =>
                    pickPicture((m) => keep({ [f.key]: m.id }, [m.id]))
                  }
                >
                  {picture?.kind === "picture" && (
                    <img src={picture.url} alt={picture.name} />
                  )}
                  <span>{t.edit.replacePicture}</span>
                </button>
              </div>
            );
          }
          case "choice":
            // A few choices side by side; many in a list.
            return f.options!.length > 5 ? (
              <label key={f.key} className={cx("field")} data-inline>
                {head}
                <select
                  className={cx("edit-select")}
                  data-short
                  value={String(v ?? "")}
                  onChange={(e) => keep({ [f.key]: e.target.value })}
                >
                  {!f.options!.includes(String(v)) && <option value={String(v ?? "")}>{String(v ?? "—")}</option>}
                  {f.options!.map((o) => (
                    <option key={o} value={o}>
                      {optionOf(t, o)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div key={f.key} className={cx("field")}>
                {head}
                <span className={cx("field-choice")} role="group">
                  {f.options!.map((o) => (
                    <button
                      key={o}
                      aria-pressed={v === o}
                      onClick={() => v !== o && keep({ [f.key]: o })}
                    >
                      {optionOf(t, o)}
                    </button>
                  ))}
                </span>
              </div>
            );
          case "color":
            return (
              <div key={f.key} className={cx("field")}>
                {head}
                <Colors
                  work={work}
                  value={typeof v === "string" ? v : undefined}
                  auto={f.optional}
                  onChange={(c) => show(f.key, c)}
                  onDone={(c) => keep({ [f.key]: c })}
                />
              </div>
            );
          case "number":
            return (
              <label
                key={f.key}
                className={cx("field")}
                data-inline={f.min === undefined || f.max === undefined || undefined}
              >
                {head}
                <Amount
                  field={f}
                  value={typeof v === "number" ? v : undefined}
                  onChange={(n) => show(f.key, n)}
                  onDone={(n) => keep({ [f.key]: n })}
                />
              </label>
            );
          case "boolean":
            return (
              <div key={f.key} className={cx("field")} data-inline>
                {head}
                <Switch
                  checked={!!v}
                  onChange={(on) => keep({ [f.key]: on })}
                />
              </div>
            );
        }
      })}
    </div>
  );
}

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

/** A colour from the work's own palette, the style's default, or any other. */
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
  const colours = palette(work);
  const current = value && hex(value);
  const [custom, setCustom] = useState(current ?? colours[0] ?? "#000000");
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
      {colours.map((c) => (
        <button
          key={c}
          className={cx("swatch")}
          style={{ "--swatch": c } as CSSProperties}
          aria-label={c}
          aria-pressed={current === c}
          onClick={() => onDone(c)}
        />
      ))}
      <Picker
        label={t.edit.custom}
        value={custom}
        pressed={!!current && !colours.includes(current)}
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


type Path = (string | number)[];
function setAt(v: unknown, path: Path, value: unknown): unknown {
  if (!path.length) return value;
  const [k, ...rest] = path;
  if (Array.isArray(v)) return v.with(k as number, setAt(v[k as number], rest, value));
  return { ...(v as object), [k]: setAt((v as any)?.[k], rest, value) };
}
/** A value of the same shape as another, emptied: what a new entry in a list starts as
 * when there is nothing to copy. */
function blank(like: unknown): unknown {
  if (typeof like === "string") return "";
  if (typeof like === "number") return 0;
  if (typeof like === "boolean") return false;
  if (Array.isArray(like)) return [];
  if (like && typeof like === "object")
    return Object.fromEntries(Object.entries(like).map(([k, v]) => [k, blank(v)]));
  return "";
}
const COLOUR = /^#[0-9a-f]{3,8}$/i;
/** The entries of a part's data that no plain control shows (lists, records and the
 * like), each opened as a tree: every value in it can be changed, entries of a list
 * added (a copy of the last), moved and taken out, and entries of a record added and
 * taken out. Changes show at once and are kept when a value is left. */
export function DataEditor({
  work,
  sceneId,
  part,
  canvas,
  change,
  pickPicture,
}: {
  work: Work;
  sceneId: string;
  part: Part;
  canvas?: Canvas;
  change: Change;
  pickPicture: PickPicture;
}) {
  const t = useT();
  const keys = restOf(work, part);
  if (!keys.length) return null;
  return (
    <div className={cx("fields")}>
      {keys.map((key) => (
        <DataEntry
          key={part.id + ":" + key}
          name={nameOf(t, { key } as Field)}
          value={part.data[key]}
          work={work}
          preview={(v) => canvas?.preview(part.id, { ...part.data, [key]: v })}
          commit={(v) =>
            void change((w) => setData(w, sceneId, part.id, { [key]: v }))
          }
          pickPicture={pickPicture}
        />
      ))}
    </div>
  );
}
function DataEntry({
  name,
  value: initial,
  work,
  preview,
  commit,
  pickPicture,
}: {
  name: string;
  value: unknown;
  work: Work;
  preview: (v: unknown) => void;
  commit: (v: unknown) => void;
  pickPicture: PickPicture;
}) {
  const [value, setValue] = useState(initial);
  const latest = useRef(value);
  // What was last kept, so leaving a value commits it only when it changed.
  const saved = useRef(initial);
  // Each time the entry is changed elsewhere (an undo, the author), its controls start
  // again from it; what this editor kept itself coming back changes nothing.
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (JSON.stringify(initial) === JSON.stringify(saved.current)) return;
    saved.current = latest.current = initial;
    setValue(initial);
    setEpoch((n) => n + 1);
  }, [initial]);
  const set = (path: Path, v: unknown, keep: boolean) => {
    const next = setAt(latest.current, path, v);
    latest.current = next;
    setValue(next);
    preview(next);
    if (keep && JSON.stringify(next) !== JSON.stringify(saved.current)) {
      saved.current = next;
      commit(next);
    }
  };
  return (
    <div className={cx("field")}>
      <span className={cx("field-name")}>{name}</span>
      <div className={cx("tree")}>
        <Node
          key={epoch}
          value={value}
          path={[]}
          depth={0}
          work={work}
          set={set}
          pickPicture={pickPicture}
        />
      </div>
    </div>
  );
}
function Node({
  value,
  path,
  depth,
  work,
  set,
  pickPicture,
}: {
  value: unknown;
  path: Path;
  depth: number;
  work: Work;
  set: (path: Path, v: unknown, keep: boolean) => void;
  pickPicture: PickPicture;
}) {
  const t = useT();
  if (Array.isArray(value))
    return (
      <div className={cx("tree-list")}>
        {value.map((item, i) => (
          <div key={i} className={cx("tree-item")}>
            <div className={cx("tree-item-head")}>
              <span>{i + 1}</span>
              <button
                aria-label={t.edit.data.up}
                data-tip={t.edit.data.up}
                disabled={i === 0}
                onClick={() => {
                  const next = [...value];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  set(path, next, true);
                }}
              >
                <ArrowUp size={12} />
              </button>
              <button
                aria-label={t.edit.data.down}
                data-tip={t.edit.data.down}
                disabled={i === value.length - 1}
                onClick={() => {
                  const next = [...value];
                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                  set(path, next, true);
                }}
              >
                <ArrowDown size={12} />
              </button>
              <button
                aria-label={t.edit.data.remove}
                data-tip={t.edit.data.remove}
                data-tone="danger"
                onClick={() =>
                  set(
                    path,
                    value.filter((_, j) => j !== i),
                    true,
                  )
                }
              >
                <X size={12} />
              </button>
            </div>
            <Node
              value={item}
              path={[...path, i]}
              depth={depth + 1}
              work={work}
              set={set}
              pickPicture={pickPicture}
            />
          </div>
        ))}
        <button
          className={cx("tree-add")}
          onClick={() =>
            set(
              path,
              [...value, value.length ? structuredClone(value.at(-1)) : ""],
              true,
            )
          }
        >
          <Plus size={13} />
          {t.edit.data.addItem}
        </button>
      </div>
    );
  if (value && typeof value === "object")
    return (
      <div className={cx("tree-record")}>
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className={cx("tree-entry")} data-flat={typeof v !== "object" || v === null || undefined}>
            <span className={cx("tree-key")}>
              {k}
              <button
                aria-label={t.edit.data.remove}
                data-tip={t.edit.data.remove}
                data-tone="danger"
                onClick={() => {
                  const { [k]: _, ...rest } = value as Record<string, unknown>;
                  set(path, rest, true);
                }}
              >
                <X size={11} />
              </button>
            </span>
            <Node
              value={v}
              path={[...path, k]}
              depth={depth + 1}
              work={work}
              set={set}
              pickPicture={pickPicture}
            />
          </div>
        ))}
        <NewKey
          add={(k) =>
            set(
              path,
              {
                ...(value as object),
                [k]: blank(Object.values(value).find((v) => typeof v !== "object") ?? ""),
              },
              true,
            )
          }
        />
      </div>
    );
  if (typeof value === "boolean")
    return <Switch checked={value} onChange={(on) => set(path, on, true)} />;
  if (typeof value === "number")
    return (
      <input
        className={cx("tree-value")}
        type="number"
        defaultValue={value}
        onChange={(e) =>
          e.target.value !== "" && set(path, Number(e.target.value), false)
        }
        onBlur={(e) =>
          e.target.value !== "" && set(path, Number(e.target.value), true)
        }
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    );
  if (typeof value === "string" && work.materials[value]?.kind === "picture") {
    const p = work.materials[value];
    return (
      <button
        className={cx("field-picture")}
        data-small
        onClick={() => pickPicture((m) => set(path, m.id, true))}
      >
        {p.kind === "picture" && <img src={p.url} alt={p.name} />}
        <span>{t.edit.replacePicture}</span>
      </button>
    );
  }
  if (typeof value === "string" && COLOUR.test(value))
    return (
      <span className={cx("tree-colour")}>
        <Picker
          plain
          label={value}
          value={hex(value)}
          onChange={(c) => set(path, c, false)}
          onDone={(c) => set(path, c, true)}
        />
        <code>{value}</code>
      </span>
    );
  if (value === null || value === undefined)
    return (
      <input
        className={cx("tree-value")}
        placeholder="—"
        onBlur={(e) => e.target.value && set(path, e.target.value, true)}
      />
    );
  return (
    <Words
      value={String(value)}
      onChange={(s) => set(path, s, false)}
      onDone={(s) => set(path, s, true)}
    />
  );
}
/** A new entry for a record, by the name it is written under. */
function NewKey({ add }: { add: (key: string) => void }) {
  const t = useT();
  const [key, setKey] = useState("");
  return (
    <span className={cx("tree-new")}>
      <input
        value={key}
        placeholder={t.edit.data.newKey}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && key.trim()) {
            add(key.trim());
            setKey("");
          }
        }}
      />
      <button
        aria-label={t.edit.data.addKey}
        data-tip={t.edit.data.addKey}
        disabled={!key.trim()}
        onClick={() => {
          add(key.trim());
          setKey("");
        }}
      >
        <Plus size={13} />
      </button>
    </span>
  );
}

const opened = (id: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem("drawy.edit." + id);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
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
  const [open, setOpen] = useState(() => opened(id, initial)),
    // Opened by a press just now: what it holds comes down into place, once.
    [opening, setOpening] = useState(false);
  return (
    <section className={cx("edit-section")} data-open={open || undefined}>
      <header>
        <button
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            setOpening(!open);
            try {
              localStorage.setItem("drawy.edit." + id, open ? "0" : "1");
            } catch {}
          }}
        >
          <ChevronRight size={13} />
          <h3>{title}</h3>
          {!!count && <small>{count}</small>}
        </button>
        {aside}
      </header>
      {open && (
        <div
          className={cx("edit-section-body")}
          data-opening={opening || undefined}
          onAnimationEnd={(e) => e.target === e.currentTarget && setOpening(false)}
        >
          {children}
        </div>
      )}
    </section>
  );
}
