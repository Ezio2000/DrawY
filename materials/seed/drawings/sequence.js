// A sequence diagram: participants across the top with dashed lifelines, and messages as
// arrows between them in time order, replies dashed with open heads, a message to oneself
// as a loop. Combined fragments (alt, loop, opt, par…) are written into the message list
// where they open, divide and close, and frame the messages between; activation bars show
// when a participant is at work, and notes sit over lifelines. Drawn in the style instead
// of a generic renderer.
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
const actors = (d.actors || []).map((a) =>
  typeof a === "string" ? { label: a } : a,
);
const n = Math.max(1, actors.length);
const FRAGMENTS = ["alt", "loop", "opt", "par", "critical", "break", "group"];
// The list in time order: messages, and the entries that open, divide and close a fragment
// or lay a note over lifelines.
const entries = (d.messages || []).map((m) => {
  const kind = FRAGMENTS.find((k) => m && m[k] !== undefined);
  if (kind) return { type: "open", kind, label: m[kind] === true ? "" : String(m[kind] ?? ""), units: 0.8 };
  if (m && m.else !== undefined) return { type: "else", label: m.else === true ? "" : String(m.else ?? ""), units: 0.7 };
  if (m && m.end) return { type: "end", units: 0.4 };
  if (m && m.note !== undefined) return { type: "note", m, units: 1.15 };
  return { type: "message", m: m || {}, units: 1 };
});
const bw = Math.min(
    W / n - size,
    Math.max(...actors.map((a) => measure(a.label, size, 600)), size * 3) +
      size * 2,
  ),
  bh = size * 2.4;
