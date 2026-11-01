import { useContext, useEffect, useState, type ReactNode } from "react";
import {
  UserRound,
  PenTool,
  Image as ImageIcon,
  Users,
  ShieldCheck,
  Plus,
  Trash2,
} from "lucide-react";
import { Segmented, Switch, Spinner, pageLocale } from "@drawy/ui";
import {
  permissions,
  speeds,
  speedFor,
  type Account,
  type AccountRole,
  type ModelCatalog,
  type ModelOption,
  type UserSettings,
} from "../../../modules/contracts/index.ts";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { Title } from "./Title.tsx";
import { useT, dictionaries } from "./i18n.tsx";
import { AccountContext, useCan } from "./account.tsx";

const channels = {
  api: { baseUrl: "https://api.openai.com/v1" },
  oauth: { baseUrl: "https://chatgpt.com/backend-api/codex" },
} as const;
const efforts = ["low", "medium", "high", "xhigh"] as const;
const account = ["channel", "baseUrl", "credential", "accountId"] as const;
type Connection = Pick<ModelOption, (typeof account)[number]>;
/** Settings changed and not yet saved, which leaving the page would lose. */
let unsaved = false;
/** Whether the page may be left: always, unless settings are unsaved and the user would
 * rather stay. */
export const leaving = () =>
  !unsaved || confirm(dictionaries[pageLocale()].settings.leave);

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

/** The image model shares the default drawing model's account when every part of the
 * connection is the same. */
const sharing = (c: ModelCatalog) => {
  const model = c.models.find((m) => m.id === c.default) ?? c.models[0];
  return account.every((k) => c.image[k] === model[k]);
};

type Tab = "preferences" | "author" | "image" | "accounts" | "roles";

/** The user's standing preferences; and, for those whose role allows it, the models
 * everyone draws and paints with, and the accounts and their roles. */
