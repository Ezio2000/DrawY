import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Undo2,
  Redo2,
  ChevronDown,
  X,
  MessagesSquare,
  PencilLine,
  History,
  Check,
} from "lucide-react";
import { Dialog } from "@drawy/ui";
import type { Material } from "@drawy/materials/schema";
import type { Canvas, Pointed } from "../../../../modules/canvas/index.ts";
import {
  versionOf,
  type Selection,
  type Target,
} from "../../../../modules/contracts/index.ts";
import { removeParts, replace, shownName } from "../../../../modules/editing/index.ts";
import { useAccount } from "../account.tsx";
import { cx } from "../cx.ts";
import { useT } from "../i18n.tsx";
import { SceneView, DetailView } from "../SceneView.tsx";
import { Studio, Now } from "../Studio.tsx";
import { ExportMenu } from "../Export.tsx";
import { Rename } from "../Rail.tsx";
import { Composer, Unconnected } from "../Composer.tsx";
import { Library } from "../Library.tsx";
import { Title } from "../Title.tsx";
import { Drafts } from "../Drafts.tsx";
import { EditPanel, Retype } from "../Editor.tsx";
import { EditMenu, EditTools, SelectionBar } from "../EditMenu.tsx";
import type { ShellProps } from "../shell.ts";
import { useEditing } from "./editing.ts";

/** What the panel beside the canvas shows: the studio (the conversation with the author
 * and its process), the drafts (every revision, to look at or bring back) or the editor,
 * while the work is edited by hand. */
type Panel = "" | "journal" | "drafts" | "edit";
/** How wide the studio, the drafts panel and the editor are, each as the person last
 * dragged it: the conversation reads best wide, a list of drafts needs far less, and the
 * editor wants room for its fields without crowding the canvas. */
type Sized = "journal" | "drafts" | "edit";
const panelWidths: Record<Sized, { min: number; initial: number }> = {
  journal: { min: 360, initial: 520 },
  drafts: { min: 260, initial: 340 },
  edit: { min: 300, initial: 380 },
};
const panelWidth = {
  max: () => Math.max(420, Math.round(innerWidth * 0.62)),
  clamp: (kind: Sized, n: number) =>
    Math.min(panelWidth.max(), Math.max(panelWidths[kind].min, n)),
  read(kind: Sized) {
    try {
      const n = Number(localStorage.getItem("drawy.panel." + kind));
      return n ? panelWidth.clamp(kind, n) : panelWidths[kind].initial;
    } catch {
      return panelWidths[kind].initial;
    }
  },
  save(kind: Sized, n: number) {
    try {
      localStorage.setItem("drawy.panel." + kind, String(Math.round(n)));
    } catch {}
  },
};
/** Whether the panel can sit beside the canvas; on narrower screens it covers it. */
const roomy = () => innerWidth > 1080;

/** The work page on a computer: the canvas with the title over it and the composer laid
 * over its foot, and beside it a panel for the studio, the drafts or the editor. */
