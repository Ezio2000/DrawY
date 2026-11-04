/* The models DrawY draws, searches and paints with, and what they cost.
 *
 * An administrator connects providers (an address and a credential) and lists the models
 * each serves, with the options people may pick for each: the efforts and speeds it
 * offers, and whether its own web search may be used. Drawing models, search services and
 * picture models are configured apart, and each person picks one of each, with an effort
 * and a speed, beside the composer.
 *
 * What a connection, an API format or a search provider offers is said once, in the
 * specs below. The schema settles a model against them, the server and the run read them,
 * and the settings page shows only the controls they allow; so adding a connection, a
 * format or a provider is adding an entry here (and its adapter, and its words), and
 * nothing that reads them changes. */
import { z } from "zod";
import type { RunUsage } from "./index.ts";

// ---- Effort

/** How hard a model thinks. Providers name their own levels; each model lists the ones it
 * offers, and a run asks for the nearest. */
export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];
/** The level a model accepts that is nearest to the one wanted, preferring the lower. */
export function effortFor(wanted: Effort, accepted: readonly Effort[]): Effort | undefined {
  if (!accepted.length) return undefined;
  const at = efforts.indexOf(wanted);
  return [...accepted].sort(
    (a, b) =>
      Math.abs(efforts.indexOf(a) - at) - Math.abs(efforts.indexOf(b) - at) ||
      efforts.indexOf(a) - efforts.indexOf(b),
  )[0];
}
/** The lowest level a model accepts, if it lists any. */
export const lowestEffort = (accepted: readonly Effort[]): Effort | undefined =>
  accepted.length
    ? accepted.reduce((a, b) => (efforts.indexOf(b) < efforts.indexOf(a) ? b : a))
    : undefined;

// ---- Search modes

/** How a run looks things up on the web: with the drawing model's own search, with a
 * search service the app calls for it, or not at all. A run uses exactly one. */
export const searchModes = ["builtin", "service", "off"] as const;
export type SearchMode = (typeof searchModes)[number];

// ---- API formats

/** The request format a drawing model speaks: the OpenAI Responses API, Chat
 * Completions, which most other providers (DeepSeek, Qwen, Kimi…) offer, or the Anthropic
 * Messages API, which Claude models speak. Each has an adapter in `modules/models`. */
export const protocols = ["responses", "chat", "anthropic"] as const;
export type Protocol = (typeof protocols)[number];
export interface ProtocolSpec {
  /** Where its own provider serves it, for a provider newly set up for it. */
  endpoint: string;
  /** Whether its provider can run a web search of its own. */
  builtinSearch: boolean;
  /** Whether it takes a processing speed (the Responses API's service tier). */
  speeds: boolean;
}
export const protocolSpecs: Record<Protocol, ProtocolSpec> = {
  responses: { endpoint: "https://api.openai.com/v1", builtinSearch: true, speeds: true },
  chat: { endpoint: "https://api.openai.com/v1", builtinSearch: false, speeds: false },
  anthropic: { endpoint: "https://api.anthropic.com", builtinSearch: true, speeds: false },
};

// ---- Speeds

/** How fast the model's requests are processed, cheapest and slowest first. Which ones
 * there are depends on the connection. */
export const speeds = ["flex", "default", "fast", "ultrafast"] as const;
export type Speed = (typeof speeds)[number];
/** What each speed usually costs against the default, until an administrator says. */
export const speedRates: Record<Speed, number> = { flex: 0.5, default: 1, fast: 2, ultrafast: 4 };

// ---- Connections

/** How a provider is reached: with an API key, or with a ChatGPT account's token. */
export const channels = ["api", "oauth"] as const;
export type Channel = (typeof channels)[number];
export interface ChannelSpec {
  /** Where it is served whatever the format; without one, each format's own endpoint. */
  endpoint?: string;
  /** The formats it speaks; a model on it that speaks another falls back to the first. */
  protocols: readonly Protocol[];
  /** The speeds it serves; every connection serves `default`. */
  speeds: readonly Speed[];
  /** Whether its provider may run a web search of its own. */
  builtinSearch: boolean;
  /** Whether a request may be pinned to one OpenRouter provider. */
  pinProvider: boolean;
  /** Whether it needs the account's ID beside its token. */
  accountId: boolean;
}
export const channelSpecs: Record<Channel, ChannelSpec> = {
  api: {
    protocols: ["responses", "chat", "anthropic"],
    speeds: ["flex", "default", "fast", "ultrafast"],
    builtinSearch: true,
    pinProvider: true,
    accountId: false,
  },
  oauth: {
    endpoint: "https://chatgpt.com/backend-api/codex",
    protocols: ["responses"],
    speeds: ["default", "fast", "ultrafast"],
    builtinSearch: false,
    pinProvider: false,
    accountId: true,
  },
};
/** Where a connection is served unless its address is set by hand. */
export const endpointFor = (channel: Channel, protocol: Protocol = "responses") =>
  channelSpecs[channel].endpoint ?? protocolSpecs[protocol].endpoint;
