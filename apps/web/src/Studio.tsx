import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookMarked,
  BookOpen,
  ChevronRight,
  Compass,
  Eye,
  Globe,
  Lightbulb,
  PenTool,
  Search,
  ImagePlus,
  SquareArrowOutUpRight,
  Wrench,
  X,
} from "lucide-react";
import { Questions } from "./Questions.tsx";
import { Markdown, plain, sourcesOf } from "./Markdown.tsx";
import { cx } from "./cx.ts";
import { span } from "./time.ts";
import { useT, type Words } from "./i18n.tsx";
import { Spinner, useLocale } from "@drawy/ui";
import { localize } from "../../../modules/contracts/messages.ts";
import { money } from "./money.ts";
import { useCan } from "./account.tsx";
import {
  costOf,
  type Run,
  type Step,
  type Work,
  type Picture,
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
/** What a guide step read, in the reader's words; a library drawing goes by its id. */
const guideNames = (step: Extract<ToolStep, { name: "draw_guide" }>, t: Words) => [
  ...step.topics.map((topic) => t.steps.guideTopics[topic] ?? topic),
  ...step.drawings,
];
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
    case "draw_guide":
      return [w.guiding, guideNames(step, t).join(w.list)].filter(Boolean).join(" · ");
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
      return w.writing;
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
            {t.now.restore}
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

/** The version a request ended in, by its number; the versions panel looks at and
 * restores it. */
function Revision({ label }: { label: string }) {
  return <span className={cx("revision")}>{label}</span>;
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
  draw_guide: BookMarked,
  set_brief: Compass,
  find_materials: Search,
  generate_images: ImagePlus,
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
        </span>
      );
    case "draw_guide":
      return (
        <>
          <span className={cx("step-title")}>{w.draw_guide}</span>
          {guideNames(step, t).length > 0 && (
            <code className={cx("step-detail")}>{guideNames(step, t).join(t.now.list)}</code>
          )}
        </>
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
    step.changed && w.changed(step.changed),
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
          {s.title && <b>{s.title}</b>}
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
      {!!facts.length && (
        <div className={cx("draft-foot")}>
          <small>{facts.join(" · ")}</small>
        </div>
      )}
    </div>
  );
}

/** What a run spent on each service: the drawing model's tokens, the searches and pages
 * read, and the pictures painted. */
export function spentBy(run: Run) {
  const u = run.usage;
  return {
    input: u?.input ?? 0,
    cached: u?.cached ?? 0,
    cacheWrite: u?.cacheWrite ?? 0,
    output: u?.output ?? 0,
    reasoning: u?.reasoning ?? 0,
    searches: u?.searches ?? 0,
    pages: u?.pages ?? 0,
    images: u?.images?.count ?? 0,
    imageTokens: (u?.images?.input ?? 0) + (u?.images?.output ?? 0),
    hosted: Object.entries(u?.hosted ?? {}).filter(([n]) => n !== "web_search"),
    failed: {
      attempts: u?.failed?.attempts ?? 0,
      ms: u?.failed?.ms ?? 0,
      input: u?.failed?.input ?? 0,
      cached: u?.failed?.cached ?? 0,
      output: u?.failed?.output ?? 0,
      estimated: u?.failed?.estimated ?? 0,
      invalidCalls: u?.failed?.invalidCalls ?? 0,
      images: u?.failed?.images ?? 0,
    },
    cost: costOf(u, run.prices),
  };
}
type Spent = ReturnType<typeof spentBy>;
const sum = (a: number, b: number) => a + b;
const total = (list: Spent[]): Spent => ({
  input: list.map((s) => s.input).reduce(sum, 0),
  cached: list.map((s) => s.cached).reduce(sum, 0),
  cacheWrite: list.map((s) => s.cacheWrite).reduce(sum, 0),
  output: list.map((s) => s.output).reduce(sum, 0),
  reasoning: list.map((s) => s.reasoning).reduce(sum, 0),
  searches: list.map((s) => s.searches).reduce(sum, 0),
  pages: list.map((s) => s.pages).reduce(sum, 0),
  images: list.map((s) => s.images).reduce(sum, 0),
  imageTokens: list.map((s) => s.imageTokens).reduce(sum, 0),
  hosted: list.flatMap((s) => s.hosted),
  failed: {
    attempts: list.map((s) => s.failed.attempts).reduce(sum, 0),
    ms: list.map((s) => s.failed.ms).reduce(sum, 0),
    input: list.map((s) => s.failed.input).reduce(sum, 0),
    cached: list.map((s) => s.failed.cached).reduce(sum, 0),
    output: list.map((s) => s.failed.output).reduce(sum, 0),
    estimated: list.map((s) => s.failed.estimated).reduce(sum, 0),
    invalidCalls: list.map((s) => s.failed.invalidCalls).reduce(sum, 0),
    images: list.map((s) => s.failed.images).reduce(sum, 0),
  },
  cost: list.some((s) => s.cost)
    ? {
        author: list.map((s) => s.cost?.author ?? 0).reduce(sum, 0),
        search: list.map((s) => s.cost?.search ?? 0).reduce(sum, 0),
        image: list.map((s) => s.cost?.image ?? 0).reduce(sum, 0),
        failed: list.map((s) => s.cost?.failed ?? 0).reduce(sum, 0),
        total: list.map((s) => s.cost?.total ?? 0).reduce(sum, 0),
      }
    : undefined,
});
/** Who searched for a run, as the user picked it. */
const searchedBy = (run: Run, t: Words) =>
  !run.services
    ? undefined
    : run.services.search === "builtin"
      ? t.composer.searchBuiltinBy(run.services.author)
      : run.services.search === "service"
        ? run.services.searchBy
        : t.composer.searchOff;