export default function DesktopWorkPage({ session: s, asking, feedback, go }: ShellProps) {
  const t = useT();
  const user = useAccount()!;
  const { attempt } = feedback;
  const { request, draft } = asking;
  const work = s.work!;
  // What is selected: modules, or else a link, as the canvas says.
  const [selected, setSelected] = useState<Selection[]>([]);
  const [link, setLink] = useState<string | null>(null);
  // The detail page open over the scene.
  const [detailId, setDetail] = useState<string>();
  // The run whose reply under the canvas was put away.
  const [dismissed, setDismissed] = useState("");
  const [panel, setPanel] = useState<Panel>("");
  const [widths, setWidths] = useState(() => ({
    journal: panelWidth.read("journal"),
    drafts: panelWidth.read("drafts"),
    edit: panelWidth.read("edit"),
  }));
  const [scenes, setScenes] = useState(false);
  const [titling, setTitling] = useState(false);
  // Words being changed where they are drawn.
  const [retyping, setRetyping] = useState<Extract<Pointed, { kind: "text" }>>();
  // A picture or a drawing being chosen from the library, and what it is for.
  const [choosing, setChoosing] = useState<{
    kind: "picture" | "drawing";
    chosen: (m: Material) => void;
  }>();
  const [canvas, setCanvas] = useState<Canvas>();
  const stage = useRef<HTMLElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const following = useRef(true);
  const journal = panel === "journal",
    drafting = panel === "drafts",
    editing = panel === "edit";
  const { run, working, sceneId, scene: active, versions, unsaved, preview, locked } = s;
  const ids = selected.map((x) => x.moduleId);
  const chosenLink = !ids.length && link ? active?.links.find((l) => l.id === link) : undefined;
  const linkId = chosenLink ? link : null;
  const focus = { modules: selected, link: chosenLink };
  // The latest reply shows under the canvas until it is put away; one from before the
  // work was opened stays in the studio.
  const putAway = !run || run.id === dismissed || run.id === s.earlier;
  const replying = !putAway && !working && !s.waiting;
  const dismiss = () => setDismissed(run?.id ?? "");
  const toggle = (p: Panel) => {
    setPanel(panel === p ? "" : p);
    s.endPreview();
  };
  /** Asks for a material of one kind from the library, for what it is chosen for. */
  const pick = (kind: "picture" | "drawing", chosen: (m: Material) => void) =>
    setChoosing({ kind, chosen });
  const hand = useEditing({
    session: s,
    canvas,
    editing,
    selected: ids,
    link: linkId,
    pick,
    retype: setRetyping,
  });
  /** Hands a change to the author, written into the composer for the person to send. */
  const ask = (text?: string, why = "") => draft.hand(text, why);

  // What is selected and open belongs to the scene it was in.
  useEffect(() => {
    setSelected([]);
    setLink(null);
    setDetail(undefined);
    setScenes(false);
    setRetyping(undefined);
  }, [s.id, sceneId]);
  // While the author draws, the studio shows how it goes about it, unless the person is
  // editing by hand or the panel would cover the canvas.
  useEffect(() => {
    if (working && roomy()) setPanel((p) => (p === "edit" ? p : "journal"));
  }, [run?.id, working]);
  useEffect(() => {
    const el = conversation.current;
    if (el) el.scrollTop = el.scrollHeight;
    following.current = true;
  }, [journal]);
  useEffect(() => {
    const el = conversation.current;
    if (el && following.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [s.runs]);
  useEffect(() => {
    if (!scenes) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-scene-menu]")) setScenes(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setScenes(false);
    addEventListener("pointerdown", close);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("pointerdown", close);
      removeEventListener("keydown", key);
    };
  }, [scenes]);
  // Cmd/Ctrl+Z takes back the latest step and Shift+Cmd/Ctrl+Z (or Ctrl+Y) brings it back,
  // unless a field is being typed in.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (
        !(e.metaKey || e.ctrlKey) ||
        (k !== "z" && k !== "y") ||
        (e.target as Element).closest("input,textarea,[contenteditable]")
      )
        return;
      e.preventDefault();
      if (working || preview) return;
      if (k === "y" || e.shiftKey) {
        if (s.redoable) void attempt(s.redo);
      } else if (s.undoable) undo();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [s.undoable, s.redoable, working, preview, s.undo, s.redo, run?.id]);
  // Cmd/Ctrl+S saves the hand edits as a version.
  useEffect(() => {
    if (!unsaved) return;
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (!locked) void attempt(s.save);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [unsaved, locked]);
  useEffect(() => {
    if (!preview) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && s.endPreview();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [preview]);
  // The author's last reply under the canvas goes with Escape or a press on the drawing.
  useEffect(() => {
    if (!replying || journal || detailId) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [replying, journal, detailId]);

  /** A module by its name, or a link by the names of the modules it joins. */
  const nameOf = (id: string): string => {
    const l = active?.links.find((x) => x.id === id);
    if (l) return `${nameOf(l.from.moduleId)} → ${nameOf(l.to.moduleId)}`;
    const m = active?.modules.find((x) => x.id === id);
    return m ? shownName(work, m) : id;
  };
  /** Going back, or undoing, puts the reply under the canvas away. */
  const restore = (revision: number) =>
    void attempt(async () => {
      await s.restore(revision);
      dismiss();
    });
  const undo = () =>
    void attempt(async () => {
      await s.undo();
      dismiss();
    });
  /** Follows a module's target: into a scene, or a detail page over this one. */
  const open = (target: Target) =>
    target.kind === "scene" ? enter(target.id) : setDetail(target.id);

  /** Words or a picture pointed at on the canvas: words are changed where they are, a
   * picture is swapped for one from the library. What the work cannot change by itself is
   * written up for the author to do. */
  function point(p: Pointed) {
    if (locked) return;
    if (!editing) setPanel("edit");
    if (p.kind === "text") return setRetyping(p);
    pick("picture", (m) =>
      void attempt(async () => {
        const done = await s.change((w) =>
          replace(w, sceneId, p.moduleId, "picture", p.material, m.id),
        );
        if (!done) {
          draft.use(m);
          ask(t.edit.askPicture(nameOf(p.moduleId)), t.edit.handedPicture);
        }
      }),
    );
  }
  function retyped(text: string | null) {
    const p = retyping!;
    setRetyping(undefined);
    if (text === null || text === p.text) return;
    if (!text.trim())
      return void attempt(() => s.change((w) => removeParts(w, sceneId, [p.moduleId])));
    void attempt(async () => {
      if (!(await s.change((w) => replace(w, sceneId, p.moduleId, "text", p.text, text))))
        ask(t.edit.askText(nameOf(p.moduleId), p.text, text), t.edit.handedText);
    });
  }
  /** Stopping hands what was asked back to the composer, to change and send again. */
  const stop = () =>
    void attempt(async () => {
      const asked = await s.stop();
      if (asked && !draft.get().text.trim()) draft.write(asked);
    });
  const send = (ask: Parameters<typeof asking.send>[0] = {}) =>
    void attempt(() => asking.send({ focus, ...ask }));
  const resume = () => send({ text: t.now.resumeMessage, scene: run?.sceneId ?? sceneId, picked: "" });
  const enter = (id: string) => void attempt(() => s.enter(id));

  const crumbs = [];
  let at = active;
  while (at) {
    crumbs.unshift(at);
    at = at.parentId ? work.scenes[at.parentId] : undefined;
  }
  const sameGroup =
    !!ids.length &&
    ids.every((id) => {
      const g = active?.modules.find((m) => m.id === id)?.group;
      return g && g === active?.modules.find((m) => m.id === ids[0])?.group;
    });

  // While drawing, the bar always shows how far it has got; with the studio open, which
  // tells the rest, only the stages.
  const status = (s.offline || s.waiting || working || (!journal && !putAway)) && (
    <Now
      compact={journal && working}
      run={run}
      work={work}
      offline={s.offline}
      pictures={!!active?.modules.length}
      answer={(o) => send({ text: o, picked: "" })}
      choose={draft.choose}
      cancel={() => void attempt(s.cancel)}
      reveal={() => setPanel("journal")}
      dismiss={dismiss}
      resume={resume}
      restore={restore}
    />
  );
  const unconnected = asking.blocked === "unconnected" && <Unconnected go={go} />;
  const note = request.handed && request.text && (
    <div className={cx("now")}>
      <span className={cx("now-line")}>{request.handed}</span>
    </div>
  );

  return (
    <div
      className={cx("workspace")}
      data-panel={panel || undefined}
      style={
        {
          "--journal": widths.journal + "px",
          "--drafts": widths.drafts + "px",
          "--edit": widths.edit + "px",
        } as CSSProperties
      }
    >
      <section
        ref={stage}
        className={cx("stage")}
        data-working={working || undefined}
        onPointerDown={(e) => {
          if (replying && (e.target as Element).closest("[data-canvas]")) dismiss();
        }}
      >
        <header className={cx("topbar")}>
          <nav className={cx("crumbs")}>
            {crumbs.map((p, i) => (
              <span key={p.id}>
                {i > 0 && <i>/</i>}
                {i === 0 && titling ? (
                  <Rename
                    title={work.title}
                    done={(title) => {
                      setTitling(false);
                      if (title) void attempt(() => s.rename(title));
                    }}
                  />
                ) : (
                  <button
                    aria-current={p.id === sceneId || undefined}
                    data-tip={i === 0 && p.id === sceneId ? t.work.rename : undefined}
                    onClick={() =>
                      i === 0 && p.id === sceneId ? setTitling(true) : enter(p.id)
                    }
                  >
                    {i === 0 ? work.title : p.title}
                  </button>
                )}
              </span>
            ))}
            {Object.keys(work.scenes).length > 1 && (
              <span className={cx("scene-menu")} data-scene-menu>
                <button
                  aria-label={t.work.scenes}
                  aria-expanded={scenes}
                  onClick={() => setScenes(!scenes)}
                >
                  <ChevronDown size={15} />
                </button>
                {scenes && (
                  <span className={cx("scene-list")}>
                    {Object.values(work.scenes).map((p) => (
                      <button
                        key={p.id}
                        data-child={!!p.parentId || undefined}
                        aria-current={p.id === sceneId || undefined}
                        onClick={() => enter(p.id)}
                      >
                        {p.parentId ? p.title : work.title}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )}
          </nav>
        </header>
        <SceneView
          key={work.id}
          work={s.display!.work}
          version={s.display!.version}
          sceneId={sceneId}
          run={s.engaged ? run : undefined}
          disabled={locked}
          editing={editing}
          quiet={s.quiet}
          view={(c) => {
            setCanvas(c);
            s.attach(c);
          }}
          open={open}
          select={setSelected}
          commit={hand.ops.move}
          point={point}
          connect={hand.ops.connect}
          selectLink={setLink}
          reconnect={hand.ops.reconnect}
          menu={hand.setMenu}
          place={(at) => {
            hand.setTool("select");
            hand.ops.add("text", at);
          }}
        />
        {editing && !locked && (
          <EditTools tool={hand.tool} setTool={hand.setTool} ops={hand.ops} />
        )}
        {editing && !locked && (
          <SelectionBar
            canvas={canvas}
            stage={stage.current}
            ops={hand.ops}
            selected={ids}
            link={linkId}
            grouped={sameGroup}
            hidden={!!hand.menu || !!retyping || hand.tool !== "select"}
            ask={() => ask()}
          />
        )}
        {hand.menu && editing && !locked && (
          <EditMenu
            at={hand.menu}
            ops={hand.ops}
            selected={ids}
            link={linkId}
            grouped={ids.some((id) => active?.modules.find((m) => m.id === id)?.group)}
            clipped={hand.clipped}
            close={() => hand.setMenu(undefined)}
            ask={() => ask()}
          />
        )}
        {retyping && stage.current && (
          <Retype
            key={retyping.moduleId + ":" + retyping.text}
            pointed={retyping}
            stage={stage.current}
            done={retyped}
          />
        )}
        <div className={cx("dock")} data-dock>
          {preview && (
            <div className={cx("preview-bar")} role="status">
              <span>
                {t.history.previewing(versionOf(versions, preview.revision)?.number ?? 0)}
              </span>
              <button className={cx("secondary small")} onClick={s.endPreview}>
                {t.history.back}
              </button>
              <button
                className={cx("primary small")}
                disabled={working}
                onClick={() => restore(preview.revision)}
              >
                {t.history.restoreThis}
              </button>
            </div>
          )}
          {feedback.error && (
            <div className={cx("toast-error")} role="alert">
              <span>{feedback.error}</span>
              <button aria-label={t.close} onClick={feedback.dismiss}>
                <X size={13} />
              </button>
            </div>
          )}
          {feedback.notice && !s.back && (
            <div className={cx("toast-error")} data-tone="ok" role="status">
              <span>{feedback.notice}</span>
            </div>
          )}
          {s.back && !preview && !s.holding && (
            <div className={cx("toast-error")} data-tone="ok" role="status">
              <span>{s.back.text}</span>
              <button className={cx("toast-action")} onClick={undo}>
                {t.history.undoBack}
              </button>
            </div>
          )}
          {s.holding ? (
            <div className={cx("unsaved-bar")} data-asking role="alertdialog">
              <span className={cx("unsaved-text")}>
                <i className={cx("unsaved-dot")} />
                {t.unsaved.ask(Math.max(1, unsaved))}
              </span>
              <span className={cx("unsaved-actions")}>
                <button className={cx("quiet-button")} onClick={() => void s.decide("cancel")}>
                  {t.unsaved.cancel}
                </button>
                <button
                  className={cx("secondary small")}
                  onClick={() => void attempt(() => s.decide("discard"))}
                >
                  {t.unsaved.discardAndSend}
                </button>
                <button
                  className={cx("primary small")}
                  onClick={() => void attempt(() => s.decide("save"))}
                >
                  {t.unsaved.saveAndSend}
                </button>
              </span>
            </div>
          ) : (
            !!unsaved &&
            !preview &&
            !s.engaged && (
              <div className={cx("unsaved-bar")} role="status">
                <span className={cx("unsaved-text")}>
                  <i className={cx("unsaved-dot")} />
                  <b>{t.unsaved.title(unsaved)}</b>
                </span>
                <span className={cx("unsaved-actions")}>
                  <button
                    className={cx("quiet-button")}
                    disabled={locked}
                    onClick={() => void attempt(s.discard)}
                  >
                    {t.unsaved.discardAll}
                  </button>
                  <button
                    className={cx("primary small")}
                    disabled={locked}
                    data-tip={t.unsaved.shortcut}
                    onClick={() => void attempt(s.save)}
                  >
                    <Check size={13} />
                    {t.unsaved.save((versions.at(-1)?.number ?? 0) + 1)}
                  </button>
                </span>
              </div>
            )
          )}
          <Composer
            place="dock"
            value={request.text}
            set={draft.write}
            attachments={request.attachments}
            detach={draft.detach}
            uploading={request.uploading}
            focus={request.asked}
            quote={
              selected.length
                ? selected.map((x) => x.label || x.moduleId).join(t.now.list)
                : chosenLink
                  ? nameOf(chosenLink.id)
                  : undefined
            }
            unquote={() => (canvas ? canvas.select([]) : (setSelected([]), setLink(null)))}
            edit={editing || locked ? undefined : () => setPanel("edit")}
            placeholder={
              s.waiting
                ? t.composer.answering
                : selected.length || chosenLink
                  ? t.composer.selected
                  : working
                    ? t.composer.working
                    : t.composer.continue
            }
            status={unconnected || note || status}
            working={working}
            busy={s.sending || !s.loaded || !s.synced}
            send={() => send()}
            stop={stop}
            attach={(files) => void attempt(() => draft.upload(files))}
            pick={asking.pick}
            models={s.engaged ? undefined : asking.models}
            collapsed={working}
            quota={user.quota}
            spent={asking.blocked === "spent" && !s.waiting}
            choose={asking.choose}
          />
        </div>
        {detailId && work.details[detailId] && (
          <DetailView detail={work.details[detailId]} close={() => setDetail(undefined)} />
        )}
      </section>
      <aside className={cx("side")} aria-label={t.work.panel}>
        <nav className={cx("side-tools")}>
          <button
            aria-label={t.work.undo}
            data-tip={t.work.undo}
            disabled={working || !s.undoable}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            aria-label={t.work.redo}
            data-tip={t.work.redo}
            disabled={working || !s.redoable}
            onClick={() => void attempt(s.redo)}
          >
            <Redo2 size={17} />
          </button>
          <button
            aria-label={t.work.edit}
            data-tip={t.work.edit}
            aria-pressed={editing}
            onClick={() => toggle("edit")}
          >
            <PencilLine size={17} />
          </button>
          <button
            aria-label={t.work.journal}
            data-tip={t.work.journal}
            aria-pressed={journal}
            data-live={working || undefined}
            onClick={() => toggle("journal")}
          >
            <MessagesSquare size={17} />
          </button>
          <button
            aria-label={t.work.drafts}
            data-tip={t.work.drafts}
            aria-pressed={drafting}
            onClick={() => toggle("drafts")}
          >
            <History size={17} />
          </button>
          <ExportMenu
            work={work}
            sceneId={sceneId}
            disabled={!active?.modules.length}
            fail={feedback.fail}
            done={feedback.say}
          />
        </nav>
        <div className={cx("side-panel")} data-kind={panel || undefined} inert={!panel}>
          {panel && (
            <Resizer
              kind={editing ? "edit" : drafting ? "drafts" : "journal"}
              width={editing ? widths.edit : drafting ? widths.drafts : widths.journal}
              set={(kind, n) => setWidths((w) => ({ ...w, [kind]: n }))}
              label={t.work.resize}
            />
          )}
          <header>
            <h2>
              <Title name={editing ? "edit" : drafting ? "drafts" : "journal"} size="section" />
            </h2>
          </header>
          <section
            className={cx("side-body")}
            ref={conversation}
            onWheel={(e) => {
              if (!journal) return;
              const el = e.currentTarget;
              following.current =
                e.deltaY > 0 && el.scrollHeight - el.scrollTop - el.clientHeight < 160;
            }}
          >
            {editing ? (
              <EditPanel
                work={s.shown!}
                sceneId={sceneId}
                selected={ids}
                link={linkId}
                canvas={canvas}
                busy={s.engaged ? t.edit.busy : undefined}
                change={(make) => attempt(() => s.change(make)).then(() => true)}
                ops={hand.ops}
                pick={pick}
                openScene={enter}
                ask={() => ask()}
              />
            ) : drafting ? (
              <Drafts
                versions={versions}
                unsaved={unsaved}
                current={work.revision}
                previewing={preview?.revision}
                locked={s.engaged || !s.loaded}
                look={(r) => void attempt(() => s.look(r))}
                restore={restore}
                save={() => void attempt(s.save)}
                discard={() => void attempt(s.discard)}
              />
            ) : (
              <Studio
                runs={s.runs}
                loaded={s.loaded}
                work={work}
                restore={restore}
                versionOf={(r) => versionOf(versions, r)?.number}
                resume={resume}
                openTrace={(id) => go("/traces/" + id)}
              />
            )}
          </section>
        </div>
      </aside>
      {choosing && (
        <Dialog
          title={choosing.kind === "picture" ? t.titles.choosePicture : t.titles.chooseDrawing}
          heading={
            <Title
              name={choosing.kind === "picture" ? "choosePicture" : "chooseDrawing"}
              size="section"
            />
          }
          wide
          onClose={() => setChoosing(undefined)}
        >
          <Library
            kinds={[choosing.kind]}
            action={choosing.kind === "picture" ? t.edit.usePicture : t.edit.useDrawing}
            use={(m) => {
              setChoosing(undefined);
              if (m.kind === choosing.kind) void attempt(async () => choosing.chosen(m));
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

/** The panel's left edge, dragged to share the page between the canvas and the panel; the
 * width is remembered for next time. Arrow keys move it too. */
function Resizer({
  kind,
  width,
  set,
  label,
}: {
  kind: Sized;
  width: number;
  set: (kind: Sized, n: number) => void;
  label: string;
}) {
  const clamp = (n: number) => panelWidth.clamp(kind, n);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={cx("resizer")}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        e.preventDefault();
        const start = e.clientX,
          from = width;
        let last = from;
        setDragging(true);
        const move = (m: PointerEvent) => {
          last = clamp(from + start - m.clientX);
          set(kind, last);
        };
        const up = () => {
          setDragging(false);
          panelWidth.save(kind, last);
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
      }}
      onDoubleClick={() => {
        set(kind, panelWidths[kind].initial);
        panelWidth.save(kind, panelWidths[kind].initial);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 80 : 20;
        const next =
          e.key === "ArrowLeft" ? width + step : e.key === "ArrowRight" ? width - step : undefined;
        if (next === undefined) return;
        e.preventDefault();
        set(kind, clamp(next));
        panelWidth.save(kind, clamp(next));
      }}
    />
  );
}
