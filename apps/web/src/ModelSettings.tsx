/* The models everyone draws, searches and paints with, as those who manage them edit them.
 *
 * Each part of the catalog (drawing models, search services, picture models) is described
 * once, as a `Part`, and one section lists, adds, edits and removes any of them. Which
 * controls a model shows is read from the specs in contracts: a connection's channel,
 * format, speeds, account ID and provider pinning appear only where they apply, so a new
 * channel, format or provider needs no change here beyond its words. */
import type { ReactNode } from "react";
import { PenTool, Image as ImageIcon, Globe, Plus, Trash2, type LucideIcon } from "lucide-react";
import { Segmented, Switch } from "@drawy/ui";
import {
  catalogParts,
  channels,
  channelSpecs,
  efforts,
  offersBuiltinSearch,
  reconnect,
  searchModes,
  searchProviders,
  searchProviderSpecs,
  searchReady,
  settleRole,
  speedsOf,
  type CatalogPart,
  type Connection,
  type ImageOption,
  type ModelCatalog,
  type ModelOption,
  type Protocol,
  type SearchService,
} from "../../../modules/contracts/index.ts";
import { cx } from "./cx.ts";
import { useT, type Words } from "./i18n.tsx";
import { Badge, Entry, Group, Head, Row, newId } from "./SettingsParts.tsx";

type W = Words["settings"];
type Item = { id: string; name: string; description?: string };
type Patch<T> = (patch: Partial<T>) => void;

/** One part of the catalog as the settings page edits it. */
interface Part<T extends Item> {
  icon: LucideIcon;
  /** The words for its section, its entries and its default. */
  words: {
    hint: string;
    add: string;
    remove: string;
    empty?: string;
    isDefault: string;
    isDefaultHint: string;
    nameHint: string;
    descriptionExample?: string;
  };
  /** Whether it has a line describing it. */
  described: boolean;
  /** A new entry, given what is there already. */
  create(catalog: ModelCatalog, id: string): T;
  /** One changed by hand, with what its connection cannot offer let go at once. */
  settle(before: T, patch: Partial<T>): T;
  ready(m: T): boolean;
  detail(m: T): string;
  aside(m: T): string;
  /** Its settings after the basics, as groups. */
  groups(m: T, patch: Patch<T>, catalog: ModelCatalog): ReactNode;
}

/** The section for one part: its entries, each opening to its settings, and adding and
 * removing them. A part that must have a default keeps at least one, and its default. */
export function CatalogSection<K extends CatalogPart>({
  part: key,
  title,
  catalog,
  change,
  editing,
  setEditing,
}: {
  part: K;
  title: string;
  catalog: ModelCatalog;
  change: (catalog: ModelCatalog) => void;
  editing?: string;
  setEditing: (id?: string) => void;
}) {
  const t = useT(),
    w = t.settings;
  const part = parts(w)[key] as unknown as Part<Item>;
  const { default: defaultKey, required } = catalogParts[key];
  const list = catalog[key] as Item[],
    chosen = catalog[defaultKey] as string | null;
  const set = (next: Item[], fallback: string | null = chosen) =>
    change({ ...catalog, [key]: next, [defaultKey]: fallback });
  const Icon = part.icon;
  return (
    <section>
      <Head title={title} hint={part.words.hint}>
        <button
          className={cx("secondary small")}
          onClick={() => {
            const id = newId(key[0]);
            set([...list, part.create(catalog, id)], chosen ?? id);
            setEditing(id);
          }}
        >
          <Plus size={15} />
          {part.words.add}
        </button>
      </Head>
      {!list.length && part.words.empty && (
        <p className={cx("settings-empty")}>{part.words.empty}</p>
      )}
      <ul className={cx("entries")}>
        {list.map((m) => {
          const isDefault = m.id === chosen;
          const patch = (p: Partial<Item>) =>
            set(list.map((x) => (x.id === m.id ? part.settle(x, p) : x)));
          const kept = required && (isDefault || list.length < 2);
          return (
            <Entry
              key={m.id}
              icon={<Icon size={16} />}
              title={m.name}
              detail={part.detail(m)}
              badges={
                <>
                  {isDefault && <Badge tone="accent">{part.words.isDefault}</Badge>}
                  {!part.ready(m) && <Badge tone="muted">{t.composer.modelUnconnected}</Badge>}
                </>
              }
              aside={<code className={cx("entry-code")}>{part.aside(m)}</code>}
              open={editing === m.id}
              toggle={() => setEditing(editing === m.id ? undefined : m.id)}
            >
              <Group title={w.basics}>
                <Row label={w.modelName} hint={part.words.nameHint}>
                  <input value={m.name} onChange={(e) => patch({ name: e.target.value })} />
                </Row>
                {part.described && (
                  <Row label={w.description} hint={w.descriptionHint}>
                    <input
                      value={m.description ?? ""}
                      placeholder={part.words.descriptionExample}
                      onChange={(e) => patch({ description: e.target.value })}
                    />
                  </Row>
                )}
                <Row label={part.words.isDefault} hint={part.words.isDefaultHint}>
                  <Switch
                    checked={isDefault}
                    disabled={isDefault}
                    onChange={() => set(list, m.id)}
                  />
                </Row>
              </Group>
              {part.groups(m, patch, catalog)}
              <footer className={cx("entry-foot")}>
                <small>{kept ? (isDefault ? w.defaultKept : w.lastKept) : ""}</small>
                <button
                  className={cx("secondary small danger")}
                  disabled={kept}
                  onClick={() => {
                    const rest = list.filter((x) => x.id !== m.id);
                    set(rest, isDefault ? (rest[0]?.id ?? null) : chosen);
                    setEditing(undefined);
                  }}
                >
                  <Trash2 size={14} />
                  {part.words.remove}
                </button>
              </footer>
            </Entry>
          );
        })}
      </ul>
    </section>
  );
}

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
        <button key={v} aria-pressed={value === v} disabled={disabled?.(v)} onClick={() => pick(v)}>
          {name(v)}
        </button>
      ))}
    </Segmented>
  );
}

