// A sequence diagram: participants across the top (a box, a person, a database or a queue)
// with dashed lifelines, messages as arrows between them in time order (calls filled,
// asynchronous messages open, replies dashed), a message to oneself as a loop, notes over
// the lifelines and fragments (alt, opt, loop, par) boxed round a run of messages, an alt's
// branches and a par's threads divided by dashed lines. Every
// part is marked as the data it is drawn from, so it is changed where it is drawn.
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
  paper = t.paper || "#fff",
  muted = t.muted || "#888",
  accent = t.accent || "#d97757",
  accent2 = t.accent2 || "#4f7c8a";
const sw = Math.max(1, Number(t.stroke ?? 1.6) * 0.85);
const size = Number(d.size ?? 14);
const rec = (x) => (x && typeof x === "object" ? x : { label: String(x ?? "") });
const people = (d.participants || []).map(rec);
const n = Math.max(1, people.length);
// A reference names a participant by id; while a write streams, it may still be a name.
const find = (list, ref) => {
  const byId = list.findIndex((p) => p.id !== undefined && p.id === ref);
  return byId >= 0 ? byId : list.findIndex((p) => p.label === ref);
};
const msgs = (d.messages || []).map(rec);
const notes = (d.notes || []).map((x) => (x && typeof x === "object" ? x : { text: String(x ?? "") }));
const frames = (d.fragments || []).filter((x) => x && typeof x === "object");
const actorish = people.some((p) => p.kind === "actor");
const bw = Math.min(
    W / n - size,
    Math.max(...people.map((p) => measure(p.label, size, 700)), size * 3) + size * 2,
  ),
  bh = size * 2.4,
  // A person stands over its name, so the header is taller when one is there.
  hh = actorish ? size * 4.4 : bh;
const X = (i) => (W * (i + 0.5)) / n;
const top = hh + sw;
// Time runs down in rows: each message, and each note after the message it follows.
const rows = [];
const noteAfter = (id) => notes.filter((nt) => (nt.after ?? null) === id);
for (const nt of noteAfter(null)) rows.push({ note: nt });
msgs.forEach((m, k) => {
  rows.push({ message: m, k });
  if (m.id !== undefined) for (const nt of noteAfter(m.id)) rows.push({ note: nt });
});
for (const nt of notes)
  if (nt.after != null && !msgs.some((m) => m.id === nt.after)) rows.push({ note: nt });
const row = (H - top - size * 0.8) / (rows.length + 0.4 || 1);
const rowY = (r) => top + row * (r + 0.8);
let out = "";
// Participants, each a part of the diagram with its name as words of its own.
people.forEach((p, i) => {
  const path = api.path("participants", p, i);
  const x = X(i);
  const tone = p.accent ? accent : accent2;
  out += `<rect class="plain" x="${x - 10}" y="${top}" width="20" height="${H - top}" fill="transparent"${p.id !== undefined ? api.anchor("participants", p.id, { shape: "lifeline" }) : ""}/>`;
  out += `<path class="plain" d="M${x} ${top}V${H}" stroke="${muted}" stroke-width="1" stroke-dasharray="4 4"/>`;
  let shape = "",
    ty = hh - bh / 2;
  if (p.kind === "actor") {
    const r = size * 0.42,
      cy = size * 0.55;
    shape = `<circle cx="${x}" cy="${cy}" r="${r}" fill="${paper}" stroke="${ink}" stroke-width="${sw}"/><path d="M${x} ${cy + r}v${size * 0.95}M${x - size * 0.7} ${cy + r + size * 0.4}h${size * 1.4}M${x} ${cy + r + size * 0.95}l${-size * 0.55} ${size * 0.75}M${x} ${cy + r + size * 0.95}l${size * 0.55} ${size * 0.75}" fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round"/>`;
    ty = hh - size * 0.75;
  } else if (p.kind === "database") {
    const e = bh * 0.16,
      y0 = hh - bh + e;
    shape = `<path d="M${x - bw / 2} ${y0}V${hh - e}A${bw / 2} ${e} 0 0 0 ${x + bw / 2} ${hh - e}V${y0}" fill="${tone}" fill-opacity=".14" stroke="${tone}" stroke-width="${sw}"/><ellipse cx="${x}" cy="${y0}" rx="${bw / 2}" ry="${e}" fill="${paper}" stroke="${tone}" stroke-width="${sw}"/>`;
    ty = hh - bh / 2 + e / 2;
  } else if (p.kind === "queue") {
    const e = Math.min(bw * 0.08, bh / 3),
      y0 = hh - bh + sw / 2;
    shape = `<path d="M${x - bw / 2 + e} ${y0}H${x + bw / 2 - e}A${e} ${bh / 2} 0 0 1 ${x + bw / 2 - e} ${y0 + bh}H${x - bw / 2 + e}A${e} ${bh / 2} 0 0 1 ${x - bw / 2 + e} ${y0}Z" fill="${tone}" fill-opacity=".14" stroke="${tone}" stroke-width="${sw}"/><path d="M${x + bw / 2 - e} ${y0}A${e} ${bh / 2} 0 0 0 ${x + bw / 2 - e} ${y0 + bh}" fill="none" stroke="${tone}" stroke-width="${sw}"/>`;
  } else
    shape = `<rect x="${x - bw / 2}" y="${hh - bh + sw / 2}" width="${bw}" height="${bh - sw}" rx="${Math.min(8, bh / 3)}" fill="${tone}" fill-opacity=".14" stroke="${tone}" stroke-width="${sw}"/>`;
  out += `<g${api.part(path, { reorder: "x" })}>${shape}<text x="${x}" y="${ty}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${ink}"${api.text(path + ".label")}>${esc(p.label)}</text></g>`;
});
// Between participants, and either side of them, a new one can go.
for (let i = 0; i <= people.length; i++) api.slot("participants", i, { x: people.length ? (W * i) / n : W / 2, y: hh - bh / 2 });
const hl = Math.max(7, sw * 4.5),
  hw = hl * 0.42;
