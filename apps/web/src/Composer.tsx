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
import { Spinner, sendsOnEnter } from "./ui/primitives.tsx";
import { useLocale } from "./ui/locale.tsx";
import type { StyleMaterial } from "@drawy/materials/schema";
import { api, type Models } from "./api.ts";
import { cx } from "./cx.ts";
import { useDismiss } from "./popover.ts";
import { useT } from "./i18n.tsx";
import type { Attachment } from "./session/request.ts";
import { useAccount, useCan } from "./account.tsx";
import type { WorkSession } from "./session/work.ts";
import { useSelect } from "./session/store.ts";
import type { Asking } from "./shell.ts";
import type { Feedback } from "./feedback.ts";
import { counted } from "./probe.ts";

/** How many styles one page of the picker shows. */
const STYLE_PAGE = 24;
const stylePages = new Map<number, Promise<{ items: StyleMaterial[]; pages: number }>>();
/** One page of the library's styles, each page loaded once: the library may hold many. */
export const stylePage = (page: number) => {
  let p = stylePages.get(page);
  if (!p) {
    p = api<{ items: StyleMaterial[]; pages: number }>(`/materials?kind=style&page=${page}&size=${STYLE_PAGE}`);
    p.catch(() => stylePages.delete(page));
    stylePages.set(page, p);
  }
  return p;
};
/** The first page of styles, for offering a few to choose from. */
export const styleList = () => stylePage(1).then((r) => r.items);
const named = new Map<string, Promise<StyleMaterial>>();
/** A style by id, however far down the library's list it is. */
export const styleNamed = (id: string) => {
  let p = named.get(id);
  if (!p) {
    p = api<StyleMaterial>("/materials/" + encodeURIComponent(id));
    p.catch(() => named.delete(id));
    named.set(id, p);
  }
  return p;
};

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
  focus,
  quote,
  unquote,
  edit,
  placeholder,
  ghostPlaceholder,
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
  /** Changes each time something is handed to the field to send, which then takes the
   * focus. */
  focus?: number;
  quote?: string;
  unquote?: () => void;
  /** Changes what is quoted by hand instead. */
  edit?: () => void;
  placeholder: string;
  /** Decorative animated placeholder rendered aria-hidden when empty, keeping the textarea's placeholder attribute stable. */
  ghostPlaceholder?: string;
  style?: StyleMaterial;
  setStyle?: (style?: StyleMaterial) => void;
  working: boolean;
  busy: boolean;
  send: () => void;
  stop?: () => void;
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
  const t = useT(),
    locale = useLocale();
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (place === "home") field.current?.focus();
  }, [place]);
  useEffect(() => {
    if (focus) requestAnimationFrame(() => field.current?.focus());
  }, [focus]);
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
                title={a.name[locale]}
              >
                {a.url ? <img src={a.url} alt={a.name[locale]} /> : <b>{a.name[locale]}</b>}
                <button aria-label={t.composer.detach(a.name[locale])} onClick={() => detach(a.id)}>
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
          <div className={cx("composer-input")}>
            <textarea
              ref={field}
              aria-label={t.composer.describe}
              placeholder={ghostPlaceholder && !value ? "" : placeholder}
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
                if (sendsOnEnter(e)) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {ghostPlaceholder && !value && (
              <span className={cx("composer-ghost")} aria-hidden="true">
                {ghostPlaceholder}
              </span>
            )}
          </div>
          <div className={cx("composer-tools")}>
            <AddMenu
              upload={() => picker.current?.click()}
              pick={pick}
            />
            {!!models?.labels.length && <ModelBar models={models} pick={choose} quota={quota} />}
            <span className={cx("composer-gap")} />
            {setStyle && <StylePicker style={style} pick={setStyle} />}
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
    </div>
  );
}

/** The pick a change makes, shown at once while it is saved. */
export function chosen(m: Models, change: SettingsChange): Models {
  return change.label ? { ...m, chosen: { label: change.label } } : m;
}

/** The one pick a run is made with: a label, named by those who manage models, that stands
 * for a whole combination of models; and how many requests are left to make. */
