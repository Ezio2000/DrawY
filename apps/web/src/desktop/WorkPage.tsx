import { useEffect, useRef, useState, type CSSProperties } from "react";
import { WorkComposer } from "../Composer.tsx";
import { WorkStatus, WorkStudio } from "../Studio.tsx";
import { WorkDrafts } from "../Drafts.tsx";
import { WorkDetail } from "../SceneView.tsx";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Dialog } from "../ui/dialogs.tsx";
import type { Material } from "@drawy/materials/schema";
import type { Canvas, Pointed } from "../../../../modules/canvas/index.ts";
import type { Selection } from "../../../../modules/contracts/index.ts";
import { cx } from "../cx.ts";
import { useT } from "../i18n.tsx";
import { Library } from "../Library.tsx";
import { Opening } from "../Opening.tsx";
import { counted } from "../probe.ts";
import { Retype, ShortcutSheet } from "../Editor.tsx";
import { DRAWING_TYPE, drawingById } from "../EditTray.tsx";
import { useBoard } from "../EditView.tsx";
import { useSelect } from "../session/store.ts";
import type { ShellProps } from "../shell.ts";
import { Title } from "../Title.tsx";
import { useEditing } from "./editing.ts";
import { useWorkPage, nameIn } from "../workPage.ts";
import { panelWidth, Resizer } from "./panels.tsx";
import {
  Bars,
  CanvasArea,
  EditOverlay,
  EditPane,
  SideTools,
  Topbar,
  type Panel,
} from "./parts.tsx";

/** Whether the panel can sit beside the canvas; on narrower screens it covers it. */
const roomy = () => innerWidth > 1080;

/** The work page on a computer: the canvas with the title over it and the composer laid
 * over its foot, and beside it a panel for the studio, the drafts or the editor.
 *
 * This component keeps how the page is used (the panel, what is selected, the detail page
 * open, the reply put away, words being retyped) and reads from the session only what
 * changes when a run starts or ends or the scene changes; each part reads the rest itself.
 * Its shortcuts read the session when the key is pressed. */
