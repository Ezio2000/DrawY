import type { Work, WorkEdit } from "../../../../modules/contracts/index.ts";
import { isEmptyEdit, revert } from "../../../../modules/editing/index.ts";
import type { Context } from "./types.ts";

/** How close in time two steps on the same values of the same parts are taken as one: typing
 * on, a slider dragged on, arrow keys pressed again. */
const TOGETHER_MS = 800;
/** How many steps are kept to go back over. */
const KEPT = 100;

/** One step of hand editing: the work before and after it, what was selected before it, and
 * what it changed, to tell a step going on from a new one. */
interface Step {
  before: Work;
  after: Work;
  selection?: { modules: string[]; links: string[] };
  key: string;
  at: number;
}
/** What a step changes, as parts and their fields: steps that change the same are one, when
 * they come close together. */
function keyOf(edit: WorkEdit) {
  const parts = [...(edit.modules ?? []), ...(edit.links ?? [])].map((p) => {
    const { id, scene: _, data, ...fields } = p as Record<string, unknown> & { id: string; data?: Record<string, unknown> };
    return [id, Object.keys(fields).sort(), Object.keys(data ?? {}).sort()];
  });
  const rest = Object.keys(edit).filter((k) => k !== "modules" && k !== "links");
  return JSON.stringify([parts, rest]);
}

/** Going back and forth over the person's hand edits, here in the page: each edit they make is
 * a step, kept with the work before and after it; undoing lays the work back as it was before
 * the step, redoing as it was after, each as a hand edit that says the revision it goes back
 * to, so the server counts the edits not saved as it would after going back to it. A change from elsewhere
 * (the author drawing, another page) ends what can be gone back over, as does going back to
 * a version or throwing the edits away; then undoing asks the server. */
export class History {
  private past: Step[] = [];
  private future: Step[] = [];
  /** A step being laid back or forth: the edit it makes is not a step itself. */
  private moving = false;

  constructor(private ctx: Context) {}

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  /** Whether an edit being made is undoing or redoing, which is not recorded as a step. */
  get replaying() {
    return this.moving;
  }

  /** A hand edit saved: the work before it and after. A step on the same values as the last,
   * close after it, joins it. */
  record(before: Work, after: Work) {
    if (this.moving) return;
    const edit = revert(before, after);
    if (isEmptyEdit(edit)) return;
    const key = keyOf(edit),
      now = Date.now();
    this.future = [];
    const last = this.past.at(-1);
    if (last && last.key === key && now - last.at < TOGETHER_MS && last.after.revision === before.revision) {
      last.after = after;
      last.at = now;
    } else {
      const v = this.ctx.view;
      this.past.push({ before, after, key, at: now, ...(v?.picked ? { selection: v.picked() } : {}) });
      if (this.past.length > KEPT) this.past.shift();
    }
    this.ctx.changed();
  }

  /** Forgets every step, as the work changed in a way they do not lead back from. */
  clear() {
    if (!this.past.length && !this.future.length) return;
    this.past = [];
    this.future = [];
    this.ctx.changed();
  }

  /** Undoing and redoing one after another, each from where the last left the stacks. */
  private queue: Promise<unknown> = Promise.resolve();
  private queued(run: () => Promise<boolean>) {
    const job = this.queue.then(run);
    this.queue = job.catch(() => {});
    return job;
  }
  /** Lays the work back as it was before the last step, with what was selected then. */
  undo() {
    return this.queued(async () => {
      const step = this.past.pop();
      if (!step) return false;
      const done = await this.lay(step.before, step);
      (done ? this.future : this.past).push(step);
      this.ctx.changed();
      return done;
    });
  }
  /** Lays the work forward as it was after the step last undone. */
  redo() {
    return this.queued(async () => {
      const step = this.future.pop();
      if (!step) return false;
      const done = await this.lay(step.after, step);
      (done ? this.past : this.future).push(step);
      this.ctx.changed();
      return done;
    });
  }
  private async lay(to: Work, step: Step) {
    this.moving = true;
    try {
      const saved = await this.ctx.edits.commit((w) => {
        const edit = revert(w, to);
        return isEmptyEdit(edit) ? null : edit;
      }, to.revision);
      const v = this.ctx.view;
      if (step.selection && v) v.select(step.selection.modules.filter((id) => Object.values(to.scenes).some((s) => s.modules.some((m) => m.id === id))), step.selection.links);
      return saved !== undefined;
    } catch {
      return false;
    } finally {
      this.moving = false;
    }
  }
}
