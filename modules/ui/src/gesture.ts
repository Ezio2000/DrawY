/* Direct manipulation in the iOS manner: content follows the fingers, resists past its
 * limits, and on release either springs back or completes the action the gesture was
 * heading for. A trackpad reports no release, so a pause in its wheel input is one. */

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { ownsScroll } from "./scroll.ts";

/* People steer with different hands and hardware: two fingers on a trackpad, three-finger
 * drag, a mouse, or a steadier pace. How input maps to motion is a choice per device,
 * kept in this browser. */

/** What two-finger scrolling and the mouse wheel do on a scene. `auto` pans with a
 * trackpad and zooms with a notched wheel. */
export type ScrollMode = "auto" | "pan" | "zoom";
/** How far a gesture travels before letting go completes it. */
export type Reach = "short" | "standard" | "long";
export interface Gestures {
  scroll: ScrollMode;
  /** Scrolling zooms the other way round. */
  invertZoom: boolean;
  /** Zooming far enough into a node enters it, and out of a scene or card returns. */
  levels: boolean;
  reach: Reach;
  /** A quick flick completes a swipe before its full distance. */
  flick: boolean;
  /** A released scene keeps drifting and slows down. */
  inertia: boolean;
  /** Sideways swipes and pulls from the top move between article cards. */
  cardSwipes: boolean;
  /** A mouse or three-finger drag moves cards by their margins and drags drawers away. */
  pointerDrag: boolean;
  /** Swipes dismiss drawers, panels and sheets. */
  sheetSwipes: boolean;
}

export type PresetId = "trackpad" | "drag" | "scroll" | "steady";
const TRACKPAD: Gestures = {
  scroll: "auto",
  invertZoom: false,
  levels: true,
  reach: "standard",
  flick: true,
  inertia: true,
  cardSwipes: true,
  pointerDrag: false,
  sheetSwipes: true,
};
export const PRESETS: { id: PresetId; gestures: Gestures }[] = [
  {
    id: "trackpad",
    gestures: TRACKPAD,
  },
  {
    id: "drag",
    gestures: { ...TRACKPAD, scroll: "zoom", pointerDrag: true },
  },
  {
    id: "scroll",
    gestures: { ...TRACKPAD, scroll: "pan" },
  },
  {
    id: "steady",
    gestures: {
      ...TRACKPAD,
      reach: "long",
      flick: false,
      inertia: false,
      sheetSwipes: false,
    },
  },
];

/** Per reach: the factor a pinch spreads to enter a node and closes to to return, and
 * the share of a surface (capped in pixels) a swipe or pull must cover. */
export const REACHES = {
  short: {
    enter: 1.3,
    back: 0.8,
    swipe: 0.14,
    swipeMax: 64,
    pull: 64,
    sheet: 0.25,
    sheetMax: 80,
  },
  standard: {
    enter: 1.5,
    back: 0.7,
    swipe: 0.2,
    swipeMax: 96,
    pull: 90,
    sheet: 0.33,
    sheetMax: 110,
  },
  long: {
    enter: 1.9,
    back: 0.55,
    swipe: 0.3,
    swipeMax: 150,
    pull: 140,
    sheet: 0.45,
    sheetMax: 160,
  },
} satisfies Record<Reach, unknown>;

const CHOICES: { [K in keyof Gestures]: readonly Gestures[K][] } = {
  scroll: ["auto", "pan", "zoom"],
  invertZoom: [false, true],
  levels: [true, false],
  reach: ["short", "standard", "long"],
  flick: [true, false],
  inertia: [true, false],
  cardSwipes: [true, false],
  pointerDrag: [false, true],
  sheetSwipes: [true, false],
};
/** Saved preferences; anything missing or unknown keeps the trackpad default. */
function readGestures(saved: unknown): Gestures {
  const out: Record<string, unknown> = { ...TRACKPAD };
  if (saved && typeof saved === "object")
    for (const [key, values] of Object.entries(CHOICES)) {
      const value = (saved as Record<string, unknown>)[key];
      if ((values as readonly unknown[]).includes(value)) out[key] = value;
    }
  return out as unknown as Gestures;
}
export const presetOf = (g: Gestures) =>
  PRESETS.find((p) =>
    (Object.keys(CHOICES) as (keyof Gestures)[]).every(
      (k) => p.gestures[k] === g[k],
    ),
  );

