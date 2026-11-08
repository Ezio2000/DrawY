import { useEffect, useRef, useState } from "react";
import type { Run, Scene, Version, Work } from "../../../../modules/contracts/index.ts";
import { api } from "../api.ts";
import { Edits } from "./edits.ts";
import { editOps, type SessionOps } from "./ops.ts";
import { Revisions } from "./revisions.ts";
import { Runs } from "./runs.ts";
import { Scenes } from "./scenes.ts";
import { Sending } from "./sending.ts";
import { Store, useStore } from "./store.ts";
import type { Ask, Change, Context, SessionHost, View } from "./types.ts";
import { Versions } from "./versions.ts";

export * from "./types.ts";

/* One open work, as any page shows it. It is made of parts, each with one job and its own
 * state: the work and its revisions (`Revisions`), the author's runs and the server's
 * events (`Runs`), hand edits on their way and their draft (`Edits`), requests and holding
 * them back (`Sending`), saving, discarding, going back, undoing and redoing (`Versions`),
 * and the scene in view (`Scenes`). The session puts what they know into one snapshot and
 * what they do into one set of actions. It has no markup, keeps nothing in the browser and
 * does not touch the page: a shell shows the snapshot, calls the actions, keeps whatever
 * belongs to how it looks (what is selected, which detail page is open, a reply put away)
 * and hands the session the `View` the work is drawn on. */

export interface Snapshot {
  id: string;
  /** The work as saved. */
  work?: Work;
  /** The work with the hand edits on their way laid on it. */
  shown?: Work;
  /** What the canvas shows: the work as shown or an earlier revision, and what tells this
   * showing of it from another of the same revision. */
  display?: { work: Work; version: string };
  /** An earlier revision shown in place of the current one. */
  preview?: { revision: number; work: Work };
  runs: Run[];
  run?: Run;
  /** Whether the runs have arrived; until then nothing can be sent or edited. */
  loaded: boolean;
  /** The latest run as it stood when the work was opened, if it had ended. */
  earlier?: string;
  /** Whether the server's events cannot be heard now. */
  offline: boolean;
  working: boolean;
  /** The author asked something and waits for the answer. */
  waiting: boolean;
  /** The author works or waits for an answer. */
  engaged: boolean;
  /** The scene in view: the one addressed, or the root when the work has no such scene. */
  sceneId: string;
  scene?: Scene;
  versions: Version[];
  /** Whether the revisions have caught up with the work; until then they say nothing. */
  synced: boolean;
  /** Hand edits not saved as a version. */
  unsaved: number;
  /** A request on its way. */
  sending: boolean;
  /** A request waits for the person to say what becomes of their unsaved edits. */
  holding: boolean;
  /** Going back to a version, while it can be taken back. */
  back?: { at: number; from: number; text: string };
  undoable: boolean;
  redoable: boolean;
  /** Editing waits while the runs load, the author works or waits, or a preview shows. */
  locked: boolean;
}

/** What a shell can do with the session, each bound once so it can be handed on as is.
 * The ones that resolve may reject with what went wrong, for the shell to say; `ops`
 * report their failures to the host themselves. */
export interface Actions {
  send(ask: Ask): Promise<void>;
  decide(how: "save" | "discard" | "cancel"): Promise<void>;
  save(): Promise<Work>;
  discard(): Promise<Work>;
  restore(revision: number): Promise<void>;
  /** Takes back going back to a version, else the latest request or hand edit. */
  undo(): Promise<void>;
  redo(): Promise<void>;
  look(revision: number): Promise<void>;
  endPreview(): void;
  /** Stops the author; resolves to what was asked, to change and send again. */
  stop(): Promise<string | undefined>;
  /** Stops the author without handing anything back, as when a question is put aside. */
  cancel(): Promise<void>;
  change: Change;
  /** Goes into a scene, asking for it when nothing is drawn there yet. */
  enter(id: string, title?: string): Promise<void>;
  rename(title: string): Promise<void>;
  /** Whether a revision is the person's own change, to show at once rather than draw. */
  quiet(revision: number): boolean;
  /** The view the work is drawn on, once it is there, and none once it goes. */
  attach(view: View | undefined): void;
  ops: SessionOps;
}

export type Session = Snapshot & Actions;

