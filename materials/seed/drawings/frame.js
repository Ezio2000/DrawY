// A frame drawn round a group of modules, with its name in a corner: a tier or subsystem of
// an architecture, a boundary, a package, a zone. It is ground for what stands on it: the
// modules inside are their own modules, links run over it, and dragging it carries them.
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
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.8);
const size = Number(d.size ?? 15);
const r = Math.min(Number(d.radius ?? 12), W / 2, H / 2);
const dash = d.dashed ? ` stroke-dasharray="${sw * 5} ${sw * 4}"` : "";
const at = d.titleAt || "top-left";
const centred = at === "top";
const below = at === "bottom-left";
const pad = size * 0.9;
const effect = d.effect ? ` filter="${api.effect(d.effect)}"` : "";
// A tab holds a UML fragment's or package's name in the corner, cut on the slant.
const tab = d.tab
  ? `<div class="tab" data-clear>${esc(d.title)}</div>`
  : "";
return api.html(`<style>
:host,.frame{position:relative;width:${W}px;height:${H}px}
svg{position:absolute;inset:0;overflow:visible}
.name{position:absolute;left:${pad}px;right:${pad}px;${below ? "bottom" : "top"}:${size * 0.55}px;display:flex;gap:${size * 0.5}px;align-items:baseline;justify-content:${centred ? "center" : "flex-start"};font-family:${esc(t.font || "system-ui")};white-space:nowrap}
.title{font-size:${size}px;font-weight:${d.weight ?? 700};line-height:1.3;color:${tone === "plain" ? ink : color}}
.note{font-size:${size * 0.8}px;line-height:1.3;color:${muted}}
.tab{position:absolute;left:0;top:0;padding:${size * 0.25}px ${size * 1.1}px ${size * 0.3}px ${size * 0.7}px;font:${d.weight ?? 700} ${size * 0.9}px/1.3 ${esc(t.font || "system-ui")};color:${paper};background:${color};border-top-left-radius:${r}px;clip-path:polygon(0 0,100% 0,100% 55%,calc(100% - ${size * 0.6}px) 100%,0 100%)}
</style><div class="frame"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect x="${sw / 2}" y="${sw / 2}" width="${W - sw}" height="${H - sw}" rx="${r}" fill="${fill === "soft" ? color : paper}" fill-opacity="${fill === "soft" ? 0.07 : fill === "paper" ? 1 : 0}" stroke="${color}" stroke-opacity="${tone === "plain" ? 0.7 : 0.9}" stroke-width="${sw}"${dash}${effect}/></svg>${
  d.tab
    ? tab + (d.note ? `<div class="name" style="left:auto;right:${pad}px"><span class="note">${esc(d.note)}</span></div>` : "")
    : `<div class="name">${d.title ? `<span class="title" data-clear>${esc(d.title)}</span>` : ""}${d.note ? `<span class="note" data-clear>${esc(d.note)}</span>` : ""}</div>`
}</div>`);
