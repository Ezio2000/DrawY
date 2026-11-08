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
import { versionOf } from "../../../../modules/contracts/index.ts";
import { removeParts, replace } from "../../../../modules/editing/index.ts";
import { cx } from "../cx.ts";
import { useT } from "../i18n.tsx";
import { SceneView, DetailView } from "../SceneView.tsx";
import { Studio, Now } from "../Studio.tsx";
import { ExportMenu } from "../Export.tsx";
import { Rename } from "../Rail.tsx";
import { Composer } from "../Composer.tsx";
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
export function DesktopWorkPage({ session: s, request, draft, app }: ShellProps) {
  const t = useT();
  const { attempt } = app;
  const work = s.work!;
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
  const { run, working, sceneId, scene: active, versions, unsavedCount, preview, locked } = s;
  const toggle = (p: Panel) => {
    setPanel(panel === p ? "" : p);
    s.endPreview();
  };
  /** Asks for a material of one kind from the library, for what it is chosen for. */
  const pick = (kind: "picture" | "drawing", chosen: (m: Material) => void) =>
    setChoosing({ kind, chosen });
  const hand = useEditing({ session: s, canvas, editing, pick, retype: setRetyping });
  /** Hands a change to the author, written into the composer for the person to send. */
  const ask = (text?: string, why = "") => draft.hand(text, why);

  useEffect(() => {
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
      } else if (s.undoable) void attempt(s.undo);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [s.undoable, s.redoable, working, preview, s.undo, s.redo]);
  // Cmd/Ctrl+S saves the hand edits as a version.
  useEffect(() => {
    if (!unsavedCount) return;
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (!locked) void attempt(s.save);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [unsavedCount, locked]);
  useEffect(() => {
    if (!preview) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && s.endPreview();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [preview]);
  // The author's last reply under the canvas goes with Escape or a press on the drawing.
  useEffect(() => {
    if (!s.replying || journal || s.detailId) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && s.dismiss();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [s.replying, journal, s.detailId]);

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
          ask(t.edit.askPicture(s.nameOf(p.moduleId)), t.edit.handedPicture);
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
        ask(t.edit.askText(s.nameOf(p.moduleId), p.text, text), t.edit.handedText);
    });
  }
  /** Stopping hands what was asked back to the composer, to change and send again. */
  const stop = () =>
    void attempt(async () => {
      const asked = await s.stop();
      if (asked && !draft.get().text.trim()) draft.write(asked);
    });
  const resume = () =>
    void attempt(() =>
      app.send({ text: t.now.resumeMessage, scene: run?.sceneId ?? sceneId, picked: "" }),
    );
  const enter = (id: string) => void attempt(() => s.enter(id));

  const crumbs = [];
  let at = active;
  while (at) {
    crumbs.unshift(at);
    at = at.parentId ? work.scenes[at.parentId] : undefined;
  }
  const chosenLink = s.chosenLink;
  const linkId = chosenLink ? s.link : null;
  const sameGroup =
    !!s.selected.length &&
    s.ids.every((id) => {
      const g = active?.modules.find((m) => m.id === id)?.group;
      return g && g === active?.modules.find((m) => m.id === s.ids[0])?.group;
    });

  // While drawing, the bar always shows how far it has got; with the studio open, which
  // tells the rest, only the stages.
  const status = (app.offline ||
    s.waiting ||
    working ||
    (!journal && run?.id !== s.dismissed)) && (
    <Now
      compact={journal && working}
      run={run}
      work={work}
      offline={app.offline}
      pictures={!!active?.modules.length}
      answer={(o) => void attempt(() => app.send({ text: o, picked: "" }))}
      choose={draft.choose}
      cancel={() => void attempt(s.cancel)}
      reveal={() => setPanel("journal")}
      dismiss={s.dismiss}
      resume={resume}
      restore={(r) => void attempt(() => s.restore(r))}
    />
  );
  const connected =
    app.models && !!app.models.labels.find((m) => m.id === app.models!.chosen.label)?.ready;
  const manages = !!app.user.permissions.includes("models.manage");
  const spent = app.user.quota === 0 && !s.waiting;
  // Until a drawing model is connected, the composer says so: those who manage models
  // are led to Settings, the rest are told an administrator has to.
  const unconnected = connected === false && (
    <div className={cx("now")} data-tone="failed">
      <span className={cx("now-line")}>
        {manages ? t.composer.unconnected : t.composer.unconnectedMember}
      </span>
      {manages && (
        <button className={cx("primary small")} onClick={() => app.go("/settings")}>
          {t.composer.connect}
        </button>
      )}
    </div>
  );
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
          if (s.replying && (e.target as Element).closest("[data-canvas]")) s.dismiss();
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
          open={s.open}
          select={s.select}
          commit={hand.ops.move}
          point={point}
          connect={hand.ops.connect}
          selectLink={s.selectLink}
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
            selected={s.ids}
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
            selected={s.ids}
            link={linkId}
            grouped={s.ids.some((id) => active?.modules.find((m) => m.id === id)?.group)}
            clipped={s.clipped}
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
                onClick={() => void attempt(() => s.restore(preview.revision))}
              >
                {t.history.restoreThis}
              </button>
            </div>
          )}
          {app.error && (
            <div className={cx("toast-error")} role="alert">
              <span>{app.error}</span>
              <button aria-label={t.close} onClick={app.clearError}>
                <X size={13} />
              </button>
            </div>
          )}
          {app.notice && !s.wentBack && (
            <div className={cx("toast-error")} data-tone="ok" role="status">
              <span>{app.notice}</span>
            </div>
          )}
          {s.wentBack?.at === work.revision && !preview && !s.holding && (
            <div className={cx("toast-error")} data-tone="ok" role="status">
              <span>{s.wentBack.text}</span>
              <button className={cx("toast-action")} onClick={() => void attempt(s.undo)}>
                {t.history.undoBack}
              </button>
            </div>
          )}
          {s.holding ? (
            <div className={cx("unsaved-bar")} data-asking role="alertdialog">
              <span className={cx("unsaved-text")}>
                <i className={cx("unsaved-dot")} />
                {t.unsaved.ask(Math.max(1, unsavedCount))}
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
            !!unsavedCount &&
            !preview &&
            !s.engaged && (
              <div className={cx("unsaved-bar")} role="status">
                <span className={cx("unsaved-text")}>
                  <i className={cx("unsaved-dot")} />
                  <b>{t.unsaved.title(unsavedCount)}</b>
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
              s.selected.length
                ? s.selected.map((x) => x.label || x.moduleId).join(t.now.list)
                : chosenLink
                  ? s.nameOf(chosenLink.id)
                  : undefined
            }
            unquote={s.unquote}
            edit={editing || locked ? undefined : () => setPanel("edit")}
            placeholder={
              s.waiting
                ? t.composer.answering
                : s.selected.length || chosenLink
                  ? t.composer.selected
                  : working
                    ? t.composer.working
                    : t.composer.continue
            }
            status={unconnected || note || status}
            working={working}
            busy={s.sending || !s.loaded || !s.synced}
            send={() => void attempt(() => app.send())}
            stop={stop}
            attach={(files) => void attempt(() => draft.upload(files))}
            pick={app.library}
            models={s.engaged ? undefined : app.models}
            collapsed={working}
            quota={app.user.quota}
            spent={spent}
            choose={app.choose}
          />
        </div>
        {s.detailId && work.details[s.detailId] && (
          <DetailView detail={work.details[s.detailId]} close={s.closeDetail} />
        )}
      </section>
      <aside className={cx("side")} aria-label={t.work.panel}>
        <nav className={cx("side-tools")}>
          <button
            aria-label={t.work.undo}
            data-tip={t.work.undo}
            disabled={working || !s.undoable}
            onClick={() => void attempt(s.undo)}
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
            fail={app.fail}
            done={app.say}
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
                selected={s.ids}
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
                unsaved={unsavedCount}
                current={work.revision}
                previewing={preview?.revision}
                locked={s.engaged || !s.loaded}
                look={(r) => void attempt(() => s.look(r))}
                restore={(r) => void attempt(() => s.restore(r))}
                save={() => void attempt(s.save)}
                discard={() => void attempt(s.discard)}
              />
            ) : (
              <Studio
                runs={s.runs}
                loaded={s.loaded}
                work={work}
                restore={(r) => void attempt(() => s.restore(r))}
                versionOf={(r) => versionOf(versions, r)?.number}
                resume={resume}
                openTrace={(id) => app.go("/traces/" + id)}
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
