import type { SettingsChange } from "../../../modules/contracts/index.ts";
import type { Models } from "./api.ts";
import type { RequestDraft, RequestState } from "./session/request.ts";
import type { Ask, Session } from "./session/work.ts";

/* What a work page is handed, whatever device it is laid out for. Only what every page
 * needs is here: the account is read from `AccountContext`, and how a page looks and
 * what that needs (panels, menus, selections, widths, shortcuts) is its own. */

/** The request being written, and sending it. */
export interface Asking {
  request: RequestState;
  draft: RequestDraft;
  /** Sends what is written, or what is given in its place, once the app allows it;
   * the request is emptied once it has gone. */
  send(ask?: Partial<Ask>): Promise<void>;
  /** Opens the library to add materials to the request. */
  pick(): void;
  /** The labels to draw with and the one chosen; absent until they arrive. */
  models?: Models;
  choose(change: SettingsChange): void;
  /** Why no new request can be sent: no drawing model is connected, or none are left.
   * Answering the author's questions still works when none are left. */
  blocked?: "unconnected" | "spent";
}

/** How the page tells the person what happened. */
export interface Feedback {
  /** What went wrong last, until it is read or replaced. */
  error: string;
  /** Something that went well, said briefly. */
  notice: string;
  dismiss(): void;
  fail(error: unknown): void;
  say(text: string): void;
  /** Runs an action, saying what went wrong if it fails. */
  attempt(fn: () => Promise<unknown>): Promise<void>;
}

export interface ShellProps {
  /** The open work. */
  session: Session;
  asking: Asking;
  feedback: Feedback;
  /** Leaves the work page for another address. */
  go(path: string): void;
}
