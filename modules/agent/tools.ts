import { viewSchema } from "../observation/index.ts";
import { z } from "zod";
import { authorWriteSchema, briefSchema, guideTopics } from "../contracts/index.ts";
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
        text: z.string().min(1).describe("The question, in the user's language"),
        options: z
          .array(
            z.object({
              label: z.string().min(1),
              detail: z.string().optional(),
              /** Picture or style material ids that show what this option looks like. */
              materials: z
                .array(z.string())
                .max(3)
                .optional()
                .describe("Picture or style material ids that show what this option looks like"),
            }),
          )
          .min(2)
          .max(4),
        multiple: z.boolean().optional().describe("Whether the user may choose several options"),
      }),
    )
    .min(1)
    .max(3),
});
/** Where a visual idea comes from. Ideas weighed for one brief come from different kinds,
 * so they are real alternatives rather than variations of the first that came to mind. */
export const ideaKinds = {
  convention: "the figure people usually draw for this kind of subject",
  anatomy: "the real thing seen whole, in section or cut away (a volcano cut open)",
  journey: "where things happen and how they travel through space (a letter's route across a map)",
  change: "one place or thing changing over time (one tree through four seasons)",
  scale: "a comparison at true size or proportion (the planets side by side)",
  mechanism:
    "the forces or reason behind a rule, shown acting (why an arch stands: the thrust passing stone to stone into the ground)",
  analogy:
    "a familiar situation with the same structure, holding at the points that matter (a computer's memory as desk, drawer and warehouse)",
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
  subjects: z
    .array(z.string().min(1))
    .min(1)
    .max(12)
    .describe("One subject per entry, in Chinese or English"),
  kinds: z
    .array(z.enum(["picture", "drawing", "effect", "style"]))
    .optional()
    .describe("Leave out to search every kind"),
  style: z.string().optional().describe("A style id to prefer; defaults to the brief's style"),
});
export const generateSchema = z.object({
  images: z.array(pictureRequestSchema).min(1).max(8),
});
export const guideSchema = z
  .object({
    topics: z
      .array(z.enum(guideTopics))
      .optional()
      .describe("Guides to read, from the list under # Guides in your instructions"),
    drawings: z
      .array(z.string().min(1))
      .max(12)
      .optional()
      .describe("Library drawing ids whose cards to read, from the list under # Library"),
  })
  .refine((g) => g.topics?.length || g.drawings?.length, "至少要指定一个指南或画法");
export const tools = [
  fn(
    "ask_user",
    "Ask the user what their words leave open (which sense of the subject, what aspect or purpose, how serious or personal) and wait for the answer. Use it only for choices that would lead to visibly different works, because the run stops until they answer. Put every open question in one call, each with 2–4 concrete options; to show a look, attach a style id (it shows that style's samples) or picture ids to an option. Call it alone.",
    schema(askSchema),
  ),
  fn(
    "set_brief",
    "Settle the work's brief before drawing, or change it when the user changes direction or the concept has to change. It decides what the figure says, not where things go, so call it before working out any layout. Each basis quotes the user's own words verbatim, and the call fails on a quote it cannot find; the ideas and the concept chosen from them are your own and quote nothing. Returns the revision, the style's tokens, guide and effects, and library pictures found for the cast, with thumbnails.",
    schema(settleSchema),
  ),
  fn(
    "find_materials",
    "Search the library beyond what set_brief found: pictures (objects, figures, scenes, icons), drawing code, effects and styles. Each subject gets its own ranked hits, with thumbnails of the best pictures, and says so when nothing matches directly: then generate that picture or try a synonym.",
    schema(findSchema),
  ),
  fn(
    "draw_guide",
    "Read instructions and library drawing cards on demand. topics returns the guides listed under # Guides in your instructions, each holding rules you do not otherwise have; drawings returns each library drawing's description, parameters, default size and example data. It changes nothing in the work. Ask for everything you expect to need in one call, alongside other calls when you can. What you read stays in the conversation, so asking again only returns a note that it is above.",
    schema(guideSchema),
  ),
  fn(
    "generate_images",
    "Have pictures made in the brief's style, in the background. Ask for every missing picture in one call, as early as you can, since they develop while you lay out. Each is painted beside the work's own pictures in that style and the style's samples, shown to the picture model as style references, so a new picture matches the ones already placed. A picture that references a key in the same request starts when that one has developed; the rest run side by side. Fails before anything is painted when a reference does not exist or references form a circle. Returns material ids at once: use them in drawings immediately. view_canvas waits until they have developed, and you are shown each one as it arrives.",
    schema(generateSchema),
  ),
  fn(
    "read_work",
    "Read the current saved work: brief, materials, scene compositions, drawing sources and revision. Each request already gives you the work as it stood and what you wrote is above, so a change needs no read first; call this when you need the source of something you have not seen, or the state after a failed write.",
    { type: "object", properties: {}, additionalProperties: false },
  ),
  fn(
    "write_work",
    "Atomically change the work, saving a new revision that the viewer sees drawn. modules and links are flat lists: a known id changes only the fields sent and everything not named stays as it is, while a new id is added. Leave out what a part does not need. drawings, interactions, details and materials are upserted or removed whole by id. Fails without saving when baseRevision is stale or the result is invalid, and says why. Write modules before drawings and each module's bounds before its data, because the layout is shown to the viewer while the rest streams.",
    schema(authorWriteSchema),
  ),
  fn(
    "view_canvas",
    "See current saved scenes as images in this conversation, with geometry: the camera, modules changed since the last look with the materials they use and where a picture's visible content is, the smallest text, any words cut off, and any runtime errors. Shows each scene's opening view and declared interaction checks. Optionally add close-ups of up to three regions, annotate object ids and bounds, or perform a sequence of CSS-selector clicks in one scene; a close-up of a revision you have already seen whole returns just the close-up. Waits for developing pictures first. Call it alone or last after write_work calls: saves run in order before the screenshot, and a failed save skips it so you do not judge an older version.",
    schema(viewSchema),
  ),
  fn(
    "finish",
    "End the run. It succeeds only when you have seen the latest saved revision of every populated scene with every picture developed; otherwise it says what is missing and the run goes on. A write invalidates earlier observations. Call it alone, as soon as the last look holds, with your closing words in message.",
    {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "What the finished work shows, for the user in their language: a few plain sentences, with any values you assumed listed so they can correct them",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  ),
];
export const searchSchema = z.object({
  /** Several facts are looked up together, one query each. */
  queries: z.array(z.string().min(1)).min(1).max(4),
});
export const openSchema = z.object({ url: z.string().min(1) });
/** Web search through the search service the app calls, for a model that has none of
 * its own or whose own is not chosen. Listed after the drawing tools, so a run that does
 * not search shares their prefix. */
export const searchTools = [
  fn(
    "web_search",
    "Search the web through the app's search service. Put every fact the figure needs in one call, one query each; each query returns up to five results with title, URL, date and snippet. Each query counts against this request's search budget, and the result says what is left.",
    schema(searchSchema),
  ),
  fn(
    "open_page",
    "Read one web page's text (up to about 12,000 characters), to settle a fact a search result only hints at. Open a page once: what it says stays above. Counts against this request's search budget.",
    schema(openSchema),
  ),
];
