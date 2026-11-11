// An entity or class as a table: its name in a header over rows of fields. For an
// entity-relationship diagram each row is a field with its type and a key mark (PK, FK); for
// a UML class the rows are attributes and methods, with a rule between the two.
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
const tone = tones[d.tone] ? d.tone : "accent2";
const color = d.color || tones[tone];
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 14);
const rows = (d.rows || []).map((r) =>
  typeof r === "string" ? (/^-{2,}$/.test(r) ? { rule: true } : { name: r }) : r || {},
);
const head = size * (d.stereotype ? 3.3 : 2.3);
const fields = rows.filter((r) => !r.rule).length,
  rules = rows.length - fields;
// Rows share the room under the header; a rule takes a third of a row.
const unit = Math.max(size * 1.2, (H - head - size * 0.4) / Math.max(1, fields + rules / 3));
const r = Math.min(Number(d.radius ?? 8), size);
const effect = d.effect ? ` filter="${api.effect(d.effect)}"` : "";
const keys = { pk: "PK", fk: "FK", uk: "UK" };
let body = "",
  y = head + size * 0.2;
for (const row of rows) {
  if (row.rule) {
    y += unit / 6;
    body += `<div class="rule" style="top:${y}px"></div>`;
    y += unit / 6;
    continue;
  }
  const key = keys[String(row.key ?? "").toLowerCase()] ?? (row.key ? String(row.key) : "");
  body += `<div class="row${row.key ? " keyed" : ""}" style="top:${y}px;height:${unit}px"><span class="key">${esc(key)}</span><span class="field">${esc(row.name)}</span><span class="type">${esc(row.type ?? "")}</span></div>`;
  y += unit;
}
return api.html(`<style>
:host,.entity{position:relative;width:${W}px;height:${H}px;font-family:${esc(t.font || "system-ui")}}
svg{position:absolute;inset:0;overflow:visible}
.head{position:absolute;left:0;right:0;top:0;height:${head}px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${ink};padding:0 ${size * 0.6}px;text-align:center}
.stereo{font-size:${size * 0.78}px;line-height:1.25;color:${muted}}
.name{font-size:${size}px;font-weight:700;line-height:1.25;white-space:nowrap}
.row{position:absolute;left:${size * 0.7}px;right:${size * 0.7}px;display:flex;align-items:center;gap:${size * 0.5}px;font-size:${size * 0.9}px;line-height:1.2;color:${ink};white-space:nowrap}
.key{flex:none;width:${d.keys === false ? 0 : size * 1.5}px;font-size:${size * 0.68}px;font-weight:700;letter-spacing:.02em;color:${color}}
.keyed .field{font-weight:600}
.field{flex:1;min-width:0}
.type{flex:none;color:${muted};font-size:${size * 0.82}px}
.rule{position:absolute;left:0;right:0;border-top:${sw}px solid ${color};opacity:.55}
</style><div class="entity"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><g${effect}><rect x="${sw / 2}" y="${sw / 2}" width="${W - sw}" height="${H - sw}" rx="${r}" fill="${paper}" stroke="${color}" stroke-width="${sw}"/><path d="M${sw / 2} ${head}V${r + sw / 2}Q${sw / 2} ${sw / 2} ${r + sw / 2} ${sw / 2}H${W - r - sw / 2}Q${W - sw / 2} ${sw / 2} ${W - sw / 2} ${r + sw / 2}V${head}Z" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-width="${sw}"/></g></svg><div class="head">${d.stereotype ? `<div class="stereo">«${esc(d.stereotype)}»</div>` : ""}<div class="name">${esc(d.name)}</div></div>${body}</div>`);