/** The speed a channel can serve: the one asked for if the channel has it, otherwise
 * default, which every channel has. */
export const speedFor = (channel: Channel, speed: Speed): Speed =>
  channelSpecs[channel].speeds.includes(speed) ? speed : "default";
/** The speeds a model may be offered at: its connection's, when its format takes one. */
export const speedsOf = (r: { channel: Channel; protocol: Protocol }): readonly Speed[] =>
  protocolSpecs[r.protocol].speeds ? channelSpecs[r.channel].speeds : [];
/** The format a new model on a connection most likely speaks, judged by its address. */
export const protocolFor = (c: Pick<Connection, "channel" | "baseUrl">): Protocol =>
  c.channel === "oauth"
    ? "responses"
    : /anthropic\.com/.test(c.baseUrl)
      ? "anthropic"
      : /api\.openai\.com/.test(c.baseUrl)
        ? "responses"
        : "chat";

/** How a provider is reached, for drawing and picture models alike. */
export interface Connection {
  channel: Channel;
  baseUrl: string;
  credential: string;
  accountId?: string;
}
const connectionShape = {
  channel: z.enum(channels),
  baseUrl: z.url(),
  credential: z.string(),
  accountId: z.string().optional(),
};
/** A connection changed by hand. One moved to another channel follows it to its address,
 * unless the address is set in the same change. */
export function reconnect<T extends Connection>(
  before: T,
  patch: Partial<T>,
  protocol: Protocol = "responses",
): T {
  const next = { ...before, ...patch };
  if (patch.baseUrl === undefined && next.channel !== before.channel)
    next.baseUrl = endpointFor(next.channel, protocol);
  return next;
}

// ---- Prices

/** What a model's tokens cost, in US dollars per million. A cache write is what a
 * provider that charges for writing its cache (Claude) asks; reads are `cached`. */
export interface TokenPrices {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
}
const money = z.number().min(0).max(1_000_000);
const tokenPricesShape = { input: money, cached: money, cacheWrite: money, output: money };
const noTokens = (): TokenPrices => ({ input: 0, cached: 0, cacheWrite: 0, output: 0 });

// ---- Drawing models

/** One drawing model a provider serves, and the options people may pick for it. */
export interface WriterModel {
  /** Its own id, unique among all drawing models; picks are saved by it. */
  id: string;
  /** The model as the provider names it. */
  model: string;
  /** The name it is shown by; empty, it is named after its model and provider. */
  name: string;
  description: string;
  protocol: Protocol;
  /** Optional OpenRouter provider slug; when set, only this provider may serve requests. */
  provider?: string;
  /** Whether it can be shown pictures: screenshots, references and library thumbnails. */
  vision: boolean;
  /** Whether it can call tools, without which it cannot draw at all. */
  tools: boolean;
  /** The most tokens one of its answers may hold; providers reject a larger ask. */
  maxOutput: number;
  /** The reasoning levels people may pick; none means it is not asked for one. */
  efforts: Effort[];
  /** The level used until someone picks another. */
  effort: Effort;
  /** The speeds people may pick; none where its format takes no speed. */
  speeds: Speed[];
  speed: Speed;
  /** Whether people may have it search the web with its provider's own search. */
  builtinSearch: boolean;
  /** Whether its Responses endpoint accepts `max_tool_calls` and `tool_choice:
   * allowed_tools`, with which a run holds a turn to the searches left without changing the
   * tools listed. Some services that speak Responses (DeepSeek's) reject them; without them
   * the run still refuses a search service's calls past the budget. */
  toolLimits: boolean;
  /** Its token prices at the default speed, and each built-in search call's price. */
  prices: TokenPrices & { search: number };
  /** What each speed costs against the default, as a multiple. */
  speedRates: Partial<Record<Speed, number>>;
}
/** A provider: where its models are reached, and the models it serves. */
export interface Provider<M> extends Connection {
  id: string;
  /** Its short name, shown after each of its models: `gpt-6.1-terra[api]`. */
  name: string;
  models: M[];
}
export type WriterProvider = Provider<WriterModel>;

