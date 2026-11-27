import { useContext, useEffect, useState } from "react";
import {
  UserRound,
  PenTool,
  Gavel,
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
  Tags,
} from "lucide-react";
import { Switch, Spinner } from "./ui/primitives.tsx";
import * as Hand from "./ui/brand/icons.tsx";
import { pageLocale } from "./ui/locale.tsx";
import {
  permissions,
  type Account,
  type AccountRole,
  type Invite,
  type ModelCatalog,
  type Permission,
  type UserSettings,
} from "../../../modules/contracts/index.ts";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { Title } from "./Title.tsx";
import { useT, dictionaries } from "./i18n.tsx";
import { AccountContext, useCan } from "./account.tsx";
import { ago } from "./time.ts";
import { useDevMode } from "./EditView.tsx";
import { Badge, Entry, Group, Head, keep, keptValue, Loaded, read, Row, useLoaded } from "./SettingsParts.tsx";
import { ImageSection, JudgeSection, LabelSection, SearchSection, WriterSection } from "./ModelSettings.tsx";

/** The section each model tab shows. */
const sections = {
  labels: LabelSection,
  author: WriterSection,
  search: SearchSection,
  image: ImageSection,
  judge: JudgeSection,
} as const;
/** Settings changed and not yet saved, which leaving the page would lose. */
let unsaved = false;
/** Whether the page may be left: always, unless settings are unsaved and the user would
 * rather stay. */
export const leaving = () =>
  !unsaved || confirm(dictionaries[pageLocale()].settings.leave);

/** The account's own settings and, for those who manage models, the models. */
type Own = { own: UserSettings; catalog?: ModelCatalog };
const loadOwn = (models: boolean) => (): Promise<Own> =>
  Promise.all([
    api<UserSettings>("/settings"),
    models ? api<ModelCatalog>("/admin/models") : undefined,
  ]).then(([own, catalog]) => ({ own, catalog }));
/** The accounts and the roles, which the accounts and roles pages both show. */
const loadAccounts = () =>
  Promise.all([api<Account[]>("/admin/accounts"), api<AccountRole[]>("/admin/roles")]);
const loadInvites = () => api<Invite[]>("/admin/invites");

/** Reads what the settings pages show before they are opened (as the account menu opens,
 * or the first page while the others wait), so each opens on what it shows. */
export function readSettings(can: (p: Permission) => boolean) {
  const quiet = () => {};
  read("own", loadOwn(can("models.manage"))).catch(quiet);
  if (!can("accounts.manage")) return;
  read("accounts", loadAccounts).catch(quiet);
  read("invites", loadInvites).catch(quiet);
}

type Tab =
  | "preferences"
  | "labels"
  | "author"
  | "search"
  | "image"
  | "judge"
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
  const [dev, setDev] = useDevMode();
  // What was kept from the last visit shows at once, and is replaced by what is read afresh
  // unless it has been changed in the meantime.
  const [kept] = useState(() => keptValue<Own>("own"));
  const [saved, setSaved] = useState(kept),
    [value, set] = useState(kept),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    // The model or service opened for editing.
    [editing, setEditing] = useState<string>();
  useEffect(() => {
    void read("own", loadOwn(models)).then(
      (v) => {
        setSaved(v);
        set((old) => (old === kept ? v : old));
      },
      (e) => setError(e.message),
    );
    readSettings(can);
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
    setDone(false);
    set({ ...value, catalog });
  };
  const tabs = (
    [
      ["preferences", UserRound, true],
      ["labels", Tags, models],
      ["author", PenTool, models],
      ["search", Globe, models],
      ["image", ImageIcon, models],
      ["judge", Gavel, models],
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
        <div
          className={cx("settings-nav")}
          role="tablist"
          aria-label={t.titles.settings}
          onKeyDown={(e) => {
            const keys = tabs.map(([k]) => k);
            const idx = keys.indexOf(tab);
            let next = -1;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % keys.length;
            else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + keys.length) % keys.length;
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = keys.length - 1;
            if (next < 0) return;
            e.preventDefault();
            setTab(keys[next]);
            const btns = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            btns[next]?.focus();
          }}
        >
          {tabs.map(([k, Icon], i) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              tabIndex={tab === k ? 0 : -1}
              // Everyone's own settings first, then what their role lets them run.
              data-break={i === 1 || undefined}
              onClick={() => setTab(k)}
            >
              <Icon size={16} />
              {t.titles[k]}
            </button>
          ))}
        </div>
        {tab === "preferences" && (
          <section>
            <Head title={t.titles.preferences} hint={w.preferencesHint} />
            <Group>
              <Row label={w.longTerm} hint={w.longTermHint} wide>
                <textarea
                  value={value.own.preferences}
                  placeholder={w.longTermExample}
                  onChange={(e) => {
                    setDone(false);
                    set({
                      ...value,
                      own: { ...value.own, preferences: e.target.value },
                    });
                  }}
                />
              </Row>
              <Row label={w.developer} hint={w.developerHint}>
                <Switch checked={dev} onChange={setDev} />
              </Row>
            </Group>
          </section>
        )}
        {(["labels", "author", "search", "image", "judge"] as const).map((k) => {
          const Section = sections[k];
          return (
            tab === k &&
            catalog && (
              <Section
                key={k}
                catalog={catalog}
                change={change}
                editing={editing}
                setEditing={setEditing}
              />
            )
          );
        })}
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
                  setError("");
                }}
              >
                {w.discard}
              </button>
              <button
                className={cx("primary small")}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
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
                    keep("own", now);
                    setSaved(now);
                    set(now);
                    setDone(true);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
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

