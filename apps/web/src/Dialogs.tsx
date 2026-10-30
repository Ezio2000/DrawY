import { useState, useEffect } from "react";
import { Dialog, Switch } from "@drawy/ui";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import type { Settings, Asset } from "../../../modules/contracts/index.ts";
export function SettingsDialog({ close }: { close: () => void }) {
  const [value, set] = useState<Settings>();
  const [error, E] = useState("");
  useEffect(() => {
    api("/settings")
      .then(set)
      .catch((e) => E(e.message));
  }, []);
  return (
    <Dialog
      title="模型设置"
      onClose={close}
      wide
      footer={
        <button
          className={cx("primary")}
          onClick={async () => {
            try {
              await api("/settings", "PUT", value);
              close();
            } catch (e) {
              E(String(e));
            }
          }}
        >
          保存
        </button>
      }
    >
      <div className={cx("drawy-settings")}>
        {value &&
          (["author", "reviewer", "image"] as const).map((key) => (
            <fieldset key={key}>
              <legend>
                {
                  { author: "绘制", reviewer: "视觉检查", image: "图片生成" }[
                    key
                  ]
                }
              </legend>
              <label>
                接入方式
                <select
                  value={value[key].channel}
                  onChange={(e) => {
                    const channel = e.target.value as "api" | "oauth";
                    set({
                      ...value,
                      [key]: {
                        ...value[key],
                        channel,
                        baseUrl:
                          channel === "api"
                            ? "https://api.openai.com/v1"
                            : "https://chatgpt.com/backend-api/codex",
                      },
                    });
                  }}
                >
                  <option value="api">OpenAI API</option>
                  <option value="oauth">ChatGPT OAuth</option>
                </select>
              </label>
              {(["baseUrl", "model", "credential", "accountId"] as const).map(
                (field) => (
                  <label key={field}>
                    {
                      {
                        baseUrl: "服务地址",
                        model: "模型",
                        credential: "API Key / OAuth Token",
                        accountId: "ChatGPT Account ID",
                      }[field]
                    }
                    <input
                      value={value[key][field] || ""}
                      onChange={(e) =>
                        set({
                          ...value,
                          [key]: { ...value[key], [field]: e.target.value },
                        })
                      }
                    />
                  </label>
                ),
              )}
              {key !== "image" && (
                <label>
                  思考强度
                  <select
                    value={value[key].effort}
                    onChange={(e) =>
                      set({
                        ...value,
                        [key]: { ...value[key], effort: e.target.value },
                      })
                    }
                  >
                    {["low", "medium", "high", "xhigh"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              )}
              {key !== "image" && (
                <label className={cx("drawy-fast")}>
                  <span>
                    Fast<small>优先处理，额度消耗更高</small>
                  </span>
                  <Switch
                    checked={value[key].fast}
                    onChange={(fast) =>
                      set({
                        ...value,
                        [key]: { ...value[key], fast },
                      })
                    }
                  />
                </label>
              )}
              {key !== "author" && (
                <button
                  className={cx("secondary")}
                  onClick={() =>
                    set({
                      ...value,
                      [key]: {
                        ...value[key],
                        channel: value.author.channel,
                        credential: value.author.credential,
                        accountId: value.author.accountId,
                        baseUrl: value.author.baseUrl,
                      },
                    })
                  }
                >
                  使用绘制账号
                </button>
              )}
            </fieldset>
          ))}
        {value && (
          <label>
            长期偏好
            <textarea
              value={value.preferences}
              onChange={(e) => set({ ...value, preferences: e.target.value })}
            />
          </label>
        )}
        <p className={cx("error")}>{error}</p>
      </div>
    </Dialog>
  );
}
export function MaterialsDialog({
  close,
  pick,
}: {
  close: () => void;
  pick: (m: { id: string; url: string; name: string; kind: string }) => void;
}) {
  const [q, Q] = useState(""),
    [items, I] = useState<any[]>([]),
    [error, E] = useState("");
  useEffect(() => {
    const a = new AbortController();
    fetch("/api/materials?q=" + encodeURIComponent(q), { signal: a.signal })
      .then((r) => r.json())
      .then(I)
      .catch((e) => {
        if (!a.signal.aborted) E(e.message);
      });
    return () => a.abort();
  }, [q]);
  return (
    <Dialog title="素材" wide onClose={close}>
      <input
        className={cx("rail-search")}
        placeholder="搜索公共与个人素材"
        value={q}
        onChange={(e) => Q(e.target.value)}
      />
      <label className={cx("secondary")}>
        上传图片
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              const data = new FormData();
              data.append("file", file);
              try {
                const a = await api<Asset>("/assets", "POST", data);
                pick({ ...a, kind: "personal" });
                close();
              } catch (e) {
                E(String(e));
              }
            }
          }}
        />
      </label>
      <p className={cx("error")}>{error}</p>
      <div className={cx("drawy-materials")}>
        {items.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              pick(m);
              close();
            }}
          >
            <img src={m.url} alt="" />
            <span>{m.name}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
export function HistoryDialog({
  id,
  close,
  restore,
}: {
  id: string;
  close: () => void;
  restore: (revision: number) => void;
}) {
  const [rows, R] = useState<{ revision: number; updatedAt: number }[]>([]);
  useEffect(() => {
    void api("/works/" + id + "/revisions").then(R);
  }, [id]);
  return (
    <Dialog title="版本历史" onClose={close}>
      <div className={cx("drawy-history")}>
        {rows.map((r) => (
          <button key={r.revision} onClick={() => restore(r.revision)}>
            <span>版本 {r.revision}</span>
            <small>{new Date(r.updatedAt).toLocaleString()}</small>
            <b>恢复</b>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
