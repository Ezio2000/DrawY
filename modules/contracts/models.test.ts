import { it, expect } from "vitest";
import {
  costOf,
  imageTokensOf,
  defaultCatalog,
  defaultWriter,
  emptySettings,
  menuFor,
  modelCatalogSchema,
  reconnect,
  endpointFor,
  searchReady,
  settingsFor,
  settleWriter,
  speedsOf,
  writerLabel,
  type ModelCatalog,
} from "./index.ts";

/** A catalog with an API provider, a ChatGPT account and an OpenRouter account, a picture
 * model and a search service. */
function catalog(): ModelCatalog {
  const base = defaultCatalog();
  return modelCatalogSchema.parse({
    ...base,
    writers: [
      {
        ...base.writers[0],
        credential: "k",
        models: [
          {
            ...defaultWriter(),
            id: "terra",
            model: "gpt-6.1-terra",
            efforts: ["low", "medium", "high", "max"],
            prices: { input: 2, cached: 0.5, cacheWrite: 0, output: 10, search: 0.01 },
            speedRates: { fast: 2 },
          },
        ],
      },
      {
        id: "chatgpt",
        name: "oauth",
        channel: "oauth",
        baseUrl: endpointFor("oauth"),
        credential: "t",
        models: [{ ...defaultWriter(), id: "terra-oauth", model: "gpt-6.1-terra", speeds: ["flex", "default", "fast", "ultrafast"] }],
      },
      {
        id: "openrouter",
        name: "openrouter",
        channel: "api",
        baseUrl: "https://openrouter.ai/api/v1",
        credential: "",
        models: [
          {
            ...defaultWriter("chat"),
            id: "opus",
            model: "claude-opus-5-5",
            provider: "anthropic",
            // Chat Completions has no search of its own, whatever is claimed.
            builtinSearch: true,
          },
        ],
      },
    ],
    painters: [{ ...base.painters[0], credential: "k", models: [{ ...base.painters[0].models[0], prices: { image: 0.04, textInput: 5, imageInput: 8, output: 30, textOutput: 10 } }] }],
    searches: [
      { id: "s", name: "SearXNG", provider: "searxng", baseUrl: "http://localhost:8888", credential: "", prices: { query: 0.002, page: 0 } },
    ],
    defaults: { writer: "terra", image: base.painters[0].models[0].id, web: "builtin" },
  });
}

it("settles a model to what its provider's connection and format offer", () => {
  // A ChatGPT account speaks only the Responses API, has no built-in search, and its own speeds.
  const oauth = settleWriter({ channel: "oauth" }, { ...defaultWriter("anthropic"), speeds: ["flex", "default", "fast"], speed: "flex" });
  expect(oauth).toMatchObject({ protocol: "responses", builtinSearch: false, speeds: ["default", "fast"], speed: "default" });
  const c = catalog();
  expect(c.writers[2].models[0]).toMatchObject({ builtinSearch: false, provider: "anthropic" });
  expect(c.writers[1].models[0].speeds).toEqual(["default", "fast", "ultrafast"]);
  // The effort kept is one the model offers.
  expect(settleWriter({ channel: "api" }, { ...defaultWriter(), effort: "max", efforts: ["low", "high"] }).effort).toBe("high");
  // Only the Responses API takes a speed.
  expect(speedsOf({ channel: "api", protocol: "responses" })).toEqual(["flex", "default", "fast", "ultrafast"]);
  expect(speedsOf({ channel: "api", protocol: "anthropic" })).toEqual([]);
});

it("names a model after its model and provider unless it has a name of its own", () => {
  const c = catalog();
  expect(writerLabel(c.writers[0], c.writers[0].models[0])).toBe("gpt-6.1-terra[api]");
  expect(writerLabel(c.writers[1], c.writers[1].models[0])).toBe("gpt-6.1-terra[oauth]");
  expect(writerLabel(c.writers[2], c.writers[2].models[0])).toBe("claude-opus-5-5[openrouter/anthropic]");
  expect(writerLabel(c.writers[2], { ...c.writers[2].models[0], name: "Opus" })).toBe("Opus");
});

