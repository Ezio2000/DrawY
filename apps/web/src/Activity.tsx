import { useEffect, useState, type ReactNode } from "react";
import { Questions } from "./Questions.tsx";
import { X } from "lucide-react";
import { cx } from "./cx.ts";
import { span } from "./time.ts";
import { useT, type Words } from "./i18n.tsx";
import { useLocale } from "@drawy/ui";
import { localize } from "../../../modules/contracts/messages.ts";
import type {
  Run,
  Step,
  Work,
  Picture,
} from "../../../modules/contracts/index.ts";
type ToolStep = Extract<Step, { kind: "tool" }>;
export const live = (run?: Run) =>
  !!run && ["running", "viewing"].includes(run.status);
/** Whether a text is written in the page's language: the model summarises its thoughts in
 * a language of its own, which is not shown to a reader of another. */
const readable = (text: string, locale: string) =>
  /[\u3400-\u9fff]/.test(text) === (locale === "zh");
/** A thought's headline and the reasoning under it. */
function thought(text: string) {
  const closed = text.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
  return closed
    ? [closed[1], closed[2]]
    : text.startsWith("**")
      ? [text.slice(2), ""]
      : [text.split("\n")[0], text.split("\n").slice(1).join("\n").trim()];
}
/** What the author is doing, in a word or two. */
function doing(step: ToolStep, t: Words) {
  const w = t.now;
  switch (step.name) {
    case "read_work":
      return w.reading;
    case "set_brief":
      return [
        w.briefing,
        step.subject,
        step.register && t.registers[step.register],
      ]
        .filter(Boolean)
        .join(" · ");
    case "find_materials":
      return [w.finding, step.subjects.join(w.list)].filter(Boolean).join(" · ");
    case "generate_images":
      return [w.generating, step.images.map((i) => i.name).join(w.list)]
        .filter(Boolean)
        .join(" · ");
    case "write_work":
      return step.revision ? w.writingRevision(step.revision) : w.writing;
    case "view_canvas":
      return step.waiting
        ? w.waitingImages(step.waiting.join(w.list))
        : [w.viewing, w.focus[step.focus]].filter(Boolean).join(" · ");
  }
}
/** Between tools, what the author is about, told by where it has got to. */
function between(steps: Step[], t: Words) {
  const last = steps.findLast((s): s is ToolStep => s.kind === "tool");
  if (!last) return t.now.understanding;
  if (last.status === "failed") return t.now.recovering;
  switch (last.name) {
    case "view_canvas":
      return t.now.revising;
    case "write_work":
      return t.now.checking;
    default:
      return t.now.composing;
  }
}
/** The pictures a step brings: the best candidates per subject, or what it generated. */
export const picturesOf = (step: Step): Picture[] =>
  step.kind !== "tool"
    ? []
    : step.name === "find_materials" || step.name === "set_brief"
      ? (step.found || []).flatMap((f) =>
          f.candidates
            .filter((c) => c.url)
            .slice(0, 3)
            .map((c) => ({ id: c.id, name: c.name, url: c.url! })),
        )
      : step.name === "generate_images"
        ? step.images.filter((p) => p.url)
        : [];
/** The top of the composer under the canvas: what the author is doing now and the pictures
 * it is weighing, its question, or how the last run ended. Pressing the line opens the
 * whole process. */
