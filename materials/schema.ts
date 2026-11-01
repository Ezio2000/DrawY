import { z } from "zod";

/** A point or box in a picture's own frame, 0..1 on both axes. */
export const unitPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export const unitBoxSchema = unitPointSchema.extend({
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});
export const namesSchema = z.object({
  zh: z.string().min(1),
  en: z.string().min(1),
});
export const originSchema = z.object({
  kind: z.enum(["curated", "generated", "upload"]),
  /** The full prompt a generated picture was made from. */
  prompt: z.string().optional(),
  model: z.string().optional(),
  /** Materials a generated picture was derived from. */
  references: z.array(z.string()).optional(),
  /** Pictures a generated picture was made to look like, for their style only. */
  styleReferences: z.array(z.string()).optional(),
  /** Who made or uploaded it. */
  user: z.string().optional(),
  createdAt: z.number(),
});
/** What part a picture plays in a composition. */
export const roleSchema = z.enum([
  "object", // one isolated thing, cut out on transparency
  "figure", // a person or character, cut out
  "scene", // a complete backdrop or vignette, opaque
  "icon", // a symbol glyph
  "texture", // a surface to fill areas with
]);
export type Role = z.infer<typeof roleSchema>;

/** A material is a ready-made ingredient that gets a better drawing made faster: a picture
 * to place, drawing code to call, an effect to apply or a style to follow. Every material
 * says what it is and when it fits, so an author can find it and judge it. */
interface Envelope {
  id: string;
  name: z.infer<typeof namesSchema>;
  aliases: string[];
  category: string;
  /** What it is: a picture's literal content, or what code draws and when to use it. */
  about: string;
  tags: string[];
  /** The style family it belongs to; null when it suits any style. */
  style: string | null;
  origin: z.infer<typeof originSchema>;
  /** The user it belongs to; public materials have none. */
  owner: string | null;
  /** A generated picture is reserved first and develops in the background. */
  status: "developing" | "ready" | "failed";
  error?: string;
  /** How many works use it. */
  uses: number;
}
export interface PictureMaterial extends Envelope {
  kind: "picture";
  role: Role;
  form: {
    width: number;
    height: number;
    background: "transparent" | "opaque";
    /** The visible content inside the frame, so it can be placed without its margins. */
    content: z.infer<typeof unitBoxSchema>;
    view?: "front" | "side" | "three-quarter" | "top" | "portrait";
    facing?: "left" | "right" | "viewer" | "none";
    /** Named points for leader lines and connections, e.g. face, flame, base. */
    anchors: Record<string, z.infer<typeof unitPointSchema>>;
    /** Dominant colours, darkest first. */
    palette: string[];
    /** An SVG drawn in currentColor that takes the work's ink. */
    recolor: boolean;
  };
  file: { url: string; mediaType: string; bytes: number };
}
/** A parameter of drawing code. The first six types are values a person can change by hand
 * in the app (a choice among its options, a picture by its material id); arrays, objects
 * and effect ids are structure the author sets. */
export interface Param {
  type:
    | "text"
    | "number"
    | "boolean"
    | "color"
    | "picture"
    | "choice"
    | "array"
    | "object"
    | "effect";
  /** The values a choice offers. */
  options?: string[];
  /** The useful range of a number, for a slider. */
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  description: string;
}
export interface DrawingMaterial extends Envelope {
  kind: "drawing";
  /** Function-body source receiving the drawing api and returning an Element. */
  source: string;
  params: Record<string, Param>;
  /** module draws inside its own bounds; link draws between api.from and api.to. */
  use: "module" | "link";
  /** A size it looks right at, in scene units. */
  size: { width: number; height: number };
  /** Data that shows what it draws at that size, as a module. */
  example: Record<string, unknown>;
}
export interface EffectMaterial extends Envelope {
  kind: "effect";
  /** SVG definitions; `$id` stands for the id the drawing refers to. */
  defs: string;
  /** How it is applied: as a filter, a fill or stroke paint, or a line marker. */
  apply: "filter" | "paint" | "marker";
}
export interface StyleMaterial extends Envelope {
  kind: "style";
  /** formal suits explanation and reference; expressive suits stories and imagination. */
  register: "formal" | "expressive" | "any";
  /** The clause every generated picture in this style ends with. */
  prompt: string;
  /** The work's shared style tokens when this style is chosen. */
  tokens: Record<string, string>;
  /** How to draw by hand in this style: line, colour, type, shading. */
  guide: string;
  /** Effects that give hand-drawn parts this style's texture. */
  effects: string[];
  /** Pictures that show the style: its chosen showcase, then the most used. */
  samples: string[];
  /** How many ready pictures it has. */
  count: number;
}
export type Material =
  PictureMaterial | DrawingMaterial | EffectMaterial | StyleMaterial;
export type MaterialKind = Material["kind"];
export const kindSchema = z.enum(["picture", "drawing", "effect", "style"]);

/** Everything the library is told about a new picture; the rest it measures itself. */
export const describeSchema = z.object({
  role: roleSchema,
  name: namesSchema,
  aliases: z.array(z.string()).default([]),
  category: z.string().default(""),
  about: z.string().default(""),
  tags: z.array(z.string()).default([]),
  /** The style family; an upload may have none. */
  style: z.string().min(1).nullable(),
  view: z
    .enum(["front", "side", "three-quarter", "top", "portrait"])
    .optional(),
  facing: z.enum(["left", "right", "viewer", "none"]).optional(),
  anchors: z.record(z.string(), unitPointSchema).default({}),
  origin: originSchema.omit({ createdAt: true, user: true }),
});
export type Describe = z.input<typeof describeSchema>;
/** A picture that is still being made: its frame is known before its pixels. */
export const reserveSchema = describeSchema.extend({
  id: z.string().regex(/^[a-z0-9-]+$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Reserve = z.input<typeof reserveSchema>;

export const searchSchema = z.object({
  /** One entry per thing wanted; each gets its own ranked hits. */
  subjects: z.array(z.string().min(1)).min(1).max(12),
  /** A style family to prefer. */
  style: z.string().optional(),
  kinds: z.array(kindSchema).optional(),
  roles: z.array(roleSchema).optional(),
  limit: z.number().int().min(1).max(24).default(4),
});
export type SearchRequest = z.input<typeof searchSchema>;
export interface Hit {
  material: Material;
  score: number;
  /** exact: it is this thing; close: every word of the request matches; related: part does. */
  match: "exact" | "close" | "related";
}
export interface SearchResult {
  subject: string;
  hits: Hit[];
}
/** Who a request is for: a user sees public materials and their own; one allowed to see
 * all sees everyone's too. Without a user, only public materials. */
export type Viewer = string | { id: string; all?: boolean } | undefined;
export const viewerOf = (v: Viewer) =>
  typeof v === "string"
    ? { id: v, all: false }
    : v && { id: v.id, all: !!v.all };
/** Which shelf of the library to browse: public materials, the user's own, or (for one
 * who sees all) other users' private ones. */
export const shelfSchema = z.enum(["public", "mine", "others"]);
export type Shelf = z.infer<typeof shelfSchema>;
export interface MaterialPage {
  items: Material[];
  total: number;
  page: number;
  pages: number;
}
