import { cx } from "./cx.ts";

/** The lantern beside the name, drawn by hand: strokes that bow a little and run past
 * their corners, a candle, its flame and a few rays of light. */
export function Lantern({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={cx(`lantern${className ? ` ${className}` : ""}`)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className={cx("lantern-glow")} cx="12" cy="13.6" r="5.2" />
      <g className={cx("lantern-rays")}>
        <path d="M3.7 7.4c.6.2 1.1.5 1.6.9" />
        <path d="M20.4 7.2c-.6.2-1.1.6-1.5 1" />
        <path d="M5.1 3.6c.4.5.8 1.1 1.1 1.7" />
        <path d="M18.8 3.5c-.4.5-.7 1.1-1 1.8" />
      </g>
      <g className={cx("lantern-frame")}>
        <path d="M10.5 4.3c-.4-1.7 3.3-2 3.1-.2" />
        <path d="M8 6.6c1.2-1.6 6.7-1.7 8 0" />
        <path d="M6.9 6.9c3.4-.5 6.9-.4 10.3.2" />
        <path d="M8.4 7.4c-.8 3.7-.9 7.7-.3 11.5" />
        <path d="M15.7 7.3c.8 3.9.7 7.9.1 11.7" />
        <path d="M6.5 19.2c3.7-.6 7.5-.4 11.1.3" />
        <path d="M8.3 21.3c2.6.4 5.2.3 7.6-.3" />
      </g>
      <path
        className={cx("lantern-candle")}
        d="M10.7 16.7c.9-.2 1.8-.2 2.7 0l-.1 2.2c-.8.2-1.7.2-2.5 0z"
      />
      <path
        className={cx("lantern-flame")}
        d="M12.1 10c1.6 1.7 2.1 2.9 2 3.9a2 2 0 0 1-4 .1c-.1-1.1.5-2.4 2-4z"
      />
    </svg>
  );
}

/** A side panel: a page with a column along its left edge, the levels strung down it like
 * the drawing under the loupe. The column deepens while the panel is open. */
export function PanelMark({
  size = 24,
  open = false,
}: {
  size?: number;
  open?: boolean;
}) {
  return (
    <svg
      className={cx("hand-mark panel-mark")}
      data-open={open || undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        className={cx("mark-accent-fill")}
        d="M4.5 5.8c1.5-.1 3-.2 4.4-.2.2 4.3.2 8.6 0 12.9-1.5.1-2.9.1-4.4 0-.3-4.2-.3-8.5 0-12.7z"
      />
      <path d="M5.6 5.2C10.4 4.8 15.3 4.8 19.2 5.1Q20.3 5.2 20.3 6.3C20.5 10.2 20.5 14.1 20.3 18Q20.2 19.1 19.1 19.2C14.4 19.6 9.6 19.6 4.9 19.2Q3.9 19.1 3.8 18.1C3.6 14.2 3.6 10.3 3.9 6.3Q4 5.3 5.2 5.15L7.4 5.05" />
      <path d="M9.4 4.5C9.1 9.5 9.2 14.6 9.5 19.8" />
      <path
        className={cx("mark-accent")}
        d="M6.8 8.2C6.6 10.7 6.7 13.3 6.9 15.8"
      />
      <circle className={cx("mark-accent-dot")} cx="6.8" cy="8.2" r="1.1" />
      <circle className={cx("mark-accent-dot")} cx="6.75" cy="12" r="1.1" />
      <circle className={cx("mark-accent-dot")} cx="6.9" cy="15.8" r="1.1" />
    </svg>
  );
}