export default function DesktopWorkPage({ session, asking, feedback, go }: ShellProps) {
  counted("page");
  const t = useT();
  const { attempt } = feedback;
  const { draft } = asking;
  // What is selected: modules, or else a link, as the canvas says.
  const [selected, setSelected] = useState<Selection[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("");
  const [widths, setWidths] = useState(() => ({
    journal: panelWidth.read("journal"),
    drafts: panelWidth.read("drafts"),
    edit: panelWidth.read("edit"),
  }));
  const [scenes, setScenes] = useState(false);
  const [titling, setTitling] = useState(false);
  // A picture or a drawing being chosen from the library, and what it is for.
  const [choosing, setChoosing] = useState<{
    kind: "picture" | "drawing";
    chosen: (m: Material) => void;
  }>();
  const [canvas, setCanvas] = useState<Canvas>();
  // The sheet of shortcuts, and how the drawing board is set up.
  const [help, setHelp] = useState(false);
  const [board, setBoard] = useBoard();
  // The editor's panel put away, leaving the canvas and its tools: where the panel would
  // cover the canvas it starts that way, and it is a press from coming back.
  const [tucked, setTucked] = useState(false);
  const stage = useRef<HTMLElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const following = useRef(true);
  const journal = panel === "journal",
    drafting = panel === "drafts",
    editing = panel === "edit";
  const ids = selected.map((x) => x.moduleId);
  const { working, waiting, locked, runId, chosenLink, linkName } = useSelect(session, (s) => {
    const l = !ids.length && link ? s.scene?.links.find((x) => x.id === link) : undefined;
    return {
      working: s.working,
      waiting: s.waiting,
      locked: s.locked,
      runId: s.run?.id,
      chosenLink: l,
      linkName: l && nameIn(s, l.id),
    };
  });
  const linkId = chosenLink ? link : null;
  const page = useWorkPage({ session, asking, feedback, focus: { modules: selected, link: chosenLink } });
  const { sceneId, putAway, dismiss, detailId, setDetail, retyping, setRetyping, retyped } = page;
  const { restore, undo, enter, open, ask, swap, stop, send, resume } = page;
  // The latest reply shows under the canvas until it is put away.
  const replying = !putAway && !working && !waiting;
  const deselect = () => (canvas ? canvas.select([]) : (setSelected([]), setLink(null)));
  const toggle = (p: Panel) => {
    const next = panel === p ? "" : p;
    // The versions are looked at as wholes: what was selected in the one shown goes.
    if (next === "drafts") deselect();
    if (next === "edit") setTucked(!roomy());
    setPanel(next);
    session.endPreview();
  };
  /** Asks for a material of one kind from the library, for what it is chosen for. */
  const pick = (kind: "picture" | "drawing", chosen: (m: Material) => void) =>
    setChoosing({ kind, chosen });
  const hand = useEditing({
    session,
    canvas,
    editing,
    selected: ids,
    link: linkId,
    pick,
    retype: setRetyping,
    help: () => setHelp(true),
  });
  // What is selected and open belongs to the scene it was in.
  useEffect(() => {
    setSelected([]);
    setLink(null);
    setScenes(false);
  }, [session, sceneId]);
  // While the author draws, the studio shows how it goes about it, unless the person is
  // editing by hand or the panel would cover the canvas.
  useEffect(() => {
    if (working && roomy()) setPanel((p) => (p === "edit" ? p : "journal"));
  }, [runId, working]);
  useEffect(() => {
    const el = conversation.current;
    if (el) el.scrollTop = el.scrollHeight;
    following.current = true;
  }, [journal]);
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
  // unless a field is being typed in; Cmd/Ctrl+S saves the hand edits as a version; Escape
  // ends a preview, or puts the reply away.
  const keys = useRef({ replying, journal, detailId, undo: () => {}, dismiss });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const s = session.get(),
        k = e.key.toLowerCase(),
        mod = e.metaKey || e.ctrlKey,
        typing = (e.target as Element).closest?.("input,textarea,[contenteditable]");
      if (mod && (k === "z" || k === "y") && !typing) {
        e.preventDefault();
        if (s.working || s.preview) return;
        if (k === "y" || e.shiftKey) {
          if (s.redoable) void attempt(session.redo);
        } else if (s.undoable) keys.current.undo();
      } else if (mod && k === "s" && s.unsaved) {
        e.preventDefault();
        if (!s.locked) void attempt(session.save);
      } else if (e.key === "Escape") {
        if (s.preview) session.endPreview();
        else if (keys.current.replying && !keys.current.journal && !keys.current.detailId)
          keys.current.dismiss();
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [session]);

  keys.current = { replying, journal, detailId, undo, dismiss };
  /** Words or a picture pointed at on the canvas: words are changed where they are, a
   * picture is swapped for one from the library. What the work cannot change by itself is
   * written up for the author to do. */
  function point(p: Pointed) {
    if (session.get().locked) return;
    if (!editing) edit();
    if (p.kind === "text") return setRetyping(p);
    pick("picture", (m) => swap(p.moduleId, p.material, m));
  }
  /** Takes up editing by hand. */
  function edit() {
    setTucked(!roomy());
    setPanel("edit");
  }
  return (
    <div
      className={cx("workspace")}
      data-panel={panel || undefined}
      data-tucked={(editing && tucked) || undefined}
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
        data-editing={(editing && !locked) || undefined}
        data-ruled={(editing && !locked && board.rulers) || undefined}
        onPointerDown={(e) => {
          if (replying && (e.target as Element).closest("[data-canvas]")) dismiss();
        }}
        // While editing, pictures and the library's drawings are dropped where they belong.
        onDragOver={(e) => {
          if (!editing || locked) return;
          const types = [...e.dataTransfer.types];
          if (types.includes("Files") || types.includes(DRAWING_TYPE)) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.defaultPrevented || !editing || locked || !canvas) return;
          const drawing = e.dataTransfer.getData(DRAWING_TYPE);
          const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
          if (!drawing && !files.length) return;
          e.preventDefault();
          const r = canvas.element.getBoundingClientRect(),
            v = canvas.view;
          const at = { x: (e.clientX - r.left - v.x) / v.scale, y: (e.clientY - r.top - v.y) / v.scale };
          if (drawing)
            void attempt(async () => {
              const m = await drawingById(drawing);
              if (m) await hand.ops.drawing(m, at);
            });
          else hand.ops.pictures(files, at);
        }}
      >
        <Topbar
          session={session}
          titling={titling}
          setTitling={setTitling}
          menu={scenes}
          setMenu={setScenes}
          enter={enter}
          rename={(title) => void attempt(() => session.rename(title))}
          drafting={panel === "drafts"}
          versions={() => toggle("drafts")}
        />
        <CanvasArea
          session={session}
          editing={editing}
          view={(c) => {
            setCanvas(c);
            session.attach(c);
          }}
          open={open}
          select={setSelected}
          selectLink={setLink}
          point={point}
          hand={hand}
          board={board}
          setBoard={setBoard}
          help={() => setHelp(true)}
          opening={<Opening draft={draft} byHand={edit} place="desk" />}
        />
        {editing && !locked && (
          <EditOverlay
            session={session}
            hand={hand}
            canvas={canvas}
            stage={stage.current}
            ids={ids}
            link={linkId}
            retyping={!!retyping}
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
          <Bars session={session} feedback={feedback} restore={restore} undo={undo} />
          <WorkComposer
            session={session}
            asking={asking}
            feedback={feedback}
            go={go}
            status={
              <WorkStatus
                session={session}
                journal={journal}
                putAway={putAway}
                answer={(o) => send({ text: o, picked: "" })}
                choose={draft.choose}
                reveal={() => setPanel("journal")}
                dismiss={dismiss}
                resume={resume}
                restore={restore}
                feedback={feedback}
              />
            }
            quote={
              selected.length
                ? selected.map((x) => x.label || x.moduleId).join(t.now.list)
                : linkName
            }
            unquote={deselect}
            selecting={!!selected.length || !!chosenLink}
            edit={editing || locked ? undefined : edit}
            send={() => send()}
            stop={stop}
          />
        </div>
        {editing && tucked && (
          <button
            className={cx("untuck")}
            aria-label={t.edit.panel.show}
            data-tip={t.edit.panel.show}
            onClick={() => setTucked(false)}
          >
            <PanelRightOpen size={16} />
            <span>{t.edit.tabs.properties}</span>
          </button>
        )}
        <WorkDetail session={session} detailId={detailId} close={() => setDetail(undefined)} />
      </section>
      <aside className={cx("side")} aria-label={t.work.panel}>
        <SideTools session={session} panel={panel} toggle={toggle} undo={undo} feedback={feedback} />
        <div
          className={cx("side-panel")}
          data-kind={panel || undefined}
          inert={!panel || (editing && tucked)}
        >
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
            {editing && (
              <button
                className={cx("tuck")}
                aria-label={t.edit.panel.hide}
                data-tip={t.edit.panel.hide}
                onClick={() => setTucked(true)}
              >
                <PanelRightClose size={16} />
              </button>
            )}
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
              <EditPane
                session={session}
                ids={ids}
                link={linkId}
                canvas={canvas}
                change={(make) => attempt(() => session.change(make)).then(() => true)}
                ops={hand.ops}
                pick={pick}
                enter={enter}
                ask={() => ask()}
              />
            ) : drafting ? (
              <WorkDrafts session={session} restore={restore} feedback={feedback} />
            ) : (
              <WorkStudio
                session={session}
                restore={restore}
                resume={resume}
                go={go}
                follow={() => {
                  const el = conversation.current;
                  if (el && following.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                }}
              />
            )}
          </section>
        </div>
      </aside>
      {help && <ShortcutSheet close={() => setHelp(false)} />}
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