it("moves a provider to the address of its new channel, unless set by hand", () => {
  const p = defaultCatalog().writers[0];
  expect(reconnect(p, { channel: "oauth" }).baseUrl).toBe(endpointFor("oauth"));
  expect(reconnect<typeof p>({ ...p, channel: "oauth" }, { channel: "api" }, "anthropic").baseUrl).toBe("https://api.anthropic.com");
  expect(reconnect(p, { channel: "oauth", baseUrl: "https://x.invalid" }).baseUrl).toBe("https://x.invalid");
});

it("refuses a catalog whose defaults or ids do not hold", () => {
  const c = catalog();
  expect(modelCatalogSchema.safeParse({ ...c, defaults: { ...c.defaults, writer: "gone" } }).success).toBe(false);
  expect(modelCatalogSchema.safeParse({ ...c, defaults: { ...c.defaults, web: "nothing" } }).success).toBe(false);
  expect(
    modelCatalogSchema.safeParse({ ...c, writers: [...c.writers, { ...c.writers[0], id: "again" }] }).success,
  ).toBe(false);
  expect(
    modelCatalogSchema.safeParse({ ...c, searches: [{ ...c.searches[0], id: "builtin" }] }).success,
  ).toBe(false);
});

/** The catalog with two labels: a fast one on terra with a search service, and a careful
 * one on the unconnected opus with the model's own search. */
function labelled(): ModelCatalog {
  const c = catalog();
  return modelCatalogSchema.parse({
    ...c,
    labels: [
      { id: "fast", name: "快速", description: "Quick sketches", writer: "terra", effort: "max", speed: "fast", web: "s", image: c.defaults.image },
      { id: "careful", name: "精细", description: "", writer: "opus", effort: "high", web: "builtin", image: c.defaults.image },
    ],
    defaults: { ...c.defaults, label: "fast" },
  });
}

it("draws with the default models while no label is configured", () => {
  const c = catalog();
  expect(settingsFor(c, emptySettings())).toMatchObject({
    label: "默认",
    author: { model: "gpt-6.1-terra", effort: c.writers[0].models[0].effort, credential: "k" },
    authorName: "gpt-6.1-terra[api]",
    search: { mode: "builtin" },
  });
  expect(menuFor(c, emptySettings())).toEqual({
    labels: [{ id: "default", name: "默认", description: "", ready: true }],
    chosen: { label: "default" },
  });
});

it("picks a label, never the models in it, settled against what the model offers", () => {
  const c = labelled();
  // Nobody has picked: the default label.
  expect(settingsFor(c, emptySettings())).toMatchObject({
    label: "快速",
    author: { model: "gpt-6.1-terra", effort: "max", speed: "fast" },
    search: { mode: "service", service: { id: "s" } },
    prices: { search: 0.002 },
  });
  // The careful label's model has no search of its own on Chat Completions, so it does not
  // search; it offers no speeds, so the model's own is used.
  const careful = { ...emptySettings(), label: "careful" };
  expect(settingsFor(c, careful)).toMatchObject({
    label: "精细",
    author: { protocol: "chat", effort: "high", speed: "default", provider: "anthropic" },
    search: { mode: "off" },
  });
  // A label taken away falls back to the default one.
  expect(settingsFor(c, { ...emptySettings(), label: "gone" }).label).toBe("快速");
  const menu = menuFor(c, careful);
  expect(menu).toEqual({
    labels: [
      { id: "fast", name: "快速", description: "Quick sketches", ready: true },
      { id: "careful", name: "精细", description: "", ready: false },
    ],
    chosen: { label: "careful" },
  });
  // People see neither models, credentials nor prices.
  expect(JSON.stringify(menu)).not.toMatch(/"k"|prices|terra|opus|claude/);
  // A self-hosted SearXNG needs no key; the others do.
  expect(searchReady({ provider: "searxng", credential: "" })).toBe(true);
  expect(searchReady({ provider: "tavily", credential: "" })).toBe(false);
});

