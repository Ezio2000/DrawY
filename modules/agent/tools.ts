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
    "Finish saving and request actual visual review. Do not claim success until this returns passed.",
    obj({ message: string }, ["message"]),
  ),
];
