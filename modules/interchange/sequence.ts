import { isItemId } from "../contracts/index.ts";

/* A sequence diagram between Mermaid and the library's sequence drawing. Mermaid reads its
 * own source (the browser asks its parser for the diagram's actors and messages, in the
 * terms below); this turns what it read into the drawing's data, and the data back into
 * source. Participants keep their ids as Mermaid aliases and messages keep theirs by their
 * place, so source edited and read again keeps what the diagram knew of each: its id, what
 * was selected, how it stands out. */

/** What Mermaid's parser reads from a sequence diagram, as its database gives it. */
export interface MermaidSequence {
  actors: { key: string; name: string; type: string }[];
  /** Messages, notes and the starts and ends of blocks, in order, by Mermaid's line types. */
  messages: { from?: string; to?: string; text: string; type: number; placement?: number }[];
  numbered: boolean;
}
/** Mermaid's line types, as its sequence database numbers them. */
const LINE = {
  SOLID: 0,
  DOTTED: 1,
  NOTE: 2,
  SOLID_CROSS: 3,
  DOTTED_CROSS: 4,
  SOLID_OPEN: 5,
  DOTTED_OPEN: 6,
  LOOP_START: 10,
  LOOP_END: 11,
  ALT_START: 12,
  ALT_ELSE: 13,
  ALT_END: 14,
  OPT_START: 15,
  OPT_END: 16,
  PAR_START: 19,
  PAR_AND: 20,
  PAR_END: 21,
  SOLID_POINT: 24,
  DOTTED_POINT: 25,
  BIDIRECTIONAL_SOLID: 33,
  BIDIRECTIONAL_DOTTED: 34,
} as const;
/** Where a note stands, as Mermaid places it. */
const PLACE = { LEFTOF: 0, RIGHTOF: 1, OVER: 2 } as const;
const STARTS: Record<number, string> = { [LINE.LOOP_START]: "loop", [LINE.ALT_START]: "alt", [LINE.OPT_START]: "opt", [LINE.PAR_START]: "par" };
const ENDS = new Set<number>([LINE.LOOP_END, LINE.ALT_END, LINE.OPT_END, LINE.PAR_END]);
const KINDS: Record<string, string> = { actor: "actor", database: "database", queue: "queue" };
const DOTTED = new Set<number>([LINE.DOTTED, LINE.DOTTED_CROSS, LINE.DOTTED_OPEN, LINE.DOTTED_POINT, LINE.BIDIRECTIONAL_DOTTED]);

type Item = Record<string, unknown> & { id: string };
export interface SequenceData {
  participants: Item[];
  messages: Item[];
  notes: Item[];
  fragments: Item[];
  numbered?: boolean;
}

/** The sequence drawing's data for what Mermaid read, taking ids and what Mermaid does not
 * say (a message standing out) from `was`, the data the source was written from: a
 * participant by its alias, a message by its place. */
