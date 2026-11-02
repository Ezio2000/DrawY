/* The models DrawY draws, searches and paints with.
 *
 * What a connection, an API format or a search provider offers is said once, in the
 * specs below. The schema settles a model against them, the server and the run read them,
 * and the settings page shows only the controls they allow; so adding a connection, a
 * format or a provider is adding an entry here (and its adapter, and its words), and
 * nothing that reads them changes. */
import { z } from "zod";

// ---- Effort

/** How hard a model thinks. Providers name their own levels; each model lists the ones it
 * accepts, and a run asks for the nearest. */
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
/** The highest level a model accepts, if it lists any. */
export const topEffort = (accepted: readonly Effort[]): Effort | undefined =>
  accepted.length
    ? accepted.reduce((a, b) => (efforts.indexOf(b) > efforts.indexOf(a) ? b : a))
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
  /** Where its own provider serves it, for a model newly switched to it. */
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

// ---- Connections

/** How a model is reached: with an API key, or with a ChatGPT account's token. */
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
    speeds: ["flex", "default", "fast"],
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
const endpoints = new Set<string>([
  ...channels.flatMap((c) => channelSpecs[c].endpoint ?? []),
  ...protocols.map((p) => protocolSpecs[p].endpoint),
]);
/** The speed a channel can serve: the one asked for if the channel has it, otherwise
 * default, which every channel has. */
export const speedFor = (channel: Channel, speed: Speed): Speed =>
  channelSpecs[channel].speeds.includes(speed) ? speed : "default";
/** The speeds a model may be set to: its connection's, when its format takes one. */
export const speedsOf = (r: { channel: Channel; protocol: Protocol }): readonly Speed[] =>
  protocolSpecs[r.protocol].speeds ? channelSpecs[r.channel].speeds : [];

/** How a model is reached, shared by drawing and picture models. */
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
/** A connection changed by hand. One moved to another channel or format follows it to its
 * address, unless the address was set by hand for the same channel. */
export function reconnect<T extends Connection & { protocol?: Protocol }>(
  before: T,
  patch: Partial<T>,
): T {
  const next = { ...before, ...patch };
  const channel = next.channel !== before.channel,
    format = next.protocol !== before.protocol;
  if (patch.baseUrl === undefined && (channel || (format && endpoints.has(before.baseUrl))))
    next.baseUrl = endpointFor(next.channel, next.protocol);
  return next;
}

// ---- Drawing models

export interface Role extends Connection {
  protocol: Protocol;
  model: string;
  /** Optional OpenRouter provider slug; when set, only this provider may serve requests. */
  provider?: string;
  effort: Effort;
  /** Use the configured effort on deciding turns instead of automatically raising it. */
  decisionUsesSetting: boolean;
  /** The reasoning levels it accepts; none means it is not asked for one. */
  efforts: Effort[];
  speed: Speed;
  /** Whether it can be shown pictures: screenshots, references and library thumbnails. */
  vision: boolean;
  /** Whether it can call tools, without which it cannot draw at all. */
  tools: boolean;
  /** Whether the provider runs a web search of its own for it. */
  builtinSearch: boolean;
  /** How it searches unless the user picks otherwise. */
  search: SearchMode;
  /** The most tokens one of its answers may hold; providers reject a larger ask. */
  maxOutput: number;
}
/** Whether a model's connection and format offer the provider's own web search. */
export const offersBuiltinSearch = (r: Pick<Role, "channel" | "protocol">) =>
  channelSpecs[r.channel].builtinSearch && protocolSpecs[r.protocol].builtinSearch;
/** Whether a model searches with its provider's own search when asked to. */
export const canSearchBuiltin = (r: Pick<Role, "channel" | "protocol" | "builtinSearch">) =>
  r.builtinSearch && offersBuiltinSearch(r);
/** The provider a request is pinned to, as the request names it, if the connection allows. */
export const pinnedProvider = (r: Pick<Role, "channel" | "provider">) =>
  r.provider && channelSpecs[r.channel].pinProvider
    ? { provider: { only: [r.provider], allow_fallbacks: false } }
    : {};
