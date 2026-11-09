import type { SettingsChange } from "../../../modules/contracts/index.ts";
import type { Models } from "./api.ts";
import type { Feedback } from "./feedback.ts";
import type { RequestDraft } from "./session/request.ts";
import type { Ask, WorkSession } from "./session/work.ts";

/* What a work page is handed, whatever device it is laid out for. Only what every page
 * needs is here: the account is read from `AccountContext`, and how a page looks and
 * what that needs (panels, menus, selections, widths, shortcuts) is its own. Each prop
 * keeps its identity while the page is open, and the stores among them are read slice by
 * slice (`useSelect`), so the page is drawn again only where what it shows changed. */

/** The request being written, and sending it. */
export interface Asking {
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

export interface ShellProps {
  /** The open work: its snapshot, read by slices, and its actions. */
  session: WorkSession;
  asking: Asking;
  /** How the page tells the person what went wrong or well. */
  feedback: Feedback;
  /** Leaves the work page for another address. */
  go(path: string): void;
}
