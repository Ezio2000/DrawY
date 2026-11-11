import { z } from "zod";
const key = z.string().min(1);
export const pointSchema = z.object({ x: z.number(), y: z.number() });
export const boundsSchema = pointSchema.extend({
  width: z.number().positive(),
  height: z.number().positive(),
});
export const targetSchema = z.object({
  kind: z.enum(["scene", "detail"]),
  id: key,
});
/** The kinds of value a person can change by hand, each with its own plain control. */
export const paramTypes = [
  "text",
  "number",
  "boolean",
  "color",
  "picture",
  "choice",
] as const;
/** How a person changes one value of a drawing's instance data without touching code. A
 * value in `defaults` gets a control without one; this names it and bounds it. */
export const paramSchema = z.object({
  label: z
    .string()
    .min(1)
    .optional()
    .describe(
      "What a person editing the work calls it, in the user's language",
    ),
  type: z.enum(paramTypes),
  options: z
    .array(z.string().min(1))
    .min(2)
    .optional()
    .describe("The values a choice offers"),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
});
const dataSchema = z.record(z.string(), z.unknown());
/** How a module drawn with a drawing gets its size when it is given none: to hold its words
 * (a block, a label), its rows (a table), or the modules it frames or carries in lanes. */
export const fits = ["words", "rows", "frame", "lanes"] as const;
export type Fit = (typeof fits)[number];
export const drawingSchema = z.object({
  id: key,
  name: key,
  params: z.record(z.string(), paramSchema).optional(),
  defaults: dataSchema.optional(),
  /** [width, height] a module drawn with it has unless it says otherwise. */
  size: z.array(z.number().positive()).length(2).optional(),
  fit: z.enum(fits).optional(),
  source: z.string().min(1),
});
/** One of the sides of a module, each at the middle of that side. */
export const sideNames = ["left", "right", "top", "bottom"] as const;
export type Side = (typeof sideNames)[number];
/** Where a link meets a module: a side, or a point as a share of the module's size. */
export const endAtSchema = z.union([
  z.enum(sideNames),
  z.array(z.number()).length(2),
]);
/** One end of a link. It belongs to the link: nothing is declared on the module, and without
 * `at` it takes the side facing the other end wherever the two modules are. */
export const linkEndSchema = z.object({
  moduleId: key,
  at: endAtSchema.optional(),
});
// Layout comes before content, in the order writes stream, so a composition can be
// sketched while its drawing code is still arriving.
export const instanceSchema = z.object({
  id: key,
  /** Set only when a person or the author names it; otherwise `labelOf` reads its words. */
  label: z.string().optional(),
  bounds: boundsSchema,
  drawingId: key,
  group: z.string().optional(),
  target: targetSchema.optional(),
  data: dataSchema,
});
export const linkSchema = z.object({
  id: key,
  drawingId: key,
  from: linkEndSchema,
  to: linkEndSchema,
  data: dataSchema,
});
export const checkSchema = z.object({ moduleId: key, selector: key });
export const sceneSchema = z.object({
  id: key,
  title: key,
  parentId: z.string().nullable(),
  /** Stacking and drawing order, first at the bottom. */
  modules: z.array(instanceSchema),
  links: z.array(linkSchema),
  /** The script that runs in this scene. */
  interaction: z.string().optional(),
  checks: z.array(checkSchema),
});
export const detailSchema = z.object({ id: key, title: key, html: z.string() });
/** What the work is meant to be, settled before drawing. Each basis quotes the user's own
 * words (a request, an answer or a standing preference) that decide that part; the concept
 * is the author's own decision of how the picture carries the intent. */
