import { useEffect, useState } from "react";
import type { Material } from "@drawy/materials/schema";
import type { Pointed } from "../../../modules/canvas/index.ts";
import { shownName, versionOf, type Target } from "../../../modules/contracts/index.ts";
import { fieldsOf, removeParts, replace, setData } from "../../../modules/editing/index.ts";
import { EXPLAIN_FOR } from "./feedback.ts";
import { useT } from "./i18n.tsx";
import { useSelect } from "./session/store.ts";
import type { Ask, Snapshot } from "./session/work.ts";
import type { ShellProps } from "./shell.ts";

/** What a part is called on the page: a module by its name, a link by the modules it joins. */
export function nameIn(s: Snapshot, id: string): string {
  const l = s.scene?.links.find((x) => x.id === id);
  if (l) return `${nameIn(s, l.from.moduleId)} → ${nameIn(s, l.to.moduleId)}`;
  const m = s.scene?.modules.find((x) => x.id === id);
  return m && s.work ? shownName(s.work, m) : id;
}

/** What the canvas reads of the session: the work as it shows now, the scene, whether it
 * may be edited, and the run drawing on it. */
export const shownOf = (s: Snapshot) => ({
  id: s.id,
  display: s.display!,
  sceneId: s.sceneId,
  locked: s.locked,
  run: s.engaged ? s.run : undefined,
});

/** What the notes over the canvas read: a preview, going back, a request held for unsaved
 * edits, and the edits themselves. */
export const notesOf = (s: Snapshot) => ({
  preview: s.preview?.revision,
  looked: s.preview && (versionOf(s.versions, s.preview.revision)?.number ?? 0),
  next: (s.versions.at(-1)?.number ?? 0) + 1,
  back: s.back,
  holding: s.holding,
  unsaved: s.unsaved,
  engaged: s.engaged,
  working: s.working,
  locked: s.locked,
});

/** What every work page does the same way, whatever device it is laid out for: the reply
 * put away, the detail page open, words being retyped, what the session tells of, going
 * back, undoing, entering scenes, sending, resuming and stopping, and handing the author
 * what the work cannot change by itself. Each page keeps the rest (its selection, its
 * panels or sheets) and gives what a request is about as `focus`. It reads from the session
 * only what changes when a run starts or ends or the scene changes. */
export function useWorkPage({
  session,
  asking,
  feedback,
  focus,
}: Pick<ShellProps, "session" | "asking" | "feedback"> & { focus: Ask["focus"] }) {
  const t = useT();
  const { attempt } = feedback;
  const { draft } = asking;
  // The run whose reply was put away, the detail page open over the scene, and words
  // being changed where they are drawn.
  const [dismissed, setDismissed] = useState("");
  const [detailId, setDetail] = useState<string>();
  const [retyping, setRetyping] = useState<Extract<Pointed, { kind: "text" }>>();
  const { sceneId, runId, earlier } = useSelect(session, (s) => ({
    sceneId: s.sceneId,
    runId: s.run?.id,
    earlier: s.earlier,
  }));
  // The latest reply shows over the composer until it is put away; one from before the
  // work was opened stays in the studio.
  const putAway = !runId || runId === dismissed || runId === earlier;
  const dismiss = () => setDismissed(session.get().run?.id ?? "");

  // What the session tells of, in the page's words.
  useEffect(
    () =>
      session.on((h) =>
        h.kind === "saved"
          ? feedback.say(t.unsaved.saved(h.version))
          : h.kind === "adjusted"
            ? feedback.say(t.edit.bring.adjusted(h.upright, h.opaque), EXPLAIN_FOR)
            : feedback.fail(h.error),
      ),
    [session, t],
  );
  // What is open belongs to the scene it was in.
  useEffect(() => {
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
  /** Follows a module's target: into a scene, or a detail page over this one. */
  const open = (target: Target) =>
    target.kind === "scene" ? enter(target.id) : setDetail(target.id);
  const nameOf = (id: string) => nameIn(session.get(), id);
  /** Hands a change to the author, written into the composer for the person to send. */
  const ask = (text?: string, why = "") => draft.hand(text, why);
  /** Swaps a picture for one from the library; what the work cannot change by itself is
   * written up for the author to do. */
  const swap = (moduleId: string, material: string, m: Material) =>
    void attempt(async () => {
      const done = await session.change((w) =>
        replace(w, sceneId, moduleId, "picture", material, m.id),
      );
      if (!done) {
        draft.use(m);
        ask(t.edit.askPicture(nameOf(moduleId)), t.edit.handedPicture);
      }
    });
  /** Words changed where they are drawn: emptied, the part goes. */
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
  const send = (more: Partial<Ask> = {}) =>
    void attempt(() => asking.send({ focus, ...more }));
  const resume = () =>
    send({ text: t.now.resumeMessage, scene: session.get().run?.sceneId ?? sceneId, picked: "" });

  return {
    sceneId,
    putAway,
    dismiss,
    detailId,
    setDetail,
    retyping,
    setRetyping,
    retyped,
    restore,
    undo,
    enter,
    open,
    ask,
    swap,
    stop,
    send,
    resume,
  };
}
