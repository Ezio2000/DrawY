// A comparison grid: options as columns, criteria as rows. A value shows in its cell as
// words, a tick (true) or a dash (false); a cell left empty stays clear, so a picture, a
// node or a small diagram can sit there as its own module. Each column can take its own
// colour, shown in its heading and a light band down the column; one column can be
// highlighted as the recommended or subject option. Rules between rows only.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
const font = t.font || "system-ui";
const ctx = document.createElement("canvas").getContext("2d");
const measure = (s, size, weight = 400) => {
  ctx.font = `${weight} ${size}px ${font}`;
  return ctx.measureText(String(s ?? "")).width;
};
const ink = t.ink || "#222",
  muted = t.muted || "#888",
  accent = t.accent || "#d97757";
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 14);
const columns = (d.columns || []).map((c) =>
  typeof c === "object" && c ? c : { label: String(c ?? "") },
);
const rows = (d.rows || []).map((r) => (r && typeof r === "object" ? r : { label: String(r ?? "") }));
const lit = Number(d.highlight ?? -1);
const numbered = !!d.numbered;
const badge = size * 1.7;
const labelW =
  Number(d.labelWidth) ||
  Math.min(
    W * 0.36,
    Math.max(
      size * 4,
      ...rows.map((r) =>
        Math.max(measure(r.label, size, 600), measure(r.note, size * 0.8)),
      ),
    ) +
      size * 1.6 +
      (numbered ? badge + size * 0.5 : 0),
  );
const cols = Math.max(1, columns.length);
const colW = (W - labelW) / cols;
const headH =
  Number(d.headerHeight) || size * (columns.some((c) => c.note) ? 3.8 : 2.8);
const rowH = (H - headH) / Math.max(1, rows.length);
const cx = (j) => labelW + colW * (j + 0.5);
const colour = (j) => columns[j]?.color || (j === lit ? accent : null);
let out = "";
const gap = size * 0.2,
  round = Math.min(12, colW / 6);
columns.forEach((c, j) => {
  const k = colour(j);
  if (!k) return;
  out += `<rect x="${labelW + colW * j + gap}" y="${sw / 2}" width="${colW - 2 * gap}" height="${H - sw}" rx="${round}" fill="${k}" fill-opacity="${j === lit ? 0.1 : 0.06}"${j === lit ? ` stroke="${k}" stroke-width="${sw}"` : ""}/>`;
});
if (d.corner)
  out += `<text x="${size * 0.6}" y="${headH / 2}" font-size="${size * 0.85}" fill="${muted}"${api.text("corner")}>${esc(d.corner)}</text>`;
columns.forEach((c, j) => {
  const k = colour(j) || ink;
  const path = api.path("columns", c, j);
  let head = `<rect class="plain" x="${labelW + colW * j}" y="0" width="${colW}" height="${headH}" fill="transparent"/>`;
  head += `<text x="${cx(j)}" y="${headH / 2 - (c.note ? size * 0.55 : 0)}" text-anchor="middle" font-size="${size * 1.05}" font-weight="700" fill="${k}"${api.text(typeof (d.columns || [])[j] === "object" && (d.columns || [])[j] ? path + ".label" : path)}>${esc(c.label)}</text>`;
  if (c.note)
    head += `<text x="${cx(j)}" y="${headH / 2 + size * 0.85}" text-anchor="middle" font-size="${size * 0.8}" fill="${muted}"${api.text(path + ".note")}>${esc(c.note)}</text>`;
  out += `<g${api.part(path, { reorder: "x" })}>${head}</g>`;
  api.slot("columns", j, { x: labelW + colW * j, y: headH / 2 });
});
if (columns.length) api.slot("columns", columns.length, { x: W - 4, y: headH / 2 });
out += `<path d="M0 ${headH}H${W}" stroke="${ink}" stroke-width="${sw}"/>`;
const tick = (x, y, c) =>
  `<path d="M${x - size * 0.45} ${y}l${size * 0.32} ${size * 0.34}l${size * 0.6} ${-size * 0.72}" fill="none" stroke="${c}" stroke-width="${sw * 1.4}" stroke-linecap="round" stroke-linejoin="round"/>`;
rows.forEach((r, i) => {
  const y = headH + rowH * (i + 0.5);
  const path = api.path("rows", r, i);
  if (i)
    out += `<path d="M0 ${headH + rowH * i}H${W}" stroke="${muted}" stroke-opacity=".35" stroke-width="1"/>`;
  api.slot("rows", i, { x: size * 0.4, y: headH + rowH * i });
  // A row is its name and its cells, one part to select and drag up or down.
  const before = out;
  out = "";
  let x = size * 0.6;
  if (numbered) {
    out += `<circle cx="${x + badge / 2}" cy="${y}" r="${badge / 2}" fill="${ink}"/><text x="${x + badge / 2}" y="${y}" text-anchor="middle" font-size="${size * 0.85}" font-weight="700" fill="${t.paper || "#fff"}">${i + 1}</text>`;
    x += badge + size * 0.5;
  }
  out += `<rect class="plain" x="0" y="${headH + rowH * i}" width="${W}" height="${rowH}" fill="transparent"/>`;
  out += `<text x="${x}" y="${y - (r.note ? size * 0.5 : 0)}" font-size="${size}" font-weight="600" fill="${ink}"${api.text(typeof (d.rows || [])[i] === "object" && (d.rows || [])[i] ? path + ".label" : path)}>${esc(r.label)}</text>`;
  if (r.note)
    out += `<text x="${x}" y="${y + size * 0.8}" font-size="${size * 0.8}" fill="${muted}"${api.text(path + ".note")}>${esc(r.note)}</text>`;
  (r.values || []).slice(0, cols).forEach((v, j) => {
    const c = colour(j) || ink;
    if (v === true) out += tick(cx(j), y, c);
    else if (v === false)
      out += `<path d="M${cx(j) - size * 0.35} ${y}h${size * 0.7}" stroke="${muted}" stroke-width="${sw * 1.2}" stroke-linecap="round"/>`;
    else if (v !== null && v !== undefined && v !== "") {
      const s = String(v),
        fs = Math.min(size, (size * (colW - size)) / (measure(s, size) || 1));
      out += `<text x="${cx(j)}" y="${y}" text-anchor="middle" font-size="${Math.max(size * 0.7, fs)}" fill="${c}"${api.text(`${path}.values.${j}`)}>${esc(s)}</text>`;
    }
  });
  out = `${before}<g${api.part(path, { reorder: "y" })}>${out}</g>`;
});
if (rows.length) api.slot("rows", rows.length, { x: size * 0.4, y: H - 2 });
return api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}" dominant-baseline="central">${out}</svg>`,
);
