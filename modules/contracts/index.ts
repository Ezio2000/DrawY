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
/** How a person changes one value of a drawing's instance data without touching code. */
export const paramSchema = z.object({
  label: z
    .string()
    .min(1)
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
export const drawingSchema = z.object({
  id: key,
  name: key,
  params: z
    .record(z.string(), paramSchema)
    .optional()
    .describe(
      "The instance data a person may change by hand, by data key; left out when there is nothing to change",
    ),
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
 * words (a request, an answer or a standing preference) that decide that part; the concept
 * is the author's own decision of how the picture carries the intent. */
export const briefSchema = z.object({
  subject: z.string().min(1),
  intent: z.string().min(1),
  audience: z.string().min(1),
  concept: z
    .string()
    .min(1)
    .describe(
      "The visual idea the picture is built on, chosen by the author: what the eye meets first, how the parts are arranged and what that arrangement says; not a list of parts and not the look",
    ),
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
    register: z
      .string()
      .min(1)
      .optional()
      .describe("Omitted when the user's words leave the register to you"),
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
/** How fast the model's requests are processed, cheapest and slowest first. The API
 * offers flex processing, the ChatGPT account ultrafast; both offer default and fast. */
export const speeds = {
  api: ["flex", "default", "fast"],
  oauth: ["default", "fast", "ultrafast"],
} as const;
export type Speed = (typeof speeds)[keyof typeof speeds][number];
/** The Responses API `service_tier` each speed asks for. */
export const serviceTiers: Record<Speed, string> = {
  flex: "flex",
  default: "default",
  fast: "priority",
  ultrafast: "ultrafast",
};
/** The speed a channel can serve: the one asked for if the channel has it, otherwise
 * default, which every channel has. */
export const speedFor = (channel: Role["channel"], speed: Speed): Speed =>
  (speeds[channel] as readonly Speed[]).includes(speed) ? speed : "default";
/** How a run looks things up on the web: with the drawing model's own search, with a
 * search service the app calls for it, or not at all. A run uses exactly one. */
export const searchModes = ["builtin", "service", "off"] as const;
export type SearchMode = (typeof searchModes)[number];
/** The request format a drawing model speaks: the OpenAI Responses API, or Chat
 * Completions, which most other providers (DeepSeek, Qwen, Kimi…) offer. */
export const protocols = ["responses", "chat"] as const;
export type Protocol = (typeof protocols)[number];
/** How hard a model thinks. Providers name their own levels; each model lists the ones it
 * accepts, and a run asks for the nearest. */
export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];
/** The level a model accepts that is nearest to the one wanted, preferring the lower. */
export function effortFor(wanted: Effort, accepted: readonly Effort[]): Effort | undefined {
  if (!accepted.length) return undefined;
  const at = efforts.indexOf(wanted);
  return [...accepted].sort(
    (a, b) =>
      Math.abs(efforts.indexOf(a) - at) - Math.abs(efforts.indexOf(b) - at) ||
      efforts.indexOf(a) - efforts.indexOf(b),
  )[0];
}
export interface Role {
  channel: "api" | "oauth";
  protocol: Protocol;
  baseUrl: string;
  credential: string;
  accountId?: string;
  model: string;
  effort: Effort;
  /** The reasoning levels it accepts; none means it is not asked for one. */
  efforts: Effort[];
  speed: Speed;
  /** Whether it can be shown pictures: screenshots, references and library thumbnails. */
  vision: boolean;
  /** Whether it can call tools, without which it cannot draw at all. */
  tools: boolean;
  /** Whether the provider runs a web search of its own for it. */
  builtinSearch: boolean;
  /** How it searches unless the user picks otherwise. */
  search: SearchMode;
  /** The most tokens one of its answers may hold; providers reject a larger ask. */
  maxOutput: number;
}
/** Only the Responses API with an API key offers the provider's own web search. */
export const canSearchBuiltin = (r: Pick<Role, "channel" | "protocol" | "builtinSearch">) =>
  r.builtinSearch && r.channel === "api" && r.protocol === "responses";
/** A picture model's connection. */
export interface ImageRole {
  channel: "api" | "oauth";
  baseUrl: string;
  credential: string;
  accountId?: string;
  model: string;
}
/** Web search services a run can call for a model, each by its own API. */
export const searchProviders = ["deepseek", "tavily", "brave", "searxng"] as const;
export type SearchProvider = (typeof searchProviders)[number];
export const searchEndpoints: Record<SearchProvider, string> = {
  deepseek: "https://api.deepseek.com/v1/tools",
  tavily: "https://api.tavily.com",
  brave: "https://api.search.brave.com",
  searxng: "http://localhost:8888",
};
export interface SearchService {
  id: string;
  name: string;
  provider: SearchProvider;
  baseUrl: string;
  /** Its API key; a self-hosted SearXNG needs none. */
  credential: string;
}
/** Whether a search service can answer: it has a key, or needs none. */
export const searchReady = (s: SearchService) =>
  s.provider === "searxng" || !!s.credential;
/** What one run is made with: the drawing model, how it searches and the picture model,
 * each with the name it is shown by. */
export interface Settings {
  author: Role;
  authorName: string;
  search: { mode: SearchMode; service?: SearchService };
  image: ImageRole;
  imageName: string;
  preferences: string;
}
export const defaultRole = (): Role => ({
  channel: "api",
  protocol: "responses",
  baseUrl: "https://api.openai.com/v1",
  credential: "",
  model: "gpt-6-astra",
  effort: "medium",
  efforts: ["low", "medium", "high", "xhigh"],
  speed: "default",
  vision: true,
  tools: true,
  builtinSearch: true,
  search: "builtin",
  maxOutput: 32768,
});
export const defaultImage = (): ImageRole => ({
  channel: "api",
  baseUrl: "https://api.openai.com/v1",
  credential: "",
  model: "gpt-image-2.5-sunburst",
});
const imageRoleSchema = z.object({
  channel: z.enum(["api", "oauth"]),
  baseUrl: z.url(),
  credential: z.string(),
  accountId: z.string().optional(),
  model: z.string().min(1),
});
const roleObject = z.object({
    channel: z.enum(["api", "oauth"]),
    protocol: z.enum(protocols),
    baseUrl: z.url(),
    credential: z.string(),
    accountId: z.string().optional(),
    model: z.string().min(1),
    effort: z.enum(efforts),
    efforts: z.array(z.enum(efforts)),
    speed: z.enum(["flex", "default", "fast", "ultrafast"]),
    vision: z.boolean(),
    tools: z.boolean(),
    builtinSearch: z.boolean(),
    search: z.enum(searchModes),
    maxOutput: z.number().int().min(1024).max(1_000_000),
});
// A ChatGPT account speaks only the Responses API; a speed the channel lacks is saved
  // as default, which every channel has; a built-in search the connection cannot offer
  // is not claimed, and a model never defaults to one it does not have.
const fixRole = <T extends z.infer<typeof roleObject>>(r: T): T => {
  const protocol = r.channel === "oauth" ? ("responses" as const) : r.protocol;
  const builtinSearch = canSearchBuiltin({ ...r, protocol });
  return {
    ...r,
    protocol,
    builtinSearch,
    search: r.search === "builtin" && !builtinSearch ? "off" : r.search,
    // The effort kept is one the model accepts.
    effort: effortFor(r.effort, r.efforts) ?? r.effort,
    speed: speedFor(r.channel, r.speed),
  };
};
export const roleSchema = roleObject.transform(fixRole);
/** A drawing model an administrator has connected, with the parameters every request to
 * it uses. People pick among them by name; only those who manage models see the rest. */
export interface ModelOption extends Role {
  id: string;
  name: string;
  description: string;
}
/** A picture model an administrator has connected. */
export interface ImageOption extends ImageRole {
  id: string;
  name: string;
  description: string;
}
/** The models the whole app draws, searches and paints with, set by those who manage
 * models. Each part is chosen on its own, so any drawing model goes with any picture
 * model and search service. */
export interface ModelCatalog {
  models: ModelOption[];
  /** The model used by whoever has not picked one. */
  default: string;
  images: ImageOption[];
  defaultImage: string;
  searches: SearchService[];
  /** The search service used by whoever has not picked one, if there is any. */
  defaultSearch: string | null;
}
/** A drawing model as the model picker shows it, with what it can do. */
export interface ModelChoice {
  id: string;
  name: string;
  description: string;
  /** The model it calls, and the provider's address it calls it at. */
  model: string;
  host: string;
  /** Whether it is connected (has a credential) and can call tools, so it can draw. */
  ready: boolean;
  vision: boolean;
  tools: boolean;
  builtinSearch: boolean;
  /** How it searches for this user: their pick for it, or its default. */
  search: SearchMode;
}
export interface ServiceChoice {
  id: string;
  name: string;
  description: string;
  /** What it is: the picture model, or the search provider. */
  detail: string;
  ready: boolean;
}
/** What each person keeps for themselves: their standing preferences, and the drawing
 * model, picture model and search service they picked, each falling back to the default
 * when it is gone; and how they want each drawing model to search. */
export interface UserSettings {
  preferences: string;
  model: string | null;
  image: string | null;
  searchService: string | null;
  searchModes: Record<string, SearchMode>;
}
export const userSettingsSchema = z.object({
  preferences: z.string(),
  model: z.string().nullable(),
  image: z.string().nullable(),
  searchService: z.string().nullable(),
  searchModes: z.record(z.string(), z.enum(searchModes)),
});
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const naming = {
  id: slug,
  name: z.string().trim().min(1).max(60),
  description: z.string().max(200),
};
export const modelOptionSchema = roleObject.extend(naming).transform(fixRole);
const imageOptionSchema = imageRoleSchema.extend(naming);
const searchServiceSchema = z.object({
  id: slug,
  name: naming.name,
  provider: z.enum(searchProviders),
  baseUrl: z.url(),
  credential: z.string(),
});
const unique = (list: { id: string }[]) =>
  new Set(list.map((m) => m.id)).size === list.length;
/** A catalog saved before pictures and search had settings of their own: one picture
 * model, and every model searching as its connection allowed. */
export function normalizeCatalog(raw: any): ModelCatalog {
  const base = defaultRole();
  const models = (raw?.models ?? []).map((m: any) => {
    const role = { ...base, ...m };
    if (m.builtinSearch === undefined)
      role.builtinSearch = canSearchBuiltin({ ...role, builtinSearch: true });
    if (m.search === undefined) role.search = role.builtinSearch ? "builtin" : "off";
    return role;
  });
  const images: ImageOption[] =
    raw?.images ??
    [
      {
        id: "default",
        name: (raw?.image ?? defaultImage()).model,
        description: "",
        ...defaultImage(),
        ...raw?.image,
      },
    ];
  const searches: SearchService[] = raw?.searches ?? [];
  return {
    models,
    default: raw?.default ?? models[0]?.id,
    images,
    defaultImage: raw?.defaultImage ?? images[0].id,
    searches,
    defaultSearch: raw?.defaultSearch ?? searches[0]?.id ?? null,
  };
}
export const modelCatalogSchema = z.preprocess(
  normalizeCatalog,
  z
    .object({
      models: z.array(modelOptionSchema).min(1),
      default: z.string(),
      images: z.array(imageOptionSchema).min(1),
      defaultImage: z.string(),
      searches: z.array(searchServiceSchema),
      defaultSearch: z.string().nullable(),
    })
    .refine((c) => unique(c.models), { message: "模型 ID 重复" })
    .refine((c) => c.models.some((m) => m.id === c.default), {
      message: "默认模型不存在",
    })
    .refine((c) => unique(c.images), { message: "生图模型 ID 重复" })
    .refine((c) => c.images.some((m) => m.id === c.defaultImage), {
      message: "默认生图模型不存在",
    })
    .refine((c) => unique(c.searches), { message: "搜索服务 ID 重复" })
    .refine(
      (c) =>
        c.defaultSearch === null
          ? !c.searches.length
          : c.searches.some((s) => s.id === c.defaultSearch),
      { message: "默认搜索服务不存在" },
    ),
);
export const defaultCatalog = (): ModelCatalog => {
  const author = defaultRole(),
    image = defaultImage();
  return {
    models: [{ id: "default", name: author.model, description: "", ...author }],
    default: "default",
    images: [{ id: "default", name: image.model, description: "", ...image }],
    defaultImage: "default",
    searches: [],
    defaultSearch: null,
  };
};
/** The search a run makes with a model: the one wanted if it is there, else none. */
export function searchFor(
  model: Pick<Role, "channel" | "protocol" | "builtinSearch">,
  wanted: SearchMode,
  service: SearchService | undefined,
): SearchMode {
  if (wanted === "builtin") return canSearchBuiltin(model) ? "builtin" : "off";
  if (wanted === "service") return service && searchReady(service) ? "service" : "off";
  return "off";
}
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
  cached: number;
  output: number;
  reasoning: number;
  /** Web searches made and pages read, by whichever way the run searched. */
  searches?: number;
  pages?: number;
  /** Calls to tools the provider runs (web search and the like), by tool. */
  hosted?: Record<string, number>;
  images?: { count: number; input: number; output: number };
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
}
export interface RunServices {
  author: string;
  model: string;
  search: SearchMode;
  /** The search service's name, when it searched with one. */
  searchBy?: string;
  image: string;
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
