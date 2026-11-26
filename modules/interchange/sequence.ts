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
  ACTIVE_START: 17,
  ACTIVE_END: 18,
  PAR_START: 19,
  PAR_AND: 20,
  PAR_END: 21,
  RECT_START: 22,
  RECT_END: 23,
  SOLID_POINT: 24,
  DOTTED_POINT: 25,
  CRITICAL_START: 27,
  CRITICAL_OPTION: 28,
  CRITICAL_END: 29,
  BREAK_START: 30,
  BREAK_END: 31,
  PAR_OVER_START: 32,
  BIDIRECTIONAL_SOLID: 33,
  BIDIRECTIONAL_DOTTED: 34,
} as const;
/** Where a note stands, as Mermaid places it. */
const PLACE = { LEFTOF: 0, RIGHTOF: 1, OVER: 2 } as const;
const STARTS: Record<number, string> = { [LINE.LOOP_START]: "loop", [LINE.ALT_START]: "alt", [LINE.OPT_START]: "opt", [LINE.PAR_START]: "par" };
const ENDS = new Set<number>([LINE.LOOP_END, LINE.ALT_END, LINE.OPT_END, LINE.PAR_END]);
/** The line that begins another section of a block, by the block's kind: `else` in an alt,
 * `and` in a par. */
const SECTIONS: Record<number, string> = { [LINE.ALT_ELSE]: "alt", [LINE.PAR_AND]: "par" };
const SECTION_WORD: Record<string, string> = { alt: "else", par: "and" };
/** What Mermaid can say that the sequence drawing cannot, by the word that says it. */
const UNEXPRESSED: Record<number, string> = {
  [LINE.ACTIVE_START]: "activate",
  [LINE.ACTIVE_END]: "activate",
  [LINE.RECT_START]: "rect",
  [LINE.CRITICAL_START]: "critical",
  [LINE.CRITICAL_OPTION]: "critical",
  [LINE.BREAK_START]: "break",
  [LINE.PAR_OVER_START]: "par over",
};
/** A diagram that says what the sequence drawing cannot, by the words that say it. */
export class Unexpressed extends Error {
  constructor(readonly words: string[]) {
    super(`sequence drawing cannot express: ${words.join(", ")}`);
  }
}
/** The words of what a diagram says that the sequence drawing would lose, if any: such a
 * diagram is kept as Mermaid draws it rather than read into the drawing. */
export function unexpressed(read: MermaidSequence): string[] {
  return [
    ...new Set(
      read.messages.flatMap((m) =>
        UNEXPRESSED[m.type]
          ? [UNEXPRESSED[m.type]]
          : isMessage(m) && !MESSAGE_KINDS[m.type]
            ? [OTHER_ARROWS[m.type] ?? "half arrows"]
            : [],
      ),
    ),
  ];
}
const KINDS: Record<string, string> = { actor: "actor", database: "database", queue: "queue" };
/** The messages the drawing draws, by the line Mermaid reads: `->>` a call, `-->>` a reply,
 * `-)` an asynchronous message. */
