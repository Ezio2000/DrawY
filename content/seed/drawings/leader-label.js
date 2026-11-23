// A label joined to the part it names by a thin leader line ending in a small dot, the way
// textbook figures name parts. `target` is the named point in the module (0..1); the text
// sits on `side` of the module.
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
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const width = [...text].reduce(
  (n, ch) => n + (/[⺀-￿]/.test(ch) ? size : size * 0.56),
  0,
);
let tx, ty, anchor, end;
if (side === "right")
  [tx, ty, anchor, end] = [W, H / 2, "end", { x: W - width - 7, y: H / 2 }];
else if (side === "left")
  [tx, ty, anchor, end] = [0, H / 2, "start", { x: width + 7, y: H / 2 }];
else if (side === "above")
  [tx, ty, anchor, end] = [
    W / 2,
    size * 0.85,
    "middle",
    { x: W / 2, y: size * 1.35 },
  ];
else
  [tx, ty, anchor, end] = [
    W / 2,
    H - size * 0.3,
    "middle",
    { x: W / 2, y: H - size * 1.35 },
  ];
const line = d.color || t.muted || "#888";
return api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(t.font || "system-ui")}">
  <path d="M${target.x} ${target.y}L${end.x} ${end.y}" stroke="${line}" stroke-width="${Number(d.width ?? 1)}" fill="none" stroke-linecap="round"/>
  ${d.dot === false ? "" : `<circle cx="${target.x}" cy="${target.y}" r="${Number(d.width ?? 1) * 2.2}" fill="${line}"/>`}
  <text x="${tx}" y="${ty}" text-anchor="${anchor}" dominant-baseline="central" font-size="${size}" fill="${d.textColor || t.ink || "#222"}" paint-order="stroke" stroke="${t.paper || "#fff"}" stroke-width="4" stroke-linejoin="round">${esc(text)}</text>
</svg>`);
