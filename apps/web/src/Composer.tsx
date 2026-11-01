import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Paperclip,
  Square,
  X,
  Palette,
  Check,
  ImageUp,
  Shapes,
  PencilLine,
  ChevronDown,
} from "lucide-react";
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
  chooseModel,
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
  /** The drawing models to pick from, and picking one. */
  models?: Models;
  chooseModel: (id: string) => void;
}) {
  const t = useT();
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (place === "home") field.current?.focus();
  }, [place]);
  return (
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
          {!!models?.models.length && (
            <ModelPicker models={models} pick={chooseModel} />
          )}
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
  );
}

/** Which drawing model draws: its name beside the send button, and a menu of the models
 * an administrator connected, each with what it is good for. */
function ModelPicker({
  models,
  pick,
}: {
  models: Models;
  pick: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const chosen =
    models.models.find((m) => m.id === models.chosen) ?? models.models[0];
  return (
    <div className={cx("model-picker")} ref={ref}>
      <button
        className={cx("model-button")}
        aria-label={t.composer.model(chosen.name)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{chosen.name}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className={cx("popover models-menu")} role="menu">
          {models.models.map((m) => (
            <button
              key={m.id}
              role="menuitemradio"
              aria-checked={m.id === chosen.id}
              disabled={!m.ready}
              onClick={() => {
                pick(m.id);
                setOpen(false);
              }}
            >
              <span>
                <b>{m.name}</b>
                <small>
                  {m.ready ? m.description : t.composer.modelUnconnected}
                </small>
              </span>
              {m.id === chosen.id && <Check size={15} />}
            </button>
          ))}
        </div>
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
        <Paperclip size={17} />
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
