import { useEffect, useRef, useState } from "react";
import type { Locale } from "@drawy/ui";
import {
  historyOf,
  stepBefore,
  type Link,
  type Point,
  type RevisionSummary,
  type Run,
  type Scene,
  type Selection,
  type Target,
  type UnsavedEdit,
  type Version,
  type Work,
  type WorkEdit,
} from "../../../../modules/contracts/index.ts";
import { applied, showable, shownName } from "../../../../modules/editing/index.ts";
import { api } from "../api.ts";
import type { ServerEvent } from "../events.ts";
import type { Words } from "../i18n.tsx";
import { addressOf } from "../routes.ts";
import { kept } from "./clip.ts";
import { editOps, type SessionOps } from "./ops.ts";
import { Store, useStore } from "./store.ts";

/* One open work, as any page shows it: the work and its revisions, the author's runs and
 * the server's events about them, sending a request (and holding it back while hand edits
 * are not saved), the queue of hand edits and the draft they lay on the work, and saving,
 * throwing away, previewing, going back to, undoing and redoing versions. It has no markup
 * and does not touch the page: a shell shows its snapshot and calls its actions, and hands
 * it the `View` the work is drawn on. */

/** Whether the author is at work on a run: drawing or looking at what it drew. */
export const live = (run?: Run) => !!run && ["running", "viewing"].includes(run.status);

/** What the session asks of whatever the work is drawn on. Places are in scene units. */
export interface View {
  /** The middle of what is in view. */
  center(): Point;
  /** How many screen pixels a scene unit takes now. */
  readonly scale: number;
  /** Selects these modules, or none; the view says what is selected through
   * `Session.select` and `Session.selectLink`. */
  select(ids: string[]): void;
  /** Settles once these modules are drawn: true, or false if they are not drawn soon. */
  drawn(ids: string[]): Promise<boolean>;
}

/** What the session needs from the app around it. */
export interface SessionHost {
  words(): Words;
  locale(): Locale;
  /** Goes to an address: as a new entry in the browser's history, or in place of the
   * address when it names a scene the work no longer has. */
  go(path: string, how: "push" | "replace"): void;
  /** The list of works may have changed: a request was made or the work renamed. */
  listed(): Promise<unknown>;
  /** A request was made, taking one from the allowance. */
  spent(): void;
  /** Something that went well, said briefly. */
  notice(text: string): void;
  /** Something done in the background failed. */
  fail(error: unknown): void;
  listen(listener: (event: ServerEvent) => void): () => void;
}

/** A request to the author, or an answer to its question. */
export interface Ask {
  text: string;
  /** Library materials sent along. */
  materials?: string[];
  /** Options picked on the author's questions, sent with the answer. */
  picked?: string;
  /** The scene asked about; the scene in view unless given. */
  scene?: string;
  /** Called once it is sent, which may be after the person decides about unsaved edits. */
  sent?: () => void;
}

/** Commits a hand edit made from the latest work; resolves to whether there was one. */
export type Change = (make: (work: Work) => WorkEdit | null) => Promise<boolean>;

interface State {
  work?: Work;
  history: RevisionSummary[];
  runs: Run[];
  /** Whether the runs have arrived; until then an empty studio is still loading. */
  loaded: boolean;
  /** The scene the address names. */
  addressed?: string;
  /** An earlier revision shown in place of the current one. */
  preview?: { revision: number; work: Work };
  /** Hand edits not saved yet, laid on the work so they show at once: the work they will
   * leave, and a count telling one showing from the next. */
  draft?: { work: Work; n: number };
  /** A request on its way to the server. */
  sending: boolean;
  /** Whether a request is held back while the person decides about their unsaved edits. */
  holding: boolean;
  /** Going back to a version, to take back while the work is still where it left it. */
  wentBack?: { at: number; from: number; text: string };
  /** Revisions undone, to bring back while the work is still where undoing left it. */
  undone?: { at: number; revisions: number[] };
  selected: Selection[];
  /** The link selected, when no module is. */
  link: string | null;
  /** The detail page open over the scene. */
  detailId?: string;
  /** The run whose reply has been put away. */
  dismissed: string;
  /** Whether there is something to paste. */
  clipped: boolean;
}

