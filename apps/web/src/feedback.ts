import type { Words } from "./i18n.tsx";
import { SessionError } from "./session/types.ts";
import { Store } from "./session/store.ts";

/** How long a note stays: an error long enough to read, a note of something done briefly. */
const ERROR_FOR = 8000,
  NOTICE_FOR = 2400;

/** What went wrong last and what went well, as the app says them; a store, so only the
 * parts of a page that show them are drawn again when they come and go. The session's
 * reasons are worded here, for every page that does not word them its own way. */
export class Feedback extends Store<{ error: string; notice: string }> {
  private state = { error: "", notice: "" };
  private timers: Partial<Record<"error" | "notice", ReturnType<typeof setTimeout>>> = {};
  constructor(private words: () => Words) {
    super();
  }
  protected build() {
    return this.state;
  }
  private show(kind: "error" | "notice", text: string) {
    clearTimeout(this.timers[kind]);
    this.state = { ...this.state, [kind]: text };
    this.changed();
    if (text)
      this.timers[kind] = setTimeout(() => this.show(kind, ""), kind === "error" ? ERROR_FOR : NOTICE_FOR);
  }
  /** Words for what went wrong. */
  describe(error: unknown) {
    if (error instanceof SessionError) {
      const t = this.words();
      return {
        noScene: t.work.noScene,
        busy: t.work.wait,
        linkDrawing: t.edit.linkDrawing,
        imagesOnly: t.composer.imagesOnly,
      }[error.reason];
    }
    return error instanceof Error ? error.message : String(error);
  }
  fail = (error: unknown) => this.show("error", this.describe(error));
  say = (text: string) => this.show("notice", text);
  dismiss = () => this.show("error", "");
  /** Runs an action, saying what went wrong if it fails. */
  attempt = async (fn: () => Promise<unknown>) => {
    try {
      this.dismiss();
      await fn();
    } catch (e) {
      this.fail(e);
    }
  };
}
