import {
  historyOf,
  stepBefore,
  type RevisionSummary,
  type Work,
} from "../../../../modules/contracts/index.ts";
import { api } from "../api.ts";
import type { Context } from "./types.ts";

/** The work and its revisions: the latest the server has said, the revisions it lists
 * (which the versions are counted from), an earlier one shown in its place, and which
 * revisions the person made themselves, to show at once rather than draw stroke by stroke. */
export class Revisions {
  work?: Work;
  history: RevisionSummary[] = [];
  /** An earlier revision shown in place of the current one. */
  preview?: { revision: number; work: Work };
  private own = new Set<number>();
  /** The person's own changes still on their way to the server. */
  private inflight = 0;
  /** The latest work the server told of while the person's change was on its way. */
  private meanwhile?: Work;
  private asked = 0;
  private derived?: {
    history: RevisionSummary[];
    revision?: number;
    of: ReturnType<typeof historyOf>;
    before?: number;
  };
  private watchers: ((work: Work) => void)[] = [];

  constructor(private ctx: Context) {}

  /** A work just made here: its only revision is its making, so nothing waits for the list. */
  begin(work: Work) {
    this.history = [{ revision: work.revision, updatedAt: work.updatedAt, cause: { kind: "create" } }];
    this.take(work);
  }

  /** Calls `fn` with each new revision of the work. */
  watch(fn: (work: Work) => void) {
    this.watchers.push(fn);
  }

  /** Takes a work the server sent or saved, unless the one shown is already newer. */
  take(work: Work) {
    if (this.ctx.disposed || work.id !== this.ctx.id) return;
    const was = this.work;
    if (was && was.revision > work.revision) return;
    this.work = work;
    // A revision not the person's own (the author drawing, another page) is not a step that
    // the hand edits made here lead back over.
    if (was && was.revision !== work.revision && !this.own.has(work.revision) && !this.inflight) this.ctx.history.clear();
    if (was?.revision !== work.revision) {
      // A preview ends when the work changes under it, and the revisions follow it.
      this.preview = undefined;
      void this.fetch();
      for (const fn of this.watchers) fn(work);
    }
    this.ctx.changed();
  }

  /** Takes a hand edit the server saved. Its row in the list is known already, so it is
   * counted among the unsaved edits at once, rather than the count going blank until the
   * list catches up, which would hide the unsaved bar and show it again on every edit. */
  edited(work: Work) {
    if (work.revision > (this.work?.revision ?? -1) && this.synced)
      this.history = [
        ...this.history,
        { revision: work.revision, updatedAt: work.updatedAt, cause: { kind: "edit" } },
      ];
    this.take(work);
  }

  private async fetch() {
    // The blank sheet is not saved yet, so the server has no revisions for it.
    if (this.ctx.id === "_blank") return;
    const asked = ++this.asked;
    try {
      const rows = await api<RevisionSummary[]>("/works/" + this.ctx.id + "/revisions");
      if (asked !== this.asked || this.ctx.disposed) return;
      this.history = rows;
      this.ctx.changed();
    } catch {}
  }

  /** A work the server told every page of. While the person's own change is on its way,
   * its answer brings that work and the caller knows what it was, so the telling waits for
   * it and stands only if the answer does not come. */
  heard(work: Work) {
    if (!this.inflight) return this.take(work);
    if (work.revision > (this.meanwhile?.revision ?? -1)) this.meanwhile = work;
  }

  /** Runs a change the person makes, marking the revision it saves as theirs. */
  async mine(save: () => Promise<Work>) {
    this.inflight++;
    let w: Work | undefined;
    try {
      w = await save();
      this.own.add(w.revision);
      return w;
    } finally {
      this.inflight--;
      const told = this.inflight ? undefined : this.meanwhile;
      if (told) this.meanwhile = undefined;
      if (told && told.revision > (w?.revision ?? -1)) this.take(told);
    }
  }

  /** Whether a revision is the person's own change: one they made or looked at, or any
   * while their change is on its way or shown as a draft. */
  quiet(revision: number) {
    return this.ctx.edits.drafting || this.inflight > 0 || this.own.has(revision);
  }

  /** The versions and unsaved edits as the revisions count them, and where undoing goes. */
  get counted() {
    const revision = this.work?.revision;
    if (this.derived?.history !== this.history || this.derived.revision !== revision)
      this.derived = {
        history: this.history,
        revision,
        of: historyOf(this.history),
        before: revision === undefined ? undefined : stepBefore(this.history, revision),
      };
    return this.derived;
  }

  /** Whether the revisions have caught up with the work; until then they say nothing. */
  get synced() {
    const w = this.work;
    return !!w && this.history.some((r) => r.revision === w.revision);
  }

  /** Hand edits not saved as a version, once the revisions say so. */
  get unsaved() {
    return this.synced ? this.counted.of.unsaved.length : 0;
  }

  /** Shows an earlier revision in place of the current one, or the current one again. */
  async look(revision: number) {
    const work = this.work!;
    // Looking at a version, and coming back from it, swaps the picture in place rather
    // than drawing it again.
    this.own.add(work.revision);
    if (revision === work.revision) return this.endPreview();
    this.own.add(revision);
    const shown = await api<Work>(`/works/${this.ctx.id}/revisions/${revision}`);
    if (this.work?.revision !== work.revision) return;
    this.preview = { revision, work: shown };
    this.ctx.changed();
  }

  endPreview() {
    if (!this.preview) return;
    this.preview = undefined;
    this.ctx.changed();
  }

  async rename(title: string) {
    if (this.ctx.id === "_blank" && this.ctx.host.materialize) {
      await this.ctx.host.materialize(title);
      return;
    }
    this.take(await api<Work>("/works/" + this.ctx.id, "PATCH", { title }));
  }
}