const KEY = "seey:gestures";
const stored = () => {
  try {
    return readGestures(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return readGestures(null);
  }
};
let current = stored();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
/** The preferences in effect; input handlers read them as each event arrives. */
export const gestures = () => current;
export const reach = () => REACHES[current.reach];
export function setGestures(next: Gestures) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Without storage the choice lasts until the page closes.
  }
  changed();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useGestures = () =>
  useSyncExternalStore(subscribe, gestures, gestures);
if (typeof addEventListener === "function")
  addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = stored();
    changed();
  });

/** Progress towards entering a node while zooming in. It follows the zoom the gesture
 * itself made (`spread`, natural log, before any resistance), so a small node takes the
 * same pinch as a large one; a node already zoomed close to filling the stage (`cover`,
 * its larger share of the stage) is ready too. */
export function enterProgress(
  spread: number,
  cover: number,
  enter = reach().enter,
) {
  return Math.max(spread / Math.log(enter), (cover - 0.35) / 0.3);
}
/** Progress towards returning while zooming out: how far the gesture carried the camera
 * below the overview (`below`, natural log, before any resistance). */
export function backProgress(below: number, back = reach().back) {
  return below / Math.log(1 / back);
}

/** How far content moves when pulled `overshoot` past its limit inside `dimension`, as
 * UIScrollView's rubber band: nearly one to one at first, never beyond `dimension`. */
export function rubber(overshoot: number, dimension: number, c = 0.55) {
  const x = Math.abs(overshoot);
  return Math.sign(overshoot) * (1 - 1 / ((x * c) / dimension + 1)) * dimension;
}

/** The pull that shows as a rubber-banded `offset`. */
function unrubber(offset: number, dimension: number, c = 0.55) {
  const y = Math.min(Math.abs(offset), dimension * 0.999);
  return Math.sign(offset) * (dimension / c) * (1 / (1 - y / dimension) - 1);
}

/** Moves `value` by `delta`, freely inside [min, max] and rubber-banded outside it. */
export function resist(
  value: number,
  delta: number,
  min: number,
  max: number,
  dimension: number,
) {
  const raw =
    value < min
      ? min - unrubber(min - value, dimension)
      : value > max
        ? max + unrubber(value - max, dimension)
        : value;
  const next = raw + delta;
  return next < min
    ? min - rubber(min - next, dimension)
    : next > max
      ? max + rubber(next - max, dimension)
      : next;
}

/** Seconds a critically damped spring takes to settle, close to UIKit's default. */
export const RESPONSE = 0.42;
/** UIScrollView's normal deceleration, 0.998 per millisecond, per second. */
export const DECAY = 1000 * Math.log(0.998);

/** A critically damped spring: the displacement and velocity (per second) `t` seconds
 * after leaving displacement `x0` with velocity `v0`. */
export function spring(x0: number, v0: number, t: number, response = RESPONSE) {
  const w = (2 * Math.PI) / response,
    e = Math.exp(-w * t),
    b = v0 + w * x0;
  return { x: (x0 + b * t) * e, v: (v0 - w * b * t) * e };
}

/** Calls `frame` with the seconds elapsed on every animation frame until it returns
 * false; the returned function stops it. */
