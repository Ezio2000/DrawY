import type { SettingsChange } from "../../../modules/contracts/index.ts";
import type { Models, User } from "./api.ts";
import type { RequestDraft, RequestState } from "./session/request.ts";
import type { Ask, Session } from "./session/work.ts";

/** What a work page is handed, whatever device it is laid out for: the open work's
 * session, the request being written, and the app around them. A shell owns only how it
 * looks and what that needs (panels, menus, widths, shortcuts). */
export interface ShellProps {
  session: Session;
  request: RequestState;
  draft: RequestDraft;
  app: {
    user: User;
    models?: Models;
    /** Picks a label; shown at once, then as the server settles it. */
    choose(change: SettingsChange): void;
    offline: boolean;
    error: string;
    clearError(): void;
    fail(error: unknown): void;
    /** Something that went well, said briefly. */
    notice: string;
    say(text: string): void;
    /** Runs an action, saying what went wrong if it fails. */
    attempt(fn: () => Promise<unknown>): Promise<void>;
    go(path: string): void;
    /** Opens the library to add materials to the request. */
    library(): void;
    /** Sends the request as written, or what is given in its place, once the app allows
     * it: a drawing model connected and requests left (answers are always allowed). */
    send(ask?: Partial<Ask>): Promise<void>;
  };
}

/** The devices a work page is laid out for. */
export type Device = "desktop";
/** The device this page is on. Every device gets the desktop page for now; a phone's
 * page goes here when there is one. */
export const deviceOf = (): Device => "desktop";
