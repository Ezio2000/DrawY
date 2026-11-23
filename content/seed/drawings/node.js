// A block of a flowchart, architecture or concept map: a shape holding a title, an
// optional note and an optional icon picture, coloured by the style's tokens. Place one per
// module and join them with arrow links, so each block moves on its own and its
// connections follow. The words are HTML, so they wrap inside the shape.
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
  accent2: t.accent2 || t.accent || "#4f7c8a",
  muted,
  ink,
};
const tone = tones[d.tone] ? d.tone : "plain";
const color = d.color || tones[tone];
const fill = d.fillStyle || (tone === "plain" ? "none" : "soft");
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const shape = d.shape || "box";
const size = Number(d.size ?? 15);
const s = sw / 2 + 0.5;
const iw = W - 2 * s,
  ih = H - 2 * s;
// The shape, and the part of it that words may use.
let path,
  extra = "",
  inset = { l: size * 0.9, r: size * 0.9, t: size * 0.55, b: size * 0.55 };
if (shape === "pill" || shape === "circle") {
  const rx = shape === "circle" ? iw / 2 : Math.min(iw, ih) / 2,
    ry = shape === "circle" ? ih / 2 : rx;
  path = `<rect x="${s}" y="${s}" width="${iw}" height="${ih}" rx="${rx}" ry="${ry}"/>`;
  if (shape === "circle")
    inset = { l: W * 0.15, r: W * 0.15, t: H * 0.15, b: H * 0.15 };
  else inset = { ...inset, l: rx * 0.6 + size * 0.4, r: rx * 0.6 + size * 0.4 };
} else if (shape === "diamond") {
  path = `<path d="M${W / 2} ${s}L${W - s} ${H / 2}L${W / 2} ${H - s}L${s} ${H / 2}Z" stroke-linejoin="round"/>`;
  inset = { l: W * 0.24, r: W * 0.24, t: H * 0.22, b: H * 0.22 };
} else if (shape === "cylinder") {
  const ry = Math.min(ih * 0.14, iw * 0.12, 16);
  path = `<path d="M${s} ${s + ry}A${iw / 2} ${ry} 0 0 1 ${W - s} ${s + ry}V${H - s - ry}A${iw / 2} ${ry} 0 0 1 ${s} ${H - s - ry}Z"/>`;
  extra = `<path d="M${s} ${s + ry}A${iw / 2} ${ry} 0 0 0 ${W - s} ${s + ry}" fill="none"/>`;
  inset = { ...inset, t: ry * 2 + size * 0.3, b: ry + size * 0.4 };
} else if (shape === "document") {
  const wave = Math.min(ih * 0.1, 10),
    r = Math.min(10, ih * 0.15);
  path = `<path d="M${s + r} ${s}H${W - s - r}Q${W - s} ${s} ${W - s} ${s + r}V${H - s - wave}C${W * 0.75} ${H - s - wave * 3} ${W * 0.5} ${H - s + wave * 0.6} ${s} ${H - s - wave * 0.6}V${s + r}Q${s} ${s} ${s + r} ${s}Z" stroke-linejoin="round"/>`;
  inset = { ...inset, b: wave * 2 + size * 0.4 };
} else {
  const rx = Math.min(Number(d.radius ?? 10), ih / 2);
  path = `<rect x="${s}" y="${s}" width="${iw}" height="${ih}" rx="${rx}"/>`;
}
const fills = {
  solid: `fill="${color}" stroke="${color}"`,
  soft: `fill="${color}" fill-opacity=".14" stroke="${color}"`,
  none: `fill="${paper}" stroke="${color}"`,
};
const shade = d.lift
  ? `<filter id="lift" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="${size * 0.18}" stdDeviation="${size * 0.3}" flood-color="${ink}" flood-opacity=".16"/></filter>`
  : "";
const effect = d.effect ? ` filter="${api.effect(d.effect)}"` : "";
const solid = fill === "solid";
const root = api.html(`<style>
:host,.node{position:relative;width:${W}px;height:${H}px}
svg{position:absolute;inset:0;overflow:visible}
.words{position:absolute;left:${inset.l}px;right:${inset.r}px;top:${inset.t}px;bottom:${inset.b}px;display:flex;flex-direction:${d.icon && W < H * 1.6 ? "column" : "row"};align-items:center;justify-content:center;gap:${size * 0.55}px;font-family:${esc(t.font || "system-ui")};text-align:${d.align === "left" ? "left" : "center"};color:${solid ? paper : ink}}
.text{display:flex;flex-direction:column;gap:${size * 0.18}px;min-width:0;${d.align === "left" ? "flex:1;" : ""}}
.title{font-size:${size}px;font-weight:${d.weight ?? 600};line-height:1.25;overflow-wrap:anywhere;text-wrap:balance}
.note{font-size:${size * 0.8}px;line-height:1.3;color:${solid ? paper : muted};opacity:${solid ? 0.85 : 1};overflow-wrap:anywhere;text-wrap:balance}
.icon{flex:none;display:flex}
</style><div class="node"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${shade}<g ${fills[fill] || fills.none} stroke-width="${sw}"${d.lift ? ' filter="url(#lift)"' : ""}${effect}>${path}${extra}</g></svg><div class="words"><div class="text">${d.title ? `<div class="title">${esc(d.title)}</div>` : ""}${d.note ? `<div class="note">${esc(d.note)}</div>` : ""}</div></div></div>`);
if (d.dashed)
  root
    .querySelector("g")
    .setAttribute("stroke-dasharray", `${sw * 4} ${sw * 3}`);
if (d.icon && api.materials[d.icon]) {
  const box = Math.min(
    (H - inset.t - inset.b) * (W < H * 1.6 ? 0.55 : 0.9),
    W * 0.4,
    size * 3.4,
  );
  const slot = document.createElement("div");
  slot.className = "icon";
  slot.append(
    api.material(d.icon, {
      width: box,
      height: box,
      align: "center",
      ...(solid ? { color: paper } : { color }),
    }),
  );
  root.querySelector(".words").prepend(slot);
}
return root;
