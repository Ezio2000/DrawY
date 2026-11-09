/** Keeps the app the size of what can be seen. On a phone the keyboard covers the bottom of
 * the window without making it smaller, and iOS scrolls the page to bring a field into
 * view and can leave it scrolled; the app is laid out in the visual viewport instead
 * (`--seen-top`, `--seen-height` on the root), so the composer stays above the keyboard
 * and nothing is left cut off when it goes. The page is not zoomed either: the drawing
 * zooms itself, and Safari's own pinch zoom, which it allows whatever the page says, would
 * blow the bars up and keep them so after a reload.
 *
 * Returns what stops following. */
export function followViewport(root = document.documentElement) {
  const v = window.visualViewport;
  if (!v) return () => {};
  const follow = () => {
    // Zoomed in (a pinch on a trackpad), the page is laid out as usual.
    if (Math.abs(v.scale - 1) > 0.01) {
      root.style.removeProperty("--seen-top");
      root.style.removeProperty("--seen-height");
      return;
    }
    root.style.setProperty("--seen-top", `${Math.max(0, v.offsetTop)}px`);
    root.style.setProperty("--seen-height", `${v.height}px`);
  };
  // Once the keyboard has gone, a page left scrolled by it is put back.
  const settle = () => {
    follow();
    if (v.height >= innerHeight - 1 && (scrollX || scrollY)) scrollTo(0, 0);
  };
  const pinch = (e: Event) => e.preventDefault();
  follow();
  v.addEventListener("resize", settle);
  v.addEventListener("scroll", follow);
  // Safari's gestures, which only it fires: two fingers on anything but the drawing (which
  // takes them itself) would zoom the whole page.
  document.addEventListener("gesturestart", pinch, { passive: false });
  document.addEventListener("gesturechange", pinch, { passive: false });
  return () => {
    v.removeEventListener("resize", settle);
    v.removeEventListener("scroll", follow);
    document.removeEventListener("gesturestart", pinch);
    document.removeEventListener("gesturechange", pinch);
  };
}
