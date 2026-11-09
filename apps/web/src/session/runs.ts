import type { Run, Work } from "../../../../modules/contracts/index.ts";
import { api } from "../api.ts";
import type { ServerEvent } from "../events.ts";
import { live, type Context } from "./types.ts";

/** The author's runs on the work and the server's events about it: loading them when the
 * work opens, following each event, and catching up after the connection drops. */
export class Runs {
  runs: Run[] = [];
  /** Whether the runs have arrived; until then nothing can be sent or edited. */
  loaded = false;
  /** The latest run as it stood when the work was opened, if it had ended: its reply is
   * old news, kept in the studio. */
  earlier?: string;
  /** Whether the server's events cannot be heard now. */
  offline = false;
  /** Why the work could not be opened, if it could not. */
  unopened?: unknown;
  private stop: () => void;

  constructor(private ctx: Context) {
    this.stop = ctx.host.listen({
      event: (e) => this.receive(e),
      offline: (offline) => {
        this.offline = offline;
        ctx.changed();
      },
    });
  }

  dispose() {
    this.stop();
  }

  get run() {
    return this.runs.at(-1);
  }
  get working() {
    return live(this.run);
  }
  get waiting() {
    return this.run?.status === "waiting";
  }

  /** A work just made here has no runs to wait for. */
  begin() {
    this.loaded = true;
  }

  /** Opens the work: it shows as soon as it arrives; its runs, which can be long, follow. */
  async load() {
    try {
      await this.open();
    } catch (e) {
      this.unopened = e;
      this.ctx.changed();
    }
  }
  private async open() {
    const runs = api<Run[]>("/works/" + this.ctx.id + "/runs");
    runs.catch(() => {});
    this.ctx.revisions.take(await api<Work>("/works/" + this.ctx.id));
    const r = await runs;
    const last = r.at(-1);
    this.earlier = last && !live(last) && last.status !== "waiting" ? last.id : undefined;
    this.loaded = true;
    // Runs started or updated while the history was on the way are newer than it: they
    // keep their state, and the history fills in what came before them.
    this.replace(merged(r, this.runs, true));
  }

  /** Takes a run the server sent back or told of. */
  upsert(run: Run) {
    const old = this.runs;
    this.replace(
      old.some((r) => r.id === run.id) ? old.map((r) => (r.id === run.id ? run : r)) : [...old, run],
    );
  }

  private receive(event: ServerEvent) {
    if (this.ctx.disposed) return;
    if (event.type === "work") return this.ctx.revisions.take(event.work);
    if (event.type === "run") {
      if (event.run.workId === this.ctx.id) this.upsert(event.run);
      return;
    }
    // Back from a dropped connection: what the server says now is what was missed; a run
    // started since the request went out is kept.
    if (!this.loaded) return;
    void Promise.all([
      api<Work>("/works/" + this.ctx.id),
      api<Run[]>("/works/" + this.ctx.id + "/runs"),
    ]).then(([w, r]) => {
      this.ctx.revisions.take(w);
      this.replace(merged(r, this.runs, false));
    }, () => {});
  }

  private replace(runs: Run[]) {
    if (this.ctx.disposed) return;
    const was = this.run;
    this.runs = runs;
    const now = this.run;
    this.ctx.changed();
    if (now && was?.id === now.id && live(was) && now.status === "completed")
      this.ctx.scenes.follow(now);
  }
}

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
