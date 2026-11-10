import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Dialog } from "@drawy/ui";
import type { Material } from "@drawy/materials/schema";
import type { Canvas, Pointed } from "../../../../modules/canvas/index.ts";
import type { Selection, Target } from "../../../../modules/contracts/index.ts";
import { fieldsOf, removeParts, replace, setData } from "../../../../modules/editing/index.ts";
import { cx } from "../cx.ts";
import { useT } from "../i18n.tsx";
import { Library } from "../Library.tsx";
import { counted } from "../probe.ts";
import { Retype, ShortcutSheet } from "../Editor.tsx";
import { DRAWING_TYPE, drawingById } from "../EditTray.tsx";
import { useBoard } from "../EditView.tsx";
import { useSelect } from "../session/store.ts";
import type { Ask } from "../session/work.ts";
import type { ShellProps } from "../shell.ts";
import { Title } from "../Title.tsx";
import { useEditing } from "./editing.ts";
import { panelWidth, Resizer } from "./panels.tsx";
import {
  Bars,
  CanvasArea,
  DetailLayer,
  DockComposer,
  DraftsPane,
  EditOverlay,
  EditPane,
  nameIn,
  SideTools,
  Status,
  StudioPane,
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
  // The sheet of shortcuts, and how the drawing board is set up.
  const [help, setHelp] = useState(false);
  const [board, setBoard] = useBoard();
  const stage = useRef<HTMLElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const following = useRef(true);
  const journal = panel === "journal",
    drafting = panel === "drafts",
    editing = panel === "edit";
  const ids = selected.map((x) => x.moduleId);
  const { sceneId, working, waiting, locked, runId, earlier, chosenLink, linkName } = useSelect(
    session,
    (s) => {
      const l = !ids.length && link ? s.scene?.links.find((x) => x.id === link) : undefined;
      return {
        sceneId: s.sceneId,
        working: s.working,
        waiting: s.waiting,
        locked: s.locked,
        runId: s.run?.id,
        earlier: s.earlier,
        chosenLink: l,
        linkName: l && nameIn(s, l.id),
      };
    },
  );
  const linkId = chosenLink ? link : null;
  // The latest reply shows under the canvas until it is put away; one from before the
  // work was opened stays in the studio.
  const putAway = !runId || runId === dismissed || runId === earlier;
  const replying = !putAway && !working && !waiting;
  const dismiss = () => setDismissed(session.get().run?.id ?? "");
  const deselect = () => (canvas ? canvas.select([]) : (setSelected([]), setLink(null)));
  const toggle = (p: Panel) => {
    const next = panel === p ? "" : p;
    // The versions are looked at as wholes: what was selected in the one shown goes.
    if (next === "drafts") deselect();
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
  /** Hands a change to the author, written into the composer for the person to send. */
  const ask = (text?: string, why = "") => draft.hand(text, why);

  // What the session tells of, in this page's words.
  useEffect(
    () =>
      session.on((h) =>
        h.kind === "saved" ? feedback.say(t.unsaved.saved(h.version)) : feedback.fail(h.error),
      ),
    [session, t],
  );
  // What is selected and open belongs to the scene it was in.
  useEffect(() => {
    setSelected([]);
    setLink(null);
    setDetail(undefined);
    setScenes(false);
    setRetyping(undefined);
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

  /** Going back, or undoing, puts the reply under the canvas away. */
  const restore = (revision: number) =>
    void attempt(async () => {
      await session.restore(revision);
      dismiss();
    });
  const undo = () =>
    void attempt(async () => {
      await session.undo();
      dismiss();
    });
  keys.current = { replying, journal, detailId, undo, dismiss };
  const enter = (id: string) => void attempt(() => session.enter(id, t.work.expand));
  /** Follows a module's target: into a scene, or a detail page over this one. */
  const open = (target: Target) =>
    target.kind === "scene" ? enter(target.id) : setDetail(target.id);
  const nameOf = (id: string) => nameIn(session.get(), id);

  /** Words or a picture pointed at on the canvas: words are changed where they are, a
   * picture is swapped for one from the library. What the work cannot change by itself is
   * written up for the author to do. */
  function point(p: Pointed) {
    if (session.get().locked) return;
    if (!editing) setPanel("edit");
    if (p.kind === "text") return setRetyping(p);
    pick("picture", (m) =>
      void attempt(async () => {
        const done = await session.change((w) =>
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
    // A link that said nothing is given its first words, where its drawing takes words.
    if (p.link && !p.text)
      return void attempt(async () => {
        const done = await session.change((w) => {
          const l = w.scenes[sceneId]?.links.find((x) => x.id === p.moduleId);
          const words = l && fieldsOf(w, l).find((f) => f.type === "text");
          return words ? setData(w, sceneId, p.moduleId, { [words.key]: text.trim() }) : null;
        });
        if (!done) ask(t.edit.askLabel(nameOf(p.moduleId), text.trim()), t.edit.handedText);
      });
    if (!text.trim())
      return void attempt(() => session.change((w) => removeParts(w, sceneId, [p.moduleId])));
    void attempt(async () => {
      if (!(await session.change((w) => replace(w, sceneId, p.moduleId, "text", p.text, text))))
        ask(t.edit.askText(nameOf(p.moduleId), p.text, text), t.edit.handedText);
    });
  }
  /** Stopping hands what was asked back to the composer, to change and send again. */
  const stop = () =>
    void attempt(async () => {
      const asked = await session.stop();
      if (asked && !draft.get().text.trim()) draft.write(asked);
    });
  /** Sends the request, about what is selected. */
  const send = (ask: Partial<Ask> = {}) =>
    void attempt(() => asking.send({ focus: { modules: selected, link: chosenLink }, ...ask }));
  const resume = () =>
    send({
      text: t.now.resumeMessage,
      scene: session.get().run?.sceneId ?? sceneId,
      picked: "",
    });

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
          if (!editing || locked || !canvas) return;
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
          <DockComposer
            session={session}
            asking={asking}
            feedback={feedback}
            go={go}
            status={
              <Status
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
            edit={editing || locked ? undefined : () => setPanel("edit")}
            send={() => send()}
            stop={stop}
          />
        </div>
        <DetailLayer session={session} detailId={detailId} close={() => setDetail(undefined)} />
      </section>
      <aside className={cx("side")} aria-label={t.work.panel}>
        <SideTools session={session} panel={panel} toggle={toggle} undo={undo} feedback={feedback} />
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
              <DraftsPane session={session} restore={restore} feedback={feedback} />
            ) : (
              <StudioPane
                session={session}
                restore={restore}
                resume={resume}
                go={go}
                body={conversation}
                following={following}
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
