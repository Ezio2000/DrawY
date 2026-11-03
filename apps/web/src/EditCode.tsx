import { useEffect, useRef, useState } from "react";
import { Check, GitFork, RotateCcw } from "lucide-react";
import { useLocale } from "@drawy/ui";
import {
  fork,
  setDrawing,
  setModule,
  syntaxError,
  useDrawing,
  usersOf,
} from "../../../modules/editing/index.ts";
import type { Instance, Work } from "../../../modules/contracts/index.ts";
import type { Material } from "@drawy/materials/schema";
import { api } from "./api.ts";
import { ownCopy, type Change } from "./handEdits.ts";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";

/* What the author writes as code, open to a person too: the code of the work's own
 * drawings and the values they let people change, a module written out in full, a
 * scene's interaction script and a detail's page. Code is kept only when it parses; the
 * work is checked as every write is. */

/** A field of code: Tab indents, ⌘Enter keeps it, Escape takes the change back. What
 * does not pass `check` is not kept, and says why. A draft belongs to what it edits:
 * give each field a key naming that record, so a draft is never kept onto another. */
export function Code({
  value,
  apply,
  check,
  rows = 8,
  label,
}: {
  value: string;
  /** Keeps the code; a thrown error is shown beside it. */
  apply: (code: string) => Promise<unknown> | void;
  check?: (code: string) => string | null;
  rows?: number;
  label: string;
}) {
  const t = useT();
  const [code, setCode] = useState(value);
  const [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  // A new revision of what is shown replaces the field while it is unchanged.
  const shown = useRef(value);
  useEffect(() => {
    if (code === shown.current) setCode(value);
    shown.current = value;
  }, [value]);
  const dirty = code !== value;
  const keep = async () => {
    // Nothing changed is nothing to keep: saving it would only make an empty revision.
    if (code === value) return;
    const problem = check?.(code) ?? null;
    if (problem) return setError(problem);
    try {
      setError("");
      await apply(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className={cx("code")}>
      <textarea
        ref={ref}
        aria-label={label}
        spellCheck={false}
        rows={rows}
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const el = e.currentTarget,
              { selectionStart: a, selectionEnd: b } = el;
            const next = code.slice(0, a) + "  " + code.slice(b);
            setCode(next);
            requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void keep();
          }
          if (e.key === "Escape") setCode(value);
        }}
      />
      {error && <p className={cx("code-error")}>{error}</p>}
      {dirty && (
        <div className={cx("code-actions")}>
          <button className={cx("secondary small")} onClick={() => setCode(value)}>
            <RotateCcw size={13} />
            {t.edit.code.revert}
          </button>
          <button className={cx("primary small")} onClick={() => void keep()}>
            <Check size={13} />
            {t.edit.code.apply}
          </button>
        </div>
      )}
    </div>
  );
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
function parsed(code: string): unknown {
  try {
    return JSON.parse(code);
  } catch (e) {
    throw Error((e as Error).message);
  }
}
const jsonError = (code: string) => {
  try {
    JSON.parse(code);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

/** The drawing a module is drawn with: which it is, another to draw it with, and, for a
 * drawing of the work's own, its code and the values it lets people change. A library
 * drawing or one other parts share is copied for this module before its code changes. */
export function DrawingPanel({
  work,
  sceneId,
  module,
  change,
  pick,
}: {
  work: Work;
  sceneId: string;
  module: Instance;
  change: Change;
  pick: (kind: "drawing", chosen: (m: Material) => void) => void;
}) {
  const t = useT(),
    locale = useLocale();
  const own = work.drawings[module.drawingId];
  const library = work.materials[module.drawingId];
  const users = usersOf(work, module.drawingId);
  const choices = [
    ...Object.values(work.drawings).map((d) => ({ id: d.id, name: d.name, own: true })),
    ...Object.values(work.materials).flatMap((m) =>
      m.kind === "drawing" ? [{ id: m.id, name: m.name, own: false }] : [],
    ),
  ];
  const FROM_LIBRARY = "\u0000library";
  const forkOwn = () =>
    void change(
      (w) =>
        fork(
          w,
          sceneId,
          [module.id],
          { name: own!.name, params: own!.params, source: own!.source },
          own!.id,
        ).edit,
    );
  const forkLibrary = async () => {
    const m = await api<Material>("/materials/" + module.drawingId);
    const copy = ownCopy(m, t, locale);
    await change((w) => fork(w, sceneId, [module.id], copy, module.drawingId).edit);
  };
  return (
    <div className={cx("fields")}>
      <label className={cx("field")}>
        <span className={cx("field-name")}>{t.edit.code.drawing}</span>
        <select
          className={cx("edit-select")}
          value={module.drawingId}
          onChange={(e) => {
            const id = e.target.value;
            if (id === FROM_LIBRARY)
              return pick("drawing", (m) =>
                void change((w) => useDrawing(w, sceneId, [module.id], m.id)),
              );
            void change((w) => useDrawing(w, sceneId, [module.id], id));
          }}
        >
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.own ? t.edit.code.own : t.edit.code.library}
            </option>
          ))}
          <option value={FROM_LIBRARY}>{t.edit.code.fromLibrary}</option>
        </select>
      </label>
      {library?.kind === "drawing" && (
        <div className={cx("edit-callout")}>
          <p>{t.edit.code.libraryNote}</p>
          <button className={cx("secondary small")} onClick={() => void forkLibrary()}>
            <GitFork size={13} />
            {t.edit.code.makeOwn}
          </button>
        </div>
      )}
      {own && (
        <>
          {users.length > 1 && (
            <div className={cx("edit-callout")}>
              <p>{t.edit.code.shared(users.length)}</p>
              <button className={cx("secondary small")} onClick={forkOwn}>
                <GitFork size={13} />
                {t.edit.code.onlyThis}
              </button>
            </div>
          )}
          <div className={cx("field")}>
            <span className={cx("field-name")}>{t.edit.code.source}</span>
            <Code
              key={"source:" + own.id}
              label={t.edit.code.source}
              value={own.source}
              rows={14}
              check={syntaxError}
              apply={(source) => change((w) => setDrawing(w, { ...w.drawings[own.id], source }))}
            />
          </div>
          <div className={cx("field")}>
            <span className={cx("field-name")}>{t.edit.code.params}</span>
            <Code
              key={"params:" + own.id}
              label={t.edit.code.params}
              value={json(own.params ?? {})}
              rows={6}
              check={jsonError}
              apply={(code) => {
                const params = parsed(code) as Record<string, never>;
                return change((w) =>
                  setDrawing(w, {
                    ...w.drawings[own.id],
                    params: Object.keys(params).length ? params : undefined,
                  }),
                );
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** A module written out in full, as the author writes it: its name, place, drawing,
 * group, where it leads, its anchors and all its data. */
export function ModuleRecord({
  work,
  sceneId,
  module,
  change,
}: {
  work: Work;
  sceneId: string;
  module: Instance;
  change: Change;
}) {
  const t = useT();
  const { id: _id, ...record } = module;
  return (
    <Code
      label={t.edit.code.record}
      value={json(record)}
      rows={12}
      check={jsonError}
      apply={(code) => change((w) => setModule(w, sceneId, module.id, parsed(code)))}
    />
  );
}
