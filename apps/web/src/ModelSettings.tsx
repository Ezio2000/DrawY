/* The models everyone draws, searches and paints with, as those who manage them edit them.
 *
 * Drawing and picture models are listed by provider: a provider is a connection (its
 * channel, address and credential), and under it the models it serves, each with the
 * options people may pick beside the composer and what it costs. Search services are a
 * list of their own, with the search everyone starts with. Which controls a model shows
 * is read from the specs in contracts, so a new channel, format or provider needs no
 * change here beyond its words. */
import { useRef, useState, type ReactNode } from "react";
import {
  PenTool,
  Image as ImageIcon,
  Globe,
  Plus,
  Trash2,
  Server,
} from "lucide-react";
import { Segmented, Switch } from "@drawy/ui";
import {
  BUILTIN,
  OFF,
  channels,
  channelSpecs,
  defaultImageModel,
  defaultWriter,
  efforts,
  endpointFor,
  imageLabel,
  offersBuiltinSearch,
  protocolFor,
  reconnect,
  searchProviders,
  searchProviderSpecs,
  searchReady,
  settleProvider,
  speedRates,
  speedsOf,
  writerLabel,
  type Channel,
  type Connection,
  type ImageModel,
  type ImageProvider,
  type ModelCatalog,
  type Protocol,
  type Provider,
  type SearchService,
  type WriterModel,
  type WriterProvider,
} from "../../../modules/contracts/index.ts";
import { cx } from "./cx.ts";
import { useT, type Words } from "./i18n.tsx";
import { useDismiss } from "./Rail.tsx";
import { Badge, Entry, Group, Head, Row, newId } from "./SettingsParts.tsx";

type W = Words["settings"];
type Patch<T> = (patch: Partial<T>) => void;

/** Choices that no longer fit beside their label go beneath it. */
const crowded = (options: readonly unknown[]) => options.length > 3;

/** One choice among a few, as a segmented control. */
function Choose<V extends string>({
  label,
  options,
  value,
  name,
  pick,
  disabled,
}: {
  label: string;
  options: readonly V[];
  value: V;
  name: (v: V) => string;
  pick: (v: V) => void;
  disabled?: (v: V) => boolean;
}) {
  return (
    <Segmented label={label}>
      {options.map((v) => (
        <button
          key={v}
          aria-pressed={value === v}
          disabled={disabled?.(v)}
          onClick={() => pick(v)}
        >
          {name(v)}
        </button>
      ))}
    </Segmented>
  );
}

/** Some of a few, as chips that toggle, kept in the order given. */
function Chips<V extends string>({
  label,
  options,
  value,
  name,
  pick,
}: {
  label: string;
  options: readonly V[];
  value: readonly V[];
  name: (v: V) => string;
  pick: (v: V[]) => void;
}) {
  return (
    <div className={cx("chips")} role="group" aria-label={label}>
      {options.map((v) => (
        <button
          key={v}
          aria-pressed={value.includes(v)}
          onClick={() =>
            pick(
              value.includes(v)
                ? value.filter((x) => x !== v)
                : options.filter((x) => x === v || value.includes(x)),
            )
          }
        >
          {name(v)}
        </button>
      ))}
    </div>
  );
}

/** A price or rate typed as text and kept as a number, so "0." can be typed on the way to
 * "0.25". */
function NumberField({
  value,
  set,
  unit,
  step = 0.01,
}: {
  value: number;
  set: (n: number) => void;
  unit?: string;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  const shown = Number(text) === value ? text : String(value);
  return (
    <span className={cx("number-field")}>
      <input
        className={cx("mono")}
        inputMode="decimal"
        type="number"
        min={0}
        step={step}
        value={shown}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0) set(n);
        }}
      />
      {unit && <small>{unit}</small>}
    </span>
  );
}

