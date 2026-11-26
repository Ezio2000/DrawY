import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, X, Check, FileInput, PenLine } from "lucide-react";
import * as Hand from "../ui/brand/icons.tsx";
import type { Canvas, CanvasOptions, PartPick, Pointed } from "../../../../modules/canvas/index.ts";
import { shownName, type Target } from "../../../../modules/contracts/index.ts";
import { carried, danglingIn, itemOf, setData, spansOf, trailOf, wrapItems } from "../../../../modules/editing/index.ts";
import { CodeView, hasTextView } from "../EditCodeView.tsx";
import { optionOf } from "../EditControls.tsx";
import { cx } from "../cx.ts";
import { SelectionBar } from "../EditBar.tsx";
import { EditMenu } from "../EditMenu.tsx";
import { EditTray } from "../EditTray.tsx";
import { BringDialog } from "../Bring.tsx";
import type { BoardSettings } from "../EditView.tsx";
import { EditPanel } from "../Editor.tsx";
import { ExportMenu } from "../Export.tsx";
import type { Feedback } from "../feedback.ts";
import { useT } from "../i18n.tsx";
import { counted } from "../probe.ts";
import { Rename } from "../Rail.tsx";
import { SceneView } from "../SceneView.tsx";
import { Seal } from "../Title.tsx";
import { useSelect } from "../session/store.ts";
import type { Change, WorkSession } from "../session/work.ts";
import type { RequestDraft } from "../session/request.ts";
import type { EditOps, useEditing } from "./editing.ts";
import { notesOf, shownOf } from "../workPage.ts";

/* The parts of the desktop work page. Each reads from the session only what it shows, so
 * the author's run, which changes many times a second while it draws, draws again only
 * the parts that show it (the canvas, the status line and the studio). */

