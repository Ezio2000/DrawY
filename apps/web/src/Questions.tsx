import { useState } from "react";
import { X, Check, Sparkles, PenLine } from "lucide-react";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import type { Question } from "../../../modules/contracts/index.ts";

/** The author's questions before it draws. A single question answers on one click; with
 * several, the choices are gathered and sent together. Each question's last row takes an
 * answer of the user's own, which stands beside (or, for a single choice, instead of) the
 * options. Anything else is written in the composer below, which sends it with the choices
 * made so far. The user can also leave the choices to the author, or drop the request. */
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
  const [chosen, setChosen] = useState<Record<string, string[]>>({}),
    // Each question's answer in the user's own words.
    [own, setOwn] = useState<Record<string, string>>({});
  const quick = questions.length === 1 && !questions[0].multiple;
  const answers = (
    q: Question,
    picked: Record<string, string[]>,
    words: Record<string, string>,
  ) => {
    const typed = words[q.id]?.trim();
    // For a single choice, words of one's own stand instead of the option.
    if (typed && !q.multiple) return [typed];
    return [...(picked[q.id] || []), ...(typed ? [typed] : [])];
  };
  const said = (picked: Record<string, string[]>, words = own) =>
    questions
      .map((q) => [q, answers(q, picked, words)] as const)
      .filter(([, a]) => a.length)
      .map(([q, a]) => `${q.text}\n→ ${a.join(t.now.list)}`)
      .join("\n");
  const send = (picked: Record<string, string[]>, words = own) =>
    answer(said(picked, words));
  const pick = (q: Question, label: string) => {
    const mine = chosen[q.id] || [];
    const next = {
      ...chosen,
      [q.id]: q.multiple
        ? mine.includes(label)
          ? mine.filter((l) => l !== label)
          : [...mine, label]
        : [label],
    };
    // Picking an option for a single choice sets aside what was typed for it.
    const words = q.multiple ? own : { ...own, [q.id]: "" };
    if (quick) send(next, words);
    else {
      setChosen(next);
      setOwn(words);
      choose(said(next, words));
    }
  };
  const write = (q: Question, text: string) => {
    const words = { ...own, [q.id]: text };
    // For a single choice, writing one's own answer sets the option aside.
    const next =
      q.multiple || !text.trim() ? chosen : { ...chosen, [q.id]: [] };
    setOwn(words);
    setChosen(next);
    choose(said(next, words));
  };
  const ready = questions.every((q) => answers(q, chosen, own).length);
  const touched =
    Object.values(chosen).some((a) => a.length) ||
    Object.values(own).some((w) => w.trim());
  return (
    <div className={cx("question")}>
      <button
        className={cx("question-drop")}
        aria-label={t.questions.drop}
        data-tip={t.questions.drop}
        onClick={cancel}
      >
        <X size={15} />
      </button>
      {questions.map((q) => (
        <section key={q.id}>
          <p>{q.text}</p>
          <ol>
            {q.options.map((o, i) => {
              const on = chosen[q.id]?.includes(o.label) || false;
              return (
                <li key={o.label}>
                  <button aria-pressed={on} onClick={() => pick(q, o.label)}>
                    <i>{on ? <Check size={13} strokeWidth={2.6} /> : i + 1}</i>
                    <b>{o.label}</b>
                    {o.detail && <small>{o.detail}</small>}
                    {!!o.pictures?.length && (
                      <span className={cx("question-pictures")}>
                        {o.pictures.slice(0, 3).map((p) => (
                          <img key={p.url} src={p.url} alt={p.name} />
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            <li>
              <label
                className={cx("question-own")}
                data-filled={!!own[q.id]?.trim() || undefined}
              >
                <i>
                  {own[q.id]?.trim() ? (
                    <Check size={13} strokeWidth={2.6} />
                  ) : (
                    <PenLine size={13} />
                  )}
                </i>
                <input
                  value={own[q.id] || ""}
                  placeholder={t.questions.own}
                  aria-label={t.questions.own}
                  onChange={(e) => write(q, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    if (!own[q.id]?.trim()) return;
                    if (quick || ready) send(chosen);
                  }}
                />
                {!!own[q.id]?.trim() && <kbd aria-hidden>↵</kbd>}
              </label>
            </li>
          </ol>
        </section>
      ))}
      <footer>
        {!touched && (
          <button
            className={cx("question-yours")}
            onClick={() => answer(t.questions.yoursMessage)}
          >
            <i>
              <Sparkles size={13} />
            </i>
            {t.questions.yours}
          </button>
        )}
        {!quick && (
          <button
            className={cx("primary small")}
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