export function animate(frame: (elapsed: number) => boolean) {
  let id = 0;
  const start = performance.now();
  const tick = (now: number) => {
    id = frame((now - start) / 1000) ? requestAnimationFrame(tick) : 0;
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

/** Wheel distance in pixels. */
export function wheelDelta(e: WheelEvent, page: number) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1;
  return { x: e.deltaX * unit, y: e.deltaY * unit };
}

/** A notched mouse wheel rather than a trackpad: line steps, or whole vertical ticks that
 * lack the trackpad's three-to-one legacy delta. An unknown device counts as a trackpad,
 * so a swipe never turns into a zoom. */
export function isMouseWheel(e: WheelEvent) {
  if (e.deltaMode === 1) return true;
  const ticks = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  return (
    !e.deltaX &&
    Number.isInteger(e.deltaY) &&
    !!ticks &&
    ticks % 120 === 0 &&
    ticks !== -3 * e.deltaY
  );
}

/** Milliseconds without input after which wheel input reversing its way is a new
 * gesture: fingers lifted and set down again, not a pinch or swipe turning back. */
const REGRIP = 100;
/** Milliseconds without input after which wheel input turning sideways is a new
 * gesture. Momentum never turns, so out of momentum a turn is one at once. */
const TURN = 30;

/** Cosine of the angle between the way input went and an event's way: 1 on, 0 sideways,
 * -1 back. */
function along(way: { x: number; y: number }, e: WheelEvent) {
  const n = Math.hypot(way.x, way.y) * Math.hypot(e.deltaX, e.deltaY);
  return n ? (way.x * e.deltaX + way.y * e.deltaY) / n : 1;
}

/** Wheel input arrives in bursts: the fingers moving, then for swipes the system's
 * momentum. A burst ends after a pause, which is the release of the gesture. Fingers set
 * down again can be quicker than that pause: input that switches between pinch and
 * scroll, turns sideways after a break or out of momentum, or reverses after a longer
 * break starts a new burst and releases the last at once. */
export class WheelBurst {
  private last = -Infinity;
  private size = 0;
  private falling = 0;
  private ctrl = false;
  private way = { x: 0, y: 0 };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly release: () => void;
  private readonly pause: number;
  constructor(release: () => void, pause = 140) {
    this.release = release;
    this.pause = pause;
  }
  /** Records an event of the given magnitude; true when it begins a new burst. A notched
   * wheel turns tick by tick, so it may wait longer (`pause`) before counting as let go. */
  add(e: WheelEvent, size: number, pause = this.pause) {
    const gap = e.timeStamp - this.last,
      way = along(this.way, e),
      regrip =
        this.timer !== undefined &&
        (e.ctrlKey !== this.ctrl ||
          (way < -0.5
            ? gap > REGRIP
            : way < 0.5 && (gap > TURN || this.coasting)));
    if (regrip) {
      this.stop();
      this.release();
    }
    const fresh = regrip || gap > pause;
    this.falling =
      !fresh && size > 0 && size < this.size ? this.falling + 1 : 0;
    this.size = size;
    this.last = e.timeStamp;
    this.ctrl = e.ctrlKey;
    if (e.deltaX || e.deltaY) this.way = { x: e.deltaX, y: e.deltaY };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.release();
    }, pause);
    return fresh;
  }
  /** Several shrinking steps in a row: the fingers have lifted and momentum is fading. */
  get coasting() {
    return this.falling >= 4;
  }
  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.last = -Infinity;
  }
}

/** One level change per gesture. Input still arriving from the gesture that changed the
 * level, as trackpad momentum does after the fingers lift, must not act on the level it
 * arrives at, and while a change is under way no level takes input. Momentum only slows
 * down along its way, so input after a pause, input that switches between pinch and
 * scroll, turns or speeds up again is a new gesture and acts at once. */
