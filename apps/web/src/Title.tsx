import { Lantern } from "@drawy/ui/brand";
import { cx } from "./cx.ts";
import { useT, type Words } from "./i18n.tsx";

/** A page or section title, set in the serif of the rest of the page. */
export function Title({
  name,
  size = "page",
}: {
  name: keyof Words["titles"];
  size?: "hero" | "page" | "section";
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
