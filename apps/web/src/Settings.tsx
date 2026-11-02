import { useContext, useEffect, useState } from "react";
import {
  UserRound,
  PenTool,
  Image as ImageIcon,
  Users,
  ShieldCheck,
  Plus,
  Trash2,
  Search,
  Check,
  Copy,
  Ticket,
  Globe,
} from "lucide-react";
import { Switch, Spinner, pageLocale } from "@drawy/ui";
import {
  permissions,
  type Account,
  type AccountRole,
  type Invite,
  type ModelCatalog,
  type UserSettings,
} from "../../../modules/contracts/index.ts";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { Title } from "./Title.tsx";
import { useT, dictionaries } from "./i18n.tsx";
import { AccountContext, useCan } from "./account.tsx";
import { ago } from "./time.ts";
import { Badge, Entry, Group, Head, Row } from "./SettingsParts.tsx";
import { CatalogSection } from "./ModelSettings.tsx";

/** The catalog part each model tab edits. */
const sections = { author: "models", search: "searches", image: "images" } as const;
/** Settings changed and not yet saved, which leaving the page would lose. */
let unsaved = false;
/** Whether the page may be left: always, unless settings are unsaved and the user would
 * rather stay. */
export const leaving = () =>
  !unsaved || confirm(dictionaries[pageLocale()].settings.leave);

