import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { ChevronDown, X, MessagesSquare, PencilLine, History, Check, Undo2, Redo2 } from "lucide-react";
import type { Canvas, CanvasOptions, Pointed } from "../../../../modules/canvas/index.ts";
import { versionOf, type Selection, type Target } from "../../../../modules/contracts/index.ts";
import { shownName } from "../../../../modules/editing/index.ts";
import { useAccount } from "../account.tsx";
import { Composer, Unconnected } from "../Composer.tsx";
import { cx } from "../cx.ts";
import { Drafts } from "../Drafts.tsx";
import { SelectionBar } from "../EditBar.tsx";
import { EditMenu } from "../EditMenu.tsx";
import { EditTray } from "../EditTray.tsx";
import type { BoardSettings } from "../EditView.tsx";
import { EditPanel } from "../Editor.tsx";
import { ExportMenu } from "../Export.tsx";
import type { Feedback } from "../feedback.ts";
import { useT } from "../i18n.tsx";
import { counted } from "../probe.ts";
import { Rename } from "../Rail.tsx";
import { SceneView, DetailView } from "../SceneView.tsx";
import { Seal } from "../Title.tsx";
import { useSelect } from "../session/store.ts";
import type { Change, Snapshot, WorkSession } from "../session/work.ts";
import type { Asking } from "../shell.ts";
import { Now, Studio } from "../Studio.tsx";
import type { EditOps, useEditing } from "./editing.ts";

/* The parts of the desktop work page. Each reads from the session only what it shows, so
 * the author's run, which changes many times a second while it draws, draws again only
 * the parts that show it (the canvas, the status line and the studio). */

/** Values compared by what they hold, for small lists built afresh from each work. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A module by its name, or a link by the names of the modules it joins. */
export function nameIn(s: Snapshot, id: string): string {
  const l = s.scene?.links.find((x) => x.id === id);
  if (l) return `${nameIn(s, l.from.moduleId)} → ${nameIn(s, l.to.moduleId)}`;
  const m = s.scene?.modules.find((x) => x.id === id);
  return m && s.work ? shownName(s.work, m) : id;
}