/** What one run's requests to a drawing model carry: its connection, the model and the
 * options picked for it. Every model adapter reads this. */
export interface Role extends Connection {
  protocol: Protocol;
  model: string;
  provider?: string;
  effort: Effort;
  /** Whether its endpoint accepts the request fields that narrow the tools (see
   * `WriterModel.toolLimits`). */
  toolLimits: boolean;
  /** The reasoning levels it accepts. */
  efforts: Effort[];
  speed: Speed;
  vision: boolean;
  tools: boolean;
  maxOutput: number;
}
/** Whether a connection and format offer the provider's own web search. */
export const offersBuiltinSearch = (r: { channel: Channel; protocol: Protocol }) =>
  channelSpecs[r.channel].builtinSearch && protocolSpecs[r.protocol].builtinSearch;
/** The provider a request is pinned to, as the request names it, if the connection allows. */
export const pinnedProvider = (r: Pick<Role, "channel" | "provider">) =>
  r.provider && channelSpecs[r.channel].pinProvider
    ? { provider: { only: [r.provider], allow_fallbacks: false } }
    : {};
/** A model as its provider's connection lets it be: a format the channel does not speak
 * falls back to one it does, a built-in search it cannot offer is not offered, and the
 * speeds and defaults kept are ones the model and channel accept. */
export function settleWriter(c: Pick<Connection, "channel">, m: WriterModel): WriterModel {
  const offered = channelSpecs[c.channel].protocols;
  const protocol = offered.includes(m.protocol) ? m.protocol : offered[0];
  const served = speedsOf({ channel: c.channel, protocol });
  const speeds = served.filter((s) => m.speeds.includes(s));
  return {
    ...m,
    protocol,
    provider: channelSpecs[c.channel].pinProvider ? m.provider : undefined,
    builtinSearch: m.builtinSearch && offersBuiltinSearch({ channel: c.channel, protocol }),
    effort: effortFor(m.effort, m.efforts) ?? m.effort,
    speeds,
    speed: speeds.includes(m.speed) ? m.speed : speeds.includes("default") ? "default" : (speeds[0] ?? "default"),
  };
}
export const settleProvider = (p: WriterProvider): WriterProvider => ({
  ...p,
  models: p.models.map((m) => settleWriter(p, m)),
});
/** A model's name as people see it: its own, or its model and provider, as in
 * `claude-opus-5-5[openrouter/anthropic]`. */
export const writerLabel = (p: Pick<Provider<unknown>, "name">, m: Pick<WriterModel, "name" | "model" | "provider">) =>
  m.name.trim() || `${m.model}[${p.name}${m.provider ? "/" + m.provider : ""}]`;

export const defaultWriter = (protocol: Protocol = "responses"): WriterModel => ({
  id: "gpt-6-astra",
  model: "gpt-6-astra",
  name: "",
  description: "",
  protocol,
  vision: true,
  tools: true,
  maxOutput: 32768,
  efforts: ["low", "medium", "high", "xhigh"],
  effort: "medium",
  speeds: protocolSpecs[protocol].speeds ? ["flex", "default", "fast"] : [],
  speed: "default",
  builtinSearch: protocolSpecs[protocol].builtinSearch,
  toolLimits: true,
  prices: { ...noTokens(), search: 0 },
  speedRates: {},
});
/** A run's request settings, for tests and anything that calls a model without a pick. */
export const defaultRole = (): Role => {
  const m = defaultWriter();
  return {
    channel: "api",
    baseUrl: endpointFor("api"),
    credential: "",
    protocol: m.protocol,
    model: m.model,
    effort: m.effort,
    toolLimits: m.toolLimits,
    efforts: m.efforts,
    speed: m.speed,
    vision: m.vision,
    tools: m.tools,
    maxOutput: m.maxOutput,
  };
};

