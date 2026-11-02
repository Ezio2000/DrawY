import { useContext, useEffect, useState, type ReactNode } from "react";
import {
  UserRound,
  PenTool,
  Image as ImageIcon,
  Users,
  ShieldCheck,
  Plus,
  Trash2,
  ChevronDown,
  Search,
  Check,
  Copy,
  Ticket,
  Globe,
} from "lucide-react";
import { Segmented, Switch, Spinner, pageLocale } from "@drawy/ui";
import {
  permissions,
  speeds,
  speedFor,
  efforts,
  effortFor,
  protocols,
  searchModes,
  searchProviders,
  searchEndpoints,
  searchReady,
  canSearchBuiltin,
  type ImageOption,
  type SearchService,
  type Account,
  type AccountRole,
  type Invite,
  type ModelCatalog,
  type ModelOption,
  type UserSettings,
} from "../../../modules/contracts/index.ts";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { Title } from "./Title.tsx";
import { useT, dictionaries } from "./i18n.tsx";
import { AccountContext, useCan } from "./account.tsx";
import { ago } from "./time.ts";

const channels = {
  api: { baseUrl: "https://api.openai.com/v1" },
  oauth: { baseUrl: "https://chatgpt.com/backend-api/codex" },
} as const;
type Connection = Pick<ModelOption, "channel" | "baseUrl" | "credential" | "accountId">;
const newId = (prefix: string) => prefix + "-" + crypto.randomUUID().slice(0, 8);
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

/** A section's title and what it is for, with its one action on the right. */
function Head({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <header className={cx("section-head")}>
      <div>
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      {children}
    </header>
  );
}

/** Settings that belong together, under a small label, on one card. */
function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className={cx("group")}>
      {title && <h3>{title}</h3>}
      <div className={cx("group-card")}>{children}</div>
    </div>
  );
}

/** One thing in a list (a model, a role): its summary as a row, its settings opened
 * beneath it. */
function Entry({
  icon,
  title,
  detail,
  badges,
  aside,
  open,
  toggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  badges?: ReactNode;
  aside?: ReactNode;
  open: boolean;
  toggle: () => void;
  children: ReactNode;
}) {
  return (
    <li className={cx("entry")} data-open={open || undefined}>
      <button className={cx("entry-row")} aria-expanded={open} onClick={toggle}>
        <span className={cx("entry-icon")}>{icon}</span>
        <span className={cx("entry-text")}>
          <span>
            <b>{title}</b>
            {badges}
          </span>
          <small>{detail}</small>
        </span>
        {aside && <span className={cx("entry-aside")}>{aside}</span>}
        <ChevronDown size={16} className={cx("entry-chevron")} />
      </button>
      {open && <div className={cx("entry-body")}>{children}</div>}
    </li>
  );
}

