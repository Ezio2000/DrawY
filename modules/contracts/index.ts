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
export const drawingSchema = z.object({
  id: key,
  name: key,
  source: z.string().min(1),
});
// Layout comes before content, in the order writes stream, so a composition can be
// sketched while its drawing code is still arriving.
export const instanceSchema = z.object({
  id: key,
  label: z.string(),
  bounds: boundsSchema,
  drawingId: key,
  group: z.string().nullable(),
  target: targetSchema.nullable(),
  anchors: z.record(z.string(), pointSchema),
  data: z.record(z.string(), z.unknown()),
});
const endpointSchema = z.object({ moduleId: key, anchor: key });
export const linkSchema = z.object({
  id: key,
  drawingId: key,
  from: endpointSchema,
  to: endpointSchema,
  data: z.record(z.string(), z.unknown()),
});
export const sceneSchema = z.object({
  id: key,
  title: key,
  parentId: z.string().nullable(),
  modules: z.array(instanceSchema),
  links: z.array(linkSchema),
  interactionId: z.string().nullable(),
  checks: z.array(z.object({ moduleId: key, selector: key })),
});
export const interactionSchema = z.object({
  id: key,
  source: z.string().min(1),
});
export const detailSchema = z.object({ id: key, title: key, html: z.string() });
/** What the work is meant to be, settled before drawing. Each basis quotes the user's own
 * words (a request, an answer or a standing preference) that decide that part. */
export const briefSchema = z.object({
  subject: z.string().min(1),
  intent: z.string().min(1),
  audience: z.string().min(1),
  register: z.enum(["formal", "expressive"]),
  style: key,
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
    subject: z.string().min(1),
    intent: z.string().min(1),
    register: z.string().min(1),
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
    }
  | { id: string; kind: "effect"; name: string; defs: string };
export type Point = z.infer<typeof pointSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Drawing = z.infer<typeof drawingSchema>;
export type Instance = z.infer<typeof instanceSchema>;
export type Link = z.infer<typeof linkSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
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
  interactions: Record<string, Interaction>;
  details: Record<string, Detail>;
  brief: Brief | null;
  materials: Record<string, MaterialUse>;
  style: Record<string, string>;
  revision: number;
  updatedAt: number;
}
export const workEditSchema = z.object({
  baseRevision: z.number().int(),
  title: z.string().optional(),
  scenes: z.array(sceneSchema).optional(),
  drawings: z.array(drawingSchema).optional(),
  interactions: z.array(interactionSchema).optional(),
  details: z.array(detailSchema).optional(),
  /** Material ids to take into the work besides those its drawings name literally. */
  materials: z.array(key).optional(),
  style: z.record(z.string(), z.string()).optional(),
  remove: z
    .object({
      drawings: z.array(key).optional(),
      scenes: z.array(key).optional(),
      interactions: z.array(key).optional(),
      details: z.array(key).optional(),
      materials: z.array(key).optional(),
    })
    .optional(),
});
export type WorkEdit = z.infer<typeof workEditSchema>;
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
export interface Role {
  channel: "api" | "oauth";
  baseUrl: string;
  credential: string;
  accountId?: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh";
  fast: boolean;
}
export interface Settings {
  author: Role;
  image: {
    channel: "api" | "oauth";
    baseUrl: string;
    credential: string;
    accountId?: string;
    model: string;
  };
  preferences: string;
}
export const defaultSettings = (): Settings => ({
  author: {
    channel: "api",
    baseUrl: "https://api.openai.com/v1",
    credential: "",
    model: "gpt-6-astra",
    effort: "medium",
    fast: false,
  },
  image: {
    channel: "api",
    baseUrl: "https://api.openai.com/v1",
    credential: "",
    model: "gpt-image-2.5-sunburst",
  },
  preferences: "",
});
export const roleSchema = z.object({
  channel: z.enum(["api", "oauth"]),
  baseUrl: z.url(),
  credential: z.string(),
  accountId: z.string().optional(),
  model: z.string().min(1),
  effort: z.enum(["low", "medium", "high", "xhigh"]),
  fast: z.boolean(),
});
export const settingsSchema = z.object({
  author: roleSchema,
  image: roleSchema.omit({ effort: true, fast: true }),
  preferences: z.string(),
});
export interface Observation {
  /** When the canvas was looked at. */
  at: number;
  revision: number;
  sceneIds: string[];
  overview: boolean;
  screenshots: Capture[];
  errors: string[];
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
export type ToolActivity =
  | { name: "read_work"; revision?: number }
  | {
      name: "set_brief";
      subject: string;
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
      region?: Bounds;
      /** Pictures still developing that the look waits for. */
      waiting?: number;
      screenshots?: Picture[];
      errors?: string[];
    };
export type Step =
  | {
      kind: "message";
      role: "user" | "assistant";
      text: string;
      /** Pictures attached to the message, as material ids. */
      materials?: string[];
    }
  | { kind: "thinking"; text: string }
  | ({
      kind: "tool";
      id: string;
      status: "running" | "done" | "failed";
      error?: string;
    } & ToolActivity);
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
}
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const id = () => crypto.randomUUID();
