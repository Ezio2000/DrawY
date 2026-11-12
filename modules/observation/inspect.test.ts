import { it, expect, vi, afterEach } from "vitest";
import { fixture } from "../runtime/fixture.ts";
import { inspect, INSPECT_MODEL } from "./inspect.ts";
import type { Shot } from "./capture.ts";
import type { Work } from "../contracts/index.ts";
afterEach(() => vi.unstubAllGlobals());

/** The root scene with three links: two from the top level, one along the bottom. */
function linked(): Work {
  const work = fixture();
  const link = (id: string, from: string, to: string) => ({
    id,
    drawingId: "arrow",
    from: { moduleId: from },
    to: { moduleId: to },
    data: {},
  });
  work.scenes.root.links = [
    link("l-down", "level-0", "level-1"),
    link("l-far", "level-0", "level-4"),
    link("l-low", "level-3", "level-4"),
  ];
  return work;
}
/** The opening view of the root scene at scale 1, its figure filling 760 × 700 pixels. */
const shot = (work: Work): Shot => ({
  camera: { x: 0, y: 0, scale: 1 },
  modules: work.scenes.root.modules.map((m) => ({ id: m.id, bounds: m.bounds })),
  text: { small: [], clipped: [], words: { "level-0": "顶层", "l-far": "跳过" } },
  sceneId: "root",
  label: "全图",
  overview: true,
  viewport: { width: 1296, height: 828 },
  base64: "d2hvbGU=",
  plain: {
    base64: "cGxhaW4=",
    frame: { x: 0, y: 0, width: 760, height: 700 },
    quarters: [
      { base64: "cTE=", frame: { x: 0, y: 0, width: 437, height: 403 } },
      { base64: "cTI=", frame: { x: 323, y: 0, width: 437, height: 403 } },
      { base64: "cTM=", frame: { x: 0, y: 297, width: 437, height: 403 } },
      { base64: "cTQ=", frame: { x: 323, y: 297, width: 437, height: 403 } },
    ],
  },
  errors: [],
});
type Asked = { model: string; state: [string, { image_url: { url: string } }]; questions: Record<string, any> };
/** A decision service that answers each picture by what it shows. */
function serve(answer: (asked: Asked) => Record<string, unknown>) {
  const asked: Asked[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
      const body = JSON.parse(String(init.body)) as Asked;
      asked.push(body);
      return Response.json({ answers: answer(body), usage: { input_tokens: 1200, cost: 0.0002 } });
    }),
  );
  return asked;
}
const noul = (noul: number) => ({ type: "noul", noul });
const choice = (probabilities: Record<string, number>) => ({ type: "choice", probabilities });
const image = (a: Asked) => a.state[1].image_url.url;

it("asks about a clean picture once, with no link questions where it has no links", async () => {
  const work = fixture();
  const asked = serve(() => ({
    has_text_pierce: noul(0.1),
    has_text_overlap: noul(0.2),
    culprit_module: choice({ "level-0": 0.9, heading: 0.1 }),
  }));
  const found = await inspect({ credential: "key" }, work, shot(work), new AbortController().signal);
  expect(found).toEqual({ calls: 1, cost: 0.0002 });
  expect(asked).toHaveLength(1);
  expect(asked[0].model).toBe(INSPECT_MODEL);
  // The plain crop is what is shown, not the screenshot with the paper's dots.
  expect(image(asked[0])).toBe("data:image/png;base64,cGxhaW4=");
  expect(Object.keys(asked[0].questions)).toEqual(["has_text_pierce", "has_text_overlap", "culprit_module"]);
  // Parts are named by the words they draw, those with words first.
  const criteria = asked[0].questions.culprit_module.criteria;
  expect(Object.entries(criteria)[0]).toEqual(["level-0", "顶层"]);
  expect(criteria.heading).toBe("标题");
  expect(Object.keys(criteria)).toHaveLength(7);
});

it("names every part given a real share when a fault is clear, links by their ends", async () => {
  const work = linked();
  const asked = serve(() => ({
    has_text_pierce: noul(0.81),
    has_text_overlap: noul(0.1),
    has_line_merge: noul(0.55),
    culprit_module: choice({ "level-1": 0.5, "level-2": 0.3, heading: 0.12, "level-3": 0.08 }),
    culprit_link: choice({ "l-far": 0.2, "l-down": 0.7, "l-low": 0.1 }),
  }));
  const found = await inspect({ credential: "key" }, work, shot(work), new AbortController().signal);
  expect(asked).toHaveLength(1);
  expect(asked[0].questions.culprit_link.criteria).toEqual({
    "l-down": "顶层 -> 尊重需求",
    "l-far": "顶层 -> 生理需求 ('跳过')",
    "l-low": "安全需求 -> 生理需求",
  });
  expect(found!.defects).toEqual({
    faults: ["text_pierce", "line_merge"],
    modules: ["level-1", "level-2"],
    links: ["l-down", "l-far"],
  });
});

it("looks again by quarters at a doubt, asking each only about the parts it shows", async () => {
  const work = linked();
  const asked = serve((a) => {
    // Two links run together low on the right, too thin to tell in the whole picture.
    const url = image(a);
    if (url.endsWith("cGxhaW4="))
      return { has_text_pierce: noul(0.2), has_text_overlap: noul(0.1), has_line_merge: noul(0.42) };
    if (url.endsWith("cTQ="))
      return {
        has_text_pierce: noul(0.1),
        has_text_overlap: noul(0.1),
        has_line_merge: noul(0.61),
        culprit_module: choice({ "level-4": 0.6, "level-3": 0.4 }),
        culprit_link: choice({ "l-low": 0.8, "l-far": 0.2 }),
      };
    return { has_text_pierce: noul(0.1), has_text_overlap: noul(0.1), has_line_merge: noul(0.2) };
  });
  const found = await inspect({ credential: "key" }, work, shot(work), new AbortController().signal);
  expect(asked).toHaveLength(5);
  const fourth = asked.find((a) => image(a).endsWith("cTQ="))!;
  // The heading at the top left is not in the bottom right quarter.
  expect(Object.keys(fourth.questions.culprit_module.criteria)).not.toContain("heading");
  expect(found).toEqual({
    calls: 5,
    cost: expect.closeTo(0.001),
    defects: { faults: ["line_merge"], modules: ["level-4", "level-3"], links: ["l-low", "l-far"] },
  });
});

it("leaves a failed check out of the look", async () => {
  const work = fixture();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
  expect(await inspect({ credential: "key" }, work, shot(work), new AbortController().signal)).toBeUndefined();
  const { plain, ...unchecked } = shot(work);
  expect(await inspect({ credential: "key" }, work, unchecked, new AbortController().signal)).toBeUndefined();
});
