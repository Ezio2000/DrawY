import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square, X, Palette, Check } from "lucide-react";
import { Spinner } from "@drawy/ui";
import type { StyleMaterial } from "@drawy/materials/schema";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { useDismiss } from "./Rail.tsx";

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
export const registers = { formal: "严谨", expressive: "个性", any: "通用" };

/** Where the user writes to the author. On the home page it is large and can pick a
 * style; under the canvas it is one line. */
export function Composer({
  place,
  value,
  set,
  attachments,
  detach,
  uploading,
  quote,
  unquote,
  placeholder,
  style,
  setStyle,
  working,
  busy,
  send,
  stop,
  attach,
}: {
  place: "home" | "dock";
  value: string;
  set: (value: string) => void;
  attachments: Attachment[];
  detach: (id: string) => void;
  uploading: number;
  quote?: string;
  unquote: () => void;
  placeholder: string;
  style?: StyleMaterial;
  setStyle?: (style?: StyleMaterial) => void;
  working: boolean;
  busy: boolean;
  send: () => void;
  stop: () => void;
  attach: (files: FileList | File[]) => void;
}) {
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
      {(!!quote || !!attachments.length || !!uploading) && (
        <div className={cx("composer-extras")}>
          {quote && (
            <span className={cx("quote")}>
              <span>{quote.slice(0, 80)}</span>
              <button onClick={unquote} aria-label="清除选择">
                <X size={12} />
              </button>
            </span>
          )}
          {attachments.map((a) => (
            <span
              className={cx("attached")}
              data-kind={a.kind}
              key={a.id}
              title={a.name}
            >
              {a.url ? <img src={a.url} alt={a.name} /> : <b>{a.name}</b>}
              <button aria-label={"移除 " + a.name} onClick={() => detach(a.id)}>
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
          aria-label="描述你想画的内容"
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
          <button
            className={cx("composer-tool")}
            aria-label="添加参考图"
            data-tip="添加参考图"
            onClick={() => picker.current?.click()}
          >
            <Paperclip size={17} />
          </button>
          {setStyle && <StylePicker style={style} pick={setStyle} />}
          <span className={cx("composer-gap")} />
          {working ? (
            <button
              className={cx("composer-stop")}
              aria-label="停止"
              data-tip="停止"
              onClick={stop}
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              className={cx("composer-send")}
              aria-label="发送"
              disabled={busy || !!uploading || !value.trim()}
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

/** Choosing the look up front, each style shown by its samples; left on 自动, the
 * author settles it from the request or asks. */
function StylePicker({
  style,
  pick,
}: {
  style?: StyleMaterial;
  pick: (style?: StyleMaterial) => void;
}) {
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
        aria-label="画风"
        onClick={() => setOpen(!open)}
      >
        {style?.samples[0] ? (
          <img src={`/materials/thumbs/${style.samples[0]}?size=64`} alt="" />
        ) : (
          <Palette size={17} />
        )}
        <span>{style ? style.name.zh : "画风"}</span>
      </button>
      {open && (
        <div className={cx("popover styles-menu")} role="menu">
          <button role="menuitemradio" aria-checked={!style} onClick={() => choose()}>
            <span className={cx("styles-auto")}>
              <Palette size={18} />
            </span>
            <span>
              <b>自动</b>
              <small>按你的描述决定，拿不准时会先问你</small>
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
                <img src={`/materials/thumbs/${s.samples[0]}?size=96`} alt="" />
              ) : (
                <span className={cx("styles-auto")} />
              )}
              <span>
                <b>{s.name.zh}</b>
                <small>{registers[s.register]}</small>
              </span>
              {style?.id === s.id && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