export const briefSchema = z.object({
  subject: z.string().min(1).describe("The subject as you understand it"),
  intent: z
    .string()
    .min(1)
    .describe("What the picture must make clear or make felt"),
  audience: z.string().min(1),
  concept: z
    .string()
    .min(1)
    .describe(
      "The visual idea the picture is built on, chosen by the author: what the eye meets first, how the parts are arranged and what that arrangement says; not a list of parts and not the look",
    ),
  register: z.enum(["formal", "expressive"]),
  style: key.describe("A style id from the library"),
  direction: z
    .string()
    .min(1)
    .describe(
      "How the work looks, never what it shows: palette, line, light, mood, level of detail",
    ),
  cast: z
    .array(z.string().min(1))
    .max(12)
    .describe("Recognizable things that will appear, one per entry"),
  basis: z.object({
    subject: z
      .string()
      .min(1)
      .describe("The user's words, verbatim, that say which thing"),
    intent: z
      .string()
      .min(1)
      .describe(
        "The user's words, verbatim, that say what to show or why; the topic itself when they leave the aspect to you",
      ),
    register: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The user's words, verbatim, that say how serious or personal it should be: a medium, audience, purpose or mood such as 教科书, 严谨, 汇报, 科普, 给孩子看, 绘本, 海报, 放飞想象, 水墨. Omitted when their words leave the register to you",
      ),
  }),
});
/** A material as a work uses it: what the runtime needs, copied when the work took it, so
 * the work keeps drawing the same way whatever happens to the library. */
export type MaterialUse =
  | {
      id: string;
      kind: "picture";
      name: string;
      role: string;
      style: string | null;
      url: string;
      /** The visible content's size in pixels; anchors are relative to it. */
      width: number;
      height: number;
      /** The visible content within the file's frame. */
      content: { x: number; y: number; width: number; height: number };
      anchors: Record<string, { x: number; y: number }>;
      recolor: boolean;
      /** A whole painted picture rather than a cut-out. */
      opaque: boolean;
      status: "developing" | "ready" | "failed";
    }
  | {
      id: string;
      kind: "drawing";
      name: string;
      source: string;
      defaults: Record<string, unknown>;
      /** The parameters a person can change by hand; the app names them itself. */
      params: Record<string, Omit<Param, "label">>;
      /** The size it looks right at, and how a module given no size is fitted. */
      size?: { width: number; height: number };
      fit?: Fit;
      /** A structure or chart that lays its words out within its module: words found
       * outside it mean the module is too small for them. */
      contained?: boolean;
    }
  | { id: string; kind: "effect"; name: string; defs: string };
export type Point = z.infer<typeof pointSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Param = z.infer<typeof paramSchema>;
export type ParamType = Param["type"];
export type Drawing = z.infer<typeof drawingSchema>;
export type Instance = z.infer<typeof instanceSchema>;
export type Link = z.infer<typeof linkSchema>;
export type LinkEnd = z.infer<typeof linkEndSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Detail = z.infer<typeof detailSchema>;
export type Brief = z.infer<typeof briefSchema>;
/** The style tokens of a work before its brief chooses a style. */
export const blankStyle: Record<string, string> = {
  ink: "#24312e",
  accent: "#d97757",
  muted: "#6c7972",
  font: "system-ui, sans-serif",
};
export interface Work {
  id: string;
  title: string;
  rootSceneId: string;
  drawings: Record<string, Drawing>;
  scenes: Record<string, Scene>;
  details: Record<string, Detail>;
  brief: Brief | null;
  materials: Record<string, MaterialUse>;
  style: Record<string, string>;
  revision: number;
  updatedAt: number;
  /** The user named the work themselves; the author keeps that title. */
  named?: boolean;
}
/** What made a revision: the work's creation, one request to the author (every revision
 * it saves while answering), a hand edit on the canvas, the person saving their hand edits
 * as a version, or going back to an earlier one. A hand edit is not a version until it is
 * saved: the person keeps working on it, then saves it or throws it away. */
export type Cause =
  | { kind: "create" }
  | { kind: "run"; runId: string; prompt: string }
  | { kind: "edit" }
  | { kind: "save" }
  | { kind: "restore"; revision: number };
export interface RevisionSummary {
  revision: number;
  updatedAt: number;
  cause: Cause;
}
/** Where a work has got to, as the list of works shows it. */
export interface WorkProgress {
  /** Its latest request's state; null before the first. */
  run:
    | "running"
    | "waiting"
    | "viewing"
    | "completed"
    | "failed"
    | "cancelled"
    | null;
  /** What that request asked, its first words. */
  prompt: string;
  /** The version it stands at. */
  version: number;
  /** Whether nothing has been drawn on it yet. */
  blank: boolean;
  /** Hand edits made on it that are not saved as a version yet. */
  unsaved?: number;
}
/** What people count as one version of a work: everything one request to the author
 * saved (only how it ended matters), hand edits saved as one, or the blank start.
 * Numbered from the oldest, the blank start being 0, so the numbers follow the requests
 * made rather than every draft the author saved on the way. Going back to a version makes
 * it the latest again: the versions after it leave the list, as if they had not been made,
 * and the next request or saved edit takes the number after it. */
