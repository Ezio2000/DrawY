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
export const resourceSchema = z.object({
  id: key,
  name: z.string(),
  url: z.string().min(1),
  assetId: z.string().nullable(),
});
export type Point = z.infer<typeof pointSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Drawing = z.infer<typeof drawingSchema>;
export type Instance = z.infer<typeof instanceSchema>;
export type Link = z.infer<typeof linkSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
export type Detail = z.infer<typeof detailSchema>;
export type Resource = z.infer<typeof resourceSchema>;
export interface Work {
  id: string;
  title: string;
  rootSceneId: string;
  drawings: Record<string, Drawing>;
  scenes: Record<string, Scene>;
  interactions: Record<string, Interaction>;
  details: Record<string, Detail>;
  resources: Record<string, Resource>;
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
  resources: z.array(resourceSchema).optional(),
  style: z.record(z.string(), z.string()).optional(),
  remove: z
    .object({
      drawings: z.array(key).optional(),
      scenes: z.array(key).optional(),
      interactions: z.array(key).optional(),
      details: z.array(key).optional(),
      resources: z.array(key).optional(),
    })
    .optional(),
});
export type WorkEdit = z.infer<typeof workEditSchema>;
export interface Selection {
  moduleId: string;
  label: string;
  data: Record<string, unknown>;
}
export interface Asset {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  source: "upload" | "generated" | "observation";
  url: string;
  generationId?: string;
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
  revision: number;
  sceneIds: string[];
  overview: boolean;
  screenshots: Asset[];
  errors: string[];
}
export interface Picture {
  name: string;
  url: string;
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
  | { name: "find_matirial"; query: string; materials?: Picture[] }
  | { name: "generate_image"; prompt: string; images?: Picture[] }
  | {
      name: "write_work";
      /** IDs of the drawing definitions whose source has fully arrived. */
      drawings: string[];
      /** The drawing definition whose source is arriving now. */
      writing?: string;
      scenes: { id: string; title: string; modules: Sketch[] }[];
      details: string[];
      resources: Picture[];
      removed: number;
      revision?: number;
    }
  | {
      name: "view_canvas";
      sceneId?: string;
      focus: "overview" | "region" | "annotate" | "actions";
      region?: Bounds;
      screenshots?: Picture[];
      errors?: string[];
    };
export type Step =
  | {
      kind: "message";
      role: "user" | "assistant";
      text: string;
      assets?: string[];
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
  question?: { text: string; options: string[] };
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
