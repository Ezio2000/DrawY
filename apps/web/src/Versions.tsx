import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { ago } from "./time.ts";
import { useT } from "./i18n.tsx";

/** Every saved revision of the work, newest first; any earlier one can be brought back,
 * saved again as the newest. */
export function Versions({
  id,
  current,
  restore,
}: {
  id: string;
  current: number;
  restore: (revision: number) => void;
}) {
  const t = useT();
  const [rows, R] = useState<{ revision: number; updatedAt: number }[]>([]);
  useEffect(() => {
    void api("/works/" + id + "/revisions").then(R);
  }, [id, current]);
  return (
    <ol className={cx("history")}>
      {rows.map((r) => (
        <li key={r.revision} data-current={r.revision === current || undefined}>
          <span>{t.history.revision(r.revision)}</span>
          <small>{ago(r.updatedAt)}</small>
          {r.revision === current ? (
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
      ))}
    </ol>
  );
}