// ---- Picture models

/** A picture model's connection, as a run paints with it. */
export interface ImageRole extends Connection {
  model: string;
}
/** What a picture model charges, in US dollars: per picture where it prices by the
 * picture, and per million tokens of each kind the Images API reports apart (text and
 * image input, image output and, on models that write some, text output), since each has
 * its own price; reference pictures are image input. */
export interface ImagePrices {
  image: number;
  textInput: number;
  imageInput: number;
  output: number;
  textOutput: number;
}
export interface ImageModel {
  id: string;
  model: string;
  name: string;
  description: string;
  prices: ImagePrices;
}
/** The token counts a picture model reports, split as they are priced. A provider that
 * does not split its input counts it all as text. */
export function imageTokensOf(usage: any) {
  const input = usage?.input_tokens ?? 0,
    output = usage?.output_tokens ?? 0;
  const image = usage?.input_tokens_details?.image_tokens ?? 0;
  return {
    input,
    output,
    textInput: usage?.input_tokens_details?.text_tokens ?? Math.max(0, input - image),
    imageInput: image,
    textOutput: usage?.output_tokens_details?.text_tokens ?? 0,
  };
}
export type ImageProvider = Provider<ImageModel>;
export const imageLabel = (p: Pick<Provider<unknown>, "name">, m: Pick<ImageModel, "name" | "model">) =>
  m.name.trim() || `${m.model}[${p.name}]`;
export const defaultImageModel = (): ImageModel => ({
  id: "gpt-image-2-5-sunburst",
  model: "gpt-image-2.5-sunburst",
  name: "",
  description: "",
  // gpt-image-2.5 at the official standard prices.
  prices: { image: 0, textInput: 5, imageInput: 8, output: 30, textOutput: 0 },
});

// ---- Search services

/** Web search services a run can call for a model, each by its own API (`modules/search`). */
export const searchProviders = ["deepseek", "tavily", "brave", "searxng"] as const;
export type SearchProvider = (typeof searchProviders)[number];
export interface SearchProviderSpec {
  /** Where it is served, for a service newly switched to it. */
  endpoint: string;
  /** Whether it needs an API key; a self-hosted one may not. */
  needsKey: boolean;
  /** Whether it reads pages itself, so a page read is paid for. */
  reads: boolean;
}
export const searchProviderSpecs: Record<SearchProvider, SearchProviderSpec> = {
  deepseek: { endpoint: "https://api.deepseek.com/v1/tools", needsKey: true, reads: true },
  tavily: { endpoint: "https://api.tavily.com", needsKey: true, reads: true },
  brave: { endpoint: "https://api.search.brave.com", needsKey: true, reads: false },
  searxng: { endpoint: "http://localhost:8888", needsKey: false, reads: false },
};
export interface SearchService {
  id: string;
  name: string;
  provider: SearchProvider;
  baseUrl: string;
  /** Its API key; a provider that needs none may leave it empty. */
  credential: string;
  /** What each query asked and each page it reads cost. */
  prices: { query: number; page: number };
}
/** Whether a search service can answer: it has a key, or needs none. */
export const searchReady = (s: Pick<SearchService, "provider" | "credential">) =>
  !searchProviderSpecs[s.provider].needsKey || !!s.credential;

// ---- Web choices

/** How a person wants a run to search, picked apart from the drawing model: not at all,
 * with whichever drawing model's own search (where that model offers one), or with a
 * search service, named by its id. */
export const OFF = "off",
  BUILTIN = "builtin";
export type Web = string;

// ---- The catalog

/** The models the whole app draws, searches and paints with, set by those who manage
 * models. Each part is configured and picked on its own. */
export interface ModelCatalog {
  writers: WriterProvider[];
  painters: ImageProvider[];
  searches: SearchService[];
  /** The only thing people pick: each label names a whole combination of drawing model,
   * effort, speed, search and picture model, set by those who manage models. */
  labels: ModelLabel[];
  /** The combination used while no label is configured, and the label anyone who has not
   * picked uses. */
  defaults: { writer: string; image: string; web: Web; label: string };
}
/** A combination of models under one name: people pick the name, never what is in it. */
export interface ModelLabel {
  id: string;
  name: string;
  description: string;
  writer: string;
  /** Absent: the drawing model's own default. */
  effort?: Effort;
  speed?: Speed;
  web: Web;
  image: string;
}

