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
    .describe("What a person editing the work calls it, in the user's language"),
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
export const drawingSchema = z.object({
  id: key,
  name: key,
  params: z.record(z.string(), paramSchema).optional(),
  defaults: dataSchema.optional(),
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
  intent: z.string().min(1).describe("What the picture must make clear or make felt"),
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
    subject: z.string().min(1).describe("The user's words, verbatim, that say which thing"),
    intent: z.string().min(1).describe("The user's words, verbatim, that say what to show or why; the topic itself when they leave the aspect to you"),
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
 * it saves while answering), a hand edit on the canvas, or bringing back an earlier one. */
export type Cause =
  | { kind: "create" }
  | { kind: "run"; runId: string; prompt: string }
  | { kind: "edit" }
  | { kind: "restore"; revision: number };
export interface RevisionSummary {
  revision: number;
  updatedAt: number;
  cause: Cause;
}
/** The revision a step of the work started from: the one before the first revision of the
 * step that made `revision`. A step is one request to the author with every revision it
 * saved, or one hand edit; a restored revision stands for the one it brought back. */
export function stepBefore(
  history: RevisionSummary[],
  revision: number,
): number | undefined {
  const of = new Map(history.map((r) => [r.revision, r.cause]));
  const seen = new Set<number>();
  let at = revision;
  while (of.get(at)?.kind === "restore" && !seen.has(at)) {
    seen.add(at);
    at = (of.get(at) as Extract<Cause, { kind: "restore" }>).revision;
  }
  const cause = of.get(at);
  if (!cause || cause.kind === "create") return undefined;
  if (cause.kind === "run")
    while (
      of.get(at - 1)?.kind === "run" &&
      (of.get(at - 1) as Extract<Cause, { kind: "run" }>).runId === cause.runId
    )
      at--;
  return at > 1 ? at - 1 : undefined;
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
export const boundsOf = ([x, y, width, height]: number[]): Bounds => ({ x, y, width, height });
/** A change to long text, so a small one does not rewrite the rest. */
export const textEditSchema = z
  .object({
    find: z.string().min(1).describe("Text as it stands now, long enough to occur only once"),
    replace: z.string(),
    all: z.boolean().optional().describe("Change every occurrence instead of requiring one"),
  })
  .strict();
const partScene = key
  .optional()
  .describe("The scene a new part goes in; leave out for the current scene. A known id is found wherever it is");
const linkEndEdit = z
  .union([key, linkEndSchema.strict()])
  .describe(
    'A module id, which meets it on the side facing the other end and follows as they move; or {moduleId, at} with a side (left, right, top, bottom) or a point [x, y] on it, each 0..1',
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
      .describe("What a person editing the work calls it; only when the words in its data do not say it"),
    bounds: boxSchema.optional().describe("[x, y, width, height] in scene units; a new module needs it"),
    drawingId: key
      .optional()
      .describe("A drawing in the work or the library; a new module needs it. Others that use the same drawing change with it"),
    group: z
      .string()
      .nullable()
      .optional()
      .describe("Modules with the same group move together; it draws nothing"),
    target: targetSchema.nullable().optional().describe("Where clicking this module leads"),
    data: dataPatch("The drawing's parameters for this module"),
  })
  .strict();
const linkEditSchema = z
  .object({
    id: key,
    scene: partScene,
    drawingId: key.optional().describe("A link drawing; a new link defaults to the library's arrow"),
    from: linkEndEdit.optional().describe("Where it starts; a new link needs it. " + (linkEndEdit.description ?? "")),
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
      .describe("The scene this one opens from; a new scene defaults to the current scene"),
    interaction: z.string().nullable().optional().describe("The script that runs in this scene, whole; null takes it out"),
    interactionEdits: z.array(textEditSchema).optional().describe("Small changes to that script"),
    checks: z
      .array(checkSchema)
      .optional()
      .describe("Important buttons view_canvas should try, by module and CSS selector; replaces the list"),
    clear: z
      .boolean()
      .optional()
      .describe("Delete everything in it first, to recompose it from the modules and links in this write"),
    order: z
      .array(key)
      .optional()
      .describe("Modules to restack: they take the stacking places they already hold among them, in this order from the bottom, and no other module moves"),
  })
  .strict();
const drawingEditSchema = z
  .object({
    id: key,
    from: key
      .optional()
      .describe("A new drawing starts as a copy of this one, in the work or the library: name, params, defaults and source"),
    name: key.optional(),
    params: z
      .record(z.string(), paramSchema.nullable())
      .optional()
      .describe("Names and bounds for the controls a person gets for data keys; null takes one out"),
    defaults: dataPatch("Values every module drawn with it has unless its own data says otherwise: the place for sizes, colours and words it reads"),
    source: z.string().min(1).optional().describe("Its code, whole; a new drawing needs it unless it has from"),
    edits: z.array(textEditSchema).optional().describe("Small changes to its code, applied in order"),
  })
  .strict();
const detailEditSchema = z
  .object({
    id: key,
    title: key.optional().describe("A new detail needs it"),
    html: z.string().optional().describe("Its page, whole; a new detail needs it"),
    edits: z.array(textEditSchema).optional().describe("Small changes to its page"),
  })
  .strict();
export const workEditSchema = z
  .object({
    title: z.string().optional(),
    scenes: z.array(sceneEditSchema).optional().describe("New scenes, and changes to a scene's own fields"),
    modules: z
      .array(moduleEditSchema)
      .optional()
      .describe("In stacking and drawing order, first at the bottom; a new module goes on top"),
    links: z.array(linkEditSchema).optional(),
    drawings: z.array(drawingEditSchema).optional(),
    details: z.array(detailEditSchema).optional(),
    materials: z
      .array(key)
      .optional()
      .describe("Material ids to take into the work besides those its drawings and data name literally"),
    style: z
      .record(z.string(), z.string().nullable())
      .optional()
      .describe("Style tokens to change; null deletes one"),
    remove: z
      .object({
        modules: z.array(key).optional().describe("Also deletes their links and checks"),
        links: z.array(key).optional(),
        drawings: z.array(key).optional(),
        scenes: z.array(key).optional().describe("Also deletes the scenes under them; modules that led there lead nowhere"),
        details: z.array(key).optional().describe("Modules that opened them open nothing"),
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
}
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