/** Values compared by what they hold, for small lists built afresh from each work. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);


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
  part,
}: {
  session: WorkSession;
  /** The part selected inside a module, named after the scene's path. */
  part?: PartPick | null;
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
  // The way into the part selected: the module, then each list it is in with its place.
  const inside = useSelect(
    session,
    (s) => {
      const m = part && s.scene?.modules.find((x) => x.id === part.moduleId);
      if (!m || !s.work) return null;
      return {
        module: shownName(s.work, m),
        trail: trailOf(s.work, m, part.path)
          .filter((step) => step.place !== undefined)
          .map((step) => `${step.label?.[t.locale] ?? step.key} ${step.place}`),
      };
    },
    same,
  );
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
        {inside && (
          <span className={cx("part-crumbs")} data-part-crumbs>
            {[inside.module, ...inside.trail].map((name, i) => (
              <span key={i}>
                <i>›</i>
                {name}
              </span>
            ))}
          </span>
        )}
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
  point,
  hand,
  board,
  setBoard,
  help,
  start,
  part,
}: {
  session: WorkSession;
  editing: boolean;
  /** A part of the module selected was selected inside it, or none is. */
  part: CanvasOptions["part"];
  view: (canvas: Canvas | undefined) => void;
  open: (target: Target) => void;
  select: CanvasOptions["select"];
  point: (pointed: Pointed) => void;
  hand: ReturnType<typeof useEditing>;
  /** How the drawing board is set up while editing. */
  board: BoardSettings;
  setBoard: (change: Partial<BoardSettings>) => void;
  /** Shows the shortcuts and gestures. */
  help: () => void;
  /** Takes up editing on a blank scene, or bringing something in. */
  start: (how: "draw" | "bring") => void;
}) {
  counted("canvas");
  const t = useT();
  const { display, sceneId, locked, run, id } = useSelect(session, shownOf);
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
      reconnect={hand.ops.reconnect}
      menu={hand.setMenu}
      place={hand.place}
      ink={hand.ink}
      erase={hand.ops.erase}
      board={board}
      setBoard={setBoard}
      help={help}
      part={part}
      items={hand.items}
      start={
        !locked && (
          editing ? (
            <small>{t.work.start.editing}</small>
          ) : (
            <span className={cx("blank-start")}>
              <button onClick={() => start("draw")}>
                <PenLine size={15} />
                {t.work.start.draw}
              </button>
              <button onClick={() => start("bring")}>
                <FileInput size={15} />
                {t.work.start.bring}
              </button>
            </span>
          )
        )
      }
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
  links,
  retyping,
  ask,
  part,
}: {
  session: WorkSession;
  hand: ReturnType<typeof useEditing>;
  canvas?: Canvas;
  stage: HTMLElement | null;
  ids: string[];
  links: string[];
  retyping: boolean;
  ask: () => void;
  /** The part selected inside the one module selected. */
  part: PartPick | null;
}) {
  counted("overlay");
  const t = useT();
  const { some, within, holds, loose, work, sceneId } = useSelect(session, (s) => {
    const modules = s.scene?.modules ?? [];
    const groups = ids.map((id) => modules.find((m) => m.id === id)?.group);
    const group = groups[0];
    return {
      some: groups.some(Boolean),
      // Inside a group: part of one group selected, not all of it.
      within:
        !!group &&
        groups.every((g) => g === group) &&
        modules.filter((m) => m.group === group).length > ids.length,
      holds: carried(modules, ids).length > 0,
      // Links left meeting nothing at either end, once what they met went.
      loose: danglingIn(s.shown!, s.sceneId).length > 0,
      work: s.shown!,
      sceneId: s.sceneId,
    };
  });
  // Items selected inside a module can be wrapped in an item of a list that spans them, of
  // each kind it offers (a run of messages in a loop or an alternative).
  // The text a module selected has of its own (a sequence diagram's Mermaid), open beside it.
  const [coding, setCoding] = useState<string>();
  const one = ids.length === 1 && !links.length ? work.scenes[sceneId]?.modules.find((m) => m.id === ids[0]) : undefined;
  const coded = coding ? work.scenes[sceneId]?.modules.find((m) => m.id === coding) : undefined;
  const wrapsOf = () => {
    const parts = canvas?.selectedParts ?? [];
    const m = parts.length ? work.scenes[sceneId]?.modules.find((x) => x.id === parts[0].moduleId) : undefined;
    const at = parts.length ? itemOf(parts[0].path) : undefined;
    if (!m || !at) return [];
    const paths = parts.map((p) => p.path);
    return spansOf(work, m, at.list).flatMap((span) =>
      (span.choice ? span.choice[1].options : [undefined]).map((o) => ({
        label: t.edit.wrap(o ? optionOf(t, o.value, { options: span.choice![1].options }) : (span.field.label?.[t.locale] ?? span.list)),
        run: () => void hand.ops.edit((w, s) => wrapItems(w, s, m.id, paths, span.list, o?.value).edit),
      })),
    );
  };
  return (
    <>
      <EditTray tool={hand.tool} setTool={hand.setTool} ops={hand.ops} bring={() => hand.setBringing(true)} />
      {hand.bringing && <BringDialog bring={hand.ops.bring} close={() => hand.setBringing(false)} />}
      <SelectionBar
        canvas={canvas}
        stage={stage}
        work={work}
        sceneId={sceneId}
        ops={hand.ops}
        selected={ids}
        links={links}
        part={part}
        hidden={!!hand.menu || retyping || hand.tool !== "select"}
        more={hand.setMenu}
        ask={ask}
        code={one && hasTextView(work, one) ? () => setCoding(one.id) : undefined}
      />
      {coded && (
        <CodeView
          key={coded.id}
          work={work}
          module={coded}
          apply={(data) => void hand.ops.edit((w, s) => setData(w, s, coded.id, data))}
          close={() => setCoding(undefined)}
        />
      )}
      {hand.menu && (
        <EditMenu
          wraps={wrapsOf()}
          at={hand.menu}
          ops={hand.ops}
          selected={ids}
          links={links}
          grouped={some}
          within={within}
          holds={holds}
          clipped={hand.clipped}
          brushed={hand.brushed}
          loose={loose}
          close={() => hand.setMenu(undefined)}
          ask={ask}
          fit={() => canvas?.fit(true, 520, "whole")}
        />
      )}
    </>
  );
}

/** The dock over the canvas's foot: the bars, then the composer. While editing by hand the
 * composer is put away until it is asked for: "describe a change", or a change handed to
 * the author, brings it up (the request counts each one), and it goes again once the focus
 * leaves it, or a press lands elsewhere, with nothing in it. What is in it, and the author at work, keep it up. It is a
 * part of its own so typing draws the page no further than here; what it holds is made by
 * the page and kept as it is. */
