import { useEffect, useRef, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Check,
  History,
  ImageUp,
  MessageSquareText,
  Share,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import type { Canvas, Pointed } from "../../../../modules/canvas/index.ts";
import {
  versionOf,
  type Instance,
  type Selection,
  type Target,
  type Work,
} from "../../../../modules/contracts/index.ts";
import { shownName } from "../../../../modules/editing/index.ts";
import { useAccount } from "../account.tsx";
import { Composer, Unconnected } from "../Composer.tsx";
import { Drafts } from "../Drafts.tsx";
import { ExportItems, useExports } from "../Export.tsx";
import type { Feedback } from "../feedback.ts";
import { useT } from "../i18n.tsx";
import { counted } from "../probe.ts";
import { DetailView, SceneView } from "../SceneView.tsx";
import { useSelect } from "../session/store.ts";
import type { Snapshot, WorkSession } from "../session/work.ts";
import type { Asking } from "../shell.ts";
import { Now, Studio } from "../Studio.tsx";
import { cx as shared } from "../cx.ts";
import { cx } from "./cx.ts";

/* The parts of the phone work page. Each reads from the session only what it shows, as on
 * the desktop page, so a run that changes many times a second draws again only the canvas,
 * the status line and the studio while it is open. */

/** Values compared by what they hold, for small lists built afresh from each work. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A module by its name, as the person sees it. */
export function nameIn(s: Snapshot, id: string): string {
  const m = s.scene?.modules.find((x) => x.id === id);
  return m && s.work ? shownName(s.work, m) : id;
}

/** The pictures a module shows: the picture materials its data names. */
export function picturesIn(work: Work, m: Instance) {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (work.materials[v]?.kind === "picture") found.add(v);
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(m.data);
  return [...found];
}

export type SheetKind = "" | "studio" | "versions" | "share" | "scenes";

/** The way home, the work's title (which opens its scenes and its name), and undoing,
 * the versions and sharing, floating over the top of the drawing. */
export function TopBar({
  session,
  back,
  open,
  undo,
}: {
  session: WorkSession;
  back: () => void;
  open: (sheet: SheetKind) => void;
  undo: () => void;
}) {
  counted("phone.top");
  const t = useT();
  const s = useSelect(session, (s) => ({
    title: s.work!.title,
    scene: s.scene?.parentId ? s.scene.title : undefined,
    undoable: s.undoable && !s.working,
    drawn: !!s.scene?.modules.length,
  }));
  return (
    <header className={cx("bar")}>
      <button className={cx("round")} aria-label={t.phone.back} onClick={back}>
        <ChevronLeft size={20} />
      </button>
      <button className={cx("title")} aria-label={t.phone.scenes} onClick={() => open("scenes")}>
        <span>{s.scene ?? s.title}</span>
        {s.scene && <small>{s.title}</small>}
        <ChevronDown size={15} />
      </button>
      <button className={cx("round")} aria-label={t.phone.undo} disabled={!s.undoable} onClick={undo}>
        <Undo2 size={18} />
      </button>
      <button className={cx("round")} aria-label={t.phone.versions} onClick={() => open("versions")}>
        <History size={18} />
      </button>
      <button
        className={cx("round")}
        aria-label={t.phone.share}
        disabled={!s.drawn}
        onClick={() => open("share")}
      >
        <Share size={18} />
      </button>
    </header>
  );
}

/** The drawing, filling the screen. Fingers pinch and move it; a tap selects a part (or
 * follows where it leads), a long press selects any part, a double tap changes its words,
 * and a part selected moves with a finger. */
export function PhoneCanvas({
  session,
  view,
  open,
  select,
  point,
}: {
  session: WorkSession;
  view: (canvas: Canvas | undefined) => void;
  open: (target: Target) => void;
  select: (selection: Selection[]) => void;
  point: (pointed: Pointed) => void;
}) {
  counted("phone.canvas");
  const { display, sceneId, locked, run, id } = useSelect(session, (s) => ({
    id: s.id,
    display: s.display!,
    sceneId: s.sceneId,
    locked: s.locked,
    run: s.engaged ? s.run : undefined,
  }));
  return (
    <SceneView
      key={id}
      work={display.work}
      version={display.version}
      sceneId={sceneId}
      run={run}
      disabled={locked}
      editing={false}
      controls={false}
      resizable={false}
      quiet={session.quiet}
      view={view}
      open={open}
      select={select}
      commit={session.ops.move}
      point={point}
      hold={() => navigator.vibrate?.(8)}
    />
  );
}

/** The notes over the composer: the version looked at, what went wrong or well, going back
 * to take back, and hand edits to save (or to decide about before a request goes). */
export function Notes({
  session,
  feedback,
  restore,
  undo,
}: {
  session: WorkSession;
  feedback: Feedback;
  restore: (revision: number) => void;
  undo: () => void;
}) {
  counted("phone.notes");
  const t = useT();
  const { attempt } = feedback;
  const { error, notice } = useSelect(feedback, (f) => f);
  const s = useSelect(session, (s) => ({
    preview: s.preview?.revision,
    looked: s.preview && (versionOf(s.versions, s.preview.revision)?.number ?? 0),
    next: (s.versions.at(-1)?.number ?? 0) + 1,
    back: s.back,
    holding: s.holding,
    unsaved: s.unsaved,
    engaged: s.engaged,
    working: s.working,
    locked: s.locked,
  }));
  return (
    <>
      {error && (
        <div className={cx("note")} data-tone="error" role="alert">
          <span>{error}</span>
          <button aria-label={t.close} onClick={feedback.dismiss}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && !s.back && (
        <div className={cx("note")} role="status">
          <span>{notice}</span>
        </div>
      )}
      {s.preview !== undefined && (
        <div className={cx("note")} role="status">
          <span>{t.history.previewing(s.looked ?? 0)}</span>
          <span className={cx("choices")}>
            <button className={cx("secondary small")} onClick={session.endPreview}>
              {t.history.back}
            </button>
            <button
              className={cx("primary small")}
              disabled={s.working}
              onClick={() => restore(s.preview!)}
            >
              {t.history.restoreThis}
            </button>
          </span>
        </div>
      )}
      {s.back && s.preview === undefined && !s.holding && (
        <div className={cx("note")} role="status">
          <span>
            {s.back.to.kind === "version" ? t.history.wentBack(s.back.to.version) : t.unsaved.discarded}
          </span>
          <button className={cx("secondary small")} onClick={undo}>
            {t.history.undoBack}
          </button>
        </div>
      )}
      {s.holding ? (
        <div className={cx("note")} role="alertdialog">
          <i className={cx("dot")} />
          <span>{t.unsaved.ask(Math.max(1, s.unsaved))}</span>
          <span className={cx("choices")}>
            <button className={cx("secondary small")} onClick={() => void session.decide("cancel")}>
              {t.unsaved.cancel}
            </button>
            <button
              className={cx("secondary small")}
              onClick={() => void attempt(() => session.decide("discard"))}
            >
              {t.unsaved.discardAndSend}
            </button>
            <button
              className={cx("primary small")}
              onClick={() => void attempt(() => session.decide("save"))}
            >
              {t.unsaved.saveAndSend}
            </button>
          </span>
        </div>
      ) : (
        !!s.unsaved &&
        s.preview === undefined &&
        !s.engaged && (
          <div className={cx("note")} role="status">
            <i className={cx("dot")} />
            <span>{t.unsaved.title(s.unsaved)}</span>
            <button
              className={cx("secondary small")}
              disabled={s.locked}
              onClick={() => void attempt(session.discard)}
            >
              {t.unsaved.discard}
            </button>
            <button
              className={cx("primary small")}
              disabled={s.locked}
              onClick={() => void attempt(session.save)}
            >
              <Check size={13} />
              {t.unsaved.saveShort}
            </button>
          </div>
        )
      )}
    </>
  );
}

/** What can be done with a finger to the part selected; the rest is described to the
 * author. Moving it is a drag on the drawing itself. */
export function Actions({
  session,
  id,
  canvas,
  retype,
  swap,
  remove,
  describe,
  deselect,
}: {
  session: WorkSession;
  id: string;
  canvas?: Canvas;
  retype: () => void;
  swap: (material: string) => void;
  remove: () => void;
  describe: () => void;
  deselect: () => void;
}) {
  counted("phone.actions");
  const t = useT();
  const s = useSelect(session, (s) => {
    const m = s.scene?.modules.find((x) => x.id === id);
    return {
      name: nameIn(s, id),
      picture: m && s.work ? picturesIn(s.work, m)[0] : undefined,
      locked: s.locked,
    };
  });
  const words = !!canvas?.wordsIn(id);
  if (s.locked) return null;
  return (
    <div className={cx("actions")} role="toolbar" aria-label={t.phone.actions}>
      <b>{s.name}</b>
      {words && (
        <button onClick={retype}>
          <Type size={18} />
          {t.phone.retype}
        </button>
      )}
      {s.picture && (
        <button onClick={() => swap(s.picture!)}>
          <ImageUp size={18} />
          {t.phone.swap}
        </button>
      )}
      <button data-ask onClick={describe}>
        <MessageSquareText size={18} />
        {t.phone.describe}
      </button>
      <button data-danger onClick={remove}>
        <Trash2 size={18} />
        {t.phone.remove}
      </button>
      <button aria-label={t.phone.deselect} onClick={deselect}>
        <X size={18} />
      </button>
    </div>
  );
}

/** What the author is doing, its question or its reply, at the top of the composer. A tap
 * on it opens the studio. */
export function Status({
  session,
  putAway,
  answer,
  choose,
  reveal,
  dismiss,
  resume,
  restore,
  feedback,
}: {
  session: WorkSession;
  putAway: boolean;
  answer: (text: string) => void;
  choose: (text: string) => void;
  reveal: () => void;
  dismiss: () => void;
  resume: () => void;
  restore: (revision: number) => void;
  feedback: Feedback;
}) {
  counted("phone.status");
  const s = useSelect(session, (s) => ({
    run: s.run,
    work: s.work!,
    offline: s.offline,
    waiting: s.waiting,
    working: s.working,
    pictures: !!s.scene?.modules.length,
  }));
  if (!(s.offline || s.waiting || s.working || !putAway)) return null;
  return (
    <Now
      run={s.run}
      work={s.work}
      offline={s.offline}
      pictures={s.pictures}
      answer={answer}
      choose={choose}
      cancel={() => void feedback.attempt(session.cancel)}
      reveal={reveal}
      dismiss={dismiss}
      resume={resume}
      restore={restore}
    />
  );
}

/** The composer at the foot of the page. It reads the request itself, so typing draws only
 * it; while the author draws it folds to its progress and the button that stops it. */
export function PhoneComposer({
  session,
  asking,
  feedback,
  go,
  status,
  quote,
  unquote,
  selecting,
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
  selecting: boolean;
  send: () => void;
  stop: () => void;
}) {
  counted("phone.composer");
  const t = useT();
  const user = useAccount()!;
  const { draft } = asking;
  const request = useSelect(draft, (r) => r);
  const s = useSelect(session, (s) => ({
    working: s.working,
    waiting: s.waiting,
    engaged: s.engaged,
    busy: s.sending || !s.loaded || !s.synced,
  }));
  const note = request.handed && request.text && (
    <div className={shared("now")}>
      <span className={shared("now-line")}>{request.handed}</span>
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
      placeholder={
        s.waiting
          ? t.composer.answering
          : selecting
            ? t.composer.selected
            : s.working
              ? t.composer.working
              : t.composer.continue
      }
      status={(asking.blocked === "unconnected" && <Unconnected go={go} />) || note || status}
      working={s.working}
      busy={s.busy}
      send={send}
      stop={stop}
      attach={(files) => void feedback.attempt(() => draft.upload(files))}
      pick={asking.pick}
      models={s.engaged ? undefined : asking.models}
      collapsed={s.working}
      quota={user.quota}
      spent={asking.blocked === "spent" && !s.waiting}
      choose={asking.choose}
    />
  );
}

/** A sheet from the bottom of the screen, over a dimmed page that closes it when tapped. */
export function Sheet({
  title,
  tall = false,
  padded = false,
  close,
  body,
  children,
}: {
  title: string;
  tall?: boolean;
  /** Whether what it holds needs room around it. */
  padded?: boolean;
  close: () => void;
  body?: React.Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <>
      <div className={cx("scrim")} onClick={close} />
      <section
        className={cx("sheet")}
        data-size={tall ? "tall" : undefined}
        role="dialog"
        aria-modal
        aria-label={title}
      >
        <i className={cx("grip")} />
        <header>
          <h2>{title}</h2>
          <button aria-label={t.phone.close} onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className={cx("body")} data-padded={padded || undefined} ref={body}>
          {children}
        </div>
      </section>
    </>
  );
}

/** The studio in a tall sheet, following the run at its foot. */
export function StudioSheet({
  session,
  close,
  restore,
  resume,
  go,
}: {
  session: WorkSession;
  close: () => void;
  restore: (revision: number) => void;
  resume: () => void;
  go: (path: string) => void;
}) {
  counted("phone.studio");
  const t = useT();
  const body = useRef<HTMLDivElement>(null);
  const s = useSelect(session, (s) => ({ runs: s.runs, loaded: s.loaded, work: s.work!, versions: s.versions }));
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.runs]);
  return (
    <Sheet title={t.phone.studio} tall padded close={close} body={body}>
      <Studio
        runs={s.runs}
        loaded={s.loaded}
        work={s.work}
        restore={restore}
        versionOf={(r) => versionOf(s.versions, r)?.number}
        resume={resume}
        openTrace={(id) => go("/traces/" + id)}
      />
    </Sheet>
  );
}

