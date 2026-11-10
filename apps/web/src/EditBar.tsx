import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRightLeft,
  Bold,
  Copy,
  Ellipsis,
  Group,
  Minus,
  MessageSquareQuote,
  Plus,
  Trash2,
  Type,
  Ungroup,
} from "lucide-react";
import type { Canvas } from "../../../modules/canvas/index.ts";
import type { Work } from "../../../modules/contracts/index.ts";
import { quickFields, sharedFields, type SharedField } from "../../../modules/editing/index.ts";
import { shapes, type EditOps, type Shape } from "./desktop/editing.ts";
import { Colors, hex, nameOf, optionOf } from "./EditControls.tsx";
import { keys } from "./EditMenu.tsx";
import { ShapeGlyph } from "./EditTray.tsx";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { useDismiss } from "./popover.ts";

/** The options and switches of a line or a fill that have a picture. */
const lines = new Set(["curve", "elbow", "corner", "filled", "open", "none", "dashed", "both", "soft", "solid", "paper"]);
/** A line as an option draws it: how a link runs, how it ends, whether it is broken; and a
 * fill as it fills. */
function LineGlyph({ kind }: { kind: string }) {
  const d: Record<string, ReactNode> = {
    curve: <path d="M4 18C6 8 16 16 20 6" />,
    elbow: <path d="M4 18h8V6h8" />,
    corner: <path d="M4 18V6h16" />,
    filled: (
      <>
        <path d="M4 12h10" />
        <path d="M13 7.5 20 12l-7 4.5Z" fill="currentColor" />
      </>
    ),
    open: <path d="M4 12h15M14 7l5 5-5 5" />,
    none: <path d="M4 12h16" />,
    dashed: <path d="M4 12h16" strokeDasharray="3.5 3.5" />,
    both: <path d="M5 12h14M9 8l-4 4 4 4M15 8l4 4-4 4" />,
    soft: <rect x="5" y="6" width="14" height="12" rx="2" fill="currentColor" fillOpacity=".22" />,
    solid: <rect x="5" y="6" width="14" height="12" rx="2" fill="currentColor" />,
    paper: <rect x="5" y="6" width="14" height="12" rx="2" />,
  };
  if (!d[kind]) return null;
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {d[kind]}
    </svg>
  );
}
/** What an option of a choice is shown as, where a picture says it better than its name. */
function glyphOf(key: string, option: string): ReactNode {
  if (key === "shape" && (shapes as readonly string[]).includes(option))
    return <ShapeGlyph shape={option as Shape} />;
  if (key === "align")
    return option === "center" ? (
      <AlignCenter size={16} />
    ) : option === "end" || option === "right" ? (
      <AlignRight size={16} />
    ) : (
      <AlignLeft size={16} />
    );
  const line = key === "fillStyle" && option === "none" ? "paper" : option;
  if ((key === "route" || key === "head" || key === "fillStyle") && lines.has(line))
    return <LineGlyph kind={line} />;
  return null;
}
/** The colour a tone of the work's style stands for, as the library's drawings read it:
 * a second accent falls back to the first, and each to a colour of its own. */
const toneOf = (work: Work, tone: string) => {
  const s = work.style;
  return tone === "plain"
    ? undefined
    : tone === "accent2"
      ? s.accent2 || s.accent || "#4f7c8a"
      : tone === "accent"
        ? s.accent || "#d97757"
        : tone === "muted"
          ? s.muted || "#8a8f98"
          : tone === "ink"
            ? s.ink || "#161a22"
            : s[tone];
};

/** The selection's look and most used actions in a bar over it on the canvas, following it
 * as the view moves: what shape, colour and size of type everything selected takes at once,
 * then copying, grouping, asking the author about it and taking it out. It steps aside
 * while something is dragged, and sits under the selection when there is no room above. */
