import { it, expect } from "vitest";
import {
  defaultCatalog,
  defaultRole,
  endpointFor,
  menuFor,
  modelCatalogSchema,
  reconnect,
  roleSchema,
  searchReady,
  settingsFor,
  settleRole,
  speedsOf,
  type UserSettings,
} from "./index.ts";

const own: UserSettings = {
  preferences: "",
  model: null,
  image: null,
  searchService: null,
  searchModes: {},
};

it("settles a model to what its connection and format offer", () => {
  // A ChatGPT account speaks only the Responses API, has no built-in search, and its own speeds.
  expect(
    settleRole({ ...defaultRole(), channel: "oauth", protocol: "anthropic", speed: "flex" }),
  ).toMatchObject({ protocol: "responses", builtinSearch: false, search: "off", speed: "default" });
  // Chat Completions has no built-in search; Messages does.
  expect(roleSchema.parse({ ...defaultRole(), protocol: "chat" })).toMatchObject({
    builtinSearch: false,
    search: "off",
  });
  expect(roleSchema.parse({ ...defaultRole(), protocol: "anthropic" })).toMatchObject({
    builtinSearch: true,
    search: "builtin",
  });
  // The effort kept is one the model accepts.
  expect(settleRole({ ...defaultRole(), effort: "max", efforts: ["low", "high"] }).effort).toBe(
    "high",
  );
  // Only the Responses API takes a speed.
  expect(speedsOf({ channel: "api", protocol: "responses" })).toEqual(["flex", "default", "fast"]);
  expect(speedsOf({ channel: "api", protocol: "anthropic" })).toEqual([]);
});

it("moves a connection to the address of its new channel or format, unless set by hand", () => {
  const role = defaultRole();
  expect(reconnect(role, { protocol: "anthropic" }).baseUrl).toBe("https://api.anthropic.com");
  expect(reconnect(role, { channel: "oauth" }).baseUrl).toBe(endpointFor("oauth"));
  const custom = { ...role, baseUrl: "https://openrouter.ai/api/v1" };
  expect(reconnect(custom, { protocol: "chat" }).baseUrl).toBe(custom.baseUrl);
  expect(reconnect(custom, { channel: "oauth" }).baseUrl).toBe(endpointFor("oauth"));
  expect(reconnect(role, { protocol: "chat", baseUrl: "https://x.invalid" }).baseUrl).toBe(
    "https://x.invalid",
  );
});

it("picks what a person chose, or the defaults when it is gone", () => {
  const catalog = modelCatalogSchema.parse({
    ...defaultCatalog(),
    models: [
      { ...defaultCatalog().models[0], credential: "k" },
      { ...defaultCatalog().models[0], id: "ds", name: "DeepSeek", protocol: "chat" },
    ],
    searches: [
      { id: "s", name: "SearXNG", provider: "searxng", baseUrl: "http://localhost:8888", credential: "" },
    ],
    defaultSearch: "s",
  });
  const mine = { ...own, model: "ds", searchModes: { ds: "service" as const } };
  expect(settingsFor(catalog, mine)).toMatchObject({
    authorName: "DeepSeek",
    search: { mode: "service", service: { id: "s" } },
  });
  // A model taken away falls back to the default, which searches its own way.
  expect(settingsFor(catalog, { ...own, model: "gone" })).toMatchObject({
    authorName: "gpt-6-astra",
    search: { mode: "builtin" },
  });
  const menu = menuFor(catalog, mine);
  expect(menu).toMatchObject({ chosen: "ds", image: "default", search: "s" });
  expect(menu.models.map((m) => [m.id, m.ready, m.builtinSearch, m.search])).toEqual([
    ["default", true, true, "builtin"],
    ["ds", false, false, "service"],
  ]);
  expect(JSON.stringify(menu)).not.toContain('"k"');
  // A self-hosted SearXNG needs no key; the others do.
  expect(searchReady({ provider: "searxng", credential: "" })).toBe(true);
  expect(searchReady({ provider: "tavily", credential: "" })).toBe(false);
});
