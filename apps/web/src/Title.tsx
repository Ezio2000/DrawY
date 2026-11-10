import { Lantern } from "@drawy/ui/brand";
import { cx } from "./cx.ts";
import { useT, type Words } from "./i18n.tsx";

/** A page or section title. */
export function Title({
  name,
  size = "page",
}: {
  name: keyof Words["titles"];
  size?: "page" | "section";
}) {
  const t = useT();
  return (
    <span className={cx("title")} data-size={size}>
      {t.titles[name]}
    </span>
  );
}

/** The mark and the name. */
export function Brand({ size = 22 }: { size?: number }) {
  return (
    <span className={cx("brand")} style={{ fontSize: size * 0.95 }}>
      <Lantern size={size} />
      <b>DrawY</b>
    </span>
  );
}

/** The seal of a finished version: its number in a small square of vermilion, as a print
 * is stamped once it is done. `quiet` outlines it, for a version that is not the one in
 * hand; `fresh` presses it down, where the version was just made. The words that say
 * which version it is are beside it, so readers of the page's text are not told twice. */
export function Seal({
  version,
  quiet,
  fresh,
  size,
}: {
  version: number;
  quiet?: boolean;
  fresh?: boolean;
  size?: "large";
}) {
  return (
    <span
      className={cx("seal")}
      data-quiet={quiet || undefined}
      data-fresh={fresh || undefined}
      data-size={size}
      aria-hidden
    >
      {version}
    </span>
  );
}
