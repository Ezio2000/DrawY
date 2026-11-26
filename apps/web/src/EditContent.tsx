import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import type { Canvas } from "../../../modules/canvas/index.ts";
import {
  drawingOf,
  fieldAt,
  getAt,
  isPlain,
  isRecord,
  parsePath,
  setAt as setIn,
  type Field,
  type Fields,
  type Work,
} from "../../../modules/contracts/index.ts";
import {
  duplicateItem,
  guessedField,
  fieldsOf,
  insertItem,
  itemOf,
  moveItem,
  removeItem,
  setAt,
} from "../../../modules/editing/index.ts";
import { cx } from "./cx.ts";
import { Colors, nameOf, optionOf, type Part, type PickPicture, Words } from "./EditControls.tsx";
import { useT, type Words as Dictionary } from "./i18n.tsx";
import type { Change } from "./session/work.ts";

/* What a part says and shows, edited as its drawing's schema lays it out: words in text
 * boxes, a list of words as rows typed one after another, a list of small records as a
 * table (references chosen by name), larger records as rows that open into a form, a tree
 * as an outline, a picture as its thumbnail. Every change is one edit at the value's path
 * in the part's data, as the author would write it; nothing here shows code or JSON. */

interface Ctx {
  work: Work;
  sceneId: string;
  part: Part;
  canvas?: Canvas;
  change: Change;
  pickPicture: PickPicture;
}
type ListField = Extract<Field, { type: "list" }>;
/** The data a part draws from: its own over its drawing's defaults. */
const drawn = (work: Work, part: Part) => ({ ...(drawingOf(work, part.drawingId)?.defaults ?? {}), ...part.data });
/** The kinds of value a part's content holds; choices, colours, numbers and switches at the
 * top of its data are how it looks, and are on the design page. */
const isContent = (f: Field) => !["choice", "color", "number", "boolean", "effect", "id"].includes(f.type);
/** The fields of an item record, but its id. */
const shownFields = (f: Field): [string, Field][] =>
  f.type === "record" || f.type === "tree" ? Object.entries(f.fields).filter(([, x]) => x.type !== "id") : [];
/** Whether a list's items read best as a table: records of a few plain values. */
const tabular = (f: ListField) => {
  const fields = shownFields(f.item);
  return f.item.type === "record" && fields.length > 0 && fields.length <= 6 && fields.every(([, x]) => isPlain(x) || x.type === "ref" || x.type === "cell");
};
const named = (t: Dictionary, key: string, f?: Field) => nameOf(t, { key, label: f?.label });

/** The content of a part: every value of its data that is not how it looks, in its schema's
 * order, then what its data holds that its drawing does not declare. */
export function Content(ctx: Ctx) {
  const t = useT();
  const { work, part } = ctx;
  const declared = drawingOf(work, part.drawingId)?.params ?? {};
  const data = drawn(work, part);
  const plain = fieldsOf(work, part).filter((f) => !(f.key in declared) && (f.type === "text" || f.type === "picture"));
  const entries: [string, Field][] = [
    ...Object.entries(declared).filter(([, f]) => isContent(f)),
    ...plain.map((f): [string, Field] => [f.key, { type: f.type } as Field]),
    ...Object.keys(part.data)
      .filter((k) => !(k in declared) && !plain.some((f) => f.key === k) && !fieldsOf(work, part).some((f) => f.key === k))
      .flatMap((k): [string, Field][] => {
        const f = guessedField(part.data[k]);
        return f && f.type !== "text" ? [[k, f]] : [];
      }),
  ];
  if (!entries.length) return null;
  return (
    <div className={cx("fields")}>
      {entries.map(([key, f]) => (
        <Value key={part.id + ":" + key} ctx={ctx} path={key} field={f} value={data[key]} name={named(t, key, f)} />
      ))}
    </div>
  );
}

