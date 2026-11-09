import { useEffect, useRef, useState } from "react";
import { Dialog } from "@drawy/ui";
import type { Material } from "@drawy/materials/schema";
import type { Canvas, Pointed } from "../../../../modules/canvas/index.ts";
import type { Selection, Target } from "../../../../modules/contracts/index.ts";
import { removeParts, replace } from "../../../../modules/editing/index.ts";
import { Retype } from "../Editor.tsx";
import { useT } from "../i18n.tsx";
import { Library } from "../Library.tsx";
import { counted } from "../probe.ts";
import { useSelect } from "../session/store.ts";
import type { Ask } from "../session/work.ts";
import type { ShellProps } from "../shell.ts";
import { Title } from "../Title.tsx";
import { cx } from "./cx.ts";
import {
  Actions,
  Detail,
  nameIn,
  Notes,
  PhoneCanvas,
  PhoneComposer,
  ScenesSheet,
  ShareSheet,
  Status,
  StudioSheet,
  TopBar,
  VersionsSheet,
  type SheetKind,
} from "./parts.tsx";

/** The work page on a phone, built for looking and asking: the drawing fills the screen,
 * the composer is at the thumb, and the studio, the versions and sharing come up as sheets.
 * Small changes are made with a finger on the part selected (its words, its picture,
 * deleting it, dragging it); anything more is described to the author, with the part.
 * Nothing here needs a right click, a modifier key, hovering or a keyboard shortcut.
 *
 * Like the desktop page, it keeps how the page is used (what is selected, the sheet open,
 * the detail page, the reply put away, words being retyped) and reads from the session
 * only what changes when a run starts or ends or the scene changes. */
