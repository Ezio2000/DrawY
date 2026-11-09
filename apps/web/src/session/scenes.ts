import type { Run, Work } from "../../../../modules/contracts/index.ts";
import { addressOf } from "../routes.ts";
import { SessionError, type Context } from "./types.ts";

/** Which scene is in view: the one the address names, or the root when the work has no
 * such scene (the address then follows); going into a scene, which asks for it when
 * nothing is drawn there yet; and following a run to the scene it drew in. */
export class Scenes {
  /** The scene the address names. */
  private addressed?: string;
  /** The address already sent back to the root, so it is sent back once. */
  private replaced?: string;

  constructor(private ctx: Context) {
    ctx.revisions.watch((work) => this.check(work));
  }

  get sceneId() {
    const w = this.ctx.revisions.work;
    return w && this.addressed && w.scenes[this.addressed]
      ? this.addressed
      : (w?.rootSceneId ?? "root");
  }

  /** The address names this scene now. */
  locate(addressed: string | undefined) {
    if (addressed !== this.replaced) this.replaced = undefined;
    if (addressed === this.addressed) return;
    this.addressed = addressed;
    const w = this.ctx.revisions.work;
    if (w) this.check(w);
    this.ctx.changed();
  }

  /** An address naming a scene the work no longer has falls back to its root. */
  private check(work: Work) {
    const a = this.addressed;
    if (!a || work.scenes[a] || this.replaced === a) return;
    this.replaced = a;
    this.ctx.host.go(addressOf(work), "replace");
  }

  /** Goes to a scene. One with nothing drawn yet is asked for at once, with the request
   * `asking` words for it from the scene's title, as the person would ask. */
  async enter(id: string, asking?: (title: string) => string) {
    const { revisions, runs, sending, host } = this.ctx;
    const w = revisions.work;
    if (!w?.scenes[id]) throw new SessionError("noScene");
    host.go(addressOf(w, id), "push");
    if (asking && !w.scenes[id].modules.length && !runs.working)
      await sending.send({ text: asking(w.scenes[id].title), scene: id });
  }

  /** A run that ends having drawn only in other scenes takes the viewer to the last one it
   * drew: left on the scene they asked from, people took the new subscene for nothing
   * done. */
  follow(run: Run) {
    const w = this.ctx.revisions.work;
    if (!w) return;
    const written = run.steps.flatMap((step) =>
      step.kind === "tool" && step.name === "write_work" && step.status === "done"
        ? step.scenes.map((x) => x.id)
        : [],
    );
    if (!written.length || written.includes(this.sceneId)) return;
    const target = written.findLast((id) => w.scenes[id]?.modules.length);
    if (target) queueMicrotask(() => this.ctx.host.go(addressOf(w, target), "push"));
  }
}
