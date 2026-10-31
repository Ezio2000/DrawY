import { useEffect, useState, type ReactNode } from "react";
import { UserRound, PenTool, Image as ImageIcon } from "lucide-react";
import { Segmented, Switch, Spinner } from "@drawy/ui";
import type { Settings as Value } from "../../../modules/contracts/index.ts";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { Title } from "./Title.tsx";
import { useT } from "./i18n.tsx";

const channels = {
  api: { baseUrl: "https://api.openai.com/v1" },
  oauth: { baseUrl: "https://chatgpt.com/backend-api/codex" },
} as const;
const efforts = ["low", "medium", "high", "xhigh"] as const;
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
  const t = useT();
  const w = t.settings;
  const [tab, setTab] = useState<"preferences" | "author" | "image">(
    "preferences",
  );
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
            <Title name="settings" />
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
      for (const k of account)
        (next.image as Record<string, unknown>)[k] = next.author[k];
    set(next);
  };
  const connection = (key: "author" | "image") => (
    <>
      <Row label={w.channel}>
        <Segmented label={w.channel}>
          {(Object.keys(channels) as (keyof typeof channels)[]).map((c) => (
            <button
              key={c}
              aria-pressed={value[key].channel === c}
              onClick={() =>
                role(key, { channel: c, baseUrl: channels[c].baseUrl })
              }
            >
              {c === "api" ? "OpenAI API" : w.chatgpt}
            </button>
          ))}
        </Segmented>
      </Row>
      <Row label={w.baseUrl}>
        <input
          value={value[key].baseUrl}
          onChange={(e) => role(key, { baseUrl: e.target.value })}
        />
      </Row>
      <Row label={value[key].channel === "api" ? "API Key" : "OAuth Token"}>
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
  const tabs = [
    ["preferences", UserRound],
    ["author", PenTool],
    ["image", ImageIcon],
  ] as const;
  return (
    <div className={cx("page settings")}>
      <header className={cx("page-head")}>
        <h1>
          <Title name="settings" />
        </h1>
      </header>
      <div className={cx("settings-layout")}>
        <nav className={cx("settings-nav")}>
          {tabs.map(([k, Icon]) => (
            <button
              key={k}
              aria-current={tab === k || undefined}
              onClick={() => setTab(k)}
            >
              <Icon size={16} />
              {t.titles[k]}
            </button>
          ))}
        </nav>
        {tab === "preferences" && (
          <section>
            <Row label={w.longTerm} hint={w.longTermHint} wide>
              <textarea
                value={value.preferences}
                placeholder={w.longTermExample}
                onChange={(e) => {
                  D(false);
                  set({ ...value, preferences: e.target.value });
                }}
              />
            </Row>
          </section>
        )}
        {tab === "author" && (
          <section>
            {connection("author")}
            <Row label={w.model}>
              <input
                value={value.author.model}
                onChange={(e) => role("author", { model: e.target.value })}
              />
            </Row>
            <Row label={w.effort}>
              <Segmented label={w.effort}>
                {efforts.map((v) => (
                  <button
                    key={v}
                    aria-pressed={value.author.effort === v}
                    onClick={() => role("author", { effort: v })}
                  >
                    {w.efforts[v]}
                  </button>
                ))}
              </Segmented>
            </Row>
            <Row label={w.fast} hint={w.fastHint}>
              <Switch
                checked={value.author.fast}
                onChange={(fast) => role("author", { fast })}
              />
            </Row>
          </section>
        )}
        {tab === "image" && (
          <section>
            <Row label={w.shared}>
              <Switch
                checked={shared}
                onChange={(on) =>
                  role(
                    "image",
                    on
                      ? Object.fromEntries(
                          account.map((k) => [k, value.author[k]]),
                        )
                      : {},
                  )
                }
              />
            </Row>
            {!shared && connection("image")}
            <Row label={w.model}>
              <input
                value={value.image.model}
                onChange={(e) => role("image", { model: e.target.value })}
              />
            </Row>
          </section>
        )}
      </div>
      {(dirty || done || error) && (
        <div className={cx("savebar")} role="status">
          <span data-error={!!error || undefined}>
            {error || (dirty ? w.unsaved : w.saved)}
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
                {w.discard}
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
                {busy ? <Spinner size={14} /> : w.save}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