/** The work's title and the way down to the scene in view, and every scene to go to. */
export function Topbar({
  session,
  titling,
  setTitling,
  menu,
  setMenu,
  enter,
  rename,
  drafting,
  versions,
}: {
  session: WorkSession;
  titling: boolean;
  setTitling: (on: boolean) => void;
  menu: boolean;
  setMenu: (on: boolean) => void;
  enter: (id: string) => void;
  rename: (title: string) => void;
  /** Whether the versions are open, and the way to open or close them. */
  drafting: boolean;
  versions: () => void;
}) {
  counted("topbar");
  const t = useT();
  const { title, sceneId, scenes, version, unsaved } = useSelect(
    session,
    (s) => ({
      title: s.work!.title,
      sceneId: s.sceneId,
      scenes: Object.values(s.work!.scenes).map((p) => ({ id: p.id, title: p.title, parentId: p.parentId })),
      version: s.versions.at(-1)?.number ?? 0,
      unsaved: s.unsaved,
    }),
    same,
  );
  // The seal is pressed down when a version is made while the page is open, not on arrival.
  const arrived = useRef(version);
  if (!arrived.current) arrived.current = version;
  const crumbs: typeof scenes = [];
  for (let at = scenes.find((p) => p.id === sceneId); at; )
    crumbs.unshift(at), (at = at.parentId ? scenes.find((p) => p.id === at!.parentId) : undefined);
  return (
    <header className={cx("topbar")}>
      <nav className={cx("crumbs")}>
        {crumbs.map((p, i) => (
          <span key={p.id}>
            {i > 0 && <i>/</i>}
            {i === 0 && titling ? (
              <Rename
                title={title}
                done={(next) => {
                  setTitling(false);
                  if (next) rename(next);
                }}
              />
            ) : (
              <button
                aria-current={p.id === sceneId || undefined}
                data-tip={i === 0 && p.id === sceneId ? t.work.rename : undefined}
                onClick={() => (i === 0 && p.id === sceneId ? setTitling(true) : enter(p.id))}
              >
                {i === 0 ? title : p.title}
              </button>
            )}
          </span>
        ))}
        {scenes.length > 1 && (
          <span className={cx("scene-menu")} data-scene-menu>
            <button aria-label={t.work.scenes} aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <ChevronDown size={15} />
            </button>
            {menu && (
              <span className={cx("scene-list")}>
                {scenes.map((p) => (
                  <button
                    key={p.id}
                    data-child={!!p.parentId || undefined}
                    aria-current={p.id === sceneId || undefined}
                    onClick={() => enter(p.id)}
                  >
                    {p.parentId ? p.title : title}
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
      </nav>
      {version > 0 && (
        <button
          className={cx("topbar-version")}
          aria-label={unsaved ? `${t.rail.version(version)} · ${t.rail.unsaved}` : t.rail.version(version)}
          aria-pressed={drafting}
          data-tip={unsaved ? `${t.rail.version(version)} · ${t.rail.unsaved}` : t.rail.version(version)}
          onClick={versions}
        >
          <Seal key={version} version={version} fresh={version !== arrived.current} />
          {unsaved > 0 && <i />}
        </button>
      )}
    </header>
  );
}

/** The canvas: what the work shows (or a version looked at), and the author's run while it
 * draws or asks, whose layout and gaze show on it. */
export function CanvasArea({
  session,
  editing,
  view,
  open,
  select,
  selectLink,
  point,
  hand,
  board,
  setBoard,
  help,
}: {
  session: WorkSession;
  editing: boolean;
  view: (canvas: Canvas | undefined) => void;
  open: (target: Target) => void;
  select: (selection: Selection[]) => void;
  selectLink: NonNullable<CanvasOptions["selectLink"]>;
  point: (pointed: Pointed) => void;
  hand: ReturnType<typeof useEditing>;
  /** How the drawing board is set up while editing. */
  board: BoardSettings;
  setBoard: (change: Partial<BoardSettings>) => void;
  /** Shows the shortcuts and gestures. */
  help: () => void;
}) {
  counted("canvas");
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
      editing={editing}
      quiet={session.quiet}
      view={view}
      open={open}
      select={select}
      commit={hand.ops.move}
      point={point}
      connect={hand.ops.connect}
      extend={hand.ops.extend}
      duplicate={hand.ops.duplicateBy}
      selectLink={selectLink}
      reconnect={hand.ops.reconnect}
      menu={hand.setMenu}
      place={hand.place}
      board={board}
      setBoard={setBoard}
      help={help}
    />
  );
}

/** The tools beside the canvas while editing, the bar over what is selected and the menu
 * on a right click. */
export function EditOverlay({
  session,
  hand,
  canvas,
  stage,
  ids,
  link,
  retyping,
  ask,
}: {
  session: WorkSession;
  hand: ReturnType<typeof useEditing>;
  canvas?: Canvas;
  stage: HTMLElement | null;
  ids: string[];
  link: string | null;
  retyping: boolean;
  ask: () => void;
}) {
  counted("overlay");
  const { some, all, work, sceneId } = useSelect(session, (s) => {
    const groups = ids.map((id) => s.scene?.modules.find((m) => m.id === id)?.group);
    return {
      some: groups.some(Boolean),
      all: !!groups.length && groups.every((g) => g && g === groups[0]),
      work: s.shown!,
      sceneId: s.sceneId,
    };
  });
  return (
    <>
      <EditTray tool={hand.tool} setTool={hand.setTool} ops={hand.ops} />
      <SelectionBar
        canvas={canvas}
        stage={stage}
        work={work}
        sceneId={sceneId}
        ops={hand.ops}
        selected={ids}
        link={link}
        grouped={all}
        hidden={!!hand.menu || retyping || hand.tool !== "select"}
        ask={ask}
        more={hand.setMenu}
      />
      {hand.menu && (
        <EditMenu
          at={hand.menu}
          ops={hand.ops}
          selected={ids}
          link={link}
          grouped={some}
          clipped={hand.clipped}
          brushed={hand.brushed}
          close={() => hand.setMenu(undefined)}
          ask={ask}
          fit={() => canvas?.fit(true, 520, "whole")}
        />
      )}
    </>
  );
}

/** What the author is doing, its question or its reply, at the top of the composer. */
export function Status({
  session,
  journal,
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
  journal: boolean;
  putAway: boolean;
  answer: (text: string) => void;
  choose: (text: string) => void;
  reveal: () => void;
  dismiss: () => void;
  resume: () => void;
  restore: (revision: number) => void;
  feedback: Feedback;
}) {
  counted("status");
  const s = useSelect(session, (s) => ({
    run: s.run,
    work: s.work!,
    offline: s.offline,
    waiting: s.waiting,
    working: s.working,
    pictures: !!s.scene?.modules.length,
  }));
  // While drawing, the bar always shows how far it has got; with the studio open, which
  // tells the rest, only the stages.
  if (!(s.offline || s.waiting || s.working || (!journal && !putAway))) return null;
  return (
    <Now
      compact={journal && s.working}
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

/** The bars over the composer: the version looked at, what went wrong or well, going back
 * to take back, and hand edits to save (or decide about before a request goes). */
export function Bars({
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
  counted("bars");
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
      {s.preview !== undefined && (
        <div className={cx("preview-bar")} role="status">
          <span>{t.history.previewing(s.looked ?? 0)}</span>
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
        </div>
      )}
      {error && (
        <div className={cx("toast-error")} role="alert">
          <span>{error}</span>
          <button aria-label={t.close} onClick={feedback.dismiss}>
            <X size={13} />
          </button>
        </div>
      )}
      {notice && !s.back && (
        <div className={cx("toast-error")} data-tone="ok" role="status">
          <span>{notice}</span>
        </div>
      )}
      {s.back && s.preview === undefined && !s.holding && (
        <div className={cx("toast-error")} data-tone="ok" role="status">
          <span>
            {s.back.to.kind === "version"
              ? t.history.wentBack(s.back.to.version)
              : t.unsaved.discarded}
          </span>
          <button className={cx("toast-action")} onClick={undo}>
            {t.history.undoBack}
          </button>
        </div>
      )}
      {s.holding ? (
        <div className={cx("unsaved-bar")} data-asking role="alertdialog">
          <span className={cx("unsaved-text")}>
            <i className={cx("unsaved-dot")} />
            {t.unsaved.ask(Math.max(1, s.unsaved))}
          </span>
          <span className={cx("unsaved-actions")}>
            <button className={cx("quiet-button")} onClick={() => void session.decide("cancel")}>
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
          <div className={cx("unsaved-bar")} role="status">
            <span className={cx("unsaved-text")}>
              <i className={cx("unsaved-dot")} />
              <b>{t.unsaved.title(s.unsaved)}</b>
            </span>
            <span className={cx("unsaved-actions")}>
              <button
                className={cx("quiet-button")}
                disabled={s.locked}
                onClick={() => void attempt(session.discard)}
              >
                {t.unsaved.discardAll}
              </button>
              <button
                className={cx("primary small")}
                disabled={s.locked}
                data-tip={t.unsaved.shortcut}
                onClick={() => void attempt(session.save)}
              >
                <Check size={13} />
                {t.unsaved.save(s.next)}
              </button>
            </span>
          </div>
        )
      )}
    </>
  );
}

/** The composer under the canvas. It reads the request itself, so typing draws only it. */
export function DockComposer({
  session,
  asking,
  feedback,
  go,
  status,
  quote,
  unquote,
  selecting,
  edit,
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
  /** Whether something is selected for the request to be about. */
  selecting: boolean;
  edit?: () => void;
  send: () => void;
  stop: () => void;
}) {
  counted("composer");
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
    <div className={cx("now")}>
      <span className={cx("now-line")}>{request.handed}</span>
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
      edit={edit}
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

/** The detail page open over the scene, as the work has it now. */
export function DetailLayer({
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

export type Panel = "" | "journal" | "drafts" | "edit";

/** The buttons beside the panel: undo, redo, the panels, and exporting the scene. */
export function SideTools({
  session,
  panel,
  toggle,
  undo,
  feedback,
}: {
  session: WorkSession;
  panel: Panel;
  toggle: (panel: Panel) => void;
  undo: () => void;
  feedback: Feedback;
}) {
  counted("tools");
  const t = useT();
  const s = useSelect(session, (s) => ({
    work: s.work!,
    sceneId: s.sceneId,
    working: s.working,
    undoable: s.undoable,
    redoable: s.redoable,
    drawn: !!s.scene?.modules.length,
  }));
  return (
    <nav className={cx("side-tools")}>
      <button aria-label={t.work.undo} data-tip={t.work.undo} disabled={s.working || !s.undoable} onClick={undo}>
        <Undo2 size={17} />
      </button>
      <button
        aria-label={t.work.redo}
        data-tip={t.work.redo}
        disabled={s.working || !s.redoable}
        onClick={() => void feedback.attempt(session.redo)}
      >
        <Redo2 size={17} />
      </button>
      <button
        aria-label={t.work.edit}
        data-tip={t.work.edit}
        aria-pressed={panel === "edit"}
        onClick={() => toggle("edit")}
      >
        <PencilLine size={17} />
      </button>
      <button
        aria-label={t.work.journal}
        data-tip={t.work.journal}
        aria-pressed={panel === "journal"}
        data-live={s.working || undefined}
        onClick={() => toggle("journal")}
      >
        <MessagesSquare size={17} />
      </button>
      <button
        aria-label={t.work.drafts}
        data-tip={t.work.drafts}
        aria-pressed={panel === "drafts"}
        onClick={() => toggle("drafts")}
      >
        <History size={17} />
      </button>
      <ExportMenu
        work={s.work}
        sceneId={s.sceneId}
        disabled={!s.drawn}
        fail={feedback.fail}
        done={feedback.say}
      />
    </nav>
  );
}

/** The studio: every run on the work, followed to its end while the person reads at the
 * bottom. */
export function StudioPane({
  session,
  restore,
  resume,
  go,
  body,
  following,
}: {
  session: WorkSession;
  restore: (revision: number) => void;
  resume: () => void;
  go: (path: string) => void;
  body: RefObject<HTMLElement | null>;
  following: RefObject<boolean>;
}) {
  counted("studio");
  const s = useSelect(session, (s) => ({ runs: s.runs, loaded: s.loaded, work: s.work!, versions: s.versions }));
  useEffect(() => {
    const el = body.current;
    if (el && following.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [s.runs]);
  return (
    <Studio
      runs={s.runs}
      loaded={s.loaded}
      work={s.work}
      restore={restore}
      versionOf={(r) => versionOf(s.versions, r)?.number}
      resume={resume}
      openTrace={(id) => go("/traces/" + id)}
    />
  );
}

/** Every version, to look at, go back to, or save the hand edits as one. */
export function DraftsPane({
  session,
  restore,
  feedback,
}: {
  session: WorkSession;
  restore: (revision: number) => void;
  feedback: Feedback;
}) {
  counted("drafts");
  const { attempt } = feedback;
  const s = useSelect(session, (s) => ({
    versions: s.versions,
    unsaved: s.unsaved,
    current: s.work!.revision,
    previewing: s.preview?.revision,
    locked: s.engaged || !s.loaded,
  }));
  return (
    <Drafts
      versions={s.versions}
      unsaved={s.unsaved}
      current={s.current}
      previewing={s.previewing}
      locked={s.locked}
      look={(r) => void attempt(() => session.look(r))}
      restore={restore}
      save={() => void attempt(session.save)}
      discard={() => void attempt(session.discard)}
    />
  );
}

/** The editor: what is selected, the scene and the work, as the hand edits on their way
 * leave them. */
export function EditPane({
  session,
  ids,
  link,
  canvas,
  change,
  ops,
  pick,
  enter,
  ask,
}: {
  session: WorkSession;
  ids: string[];
  link: string | null;
  canvas?: Canvas;
  change: Change;
  ops: EditOps;
  pick: (kind: "picture" | "drawing", chosen: (m: import("@drawy/materials/schema").Material) => void) => void;
  enter: (id: string) => void;
  ask: () => void;
}) {
  counted("editor");
  const t = useT();
  const s = useSelect(session, (s) => ({ shown: s.shown!, sceneId: s.sceneId, engaged: s.engaged }));
  return (
    <EditPanel
      work={s.shown}
      sceneId={s.sceneId}
      selected={ids}
      link={link}
      canvas={canvas}
      busy={s.engaged ? t.edit.busy : undefined}
      change={change}
      ops={ops}
      pick={pick}
      openScene={enter}
      ask={ask}
    />
  );
}