export class WorkSession extends Store<Session> {
  private ctx: Context;
  private actions: Actions;

  /** Opens a work by its id: it loads, and follows the server from then on. A work just
   * made here (`made`) shows at once, with no runs to wait for. */
  constructor(id: string, host: SessionHost, made?: Work) {
    super();
    const ctx = {
      id,
      host,
      disposed: false,
      changed: () => this.build(),
    } as Context;
    this.ctx = ctx;
    ctx.revisions = new Revisions(ctx);
    ctx.edits = new Edits(ctx);
    ctx.sending = new Sending(ctx);
    ctx.versions = new Versions(ctx);
    ctx.scenes = new Scenes(ctx);
    ctx.runs = new Runs(ctx);
    const { revisions, runs, edits, sending, versions, scenes } = ctx;
    this.actions = {
      send: (ask) => sending.send(ask),
      decide: (how) => sending.decide(how),
      save: () => versions.save(),
      discard: () => versions.discard(),
      restore: (revision) => versions.restore(revision),
      undo: () => versions.undo(),
      redo: () => versions.redo(),
      look: (revision) => revisions.look(revision),
      endPreview: () => revisions.endPreview(),
      stop: () => sending.stop(),
      cancel: async () => {
        const run = runs.run;
        if (run) await api("/runs/" + run.id + "/cancel", "POST");
      },
      change: edits.change,
      enter: (id, title) => scenes.enter(id, title),
      rename: (title) => revisions.rename(title),
      quiet: (revision) => revisions.quiet(revision),
      attach: (view) => void (ctx.view = view),
      ops: editOps(ctx),
    };
    if (made) {
      runs.begin();
      revisions.begin(made);
    } else {
      this.build();
      void runs.load().catch((e) => host.fail(e));
    }
  }

  get id() {
    return this.ctx.id;
  }

  /** The address names this scene now. */
  locate(addressed: string | undefined) {
    this.ctx.scenes.locate(addressed);
  }

  dispose() {
    this.ctx.disposed = true;
    this.ctx.runs.dispose();
    this.ctx.versions.dispose();
  }

  private build() {
    if (this.ctx.disposed || !this.actions) return;
    const { revisions, runs, edits, sending, versions, scenes } = this.ctx;
    const work = revisions.work,
      preview = revisions.preview,
      draft = edits.draft;
    const sceneId = scenes.sceneId;
    const shown = draft && work && draft.work.id === work.id ? draft.work : work;
    this.publish({
      ...this.actions,
      id: this.ctx.id,
      work,
      shown,
      display: shown && {
        work: preview?.work.scenes[sceneId] ? preview.work : shown,
        version: !preview && draft ? "~" + draft.n : "",
      },
      preview,
      runs: runs.runs,
      run: runs.run,
      loaded: runs.loaded,
      earlier: runs.earlier,
      offline: runs.offline,
      working: runs.working,
      waiting: runs.waiting,
      engaged: runs.working || runs.waiting,
      sceneId,
      scene: work?.scenes[sceneId],
      versions: revisions.counted.of.versions,
      synced: revisions.synced,
      unsaved: revisions.unsaved,
      sending: sending.sending,
      holding: sending.holding,
      back: versions.back,
      undoable: !!work && versions.undoable,
      redoable: versions.redoable,
      locked: !runs.loaded || runs.working || runs.waiting || !!preview,
    });
  }
}

/** The work at an address, kept open while the address names it: the session for it is
 * made when the address comes to it and let go when the address leaves. A work made here
 * is opened with `begin`, before going to its address, so it shows at once. */
export function useWorkSession(id: string | undefined, host: SessionHost) {
  const [session, setSession] = useState<WorkSession>();
  const current = useRef<WorkSession>(undefined);
  const replace = (next: WorkSession | undefined) => {
    current.current?.dispose();
    current.current = next;
    setSession(next);
  };
  useEffect(() => {
    if (id && current.current?.id !== id) replace(new WorkSession(id, host));
    if (!id && current.current) replace(undefined);
  }, [id]);
  useEffect(() => () => current.current?.dispose(), []);
  const open = session?.id === id ? session : undefined;
  return {
    session: useStore(open),
    store: open,
    begin(work: Work) {
      const made = new WorkSession(work.id, host, work);
      replace(made);
      return made;
    },
  };
}
