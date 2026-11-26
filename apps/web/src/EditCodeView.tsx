import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Instance, Work } from "../../../modules/contracts/index.ts";
import { dataPatch } from "../../../modules/editing/index.ts";
import { sequenceSource, SEQUENCE, type SequenceData } from "../../../modules/interchange/index.ts";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { readSequence } from "./interchange.ts";

/* A drawing that has a text of its own (a sequence diagram, as Mermaid writes one) shown as
 * that text beside the canvas, in step with the picture both ways: what the text says is
 * drawn as it is typed, and a change made on the canvas rewrites the text while it is not
 * being typed in. Items keep their ids through the text (participants by their aliases,
 * messages by their place), so what is selected and how parts stand out survive it. */

/** The text forms drawings have, by the library drawing's id. */
const views: Record<string, { write: (data: Record<string, unknown>) => string; read: (text: string, was: Record<string, unknown>) => Promise<Record<string, unknown>> }> = {
  [SEQUENCE]: {
    write: (data) => sequenceSource(data as Partial<SequenceData>),
    read: async (text, was) => ({ ...(await readSequence(text, was as Partial<SequenceData>)) }) as Record<string, unknown>,
  },
};
/** Whether a module's drawing has a text form: a library drawing named for one. */
export const hasTextView = (work: Work, m: Instance) => !!views[m.drawingId] && !work.drawings[m.drawingId];

export function CodeView({
  work,
  module,
  apply,
  close,
}: {
  work: Work;
  module: Instance;
  /** Gives the module the data the text reads as, as one hand edit. */
  apply: (patch: Record<string, unknown>) => void;
  close: () => void;
}) {
  const t = useT();
  const view = views[module.drawingId];
  const written = view.write(module.data);
  const [text, setText] = useState(written);
  const [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A change made on the canvas shows here unless the text is being typed in.
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(written);
  }, [written]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const read = (next: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const data = await view.read(next, module.data);
        setError("");
        const before: Record<string, unknown> = {};
        for (const k of Object.keys(data)) before[k] = module.data[k];
        const patch = dataPatch(before, data);
        if (Object.keys(patch).length) apply(data);
      } catch (e) {
        setError(e instanceof Error ? e.message.split("\n").slice(0, 3).join("\n") : String(e));
      }
    }, 500);
  };
  return (
    <div className={cx("code-view")} role="dialog" aria-label={t.edit.codeView.title}>
      <header>
        <b>{t.edit.codeView.title}</b>
        <button aria-label={t.close} onClick={close}>
          <X size={14} />
        </button>
      </header>
      <textarea
        ref={ref}
        spellCheck={false}
        aria-label={t.edit.codeView.title}
        aria-invalid={!!error || undefined}
        value={text}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setText(e.target.value);
          read(e.target.value);
        }}
      />
      {error && (
        <pre className={cx("code-view-error")} role="alert">
          {error}
        </pre>
      )}
    </div>
  );
}