/** One value of the content under its name, in the editor its kind takes. */
function Value({ ctx, path, field, value, name }: { ctx: Ctx; path: string; field: Field; value: unknown; name: string }) {
  const head = <span className={cx("field-name")}>{name}</span>;
  switch (field.type) {
    case "list":
      return (
        <div className={cx("field")} data-list>
          <ListEditor ctx={ctx} path={path} field={field} items={Array.isArray(value) ? value : []} name={name} />
        </div>
      );
    case "tree":
      return (
        <div className={cx("field")} data-list>
          {head}
          <Outline ctx={ctx} path={path} field={field} root={isRecord(value) ? value : {}} />
        </div>
      );
    case "record":
      return (
        <div className={cx("field")}>
          {head}
          <RecordForm ctx={ctx} path={path} field={field} value={isRecord(value) ? value : {}} />
        </div>
      );
    default:
      // Words and pictures take the width under their name; other values sit beside it.
      return (
        <label className={cx("field")} data-inline={!["text", "picture", "color"].includes(field.type) || undefined}>
          {head}
          <Plain ctx={ctx} path={path} field={field} value={value} label={name} />
        </label>
      );
  }
}

/** Keeps a value at a path, or shows it on the canvas as it is typed. */
const keeper = (ctx: Ctx) => ({
  keep: (path: string, value: unknown) => void ctx.change((w) => setAt(w, ctx.sceneId, ctx.part.id, path, value)),
  show: (path: string, value: unknown) => {
    const next = setIn(ctx.part.data, path, value);
    if (next && isRecord(next)) ctx.canvas?.preview(ctx.part.id, next);
  },
});

/** The items of a list of the part's data that a reference names, and the field they are
 * called by. */