export function Settings() {
  const t = useT(),
    can = useCan();
  const w = t.settings;
  const models = can("models.manage"),
    accounts = can("accounts.manage");
  const [tab, setTab] = useState<Tab>("preferences");
  const [saved, setSaved] = useState<{
      own: UserSettings;
      catalog?: ModelCatalog;
    }>(),
    [value, set] = useState<typeof saved>(),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [done, D] = useState(false),
    // The image model uses its own account rather than the default drawing model's.
    [separate, setSeparate] = useState(false),
    // The drawing model being edited.
    [editing, setEditing] = useState<string>();
  useEffect(() => {
    void Promise.all([
      api<UserSettings>("/settings"),
      models ? api<ModelCatalog>("/admin/models") : undefined,
    ]).then(
      ([own, catalog]) => {
        const v = { own, catalog };
        setSaved(v);
        set(v);
        if (catalog) {
          setSeparate(!sharing(catalog));
          setEditing(catalog.default);
        }
      },
      (e) => E(e.message),
    );
  }, [models]);
  const dirty = !!value && JSON.stringify(value) !== JSON.stringify(saved);
  useEffect(() => {
    unsaved = dirty;
    const stay = (e: BeforeUnloadEvent) => dirty && e.preventDefault();
    addEventListener("beforeunload", stay);
    return () => {
      unsaved = false;
      removeEventListener("beforeunload", stay);
    };
  }, [dirty]);
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
  const catalog = value.catalog;
  const shared = !separate;
  const change = (catalog: ModelCatalog) => {
    D(false);
    set({ ...value, catalog });
  };
  /** Changes one drawing model; while the image model shares the default one's
   * account, it follows every change to it. */
  const model = (id: string, patch: Partial<ModelOption>) => {
    if (!catalog) return;
    const next = {
      ...catalog,
      models: catalog.models.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    };
    if (shared && id === catalog.default) {
      const chosen = next.models.find((m) => m.id === id)!;
      next.image = {
        ...next.image,
        ...Object.fromEntries(account.map((k) => [k, chosen[k]])),
      };
    }
    change(next);
  };
  const image = (patch: Partial<ModelCatalog["image"]>) =>
    catalog && change({ ...catalog, image: { ...catalog.image, ...patch } });
  const connection = (
    of: Connection,
    patch: (p: Partial<ModelOption>) => void,
    withSpeed: boolean,
    speed?: ModelOption["speed"],
  ) => (
    <>
      <Row label={w.channel}>
        <Segmented label={w.channel}>
          {(Object.keys(channels) as (keyof typeof channels)[]).map((c) => (
            <button
              key={c}
              aria-pressed={of.channel === c}
              onClick={() =>
                patch({
                  channel: c,
                  baseUrl: channels[c].baseUrl,
                  // Each connection offers its own speeds; one it lacks falls back.
                  ...(withSpeed && speed ? { speed: speedFor(c, speed) } : {}),
                })
              }
            >
              {c === "api" ? "OpenAI API" : w.chatgpt}
            </button>
          ))}
        </Segmented>
      </Row>
      <Row label={w.baseUrl}>
        <input
          value={of.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value })}
        />
      </Row>
      <Row label={of.channel === "api" ? "API Key" : "OAuth Token"}>
        <input
          className={cx("mono")}
          value={of.credential}
          spellCheck={false}
          onChange={(e) => patch({ credential: e.target.value })}
        />
      </Row>
      {of.channel === "oauth" && (
        <Row label="Account ID">
          <input
            className={cx("mono")}
            value={of.accountId || ""}
            spellCheck={false}
            onChange={(e) => patch({ accountId: e.target.value })}
          />
        </Row>
      )}
    </>
  );
  const tabs = (
    [
      ["preferences", UserRound, true],
      ["author", PenTool, models],
      ["image", ImageIcon, models],
      ["accounts", Users, accounts],
      ["roles", ShieldCheck, accounts],
    ] as const
  ).filter(([, , shown]) => shown);
  const current = catalog?.models.find((m) => m.id === editing);
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
                value={value.own.preferences}
                placeholder={w.longTermExample}
                onChange={(e) => {
                  D(false);
                  set({
                    ...value,
                    own: { ...value.own, preferences: e.target.value },
                  });
                }}
              />
            </Row>
          </section>
        )}
        {tab === "author" && catalog && (
          <section>
            <div
              className={cx("model-list")}
              role="tablist"
              aria-label={w.models}
            >
              {catalog.models.map((m) => (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={m.id === editing}
                  onClick={() => setEditing(m.id)}
                >
                  <span>{m.name}</span>
                  {m.id === catalog.default && <small>{w.isDefault}</small>}
                </button>
              ))}
              <button
                className={cx("model-add")}
                onClick={() => {
                  const base =
                    catalog.models.find((m) => m.id === catalog.default) ??
                    catalog.models[0];
                  const id = "m-" + crypto.randomUUID().slice(0, 8);
                  // A new model starts from the default one's connection, so adding
                  // another model of the same account takes only its name.
                  change({
                    ...catalog,
                    models: [
                      ...catalog.models,
                      { ...base, id, name: w.newModel, description: "" },
                    ],
                  });
                  setEditing(id);
                }}
              >
                <Plus size={15} />
                {w.addModel}
              </button>
            </div>
            {current && (
              <>
                <Row label={w.modelName} hint={w.modelNameHint}>
                  <input
                    value={current.name}
                    onChange={(e) =>
                      model(current.id, { name: e.target.value })
                    }
                  />
                </Row>
                <Row label={w.description} hint={w.descriptionHint}>
                  <input
                    value={current.description}
                    placeholder={w.descriptionExample}
                    onChange={(e) =>
                      model(current.id, { description: e.target.value })
                    }
                  />
                </Row>
                <Row label={w.isDefault} hint={w.isDefaultHint}>
                  <Switch
                    checked={current.id === catalog.default}
                    disabled={current.id === catalog.default}
                    onChange={() => {
                      const next = { ...catalog, default: current.id };
                      // The image model keeps sharing whichever model is the default.
                      if (shared)
                        next.image = {
                          ...next.image,
                          ...Object.fromEntries(
                            account.map((k) => [k, current[k]]),
                          ),
                        };
                      change(next);
                    }}
                  />
                </Row>
                {connection(
                  current,
                  (p) => model(current.id, p),
                  true,
                  current.speed,
                )}
                <Row label={w.model}>
                  <input
                    className={cx("mono")}
                    value={current.model}
                    onChange={(e) =>
                      model(current.id, { model: e.target.value })
                    }
                  />
                </Row>
                <Row label={w.effort}>
                  <Segmented label={w.effort}>
                    {efforts.map((v) => (
                      <button
                        key={v}
                        aria-pressed={current.effort === v}
                        onClick={() => model(current.id, { effort: v })}
                      >
                        {w.efforts[v]}
                      </button>
                    ))}
                  </Segmented>
                </Row>
                <Row label={w.speed} hint={w.speedHints[current.speed]}>
                  <Segmented label={w.speed}>
                    {speeds[current.channel].map((v) => (
                      <button
                        key={v}
                        aria-pressed={current.speed === v}
                        onClick={() => model(current.id, { speed: v })}
                      >
                        {w.speeds[v]}
                      </button>
                    ))}
                  </Segmented>
                </Row>
                <Row label={w.removeModel}>
                  <button
                    className={cx("secondary small danger")}
                    disabled={
                      catalog.models.length < 2 ||
                      current.id === catalog.default
                    }
                    onClick={() => {
                      change({
                        ...catalog,
                        models: catalog.models.filter(
                          (m) => m.id !== current.id,
                        ),
                      });
                      setEditing(catalog.default);
                    }}
                  >
                    <Trash2 size={14} />
                    {t.rail.remove}
                  </button>
                </Row>
              </>
            )}
          </section>
        )}
        {tab === "image" && catalog && (
          <section>
            <Row label={w.shared}>
              <Switch
                checked={shared}
                onChange={(on) => {
                  setSeparate(!on);
                  // Sharing again takes the default model's account back; going
                  // separate starts from it, to be changed below.
                  if (on) {
                    const base =
                      catalog.models.find((m) => m.id === catalog.default) ??
                      catalog.models[0];
                    image(Object.fromEntries(account.map((k) => [k, base[k]])));
                  }
                }}
              />
            </Row>
            {!shared && connection(catalog.image, image, false)}
            <Row label={w.model}>
              <input
                className={cx("mono")}
                value={catalog.image.model}
                onChange={(e) => image({ model: e.target.value })}
              />
            </Row>
          </section>
        )}
        {tab === "accounts" && <Accounts />}
        {tab === "roles" && <Roles />}
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
                  if (saved?.catalog) {
                    setSeparate(!sharing(saved.catalog));
                    setEditing(saved.catalog.default);
                  }
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
                    if (
                      JSON.stringify(value.own) !== JSON.stringify(saved?.own)
                    )
                      await api("/settings", "PUT", {
                        preferences: value.own.preferences,
                      });
                    const next =
                      catalog &&
                      JSON.stringify(catalog) !== JSON.stringify(saved?.catalog)
                        ? await api<ModelCatalog>(
                            "/admin/models",
                            "PUT",
                            catalog,
                          )
                        : catalog;
                    const now = { ...value, catalog: next };
                    setSaved(now);
                    set(now);
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