export interface Version {
  number: number;
  /** The revision it stands at: the last one it saved. */
  revision: number;
  /** Every revision it saved, oldest first, and those that went back to it. */
  revisions: number[];
  /** The cause of its last revision. */
  cause: Cause;
  updatedAt: number;
}
/** One hand edit not saved as a version yet, and the revisions that came back to it. */
export interface UnsavedEdit {
  revision: number;
  revisions: number[];
}
/** Revisions one request saved in a row are one version. */
const sameRun = (a: Cause, b: Cause) =>
  a.kind === "run" && b.kind === "run" && a.runId === b.runId;
/** The versions of a work as they stand now, oldest first, and the hand edits made on the
 * latest that are not saved as a version yet, from its revisions in any order. */
export function historyOf(
  history: Pick<RevisionSummary, "revision" | "cause" | "updatedAt">[],
): {
  versions: Version[];
  unsaved: UnsavedEdit[];
} {
  type Entry = Version & {
    /** The versions under it when it was made, to bring back with it. */
    chain: Entry[];
    /** The revisions standing as it ended. */
    ends: Set<number>;
    /** Gone back to: whatever comes next is a version of its own. */
    sealed?: boolean;
  };
  // Where each revision is: in a version, or among the unsaved edits laid on one.
  const where = new Map<
    number,
    { version?: Entry; edits?: UnsavedEdit[]; at?: number }
  >();
  const sorted = [...history].sort((a, b) => a.revision - b.revision);
  let stack: Entry[] = [],
    unsaved: UnsavedEdit[] = [];
  const push = (r: (typeof sorted)[number], cause: Cause, before: number[]) => {
    const entry: Entry = {
      number: stack.length,
      revision: r.revision,
      revisions: [...before, r.revision],
      cause,
      updatedAt: r.updatedAt,
      chain: [...stack],
      ends: new Set([r.revision]),
    };
    for (const n of entry.revisions) where.set(n, { version: entry });
    stack = [...stack, entry];
    unsaved = [];
  };
  for (const r of sorted) {
    const top = stack.at(-1),
      cause = r.cause;
    if (cause.kind === "edit" && top) {
      unsaved = [...unsaved, { revision: r.revision, revisions: [r.revision] }];
      where.set(r.revision, {
        version: top,
        edits: unsaved,
        at: unsaved.length - 1,
      });
      continue;
    }
    if (cause.kind === "restore") {
      const to = where.get(cause.revision);
      if (to?.version && to.edits) {
        // Back to an edit not saved yet, with the version it was made on.
        stack = [...to.version.chain, to.version];
        unsaved = to.edits.slice(0, to.at! + 1);
        unsaved.at(-1)!.revisions.push(r.revision);
        where.set(r.revision, {
          version: to.version,
          edits: unsaved,
          at: unsaved.length - 1,
        });
        continue;
      }
      if (to?.version && to.version.ends.has(cause.revision)) {
        // Back to a version as it ended: the ones after it go.
        const v = to.version;
        stack = [...v.chain, v];
        unsaved = [];
        v.revisions.push(r.revision);
        v.ends.add(r.revision);
        v.sealed = true;
        where.set(r.revision, { version: v });
        continue;
      }
      // A draft from the middle of a request comes back as a version of its own.
      push(r, cause, []);
      continue;
    }
    if (top && !top.sealed && !unsaved.length && sameRun(top.cause, cause)) {
      top.revisions.push(r.revision);
      top.revision = r.revision;
      top.cause = cause;
      top.updatedAt = r.updatedAt;
      top.ends = new Set([r.revision]);
      where.set(r.revision, { version: top });
    } else
      push(
        r,
        cause,
        unsaved.flatMap((e) => e.revisions),
      );
  }
  // Without the blank start (it can only be missing from a partial history) numbering
  // still begins at 1.
  const offset = sorted[0] && sorted[0].cause.kind !== "create" ? 1 : 0;
  return {
    versions: stack.map((v) => ({
      number: v.number + offset,
      revision: v.revision,
      revisions: [...v.revisions],
      cause: v.cause,
      updatedAt: v.updatedAt,
    })),
    unsaved: unsaved.map((e) => ({
      revision: e.revision,
      revisions: [...e.revisions],
    })),
  };
}
/** The versions of a work as they stand now, oldest first, from its revisions in any order. */
export const versionsOf = (
  history: Pick<RevisionSummary, "revision" | "cause" | "updatedAt">[],
): Version[] => historyOf(history).versions;
/** The version a revision belongs to. */
export const versionOf = (versions: Version[], revision: number) =>
  versions.find((v) => v.revisions.includes(revision));