/** A model as its connection lets it be: a format the channel does not speak falls back
 * to one it does, a built-in search it cannot offer is not claimed (and not defaulted
 * to), and the effort and speed kept are ones the model and channel accept. */
export function settleRole<T extends Role>(r: T): T {
  const offered = channelSpecs[r.channel].protocols;
  const protocol = offered.includes(r.protocol) ? r.protocol : offered[0];
  const builtinSearch = r.builtinSearch && offersBuiltinSearch({ channel: r.channel, protocol });
  return {
    ...r,
    protocol,
    builtinSearch,
    search: r.search === "builtin" && !builtinSearch ? "off" : r.search,
    effort: effortFor(r.effort, r.efforts) ?? r.effort,
    speed: speedFor(r.channel, r.speed),
  };
}
export const defaultRole = (): Role => ({
  channel: "api",
  protocol: "responses",
  baseUrl: endpointFor("api", "responses"),
  credential: "",
  model: "gpt-6-astra",
  effort: "medium",
  decisionUsesSetting: false,
  efforts: ["low", "medium", "high", "xhigh"],
  speed: "default",
  vision: true,
  tools: true,
  builtinSearch: true,
  search: "builtin",
  maxOutput: 32768,
});
const roleObject = z.object({
  ...connectionShape,
  protocol: z.enum(protocols),
  model: z.string().min(1),
  provider: z.string().trim().min(1).optional(),
  effort: z.enum(efforts),
  decisionUsesSetting: z.boolean().default(false),
  efforts: z.array(z.enum(efforts)),
  speed: z.enum(speeds),
  vision: z.boolean(),
  tools: z.boolean(),
  builtinSearch: z.boolean(),
  search: z.enum(searchModes),
  maxOutput: z.number().int().min(1024).max(1_000_000),
});
export const roleSchema = roleObject.transform(settleRole);

// ---- Picture models

/** A picture model's connection. */
export interface ImageRole extends Connection {
  model: string;
}
export const defaultImage = (): ImageRole => ({
  channel: "api",
  baseUrl: endpointFor("api"),
  credential: "",
  model: "gpt-image-2.5-sunburst",
});
const imageRoleObject = z.object({ ...connectionShape, model: z.string().min(1) });

// ---- Search services

/** Web search services a run can call for a model, each by its own API (`modules/search`). */
export const searchProviders = ["deepseek", "tavily", "brave", "searxng"] as const;
export type SearchProvider = (typeof searchProviders)[number];
export interface SearchProviderSpec {
  /** Where it is served, for a service newly switched to it. */
  endpoint: string;
  /** Whether it needs an API key; a self-hosted one may not. */
  needsKey: boolean;
}
export const searchProviderSpecs: Record<SearchProvider, SearchProviderSpec> = {
  deepseek: { endpoint: "https://api.deepseek.com/v1/tools", needsKey: true },
  tavily: { endpoint: "https://api.tavily.com", needsKey: true },
  brave: { endpoint: "https://api.search.brave.com", needsKey: true },
  searxng: { endpoint: "http://localhost:8888", needsKey: false },
};
export interface SearchService {
  id: string;
  name: string;
  provider: SearchProvider;
  baseUrl: string;
  /** Its API key; a provider that needs none may leave it empty. */
  credential: string;
}
/** Whether a search service can answer: it has a key, or needs none. */
export const searchReady = (s: Pick<SearchService, "provider" | "credential">) =>
  !searchProviderSpecs[s.provider].needsKey || !!s.credential;
/** The search a run makes with a model: the one wanted if it is there, else none. */
export function searchFor(
  model: Pick<Role, "channel" | "protocol" | "builtinSearch">,
  wanted: SearchMode,
  service: SearchService | undefined,
): SearchMode {
  if (wanted === "builtin") return canSearchBuiltin(model) ? "builtin" : "off";
  if (wanted === "service") return service && searchReady(service) ? "service" : "off";
  return "off";
}

// ---- The catalog

/** What an administrator connects is picked by name and described in a line; only those
 * who manage models see the rest. */
