import { FilePlus2, Hand, MessageSquareText, RotateCcw } from "lucide-react";
import { cx } from "./cx.ts";
import { ago } from "./time.ts";
import { useT, type Words } from "./i18n.tsx";
import { versionOf, type Version } from "../../../modules/contracts/index.ts";

/** What a version came from, in the words the person used: what they asked, edits made by
 * hand, a version brought back, or the blank start. */
export function versionTitle(v: Version, versions: Version[], t: Words) {
  switch (v.cause.kind) {
    case "run":
      return v.cause.prompt || t.history.pictures;
    case "edit":
      return v.revisions.length > 1
        ? t.history.editedTimes(v.revisions.length)
        : t.history.edited;
    case "restore": {
      const from = versionOf(versions, v.cause.revision);
      return from ? t.history.restored(from.number) : t.history.restoredSome;
    }
    default:
      return t.history.created;
  }
}

/** The work's versions, newest first: one for each request to the author (however many
 * drafts it saved on the way), each run of hand edits and each restore. Pressing one shows
 * it on the canvas; restoring brings it back as the newest version. */
export function Drafts({
  versions,
  current,
  previewing,
  locked,
  look,
  restore,
}: {
  /** Oldest first, as `versionsOf` gives them. */
  versions: Version[];
  current: number;
  previewing?: number;
  /** Whether the work can be changed now; while the author works it cannot. */
  locked: boolean;
  look: (revision: number) => void;
  restore: (revision: number) => void;
}) {
  const t = useT();
  if (!versions.length)
    return <p className={cx("journal-empty")}>{t.drafts.empty}</p>;
  return (
    <>
      <p className={cx("drafts-hint")}>{t.drafts.hint}</p>
      <ol className={cx("drafts")}>
        {[...versions].reverse().map((v) => {
          const Icon =
            v.cause.kind === "run"
              ? MessageSquareText
              : v.cause.kind === "restore"
                ? RotateCcw
                : v.cause.kind === "edit"
                  ? Hand
                  : FilePlus2;
          const title = versionTitle(v, versions, t);
          const now = v.revisions.includes(current);
          const shown =
            v.revision === previewing || (now && previewing === undefined);
          return (
            <li
              key={v.revision}
              className={cx("drafts-version")}
              data-kind={v.cause.kind}
              data-current={now || undefined}
              data-previewing={v.revision === previewing || undefined}
            >
              <button
                className={cx("drafts-look")}
                aria-pressed={shown}
                data-tip={now ? undefined : t.history.look}
                onClick={() => look(v.revision)}
              >
                <i>
                  <Icon size={13} />
                </i>
                <span>
                  <b>
                    {v.cause.kind === "create"
                      ? t.history.blank
                      : t.history.revision(v.number)}
                  </b>
                  <small>{ago(v.updatedAt)}</small>
                  {v.cause.kind !== "create" && <q title={title}>{title}</q>}
                </span>
              </button>
              {now ? (
                <em>{t.history.current}</em>
              ) : (
                <button
                  className={cx("secondary small drafts-restore")}
                  disabled={locked}
                  data-tip={locked ? t.work.wait : undefined}
                  onClick={() => restore(v.revision)}
                >
                  <RotateCcw size={13} />
                  {t.history.restore}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
