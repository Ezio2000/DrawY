import type { Locale } from "@drawy/ui";
import type { Link, Point, Run, Selection, Work, WorkEdit } from "../../../../modules/contracts/index.ts";
import type { Drawn } from "../../../../modules/canvas/index.ts";
import type { Listener } from "../events.ts";
import type { Edits } from "./edits.ts";
import type { Revisions } from "./revisions.ts";
import type { Runs } from "./runs.ts";
import type { Scenes } from "./scenes.ts";
import type { Sending } from "./sending.ts";
import type { Versions } from "./versions.ts";

/** Whether the author is at work on a run: drawing or looking at what it drew. */
export const live = (run?: Run) => !!run && ["running", "viewing"].includes(run.status);

export type { Drawn };

/** What the session asks of whatever the work is drawn on. Places are in scene units. */
export interface View {
  /** The middle of what is in view. */
  center(): Point;
  /** How many screen pixels a scene unit takes now. */
  readonly scale: number;
  /** Selects these modules, or none. Whatever shows the work keeps the selection; the
   * session selects only what it has just made. */
  select(ids: string[]): void;
  /** Settles once these modules, made in `revision`, are drawn, or once it is clear they
   * will not be. It waits as long as drawing takes, however slow. */
  drawn(ids: string[], revision: number): Promise<Drawn>;
}

/** Why the session refused or could not do something. It names the reason; how to say
 * it, and whether to say it at all, is for whoever shows the work. Errors from the server
 * arrive as they are, already in the reader's language. */
export class SessionError extends Error {
  constructor(
    readonly reason:
      | "noScene" // the scene asked for is not in the work
      | "busy" // the author is drawing, so the work cannot be changed by hand
      | "linkDrawing" // a drawing for links was chosen to place as a module
      | "imagesOnly", // only pictures can be attached
  ) {
    super(reason);
  }
}

/** What happened that whoever shows the work may want to tell the person: hand edits
 * saved as a version (counted as people count them), or something started and forgotten
 * (an edit from a menu, a key or a drag) that failed. */
export type Happening =
  | { kind: "saved"; version: number }
  | { kind: "failed"; error: unknown };

/** Going back, which can be taken back for a while: to a version, by its number, or to
 * the latest version by throwing hand edits away. */
export interface Back {
  /** The revision going back made, and the one it left. */
  at: number;
  from: number;
  to: { kind: "version"; version: number } | { kind: "discarded" };
}

/** What the session needs from the app around it. */
export interface SessionHost {
  /** The language a library material's name is taken into the work in. */
  locale(): Locale;
  /** Goes to an address: as a new entry in the browser's history, or in place of the
   * address when it names a scene the work no longer has. */
  go(path: string, how: "push" | "replace"): void;
  /** The list of works may have changed: a request was made or the work renamed. */
  listed(): Promise<unknown>;
  /** A request was made, taking one from the allowance. */
  spent(): void;
  /** The server's events for this user, and whether they cannot be heard. */
  listen(listener: Listener): () => void;
}

/** What a request is about, when not the whole scene: the modules selected, or a link. */
export interface Focus {
  modules: Pick<Selection, "moduleId" | "label">[];
  link?: Link;
}

/** A request to the author, or an answer while it waits for one. */
export interface Ask {
  text: string;
  /** Library materials sent along. */
  materials?: string[];
  /** Options picked on the author's questions, sent with the answer. */
  picked?: string;
  /** The scene asked about; the one in view unless given. */
  scene?: string;
  /** What in the scene it is about. */
  focus?: Focus;
  /** Called once it is sent, which may be after the person decides about unsaved edits. */
  sent?: () => void;
}

/** Commits a hand edit made from the latest work; resolves to whether there was one. */
export type Change = (make: (work: Work) => WorkEdit | null) => Promise<boolean>;

/** What the parts of a session share: each owns its own state and reads the others'. */
export interface Context {
  readonly id: string;
  readonly host: SessionHost;
  /** Whether the session has been let go; nothing it hears then changes it. */
  disposed: boolean;
  /** Something changed: the snapshot is built again. */
  changed(): void;
  /** Tells whoever listens what happened. */
  tell(happening: Happening): void;
  /** The view the work is drawn on, while there is one. */
  view?: View;
  revisions: Revisions;
  runs: Runs;
  edits: Edits;
  sending: Sending;
  versions: Versions;
  scenes: Scenes;
}
