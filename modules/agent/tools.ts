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
    "Settle the work's brief before drawing, or change it when the user changes direction. Each basis quotes the user's own words. Returns the style's tokens, guide and effects, and library materials found for the cast, with thumbnails.",
    schema(briefSchema),
  ),
  fn(
    "find_materials",
    "Search the material library: pictures (objects, figures, scenes, icons), drawing code, effects and styles. One subject per entry, in Chinese or English; each gets its own ranked hits, with thumbnails of the best pictures. Pass the brief's style to prefer it.",
    schema(findSchema),
  ),
  fn(
    "generate_images",
    "Have pictures made in the brief's style, in the background. Ask for every missing picture in one call. Returns material ids at once: use them in drawings immediately; view_canvas waits until they have developed, and you will be shown each one as it arrives.",
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