export function SelectionBar({
  canvas,
  stage,
  work,
  sceneId,
  ops,
  selected,
  link,
  grouped,
  hidden,
  ask,
  more,
}: {
  canvas?: Canvas;
  stage: HTMLElement | null;
  /** The work as shown, with the hand edits on their way. */
  work: Work;
  sceneId: string;
  ops: EditOps;
  selected: string[];
  link: string | null;
  /** Whether the selected modules share a group. */
  grouped: boolean;
  hidden: boolean;
  ask: () => void;
  /** Opens the menu of everything else that can be done, at a point on screen. */
  more: (at: { x: number; y: number }) => void;
}) {
  const t = useT(),
    e = t.edit;
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState("");
  const some = selected.length > 0;
  useDismiss(!!open, () => setOpen(""), ref, "[data-popover]");
  const showing = selected.join() + ":" + (link ?? "");
  useLayoutEffect(() => setOpen(""), [showing]);
  useLayoutEffect(() => {
    if (!canvas || !stage) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = canvas.selectionRect(),
        area = stage.getBoundingClientRect();
      if (
        !r ||
        canvas.dragging ||
        r.bottom < area.top ||
        r.top > area.bottom ||
        r.right < area.left ||
        r.left > area.right
      ) {
        el.dataset.away = "";
        return;
      }
      const w = el.offsetWidth,
        h = el.offsetHeight;
      // Clear of the dot above a selected module and of the ruler along the top; under
      // the selection it is clear of its measure.
      // Fingers have a dot out on every side, further off, and the bar stands clear of it.
      const clear = matchMedia("(any-pointer: coarse)").matches ? 62 : 36;
      let top = r.top - area.top - h - clear;
      const under = top < 30;
      if (under) top = r.bottom - area.top + clear + 2;
      const left = Math.min(
        area.width - w - 12,
        Math.max(76, r.left - area.left + r.width / 2 - w / 2),
      );
      el.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
      el.toggleAttribute("data-under", under);
      // What opens from the bar opens upward while there is room for it over the bar.
      el.toggleAttribute("data-low", top < 150);
      delete el.dataset.away;
    };
    place();
    return canvas.watch(place);
  }, [canvas, stage, showing, hidden]);
  if (hidden || (!some && !link)) return null;
  const scene = work.scenes[sceneId];
  const parts = some
    ? (scene?.modules.filter((m) => selected.includes(m.id)) ?? [])
    : (scene?.links.filter((l) => l.id === link) ?? []);
  const quick = quickFields(sharedFields(work, parts));
  const item = (
    label: string,
    icon: ReactNode,
    run: (ev: React.MouseEvent<HTMLButtonElement>) => void,
    o: { key?: string; danger?: boolean; off?: boolean; pressed?: boolean; words?: string } = {},
  ) => (
    <button
      key={label}
      aria-label={label}
      data-tip={o.words ? undefined : o.key ? `${label} · ${keys(o.key)}` : label}
      data-tone={o.danger ? "danger" : undefined}
      data-worded={o.words ? "" : undefined}
      aria-pressed={o.pressed}
      disabled={o.off}
      onPointerDown={(ev) => ev.preventDefault()}
      onClick={run}
    >
      {icon}
      {o.words && <span>{o.words}</span>}
    </button>
  );
  /** A value of the look: a control that changes it for everything selected. */
  const control = (f: SharedField) => {
    const name = nameOf(t, f);
    const set = (value: unknown) => {
      setOpen("");
      ops.restyle({ [f.key]: value });
    };
    if (f.type === "boolean") {
      const pictured = lines.has(f.key);
      return item(name, pictured ? <LineGlyph kind={f.key} /> : null, () => set(!f.value), {
        pressed: !f.mixed && !!f.value,
        words: pictured ? undefined : name,
      });
    }
    if (f.key === "weight" && f.type === "number") {
      const bold = !f.mixed && Number(f.value) >= 600;
      return item(t.edit.bar.bold, <Bold size={16} />, () => set(bold ? (f.optional ? undefined : 400) : 700), {
        pressed: bold,
      });
    }
    if (f.type === "number") {
      const step = f.key === "size" ? (Number(f.value) >= 28 ? 4 : 2) : (f.step ?? 1);
      const value = typeof f.value === "number" ? f.value : (f.min ?? 0);
      const to = (n: number) => ops.restyle({ [f.key]: Math.min(f.max!, Math.max(f.min!, n)) });
      return (
        <span key={f.key} className={cx("bar-stepper")} role="group" aria-label={name}>
          {item(t.edit.bar.less(name), f.key === "size" ? <Type size={12} /> : <Minus size={14} />, () => to(value - step), {
            off: value <= f.min!,
          })}
          <output data-tip={name}>{f.mixed ? "–" : Math.round(value * 100) / 100}</output>
          {item(t.edit.bar.more(name), f.key === "size" ? <Type size={17} /> : <Plus size={14} />, () => to(value + step), {
            off: value >= f.max!,
          })}
        </span>
      );
    }
    const isOpen = open === f.key;
    const toggle = () => setOpen(isOpen ? "" : f.key);
    if (f.type === "color") {
      const colour = typeof f.value === "string" && !f.mixed ? hex(f.value) : undefined;
      return (
        <span key={f.key} className={cx("bar-pop")}>
          {item(
            name,
            <i className={cx("bar-swatch")} data-auto={!colour || undefined} style={{ "--swatch": colour } as CSSProperties} />,
            toggle,
            { pressed: isOpen },
          )}
          {isOpen && (
            <div className={cx("bar-popover")} data-popover>
              <Colors
                work={work}
                value={f.mixed ? undefined : (f.value as string | undefined)}
                auto={f.optional}
                onChange={() => {}}
                onDone={set}
              />
            </div>
          )}
        </span>
      );
    }
    // A choice: its options as pictures where they have one, as a swatch for a tone of the
    // work's style, and by name otherwise.
    const options = f.options ?? [];
    const now = f.mixed ? undefined : String(f.value ?? "");
    const face = (o: string, large = false) =>
      f.key === "tone" ? (
        <i
          className={cx("bar-swatch")}
          data-plain={o === "plain" || undefined}
          data-large={large || undefined}
          style={{ "--swatch": toneOf(work, o) } as CSSProperties}
        />
      ) : (
        glyphOf(f.key, o)
      );
    const pictured = options.every((o) => face(o));
    // A choice left to its drawing shows as its first option, faintly.
    const shown = now && options.includes(now) ? now : undefined;
    return (
      <span key={f.key} className={cx("bar-pop")}>
        {item(
          name,
          shown && face(shown) ? (
            face(shown)
          ) : pictured ? (
            <span className={cx("bar-unset")}>{face(options[0])}</span>
          ) : null,
          toggle,
          {
            pressed: isOpen,
            words: pictured ? undefined : shown ? optionOf(t, shown) : name,
          },
        )}
        {isOpen && (
          <div className={cx("bar-popover")} data-popover data-list={!pictured || undefined} role="menu">
            {options.map((o) => (
              <button
                key={o}
                role="menuitemradio"
                aria-checked={now === o}
                aria-label={optionOf(t, o)}
                data-tip={pictured ? optionOf(t, o) : undefined}
                onClick={() => set(o)}
              >
                {face(o, true)}
                {!pictured && <span>{optionOf(t, o)}</span>}
              </button>
            ))}
          </div>
        )}
      </span>
    );
  };
  return (
    <div ref={ref} className={cx("selection-bar")} role="toolbar" aria-label={e.bar.label} data-away="">
      {quick.map(control)}
      {!!quick.length && <i />}
      {some ? (
        <>
          {item(e.menu.duplicate, <Copy size={15} />, ops.duplicate, { key: "Mod+D" })}
          {grouped
            ? item(e.menu.ungroup, <Ungroup size={15} />, ops.ungroup, { key: "Shift+Mod+G" })
            : selected.length > 1 &&
              item(e.menu.group, <Group size={15} />, ops.group, { key: "Mod+G" })}
        </>
      ) : (
        item(e.menu.reverse, <ArrowRightLeft size={15} />, () => ops.reverse(), { key: "R" })
      )}
      {item(e.menu.remove, <Trash2 size={15} />, ops.remove, { key: "Delete", danger: true })}
      {item(
        e.menu.more,
        <Ellipsis size={16} />,
        (ev) => {
          const r = ev.currentTarget.getBoundingClientRect();
          more({ x: r.left, y: r.bottom + 6 });
        },
      )}
      <i />
      {item(e.menu.ask, <MessageSquareQuote size={15} />, ask, { words: e.bar.ask })}
    </div>
  );
}
