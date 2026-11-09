import type { Work, WorkEdit } from "../../../../modules/contracts/index.ts";
import { applied, showable } from "../../../../modules/editing/index.ts";
import { api } from "../api.ts";
import type { Context } from "./types.ts";

/** Hand edits on their way: they go one after another, each made from the work the last
 * one left, and each shows at once, laid as a draft on what the edits before it will
 * leave, unless it takes in a material the work does not hold yet. The saved work
 * replaces the draft when the last edit is saved, and a failed edit takes back what was
 * shown. */
export class Edits {
  /** The draft shown, and a count telling one showing of it from the next. */
  draft?: { work: Work; n: number };
  private drafted?: Work;
  private queued = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private ctx: Context) {}

  /** Whether a draft is shown, so what the canvas is given next is the person's own. */
  get drafting() {
    return !!this.drafted;
  }
  /** Whether edits are still on their way. */
  get pending() {
    return this.queued > 0;
  }
  /** Settles once every edit sent so far has been saved or has failed. */
  settled() {
    return this.chain;
  }

  /** Commits a hand edit; resolves to the work it saved, or nothing when `make` had no
   * edit to make. `make` may run twice (for the draft and for real), so it must not do
   * anything that can only happen once. */
  commit(make: (work: Work) => WorkEdit | null): Promise<Work | undefined> {
    const { revisions } = this.ctx;
    const base = this.drafted ?? revisions.work;
    if (base) {
      try {
        const guess = make(base);
        if (guess && showable(base, guess)) {
          this.drafted = applied(base, guess);
          this.draft = { work: this.drafted, n: (this.draft?.n ?? 0) + 1 };
          this.ctx.changed();
        }
      } catch {
        // The edit says why when it is made for real.
      }
    }
    this.queued++;
    const settle = (failed: boolean) => {
      this.queued--;
      if (failed || !this.queued) {
        this.drafted = undefined;
        this.draft = undefined;
      }
    };
    const job = this.chain.then(async () => {
      try {
        const w = revisions.work;
        const edit = w && make(w);
        if (!w || !edit) {
          settle(false);
          this.ctx.changed();
          return undefined;
        }
        const saved = await revisions.mine(() =>
          api<Work>("/works/" + w.id + "/edits", "POST", { baseRevision: w.revision, edit }),
        );
        settle(false);
        revisions.take(saved);
        this.ctx.changed();
        return saved;
      } catch (e) {
        settle(true);
        this.ctx.changed();
        throw e;
      }
    });
    this.chain = job.catch(() => {});
    return job;
  }

  change = (make: (work: Work) => WorkEdit | null) => this.commit(make).then((w) => !!w);
}