export function Now({
  run,
  work,
  offline,
  pictures,
  answer,
  choose,
  cancel,
  reveal,
  dismiss,
}: {
  run?: Run;
  work: Work;
  offline: boolean;
  /** Whether the pictures being weighed show here rather than pinned on a blank canvas. */
  pictures: boolean;
  answer: (text: string) => void;
  choose: (text: string) => void;
  cancel: () => void;
  reveal: () => void;
  dismiss: () => void;
}) {
  const t = useT(),
    locale = useLocale();
  if (offline)
    return (
      <div className={cx("now")} data-tone="quiet">
        <i className={cx("now-dot")} />
        <span className={cx("now-line")}>{t.now.offline}</span>
      </div>
    );
  if (!run) return null;
  if (run.status === "waiting" && run.questions)
    return (
      <Questions
        key={run.steps.length}
        questions={run.questions}
        answer={answer}
        choose={choose}
        cancel={cancel}
      />
    );
  if (!live(run)) {
    const reply = run.steps.at(-1);
    const text =
      run.status === "completed"
        ? reply?.kind === "message" && reply.role === "assistant"
          ? reply.text
          : ""
        : run.status === "failed"
          ? (run.error && localize(run.error, locale)) || t.now.unfinished
          : t.now.stopped;
    if (!text) return null;
    return (
      <div className={cx("now")} data-tone={run.status}>
        <button className={cx("now-reply")} data-tip={t.now.open} onClick={reveal}>
          {text}
        </button>
        <button
          className={cx("now-close")}
          aria-label={t.collapse}
          data-tip={t.now.dismiss}
          onClick={dismiss}
        >
          <X size={14} />
        </button>
      </div>
    );
  }
  const used = new Set(Object.keys(work.materials));
  // What is going into the picture: pictures generated for it and those it has taken in.
  const board = pictures
    ? run.steps
        .flatMap(picturesOf)
        // A picture still developing shows as the shimmer after them.
        .filter((p) => p.status !== "developing" && p.status !== "failed")
        .filter((p) => !p.id || used.has(p.id) || p.status === "ready")
        .filter((p, i, all) => all.findIndex((q) => q.url === p.url) === i)
        .slice(-4)
    : [];
  // A tool still at work outranks the thoughts and notes that stream alongside it.
  const busy = run.steps.findLast(
      (s): s is ToolStep => s.kind === "tool" && s.status === "running",
    ),
    tail = run.steps.at(-1),
    painting =
      pictures &&
      run.steps.some(
        (s) =>
          s.kind === "tool" &&
          s.name === "generate_images" &&
          s.images.some((i) => i.status === "developing"),
      );
  const headline = tail?.kind === "thinking" ? thought(tail.text)[0] : "";
  const line = busy
    ? doing(busy, t)
    : headline && readable(headline, locale)
      ? headline
      : tail?.kind === "message" && tail.role === "assistant"
        ? tail.text
        : between(run.steps, t);
  const at = run.steps.indexOf((busy ?? tail)!);
  return (
    <button className={cx("now")} data-tone="live" data-tip={t.now.open} onClick={reveal}>
      <i className={cx("now-dot")} />
      <span key={at} className={cx("now-line")}>
        {line}
      </span>
      <Elapsed key={at + line} />
      {(!!board.length || painting) && (
        <span className={cx("board")}>
          {board.map((p, i) => (
            <img
              key={p.url + i}
              src={p.url}
              alt={p.name}
              data-used={(p.id && used.has(p.id)) || undefined}
            />
          ))}
          {painting && <i className={cx("developing")} />}
        </span>
      )}
    </button>
  );
}
/** How long the author has been at its current step, once that is long enough to wonder. */
function Elapsed() {
  const [since] = useState(Date.now()),
    [now, setNow] = useState(since);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const t = useT();
  const s = Math.round((now - since) / 1000);
  return s >= 8 ? <small className={cx("now-time")}>{t.now.seconds(s)}</small> : null;
}
/** Every run of this work: the request, how the author went about it, and its reply. */
export function Activity({
  runs,
  work,
  openTrace,
}: {
  runs: Run[];
  work: Work;
  /** Opens the record of a run. */
  openTrace: (runId: string) => void;
}) {
  const t = useT(),
    locale = useLocale();
  const [zoom, Z] = useState<Picture>();
  const [open, O] = useState<Record<string, boolean>>({});
  const used = new Set(Object.keys(work.materials));
  const last = runs.at(-1);
  return (
    <>
      {!runs.length && <p className={cx("journal-empty")}>{t.journal.empty}</p>}
      {runs.map((r) => {
        const reply =
          r.status === "completed" && r.steps.at(-1)?.kind === "message"
            ? r.steps.length - 1
            : -1;
        const unfolded = open[r.id] ?? (r === last && live(r));
        const items: ReactNode[] = [];
        let trace: ReactNode[] = [];
        const flush = () => {
          if (!trace.length) return;
          items.push(
            <ol key={"trace" + items.length} className={cx("trace")}>
              {trace}
            </ol>,
          );
          trace = [];
        };
        r.steps.forEach((s, i) => {
          if (i === reply) return;
          if (s.kind === "message" && s.role === "user") {
            flush();
            items.push(
              <div key={i} className={cx("prompt")}>
                {!!s.materials?.length && (
                  <span className={cx("prompt-pictures")}>
                    {s.materials.map((id) => (
                      <img
                        key={id}
                        src={`/materials/thumbs/${id}?size=96`}
                        alt=""
                      />
                    ))}
                  </span>
                )}
                {s.text && <p>{s.text}</p>}
              </div>,
            );
          } else if (s.kind === "message" && s.asked) {
            // What the author asked stays in the conversation, before the answer.
            flush();
            items.push(
              <div key={i} className={cx("reply")}>
                {s.text}
              </div>,
            );
          } else if (unfolded)
            trace.push(
              <Trace
                key={i}
                step={s}
                live={live(r) && i === r.steps.length - 1}
                used={used}
                zoom={Z}
              />,
            );
        });
        flush();
        const steps = r.steps.filter(
          (s) => s.kind === "tool" || s.kind === "thinking",
        ).length;
        const saved = r.steps.findLast(
          (s) => s.kind === "tool" && s.name === "write_work" && s.revision,
        ) as Extract<ToolStep, { name: "write_work" }> | undefined;
        const facts = [
          !!steps && t.journal.steps(steps),
          r.elapsedMs && span(r.elapsedMs),
          saved && t.journal.revision(saved.revision!),
        ].filter(Boolean);
        return (
          <article key={r.id} className={cx("run")} data-status={r.status}>
            {items[0]}
            {!!steps && (
              <button
                className={cx("run-fold")}
                aria-expanded={unfolded}
                onClick={() => O({ ...open, [r.id]: !unfolded })}
              >
                <span>{live(r) ? t.journal.working : t.journal.process}</span>
                <small>{facts.join(" · ")}</small>
              </button>
            )}
            {unfolded && (
              <a
                className={cx("run-trace")}
                href={"/traces/" + r.id}
                onClick={(e) => {
                  e.preventDefault();
                  openTrace(r.id);
                }}
              >
                {t.journal.trace}
              </a>
            )}
            {items.slice(1)}
            {reply >= 0 && (
              <div className={cx("reply")}>
                {(r.steps[reply] as { text: string }).text}
              </div>
            )}
            {r.status === "failed" && (
              <p className={cx("run-error")}>{(r.error && localize(r.error, locale)) || t.journal.failed}</p>
            )}
            {r.status === "cancelled" && (
              <p className={cx("run-note")}>{t.journal.stopped}</p>
            )}
          </article>
        );
      })}
      {zoom && <Lightbox picture={zoom} close={() => Z(undefined)} />}
    </>
  );
}
/** A picture enlarged over everything; a click anywhere, the button or Escape closes it. */
function Lightbox({ picture, close }: { picture: Picture; close: () => void }) {
  const t = useT();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, []);
  return (
    <div className={cx("lightbox")} onClick={close}>
      <button aria-label={t.close}>
        <X size={18} />
      </button>
      <img src={picture.url} alt={picture.name} />
    </div>
  );
}
function Trace({
  step,
  live,
  used,
  zoom,
}: {
  step: Step;
  live: boolean;
  used: Set<string>;
  zoom: (p: Picture) => void;
}) {
  const t = useT(),
    locale = useLocale();
  if (step.kind === "message")
    return <li className={cx("trace-note")}>{step.text}</li>;
  if (step.kind === "thinking") {
    const [title, body] = thought(step.text);
    return (
      <li data-status={live ? "running" : "done"}>
        <details>
          <summary>
            {title && readable(title, locale) ? title : t.now.thinking}
          </summary>
          {body && <p>{body}</p>}
        </details>
      </li>
    );
  }
  const shots = picturesOf(step).concat(
    step.name === "view_canvas" ? step.screenshots || [] : [],
  );
  return (
    <li data-status={step.status}>
      <span>{doing(step, t)}</span>

      {!!shots.length && (
        <div className={cx("thumbs")} data-kind={step.name}>
          {shots.map((p, i) => (
            <button
              key={p.url + i}
              title={p.id ? `${p.name} · ${p.id}` : p.name}
              data-used={(p.id && used.has(p.id)) || undefined}
              data-status={p.status}
              onClick={() => zoom(p)}
            >
              {p.status === "developing" ? (
                <i className={cx("developing")} />
              ) : p.status === "failed" ? (
                <i className={cx("failed")}>×</i>
              ) : (
                <img src={p.url} alt={p.name} loading="lazy" />
              )}
            </button>
          ))}
        </div>
      )}
      {(step.name === "find_materials" || step.name === "set_brief") &&
        step.found?.some((f) => !f.candidates.length) && (
          <small>
            {t.journal.missing}
            {step.found
              .filter((f) => !f.candidates.length)
              .map((f) => f.subject)
              .join(t.now.list)}
          </small>
        )}
      {[
        ...(step.name === "view_canvas" ? step.errors || [] : []),
        ...(step.error ? [step.error] : []),
      ].map((e, i) => (
        <small key={i} className={cx("trace-error")}>
          {e}
        </small>
      ))}
    </li>
  );
}