const X = (i) => (W * (i + 0.5)) / n;
const index = (name) => {
  const i = actors.findIndex((a) => a.label === name);
  return i < 0 ? Math.min(n - 1, Math.max(0, Number(name) || 0)) : i;
};
const person = (a) => a.kind === "actor";
const top = bh + (actors.some(person) ? size * 1.4 : 0);
const units = entries.reduce((s, e) => s + e.units, 0);
const row = (H - top - size * 1.2) / (units + 0.6);
// Where each entry sits down the page.
let run = top + row * 0.4;
for (const e of entries) {
  e.y = run + (e.type === "message" || e.type === "note" ? e.units * row * 0.55 : 0);
  e.top = run;
  run += e.units * row;
}
const bottom = run;
// Activation bars: a call puts its receiver to work until the reply goes back, or the
// messages say when with activate and deactivate.
const aw = size * 0.72;
const bars = [];
const open = actors.map(() => []);
const auto = d.activations === true;
for (const e of entries) {
  if (e.type !== "message") continue;
  const a = index(e.m.from),
    b = index(e.m.to);
  if (auto ? !e.m.reply && a !== b : e.m.activate) {
    const bar = { actor: b, from: e.y, to: bottom - row * 0.3, depth: open[b].length };
    open[b].push(bar);
    bars.push(bar);
  }
  if (auto ? e.m.reply && a !== b : e.m.deactivate) {
    const bar = open[a].pop();
    if (bar) bar.to = e.y;
  }
}
const active = (i, y) => bars.filter((b) => b.actor === i && b.from <= y + 0.01 && b.to >= y - 0.01).length;
// Fragments: each frames the lifelines its messages touch.
const frames = [];
const stack = [];
for (const e of entries) {
  if (e.type === "open") {
    const f = { kind: e.kind, label: e.label, top: e.top, lo: n, hi: -1, depth: stack.length, parts: [] };
    stack.push(f);
    frames.push(f);
  } else if (e.type === "else") {
    stack.at(-1)?.parts.push({ y: e.top + e.units * row * 0.15, label: e.label });
  } else if (e.type === "end") {
    const f = stack.pop();
    if (f) f.bottom = e.top + e.units * row * 0.5;
  } else {
    const touched =
      e.type === "message"
        ? [index(e.m.from), index(e.m.to)]
        : [].concat(e.m.over ?? []).map(index);
    for (const f of stack)
      for (const i of touched) {
        f.lo = Math.min(f.lo, i);
        f.hi = Math.max(f.hi, i);
      }
  }
}
for (const f of stack) f.bottom = bottom;
let out = "";
const lifeEnd = Math.max(bottom + row * 0.2, H - size * 0.2);
actors.forEach((a, i) => {
  const c = a.accent ? accent : accent2;
  out += `<path class="plain" d="M${X(i)} ${top}V${lifeEnd}" stroke="${muted}" stroke-width="1" stroke-dasharray="4 4"/>`;
  if (person(a)) {
    // A stick figure for a human actor, its name underneath.
    const u = size * 0.5,
      x = X(i),
      y0 = sw;
    out += `<circle cx="${x}" cy="${y0 + u * 0.8}" r="${u * 0.8}" fill="${paper}" stroke="${c}" stroke-width="${sw}"/><path d="M${x} ${y0 + u * 1.6}V${y0 + u * 3.4}M${x - u * 1.3} ${y0 + u * 2.3}H${x + u * 1.3}M${x - u * 1.1} ${y0 + u * 4.8}L${x} ${y0 + u * 3.4}L${x + u * 1.1} ${y0 + u * 4.8}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
    out += `<text x="${x}" y="${top - size * 0.65}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${ink}" paint-order="stroke" stroke="${paper}" stroke-width="4" stroke-linejoin="round">${esc(a.label)}</text>`;
    return;
  }
  out += `<rect x="${X(i) - bw / 2}" y="${top - bh + sw / 2}" width="${bw}" height="${bh - sw}" rx="${Math.min(8, bh / 3)}" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="${sw}"/>`;
  out += `<text x="${X(i)}" y="${top - bh / 2}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${ink}">${esc(a.label)}</text>`;
});
// Fragments lie under the bars and messages.
const pad = Math.min(W / n / 2 - 4, Math.max(bw / 2 + size * 0.6, size * 3));
for (const f of frames) {
  const lo = f.hi < 0 ? 0 : f.lo,
    hi = f.hi < 0 ? n - 1 : f.hi;
  const inset = f.depth * size * 0.45;
  const x0 = Math.max(sw, X(lo) - pad + inset),
    x1 = Math.min(W - sw, X(hi) + pad - inset + (lo === hi ? size * 4 : 0));
  const tagW = measure(f.kind, size * 0.8, 700) + size * 1.1,
    tagH = size * 1.35;
  out += `<rect class="plain" x="${x0}" y="${f.top}" width="${x1 - x0}" height="${f.bottom - f.top}" rx="4" fill="${accent2}" fill-opacity=".05" stroke="${muted}" stroke-width="${sw * 0.9}"/>`;
  out += `<path class="plain" d="M${x0} ${f.top}H${x0 + tagW}V${f.top + tagH * 0.6}L${x0 + tagW - tagH * 0.4} ${f.top + tagH}H${x0}Z" fill="${muted}"/>`;
  out += `<text x="${x0 + size * 0.45}" y="${f.top + tagH / 2}" font-size="${size * 0.8}" font-weight="700" fill="${paper}">${esc(f.kind)}</text>`;
  if (f.label)
    out += `<text x="${x0 + tagW + size * 0.5}" y="${f.top + tagH / 2}" font-size="${size * 0.82}" font-weight="600" fill="${ink}" paint-order="stroke" stroke="${paper}" stroke-width="4" stroke-linejoin="round">${esc(f.label)}</text>`;
  for (const part of f.parts) {
    out += `<path class="plain" d="M${x0} ${part.y}H${x1}" stroke="${muted}" stroke-width="${sw * 0.9}" stroke-dasharray="${sw * 4} ${sw * 3}"/>`;
    if (part.label)
      out += `<text x="${x0 + size * 0.5}" y="${part.y + size * 0.85}" font-size="${size * 0.82}" font-weight="600" fill="${ink}" paint-order="stroke" stroke="${paper}" stroke-width="4" stroke-linejoin="round">${esc(part.label)}</text>`;
  }
}
for (const b of bars)
  out += `<rect x="${X(b.actor) - aw / 2 + b.depth * aw * 0.45}" y="${b.from}" width="${aw}" height="${Math.max(row * 0.3, b.to - b.from)}" rx="2" fill="${paper}" stroke="${actors[b.actor]?.accent ? accent : accent2}" stroke-width="${sw}"/><rect class="plain" x="${X(b.actor) - aw / 2 + b.depth * aw * 0.45}" y="${b.from}" width="${aw}" height="${Math.max(row * 0.3, b.to - b.from)}" rx="2" fill="${actors[b.actor]?.accent ? accent : accent2}" fill-opacity=".2"/>`;
const hl = Math.max(7, sw * 4.5),
  hw = hl * 0.42;
let number = 0;
for (const e of entries) {
  if (e.type === "note") {
    const over = [].concat(e.m.over ?? []).map(index);
    const lo = over.length ? Math.min(...over) : 0,
      hi = over.length ? Math.max(...over) : n - 1;
    const tw = measure(e.m.note, size * 0.86) + size * 1.4;
    const cx = (X(lo) + X(hi)) / 2,
      w = Math.max(tw, X(hi) - X(lo) + size * 3),
      h = size * 1.9,
      fold = size * 0.5;
    const x0 = Math.max(sw, Math.min(W - w - sw, cx - w / 2));
    out += `<path d="M${x0} ${e.y - h / 2}H${x0 + w - fold}L${x0 + w} ${e.y - h / 2 + fold}V${e.y + h / 2}H${x0}Z" fill="${paper}" stroke="${accent}" stroke-width="${sw}" stroke-linejoin="round"/><path class="plain" d="M${x0} ${e.y - h / 2}H${x0 + w - fold}L${x0 + w} ${e.y - h / 2 + fold}V${e.y + h / 2}H${x0}Z" fill="${accent}" fill-opacity=".12"/>`;
    out += `<text x="${x0 + w / 2}" y="${e.y}" text-anchor="middle" font-size="${size * 0.86}" fill="${ink}">${esc(e.m.note)}</text>`;
    continue;
  }
  if (e.type !== "message") continue;
  const m = e.m,
    y = e.y;
  number++;
  const a = index(m.from),
    b = index(m.to);
  const c = m.accent ? accent : ink;
  const dash = m.reply ? ` stroke-dasharray="${sw * 3} ${sw * 2.5}"` : "";
  const words = (d.numbered ? number + ". " : "") + (m.label ?? "");
  if (a === b) {
    const x = X(a) + (active(a, y) ? aw / 2 : 0),
      w = Math.min(W / n / 2.5, size * 3);
    out += `<path d="M${x} ${y - row * 0.2}H${x + w}V${y + row * 0.2}H${x + hl}" fill="none" stroke="${c}" stroke-width="${sw}"${dash}/>`;
    out += `<path d="M${x} ${y + row * 0.2}l${hl} ${-hw}v${hw * 2}z" fill="${c}"/>`;
    out += `<text x="${x + w + size * 0.4}" y="${y}" font-size="${size * 0.88}" fill="${c}" paint-order="stroke" stroke="${paper}" stroke-width="4" stroke-linejoin="round">${esc(words)}</text>`;
    continue;
  }
  const s = Math.sign(X(b) - X(a));
  // A message starts and ends at the edge of an activation bar where one is drawn.
  const xa = X(a) + (active(a, y) ? (s * aw) / 2 : 0),
    xb = X(b) - (active(b, y) ? (s * aw) / 2 : 0) - s * 2;
  const openHead = m.reply || m.async;
  out += `<path d="M${xa} ${y}H${xb - (openHead ? 0 : s * hl * 0.7)}" stroke="${c}" stroke-width="${sw}"${dash}/>`;
  out += openHead
    ? `<path d="M${xb - s * hl} ${y - hw}L${xb} ${y}L${xb - s * hl} ${y + hw}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
    : `<path d="M${xb} ${y}l${-s * hl} ${-hw}v${hw * 2}z" fill="${c}"/>`;
  out += `<text x="${(xa + xb) / 2}" y="${y - size * 0.75}" text-anchor="middle" font-size="${size * 0.88}" fill="${c}" paint-order="stroke" stroke="${paper}" stroke-width="4" stroke-linejoin="round">${esc(words)}</text>`;
}
const svg = api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible" font-family="${esc(font)}" dominant-baseline="central">${out}</svg>`,
);
// The style's texture on the shapes, never on the words.
if (d.effect) {
  const fx = api.effect(d.effect);
  for (const el of svg.querySelectorAll(
    "path:not(.plain),rect:not(.plain),circle:not(.plain)",
  ))
    el.setAttribute("filter", fx);
}
return svg;
