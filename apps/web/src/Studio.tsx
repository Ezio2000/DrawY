import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChevronRight,
  Compass,
  Eye,
  FilePlus2,
  Globe,
  Hand,
  Lightbulb,
  PenTool,
  RotateCcw,
  Search,
  Sparkles,
  SquareArrowOutUpRight,
  Wrench,
  X,
} from "lucide-react";
import { Questions } from "./Questions.tsx";
import { Markdown, plain, sourcesOf } from "./Markdown.tsx";
import { cx } from "./cx.ts";
import { ago, span } from "./time.ts";
import { useT, type Words } from "./i18n.tsx";
import { useLocale } from "@drawy/ui";
import { localize } from "../../../modules/contracts/messages.ts";
import type {
  Run,
  Step,
  Work,
  Picture,
  RevisionSummary,
} from "../../../modules/contracts/index.ts";
type ToolStep = Extract<Step, { kind: "tool" }>;
type Tool<N extends ToolStep["name"]> = Extract<ToolStep, { name: N }>;
export const live = (run?: Run) =>
  !!run && ["running", "viewing"].includes(run.status);
/** Whether a text is written in the page's language: the model summarises its thoughts in
 * a language of its own, which is not shown to a reader of another. */
const readable = (text: string, locale: string) =>
  /[㐀-鿿]/.test(text) === (locale === "zh");
/** A thought's headline and the reasoning under it. */
function thought(text: string) {
  const closed = text.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
  return closed
    ? [closed[1], closed[2]]
    : text.startsWith("**")
      ? [text.slice(2), ""]
      : [text.split("\n")[0], text.split("\n").slice(1).join("\n").trim()];
}
const k = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
      : String(n);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