export class LevelInput {
  private latest?: {
    t: number;
    x: number;
    y: number;
    ctrl: boolean;
    size: number;
    speed: number;
    began: boolean;
  };
  /** The slowest the input left over from a change has moved: pixels per event and per
   * millisecond. Both rise when fingers push again; coalesced events only grow, and
   * uneven timing only speeds up. */
  private spent?: { size: number; speed: number };
  private changing = 0;
  see(e: WheelEvent) {
    const { deltaX: x, deltaY: y, ctrlKey: ctrl, timeStamp: t } = e,
      size = Math.hypot(x, y),
      p = this.latest;
    if (!size) return;
    const speed = p ? size / Math.max(1, t - p.t) : 0,
      began =
        !p ||
        t - p.t > 240 ||
        ctrl !== p.ctrl ||
        x * p.x + y * p.y < 0.5 * size * p.size;
    const s = this.spent;
    if (s)
      this.spent =
        began || (size > 2 * s.size && speed > 2 * s.speed + 0.2)
          ? undefined
          : { size: Math.min(s.size, size), speed: Math.min(s.speed, speed) };
    this.latest = { t, x, y, ctrl, size, speed, began };
  }
  /** The level starts to change at `now`; the returned function reports the next level
   * shown. A release by pause comes well after the last input, so input this recent is
   * still the gesture that made the change, unless it is a new one that let go of it. */
  change(now: number) {
    const p = this.latest;
    this.spent =
      p && !p.began && now - p.t < 120
        ? { size: p.size, speed: p.speed }
        : undefined;
    this.changing++;
    return () => void this.changing--;
  }
  get fresh() {
    return !this.spent && !this.changing;
  }
}
const levelInput = new LevelInput();
if (typeof addEventListener === "function")
  addEventListener("wheel", (e) => levelInput.see(e), {
    capture: true,
    passive: true,
  });
/** Whether wheel input arriving now may act on the level shown. */
export const freshGesture = () => levelInput.fresh;
/** A level change starts; call the returned function once the next level is shown. */
export const changeLevel = () => levelInput.change(performance.now());

/** Whether input at a point is meant for `el`. While a level transition plays, the page
 * shows pictures of the stage and input lands on the page around it instead, as does the
 * rest of a wheel stream begun then; the surface under the point takes it all the same,
 * so the next gesture never waits for the animation. */
export function aimsAt(
  e: { target: EventTarget | null; clientX: number; clientY: number },
  el: Element,
) {
  const target = e.target;
  if (!(target instanceof Node) || !target.contains(el))
    return el.contains(target as Node);
  const r = el.getBoundingClientRect();
  return (
    e.clientX >= r.left &&
    e.clientX < r.right &&
    e.clientY >= r.top &&
    e.clientY < r.bottom
  );
}

type Sample = { t: number; at: number };
/** Velocity in pixels per millisecond over the last moments of a drag; zero when the
 * pointer rested before lifting. */
export function flickVelocity(samples: Sample[], now: number) {
  const recent = samples.filter((s) => now - s.t <= 100);
  if (recent.length < 2 || now - recent.at(-1)!.t > 50) return 0;
  const first = recent[0],
    last = recent.at(-1)!;
  return last.t > first.t ? (last.at - first.at) / (last.t - first.t) : 0;
}

export type Edge = "left" | "right" | "bottom";

/** Lets a sheet or drawer be swiped away towards `edge`: with the trackpad, with touch
 * wherever no scroll takes the gesture, and with the mouse from an element marked
 * `data-swipe-handle` (from anywhere on a drawer when pointer drags are on). The surface
 * follows through `--swipe` and `--swipe-progress` on `vars` (default: the surface) and
 * springs back unless released past the threshold or flicked. */