const slug = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const shortName = z.string().trim().min(1).max(60);
const writerModelObject = z.object({
  id: slug,
  model: z.string().min(1),
  name: z.string().max(80),
  description: z.string().max(200),
  protocol: z.enum(protocols),
  provider: z.string().trim().min(1).optional(),
  vision: z.boolean(),
  tools: z.boolean(),
  maxOutput: z.number().int().min(1024).max(1_000_000),
  efforts: z.array(z.enum(efforts)),
  effort: z.enum(efforts),
  speeds: z.array(z.enum(speeds)),
  speed: z.enum(speeds),
  builtinSearch: z.boolean(),
  // Catalogs saved before it was asked keep the request limits they always had.
  toolLimits: z.boolean().default(true),
  prices: z.object({ ...tokenPricesShape, search: money }),
  speedRates: z.partialRecord(z.enum(speeds), z.number().min(0).max(100)),
});
const providerShape = { ...connectionShape, id: slug, name: shortName };
export const writerProviderSchema = z
  .object({ ...providerShape, models: z.array(writerModelObject) })
  .transform(settleProvider);
const imageProviderSchema = z.object({
  ...providerShape,
  models: z.array(
    z.object({
      id: slug,
      model: z.string().min(1),
      name: z.string().max(80),
      description: z.string().max(200),
      prices: z.object({
        image: money,
        textInput: money,
        imageInput: money,
        output: money,
        textOutput: money,
      }),
    }),
  ),
});
const searchServiceSchema = z.object({
  id: slug.refine((id) => id !== OFF && id !== BUILTIN, { message: "搜索服务 ID 不能是 off 或 builtin" }),
  name: shortName,
  provider: z.enum(searchProviders),
  baseUrl: z.url(),
  credential: z.string(),
  prices: z.object({ query: money, page: money }),
});
const labelSchema = z.object({
  id: slug,
  name: shortName,
  description: z.string().max(200),
  writer: z.string(),
  effort: z.enum(efforts).optional(),
  speed: z.enum(speeds).optional(),
  web: z.string(),
  image: z.string(),
});
const unique = (ids: string[]) => new Set(ids).size === ids.length;
const knownWeb = (c: { searches: { id: string }[] }, web: Web) =>
  web === OFF || web === BUILTIN || c.searches.some((s) => s.id === web);
const modelIds = (list: Provider<{ id: string }>[]) => list.flatMap((p) => p.models.map((m) => m.id));
export const modelCatalogSchema = z
  .object({
    writers: z.array(writerProviderSchema),
    painters: z.array(imageProviderSchema),
    searches: z.array(searchServiceSchema),
    labels: z.array(labelSchema).default([]),
    defaults: z.object({ writer: z.string(), image: z.string(), web: z.string(), label: z.string().default("") }),
  })
  .refine((c) => modelIds(c.writers).length > 0, { message: "至少需要一个绘制模型" })
  .refine((c) => modelIds(c.painters).length > 0, { message: "至少需要一个生图模型" })
  .refine((c) => unique(c.writers.map((p) => p.id)), { message: "绘制供应商 ID 重复" })
  .refine((c) => unique(c.painters.map((p) => p.id)), { message: "生图供应商 ID 重复" })
  .refine((c) => unique(modelIds(c.writers)), { message: "模型 ID 重复" })
  .refine((c) => unique(modelIds(c.painters)), { message: "生图模型 ID 重复" })
  .refine((c) => unique(c.searches.map((s) => s.id)), { message: "搜索服务 ID 重复" })
  .refine((c) => modelIds(c.writers).includes(c.defaults.writer), { message: "默认模型不存在" })
  .refine((c) => modelIds(c.painters).includes(c.defaults.image), { message: "默认生图模型不存在" })
  .refine((c) => knownWeb(c, c.defaults.web), { message: "默认搜索方式不存在" })
  .refine((c) => unique(c.labels.map((l) => l.id)), { message: "档位 ID 重复" })
  .refine((c) => c.labels.every((l) => modelIds(c.writers).includes(l.writer)), { message: "档位的绘制模型不存在" })
  .refine((c) => c.labels.every((l) => modelIds(c.painters).includes(l.image)), { message: "档位的生图模型不存在" })
  .refine((c) => c.labels.every((l) => knownWeb(c, l.web)), { message: "档位的搜索方式不存在" })
  .refine((c) => !c.labels.length || c.labels.some((l) => l.id === c.defaults.label), { message: "默认档位不存在" });
