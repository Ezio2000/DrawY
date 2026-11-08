/** Counts how often a part of the page is drawn, when something is counting: the desktop
 * regression suite sets `window.__drawyRenders` to check that a part is drawn again only
 * when what it shows changed. Otherwise it does nothing. */
export function counted(part: string) {
  const counts = (globalThis as { __drawyRenders?: Record<string, number> }).__drawyRenders;
  if (counts) counts[part] = (counts[part] ?? 0) + 1;
}
