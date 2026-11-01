import { viewSchema } from "../observation/index.ts";
import { z } from "zod";
import { briefSchema, workEditSchema } from "../contracts/index.ts";
import { pictureRequestSchema } from "../images/index.ts";
const fn = (name: string, description: string, parameters: object) => ({
  type: "function",
  name,
  description,
  parameters,
  strict: false,
});
const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input" });
export const askSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        options: z
          .array(
            z.object({
              label: z.string().min(1),
              detail: z.string().optional(),
              /** Picture or style material ids that show what this option looks like. */
              materials: z.array(z.string()).max(3).optional(),
            }),
          )
          .min(2)
          .max(4),
        multiple: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(3),
});
/** Where a visual idea comes from. Ideas weighed for one brief come from different kinds,
 * so they are real alternatives rather than variations of the first that came to mind. */
export const ideaKinds = {
  convention: "the figure people usually draw for this kind of subject",
  anatomy: "the real thing seen whole, in section or cut away",
  journey: "where things happen and how they travel through space",
  change: "one place or thing changing over time",
  scale: "a comparison at true size or proportion",
  mechanism: "the forces or reason behind it, shown acting",
  analogy: "a familiar situation with the same structure",
  scene: "a moment with characters that makes it felt",
};
/** What set_brief takes: the brief, with the ideas weighed before its concept. They come
 * first so that the concept is chosen from them as it is written; they stay in the run's
 * steps, not in the work. */
const { subject, intent, audience, ...rest } = briefSchema.shape;
export const settleSchema = z.object({
  subject,
  intent,
  audience,
  ideas: z
    .array(
      z.object({
        kind: z.enum(Object.keys(ideaKinds) as [keyof typeof ideaKinds]),
        idea: z.string().min(1),
      }),
    )
    .min(2)
    .max(3)
    .refine(
      (ideas) => new Set(ideas.map((i) => i.kind)).size === ideas.length,
      "ideas 要来自不同的种类：同一种类的想法只是彼此的变体",
    )
    .describe(
      `Two or three visual ideas for the intent, each of a different kind, one sentence each, weighed before the concept is chosen. Kinds: ${Object.entries(
        ideaKinds,
      )
        .map(([k, v]) => `${k} (${v})`)
        .join(", ")}`,
    ),
  ...rest,
});
export const findSchema = z.object({
  subjects: z.array(z.string().min(1)).min(1).max(12),
  kinds: z.array(z.enum(["picture", "drawing", "effect", "style"])).optional(),
  style: z.string().optional(),
});
export const generateSchema = z.object({
  images: z.array(pictureRequestSchema).min(1).max(8),
});
export const tools = [
  fn(
    "ask_user",
    "Ask the user what their words leave open (which sense of the subject, what aspect or purpose, how serious or personal) and wait. All open questions in one call, each with 2–4 concrete options that would lead to visibly different works. To show a look, attach the style id to the option (it shows that style's samples) or picture ids. Call alone.",
    schema(askSchema),
  ),
  fn(
    "set_brief",
    "Settle the work's brief before drawing, or change it when the user changes direction or the concept has to change. Each basis quotes the user's own words; the ideas and the concept chosen from them are your own and quote nothing. Returns the style's tokens, guide and effects, and library materials found for the cast, with thumbnails.",
    schema(settleSchema),
  ),
  fn(
    "find_materials",
    "Search the material library: pictures (objects, figures, scenes, icons), drawing code, effects and styles. One subject per entry, in Chinese or English; each gets its own ranked hits, with thumbnails of the best pictures. Pass the brief's style to prefer it.",
    schema(findSchema),
  ),
  fn(
    "generate_images",
    "Have pictures made in the brief's style, in the background. Ask for every missing picture in one call. Each is painted beside the work's own pictures in that style and the style's samples, shown to the picture model as style references, so a new picture matches the ones already placed; use references only for what a picture must be made from. A picture can reference another in the same call by its key (the same character in several scenes): it is made from that picture once it exists. Returns material ids at once: use them in drawings immediately; view_canvas waits until they have developed, and you will be shown each one as it arrives.",
    schema(generateSchema),
  ),
  fn(
    "read_work",
    "Read the current work: brief, materials, scene compositions, drawing sources and revision.",
    { type: "object", properties: {}, additionalProperties: false },
  ),
  fn(
    "write_work",
    "Atomically upsert or remove scene compositions, drawing definitions, interactions, details and materials. Sections contain complete records by ID; omitted records remain. Supply the current baseRevision. Write scenes before drawings and each module's label and bounds before its data: the layout is shown to the viewer while the rest streams.",
    schema(workEditSchema),
  ),
  fn(
    "view_canvas",
    "See current saved scenes as images in this conversation. Includes overview, declared interaction checks and geometry. Optionally focus a world-coordinate region, annotate object IDs/bounds, or perform a sequence of CSS-selector clicks in one scene. Waits for developing pictures first. Call alone.",
    schema(viewSchema),
  ),
  fn(
    "finish",
    "Finish after visually inspecting the latest saved revision of every populated scene, with every picture developed, and fixing concrete defects. Call alone; a write invalidates earlier observations.",
    {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
      additionalProperties: false,
    },
  ),
];
