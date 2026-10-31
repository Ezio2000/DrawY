import { useState } from "react";
import { X } from "lucide-react";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import type { Question } from "../../../modules/contracts/index.ts";

/** The author's questions before it draws. A single question answers on one click; with
 * several, the choices are gathered and sent together. Anything the user wants to add is
 * written in the composer below, which sends it with the choices made so far. The user can
 * also leave the choices to the author, or drop the request. */
export function Questions({
  questions,
  answer,
  choose,
  cancel,
}: {
  questions: Question[];
  answer: (text: string) => void;
  /** The choices made so far, as they would be sent. */
  choose: (text: string) => void;
  cancel: () => void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const quick = questions.length === 1 && !questions[0].multiple;
  const said = (picked: Record<string, string[]>) =>
    questions
      .filter((q) => picked[q.id]?.length)
      .map((q) => `${q.text}\n→ ${picked[q.id].join(t.now.list)}`)
      .join("\n");
  const send = (picked: Record<string, string[]>) => answer(said(picked));
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
    else {
      setChosen(next);
      choose(said(next));
    }
  };
  const ready = questions.every((q) => chosen[q.id]?.length);
  return (
    <div className={cx("question")}>
      <header>
        <small>{t.questions.confirm(questions.length)}</small>
        <button aria-label={t.questions.drop} data-tip={t.questions.drop} onClick={cancel}>
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
        {!Object.keys(chosen).length && (
          <button
            className={cx("quiet-button")}
            onClick={() => answer(t.questions.yoursMessage)}
          >
            {t.questions.yours}
          </button>
        )}
        {!quick && (
          <button
            className={cx("primary")}
            disabled={!ready}
            onClick={() => send(chosen)}
          >
            {t.questions.ok}
          </button>
        )}
      </footer>
    </div>
  );
}
