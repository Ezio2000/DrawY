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
  Tags,
  ArrowUp,
  ArrowDown,
  Copy,
  Star,
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
  type ModelLabel,
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
          const holdsDefault = p.models.some(
            (m) =>
              m.id === chosen ||
              catalog.labels.some((l) => l.writer === m.id || l.image === m.id),
          );
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
                    const tiers = catalog.labels.filter(
                      (l) => l.writer === m.id || l.image === m.id,
                    );
                    const labelled = !!tiers.length;
                    const kept = isDefault || total < 2 || labelled;
                    return (
                      <Entry
                        key={m.id}
                        icon={<kind.icon size={15} />}
                        title={kind.label(p, m)}
                        detail={kind.detail(p, m)}
                        badges={
                          <>
                            {isDefault && <Badge tone="accent">{w.isDefault}</Badge>}
                            {labelled && (
                              <Badge tone="muted">
                                {w.usedBy(tiers.map((l) => l.name).join(t.now.list))}
                              </Badge>
                            )}
                          </>
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
                                : labelled
                                  ? w.labelKept
                                  : w.lastKept
                              : ""}
                          </small>
                          <span className={cx("tier-actions")}>
                          <button
                            className={cx("secondary small")}
                            onClick={() => {
                              const copy = { ...structuredClone(m), id: newId(m.id.split("-")[0] || "m"), name: m.name && w.copyOf(m.name) };
                              set(
                                list.map((x) =>
                                  x.id === p.id
                                    ? kind.settle({
                                        ...x,
                                        models: x.models.flatMap((y) => (y.id === m.id ? [y, copy] : [y])),
                                      })
                                    : x,
                                ),
                              );
                              setModel(copy.id);
                            }}
                          >
                            <Copy size={14} />
                            {w.duplicate}
                          </button>
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
                          </span>
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
        {m.protocol === "responses" && (
          <Row label={w.toolLimits} hint={w.toolLimitsHint}>
            <Switch
              checked={m.toolLimits}
              onChange={(on) => patch({ toolLimits: on })}
            />
          </Row>
        )}
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
        {m.speeds.length > 0 && (
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
      <Row label={w.priceTextInput} hint={w.priceTextInputHint}>
        <NumberField
          value={m.prices.textInput}
          set={(textInput) => set({ textInput })}
          unit="$ / 1M"
        />
      </Row>
      <Row label={w.priceImageInput} hint={w.priceImageInputHint}>
        <NumberField
          value={m.prices.imageInput}
          set={(imageInput) => set({ imageInput })}
          unit="$ / 1M"
        />
      </Row>
      <Row label={w.priceImageOutput} hint={w.priceImageOutputHint}>
        <NumberField
          value={m.prices.output}
          set={(output) => set({ output })}
          unit="$ / 1M"
        />
      </Row>
      <Row label={w.priceTextOutput} hint={w.priceTextOutputHint}>
        <NumberField
          value={m.prices.textOutput}
          set={(textOutput) => set({ textOutput })}
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

/** One choice among a few, the first standing for "whatever the model says", so a
 * choice with a single option can still be made and seen. */
function ChooseOrDefault<V extends string>({
  label,
  options,
  value,
  fallback,
  name,
  pick,
  offered,
}: {
  label: string;
  options: readonly V[];
  value?: V;
  /** What the model uses when nothing is chosen. */
  fallback: V;
  name: (v: V) => string;
  pick: (v?: V) => void;
  /** Options the model offers people now; the others are offered once picked. */
  offered: readonly V[];
}) {
  const t = useT(),
    w = t.settings;
  return (
    <Segmented label={label}>
      <button aria-pressed={value === undefined} onClick={() => pick(undefined)}>
        {w.modelDefault(name(fallback))}
      </button>
      {options.map((v) => (
        <button
          key={v}
          aria-pressed={value === v}
          data-off={!offered.includes(v) || undefined}
          data-tip={offered.includes(v) ? undefined : w.notOfferedYet}
          onClick={() => pick(v)}
        >
          {name(v)}
        </button>
      ))}
    </Segmented>
  );
}

/** The labels people pick beside the composer, each a whole combination of models that
 * only those who manage models see: people pick the name, never what is in it. Each shows
 * what is in it at a glance and what would keep it from working, and can be moved,
 * copied or made the default from its row. */
export function LabelSection({
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
  const list = catalog.labels;
  const writers = catalog.writers.flatMap((p) => p.models.map((m) => ({ p, m })));
  const painters = catalog.painters.flatMap((p) => p.models.map((m) => ({ p, m })));
  const webs = [OFF, BUILTIN, ...catalog.searches.map((s) => s.id)];
  const webName = (v: string) =>
    v === OFF
      ? t.composer.searchOff
      : v === BUILTIN
        ? t.composer.searchBuiltin
        : (catalog.searches.find((s) => s.id === v)?.name ?? v);
  const set = (labels: ModelLabel[], label = catalog.defaults.label, writers = catalog.writers) =>
    change({
      ...catalog,
      writers,
      labels,
      defaults: {
        ...catalog.defaults,
        label: labels.some((l) => l.id === label) ? label : (labels[0]?.id ?? ""),
      },
    });
  /** The drawing model with an option it did not offer people yet, now offered. */
  const offering = (id: string, patch: (m: WriterModel) => Partial<WriterModel>) =>
    catalog.writers.map((p) =>
      p.models.some((m) => m.id === id)
        ? settleProvider({
            ...p,
            models: p.models.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)),
          })
        : p,
    );
  const move = (i: number, by: number) => {
    const next = [...list];
    const [l] = next.splice(i, 1);
    next.splice(i + by, 0, l);
    set(next);
  };
  return (
    <section>
      <Head title={t.titles.labels} hint={w.labelsHint}>
        <button
          className={cx("secondary small")}
          onClick={() => {
            const id = newId("t");
            set([
              ...list,
              {
                id,
                name: w.labelNew(list.length + 1),
                description: "",
                writer: catalog.defaults.writer,
                web: catalog.defaults.web,
                image: catalog.defaults.image,
              },
            ]);
            setEditing(id);
          }}
        >
          <Plus size={15} />
          {w.addLabel}
        </button>
      </Head>
      {!list.length && <p className={cx("settings-empty")}>{w.noLabels}</p>}
      <ul className={cx("entries")}>
        {list.map((l, i) => {
          const patch = (p: Partial<ModelLabel>, writers?: WriterProvider[]) =>
            set(
              list.map((x) => (x.id === l.id ? { ...x, ...p } : x)),
              catalog.defaults.label,
              writers,
            );
          const writer = writers.find((x) => x.m.id === l.writer);
          const painter = painters.find((x) => x.m.id === l.image);
          const isDefault = l.id === catalog.defaults.label;
          const served = writer
            ? speedsOf({ channel: writer.p.channel, protocol: writer.m.protocol })
            : [];
          const builtinOk =
            !!writer?.m.builtinSearch &&
            offersBuiltinSearch({ channel: writer.p.channel, protocol: writer.m.protocol });
          // What would keep the tier from drawing, said on its row.
          const problems = [
            !writer && w.tierNoWriter,
            writer && !writer.p.credential && w.tierUnconnected(writer.p.name),
            writer && !writer.m.tools && w.tierNoTools,
            l.web === BUILTIN && !builtinOk && w.tierNoBuiltin,
          ].filter(Boolean) as string[];
          return (
            <Entry
              key={l.id}
              icon={<Tags size={16} />}
              title={l.name}
              detail={[
                writer ? writerLabel(writer.p, writer.m) : l.writer,
                l.effort && w.efforts[l.effort],
                l.speed && w.speeds[l.speed],
                webName(l.web),
                painter ? imageLabel(painter.p, painter.m) : l.image,
              ]
                .filter(Boolean)
                .join(" · ")}
              badges={
                <>
                  {isDefault && <Badge tone="accent">{w.labelIsDefault}</Badge>}
                  {!!problems.length && <Badge tone="warn">{w.tierUnready}</Badge>}
                </>
              }
              open={editing === l.id}
              toggle={() => setEditing(editing === l.id ? undefined : l.id)}
            >
              {!!problems.length && (
                <ul className={cx("tier-problems")}>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <div className={cx("tier-preview")}>
                <small>{w.tierPreview}</small>
                <span>
                  <b>{l.name || w.labelNew(i + 1)}</b>
                  {l.description && <em>{l.description}</em>}
                </span>
              </div>
              <Group title={w.basics}>
                <Row label={w.labelName} hint={w.labelNameHint}>
                  <input value={l.name} onChange={(e) => patch({ name: e.target.value })} />
                </Row>
                <Row label={w.description} hint={w.labelDescriptionHint}>
                  <input
                    value={l.description}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </Row>
              </Group>
              <Group title={w.labelModels}>
                <Row label={t.titles.author}>
                  <select
                    value={l.writer}
                    onChange={(e) =>
                      patch({ writer: e.target.value, effort: undefined, speed: undefined })
                    }
                  >
                    {catalog.writers.map((p) => (
                      <optgroup
                        key={p.id}
                        label={p.name + (p.credential ? "" : ` · ${t.composer.modelUnconnected}`)}
                      >
                        {p.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {writerLabel(p, m)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Row>
                {writer && writer.m.efforts.length > 0 && (
                  <Row label={w.effort} hint={w.tierOptionHint} wide>
                    <ChooseOrDefault
                      label={w.effort}
                      options={writer.m.efforts}
                      offered={writer.m.efforts}
                      value={l.effort}
                      fallback={writer.m.effort}
                      name={(v) => w.efforts[v]}
                      pick={(effort) => patch({ effort })}
                    />
                  </Row>
                )}
                {writer && served.length > 0 && (
                  <Row label={w.speed} hint={w.tierSpeedHint} wide>
                    <ChooseOrDefault
                      label={w.speed}
                      options={served}
                      offered={writer.m.speeds}
                      value={l.speed}
                      fallback={writer.m.speed}
                      name={(v) => w.speeds[v]}
                      pick={(speed) =>
                        patch(
                          { speed },
                          // A speed the model did not offer yet is offered from now on.
                          speed && !writer.m.speeds.includes(speed)
                            ? offering(writer.m.id, (m) => ({
                                speeds: served.filter((s) => s === speed || m.speeds.includes(s)),
                              }))
                            : undefined,
                        )
                      }
                    />
                  </Row>
                )}
                <Row label={t.titles.search} hint={builtinOk ? undefined : w.tierBuiltinHint} wide={crowded(webs)}>
                  <Choose
                    label={t.titles.search}
                    options={webs}
                    value={l.web}
                    name={webName}
                    disabled={(v) => v === BUILTIN && !builtinOk}
                    pick={(web) => patch({ web })}
                  />
                </Row>
                <Row label={t.titles.image}>
                  <select value={l.image} onChange={(e) => patch({ image: e.target.value })}>
                    {catalog.painters.map((p) => (
                      <optgroup
                        key={p.id}
                        label={p.name + (p.credential ? "" : ` · ${t.composer.modelUnconnected}`)}
                      >
                        {p.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {imageLabel(p, m)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Row>
              </Group>
              <footer className={cx("entry-foot tier-foot")}>
                <span className={cx("tier-actions")}>
                  <button
                    className={cx("secondary small")}
                    disabled={i === 0}
                    aria-label={w.moveUp}
                    data-tip={w.moveUp}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className={cx("secondary small")}
                    disabled={i === list.length - 1}
                    aria-label={w.moveDown}
                    data-tip={w.moveDown}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    className={cx("secondary small")}
                    onClick={() => {
                      const id = newId("t");
                      const next = [...list];
                      next.splice(i + 1, 0, { ...l, id, name: w.copyOf(l.name) });
                      set(next);
                      setEditing(id);
                    }}
                  >
                    <Copy size={14} />
                    {w.duplicate}
                  </button>
                  {!isDefault && (
                    <button className={cx("secondary small")} onClick={() => set(list, l.id)}>
                      <Star size={14} />
                      {w.makeDefault}
                    </button>
                  )}
                </span>
                <button
                  className={cx("secondary small danger")}
                  onClick={() => {
                    set(list.filter((x) => x.id !== l.id));
                    setEditing(undefined);
                  }}
                >
                  <Trash2 size={14} />
                  {w.removeLabel}
                </button>
              </footer>
            </Entry>
          );
        })}
      </ul>
    </section>
  );
}
