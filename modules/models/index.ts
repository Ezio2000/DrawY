/* Calling the drawing models. The run speaks the Responses API's items and events; each
 * request format has an adapter that turns them into its own requests and its answers
 * back (`responses.ts`, `chat.ts`, `anthropic.ts`). What differs by format, from how a
 * turn's effort is lowered to how its searches are held to a budget, is asked of the
 * adapter here, so the run never checks which format a model speaks. */
import { pinnedProvider, type Protocol, type Role } from "../contracts/index.ts";
import { anthropic } from "./anthropic.ts";
import { chat } from "./chat.ts";
import { responses } from "./responses.ts";
import { blind } from "./text.ts";
import type { Adapter, Answer, Item, Turn } from "./types.ts";
export { CutOff } from "./types.ts";

export type { Adapter, Answer, EffortControl, Item, Turn } from "./types.ts";
export { headers } from "./http.ts";
export { textOf, citationsOf, blind } from "./text.ts";
export { forResponses } from "./responses.ts";
export { toMessages, chatTools } from "./chat.ts";

const adapters: Record<Protocol, Adapter> = { responses, chat, anthropic };
/** The adapter for a request format. */
export const adapterFor = (protocol: Protocol): Adapter => adapters[protocol];

/** One turn with a drawing model, streamed as Responses events and returned as Responses
 * items, whichever format the model speaks. */
export async function generate(role: Role, turn: Turn): Promise<Answer> {
  if (!role.credential) throw Error("请先配置模型凭证");
  return adapterFor(role.protocol).generate(role, {
    ...turn,
    input: role.vision ? turn.input : blind(turn.input),
    tools: turn.tools ?? [],
    onEvent: turn.onEvent ?? (() => {}),
    budget: Math.min(turn.budget ?? 32768, role.maxOutput),
  });
}

/** What a turn's trace records of the request it makes. */
export const requestOf = (role: Role): Item => ({
  model: role.model,
  ...pinnedProvider(role),
  ...adapterFor(role.protocol).describe?.(role),
});
