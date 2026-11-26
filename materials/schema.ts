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

/** How a material is carried out: the payload format the app knows how to run. A picture
 * is placed, drawing code is called, an effect is applied, a style is followed. The library
 * can hold any number of material types; each is carried by one of these. */
export const kindSchema = z.enum(["picture", "drawing", "effect", "style"]);
export type MaterialKind = z.infer<typeof kindSchema>;
/** A material type's id: one level, all types alike (object, figure, scene, icon, texture,
 * drawing, effect, style and any a material pack adds). */
export const typeIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
/** A material type the library knows, from its material packs: what it is called and
 * which payload carries it. */
export const materialTypeSchema = z.object({
  id: typeIdSchema,
  kind: kindSchema,
  name: namesSchema,
  about: z.string().default(""),
});
export type MaterialType = z.infer<typeof materialTypeSchema>;
/** The types of picture the app makes itself, by generating or by upload: a pack that
 * does not declare them still lets pictures be made. */
export const pictureTypes = ["object", "figure", "scene", "icon", "texture"] as const;
export type PictureType = (typeof pictureTypes)[number];

/** A material is a ready-made ingredient that gets a better drawing made faster: a picture
 * to place, drawing code to call, an effect to apply or a style to follow. Every material
 * says what it is and when it fits, so an author can find it and judge it. */
interface Envelope {
  id: string;
  /** Which content of this id it is: a material pack's update makes a new version, and a
   * work keeps the version it took. */
  version: number;
  /** A digest of the content, the same for the same content. */
  hash: string;
  /** Its material type, one of the library's flat list. */
  type: string;
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
  /** A generated picture is reserved first and develops in the background; a withdrawn
   * one is no longer offered, though works that hold it keep it. */
  status: "developing" | "ready" | "failed" | "withdrawn";
  error?: string;
  /** How many works use it. */
  uses: number;
  /** The source of the material pack it came from; null for what users made. */
  pack: string | null;
}
export interface PictureMaterial extends Envelope {
  kind: "picture";
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
  /** `blob` is the content digest a pack's file is kept under. */
  file: { url: string; mediaType: string; bytes: number; blob?: string };
}
export { fieldSchema, fieldsSchema, type Field, type Fields } from "./fields.ts";
import type { FieldType, Fields } from "./fields.ts";
export interface DrawingMaterial extends Envelope {
  kind: "drawing";
  /** Function-body source receiving the drawing api and returning an Element. */
  source: string;
  /** The data it reads, as a schema: what the editor offers and writes are checked by. */
  params: Fields;
  /** What it draws with where a part's data says nothing. */
  defaults: Record<string, unknown>;
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
  /** Pictures that show the style: its chosen showcase, then the most used. A few only,
   * whatever the size of the library. */
  samples: string[];
  /** How many ready public pictures it has. */
  count: number;
}
export type Material =
  PictureMaterial | DrawingMaterial | EffectMaterial | StyleMaterial;

/** The parts of a material only reading it in full needs: drawing code and its example,
 * a style's long instructions. Searching and browsing leave them out. */
export const BODY = {
  drawing: ["source", "example"],
  style: ["guide", "prompt"],
} as const;
type Head<M> = M extends DrawingMaterial
  ? Omit<M, "source" | "example">
  : M extends StyleMaterial
    ? Omit<M, "guide" | "prompt">
    : M;
/** A material as searching and browsing show it: everything but its body. */
export type MaterialHead = Head<Material>;

/** Everything the library is told about a new picture; the rest it measures itself. */
export const describeSchema = z.object({
  type: z.enum(pictureTypes),
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

/** The most a search does, whatever the library holds: how long a subject may be, how many
 * candidates are weighed for one, and how many are returned. */
export const SEARCH_LIMITS = {
  subject: 256,
  subjects: 12,
  candidates: 256,
  hits: 24,
} as const;
export const searchSchema = z.object({
  /** One entry per thing wanted; each gets its own ranked hits. */
  subjects: z.array(z.string().min(1).max(SEARCH_LIMITS.subject)).min(1).max(SEARCH_LIMITS.subjects),
  /** A style family to prefer. */
  style: z.string().optional(),
  /** Material types to keep, from the library's flat list. */
  types: z.array(typeIdSchema).optional(),
  /** Payload formats to keep. */
  kinds: z.array(kindSchema).optional(),
  limit: z.number().int().min(1).max(SEARCH_LIMITS.hits).default(4),
});
export type SearchRequest = z.input<typeof searchSchema>;
export interface Hit {
  material: MaterialHead;
  score: number;
  /** exact: it is this thing by name; close: every word of the request is in its own words;
   * related: part of it is. */
  match: "exact" | "close" | "related";
}
export interface SearchResult {
  subject: string;
  hits: Hit[];
  /** Words of the request no material in the library has: what the hits cannot be. */
  unknown: string[];
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
  items: MaterialHead[];
  total: number;
  page: number;
  pages: number;
}
/** A material named with the version wanted; without one, the current. */
export interface MaterialRef {
  id: string;
  version?: number;
}

/** What the app's own editing asks of the library: the drawing that sets words, the one
 * that places a picture, and the one that joins two parts. A material pack names them, so
 * the app knows these capabilities and not the names of the drawings. */
export const capabilities = ["text", "picture", "link"] as const;
export type Capability = (typeof capabilities)[number];
export type Bindings = Record<Capability, string>;
/** What each capability's drawing must accept: the data the app writes into it. */
export const capabilityContract: Record<Capability, { use: "module" | "link"; params: Record<string, FieldType> }> = {
  text: { use: "module", params: { text: "text", size: "number" } },
  picture: { use: "module", params: { material: "picture" } },
  link: { use: "link", params: {} },
};
