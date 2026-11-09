/** Somewhere to keep small strings between visits. The session layer is handed one rather
 * than reaching for the browser's, so it runs (and is tested) without a page. */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** The browser's local storage, which a private window or a blocked site may refuse:
 * then nothing is kept, and nothing fails. */
export const browserStorage: KeyValue = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

/** Storage kept in memory, for tests and for whatever should not outlive the page. */
export function memoryStorage(): KeyValue {
  const kept = new Map<string, string>();
  return { get: (key) => kept.get(key) ?? null, set: (key, value) => void kept.set(key, value) };
}