interface Named {
  id: string;
  name: string;
  description: string;
}
/** A drawing model an administrator has connected, with the parameters every request to
 * it uses. */
export interface ModelOption extends Role, Named {}
/** A picture model an administrator has connected. */
export interface ImageOption extends ImageRole, Named {}
/** The models the whole app draws, searches and paints with, set by those who manage
 * models. Each part is chosen on its own, so any drawing model goes with any picture
 * model and search service. */
export interface ModelCatalog {
  models: ModelOption[];
  /** The model used by whoever has not picked one. */
  default: string;
  images: ImageOption[];
  defaultImage: string;
  searches: SearchService[];
  /** The search service used by whoever has not picked one, if there is any. */
  defaultSearch: string | null;
}
/** The three parts of a catalog, each a list with a default. Drawing and picture models
 * must have one; search services may have none. */
export const catalogParts = {
  models: { default: "default", required: true },
  images: { default: "defaultImage", required: true },
  searches: { default: "defaultSearch", required: false },
} as const satisfies Record<string, { default: keyof ModelCatalog; required: boolean }>;
export type CatalogPart = keyof typeof catalogParts;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const naming = {
  id: slug,
  name: z.string().trim().min(1).max(60),
  description: z.string().max(200),
};
export const modelOptionSchema = roleObject.extend(naming).transform(settleRole);
const imageOptionSchema = imageRoleObject.extend(naming);
const searchServiceSchema = z.object({
  id: slug,
  name: naming.name,
  provider: z.enum(searchProviders),
  baseUrl: z.url(),
  credential: z.string(),
});
const unique = (list: { id: string }[]) => new Set(list.map((m) => m.id)).size === list.length;
const defaulted = (list: { id: string }[], id: string | null, required: boolean) =>
  id === null ? !required && !list.length : list.some((m) => m.id === id);
/** A catalog saved before pictures and search had settings of their own: one picture
 * model, and every model searching as its connection allowed. */
export function normalizeCatalog(raw: any): ModelCatalog {
  const base = defaultRole();
  const models = (raw?.models ?? []).map((m: any) => {
    const role = { ...base, ...m };
    if (m.builtinSearch === undefined) role.builtinSearch = offersBuiltinSearch(role);
    if (m.search === undefined) role.search = role.builtinSearch ? "builtin" : "off";
    return role;
  });
  const images: ImageOption[] = raw?.images ?? [
    {
      id: "default",
      name: (raw?.image ?? defaultImage()).model,
      description: "",
      ...defaultImage(),
      ...raw?.image,
    },
  ];
  const searches: SearchService[] = raw?.searches ?? [];
  return {
    models,
    default: raw?.default ?? models[0]?.id,
    images,
    defaultImage: raw?.defaultImage ?? images[0].id,
    searches,
    defaultSearch: raw?.defaultSearch ?? searches[0]?.id ?? null,
  };
}
export const modelCatalogSchema = z.preprocess(
  normalizeCatalog,
  z
    .object({
      models: z.array(modelOptionSchema).min(1),
      default: z.string(),
      images: z.array(imageOptionSchema).min(1),
      defaultImage: z.string(),
      searches: z.array(searchServiceSchema),
      defaultSearch: z.string().nullable(),
    })
    .refine((c) => unique(c.models), { message: "模型 ID 重复" })
    .refine((c) => defaulted(c.models, c.default, true), { message: "默认模型不存在" })
    .refine((c) => unique(c.images), { message: "生图模型 ID 重复" })
    .refine((c) => defaulted(c.images, c.defaultImage, true), { message: "默认生图模型不存在" })
    .refine((c) => unique(c.searches), { message: "搜索服务 ID 重复" })
    .refine((c) => defaulted(c.searches, c.defaultSearch, false), {
      message: "默认搜索服务不存在",
    }),
);
export const defaultCatalog = (): ModelCatalog => {
  const author = defaultRole(),
    image = defaultImage();
  return {
    models: [{ id: "default", name: author.model, description: "", ...author }],
    default: "default",
    images: [{ id: "default", name: image.model, description: "", ...image }],
    defaultImage: "default",
    searches: [],
    defaultSearch: null,
  };
};