function referable(ctx: Ctx, to: string) {
  const list = getAt(drawn(ctx.work, ctx.part), to);
  const items = Array.isArray(list) ? list.filter(isRecord) : [];
  const listField = fieldAt(drawingOf(ctx.work, ctx.part.drawingId)?.params ?? {}, to);
  const title = listField?.type === "list" ? (listField.title ?? shownFields(listField.item).find(([, x]) => x.type === "text")?.[0]) : undefined;
  return { items, title };
}
/** A single value in the control its kind takes, compact enough for a table's cell. */
function Plain({ ctx, path, field, value, label, cell }: { ctx: Ctx; path: string; field: Field; value: unknown; label: string; cell?: boolean }) {
  const t = useT();
  const { keep, show } = keeper(ctx);
  switch (field.type) {
    case "text":
    case "id":
      return cell ? (
        <Typed value={String(value ?? "")} label={label} onDone={(s) => s !== (value ?? "") && keep(path, s)} />
      ) : (
        <Words value={String(value ?? "")} onChange={(s) => show(path, s)} onDone={(s) => s !== (value ?? "") && keep(path, s)} />
      );
    case "cell": {
      const shown = value === true ? "✓" : value === false ? "—" : value == null ? "" : String(value);
      return (
        <Typed
          value={shown}
          label={label}
          onDone={(s) => {
            const v = s.trim() === "✓" ? true : s.trim() === "—" || s.trim() === "-" ? false : s.trim() ? s : null;
            if (v !== value) keep(path, v ?? undefined);
          }}
        />
      );
    }
    case "number":
      return (
        <Typed
          value={value === undefined || value === null ? "" : String(value)}
          label={label}
          numeric
          onDone={(s) => {
            const n = s.trim() === "" ? undefined : Number(s);
            if (n === undefined || Number.isFinite(n)) n !== value && keep(path, n);
          }}
        />
      );
    case "boolean":
      return (
        <input type="checkbox" className={cx("cell-check")} aria-label={label} checked={!!value} onChange={(e) => keep(path, e.target.checked)} />
      );
    case "choice":
      return (
        // A choice left unwritten is drawn as its first option, so it shows as that.
        <select
          className={cx("edit-select")}
          data-cell={cell || undefined}
          aria-label={label}
          value={String(value ?? field.options[0].value)}
          onChange={(e) => keep(path, e.target.value)}
        >
          {value !== undefined && !field.options.some((o) => o.value === value) && <option value={String(value)}>{String(value)}</option>}
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {optionOf(t, o.value, field)}
            </option>
          ))}
        </select>
      );
    case "ref": {
      const { items, title } = referable(ctx, field.to);
      return (
        <select className={cx("edit-select")} data-cell={cell || undefined} aria-label={label} value={String(value ?? "")} onChange={(e) => keep(path, e.target.value || undefined)}>
          {!items.some((x) => x.id === value) && <option value="">{t.edit.contentEditor.none}</option>}
          {items.map((x, i) => (
            <option key={String(x.id ?? i)} value={String(x.id ?? "")}>
              {String((title && x[title]) || t.edit.contentEditor.item(i + 1))}
            </option>
          ))}
        </select>
      );
    }
    case "color":
      return <Colors work={ctx.work} value={typeof value === "string" ? value : undefined} auto onChange={(c) => show(path, c)} onDone={(c) => keep(path, c)} />;
    case "picture": {
      const picture = typeof value === "string" ? ctx.work.materials[value] : undefined;
      return (
        <button className={cx("field-picture")} onClick={() => ctx.pickPicture((m) => keep(path, m.id))}>
          {picture?.kind === "picture" && <img src={picture.url} alt={picture.name} />}
          <span>{t.edit.replacePicture}</span>
        </button>
      );
    }
    case "geo": {
      // A place of the list it names, by id, or a point given as longitude and latitude.
      const c = t.edit.contentEditor;
      const at = Array.isArray(value) ? value : [];
      const coordinates = (
        <>
          <Typed value={String(at[0] ?? "")} label={c.lon} numeric onDone={(s) => Number.isFinite(Number(s)) && keep(path, [Number(s), Number(at[1] ?? 0)])} />
          <Typed value={String(at[1] ?? "")} label={c.lat} numeric onDone={(s) => Number.isFinite(Number(s)) && keep(path, [Number(at[0] ?? 0), Number(s)])} />
        </>
      );
      if (!field.to) return <span className={cx("cell-pair")}>{coordinates}</span>;
      const { items, title } = referable(ctx, field.to);
      const place = typeof value === "string" ? items.find((x) => x.id === value) : undefined;
      return (
        <span className={cx("cell-pair")}>
          <select
            className={cx("edit-select")}
            data-cell={cell || undefined}
            aria-label={label}
            value={typeof value === "string" ? value : ""}
            // Leaving a place for coordinates starts them where the place is.
            onChange={(e) => keep(path, e.target.value || (place ? [Number(place.lon ?? 0), Number(place.lat ?? 0)] : [0, 0]))}
          >
            <option value="">{c.coordinates}</option>
            {items.map((x, i) => (
              <option key={String(x.id ?? i)} value={String(x.id ?? "")}>
                {String((title && x[title]) || c.item(i + 1))}
              </option>
            ))}
          </select>
          {typeof value !== "string" && coordinates}
        </span>
      );
    }
    default:
      return null;
  }
}

/** A one-line box kept when it is left or Enter is pressed; a value changed elsewhere shows
 * unless it is being typed. */
function Typed({ value, label, numeric, onDone, onKeyDown, focus }: {
  value: string;
  label: string;
  numeric?: boolean;
  onDone: (s: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>, text: string) => void;
  focus?: boolean;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  // Escape leaves the box without keeping what was typed: the blur it causes comes before the
  // text shown is set back.
  const cancelled = useRef(false);
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(value);
  }, [value]);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <input
      ref={ref}
      className={cx("cell-input")}
      data-numeric={numeric || undefined}
      inputMode={numeric ? "decimal" : undefined}
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        onKeyDown?.(e, text);
        if (e.defaultPrevented) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setText(value);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (cancelled.current) cancelled.current = false;
        else if (text !== value) onDone(text);
      }}
    />
  );
}