/** How a model is reached: its channel and format, its address, credential and model ID,
 * with only what that channel and format take. */
function ConnectionFields<
  T extends Connection & { model: string; protocol?: Protocol; provider?: string },
>({ of, patch, w, before }: { of: T; patch: Patch<T>; w: W; before?: ReactNode }) {
  const spec = channelSpecs[of.channel];
  return (
    <Group title={w.connection}>
      {before}
      <Row label={w.channel}>
        <Choose
          label={w.channel}
          options={channels}
          value={of.channel}
          name={(c) => w.channels[c]}
          pick={(channel) => patch({ channel } as Partial<T>)}
        />
      </Row>
      {of.protocol && spec.protocols.length > 1 && (
        <Row
          label={w.protocol}
          hint={w.protocolHints[of.protocol]}
          wide={crowded(spec.protocols)}
        >
          <Choose
            label={w.protocol}
            options={spec.protocols}
            value={of.protocol}
            name={(p) => w.protocols[p]}
            pick={(protocol) => patch({ protocol } as Partial<T>)}
          />
        </Row>
      )}
      <Row label={w.baseUrl}>
        <input value={of.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value } as Partial<T>)} />
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
      <Row label={w.model} hint={w.modelIdHint}>
        <input
          className={cx("mono")}
          value={of.model}
          spellCheck={false}
          onChange={(e) => patch({ model: e.target.value } as Partial<T>)}
        />
      </Row>
      {of.protocol && spec.pinProvider && (
        <Row label={w.pinnedProvider} hint={w.pinnedProviderHint}>
          <input
            value={of.provider ?? ""}
            placeholder="anthropic"
            spellCheck={false}
            onChange={(e) => patch({ provider: e.target.value || undefined } as Partial<T>)}
          />
        </Row>
      )}
    </Group>
  );
}

