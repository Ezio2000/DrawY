// A speech or annotation bubble: words in a rounded bubble whose tail points at what they
// are about, as a person's line, a thought or a remark beside a picture. The words are HTML
// so they wrap; the tail can leave any side at any point along it.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const ink = t.ink || "#222",
  paper = t.paper || "#fff",
  muted = t.muted || "#888";
const tones = {
  plain: muted,
  accent: t.accent || "#d97757",
  accent2: t.accent2 || "#4f7c8a",
  ink,
};
const color = d.color || tones[d.tone] || tones.plain;
const solid = d.fillStyle === "solid";
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 15);
const side = ["bottom", "top", "left", "right", "none"].includes(d.tail)
  ? d.tail
  : "bottom";
const k = Math.min(0.9, Math.max(0.1, Number(d.tailAt ?? 0.25)));
const tl =
  side === "none"
    ? 0
    : Math.min(size * 1.4, (side === "left" || side === "right" ? W : H) * 0.3);
const s = sw / 2 + 0.5;
// The bubble's box, leaving room for the tail on its side.
const b = {
  x: s + (side === "left" ? tl : 0),
  y: s + (side === "top" ? tl : 0),
  w: W - 2 * s - (side === "left" || side === "right" ? tl : 0),
  h: H - 2 * s - (side === "top" || side === "bottom" ? tl : 0),
};
const r = Math.min(Number(d.radius ?? size * 0.9), b.h / 2, b.w / 2);
const tw = Math.min(
  size * 1.1,
  (side === "left" || side === "right" ? b.h : b.w) * 0.25,
);
const R = b.x + b.w,
  B = b.y + b.h;
let p = `M${b.x + r} ${b.y}`;
if (side === "top") {
  const x = b.x + r + (b.w - 2 * r) * k;
  p += `H${x - tw / 2}L${x - tw * 0.2} ${s}L${x + tw / 2} ${b.y}`;
}
p += `H${R - r}Q${R} ${b.y} ${R} ${b.y + r}`;
if (side === "right") {
  const y = b.y + r + (b.h - 2 * r) * k;
  p += `V${y - tw / 2}L${W - s} ${y + tw * 0.2}L${R} ${y + tw / 2}`;
}
p += `V${B - r}Q${R} ${B} ${R - r} ${B}`;
if (side === "bottom") {
  const x = b.x + r + (b.w - 2 * r) * k;
  p += `H${x + tw / 2}L${x - tw * 0.2} ${H - s}L${x - tw / 2} ${B}`;
}
p += `H${b.x + r}Q${b.x} ${B} ${b.x} ${B - r}`;
if (side === "left") {
  const y = b.y + r + (b.h - 2 * r) * k;
  p += `V${y + tw / 2}L${s} ${y + tw * 0.2}L${b.x} ${y - tw / 2}`;
}
p += `V${b.y + r}Q${b.x} ${b.y} ${b.x + r} ${b.y}Z`;
const effect = d.effect ? ` filter="${api.effect(d.effect)}"` : "";
return api.html(`<style>
.bubble{position:relative;width:${W}px;height:${H}px}
svg{position:absolute;inset:0;overflow:visible}
.words{position:absolute;left:${b.x + size * 0.9}px;top:${b.y + size * 0.5}px;width:${b.w - size * 1.8}px;height:${b.h - size}px;display:flex;flex-direction:column;justify-content:center;gap:${size * 0.2}px;text-align:${d.align === "center" ? "center" : "left"};font-family:${esc(t.font || "system-ui")};color:${solid ? paper : ink}}
.text{font-size:${size}px;line-height:1.4;overflow-wrap:anywhere;text-wrap:pretty}
.who{font-size:${size * 0.8}px;font-weight:700;color:${solid ? paper : color}}
</style><div class="bubble"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path d="${p}" fill="${solid ? color : paper}" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"${d.dashed ? ` stroke-dasharray="${sw * 4} ${sw * 3}"` : ""}${effect}/></svg><div class="words">${d.speaker ? `<div class="who">${esc(d.speaker)}</div>` : ""}<div class="text">${esc(d.text)}</div></div></div>`);