/** Every account and the role it holds, as a list to search; a change takes effect at
 * once. */
function Accounts() {
  const w = useT().settings,
    roleName = useRoleName();
  const me = useContext(AccountContext)?.id;
  const { value, update, error, attempt } = useLoaded("accounts", loadAccounts);
  const [query, setQuery] = useState("");
  const change = (a: Account, patch: { quota: number | null } | { role: string }) =>
    attempt(async () => {
      const changed = await api<Account>("/admin/accounts/" + a.id, "PATCH", patch);
      update(([list, roles]) => [list.map((x) => (x.id === a.id ? changed : x)), roles]);
      // Taking away one's own right to manage accounts takes this page away.
      if (a.id === me && !changed.permissions.includes("accounts.manage")) location.reload();
    });
  return (
    <section>
      <Head title={useT().titles.accounts} hint={w.accountsHint} />
      <Loaded value={value} error={error}>
        {([list, roles]) => {
          const shown = list.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));
          return (
            <div className={cx("group-card members")}>
              <div className={cx("members-bar")}>
                <label className={cx("members-search")}>
                  <Search size={15} />
                  <input
                    placeholder={w.searchAccounts}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <small>{w.accountsCount(list.length)}</small>
              </div>
              <div className={cx("members-head")} aria-hidden>
                <span>{w.accountName}</span>
                <span className={cx("members-quota-head")} title={w.quotaHint}>
                  {w.accountQuota}
                </span>
                <span>{w.accountRole}</span>
              </div>
              <ul>
                {shown.map((a) => (
                  <li key={a.id}>
                    <Hand.Avatar name={a.name} />
                    <span className={cx("member-name")}>
                      <b>{a.name}</b>
                      {a.id === me && <Badge tone="muted">{w.you}</Badge>}
                    </span>
                    <Quota
                      key={a.id + ":" + a.quota}
                      account={a}
                      save={(quota) => void change(a, { quota })}
                    />
                    <select
                      aria-label={w.accountRole + " · " + a.name}
                      value={a.role}
                      onChange={(e) => void change(a, { role: e.target.value })}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {roleName(r)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
                {!shown.length && <li className={cx("members-none")}>{w.noAccounts}</li>}
              </ul>
            </div>
          );
        }}
      </Loaded>
    </section>
  );
}

/** How many more requests an account may make, typed and kept on leaving the field; left
 * empty, it has no limit. */
function Quota({
  account,
  save,
}: {
  account: Account;
  save: (quota: number | null) => void;
}) {
  const w = useT().settings;
  const [value, set] = useState(account.quota === null ? "" : String(account.quota));
  const commit = () => {
    const n = value.trim() === "" ? null : Math.max(0, Math.floor(Number(value)));
    if (n !== null && !Number.isFinite(n)) return set(account.quota === null ? "" : String(account.quota));
    if (n !== account.quota) save(n);
  };
  return (
    <input
      className={cx("members-quota")}
      aria-label={w.accountQuota + " · " + account.name}
      inputMode="numeric"
      placeholder={w.unlimited}
      value={value}
      onChange={(e) => set(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** The invite codes sign-ups need: made here, copied to hand out, each used once. An
 * unused one can be withdrawn; a used one stays to show who came in with it. */
function Invites() {
  const t = useT(),
    w = t.settings;
  const { value: list, update, error, attempt } = useLoaded("invites", loadInvites);
  const [copied, setCopied] = useState<string>();
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
                update((old) => [...made, ...old]);
              })
            }
          >
            <Plus size={15} />
            {w.makeInvite}
          </button>
        )}
      </Head>
      <Loaded value={list} error={error}>
        {(list) => (
          <div className={cx("group-card members invites")}>
            <div className={cx("members-bar")}>
              <small>{w.invitesCount(list.filter((i) => !i.usedBy).length, list.length)}</small>
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
                            update((old) => old.filter((x) => x.code !== i.code));
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
      </Loaded>
    </section>
  );
}

/** The roles and what each may do, one row each, opened to change. Administrators may do
 * everything; members' and added roles' permissions take effect at once. */
function Roles() {
  const t = useT(),
    w = t.settings,
    roleName = useRoleName();
  const { value, update, error, attempt } = useLoaded("accounts", loadAccounts);
  const [open, setOpen] = useState<string>();
  const roles = value?.[1];
  const save = (r: AccountRole, patch: Partial<AccountRole>) =>
    attempt(async () => {
      const changed = await api<AccountRole>("/admin/roles/" + r.id, "PUT", {
        name: r.name,
        permissions: r.permissions,
        ...patch,
      });
      update(([accounts, roles]) => [accounts, roles.map((x) => (x.id === r.id ? changed : x))]);
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
                update(([accounts, roles]) => [accounts, [...roles, made]]);
                setOpen(made.id);
              })
            }
          >
            <Plus size={15} />
            {w.addRole}
          </button>
        )}
      </Head>
      <Loaded value={value} error={error}>
        {([accounts, roles]) => (
          <ul className={cx("entries")}>
            {roles.map((r) => (
              <Entry
                key={r.id}
                icon={<ShieldCheck size={16} />}
                title={roleName(r)}
                detail={summary(r)}
                badges={r.builtin && <Badge tone="muted">{w.builtinRole}</Badge>}
                aside={w.membersCount(accounts.filter((a) => a.role === r.id).length)}
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
                          // Its accounts are members again.
                          update(([accounts, roles]) => [
                            accounts.map((a) => (a.role === r.id ? { ...a, role: "member" } : a)),
                            roles.filter((x) => x.id !== r.id),
                          ]);
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
      </Loaded>
    </section>
  );
}