const Badge = ({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "accent" | "muted";
}) => (
  <span className={cx("badge")} data-tone={tone}>
    {children}
  </span>
);

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
  /** Changes one drawing model. What its connection cannot offer is let go at once: a
   * ChatGPT account speaks only the Responses API, and only an API key with it has the
   * provider's own search. */
  const model = (id: string, patch: Partial<ModelOption>) => {
    if (!catalog) return;
    change({
      ...catalog,
      models: catalog.models.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m, ...patch };
        if (next.channel === "oauth") next.protocol = "responses";
        if (!canSearchBuiltin({ ...next, builtinSearch: true })) next.builtinSearch = false;
        if (next.search === "builtin" && !next.builtinSearch) next.search = "off";
        next.effort = effortFor(next.effort, next.efforts) ?? next.effort;
        return next;
      }),
    });
  };
  const image = (id: string, patch: Partial<ImageOption>) =>
    catalog &&
    change({
      ...catalog,
      images: catalog.images.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  const service = (id: string, patch: Partial<SearchService>) =>
    catalog &&
    change({
      ...catalog,
      searches: catalog.searches.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
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
              {c === "api" ? w.apiKey : w.chatgpt}
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
          type="password"
          autoComplete="off"
          value={of.credential}
          spellCheck={false}
          placeholder={w.credentialEmpty}
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
        {tab === "author" && catalog && (
          <section>
            <Head title={t.titles.author} hint={w.modelsHint}>
              <button
                className={cx("secondary small")}
                onClick={() => {
                  const base =
                    catalog.models.find((m) => m.id === catalog.default) ??
                    catalog.models[0];
                  const id = newId("m");
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
            </Head>
            <ul className={cx("entries")}>
              {catalog.models.map((m) => (
                <Entry
                  key={m.id}
                  icon={<PenTool size={16} />}
                  title={m.name}
                  detail={m.description || m.model}
                  badges={
                    <>
                      {m.id === catalog.default && (
                        <Badge tone="accent">{w.isDefault}</Badge>
                      )}
                      {!m.credential && (
                        <Badge tone="muted">
                          {t.composer.modelUnconnected}
                        </Badge>
                      )}
                    </>
                  }
                  aside={
                    <code className={cx("entry-code")}>
                      {m.model} · {w.efforts[m.effort]} · {w.searchModesShort[m.search]}
                    </code>
                  }
                  open={editing === m.id}
                  toggle={() => setEditing(editing === m.id ? undefined : m.id)}
                >
                  <Group title={w.basics}>
                    <Row label={w.modelName} hint={w.modelNameHint}>
                      <input
                        value={m.name}
                        onChange={(e) => model(m.id, { name: e.target.value })}
                      />
                    </Row>
                    <Row label={w.description} hint={w.descriptionHint}>
                      <input
                        value={m.description}
                        placeholder={w.descriptionExample}
                        onChange={(e) =>
                          model(m.id, { description: e.target.value })
                        }
                      />
                    </Row>
                    <Row label={w.isDefault} hint={w.isDefaultHint}>
                      <Switch
                        checked={m.id === catalog.default}
                        disabled={m.id === catalog.default}
                        onChange={() => change({ ...catalog, default: m.id })}
                      />
                    </Row>
                  </Group>
                  <Group title={w.connection}>
                    {connection(m, (p) => model(m.id, p), true, m.speed)}
                    {m.channel === "api" && (
                      <Row label={w.protocol} hint={w.protocolHints[m.protocol]}>
                        <Segmented label={w.protocol}>
                          {protocols.map((v) => (
                            <button
                              key={v}
                              aria-pressed={m.protocol === v}
                              onClick={() => model(m.id, { protocol: v })}
                            >
                              {w.protocols[v]}
                            </button>
                          ))}
                        </Segmented>
                      </Row>
                    )}
                  </Group>
                  <Group title={w.abilities}>
                    <Row label={w.vision} hint={w.visionHint}>
                      <Switch checked={m.vision} onChange={(on) => model(m.id, { vision: on })} />
                    </Row>
                    <Row label={w.tools} hint={w.toolsHint}>
                      <Switch checked={m.tools} onChange={(on) => model(m.id, { tools: on })} />
                    </Row>
                    <Row
                      label={w.builtinSearch}
                      hint={
                        canSearchBuiltin({ ...m, builtinSearch: true })
                          ? w.builtinSearchHint
                          : w.builtinSearchUnavailable
                      }
                    >
                      <Switch
                        checked={m.builtinSearch}
                        disabled={!canSearchBuiltin({ ...m, builtinSearch: true })}
                        onChange={(on) => model(m.id, { builtinSearch: on })}
                      />
                    </Row>
                    <Row label={w.defaultSearch} hint={w.defaultSearchHint}>
                      <Segmented label={w.defaultSearch}>
                        {searchModes.map((v) => (
                          <button
                            key={v}
                            aria-pressed={m.search === v}
                            disabled={v === "builtin" && !m.builtinSearch}
                            onClick={() => model(m.id, { search: v })}
                          >
                            {w.searchModes[v]}
                          </button>
                        ))}
                      </Segmented>
                    </Row>
                  </Group>
                  <Group title={w.parameters}>
                    <Row label={w.model}>
                      <input
                        className={cx("mono")}
                        value={m.model}
                        onChange={(e) => model(m.id, { model: e.target.value })}
                      />
                    </Row>
                    <Row label={w.acceptedEfforts} hint={w.acceptedEffortsHint}>
                      <div className={cx("chips")} role="group" aria-label={w.acceptedEfforts}>
                        {efforts.map((v) => (
                          <button
                            key={v}
                            aria-pressed={m.efforts.includes(v)}
                            onClick={() =>
                              model(m.id, {
                                efforts: m.efforts.includes(v)
                                  ? m.efforts.filter((x) => x !== v)
                                  : efforts.filter((x) => x === v || m.efforts.includes(x)),
                              })
                            }
                          >
                            {w.efforts[v]}
                          </button>
                        ))}
                      </div>
                    </Row>
                    <Row label={w.effort}>
                      <Segmented label={w.effort}>
                        {(m.efforts.length ? m.efforts : efforts).map((v) => (
                          <button
                            key={v}
                            aria-pressed={m.effort === v}
                            onClick={() => model(m.id, { effort: v })}
                          >
                            {w.efforts[v]}
                          </button>
                        ))}
                      </Segmented>
                    </Row>
{/* Speeds are the Responses API's service tiers; Chat Completions has none. */}
                    {m.protocol === "responses" && (
                                        <Row label={w.speed} hint={w.speedHints[m.speed]}>
                      <Segmented label={w.speed}>
                        {speeds[m.channel].map((v) => (
                          <button
                            key={v}
                            aria-pressed={m.speed === v}
                            onClick={() => model(m.id, { speed: v })}
                          >
                            {w.speeds[v]}
                          </button>
                        ))}
                      </Segmented>
                    </Row>
                    )}
                    <Row label={w.maxOutput} hint={w.maxOutputHint}>
                      <input
                        className={cx("mono")}
                        type="number"
                        min={1024}
                        step={1024}
                        value={m.maxOutput}
                        onChange={(e) => model(m.id, { maxOutput: Math.round(Number(e.target.value) || 0) })}
                      />
                    </Row>
                  </Group>
                  <footer className={cx("entry-foot")}>
                    <small>
                      {m.id === catalog.default
                        ? w.defaultKept
                        : catalog.models.length < 2
                          ? w.lastKept
                          : ""}
                    </small>
                    <button
                      className={cx("secondary small danger")}
                      disabled={
                        catalog.models.length < 2 || m.id === catalog.default
                      }
                      onClick={() => {
                        change({
                          ...catalog,
                          models: catalog.models.filter((x) => x.id !== m.id),
                        });
                        setEditing(undefined);
                      }}
                    >
                      <Trash2 size={14} />
                      {w.removeModel}
                    </button>
                  </footer>
                </Entry>
              ))}
            </ul>
          </section>
        )}
        {tab === "search" && catalog && (
          <section>
            <Head title={t.titles.search} hint={w.searchHint}>
              <button
                className={cx("secondary small")}
                onClick={() => {
                  const id = newId("s");
                  change({
                    ...catalog,
                    searches: [
                      ...catalog.searches,
                      {
                        id,
                        name: w.providers.deepseek,
                        provider: "deepseek",
                        baseUrl: searchEndpoints.deepseek,
                        credential: "",
                      },
                    ],
                    defaultSearch: catalog.defaultSearch ?? id,
                  });
                  setEditing(id);
                }}
              >
                <Plus size={15} />
                {w.addSearch}
              </button>
            </Head>
            {!catalog.searches.length && <p className={cx("settings-empty")}>{w.noSearch}</p>}
            <ul className={cx("entries")}>
              {catalog.searches.map((m) => (
                <Entry
                  key={m.id}
                  icon={<Globe size={16} />}
                  title={m.name}
                  detail={w.providers[m.provider]}
                  badges={
                    <>
                      {m.id === catalog.defaultSearch && <Badge tone="accent">{w.isDefaultService}</Badge>}
                      {!searchReady(m) && <Badge tone="muted">{t.composer.modelUnconnected}</Badge>}
                    </>
                  }
                  aside={<code className={cx("entry-code")}>{m.baseUrl}</code>}
                  open={editing === m.id}
                  toggle={() => setEditing(editing === m.id ? undefined : m.id)}
                >
                  <Group title={w.basics}>
                    <Row label={w.modelName} hint={w.serviceNameHint}>
                      <input value={m.name} onChange={(e) => service(m.id, { name: e.target.value })} />
                    </Row>
                    <Row label={w.isDefaultService} hint={w.defaultSearchServiceHint}>
                      <Switch
                        checked={m.id === catalog.defaultSearch}
                        disabled={m.id === catalog.defaultSearch}
                        onChange={() => change({ ...catalog, defaultSearch: m.id })}
                      />
                    </Row>
                  </Group>
                  <Group title={w.connection}>
                    <Row label={w.provider} hint={w.providerHints[m.provider]}>
                      <Segmented label={w.provider}>
                        {searchProviders.map((v) => (
                          <button
                            key={v}
                            aria-pressed={m.provider === v}
                            onClick={() => service(m.id, { provider: v, baseUrl: searchEndpoints[v] })}
                          >
                            {w.providers[v]}
                          </button>
                        ))}
                      </Segmented>
                    </Row>
                    <Row label={w.baseUrl}>
                      <input value={m.baseUrl} onChange={(e) => service(m.id, { baseUrl: e.target.value })} />
                    </Row>
                    <Row label="API Key">
                      <input
                        className={cx("mono")}
                        type="password"
                        autoComplete="off"
                        value={m.credential}
                        spellCheck={false}
                        placeholder={m.provider === "searxng" ? w.credentialOptional : w.credentialEmpty}
                        onChange={(e) => service(m.id, { credential: e.target.value })}
                      />
                    </Row>
                  </Group>
                  <footer className={cx("entry-foot")}>
                    <small />
                    <button
                      className={cx("secondary small danger")}
                      onClick={() => {
                        const searches = catalog.searches.filter((x) => x.id !== m.id);
                        change({
                          ...catalog,
                          searches,
                          defaultSearch:
                            catalog.defaultSearch === m.id ? (searches[0]?.id ?? null) : catalog.defaultSearch,
                        });
                        setEditing(undefined);
                      }}
                    >
                      <Trash2 size={14} />
                      {w.removeSearch}
                    </button>
                  </footer>
                </Entry>
              ))}
            </ul>
          </section>
        )}
        {tab === "image" && catalog && (
          <section>
            <Head title={t.titles.image} hint={w.imageHint}>
              <button
                className={cx("secondary small")}
                onClick={() => {
                  const base =
                    catalog.images.find((m) => m.id === catalog.defaultImage) ?? catalog.images[0];
                  const id = newId("i");
                  change({
                    ...catalog,
                    images: [...catalog.images, { ...base, id, name: w.newImage, description: "" }],
                  });
                  setEditing(id);
                }}
              >
                <Plus size={15} />
                {w.addImage}
              </button>
            </Head>
            <ul className={cx("entries")}>
              {catalog.images.map((m) => (
                <Entry
                  key={m.id}
                  icon={<ImageIcon size={16} />}
                  title={m.name}
                  detail={m.description || m.model}
                  badges={
                    <>
                      {m.id === catalog.defaultImage && <Badge tone="accent">{w.isDefault}</Badge>}
                      {!m.credential && <Badge tone="muted">{t.composer.modelUnconnected}</Badge>}
                    </>
                  }
                  aside={<code className={cx("entry-code")}>{m.model}</code>}
                  open={editing === m.id}
                  toggle={() => setEditing(editing === m.id ? undefined : m.id)}
                >
                  <Group title={w.basics}>
                    <Row label={w.modelName} hint={w.modelNameHint}>
                      <input value={m.name} onChange={(e) => image(m.id, { name: e.target.value })} />
                    </Row>
                    <Row label={w.description} hint={w.descriptionHint}>
                      <input value={m.description} onChange={(e) => image(m.id, { description: e.target.value })} />
                    </Row>
                    <Row label={w.isDefault} hint={w.isDefaultImageHint}>
                      <Switch
                        checked={m.id === catalog.defaultImage}
                        disabled={m.id === catalog.defaultImage}
                        onChange={() => change({ ...catalog, defaultImage: m.id })}
                      />
                    </Row>
                  </Group>
                  <Group title={w.connection}>
                    <Row label={w.sameAs} hint={w.sameAsHint}>
                      <select
                        value=""
                        onChange={(e) => {
                          const from = catalog.models.find((x) => x.id === e.target.value);
                          if (from)
                            image(m.id, {
                              channel: from.channel,
                              baseUrl: from.baseUrl,
                              credential: from.credential,
                              accountId: from.accountId,
                            });
                        }}
                      >
                        <option value="">{w.sameAsPick}</option>
                        {catalog.models.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </Row>
                    {connection(m, (p) => image(m.id, p), false)}
                  </Group>
                  <Group title={w.parameters}>
                    <Row label={w.model}>
                      <input
                        className={cx("mono")}
                        value={m.model}
                        onChange={(e) => image(m.id, { model: e.target.value })}
                      />
                    </Row>
                  </Group>
                  <footer className={cx("entry-foot")}>
                    <small>
                      {m.id === catalog.defaultImage
                        ? w.defaultKept
                        : catalog.images.length < 2
                          ? w.lastKept
                          : ""}
                    </small>
                    <button
                      className={cx("secondary small danger")}
                      disabled={catalog.images.length < 2 || m.id === catalog.defaultImage}
                      onClick={() => {
                        change({ ...catalog, images: catalog.images.filter((x) => x.id !== m.id) });
                        setEditing(undefined);
                      }}
                    >
                      <Trash2 size={14} />
                      {w.removeModel}
                    </button>
                  </footer>
                </Entry>
              ))}
            </ul>
          </section>
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