export function sequenceFrom(read: MermaidSequence, was?: Partial<SequenceData>): SequenceData {
  const keep = (list: unknown[] | undefined, i: number) => (Array.isArray(list) && list[i] && typeof list[i] === "object" ? (list[i] as Item) : undefined);
  const taken = new Set<string>();
  const fresh = (base: string) => {
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
    taken.add(id);
    return id;
  };
  const participants: Item[] = read.actors.map((a) => {
    const id = isItemId(a.key) ? fresh(a.key) : fresh("p" + (taken.size + 1));
    const kind = KINDS[a.type];
    const prior = (was?.participants ?? []).find((p) => p.id === id);
    const { kind: _, ...rest } = prior ?? ({} as Item);
    return { ...rest, id, label: a.name || a.key, ...(kind ? { kind } : {}) };
  });
  const idOf = new Map(read.actors.map((a, i) => [a.key, participants[i].id]));
  const messages: Item[] = [];
  const notes: Item[] = [];
  const fragments: Item[] = [];
  const open: { kind: string; label: string; first: number }[] = [];
  for (const m of read.messages) {
    if (m.type === LINE.NOTE) {
      const over = [m.from, m.placement === PLACE.OVER ? m.to : undefined].flatMap((k) => (k && idOf.get(k) ? [idOf.get(k)!] : []));
      notes.push({ id: `n${notes.length + 1}`, over: [...new Set(over)], ...(messages.length ? { after: messages.at(-1)!.id } : {}), text: m.text });
    } else if (STARTS[m.type]) open.push({ kind: STARTS[m.type], label: m.text, first: messages.length });
    else if (ENDS.has(m.type)) {
      const block = open.pop();
      if (block && messages.length > block.first)
        fragments.push({
          id: `f${fragments.length + 1}`,
          kind: block.kind,
          ...(block.label ? { label: block.label } : {}),
          from: messages[block.first].id,
          to: messages.at(-1)!.id,
        });
    } else if (m.from && m.to && idOf.has(m.from) && idOf.has(m.to)) {
      const i = messages.length;
      const prior = keep(was?.messages, i);
      const kind = DOTTED.has(m.type) ? "reply" : m.type === LINE.SOLID_OPEN ? "async" : "sync";
      const { kind: _k, from: _f, to: _t, label: _l, ...rest } = prior ?? ({} as Item);
      messages.push({ ...rest, id: prior?.id ?? `m${i + 1}`, from: idOf.get(m.from)!, to: idOf.get(m.to)!, label: m.text, ...(kind === "sync" ? {} : { kind }) });
    }
  }
  // Ids a message took from its place that another already has are made unique.
  const seen = new Set<string>();
  for (const m of messages) {
    let id = m.id;
    for (let n = 2; seen.has(id); n++) id = `${m.id}-${n}`;
    seen.add(id);
    m.id = id;
  }
  // Numbering the text no longer asks for is turned off, not left out, so it goes.
  const numbered = read.numbered ? { numbered: true } : was?.numbered ? { numbered: false } : {};
  return { participants, messages, notes, fragments, ...numbered };
}

const said = (s: unknown) => String(s ?? "").replace(/[\n;#]/g, " ").trim();
/** The sequence drawing's data as Mermaid source: participants by their ids as aliases,
 * messages by their kind of line, notes after the message they follow, and fragments as
 * blocks round the messages they hold. */
export function sequenceSource(data: Partial<SequenceData>): string {
  const participants = (data.participants ?? []).filter((p) => p && typeof p === "object");
  const messages = (data.messages ?? []).filter((m) => m && typeof m === "object");
  const notes = data.notes ?? [];
  const fragments = data.fragments ?? [];
  const lines = ["sequenceDiagram"];
  if (data.numbered) lines.push("  autonumber");
  for (const p of participants) {
    const word = p.kind === "actor" ? "actor" : p.kind === "database" ? "database" : p.kind === "queue" ? "queue" : "participant";
    lines.push(`  ${word} ${p.id} as ${said(p.label) || p.id}`);
  }
  const arrow = (kind: unknown) => (kind === "reply" ? "-->>" : kind === "async" ? "-)" : "->>");
  const place = (id: unknown) => messages.findIndex((m) => m.id === id);
  const noteLine = (n: Item) => {
    const over = (Array.isArray(n.over) ? n.over : []).join(",");
    return over ? `  Note over ${over}: ${said(n.text)}` : null;
  };
  for (const n of notes) if (n.after === undefined || place(n.after) < 0) lines.push(noteLine(n) ?? "");
  messages.forEach((m, i) => {
    // Blocks open outermost first and close innermost first.
    const opening = fragments.filter((f) => place(f.from) === i).sort((a, b) => place(b.to) - place(a.to));
    for (const f of opening) lines.push(`  ${f.kind ?? "alt"}${f.label ? " " + said(f.label) : ""}`);
    lines.push(`  ${m.from}${arrow(m.kind)}${m.to}: ${said(m.label)}`);
    for (const n of notes) if (n.after === m.id) lines.push(noteLine(n) ?? "");
    const closing = fragments.filter((f) => place(f.to) === i).sort((a, b) => place(b.from) - place(a.from));
    for (const _ of closing) lines.push("  end");
  });
  return lines.filter(Boolean).join("\n") + "\n";
}