export interface Snapshot extends Readonly<State> {
  id: string;
  /** The latest run. */
  run?: Run;
  working: boolean;
  /** The author asked something and waits for the answer. */
  waiting: boolean;
  /** The author works or waits for an answer. */
  engaged: boolean;
  /** The scene in view: the one addressed, or the root when the work has no such scene. */
  sceneId: string;
  scene?: Scene;
  /** The versions as they stand, and the hand edits made since the latest. */
  versions: Version[];
  unsaved: UnsavedEdit[];
  /** Whether the revisions have caught up with the work; until then they say nothing. */
  synced: boolean;
  /** Hand edits not saved as a version, once the revisions say so. */
  unsavedCount: number;
  undoable: boolean;
  redoable: boolean;
  /** Editing waits while the runs load, the author works or an earlier revision is shown. */
  locked: boolean;
  /** The work with the hand edits on their way laid on it. */
  shown?: Work;
  /** What the canvas shows: the work as shown or an earlier revision, and what tells this
   * showing of it from another of the same revision. */
  display?: { work: Work; version: string };
  /** Whether the latest run's reply is still to be read where the work is. */
  replying: boolean;
  /** The selected module ids. */
  ids: string[];
  /** The selected link, when no module is. */
  chosenLink?: Link;
}

export type Session = Snapshot & Actions;

/** Revisions people make themselves (hand edits, undoing, going back) and the ones they
 * look at show at once rather than being drawn stroke by stroke. */
export class WorkSession extends Store<Session> {
  private state: State;
  /** Hand edits go one after another, each made from the work the last one left. */
  private edits: Promise<unknown> = Promise.resolve();
  /** Hand edits queued, and the work they will leave once all are saved. */
  private queued = 0;
  private drafted?: Work;
  /** Changes of the person's own still on their way. */
  private inflight = 0;
  private own = new Set<number>();
  private held?: (work: Work) => Promise<void>;
  private historyAsked = 0;
  private watched?: { id: string; live: boolean };
  private shownScene?: string;
  private replaced?: string;
  private wentBackTimer?: ReturnType<typeof setTimeout>;
  private stopListening: () => void;
  private disposed = false;
  view?: View;
  readonly actions: Actions;
  readonly ops: SessionOps;