/** Rows that can be dragged into another order by their handle. */
function useReorder(count: number, move: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<{ from: number; to: number }>();
  const rows = useRef<(HTMLElement | null)[]>([]);
  const start = (from: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging({ from, to: from });
  };
  const over = (e: React.PointerEvent) => {
    if (!dragging) return;
    const mids = rows.current.slice(0, count).map((r) => (r ? r.getBoundingClientRect() : null));
    let to = mids.findIndex((r) => r && e.clientY < r.top + r.height / 2);
    if (to < 0) to = count - 1;
    else if (to > dragging.from) to -= 1;
    if (to !== dragging.to) setDragging({ ...dragging, to });
  };
  const end = () => {
    if (dragging && dragging.to !== dragging.from) move(dragging.from, dragging.to);
    setDragging(undefined);
  };
  const handle = (i: number, label: string) => (
    <button className={cx("row-grip")} aria-label={label} onPointerDown={start(i)} onPointerMove={over} onPointerUp={end} onPointerCancel={() => setDragging(undefined)}>
      <GripVertical size={13} />
    </button>
  );
  return { rows, handle, dragging };
}

/** A list of the content: words as rows, small records as a table, larger ones as rows that
 * open into a form, each with its place to drag and a way to take it out. */
function ListEditor({ ctx, path, field, items, name }: { ctx: Ctx; path: string; field: ListField; items: unknown[]; name: string }) {
  const t = useT(),
    c = t.edit.contentEditor;
  const [note, setNote] = useState("");
  const [focus, setFocus] = useState<number>();
  const run = (make: (w: Work) => ReturnType<typeof moveItem>) => void ctx.change(make);
  const id = (i: number) => (isRecord(items[i]) && typeof items[i].id === "string" ? (items[i].id as string) : i);
  const insert = (at: number, values?: Record<string, unknown>) => {
    setFocus(at);
    void ctx.change((w) => insertItem(w, ctx.sceneId, ctx.part.id, path, at, values).edit);
  };
  const remove = (i: number) => {
    const { along } = removeItem(ctx.work, ctx.sceneId, ctx.part.id, path, id(i));
    void ctx.change((w) => removeItem(w, ctx.sceneId, ctx.part.id, path, id(i)).edit);
    setNote(along ? c.removedAlong(along) : "");
  };
  const order = useReorder(items.length, (from, to) => run((w) => moveItem(w, ctx.sceneId, ctx.part.id, path, id(from), to)));
  const full = field.max !== undefined && items.length >= field.max;
  // The list's name, with the way to add to it beside it.
  const head = (
    <span className={cx("field-name")} data-list-head>
      {name}
      {!full && (
        <button className={cx("row-act")} aria-label={`${c.add} · ${name}`} data-tip={c.add} onClick={() => insert(items.length)}>
          <Plus size={13} />
        </button>
      )}
    </span>
  );
  const at = (i: number) => `${path}.${isRecord(items[i]) && typeof items[i].id === "string" ? "#" + items[i].id : i}`;
  const remover = (i: number) => (
    <button className={cx("row-act")} aria-label={c.remove} data-tip={c.remove} onClick={() => remove(i)}>
      <Trash2 size={13} />
    </button>
  );
  let body: ReactNode;
  if (field.item.type === "text" || field.item.type === "number" || field.item.type === "cell") {
    // Words typed one after another: Enter goes on to a new row, Backspace in an empty row
    // takes it out.
    body = (
      <ol className={cx("rows")}>
        {items.map((v, i) => (
          <li key={i} ref={(el) => void (order.rows.current[i] = el)} data-drop={order.dragging?.to === i || undefined}>
            {order.handle(i, c.drag)}
            <Typed
              value={v === null || v === undefined ? "" : String(v)}
              label={c.item(i + 1)}
              numeric={field.item.type === "number"}
              focus={focus === i}
              onDone={(s) => ctx.change((w) => setAt(w, ctx.sceneId, ctx.part.id, at(i), field.item.type === "number" ? Number(s) : s))}
              onKeyDown={(e, text) => {
                if (e.key === "Enter" && !full) {
                  e.preventDefault();
                  if (text !== String(v ?? "")) void ctx.change((w) => setAt(w, ctx.sceneId, ctx.part.id, at(i), text));
                  insert(i + 1);
                } else if (e.key === "Backspace" && !text) {
                  e.preventDefault();
                  remove(i);
                  setFocus(Math.max(0, i - 1));
                }
              }}
            />
            {remover(i)}
          </li>
        ))}
      </ol>
    );
  } else if (field.item.type !== "record" && field.item.type !== "tree") {
    // Single values that are not words, each a row with its own control: a reference, a
    // place, a pair of numbers.
    const item = field.item;
    body = (
      <ol className={cx("rows")}>
        {items.map((v, i) => (
          <li key={i} ref={(el) => void (order.rows.current[i] = el)} data-drop={order.dragging?.to === i || undefined}>
            {order.handle(i, c.drag)}
            {item.type === "list" ? (
              <span className={cx("cell-pair")}>
                {Array.from({ length: Math.max(item.min ?? 0, Array.isArray(v) ? v.length : 0) }, (_, j) => (
                  <Plain key={j} ctx={ctx} path={`${at(i)}.${j}`} field={item.item} value={Array.isArray(v) ? v[j] : undefined} label={`${c.item(i + 1)} · ${j + 1}`} cell />
                ))}
              </span>
            ) : (
              <Plain ctx={ctx} path={at(i)} field={item} value={v} label={c.item(i + 1)} cell />
            )}
            {remover(i)}
          </li>
        ))}
      </ol>
    );
  } else if (tabular(field)) {
    const columns = shownFields(field.item);
    // Rows copied from a spreadsheet come in as rows, one value per column.
    const paste = (e: ClipboardEvent) => {
      const text = e.clipboardData.getData("text/plain");
      if (!/\t|\n/.test(text.trim())) return;
      e.preventDefault();
      const rows = text.replace(/\r/g, "").trim().split("\n").map((r) => r.split("\t"));
      const read = (f: Field, s: string): unknown =>
        f.type === "number" ? (Number.isFinite(Number(s)) ? Number(s) : undefined) : f.type === "boolean" ? /^(true|1|✓|是|yes)$/i.test(s.trim()) : s.trim() || undefined;
      const next = rows.map((r, i) => {
        const was = isRecord(items[i]) ? items[i] : {};
        const item: Record<string, unknown> = { ...was };
        columns.forEach(([k, f], j) => {
          if (r[j] !== undefined) item[k] = read(f, r[j]);
        });
        return item;
      });
      void ctx.change((w) => setAt(w, ctx.sceneId, ctx.part.id, path, next));
    };
    // Words take the room; references and choices are narrower, switches narrowest.
    const share = (f: Field) => (f.type === "boolean" ? 0 : f.type === "text" || f.type === "cell" ? 2.2 : 1);
    const total = columns.reduce((n, [, f]) => n + share(f), 0) || 1;
    body = (
      <div className={cx("table-wrap")} onPaste={paste}>
        <table className={cx("data-table")}>
          <colgroup>
            <col style={{ width: 22 }} />
            {columns.map(([k, f]) => (
              <col key={k} style={f.type === "boolean" ? { width: 30 } : { width: `${(share(f) / total) * 100}%` }} />
            ))}
            <col style={{ width: 22 }} />
          </colgroup>
          <thead hidden={!items.length}>
            <tr>
              <th />
              {columns.map(([k, f]) => (
                <th key={k}>{named(t, k, f)}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={String(isRecord(item) ? (item.id ?? i) : i)} ref={(el) => void (order.rows.current[i] = el)} data-drop={order.dragging?.to === i || undefined}>
                <td>{order.handle(i, c.drag)}</td>
                {columns.map(([k, f]) => (
                  <td key={k}>
                    <Plain ctx={ctx} path={`${at(i)}.${k}`} field={f} value={isRecord(item) ? item[k] : undefined} label={`${named(t, k, f)} · ${c.item(i + 1)}`} cell />
                  </td>
                ))}
                <td>{remover(i)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    // Larger records: each a row with its name, opening into its form.
    const title = field.title ?? shownFields(field.item).find(([, x]) => x.type === "text")?.[0];
    body = (
      <ol className={cx("rows")}>
        {items.map((item, i) => (
          <ItemRow
            key={String(isRecord(item) ? (item.id ?? i) : i)}
            ctx={ctx}
            path={at(i)}
            field={field.item}
            item={item}
            title={title}
            place={i}
            grip={order.handle(i, c.drag)}
            remover={remover(i)}
            refer={(el) => void (order.rows.current[i] = el)}
            drop={order.dragging?.to === i}
          />
        ))}
      </ol>
    );
  }
  return (
    <div className={cx("list-editor")}>
      {head}
      {body}
      {note && (
        <small className={cx("list-note")} role="status">
          {note}
        </small>
      )}
    </div>
  );
}

/** An item of a list of larger records: its name typed in place, opening into its form. */
function ItemRow({ ctx, path, field, item, title, place, grip, remover, refer, drop }: {
  ctx: Ctx;
  path: string;
  field: Field;
  item: unknown;
  title?: string;
  place: number;
  grip: ReactNode;
  remover: ReactNode;
  refer: (el: HTMLLIElement | null) => void;
  drop: boolean;
}) {
  const t = useT(),
    c = t.edit.contentEditor;
  const [open, setOpen] = useState(false);
  const record = isRecord(item) ? item : {};
  return (
    <li ref={refer} data-open={open || undefined} data-drop={drop || undefined} className={cx("item-row")}>
      <div className={cx("item-head")}>
        {grip}
        <button className={cx("row-act")} aria-expanded={open} aria-label={open ? c.collapse : c.expand} onClick={() => setOpen(!open)}>
          <ChevronRight size={13} />
        </button>
        {title ? (
          <Plain ctx={ctx} path={`${path}.${title}`} field={{ type: "text" }} value={record[title]} label={c.item(place + 1)} cell />
        ) : (
          <span className={cx("item-name")}>{c.item(place + 1)}</span>
        )}
        {remover}
      </div>
      {open && (
        <div className={cx("item-body")}>
          <RecordForm ctx={ctx} path={path} field={field} value={record} skip={title} />
        </div>
      )}
    </li>
  );
}

/** A record's values, each under its name. */
function RecordForm({ ctx, path, field, value, skip }: { ctx: Ctx; path: string; field: Field; value: Record<string, unknown>; skip?: string }) {
  const t = useT();
  const fields = shownFields(field).filter(([k]) => k !== skip);
  const rest = field.type === "record" ? field.rest : undefined;
  return (
    <div className={cx("fields")} data-compact>
      {fields.map(([k, f]) => (
        <Value key={k} ctx={ctx} path={`${path}.${k}`} field={f} value={value[k]} name={named(t, k, f)} />
      ))}
      {rest && <Renamings ctx={ctx} path={path} value={value} field={rest} known={fields.map(([k]) => k)} />}
    </div>
  );
}

/** A record keyed by names, as a map's renamings: each name and what it shows as. */
function Renamings({ ctx, path, value, field, known }: { ctx: Ctx; path: string; value: Record<string, unknown>; field: Field; known: string[] }) {
  const t = useT(),
    c = t.edit.contentEditor;
  const entries = Object.entries(value).filter(([k]) => !known.includes(k));
  const keepAll = (next: Record<string, unknown>) => void ctx.change((w) => setAt(w, ctx.sceneId, ctx.part.id, path, next));
  return (
    <div className={cx("list-editor")}>
      <ol className={cx("rows")}>
        {[...entries, ["", ""] as [string, unknown]].map(([k, v], i) => (
          <li key={k || "new" + i}>
            <Typed
              value={k}
              label={c.newKey}
              onDone={(s) => {
                const next = { ...value };
                delete next[k];
                if (s.trim()) next[s.trim()] = v ?? "";
                keepAll(next);
              }}
            />
            <Typed value={String(v ?? "")} label={c.newValue} onDone={(s) => k && keepAll({ ...value, [k]: field.type === "number" ? Number(s) : s })} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A tree as an outline: each node's words in a row, indented under its parent. Enter makes
 * the next node beside it, Tab puts a node under the one before it and Shift+Tab back out,
 * Backspace in an empty row takes it out. */
function Outline({ ctx, path, field, root }: { ctx: Ctx; path: string; field: Extract<Field, { type: "tree" }>; root: Record<string, unknown> }) {
  const t = useT(),
    c = t.edit.contentEditor;
  const children = field.children ?? "children";
  const title = field.title ?? shownFields(field).find(([, x]) => x.type === "text")?.[0] ?? "label";
  const [focus, setFocus] = useState<string>();
  type Row = { steps: number[]; node: Record<string, unknown> };
  const rows: Row[] = [];
  const walk = (node: Record<string, unknown>, steps: number[]) => {
    rows.push({ steps, node });
    const kids = Array.isArray(node[children]) ? (node[children] as unknown[]) : [];
    kids.forEach((k, i) => isRecord(k) && walk(k, [...steps, i]));
  };
  walk(root, []);
  const keepRoot = (next: Record<string, unknown>) => void ctx.change((w) => setAt(w, ctx.sceneId, ctx.part.id, path, next));
  const kidsOf = (n: Record<string, unknown>) => (Array.isArray(n[children]) ? [...(n[children] as Record<string, unknown>[])] : []);
  /** The tree with the node at `steps` changed by `edit`, which gets its parent's children. */
  const within = (steps: number[], edit: (siblings: Record<string, unknown>[], at: number) => void) => {
    const next = structuredClone(root);
    let parent = next;
    for (const s of steps.slice(0, -1)) parent = kidsOf(parent)[s];
    const siblings = kidsOf(parent);
    edit(siblings, steps.at(-1)!);
    parent[children] = siblings;
    return next;
  };
  const fresh = () => {
    const taken = new Set(rows.map((r) => r.node.id));
    let n = rows.length + 1;
    while (taken.has("n" + n)) n++;
    return "n" + n;
  };
  const key = (r: Row) => (r.node.id as string | undefined) ?? r.steps.join(".");
  return (
    <ol className={cx("rows", "outline")}>
      {rows.map((r) => (
        <li key={key(r)} style={{ paddingLeft: r.steps.length * 16 }}>
          <Typed
            value={String(r.node[title] ?? "")}
            label={c.item(r.steps.length + 1)}
            focus={focus === key(r)}
            onDone={(s) => {
              const next = structuredClone(root);
              let node = next;
              for (const s2 of r.steps) node = kidsOf(node)[s2];
              node[title] = s;
              keepRoot(next);
            }}
            onKeyDown={(e) => {
              if (!r.steps.length && (e.key === "Tab" || e.key === "Enter")) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const id = fresh();
                  setFocus(id);
                  keepRoot({ ...root, [children]: [{ id, [title]: "" }, ...kidsOf(root)] });
                }
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const id = fresh();
                setFocus(id);
                keepRoot(within(r.steps, (sib, at) => sib.splice(at + 1, 0, { id, [title]: "" })));
              } else if (e.key === "Tab" && !e.shiftKey && r.steps.at(-1)! > 0) {
                e.preventDefault();
                setFocus(key(r));
                keepRoot(
                  within(r.steps, (sib, at) => {
                    const [node] = sib.splice(at, 1);
                    sib[at - 1] = { ...sib[at - 1], [children]: [...kidsOf(sib[at - 1]), node] };
                  }),
                );
              } else if (e.key === "Tab" && e.shiftKey && r.steps.length > 1) {
                e.preventDefault();
                setFocus(key(r));
                const parentSteps = r.steps.slice(0, -1);
                const node = r.node;
                const out = within(r.steps, (sib, at) => void sib.splice(at, 1));
                // Back out to beside its parent, right after it.
                let grand = out;
                for (const s of parentSteps.slice(0, -1)) grand = kidsOf(grand)[s];
                const uncles = kidsOf(grand);
                uncles.splice(parentSteps.at(-1)! + 1, 0, node);
                grand[children] = uncles;
                keepRoot(out);
              } else if (e.key === "Backspace" && !(e.currentTarget as HTMLInputElement).value && r.steps.length) {
                e.preventDefault();
                keepRoot(within(r.steps, (sib, at) => void sib.splice(at, 1)));
              }
            }}
          />
          {r.steps.length > 0 && (
            <button className={cx("row-act")} aria-label={c.remove} data-tip={c.remove} onClick={() => keepRoot(within(r.steps, (sib, at) => void sib.splice(at, 1)))}>
              <Trash2 size={13} />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The item of a part selected on the canvas: its form, and the way to move it up or down,
 * copy it or take it out. */
export function ItemForm({ ctx, path }: { ctx: Ctx; path: string }) {
  const t = useT(),
    c = t.edit.contentEditor;
  const fields = drawingOf(ctx.work, ctx.part.drawingId)?.params ?? {};
  const field = fieldAt(fields, path);
  const value = getAt(drawn(ctx.work, ctx.part), path);
  const item = itemOf(path);
  const list = item && getAt(drawn(ctx.work, ctx.part), item.list);
  const place = Array.isArray(list) && item ? (typeof item.item === "number" ? item.item : list.findIndex((x) => isRecord(x) && x.id === item.item)) : -1;
  const [note, setNote] = useState("");
  if (!field || value === undefined) return null;
  const run = (make: (w: Work) => ReturnType<typeof moveItem>) => void ctx.change(make);
  return (
    <div className={cx("fields")}>
      {item && Array.isArray(list) && (
        <nav className={cx("item-acts")}>
          <button aria-label={c.up} data-tip={c.up} disabled={place <= 0} onClick={() => run((w) => moveItem(w, ctx.sceneId, ctx.part.id, item.list, item.item, place - 1))}>
            <ArrowUp size={14} />
          </button>
          <button aria-label={c.down} data-tip={c.down} disabled={place >= list.length - 1} onClick={() => run((w) => moveItem(w, ctx.sceneId, ctx.part.id, item.list, item.item, place + 1))}>
            <ArrowDown size={14} />
          </button>
          <button aria-label={c.duplicate} data-tip={c.duplicate} onClick={() => run((w) => duplicateItem(w, ctx.sceneId, ctx.part.id, item.list, item.item).edit)}>
            <Copy size={14} />
          </button>
          <button
            aria-label={c.remove}
            data-tip={c.remove}
            data-tone="danger"
            onClick={() => {
              const { along } = removeItem(ctx.work, ctx.sceneId, ctx.part.id, item.list, item.item);
              setNote(along ? c.removedAlong(along) : "");
              run((w) => removeItem(w, ctx.sceneId, ctx.part.id, item.list, item.item).edit);
            }}
          >
            <Trash2 size={14} />
          </button>
        </nav>
      )}
      {field.type === "record" || field.type === "tree" ? (
        <RecordForm ctx={ctx} path={path} field={field.type === "tree" ? { type: "record", fields: field.fields } : field} value={isRecord(value) ? value : {}} />
      ) : (
        <Value ctx={ctx} path={path} field={field} value={value} name={named(t, String(parsePath(path).at(-2) ?? path), field)} />
      )}
      {note && (
        <small className={cx("list-note")} role="status">
          {note}
        </small>
      )}
    </div>
  );
}
