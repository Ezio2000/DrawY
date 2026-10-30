/** Whether an element between `target` and `root` takes a scroll of `delta` along `axis`
 * itself, so the gesture belongs to it. Text fields keep every gesture. */
export function ownsScroll(
  target: EventTarget | null,
  root: Element,
  axis: "x" | "y",
  delta: number,
) {
  // The target may live in an embedded page, whose Element is another class.
  const node = target as Node | null;
  for (
    let el =
      node?.nodeType === Node.ELEMENT_NODE && root.contains(node)
        ? (node as Element)
        : null;
    el && el !== root;
    el = el.parentElement
  ) {
    if (el.matches("input, textarea, select, [contenteditable]")) return true;
    const style = getComputedStyle(el);
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const at = axis === "x" ? el.scrollLeft : el.scrollTop,
      range =
        axis === "x"
          ? el.scrollWidth - el.clientWidth
          : el.scrollHeight - el.clientHeight;
    if (range > 1 && (delta < 0 ? at > 0.5 : at < range - 0.5)) return true;
  }
  return false;
}