  constructor(
    readonly id: string,
    readonly host: SessionHost,
    /** A work just made here: it is shown at once, with no runs to wait for. */
    made?: Work,
  ) {
    super();
    this.state = {
      history: made
        ? [{ revision: made.revision, updatedAt: made.updatedAt, cause: { kind: "create" } }]
        : [],
      runs: [],
      loaded: !!made,
      sending: false,
      holding: false,
      selected: [],
      link: null,
      dismissed: "",
      clipped: !!kept(),
    };
    this.ops = editOps(this);
    this.actions = actionsOf(this);
    this.stopListening = host.listen((e) => this.receive(e));
    if (made) this.set({ work: made });
    else {
      this.build();
      void this.load().catch((e) => this.host.fail(e));
    }
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.wentBackTimer);
    this.stopListening();
  }

  /** The work as saved, with the hand edits saved so far. */
  get work() {
    return this.state.work;
  }

  // State

  private memo?: { history: RevisionSummary[]; of: ReturnType<typeof historyOf> };
  private undoMemo?: { history: RevisionSummary[]; revision: number; before?: number };
  set(patch: Partial<State>) {
    if (this.disposed) return;
    const was = this.state;
    const next = { ...was, ...patch };
    if (patch.work && next.work && was.work?.revision !== next.work.revision) {
      // A preview ends when the work changes under it, and the revisions follow it.
      next.preview = undefined;
      queueMicrotask(() => this.fetchHistory());
    }
    if ("wentBack" in patch && patch.wentBack !== was.wentBack) {
      clearTimeout(this.wentBackTimer);
      // Going back can be taken back for a while, from the note that says it happened.
      if (patch.wentBack)
        this.wentBackTimer = setTimeout(() => this.set({ wentBack: undefined }), 10000);
    }
    this.state = next;
    this.reconcile();
    this.build();
  }

  /** Keeps what follows from the work and the address in step with them. */
  private reconcile() {
    const s = this.state,
      w = s.work;
    if (!w) return;
    // An address naming a scene the work no longer has falls back to its root.
    if (s.addressed && !w.scenes[s.addressed] && this.replaced !== s.addressed) {
      this.replaced = s.addressed;
      this.host.go(addressOf(w), "replace");
    }
    const sceneId = sceneOf(s);
    if (this.shownScene !== sceneId) {
      this.shownScene = sceneId;
      this.state = { ...this.state, selected: [], link: null, detailId: undefined };
    }
    if (this.state.detailId && !w.details[this.state.detailId])
      this.state = { ...this.state, detailId: undefined };
    // A run that ends having drawn only in other scenes takes the viewer to the last one
    // it drew: left on the scene they asked from, people took the new subscene for
    // nothing done.
    const run = s.runs.at(-1),
      was = this.watched;
    this.watched = run && { id: run.id, live: live(run) };
    if (!run || run.status !== "completed" || was?.id !== run.id || !was.live) return;
    const written = run.steps.flatMap((step) =>
      step.kind === "tool" && step.name === "write_work" && step.status === "done"
        ? step.scenes.map((x) => x.id)
        : [],
    );
    if (!written.length || written.includes(sceneId)) return;
    const target = written.findLast((id) => w.scenes[id]?.modules.length);
    if (target) queueMicrotask(() => this.host.go(addressOf(w, target), "push"));
  }

  private build() {
    const s = this.state,
      work = s.work;
    if (this.memo?.history !== s.history)
      this.memo = { history: s.history, of: historyOf(s.history) };
    const { versions, unsaved } = this.memo.of;
    const run = s.runs.at(-1),
      working = live(run),
      waiting = run?.status === "waiting";
    const sceneId = sceneOf(s);
    const synced = !!work && s.history.some((r) => r.revision === work.revision);
    if (
      work &&
      (this.undoMemo?.history !== s.history || this.undoMemo.revision !== work.revision)
    )
      this.undoMemo = {
        history: s.history,
        revision: work.revision,
        before: stepBefore(s.history, work.revision),
      };
    const shown = s.draft && work && s.draft.work.id === work.id ? s.draft.work : work;
    const chosenLink =
      !s.selected.length && s.link
        ? work?.scenes[sceneId]?.links.find((l) => l.id === s.link)
        : undefined;
    this.publish({
      ...s,
      ...this.actions,
      id: this.id,
      run,
      working,
      waiting,
      engaged: working || waiting,
      sceneId,
      scene: work?.scenes[sceneId],
      versions,
      unsaved,
      synced,
      unsavedCount: synced ? unsaved.length : 0,
      undoable:
        !!work &&
        ((s.wentBack?.at === work.revision) || this.undoMemo?.before !== undefined),
      redoable: !!work && s.undone?.at === work.revision,
      locked: !s.loaded || working || waiting || !!s.preview,
      shown,
      display: shown && {
        work: s.preview?.work.scenes[sceneId] ? s.preview.work : shown,
        version: !s.preview && s.draft ? "~" + s.draft.n : "",
      },
      replying: !!run && !working && !waiting && run.id !== s.dismissed,
      ids: s.selected.map((x) => x.moduleId),
      chosenLink,
    });
  }

  // Loading and the server's events

  private async load() {
    // The work shows as soon as it arrives; its runs, which can be long, follow.
    const runs = api<Run[]>("/works/" + this.id + "/runs");
    runs.catch(() => {});
    const w = await api<Work>("/works/" + this.id);
    this.take(w);
    const r = await runs;
    // Runs started or updated while the history was on the way are newer than it: they
    // keep their state, and the history fills in what came before them.
    const last = r.at(-1);
    this.set({
      runs: merged(r, this.state.runs, true),
      loaded: true,
      // A reply from an earlier visit stays in the studio, not under the canvas; one still
      // to come shows when it arrives.
      dismissed: last && !live(last) && last.status !== "waiting" ? last.id : "",
    });
  }

  /** Takes a work the server sent, unless the one shown is already newer. */
  private take(w: Work) {
    if (w.id !== this.id) return;
    if (this.state.work && this.state.work.revision > w.revision) return;
    this.set({ work: w });
  }

  private receive(event: ServerEvent) {
    if (event.type === "connected") {
      // What the server says now is what was missed while disconnected; a run started
      // since the request went out is kept.
      if (!this.state.loaded) return;
      void Promise.all([
        api<Work>("/works/" + this.id),
        api<Run[]>("/works/" + this.id + "/runs"),
      ]).then(([w, r]) => {
        this.take(w);
        this.set({ runs: merged(r, this.state.runs, false) });
      }, () => {});
    } else if (event.type === "work") this.take(event.work);
    else if (event.type === "run" && event.run.workId === this.id) this.upsert(event.run);
  }

  private upsert(run: Run) {
    const old = this.state.runs;
    this.set({
      runs: old.some((r) => r.id === run.id)
        ? old.map((r) => (r.id === run.id ? run : r))
        : [...old, run],
    });
  }

  private async fetchHistory() {
    const w = this.state.work;
    if (!w || this.disposed) return;
    const asked = ++this.historyAsked;
    try {
      const rows = await api<RevisionSummary[]>("/works/" + w.id + "/revisions");
      if (asked === this.historyAsked) this.set({ history: rows });
    } catch {}
  }

  // What the canvas asks

  /** Whether a revision is the person's own change, to show at once rather than draw. */
  quiet = (revision: number) => !!this.drafted || this.inflight > 0 || this.own.has(revision);

  /** Runs a change the person makes, marking the revision it saves as theirs. */
  async mine(save: () => Promise<Work>) {
    this.inflight++;
    try {
      const w = await save();
      this.own.add(w.revision);
      return w;
    } finally {
      this.inflight--;
    }
  }

  /** Commits a hand edit, made from the work as the edits before it left it. It shows at
   * once, laid on what the edits before it will leave, unless it takes in a material the
   * work does not hold yet; the saved work replaces it when the last edit is saved, and a
   * failed edit takes back what was shown. `make` may run twice (for the draft and for
   * real), so it must not do anything that can only happen once. */
  change: Change = (make) => {
    const base = this.drafted ?? this.state.work;
    if (base) {
      try {
        const guess = make(base);
        if (guess && showable(base, guess)) {
          const next = applied(base, guess);
          this.drafted = next;
          this.set({ draft: { work: next, n: (this.state.draft?.n ?? 0) + 1 } });
        }
      } catch {
        // The edit says why when it is made for real.
      }
    }
    this.queued++;
    const settle = (failed: boolean, patch: Partial<State> = {}) => {
      this.queued--;
      if (failed || !this.queued) {
        this.drafted = undefined;
        patch.draft = undefined;
      }
      this.set(patch);
    };
    const job = this.edits.then(async () => {
      const w = this.state.work;
      const edit = w && make(w);
      if (!w || !edit) {
        settle(false);
        return false;
      }
      try {
        const saved = await this.mine(() =>
          api<Work>("/works/" + w.id + "/edits", "POST", { baseRevision: w.revision, edit }),
        );
        settle(false, { work: saved, undone: undefined });
        return true;
      } catch (e) {
        settle(true);
        throw e;
      }
    });
    this.edits = job.catch(() => {});
    return job;
  };

  /** Hand edits are queued or saved and not yet a version. */
  get pendingEdits() {
    return this.queued > 0 || this.get().unsavedCount > 0;
  }

  /** Sends a request, or an answer while the author waits for one. Hand edits not saved
   * yet hold it back until the person says what becomes of them, since the author would
   * otherwise take them into its own version. */
  async send(ask: Ask, decided?: Work): Promise<void> {
    const s = this.get();
    if (this.disposed || !s.work || !s.loaded || s.sending || s.working) return;
    if (!ask.text.trim() && !ask.materials?.length) return;
    if (!decided && !s.synced) return;
    if (!decided && this.pendingEdits) {
      this.held = (saved) => this.send(ask, saved);
      this.set({ holding: true });
      return;
    }
    this.set({ sending: true });
    try {
      const w = decided ?? s.work;
      const target = w.scenes[ask.scene ?? s.sceneId] ? (ask.scene ?? s.sceneId) : w.rootSceneId;
      const link = this.get().chosenLink;
      const selected = this.state.selected;
      const request = selected.length
        ? `${ask.text}\n${selected.map((x) => `Selected module: ${x.moduleId}\n${x.label}`).join("\n")}`
        : link
          ? `${ask.text}\nSelected link: ${link.id} (${link.from.moduleId} → ${link.to.moduleId})`
          : ask.text;
      const run = this.get().run;
      const answering = run?.status === "waiting";
      const r = answering
        ? await api<Run>("/runs/" + run!.id + "/answer", "POST", {
            answer: [ask.picked, request].filter(Boolean).join("\n"),
            materials: ask.materials ?? [],
          })
        : await api<Run>("/works/" + w.id + "/runs", "POST", {
            prompt: request,
            sceneId: target,
            materials: ask.materials ?? [],
          });
      this.upsert(r);
      // A new request took one from the allowance; an answer did not.
      if (!answering) this.host.spent();
      ask.sent?.();
      await this.host.listed();
    } finally {
      this.set({ sending: false });
    }
  }

  /** What becomes of the unsaved edits that hold a request back: saved as a version or
   * thrown away, and the request sent; or the request is not sent after all. */
  async decide(how: "save" | "discard" | "cancel") {
    const held = this.held;
    this.held = undefined;
    this.set({ holding: false });
    if (!held || how === "cancel") return;
    await held(how === "save" ? await this.save() : await this.discard());
  }

  /** Saves the hand edits made since the latest version as a version of their own. */
  async save() {
    await this.edits;
    const number = (this.get().versions.at(-1)?.number ?? 0) + 1;
    const w = await this.mine(() => api<Work>("/works/" + this.id + "/save", "POST"));
    this.set({ work: w, undone: undefined, wentBack: undefined });
    this.host.notice(this.host.words().unsaved.saved(number));
    return w;
  }

  /** Throws the hand edits made since the latest version away. */
  async discard() {
    await this.edits;
    const latest = this.get().versions.at(-1);
    const from = this.state.work!.revision;
    if (!latest) return this.state.work!;
    const w = await this.mine(() =>
      api<Work>("/works/" + this.id + "/restore", "POST", { revision: latest.revision }),
    );
    this.set({
      work: w,
      undone: undefined,
      wentBack: { at: w.revision, from, text: this.host.words().unsaved.discarded },
    });
    return w;
  }

  /** Goes back to a version: the work is as it was then, and the versions after it leave
   * the list. It can be taken back from the note that says so. */
  async restore(revision: number) {
    await this.edits;
    const from = this.state.work!.revision;
    const number = this.get().versions.find((v) => v.revisions.includes(revision))?.number;
    const w = await this.mine(() =>
      api<Work>("/works/" + this.id + "/restore", "POST", { revision }),
    );
    this.set({
      work: w,
      preview: undefined,
      undone: undefined,
      wentBack:
        number !== undefined
          ? { at: w.revision, from, text: this.host.words().history.wentBack(number) }
          : undefined,
      ...this.putAway(),
    });
  }

  /** Takes back the latest request, hand edit or going back, as a whole; it can be
   * brought back until the work changes otherwise. */
  async undo() {
    const s = this.get();
    if (!s.work || !s.undoable) return;
    const from = s.work.revision;
    if (s.wentBack?.at === from) {
      // Going back is taken back: the versions it left come back.
      const back = s.wentBack;
      this.set({ wentBack: undefined });
      const w = await this.mine(() =>
        api<Work>("/works/" + this.id + "/restore", "POST", { revision: back.from }),
      );
      return this.set({ work: w });
    }
    const w = await this.mine(() => api<Work>("/works/" + this.id + "/undo", "POST"));
    const old = this.state.undone;
    this.set({
      work: w,
      undone: { at: w.revision, revisions: [...(old?.at === from ? old.revisions : []), from] },
      ...this.putAway(),
    });
  }

  async redo() {
    const s = this.get();
    if (!s.redoable) return;
    const revisions = s.undone!.revisions;
    const w = await this.mine(() =>
      api<Work>("/works/" + this.id + "/restore", "POST", { revision: revisions.at(-1) }),
    );
    this.set({
      work: w,
      undone:
        revisions.length > 1 ? { at: w.revision, revisions: revisions.slice(0, -1) } : undefined,
    });
  }

  /** Shows an earlier revision in place of the current one, or the current one again. */
  async look(revision: number) {
    const work = this.state.work!;
    // Looking at a version, and coming back from it, swaps the picture in place rather
    // than drawing it again.
    this.own.add(work.revision);
    if (revision === work.revision) return this.set({ preview: undefined });
    this.own.add(revision);
    const shown = await api<Work>(`/works/${this.id}/revisions/${revision}`);
    if (this.state.work?.revision === work.revision) this.set({ preview: { revision, work: shown } });
  }

  /** Stopping hands what was asked back, to change and send again: resolves to it. */
  async stop() {
    const run = this.get().run;
    if (!run) return;
    const asked = run.steps.findLast((s) => s.kind === "message" && s.role === "user");
    await api("/runs/" + run.id + "/cancel", "POST");
    return asked?.kind === "message" ? asked.text : undefined;
  }

  /** Goes to a scene; one with nothing drawn yet is asked for at once. */
  async enter(id: string, title?: string) {
    const w = this.state.work;
    if (!w?.scenes[id]) throw Error(this.host.words().work.noScene);
    this.host.go(addressOf(w, id), "push");
    if (!w.scenes[id].modules.length && !this.get().working)
      await this.send({ text: this.host.words().work.expand(title || w.scenes[id].title), scene: id });
  }

  async rename(title: string) {
    const w = await api<Work>("/works/" + this.id, "PATCH", { title });
    this.take(w);
    await this.host.listed();
  }

  /** The address names this scene now. */
  locate(addressed: string | undefined) {
    if (addressed !== this.replaced) this.replaced = undefined;
    if (addressed !== this.state.addressed) this.set({ addressed });
  }

  /** The view the work is drawn on, once it is there, and none once it goes. */
  attach(view: View | undefined) {
    this.view = view;
  }

  /** Hand edits' clip changed. */
  clipped() {
    if (!this.state.clipped) this.set({ clipped: true });
  }

  /** The reply under the canvas goes. */
  private putAway(): Partial<State> {
    const run = this.state.runs.at(-1);
    return run ? { dismissed: run.id } : {};
  }

  /** A module by its name, or a link by the names of the modules it joins. */
  nameOf = (id: string): string => {
    const s = this.get(),
      scene = s.scene;
    const link = scene?.links.find((l) => l.id === id);
    if (link) return `${this.nameOf(link.from.moduleId)} → ${this.nameOf(link.to.moduleId)}`;
    const m = scene?.modules.find((x) => x.id === id);
    return m && s.work ? shownName(s.work, m) : id;
  };
}

