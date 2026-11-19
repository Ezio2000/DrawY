import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft } from "lucide-react";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import type { RequestDraft } from "./session/request.ts";
import { useSelect } from "./session/store.ts";
import { Specimen, type SpecimenKind } from "./Specimens.tsx";
import { Brand } from "./Title.tsx";

const kinds: SpecimenKind[] = ["solar", "model", "kin"];
/** The painted subject that stands for each drawing where there is no room for it. */
const subjects: Record<SpecimenKind, string> = { solar: "sun", model: "brain", kin: "youth" };

/** The sheet a work starts on, before its first line: the drawing board, squared and
 * ruled, with what DrawY makes of a request lettered on it once in large type, a few
 * requests to try, and, pencilling itself in beside them, the drawing the one pointed at
 * would give, which the rulers cast. Nothing on it explains itself in words. A request
 * picked is written into the composer to finish and send, not sent; once the person
 * writes their own, the sample steps back under the paper. Where hands draw (the desktop
 * page), the board's tools lie beside it, and taking one up starts drawing by hand.
 *
 * It lies over the canvas between the title and the composer, keeping clear of the
 * composer as that grows. It reads only whether the request is the person's own, so
 * typing draws it again only when that changes. */
export function Opening({
  draft,
  tray,
  place,
}: {
  draft: RequestDraft;
  /** The board's tools, where the page draws by hand. */
  tray?: ReactNode;
  place: "desk" | "phone";
}) {
  const t = useT().opening;
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const pointing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const own = useSelect(draft, (r) => {
    const text = r.text.trim();
    return !!text && !t.asks.some((a) => a.text === text);
  });
  // The sheet keeps clear of the composer and what sits over it, as they change size.
  useLayoutEffect(() => {
    const el = ref.current;
    let stage = el?.parentElement;
    while (stage && !stage.querySelector("[data-dock]")) stage = stage.parentElement;
    const dock = stage?.querySelector<HTMLElement>("[data-dock]");
    if (!el || !stage || !dock) return;
    const clear = () =>
      el.style.setProperty(
        "--clear",
        Math.max(0, Math.round(stage.getBoundingClientRect().bottom - dock.getBoundingClientRect().top)) + "px",
      );
    clear();
    const watch = new ResizeObserver(clear);
    watch.observe(dock);
    watch.observe(stage);
    return () => watch.disconnect();
  }, []);
  useEffect(() => () => clearTimeout(pointing.current), []);
  /** Shows the drawing for a request; a pointer passing over on its way elsewhere does not. */
  const point = (i: number, now = false) => {
    clearTimeout(pointing.current);
    if (now) setShown(i);
    else pointing.current = setTimeout(() => setShown(i), 90);
  };
  return (
    <>
      {tray}
      <div
        ref={ref}
        className={cx("opening")}
        data-opening
        data-place={place}
        data-own={own || undefined}
      >
      <div className={cx("opening-layout")}>
        <header className={cx("opening-copy")}>
          <Brand size={19} />
          <h1>
            <span>{t.head}</span>
            <span>
              {t.tail[0]}
              <span className={cx("opening-mark")}>
                {t.tail[1]}
                <svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden>
                  <path d="M1.5 8.2C18 5.6 34 9.4 52 6.9S84 5.2 98.5 7.4" pathLength={1} />
                </svg>
              </span>
              {t.tail[2]}
            </span>
          </h1>
        </header>
        <figure className={cx("specimen")}>
          <Specimen key={kinds[shown]} kind={kinds[shown]} label={t.sampleOf(t.asks[shown].ask)} />
        </figure>
        <section className={cx("opening-asks")} aria-label={t.try}>
          <ul>
            {t.asks.map((a, i) => (
              <li key={a.text}>
                <button
                  data-shown={i === shown || undefined}
                  onPointerEnter={() => point(i)}
                  onPointerLeave={() => clearTimeout(pointing.current)}
                  onFocus={() => point(i, true)}
                  onClick={() => {
                    point(i, true);
                    draft.hand(a.text);
                  }}
                >
                  <i aria-hidden />
                  <img
                    className={cx("opening-subject")}
                    src={`/materials/thumbs/${subjects[kinds[i]]}?size=128`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span>
                    <b>{a.ask}</b>
                    <small>{a.who}</small>
                  </span>
                  <CornerDownLeft className={cx("opening-use")} size={15} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
    </>
  );
}