const slotX = Math.max(size * 0.6, (X(0) - bw / 2) / 2);
// Fragments go under the messages they hold.
const rowOf = (id) => rows.findIndex((r) => r.message && r.message.id === id);
frames.forEach((f, j) => {
  const a = rowOf(f.from),
    b = rowOf(f.to ?? f.from);
  if (a < 0 || b < 0) return;
  const [r0, r1] = a <= b ? [a, b] : [b, a];
  const held = rows.slice(r0, r1 + 1).flatMap((r) => (r.message ? [find(people, r.message.from), find(people, r.message.to)] : []));
  const lo = Math.min(...held.filter((i) => i >= 0)),
    hi = Math.max(...held.filter((i) => i >= 0));
  if (!Number.isFinite(lo)) return;
  const x0 = Math.max(sw, X(lo) - W / n / 2.6),
    x1 = Math.min(W - sw, X(hi) + W / n / 2.6);
  const y0 = rowY(r0) - row * 0.62,
    y1 = rowY(r1) + row * 0.38;
  const path = api.path("fragments", f, j);
  const kind = String(f.kind || "alt");
  const tag = measure(kind, size * 0.8, 700) + size;
  out += `<g${api.part(path)}><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${muted}" stroke-width="${sw * 0.8}"/><path d="M${x0} ${y0}h${tag}v${size * 0.9}l${-size * 0.4} ${size * 0.4}H${x0}z" fill="${paper}" stroke="${muted}" stroke-width="${sw * 0.8}"/><text x="${x0 + size * 0.35}" y="${y0 + size * 0.62}" font-size="${size * 0.8}" font-weight="700" fill="${muted}">${esc(kind)}</text>${f.label ? `<text x="${x0 + tag + size * 0.5}" y="${y0 + size * 0.62}" font-size="${size * 0.8}" fill="${muted}" font-style="italic"${api.text(path + ".label")}>${esc(f.label)}</text>` : ""}</g>`;
  // An alt's further branches and a par's further threads, each under a dashed line above
  // its first message, with its condition.
  const sections = ["alt", "par"].includes(kind) && Array.isArray(f.sections) ? f.sections.filter((x) => x && typeof x === "object") : [];
  sections.forEach((x, i) => {
    const r = rowOf(x.from);
    if (r <= r0 || r > r1) return;
    const y = rowY(r) - row * 0.62;
    const at = api.path(path + ".sections", x, i);
    out += `<g${api.part(at)}><path d="M${x0} ${y}H${x1}" stroke="${muted}" stroke-width="${sw * 0.8}" stroke-dasharray="${sw * 4} ${sw * 3}"/>${x.label ? `<text x="${x0 + size * 0.5}" y="${y + size * 0.85}" font-size="${size * 0.8}" fill="${muted}" font-style="italic"${api.text(at + ".label")}>${esc(x.label)}</text>` : ""}</g>`;
  });
});
rows.forEach((r, ri) => {
  const y = rowY(ri);
  if (r.note) {
    const nt = r.note,
      j = notes.indexOf(nt);
    const over = (Array.isArray(nt.over) ? nt.over : [nt.over]).map((ref) => find(people, ref)).filter((i) => i >= 0);
    const path = api.path("notes", nt, j);
    const lo = over.length ? Math.min(...over) : 0,
      hi = over.length ? Math.max(...over) : 0;
    // Beside a lifeline a note stands off the first it names; over them it spans them all.
    const side = nt.placement === "left" ? -1 : nt.placement === "right" ? 1 : 0;
    const first = over.length ? over[0] : 0;
    const w = Math.max(measure(nt.text, size * 0.85) + size * 1.4, !side && hi > lo ? X(hi) - X(lo) + size * 2 : 0);
    const cx = side ? X(first) + side * (w / 2 + size * 0.6) : (X(lo) + X(hi)) / 2,
      h = Math.min(row * 0.8, size * 2);
    out += `<g${api.part(path, { reorder: "y" })}><path d="M${cx - w / 2} ${y - h / 2}H${cx + w / 2 - size * 0.5}l${size * 0.5} ${size * 0.5}V${y + h / 2}H${cx - w / 2}Z" fill="${accent}" fill-opacity=".12" stroke="${accent}" stroke-width="${sw * 0.8}"/><text x="${cx}" y="${y}" text-anchor="middle" font-size="${size * 0.85}" fill="${ink}"${api.text(path + ".text")}>${esc(nt.text)}</text></g>`;
    return;
  }
  const m = r.message,
    k = r.k;
  const a = find(people, m.from),
    b = find(people, m.to);
  // A message to someone not among the participants is not drawn; the workspace refuses it.
  if (a < 0 || b < 0) return;
  const path = api.path("messages", m, k);
  const c = m.accent ? accent : ink;
  const kind = m.kind ?? "sync";
  const dash = kind === "reply" ? ` stroke-dasharray="${sw * 3} ${sw * 2.5}"` : "";
  const open = kind !== "sync";
  const num = d.numbered ? `${k + 1}.` : "";
  const fs = size * 0.88;
  const words = (x, ly, anchor) => {
    const label = `<text x="${x}" y="${ly}" text-anchor="${anchor}" font-size="${fs}" fill="${c}" paint-order="stroke" stroke="${paper}" stroke-width="4" stroke-linejoin="round"${api.text(path + ".label")}>${esc(m.label ?? "")}</text>`;
    if (!num) return label;
    // The number is drawn apart from the words, so the words alone are the message's label.
    const lw = measure(m.label ?? "", fs);
    const nx = anchor === "middle" ? x - lw / 2 - fs * 0.3 : x - fs * 0.3;
    return `<text x="${nx}" y="${ly}" text-anchor="end" font-size="${fs}" font-weight="700" fill="${c}" paint-order="stroke" stroke="${paper}" stroke-width="4">${num}</text>` + label;
  };
  let shape;
  if (a === b) {
    const x = X(a),
      w = Math.min(W / n / 2.5, size * 3);
    shape = `<path d="M${x} ${y - row * 0.2}H${x + w}V${y + row * 0.2}H${x + hl}" fill="none" stroke="${c}" stroke-width="${sw}"${dash}/>`;
    shape += open
      ? `<path d="M${x + hl} ${y + row * 0.2 - hw}L${x} ${y + row * 0.2}L${x + hl} ${y + row * 0.2 + hw}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="M${x} ${y + row * 0.2}l${hl} ${-hw}v${hw * 2}z" fill="${c}"/>`;
    shape += words(x + w + size * 0.4 + (num ? measure(num, fs) + fs * 0.3 : 0), y, "start");
    api.handle(path + ".from", { kind: "ref", at: { x, y: y - row * 0.2 } });
    api.handle(path + ".to", { kind: "ref", at: { x, y: y + row * 0.2 } });
  } else {
    const s = Math.sign(X(b) - X(a));
    const xa = X(a),
      xb = X(b) - s * 2;
    shape = `<path d="M${xa} ${y}H${xb - (open ? 0 : s * hl * 0.7)}" stroke="${c}" stroke-width="${sw}"${dash}/>`;
    shape += open
      ? `<path d="M${xb - s * hl} ${y - hw}L${xb} ${y}L${xb - s * hl} ${y + hw}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
      : `<path d="M${xb} ${y}l${-s * hl} ${-hw}v${hw * 2}z" fill="${c}"/>`;
    // A wide hit line, so the message is easy to press.
    shape = `<path class="plain" d="M${xa} ${y}H${xb}" stroke="transparent" stroke-width="${Math.max(10, row * 0.5)}"/>` + shape;
    shape += words((xa + xb) / 2, y - size * 0.75, "middle");
    api.handle(path + ".from", { kind: "ref", at: { x: xa, y } });
    api.handle(path + ".to", { kind: "ref", at: { x: xb, y } });
  }
  out += `<g${api.part(path, { reorder: "y" })}>${shape}</g>`;
});
// Between messages, and before the first and after the last, a new one can go; dragging
// from one lifeline to another makes one there.
let m = 0;
rows.forEach((r, ri) => {
  if (!r.message) return;
  api.slot("messages", m++, { x: slotX, y: rowY(ri) - row / 2 });
});
api.slot("messages", m, { x: slotX, y: rows.length ? rowY(rows.length - 1) + row / 2 : top + row / 2 });
api.create({ list: "messages", between: ["from", "to"], rows: "y" });
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}" dominant-baseline="central">${out}</svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll(
    "path:not(.plain),rect:not(.plain),circle:not(.plain),ellipse:not(.plain)",
  ))
    el.setAttribute("filter", fx);
}
return svg;
