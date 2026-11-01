import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  BringToFront,
  ChevronRight,
  Copy,
  ImagePlus,
  MousePointerClick,
  RotateCcw,
  SendToBack,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import { Switch } from "@drawy/ui";
import type { Canvas, Pointed } from "../../../modules/canvas/index.ts";
import {
  fieldsOf,
  setData,
  setStyle,
  type Field,
} from "../../../modules/editing/index.ts";
import type {
  Instance,
  Link,
  Work,
  WorkEdit,
} from "../../../modules/contracts/index.ts";
import type { PictureMaterial } from "@drawy/materials/schema";
import { cx } from "./cx.ts";
import { useT, type Words } from "./i18n.tsx";

/** Commits a hand edit made from the latest work; resolves to whether there was one. */
export type Change = (
  make: (work: Work) => WorkEdit | null,
) => Promise<boolean>;
/** The part a field belongs to: a module, or a link drawn between two. */
type Part = Instance | Link;

const COLOR = /^#[0-9a-f]{6}$/i;
/** A colour as the colour picker takes it. */
const hex = (value: unknown) => {
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
function palette(work: Work) {
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
const nameOf = (t: Words, f: Field) =>
  f.label ??
  (t.edit.params as Record<string, string>)[f.key] ??
  f.key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
const optionOf = (t: Words, value: string) =>
  (t.edit.options as Record<string, string>)[value] ?? value;

/** The editing panel beside the canvas. With nothing selected it says how editing works,
 * adds words and pictures and sets the work's colours and type; with modules selected it
 * shows what can be changed about them, in plain controls. */
export function EditPanel({
  work,
  sceneId,
  selected,
  canvas,
  busy,
  change,
  add,
  duplicate,
  remove,
  arrange,
  pickPicture,
  ask,
}: {
  work: Work;
  sceneId: string;
  selected: string[];
  canvas?: Canvas;
  /** Why the work cannot be edited right now, if it cannot. */
  busy?: string;
  change: Change;
  add: (kind: "text" | "picture") => void;
  duplicate: () => void;
  remove: () => void;
  arrange: (to: "front" | "back") => void;
  pickPicture: (chosen: (m: PictureMaterial) => void) => void;
  ask: () => void;
}) {
  const t = useT();
  const scene = work.scenes[sceneId];
  const modules = selected.flatMap((id) => {
    const m = scene?.modules.find((x) => x.id === id);
    return m ? [m] : [];
  });
  if (busy || !scene) return <p className={cx("edit-note")}>{busy}</p>;
  if (!modules.length)
    return (
      <div className={cx("edit")}>
        <p className={cx("edit-note")}>
          <MousePointerClick size={15} />
          {t.edit.howTo}
        </p>
        <section>
          <h3>{t.edit.add}</h3>
          <div className={cx("edit-adds")}>
            <button className={cx("secondary")} onClick={() => add("text")}>
              <Type size={16} />
              {t.edit.addText}
            </button>
            <button className={cx("secondary")} onClick={() => add("picture")}>
              <ImagePlus size={16} />
              {t.edit.addPicture}
            </button>
          </div>
        </section>
        <Look work={work} change={change} />
      </div>
    );
  const one = modules.length === 1 ? modules[0] : undefined;
  const links = one
    ? scene.links.filter(
        (l) => l.from.moduleId === one.id || l.to.moduleId === one.id,
      )
    : [];
  return (
    <div className={cx("edit")}>
      <header className={cx("edit-head")}>
        <h3>
          {one ? one.label || t.edit.untitled : t.edit.many(modules.length)}
        </h3>
        <nav className={cx("edit-actions")}>
          <button data-tip={t.edit.duplicate} onClick={duplicate}>
            <Copy size={15} />
            {t.edit.actions.duplicate}
          </button>
          <button data-tip={t.edit.front} onClick={() => arrange("front")}>
            <BringToFront size={15} />
            {t.edit.actions.front}
          </button>
          <button data-tip={t.edit.back} onClick={() => arrange("back")}>
            <SendToBack size={15} />
            {t.edit.actions.back}
          </button>
          <button data-tip={t.edit.remove} data-tone="danger" onClick={remove}>
            <Trash2 size={15} />
            {t.edit.actions.remove}
          </button>
        </nav>
      </header>
      {one && (
        <Fields
          key={one.id + ":" + work.revision}
          work={work}
          sceneId={sceneId}
          part={one}
          canvas={canvas}
          change={change}
          pickPicture={pickPicture}
        />
      )}
      {!!links.length && (
        <section>
          <h3>{t.edit.links}</h3>
          {links.map((l) => (
            <Connection
              key={l.id}
              work={work}
              sceneId={sceneId}
              link={l}
              from={one!.id}
              change={change}
              pickPicture={pickPicture}
            />
          ))}
        </section>
      )}
      <p className={cx("edit-note")}>{one ? t.edit.tipOne : t.edit.tipMany}</p>
      <button className={cx("edit-ask")} onClick={ask}>
        <Sparkles size={15} />
        {t.edit.ask}
      </button>
    </div>
  );
}

/** The values of one module or link, each in the control its kind takes. Changes show on
 * the canvas as they are made and are kept when they are done: words when the field is
 * left, a slider when it is let go, everything else at once. */
function Fields({
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
  pickPicture: (chosen: (m: PictureMaterial) => void) => void;
}) {
  const t = useT();
  const fields = fieldsOf(work, part);
  // Values changed but not yet kept, shown on the canvas meanwhile.
  const draft = useRef<Record<string, unknown>>({});
  const [, redraw] = useState(0);
  const isModule = "bounds" in part;
  const show = (key: string, value: unknown) => {
    draft.current = { ...draft.current, [key]: value };
    redraw((n) => n + 1);
    if (isModule) canvas?.preview(part.id, { ...part.data, ...draft.current });
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
            return (
              <div key={f.key} className={cx("field")}>
                {head}
                <span className={cx("field-choice")} role="group">
                  {f.options!.map((o) => (
                    <button
                      key={o}
                      aria-pressed={v === o}
                      onClick={() => keep({ [f.key]: o })}
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
              <label key={f.key} className={cx("field")}>
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
function Words({
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
function Colors({
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
function Picker({
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
function Amount({
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
  const set = (x: number) => {
    setN(x);
    onChange(x);
  };
  const done = () => n !== undefined && n !== value && onDone(n);
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

/** A link of the selected module: where it goes, what can be changed about it, and a way
 * to take it out. */
function Connection({
  work,
  sceneId,
  link,
  from,
  change,
  pickPicture,
}: {
  work: Work;
  sceneId: string;
  link: Link;
  from: string;
  change: Change;
  pickPicture: (chosen: (m: PictureMaterial) => void) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const scene = work.scenes[sceneId];
  const other = link.from.moduleId === from ? link.to : link.from;
  const name =
    scene.modules.find((m) => m.id === other.moduleId)?.label || other.moduleId;
  return (
    <div className={cx("connection")} data-open={open || undefined}>
      <div className={cx("connection-head")}>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRight size={14} />
          <span>
            {link.from.moduleId === from ? t.edit.to(name) : t.edit.from(name)}
          </span>
        </button>
        <button
          aria-label={t.edit.removeLink}
          data-tip={t.edit.removeLink}
          data-tone="danger"
          onClick={() =>
            void change((w) => {
              const s = w.scenes[sceneId];
              return {
                baseRevision: w.revision,
                scenes: [
                  { ...s, links: s.links.filter((l) => l.id !== link.id) },
                ],
              };
            })
          }
        >
          <Trash2 size={14} />
        </button>
      </div>
      {open && (
        <Fields
          key={work.revision}
          work={work}
          sceneId={sceneId}
          part={link}
          change={change}
          pickPicture={pickPicture}
        />
      )}
    </div>
  );
}

/** Families of type a work can be set in, by what they look like. */
const faces = {
  sans: '"PingFang SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",system-ui,sans-serif',
  serif: '"Songti SC","Noto Serif CJK SC","Source Han Serif SC",serif',
  kai: '"Kaiti SC","STKaiti","AR PL UKai CN","KaiTi",serif',
} as const;
const faceOf = (font = "") =>
  /kai/i.test(font)
    ? "kai"
    : /song|serif/i.test(font) && !/sans/i.test(font)
      ? "serif"
      : "sans";
/** The work's own look, which every part takes unless it sets its own: its colours and
 * its type. */
function Look({ work, change }: { work: Work; change: Change }) {
  const t = useT();
  const tokens = (["ink", "accent", "accent2", "muted"] as const).filter(
    (k) => work.style[k],
  );
  const face = faceOf(work.style.font);
  return (
    <section>
      <h3>{t.edit.look}</h3>
      <div className={cx("fields")}>
        {tokens.map((k) => (
          <Token
            key={k + work.revision}
            work={work}
            token={k}
            change={change}
          />
        ))}
        <div className={cx("field")}>
          <span className={cx("field-name")}>{t.edit.font}</span>
          <span className={cx("field-choice")} role="group">
            {(Object.keys(faces) as (keyof typeof faces)[]).map((f) => (
              <button
                key={f}
                aria-pressed={face === f}
                style={{ fontFamily: faces[f] }}
                onClick={() =>
                  face !== f &&
                  void change((w) => setStyle(w, "font", faces[f]))
                }
              >
                {t.edit.faces[f]}
              </button>
            ))}
          </span>
        </div>
      </div>
    </section>
  );
}

/** One of the work's colours, changed for every part that takes it. */
function Token({
  work,
  token,
  change,
}: {
  work: Work;
  token: "ink" | "accent" | "accent2" | "muted";
  change: Change;
}) {
  const t = useT();
  const [value, setValue] = useState(hex(work.style[token]));
  return (
    <div className={cx("field")} data-inline>
      <span className={cx("field-name")}>{t.edit.tokens[token]}</span>
      <Picker
        plain
        label={t.edit.tokens[token]}
        value={value}
        onChange={setValue}
        onDone={(c) =>
          c !== hex(work.style[token]) &&
          void change((w) => setStyle(w, token, c))
        }
      />
    </div>
  );
}

/** Words being changed where they are drawn: a field laid over them at their size. Enter
 * or leaving keeps the change, Escape takes it back. */
export function Retype({
  pointed,
  stage,
  done,
}: {
  pointed: Extract<Pointed, { kind: "text" }>;
  stage: HTMLElement;
  done: (text: string | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(pointed.text);
  const finished = useRef(false);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    done(value);
  };
  useEffect(() => {
    ref.current!.focus();
    ref.current!.select();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text]);
  // The field stays over the words as the view moves under it.
  useLayoutEffect(() => {
    let frame = 0;
    const follow = () => {
      const el = ref.current!,
        area = stage.getBoundingClientRect(),
        { rect: r, size: s } = pointed.place(),
        size = Math.min(48, Math.max(13, s));
      Object.assign(el.style, {
        left: r.left - area.left - 6 + "px",
        top: r.top - area.top + r.height / 2 - size * 0.75 - 4 + "px",
        minWidth: Math.max(120, r.width + 24) + "px",
        fontSize: size + "px",
      });
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [pointed, stage]);
  return (
    <textarea
      ref={ref}
      className={cx("retype")}
      rows={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(null);
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(text);
        }
      }}
      onBlur={() => finish(text)}
    />
  );
}