it("refuses labels naming models, searches or a default that are not there", () => {
  const c = labelled();
  const label = c.labels[0];
  for (const broken of [
    { ...label, writer: "gone" },
    { ...label, image: "gone" },
    { ...label, web: "nowhere" },
  ])
    expect(modelCatalogSchema.safeParse({ ...c, labels: [broken] }).success).toBe(false);
  expect(modelCatalogSchema.safeParse({ ...c, labels: [label, label] }).success).toBe(false);
  expect(modelCatalogSchema.safeParse({ ...c, defaults: { ...c.defaults, label: "gone" } }).success).toBe(false);
});

it("prices a run at the speed it picked, the way it searched and the pictures it painted", () => {
  const fast = settingsFor(labelled(), emptySettings());
  expect(fast.prices).toEqual({
    author: { input: 4, cached: 1, cacheWrite: 0, output: 20 },
    search: 0.002,
    page: 0,
    image: { image: 0.04, textInput: 5, imageInput: 8, output: 30, textOutput: 10 },
  });
  const cost = costOf(
    {
      input: 1_000_000,
      cached: 400_000,
      output: 100_000,
      reasoning: 50_000,
      searches: 5,
      pages: 2,
      images: { count: 2, input: 3000, output: 10_000, textInput: 1000, imageInput: 2000, textOutput: 500 },
    },
    fast.prices,
  )!;
  expect(cost.author).toBeCloseTo(0.6 * 4 + 0.4 * 1 + 0.1 * 20);
  expect(cost.search).toBeCloseTo(0.01);
  // Text and image input, image and text output, each at its own price.
  expect(cost.image).toBeCloseTo(0.08 + (1000 * 5 + 2000 * 8 + 9500 * 30 + 500 * 10) / 1e6);
  expect(cost.total).toBeCloseTo(cost.author + cost.search + cost.image);
  // Claude's cache writes are priced on their own.
  expect(
    costOf(
      { input: 1_000_000, cached: 0, cacheWrite: 1_000_000, output: 0, reasoning: 0 },
      { ...fast.prices, author: { input: 1, cached: 0.1, cacheWrite: 1.25, output: 5 } },
    )!.author,
  ).toBeCloseTo(1.25);
  // The model's own search is priced by the call.
  expect(settingsFor(catalog(), emptySettings()).prices).toMatchObject({ search: 0.01, page: 0 });
  expect(costOf(undefined, undefined)).toBeUndefined();
});

it("splits a picture model's tokens as they are priced, so a style reference costs image input", () => {
  const prices = { image: 0, textInput: 5, imageInput: 8, output: 30, textOutput: 0 };
  const run = (usage: object) => {
    const t = imageTokensOf(usage);
    return costOf(
      { input: 0, cached: 0, output: 0, reasoning: 0, images: { count: 1, ...t } },
      { author: { input: 0, cached: 0, cacheWrite: 0, output: 0 }, search: 0, page: 0, image: prices },
    )!.image;
  };
  // As the Images API reports a picture painted with one style reference.
  const withReference = {
    input_tokens: 1300,
    input_tokens_details: { text_tokens: 100, image_tokens: 1200 },
    output_tokens: 4000,
  };
  expect(imageTokensOf(withReference)).toEqual({ input: 1300, output: 4000, textInput: 100, imageInput: 1200, textOutput: 0 });
  expect(run(withReference)).toBeCloseTo((100 * 5 + 1200 * 8 + 4000 * 30) / 1e6);
  // A provider that does not split its input is counted as text.
  expect(imageTokensOf({ input_tokens: 50, output_tokens: 10 })).toMatchObject({ textInput: 50, imageInput: 0 });
});
