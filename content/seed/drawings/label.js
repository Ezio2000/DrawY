// A short label in the work's type with a paper-coloured halo, so it stays legible over
// pictures and lines. Lines break at "\n"; an optional note sits underneath, smaller.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const size = Number(d.size ?? 16);
const align = d.align ?? "center";
const x = align === "start" ? 0 : align === "end" ? W : W / 2;
const anchor = align === "center" ? "middle" : align;
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const lines = String(d.text ?? "").split("\n");
const note = d.note ? String(d.note).split("\n") : [];
const noteSize = size * 0.78;
const total = lines.length * size * 1.25 + note.length * noteSize * 1.3;
let y = (H - total) / 2 + size * 0.95;
const halo =
  d.halo === false
    ? ""
    : `paint-order="stroke" stroke="${t.paper || "#fff"}" stroke-width="${Math.max(3, size / 4)}" stroke-linejoin="round"`;
const rows = [];
for (const line of lines) {
  rows.push(
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${d.weight ?? 500}" fill="${d.color || t.ink || "#222"}" ${halo}>${esc(line)}</text>`,
  );
  y += size * 1.25;
}
for (const line of note) {
  rows.push(
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${noteSize}" fill="${d.noteColor || t.muted || "#777"}" ${halo}>${esc(line)}</text>`,
  );
  y += noteSize * 1.3;
}
return api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(t.font || "system-ui")}">${rows.join("")}</svg>`,
);
