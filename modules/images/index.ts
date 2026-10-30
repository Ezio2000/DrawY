import { headers } from "../models/index.ts";
import type { UserStore } from "../storage/index.ts";
export async function generateImage(
  store: UserStore,
  args: {
    prompt: string;
    references?: string[];
    size?: string;
    quality?: string;
    background?: string;
  },
  signal: AbortSignal,
) {
  const role = store.settings().image;
  if (!role.credential) throw Error("请在模型设置中配置生图凭证");
  const refs = (args.references || []).map((assetId) => ({
    asset: store.asset(assetId),
    bytes: store.bytes(assetId),
  }));
  const params = {
    model: role.model,
    prompt: args.prompt,
    n: 1,
    size: args.size || "auto",
    quality: args.quality || "auto",
    background: args.background || "auto",
  };
  let body: BodyInit;
  const h: Record<string, string> = headers(role);
  if (refs.length && role.channel === "api") {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.append(k, String(v));
    for (const { asset, bytes } of refs)
      form.append(
        "image[]",
        new Blob([new Uint8Array(bytes)], { type: asset.mediaType }),
        asset.name,
      );
    body = form;
    delete h["Content-Type"];
  } else
    body = JSON.stringify({
      ...params,
      ...(refs.length
        ? {
            images: refs.map(({ asset, bytes }) => ({
              image_url: `data:${asset.mediaType};base64,${bytes.toString("base64")}`,
            })),
          }
        : {}),
    });
  if (role.channel === "oauth")
    h["x-codex-image-turn-id"] = crypto.randomUUID();
  const r = await fetch(
    role.baseUrl.replace(/\/$/, "") +
      "/images/" +
      (refs.length ? "edits" : "generations"),
    { method: "POST", headers: h, body, signal },
  );
  if (!r.ok) throw Error(`生图失败 ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as {
    data: { b64_json: string; generation_id?: string }[];
  };
  return data.data.map((d) =>
    store.putAsset(
      Buffer.from(d.b64_json, "base64"),
      args.prompt.slice(0, 80),
      "image/png",
      "generated",
      d.generation_id,
    ),
  );
}
