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
  expect(speedsOf({ channel: "api", protocol: "responses" })).toEqual(["flex", "default", "fast"]);
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

it("picks each of the five on its own, settled against what the model offers", () => {
  const c = catalog();
  // The defaults: the default model at its own effort and speed, its own search.
  expect(settingsFor(c, emptySettings())).toMatchObject({
    author: { model: "gpt-6.1-terra", effort: "medium", speed: "default", credential: "k" },
    authorName: "gpt-6.1-terra[api]",
    search: { mode: "builtin" },
  });
  // A pick of each.
  const mine = { ...emptySettings(), writer: "terra", effort: "max" as const, speed: "fast" as const, web: "s" };
  expect(settingsFor(c, mine)).toMatchObject({
    author: { effort: "max", speed: "fast" },
    search: { mode: "service", service: { id: "s" } },
  });
  // The same picks on a model that offers less: the nearest effort, its own speed, and its
  // missing search means none, while the wanted search is kept for the next model.
  const opus = { ...mine, writer: "opus", web: "builtin" };
  expect(settingsFor(c, opus)).toMatchObject({
    author: { protocol: "chat", effort: "xhigh", speed: "default", provider: "anthropic" },
    search: { mode: "off" },
  });
  expect(menuFor(c, opus).chosen).toMatchObject({ writer: "opus", web: "builtin", search: "off" });
  // A model taken away falls back to the default.
  expect(settingsFor(c, { ...emptySettings(), writer: "gone" }).authorName).toBe("gpt-6.1-terra[api]");
  const menu = menuFor(c, mine);
  expect(menu.writers.map((m) => [m.id, m.name, m.provider, m.ready, m.builtinSearch])).toEqual([
    ["terra", "gpt-6.1-terra[api]", "api", true, true],
    ["terra-oauth", "gpt-6.1-terra[oauth]", "oauth", true, false],
    ["opus", "claude-opus-5-5[openrouter/anthropic]", "openrouter", false, false],
  ]);
  expect(menu.chosen).toEqual({ writer: "terra", effort: "max", speed: "fast", web: "s", search: "service", image: c.defaults.image });
  // Nobody but those who manage models sees credentials or prices.
  expect(JSON.stringify(menu)).not.toMatch(/"k"|prices/);
  // A self-hosted SearXNG needs no key; the others do.
  expect(searchReady({ provider: "searxng", credential: "" })).toBe(true);
  expect(searchReady({ provider: "tavily", credential: "" })).toBe(false);
});

it("prices a run at the speed it picked, the way it searched and the pictures it painted", () => {
  const c = catalog();
  const fast = settingsFor(c, { ...emptySettings(), speed: "fast", web: "s" });
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
  expect(settingsFor(c, emptySettings()).prices).toMatchObject({ search: 0.01, page: 0 });
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
