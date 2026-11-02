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
  Globe,
  Image as ImageIcon,
} from "lucide-react";
import type { SearchMode, UserSettings } from "../../../modules/contracts/index.ts";
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
  /** What draws, searches and paints, and picking each. */
  models?: Models;
  choose: (change: Pick<Partial<UserSettings>, Choice>) => void;
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
            <ModelPicker models={models} pick={choose} />
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

type Choice = "model" | "image" | "searchService" | "searchModes";
/** The picks a change makes, shown at once while it is saved. */
export function chosen(m: Models, change: Pick<Partial<UserSettings>, Choice>): Models {
  return {
    ...m,
    chosen: change.model ?? m.chosen,
    image: change.image ?? m.image,
    search: change.searchService ?? m.search,
    models: m.models.map((x) =>
      change.searchModes?.[x.id] ? { ...x, search: change.searchModes[x.id] } : x,
    ),
  };
}
/** Who draws, who searches and who paints: their names beside the send button, and a
 * menu to pick each on its own by display name. */
function ModelPicker({
  models,
  pick,
}: {
  models: Models;
  pick: (change: Pick<Partial<UserSettings>, Choice>) => void;
}) {
  const t = useT(),
    w = t.composer;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const chosen =
    models.models.find((m) => m.id === models.chosen) ?? models.models[0];
  const image = models.images.find((m) => m.id === models.image) ?? models.images[0];
  const service = models.searches.find((s) => s.id === models.search);
  const searchName = (mode: SearchMode) =>
    mode === "builtin"
      ? w.searchBuiltinBy(chosen.name)
      : mode === "service" && service
        ? service.name
        : w.searchNone;
  const summary = w.services(chosen.name, searchName(chosen.search), image?.name ?? "");
  const mode = (search: SearchMode, searchService?: string) =>
    pick({
      searchModes: { [chosen.id]: search },
      ...(searchService ? { searchService } : {}),
    });
  return (
    <div className={cx("model-picker")} ref={ref}>
      <button
        className={cx("model-button")}
        aria-label={summary}
        data-tip={open ? undefined : summary}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{chosen.name}</span>
        <span className={cx("model-part")} data-off={chosen.search === "off" || undefined}>
          <Globe size={12} />
          <span>{searchName(chosen.search)}</span>
        </span>
        {image && (
          <span className={cx("model-part")}>
            <ImageIcon size={12} />
            <span>{image.name}</span>
          </span>
        )}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className={cx("popover models-menu")} role="menu">
          <p className={cx("models-head")}>{w.authorSection}</p>
          {models.models.map((m) => (
            <button
              key={m.id}
              role="menuitemradio"
              aria-checked={m.id === chosen.id}
              disabled={!m.ready}
              onClick={() => pick({ model: m.id })}
            >
              <span>{m.name}</span>
              {m.id === chosen.id && <Check size={15} />}
            </button>
          ))}
          <p className={cx("models-head")}>{w.searchSection(chosen.name)}</p>
          <button
            role="menuitemradio"
            aria-checked={chosen.search === "builtin"}
            disabled={!chosen.builtinSearch}
            onClick={() => mode("builtin")}
          >
            <span>{w.searchBuiltin}</span>
            {chosen.search === "builtin" && <Check size={15} />}
          </button>
          {models.searches.length ? (
            models.searches.map((s) => {
              const on = chosen.search === "service" && models.search === s.id;
              return (
                <button
                  key={s.id}
                  role="menuitemradio"
                  aria-checked={on}
                  disabled={!s.ready}
                  onClick={() => mode("service", s.id)}
                >
                  <span>{s.name}</span>
                  {on && <Check size={15} />}
                </button>
              );
            })
          ) : (
            <button role="menuitemradio" aria-checked={false} disabled>
              <span>{w.searchServiceNone}</span>
            </button>
          )}
          <button
            role="menuitemradio"
            aria-checked={chosen.search === "off"}
            onClick={() => mode("off")}
          >
            <span>{w.searchOff}</span>
            {chosen.search === "off" && <Check size={15} />}
          </button>
          <p className={cx("models-head")}>{w.imageSection}</p>
          {models.images.map((m) => (
            <button
              key={m.id}
              role="menuitemradio"
              aria-checked={m.id === image?.id}
              disabled={!m.ready}
              onClick={() => pick({ image: m.id })}
            >
              <span>{m.name}</span>
              {m.id === image?.id && <Check size={15} />}
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
