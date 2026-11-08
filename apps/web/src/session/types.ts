import type { Locale } from "@drawy/ui";
import type { Link, Point, Run, Selection, Work, WorkEdit } from "../../../../modules/contracts/index.ts";
import type { Drawn } from "../../../../modules/canvas/index.ts";
import type { Listener } from "../events.ts";
import type { Words } from "../i18n.tsx";
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

/** What the session needs from the app around it. */
export interface SessionHost {
  words(): Words;
  locale(): Locale;
  /** Goes to an address: as a new entry in the browser's history, or in place of the
   * address when it names a scene the work no longer has. */
  go(path: string, how: "push" | "replace"): void;
  /** The list of works may have changed: a request was made or the work renamed. */
  listed(): Promise<unknown>;
  /** A request was made, taking one from the allowance. */
  spent(): void;
  /** Something that went well, said briefly. */
  notice(text: string): void;
  /** Something done in the background failed. */
  fail(error: unknown): void;
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
  /** The view the work is drawn on, while there is one. */
  view?: View;
  revisions: Revisions;
  runs: Runs;
  edits: Edits;
  sending: Sending;
  versions: Versions;
  scenes: Scenes;
}
