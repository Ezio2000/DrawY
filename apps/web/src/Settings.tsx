import { useEffect, useState, type ReactNode } from "react";
import { Segmented, Switch, Spinner } from "@drawy/ui";
import type { Settings as Value } from "../../../modules/contracts/index.ts";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { Lettering } from "./Lettering.tsx";

const channels = {
  api: { label: "OpenAI API", baseUrl: "https://api.openai.com/v1" },
  oauth: {
    label: "ChatGPT 账号",
    baseUrl: "https://chatgpt.com/backend-api/codex",
  },
} as const;
const efforts = { low: "低", medium: "中", high: "高", xhigh: "极高" } as const;
const account = ["channel", "baseUrl", "credential", "accountId"] as const;

/** One setting: what it is and why it matters on the left, its control on the right. */
function Row({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cx("setting")} data-wide={wide || undefined}>
      <div>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** The user's standing preferences and the models that draw and paint for them. */
export function Settings() {
  const [saved, setSaved] = useState<Value>(),
    [value, set] = useState<Value>(),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [done, D] = useState(false);
  useEffect(() => {
    api<Value>("/settings").then(
      (v) => {
        setSaved(v);
        set(v);
      },
      (e) => E(e.message),
    );
  }, []);
  if (!value)
    return (
      <div className={cx("page")}>
        <header className={cx("page-head")}>
          <h1>
            <Lettering name="settings" height={64} />
          </h1>
        </header>
        {error ? <p className={cx("error")}>{error}</p> : <Spinner />}
      </div>
    );
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const shared = account.every((k) => value.image[k] === value.author[k]);
  const role = <K extends "author" | "image">(
    key: K,
    patch: Partial<Value[K]>,
  ) => {
    D(false);
    const next = { ...value, [key]: { ...value[key], ...patch } };
    // While the image model shares the account, it follows every change to it.
    if (key === "author" && shared)
      for (const k of account) (next.image as Record<string, unknown>)[k] = next.author[k];
    set(next);
  };
  const connection = (key: "author" | "image") => (
    <>
      <Row label="接入方式">
        <Segmented label="接入方式">
          {(Object.keys(channels) as (keyof typeof channels)[]).map((c) => (
            <button
              key={c}
              aria-pressed={value[key].channel === c}
              onClick={() =>
                role(key, { channel: c, baseUrl: channels[c].baseUrl })
              }
            >
              {channels[c].label}
            </button>
          ))}
        </Segmented>
      </Row>
      <Row label="服务地址">
        <input
          value={value[key].baseUrl}
          onChange={(e) => role(key, { baseUrl: e.target.value })}
        />
      </Row>
      <Row
        label={value[key].channel === "api" ? "API Key" : "OAuth Token"}
        hint={
          value[key].channel === "api"
            ? "在 OpenAI 平台创建的密钥"
            : "ChatGPT 登录后得到的访问令牌"
        }
      >
        <input
          className={cx("mono")}
          value={value[key].credential}
          spellCheck={false}
          onChange={(e) => role(key, { credential: e.target.value })}
        />
      </Row>
      {value[key].channel === "oauth" && (
        <Row label="Account ID">
          <input
            className={cx("mono")}
            value={value[key].accountId || ""}
            spellCheck={false}
            onChange={(e) => role(key, { accountId: e.target.value })}
          />
        </Row>
      )}
    </>
  );
  return (
    <div className={cx("page settings")}>
      <header className={cx("page-head")}>
        <h1>
          <Lettering name="settings" height={64} />
        </h1>
      </header>
      <section>
        <h2>
          <Lettering name="preferences" height={36} />
        </h2>
        <Row
          label="长期偏好"
          hint="每次创作都会参考，比如你是谁、常给谁看、喜欢或不要的画风。"
          wide
        >
          <textarea
            value={value.preferences}
            placeholder="例如：我是初中物理老师，图要严谨、标注清楚，不要卡通人物。"
            onChange={(e) => {
              D(false);
              set({ ...value, preferences: e.target.value });
            }}
          />
        </Row>
      </section>
      <section>
        <h2>
          <Lettering name="author" height={36} />
        </h2>
        <p className={cx("section-note")}>理解你的想法、构图并写出画面的模型。</p>
        {connection("author")}
        <Row label="模型">
          <input
            value={value.author.model}
            onChange={(e) => role("author", { model: e.target.value })}
          />
        </Row>
        <Row label="思考强度" hint="越高越周到，也越慢">
          <Segmented label="思考强度">
            {(Object.keys(efforts) as (keyof typeof efforts)[]).map((v) => (
              <button
                key={v}
                aria-pressed={value.author.effort === v}
                onClick={() => role("author", { effort: v })}
              >
                {efforts[v]}
              </button>
            ))}
          </Segmented>
        </Row>
        <Row label="Fast" hint="优先处理，额度消耗更高">
          <Switch
            checked={value.author.fast}
            onChange={(fast) => role("author", { fast })}
          />
        </Row>
      </section>
      <section>
        <h2>
          <Lettering name="image" height={36} />
        </h2>
        <p className={cx("section-note")}>为作品画出插图、人物和场景的模型。</p>
        <Row label="与绘制模型共用账号">
          <Switch
            checked={shared}
            onChange={(on) =>
              role(
                "image",
                on
                  ? Object.fromEntries(account.map((k) => [k, value.author[k]]))
                  : {},
              )
            }
          />
        </Row>
        {!shared && connection("image")}
        <Row label="模型">
          <input
            value={value.image.model}
            onChange={(e) => role("image", { model: e.target.value })}
          />
        </Row>
      </section>
      {(dirty || done || error) && (
        <div className={cx("savebar")} role="status">
          <span data-error={!!error || undefined}>
            {error || (dirty ? "有未保存的更改" : "已保存")}
          </span>
          {dirty && (
            <>
              <button
                className={cx("secondary small")}
                onClick={() => {
                  set(saved);
                  E("");
                }}
              >
                放弃
              </button>
              <button
                className={cx("primary small")}
                disabled={busy}
                onClick={async () => {
                  B(true);
                  E("");
                  try {
                    await api("/settings", "PUT", value);
                    setSaved(value);
                    D(true);
                  } catch (e) {
                    E(e instanceof Error ? e.message : String(e));
                  } finally {
                    B(false);
                  }
                }}
              >
                {busy ? <Spinner size={14} /> : "保存"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
