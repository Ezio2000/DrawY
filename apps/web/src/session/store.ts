import { useSyncExternalStore } from "react";

/** State kept outside React, changed by plain methods and read as one snapshot: what a
 * session knows lives in fields rather than in refs and effects, so its rules can be read
 * (and tested) in one place, and any page can show it. */
export abstract class Store<T> {
  private listeners = new Set<() => void>();
  private snap: T;
  constructor() {
    this.snap = undefined as T;
  }
  /** What the store shows now; a new object after every change, the same one until then. */
  get = (): T => this.snap;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  /** Builds the snapshot again and tells whoever shows it. */
  protected publish(snapshot: T) {
    this.snap = snapshot;
    for (const l of [...this.listeners]) l();
  }
}

const none = () => () => {};
const nothing = () => undefined;
/** A store's snapshot, kept in step with it. */
export function useStore<T>(store: Store<T>): T;
export function useStore<T>(store: Store<T> | undefined): T | undefined;
export function useStore<T>(store: Store<T> | undefined) {
  return useSyncExternalStore(store?.subscribe ?? none, store?.get ?? nothing);
}
