import { Check, FilePlus2, Hand, MessageSquareText, PencilLine, RotateCcw } from "lucide-react";
import { cx } from "./cx.ts";
import { Seal } from "./Title.tsx";
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
    case "save":
      return t.history.edited;
    case "restore": {
      const from = versionOf(versions, v.cause.revision);
      return from ? t.history.restored(from.number) : t.history.restoredSome;
    }
    default:
      return t.history.created;
  }
}

/** The work's versions, newest first: one for each request to the author (however many
 * drafts it saved on the way) and each set of hand edits saved as one, with the edits not
 * saved yet above them. Pressing one shows it on the canvas; going back to one makes it
 * the latest again, the versions after it leaving the list. */
export function Drafts({
  versions,
  unsaved,
  current,
  previewing,
  locked,
  look,
  restore,
  save,
  discard,
}: {
  /** Oldest first, as `historyOf` gives them. */
  versions: Version[];
  /** How many hand edits are not saved as a version yet. */
  unsaved: number;
  current: number;
  previewing?: number;
  /** Whether the work can be changed now; while the author works it cannot. */
  locked: boolean;
  look: (revision: number) => void;
  restore: (revision: number) => void;
  save: () => void;
  discard: () => void;
}) {
  const t = useT();
  if (!versions.length)
    return <p className={cx("journal-empty")}>{t.drafts.empty}</p>;
  const latest = versions.at(-1)!;
  return (
    <>
      <ol className={cx("drafts")}>
        {!!unsaved && (
          <li
            className={cx("drafts-version")}
            data-kind="unsaved"
            data-current={previewing === undefined || undefined}
          >
            <button
              className={cx("drafts-look")}
              aria-pressed={previewing === undefined}
              onClick={() => look(current)}
            >
              <i>
                <PencilLine size={13} />
              </i>
              <span>
                <b>{t.unsaved.row}</b>
                <q>{t.unsaved.rowHint(unsaved)}</q>
              </span>
            </button>
            <span className={cx("drafts-unsaved")}>
              <button className={cx("secondary small")} disabled={locked} onClick={discard}>
                {t.unsaved.discard}
              </button>
              <button className={cx("primary small")} disabled={locked} onClick={save}>
                <Check size={13} />
                {t.unsaved.saveShort}
              </button>
            </span>
          </li>
        )}
        {[...versions].reverse().map((v) => {
          const Icon =
            v.cause.kind === "run"
              ? MessageSquareText
              : v.cause.kind === "restore"
                ? RotateCcw
                : v.cause.kind === "save" || v.cause.kind === "edit"
                  ? Hand
                  : FilePlus2;
          const title = versionTitle(v, versions, t);
          // With edits not saved yet, the latest version is what they were made on.
          const now = v.revisions.includes(current) || (!!unsaved && v === latest);
          const shown =
            v.revision === previewing ||
            (now && !unsaved && previewing === undefined);
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
                onClick={() => look(now && !unsaved ? current : v.revision)}
              >
                {v.cause.kind === "create" ? (
                  <i>
                    <Icon size={13} />
                  </i>
                ) : (
                  <Seal version={v.number} quiet={!now} size="large" />
                )}
                <span>
                  <b>
                    {v.cause.kind === "create"
                      ? t.history.blank
                      : t.history.revision(v.number)}
                  </b>
                  <small>{ago(v.updatedAt)}</small>
                  {v.cause.kind !== "create" && (
                    <q title={title}>
                      <Icon size={12} />
                      {title}
                    </q>
                  )}
                </span>
              </button>
              {now && !unsaved ? (
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