const MESSAGE_KINDS: Record<number, string> = { [LINE.SOLID]: "sync", [LINE.DOTTED]: "reply", [LINE.SOLID_POINT]: "async" };
/** Lines between participants the drawing has no message for, as Mermaid writes them. */
const OTHER_ARROWS: Record<number, string> = {
  [LINE.SOLID_OPEN]: "->",
  [LINE.DOTTED_OPEN]: "-->",
  [LINE.SOLID_CROSS]: "-x",
  [LINE.DOTTED_CROSS]: "--x",
  [LINE.DOTTED_POINT]: "--)",
  [LINE.BIDIRECTIONAL_SOLID]: "<<->>",
  [LINE.BIDIRECTIONAL_DOTTED]: "<<-->>",
};
/** Whether a line is a message from one participant to another, whatever its arrow. */
const isMessage = (m: MermaidSequence["messages"][number]) => !!m.from && !!m.to && m.type !== LINE.NOTE;

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
  const open: { kind: string; label: string; first: number; sections: { label: string; first: number }[]; order: number }[] = [];
  // Blocks are kept in the order they open, outer before inner, which tells two round the
  // same messages apart; they close inner first.
  const closed: { order: number; fragment: Omit<Item, "id"> }[] = [];
  let opened = 0;
  // A message's id is settled as it is read, before a note or a fragment refers to it: the id
  // the message in its place had, or else the next mN no message has or had.
  const used = new Set<string>();
  const had = new Set((was?.messages ?? []).flatMap((m) => (m && typeof m === "object" && typeof m.id === "string" ? [m.id] : [])));
  const messageId = (prior?: string) => {
    let id = prior;
    for (let n = messages.length + 1; !id || used.has(id); n++) id = had.has(`m${n}`) ? undefined : `m${n}`;
    used.add(id);
    return id;
  };
  for (const m of read.messages) {
    if (m.type === LINE.NOTE) {
      const over = [m.from, m.placement === PLACE.OVER ? m.to : undefined].flatMap((k) => (k && idOf.get(k) ? [idOf.get(k)!] : []));
      notes.push({ id: `n${notes.length + 1}`, over: [...new Set(over)], ...(messages.length ? { after: messages.at(-1)!.id } : {}), text: m.text });
    } else if (STARTS[m.type]) open.push({ kind: STARTS[m.type], label: m.text, first: messages.length, sections: [], order: opened++ });
    else if (SECTIONS[m.type]) {
      const block = open.at(-1);
      if (block?.kind === SECTIONS[m.type]) block.sections.push({ label: m.text, first: messages.length });
    } else if (ENDS.has(m.type)) {
      const block = open.pop();
      // A section starts at its first message; one with none, or before any of the block's,
      // has nothing to divide.
      const sections = (block?.sections ?? []).filter((x) => x.first > block!.first && x.first < messages.length);
      if (block && messages.length > block.first)
        closed.push({
          order: block.order,
          fragment: {
            kind: block.kind,
            ...(block.label ? { label: block.label } : {}),
            from: messages[block.first].id,
            to: messages.at(-1)!.id,
            ...(sections.length
              ? { sections: sections.map((x, k) => ({ id: `s${k + 1}`, from: messages[x.first].id, ...(x.label ? { label: x.label } : {}) })) }
              : {}),
          },
        });
    } else if (m.from && m.to && idOf.has(m.from) && idOf.has(m.to)) {
      const i = messages.length;
      const prior = keep(was?.messages, i);
      const kind = MESSAGE_KINDS[m.type] ?? "sync";
      const { kind: _k, from: _f, to: _t, label: _l, ...rest } = prior ?? ({} as Item);
      messages.push({ ...rest, id: messageId(typeof prior?.id === "string" ? prior.id : undefined), from: idOf.get(m.from)!, to: idOf.get(m.to)!, label: m.text, ...(kind === "sync" ? {} : { kind }) });
    }
  }
  const fragments: Item[] = closed.sort((a, b) => a.order - b.order).map((c, i) => ({ id: `f${i + 1}`, ...c.fragment }));
  // Numbering the text no longer asks for is turned off, not left out, so it goes.
  const numbered = read.numbered ? { numbered: true } : was?.numbered ? { numbered: false } : {};
  return { participants, messages, notes, fragments, ...numbered };
}

const said = (s: unknown) => String(s ?? "").replace(/[\n;#]/g, " ").trim();
/** The sequence drawing's data as Mermaid source: participants by their ids as aliases,
 * messages by their kind of line, notes after the message they follow, and fragments as
 * blocks round the messages they hold, an alt's or a par's further sections each from its
 * first message. */
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
    // Another section of a block open round this message begins with it.
    for (const f of fragments)
      for (const x of Array.isArray(f.sections) ? (f.sections as Item[]) : [])
        if (place(x.from) === i && place(f.from) < i && i <= place(f.to) && SECTION_WORD[String(f.kind ?? "alt")])
          lines.push(`  ${SECTION_WORD[String(f.kind ?? "alt")]}${x.label ? " " + said(x.label) : ""}`);
    // Blocks open outermost first and close innermost first; of two round the same messages,
    // the one listed first is outside the other.
    const opening = fragments.filter((f) => place(f.from) === i).sort((a, b) => place(b.to) - place(a.to));
    for (const f of opening) lines.push(`  ${f.kind ?? "alt"}${f.label ? " " + said(f.label) : ""}`);
    lines.push(`  ${m.from}${arrow(m.kind)}${m.to}: ${said(m.label)}`);
    for (const n of notes) if (n.after === m.id) lines.push(noteLine(n) ?? "");
    const closing = fragments.filter((f) => place(f.to) === i).sort((a, b) => place(b.from) - place(a.from));
    for (const _ of closing) lines.push("  end");
  });
  return lines.filter(Boolean).join("\n") + "\n";
}
