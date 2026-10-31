import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Search, Upload, X } from "lucide-react";
import { Segmented, Spinner, reducedMotion, useLocale } from "@drawy/ui";
import type {
  Material,
  MaterialPage,
  StyleMaterial,
  DrawingMaterial,
  EffectMaterial,
} from "@drawy/materials/schema";
import { Canvas } from "../../../modules/canvas/index.ts";
import type { Work } from "../../../modules/contracts/index.ts";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { styleList } from "./Composer.tsx";
import { ago } from "./time.ts";
import { useT } from "./i18n.tsx";

const kinds = ["picture", "drawing", "effect", "style"] as const;
/** Soft grounds for the shelf, after the Anthropic palette: oat, cactus, heather, coral,
 * manilla, sky, clay and olive, each faded to a tint. */
const tints = [
  "#ece6da",
  "#dbe6e1",
  "#e2e1ec",
  "#f2e1df",
  "#f1e8d6",
  "#dfe7ef",
  "#f3e0d6",
  "#e3e8d8",
];
/** The material library: browse each kind, look closely at one, and use it. */
export function Library({
  use,
  action,
}: {
  /** Puts a material to use: attached to the next message. */
  use: (m: Material) => void;
  action: string;
}) {
  const t = useT(),
    locale = useLocale();
  const [q, Q] = useState(""),
    [kind, K] = useState<Material["kind"]>("picture"),
    [result, R] = useState<MaterialPage>({
      items: [],
      total: 0,
      page: 0,
      pages: 1,
    }),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [error, E] = useState(""),
    [open, O] = useState<Material>(),
    [styles, setStyles] = useState<StyleMaterial[]>([]),
    [uploading, U] = useState(false),
    [stamp, setStamp] = useState(0);
  useEffect(() => void styleList().then(setStyles, () => {}), []);
  useEffect(() => {
    const a = new AbortController();
    setLoading(true);
    E("");
    const t = setTimeout(
      () =>
        fetch(
          `/api/materials?q=${encodeURIComponent(q)}&page=${page}&kind=${kind}`,
          { signal: a.signal, headers: { "X-Drawy-Locale": locale } },
        )
          .then(async (r) => {
            if (!r.ok) throw Error((await r.json()).error);
            return r.json() as Promise<MaterialPage>;
          })
          .then((next) =>
            R((old) =>
              page > 1 ? { ...next, items: [...old.items, ...next.items] } : next,
            ),
          )
          .catch((e) => {
            if (!a.signal.aborted) E(e.message);
          })
          .finally(() => {
            if (!a.signal.aborted) setLoading(false);
          }),
      q ? 180 : 0,
    );
    return () => {
      clearTimeout(t);
      a.abort();
    };
  }, [q, page, kind, stamp, locale]);
  const styleName = (id: string | null) =>
    styles.find((s) => s.id === id)?.name[locale];
  async function upload(files: FileList) {
    U(true);
    E("");
    try {
      let last: Material | undefined;
      for (const file of Array.from(files)) {
        const data = new FormData();
        data.append("file", file);
        last = await api<Material>("/materials", "POST", data);
      }
      setPage(1);
      setStamp(stamp + 1);
      if (last) O(last);
    } catch (e) {
      E(e instanceof Error ? e.message : String(e));
    } finally {
      U(false);
    }
  }
  return (
    <div className={cx("library")}>
      <div className={cx("library-bar")}>
        <Segmented label={t.library.kind}>
          {kinds.map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => {
                K(k);
                setPage(1);
                O(undefined);
              }}
            >
              {t.library.kinds[k]}
            </button>
          ))}
        </Segmented>
        <label className={cx("page-search")}>
          <Search size={16} />
          <input
            placeholder={t.library.search}
            value={q}
            onChange={(e) => {
              Q(e.target.value);
              setPage(1);
            }}
          />
          {q && (
            <button aria-label={t.library.clear} onClick={() => (Q(""), setPage(1))}>
              <X size={14} />
            </button>
          )}
        </label>
        <label
          className={cx("secondary upload")}
          data-busy={uploading || undefined}
          aria-label={t.library.upload}
          data-tip={t.library.upload}
        >
          {uploading ? <Spinner size={15} /> : <Upload size={15} />}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className={cx("page-count")} aria-live="polite">
        {result.page > 0 && !loading && t.library.count(result.total)}
      </p>
      {error && (
        <p className={cx("error")} role="alert">
          {error}
        </p>
      )}
      <div
        className={cx("shelf")}
        data-kind={kind}
        aria-busy={(loading && page === 1) || undefined}
      >
        {result.items.map((m, i) => (
          <button
            key={m.id}
            className={cx("item")}
            aria-current={open?.id === m.id || undefined}
            style={{ "--tint": tints[i % tints.length] } as CSSProperties}
            onClick={() => O(m)}
          >
            <Look m={m} />
            <span className={cx("item-name")}>
              <b>{m.name[locale]}</b>
              <small>
                {m.kind === "picture"
                  ? styleName(m.style) || t.library.roles[m.role]
                  : m.kind === "style"
                    ? t.registers[m.register]
                    : m.name[locale === "zh" ? "en" : "zh"]}
              </small>
            </span>
          </button>
        ))}
        {!loading && !result.items.length && (
          <p className={cx("shelf-empty")}>{t.library.none(q)}</p>
        )}
      </div>
      {result.page < result.pages && result.page > 0 && (
        <button
          className={cx("secondary more")}
          disabled={loading}
          onClick={() => setPage(result.page + 1)}
        >
          {loading ? <Spinner size={15} /> : t.library.more}
        </button>
      )}
      {open && (
        <Inspector
          key={open.id}
          tint={
            tints[Math.max(0, result.items.findIndex((m) => m.id === open.id)) % tints.length]
          }
          m={open}
          styleName={styleName}
          close={() => O(undefined)}
          use={() => use(open)}
          action={action}
        />
      )}
    </div>
  );
}

