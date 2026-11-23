import { afterEach, expect, it, vi } from "vitest";
import { costOf, defaultCatalog, emptySettings, menuFor, modelCatalogSchema, settingsFor, type Run } from "../contracts/index.ts";
import { selectSettings } from "./routing.ts";

const own = emptySettings();
function catalog() {
  const c = defaultCatalog();
  const p = c.writers[0];
  p.credential = "test-a";
  const m = p.models[0];
  m.model = "gpt-6.2-sol";
  m.id = "sol-a";
  c.defaults.writer = m.id;
  m.efforts = ["low", "medium"];
  m.effort = "medium";
  c.writers.push({ ...p, id: "other-account", credential: "test-b", models: [{ ...m, id: "other-sol" }] });
  c.defaults.web = "off";
  c.decision = {
    endpoint: "https://router.example/api/choose", credential: "decision-key", model: "decision-deployment",
    routes: [
      { writer: m.id, effort: "low", descriptions: ["Edit text in place."] },
      { writer: m.id, effort: "medium", descriptions: ["Organize supplied information."] },
      { writer: "other-sol", effort: "low", descriptions: ["Extend an existing diagram.", "Rearrange the layout."] },
    ],
  };
  const tier = { id: "regular", name: "Sol", description: "Editing", writer: m.id, image: c.defaults.image, web: "off" };
  c.labels = [tier];
  c.defaults.label = tier.id;
  return c;
}
const run = () => ({ id: "r", sceneId: "root" }) as Run;
const message = { role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AA==" }] };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("sends only the request and anonymous task choices and resolves either description of a combination locally", async () => {
  const c = catalog();
  const descriptions = c.decision.routes.flatMap((route) => route.descriptions);
  for (const description of c.decision.routes[2].descriptions) {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(c.decision.endpoint);
      expect(init.headers).toMatchObject({ Authorization: "Bearer decision-key" });
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("decision-deployment");
      expect(body.input).toEqual([message]);
      expect(body.questions).toHaveLength(1);
      const q = body.questions[0];
      expect(q.name).toBe("task");
      expect(q.choices.map((o: { description: string }) => o.description)).toEqual(descriptions);
      for (const o of q.choices) expect(o).toEqual({ value: expect.stringMatching(/^[a-f0-9]{24}$/), description: expect.any(String) });
      expect(init.body).not.toMatch(/test-a|test-b|decision-key|other-account|sol-a|gpt-6|effort|usdPerMillion|previous|tier/i);
      const choice = q.choices.find((o: { description: string }) => o.description === description).value;
      return Response.json({ answers: [{ type: "choice", name: "task", choice }],
        usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 300, cache_write_tokens: 200 } } });
    });
    vi.stubGlobal("fetch", fetch);
    const r = run(), settings = await selectSettings(c, own, r, message, new AbortController().signal);
    expect(fetch).toHaveBeenCalledOnce();
    expect(settings).toMatchObject({ label: "Auto", writerProviderId: "other-account", author: { credential: "test-b", effort: "low" } });
    expect(r.usage?.decision?.model).toBe("decision-deployment");
    expect(r.usage?.input).toBe(0);
    expect(costOf(r.usage, settings.prices)?.total).toBeCloseTo(0.000078, 9);
  }
});

it("bypasses Decisions for a manual pick, a sole non-adjustable model, or no ready candidates", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const c = catalog();
  const resolve = (label: string | null) => selectSettings(c, { ...own, label }, run(), message, new AbortController().signal);
  expect((await resolve("regular")).author.effort).toBe("medium");
  c.writers[1].credential = "";
  c.writers[0].models[0].efforts = [];
  c.decision.routes = [{ writer: "sol-a", descriptions: ["Edit text.", "Update colors."] }, c.decision.routes[2]];
  expect(modelCatalogSchema.safeParse(c).success).toBe(true);
  expect((await resolve(null)).label).toBe("Auto");
  c.decision.routes = [];
  expect((await resolve(null)).label).toBe(c.labels[0].name);
  expect(fetch).not.toHaveBeenCalled();
  expect(menuFor(c, { label: "removed" }).chosen.label).toBeNull();
});

it.each(["invalid", "refusal", "http", "timeout"])("uses the global default after %s even when it is outside Auto", async (failure) => {
  const c = catalog();
  c.labels[0].name = "Default only";
  const deadline = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => deadline(5));
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (failure === "timeout") return await new Promise<Response>((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
    if (failure === "http") return new Response("", { status: 503 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    return Response.json({ answers: [{ type: failure === "invalid" ? "choice" : "refusal", name: "task", choice: "regular/low" }] });
  });
  const s = await selectSettings(c, own, run(), message, new AbortController().signal);
  expect(s).toMatchObject({ label: "Default only", author: { effort: "medium" } });
  expect(timeout).toHaveBeenCalledWith(5000);
});

it("validates decision endpoints, candidate model IDs and their supported efforts", () => {
  const c = catalog(), route = c.decision.routes[0];
  const accepts = (patch: object) => modelCatalogSchema.safeParse({ ...c, decision: { ...c.decision, ...patch } }).success;
  expect(accepts({})).toBe(true);
  for (const change of [{ effort: "xhigh" }, { effort: undefined }, { writer: "missing" }, { descriptions: [] }, { descriptions: ["  "] }])
    expect(accepts({ routes: [{ ...route, ...change }] })).toBe(false);
  expect(accepts({ routes: [route, { ...route, descriptions: ["Another task"] }] })).toBe(false);
  expect(accepts({ routes: [route, { ...route, effort: "medium" }] })).toBe(false);
  expect(accepts({ endpoint: "not an HTTP endpoint" })).toBe(false);
});

it("runs a model outside every tier at its own speed with the site search and image defaults", async () => {
  const c = catalog();
  c.decision.routes = [c.decision.routes[2]];
  c.painters[0].models.push({ ...c.painters[0].models[0], id: "tier-image", model: "tier-image" });
  c.labels[0] = { ...c.labels[0], speed: "fast", web: "builtin", image: "tier-image" };
  const s = await selectSettings(c, own, run(), message, new AbortController().signal);
  expect(s).toMatchObject({
    label: "Auto", writerProviderId: "other-account", author: { effort: "low", speed: "default" },
    search: { mode: "off" }, image: { model: c.painters[0].models[0].model },
  });
  expect(settingsFor(c, { ...own, label: "regular" }).image.model).toBe("tier-image");
});