/** Every version: a tap looks at one on the drawing (the sheet goes, so it can be seen),
 * and going back, saving or throwing away hand edits are a tap each. */
export function VersionsSheet({
  session,
  close,
  restore,
  feedback,
}: {
  session: WorkSession;
  close: () => void;
  restore: (revision: number) => void;
  feedback: Feedback;
}) {
  counted("phone.versions");
  const t = useT();
  const { attempt } = feedback;
  const s = useSelect(session, (s) => ({
    versions: s.versions,
    unsaved: s.unsaved,
    current: s.work!.revision,
    previewing: s.preview?.revision,
    locked: s.engaged || !s.loaded,
  }));
  return (
    <Sheet title={t.phone.versions} close={close}>
      <Drafts
        versions={s.versions}
        unsaved={s.unsaved}
        current={s.current}
        previewing={s.previewing}
        locked={s.locked}
        look={(r) => {
          close();
          void attempt(() => session.look(r));
        }}
        restore={(r) => {
          close();
          restore(r);
        }}
        save={() => void attempt(session.save)}
        discard={() => void attempt(session.discard)}
      />
    </Sheet>
  );
}

/** Sharing first, then the files and cards to save. */
export function ShareSheet({
  session,
  close,
  feedback,
}: {
  session: WorkSession;
  close: () => void;
  feedback: Feedback;
}) {
  const t = useT();
  const s = useSelect(session, (s) => ({ work: s.work!, sceneId: s.sceneId }));
  const exports = useExports({ ...s, fail: feedback.fail, done: feedback.say, close });
  return (
    <Sheet title={t.phone.share} close={close}>
      <div className={cx("exports")} role="menu">
        <ExportItems exports={exports} shareFirst />
      </div>
    </Sheet>
  );
}