const sceneOf = (s: State) =>
  s.work && s.addressed && s.work.scenes[s.addressed]
    ? s.addressed
    : (s.work?.rootSceneId ?? "root");

/** Runs fetched from the server laid over the runs already shown: the fetched ones in
 * their order, each replaced by the shown one when that is newer, then any shown run the
 * fetch did not include, such as one started while it was on the way. */
export function merged(fetched: Run[], shown: Run[], shownNewer: boolean) {
  const byId = new Map(shown.map((x) => [x.id, x]));
  const ids = new Set(fetched.map((x) => x.id));
  return [
    ...fetched.map((x) => (shownNewer ? (byId.get(x.id) ?? x) : x)),
    ...shown.filter((x) => !ids.has(x.id)),
  ];
}

/** What a shell can do with the session, each bound once so it can be handed on as is.
 * The ones that resolve may reject with what went wrong, for the shell to say; `ops` and
 * `open` report their failures to the host themselves. */
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
  /** Puts the latest reply away. */
  dismiss(): void;
  change: Change;
  enter(id: string, title?: string): Promise<void>;
  /** Follows a module's target: a scene, or a detail page over it. */
  open(target: Target): void;
  closeDetail(): void;
  rename(title: string): Promise<void>;
  /** What the view says is selected. */
  select(selected: Selection[]): void;
  selectLink(link: string | null): void;
  /** Lets go of what is selected, so the request is about the whole scene. */
  unquote(): void;
  /** Whether a revision is the person's own change, to show at once rather than draw. */
  quiet(revision: number): boolean;
  /** A module by its name, or a link by the names of the modules it joins. */
  nameOf(id: string): string;
  /** The view the work is drawn on, once it is there, and none once it goes. */
  attach(view: View | undefined): void;
  ops: SessionOps;
}

