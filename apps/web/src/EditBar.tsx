import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Ellipsis,
  MessageSquareQuote,
  Minus,
  Plus,
  Type,
} from "lucide-react";
import type { Canvas } from "../../../modules/canvas/index.ts";
import type { Work } from "../../../modules/contracts/index.ts";
import { quickFields, sharedFields, type SharedField } from "../../../modules/editing/index.ts";
import { shapes, type EditOps, type Shape } from "./desktop/editing.ts";
import { Colors, hex, nameOf, optionOf } from "./EditControls.tsx";
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

/** The selection's look in a small bar under it on the canvas, following it as the view
 * moves: what shape, colour and size of type everything selected (modules and links) takes
 * at once, the menu of everything else, and describing a change to the author, which brings
 * up the composer put away while editing. The rest is in the panel, the menu and the
 * keyboard, so the bar covers as little of the drawing as it can. It steps aside while
 * something is dragged, and sits over the selection when there is no room under it. */
export function SelectionBar({
  canvas,
  stage,
  work,
  sceneId,
  ops,
  selected,
  links,
  hidden,
  more,
  ask,
}: {
  canvas?: Canvas;
  stage: HTMLElement | null;
  /** The work as shown, with the hand edits on their way. */
  work: Work;
  sceneId: string;
  ops: EditOps;
  selected: string[];
  links: string[];
  hidden: boolean;
  /** Opens the menu of everything else that can be done, at a point on screen. */
  more: (at: { x: number; y: number }) => void;
  /** Brings up the composer, about the selection. */
  ask: () => void;
}) {
  const t = useT(),
    e = t.edit;
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState("");
  useDismiss(!!open, () => setOpen(""), ref, "[data-popover]");
  const showing = selected.join() + ":" + links.join();
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
      // Under the selection, clear of its measure and of the dot on its side (fingers have
      // a dot out on every side, further off); over it where the composer or the edge of
      // the canvas leaves no room under it.
      const clear = matchMedia("(any-pointer: coarse)").matches ? 62 : 36;
      const dock = stage.querySelector("[data-dock]")?.getBoundingClientRect();
      const floor = Math.min(area.bottom, dock && dock.height ? dock.top : area.bottom) - area.top - 8;
      let top = r.bottom - area.top + clear;
      const under = top + h <= floor || r.top - area.top - h - clear < 30;
      if (!under) top = r.top - area.top - h - clear;
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
  if (hidden || (!selected.length && !links.length)) return null;
  const scene = work.scenes[sceneId];
  const parts = [
    ...(scene?.modules.filter((m) => selected.includes(m.id)) ?? []),
    ...(scene?.links.filter((l) => links.includes(l.id)) ?? []),
  ];
  const quick = quickFields(sharedFields(work, parts));
  const item = (
    label: string,
    icon: ReactNode,
    run: (ev: React.MouseEvent<HTMLButtonElement>) => void,
    o: { off?: boolean; pressed?: boolean; words?: string } = {},
  ) => (
    <button
      key={label}
      aria-label={label}
      data-tip={o.words ? undefined : label}
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
      return item(t.edit.bar.bold, <Bold size={16} />, () => set(bold ? 400 : 700), {
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
