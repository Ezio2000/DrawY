import type { ServerEvent, WorkSummary } from "../../../modules/contracts/index.ts";
import { api } from "./api.ts";
import { listen } from "./events.ts";
import { kept, Store } from "./session/store.ts";

type Change = Extract<ServerEvent, { type: "summary" | "removed" }>;

/** One account's sidebar cache. A mounted list subscribes, a closed one keeps its place. */
export class Recents extends Store<{ rows: WorkSummary[]; loading: boolean }> {
  scrollTop = 0;
  private rows = new Map<string, WorkSummary>();
  private hidden = new Set<string>();
  private loaded = false;
  private needsSync = true;
  private open = false;
  // Only lightweight changes are retained while the full snapshot is on its way.
  private pending?: Change[];

  constructor(private fail: (error: unknown) => void) {
    super();
  }

  protected build() {
    return {
      rows: [...this.rows.values()].reverse().filter((w) => !this.hidden.has(w.id)),
      loading: !this.loaded && !!this.pending,
    };
  }

  follow(user: string) {
    const stop = listen(user, {
      event: (event) => {
        if (event.type === "connected") {
          this.needsSync = true;
          this.pending = undefined;
          if (this.open) void this.sync();
        } else if (event.type === "summary" || event.type === "removed") {
          this.change(event);
        }
      },
    });
    return () => {
      stop();
      this.pending = undefined;
    };
  }

  show(open: boolean) {
    this.open = open;
    if (open && this.needsSync && !this.pending) void this.sync();
  }

  private async sync() {
    const pending: Change[] = [];
    this.pending = pending;
    this.changed();
    try {
      const rows = await api<WorkSummary[]>("/works?covers=0");
      if (this.pending !== pending) return;
      this.rows = new Map(rows.reverse().map((w) => [w.id, w]));
      for (const change of pending) this.apply(change);
      this.loaded = true;
      this.needsSync = false;
    } catch (error) {
      if (this.pending === pending) this.fail(error);
    } finally {
      if (this.pending === pending) {
        this.pending = undefined;
        this.changed();
      }
    }
  }

  /** Hide during the undo window; a failed deletion or an undo reveals the latest row. */
  hide(id: string, hidden: boolean) {
    if (hidden) this.hidden.add(id);
    else this.hidden.delete(id);
    this.changed();
  }

  change(change: Change) {
    this.pending?.push(change);
    if (this.loaded && this.apply(change)) this.changed();
  }

  private apply(change: Change): boolean {
    if (change.type === "removed") return this.rows.delete(change.id);
    const row = change.summary;
    const old = this.rows.get(row.id);
    const next = kept(old, row);
    if (next === old) return false;
    this.rows.set(row.id, next);
    return true;
  }
}