export const defaultCatalog = (): ModelCatalog => {
  const writer = defaultWriter(),
    image = defaultImageModel();
  return {
    writers: [
      { id: "openai", name: "api", channel: "api", baseUrl: endpointFor("api"), credential: "", models: [writer] },
    ],
    painters: [
      { id: "openai-images", name: "api", channel: "api", baseUrl: endpointFor("api"), credential: "", models: [image] },
    ],
    searches: [],
    labels: [],
    defaults: { writer: writer.id, image: image.id, web: BUILTIN, label: "" },
  };
};
/** The labels people pick from: those configured, or while there are none, one made of
 * the default models. */
export function labelsOf(catalog: ModelCatalog): ModelLabel[] {
  if (catalog.labels.length) return catalog.labels;
  return [
    {
      id: "default",
      name: "默认",
      description: "",
      writer: catalog.defaults.writer,
      web: catalog.defaults.web,
      image: catalog.defaults.image,
    },
  ];
}

// ---- What each person picks

/** What each person keeps for themselves: their standing preferences and the label they
 * picked, which falls back to the default label when it is not set or gone. */
export interface UserSettings {
  preferences: string;
  label: string | null;
}
export const userSettingsSchema = z.object({
  preferences: z.string(),
  label: z.string().nullable(),
});
export const settingsChangeSchema = userSettingsSchema.partial();
export type SettingsChange = z.infer<typeof settingsChangeSchema>;
export const emptySettings = (): UserSettings => ({ preferences: "", label: null });
const entries = <M extends { id: string }>(list: Provider<M>[]) =>
  list.flatMap((provider) => provider.models.map((model) => ({ provider, model })));
/** The search a pick makes with a model: the one wanted if it is there, else none. */
export function webFor(
  writer: { channel: Channel; protocol: Protocol; builtinSearch: boolean },
  wanted: Web,
  searches: SearchService[],
): { mode: SearchMode; service?: SearchService } {
  if (wanted === BUILTIN)
    return writer.builtinSearch && offersBuiltinSearch(writer) ? { mode: "builtin" } : { mode: "off" };
  const service = searches.find((s) => s.id === wanted);
  return service && searchReady(service) ? { mode: "service", service } : { mode: "off" };
}
/** What a person draws, searches and paints with: what the label they picked holds, or
 * the default label's when they have not or it was taken away, settled against what the
 * model offers. */
export function picked(catalog: ModelCatalog, own: Pick<UserSettings, "label">) {
  const labels = labelsOf(catalog);
  const label =
    labels.find((l) => l.id === own.label) ??
    labels.find((l) => l.id === catalog.defaults.label) ??
    labels[0];
  const writers = entries(catalog.writers),
    painters = entries(catalog.painters);
  const w =
    writers.find((x) => x.model.id === label.writer) ??
    writers.find((x) => x.model.id === catalog.defaults.writer) ??
    writers[0];
  const p =
    painters.find((x) => x.model.id === label.image) ??
    painters.find((x) => x.model.id === catalog.defaults.image) ??
    painters[0];
  const m = w.model;
  const effort = effortFor(label.effort ?? m.effort, m.efforts) ?? m.effort;
  const speed = label.speed && m.speeds.includes(label.speed) ? label.speed : m.speed;
  const wanted = knownWeb(catalog, label.web) ? label.web : catalog.defaults.web;
  const search = webFor({ channel: w.provider.channel, ...m }, wanted, catalog.searches);
  return { label, writer: w, effort, speed, search, painter: p };
}

/** What a run's spending is priced at, fixed when it starts: the drawing model's tokens at
 * the picked speed, each search and page read the way it searched, and each picture. */
