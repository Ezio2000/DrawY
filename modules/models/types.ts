import type { Effort, Role } from "../contracts/index.ts";
export type Item = Record<string, any>;

/** One turn asked of a drawing model. The run keeps its conversation as Responses items
 * whatever the model speaks; an adapter turns them into its own requests and its answer
 * back into the same events and items. */
export interface Turn {
  instructions: string;
  input: Item[];
  tools?: Item[];
  signal: AbortSignal;
  /** Each streamed event, as the Responses API names it. */
  onEvent?: (event: Item) => void;
  /** The most tokens the answer may hold; the model's own limit caps it. */
  budget?: number;
  /** Requests that extend one another share a key, so they reach the machine holding
   * their cached prefix. */
  cacheKey?: string;
  /** Request fields that steer this turn without changing its cached prefix, such as
   * which of the tools it may call (from the adapter's own `narrow`). */
  steer?: Item;
  /** The effort this turn thinks at. An API that sets it per request asks for it; one that
   * takes a change inside the conversation reads it there and keeps the request's own as
   * configured, so the cached prefix holds. */
  effort?: Effort;
}
/** A turn as an adapter receives it, with every default filled in. */
export type Request = Turn & { tools: Item[]; onEvent: (event: Item) => void; budget: number };
/** The reasons services give for running out of room, as opposed to stopping a turn. */
const outOfRoom = new Set(["max_output_tokens", "max_tokens", "length", "model_context_window_exceeded"]);
/** A turn the service stopped before it finished: the tokens were still spent, in the
 * usage it carries. `thoughtOnly` says the model spent them all thinking and wrote
 * nothing, which less thought can cure and a smaller change cannot. */
export class CutOff extends Error {
  constructor(
    readonly reason: string | undefined,
    readonly thoughtOnly: boolean,
    readonly usage: Item,
  ) {
    super(
      reason && !outOfRoom.has(reason)
        ? `模型服务中止了这一轮的输出：${reason}`
        : thoughtOnly
          ? "模型的思考用完了这一轮的输出额度，还没写出内容；可以调低思考强度再试"
          : "这一轮要写的内容太多，模型的输出被截断了",
    );
  }
}

export interface Answer {
  items: Item[];
  usage: Item;
  response: Item;
}

/** How an API lets a run change a turn's effort: per request, by an item inside the
 * conversation (which the run keeps there), or not at all. */
export type EffortControl = "request" | "conversation" | "fixed";

/** One request format a drawing model speaks. Everything the run does differently by
 * format is asked of its adapter; adding a format is adding one. */
export interface Adapter {
  generate(role: Role, request: Request): Promise<Answer>;
  /** How the run raises the effort of the turns that decide the work. */
  effortControl(role: Role): EffortControl;
  /** The effort those turns ask for. */
  decidingEffort(role: Role): Effort;
  /** Request fields that hold a turn to the searches left without changing the tools
   * listed, which would restart the cache; absent where the API has no such way, and the
   * run refuses calls past the budget instead. */
  narrow?(tools: Item[], left: number, isSearch: (tool: Item) => boolean, role: Pick<Role, "toolLimits">): Item;
  /** What a turn's trace records of the request beyond its model and effort. */
  describe?(role: Role): Item;
}