/** How a provider is reached: its name, channel, address, credential and account. */
function ConnectionFields<T extends Connection & { name: string }>({
  of,
  patch,
  w,
}: {
  of: T;
  patch: Patch<T>;
  w: W;
}) {
  const spec = channelSpecs[of.channel];
  return (
    <Group title={w.connection}>
      <Row label={w.providerName} hint={w.providerNameHint}>
        <input
          value={of.name}
          onChange={(e) => patch({ name: e.target.value } as Partial<T>)}
        />
      </Row>
      <Row label={w.channel}>
        <Choose
          label={w.channel}
          options={channels}
          value={of.channel}
          name={(c) => w.channels[c]}
          pick={(channel) => patch({ channel } as Partial<T>)}
        />
      </Row>
      <Row label={w.baseUrl}>
        <input
          className={cx("mono")}
          value={of.baseUrl}
          spellCheck={false}
          onChange={(e) => patch({ baseUrl: e.target.value } as Partial<T>)}
        />
      </Row>
      <Row label={w.credentials[of.channel]}>
        <input
          className={cx("mono")}
          type="password"
          autoComplete="off"
          value={of.credential}
          spellCheck={false}
          placeholder={w.credentialEmpty}
          onChange={(e) => patch({ credential: e.target.value } as Partial<T>)}
        />
      </Row>
      {spec.accountId && (
        <Row label={w.accountId}>
          <input
            className={cx("mono")}
            value={of.accountId || ""}
            spellCheck={false}
            onChange={(e) => patch({ accountId: e.target.value } as Partial<T>)}
          />
        </Row>
      )}
    </Group>
  );
}

