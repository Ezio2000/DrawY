import { useEffect, useState } from "react";
import { Dialog } from "@drawy/ui";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { ago } from "./time.ts";
import { Lettering } from "./Lettering.tsx";

/** Every saved revision of the work, newest first; any earlier one can be brought back. */
export function HistoryDialog({
  id,
  current,
  close,
  restore,
}: {
  id: string;
  current: number;
  close: () => void;
  restore: (revision: number) => void;
}) {
  const [rows, R] = useState<{ revision: number; updatedAt: number }[]>([]);
  useEffect(() => {
    void api("/works/" + id + "/revisions").then(R);
  }, [id]);
  return (
    <Dialog
      title="版本"
      heading={<Lettering name="history" height={44} />}
      description="每次落笔都会留下一稿。恢复会把那一稿另存为最新的一稿，之后的稿子都还在。"
      onClose={close}
    >
      <ol className={cx("history")}>
        {rows.map((r) => (
          <li key={r.revision} data-current={r.revision === current || undefined}>
            <span>第 {r.revision} 稿</span>
            <small>{ago(r.updatedAt)}</small>
            {r.revision === current ? (
              <b>当前</b>
            ) : (
              <button
                className={cx("secondary small")}
                onClick={() => restore(r.revision)}
              >
                恢复
              </button>
            )}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
