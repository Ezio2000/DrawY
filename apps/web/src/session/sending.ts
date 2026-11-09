import type { Run, Work } from "../../../../modules/contracts/index.ts";
import { api } from "../api.ts";
import type { Ask, Context, Focus } from "./types.ts";

/** What the author is told a request is about, under the request itself. */
export function aboutOf(text: string, focus?: Focus) {
  if (focus?.modules.length)
    return `${text}\n${focus.modules.map((x) => `Selected module: ${x.moduleId}\n${x.label}`).join("\n")}`;
  if (focus?.link)
    return `${text}\nSelected link: ${focus.link.id} (${focus.link.from.moduleId} → ${focus.link.to.moduleId})`;
  return text;
}

/** Requests to the author: sending one, or an answer while it waits; holding one back
 * while hand edits are not saved, since the author would otherwise take them into its own
 * version; and stopping the author. */
export class Sending {
  /** A request on its way to the server. */
  sending = false;
  private held?: (work: Work) => Promise<void>;

  constructor(private ctx: Context) {}

  /** Whether a request waits for the person to say what becomes of their unsaved edits. */
  get holding() {
    return !!this.held;
  }

  async send(ask: Ask, decided?: Work): Promise<void> {
    const { revisions, runs, edits, scenes } = this.ctx;
    const work = decided ?? revisions.work;
    if (this.ctx.disposed || !work || !runs.loaded || this.sending || runs.working) return;
    if (!ask.text.trim() && !ask.materials?.length) return;
    if (!decided) {
      if (!revisions.synced) return;
      if (edits.pending || revisions.unsaved) {
        this.held = (saved) => this.send(ask, saved);
        return this.ctx.changed();
      }
    }
    this.sending = true;
    this.ctx.changed();
    try {
      const scene = ask.scene ?? scenes.sceneId;
      const run = runs.run,
        answering = run?.status === "waiting";
      const request = aboutOf(ask.text, ask.focus);
      const r = answering
        ? await api<Run>("/runs/" + run!.id + "/answer", "POST", {
            answer: [ask.picked, request].filter(Boolean).join("\n"),
            materials: ask.materials ?? [],
          })
        : await api<Run>("/works/" + work.id + "/runs", "POST", {
            prompt: request,
            sceneId: work.scenes[scene] ? scene : work.rootSceneId,
            materials: ask.materials ?? [],
          });
      runs.upsert(r);
      // A new request took one from the allowance; an answer did not.
      if (!answering) this.ctx.host.spent();
      ask.sent?.();
      await this.ctx.host.listed();
    } finally {
      this.sending = false;
      this.ctx.changed();
    }
  }

  /** What becomes of the unsaved edits that hold a request back: saved as a version or
   * thrown away, and the request sent; or the request is not sent after all. */
  async decide(how: "save" | "discard" | "cancel") {
    const held = this.held;
    this.held = undefined;
    this.ctx.changed();
    if (!held || how === "cancel") return;
    const { versions } = this.ctx;
    await held(how === "save" ? await versions.save() : await versions.discard());
  }

  /** Stops the author; resolves to what was asked, to change and send again. */
  async stop() {
    const run = this.ctx.runs.run;
    if (!run) return;
    const asked = run.steps.findLast((s) => s.kind === "message" && s.role === "user");
    await api("/runs/" + run.id + "/cancel", "POST");
    return asked?.kind === "message" ? asked.text : undefined;
  }
}