/** Spending at a glance: what it cost, the tokens and how much of the input the cache
 * served, searches and pictures as tiles; then how the cost splits between the services,
 * and one line for each with what it used and who served it. */
function Stats({
  s,
  by,
  elapsed,
}: {
  s: Spent;
  by?: { author?: string; search?: string; image?: string };
  /** How long it took, for one run. */
  elapsed?: number;
}) {
  const t = useT(),
    w = t.usage;
  const hit = s.input ? Math.round((s.cached / s.input) * 100) : 0;
  const services = [
    {
      key: "author",
      label: w.author,
      who: by?.author,
      parts: [w.inputShort(k(s.input)), w.outputShort(k(s.output)), !!s.reasoning && w.reasoningShort(k(s.reasoning))],
      cost: s.cost?.author,
      used: s.input + s.output > 0,
    },
    {
      key: "search",
      label: w.search,
      who: by?.search,
      parts: [w.searchCalls(s.searches), !!s.pages && w.pages(s.pages)],
      cost: s.cost?.search,
      used: s.searches + s.pages > 0,
    },
    {
      key: "image",
      label: w.image,
      who: by?.image,
      parts: [w.images(s.images), !!s.imageTokens && w.tokens(k(s.imageTokens))],
      cost: s.cost?.image,
      used: s.images > 0,
    },
    {
      key: "failed",
      label: w.failed,
      who: undefined,
      parts: [
        !!s.failed.attempts && w.failedAttempts(s.failed.attempts),
        !!s.failed.attempts && w.failedTime(Math.round(s.failed.ms / 1000)),
        !!s.failed.attempts &&
          (s.failed.estimated ? w.failedOutputAbout(k(s.failed.output)) : w.failedOutput(k(s.failed.output))),
        !!s.failed.invalidCalls && w.failedCalls(s.failed.invalidCalls),
        !!s.failed.images && w.failedImages(s.failed.images),
      ],
      cost: s.cost?.failed,
      used: !!(s.failed.attempts || s.failed.invalidCalls || s.failed.images),
    },
  ].filter((r) => r.used);
  const total = s.cost?.total ?? 0;
  const tiles = [
    { key: "cost", label: w.cost, value: s.cost ? money(total) : w.unpriced },
    {
      key: "tokens",
      label: w.tokensLabel,
      value: k(s.input + s.output),
      sub: s.input ? w.cacheHit(hit) : undefined,
    },
    ...(elapsed ? [{ key: "time", label: w.elapsed, value: span(elapsed) }] : []),
    ...(s.searches || s.pages
      ? [{ key: "search", label: w.searchesLabel, value: String(s.searches), sub: s.pages ? w.pagesShort(s.pages) : undefined }]
      : []),
    ...(s.images ? [{ key: "images", label: w.imagesLabel, value: String(s.images) }] : []),
  ];
  return (
    <div className={cx("spend")}>
      <dl className={cx("spend-tiles")}>
        {tiles.map((tile) => (
          <div key={tile.key} data-key={tile.key}>
            <dt>{tile.label}</dt>
            <dd>
              <b>{tile.value}</b>
              {tile.sub && <small>{tile.sub}</small>}
            </dd>
          </div>
        ))}
      </dl>
      {total > 0 && services.filter((r) => r.cost).length > 1 && (
        <div className={cx("spend-split")} role="img" aria-label={w.split}>
          {services
            .filter((r) => r.cost)
            .map((r) => (
              <i
                key={r.key}
                data-key={r.key}
                style={{ flexGrow: r.cost! / total }}
                title={`${r.label} ${money(r.cost!)}`}
              />
            ))}
        </div>
      )}
      <ul className={cx("spend-rows")}>
        {services.map((r) => (
          <li key={r.key} data-key={r.key}>
            <i className={cx("spend-swatch")} />
            <span className={cx("spend-name")}>
              <b>{r.label}</b>
              {r.who && <small title={r.who}>{r.who}</small>}
            </span>
            <span className={cx("spend-parts")}>
              {(r.parts.filter(Boolean) as string[]).map((part) => (
                <em key={part}>{part}</em>
              ))}
            </span>
            <span className={cx("spend-cost")}>
              {r.cost === undefined ? "—" : money(r.cost)}
              {total > 0 && !!r.cost && <small>{Math.round((r.cost / total) * 100)}%</small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
/** What the whole work has spent over every request, service by service. */
function WorkUsage({ runs }: { runs: Run[] }) {
  const t = useT(),
    manages = useCan()("models.manage");
  const [open, setOpen] = useState(false);
  const s = total(runs.map(spentBy));
  if (!s.input && !s.output && !s.searches && !s.pages && !s.images)
    return null;
  const names = (pick: (r: Run) => string | undefined) =>
    [...new Set(runs.map(pick).filter(Boolean))].join(t.now.list) || undefined;
  return (
    <div className={cx("work-usage")} data-open={open || undefined}>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        <BarChart3 size={14} />
        <b>{t.usage.allRuns(runs.length)}</b>
        <span className={cx("usage-chips")}>
          {[
            s.cost && money(s.cost.total),
            t.usage.tokens(k(s.input + s.output)),
            !!s.searches && t.usage.searches(s.searches),
            !!s.images && t.usage.images(s.images),
          ]
            .filter(Boolean)
            .map((x) => (
              <em key={x as string}>{x}</em>
            ))}
        </span>
        <ChevronRight size={13} />
      </button>
      {open && (
        <Stats
          s={s}
          by={!manages ? { author: names((r) => r.services?.label) } : {
            author: names((r) => r.services?.author),
            search: names((r) =>
              r.services?.search === "off" ? undefined : searchedBy(r, t),
            ),
            image: names((r) =>
              spentBy(r).images ? r.services?.image : undefined,
            ),
          }}
        />
      )}
    </div>
  );
}

/** The conversation with the author and how it went about each request, in the order
 * they happened; the drafts each saved are kept in the drafts panel. */
export function Studio({
  runs,
  loaded,
  work,
  restore,
  resume,
  openTrace,
  versionOf,
}: {
  runs: Run[];
  /** Whether the work's run history has arrived, so no runs means there are none. */
  loaded: boolean;
  work: Work;
  /** The number of the version a revision belongs to. */
  versionOf: (revision: number) => number | undefined;
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
  return (
    <>
      {!runs.length &&
        (loaded ? (
          <p className={cx("journal-empty")}>{t.journal.empty}</p>
        ) : (
          <Spinner />
        ))}
      <WorkUsage runs={runs} />
      {runs.map((run) => (
        <RunView
          key={run.id}
          run={run}
          work={work}
          last={run === last}
          unfolded={open[run.id] ?? (run === last && live(run))}
          fold={(on) => O({ ...open, [run.id]: on })}
          used={used}
          zoom={Z}
          resume={resume}
          restore={restore}
          openTrace={openTrace}
          versionOf={versionOf}
          locale={locale}
          t={t}
        />
      ))}
      {zoom && <Lightbox picture={zoom} close={() => Z(undefined)} />}
    </>
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
  versionOf,
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
  versionOf: (revision: number) => number | undefined;
  locale: string;
  t: Words;
}) {
  const manages = useCan()("models.manage");
  const [showStats, setShowStats] = useState(false);
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
  const facts = [
    !!count && t.journal.steps(count),
    r.elapsedMs && span(r.elapsedMs),
  ].filter(Boolean);
  const spent = spentBy(r);
  const priced = !working && !!r.usage && (spent.input + spent.output > 0 || !!spent.images);
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
          {priced && (
            <button
              className={cx("run-stats")}
              aria-expanded={showStats}
              data-tip={showStats ? t.usage.hideStats : t.usage.showStats}
              onClick={() => setShowStats(!showStats)}
            >
              <BarChart3 size={13} />
              <span>{spent.cost ? money(spent.cost.total) : t.usage.tokens(k(spent.input + spent.output))}</span>
            </button>
          )}
          {unfolded && manages && (
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
      {showStats && priced && (
        <Stats
          s={spent}
          elapsed={r.elapsedMs}
          by={!manages ? { author: r.services?.label } : {
            author:
              r.services &&
              [
                r.services.author,
                r.services.effort && t.settings.efforts[r.services.effort],
                r.services.speed &&
                  r.services.speed !== "default" &&
                  t.settings.speeds[r.services.speed],
              ]
                .filter(Boolean)
                .join(" · "),
            search: searchedBy(r, t),
            image: r.services?.image,
          }}
        />
      )}
      {items.slice(1)}
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
      {!working && saved?.revision !== undefined && versionOf(saved.revision) !== undefined && (
        <div className={cx("run-result")}>
          <Revision label={t.journal.result(versionOf(saved.revision)!)} />
        </div>
      )}
      {r.status === "failed" && (
        <div className={cx("run-error")}>
          <p>{(r.error && localize(r.error, locale as "zh" | "en")) || t.journal.failed}</p>
          {ended && (
            <div className={cx("run-actions")}>
              {ended.clean !== undefined && (
                <button className={cx("secondary small")} onClick={() => restore(ended.clean!)}>
                  {t.now.restore}
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
