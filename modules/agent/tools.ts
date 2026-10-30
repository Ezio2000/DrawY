import { z } from "zod";
import { pageSchema } from "../contracts/index.ts";
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
});
export const tools = [
  fn(
    "read_work",
    "Read the current work, page sources and revision.",
    obj({}, []),
  ),
  fn(
    "write_pages",
    "Atomically save complete changed pages. baseRevision must match current work.",
    obj(
      {
        baseRevision: { type: "integer" },
        pages: { type: "array", items: z.toJSONSchema(pageSchema) },
      },
      ["baseRevision", "pages"],
    ),
  ),
  fn(
    "find_matirial",
    "Find public and personal images/icons. Search concise keywords; empty query browses.",
    obj({ query: string }, ["query"]),
  ),
  fn(
    "generate_image",
    "Generate an image or edit reference asset IDs. Returns saved assets for HTML use.",
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