export function useSwipeDismiss(
  ref: RefObject<HTMLElement | null>,
  edge: Edge,
  dismiss: (() => void) | undefined,
  { vars }: { vars?: RefObject<HTMLElement | null> } = {},
) {
  const action = useRef(dismiss);
  action.current = dismiss;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const horizontal = edge !== "bottom",
      sign = edge === "left" ? -1 : 1;
    /** Distance towards the edge. */
    const toward = (d: { x: number; y: number }) =>
      edge === "left" ? d.x : edge === "right" ? -d.x : -d.y;
    let amount = 0,
      done = false,
      axis: "swipe" | "other" | undefined,
      sum = { x: 0, y: 0 },
      top = false,
      reset: ReturnType<typeof setTimeout> | undefined;
    let drag:
      | { id: number; x: number; y: number; locked: boolean; samples: Sample[] }
      | undefined;
    const threshold = () => {
      const r = reach();
      return Math.min(
        r.sheetMax,
        (horizontal ? el.offsetWidth : el.offsetHeight) * r.sheet,
      );
    };
    const paint = (active: boolean) => {
      const out = vars?.current ?? el;
      const shown = amount >= 0 ? amount : -rubber(-amount, 60);
      out.style.setProperty("--swipe", `${(sign * shown).toFixed(1)}px`);
      out.style.setProperty(
        "--swipe-progress",
        Math.min(1, Math.max(0, amount / threshold())).toFixed(3),
      );
      out.dataset.swipe = active ? "on" : "off";
    };
    const settle = (velocity: number) => {
      if (done) return;
      if (
        amount >= threshold() ||
        (gestures().flick && velocity > 0.45 && amount > 24)
      ) {
        done = true;
        paint(false);
        action.current?.();
        // The surface leaves from where it was let go; it is gone by the time this runs.
        reset = setTimeout(() => {
          done = false;
          amount = 0;
          paint(true);
        }, 700);
        return;
      }
      if (amount) {
        amount = 0;
        paint(false);
      }
    };
    const burst = new WheelBurst(() => settle(0));
    const wheel = (e: WheelEvent) => {
      if (!action.current || done || e.ctrlKey || !gestures().sheetSwipes)
        return;
      const d = wheelDelta(e, el.clientHeight);
      if (burst.add(e, Math.hypot(d.x, d.y))) {
        axis = undefined;
        sum = { x: 0, y: 0 };
        top = !ownsScroll(e.target, el, "y", -1);
      }
      let step = d;
      if (!axis) {
        sum = { x: sum.x + d.x, y: sum.y + d.y };
        if (Math.hypot(sum.x, sum.y) < 6) return;
        const along = horizontal
          ? Math.abs(sum.x) > Math.abs(sum.y) * 1.2
          : Math.abs(sum.y) > Math.abs(sum.x) * 1.2;
        axis =
          along &&
          (horizontal
            ? !ownsScroll(e.target, el, "x", sum.x)
            : top && toward(sum) > 0)
            ? "swipe"
            : "other";
        step = sum;
      }
      if (axis !== "swipe") return;
      const pull = toward(step);
      // A sheet hands the gesture back to its scroll once it is pushed home again.
      if (!horizontal && amount + pull <= 0) {
        if (amount) {
          amount = 0;
          paint(true);
        }
        return;
      }
      e.preventDefault();
      amount = Math.max(-80, amount + pull);
      paint(true);
      if (amount >= threshold() && burst.coasting) {
        burst.stop();
        settle(0);
      }
    };
    const down = (e: PointerEvent) => {
      const g = gestures();
      if (
        !action.current ||
        done ||
        !g.sheetSwipes ||
        !e.isPrimary ||
        e.button !== 0
      )
        return;
      const target = e.target as Element;
      if (target.closest("input, textarea, select, [contenteditable], iframe"))
        return;
      // Touch drags a drawer from anywhere, and so does the mouse when pointer drags are on;
      // a sheet scrolls, so it needs the handle.
      const needsHandle =
        !horizontal || (e.pointerType === "mouse" && !g.pointerDrag);
      if (needsHandle && !target.closest("[data-swipe-handle]")) return;
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        locked: false,
        samples: [],
      };
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (!drag.locked) {
        if (Math.hypot(dx, dy) < 8) return;
        const along = horizontal
          ? Math.abs(dx) > Math.abs(dy) * 1.2
          : Math.abs(dy) > Math.abs(dx);
        if (!along || (horizontal && ownsScroll(e.target, el, "x", -dx))) {
          drag = undefined;
          return;
        }
        drag.locked = true;
        el.setPointerCapture(e.pointerId);
        getSelection()?.removeAllRanges();
      }
      amount = edge === "left" ? -dx : edge === "right" ? dx : dy;
      drag.samples.push({ t: e.timeStamp, at: amount });
      if (drag.samples.length > 12) drag.samples.shift();
      paint(true);
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { locked, samples } = drag;
      drag = undefined;
      if (locked)
        settle(
          e.type === "pointerup" ? flickVelocity(samples, e.timeStamp) : 0,
        );
    };
    // A pointer drag moves the surface instead of selecting text.
    const select = (e: Event) => drag && e.preventDefault();
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("selectstart", select);
    return () => {
      burst.stop();
      clearTimeout(reset);
      el.removeEventListener("selectstart", select);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [edge]);
}