/** A role's name: a built-in one in the reader's language, the rest as named. */
export function useRoleName() {
  const t = useT();
  return (r: Pick<AccountRole, "id" | "name" | "builtin">) =>
    (r.builtin && t.settings.roleNames[r.id]) || r.name;
}

/** Every account and the role it holds; a change takes effect at once. */
function Accounts() {
  const w = useT().settings,
    roleName = useRoleName();
  const me = useContext(AccountContext)?.id;
  const [list, setList] = useState<Account[]>(),
    [roles, setRoles] = useState<AccountRole[]>([]),
    [error, E] = useState("");
  useEffect(() => {
    void Promise.all([
      api<Account[]>("/admin/accounts"),
      api<AccountRole[]>("/admin/roles"),
    ]).then(
      ([a, r]) => {
        setList(a);
        setRoles(r);
      },
      (e) => E(e.message),
    );
  }, []);
  if (!list)
    return (
      <section>
        {error ? <p className={cx("error")}>{error}</p> : <Spinner />}
      </section>
    );
  return (
    <section>
      {error && (
        <p className={cx("error")} role="alert">
          {error}
        </p>
      )}
      {list.map((a) => (
        <Row key={a.id} label={a.name + (a.id === me ? w.you : "")}>
          <select
            aria-label={w.accountRole}
            value={a.role}
            onChange={async (e) => {
              E("");
              try {
                const changed = await api<Account>(
                  "/admin/accounts/" + a.id,
                  "PATCH",
                  { role: e.target.value },
                );
                setList((old) =>
                  old!.map((x) => (x.id === a.id ? changed : x)),
                );
                // Taking away one's own right to manage accounts takes this page away.
                if (
                  a.id === me &&
                  !changed.permissions.includes("accounts.manage")
                )
                  location.reload();
              } catch (err) {
                E(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleName(r)}
              </option>
            ))}
          </select>
        </Row>
      ))}
    </section>
  );
}