/** Where a new provider starts: the common ones, and any other address. */
const presets = {
  openai: { name: "api", channel: "api", baseUrl: "https://api.openai.com/v1" },
  chatgpt: { name: "oauth", channel: "oauth", baseUrl: endpointFor("oauth") },
  anthropic: {
    name: "anthropic",
    channel: "api",
    baseUrl: "https://api.anthropic.com",
  },
  openrouter: {
    name: "openrouter",
    channel: "api",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  other: {
    name: "custom",
    channel: "api",
    baseUrl: "https://api.example.com/v1",
  },
} satisfies Record<string, { name: string; channel: Channel; baseUrl: string }>;
type Preset = keyof typeof presets;

/** Adding a provider, starting from one of the common ones. */
function AddProvider({ add, w }: { add: (preset: Preset) => void; w: W }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div className={cx("add-provider")} ref={ref}>
      <button
        className={cx("secondary small")}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Plus size={15} />
        {w.addProvider}
      </button>
      {open && (
        <div className={cx("popover")} role="menu">
          {(Object.keys(presets) as Preset[]).map((p) => (
            <button
              key={p}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                add(p);
              }}
            >
              <span>
                {w.presets[p]}
                <small>{presets[p].baseUrl}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What differs between the drawing and the picture models' sections. */
interface Kind<
  M extends { id: string; model: string; name: string; description: string },
> {
  icon: typeof PenTool;
  hint: string;
  defaultOf: (c: ModelCatalog) => string;
  withDefault: (c: ModelCatalog, id: string) => ModelCatalog;
  label: (p: Provider<M>, m: M) => string;
  /** A new model on a provider, from the one before it there or a fresh one. */
  create: (p: Provider<M>) => M;
  settle: (p: Provider<M>) => Provider<M>;
  /** The line under a model's name. */
  detail: (p: Provider<M>, m: M) => string;
  /** The model's settings past its basics. */
  groups: (p: Provider<M>, m: M, patch: Patch<M>) => ReactNode;
}

/** The providers of one kind of model, each opening to its connection and its models. */
function ProviderSection<
  M extends { id: string; model: string; name: string; description: string },
>({
  title,
  list,
  set,
  catalog,
  change,
  kind,
  editing,
  setEditing,
}: {
  title: string;
  list: Provider<M>[];
  set: (list: Provider<M>[], catalog?: ModelCatalog) => void;
  catalog: ModelCatalog;
  change: (catalog: ModelCatalog) => void;
  kind: Kind<M>;
  editing?: string;
  setEditing: (id?: string) => void;
}) {
  const t = useT(),
    w = t.settings;
  const chosen = kind.defaultOf(catalog);
  const total = list.reduce((n, p) => n + p.models.length, 0);
  const [model, setModel] = useState<string>();
  const patchProvider = (p: Provider<M>, patch: Partial<Provider<M>>) =>
    set(
      list.map((x) =>
        x.id === p.id
          ? kind.settle(reconnect(x, patch, protocolFor({ ...x, ...patch })))
          : x,
      ),
    );
  return (
    <section>
      <Head title={title} hint={kind.hint}>
        <AddProvider
          w={w}
          add={(preset) => {
            const id = newId("p");
            const p = {
              ...presets[preset],
              id,
              credential: "",
              models: [],
            } as Provider<M>;
            const first = kind.create(p);
            set([...list, { ...p, models: [first] }]);
            setEditing(id);
            setModel(first.id);
          }}
        />
      </Head>
      <ul className={cx("entries")}>
        {list.map((p) => {
          const holdsDefault = p.models.some((m) => m.id === chosen);
          return (
            <Entry
              key={p.id}
              icon={<Server size={16} />}
              title={p.name}
              detail={`${p.baseUrl} · ${w.modelsCount(p.models.length)}`}
              badges={
                <>
                  <Badge tone="muted">{w.channels[p.channel]}</Badge>
                  {!p.credential && (
                    <Badge tone="muted">{t.composer.modelUnconnected}</Badge>
                  )}
                </>
              }
              open={editing === p.id}
              toggle={() => setEditing(editing === p.id ? undefined : p.id)}
            >
              <ConnectionFields
                of={p}
                patch={(patch) => patchProvider(p, patch)}
                w={w}
              />
              <div className={cx("group")}>
                <h3>{w.providerModels}</h3>
                <ul className={cx("entries nested")}>
                  {p.models.map((m) => {
                    const isDefault = m.id === chosen;
                    const patch: Patch<M> = (mp) =>
                      set(
                        list.map((x) =>
                          x.id === p.id
                            ? kind.settle({
                                ...x,
                                models: x.models.map((y) =>
                                  y.id === m.id ? { ...y, ...mp } : y,
                                ),
                              })
                            : x,
                        ),
                      );
                    const kept = isDefault || total < 2;
                    return (
                      <Entry
                        key={m.id}
                        icon={<kind.icon size={15} />}
                        title={kind.label(p, m)}
                        detail={kind.detail(p, m)}
                        badges={
                          isDefault && (
                            <Badge tone="accent">{w.isDefault}</Badge>
                          )
                        }
                        open={model === m.id}
                        toggle={() =>
                          setModel(model === m.id ? undefined : m.id)
                        }
                      >
                        <Group title={w.basics}>
                          <Row label={w.model} hint={w.modelIdHint}>
                            <input
                              className={cx("mono")}
                              value={m.model}
                              spellCheck={false}
                              onChange={(e) =>
                                patch({ model: e.target.value } as Partial<M>)
                              }
                            />
                          </Row>
                          <Row label={w.modelName} hint={w.modelNameHint}>
                            <input
                              value={m.name}
                              placeholder={kind.label(p, { ...m, name: "" })}
                              onChange={(e) =>
                                patch({ name: e.target.value } as Partial<M>)
                              }
                            />
                          </Row>
                          <Row label={w.description} hint={w.descriptionHint}>
                            <input
                              value={m.description}
                              placeholder={w.descriptionExample}
                              onChange={(e) =>
                                patch({
                                  description: e.target.value,
                                } as Partial<M>)
                              }
                            />
                          </Row>
                          <Row label={w.isDefault} hint={w.isDefaultHint}>
                            <Switch
                              checked={isDefault}
                              disabled={isDefault}
                              onChange={() =>
                                change(kind.withDefault(catalog, m.id))
                              }
                            />
                          </Row>
                        </Group>
                        {kind.groups(p, m, patch)}
                        <footer className={cx("entry-foot")}>
                          <small>
                            {kept
                              ? isDefault
                                ? w.defaultKept
                                : w.lastKept
                              : ""}
                          </small>
                          <button
                            className={cx("secondary small danger")}
                            disabled={kept}
                            onClick={() =>
                              set(
                                list.map((x) =>
                                  x.id === p.id
                                    ? {
                                        ...x,
                                        models: x.models.filter(
                                          (y) => y.id !== m.id,
                                        ),
                                      }
                                    : x,
                                ),
                              )
                            }
                          >
                            <Trash2 size={14} />
                            {w.removeModel}
                          </button>
                        </footer>
                      </Entry>
                    );
                  })}
                </ul>
                <button
                  className={cx("secondary small add-model")}
                  onClick={() => {
                    const m = kind.create(p);
                    set(
                      list.map((x) =>
                        x.id === p.id ? { ...x, models: [...x.models, m] } : x,
                      ),
                    );
                    setModel(m.id);
                  }}
                >
                  <Plus size={14} />
                  {w.addModel}
                </button>
              </div>
              <footer className={cx("entry-foot")}>
                <small>{holdsDefault ? w.providerKept : ""}</small>
                <button
                  className={cx("secondary small danger")}
                  disabled={holdsDefault}
                  onClick={() => {
                    set(list.filter((x) => x.id !== p.id));
                    setEditing(undefined);
                  }}
                >
                  <Trash2 size={14} />
                  {w.removeProvider}
                </button>
              </footer>
            </Entry>
          );
        })}
      </ul>
    </section>
  );
}

/** Token prices, per million, at the default speed. */
function TokenPriceRows({
  prices,
  set,
  w,
  cacheWrite,
}: {
  prices: { input: number; cached: number; cacheWrite: number; output: number };
  set: (
    p: Partial<{
      input: number;
      cached: number;
      cacheWrite: number;
      output: number;
    }>,
  ) => void;
  w: W;
  cacheWrite: boolean;
}) {
  return (
    <>
      <Row label={w.priceInput} hint={w.perMillion}>
        <NumberField
          value={prices.input}
          set={(input) => set({ input })}
          unit="$ / 1M"
        />
      </Row>
      <Row label={w.priceCached} hint={w.priceCachedHint}>
        <NumberField
          value={prices.cached}
          set={(cached) => set({ cached })}
          unit="$ / 1M"
        />
      </Row>
      {cacheWrite && (
        <Row label={w.priceCacheWrite} hint={w.priceCacheWriteHint}>
          <NumberField
            value={prices.cacheWrite}
            set={(cacheWrite) => set({ cacheWrite })}
            unit="$ / 1M"
          />
        </Row>
      )}
      <Row label={w.priceOutput} hint={w.priceOutputHint}>
        <NumberField
          value={prices.output}
          set={(output) => set({ output })}
          unit="$ / 1M"
        />
      </Row>
    </>
  );
}

/** A drawing model's settings past its basics: its format, what it can do, the options
 * people may pick for it, and its prices. */
function writerGroups(
  p: WriterProvider,
  m: WriterModel,
  patch: Patch<WriterModel>,
  w: W,
) {
  const spec = channelSpecs[p.channel];
  const offered = offersBuiltinSearch({
    channel: p.channel,
    protocol: m.protocol,
  });
  const served = speedsOf({ channel: p.channel, protocol: m.protocol });
  return (
    <>
      <Group title={w.connection}>
        {spec.protocols.length > 1 && (
          <Row
            label={w.protocol}
            hint={w.protocolHints[m.protocol]}
            wide={crowded(spec.protocols)}
          >
            <Choose
              label={w.protocol}
              options={spec.protocols}
              value={m.protocol}
              name={(v) => w.protocols[v]}
              pick={(protocol: Protocol) =>
                patch({
                  protocol,
                  // A model newly on a format with speeds or a search of its own offers them.
                  speeds: m.speeds.length
                    ? m.speeds
                    : [...speedsOf({ channel: p.channel, protocol })],
                  builtinSearch:
                    m.builtinSearch ||
                    offersBuiltinSearch({ channel: p.channel, protocol }),
                })
              }
            />
          </Row>
        )}
        {spec.pinProvider && (
          <Row label={w.pinnedProvider} hint={w.pinnedProviderHint}>
            <input
              value={m.provider ?? ""}
              placeholder="anthropic"
              spellCheck={false}
              onChange={(e) =>
                patch({ provider: e.target.value.trim() || undefined })
              }
            />
          </Row>
        )}
      </Group>
      <Group title={w.abilities}>
        <Row label={w.vision} hint={w.visionHint}>
          <Switch checked={m.vision} onChange={(on) => patch({ vision: on })} />
        </Row>
        <Row label={w.tools} hint={w.toolsHint}>
          <Switch checked={m.tools} onChange={(on) => patch({ tools: on })} />
        </Row>
        <Row label={w.maxOutput} hint={w.maxOutputHint}>
          <NumberField
            value={m.maxOutput}
            step={1024}
            set={(n) => patch({ maxOutput: Math.round(n) })}
          />
        </Row>
      </Group>
      <Group title={w.userOptions}>
        <Row label={w.offeredEfforts} hint={w.offeredEffortsHint} wide>
          <Chips
            label={w.offeredEfforts}
            options={efforts}
            value={m.efforts}
            name={(v) => w.efforts[v]}
            pick={(list) => patch({ efforts: list })}
          />
        </Row>
        {m.efforts.length > 0 && (
          <Row
            label={w.effort}
            hint={w.defaultOptionHint}
            wide={crowded(m.efforts)}
          >
            <Choose
              label={w.effort}
              options={m.efforts}
              value={m.effort}
              name={(v) => w.efforts[v]}
              pick={(effort) => patch({ effort })}
            />
          </Row>
        )}
        <Row label={w.decisionUsesSetting} hint={w.decisionUsesSettingHint}>
          <Switch
            checked={m.decisionUsesSetting}
            onChange={(on) => patch({ decisionUsesSetting: on })}
          />
        </Row>
        {served.length > 0 && (
          <Row label={w.offeredSpeeds} hint={w.offeredSpeedsHint} wide>
            <Chips
              label={w.offeredSpeeds}
              options={served}
              value={m.speeds}
              name={(v) => w.speeds[v]}
              pick={(list) => patch({ speeds: list })}
            />
          </Row>
        )}
        {m.speeds.length > 1 && (
          <Row
            label={w.speed}
            hint={w.defaultOptionHint}
            wide={crowded(m.speeds)}
          >
            <Choose
              label={w.speed}
              options={m.speeds}
              value={m.speed}
              name={(v) => w.speeds[v]}
              pick={(speed) => patch({ speed })}
            />
          </Row>
        )}
        <Row
          label={w.builtinSearch}
          hint={offered ? w.builtinSearchHint : w.builtinSearchUnavailable}
        >
          <Switch
            checked={m.builtinSearch}
            disabled={!offered}
            onChange={(on) => patch({ builtinSearch: on })}
          />
        </Row>
      </Group>
      <Group title={w.pricing}>
        <TokenPriceRows
          prices={m.prices}
          set={(prices) => patch({ prices: { ...m.prices, ...prices } })}
          w={w}
          cacheWrite={m.protocol === "anthropic"}
        />
        {m.builtinSearch && (
          <Row label={w.priceBuiltinSearch} hint={w.priceBuiltinSearchHint}>
            <NumberField
              value={m.prices.search}
              set={(search) => patch({ prices: { ...m.prices, search } })}
              step={0.001}
              unit={w.perCall}
            />
          </Row>
        )}
        {m.speeds
          .filter((s) => s !== "default")
          .map((s) => (
            <Row
              key={s}
              label={w.speedRate(w.speeds[s])}
              hint={w.speedRateHint}
            >
              <NumberField
                value={m.speedRates[s] ?? speedRates[s]}
                step={0.1}
                set={(rate) =>
                  patch({ speedRates: { ...m.speedRates, [s]: rate } })
                }
                unit="×"
              />
            </Row>
          ))}
      </Group>
    </>
  );
}

/** A picture model's prices. */
function imageGroups(m: ImageModel, patch: Patch<ImageModel>, w: W) {
  const set = (prices: Partial<ImageModel["prices"]>) =>
    patch({ prices: { ...m.prices, ...prices } });
  return (
    <Group title={w.pricing}>
      <Row label={w.pricePerImage} hint={w.pricePerImageHint}>
        <NumberField
          value={m.prices.image}
          set={(image) => set({ image })}
          step={0.001}
          unit={w.perImage}
        />
      </Row>
      <Row label={w.priceImageInput} hint={w.perMillion}>
        <NumberField
          value={m.prices.input}
          set={(input) => set({ input })}
          unit="$ / 1M"
        />
      </Row>
      <Row label={w.priceImageOutput} hint={w.perMillion}>
        <NumberField
          value={m.prices.output}
          set={(output) => set({ output })}
          unit="$ / 1M"
        />
      </Row>
    </Group>
  );
}

/** The drawing models' providers. */
export function WriterSection({
  catalog,
  change,
  editing,
  setEditing,
}: {
  catalog: ModelCatalog;
  change: (catalog: ModelCatalog) => void;
  editing?: string;
  setEditing: (id?: string) => void;
}) {
  const t = useT(),
    w = t.settings;
  const kind: Kind<WriterModel> = {
    icon: PenTool,
    hint: w.modelsHint,
    defaultOf: (c) => c.defaults.writer,
    withDefault: (c, writer) => ({ ...c, defaults: { ...c.defaults, writer } }),
    label: writerLabel,
    create: (p) => {
      const protocol = p.models.at(-1)?.protocol ?? protocolFor(p);
      const base = p.models.at(-1) ?? defaultWriter(protocol);
      return {
        ...base,
        id: newId("m"),
        model: base.model,
        name: "",
        description: "",
        protocol,
      };
    },
    settle: (p) => settleProvider(p as WriterProvider),
    detail: (_, m) =>
      [m.model, w.protocols[m.protocol], m.description]
        .filter(Boolean)
        .join(" · "),
    groups: (p, m, patch) => writerGroups(p, m, patch, w),
  };
  return (
    <ProviderSection
      title={t.titles.author}
      list={catalog.writers}
      set={(writers) => change({ ...catalog, writers })}
      catalog={catalog}
      change={change}
      kind={kind}
      editing={editing}
      setEditing={setEditing}
    />
  );
}

/** The picture models' providers. */
export function ImageSection({
  catalog,
  change,
  editing,
  setEditing,
}: {
  catalog: ModelCatalog;
  change: (catalog: ModelCatalog) => void;
  editing?: string;
  setEditing: (id?: string) => void;
}) {
  const t = useT(),
    w = t.settings;
  const kind: Kind<ImageModel> = {
    icon: ImageIcon,
    hint: w.imageHint,
    defaultOf: (c) => c.defaults.image,
    withDefault: (c, image) => ({ ...c, defaults: { ...c.defaults, image } }),
    label: imageLabel,
    create: (p) => ({
      ...(p.models.at(-1) ?? defaultImageModel()),
      id: newId("i"),
      name: "",
      description: "",
    }),
    settle: (p) => p,
    detail: (_, m) => [m.model, m.description].filter(Boolean).join(" · "),
    groups: (_, m, patch) => imageGroups(m, patch, w),
  };
  return (
    <ProviderSection
      title={t.titles.image}
      list={catalog.painters}
      set={(painters) =>
        change({ ...catalog, painters: painters as ImageProvider[] })
      }
      catalog={catalog}
      change={change}
      kind={kind}
      editing={editing}
      setEditing={setEditing}
    />
  );
}

/** The search services, and how everyone searches until they pick otherwise. */
export function SearchSection({
  catalog,
  change,
  editing,
  setEditing,
}: {
  catalog: ModelCatalog;
  change: (catalog: ModelCatalog) => void;
  editing?: string;
  setEditing: (id?: string) => void;
}) {
  const t = useT(),
    w = t.settings;
  const list = catalog.searches;
  const set = (searches: SearchService[], web = catalog.defaults.web) =>
    change({ ...catalog, searches, defaults: { ...catalog.defaults, web } });
  const webs = [OFF, BUILTIN, ...list.map((s) => s.id)];
  return (
    <section>
      <Head title={t.titles.search} hint={w.searchHint}>
        <button
          className={cx("secondary small")}
          onClick={() => {
            const id = newId("s");
            set([
              ...list,
              {
                id,
                name: w.providers.deepseek,
                provider: "deepseek",
                baseUrl: searchProviderSpecs.deepseek.endpoint,
                credential: "",
                prices: { query: 0, page: 0 },
              },
            ]);
            setEditing(id);
          }}
        >
          <Plus size={15} />
          {w.addSearch}
        </button>
      </Head>
      <Group>
        <Row label={w.defaultWeb} hint={w.defaultWebHint} wide={crowded(webs)}>
          <Choose
            label={w.defaultWeb}
            options={webs}
            value={catalog.defaults.web}
            name={(v) =>
              v === OFF
                ? t.composer.searchOff
                : v === BUILTIN
                  ? t.composer.searchBuiltin
                  : (list.find((s) => s.id === v)?.name ?? v)
            }
            pick={(web) => set(list, web)}
          />
        </Row>
      </Group>
      {!list.length && <p className={cx("settings-empty")}>{w.noSearch}</p>}
      <ul className={cx("entries")}>
        {list.map((s) => {
          const patch = (p: Partial<SearchService>) =>
            set(
              list.map((x) =>
                x.id !== s.id
                  ? x
                  : {
                      ...x,
                      ...p,
                      // A service moved to another provider follows it to its address.
                      ...(p.provider &&
                      p.provider !== x.provider &&
                      p.baseUrl === undefined
                        ? { baseUrl: searchProviderSpecs[p.provider].endpoint }
                        : {}),
                    },
              ),
            );
          return (
            <Entry
              key={s.id}
              icon={<Globe size={16} />}
              title={s.name}
              detail={w.providers[s.provider]}
              badges={
                <>
                  {s.id === catalog.defaults.web && (
                    <Badge tone="accent">{w.isDefault}</Badge>
                  )}
                  {!searchReady(s) && (
                    <Badge tone="muted">{t.composer.modelUnconnected}</Badge>
                  )}
                </>
              }
              aside={<code className={cx("entry-code")}>{s.baseUrl}</code>}
              open={editing === s.id}
              toggle={() => setEditing(editing === s.id ? undefined : s.id)}
            >
              <Group title={w.connection}>
                <Row label={w.modelName} hint={w.serviceNameHint}>
                  <input
                    value={s.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </Row>
                <Row
                  label={w.provider}
                  hint={w.providerHints[s.provider]}
                  wide={crowded(searchProviders)}
                >
                  <Choose
                    label={w.provider}
                    options={searchProviders}
                    value={s.provider}
                    name={(v) => w.providers[v]}
                    pick={(provider) => patch({ provider })}
                  />
                </Row>
                <Row label={w.baseUrl}>
                  <input
                    className={cx("mono")}
                    value={s.baseUrl}
                    onChange={(e) => patch({ baseUrl: e.target.value })}
                  />
                </Row>
                <Row label="API Key">
                  <input
                    className={cx("mono")}
                    type="password"
                    autoComplete="off"
                    value={s.credential}
                    spellCheck={false}
                    placeholder={
                      searchProviderSpecs[s.provider].needsKey
                        ? w.credentialEmpty
                        : w.credentialOptional
                    }
                    onChange={(e) => patch({ credential: e.target.value })}
                  />
                </Row>
              </Group>
              <Group title={w.pricing}>
                <Row label={w.priceQuery} hint={w.priceQueryHint}>
                  <NumberField
                    value={s.prices.query}
                    step={0.001}
                    set={(query) => patch({ prices: { ...s.prices, query } })}
                    unit={w.perQuery}
                  />
                </Row>
                {searchProviderSpecs[s.provider].reads && (
                  <Row label={w.pricePage} hint={w.pricePageHint}>
                    <NumberField
                      value={s.prices.page}
                      step={0.001}
                      set={(page) => patch({ prices: { ...s.prices, page } })}
                      unit={w.perPage}
                    />
                  </Row>
                )}
              </Group>
              <footer className={cx("entry-foot")}>
                <small />
                <button
                  className={cx("secondary small danger")}
                  onClick={() => {
                    set(
                      list.filter((x) => x.id !== s.id),
                      catalog.defaults.web === s.id
                        ? OFF
                        : catalog.defaults.web,
                    );
                    setEditing(undefined);
                  }}
                >
                  <Trash2 size={14} />
                  {w.removeSearch}
                </button>
              </footer>
            </Entry>
          );
        })}
      </ul>
    </section>
  );
}
