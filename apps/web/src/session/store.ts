import { useRef, useSyncExternalStore } from "react";

/** State kept outside React, changed by plain methods and read as one snapshot: what a
 * session knows lives in fields rather than in refs and effects, so its rules can be read
 * (and tested) in one place, and any page can show it.
 *
 * Changes are cheap to make often: a change only marks the snapshot stale, the snapshot is
 * built when it is next read, and those who listen are told once for all the changes made
 * in the same turn. What did not change keeps its identity from one snapshot to the next
 * (`kept`), so a part of the page that reads only it (`useSelect`) is not drawn again. */
export abstract class Store<T> {
  private listeners = new Set<() => void>();
  private snap?: T;
  private stale = true;
  private told = false;
  /** The snapshot as things stand, given the one before it. */
  protected abstract build(previous: T | undefined): T;
  /** What the store shows now; a new object after a change, the same one until then. */
  get = (): T => {
    if (this.stale) {
      this.snap = this.build(this.snap);
      this.stale = false;
    }
    return this.snap!;
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  /** Something changed: the snapshot is built again when read, and listeners hear of it
   * once the current turn is done. */
  protected changed() {
    this.stale = true;
    if (this.told) return;
    this.told = true;
    queueMicrotask(() => {
      this.told = false;
      for (const l of [...this.listeners]) l();
    });
  }
}

/** Whether two values are the same, or objects or arrays whose own entries are. */
export function shallow(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a),
    kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/** `next`, with each of its entries that equals `previous`'s (shallowly) taken from
 * `previous`, so what did not change is the very same object as before. */
export function kept<T extends object>(previous: T | undefined, next: T): T {
  if (!previous) return next;
  const out = { ...next } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    const was = (previous as Record<string, unknown>)[k];
    if (shallow(was, v)) out[k] = was;
  }
  return shallow(previous, out) ? previous : (out as T);
}

/** What a part of the page reads from a store: it is drawn again only when this changes
 * (by `equal`, shallow unless given), not whenever anything in the store does. */
export function selection<T, U>(
  store: Store<T>,
  select: (snapshot: T) => U,
  equal: (a: U, b: U) => boolean = shallow,
) {
  let last: { value: U } | undefined;
  return {
    subscribe: store.subscribe,
    get(): U {
      const value = select(store.get());
      if (last && equal(last.value, value)) return last.value;
      last = { value };
      return value;
    },
    /** Replaces what is selected, as a component's `select` may change with its props. */
    reselect(next: (snapshot: T) => U) {
      select = next;
    },
  };
}

/** A part of a store's snapshot, kept in step with it; see `selection`. */
export function useSelect<T, U>(
  store: Store<T>,
  select: (snapshot: T) => U,
  equal?: (a: U, b: U) => boolean,
): U {
  const ref = useRef<ReturnType<typeof selection<T, U>>>(undefined);
  if (!ref.current || ref.current.subscribe !== store.subscribe)
    ref.current = selection(store, select, equal);
  else ref.current.reselect(select);
  return useSyncExternalStore(ref.current.subscribe, ref.current.get);
}

/** A store's whole snapshot, drawn again on every change. */
export function useStore<T>(store: Store<T>): T;
export function useStore<T>(store: Store<T> | undefined): T | undefined;
export function useStore<T>(store: Store<T> | undefined) {
  return useSyncExternalStore(store?.subscribe ?? none, store?.get ?? nothing);
}
const none = () => () => {};
const nothing = () => undefined;
