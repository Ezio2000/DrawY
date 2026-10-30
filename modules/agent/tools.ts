import { viewSchema } from "../observation/index.ts";
import { z } from "zod";
import { workEditSchema } from "../contracts/index.ts";
const string = { type: "string" };
const obj = (properties: object, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const fn = (name: string, description: string, parameters: object) => ({
  type: "function",
  name,
  description,
  parameters,
  strict: false,
});
export const tools = [
  fn(
    "view_canvas",
    "See current saved scenes as images in this conversation. Includes overview, declared interaction checks and geometry. Optionally focus a world-coordinate region, annotate object IDs/bounds, or perform a sequence of CSS-selector clicks in one scene. Call alone.",
    z.toJSONSchema(viewSchema),
  ),
  fn(
    "read_work",
    "Read the current work, scene compositions and drawing sources and revision.",
    obj({}, []),
  ),
  fn(
    "write_work",
    "Atomically upsert or remove drawing definitions, scene compositions, interactions, details and resources. Sections contain complete records by ID; omitted records remain. Supply the current baseRevision.",
    z.toJSONSchema(workEditSchema),
  ),
  fn(
    "find_matirial",
    "Find public and personal images/icons. Search concise keywords; empty query browses.",
    obj({ query: string }, ["query"]),
  ),
  fn(
    "generate_image",
    "Generate an image or edit reference asset IDs. Returns assets to add to work resources.",
    obj(
      {
        prompt: string,
        references: { type: "array", items: string },
        size: string,
        quality: string,
        background: string,
      },
      ["prompt"],
    ),
  ),
  fn(
    "ask_question",
    "Ask a consequential question and wait for the user.",
    obj({ text: string, options: { type: "array", items: string } }, [
      "text",
      "options",
    ]),
  ),
  fn(
    "finish",
    "Finish after visually inspecting the latest saved revision of every populated scene and fixing concrete defects. Call alone; a write invalidates earlier observations.",
    obj({ message: string }, ["message"]),
  ),
];
