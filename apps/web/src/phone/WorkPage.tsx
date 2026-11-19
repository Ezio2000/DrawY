import { useEffect, useRef, useState } from "react";
import { WorkComposer } from "../Composer.tsx";
import { WorkStatus } from "../Studio.tsx";
import { WorkDetail } from "../SceneView.tsx";
import { Dialog } from "../ui/dialogs.tsx";
import type { Material } from "@drawy/materials/schema";
import type { Canvas, Pointed } from "../../../../modules/canvas/index.ts";
import type { Selection } from "../../../../modules/contracts/index.ts";
import { Retype } from "../Editor.tsx";
import { useT } from "../i18n.tsx";
import { Library } from "../Library.tsx";
import { Opening } from "../Opening.tsx";
import { counted } from "../probe.ts";
import { useSelect } from "../session/store.ts";
import type { ShellProps } from "../shell.ts";
import { Title } from "../Title.tsx";
import { cx } from "./cx.ts";
import { useWorkPage } from "../workPage.ts";
import {
  Actions,
  Notes,
  PhoneCanvas,
  ScenesSheet,
  ShareSheet,
  StudioSheet,
  TopBar,
  VersionsSheet,
  Whole,
  type SheetKind,
} from "./parts.tsx";
import { useBackCloses } from "./back.ts";

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
  const page = useWorkPage({ session, asking, feedback, focus: { modules: selected } });
  const { sceneId, putAway, dismiss, detailId, setDetail, retyping, setRetyping, retyped } = page;
  const { restore, undo, enter, open, ask, stop, send, resume } = page;
  // A picture being chosen from the library, and what it is for.
  const [choosing, setChoosing] = useState<(m: Material) => void>();
  const [canvas, setCanvas] = useState<Canvas>();
  const stage = useRef<HTMLDivElement>(null);
  const ids = selected.map((x) => x.moduleId);
  const { working, waiting, locked } = useSelect(session, (s) => ({
    working: s.working,
    waiting: s.waiting,
    locked: s.locked,
  }));
  const deselect = () => (canvas ? canvas.select([]) : setSelected([]));
  /** Opens a sheet. The versions are looked at as wholes: what was selected in the one
   * shown goes, with the actions on it. */
  const show = (kind: SheetKind) => {
    if (kind === "versions") deselect();
    setSheet(kind);
  };

  // The browser's way back closes what is open over the drawing before it leaves the work.
  useBackCloses(!!sheet, () => setSheet(""));
  useBackCloses(!!detailId, () => setDetail(undefined));
  // What is selected belongs to the scene it was in.
  useEffect(() => setSelected([]), [session, sceneId]);

  /** Swaps a picture for one chosen from the library. */
  const swap = (moduleId: string, material: string) =>
    setChoosing(() => (m: Material) => page.swap(moduleId, material, m));
  /** A double tap on words changes them where they are; on a picture, swaps it. */
  function point(p: Pointed) {
    if (session.get().locked) return;
    if (p.kind === "text") return setRetyping(p);
    swap(p.moduleId, p.material);
  }
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
          opening={<Opening draft={draft} place="phone" />}
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
          <Whole canvas={canvas} />
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
          <WorkComposer
            session={session}
            asking={asking}
            feedback={feedback}
            go={go}
            status={
              <WorkStatus
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
        <WorkDetail session={session} detailId={detailId} close={() => setDetail(undefined)} />
      </div>
      {sheet === "studio" && (
        <StudioSheet
          session={session}
          close={() => setSheet("")}
          restore={restore}
          resume={resume}
          go={go}
          show={show}
        />
      )}
      {sheet === "versions" && (
        <VersionsSheet
          session={session}
          close={() => setSheet("")}
          restore={restore}
          feedback={feedback}
          show={show}
        />
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
