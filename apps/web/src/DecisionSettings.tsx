import { Fragment } from "react";
import { readyWriter, type DecisionConfig, type Effort, type ModelCatalog } from "../../../modules/contracts/index.ts";
import { Chips, Group, Head, Row } from "./SettingsParts.tsx";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { Switch } from "./ui/primitives.tsx";

export function DecisionSettings({ catalog, change }: {
  catalog: ModelCatalog;
  change: (catalog: ModelCatalog) => void;
}) {
  const t = useT(), w = t.settings;
  const config = catalog.decision;
  const patch = (value: Partial<DecisionConfig>) => change({ ...catalog, decision: { ...config, ...value } });
  const select = (writer: string, levels: (Effort | undefined)[]) => {
    const kept = config.routes.filter((r) => r.writer !== writer || levels.includes(r.effort));
    const added = levels.filter((e) => !kept.some((r) => r.writer === writer && r.effort === e));
    patch({ routes: [...kept, ...added.map((effort) => ({ writer, effort, descriptions: [] }))] });
  };
  const providers = catalog.writers.map((provider) => ({
    provider,
    models: provider.models.filter((m) =>
      readyWriter(provider, m) || config.routes.some((r) => r.writer === m.id)),
  })).filter(({ models }) => models.length);
  return (
    <section>
      <Head title={t.titles.decision} hint={w.decisionHint} />
      <Group title={w.decisionApi}>
        <Row label={w.decisionEndpoint}>
          <input aria-label={w.decisionEndpoint} className={cx("mono")} spellCheck={false}
            value={config.endpoint} onChange={(e) => patch({ endpoint: e.target.value })} />
        </Row>
        <Row label={w.credentials.api}>
          <input aria-label={w.credentials.api} className={cx("mono")} autoComplete="off" spellCheck={false}
            value={config.credential} onChange={(e) => patch({ credential: e.target.value })} />
        </Row>
        <Row label={w.decisionModel} hint={w.decisionPricing}>
          <input aria-label={w.decisionModel} className={cx("mono")} spellCheck={false}
            value={config.model} onChange={(e) => patch({ model: e.target.value })} />
        </Row>
      </Group>
      <h3 className={cx("decision-heading")}>{w.decisionCandidates}</h3>
      {providers.length === 0 && <p className={cx("settings-empty")}>{w.noDrawingCandidates}</p>}
      {providers.map(({ provider, models }) => (
        <Group key={provider.id} title={provider.name}>
          {models.map((m) => {
            const routes = config.routes.filter((r) => r.writer === m.id);
            const enabled = routes.length > 0;
            const ready = readyWriter(provider, m);
            const name = m.name || m.model;
            const hint = [m.name && m.model, m.provider, !ready && w.decisionUnavailable].filter(Boolean).join(" · ");
            return (
              <Fragment key={m.id}>
                <Row label={name} hint={hint || undefined}>
                  <div className={cx("decision-options")}>
                    <Switch label={name} checked={enabled} onChange={(on) =>
                      select(m.id, on ? [m.efforts.length ? m.effort : undefined] : [])} />
                    {enabled && m.efforts.length > 0 && (
                      <Chips label={w.autoLevels + " · " + name} options={m.efforts} value={routes.flatMap((r) => r.effort ?? [])} required
                        name={(effort) => w.efforts[effort]} pick={(levels) => select(m.id, levels)} />
                    )}
                  </div>
                </Row>
                {routes.map((route) => {
                  const label = route.effort ? w.taskDescriptions + " · " + w.efforts[route.effort] : w.taskDescriptions;
                  return (
                    <Row key={route.effort ?? "default"} label={label} wide>
                      <textarea className={cx("decision-tasks")} aria-label={name + " · " + label}
                        rows={Math.max(2, route.descriptions.length)} placeholder={w.taskExample}
                        value={route.descriptions.join("\n")} onChange={(e) => patch({
                          routes: config.routes.map((r) => r === route ? { ...r, descriptions: e.target.value.split("\n") } : r),
                        })} />
                    </Row>
                  );
                })}
              </Fragment>
            );
          })}
        </Group>
      ))}
    </section>
  );
}