/** A drawing model's own settings: what it can do, how hard it thinks, and its output. */
function drawingGroups(m: ModelOption, patch: Patch<ModelOption>, w: W) {
  const offered = offersBuiltinSearch(m),
    speeds = speedsOf(m);
  return (
    <>
      <ConnectionFields of={m} patch={patch} w={w} />
      <Group title={w.abilities}>
        <Row label={w.vision} hint={w.visionHint}>
          <Switch checked={m.vision} onChange={(on) => patch({ vision: on })} />
        </Row>
        <Row label={w.tools} hint={w.toolsHint}>
          <Switch checked={m.tools} onChange={(on) => patch({ tools: on })} />
        </Row>
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
        <Row label={w.defaultSearch} hint={w.defaultSearchHint}>
          <Choose
            label={w.defaultSearch}
            options={searchModes}
            value={m.search}
            name={(v) => w.searchModes[v]}
            disabled={(v) => v === "builtin" && !m.builtinSearch}
            pick={(search) => patch({ search })}
          />
        </Row>
      </Group>
      <Group title={w.reasoning}>
        <Row label={w.acceptedEfforts} hint={w.acceptedEffortsHint} wide>
          <div className={cx("chips")} role="group" aria-label={w.acceptedEfforts}>
            {efforts.map((v) => (
              <button
                key={v}
                aria-pressed={m.efforts.includes(v)}
                onClick={() =>
                  patch({
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
        <Row label={w.effort} wide={crowded(m.efforts.length ? m.efforts : efforts)}>
          <Choose
            label={w.effort}
            options={m.efforts.length ? m.efforts : efforts}
            value={m.effort}
            name={(v) => w.efforts[v]}
            pick={(effort) => patch({ effort })}
          />
        </Row>
        <Row label={w.decisionUsesSetting} hint={w.decisionUsesSettingHint}>
          <Switch
            checked={m.decisionUsesSetting}
            onChange={(on) => patch({ decisionUsesSetting: on })}
          />
        </Row>
      </Group>
      <Group title={w.parameters}>
        {speeds.length > 0 && (
          <Row label={w.speed} hint={w.speedHints[m.speed]} wide={crowded(speeds)}>
            <Choose
              label={w.speed}
              options={speeds}
              value={m.speed}
              name={(v) => w.speeds[v]}
              pick={(speed) => patch({ speed })}
            />
          </Row>
        )}
        <Row label={w.maxOutput} hint={w.maxOutputHint}>
          <input
            className={cx("mono")}
            type="number"
            min={1024}
            step={1024}
            value={m.maxOutput}
            onChange={(e) => patch({ maxOutput: Math.round(Number(e.target.value) || 0) })}
          />
        </Row>
      </Group>
    </>
  );
}

/** Every part of the catalog, in the reader's words. */
const parts = (w: W): { [K in CatalogPart]: Part<ModelCatalog[K][number]> } => ({
  models: {
    icon: PenTool,
    words: {
      hint: w.modelsHint,
      add: w.addModel,
      remove: w.removeModel,
      isDefault: w.isDefault,
      isDefaultHint: w.isDefaultHint,
      nameHint: w.modelNameHint,
      descriptionExample: w.descriptionExample,
    },
    described: true,
    // A new model starts from the default one's connection, so adding another model of
    // the same account takes only its name.
    create: (c, id) => ({
      ...(c.models.find((m) => m.id === c.default) ?? c.models[0]),
      id,
      name: w.newModel,
      description: "",
    }),
    settle: (before, patch) => settleRole(reconnect(before, patch)),
    ready: (m) => !!m.credential,
    detail: (m) => m.description || m.model,
    aside: (m) => `${m.model} · ${w.efforts[m.effort]} · ${w.searchModesShort[m.search]}`,
    groups: (m, patch) => drawingGroups(m, patch, w),
  },
  searches: {
    icon: Globe,
    words: {
      hint: w.searchHint,
      add: w.addSearch,
      remove: w.removeSearch,
      empty: w.noSearch,
      isDefault: w.isDefaultService,
      isDefaultHint: w.defaultSearchServiceHint,
      nameHint: w.serviceNameHint,
    },
    described: false,
    create: (_, id): SearchService => ({
      id,
      name: w.providers.deepseek,
      provider: "deepseek",
      baseUrl: searchProviderSpecs.deepseek.endpoint,
      credential: "",
    }),
    // A service moved to another provider follows it to its address.
    settle: (before, patch) => ({
      ...before,
      ...patch,
      ...(patch.provider && patch.provider !== before.provider && patch.baseUrl === undefined
        ? { baseUrl: searchProviderSpecs[patch.provider].endpoint }
        : {}),
    }),
    ready: searchReady,
    detail: (m) => w.providers[m.provider],
    aside: (m) => m.baseUrl,
    groups: (m, patch) => (
      <Group title={w.connection}>
        <Row label={w.provider} hint={w.providerHints[m.provider]} wide={crowded(searchProviders)}>
          <Choose
            label={w.provider}
            options={searchProviders}
            value={m.provider}
            name={(v) => w.providers[v]}
            pick={(provider) => patch({ provider })}
          />
        </Row>
        <Row label={w.baseUrl}>
          <input value={m.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} />
        </Row>
        <Row label="API Key">
          <input
            className={cx("mono")}
            type="password"
            autoComplete="off"
            value={m.credential}
            spellCheck={false}
            placeholder={
              searchProviderSpecs[m.provider].needsKey ? w.credentialEmpty : w.credentialOptional
            }
            onChange={(e) => patch({ credential: e.target.value })}
          />
        </Row>
      </Group>
    ),
  },
  images: {
    icon: ImageIcon,
    words: {
      hint: w.imageHint,
      add: w.addImage,
      remove: w.removeImage,
      isDefault: w.isDefault,
      isDefaultHint: w.isDefaultImageHint,
      nameHint: w.modelNameHint,
    },
    described: true,
    create: (c, id): ImageOption => ({
      ...(c.images.find((m) => m.id === c.defaultImage) ?? c.images[0]),
      id,
      name: w.newImage,
      description: "",
    }),
    settle: reconnect,
    ready: (m) => !!m.credential,
    detail: (m) => m.description || m.model,
    aside: (m) => m.model,
    groups: (m, patch, catalog) => (
      <ConnectionFields
        of={m}
        patch={patch}
        w={w}
        before={
          <Row label={w.sameAs} hint={w.sameAsHint}>
            <select
              value=""
              onChange={(e) => {
                const from = catalog.models.find((x) => x.id === e.target.value);
                if (from)
                  patch({
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
        }
      />
    ),
  },
});
