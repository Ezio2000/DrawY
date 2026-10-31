// A curly brace that gathers the things beside it, its point toward `facing`
// (right, left, up or down), with an optional label at the point.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const facing = d.facing ?? "right";
const vertical = facing === "right" || facing === "left";
const L = vertical ? H : W,
  depth = Math.min(vertical ? W : H, Number(d.depth ?? 14));
const r = Math.min(depth, L / 8),
  m = depth / 2,
  q = L / 2;
// Drawn pointing right along y, then turned into place.
const path = `M0 0Q${m} 0 ${m} ${r}L${m} ${q - r}Q${m} ${q} ${depth} ${q}Q${m} ${q} ${m} ${q + r}L${m} ${L - r}Q${m} ${L} 0 ${L}`;
const turn = {
  right: "",
  left: `translate(${W} 0) scale(-1 1)`,
  down: `translate(${W} 0) rotate(90)`,
  up: `translate(0 ${H}) rotate(-90)`,
}[facing];
const ox = facing === "left" ? W - depth : 0,
  oy = facing === "up" ? H - depth : 0;
const size = Number(d.size ?? 15);
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const lx = facing === "right" ? depth + 8 : facing === "left" ? ox - 8 : W / 2;
const ly =
  facing === "down"
    ? depth + size * 1.1
    : facing === "up"
      ? oy - size * 0.5
      : H / 2;
const anchor =
  facing === "right" ? "start" : facing === "left" ? "end" : "middle";
const label = d.label
  ? `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="${vertical ? "central" : "auto"}" font-size="${size}" fill="${t.ink || "#222"}">${esc(d.label)}</text>`
  : "";
return api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(t.font || "system-ui")}">
  <path d="${path}" transform="${turn}" fill="none" stroke="${d.color || t.muted || "#888"}" stroke-width="${Number(d.width ?? 1.4)}" stroke-linecap="round" stroke-linejoin="round"/>${label}
</svg>`);