export function Dock({
  session,
  draft,
  editing,
  children,
}: {
  session: WorkSession;
  draft: RequestDraft;
  editing: boolean;
  children: ReactNode;
}) {
  const [describing, setDescribing] = useState(false);
  const editingNow = useRef(editing);
  editingNow.current = editing;
  useEffect(() => {
    let asked = draft.get().asked;
    return draft.subscribe(() => {
      const now = draft.get().asked;
      if (now !== asked && editingNow.current) setDescribing(true);
      asked = now;
    });
  }, [draft]);
  useEffect(() => {
    if (!editing) setDescribing(false);
  }, [editing]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!describing) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setDescribing(false);
    };
    addEventListener("pointerdown", away, true);
    return () => removeEventListener("pointerdown", away, true);
  }, [describing]);
  const written = useSelect(draft, (d) => !!d.text.trim() || d.attachments.length > 0 || d.uploading > 0);
  const busy = useSelect(session, (s) => s.locked || s.working || s.waiting);
  return (
    <div
      ref={ref}
      className={cx("dock")}
      data-dock
      data-quiet={(editing && !busy && !describing && !written) || undefined}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDescribing(false);
      }}
    >
      {children}
    </div>
  );
}

/** The bars over the composer: the version looked at, what went wrong or well, going back
 * to take back, and hand edits to save (or decide about before a request goes). */
export function Bars({
  session,
  feedback,
  restore,
  undo,
  editing,
}: {
  session: WorkSession;
  feedback: Feedback;
  restore: (revision: number) => void;
  undo: () => void;
  /** The hand editor is open: edits come one after another there, and the dot on the
   * seal and ⌘S are enough until it is closed. */
  editing: boolean;
}) {
  counted("bars");
  const t = useT();
  const { attempt } = feedback;
  const { error, notice } = useSelect(feedback, (f) => f);
  const s = useSelect(session, notesOf);
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
        !s.engaged &&
        !editing && (
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

export type Panel = "" | "journal" | "drafts" | "edit";

/** The buttons beside the panel: undo, the panels, and exporting the scene. */
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
    drawn: !!s.scene?.modules.length,
  }));
  return (
    <nav className={cx("side-tools")}>
      <button aria-label={t.work.undo} data-tip={t.work.undo} disabled={s.working || !s.undoable} onClick={undo}>
        <Hand.Undo size={18} />
      </button>
      <button
        aria-label={t.work.edit}
        data-tip={t.work.edit}
        aria-pressed={panel === "edit"}
        onClick={() => toggle("edit")}
      >
        <Hand.Pencil size={18} />
      </button>
      <button
        aria-label={t.work.journal}
        data-tip={t.work.journal}
        aria-pressed={panel === "journal"}
        data-live={s.working || undefined}
        onClick={() => toggle("journal")}
      >
        <Hand.Talk size={18} />
      </button>
      <button
        aria-label={t.work.drafts}
        data-tip={t.work.drafts}
        aria-pressed={panel === "drafts"}
        onClick={() => toggle("drafts")}
      >
        <Hand.Versions size={18} />
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

/** The editor: what is selected, the scene and the work, as the hand edits on their way
 * leave them. */
export function EditPane({
  session,
  ids,
  links,
  part,
  canvas,
  change,
  ops,
  pick,
  enter,
  ask,
}: {
  session: WorkSession;
  ids: string[];
  links: string[];
  canvas?: Canvas;
  change: Change;
  ops: EditOps;
  pick: (kind: "picture" | "drawing", chosen: (m: import("@drawy/materials/schema").Material) => void) => void;
  enter: (id: string) => void;
  ask: () => void;
  /** The part selected inside the one module selected. */
  part: PartPick | null;
}) {
  counted("editor");
  const t = useT();
  const s = useSelect(session, (s) => ({ shown: s.shown!, sceneId: s.sceneId, engaged: s.engaged }));
  return (
    <EditPanel
      work={s.shown}
      sceneId={s.sceneId}
      selected={ids}
      links={links}
      part={part}
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