// ---- What each person picks

/** What each person keeps for themselves: their standing preferences, and the drawing
 * model, picture model and search service they picked, each falling back to the default
 * when it is gone; and how they want each drawing model to search. */
export interface UserSettings {
  preferences: string;
  model: string | null;
  image: string | null;
  searchService: string | null;
  searchModes: Record<string, SearchMode>;
}
export const userSettingsSchema = z.object({
  preferences: z.string(),
  model: z.string().nullable(),
  image: z.string().nullable(),
  searchService: z.string().nullable(),
  searchModes: z.record(z.string(), z.enum(searchModes)),
});
const pick = <T extends { id: string }>(list: T[], id: string | null, fallback: string | null) =>
  list.find((m) => m.id === id) ?? list.find((m) => m.id === fallback) ?? list[0];
/** What a person draws, paints and searches with: what they picked, or the default when
 * they have not or it was taken away; and how that model searches for them, if it can. */
export function picked(catalog: ModelCatalog, own: UserSettings) {
  const model = pick(catalog.models, own.model, catalog.default);
  const service = pick(catalog.searches, own.searchService, catalog.defaultSearch) as
    | SearchService
    | undefined;
  return {
    model,
    image: pick(catalog.images, own.image, catalog.defaultImage),
    service,
    search: searchFor(model, own.searchModes[model.id] ?? model.search, service),
  };
}
/** What one run is made with: the drawing model, how it searches and the picture model,
 * each with the name it is shown by. */
export interface Settings {
  author: Role;
  authorName: string;
  search: { mode: SearchMode; service?: SearchService };
  image: ImageRole;
  imageName: string;
  preferences: string;
}
export function settingsFor(catalog: ModelCatalog, own: UserSettings): Settings {
  const { model, image, service, search } = picked(catalog, own);
  const { id: _, name: authorName, description: __, ...author } = model;
  const { id: ___, name: imageName, description: ____, ...painter } = image;
  return {
    author,
    authorName,
    search: search === "service" ? { mode: search, service } : { mode: search },
    image: painter,
    imageName,
    preferences: own.preferences,
  };
}

// ---- The picker everyone sees

/** A drawing model as the model picker shows it, with what it can do. */
export interface ModelChoice {
  id: string;
  name: string;
  description: string;
  /** The model it calls, and the provider's address it calls it at. */
  model: string;
  host: string;
  /** Whether it is connected (has a credential) and can call tools, so it can draw. */
  ready: boolean;
  vision: boolean;
  tools: boolean;
  builtinSearch: boolean;
  /** How it searches for this user: their pick for it, or its default. */
  search: SearchMode;
}
export interface ServiceChoice {
  id: string;
  name: string;
  description: string;
  /** What it is: the picture model, or the search provider. */
  detail: string;
  ready: boolean;
}
/** Everything a person may pick from, without credentials or parameters, and what they
 * have picked. */
export interface ModelMenu {
  models: ModelChoice[];
  default: string;
  chosen: string;
  images: ServiceChoice[];
  image: string;
  searches: ServiceChoice[];
  search: string | null;
}
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
export function menuFor(catalog: ModelCatalog, own: UserSettings): ModelMenu {
  const { model, image, service } = picked(catalog, own);
  return {
    models: catalog.models.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      model: m.model,
      host: host(m.baseUrl),
      ready: !!m.credential && m.tools,
      vision: m.vision,
      tools: m.tools,
      builtinSearch: canSearchBuiltin(m),
      search: searchFor(m, own.searchModes[m.id] ?? m.search, service),
    })),
    default: catalog.default,
    chosen: model.id,
    images: catalog.images.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      detail: m.model,
      ready: !!m.credential,
    })),
    image: image.id,
    searches: catalog.searches.map((s) => ({
      id: s.id,
      name: s.name,
      description: "",
      detail: s.provider,
      ready: searchReady(s),
    })),
    search: service?.id ?? null,
  };
}