/** The revision undoing goes back to from `revision`, the latest: the hand edit before it
 * while edits are not saved yet, else the version before the one it is in. */
export function stepBefore(
  history: RevisionSummary[],
  revision: number,
): number | undefined {
  const { versions, unsaved } = historyOf(history);
  const i = unsaved.findIndex((e) => e.revisions.includes(revision));
  if (i >= 0)
    return i > 0 ? unsaved[i - 1].revision : versions.at(-1)?.revision;
  const v = versionOf(versions, revision);
  if (!v) return undefined;
  return versions[versions.indexOf(v) - 1]?.revision;
}
/* A change to a work, the one form the author's write_work and every hand edit share. Each
 * record names what it changes by id and says nothing about the rest:
 * - a record with a known id changes only the fields it gives, a new id adds the record;
 * - objects (data, defaults, params, style) merge key by key, null deleting a key;
 * - a list given whole replaces the list; given as an object keyed by position it changes
 *   those items (see mergeValue);
 * - long text (a drawing's source, a script, a detail's page) changes whole or by edits;
 * - remove goes first and takes along what can no longer stand without what it removed.
 * The workspace commits it as one revision (editing/apply.ts lays it on the work). */
const dataPatch = (what: string) =>
  z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      `${what}; keys you give change, others stay, null deletes one. A list you give replaces the list; {"2":{"value":5}} changes its item 2 alone, and position = its length appends`,
    );
/** A boxed position and size as every edit and the author's reading of a work write it. */
export const boxSchema = z
  .array(z.number())
  .length(4)
  .refine(([, , width, height]) => width > 0 && height > 0, "宽和高必须大于 0")
  .describe("[x, y, width, height] in scene units");
export const boxOf = ({ x, y, width, height }: Bounds) => [x, y, width, height];
export const boundsOf = ([x, y, width, height]: number[]): Bounds => ({
  x,
  y,
  width,
  height,
});
/** A change to long text, so a small one does not rewrite the rest. */
export const textEditSchema = z
  .object({
    find: z
      .string()
      .min(1)
      .describe("Text as it stands now, long enough to occur only once"),
    replace: z.string(),
    all: z
      .boolean()
      .optional()
      .describe("Change every occurrence instead of requiring one"),
  })
  .strict();
const partScene = key
  .optional()
  .describe(
    "The scene a new part goes in; leave out for the current scene. A known id is found wherever it is",
  );
const linkEndEdit = z
  .union([key, linkEndSchema.strict()])
  .describe(
    "A module id, which meets it on the side facing the other end and follows as they move; or {moduleId, at} with a side (left, right, top, bottom) or a point [x, y] on it, each 0..1",
  );
// Fields stay in the order of a whole record: layout streams before content.
const moduleEditSchema = z
  .object({
    id: key,
    scene: partScene,
    label: z
      .string()
      .nullable()
      .optional()
      .describe(
        "What a person editing the work calls it; only when the words in its data do not say it",
      ),
    bounds: boxSchema
      .optional()
      .describe(
        "[x, y, width, height] in scene units; a new module needs it unless arrange places it",
      ),
    drawingId: key
      .optional()
      .describe(
        "A drawing in the work or the library; a new module needs it. Others that use the same drawing change with it",
      ),
    group: z
      .string()
      .nullable()
      .optional()
      .describe("Modules with the same group move together; it draws nothing"),
    target: targetSchema
      .nullable()
      .optional()
      .describe("Where clicking this module leads"),
    data: dataPatch("The drawing's parameters for this module"),
  })
  .strict();
const linkEditSchema = z
  .object({
    id: key
      .optional()
      .describe(
        "Leave out for the one link between two modules: it is then known by its ends, and writing it again changes it",
      ),
    scene: key
      .optional()
      .describe(
        "The scene a new link goes in; leave out to put it where its two modules are (the current scene if they are in different ones)",
      ),
    drawingId: key
      .optional()
      .describe("A link drawing; a new link defaults to the library's arrow"),
    from: linkEndEdit
      .optional()
      .describe(
        "Where it starts; a new link needs it. " +
          (linkEndEdit.description ?? ""),
      ),
    to: linkEndEdit.optional().describe("Where it ends; a new link needs it"),
    data: dataPatch("The drawing's parameters for this link"),
  })
  .strict();