/** The work's title, to change, and its scenes, to go to. */
export function ScenesSheet({
  session,
  close,
  enter,
  rename,
}: {
  session: WorkSession;
  close: () => void;
  enter: (id: string) => void;
  rename: (title: string) => void;
}) {
  const t = useT();
  const s = useSelect(
    session,
    (s) => ({
      title: s.work!.title,
      sceneId: s.sceneId,
      scenes: Object.values(s.work!.scenes).map((p) => ({ id: p.id, title: p.title, parentId: p.parentId })),
    }),
    same,
  );
  const typed = useRef(s.title),
    renamed = useRef(s.title);
  const done = () => {
    const next = typed.current.trim();
    if (!next || next === renamed.current) return;
    renamed.current = next;
    rename(next);
  };
  return (
    <Sheet
      title={t.phone.scenes}
      close={() => {
        done();
        close();
      }}
    >
      <div className={cx("scenes")}>
        <label>
          {t.phone.title}
          <input
            defaultValue={s.title}
            maxLength={80}
            enterKeyHint="done"
            onChange={(e) => (typed.current = e.target.value)}
            onBlur={done}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
            }}
          />
        </label>
        {s.scenes.length > 1 &&
          s.scenes.map((p) => (
            <button
              key={p.id}
              data-child={!!p.parentId || undefined}
              aria-current={p.id === s.sceneId || undefined}
              onClick={() => {
                close();
                enter(p.id);
              }}
            >
              {p.parentId ? p.title : s.title}
            </button>
          ))}
      </div>
    </Sheet>
  );
}

/** The detail page open over the scene, as the work has it now. */
export function Detail({
  session,
  detailId,
  close,
}: {
  session: WorkSession;
  detailId?: string;
  close: () => void;
}) {
  const detail = useSelect(session, (s) => (detailId ? s.work!.details[detailId] : undefined));
  return detail ? <DetailView detail={detail} close={close} /> : null;
}
