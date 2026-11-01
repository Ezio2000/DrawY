import { RotateCcw } from "lucide-react";
import { cx } from "./cx.ts";
import { ago } from "./time.ts";
import { useT } from "./i18n.tsx";
import type { RevisionSummary } from "../../../modules/contracts/index.ts";

/** The work's history as the steps that made it, newest first: each request to the author
 * (with every draft it saved), each hand edit and each restore. A step can be looked at on
 * the canvas, then brought back as the newest revision. */
export function Versions({
  history,
  current,
  previewing,
  look,
  restore,
}: {
  history: RevisionSummary[];
  current: number;
  previewing?: number;
  look: (revision: number) => void;
  restore: (revision: number) => void;
}) {
  const t = useT();
  const steps: RevisionSummary[] = [];
  for (const r of history) {
    const last = steps.at(-1);
    // History comes newest first; a request's earlier drafts join its latest one.
    if (
      last?.cause.kind === "run" &&
      r.cause.kind === "run" &&
      r.cause.runId === last.cause.runId
    )
      continue;
    steps.push(r);
  }
  const label = ({ cause }: RevisionSummary) =>
    cause.kind === "run"
      ? cause.prompt || t.history.pictures
      : cause.kind === "edit"
        ? t.history.edited
        : cause.kind === "restore"
          ? t.history.restored(cause.revision)
          : t.history.created;
  return (
    <ol className={cx("history")}>
      {steps.map((r) => {
        const now = r.revision === current;
        return (
          <li
            key={r.revision}
            data-current={now || undefined}
            data-previewing={r.revision === previewing || undefined}
            data-kind={r.cause.kind}
          >
            <button
              className={cx("history-look")}
              onClick={() => look(r.revision)}
            >
              <span>{label(r)}</span>
              <small>
                {t.history.revision(r.revision)} · {ago(r.updatedAt)}
              </small>
            </button>
            {now ? (
              <b>{t.history.current}</b>
            ) : (
              <button
                className={cx("history-restore")}
                aria-label={t.history.restore}
                data-tip={t.history.restore}
                onClick={() => restore(r.revision)}
              >
                <RotateCcw size={14} />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