type Tab =
  | "preferences"
  | "author"
  | "search"
  | "image"
  | "accounts"
  | "invites"
  | "roles";

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
    // The model or service opened for editing.
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
  const change = (catalog: ModelCatalog) => {
    D(false);
    set({ ...value, catalog });
  };
  const tabs = (
    [
      ["preferences", UserRound, true],
      ["author", PenTool, models],
      ["search", Globe, models],
      ["image", ImageIcon, models],
      ["accounts", Users, accounts],
      ["invites", Ticket, accounts],
      ["roles", ShieldCheck, accounts],
    ] as const
  ).filter(([, , shown]) => shown);
  return (
    <div className={cx("page settings")}>
      <header className={cx("page-head")}>
        <h1>
          <Title name="settings" />
        </h1>
      </header>
      <div className={cx("settings-layout")}>
        <nav className={cx("settings-nav")}>
          {tabs.map(([k, Icon], i) => (
            <button
              key={k}
              aria-current={tab === k || undefined}
              // Everyone's own settings first, then what their role lets them run.
              data-break={i === 1 || undefined}
              onClick={() => setTab(k)}
            >
              <Icon size={16} />
              {t.titles[k]}
            </button>
          ))}
        </nav>
        {tab === "preferences" && (
          <section>
            <Head title={t.titles.preferences} hint={w.preferencesHint} />
            <Group>
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
            </Group>
          </section>
        )}
        {(["author", "search", "image"] as const).map(
          (k) =>
            tab === k &&
            catalog && (
              <CatalogSection
                key={k}
                part={sections[k]}
                title={t.titles[k]}
                catalog={catalog}
                change={change}
                editing={editing}
                setEditing={setEditing}
              />
            ),
        )}
        {tab === "accounts" && <Accounts />}
        {tab === "invites" && <Invites />}
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

/** A person's mark: the first letter of their name. */
const Avatar = ({ name }: { name: string }) => (
  <span className={cx("avatar")}>{[...name][0]?.toUpperCase()}</span>
);

/** Every account and the role it holds, as a list to search; a change takes effect at
 * once. */
function Accounts() {
  const w = useT().settings,
    roleName = useRoleName();
  const me = useContext(AccountContext)?.id;
  const [list, setList] = useState<Account[]>(),
    [roles, setRoles] = useState<AccountRole[]>([]),
    [q, Q] = useState(""),
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
  const shown = (list ?? []).filter((a) =>
    a.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <section>
      <Head title={useT().titles.accounts} hint={w.accountsHint} />
      {error && (
        <p className={cx("error")} role="alert">
          {error}
        </p>
      )}
      {!list ? (
        !error && <Spinner />
      ) : (
        <div className={cx("group-card members")}>
          <div className={cx("members-bar")}>
            <label className={cx("members-search")}>
              <Search size={15} />
              <input
                placeholder={w.searchAccounts}
                value={q}
                onChange={(e) => Q(e.target.value)}
              />
            </label>
            <small>{w.accountsCount(list.length)}</small>
          </div>
          <div className={cx("members-head")} aria-hidden>
            <span>{w.accountName}</span>
            <span>{w.accountRole}</span>
          </div>
          <ul>
            {shown.map((a) => (
              <li key={a.id}>
                <Avatar name={a.name} />
                <span className={cx("member-name")}>
                  <b>{a.name}</b>
                  {a.id === me && <Badge tone="muted">{w.you}</Badge>}
                </span>
                <select
                  aria-label={w.accountRole + " · " + a.name}
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
                      // Taking away one's own right to manage accounts takes this page
                      // away.
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
              </li>
            ))}
            {!shown.length && (
              <li className={cx("members-none")}>{w.noAccounts}</li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The invite codes sign-ups need: made here, copied to hand out, each used once. An
 * unused one can be withdrawn; a used one stays to show who came in with it. */
function Invites() {
  const t = useT(),
    w = t.settings;
  const [list, setList] = useState<Invite[]>(),
    [copied, setCopied] = useState<string>(),
    [error, E] = useState("");
  useEffect(() => {
    void api<Invite[]>("/admin/invites").then(setList, (e) => E(e.message));
  }, []);
  const attempt = async (fn: () => Promise<void>) => {
    E("");
    try {
      await fn();
    } catch (e) {
      E(e instanceof Error ? e.message : String(e));
    }
  };
  const unused = (list ?? []).filter((i) => !i.usedBy).length;
  return (
    <section>
      <Head title={t.titles.invites} hint={w.invitesHint}>
        {list && (
          <button
            className={cx("secondary small")}
            onClick={() =>
              void attempt(async () => {
                const made = await api<Invite[]>("/admin/invites", "POST", {
                  count: 1,
                });
                setList((old) => [...made, ...old!]);
              })
            }
          >
            <Plus size={15} />
            {w.makeInvite}
          </button>
        )}
      </Head>
      {error && (
        <p className={cx("error")} role="alert">
          {error}
        </p>
      )}
      {!list ? (
        !error && <Spinner />
      ) : (
        <div className={cx("group-card members invites")}>
          <div className={cx("members-bar")}>
            <small>{w.invitesCount(unused, list.length)}</small>
          </div>
          <ul>
            {list.map((i) => (
              <li key={i.code}>
                <span className={cx("member-name")}>
                  <code className={cx("invite-code")}>{i.code}</code>
                  {i.usedBy ? (
                    <Badge tone="muted">
                      {w.inviteUsed(i.usedBy.name ?? w.inviteRemovedAccount)}
                    </Badge>
                  ) : (
                    <Badge tone="accent">{w.inviteUnused}</Badge>
                  )}
                </span>
                <small className={cx("invite-when")}>
                  {ago(i.usedAt ?? i.createdAt)}
                </small>
                {!i.usedBy && (
                  <>
                    <button
                      className={cx("invite-action")}
                      title={copied === i.code ? w.inviteCopied : w.inviteCopy}
                      aria-label={w.inviteCopy}
                      onClick={() =>
                        void navigator.clipboard?.writeText(i.code).then(() => {
                          setCopied(i.code);
                          setTimeout(
                            () => setCopied((c) => (c === i.code ? undefined : c)),
                            1500,
                          );
                        })
                      }
                    >
                      {copied === i.code ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                    <button
                      className={cx("invite-action")}
                      title={w.inviteRemove}
                      aria-label={w.inviteRemove}
                      onClick={() => {
                        if (!confirm(w.inviteRemoveConfirm(i.code))) return;
                        void attempt(async () => {
                          await api(
                            "/admin/invites/" + encodeURIComponent(i.code),
                            "DELETE",
                          );
                          setList((old) => old!.filter((x) => x.code !== i.code));
                        });
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </li>
            ))}
            {!list.length && (
              <li className={cx("members-none")}>{w.noInvites}</li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The roles and what each may do, one row each, opened to change. Administrators may do
 * everything; members' and added roles' permissions take effect at once. */
function Roles() {
  const t = useT(),
    w = t.settings,
    roleName = useRoleName();
  const [roles, setRoles] = useState<AccountRole[]>(),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [open, setOpen] = useState<string>(),
    [error, E] = useState("");
  useEffect(() => {
    void Promise.all([
      api<AccountRole[]>("/admin/roles"),
      api<Account[]>("/admin/accounts"),
    ]).then(
      ([r, a]) => {
        setRoles(r);
        const n: Record<string, number> = {};
        for (const x of a) n[x.role] = (n[x.role] ?? 0) + 1;
        setCounts(n);
      },
      (e) => E(e.message),
    );
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
  const summary = (r: AccountRole) =>
    r.permissions.length === permissions.length
      ? w.allPermissions
      : r.permissions.length
        ? r.permissions.map((p) => w.permissionsShort[p]).join(t.now.list)
        : w.noPermissions;
  return (
    <section>
      <Head title={t.titles.roles} hint={w.rolesHint}>
        {roles && (
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
                setOpen(made.id);
              })
            }
          >
            <Plus size={15} />
            {w.addRole}
          </button>
        )}
      </Head>
      {error && (
        <p className={cx("error")} role="alert">
          {error}
        </p>
      )}
      {!roles ? (
        !error && <Spinner />
      ) : (
        <ul className={cx("entries")}>
          {roles.map((r) => (
            <Entry
              key={r.id}
              icon={<ShieldCheck size={16} />}
              title={roleName(r)}
              detail={summary(r)}
              badges={r.builtin && <Badge tone="muted">{w.builtinRole}</Badge>}
              aside={w.membersCount(counts[r.id] ?? 0)}
              open={open === r.id}
              toggle={() => setOpen(open === r.id ? undefined : r.id)}
            >
              {r.id === "admin" ? (
                <p className={cx("entry-note")}>{w.adminHint}</p>
              ) : r.id === "member" ? (
                <p className={cx("entry-note")}>{w.memberHint}</p>
              ) : (
                <Group>
                  <Row label={w.roleName}>
                    <input
                      defaultValue={r.name}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== r.name) void save(r, { name });
                        else e.target.value = r.name;
                      }}
                    />
                  </Row>
                </Group>
              )}
              <Group title={w.permissionsTitle}>
                {permissions.map((p) => (
                  <Row
                    key={p}
                    label={w.permissions[p]}
                    hint={w.permissionHints[p]}
                  >
                    {r.id === "admin" ? (
                      <Check size={17} className={cx("granted")} />
                    ) : (
                      <Switch
                        checked={r.permissions.includes(p)}
                        onChange={(on) =>
                          void save(r, {
                            permissions: on
                              ? [...r.permissions, p]
                              : r.permissions.filter((x) => x !== p),
                          })
                        }
                      />
                    )}
                  </Row>
                ))}
              </Group>
              {!r.builtin && (
                <footer className={cx("entry-foot")}>
                  <small>{w.removeRoleHint}</small>
                  <button
                    className={cx("secondary small danger")}
                    onClick={() => {
                      if (!confirm(w.removeRoleConfirm(r.name))) return;
                      void attempt(async () => {
                        await api("/admin/roles/" + r.id, "DELETE");
                        setRoles((old) => old!.filter((x) => x.id !== r.id));
                        setCounts((old) => ({
                          ...old,
                          member: (old.member ?? 0) + (old[r.id] ?? 0),
                        }));
                      });
                    }}
                  >
                    <Trash2 size={14} />
                    {w.removeRole}
                  </button>
                </footer>
              )}
            </Entry>
          ))}
        </ul>
      )}
    </section>
  );
}