export default function PhoneWorkPage({ session, asking, feedback, go }: ShellProps) {
  counted("phone.page");
  const t = useT();
  const { attempt } = feedback;
  const { draft } = asking;
  const [selected, setSelected] = useState<Selection[]>([]);
  const [sheet, setSheet] = useState<SheetKind>("");
  const [detailId, setDetail] = useState<string>();
  const [dismissed, setDismissed] = useState("");
  const [retyping, setRetyping] = useState<Extract<Pointed, { kind: "text" }>>();
  // A picture being chosen from the library, and what it is for.
  const [choosing, setChoosing] = useState<(m: Material) => void>();
  const [canvas, setCanvas] = useState<Canvas>();
  const stage = useRef<HTMLDivElement>(null);
  const ids = selected.map((x) => x.moduleId);
  const { sceneId, working, waiting, locked, runId, earlier } = useSelect(session, (s) => ({
    sceneId: s.sceneId,
    working: s.working,
    waiting: s.waiting,
    locked: s.locked,
    runId: s.run?.id,
    earlier: s.earlier,
  }));
  // The latest reply shows over the composer until it is put away; one from before the
  // work was opened stays in the studio.
  const putAway = !runId || runId === dismissed || runId === earlier;
  const dismiss = () => setDismissed(session.get().run?.id ?? "");
  const deselect = () => (canvas ? canvas.select([]) : setSelected([]));
  /** Opens a sheet. The versions are looked at as wholes: what was selected in the one
   * shown goes, with the actions on it. */
  const show = (kind: SheetKind) => {
    if (kind === "versions") deselect();
    setSheet(kind);
  };

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
    setDetail(undefined);
    setRetyping(undefined);
  }, [session, sceneId]);

  /** Going back, or undoing, puts the reply away. */
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
  const enter = (id: string) => void attempt(() => session.enter(id, t.work.expand));
  const open = (target: Target) =>
    target.kind === "scene" ? enter(target.id) : setDetail(target.id);
  const nameOf = (id: string) => nameIn(session.get(), id);
  /** Hands a change to the author, written into the composer for the person to send. */
  const ask = (text?: string, why = "") => draft.hand(text, why);

  /** Swaps a picture for one from the library; what the work cannot change by itself is
   * written up for the author to do. */
  const swap = (moduleId: string, material: string) =>
    setChoosing(() => (m: Material) =>
      void attempt(async () => {
        const done = await session.change((w) =>
          replace(w, sceneId, moduleId, "picture", material, m.id),
        );
        if (!done) {
          draft.use(m);
          ask(t.edit.askPicture(nameOf(moduleId)), t.edit.handedPicture);
        }
      }),
    );
  /** A double tap on words changes them where they are; on a picture, swaps it. */
  function point(p: Pointed) {
    if (session.get().locked) return;
    if (p.kind === "text") return setRetyping(p);
    swap(p.moduleId, p.material);
  }
  function retyped(text: string | null) {
    const p = retyping!;
    setRetyping(undefined);
    if (text === null || text === p.text) return;
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
    void attempt(() => asking.send({ focus: { modules: selected }, ...ask }));
  const resume = () =>
    send({ text: t.now.resumeMessage, scene: session.get().run?.sceneId ?? sceneId, picked: "" });
  const one = ids.length === 1 ? ids[0] : undefined;

  return (
    <div className={cx("phone")} data-shell="phone">
      <div className={cx("stage")} ref={stage}>
        <PhoneCanvas
          session={session}
          view={(c) => {
            setCanvas(c);
            session.attach(c);
          }}
          open={open}
          select={setSelected}
          point={point}
        />
        <TopBar session={session} back={() => go("/")} open={show} undo={undo} />
        {retyping && stage.current && (
          <Retype
            key={retyping.moduleId + ":" + retyping.text}
            pointed={retyping}
            stage={stage.current}
            done={retyped}
          />
        )}
        <div className={cx("dock")} data-dock>
          <Notes session={session} feedback={feedback} restore={restore} undo={undo} />
          {one && !working && (
            <Actions
              session={session}
              id={one}
              canvas={canvas}
              retype={() => {
                const words = canvas?.wordsIn(one);
                if (words) setRetyping(words);
              }}
              swap={(material) => swap(one, material)}
              remove={() => {
                session.ops.remove([one]);
                deselect();
              }}
              describe={() => ask()}
              deselect={deselect}
            />
          )}
          <PhoneComposer
            session={session}
            asking={asking}
            feedback={feedback}
            go={go}
            status={
              <Status
                session={session}
                putAway={putAway}
                answer={(o) => send({ text: o, picked: "" })}
                choose={draft.choose}
                reveal={() => setSheet("studio")}
                dismiss={dismiss}
                resume={resume}
                restore={restore}
                feedback={feedback}
              />
            }
            quote={selected.length ? selected.map((x) => x.label || x.moduleId).join(t.now.list) : undefined}
            unquote={deselect}
            selecting={!!selected.length && !waiting}
            send={() => send()}
            stop={stop}
          />
        </div>
        <Detail session={session} detailId={detailId} close={() => setDetail(undefined)} />
      </div>
      {sheet === "studio" && (
        <StudioSheet session={session} close={() => setSheet("")} restore={restore} resume={resume} go={go} />
      )}
      {sheet === "versions" && (
        <VersionsSheet session={session} close={() => setSheet("")} restore={restore} feedback={feedback} />
      )}
      {sheet === "share" && <ShareSheet session={session} close={() => setSheet("")} feedback={feedback} />}
      {sheet === "scenes" && (
        <ScenesSheet
          session={session}
          close={() => setSheet("")}
          enter={enter}
          rename={(title) => void attempt(() => session.rename(title))}
        />
      )}
      {choosing && !locked && (
        <Dialog
          title={t.titles.choosePicture}
          heading={<Title name="choosePicture" size="section" />}
          wide
          onClose={() => setChoosing(undefined)}
        >
          <Library
            kinds={["picture"]}
            action={t.edit.usePicture}
            use={(m) => {
              const chosen = choosing;
              setChoosing(undefined);
              if (m.kind === "picture") chosen(m);
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