function ModelBar({
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
  const left = quota !== undefined && quota !== null && (
    <i data-out={quota <= 0 || undefined}>{w.quotaShort(quota)}</i>
  );
  // One pill, as in Claude's composer: the label in ink, the requests left after it in grey.
  if (models.labels.length < 2)
    return left ? (
      <span className={cx("model-bar")} data-tip={w.quotaHint}>
        {left}
      </span>
    ) : null;
  return <LabelPick models={models} label={label} name={name} left={left} pick={pick} />;
}

/** The label's pill, and a menu of the others. */
function LabelPick({
  models,
  label,
  name,
  left,
  pick,
}: {
  models: Models;
  label: Models["labels"][number];
  name: (l: { id: string; name: string }) => string;
  left: ReactNode;
  pick: (change: SettingsChange) => void;
}) {
  const w = useT().composer;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div className={cx("model-bar")}>
      <div className={cx("pick")} ref={ref}>
        <button
          className={cx("pick-button")}
          aria-label={`${w.labelSection}: ${name(label)}`}
          data-tip={open ? undefined : w.labelSection}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className={cx("pick-writer")}>
            <b>{name(label)}</b>
            {left}
          </span>
        </button>
        {open && (
          <div className={cx("popover models-menu")} role="menu">
            <p className={cx("models-head")}>{w.labelSection}</p>
            {models.labels.map((l) => (
              <button
                key={l.id}
                role="menuitemradio"
                aria-checked={l.id === label.id}
                disabled={!l.ready}
                onClick={() => {
                  setOpen(false);
                  pick({ label: l.id });
                }}
              >
                <span>
                  {name(l)}
                  {(l.ready ? l.description : w.modelUnconnected) && (
                    <small>{l.ready ? l.description : w.modelUnconnected}</small>
                  )}
                </span>
                {l.id === label.id && <Check size={15} />}
              </button>
            ))}
          </div>
        )}
      </div>
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
    [list, setList] = useState<StyleMaterial[]>([]),
    [shown, setShown] = useState({ page: 0, pages: 1 });
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  /** The next page of styles, added below those shown. */
  const more = (page: number) =>
    void stylePage(page).then((r) => {
      setList((old) => (page === 1 ? r.items : [...old, ...r.items.filter((s) => !old.some((o) => o.id === s.id))]));
      setShown({ page, pages: r.pages });
    }, () => {});
  useEffect(() => {
    if (open && !shown.page) more(1);
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
          {shown.page < shown.pages && (
            <button role="menuitem" onClick={() => more(shown.page + 1)}>
              <span className={cx("styles-auto")} />
              <span>
                <b>{t.composer.moreStyles}</b>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Until a drawing model is connected, the composer says so: those who manage models are
 * led to Settings, the rest are told an administrator has to. */
export function Unconnected({ go }: { go: (path: string) => void }) {
  const t = useT();
  const manages = useCan()("models.manage");
  return (
    <div className={cx("now")} data-tone="failed">
      <span className={cx("now-line")}>
        {manages ? t.composer.unconnected : t.composer.unconnectedMember}
      </span>
      {manages && (
        <button className={cx("primary small")} onClick={() => go("/settings")}>
          {t.composer.connect}
        </button>
      )}
    </div>
  );
}

/** The composer under a work. It reads the request itself, so typing draws only it; while
 * the author draws it folds to its progress and the button that stops it. */
export function WorkComposer({
  session,
  asking,
  feedback,
  go,
  status,
  quote,
  unquote,
  selecting,
  edit,
  send,
  stop,
}: {
  session: WorkSession;
  asking: Asking;
  feedback: Feedback;
  go: (path: string) => void;
  status: ReactNode;
  quote?: string;
  unquote: () => void;
  /** Whether something is selected for the request to be about. */
  selecting: boolean;
  edit?: () => void;
  send: () => void;
  stop: () => void;
}) {
  counted("composer");
  const t = useT();
  const user = useAccount();
  const { draft } = asking;
  const request = useSelect(draft, (r) => r);
  const s = useSelect(session, (s) => ({
    working: s.working,
    waiting: s.waiting,
    engaged: s.engaged,
    busy: s.sending || !s.loaded || !s.synced,
    empty: !s.scene?.modules.length,
    unbriefed: !s.work?.brief && !s.scene?.modules.length,
  }));
  const note = request.handed && request.text && (
    <div className={cx("now")}>
      <span className={cx("now-line")}>{request.handed}</span>
    </div>
  );
  return (
    <Composer
      place="dock"
      value={request.text}
      set={draft.write}
      attachments={request.attachments}
      detach={draft.detach}
      uploading={request.uploading}
      focus={request.asked}
      quote={quote}
      unquote={unquote}
      edit={edit}
      placeholder={
        s.waiting
          ? t.composer.answering
          : selecting
            ? t.composer.selected
            : s.working
              ? t.composer.working
              : s.empty
                ? t.home.placeholder
                : t.composer.continue
      }
      status={(asking.blocked === "unconnected" && <Unconnected go={go} />) || note || status}
      style={request.style}
      setStyle={((session.id === "_blank" || s.unbriefed) && user) || request.style ? draft.setStyle : undefined}
      working={s.working}
      busy={s.busy}
      send={send}
      stop={stop}
      attach={(files) => void feedback.attempt(() => asking.upload(files))}
      pick={asking.pick}
      models={s.engaged ? undefined : asking.models}
      collapsed={s.working}
      quota={user?.quota}
      spent={asking.blocked === "spent" && !s.waiting}
      choose={asking.choose}
    />
  );
}
