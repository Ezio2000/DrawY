import {
  Eye,
  FilePlus2,
  Hand,
  MessageSquareText,
  RotateCcw,
} from "lucide-react";
import { cx } from "./cx.ts";
import { ago } from "./time.ts";
import { useT } from "./i18n.tsx";
import type { RevisionSummary } from "../../../modules/contracts/index.ts";

/** Revisions that belong together: every draft one request to the author saved, or one
 * change made by hand, restored or the blank start. */
interface Group {
  key: string;
  cause: RevisionSummary["cause"];
  revisions: RevisionSummary[];
}

/** The work's drafts, newest first and grouped by the request that saved them, each to
 * look at on the canvas or bring back as the newest revision. */
export function Drafts({
  history,
  current,
  previewing,
  locked,
  look,
  restore,
}: {
  /** Newest first. */
  history: RevisionSummary[];
  current: number;
  previewing?: number;
  /** Whether the work can be changed now; while the author works it cannot. */
  locked: boolean;
  look: (revision: number) => void;
  restore: (revision: number) => void;
}) {
  const t = useT();
  const groups: Group[] = [];
  for (const r of history) {
    const last = groups.at(-1);
    if (
      last &&
      ((last.cause.kind === "run" &&
        r.cause.kind === "run" &&
        r.cause.runId === last.cause.runId) ||
        (last.cause.kind === "edit" && r.cause.kind === "edit"))
    )
      last.revisions.push(r);
    else
      groups.push({ key: String(r.revision), cause: r.cause, revisions: [r] });
  }
  if (!groups.length)
    return <p className={cx("journal-empty")}>{t.drafts.empty}</p>;
  return (
    <ol className={cx("drafts")}>
      {groups.map((g) => {
        const Icon =
          g.cause.kind === "run"
            ? MessageSquareText
            : g.cause.kind === "restore"
              ? RotateCcw
              : g.cause.kind === "edit"
                ? Hand
                : FilePlus2;
        const title =
          g.cause.kind === "run"
            ? g.cause.prompt || t.history.pictures
            : g.cause.kind === "edit"
              ? g.revisions.length > 1
                ? t.history.editedTimes(g.revisions.length)
                : t.history.edited
              : g.cause.kind === "restore"
                ? t.history.restored(g.cause.revision)
                : t.history.created;
        return (
          <li
            key={g.key}
            className={cx("drafts-group")}
            data-kind={g.cause.kind}
          >
            <header>
              <i>
                <Icon size={13} />
              </i>
              <span title={title}>{title}</span>
              <small>{ago(g.revisions[0].updatedAt)}</small>
            </header>
            <ul>
              {g.revisions.map((r) => {
                const now = r.revision === current;
                const shown =
                  r.revision === previewing ||
                  (now && previewing === undefined);
                return (
                  <li
                    key={r.revision}
                    data-current={now || undefined}
                    data-previewing={r.revision === previewing || undefined}
                  >
                    <button
                      className={cx("drafts-look")}
                      aria-pressed={shown}
                      data-tip={now ? undefined : t.history.look}
                      onClick={() => look(r.revision)}
                    >
                      <Eye size={13} />
                      <b>{t.history.revision(r.revision)}</b>
                      <small>{ago(r.updatedAt)}</small>
                    </button>
                    {now ? (
                      <em>{t.history.current}</em>
                    ) : (
                      <button
                        className={cx("drafts-restore")}
                        aria-label={t.history.restore}
                        data-tip={t.history.restore}
                        disabled={locked}
                        onClick={() => restore(r.revision)}
                      >
                        <RotateCcw size={13} />
                        <span>{t.history.restore}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
