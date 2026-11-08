import type { Work } from "../../../../modules/contracts/index.ts";
import { api } from "../api.ts";
import type { Context } from "./types.ts";

/** How long going back can be taken back from the note that says it happened. */
const BACK_FOR = 10_000;

/** What is done to versions as a whole: saving the hand edits as one, throwing them away,
 * going back to a version (and taking that back), undoing and redoing. Each waits for the
 * hand edits on their way, and each revision it makes is the person's own. */
export class Versions {
  /** Going back, to take back while the work is still where it left it. */
  wentBack?: { at: number; from: number; text: string };
  /** Revisions undone, to bring back while the work is still where undoing left it. */
  undone?: { at: number; revisions: number[] };
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private ctx: Context) {}

  dispose() {
    clearTimeout(this.timer);
  }

  private get work() {
    return this.ctx.revisions.work!;
  }
  private apply(save: () => Promise<Work>) {
    return this.ctx.revisions.mine(save).then((w) => {
      this.ctx.revisions.take(w);
      return w;
    });
  }
  private restoring(revision: number) {
    return this.apply(() =>
      api<Work>("/works/" + this.ctx.id + "/restore", "POST", { revision }),
    );
  }
  private wentTo(back: Versions["wentBack"]) {
    clearTimeout(this.timer);
    this.wentBack = back;
    if (back)
      this.timer = setTimeout(() => {
        this.wentBack = undefined;
        this.ctx.changed();
      }, BACK_FOR);
    this.ctx.changed();
  }

  /** Whether going back can be taken back now. */
  get back() {
    const w = this.ctx.revisions.work;
    return w && this.wentBack?.at === w.revision ? this.wentBack : undefined;
  }
  get undoable() {
    return !!this.back || this.ctx.revisions.counted.before !== undefined;
  }
  get redoable() {
    const w = this.ctx.revisions.work;
    return !!w && this.undone?.at === w.revision;
  }

  /** Saves the hand edits made since the latest version as a version of their own. */
  async save() {
    await this.ctx.edits.settled();
    const number = (this.ctx.revisions.counted.of.versions.at(-1)?.number ?? 0) + 1;
    const w = await this.apply(() => api<Work>("/works/" + this.ctx.id + "/save", "POST"));
    this.ctx.host.notice(this.ctx.host.words().unsaved.saved(number));
    return w;
  }

  /** Throws the hand edits made since the latest version away. */
  async discard() {
    await this.ctx.edits.settled();
    const latest = this.ctx.revisions.counted.of.versions.at(-1);
    const from = this.work.revision;
    if (!latest) return this.work;
    const w = await this.restoring(latest.revision);
    this.wentTo({ at: w.revision, from, text: this.ctx.host.words().unsaved.discarded });
    return w;
  }

  /** Goes back to a version: the work is as it was then, and the versions after it leave
   * the list. It can be taken back for a while. */
  async restore(revision: number) {
    await this.ctx.edits.settled();
    const from = this.work.revision;
    const number = this.ctx.revisions.counted.of.versions.find((v) =>
      v.revisions.includes(revision),
    )?.number;
    const w = await this.restoring(revision);
    this.wentTo(
      number !== undefined
        ? { at: w.revision, from, text: this.ctx.host.words().history.wentBack(number) }
        : undefined,
    );
  }

  /** Takes back going back to a version, else the latest request or hand edit as a whole;
   * it can be brought back until the work changes otherwise. */
  async undo() {
    if (!this.undoable) return;
    const back = this.back;
    if (back) {
      this.wentTo(undefined);
      await this.restoring(back.from);
      return;
    }
    const from = this.work.revision;
    const old = this.undone;
    const w = await this.apply(() => api<Work>("/works/" + this.ctx.id + "/undo", "POST"));
    this.undone = {
      at: w.revision,
      revisions: [...(old?.at === from ? old.revisions : []), from],
    };
    this.ctx.changed();
  }

  async redo() {
    if (!this.redoable) return;
    const revisions = this.undone!.revisions;
    const w = await this.restoring(revisions.at(-1)!);
    this.undone =
      revisions.length > 1 ? { at: w.revision, revisions: revisions.slice(0, -1) } : undefined;
    this.ctx.changed();
  }
}
