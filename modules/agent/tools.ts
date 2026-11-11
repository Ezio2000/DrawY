import { viewSchema } from "../observation/index.ts";
import { z } from "zod";
import { briefSchema, guideTopics, workEditSchema } from "../contracts/index.ts";
import { pictureRequestSchema } from "../images/index.ts";
const fn = (name: string, description: string, parameters: object) => ({
  type: "function",
  name,
  description,
  parameters,
  strict: false,
});
/** A tool's parameters as JSON Schema, without the draft's URL, which only adds tokens. */
const schema = (s: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(s, { io: "input" });
  return rest;
};
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
/** What write_work takes: an edit, whether it finishes the write refused before it, and
 * what to check in the look at what it saves. */
export const writeSchema = workEditSchema.extend({
  amend: z
    .boolean()
    .optional()
    .describe(
      "Finish the write just refused: send only what corrects it, and both save as one revision",
    ),
  look: viewSchema
    .pick({ sceneId: true, claims: true, regions: true })
    .optional()
    .describe("For the look at this save that comes back with it: the claims to check against it, and close-ups or one scene if you need them"),
});
export const tools = [
  fn(
    "ask_user",
    "Ask the user what their words leave open and wait for the answer: which of several things they mean, or a purpose that would make a different work. Use it only for choices that would lead to visibly different works, because the run stops until they answer. Put every open question in one call, each with 2–4 concrete options; to show a look, attach a style id (it shows that style's samples) or picture ids to an option. Call it alone.",
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
    "Have pictures made in the brief's style, in the background. Ask for every missing picture in one call as soon as you know what is missing, before working out the layout, since they develop while you lay out with their ids. Each is painted beside the work's own pictures in that style and the style's samples, shown to the picture model as style references, so a new picture matches the ones already placed; a picture carries no words, so names and numbers belong in your labels. A picture that references a key in the same request starts when that one has developed, taking about twice as long; the rest run side by side. A cut-out that comes out with a background is painted once more, and you are told when it still has one. Fails before anything is painted when a reference does not exist or references form a circle. Returns material ids at once: use them in drawings immediately. view_canvas waits until they have developed, and you are shown each one as it arrives; replace one that came out wrong (wrong subject, words in it, a clashing style), since a label cannot rescue it.",
    schema(generateSchema),
  ),
  fn(
    "read_work",
    "Read the current saved work: brief, materials, scene compositions, drawing sources and revision. Each request already gives you the work as it stood and what you wrote is above, so a change needs no read first; call this when you need the source of something you have not seen.",
    { type: "object", properties: {}, additionalProperties: false },
  ),
  fn(
    "write_work",
    "Change the work, saving one new revision that the viewer sees drawn, and look at it: the result carries the same look view_canvas gives (every nonempty scene's opening view, unless look names one), with its screenshots after it, so a save and its look take one turn. Send only what changes: a record with a known id keeps every field you leave out, and a new id adds the record. data, defaults and style merge key by key, null deleting a key; code and pages change whole or by edits. The revision saves whole or not at all: a refusal lists every problem, holds the write and shows nothing, so correct it with amend: true and only what was wrong. Write modules before drawings and each module's bounds before its data, because the layout is shown to the viewer while the rest streams; look comes last. Of several writes in one message, only the last is looked at.",
    schema(writeSchema),
  ),
  fn(
    "view_canvas",
    "See current saved scenes as images in this conversation, with geometry: the camera, modules changed since the last look with the materials they use and where a picture's visible content is, the parts whose text is too small and the size that would read, any words cut off, and any runtime errors. Shows each scene's opening view and declared interaction checks. Optionally add close-ups of up to three regions, annotate object ids and bounds, or perform a sequence of CSS-selector clicks in one scene; a close-up of a revision you have already seen whole returns just the close-up. Waits for developing pictures first. Every write_work already looks at what it saved, so call this only to look without saving: at a close-up, the result of clicks, or once pictures have developed. Called last after write_work calls, it looks in place of their own look.",
    schema(viewSchema),
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