function actionsOf(s: WorkSession): Actions {
  const report = (p: Promise<unknown>) => void p.catch((e) => s.host.fail(e));
  return {
    send: (ask) => s.send(ask),
    decide: (how) => s.decide(how),
    save: () => s.save(),
    discard: () => s.discard(),
    restore: (revision) => s.restore(revision),
    undo: () => s.undo(),
    redo: () => s.redo(),
    look: (revision) => s.look(revision),
    endPreview: () => s.set({ preview: undefined }),
    stop: () => s.stop(),
    cancel: async () => {
      const run = s.get().run;
      if (run) await api("/runs/" + run.id + "/cancel", "POST");
    },
    dismiss: () => s.set({ dismissed: s.get().run?.id ?? "" }),
    change: s.change,
    enter: (id, title) => s.enter(id, title),
    open: (target) =>
      target.kind === "scene" ? report(s.enter(target.id)) : s.set({ detailId: target.id }),
    closeDetail: () => s.set({ detailId: undefined }),
    rename: (title) => s.rename(title),
    select: (selected) => s.set({ selected }),
    selectLink: (link) => s.set({ link }),
    unquote: () => (s.view ? s.view.select([]) : s.set({ selected: [], link: null })),
    quiet: s.quiet,
    nameOf: s.nameOf,
    attach: (view) => s.attach(view),
    ops: s.ops,
  };
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
  const snapshot = useStore(session?.id === id ? session : undefined);
  return {
    session: snapshot,
    store: session?.id === id ? session : undefined,
    begin(work: Work) {
      const made = new WorkSession(work.id, host, work);
      replace(made);
      return made;
    },
  };
}