export interface RunPrices {
  author: TokenPrices;
  search: number;
  page: number;
  image: ImagePrices;
}
/** What a run cost, in US dollars, by service. */
export interface RunCost {
  author: number;
  search: number;
  image: number;
  /** The drawing model's attempts that failed, apart from `author` and within `total`. */
  failed: number;
  total: number;
}
/** The cost of what a run spent, at the prices it ran at. */
export function costOf(usage: RunUsage | undefined, prices: RunPrices | undefined): RunCost | undefined {
  if (!prices) return undefined;
  const u = usage ?? { input: 0, cached: 0, output: 0, reasoning: 0 };
  const a = prices.author;
  const tokens = (t: { input: number; cached: number; cacheWrite?: number; output: number }) => {
    const write = t.cacheWrite ?? 0,
      fresh = Math.max(0, t.input - t.cached - write);
    return (fresh * a.input + t.cached * a.cached + write * a.cacheWrite + t.output * a.output) / 1e6;
  };
  const author = tokens(u);
  const failed = u.failed ? tokens(u.failed) : 0;
  const search = (u.searches ?? 0) * prices.search + (u.pages ?? 0) * prices.page;
  const i = u.images;
  const p = prices.image;
  const image = i
    ? i.count * p.image +
      ((i.textInput ?? i.input - (i.imageInput ?? 0)) * p.textInput +
        (i.imageInput ?? 0) * p.imageInput +
        (i.output - (i.textOutput ?? 0)) * p.output +
        (i.textOutput ?? 0) * p.textOutput) /
        1e6
    : 0;
  return { author, search, image, failed, total: author + search + image + failed };
}

/** What one run is made with: the drawing model with the options picked, how it searches
 * and the picture model, each with the name it is shown by, and what it all costs. */
export interface Settings {
  /** The label picked, by name: all that people who do not manage models are shown. */
  label: string;
  author: Role;
  authorName: string;
  search: { mode: SearchMode; service?: SearchService };
  image: ImageRole;
  imageName: string;
  prices: RunPrices;
  preferences: string;
}
export function settingsFor(catalog: ModelCatalog, own: UserSettings): Settings {
  const { label, writer, effort, speed, search, painter } = picked(catalog, own);
  const { provider: p, model: m } = writer;
  const rate = m.speedRates[speed] ?? speedRates[speed];
  const scaled = (n: number) => n * rate;
  return {
    label: label.name,
    author: {
      channel: p.channel,
      baseUrl: p.baseUrl,
      credential: p.credential,
      ...(p.accountId ? { accountId: p.accountId } : {}),
      protocol: m.protocol,
      model: m.model,
      ...(m.provider ? { provider: m.provider } : {}),
      effort,
      toolLimits: m.toolLimits,
      efforts: m.efforts,
      speed,
      vision: m.vision,
      tools: m.tools,
      maxOutput: m.maxOutput,
    },
    authorName: writerLabel(p, m),
    search,
    image: {
      channel: painter.provider.channel,
      baseUrl: painter.provider.baseUrl,
      credential: painter.provider.credential,
      ...(painter.provider.accountId ? { accountId: painter.provider.accountId } : {}),
      model: painter.model.model,
    },
    imageName: imageLabel(painter.provider, painter.model),
    prices: {
      author: {
        input: scaled(m.prices.input),
        cached: scaled(m.prices.cached),
        cacheWrite: scaled(m.prices.cacheWrite),
        output: scaled(m.prices.output),
      },
      search:
        search.mode === "builtin" ? m.prices.search : search.mode === "service" ? search.service!.prices.query : 0,
      page: search.mode === "service" ? search.service!.prices.page : 0,
      image: painter.model.prices,
    },
    preferences: own.preferences,
  };
}

// ---- The picker everyone sees

/** A label as the picker shows it: its name and what it is for, nothing of what is in it. */
export interface LabelChoice {
  id: string;
  name: string;
  description: string;
  /** Whether its drawing model is connected and can call tools, so it can draw. */
  ready: boolean;
}
/** Everything a person may pick from, without models, credentials or prices. */
export interface ModelMenu {
  labels: LabelChoice[];
  chosen: { label: string };
}
export function menuFor(catalog: ModelCatalog, own: Pick<UserSettings, "label">): ModelMenu {
  const writers = entries(catalog.writers);
  return {
    labels: labelsOf(catalog).map((l) => {
      const w = writers.find((x) => x.model.id === l.writer);
      return {
        id: l.id,
        name: l.name,
        description: l.description,
        ready: !!w && !!w.provider.credential && w.model.tools,
      };
    }),
    chosen: { label: picked(catalog, own).label.id },
  };
}
