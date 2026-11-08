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
    if (was?.revision !== work.revision) {
      // A preview ends when the work changes under it, and the revisions follow it.
      this.preview = undefined;
      void this.fetch();
      for (const fn of this.watchers) fn(work);
    }
    this.ctx.changed();
  }

  private async fetch() {
    const asked = ++this.asked;
    try {
      const rows = await api<RevisionSummary[]>("/works/" + this.ctx.id + "/revisions");
      if (asked !== this.asked || this.ctx.disposed) return;
      this.history = rows;
      this.ctx.changed();
    } catch {}
  }

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
    this.take(await api<Work>("/works/" + this.ctx.id, "PATCH", { title }));
    await this.ctx.host.listed();
  }
}