const sceneEditSchema = z
  .object({
    id: key,
    title: key.optional().describe("A new scene needs it"),
    parentId: z
      .string()
      .optional()
      .describe(
        "The scene this one opens from; a new scene defaults to the current scene",
      ),
    interaction: z
      .string()
      .nullable()
      .optional()
      .describe("The script that runs in this scene, whole; null takes it out"),
    interactionEdits: z
      .array(textEditSchema)
      .optional()
      .describe("Small changes to that script"),
    checks: z
      .array(checkSchema)
      .optional()
      .describe(
        "Important buttons of the scene's script or a drawing that view_canvas should try, by module and CSS selector; not modules that only open their target; replaces the list",
      ),
    clear: z
      .boolean()
      .optional()
      .describe(
        "Delete everything in it first, to recompose it from the modules and links in this write",
      ),
    order: z
      .array(key)
      .optional()
      .describe(
        "Modules to restack: they take the stacking places they already hold among them, in this order from the bottom, and no other module moves",
      ),
  })
  .strict();
const drawingEditSchema = z
  .object({
    id: key,
    from: key
      .optional()
      .describe(
        "A new drawing starts as a copy of this one, in the work or the library: name, params, defaults and source",
      ),
    name: key.optional(),
    params: z
      .record(z.string(), paramSchema.nullable())
      .optional()
      .describe(
        "Names and bounds for the controls a person gets for data keys; null takes one out",
      ),
    defaults: dataPatch(
      "Values every module drawn with it has unless its own data says otherwise: the place for sizes, colours and words it reads",
    ),
    size: z
      .array(z.number().positive())
      .length(2)
      .optional()
      .describe(
        "[width, height] a module drawn with it has when arrange places it and it gives no bounds",
      ),
    fit: z
      .enum(fits)
      .nullable()
      .optional()
      .describe(
        "How arrange sizes such a module instead: words to hold its title, text and note, rows for its rows; a copy keeps its origin's",
      ),
    source: z
      .string()
      .min(1)
      .optional()
      .describe("Its code, whole; a new drawing needs it unless it has from"),
    edits: z
      .array(textEditSchema)
      .optional()
      .describe("Small changes to its code, applied in order"),
  })
  .strict();
const detailEditSchema = z
  .object({
    id: key,
    title: key.optional().describe("A new detail needs it"),
    html: z
      .string()
      .optional()
      .describe("Its page, whole; a new detail needs it"),
    edits: z
      .array(textEditSchema)
      .optional()
      .describe("Small changes to its page"),
  })
  .strict();
/** One change made to many parts at once: every module (or link) of a scene that matches,
 * so a size, a font or a colour shared by fifty blocks is one record and not fifty. */
const eachSchema = z
  .object({
    links: z.boolean().optional().describe("Change links instead of modules"),
    scene: key.optional().describe("Leave out for the current scene"),
    drawingId: key.optional().describe("Only parts drawn with this drawing"),
    group: z.string().optional().describe("Only modules of this group"),
    where: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Only parts whose data has these values, such as {"tone": "accent"}',
      ),
    data: dataPatch("Merged into the data of each"),
    use: key.optional().describe("The drawing each is drawn with from now on"),
    size: z
      .array(z.number().positive())
      .length(2)
      .optional()
      .describe("[width, height] each module takes, about its centre"),
  })
  .strict();
export const layouts = ["flow", "tree", "lanes", "grid"] as const;
export const directions = ["down", "right", "up", "left"] as const;
/** Places modules by their links instead of by coordinates. It is worked out once, when the
 * write is saved, into each module's own bounds: nothing of it is kept, so every module is
 * then moved by hand like any other. */