/** The roles and what each may do. Administrators may do everything; members' and added
 * roles' permissions are switched on and off here, and take effect at once. */
function Roles() {
  const w = useT().settings,
    roleName = useRoleName();
  const [roles, setRoles] = useState<AccountRole[]>(),
    [error, E] = useState("");
  useEffect(() => {
    void api<AccountRole[]>("/admin/roles").then(setRoles, (e) => E(e.message));
  }, []);
  const attempt = async (fn: () => Promise<void>) => {
    E("");
    try {
      await fn();
    } catch (e) {
      E(e instanceof Error ? e.message : String(e));
    }
  };
  const save = (r: AccountRole, patch: Partial<AccountRole>) =>
    attempt(async () => {
      const changed = await api<AccountRole>("/admin/roles/" + r.id, "PUT", {
        name: r.name,
        permissions: r.permissions,
        ...patch,
      });
      setRoles((old) => old!.map((x) => (x.id === r.id ? changed : x)));
    });
  if (!roles)
    return (
      <section>
        {error ? <p className={cx("error")}>{error}</p> : <Spinner />}
      </section>
    );
  return (
    <section>
      {error && (
        <p className={cx("error")} role="alert">
          {error}
        </p>
      )}
      {roles.map((r) => (
        <div className={cx("role")} key={r.id}>
          <header>
            {r.builtin ? (
              <b>{roleName(r)}</b>
            ) : (
              <input
                aria-label={w.roleName}
                defaultValue={r.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== r.name) void save(r, { name });
                  else e.target.value = r.name;
                }}
              />
            )}
            {r.builtin ? (
              <small>{w.builtinRole}</small>
            ) : (
              <button
                className={cx("secondary small danger")}
                onClick={() => {
                  if (!confirm(w.removeRoleConfirm(r.name))) return;
                  void attempt(async () => {
                    await api("/admin/roles/" + r.id, "DELETE");
                    setRoles((old) => old!.filter((x) => x.id !== r.id));
                  });
                }}
              >
                <Trash2 size={14} />
                {w.removeRole}
              </button>
            )}
          </header>
          {r.id === "admin" && (
            <small className={cx("role-hint")}>{w.adminHint}</small>
          )}
          {r.id === "member" && (
            <small className={cx("role-hint")}>{w.memberHint}</small>
          )}
          {permissions.map((p) => (
            <Row key={p} label={w.permissions[p]} hint={w.permissionHints[p]}>
              <Switch
                checked={r.permissions.includes(p)}
                disabled={r.id === "admin"}
                onChange={(on) =>
                  void save(r, {
                    permissions: on
                      ? [...r.permissions, p]
                      : r.permissions.filter((x) => x !== p),
                  })
                }
              />
            </Row>
          ))}
        </div>
      ))}
      <div>
        <button
          className={cx("secondary small")}
          onClick={() =>
            void attempt(async () => {
              const taken = new Set(roles.map((r) => r.name));
              let n = 1;
              while (taken.has(w.newRole(n))) n++;
              const made = await api<AccountRole>("/admin/roles", "POST", {
                name: w.newRole(n),
                permissions: [],
              });
              setRoles((old) => [...old!, made]);
            })
          }
        >
          <Plus size={14} />
          {w.addRole}
        </button>
      </div>
    </section>
  );
}
