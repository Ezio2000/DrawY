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
import type { SettingsChange } from "../../../modules/contracts/index.ts";
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
  quota,
  spent,
  collapsed,
}: {
  place: "home" | "dock";
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
  /** Requests left to make; null is no limit. */
  quota?: number | null;
  /** Whether no request is left, so a new one cannot be sent (answers still can). */
  spent?: boolean;
  /** While the author draws there is nothing to write: the box folds down to what is
   * happening and the button that stops it. */
  collapsed?: boolean;
}) {
  const t = useT();
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (place === "home") field.current?.focus();
  }, [place]);
  // Unfolding from the pill when the author stops or asks, it opens the way it folded,
  // rather than standing there whole at once.
  const [folded, setFolded] = useState(!!collapsed),
    [unfolding, setUnfolding] = useState(false);
  if (folded !== !!collapsed) {
    setFolded(!!collapsed);
    setUnfolding(!collapsed);
  }
  if (collapsed)
    return (
      <div className={cx("composer-wrap")} data-place={place} data-collapsed>
        <div className={cx("composer")} data-place={place} data-collapsed>
          {status || (
            <div className={cx("now")} data-tone="live">
              <i className={cx("now-dot")} />
              <span className={cx("now-line")}>{t.composer.working}</span>
            </div>
          )}
          <button
            className={cx("composer-stop")}
            aria-label={t.composer.stop}
            data-tip={t.composer.stop}
            onClick={stop}
          >
            <Square size={12} fill="currentColor" />
          </button>
        </div>
      </div>
    );
  return (
    <div className={cx("composer-wrap")} data-place={place}>
      <div
        className={cx("composer")}
        data-place={place}
        data-unfolding={unfolding || undefined}
        onAnimationEnd={(e) => e.target === e.currentTarget && setUnfolding(false)}
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
                  busy ||
                  spent ||
                  !!uploading ||
                  !(value.trim() || attachments.length)
                }
                data-tip={spent ? t.composer.quotaOut : undefined}
                onClick={send}
              >
                {busy ? <Spinner size={15} /> : <ArrowUp size={18} />}
              </button>
            )}
          </div>
        </div>
      </div>
      {!!models?.labels.length && <ModelBar models={models} pick={choose} quota={quota} />}
    </div>
  );
}

/** The pick a change makes, shown at once while it is saved. */
export function chosen(m: Models, change: SettingsChange): Models {
  return change.label ? { ...m, chosen: { label: change.label } } : m;
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

/** The one pick a run is made with: a label, named by those who manage models, that stands
 * for a whole combination of models; and how many requests are left to make. */
export function ModelBar({
  models,
  pick,
  quota,
}: {
  models: Models;
  pick: (change: SettingsChange) => void;
  quota?: number | null;
}) {
  const t = useT(),
    w = t.composer;
  const label =
    models.labels.find((l) => l.id === models.chosen.label) ?? models.labels[0];
  if (!label) return null;
  const name = (l: { id: string; name: string }) =>
    l.id === "default" && l.name === "默认" ? w.defaultLabel : l.name;
  return (
    <div className={cx("model-bar")}>
      {quota !== undefined && quota !== null && (
        <span
          className={cx("quota")}
          data-out={quota <= 0 || undefined}
          data-tip={w.quotaHint}
        >
          {w.quota(quota)}
        </span>
      )}
      {models.labels.length > 1 && (
        <Pick label={w.labelSection} value={name(label)}>
          {(close) => (
            <>
              <p className={cx("models-head")}>{w.labelSection}</p>
              {models.labels.map((l) => (
                <Option
                  key={l.id}
                  on={l.id === label.id}
                  disabled={!l.ready}
                  note={l.ready ? l.description : w.modelUnconnected}
                  pick={() => {
                    close();
                    pick({ label: l.id });
                  }}
                >
                  {name(l)}
                </Option>
              ))}
            </>
          )}
        </Pick>
      )}
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
