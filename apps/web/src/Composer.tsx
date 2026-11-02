import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Plus,
  Square,
  X,
  Palette,
  Check,
  ImageUp,
  Shapes,
  PencilLine,
} from "lucide-react";
import { effortFor, type SettingsChange } from "../../../modules/contracts/index.ts";
import { Spinner, useLocale } from "@drawy/ui";
import type { StyleMaterial } from "@drawy/materials/schema";
import { api, type Models } from "./api.ts";
import { cx } from "./cx.ts";
import { useDismiss } from "./Rail.tsx";
import { useT } from "./i18n.tsx";

/** Something sent along with the message: a picture, or any library material. */
export interface Attachment {
  id: string;
  kind: string;
  name: string;
  url?: string;
}
let styles: Promise<StyleMaterial[]> | undefined;
/** The library's styles, loaded once. */
export const styleList = () =>
  (styles ??= api<{ items: StyleMaterial[] }>("/materials?kind=style")
    .then((r) => r.items)
    .catch((e) => {
      styles = undefined;
      throw e;
    }));

/** Where the user writes to the author. On the home page it is large and can pick a
 * style; under the canvas it is one line, and what the author is doing shows inside it,
 * above the field. */
export function Composer({
  place,
  value,
  set,
  attachments,
  detach,
  uploading,
  quote,
  unquote,
  edit,
  placeholder,
  style,
  setStyle,
  working,
  busy,
  send,
  stop,
  attach,
  pick,
  status,
  models,
  choose,
}: {
  place: "home" | "dock" | "panel";
  value: string;
  set: (value: string) => void;
  attachments: Attachment[];
  detach: (id: string) => void;
  uploading: number;
  quote?: string;
  unquote: () => void;
  /** Changes what is quoted by hand instead. */
  edit?: () => void;
  placeholder: string;
  style?: StyleMaterial;
  setStyle?: (style?: StyleMaterial) => void;
  working: boolean;
  busy: boolean;
  send: () => void;
  stop: () => void;
  attach: (files: FileList | File[]) => void;
  /** Opens the library to pick materials from. */
  pick: () => void;
  /** What the author is doing, its question or its reply, shown in the box. */
  status?: ReactNode;
  /** What draws, searches and paints, and picking each, under the box; absent while the
   * author works. */
  models?: Models;
  choose: (change: SettingsChange) => void;
}) {
  const t = useT();
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (place === "home") field.current?.focus();
  }, [place]);
  return (
    <div className={cx("composer-wrap")} data-place={place}>
      <div
        className={cx("composer")}
        data-place={place}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          attach(e.dataTransfer.files);
        }}
      >
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) attach(e.target.files);
            e.target.value = "";
          }}
        />
        {status}
        {(!!quote || !!attachments.length || !!uploading) && (
          <div className={cx("composer-extras")}>
            {quote && (
              <span className={cx("quote")}>
                <span>{quote.slice(0, 80)}</span>
                <button onClick={unquote} aria-label={t.composer.clearQuote}>
                  <X size={12} />
                </button>
              </span>
            )}
            {quote && edit && (
              <button className={cx("quote-edit")} onClick={edit}>
                <PencilLine size={13} />
                {t.composer.editByHand}
              </button>
            )}
            {attachments.map((a) => (
              <span
                className={cx("attached")}
                data-kind={a.kind}
                key={a.id}
                title={a.name}
              >
                {a.url ? <img src={a.url} alt={a.name} /> : <b>{a.name}</b>}
                <button aria-label={t.composer.detach(a.name)} onClick={() => detach(a.id)}>
                  <X size={11} />
                </button>
              </span>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <span className={cx("attached")} data-uploading key={"u" + i}>
                <Spinner size={16} />
              </span>
            ))}
          </div>
        )}
        <div className={cx("composer-field")}>
          <textarea
            ref={field}
            aria-label={t.composer.describe}
            placeholder={placeholder}
            value={value}
            rows={1}
            onChange={(e) => set(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                attach(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className={cx("composer-tools")}>
            <AddMenu
              upload={() => picker.current?.click()}
              pick={pick}
            />
            {setStyle && <StylePicker style={style} pick={setStyle} />}
            <span className={cx("composer-gap")} />
            {working ? (
              <button
                className={cx("composer-stop")}
                aria-label={t.composer.stop}
                data-tip={t.composer.stop}
                onClick={stop}
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                className={cx("composer-send")}
                aria-label={t.composer.send}
                disabled={
                  busy || !!uploading || !(value.trim() || attachments.length)
                }
                onClick={send}
              >
                {busy ? <Spinner size={15} /> : <ArrowUp size={18} />}
              </button>
            )}
          </div>
        </div>
      </div>
      {!!models?.writers.length && <ModelBar models={models} pick={choose} />}
    </div>
  );
}

/** The picks a change makes, shown at once while it is saved. */
export function chosen(m: Models, change: SettingsChange): Models {
  const writer = m.writers.find(
    (x) => x.id === (change.writer ?? m.chosen.writer),
  );
  // A model switched to comes with the effort and speed last picked for it.
  const switched = !!writer && writer.id !== m.chosen.writer;
  const effort = change.effort ?? (switched ? writer.effort : m.chosen.effort),
    speed = change.speed ?? (switched ? writer.speed : m.chosen.speed),
    web = change.web ?? m.chosen.web;
  return {
    ...m,
    chosen: {
      writer: writer?.id ?? m.chosen.writer,
      ...(writer?.efforts.length
        ? {
            effort: effortFor(effort ?? writer.effort, writer.efforts) ?? writer.effort,
          }
        : {}),
      ...(writer && writer.speeds.length > 1
        ? {
            speed:
              speed && writer.speeds.includes(speed) ? speed : writer.speed,
          }
        : {}),
      web,
      search:
        web === "off"
          ? "off"
          : web === "builtin"
            ? writer?.builtinSearch
              ? "builtin"
              : "off"
            : "service",
      image: change.image ?? m.chosen.image,
    },
  };
}

/** One pick beside the composer: what is picked, and a menu of the rest. */
function Pick({
  label,
  value,
  shown,
  off,
  long,
  wide,
  children,
}: {
  label: string;
  value: string;
  /** What the button shows, where it is more than the value's words. */
  shown?: ReactNode;
  /** Whether what is wanted is not what will happen (a search the model lacks). */
  off?: boolean;
  /** Whether its name may be long, and so give way where room is short. */
  long?: boolean;
  /** Whether its menu holds several settings side by side, and so is wider. */
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div className={cx("pick")} data-long={long || undefined} ref={ref}>
      <button
        className={cx("pick-button")}
        aria-label={`${label}: ${value}`}
        data-tip={open ? undefined : label}
        data-off={off || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {shown ?? <span>{value}</span>}
      </button>
      {open && (
        <div
          className={cx("popover models-menu")}
          data-wide={wide || undefined}
          role="menu"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
/** One entry in a pick's menu. */
function Option({
  on,
  disabled,
  pick,
  children,
  note,
}: {
  on: boolean;
  disabled?: boolean;
  pick: () => void;
  children: ReactNode;
  note?: string;
}) {
  return (
    <button
      role="menuitemradio"
      aria-checked={on}
      disabled={disabled}
      onClick={pick}
    >
      <span>
        {children}
        {note && <small>{note}</small>}
      </span>
      {on && <Check size={15} />}
    </button>
  );
}

/** The five picks a run is made with, each on its own: the drawing model, how hard it
 * thinks, how fast it is served, how it searches the web and which model paints. Effort
 * and speed show only where the model offers a choice. */
export function ModelBar({
  models,
  pick,
}: {
  models: Models;
  pick: (change: SettingsChange) => void;
}) {
  const t = useT(),
    w = t.composer,
    names = t.settings;
  const c = models.chosen;
  const writer =
    models.writers.find((m) => m.id === c.writer) ?? models.writers[0];
  const image = models.images.find((m) => m.id === c.image) ?? models.images[0];
  const service = models.searches.find((s) => s.id === c.web);
  if (!writer) return null;
  const webName =
    c.web === "builtin"
      ? w.searchBuiltin
      : service
        ? service.name
        : w.searchOff;
  const providers = [...new Set(models.writers.map((m) => m.provider))];
  const choose = (change: SettingsChange, close: () => void) => {
    close();
    pick(change);
  };
  const effortName = c.effort && writer.efforts.length > 1 ? names.efforts[c.effort] : undefined,
    speedName = c.speed ? names.speeds[c.speed] : undefined;
  return (
    <div className={cx("model-bar")}>
      {/* The model, how hard it thinks and how fast it is served are one choice of how the
          drawing is written: one button, and a panel that sets all three. */}
      <Pick
        label={w.authorSection}
        value={[writer.name, effortName, speedName].filter(Boolean).join(" · ")}
        shown={
          <span className={cx("pick-writer")}>
            <b>{writer.name}</b>
            {effortName && <i>{effortName}</i>}
            {speedName && <i>{speedName}</i>}
          </span>
        }
        long
        wide
      >
        {() => (
          <>
            <p className={cx("models-head")}>{w.authorSection}</p>
            {providers.map((p) => (
              <div key={p} className={cx("models-group")}>
                {providers.length > 1 && <p className={cx("models-sub")}>{p}</p>}
                {models.writers
                  .filter((m) => m.provider === p)
                  .map((m) => (
                    <Option
                      key={m.id}
                      on={m.id === writer.id}
                      disabled={!m.ready}
                      note={m.ready ? m.description : w.modelUnconnected}
                      pick={() => pick({ writer: m.id })}
                    >
                      {m.name}
                    </Option>
                  ))}
              </div>
            ))}
            {c.effort && writer.efforts.length > 1 && (
              <Segments
                label={names.effort}
                options={writer.efforts}
                value={c.effort}
                name={(e) => names.efforts[e]}
                pick={(effort) => pick({ effort })}
              />
            )}
            {c.speed && (
              <Segments
                label={names.speed}
                options={writer.speeds}
                value={c.speed}
                name={(s) => names.speeds[s]}
                hint={names.speedHints[c.speed]}
                pick={(speed) => pick({ speed })}
              />
            )}
          </>
        )}
      </Pick>
      <Pick
        label={w.searchSection}
        value={webName}
        off={c.web !== "off" && c.search === "off"}
        long
      >
        {(close) => (
          <>
            <p className={cx("models-head")}>{w.searchSection}</p>
            <Option
              on={c.web === "off"}
              pick={() => choose({ web: "off" }, close)}
            >
              {w.searchOff}
            </Option>
            <Option
              on={c.web === "builtin"}
              note={
                writer.builtinSearch
                  ? w.searchBuiltinBy(writer.name)
                  : w.searchBuiltinNone(writer.name)
              }
              pick={() => choose({ web: "builtin" }, close)}
            >
              {w.searchBuiltin}
            </Option>
            {models.searches.map((s) => (
              <Option
                key={s.id}
                on={c.web === s.id}
                disabled={!s.ready}
                pick={() => choose({ web: s.id }, close)}
              >
                {s.name}
              </Option>
            ))}
          </>
        )}
      </Pick>
      {image && (
        <Pick label={w.imageSection} value={image.name} long>
          {(close) => (
            <>
              <p className={cx("models-head")}>{w.imageSection}</p>
              {models.images.map((m) => (
                <Option
                  key={m.id}
                  on={m.id === image.id}
                  disabled={!m.ready}
                  note={m.ready ? m.description : w.modelUnconnected}
                  pick={() => choose({ image: m.id }, close)}
                >
                  {m.name}
                </Option>
              ))}
            </>
          )}
        </Pick>
      )}
    </div>
  );
}

/** A setting of the drawing model with a few levels, picked side by side in its panel. */
function Segments<T extends string>({
  label,
  options,
  value,
  name,
  hint,
  pick,
}: {
  label: string;
  options: readonly T[];
  value: T;
  name: (v: T) => string;
  hint?: string;
  pick: (v: T) => void;
}) {
  return (
    <div className={cx("models-setting")}>
      <p className={cx("models-head")}>{label}</p>
      <div className={cx("models-seg")} role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            role="menuitemradio"
            aria-checked={o === value}
            onClick={() => pick(o)}
          >
            {name(o)}
          </button>
        ))}
      </div>
      {hint && <small className={cx("models-hint")}>{hint}</small>}
    </div>
  );
}

/** Adding to the message: a picture from this computer, or anything from the library. */
function AddMenu({ upload, pick }: { upload: () => void; pick: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const choose = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <div className={cx("add-menu")} ref={ref}>
      <button
        className={cx("composer-tool")}
        aria-label={t.composer.attach}
        data-tip={open ? undefined : t.composer.attach}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Plus size={19} />
      </button>
      {open && (
        <div className={cx("popover")} role="menu">
          <button role="menuitem" onClick={() => choose(upload)}>
            <ImageUp size={15} />
            {t.composer.upload}
          </button>
          <button role="menuitem" onClick={() => choose(pick)}>
            <Shapes size={15} />
            {t.composer.fromLibrary}
          </button>
        </div>
      )}
    </div>
  );
}

/** Choosing the look up front, each style shown by its samples; left on auto, the
 * author settles it from the request or asks. */
function StylePicker({
  style,
  pick,
}: {
  style?: StyleMaterial;
  pick: (style?: StyleMaterial) => void;
}) {
  const t = useT(),
    locale = useLocale();
  const [open, setOpen] = useState(false),
    [list, setList] = useState<StyleMaterial[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  useEffect(() => {
    if (open) void styleList().then(setList, () => {});
  }, [open]);
  const choose = (s?: StyleMaterial) => {
    pick(s);
    setOpen(false);
  };
  return (
    <div className={cx("style-picker")} ref={ref}>
      <button
        className={cx("composer-tool")}
        data-chosen={!!style || undefined}
        aria-expanded={open}
        aria-label={t.composer.style}
        onClick={() => setOpen(!open)}
      >
        {style?.samples[0] ? (
          <img src={`/materials/thumbs/${style.samples[0]}?size=64`} alt="" />
        ) : (
          <Palette size={17} />
        )}
        {style && <span>{style.name[locale]}</span>}
      </button>
      {open && (
        <div className={cx("popover styles-menu")} role="menu">
          <button role="menuitemradio" aria-checked={!style} onClick={() => choose()}>
            <span className={cx("styles-auto")}>
              <Palette size={18} />
            </span>
            <span>
              <b>{t.composer.auto}</b>
            </span>
            {!style && <Check size={15} />}
          </button>
          {list.map((s) => (
            <button
              key={s.id}
              role="menuitemradio"
              aria-checked={style?.id === s.id}
              onClick={() => choose(s)}
            >
              {s.samples[0] ? (
                <img
                  src={`/materials/thumbs/${s.samples[0]}?size=256`}
                  alt=""
                />
              ) : (
                <span className={cx("styles-auto")} />
              )}
              <span>
                <b>{s.name[locale]}</b>
                <small>{t.registers[s.register]}</small>
              </span>
              {style?.id === s.id && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
