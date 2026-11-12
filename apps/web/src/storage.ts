/* Small strings kept in this browser between visits. A private window or a blocked site may
 * refuse local storage: then nothing is kept, and nothing fails. */

export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