export const arrangeSchema = z
  .object({
    scene: key.optional().describe("Leave out for the current scene"),
    layout: z
      .enum(layouts)
      .optional()
      .describe(
        "flow (the default): ranks along the direction by the links, as a flowchart, state machine, dependency graph or architecture; tree: each module under the one that links to it, as an org chart, or to both sides of the root with direction both, as a mind map; lanes: swimlanes, each module in the lane it is listed in and in order of the links along it; grid: rows of equal cells in the order listed",
      ),
    direction: z
      .enum([...directions, "both"])
      .optional()
      .describe(
        "Which way it reads; defaults to the style token flow, else down. both is a tree's two sides",
      ),
    modules: z
      .union([z.array(key), z.literal("all")])
      .optional()
      .describe(
        'The modules to place; leave out for those this write adds without bounds, or "all" for every module of the scene. Others stay where they are',
      ),
    tiers: z
      .array(z.array(key))
      .optional()
      .describe(
        "flow: the rank each module stands in when the figure names its own, first rank first, as the layers of an architecture or a dependency graph; their order within a rank is still worked out from the links",
      ),
    lanes: z
      .array(z.array(key))
      .optional()
      .describe(
        "lanes: the modules of each lane, in the order of the lanes module's lanes",
      ),
    ground: key
      .optional()
      .describe(
        "lanes: the swimlanes module to size under them; it is given its place and its header",
      ),
    frames: z
      .record(z.string(), z.array(key))
      .optional()
      .describe(
        "Frame modules and the modules each holds, as {frameId: [memberIds]}; a member may be another frame. Members are kept together and each frame is sized round its own",
      ),
    columns: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("grid: cells in a row"),
    wrap: z
      .boolean()
      .optional()
      .describe(
        "flow: fold a figure much longer than the landscape view into rows that run back and forth (columns, for one that reads down). On unless false, or when the arrangement has frames or tiers",
      ),
    gap: z
      .array(z.number().nonnegative())
      .length(2)
      .optional()
      .describe(
        "[between ranks, between neighbours] in scene units; the default leaves room for the links and their labels",
      ),
    size: z
      .array(z.number().positive())
      .length(2)
      .optional()
      .describe(
        "[width, height] for the modules without bounds, instead of fitting each kind to its words",
      ),
    fit: z
      .boolean()
      .optional()
      .describe(
        "Size every module placed again to its words, not only those without bounds",
      ),
    at: z
      .array(z.number())
      .length(2)
      .optional()
      .describe(
        "[x, y] of the arrangement's top left; defaults to where its modules already are, else [0, 0]",
      ),
    beside: z
      .tuple([key, z.enum(["right", "below", "left", "above"])])
      .optional()
      .describe(
        "Instead of at: a module already placed (by an earlier arrange of this write too) to set the arrangement beside, as [moduleId, side]",
      ),
  })
  .strict();
