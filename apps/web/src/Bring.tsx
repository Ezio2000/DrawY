import { useRef, useState } from "react";
import { AlertCircle, FileUp } from "lucide-react";
import type { Clip } from "../../../modules/editing/index.ts";
import { Dialog } from "./ui/dialogs.tsx";
import { Spinner } from "./ui/primitives.tsx";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { clipOf, IMPORTABLE, incoming } from "./interchange.ts";

/** Bringing a Mermaid diagram or an Excalidraw scene into the scene: pasted into a box, or
 * read from a file. What comes in is placed in the middle of the view and selected. */
export function BringDialog({
  bring,
  close,
}: {
  bring: (clip: Clip) => Promise<unknown>;
  close: () => void;
}) {
  const t = useT(),
    b = t.edit.bring;
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const take = async (source: string) => {
    const what = incoming(source);
    if (!what) return setError(b.unknown);
    setBusy(true);
    setError("");
    try {
      const clip = await clipOf(what);
      if (!clip.modules.length) return setError(b.empty);
      close();
      await bring(clip);
    } catch (e) {
      setError(b.broken(e instanceof Error ? e.message.split("\n")[0] : String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={b.heading}
      description={b.hint}
      wide
      onClose={close}
      footer={
        <>
          <input
            ref={file}
            type="file"
            accept={IMPORTABLE}
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) {
                const source = await f.text();
                setText(source.length > 20000 ? "" : source);
                await take(source);
              }
            }}
          />
          <button className={cx("secondary")} disabled={busy} onClick={() => file.current?.click()}>
            <FileUp size={15} />
            {b.open}
          </button>
          <button className={cx("primary")} disabled={busy || !text.trim()} onClick={() => void take(text)}>
            {busy && <Spinner size={14} />}
            {b.submit}
          </button>
        </>
      }
    >
      <label className={cx("field", "bring")}>
        <textarea
          autoFocus
          rows={10}
          spellCheck={false}
          value={text}
          placeholder={b.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void take(text);
          }}
        />
      </label>
      {error && (
        <p className={cx("error")} role="alert">
          <AlertCircle size={15} />
          {error}
        </p>
      )}
    </Dialog>
  );
}
