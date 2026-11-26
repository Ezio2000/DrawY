// A label joined to the part it names by a thin leader line ending in a small dot, the way
// textbook figures name parts. `target` is the named point in the module (0..1); the text
// sits on `side` of the module, at `textAt` along that side, so a column of labels can line
// up on one side while their leaders bend once to parts at any height.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const size = Number(d.size ?? 15);
const side = d.side ?? "right";
const fallback = {
  right: { x: 0, y: 0.5 },
  left: { x: 1, y: 0.5 },
  above: { x: 0.5, y: 1 },
  below: { x: 0.5, y: 0 },
}[side];
const target = {
  x: (d.target ?? fallback).x * W,
  y: (d.target ?? fallback).y * H,
};
const text = String(d.text ?? "");
const font = t.font || "system-ui";
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const ctx = document.createElement("canvas").getContext("2d");
ctx.font = `${size}px ${font}`;
const width = ctx.measureText(text).width;
const at = Math.min(1, Math.max(0, Number(d.textAt ?? 0.5)));
const gap = 7;
let tx, ty, anchor, end, knee;
if (side === "right" || side === "left") {
  const y = Math.min(H - size * 0.7, Math.max(size * 0.7, at * H));
  const right = side === "right";
  [tx, ty, anchor] = [right ? W : 0, y, right ? "end" : "start"];
  end = { x: right ? W - width - gap : width + gap, y };
  // A level run out of the text, then one bend down or up to the part.
  const run = Math.min(size * 2, Math.abs(end.x - target.x) * 0.5);
  knee = { x: end.x + (right ? -run : run), y };
} else {
  const x = Math.min(W - width / 2, Math.max(width / 2, at * W));
  const above = side === "above";
  [tx, ty, anchor] = [x, above ? size * 0.85 : H - size * 0.3, "middle"];
  end = { x, y: above ? size * 1.35 : H - size * 1.35 };
  const run = Math.min(size * 2, Math.abs(target.y - end.y) * 0.5);
  knee = { x, y: end.y + (above ? run : -run) };
}
const bend = d.bend !== "straight";
const path = bend
  ? `M${target.x} ${target.y}L${knee.x} ${knee.y}L${end.x} ${end.y}`
  : `M${target.x} ${target.y}L${end.x} ${end.y}`;
const line = d.color || t.muted || "#888";
// The dot drags onto the part it names, the words along their side.
const share = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
if (d.target) api.handle("target", { kind: "point", at: target, unproject: (x, y) => ({ x: share(x / W), y: share(y / H) }) });
if (d.textAt != null)
  api.handle("textAt", side === "right" || side === "left" ? { kind: "scalar", at: { x: tx, y: ty }, axis: "y", scale: 1 / H } : { kind: "scalar", at: { x: tx, y: ty }, axis: "x", scale: 1 / W });
return api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}">
  <path d="${path}" stroke="${line}" stroke-width="${Number(d.width ?? 1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  ${d.dot === false ? "" : `<circle cx="${target.x}" cy="${target.y}" r="${Number(d.width ?? 1) * 2.2}" fill="${line}"/>`}
  <text x="${tx}" y="${ty}" text-anchor="${anchor}" dominant-baseline="central" font-size="${size}" fill="${d.textColor || t.ink || "#222"}" paint-order="stroke" stroke="${t.paper || "#fff"}" stroke-width="4" stroke-linejoin="round"${d.text != null ? api.text("text") : ""}>${esc(text)}</text>
</svg>`);
