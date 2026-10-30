import { generate, type Item } from "../models/index.ts";
import { REVIEWER } from "./prompt.ts";
import type { UserStore } from "../storage/index.ts";
import type { ReviewResult, Issue } from "../contracts/index.ts";
const tool = (
  name: string,
  description: string,
  properties: Item,
  required: string[],
) => ({
  type: "function",
  name,
  description,
  parameters: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
});
export async function review(
  store: UserStore,
  workId: string,
  changed: string[],
  request: string,
  refs: string[],
  signal: AbortSignal,
): Promise<ReviewResult> {
  const work = store.work(workId),
    origin = process.env.DRAWY_INTERNAL_URL || "http://127.0.0.1:8080",
    service = process.env.DRAWY_REVIEW_URL || "http://127.0.0.1:8091";
  const token = store.storage.session(store.userId);
  const ids = [
    ...new Set(
      changed.flatMap((id) => [
        id,
        ...(work.pages[id]?.parentId ? [work.pages[id].parentId!] : []),
        ...Object.values(work.pages)
          .filter((p) => p.parentId === id)
          .map((p) => p.id),
      ]),
    ),
  ].filter((id) => work.pages[id]?.html);
  const screenshots: ReviewResult["screenshots"] = [];
  try {
    const r = await fetch(service + "/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin,
        cookie: token,
        pages: ids.map((id) => ({
          id,
          url: `${origin}/api/works/${workId}/pages/${id}?revision=${work.revision}&review=1`,
          selectors: work.pages[id].checkSelectors,
        })),
      }),
      signal,
    });
    if (!r.ok) throw Error("截图失败: " + (await r.text()));
    const { shots } = (await r.json()) as {
      shots: {
        pageId: string;
        label: string;
        base64: string;
        errors: string[];
      }[];
    };
    if (!shots.length) throw Error("没有可检查的页面");
    const input: Item[] = [
      {
        role: "user",
        content: [
          { type: "input_text", text: request },
          ...refs.flatMap((assetId) => {
            const asset = store.asset(assetId);
            return [
              { type: "input_text", text: "User reference image" },
              {
                type: "input_image",
                image_url: `data:${asset.mediaType};base64,${store.bytes(assetId).toString("base64")}`,
              },
            ];
          }),
          ...shots.flatMap((s, i) => {
            screenshots.push(
              store.putAsset(
                Buffer.from(s.base64, "base64"),
                `review-${work.revision}-${s.pageId}-${i}`,
                "image/png",
                "review",
              ),
            );
            return [
              {
                type: "input_text",
                text: `Screenshot ${i}, page ${s.pageId}, ${s.label}, errors: ${s.errors.join("; ")}`,
              },
              {
                type: "input_image",
                image_url: "data:image/png;base64," + s.base64,
              },
            ];
          }),
        ],
      },
    ];
    const tools = [
      tool(
        "verdict",
        "Return concrete visual findings.",
        {
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                pageId: { type: "string" },
                area: { type: "string" },
                severity: { type: "string", enum: ["blocking", "minor"] },
                detail: { type: "string" },
              },
              required: ["pageId", "area", "severity", "detail"],
              additionalProperties: false,
            },
          },
        },
        ["issues"],
      ),
      tool(
        "crop",
        "Inspect a screenshot region at full resolution.",
        {
          screenshot: { type: "integer" },
          x: { type: "integer" },
          y: { type: "integer" },
          width: { type: "integer" },
          height: { type: "integer" },
        },
        ["screenshot", "x", "y", "width", "height"],
      ),
    ];
    for (let turn = 0; turn < 4; turn++) {
      const result = await generate(
        store.settings().reviewer,
        REVIEWER,
        input,
        tools,
        signal,
        () => {},
        8192,
      );
      input.push(...result.items);
      for (const call of result.items.filter(
        (i) => i.type === "function_call",
      )) {
        const args = JSON.parse(call.arguments);
        if (call.name === "verdict") {
          const issues: Issue[] = args.issues;
          for (const s of shots)
            for (const error of s.errors)
              issues.push({
                pageId: s.pageId,
                area: s.label,
                severity: "blocking",
                detail: error,
              });
          return {
            revision: work.revision,
            status: issues.some((i) => i.severity === "blocking")
              ? "issues"
              : "passed",
            issues,
            screenshots,
          };
        }
        if (call.name === "crop") {
          const s = shots[args.screenshot];
          if (!s) throw Error("截图编号不存在");
          const response = await fetch(service + "/crop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...args, base64: s.base64 }),
            signal,
          });
          if (!response.ok) throw Error("截图裁剪失败");
          const crop = (await response.json()) as { base64: string };
          input.push(
            {
              type: "function_call_output",
              call_id: call.call_id,
              output: "Crop follows.",
            },
            {
              role: "user",
              content: [
                {
                  type: "input_image",
                  image_url: "data:image/png;base64," + crop.base64,
                },
              ],
            },
          );
        }
      }
    }
    throw Error("视觉模型未提交检查结果");
  } catch (e) {
    signal.throwIfAborted();
    return {
      revision: work.revision,
      status: "failed",
      issues: [],
      screenshots,
      error: String(e),
    };
  } finally {
    store.storage.db.prepare("DELETE FROM sessions WHERE id=?").run(token);
  }
}
