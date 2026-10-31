import { useState } from "react";
import { X } from "lucide-react";
import { cx } from "./cx.ts";
import type { Question } from "../../../modules/contracts/index.ts";

/** The author's questions before it draws. A single question answers on one click; with
 * several, the choices are gathered and sent together, with anything the user adds. The
 * user can also leave the choices to the author, or drop the request. */
export function Questions({
  questions,
  answer,
  cancel,
}: {
  questions: Question[];
  answer: (text: string) => void;
  cancel: () => void;
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const quick = questions.length === 1 && !questions[0].multiple;
  const send = (picked: Record<string, string[]>) =>
    answer(
      [
        ...questions
          .filter((q) => picked[q.id]?.length)
          .map((q) => `${q.text}\n→ ${picked[q.id].join("、")}`),
        ...(note.trim() ? [note.trim()] : []),
      ].join("\n"),
    );
  const pick = (q: Question, label: string) => {
    const own = chosen[q.id] || [];
    const next = {
      ...chosen,
      [q.id]: q.multiple
        ? own.includes(label)
          ? own.filter((l) => l !== label)
          : [...own, label]
        : [label],
    };
    if (quick) send(next);
    else setChosen(next);
  };
  const ready =
    questions.every((q) => chosen[q.id]?.length) || (!quick && !!note.trim());
  return (
    <div className={cx("question")}>
      <header>
        <small>画之前想先确认{questions.length > 1 ? ` ${questions.length} 件事` : "一下"}</small>
        <button aria-label="不画了" data-tip="不画了" onClick={cancel}>
          <X size={15} />
        </button>
      </header>
      {questions.map((q) => (
        <section key={q.id}>
          <p>{q.text}</p>
          <div>
            {q.options.map((o) => (
              <button
                key={o.label}
                aria-pressed={chosen[q.id]?.includes(o.label) || false}
                data-pictures={!!o.pictures?.length || undefined}
                onClick={() => pick(q, o.label)}
              >
                {!!o.pictures?.length && (
                  <span className={cx("question-pictures")}>
                    {o.pictures.map((p) => (
                      <img key={p.url} src={p.url} alt={p.name} />
                    ))}
                  </span>
                )}
                <b>{o.label}</b>
                {o.detail && <small>{o.detail}</small>}
              </button>
            ))}
          </div>
        </section>
      ))}
      <footer>
        <input
          placeholder={quick ? "或者直接说你的想法…" : "补充说明（可选）"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              (note.trim() || ready)
            ) {
              e.preventDefault();
              send(chosen);
            }
          }}
        />
        {!note.trim() && !Object.keys(chosen).length && (
          <button
            className={cx("quiet-button")}
            onClick={() => answer("你来决定，直接画。")}
          >
            你来决定
          </button>
        )}
        {(!quick || note.trim()) && (
          <button
            className={cx("primary")}
            disabled={!ready && !note.trim()}
            onClick={() => send(chosen)}
          >
            确定
          </button>
        )}
      </footer>
    </div>
  );
}