/** A tool's name as words, for tools the app has no view of its own for. */
const toolName = (name: string) => name.replace(/[_-]+/g, " ");
/** What the author is doing, in a word or two. */
function doing(step: ToolStep, t: Words): string {
  const w = t.now;
  switch (step.name) {
    case "web_search":
      return [
        step.action === "open_page" ? t.steps.openPage : step.action === "find_in_page" ? t.steps.findInPage : w.searching,
        step.queries.join(w.list) || step.urls.map(host).join(w.list),
      ]
        .filter(Boolean)
        .join(" · ");
    case "hosted":
      return [w.using(toolName(step.tool)), step.detail].filter(Boolean).join(" · ");
    case "read_work":
      return w.reading;
    case "set_brief":
      return [w.briefing, step.subject, step.register && t.registers[step.register]]
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
/** Where a failed run left the work: the last revision it saved, and, when that one was
 * not seen whole without errors and the work is still as the run left it, the latest one
 * that was. */
export function stopped(run: Run, work: Work) {
  const saved = run.steps.findLast(
    (s): s is ToolStep & { name: "write_work" | "set_brief" } =>
      s.kind === "tool" &&
      (s.name === "write_work" || s.name === "set_brief") &&
      s.status === "done" &&
      !!s.revision,
  )?.revision;
  if (saved === undefined) return {};
  const clean = (r: number) =>
    run.observations.some((o) => o.revision === r && o.overview && !o.errors.length);
  if (work.revision !== saved || clean(saved)) return { saved };
  const earlier = run.observations
    .filter((o) => o.revision < saved && o.overview && clean(o.revision))
    .map((o) => o.revision);
  return { saved, clean: earlier.length ? Math.max(...earlier) : undefined };
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
/** The top of the composer: what the author is doing now and the pictures it is weighing,
 * its question, or how the last run ended. Pressing the line opens the studio. */
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
  resume,
  restore,
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
  /** Asks the author to go on from where a failed run stopped. */
  resume: () => void;
  restore: (revision: number) => void;
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
          ? plain(reply.text)
          : ""
        : run.status === "failed"
          ? (run.error && localize(run.error, locale)) || t.now.unfinished
          : t.now.stopped;
    if (!text) return null;
    const ended = run.status === "failed" ? stopped(run, work) : undefined;
    return (
      <div className={cx("now")} data-tone={run.status}>
        <button className={cx("now-reply")} data-tip={t.now.open} onClick={reveal}>
          {text}
          {ended?.saved !== undefined && (
            <span className={cx("now-saved")}>
              {ended.clean === undefined ? t.now.saved(ended.saved) : t.now.unchecked(ended.saved)}
            </span>
          )}
        </button>
        {ended?.clean !== undefined && (
          <button className={cx("now-action")} onClick={() => restore(ended.clean!)}>
            {t.now.restore(ended.clean)}
          </button>
        )}
        {ended && (
          <button className={cx("primary small")} onClick={resume}>
            {t.now.resume}
          </button>
        )}
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
  const painting =
    pictures &&
    run.steps.some(
      (s) =>
        s.kind === "tool" &&
        s.name === "generate_images" &&
        s.images.some((i) => i.status === "developing"),
    );
  return (
    <button className={cx("now")} data-tone="live" data-tip={t.now.open} onClick={reveal}>
      <i className={cx("now-dot")} />
      <Current run={run} />
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
/** One line on what a live run is doing, and for how long it has. */
function Current({ run }: { run: Run }) {
  const t = useT(),
    locale = useLocale();
  // A tool still at work outranks the thoughts and notes that stream alongside it.
  const busy = run.steps.findLast(
      (s): s is ToolStep => s.kind === "tool" && s.status === "running",
    ),
    tail = run.steps.at(-1);
  const headline = tail?.kind === "thinking" ? thought(tail.text)[0] : "";
  const line = busy
    ? doing(busy, t)
    : headline && readable(headline, locale)
      ? plain(headline)
      : tail?.kind === "message" && tail.role === "assistant"
        ? plain(tail.text)
        : between(run.steps, t);
  const at = run.steps.indexOf((busy ?? tail)!);
  return (
    <>
      <span key={at} className={cx("now-line")}>
        {line}
      </span>
      <Elapsed key={at + line} />
    </>
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

/** What the studio needs to show revisions where they were made and bring them back. */
interface Revisions {
  current: number;
  previewing?: number;
  /** Whether the work can be changed now; while the author works it cannot. */
  locked: boolean;
  look: (revision: number) => void;
  restore: (revision: number) => void;
}
const RevisionContext = createContext<Revisions>({
  current: 0,
  locked: true,
  look: () => {},
  restore: () => {},
});
/** A revision where it was made: which it is, and looking at it or bringing it back. */
function Revision({ revision, label }: { revision: number; label?: string }) {
  const t = useT();
  const r = useContext(RevisionContext);
  const now = revision === r.current;
  return (
    <span
      className={cx("revision")}
      data-current={now || undefined}
      data-previewing={revision === r.previewing || undefined}
    >
      <button
        className={cx("revision-look")}
        data-tip={now ? undefined : t.history.look}
        disabled={now && r.previewing === undefined}
        onClick={() => r.look(revision)}
      >
        {label ?? t.history.revision(revision)}
      </button>
      {now ? (
        <b>{t.history.current}</b>
      ) : (
        <button
          className={cx("revision-restore")}
          aria-label={t.history.restore}
          data-tip={t.history.restore}
          disabled={r.locked}
          onClick={() => r.restore(revision)}
        >
          <RotateCcw size={12} />
        </button>
      )}
    </span>
  );
}

/** A thumbnail of a picture, opened large when pressed. */
function Thumb({
  picture,
  used,
  zoom,
  caption,
}: {
  picture: Picture;
  used?: boolean;
  zoom: (p: Picture) => void;
  caption?: boolean;
}) {
  return (
    <figure className={cx("thumb")} data-status={picture.status} data-used={used || undefined}>
      <button
        title={picture.id ? `${picture.name} · ${picture.id}` : picture.name}
        disabled={picture.status === "developing" || picture.status === "failed"}
        onClick={() => zoom(picture)}
      >
        {picture.status === "developing" ? (
          <i className={cx("developing")} />
        ) : picture.status === "failed" ? (
          <i className={cx("failed")}>×</i>
        ) : (
          <img src={picture.url} alt={picture.name} loading="lazy" />
        )}
      </button>
      {caption && <figcaption>{picture.name}</figcaption>}
    </figure>
  );
}

const icons = {
  web_search: Globe,
  hosted: Wrench,
  read_work: BookOpen,
  set_brief: Compass,
  find_materials: Search,
  generate_images: Sparkles,
  write_work: PenTool,
  view_canvas: Eye,
} satisfies Record<ToolStep["name"], unknown>;

/** One step of the process with the look of its tool: searches show what was asked and
 * where it went, the brief reads as a brief, pictures as pictures, drafts as revisions to
 * look at or bring back, looks as the screenshots the author saw. */
function StepView({
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
    return (
      <li className={cx("step")} data-kind="note">
        <Markdown text={step.text} citations={step.citations} className={cx("step-note")} />
      </li>
    );
  if (step.kind === "thinking") return <Thoughts steps={[step]} live={live} />;
  const Icon = icons[step.name] ?? Wrench;
  const errors = [
    ...(step.name === "view_canvas" ? step.errors || [] : []),
    ...(step.error ? [step.error] : []),
  ];
  return (
    <li className={cx("step")} data-kind={step.name} data-status={step.status}>
      <i className={cx("step-icon")}>
        <Icon size={13} />
      </i>
      <div className={cx("step-body")}>
        <ToolBody step={step} used={used} zoom={zoom} />
        {errors.map((e, i) => (
          <small key={i} className={cx("step-error")}>
            {e}
          </small>
        ))}
      </div>
    </li>
  );
}
/** Thoughts in a row, as one line: the latest headline the reader can read, and every
 * thought's headline and reasoning when opened. */
function Thoughts({ steps, live }: { steps: Step[]; live: boolean }) {
  const t = useT(),
    locale = useLocale();
  const parts = steps
    .map((s) => thought(s.kind === "thinking" ? s.text : ""))
    .filter(([title]) => title && readable(title, locale));
  const headline = parts.at(-1)?.[0];
  return (
    <li className={cx("step")} data-kind="thinking" data-status={live ? "running" : "done"}>
      <i className={cx("step-icon")}>
        <Lightbulb size={13} />
      </i>
      <details className={cx("step-body")}>
        <summary>
          <span>{headline ? plain(headline) : t.now.thinking}</span>
          {steps.length > 1 && <small>×{steps.length}</small>}
          {!!parts.length && <ChevronRight size={13} />}
        </summary>
        {parts.map(([title, body], i) => (
          <div key={i} className={cx("step-thought")}>
            <b>{plain(title)}</b>
            {body && readable(body, locale) && <Markdown text={body} />}
          </div>
        ))}
      </details>
    </li>
  );
}
function ToolBody({
  step,
  used,
  zoom,
}: {
  step: ToolStep;
  used: Set<string>;
  zoom: (p: Picture) => void;
}) {
  const t = useT();
  const w = t.steps;
  switch (step.name) {
    case "web_search":
      return (
        <>
          <span className={cx("step-title")}>
            {step.action === "open_page"
              ? w.openPage
              : step.action === "find_in_page"
                ? w.findInPage
                : w.web_search}
            {step.pattern && <small> · “{step.pattern}”</small>}
          </span>
          {!!step.queries.length && (
            <div className={cx("queries")}>
              {step.queries.map((q, i) => (
                <q key={i} title={q}>
                  {q}
                </q>
              ))}
            </div>
          )}
          {!!step.urls.length && (
            <div className={cx("pages")}>
              {step.urls.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" title={u}>
                  {host(u)}
                  <SquareArrowOutUpRight size={10} />
                </a>
              ))}
            </div>
          )}
        </>
      );
    case "hosted":
      return (
        <>
          <span className={cx("step-title")}>{t.now.using(toolName(step.tool))}</span>
          {step.detail && <code className={cx("step-detail")}>{step.detail}</code>}
        </>
      );
    case "read_work":
      return (
        <span className={cx("step-title")}>
          {w.read_work}
          {step.revision !== undefined && <small> · {t.history.revision(step.revision)}</small>}
        </span>
      );
    case "set_brief":
      return <Brief step={step} used={used} zoom={zoom} />;
    case "find_materials":
      return (
        <>
          <span className={cx("step-title")}>{w.find_materials}</span>
          <Found found={step.found} subjects={step.subjects} used={used} zoom={zoom} />
        </>
      );
    case "generate_images": {
      const ready = step.images.filter((i) => i.status === "ready").length;
      return (
        <>
          <span className={cx("step-title")}>
            {w.generate_images}
            {!!step.images.length && (
              <small> · {w.imagesReady(ready, step.images.length)}</small>
            )}
          </span>
          <div className={cx("gallery")}>
            {step.images.map((p, i) => (
              <Thumb
                key={(p.id ?? p.name) + i}
                picture={p.url ? p : { ...p, status: "developing" }}
                used={!!p.id && used.has(p.id)}
                zoom={zoom}
                caption
              />
            ))}
          </div>
        </>
      );
    }
    case "write_work":
      return <Draft step={step} />;
    case "view_canvas":
      return (
        <>
          <span className={cx("step-title")}>
            {step.waiting ? t.now.waitingImages(step.waiting.join(t.now.list)) : w.view_canvas}
            {!step.waiting && <small> · {t.now.focus[step.focus]}</small>}
          </span>
          {!!step.screenshots?.length && (
            <div className={cx("looks")}>
              {step.screenshots.map((p, i) => (
                <Thumb key={p.url + i} picture={p} zoom={zoom} />
              ))}
            </div>
          )}
        </>
      );
  }
}
/** The brief as the author set it: what it is about, the ideas it weighed and the one it
 * chose, and the materials it found for its cast. */
function Brief({
  step,
  used,
  zoom,
}: {
  step: Tool<"set_brief">;
  used: Set<string>;
  zoom: (p: Picture) => void;
}) {
  const t = useT();
  return (
    <div className={cx("brief")}>
      <span className={cx("step-title")}>{t.steps.set_brief}</span>
      {step.subject && (
        <h4>
          {step.subject}
          {step.register && <i>{t.registers[step.register]}</i>}
        </h4>
      )}
      {!!step.ideas?.length && (
        <ol className={cx("ideas")}>
          {step.ideas.map((idea, i) => (
            <li key={i}>{idea}</li>
          ))}
        </ol>
      )}
      {step.concept && (
        <blockquote>
          <small>{t.steps.concept}</small>
          {step.concept}
        </blockquote>
      )}
      {!!step.found?.length && <Found found={step.found} used={used} zoom={zoom} />}
      {step.revision !== undefined && (
        <div className={cx("draft-foot")}>
          <Revision revision={step.revision} />
        </div>
      )}
    </div>
  );
}
/** Materials found, by what they were looked for. */
function Found({
  found,
  subjects = [],
  used,
  zoom,
}: {
  found?: { subject: string; candidates: { id: string; name: string; url?: string }[] }[];
  subjects?: string[];
  used: Set<string>;
  zoom: (p: Picture) => void;
}) {
  const t = useT();
  const rows = found ?? subjects.map((subject) => ({ subject, candidates: undefined }));
  return (
    <dl className={cx("found")}>
      {rows.map((f, i) => (
        <div key={f.subject + i}>
          <dt>{f.subject}</dt>
          <dd>
            {!f.candidates ? (
              <i className={cx("developing", "found-wait")} />
            ) : !f.candidates.length ? (
              <span className={cx("found-none")}>{t.steps.none}</span>
            ) : (
              f.candidates.slice(0, 4).map((c) =>
                c.url ? (
                  <Thumb
                    key={c.id}
                    picture={{ id: c.id, name: c.name, url: c.url }}
                    used={used.has(c.id)}
                    zoom={zoom}
                  />
                ) : (
                  <span key={c.id} className={cx("found-name")} data-used={used.has(c.id) || undefined}>
                    {c.name}
                  </span>
                ),
              )
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
/** A draft being written, then saved: its scenes and the modules laid out in them, and
 * once saved, the revision to look at or bring back. */
function Draft({ step }: { step: Tool<"write_work"> }) {
  const t = useT();
  const w = t.steps;
  const modules = step.scenes.reduce((n, s) => n + s.modules.length, 0);
  const facts = [
    modules && w.modules(modules),
    step.drawings.length && w.drawings(step.drawings.length),
    step.materials.length && w.materials(step.materials.length),
    step.removed && w.removed(step.removed),
  ].filter(Boolean);
  return (
    <div className={cx("draft")}>
      <span className={cx("step-title")}>
        {step.status === "running" ? w.writing : w.write_work}
        {step.writing && step.status === "running" && <small> · {w.writingDrawing(step.writing)}</small>}
      </span>
      {step.scenes.map((s) => (
        <div key={s.id} className={cx("draft-scene")}>
          <b>{s.title || s.id}</b>
          <span className={cx("draft-modules")}>
            {/* While streaming every module shows as it lands; a saved draft keeps a few. */}
            {(step.status === "running" ? s.modules : s.modules.slice(0, 8)).map((m) => (
              <i key={m.id}>{m.label || m.id}</i>
            ))}
            {step.status !== "running" && s.modules.length > 8 && (
              <i data-more>+{s.modules.length - 8}</i>
            )}
          </span>
        </div>
      ))}
      {(!!facts.length || step.revision !== undefined) && (
        <div className={cx("draft-foot")}>
          {step.revision !== undefined && <Revision revision={step.revision} />}
          <small>{facts.join(" · ")}</small>
        </div>
      )}
    </div>
  );
}

/** What a run spent on each service: the drawing model's tokens, the searches and pages
 * read, and the pictures painted. Runs saved before these were counted are counted from
 * their steps. */
export function spentBy(run: Run) {
  const u = run.usage;
  const looked = run.steps.filter(
    (s): s is Tool<"web_search"> => s.kind === "tool" && s.name === "web_search",
  );
  const read = (s: Tool<"web_search">) => s.action === "open_page" || s.action === "find_in_page";
  return {
    input: u?.input ?? 0,
    cached: u?.cached ?? 0,
    output: u?.output ?? 0,
    reasoning: u?.reasoning ?? 0,
    searches: u?.searches ?? looked.filter((s) => !read(s)).length,
    pages: u?.pages ?? looked.filter(read).length,
    images:
      u?.images?.count ??
      run.steps.reduce(
        (n, s) =>
          n +
          (s.kind === "tool" && s.name === "generate_images"
            ? s.images.filter((i) => i.status === "ready").length
            : 0),
        0,
      ),
    imageTokens: (u?.images?.input ?? 0) + (u?.images?.output ?? 0),
    hosted: Object.entries(u?.hosted ?? {}).filter(([n]) => n !== "web_search"),
  };
}
type Spent = ReturnType<typeof spentBy>;
const total = (list: Spent[]): Spent =>
  list.reduce(
    (a, b) => ({
      input: a.input + b.input,
      cached: a.cached + b.cached,
      output: a.output + b.output,
      reasoning: a.reasoning + b.reasoning,
      searches: a.searches + b.searches,
      pages: a.pages + b.pages,
      images: a.images + b.images,
      imageTokens: a.imageTokens + b.imageTokens,
      hosted: [...a.hosted, ...b.hosted],
    }),
    { input: 0, cached: 0, output: 0, reasoning: 0, searches: 0, pages: 0, images: 0, imageTokens: 0, hosted: [] },
  );
/** The spending in full, one service a line, each with who provided it when known. */
function spentLines(s: Spent, t: Words, by?: { author?: string; search?: string; image?: string }) {
  const named = (label: string, who?: string) => (who ? `${label} · ${who}` : label);
  return [
    t.usage.line(named(t.usage.author, by?.author), [
      t.usage.input(k(s.input), k(s.cached)),
      t.usage.output(k(s.output), k(s.reasoning)),
    ]),
    t.usage.line(named(t.usage.search, by?.search), [
      t.usage.searchCalls(s.searches),
      t.usage.pages(s.pages),
    ]),
    t.usage.line(named(t.usage.image, by?.image), [t.usage.imageTokens(s.images, k(s.imageTokens))]),
  ];
}
/** Who searched for a run, as the user picked it. */
const searchedBy = (run: Run, t: Words) =>
  !run.services
    ? undefined
    : run.services.search === "builtin"
      ? t.composer.searchBuiltinBy(run.services.author)
      : run.services.search === "service"
        ? run.services.searchBy
        : t.composer.searchOff;
/** A run's spending in a few words, and in full on hover. */
function usage(run: Run, t: Words) {
  const s = spentBy(run);
  const tokens = s.input + s.output;
  const short = [
    !!s.searches && t.usage.searches(s.searches),
    !!s.pages && t.usage.pagesShort(s.pages),
    ...s.hosted.map(([n, c]) => `${toolName(n)} ×${c}`),
    !!s.images && t.usage.images(s.images),
    !!tokens && t.usage.tokens(k(tokens)),
  ].filter(Boolean) as string[];
  const lines = run.usage || s.searches || s.images
    ? spentLines(s, t, {
        author: run.services && `${run.services.author} · ${run.services.model}`,
        search: searchedBy(run, t),
        image: run.services?.image,
      })
    : [];
  return { short, lines };
}
/** What the whole work has spent over every request, service by service. */
function WorkUsage({ runs }: { runs: Run[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const s = total(runs.map(spentBy));
  if (!s.input && !s.output && !s.searches && !s.pages && !s.images) return null;
  const names = (pick: (r: Run) => string | undefined) =>
    [...new Set(runs.map(pick).filter(Boolean))].join("、") || undefined;
  const lines = spentLines(s, t, {
    author: names((r) => r.services?.author),
    search: names((r) => (r.services?.search === "off" ? undefined : searchedBy(r, t))),
    image: names((r) => (spentBy(r).images ? r.services?.image : undefined)),
  });
  return (
    <div className={cx("work-usage")} data-open={open || undefined}>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>{t.usage.allRuns(runs.length)}</b>
        <span>
          {[
            t.usage.tokens(k(s.input + s.output)),
            t.usage.searches(s.searches),
            t.usage.pagesShort(s.pages),
            t.usage.images(s.images),
          ].join(" · ")}
        </span>
      </button>
      {open && <SpentLines lines={lines} />}
    </div>
  );
}
/** Spending service by service, one to a line. */
function SpentLines({ lines, title }: { lines: string[]; title?: string }) {
  return (
    <ul className={cx("spent-lines")}>
      {title && <li><b>{title}</b></li>}
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

type Entry =
  | { at: number; kind: "run"; run: Run }
  | { at: number; kind: "hand"; revisions: RevisionSummary[] };

/** The conversation with the author, how it went about each request, and the revisions
 * the work went through, in the order they happened; the composer sits underneath. */
export function Studio({
  runs,
  work,
  history,
  previewing,
  look,
  restore,
  resume,
  openTrace,
}: {
  runs: Run[];
  work: Work;
  history: RevisionSummary[];
  previewing?: number;
  look: (revision: number) => void;
  restore: (revision: number) => void;
  resume: () => void;
  /** Opens the record of a run. */
  openTrace: (runId: string) => void;
}) {
  const t = useT(),
    locale = useLocale();
  const [zoom, Z] = useState<Picture>();
  const [open, O] = useState<Record<string, boolean>>({});
  const used = new Set(Object.keys(work.materials));
  const last = runs.at(-1);
  // Revisions people made themselves sit between the requests, a run of edits as one.
  const entries: Entry[] = runs.map((run) => ({ at: run.startedAt, kind: "run", run }));
  for (const r of [...history].reverse()) {
    if (r.cause.kind === "run" || r.cause.kind === "create") continue;
    const prev = entries.at(-1);
    const after = entries.findLast((e) => e.at <= r.updatedAt);
    if (
      prev?.kind === "hand" &&
      after === prev &&
      r.cause.kind === "edit" &&
      prev.revisions.at(-1)!.cause.kind === "edit"
    )
      prev.revisions.push(r);
    else entries.push({ at: r.updatedAt, kind: "hand", revisions: [r] });
    entries.sort((a, b) => a.at - b.at);
  }
  const revisions: Revisions = {
    current: work.revision,
    previewing,
    locked: live(last) || last?.status === "waiting",
    look,
    restore,
  };
  return (
    <RevisionContext.Provider value={revisions}>
      {!entries.length && <p className={cx("journal-empty")}>{t.journal.empty}</p>}
      <WorkUsage runs={runs} />
      {entries.map((e) =>
        e.kind === "hand" ? (
          <HandEntry key={"hand" + e.revisions[0].revision} revisions={e.revisions} />
        ) : (
          <RunView
            key={e.run.id}
            run={e.run}
            work={work}
            last={e.run === last}
            unfolded={open[e.run.id] ?? (e.run === last && live(e.run))}
            fold={(on) => O({ ...open, [e.run.id]: on })}
            used={used}
            zoom={Z}
            resume={resume}
            restore={restore}
            openTrace={openTrace}
            locale={locale}
            t={t}
          />
        ),
      )}
      {zoom && <Lightbox picture={zoom} close={() => Z(undefined)} />}
    </RevisionContext.Provider>
  );
}
/** Revisions the person made by hand, or brought back, between requests. */
function HandEntry({ revisions }: { revisions: RevisionSummary[] }) {
  const t = useT();
  const latest = revisions.at(-1)!;
  const cause = latest.cause;
  const Icon = cause.kind === "restore" ? RotateCcw : cause.kind === "edit" ? Hand : FilePlus2;
  return (
    <div className={cx("hand")}>
      <Icon size={13} />
      <span>
        {cause.kind === "restore"
          ? t.history.restored(cause.revision)
          : revisions.length > 1
            ? t.history.editedTimes(revisions.length)
            : t.history.edited}
        <small> · {ago(latest.updatedAt)}</small>
      </span>
      <Revision revision={latest.revision} />
    </div>
  );
}
function RunView({
  run: r,
  work,
  last,
  unfolded,
  fold,
  used,
  zoom,
  resume,
  restore,
  openTrace,
  locale,
  t,
}: {
  run: Run;
  work: Work;
  last: boolean;
  unfolded: boolean;
  fold: (on: boolean) => void;
  used: Set<string>;
  zoom: (p: Picture) => void;
  resume: () => void;
  restore: (revision: number) => void;
  openTrace: (runId: string) => void;
  locale: string;
  t: Words;
}) {
  const working = live(r);
  const reply =
    r.status === "completed" && r.steps.at(-1)?.kind === "message" ? r.steps.length - 1 : -1;
  const items: ReactNode[] = [];
  let steps: ReactNode[] = [];
  const flush = () => {
    if (!steps.length) return;
    items.push(
      <ol key={"steps" + items.length} className={cx("steps")}>
        {steps}
      </ol>,
    );
    steps = [];
  };
  // Thoughts in a row read as one step.
  let thinking: Step[] = [];
  const think = (i: number) => {
    if (!thinking.length) return;
    steps.push(
      <Thoughts key={"t" + i} steps={thinking} live={working && i === r.steps.length} />,
    );
    thinking = [];
  };
  r.steps.forEach((s, i) => {
    if (i === reply) return;
    if (s.kind === "thinking" && unfolded) {
      thinking.push(s);
      return;
    }
    think(i);
    if (s.kind === "message" && s.role === "user") {
      flush();
      items.push(
        <div key={i} className={cx("prompt")}>
          {!!s.materials?.length && (
            <span className={cx("prompt-pictures")}>
              {s.materials.map((id) => (
                <img key={id} src={`/materials/thumbs/${id}?size=96`} alt="" />
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
        <div key={i} className={cx("reply", "asked")}>
          <Markdown text={s.text} />
        </div>,
      );
    } else if (unfolded)
      steps.push(
        <StepView
          key={i}
          step={s}
          live={working && i === r.steps.length - 1}
          used={used}
          zoom={zoom}
        />,
      );
  });
  think(r.steps.length);
  flush();
  const count = r.steps.filter((s) => s.kind === "tool" || s.kind === "thinking").length;
  const saved = r.steps.findLast(
    (s): s is Tool<"write_work"> => s.kind === "tool" && s.name === "write_work" && !!s.revision,
  );
  const spent = usage(r, t);
  const facts = [
    !!count && t.journal.steps(count),
    r.elapsedMs && span(r.elapsedMs),
    ...spent.short,
  ].filter(Boolean);
  const answer = reply >= 0 ? (r.steps[reply] as Extract<Step, { kind: "message" }>) : undefined;
  const sources = sourcesOf(answer?.citations);
  const ended = last && r.status === "failed" ? stopped(r, work) : undefined;
  return (
    <article className={cx("run")} data-status={r.status}>
      {items[0]}
      {!!count && (
        <div className={cx("run-head")}>
          <button className={cx("run-fold")} aria-expanded={unfolded} onClick={() => fold(!unfolded)}>
            {working && <i className={cx("now-dot")} />}
            <span>{working ? t.journal.working : t.journal.process}</span>
            <small>{facts.join(" · ")}</small>
          </button>
          {unfolded && (
            <a
              className={cx("run-trace")}
              href={"/traces/" + r.id}
              aria-label={t.journal.trace}
              data-tip={t.journal.trace}
              onClick={(e) => {
                e.preventDefault();
                openTrace(r.id);
              }}
            >
              <SquareArrowOutUpRight size={13} />
            </a>
          )}
        </div>
      )}
      {items.slice(1)}
      {unfolded && !!spent.lines.length && <SpentLines title={t.usage.thisRun} lines={spent.lines} />}
      {working && unfolded && (
        <div className={cx("run-now")}>
          <Current run={r} />
        </div>
      )}
      {answer && (
        <div className={cx("reply")}>
          <Markdown text={answer.text} citations={answer.citations} />
          {!!sources.length && (
            <div className={cx("sources")}>
              <small>{t.journal.sources}</small>
              {sources.map((c) => (
                <a key={c.url} href={c.url} target="_blank" rel="noreferrer" title={c.title}>
                  {c.title || host(c.url)}
                  <span>{host(c.url)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      {!working && saved?.revision !== undefined && (
        <div className={cx("run-result")}>
          <Revision revision={saved.revision} label={t.journal.result(saved.revision)} />
        </div>
      )}
      {r.status === "failed" && (
        <div className={cx("run-error")}>
          <p>{(r.error && localize(r.error, locale as "zh" | "en")) || t.journal.failed}</p>
          {ended && (
            <div className={cx("run-actions")}>
              {ended.clean !== undefined && (
                <button className={cx("secondary small")} onClick={() => restore(ended.clean!)}>
                  {t.now.restore(ended.clean)}
                </button>
              )}
              <button className={cx("primary small")} onClick={resume}>
                {t.now.resume}
              </button>
            </div>
          )}
        </div>
      )}
      {r.status === "cancelled" && <p className={cx("run-note")}>{t.journal.stopped}</p>}
    </article>
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