/** What a material looks like: a picture, a style's samples, a drawing drawn from its
 * example, an effect on a swatch. */
function Look({ m, large = false }: { m: Material; large?: boolean }) {
  switch (m.kind) {
    case "picture":
      return (
        <span className={cx("look")} data-developing={m.status === "developing" || undefined}>
          <img
            src={large ? m.file.url : `/materials/thumbs/${m.id}?size=256`}
            alt=""
            loading="lazy"
          />
        </span>
      );
    case "style":
      return (
        <span className={cx("look samples")}>
          {(m.samples.length ? m.samples : [null])
            .slice(0, large ? 6 : 3)
            .map((id, i) =>
              id ? (
                <img
                  key={id}
                  src={`/materials/thumbs/${id}?size=256`}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <i key={i} />
              ),
            )}
        </span>
      );
    case "drawing":
      return <DrawingLook m={m} />;
    case "effect":
      return <EffectLook m={m} />;
  }
}
/** A drawing material drawn live from its example data. */
function DrawingLook({ m }: { m: DrawingMaterial }) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let view: Canvas | undefined,
      gone = false;
    void api<Work>(`/materials/${m.id}/preview`).then((work) => {
      if (gone || !host.current) return;
      view = new Canvas(host.current, work, work.scenes.root, {
        motion: !reducedMotion(),
        insets: { top: 14, bottom: 14 },
        open: () => {},
        select: () => {},
        error: () => {},
      });
    });
    return () => {
      gone = true;
      view?.dispose();
    };
  }, [m.id]);
  return <span className={cx("look drawn")} ref={host} />;
}
/** An effect applied to a swatch the way it is meant to be applied. */
function EffectLook({ m }: { m: EffectMaterial }) {
  const id = "look-" + m.id;
  const url = `url(#${id})`;
  return (
    <span className={cx("look")}>
      <svg viewBox="0 0 200 120" aria-hidden>
        <defs dangerouslySetInnerHTML={{ __html: m.defs.replaceAll("$id", id) }} />
        {m.apply === "marker" ? (
          <path
            d="M24 92C70 30 130 30 176 60"
            fill="none"
            stroke="#3b3632"
            strokeWidth="2.4"
            markerEnd={url}
          />
        ) : m.apply === "paint" ? (
          <ellipse cx="100" cy="60" rx="72" ry="42" fill={url} stroke="#3b3632" strokeWidth="1.6" />
        ) : (
          <g filter={url}>
            <ellipse cx="78" cy="62" rx="48" ry="38" fill="#d97757" />
            <rect x="104" y="34" width="66" height="54" rx="10" fill="#5b8a8f" />
          </g>
        )}
      </svg>
    </span>
  );
}

/** One material up close, with what it is and a way to use it. */
function Inspector({
  m,
  tint,
  styleName,
  close,
  use,
  action,
}: {
  m: Material;
  tint: string;
  styleName: (id: string | null) => string | undefined;
  close: () => void;
  use: () => void;
  action: string;
}) {
  const t = useT(),
    locale = useLocale(),
    f = t.library.facts;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, []);
  const facts: [string, string][] = [
    [f.kind, t.library.kinds[m.kind]],
    ...(m.kind === "picture"
      ? ([
          [f.role, t.library.roles[m.role]],
          [f.style, styleName(m.style) || f.any],
          [
            f.size,
            `${Math.round(m.form.width * m.form.content.width)} × ${Math.round(m.form.height * m.form.content.height)}`,
          ],
        ] as [string, string][])
      : []),
    ...(m.kind === "style"
      ? ([
          [f.fits, t.registers[m.register]],
          [f.pictures, f.picturesCount(m.count)],
        ] as [string, string][])
      : []),
    ...(m.kind === "drawing"
      ? ([
          [f.use, m.use === "link" ? f.link : f.module],
          [f.params, Object.keys(m.params).join(t.now.list)],
        ] as [string, string][])
      : []),
    [f.origin, t.library.origins[m.origin.kind]],
    [f.added, ago(m.origin.createdAt)],
    [f.used, f.usedCount(m.uses)],
  ];
  return (
    <aside className={cx("inspector")} aria-label={m.name[locale]}>
      <header>
        <div>
          <h2>{m.name[locale]}</h2>
          <p>{m.name[locale === "zh" ? "en" : "zh"]}</p>
        </div>
        <button className={cx("close-button")} aria-label={t.close} onClick={close}>
          <X size={15} />
        </button>
      </header>
      <div
        className={cx("inspector-look")}
        data-kind={m.kind}
        style={{ "--tint": tint } as CSSProperties}
      >
        <Look m={m} large />
      </div>
      {m.kind === "style" && (
        <div className={cx("swatches")}>
          {Object.entries(m.tokens)
            .filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(v))
            .map(([k, v]) => (
              <span key={k} title={`${k} ${v}`} style={{ background: v }} />
            ))}
        </div>
      )}
      <dl>
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className={cx("inspector-about")}>{m.about}</p>
      {m.origin.prompt && (
        <details className={cx("inspector-prompt")}>
          <summary>{t.library.prompt}</summary>
          <p>{m.origin.prompt}</p>
        </details>
      )}
      <footer>
        <code>{m.id}</code>
        <button
          className={cx("primary")}
          disabled={m.status !== "ready"}
          onClick={use}
        >
          {action}
        </button>
      </footer>
    </aside>
  );
}