export type Arrange = z.infer<typeof arrangeSchema>;
export type Each = z.infer<typeof eachSchema>;
export const workEditSchema = z
  .object({
    title: z.string().optional(),
    scenes: z
      .array(sceneEditSchema)
      .optional()
      .describe("New scenes, and changes to a scene's own fields"),
    arrange: z
      .array(arrangeSchema)
      .optional()
      .describe(
        "Arrangements to work out, in order, for modules that give no bounds or that should be placed again. Write it before modules, so the viewer watches the figure take shape",
      ),
    modules: z
      .array(moduleEditSchema)
      .optional()
      .describe(
        "In stacking and drawing order, first at the bottom; a new module goes on top",
      ),
    links: z.array(linkEditSchema).optional(),
    each: z
      .array(eachSchema)
      .optional()
      .describe("Changes made to every matching part, after the records above"),
    drawings: z.array(drawingEditSchema).optional(),
    details: z.array(detailEditSchema).optional(),
    materials: z
      .array(key)
      .optional()
      .describe(
        "Material ids to take into the work besides those its drawings and data name literally",
      ),
    style: z
      .record(z.string(), z.string().nullable())
      .optional()
      .describe("Style tokens to change; null deletes one"),
    remove: z
      .object({
        modules: z
          .array(key)
          .optional()
          .describe("Also deletes their links and checks"),
        links: z.array(key).optional(),
        drawings: z.array(key).optional(),
        scenes: z
          .array(key)
          .optional()
          .describe(
            "Also deletes the scenes under them; modules that led there lead nowhere",
          ),
        details: z
          .array(key)
          .optional()
          .describe("Modules that opened them open nothing"),
        materials: z.array(key).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WorkEdit = z.infer<typeof workEditSchema>;
export type ModuleEdit = z.infer<typeof moduleEditSchema>;
export type LinkEdit = z.infer<typeof linkEditSchema>;
export type SceneEdit = z.infer<typeof sceneEditSchema>;
export type DrawingEdit = z.infer<typeof drawingEditSchema>;
export type TextEdit = z.infer<typeof textEditSchema>;
export * from "./edit.ts";
export interface Selection {
  moduleId: string;
  label: string;
  data: Record<string, unknown>;
}
/** A screenshot of the canvas taken for the author. */
export interface Capture {
  id: string;
  name: string;
  url: string;
}
export * from "./models.ts";
import type { Effort, RunPrices, SearchMode, Speed } from "./models.ts";
/** What a role may do beyond drawing: manage the models, see and use every material,
 * publish and withdraw materials, and manage accounts and their roles. */
export const permissions = [
  "models.manage",
  "materials.all",
  "materials.manage",
  "accounts.manage",
] as const;
export type Permission = (typeof permissions)[number];
/** A role an account holds. Administrators may do everything and cannot be changed;
 * members are who new accounts start as; administrators can add more. */
export interface AccountRole {
  id: string;
  name: string;
  permissions: Permission[];
  builtin: boolean;
}
export const ADMIN = "admin",
  MEMBER = "member";
export const accountRoleSchema = z.object({
  name: z.string().trim().min(1).max(40),
  permissions: z.array(z.enum(permissions)),
});
/** The signed-in account as the app knows it. */
export interface Account {
  id: string;
  name: string;
  role: string;
  roleName: string;
  /** Whether the role is built in, so its name is shown in the reader's language. */
  builtinRole: boolean;
  permissions: Permission[];
  /** Requests to the author it may still make; null is no limit. */
  quota: number | null;
}
/** The requests a new account may make until an administrator gives it more. */
export const DEFAULT_QUOTA = 10;
/** A one-time code an administrator hands out, which lets one person create an account. */
export interface Invite {
  code: string;
  createdAt: number;
  /** Who made it, by name; a removed account has none. */
  createdBy: string | null;
  /** The account it made, once used. */
  usedBy: { id: string; name: string | null } | null;
  usedAt: number | null;
}
export interface Observation {
  /** When the canvas was looked at. */
  at: number;
  revision: number;
  sceneIds: string[];
  overview: boolean;
  screenshots: Capture[];
  errors: string[];
  /** The smallest text of each scene seen whole, in screenshot pixels. */
  smallestText?: Record<string, number>;
}
export interface Picture {
  name: string;
  url: string;
  /** The material it shows, if it is one. */
  id?: string;
  status?: "developing" | "ready" | "failed";
}
/** A material the author is weighing, as the journal shows it. */
export interface Candidate {
  id: string;
  kind: "picture" | "drawing" | "effect" | "style";
  name: string;
  /** A picture to show: the picture itself, or a style's sample. */
  url?: string;
}
export interface Question {
  id: string;
  text: string;
  options: { label: string; detail?: string; pictures?: Picture[] }[];
  multiple?: boolean;
}
/** A module as the author lays it out, while its write is still streaming. */
export interface Sketch {
  id: string;
  label: string;
  bounds: Bounds;
  /** The drawing it uses, once that much of the module has streamed. */
  drawingId?: string;
}
export interface Citation {
  start: number;
  end: number;
  url: string;
  title: string;
}
/** The guides the author can read on demand with draw_guide. */
export const guideTopics = [
  "drawing",
  "diagrams",
  "maps",
  "exploration",
  "formats",
  "copy",
] as const;
export type GuideTopic = (typeof guideTopics)[number];
export type ToolActivity =
  | {
      name: "web_search";
      queries: string[];
      urls: string[];
      /** What the search did: ran queries, opened a page or looked for words in one. */
      action?: "search" | "open_page" | "find_in_page";
      /** The words looked for in a page. */
      pattern?: string;
    }
  /** A tool the model provider runs itself that the app has no special view for, named
   * by its output item's type without `_call` (e.g. `code_interpreter`). */
  | { name: "hosted"; tool: string; detail?: string }
  | { name: "read_work"; revision?: number }
  /** What the author read on demand: guides by topic, library drawings by id. */
  | { name: "draw_guide"; topics: GuideTopic[]; drawings: string[] }
  | {
      name: "set_brief";
      subject: string;
      /** The different visual ideas the author weighed, as they stream. */
      ideas?: string[];
      /** The one it chose and developed, once it has streamed. */
      concept?: string;
      register?: "formal" | "expressive";
      style?: string;
      /** Materials found for the cast, by subject. */
      found?: { subject: string; candidates: Candidate[] }[];
      revision?: number;
    }
  | {
      name: "find_materials";
      subjects: string[];
      found?: { subject: string; candidates: Candidate[] }[];
    }
  | { name: "generate_images"; images: Picture[] }
  | {
      name: "write_work";
      /** IDs of the drawing definitions whose source has fully arrived. */
      drawings: string[];
      /** The drawing definition whose source is arriving now. */
      writing?: string;
      scenes: { id: string; title: string; modules: Sketch[] }[];
      /** Modules and links this write changes in part, in scenes it does not replace. */
      changed?: number;
      details: string[];
      /** Materials taken into the work by this write. */
      materials: string[];
      removed: number;
      revision?: number;
    }
  | {
      name: "view_canvas";
      sceneId?: string;
      focus: "overview" | "region" | "annotate" | "actions";
      regions?: Bounds[];
      /** The names of pictures still developing that the look waits for. */
      waiting?: string[];
      screenshots?: Picture[];
      errors?: string[];
    };
export type Step =
  | {
      kind: "message";
      role: "user" | "assistant";
      text: string;
      citations?: Citation[];
      /** Pictures attached to the message, as material ids. */
      materials?: string[];
      /** The author's questions, waiting for the user's answer. */
      asked?: boolean;
    }
  | { kind: "thinking"; text: string }
  | ({
      kind: "tool";
      id: string;
      status: "running" | "done" | "failed";
      error?: string;
    } & ToolActivity);
/** What a run has spent so far: the author's tokens over every model turn, and what the
 * pictures it generated cost the picture model. */
export interface RunUsage {
  input: number;
  /** Input tokens read from the provider's cache, and written to it where that is paid. */
  cached: number;
  cacheWrite?: number;
  output: number;
  reasoning: number;
  /** Web searches made and pages read, by whichever way the run searched. */
  searches?: number;
  pages?: number;
  /** Calls to tools the provider runs (web search and the like), by tool. */
  hosted?: Record<string, number>;
  /** Pictures painted, and the picture model's tokens: all input and output, and the
   * parts priced apart (text and image input, text output). */
  images?: {
    count: number;
    input: number;
    output: number;
    textInput?: number;
    imageInput?: number;
    textOutput?: number;
  };
  /** What failed and did not count towards the above, though it was spent all the same. */
  failed?: FailedUsage;
}
/** Model attempts that did not finish (a dropped stream, a cut-off answer, a cancelled
 * turn), tool calls written broken and pictures that did not develop. */
export interface FailedUsage {
  /** Model attempts, whether or not they cost anything: a refused request costs nothing. */
  attempts: number;
  /** How long those attempts took, with the waits before each was tried again. */
  ms: number;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  /** How much of `output` is estimated from what had streamed, as a stream that breaks
   * off never reports it. It leaves out thinking that was not shown, so it runs low. */
  estimated: number;
  /** Tool calls whose input was not valid JSON. The model is told and writes them again, so
   * their tokens are in the turn that wrote them, not in the counts above. */
  invalidCalls: number;
  /** Pictures that failed; the picture model reports nothing for those. */
  images: number;
}
export interface Run {
  id: string;
  workId: string;
  sceneId: string;
  status:
    "running" | "waiting" | "viewing" | "completed" | "failed" | "cancelled";
  steps: Step[];
  questions?: Question[];
  observations: Observation[];
  error?: string;
  startedAt: number;
  elapsedMs?: number;
  firstOutputMs?: number;
  firstSceneMs?: number;
  usage?: RunUsage;
  /** Who made it: the drawing model, how it searched and the picture model, by name. */
  services?: RunServices;
  /** What its spending is priced at, fixed when it started (`costOf` gives the cost). */
  prices?: RunPrices;
}
export interface RunServices {
  /** The label picked; people who do not manage models are shown only this. */
  label?: string;
  author: string;
  model: string;
  effort?: Effort;
  speed?: Speed;
  search: SearchMode;
  /** The search service's name, when it searched with one. */
  searchBy?: string;
  image: string;
}
export const id = () => crypto.randomUUID();
